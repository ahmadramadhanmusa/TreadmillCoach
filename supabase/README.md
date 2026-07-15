# Backend (Supabase) — fondasi versi berbayar

> **Status: LIVE & DIPAKAI APLIKASI** (2026-07-15). Project **Bugar.ai**
> (`ooapxocyjetimvvhuarj`, Singapore). Aplikasi memanggil proxy dengan
> **anonymous sign-in** otomatis (`src/backend.js`) — tidak ada API key di
> bundle. Kuota 60 foto/bulan/user aktif. Secret `ANTHROPIC_API_KEY`
> masih key lama — **tinggal rotasi**: buat key baru di console.anthropic.com,
> `supabase secrets set ANTHROPIC_API_KEY=<baru>`, lalu revoke key lama.
> Endpoint: `https://ooapxocyjetimvvhuarj.supabase.co/functions/v1/analyze-food`

Proxy AI + kuota per user, supaya API key Anthropic **tidak lagi tertanam di
aplikasi** dan biaya per pengguna terkendali. Sinkronisasi data & pembayaran
(Mayar) menyusul setelah ini jalan.

## Setup sekali (±15 menit)

1. **Buat project** di [supabase.com](https://supabase.com) (tier gratis cukup)
   — catat `Project URL` dan `anon key` (Settings → API).
2. **Install CLI & login**:
   ```bash
   brew install supabase/tap/supabase
   supabase login
   supabase link --project-ref <PROJECT_REF>
   ```
3. **Terapkan skema kuota**:
   ```bash
   supabase db push
   ```
4. **Simpan API key Anthropic sebagai secret server** (buat key BARU di
   console.anthropic.com khusus untuk backend, jangan pakai key lama yang
   sudah tertanam di build publik):
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-api03-...
   ```
5. **Deploy function**:
   ```bash
   supabase functions deploy analyze-food
   ```

## Sesudah itu (perubahan aplikasi)

- [x] Auth di aplikasi — **anonymous sign-in** (2026-07-15); upgrade ke
  "tautkan email" menyusul saat versi berbayar.
- [x] `analyzeFoodPhoto()` memanggil function dengan JWT (`src/backend.js`).
- [x] `VITE_ANTHROPIC_API_KEY` dihapus dari GitHub Actions (secret & workflow).
- [ ] **Rotasi key Anthropic** (tindakan manual): buat key baru →
  `supabase secrets set ANTHROPIC_API_KEY=<baru>` → revoke key lama →
  hapus `.env.local`.
- [ ] (Opsional) Sinkronkan data latihan/berat ke tabel Supabase agar tidak
  hilang saat ganti HP — dan jadi nilai jual versi Pro.

## Kuota

Tier gratis: **60 foto/bulan/user** (ubah `MONTHLY_QUOTA` di
`functions/analyze-food/index.ts`). Biaya AI ±Rp200/foto → maks. ±Rp12.000
per user aktif per bulan. Saat menaikkan kuota untuk tier berbayar, pastikan
harga langganan menutup angka ini.
