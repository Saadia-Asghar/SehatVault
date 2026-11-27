-- Run once in the Supabase SQL editor.
create table if not exists profiles (
  user_id uuid primary key references auth.users on delete cascade,
  display_name text,
  patient_chain_id text not null,
  created_at timestamptz default now()
);

create table if not exists medical_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  doc_type text,
  doc_date date,
  doctor text,
  facility text,
  summary text,
  extracted jsonb,
  uncertain_fields text[] default '{}',
  file_path text not null,
  file_mime text,
  file_sha256 text not null,
  record_salt text not null,
  commitment text not null,
  tx_hash text,
  created_at timestamptz default now()
);

create table if not exists medications (
  id uuid primary key default gen_random_uuid(),
  record_id uuid references medical_records on delete cascade,
  user_id uuid not null,
  name text, dose text, frequency text, duration text, uncertain boolean default false
);

create table if not exists lab_results (
  id uuid primary key default gen_random_uuid(),
  record_id uuid references medical_records on delete cascade,
  user_id uuid not null,
  test_name text, value numeric, unit text, ref_range text, result_date date
);

create table if not exists share_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  share_chain_id text not null unique,
  token_hash text not null unique,
  brief text,
  expires_at timestamptz not null,
  status text default 'active',
  tx_hash text,
  revoke_tx_hash text,
  created_at timestamptz default now()
);

create table if not exists share_records (
  share_id uuid references share_permissions on delete cascade,
  record_id uuid references medical_records on delete cascade,
  primary key (share_id, record_id)
);

create table if not exists access_logs (
  id bigserial primary key,
  share_id uuid references share_permissions on delete cascade,
  accessed_at timestamptz default now(),
  result text,
  tx_hash text
);

-- All app access goes through server routes (service role key) that always
-- filter by the signed-in user. RLS with no policies blocks direct client access.
alter table profiles enable row level security;
alter table medical_records enable row level security;
alter table medications enable row level security;
alter table lab_results enable row level security;
alter table share_permissions enable row level security;
alter table share_records enable row level security;
alter table access_logs enable row level security;

-- Private storage bucket for documents.
insert into storage.buckets (id, name, public)
values ('records', 'records', false)
on conflict (id) do nothing;
