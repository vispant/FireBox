-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Adds a lightweight "room directory" so Snake Arena's "Play Online" button can find
-- an existing public arena to join, or know to create a new one. Realtime channels
-- themselves aren't listable from the client, so this small table is what makes
-- matchmaking possible — it only stores a room code, a heartbeat timestamp, and a
-- rough player count, nothing personal.

create table public.arena_rooms (
  code text primary key,
  host_id text not null,
  player_count int not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.arena_rooms enable row level security;

-- This project's trust model (see profiles/leaderboard) already accepts client-side
-- spoofing as a hobby-scale tradeoff, and guests (no Supabase Auth session) need to
-- create/update rooms too — so these policies are intentionally open rather than
-- scoped to auth.uid(), matching the rest of the app.
create policy "Anyone can view rooms"
  on public.arena_rooms for select
  using (true);

create policy "Anyone can create a room"
  on public.arena_rooms for insert
  with check (true);

create policy "Anyone can update rooms"
  on public.arena_rooms for update
  using (true);

create policy "Anyone can delete rooms"
  on public.arena_rooms for delete
  using (true);
