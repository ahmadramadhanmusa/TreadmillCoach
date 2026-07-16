-- Cadangan & sinkronisasi data aplikasi per user (satu baris JSONB per user).
-- Sudah diterapkan ke produksi 2026-07-16 via Management API.

create table if not exists user_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table user_state enable row level security;

create policy "baca state sendiri" on user_state
  for select using (auth.uid() = user_id);

create policy "tambah state sendiri" on user_state
  for insert with check (auth.uid() = user_id);

create policy "ubah state sendiri" on user_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
