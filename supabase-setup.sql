-- OrgChart Builder — cloud sync setup (email sign-in)
-- Run this once in your Supabase project's SQL Editor.
--
-- Each row belongs to a signed-in user. Row Level Security ties every read
-- and write to auth.uid(), so a signed-in person can only ever see their own
-- charts — the anon key on its own reads nothing at all.

create table if not exists public.oc_charts_v2 (
  user_id    uuid    not null references auth.users(id) on delete cascade,
  chart_id   text    not null,
  payload    jsonb,
  deleted    boolean not null default false,
  updated_at bigint  not null,
  primary key (user_id, chart_id)
);

alter table public.oc_charts_v2 enable row level security;

drop policy if exists "read own charts"   on public.oc_charts_v2;
drop policy if exists "insert own charts" on public.oc_charts_v2;
drop policy if exists "update own charts" on public.oc_charts_v2;

create policy "read own charts" on public.oc_charts_v2
  for select to authenticated using (user_id = auth.uid());
create policy "insert own charts" on public.oc_charts_v2
  for insert to authenticated with check (user_id = auth.uid());
create policy "update own charts" on public.oc_charts_v2
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update on public.oc_charts_v2 to authenticated;

-- Saving goes through this so an older write can never clobber a newer one:
-- a device that was offline for a while comes back and loses politely.
-- security invoker, so RLS still applies and auth.uid() is the caller.
create or replace function public.oc_save(
  p_chart_id text,
  p_payload jsonb,
  p_deleted boolean,
  p_updated_at bigint
) returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_existing bigint;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select c.updated_at into v_existing
  from public.oc_charts_v2 c
  where c.user_id = v_uid and c.chart_id = p_chart_id;

  if v_existing is not null and v_existing >= p_updated_at then
    return v_existing;
  end if;

  insert into public.oc_charts_v2 (user_id, chart_id, payload, deleted, updated_at)
  values (v_uid, p_chart_id, p_payload, coalesce(p_deleted, false), p_updated_at)
  on conflict (user_id, chart_id) do update
    set payload = excluded.payload,
        deleted = excluded.deleted,
        updated_at = excluded.updated_at;

  return p_updated_at;
end;
$$;

grant execute on function public.oc_save(text, jsonb, boolean, bigint) to authenticated;
