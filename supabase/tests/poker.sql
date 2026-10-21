-- Portable integration/security tests. Run after the migration as postgres.
-- Everything, including test users, is rolled back.
begin;

insert into auth.users (id) values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003');

create function pg_temp.assert_true(condition boolean, description text)
returns void language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'FAIL: %', description; end if;
  raise notice 'PASS: %', description;
end;
$$;

create function pg_temp.expect_error(action text, payload jsonb, message text)
returns void language plpgsql as $$
begin
  begin
    perform public.poker(action, payload);
  exception when others then
    if position(message in sqlerrm) > 0 then
      raise notice 'PASS: rejected % (%)', action, message;
      return;
    end if;
    raise;
  end;
  raise exception 'FAIL: expected % to reject with %', action, message;
end;
$$;

set local role authenticated;

do $$
declare
  alice text := '00000000-0000-4000-8000-000000000001';
  bob text := '00000000-0000-4000-8000-000000000002';
  carol text := '00000000-0000-4000-8000-000000000003';
  a jsonb;
  b jsonb;
  view jsonb;
  sid text;
  rid text;
  option1 text;
  option2 text;
begin
  perform set_config('request.jwt.claim.sub', alice, true);
  perform pg_temp.expect_error('create', '{"name":" "}', 'Enter a name');
  a := public.poker('create', '{"name":"Alice"}');
  sid := a ->> 'id';
  rid := a #>> '{round,id}';
  option1 := a #>> '{round,options,0,id}';
  option2 := a #>> '{round,options,1,id}';
  perform pg_temp.assert_true(a ->> 'presenterId' = alice, 'presenter is authenticated creator');
  perform pg_temp.assert_true(jsonb_array_length(a -> 'participants') = 1, 'creator joins automatically');
  a := public.poker('vote', jsonb_build_object('sessionId', sid, 'roundId', rid, 'optionId', option1));
  perform pg_temp.assert_true(a #>> '{participants,0,optionId}' = option1, 'voter can see own hidden value');

  perform set_config('request.jwt.claim.sub', bob, true);
  perform pg_temp.expect_error('snapshot', jsonb_build_object('sessionId', sid), 'Join this session first');
  perform pg_temp.assert_true((select count(*) from public.session_updates) = 0, 'nonmember cannot read revision rows');
  b := public.poker('create', '{"name":"Bob"}');
  perform pg_temp.assert_true(b ->> 'id' <> sid, 'independent invitation IDs');
  view := public.poker('join', jsonb_build_object('sessionId', sid, 'name', 'Bob', 'presenterId', bob));
  perform pg_temp.assert_true(view ->> 'presenterId' = alice, 'invitation cannot transfer presenter role');
  perform pg_temp.assert_true(view #>> '{participants,0,hasVoted}' = 'true', 'other member sees voting status');
  perform pg_temp.assert_true(view #>> '{participants,0,optionId}' is null, 'other member cannot see hidden value');
  perform pg_temp.expect_error('reveal', jsonb_build_object('sessionId', sid, 'roundId', rid), 'Only the presenter');
  perform pg_temp.expect_error('next_round', jsonb_build_object('sessionId', sid, 'roundId', rid, 'labels', '["X"]'::jsonb), 'Only the presenter');
  -- Supplying another user's ID must not alter their vote.
  view := public.poker('vote', jsonb_build_object('sessionId', sid, 'roundId', rid, 'optionId', option2, 'userId', alice));
  perform pg_temp.assert_true(view #>> '{participants,1,optionId}' = option2, 'vote ownership always uses auth identity');
  perform pg_temp.expect_error('vote', jsonb_build_object('sessionId', sid, 'roundId', rid, 'optionId', b #>> '{round,options,0,id}'), 'Choose a card');

  perform set_config('request.jwt.claim.sub', carol, true);
  perform pg_temp.expect_error('snapshot', jsonb_build_object('sessionId', sid), 'Join this session first');
  perform pg_temp.expect_error('vote', jsonb_build_object('sessionId', sid, 'roundId', rid, 'optionId', option1), 'Join this session first');

  perform set_config('request.jwt.claim.sub', alice, true);
  view := public.poker('snapshot', jsonb_build_object('sessionId', sid));
  perform pg_temp.assert_true(view #>> '{participants,0,optionId}' = option1, 'forged voter ID did not modify Alice vote');
  view := public.poker('vote', jsonb_build_object('sessionId', sid, 'roundId', rid, 'optionId', option2));
  perform pg_temp.assert_true(view #>> '{participants,0,optionId}' = option2, 'vote can change before reveal');
  view := public.poker('reveal', jsonb_build_object('sessionId', sid, 'roundId', rid));
  perform pg_temp.assert_true(view #>> '{round,revealed}' = 'true', 'presenter can reveal');
  perform pg_temp.assert_true(view #>> '{participants,1,optionId}' = option2, 'reveal exposes all submitted values');
  perform pg_temp.expect_error('vote', jsonb_build_object('sessionId', sid, 'roundId', rid, 'optionId', option1), 'Votes are locked');

  perform set_config('request.jwt.claim.sub', bob, true);
  view := public.poker('snapshot', jsonb_build_object('sessionId', sid));
  perform pg_temp.assert_true(view #>> '{round,revealed}' = 'true', 'non-presenter snapshot sees reveal');
  perform pg_temp.assert_true(view #>> '{participants,0,optionId}' = option2 and view #>> '{participants,1,optionId}' = option2, 'non-presenter sees every revealed vote');
  perform set_config('request.jwt.claim.sub', alice, true);

  perform pg_temp.expect_error('next_round', jsonb_build_object('sessionId', sid, 'roundId', rid, 'labels', '[]'::jsonb), 'Add at least one card');
  perform pg_temp.expect_error('next_round', jsonb_build_object('sessionId', sid, 'roundId', rid, 'labels', '["S"," S "]'::jsonb), 'unique label');
  perform pg_temp.expect_error('next_round', jsonb_build_object('sessionId', sid, 'roundId', rid, 'labels', '[1]'::jsonb), 'must be text');
  perform pg_temp.expect_error('next_round', jsonb_build_object('sessionId', sid, 'roundId', rid, 'labels', '[null]'::jsonb), 'must be text');
  perform pg_temp.expect_error('next_round', jsonb_build_object('sessionId', sid, 'roundId', rid, 'labels', '[" "]'::jsonb), 'between 1 and 30');
  view := public.poker('next_round', jsonb_build_object('sessionId', sid, 'roundId', rid, 'labels', '[" XL ","M","S"]'::jsonb));
  perform pg_temp.assert_true(view #>> '{round,number}' = '2', 'round advances');
  perform pg_temp.assert_true(view #>> '{round,revealed}' = 'false', 'new round is hidden');
  perform pg_temp.assert_true(view #>> '{round,options,0,label}' = 'XL' and view #>> '{round,options,2,label}' = 'S', 'custom cards preserve order and trim labels');
  perform pg_temp.assert_true(view #>> '{participants,0,hasVoted}' = 'false' and view #>> '{participants,1,hasVoted}' = 'false', 'new round clears every voting status');
  perform pg_temp.expect_error('vote', jsonb_build_object('sessionId', sid, 'roundId', rid, 'optionId', option1), 'The round changed');
  perform pg_temp.expect_error('reveal', jsonb_build_object('sessionId', sid, 'roundId', rid), 'The round changed');
  perform pg_temp.expect_error('next_round', jsonb_build_object('sessionId', sid, 'roundId', rid), 'The round changed');
  rid := view #>> '{round,id}';
  perform pg_temp.expect_error('vote', jsonb_build_object('sessionId', sid, 'roundId', rid, 'optionId', option1), 'Choose a card');

  perform set_config('request.jwt.claim.sub', bob, true);
  view := public.poker('snapshot', jsonb_build_object('sessionId', b ->> 'id'));
  perform pg_temp.assert_true(jsonb_array_length(view -> 'participants') = 1 and view #>> '{round,number}' = '1', 'other session membership and rounds stay isolated');
  view := public.poker('join', jsonb_build_object('sessionId', sid, 'name', 'Robert'));
  perform pg_temp.assert_true(jsonb_array_length(view -> 'participants') = 2, 'rejoining same identity does not duplicate participant');

  begin
    execute 'select * from poker_private.votes';
    raise exception 'FAIL: private vote table readable';
  exception when insufficient_privilege then raise notice 'PASS: direct vote reads blocked'; end;
  begin
    update public.session_updates set revision = 0;
    raise exception 'FAIL: revision writes allowed';
  exception when insufficient_privilege then raise notice 'PASS: direct revision writes blocked'; end;

  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.expect_error('create', '{"name":"Nobody"}', 'Sign in');
end;
$$;

reset role;
select pg_temp.assert_true(
  not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename <> 'session_updates' and schemaname = 'poker_private'),
  'private data is not published to Realtime'
);
select pg_temp.assert_true(not has_function_privilege('anon', 'public.poker(text,jsonb)', 'EXECUTE'), 'unauthenticated API access blocked');
rollback;
