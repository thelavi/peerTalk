-- peerTalk — initial schema, RLS, triggers
-- Apply via Supabase SQL editor or `supabase db push`

-- ============================================================================
-- 1. ENUMS
-- ============================================================================
create type member_role as enum ('owner', 'member');

-- ============================================================================
-- 2. TABLES
-- ============================================================================

-- profiles: 1-1 with auth.users, holds public profile fields
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text unique not null check (char_length(username) between 3 and 32),
  display_name text not null check (char_length(display_name) between 1 and 64),
  avatar_url   text,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- rooms: persistent named rooms
create table rooms (
  id               uuid primary key default gen_random_uuid(),
  slug             text unique not null check (slug ~ '^[a-z0-9-]{3,40}$'),
  name             text not null check (char_length(name) between 1 and 80),
  owner_id         uuid not null references profiles(id) on delete cascade,
  is_private       boolean not null default false,
  max_participants int    not null default 4 check (max_participants between 2 and 8),
  created_at       timestamptz not null default now()
);
create index rooms_owner_idx on rooms(owner_id);

-- room_members: who can enter a room
create table room_members (
  room_id   uuid not null references rooms(id) on delete cascade,
  user_id   uuid not null references profiles(id) on delete cascade,
  role      member_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index room_members_user_idx on room_members(user_id);

-- messages: persistent chat fallback (when peers offline / for scrollback)
create table messages (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references rooms(id) on delete cascade,
  sender_id  uuid not null references profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  deleted_at timestamptz
);
create index messages_room_time_idx on messages(room_id, created_at desc);

-- call_sessions: one per call instance (room may host many over time)
create table call_sessions (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references rooms(id) on delete cascade,
  initiator_id uuid not null references profiles(id) on delete cascade,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz
);
create index call_sessions_room_idx on call_sessions(room_id, started_at desc);

-- call_participants: per-user join/leave within a call
create table call_participants (
  call_id          uuid not null references call_sessions(id) on delete cascade,
  user_id          uuid not null references profiles(id) on delete cascade,
  joined_at        timestamptz not null default now(),
  left_at          timestamptz,
  duration_seconds int,
  primary key (call_id, user_id)
);
create index call_participants_user_idx on call_participants(user_id);

-- ============================================================================
-- 3. TRIGGERS
-- ============================================================================

-- auto-create profile row on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, username, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- auto-update updated_at on profiles
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on profiles
  for each row execute function public.touch_updated_at();

-- auto-add owner as room member on room insert
create or replace function public.handle_new_room()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into room_members (room_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

create trigger on_room_created
  after insert on rooms
  for each row execute function public.handle_new_room();

-- ============================================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================================

alter table profiles          enable row level security;
alter table rooms             enable row level security;
alter table room_members      enable row level security;
alter table messages          enable row level security;
alter table call_sessions     enable row level security;
alter table call_participants enable row level security;

-- helper: is the current user a member of room?
create or replace function public.is_room_member(_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from room_members
    where room_id = _room_id and user_id = auth.uid()
  );
$$;

-- profiles: any auth user can read; only self can update
create policy "profiles_select_authed" on profiles
  for select to authenticated using (true);

create policy "profiles_insert_self" on profiles
  for insert to authenticated with check (id = auth.uid());

create policy "profiles_update_self" on profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- rooms: visible if public OR you're a member; insert only as self-owner
create policy "rooms_select_visible" on rooms
  for select to authenticated using (
    not is_private or owner_id = auth.uid() or public.is_room_member(id)
  );

create policy "rooms_insert_self_owner" on rooms
  for insert to authenticated with check (owner_id = auth.uid());

create policy "rooms_update_owner" on rooms
  for update to authenticated using (owner_id = auth.uid());

create policy "rooms_delete_owner" on rooms
  for delete to authenticated using (owner_id = auth.uid());

-- room_members: members can read membership; users can self-add to non-private rooms
create policy "room_members_select_member" on room_members
  for select to authenticated using (
    user_id = auth.uid() or public.is_room_member(room_id)
  );

create policy "room_members_insert_self" on room_members
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (
      select 1 from rooms
      where id = room_members.room_id
        and (not is_private or owner_id = auth.uid())
    )
  );

create policy "room_members_delete_self_or_owner" on room_members
  for delete to authenticated using (
    user_id = auth.uid()
    or exists (
      select 1 from rooms
      where id = room_members.room_id and owner_id = auth.uid()
    )
  );

-- messages: only room members read/write; sender must be self
create policy "messages_select_member" on messages
  for select to authenticated using (public.is_room_member(room_id));

create policy "messages_insert_member" on messages
  for insert to authenticated with check (
    sender_id = auth.uid() and public.is_room_member(room_id)
  );

create policy "messages_update_own" on messages
  for update to authenticated using (sender_id = auth.uid());

create policy "messages_delete_own" on messages
  for delete to authenticated using (sender_id = auth.uid());

-- call_sessions: members read; initiator must be self
create policy "call_sessions_select_member" on call_sessions
  for select to authenticated using (public.is_room_member(room_id));

create policy "call_sessions_insert_member" on call_sessions
  for insert to authenticated with check (
    initiator_id = auth.uid() and public.is_room_member(room_id)
  );

create policy "call_sessions_update_member" on call_sessions
  for update to authenticated using (public.is_room_member(room_id));

-- call_participants: self read/insert/update only when room member
create policy "call_participants_select_member" on call_participants
  for select to authenticated using (
    user_id = auth.uid()
    or exists (
      select 1 from call_sessions cs
      where cs.id = call_participants.call_id
        and public.is_room_member(cs.room_id)
    )
  );

create policy "call_participants_insert_self" on call_participants
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (
      select 1 from call_sessions cs
      where cs.id = call_participants.call_id
        and public.is_room_member(cs.room_id)
    )
  );

create policy "call_participants_update_self" on call_participants
  for update to authenticated using (user_id = auth.uid());

-- ============================================================================
-- 5. REALTIME PUBLICATION
-- ============================================================================
-- Enable Postgres CDC on messages so clients can subscribe via
-- supabase.channel().on('postgres_changes', ...) for live chat updates.
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table call_participants;
