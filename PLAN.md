# TeamPoker — Implementation Plan

## Goal

Build a live planning-poker web app for teams. Multiple independent sessions can run at the same time. Participants do not need accounts, but must enter a display name before creating or joining a session.

## Agreed MVP

- A presenter enters their name and creates a session.
- Each session has a unique invitation link that the presenter can share.
- Participants open the link, enter their name, and join that session.
- Sessions keep their participants, score options, votes, and results separate.
- The presenter can add, edit, remove, and reorder any number of score cards.
- Cards support numeric scores such as `1, 2, 3, 4, 5` and custom labels such as `S, M, L, XL`.
- All participants, including the presenter, can vote and change their vote before reveal.
- Everyone can see who has voted, but cannot see hidden vote values.
- Only the presenter can reveal votes and start another round.
- Revealing votes shows every participant's name and score to everyone in real time.
- Results include counts per score and the available card nearest the average, showing both nearest cards when tied. Numeric votes use actual values; custom labels use configured card order as an evenly spaced scale.
- Starting another round clears the current votes.
- Presenter controls belong to the presenter's authenticated browser identity, not to everyone who has the invitation link.

## Technology and Hosting

- React and TypeScript for the responsive web interface.
- Netlify for hosting the web app.
- Supabase for persistent data, anonymous authentication, authorization, and real-time updates.
- Anonymous authentication provides an internal identity without requiring account registration or passwords. Display names are entered separately.

## Implementation Steps

1. Set up the React/TypeScript project, development commands, and Netlify configuration.
2. Define Supabase tables and migrations for sessions, participants, ordered score options, rounds, and votes.
3. Implement database authorization so only members can access a session, each voter can manage only their own vote, and only the presenter can configure cards, reveal votes, or begin a round.
4. Protect unrevealed vote values at the database/API level, including real-time subscriptions; expose voting status separately from private vote values.
5. Build the name-entry, session-creation, invitation, and join flows.
6. Build the session screen with score-card editing, participant voting status, and presenter controls.
7. Add real-time synchronization for membership, voting status, reveal state, and round changes.
8. Add revealed results and nearest-average-card final scores for numeric and ordered custom scales, including ties.
9. Add responsive styling, loading and error states, reconnect handling, and accessible controls.
10. Test session isolation, presenter permissions, hidden-vote privacy, voting and reveal flows, custom scores, and result calculations.
11. Document local setup, Supabase configuration and migrations, required environment variables, and deployment to Netlify.

## Implementation Defaults

- Score options are configured before voting; changing them requires starting a fresh round so existing votes are not invalidated silently.
- Votes cannot be changed after reveal; the presenter starts a new round to resume voting.
- Final scores are cards, not decimal averages. When all submitted scores are numeric, average their actual values and choose the nearest numeric card(s). Otherwise, average positions in the complete configured card order and choose the nearest card(s). Unvoted cards can be the final score; participants without votes are excluded.
- Display names are labels, not proof of identity; permissions use anonymous authentication IDs.
- Reloading the same browser preserves its anonymous identity where browser storage remains available. Cross-device presenter recovery is outside the MVP.

## Verification and Delivery

- Run available automated tests, type checks, and the production build.
- Provide deployment instructions and clearly identify any setup that requires the owner's Supabase or Netlify account.
- Do not claim deployed or live-verified functionality without actually performing those checks.
