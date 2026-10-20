-- All game data is private. The only published table contains a revision counter,
-- never identities, names, options, or votes. All access goes through poker().
create schema if not exists poker_private;
revoke all on schema poker_private from public, anon, authenticated;

create table poker_private.sessions (
  id uuid primary key default gen_random_uuid(),
  presenter_id uuid not null references auth.users(id),
  current_round_id uuid,
  created_at timestamptz not null default now()
);

create table poker_private.participants (
  session_id uuid not null references poker_private.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  name text not null check (length(btrim(name)) between 1 and 60),
  joined_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create table poker_private.rounds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references poker_private.sessions(id) on delete cascade,
  number integer not null check (number > 0),
  revealed boolean not null default false,
  unique (session_id, number),
  unique (session_id, id)
);

alter table poker_private.sessions add constraint current_round_in_session
  foreign key (id, current_round_id) references poker_private.rounds(session_id, id);

create table poker_private.score_options (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references poker_private.rounds(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 30),
  position integer not null check (position >= 0),
  unique (round_id, label),
  unique (round_id, position),
  unique (round_id, id)
);

create table poker_private.votes (
  round_id uuid not null,
  session_id uuid not null,
  user_id uuid not null,
  option_id uuid not null,
  primary key (round_id, user_id),
  foreign key (session_id, round_id) references poker_private.rounds(session_id, id) on delete cascade,
  foreign key (session_id, user_id) references poker_private.participants(session_id, user_id) on delete cascade,
  foreign key (round_id, option_id) references poker_private.score_options(round_id, id)
);

-- Defense in depth: private tables are not exposed by PostgREST, have no client
-- grants, and have RLS enabled with no client policies.
alter table poker_private.sessions enable row level security;
alter table poker_private.participants enable row level security;
alter table poker_private.rounds enable row level security;
alter table poker_private.score_options enable row level security;
alter table poker_private.votes enable row level security;
revoke all on all tables in schema poker_private from public, anon, authenticated;

create table public.session_updates (
  id uuid primary key references poker_private.sessions(id) on delete cascade,
  revision bigint not null default 1
);
alter table public.session_updates enable row level security;
revoke all on public.session_updates from public, anon, authenticated;
grant select on public.session_updates to authenticated;

create function public.is_poker_member(session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from poker_private.participants p
    where p.session_id = $1 and p.user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_poker_member(uuid) from public, anon;
grant execute on function public.is_poker_member(uuid) to authenticated;
create policy "Members can read revision counters" on public.session_updates
  for select to authenticated using (public.is_poker_member(id));

-- A single transactional API. Every operation locks its session, serializing
-- votes/reveal/new-round races. Round IDs reject delayed writes to old rounds.
create function public.poker(action text, payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  sid uuid;
  rid uuid;
  game poker_private.sessions%rowtype;
  current_round poker_private.rounds%rowtype;
  display_name text;
  labels jsonb;
  chosen uuid;
  result jsonb;
begin
  if caller is null then
    raise exception 'Sign in before accessing a session.' using errcode = '42501';
  end if;
  if action is null or action not in ('create', 'join', 'snapshot', 'vote', 'reveal', 'next_round') then
    raise exception 'Unknown action.' using errcode = '22023';
  end if;

  if action in ('create', 'join') then
    display_name := btrim(payload ->> 'name');
    if display_name is null or length(display_name) not between 1 and 60 then
      raise exception 'Enter a name between 1 and 60 characters.' using errcode = '22023';
    end if;
  end if;

  if action = 'create' then
    insert into poker_private.sessions (presenter_id) values (caller) returning id into sid;
    insert into poker_private.participants (session_id, user_id, name) values (sid, caller, display_name);
    insert into poker_private.rounds (session_id, number) values (sid, 1) returning id into rid;
    insert into poker_private.score_options (round_id, label, position)
      select rid, label, (ordinality - 1)::integer
      from jsonb_array_elements_text('["1", "2", "3", "5", "8", "13", "?"]'::jsonb)
        with ordinality as options(label, ordinality);
    update poker_private.sessions set current_round_id = rid where id = sid;
    insert into public.session_updates (id) values (sid);
  else
    sid := (payload ->> 'sessionId')::uuid;
  end if;

  select * into game from poker_private.sessions where id = sid for update;
  if not found then
    raise exception 'Session not found. Check your invitation link.' using errcode = 'P0002';
  end if;

  if action = 'join' then
    -- The unguessable session UUID is the invitation token. It permits joining,
    -- not presenting. Presenter ownership always comes from auth.uid().
    insert into poker_private.participants (session_id, user_id, name) values (sid, caller, display_name)
      on conflict (session_id, user_id) do update set name = excluded.name;
  end if;

  if not exists (select 1 from poker_private.participants where session_id = sid and user_id = caller) then
    raise exception 'Join this session first.' using errcode = '42501';
  end if;

  select * into current_round from poker_private.rounds where id = game.current_round_id;
  if action in ('vote', 'reveal', 'next_round') then
    if (payload ->> 'roundId')::uuid is distinct from current_round.id then
      raise exception 'The round changed. Refresh and try again.' using errcode = '40001';
    end if;
  end if;

  if action in ('reveal', 'next_round') and game.presenter_id <> caller then
    raise exception 'Only the presenter can do that.' using errcode = '42501';
  end if;

  if action = 'vote' then
    if current_round.revealed then
      raise exception 'Votes are locked after reveal.' using errcode = '42501';
    end if;
    chosen := (payload ->> 'optionId')::uuid;
    if not exists (select 1 from poker_private.score_options where round_id = current_round.id and id = chosen) then
      raise exception 'Choose a card from this round.' using errcode = '22023';
    end if;
    insert into poker_private.votes (round_id, session_id, user_id, option_id)
      values (current_round.id, sid, caller, chosen)
      on conflict (round_id, user_id) do update set option_id = excluded.option_id;
  elsif action = 'reveal' then
    update poker_private.rounds set revealed = true where id = current_round.id;
  elsif action = 'next_round' then
    labels := payload -> 'labels';
    if labels is null then
      select jsonb_agg(label order by position) into labels
        from poker_private.score_options where round_id = current_round.id;
    end if;
    if jsonb_typeof(labels) is distinct from 'array' then
      raise exception 'Cards must be a list.' using errcode = '22023';
    end if;
    if jsonb_array_length(labels) = 0 then
      raise exception 'Add at least one card.' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(labels) as item(value)
      where jsonb_typeof(value) is distinct from 'string') then
      raise exception 'Card labels must be text.' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements_text(labels) as item(label)
      where length(btrim(label)) not between 1 and 30) then
      raise exception 'Card labels must be between 1 and 30 characters.' using errcode = '22023';
    end if;
    if (select count(*) <> count(distinct btrim(label)) from jsonb_array_elements_text(labels) as item(label)) then
      raise exception 'Each card needs a unique label.' using errcode = '22023';
    end if;
    insert into poker_private.rounds (session_id, number) values (sid, current_round.number + 1) returning id into rid;
    insert into poker_private.score_options (round_id, label, position)
      select rid, btrim(label), (ordinality - 1)::integer
      from jsonb_array_elements_text(labels) with ordinality as options(label, ordinality);
    update poker_private.sessions set current_round_id = rid where id = sid;
    game.current_round_id := rid;
  end if;

  if action not in ('snapshot', 'create') then
    update public.session_updates set revision = revision + 1 where id = sid;
  end if;

  select jsonb_build_object(
    'id', game.id, 'presenterId', game.presenter_id,
    'revision', (select revision from public.session_updates where id = sid),
    'round', jsonb_build_object(
      'id', r.id, 'number', r.number, 'revealed', r.revealed,
      'options', (select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label) order by o.position)
        from poker_private.score_options o where o.round_id = r.id)
    ),
    'participants', (select jsonb_agg(jsonb_build_object(
      'id', p.user_id, 'name', p.name, 'hasVoted', v.option_id is not null,
      'optionId', case when r.revealed or p.user_id = caller then v.option_id else null end
    ) order by p.joined_at, p.user_id)
      from poker_private.participants p
      left join poker_private.votes v on v.round_id = r.id and v.user_id = p.user_id
      where p.session_id = sid)
  ) into result from poker_private.rounds r where r.id = game.current_round_id;
  return result;
end;
$$;

revoke all on function public.poker(text, jsonb) from public, anon;
grant execute on function public.poker(text, jsonb) to authenticated;

-- Deliberately do NOT publish the votes table (even with RLS).
alter publication supabase_realtime add table public.session_updates;
