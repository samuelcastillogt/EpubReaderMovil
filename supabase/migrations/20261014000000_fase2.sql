-- Fase 2: lista de espera (fake door), respaldo y control de uso de IA.

create table if not exists public.waitlist (
  id bigint generated always as identity primary key,
  email text not null,
  source text,
  created_at timestamptz not null default now()
);
alter table public.waitlist enable row level security;
drop policy if exists "waitlist_insert" on public.waitlist;
create policy "waitlist_insert" on public.waitlist
  for insert to anon, authenticated with check (char_length(email) between 5 and 254);

create table if not exists public.backups (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.backups enable row level security;
drop policy if exists "backups_select_own" on public.backups;
drop policy if exists "backups_insert_own" on public.backups;
drop policy if exists "backups_update_own" on public.backups;
create policy "backups_select_own" on public.backups
  for select to authenticated using (auth.uid() = user_id);
create policy "backups_insert_own" on public.backups
  for insert to authenticated with check (auth.uid() = user_id);
create policy "backups_update_own" on public.backups
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Solo la Edge Function (service role) lee y escribe esta tabla.
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  book_id text not null,
  chars integer not null,
  model text not null,
  created_at timestamptz not null default now()
);
alter table public.ai_usage enable row level security;
create index if not exists ai_usage_user_created_idx on public.ai_usage (user_id, created_at desc);
create index if not exists ai_usage_user_book_idx on public.ai_usage (user_id, book_id);
