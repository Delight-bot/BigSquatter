-- Optional cloud sync for Squat Challenge.
--
-- The app is local-first and fully functional without this. Running the file in
-- the Supabase SQL editor, then setting VITE_SUPABASE_URL and
-- VITE_SUPABASE_ANON_KEY, turns on backup and multi-device sync.
--
-- Shape note: a challenge is at most 30 day-records plus a capped session list,
-- which is small enough to keep as JSONB on one row. That keeps a sync a single
-- idempotent upsert instead of a diff across two child tables — the right
-- trade-off at this size, and easy to normalise later if per-rep analytics are
-- ever needed.

create table if not exists public.challenges (
  id            uuid primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  start_date    date not null,
  days          jsonb not null default '{}'::jsonb,
  sessions      jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists challenges_user_updated_idx
  on public.challenges (user_id, updated_at desc);

alter table public.challenges enable row level security;

-- Every policy is scoped to auth.uid(): with RLS on and these four policies, the
-- anon key shipped in the client can only ever reach the signed-in user's rows.
create policy "Users read their own challenges"
  on public.challenges for select
  using (auth.uid() = user_id);

create policy "Users create their own challenges"
  on public.challenges for insert
  with check (auth.uid() = user_id);

create policy "Users update their own challenges"
  on public.challenges for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete their own challenges"
  on public.challenges for delete
  using (auth.uid() = user_id);

-- Keep updated_at honest regardless of what the client sends, so "most recently
-- updated wins" is a claim the database can back.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists challenges_touch_updated_at on public.challenges;
create trigger challenges_touch_updated_at
  before update on public.challenges
  for each row execute function public.touch_updated_at();
