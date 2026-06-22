-- Team-shared rotation.
--
-- The rotation schedule is NOT end-to-end encrypted (it's a work schedule, not
-- a secret) so it can be served to multiple authenticated users. Personal data
-- (calendar, vacations, invoices, tasks) stays in the encrypted vault tables
-- from 0001 and is untouched here.
--
-- Roles, resolved from the JWT email claim:
--   admin  → email in admin_emails   (manages rotation + team allowlist)
--   team   → email in team_members   (read-only view of the rotation)
--   none   → neither                 (no access to the shared rotation)

-- ── Allowlists ──────────────────────────────────────────────────────────
create table if not exists public.admin_emails (
  email text primary key
);

create table if not exists public.team_members (
  email text primary key,
  added_at timestamptz not null default now()
);

-- Bootstrap admin. Change/add rows here or via SQL later.
insert into public.admin_emails(email) values ('mtouaamourad@gmail.com')
  on conflict (email) do nothing;

-- ── Canonical rotation (singleton row) ──────────────────────────────────
create table if not exists public.shared_rotation (
  id int primary key default 1,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint shared_rotation_singleton check (id = 1)
);
insert into public.shared_rotation(id, config) values (1, '{}'::jsonb)
  on conflict (id) do nothing;

-- ── Role helpers (SECURITY DEFINER so they can read allowlists under RLS) ─
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admin_emails
    where email = (auth.jwt() ->> 'email')
  );
$$;

create or replace function public.is_team_member()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.team_members
    where email = (auth.jwt() ->> 'email')
  );
$$;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select case
    when public.is_admin() then 'admin'
    when public.is_team_member() then 'team'
    else 'none'
  end;
$$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_team_member() to authenticated;
grant execute on function public.my_role() to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────
alter table public.admin_emails  enable row level security;
alter table public.team_members  enable row level security;
alter table public.shared_rotation enable row level security;

-- admin_emails: only admins can see/manage it
drop policy if exists admin_emails_admin_all on public.admin_emails;
create policy admin_emails_admin_all on public.admin_emails
  for all using (public.is_admin()) with check (public.is_admin());

-- team_members: admins manage; a user may read their own row
drop policy if exists team_members_admin_all on public.team_members;
create policy team_members_admin_all on public.team_members
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists team_members_self_read on public.team_members;
create policy team_members_self_read on public.team_members
  for select using (email = (auth.jwt() ->> 'email'));

-- shared_rotation: team (incl. admin) reads; only admin writes
drop policy if exists shared_rotation_read on public.shared_rotation;
create policy shared_rotation_read on public.shared_rotation
  for select using (public.is_team_member());

drop policy if exists shared_rotation_insert on public.shared_rotation;
create policy shared_rotation_insert on public.shared_rotation
  for insert with check (public.is_admin());

drop policy if exists shared_rotation_update on public.shared_rotation;
create policy shared_rotation_update on public.shared_rotation
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists shared_rotation_delete on public.shared_rotation;
create policy shared_rotation_delete on public.shared_rotation
  for delete using (public.is_admin());

-- keep updated_at fresh on writes
drop trigger if exists shared_rotation_touch on public.shared_rotation;
create trigger shared_rotation_touch before update on public.shared_rotation
  for each row execute function public.touch_updated_at();
