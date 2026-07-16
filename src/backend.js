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

// URL aplikasi untuk pengalihan link email (konfirmasi & login)
const APP_URL = `${window.location.origin}${import.meta.env.BASE_URL}`;

// Sesi yang SUDAH ada saja — tidak membuat akun baru.
export async function getSessionSafe() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

// ---- Sinkronisasi state aplikasi (tabel user_state, satu baris per user) ----
export async function pushState(data) {
  const session = await ensureSession();
  const updated_at = new Date().toISOString();
  const { error } = await supabase
    .from("user_state")
    .upsert({ user_id: session.user.id, data, updated_at });
  if (error) throw new Error("Gagal menyimpan cadangan.");
  return updated_at;
}

export async function pullState() {
  const session = await getSessionSafe();
  if (!session) return null;
  const { data, error } = await supabase
    .from("user_state")
    .select("data, updated_at")
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (error) return null; // offline dsb. — pakai data lokal
  return data;
}

// ---- Akun: tautkan email ke akun anonim / login dari perangkat lain ----
export async function getAccount() {
  const session = await getSessionSafe();
  if (!session) return { status: "local" };
  const u = session.user;
  return u.email && !u.new_email && u.email_confirmed_at
    ? { status: "linked", email: u.email }
    : u.email || u.new_email
      ? { status: "pending", email: u.email || u.new_email }
      : { status: "anon" };
}

// Upgrade akun anonim → email (Supabase kirim link konfirmasi)
export async function linkEmail(email) {
  await ensureSession();
  const { error } = await supabase.auth.updateUser(
    { email },
    { emailRedirectTo: APP_URL },
  );
  if (error) {
    throw new Error(
      /already|registered/i.test(error.message)
        ? "Email ini sudah terpakai di akun lain — gunakan \"Masuk dari HP lain\" di bawah."
        : "Gagal mengirim email konfirmasi — coba lagi."
    );
  }
}

// Login via magic link di perangkat baru (akun harus sudah tautkan email)
export async function sendLoginLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: APP_URL, shouldCreateUser: false },
  });
  if (error) {
    throw new Error(
      /not found|signups/i.test(error.message)
        ? "Email ini belum terdaftar — tautkan dulu dari perangkat lamamu."
        : "Gagal mengirim link login — coba lagi."
    );
  }
}

// Panggil callback saat login via magic link selesai (kembali dari email)
export function onSignedIn(cb) {
  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN") cb();
  });
  return () => data.subscription.unsubscribe();
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
