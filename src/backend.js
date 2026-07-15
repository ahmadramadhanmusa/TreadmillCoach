import { createClient } from "@supabase/supabase-js";

// Backend BugarAI (Supabase). Kunci anon memang publik — aman ditanam di
// aplikasi; akses data dibatasi RLS, dan API key Anthropic tinggal di server.
const SUPABASE_URL = "https://ooapxocyjetimvvhuarj.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vYXB4b2N5amV0aW12dmh1YXJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMjgzNDEsImV4cCI6MjA5OTYwNDM0MX0.-2xeyqu4JQ7YbHnSjgajLKgiZINZRXrRMiFdDK3Z5-I";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Sesi anonim dibuat otomatis saat pertama dibutuhkan dan tersimpan di
// perangkat — pengguna tidak pernah melihat form login.
async function ensureSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return session;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw new Error("Gagal menyiapkan sesi — cek koneksi internet.");
  return data.session;
}

// Analisis foto makanan via Edge Function (kuota 60 foto/bulan per pengguna).
export async function analyzeFoodPhoto(b64) {
  await ensureSession();
  const { data, error } = await supabase.functions.invoke("analyze-food", {
    body: { image: b64 },
  });
  if (error) {
    let payload = null;
    try { payload = await error.context?.json(); } catch { /* bukan JSON */ }
    if (payload?.code === "quota_exceeded") {
      throw new Error("Jatah foto bulan ini habis (60 foto/bulan) — kembali tersedia awal bulan depan.");
    }
    if (payload?.error === "ditolak model") {
      throw new Error("Permintaan ditolak model — coba foto lain.");
    }
    throw new Error("Gagal menghubungi server — cek koneksi lalu coba lagi.");
  }
  return data;
}
