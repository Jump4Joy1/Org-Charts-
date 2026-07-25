-- OrgChart Builder — cloud sync setup
-- Run this once in your Supabase project's SQL Editor.
--
-- Security model: the anon key alone gets you nothing. The table itself is
-- not readable or writable by the anon role; the only things exposed are the
-- two functions below, and both demand the sync code. The sync code is the
-- secret that guards your charts, so treat it like a password.

create table if not exists public.oc_charts (
  space      text   not null,
  chart_id   text   not null,
  payload    jsonb,
  deleted    boolean not null default false,
  updated_at bigint not null,
  primary key (space, chart_id)
);

alter table public.oc_charts enable row level security;

-- No direct table access for the anon key — everything goes through the
-- functions, which check the space (sync code) first.
revoke all on table public.oc_charts from anon, authenticated;

-- Read every chart belonging to one sync code.
create or replace function public.oc_pull(p_space text, p_since bigint default 0)
returns table (chart_id text, payload jsonb, deleted boolean, updated_at bigint)
language sql
security definer
set search_path = public
as $$
  select c.chart_id, c.payload, c.deleted, c.updated_at
  from public.oc_charts c
  where c.space = p_space
    and length(p_space) >= 16
    and c.updated_at > coalesce(p_since, 0);
$$;

-- Write one chart. Older writes are ignored, so a stale device that comes
-- back online cannot clobber newer work.
create or replace function public.oc_push(
  p_space text,
  p_chart_id text,
  p_payload jsonb,
  p_deleted boolean,
  p_updated_at bigint
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing bigint;
begin
  if length(p_space) < 16 then
    raise exception 'sync code too short';
  end if;

  select c.updated_at into v_existing
  from public.oc_charts c
  where c.space = p_space and c.chart_id = p_chart_id;

  if v_existing is not null and v_existing >= p_updated_at then
    return v_existing;
  end if;

  insert into public.oc_charts (space, chart_id, payload, deleted, updated_at)
  values (p_space, p_chart_id, p_payload, coalesce(p_deleted, false), p_updated_at)
  on conflict (space, chart_id) do update
    set payload = excluded.payload,
        deleted = excluded.deleted,
        updated_at = excluded.updated_at;

  return p_updated_at;
end;
$$;

grant execute on function public.oc_pull(text, bigint) to anon, authenticated;
grant execute on function public.oc_push(text, text, jsonb, boolean, bigint) to anon, authenticated;
