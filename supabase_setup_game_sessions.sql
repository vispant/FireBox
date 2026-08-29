-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Tracks which game was played, when, and for how long — for both signed-in users
-- and guests (a guest's row has a null user_id, since guests never get a Supabase
-- Auth session in this app). View this data directly in the Supabase Table Editor;
-- the app itself only ever writes to it, never reads it back.
--
-- guest_id is a random UUID the app generates once per browser and stores in
-- localStorage (fireBox.guestId.v1) — it's the only way to tell "one guest played
-- 10 times" apart from "10 different guests played once each", since user_id alone
-- is null for every guest. It's sent for signed-in users too (same browser value),
-- so count(distinct user_id) still gives true unique signed-in players; use
-- count(distinct guest_id) filtered to user_id is null for unique guests.

create table public.game_sessions (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  guest_id uuid,
  game_id text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds int
);

alter table public.game_sessions enable row level security;

-- Same trust model as arena_rooms elsewhere in this project: client-side hobby
-- analytics, open to signed-in users and guests alike.
--
-- A SELECT policy is required even though the app's own UI never displays this
-- data: main.js does `.insert({...}).select("id").single()` so it can capture
-- the new row's id and fill in ended_at/duration_seconds later. That `.select()`
-- asks Postgres to RETURN the just-inserted row, and RETURNING is filtered by
-- the SELECT policy same as a real read — with none defined, RLS blocks the
-- whole insert (not just the returned data), which silently broke session
-- logging entirely until this policy was added.
create policy "Anyone can log a session starting"
  on public.game_sessions for insert
  with check (true);

create policy "Anyone can log a session ending"
  on public.game_sessions for update
  using (true);

create policy "Anyone can view sessions"
  on public.game_sessions for select
  using (true);
