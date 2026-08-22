-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Tracks which game was played, when, and for how long — for both signed-in users
-- and guests (a guest's row just has a null user_id, since guests never get a
-- Supabase Auth session in this app). View this data directly in the Supabase
-- Table Editor; the app itself only ever writes to it, never reads it back.

create table public.game_sessions (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  game_id text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds int
);

alter table public.game_sessions enable row level security;

-- Same trust model as arena_rooms elsewhere in this project: client-side hobby
-- analytics, open to signed-in users and guests alike. No SELECT policy is
-- defined on purpose — the app never reads this table back, so the public key
-- can write to it but not read it. You can still see everything yourself in the
-- Table Editor / SQL Editor, since dashboard access isn't subject to these
-- policies.
create policy "Anyone can log a session starting"
  on public.game_sessions for insert
  with check (true);

create policy "Anyone can log a session ending"
  on public.game_sessions for update
  using (true);
