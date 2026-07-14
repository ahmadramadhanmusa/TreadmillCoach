-- Kuota foto makanan per user per bulan.
-- Jalankan via: supabase db push   (atau tempel di SQL Editor dashboard)

create table if not exists photo_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  month   text not null, -- 'YYYY-MM'
  used    integer not null default 0,
  primary key (user_id, month)
);

alter table photo_usage enable row level security;

-- User hanya bisa membaca kuotanya sendiri (untuk ditampilkan di aplikasi)
create policy "baca kuota sendiri" on photo_usage
  for select using (auth.uid() = user_id);

-- Cek + increment kuota secara atomik. Dipanggil Edge Function.
-- Return true bila masih ada jatah, false bila kuota habis.
create or replace function use_photo_quota(p_quota integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  m text := to_char(now(), 'YYYY-MM');
  ok boolean;
begin
  insert into photo_usage (user_id, month, used)
  values (auth.uid(), m, 1)
  on conflict (user_id, month)
  do update set used = photo_usage.used + 1
  where photo_usage.used < p_quota;

  get diagnostics ok = row_count;
  return ok;
end;
$$;

revoke all on function use_photo_quota(integer) from anon;
grant execute on function use_photo_quota(integer) to authenticated;
