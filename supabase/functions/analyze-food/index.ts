// Edge Function: proxy analisis foto makanan ke Claude API.
// API key Anthropic tinggal di server (secret), tidak pernah sampai ke browser.
// Setiap user punya kuota bulanan (tabel photo_usage) — cek dulu, panggil AI, catat.
//
// Deploy:  supabase functions deploy analyze-food
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import { createClient } from "jsr:@supabase/supabase-js@2";

const MONTHLY_QUOTA = 60; // foto per user per bulan (tier gratis)

const FOOD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items", "total_kcal", "total_protein"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "kcal", "protein"],
        properties: {
          name: { type: "string" },
          kcal: { type: "integer" },
          protein: { type: "integer" },
        },
      },
    },
    total_kcal: { type: "integer" },
    total_protein: { type: "integer" },
  },
};

const FOOD_PROMPT =
  "Identifikasi makanan dan minuman di foto ini. Perkirakan porsi dari yang terlihat, " +
  "lalu estimasikan kalori (kkal) dan protein (gram) per item secara realistis untuk masakan Indonesia " +
  "bila relevan. Nama item dalam bahasa Indonesia, singkat. Jika tidak ada makanan di foto, " +
  "kembalikan items kosong dengan total 0.";

const cors = {
  "Access-Control-Allow-Origin": "*",
  // supabase-js ikut mengirim apikey & x-client-info — wajib diizinkan di preflight
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // 1. Autentikasi — harus login (JWT Supabase di header Authorization)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  // 2. Cek & tambah kuota bulanan secara atomik (fungsi SQL use_photo_quota)
  const { data: allowed, error: qErr } = await supabase.rpc("use_photo_quota", {
    p_quota: MONTHLY_QUOTA,
  });
  if (qErr) return json({ error: "quota check failed" }, 500);
  if (!allowed) return json({ error: "quota habis", code: "quota_exceeded" }, 429);

  // 3. Panggil Claude API (key dari secret server)
  const { image } = await req.json(); // base64 JPEG tanpa prefix data:
  if (typeof image !== "string" || image.length > 2_000_000) {
    return json({ error: "gambar tidak valid" }, 400);
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 2048,
      output_config: { format: { type: "json_schema", schema: FOOD_SCHEMA } },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
          { type: "text", text: FOOD_PROMPT },
        ],
      }],
    }),
  });

  if (!res.ok) return json({ error: "AI error", status: res.status }, 502);
  const msg = await res.json();
  if (msg.stop_reason === "refusal") return json({ error: "ditolak model" }, 422);
  const text = msg.content?.find((b: { type: string }) => b.type === "text")?.text;
  if (!text) return json({ error: "respons kosong" }, 502);

  return json(JSON.parse(text));
});
