import { useState, useEffect, useRef, useCallback } from "react";
import Anthropic from "@anthropic-ai/sdk";

/* ============================================================
   TREADMILL COACH — Program 30 Menit / ±5.000 Langkah
   ============================================================ */

// ---- Program interval (detik) ----
const PHASES = [
  { name: "Pemanasan",   from: 0,    to: 300,  speed: 5.0, incline: "1%",   inc: 1,   tone: "blue",     tip: "Jalan santai, atur napas" },
  { name: "Tanjakan I",  from: 300,  to: 720,  speed: 6.0, incline: "4%",   inc: 4,   tone: "pink",     tip: "Jalan cepat, jangan pegangan handle" },
  { name: "Tempo I",     from: 720,  to: 900,  speed: 6.5, incline: "2%",   inc: 2,   tone: "lavender", tip: "Langkah cepat & pendek" },
  { name: "Tanjakan II", from: 900,  to: 1320, speed: 6.0, incline: "5–6%", inc: 5.5, tone: "pink",     tip: "Fase pembakar utama — tahan!" },
  { name: "Tempo II",    from: 1320, to: 1560, speed: 6.5, incline: "2%",   inc: 2,   tone: "lavender", tip: "Push terakhir, jaga postur" },
  { name: "Pendinginan", from: 1560, to: 1800, speed: 4.8, incline: "0–1%", inc: 0.5, tone: "green",    tip: "Turunkan detak jantung perlahan" },
];
const TOTAL = 1800;

const TONE = {
  blue: "var(--blue)",
  pink: "var(--pink)",
  lavender: "var(--lavender)",
  green: "var(--green)",
  yellow: "var(--yellow)",
};

const DAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const DEFAULT_SCHEDULE = ["gym", "tm", "gym", "tm", "gym", "tm", "rest"];
const TYPE_INFO = {
  gym:  { label: "Gym — Beban",    badge: "BEBAN",        tone: "lavender", icon: "dumbbell" },
  tm:   { label: "Treadmill 30'",  badge: "KARDIO",       tone: "blue",     icon: "run" },
  both: { label: "Gym + Treadmill (kardio setelah beban)", badge: "BEBAN+KARDIO", tone: "pink", icon: "flame" },
  rest: { label: "Istirahat",      badge: "REST",         tone: "yellow",   icon: "moon" },
};

// ---- Faktor aktivitas untuk TDEE ----
const ACTIVITIES = [
  { id: "sedentary",  label: "Jarang gerak", desc: "kerja duduk, tanpa olahraga", factor: 1.2 },
  { id: "light",      label: "Ringan",       desc: "olahraga 1–3×/pekan",         factor: 1.375 },
  { id: "moderate",   label: "Sedang",       desc: "olahraga 3–5×/pekan",         factor: 1.55 },
  { id: "active",     label: "Aktif",        desc: "olahraga 6–7×/pekan",         factor: 1.725 },
  { id: "veryactive", label: "Sangat aktif", desc: "fisik berat / 2× sehari",     factor: 1.9 },
];

// ---- Penyimpanan lokal ----
const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* penyimpanan penuh / private mode */ }
  },
};

// ---- Helpers ----
const phaseAt = (t) => PHASES.find((p) => t >= p.from && t < p.to) || PHASES[PHASES.length - 1];
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const pad2 = (n) => String(n).padStart(2, "0");
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fmtDay = (iso) => new Date(`${iso}T00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
// Senin pekan berjalan (untuk hitung streak)
const weekStart = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x.getTime();
};

// Estimasi langkah: jarak / panjang langkah (~0.58–0.62 m, lebih pendek saat menanjak)
function stepsPerSec(speed, inc) {
  const stride = inc >= 4 ? 0.58 : 0.62;
  return speed / 3.6 / stride;
}
// Estimasi kalori (MET): jalan cepat + incline
function kcalPerSec(speed, inc, kg) {
  const met = 2.5 + speed * 0.55 + inc * 0.45;
  return (met * 3.5 * kg) / 200 / 60;
}
function totalsAt(t, kg) {
  let steps = 0, kcal = 0, km = 0;
  for (const p of PHASES) {
    const dur = Math.max(0, Math.min(t, p.to) - p.from);
    if (dur <= 0) continue;
    steps += stepsPerSec(p.speed, p.inc) * dur;
    kcal += kcalPerSec(p.speed, p.inc, kg) * dur;
    km += (p.speed / 3600) * dur;
  }
  return { steps: Math.round(steps), kcal: Math.round(kcal), km };
}

// ---- Ikon (Lucide, inline SVG) ----
const Svg = ({ children, size = 18, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    {children}
  </svg>
);

const PATHS = {
  play: <polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="5" y="4" width="4.5" height="16" rx="1.5" fill="currentColor" stroke="none" />
      <rect x="14.5" y="4" width="4.5" height="16" rx="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  reset: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="4" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </>
  ),
  chart: (
    <>
      <line x1="6" y1="20" x2="6" y2="14" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="18" y1="20" x2="18" y2="10" />
    </>
  ),
  zap: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  trend: (
    <>
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </>
  ),
  run: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  flame: <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />,
  pin: (
    <>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  bulb: (
    <>
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
    </>
  ),
  volume: (
    <>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </>
  ),
  check: <polyline points="20 6 9 17 4 12" />,
  pencil: <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z" />,
  dumbbell: (
    <>
      <path d="m6.5 6.5 11 11" />
      <path d="m21 21-1-1" />
      <path d="m3 3 1 1" />
      <path d="m18 22 4-4" />
      <path d="m2 6 4-4" />
      <path d="m3 10 7-7" />
      <path d="m14 21 7-7" />
    </>
  ),
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  camera: (
    <>
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </>
  ),
  x: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  heart: <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z" />,
  scale: (
    <>
      <path d="M12 3v18" />
      <path d="M5 7l7-4 7 4" />
      <path d="M3 13a3 3 0 0 0 4 0L5 8l-2 5Z" />
      <path d="M17 13a3 3 0 0 0 4 0l-2-5-2 5Z" />
    </>
  ),
  calc: (
    <>
      <rect x="4" y="2" width="16" height="20" rx="3" />
      <line x1="8" y1="7" x2="16" y2="7" />
      <path d="M8 12h.01" />
      <path d="M12 12h.01" />
      <path d="M16 12h.01" />
      <path d="M8 16h.01" />
      <path d="M12 16h.01" />
      <path d="M16 16h.01" />
    </>
  ),
};

const Icon = ({ name, size }) => <Svg size={size}>{PATHS[name]}</Svg>;

// ---- Beep (Web Audio) ----
function useBeeper() {
  const ctxRef = useRef(null);
  return useCallback((freq = 880, ms = 150) => {
    try {
      if (!ctxRef.current) ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = ctxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "square";
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + ms / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + ms / 1000);
    } catch { /* audio diblokir browser */ }
  }, []);
}

// Layar tetap menyala selama latihan berjalan
function useWakeLock(active) {
  useEffect(() => {
    if (!active || !navigator.wakeLock) return;
    let lock = null;
    navigator.wakeLock.request("screen").then((l) => { lock = l; }).catch(() => {});
    return () => { lock?.release().catch(() => {}); };
  }, [active]);
}

// ---- Profil interval: 30 bar hitam ala equalizer (1 bar = 1 menit) ----
function Profile({ t }) {
  const curMin = Math.floor(t / 60);
  const bars = Array.from({ length: 30 }, (_, i) => {
    const p = phaseAt(i * 60);
    const intensity = p.speed + p.inc * 1.1; // 5.35 – 12.05
    const pct = 26 + ((intensity - 5) / 7.5) * 70;
    return { pct: Math.min(100, pct), phase: p };
  });
  return (
    <div>
      <div className="bars" role="img" aria-label="Profil intensitas 30 menit, bar per menit">
        {bars.map((b, i) => (
          <div key={i}
            className={`bar${i < curMin ? " done" : ""}${i === curMin && t < TOTAL ? " now" : ""}`}
            style={{ height: `${b.pct}%` }} />
        ))}
      </div>
      <div className="axis"><span>0'</span><span>10'</span><span>20'</span><span>30'</span></div>
      <div className="legend">
        {PHASES.map((p) => (
          <span key={p.name} className="tag" style={{ background: TONE[p.tone] }}>
            {p.name} · {p.speed.toFixed(1)} km/j
          </span>
        ))}
      </div>
    </div>
  );
}

// ---- Analisis foto makanan (Claude vision) ----
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

// Kecilkan foto ke maks 1024px sisi terpanjang → base64 JPEG
async function imageToBase64(file, maxDim = 1024) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
  return { b64: dataUrl.split(",")[1], preview: dataUrl };
}

async function analyzeFoodPhoto(apiKey, b64) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const res = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 2048,
    output_config: { format: { type: "json_schema", schema: FOOD_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
          { type: "text", text: FOOD_PROMPT },
        ],
      },
    ],
  });
  if (res.stop_reason === "refusal") {
    throw new Error("Permintaan ditolak model — coba foto lain.");
  }
  const text = res.content.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("Respons kosong — coba lagi.");
  return JSON.parse(text);
}

// ---- Input angka: bebas saat mengetik, clamp saat blur ----
function NumField({ label, unit, value, min, max, fallback, onCommit }) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => { setTxt(String(value)); }, [value]);
  const type = (t) => {
    setTxt(t);
    const n = Number(t);
    if (n >= min && n <= max) onCommit(n);
  };
  const blur = () => {
    const n = Math.max(min, Math.min(max, Number(txt) || fallback));
    onCommit(n);
    setTxt(String(n));
  };
  return (
    <label className="field">
      <span className="lbl">{label}</span>
      <span className="row">
        <input type="number" inputMode="numeric" value={txt} min={min} max={max}
          onChange={(e) => type(e.target.value)} onBlur={blur} />
        <span className="unit">{unit}</span>
      </span>
    </label>
  );
}

// ---- Grafik tren berat badan (garis hitam + titik) ----
function WeightChart({ entries }) {
  if (entries.length < 2) {
    return <div className="empty small">Catat berat minimal 2 kali (beda hari) untuk melihat tren.</div>;
  }
  const data = entries.slice(-14);
  const kgs = data.map((e) => e.kg);
  const min = Math.min(...kgs);
  const max = Math.max(...kgs);
  const span = max - min || 1;
  const pts = data.map((e, i) => [
    6 + (i / (data.length - 1)) * 288,
    10 + ((max - e.kg) / span) * 64,
  ]);
  const last = pts[pts.length - 1];
  return (
    <div>
      <svg viewBox="0 0 300 88" className="wchart" role="img"
        aria-label={`Grafik berat badan, ${data.length} catatan terakhir, dari ${data[0].kg} ke ${kgs[kgs.length - 1]} kg`}>
        <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--ink)"
          strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 4.5 : 2.8}
            fill={i === pts.length - 1 ? "var(--pink-strong)" : "var(--ink)"} />
        ))}
        <text x={last[0]} y={last[1] - 9} textAnchor="end" className="wchart-val">
          {kgs[kgs.length - 1].toLocaleString("id-ID")} kg
        </text>
      </svg>
      <div className="axis">
        <span>{fmtDay(data[0].d)}</span>
        <span>{min.toLocaleString("id-ID")}–{max.toLocaleString("id-ID")} kg</span>
        <span>{fmtDay(data[data.length - 1].d)}</span>
      </div>
    </div>
  );
}

// ============================================================
const TABS = ["workout", "bmr", "progress", "schedule", "history"];

export default function App() {
  const [tab, setTab] = useState(() => {
    const h = window.location.hash.slice(1);
    return TABS.includes(h) ? h : "workout";
  });
  const [t, setT] = useState(0);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [weight, setWeight] = useState(75);
  const [weightText, setWeightText] = useState("75");
  const [sessions, setSessions] = useState([]);
  const [saved, setSaved] = useState(false);
  const [schedule, setSchedule] = useState(DEFAULT_SCHEDULE);
  const [editMode, setEditMode] = useState(false);
  const [bmrProfile, setBmrProfile] = useState({ sex: "m", height: 170, age: 30, activity: "moderate" });
  const [weights, setWeights] = useState([]);   // [{d: "YYYY-MM-DD", kg}]
  const [food, setFood] = useState([]);         // [{d: "YYYY-MM-DD", kcal, prot}]
  // Key bawaan dari .env.local (VITE_ANTHROPIC_API_KEY) — key yang pernah
  // diinput manual di aplikasi tetap diprioritaskan.
  const [apiKey, setApiKey] = useState(
    () => store.get("tm-apikey") || import.meta.env.VITE_ANTHROPIC_API_KEY || ""
  );
  const [keyInput, setKeyInput] = useState("");
  const [scan, setScan] = useState({ status: "idle" }); // idle|need-key|loading|done|error
  const fileRef = useRef(null);
  const beep = useBeeper();
  const prevPhase = useRef(null);
  useWakeLock(running);

  // Muat riwayat, berat & jadwal
  useEffect(() => {
    try {
      const r = store.get("tm-sessions");
      if (r) setSessions(JSON.parse(r));
    } catch { /* data korup, abaikan */ }
    const w = store.get("tm-weight");
    if (w) {
      const n = Number(w) || 75;
      setWeight(n);
      setWeightText(String(n));
    }
    try {
      const sc = store.get("tm-schedule");
      if (sc) {
        const arr = JSON.parse(sc);
        if (Array.isArray(arr) && arr.length === 7) setSchedule(arr);
      }
    } catch { /* data korup, abaikan */ }
    try {
      const b = store.get("tm-bmr");
      if (b) setBmrProfile((prev) => ({ ...prev, ...JSON.parse(b) }));
    } catch { /* data korup, abaikan */ }
    try {
      const ws = store.get("tm-weights");
      if (ws) setWeights(JSON.parse(ws));
    } catch { /* data korup, abaikan */ }
    try {
      const fd = store.get("tm-food");
      if (fd) setFood(JSON.parse(fd));
    } catch { /* data korup, abaikan */ }
  }, []);

  // Timer
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setT((prev) => {
        const next = prev + 1;
        if (next >= TOTAL) {
          setRunning(false);
          setDone(true);
          beep(1200, 400);
          return TOTAL;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, beep]);

  // Bunyi saat ganti fase + hitung mundur 3-2-1
  useEffect(() => {
    const p = phaseAt(t);
    if (prevPhase.current && prevPhase.current !== p.name && t > 0) beep(980, 250);
    prevPhase.current = p.name;
    const nextChange = p.to - t;
    if (running && nextChange <= 3 && nextChange >= 1) beep(660, 100);
  }, [t, running, beep]);

  const phase = phaseAt(t);
  const phaseIdx = PHASES.indexOf(phase);
  const nextPhase = PHASES[phaseIdx + 1];
  const { steps, kcal, km } = totalsAt(t, weight);
  const remain = phase.to - t;

  const updateDay = (idx, type) => {
    const arr = schedule.map((v, i) => (i === idx ? type : v));
    setSchedule(arr);
    store.set("tm-schedule", JSON.stringify(arr));
  };

  const resetSchedule = () => {
    setSchedule(DEFAULT_SCHEDULE);
    store.set("tm-schedule", JSON.stringify(DEFAULT_SCHEDULE));
  };

  const saveSession = () => {
    const totals = totalsAt(t, weight);
    const entry = { date: new Date().toISOString(), dur: t, steps: totals.steps, kcal: totals.kcal };
    const arr = [entry, ...sessions].slice(0, 60);
    setSessions(arr);
    setSaved(true);
    store.set("tm-sessions", JSON.stringify(arr));
  };

  const reset = () => { setT(0); setRunning(false); setDone(false); setSaved(false); };

  const setWeightAll = (w) => {
    setWeight(w);
    setWeightText(String(w));
    store.set("tm-weight", String(w));
  };

  // Saat mengetik: terima teks apa adanya, simpan hanya jika sudah valid.
  // Clamp ke 40–150 baru dilakukan saat selesai mengedit (blur).
  const typeWeight = (txt) => {
    setWeightText(txt);
    const n = Number(txt);
    if (n >= 40 && n <= 150) {
      setWeight(n);
      store.set("tm-weight", String(n));
    }
  };

  const commitWeight = () => {
    setWeightAll(Math.max(40, Math.min(150, Number(weightText) || 75)));
  };

  const updateBmrProfile = (patch) => {
    setBmrProfile((prev) => {
      const next = { ...prev, ...patch };
      store.set("tm-bmr", JSON.stringify(next));
      return next;
    });
  };

  // Mifflin-St Jeor
  const bmr = Math.round(
    10 * weight + 6.25 * bmrProfile.height - 5 * bmrProfile.age + (bmrProfile.sex === "m" ? 5 : -161)
  );
  const activityInfo = ACTIVITIES.find((a) => a.id === bmrProfile.activity) || ACTIVITIES[2];
  const tdee = Math.round(bmr * activityInfo.factor);
  const protein = Math.round((weight * 1.8) / 5) * 5;

  // Zona detak jantung (dari usia di profil BMR)
  const maxHr = 220 - bmrProfile.age;
  const hrZone = (lo, hi) => `${Math.round(maxHr * lo)}–${Math.round(maxHr * hi)}`;

  // ---- Log berat badan ----
  const loggedToday = weights.some((e) => e.d === dayKey());
  const logWeight = () => {
    const entry = { d: dayKey(), kg: weight };
    const arr = [...weights.filter((e) => e.d !== entry.d), entry]
      .sort((a, b) => a.d.localeCompare(b.d))
      .slice(-120);
    setWeights(arr);
    store.set("tm-weights", JSON.stringify(arr));
  };
  // Selisih vs catatan terlama dalam rentang N hari terakhir
  const deltaSince = (days) => {
    if (weights.length < 2) return null;
    const cutoff = Date.now() - days * 86400000;
    const base = weights.find((e) => new Date(`${e.d}T00:00`).getTime() >= cutoff);
    const latest = weights[weights.length - 1];
    if (!base || base.d === latest.d) return null;
    return latest.kg - base.kg;
  };
  const fmtDelta = (v) =>
    v === null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toLocaleString("id-ID", { maximumFractionDigits: 1 })}`;

  // ---- Log asupan harian ----
  const todayFood = food.find((f) => f.d === dayKey()) || { kcal: 0, prot: 0 };
  const logFood = (patch) => {
    const entry = { d: dayKey(), kcal: todayFood.kcal, prot: todayFood.prot, ...patch };
    const arr = [...food.filter((f) => f.d !== entry.d), entry]
      .sort((a, b) => a.d.localeCompare(b.d))
      .slice(-90);
    setFood(arr);
    store.set("tm-food", JSON.stringify(arr));
  };
  const deficit = tdee - todayFood.kcal;
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 6 + i);
    const k = dayKey(d);
    return { k, initial: "SSRKJSM"[(d.getDay() + 6) % 7], entry: food.find((f) => f.d === k) };
  });
  const foodTone = (entry) => {
    if (!entry || !entry.kcal) return null;
    if (entry.kcal <= tdee - 300) return "var(--green)";
    if (entry.kcal <= tdee) return "var(--yellow)";
    return "var(--pink)";
  };

  // ---- Foto makanan → estimasi kalori ----
  const openCamera = () => {
    if (!apiKey) {
      setScan({ status: "need-key" });
      return;
    }
    fileRef.current?.click();
  };

  const saveApiKey = () => {
    const k = keyInput.trim();
    if (!k) return;
    setApiKey(k);
    store.set("tm-apikey", k);
    setKeyInput("");
    setScan({ status: "idle" });
    fileRef.current?.click();
  };

  const onPhotoPicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // supaya foto yang sama bisa dipilih ulang
    if (!file) return;
    try {
      const { b64, preview } = await imageToBase64(file);
      setScan({ status: "loading", preview });
      const result = await analyzeFoodPhoto(apiKey, b64);
      setScan({ status: "done", preview, result });
    } catch (err) {
      let msg = err?.message || "Terjadi kesalahan.";
      if (err instanceof Anthropic.AuthenticationError) {
        msg = "API key tidak valid. Masukkan ulang.";
        setApiKey("");
        store.set("tm-apikey", "");
      } else if (err instanceof Anthropic.RateLimitError) {
        msg = "Terlalu banyak permintaan — tunggu sebentar lalu coba lagi.";
      } else if (err instanceof Anthropic.APIConnectionError) {
        msg = "Tidak bisa terhubung — cek koneksi internet.";
      }
      setScan({ status: "error", error: msg });
    }
  };

  const addScanToToday = () => {
    if (scan.status !== "done") return;
    logFood({
      kcal: todayFood.kcal + scan.result.total_kcal,
      prot: todayFood.prot + scan.result.total_protein,
    });
    setScan({ status: "idle" });
  };

  // ---- Streak: pekan berturut-turut dengan ≥3 sesi ----
  const WEEK_MS = 7 * 86400000;
  const weekCounts = {};
  for (const s of sessions) {
    const w = weekStart(new Date(s.date));
    weekCounts[w] = (weekCounts[w] || 0) + 1;
  }
  const curWeek = weekStart(new Date());
  let streak = 0;
  // pekan berjalan ikut dihitung kalau sudah tercapai; kalau belum, jangan putus streak
  for (let w = (weekCounts[curWeek] || 0) >= 3 ? curWeek : curWeek - WEEK_MS; (weekCounts[w] || 0) >= 3; w -= WEEK_MS) {
    streak++;
  }

  // Statistik pekan ini
  const weekAgo = Date.now() - 7 * 86400000;
  const week = sessions.filter((s) => new Date(s.date).getTime() > weekAgo);
  const weekSteps = week.reduce((a, s) => a + s.steps, 0);
  const weekKcal = week.reduce((a, s) => a + s.kcal, 0);

  const todayIdx = (new Date().getDay() + 6) % 7; // Senin = 0

  const cardTone = done ? TONE.green : TONE[phase.tone];

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="logo"><Icon name="flame" size={22} /></div>
        <div className="titles">
          <h1>Treadmill Coach</h1>
          <div className="sub">30 MENIT · ±5.000 LANGKAH</div>
        </div>
        <label className="weight-pill">
          BB
          <input type="number" value={weightText} min={40} max={150} inputMode="numeric"
            aria-label="Berat badan dalam kilogram"
            onChange={(e) => typeWeight(e.target.value)}
            onBlur={commitWeight} />
          kg
        </label>
      </header>

      {/* ================= LATIHAN ================= */}
      {tab === "workout" && (
        <div className="view">
          {/* Kartu fase aktif */}
          <section className="phase-card" style={{ background: cardTone }}>
            <div className="deco" />
            <div className="phase-head">
              <span className="chip">
                <span className={`dot${running ? " live" : ""}`} />
                {done ? "Selesai" : phase.name}
              </span>
              <span className="phase-count">fase {phaseIdx + 1}/6</span>
            </div>

            <div className="timer">{done ? "30:00" : fmt(remain)}</div>
            <div className="timer-sub">
              {done ? "Program selesai — kerja bagus!" : `Sisa fase · total ${fmt(TOTAL - t)}`}
            </div>

            <div className="target-row">
              <div className="target">
                <span className="ic"><Icon name="zap" /></span>
                <div>
                  <div className="val">{phase.speed.toFixed(1)}</div>
                  <div className="lbl">km/jam</div>
                </div>
              </div>
              <div className="target">
                <span className="ic"><Icon name="trend" /></span>
                <div>
                  <div className="val">{phase.incline}</div>
                  <div className="lbl">Incline</div>
                </div>
              </div>
            </div>

            <div className="tip-row">
              <Icon name="bulb" size={16} />
              <div>
                {phase.tip}
                {nextPhase && !done && (
                  <span className="next">
                    Berikutnya: {nextPhase.name} — {nextPhase.speed.toFixed(1)} km/j · {nextPhase.incline}
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* Profil interval */}
          <section className="card">
            <div className="chart-head">
              <h2>Profil Interval</h2>
              <span className="meta">menit {Math.min(30, Math.floor(t / 60) + (done ? 0 : 1))}/30</span>
            </div>
            <Profile t={t} />
          </section>

          {/* Statistik live */}
          <div className="stats">
            <div className="stat" style={{ background: "var(--pink)" }}>
              <span className="ic"><Icon name="run" size={16} /></span>
              <div className="val">{steps.toLocaleString("id-ID")}</div>
              <div className="lbl">Langkah</div>
            </div>
            <div className="stat" style={{ background: "var(--green)" }}>
              <span className="ic"><Icon name="flame" size={16} /></span>
              <div className="val">{kcal}<small>kkal</small></div>
              <div className="lbl">Kalori</div>
            </div>
            <div className="stat" style={{ background: "var(--lavender)" }}>
              <span className="ic"><Icon name="pin" size={16} /></span>
              <div className="val">{km.toFixed(2)}<small>km</small></div>
              <div className="lbl">Jarak</div>
            </div>
          </div>

          {/* Kontrol */}
          <div className="controls">
            {!done ? (
              <>
                <button className="btn-main" onClick={() => setRunning(!running)}>
                  <Icon name={running ? "pause" : "play"} />
                  {running ? "JEDA" : t > 0 ? "LANJUT" : "MULAI"}
                </button>
                <button className="btn-round" onClick={reset} aria-label="Reset latihan">
                  <Icon name="reset" />
                </button>
              </>
            ) : (
              <>
                <button className={`btn-main${saved ? "" : " save"}`} onClick={saveSession} disabled={saved}>
                  <Icon name="check" />
                  {saved ? "TERSIMPAN" : "SIMPAN SESI"}
                </button>
                <button className="btn-round" onClick={reset} aria-label="Ulangi latihan">
                  <Icon name="reset" />
                </button>
              </>
            )}
          </div>
          <p className="hint">
            <Icon name="volume" size={14} />
            Bunyi otomatis setiap ganti fase — layar boleh dikantongi
          </p>

          {/* Zona detak jantung */}
          <section className="card">
            <div className="chart-head">
              <h2>Zona Detak Jantung</h2>
              <span className="meta">usia {bmrProfile.age} · maks {maxHr} bpm</span>
            </div>
            <div className="zones">
              <div className="zone" style={{ background: "var(--green)" }}>
                <span className="zl"><Icon name="heart" size={14} /> Bakar lemak · 60–70%</span>
                <b>{hrZone(0.6, 0.7)} bpm</b>
              </div>
              <div className="zone" style={{ background: "var(--blue)" }}>
                <span className="zl"><Icon name="heart" size={14} /> Kardio · 70–80%</span>
                <b>{hrZone(0.7, 0.8)} bpm</b>
              </div>
              <div className="zone" style={{ background: "var(--pink)" }}>
                <span className="zl"><Icon name="heart" size={14} /> Intens · 80–90%</span>
                <b>{hrZone(0.8, 0.9)} bpm</b>
              </div>
            </div>
            <p className="zone-note">Fase tanjakan idealnya di zona bakar lemak–kardio. Usia diambil dari profil di tab BMR.</p>
          </section>
        </div>
      )}

      {/* ================= PROGRES ================= */}
      {tab === "progress" && (
        <div className="view">
          {/* Berat badan */}
          <section className="phase-card" style={{ background: "var(--pink)" }}>
            <div className="deco" />
            <div className="phase-head">
              <span className="chip"><span className="dot" />Berat Badan</span>
              <span className="phase-count">
                {weights.length ? `dicatat ${fmtDay(weights[weights.length - 1].d)}` : "belum ada catatan"}
              </span>
            </div>

            <div className="timer bmr-num">
              {(weights.length ? weights[weights.length - 1].kg : weight).toLocaleString("id-ID")}
            </div>
            <div className="timer-sub">kg · berat terkini</div>

            <div className="target-row">
              <div className="target">
                <span className="ic"><Icon name="trend" /></span>
                <div>
                  <div className="val">{fmtDelta(deltaSince(7))}</div>
                  <div className="lbl">7 hari</div>
                </div>
              </div>
              <div className="target">
                <span className="ic"><Icon name="trend" /></span>
                <div>
                  <div className="val">{fmtDelta(deltaSince(30))}</div>
                  <div className="lbl">30 hari</div>
                </div>
              </div>
            </div>

            <div className="log-row">
              <NumField label="Berat hari ini" unit="kg" value={weight} min={40} max={150} fallback={75}
                onCommit={setWeightAll} />
              <button className="btn-log" onClick={logWeight}>
                <Icon name="check" size={15} />
                {loggedToday ? "PERBARUI" : "CATAT"}
              </button>
            </div>
          </section>

          {/* Grafik tren */}
          <section className="card">
            <div className="chart-head">
              <h2>Tren Berat</h2>
              <span className="meta">{weights.length} catatan</span>
            </div>
            <WeightChart entries={weights} />
          </section>

          {/* Asupan hari ini */}
          <section className="card form-card">
            <div>
              <div className="chart-head" style={{ marginBottom: 10 }}>
                <h2>Asupan Hari Ini</h2>
                <span className="meta">target {(tdee - 500).toLocaleString("id-ID")}–{(tdee - 300).toLocaleString("id-ID")} kkal</span>
              </div>
              <div className="intake-row">
                <div className="fields two" style={{ flex: 1 }}>
                  <NumField label="Kalori" unit="kkal" value={todayFood.kcal} min={0} max={8000} fallback={0}
                    onCommit={(n) => logFood({ kcal: n })} />
                  <NumField label="Protein" unit="g" value={todayFood.prot} min={0} max={400} fallback={0}
                    onCommit={(n) => logFood({ prot: n })} />
                </div>
                <button className="btn-cam" onClick={openCamera} aria-label="Foto makanan untuk estimasi kalori otomatis">
                  <Icon name="camera" size={20} />
                </button>
              </div>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden
                onChange={onPhotoPicked} />
            </div>

            {/* Panel foto makanan */}
            {scan.status === "need-key" && (
              <div className="scan-panel">
                <div className="scan-title">
                  Fitur foto makanan memakai Claude AI
                  <button className="scan-close" onClick={() => setScan({ status: "idle" })} aria-label="Tutup">
                    <Icon name="x" size={14} />
                  </button>
                </div>
                <p className="scan-note">
                  Masukkan API key Anthropic (buat di console.anthropic.com). Key hanya
                  disimpan di perangkat ini. Biaya ± Rp150–300 per foto.
                </p>
                <div className="key-row">
                  <input type="password" value={keyInput} placeholder="sk-ant-..."
                    onChange={(e) => setKeyInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveApiKey()} />
                  <button className="btn-log" onClick={saveApiKey}>SIMPAN</button>
                </div>
              </div>
            )}

            {scan.status === "loading" && (
              <div className="scan-panel">
                {scan.preview && <img className="scan-img" src={scan.preview} alt="Foto makanan" />}
                <div className="scan-loading">Menganalisis makanan…</div>
              </div>
            )}

            {scan.status === "error" && (
              <div className="scan-panel">
                <div className="scan-title">
                  Gagal menganalisis
                  <button className="scan-close" onClick={() => setScan({ status: "idle" })} aria-label="Tutup">
                    <Icon name="x" size={14} />
                  </button>
                </div>
                <p className="scan-note">{scan.error}</p>
              </div>
            )}

            {scan.status === "done" && (
              <div className="scan-panel">
                <div className="scan-result-head">
                  {scan.preview && <img className="scan-img small" src={scan.preview} alt="Foto makanan" />}
                  <div style={{ flex: 1 }}>
                    {scan.result.items.length === 0 ? (
                      <p className="scan-note">Tidak ada makanan terdeteksi di foto.</p>
                    ) : (
                      scan.result.items.map((it, i) => (
                        <div key={i} className="scan-item">
                          <span>{it.name}</span>
                          <span className="n">{it.kcal} kkal · {it.protein} g</span>
                        </div>
                      ))
                    )}
                    {scan.result.items.length > 0 && (
                      <div className="scan-item total">
                        <span>Total</span>
                        <span className="n">{scan.result.total_kcal} kkal · {scan.result.total_protein} g</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="scan-actions">
                  {scan.result.items.length > 0 && (
                    <button className="btn-log" onClick={addScanToToday}>
                      <Icon name="check" size={14} /> TAMBAHKAN
                    </button>
                  )}
                  <button className="btn-ghost-sm" onClick={() => setScan({ status: "idle" })}>Batal</button>
                </div>
              </div>
            )}

            {todayFood.kcal > 0 && (
              <div className="status-row">
                <span className="tag" style={{ background: foodTone(todayFood) }}>
                  {deficit >= 0 ? `Defisit ${deficit.toLocaleString("id-ID")} kkal` : `Surplus ${(-deficit).toLocaleString("id-ID")} kkal`}
                  {deficit >= 300 ? " — on track" : deficit >= 0 ? " — masih kecil" : ""}
                </span>
                <span className="tag" style={{ background: todayFood.prot >= protein ? "var(--green)" : "var(--yellow)" }}>
                  {todayFood.prot >= protein ? "Protein cukup" : `Protein kurang ${protein - todayFood.prot} g`}
                </span>
              </div>
            )}

            <div className="dots7" aria-label="Asupan 7 hari terakhir">
              {last7.map((d) => (
                <div key={d.k} className="dot7">
                  <span className="c" style={{
                    background: foodTone(d.entry) || "transparent",
                    borderColor: foodTone(d.entry) || "var(--line)",
                  }} />
                  <span className="i">{d.initial}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Streak & pekan ini */}
          <div className="stats">
            <div className="stat" style={{ background: "var(--pink)" }}>
              <span className="ic"><Icon name="flame" size={16} /></span>
              <div className="val">{streak}<small>pekan</small></div>
              <div className="lbl">Streak</div>
            </div>
            <div className="stat" style={{ background: "var(--blue)" }}>
              <span className="ic"><Icon name="check" size={16} /></span>
              <div className="val">{week.length}<small>/3</small></div>
              <div className="lbl">Sesi pekan</div>
            </div>
            <div className="stat" style={{ background: "var(--green)" }}>
              <span className="ic"><Icon name="run" size={16} /></span>
              <div className="val">{weekSteps.toLocaleString("id-ID")}</div>
              <div className="lbl">Langkah</div>
            </div>
          </div>

          <div className="note">
            <b>Kalibrasi TDEE:</b> kalau 3 pekan berat tidak turun padahal asupan sesuai target,
            TDEE aslimu lebih rendah dari estimasi — turunkan target harian 100–150 kkal, lalu amati lagi.
          </div>
        </div>
      )}

      {/* ================= BMR ================= */}
      {tab === "bmr" && (
        <div className="view">
          {/* Hasil */}
          <section className="phase-card" style={{ background: "var(--lavender)" }}>
            <div className="deco" />
            <div className="phase-head">
              <span className="chip"><span className="dot" />BMR & TDEE</span>
              <span className="phase-count">Mifflin-St Jeor</span>
            </div>

            <div className="timer bmr-num">{tdee.toLocaleString("id-ID")}</div>
            <div className="timer-sub">kkal/hari · kebutuhan total (TDEE)</div>

            <div className="target-row">
              <div className="target">
                <span className="ic"><Icon name="moon" /></span>
                <div>
                  <div className="val">{bmr.toLocaleString("id-ID")}</div>
                  <div className="lbl">BMR · basal</div>
                </div>
              </div>
              <div className="target">
                <span className="ic"><Icon name="dumbbell" /></span>
                <div>
                  <div className="val">{protein}<span style={{ fontSize: 13 }}> g</span></div>
                  <div className="lbl">Protein / hari</div>
                </div>
              </div>
            </div>

            <div className="tip-row">
              <Icon name="bulb" size={16} />
              <div>
                TDEE = BMR × aktivitas <b>{activityInfo.label.toLowerCase()}</b> (×{activityInfo.factor}).
                Untuk turun berat aman, makan 300–500 kkal di bawah angka ini.
              </div>
            </div>
          </section>

          {/* Form data diri */}
          <section className="card form-card">
            <div>
              <div className="form-label">Jenis kelamin</div>
              <div className="seg">
                <button className={bmrProfile.sex === "m" ? "sel" : ""}
                  onClick={() => updateBmrProfile({ sex: "m" })}>Pria</button>
                <button className={bmrProfile.sex === "f" ? "sel" : ""}
                  onClick={() => updateBmrProfile({ sex: "f" })}>Wanita</button>
              </div>
            </div>

            <div>
              <div className="form-label">Data tubuh</div>
              <div className="fields">
                <NumField label="Berat" unit="kg" value={weight} min={40} max={150} fallback={75}
                  onCommit={setWeightAll} />
                <NumField label="Tinggi" unit="cm" value={bmrProfile.height} min={130} max={220} fallback={170}
                  onCommit={(n) => updateBmrProfile({ height: n })} />
                <NumField label="Usia" unit="thn" value={bmrProfile.age} min={10} max={90} fallback={30}
                  onCommit={(n) => updateBmrProfile({ age: n })} />
              </div>
            </div>

            <div>
              <div className="form-label">Aktivitas harian</div>
              <div className="act-list">
                {ACTIVITIES.map((a) => (
                  <button key={a.id} className={`act-opt${bmrProfile.activity === a.id ? " sel" : ""}`}
                    onClick={() => updateBmrProfile({ activity: a.id })}>
                    <span>{a.label} <span className="desc">· {a.desc}</span></span>
                    <span className="x">{Math.round(bmr * a.factor).toLocaleString("id-ID")} kkal</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Target harian */}
          <div className="stats">
            <div className="stat" style={{ background: "var(--blue)" }}>
              <span className="ic"><Icon name="check" size={16} /></span>
              <div className="val">{tdee.toLocaleString("id-ID")}</div>
              <div className="lbl">Jaga BB</div>
            </div>
            <div className="stat" style={{ background: "var(--pink)" }}>
              <span className="ic"><Icon name="trend" size={16} /></span>
              <div className="val">{(tdee - 300).toLocaleString("id-ID")}</div>
              <div className="lbl">Defisit −300</div>
            </div>
            <div className="stat" style={{ background: "var(--green)" }}>
              <span className="ic"><Icon name="flame" size={16} /></span>
              <div className="val">{(tdee - 500).toLocaleString("id-ID")}</div>
              <div className="lbl">Defisit −500</div>
            </div>
          </div>

          <div className="note">
            <b>Apa itu BMR & TDEE?</b> BMR adalah kalori yang dibakar tubuh saat istirahat total.
            TDEE = BMR × faktor aktivitas — inilah patokan kebutuhan harianmu. Angka protein
            ({protein} g ≈ 1,8 g/kg BB) membantu menjaga otot selama defisit.
          </div>
        </div>
      )}

      {/* ================= JADWAL ================= */}
      {tab === "schedule" && (
        <div className="view">
          <div className="sched-intro">
            <p>Kardio idealnya di hari <b>non-gym</b>. Kalau digabung, kardio <b>setelah</b> beban.</p>
            <button className={`btn-edit${editMode ? " on" : ""}`} onClick={() => setEditMode(!editMode)}>
              <Icon name={editMode ? "check" : "pencil"} size={13} />
              {editMode ? "SELESAI" : "EDIT"}
            </button>
          </div>

          <div className="mix">
            <span className="tag" style={{ background: "var(--ink)", color: "#fff" }}>
              BEBAN ×{schedule.filter((d) => d === "gym" || d === "both").length}
            </span>
            <span className="tag" style={{ background: "var(--blue)" }}>
              KARDIO ×{schedule.filter((d) => d === "tm" || d === "both").length}
            </span>
            <span className="tag" style={{ background: "var(--yellow)" }}>
              REST ×{schedule.filter((d) => d === "rest").length}
            </span>
          </div>

          {schedule.map((type, i) => {
            const isToday = i === todayIdx;
            const info = TYPE_INFO[type];
            return (
              <div key={DAYS[i]} className={`day-card${isToday ? " today" : ""}`}>
                <div className="day-row">
                  <span className="day-ic" style={{ background: TONE[info.tone] }}>
                    <Icon name={info.icon} size={19} />
                  </span>
                  <div className="day-name">
                    <div className="d">{DAYS[i]}</div>
                    {isToday && <div className="today-tag">HARI INI</div>}
                  </div>
                  <div className="day-label">{info.label}</div>
                  {!editMode && (
                    <span className="day-badge" style={{ background: TONE[info.tone] }}>{info.badge}</span>
                  )}
                </div>
                {editMode && (
                  <div className="day-opts">
                    {[
                      { t: "gym", lbl: "Beban" },
                      { t: "tm", lbl: "Kardio" },
                      { t: "both", lbl: "Gabung" },
                      { t: "rest", lbl: "Rest" },
                    ].map((opt) => (
                      <button key={opt.t} className={`day-opt${type === opt.t ? " sel" : ""}`}
                        onClick={() => updateDay(i, opt.t)}>
                        {opt.lbl}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {editMode && (
            <button className="btn-reset-sched" onClick={resetSchedule}>
              <Icon name="reset" size={14} />
              Kembalikan ke jadwal default (Sen-Rab-Jum gym)
            </button>
          )}

          <div className="note">
            <b>Catatan lemak perut:</b> treadmill menambah ±800–950 kkal pengeluaran per pekan,
            tapi penentu utamanya defisit kalori dari nutrisi. Target 2000 kkal & protein 140g
            tetap prioritas nomor satu.
          </div>
        </div>
      )}

      {/* ================= RIWAYAT ================= */}
      {tab === "history" && (
        <div className="view">
          <section className="week-card">
            <div className="cell">
              <div className="val">{week.length}<small>/3</small></div>
              <div className="lbl">Sesi / pekan</div>
            </div>
            <div className="sep" />
            <div className="cell">
              <div className="val">{weekSteps.toLocaleString("id-ID")}</div>
              <div className="lbl">Langkah</div>
            </div>
            <div className="sep" />
            <div className="cell">
              <div className="val">{weekKcal.toLocaleString("id-ID")}<small>kkal</small></div>
              <div className="lbl">Kalori</div>
            </div>
          </section>

          {sessions.length === 0 && (
            <div className="empty">
              Belum ada sesi tersimpan.<br />
              Selesaikan latihan pertama lalu tekan <b>Simpan Sesi</b>.
            </div>
          )}

          {sessions.map((s, i) => {
            const d = new Date(s.date);
            const complete = s.dur >= TOTAL;
            return (
              <div key={s.date + i} className="session">
                <span className="ic" style={{ background: complete ? "var(--green)" : "var(--yellow)" }}>
                  <Icon name={complete ? "check" : "run"} size={18} />
                </span>
                <div className="info">
                  <div className="date">
                    {d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "short" })}
                  </div>
                  <div className="meta">{fmt(s.dur)} menit · {complete ? "lengkap" : "sebagian"}</div>
                </div>
                <div className="nums">
                  <div className="steps">{s.steps.toLocaleString("id-ID")}</div>
                  <div className="kcal">{s.kcal} KKAL</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bottom nav */}
      <nav className="nav" aria-label="Navigasi utama">
        {[
          { id: "workout", icon: "play", label: "Latihan" },
          { id: "bmr", icon: "calc", label: "BMR" },
          { id: "progress", icon: "trend", label: "Progres" },
          { id: "schedule", icon: "calendar", label: "Jadwal" },
          { id: "history", icon: "chart", label: "Riwayat" },
        ].map((tb) => (
          <button key={tb.id} className={tab === tb.id ? "active" : ""}
            onClick={() => { setTab(tb.id); window.history.replaceState(null, "", `#${tb.id}`); }}
            aria-label={tb.label} aria-current={tab === tb.id ? "page" : undefined}>
            <span className="ring"><Icon name={tb.icon} size={19} /></span>
            {tb.label.toUpperCase()}
          </button>
        ))}
      </nav>
    </div>
  );
}
