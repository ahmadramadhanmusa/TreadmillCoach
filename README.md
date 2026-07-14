# Treadmill Coach

Aplikasi pemandu latihan treadmill 30 menit (±5.000 langkah) — program interval 6 fase
dengan panduan kecepatan & incline, bunyi otomatis tiap ganti fase, jadwal mingguan,
dan riwayat sesi. Data tersimpan di `localStorage` browser.

## Menjalankan

```bash
npm install
npm run dev      # development di http://localhost:5173
npm run build    # produksi ke folder dist/
```

## Fitur

- **Latihan** — timer 30 menit dengan 6 fase (pemanasan, tanjakan, tempo, pendinginan),
  target kecepatan & incline per fase, estimasi langkah/kalori/jarak live,
  profil interval per menit, beep saat ganti fase + hitung mundur 3-2-1,
  zona detak jantung (dari usia), dan wake lock agar layar tetap menyala.
- **Lari** — GPS tracker lari/jalan outdoor ala Strava: rute live di peta
  (Leaflet + OpenStreetMap), jarak, pace saat ini & rata-rata, estimasi kalori
  dari berat badan, wake lock, dan riwayat aktivitas (maks. 30) yang rutenya
  bisa dilihat ulang di peta. Butuh izin lokasi & layar tetap menyala saat
  tracking. Mode demo tanpa GPS: buka dengan `?gps-demo` (atau
  `?gps-demo=auto` untuk langsung mulai).
- **BMR** — kalkulator BMR (Mifflin-St Jeor) & TDEE dengan faktor aktivitas,
  plus target kalori defisit dan target protein harian.
- **Progres** — log berat badan dengan grafik tren & selisih 7/30 hari,
  catatan kalori + protein harian vs target TDEE (indikator 7 hari terakhir),
  dan streak pekan yang mencapai ≥3 sesi. Tombol kamera memotret makanan dan
  mengestimasi kalori/protein otomatis via Claude API (model `claude-opus-4-8`,
  vision + structured output) — butuh API key Anthropic pribadi, disimpan
  hanya di localStorage perangkat.
- **Jadwal** — jadwal mingguan beban/kardio/gabung/rest yang bisa diedit.
- **Riwayat** — ringkasan pekan ini dan daftar sesi tersimpan (maks. 60).

Tab bisa di-deep-link: `#workout`, `#run`, `#bmr`, `#progress`, `#schedule`, `#history`.

## PWA

Aplikasi ini installable (Add to Home Screen) dan jalan offline setelah kunjungan
pertama — service worker (Workbox) mem-precache seluruh aset dan meng-cache font
Google. Service worker hanya aktif di build produksi (`npm run build` lalu
`npm run preview`, atau di-deploy), bukan di `npm run dev`. Syarat install:
diakses lewat HTTPS (atau `localhost`).
