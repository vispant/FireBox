-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Creates a public profile row per user (display name + coarse country),
-- separate from the private auth.users table Supabase manages itself.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  country text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Display names are shown on the leaderboard, so anyone can read profiles.
create policy "Profiles are viewable by everyone"
  on public.profiles for select
  using (true);

-- Users can only ever create/edit their own row.
create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);
