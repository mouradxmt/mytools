-- mytools schema. Plain Postgres + RLS.
-- Works with hosted Supabase, self-hosted Supabase Docker, or any Postgres
-- if you supply your own auth.uid() function.

create extension if not exists "uuid-ossp";

-- Per-user vault metadata: master_key wrapped twice (by password-derived KEK
-- and by recovery-code-derived KEK). The server NEVER sees plaintext.
create table if not exists public.vault_meta (
  user_id uuid primary key references auth.users(id) on delete cascade,
  schema_version int not null default 1,
  wrap_pass_iv text not null,
  wrap_pass_ct text not null,
  wrap_recovery_iv text,
  wrap_recovery_ct text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vault_meta enable row level security;

drop policy if exists "vault_meta own" on public.vault_meta;
create policy "vault_meta own" on public.vault_meta
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Per-namespace encrypted blobs (one row per app section).
create table if not exists public.vault_blobs (
  user_id uuid not null references auth.users(id) on delete cascade,
  namespace text not null,
  iv text not null,
  ct text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, namespace)
);

alter table public.vault_blobs enable row level security;

drop policy if exists "vault_blobs own" on public.vault_blobs;
create policy "vault_blobs own" on public.vault_blobs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists vault_blobs_user_updated_idx
  on public.vault_blobs(user_id, updated_at desc);

-- Auto-stamp updated_at on writes.
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists vault_meta_touch on public.vault_meta;
create trigger vault_meta_touch before update on public.vault_meta
  for each row execute function public.touch_updated_at();

drop trigger if exists vault_blobs_touch on public.vault_blobs;
create trigger vault_blobs_touch before update on public.vault_blobs
  for each row execute function public.touch_updated_at();
