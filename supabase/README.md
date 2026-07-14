# Backend (Supabase) — fondasi versi berbayar

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

## Sesudah itu (perubahan aplikasi — minta bantuan Claude)

- Tambah login (Supabase Auth, magic link email / Google) di aplikasi.
- Ganti `analyzeFoodPhoto()` di `src/App.jsx` agar memanggil
  `https://<PROJECT_REF>.supabase.co/functions/v1/analyze-food`
  dengan JWT user, bukan Claude API langsung.
- Hapus `VITE_ANTHROPIC_API_KEY` dari GitHub Actions secret & `.env.local`,
  lalu **revoke key lama** di console.anthropic.com.
- (Opsional) Sinkronkan data latihan/berat ke tabel Supabase agar tidak
  hilang saat ganti HP — dan jadi nilai jual versi Pro.

## Kuota

Tier gratis: **60 foto/bulan/user** (ubah `MONTHLY_QUOTA` di
`functions/analyze-food/index.ts`). Biaya AI ±Rp200/foto → maks. ±Rp12.000
per user aktif per bulan. Saat menaikkan kuota untuk tier berbayar, pastikan
harga langganan menutup angka ini.
