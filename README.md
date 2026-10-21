# TeamPoker

Live planning poker without account registration. A presenter creates a table, shares its invitation, and reveals everyone's estimates together.

**Hosting:** a static React/TypeScript app on Netlify, with Supabase for anonymous identity, PostgreSQL storage, and Realtime. No separate server or paid hosting plan is required for a small deployment within each provider's free-tier limits. Free-tier quotas, inactivity pauses, and availability policies still apply; check the providers' current terms. This repository is not already deployed.

## Features

- Separate invitation links, membership, cards, rounds, and votes for every session.
- Display names with persistent, anonymous browser identities; no passwords.
- Presenter-only reveal, round reset, and ordered score-card configuration.
- Numeric and custom score labels; votes can change until reveal.
- Private vote values, shared voting status, and real-time revealed results.
- Revealed results list voter names under each score, identify non-voters, and show a final score snapped to the card nearest the average, including ties.
- Responsive keyboard-accessible interface, connection status, and polling recovery.

### Final scores

The final score is the available card nearest the average, not the raw decimal average or the most frequent vote. Exactly tied nearest cards are both shown, and a card does not need any votes to be the result.

- **Numeric votes:** average actual values and select the nearest numeric card(s). For cards `1–6`, an average of `3.4` gives `3`; `3.5` gives `3 / 4`. Unused custom cards such as `?` are not numeric candidates.
- **Custom or mixed-label votes:** treat the complete configured card order as equally spaced positions, average the voted positions, and select the nearest card(s). With `S, M, L, XL`, one `S` and one `XL` give `M / L`; two `S`, six `M`, and one `XL` give `M`.
- Participants who have not voted do not affect the average. Reordering custom cards changes their scale.

## 1. Create and configure Supabase

You need your own Supabase account and project. There is no database server to install or manage locally, and you do not need to write SQL.

1. Create a project at [Supabase](https://supabase.com/dashboard).
2. In **Authentication → Sign In / Providers**, enable **Anonymous Sign-Ins**. This is distinct from the public `anon` API role: visitors sign in anonymously and then use the `authenticated` role.
3. In the project's **SQL Editor**, paste and run the entire file [`supabase/migrations/202610200001_poker.sql`](supabase/migrations/202610200001_poker.sql) once. It creates the tables, protected API, permissions, and the Realtime publication entry. Keep the migration file unchanged after applying it; use new migrations for later changes.
4. Under the API settings / Connect dialog, copy the **project URL** and **publishable key** (the legacy **anon key** also works).
5. Keep `poker_private` **out of the exposed API schemas**. The default `public` API schema is sufficient. Do not add the private tables to Realtime. Only `public.session_updates` should be published for this app; the migration does this automatically.

The SQL Editor is just a one-time way to apply the included setup file. If you already use the Supabase CLI, you can instead link the project and apply it with `supabase db push`.

**Never put a service-role/secret key or database password in the frontend or Netlify build variables.** Vite's `VITE_` variables are intentionally public. Database authorization protects the data even though the publishable key is public.

## 2. Run locally

### Docker (no Node.js or npm installation needed)

Requires Docker. Complete the Supabase setup above, then:

```sh
cp .env.example .env
```

Fill in your Supabase URL and publishable key in `.env`, then run:

```sh
bash scripts/dev-docker.sh
```

Open **http://localhost:5173**. The container installs dependencies automatically; source changes reload in the browser. Stop with Ctrl+C. This launcher uses a temporary dependency volume that is removed when the container exits. Restart it after editing `.env`.

Supabase still runs in your hosted project—this does not start a local Supabase stack. No Node.js, npm, or Docker Compose installation is needed on your computer.

#### Optional: Docker Compose

If you have Docker Compose (included in Docker Desktop), you can instead run:

```sh
docker compose up
```

This uses the same URL and keeps dependencies in a reusable Docker volume, separate from any host `node_modules`.

Stop with Ctrl+C, then `docker compose down`. After editing `.env`, run `docker compose restart app`.

With the app running, checks can also run inside Docker:

```sh
docker compose exec app npm test
docker compose exec app npm run typecheck
docker compose exec app npm run build
```

Database tests need only Docker and a host shell: `bash scripts/test-db.sh`.

### Node.js

Requires Node.js **22.12+** and npm.

```sh
npm ci
cp .env.example .env
```

Fill in `.env`:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-or-anon-key
```

```sh
npm run dev
```

Open the URL printed by Vite. Without the environment variables the app shows setup instructions instead of trying to connect. Restart Vite after editing `.env`.

Create a session, then open its invitation in a **different browser or private window** to simulate another participant. Tabs in the same browser profile share an identity and represent the same person.

## 3. Deploy to Netlify

1. Push this repository to your Git provider.
2. Create a Netlify site by importing the repository. `netlify.toml` sets the build command (`npm run build`), publish directory (`dist`), Node version, and SPA routing for invitation URLs.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to the site's build environment variables.
4. Deploy. Environment changes require a new build because Vite embeds the values in the bundle.
5. Set the Supabase Auth **Site URL** to your Netlify HTTPS address. This app does not use email or OAuth redirects.
6. Verify the checklist below on the real deployment. No Netlify Functions or persistent WebSocket server is needed: browsers connect directly to Supabase Realtime over HTTPS/WSS.

Do not enable Supabase's CAPTCHA requirement without also adding a CAPTCHA widget and passing its token to anonymous sign-in; this MVP does not include a CAPTCHA integration. Use Supabase's authentication rate limits, monitor usage, and evaluate CAPTCHA before exposing the app broadly. Anyone who knows an invitation can join that session; invitations are not passwords or presenter credentials.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm audit
```

Database authorization and privacy tests require Docker:

```sh
npm run test:db
```

This script starts a **disposable** PostgreSQL 17 container, adds minimal auth-role/identity stubs, applies the real migration, runs [`supabase/tests/poker.sql`](supabase/tests/poker.sql), and removes the container. It does not touch your Supabase project. The stubs exercise SQL authorization, not Supabase's JWT validation or hosted Realtime infrastructure. You can also run the test SQL in an empty development Supabase project's SQL Editor after applying the migration; all test inserts are rolled back. Do not run tests against production data.

GitHub Actions runs the app checks and database tests independently.

### Live acceptance checklist

- Create a session as Alice; join from a separate browser as Bob.
- Confirm both names appear without a reload. Vote in both browsers and change a vote.
- Verify only status, not others' values, is returned by `poker('snapshot', ...)` before reveal (inspect Network responses).
- Verify Bob cannot reveal or configure cards, including by calling the API directly.
- Reveal as Alice; confirm both clients see every score and matching results.
- Start another round; confirm all votes clear and old-round writes are rejected.
- Configure `S, M, L, XL`: one `S` and one `XL` vote should give `M / L`. Two `S`, six `M`, and one `XL` should give `M`. Reorder cards and verify custom-label results follow the new order.
- Create a second session and verify its participants, votes, and results are isolated.
- Reload the presenter's browser and verify the presenter role persists.
- Disconnect/reconnect a participant and verify changes catch up. The app polls every ten seconds as a fallback and refreshes on focus/online/re-subscription.

## How privacy works

- Actual session, participant, round, option, and vote tables live in `poker_private`. Clients have no schema/table access; RLS is enabled with no client policies.
- The sole game API is the `public.poker` database function. It uses the authenticated `auth.uid()` for membership, ownership, and presenter checks—not request-supplied user IDs or display names.
- Snapshots show each person's voting status but return `null` for other people's hidden values. A voter can see their own selection. Revealed snapshots expose all current-round votes to members.
- Realtime publishes **only a session ID and revision counter**, with member-only row access. Clients fetch a freshly authorized snapshot after each notification. Private vote rows never enter a Realtime stream.
- Session row locks serialize mutations and snapshots. Every vote, reveal, and round-change request includes the expected round ID, preventing stale requests from affecting a fresh round.
- Card configuration creates a new round atomically. Existing votes remain in their old round and never get silently reassigned to different cards.

## MVP limitations and operations

- Browser storage is the presenter's credential. Clearing it, using a new device, or deleting the anonymous user loses presenter access. There is no presenter recovery or role transfer.
- Participants are session members, **not an online-presence list**. Closing a tab does not remove its name; reveal can happen before everyone votes. No kicks, leave action, or automatic membership expiry are included.
- Sessions and old rounds persist until you delete them. For a small MVP, use a dedicated Supabase project and periodically clean up unused data. There is no automatic retention job or analytics tracking.
- No session passwords, ticket tracking, cross-device recovery, or offline voting. Invitation URLs grant membership, so share them only with intended teammates.
- Free-tier usage is finite. Monitor Netlify and Supabase quotas, Auth rate limits, database size, and Realtime connections. Large/public use needs abuse protections and a retention policy before launch.
- Google Fonts is optional presentation only; system sans-serif fallbacks work if external fonts are blocked.

See [`PLAN.md`](PLAN.md) for the agreed scope.
