create table if not exists users_meta (
  id uuid primary key default gen_random_uuid(),
  supabase_user_id uuid unique not null,
  role text not null check (role in ('driver', 'parent')),
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  profile_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists drivers (
  id uuid primary key default gen_random_uuid(),
  supabase_user_id uuid unique not null references users_meta (supabase_user_id) on delete cascade,
  first_name text,
  last_name text,
  phone text,
  profile jsonb default '{}',
  status text not null default 'pending',
  vehicle jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers (id) on delete cascade,
  vehicle_make text not null,
  vehicle_model text not null,
  seat_count integer not null,
  route_name text,
  vehicle_type text not null default 'Van',
  monthly_fee numeric not null default 0 check (monthly_fee >= 0),
  distance_km numeric,
  image_url text,
  rating numeric not null default 5 check (rating >= 0 and rating <= 5),
  created_at timestamptz not null default now(),
  constraint vehicles_driver_unique unique (driver_id)
);

create table if not exists driver_invites (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers (id) on delete cascade,
  code_plain text not null,
  code_hash text not null,
  expires_at timestamptz,
  max_uses integer not null default 1,
  uses integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists parents (
  id uuid primary key default gen_random_uuid(),
  supabase_user_id uuid unique not null references users_meta (supabase_user_id) on delete cascade,
  full_name text,
  phone text,
  notification_prefs jsonb default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists children (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references parents (id) on delete cascade,
  child_name text not null,
  school text not null,
  pickup_location text not null,
  pickup_time text not null default '06:45 AM',
  attendance_state text not null default 'coming' check (attendance_state in ('coming', 'not_coming', 'pending')),
  payment_status text not null default 'paid' check (payment_status in ('paid', 'due', 'overdue')),
  linked_driver_id uuid references drivers (id),
  created_at timestamptz not null default now()
);

create table if not exists parent_driver_links (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers (id) on delete cascade,
  child_id uuid not null references children (id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists parent_payments (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references parents (id) on delete cascade,
  title text not null default 'Monthly Fee',
  amount numeric not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'overdue')),
  method text default 'Card',
  due_date date,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists parent_notifications (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references parents (id) on delete cascade,
  category text not null default 'ride' check (category in ('ride', 'payment', 'safety')),
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table if not exists message_threads (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references parents (id) on delete cascade,
  driver_id uuid references drivers (id),
  title text not null,
  last_message text,
  last_activity timestamptz not null default now(),
  unread_parent_count integer not null default 0,
  unread_driver_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references message_threads (id) on delete cascade,
  sender_type text not null check (sender_type in ('parent', 'driver', 'system')),
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_driver_invites_hash on driver_invites (code_hash);
create index if not exists idx_parent_driver_links_child on parent_driver_links (child_id);
create index if not exists idx_parent_payments_parent on parent_payments (parent_id, created_at desc);
create index if not exists idx_parent_notifications_parent on parent_notifications (parent_id, created_at desc);
create index if not exists idx_message_threads_parent on message_threads (parent_id, last_activity desc);
create index if not exists idx_messages_thread on messages (thread_id, created_at);
