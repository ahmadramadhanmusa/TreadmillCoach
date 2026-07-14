import { useState, useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/* ============================================================
   LARI / JALAN OUTDOOR — GPS tracker ala Strava
   Rute di peta (Leaflet + OpenStreetMap), jarak via haversine,
   pace, kalori dari berat badan, riwayat di localStorage.
   ============================================================ */

const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* penyimpanan penuh / private mode */ }
  },
};

// kkal per kg per km (aproksimasi umum: lari ~1.03, jalan ~0.53)
const KCAL_PER_KG_KM = { run: 1.03, walk: 0.53 };
const MODES = [
  { id: "run", label: "Lari" },
  { id: "walk", label: "Jalan" },
];

const fmtClock = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Pace menit/km → "MM:SS"
function fmtPace(secPerKm) {
  if (!isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) return "–:––";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Jarak antar koordinat (meter)
function haversine(a, b) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Kurangi titik rute sebelum disimpan agar localStorage tidak penuh
function downsample(path, max = 500) {
  if (path.length <= max) return path;
  const step = path.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(path[Math.floor(i * step)]);
  out.push(path[path.length - 1]);
  return out;
}

// Mode demo (?gps-demo di URL): titik GPS sintetis memutari Monas,
// untuk mencoba fitur tanpa keluar rumah / di desktop.
const DEMO = new URLSearchParams(window.location.search).has("gps-demo");
function demoWatch(cb) {
  let i = 0;
  const id = setInterval(() => {
    const ang = i * 0.012; // ~3 m/s di radius 250 m
    cb({
      coords: {
        latitude: -6.1754 + (Math.cos(ang) * 250) / 111320,
        longitude: 106.8272 + (Math.sin(ang) * 250) / 111320 / Math.cos(6.1754 * (Math.PI / 180)),
        accuracy: 8,
      },
      timestamp: Date.now(),
    });
    i++;
  }, 1000);
  return () => clearInterval(id);
}

// Ikon lokal (Lucide) — RunTab berdiri sendiri, tidak impor dari App
const Ic = ({ d, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
const IC = {
  play: <polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="5" y="4" width="4.5" height="16" rx="1.5" fill="currentColor" stroke="none" />
      <rect x="14.5" y="4" width="4.5" height="16" rx="1.5" fill="currentColor" stroke="none" />
    </>
  ),
  stop: <rect x="5" y="5" width="14" height="14" rx="2.5" fill="currentColor" stroke="none" />,
  pin: (
    <>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
};

export default function RunTab({ weight }) {
  const [status, setStatus] = useState("idle"); // idle|tracking|paused|done
  const [mode, setMode] = useState("run");
  const [dur, setDur] = useState(0);       // detik
  const [dist, setDist] = useState(0);     // meter
  const [curPace, setCurPace] = useState(Infinity); // detik/km (jendela ~30 dtk)
  const [gps, setGps] = useState("off");    // off|wait|ok|denied
  const [runs, setRuns] = useState([]);
  const [saved, setSaved] = useState(false);
  const [viewing, setViewing] = useState(null); // index riwayat yang dilihat di peta

  const mapRef = useRef(null);
  const mapEl = useRef(null);
  const lineRef = useRef(null);
  const savedLineRef = useRef(null);
  const dotRef = useRef(null);
  const pathRef = useRef([]);   // [{lat,lng,t}]
  const stopWatchRef = useRef(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  // Muat riwayat lari
  useEffect(() => {
    try {
      const r = store.get("tm-runs");
      if (r) setRuns(JSON.parse(r));
    } catch { /* data korup, abaikan */ }
  }, []);

  // Peta Leaflet — sekali saat tab dibuka
  useEffect(() => {
    const map = L.map(mapEl.current, { zoomControl: false, attributionControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
    map.setView([-2.5, 118], 4); // Indonesia
    lineRef.current = L.polyline([], { color: "#17181c", weight: 4 }).addTo(map);
    savedLineRef.current = L.polyline([], { color: "#ee5d8f", weight: 4 }).addTo(map);
    dotRef.current = L.circleMarker([0, 0], {
      radius: 7, color: "#fff", weight: 2, fillColor: "#ee5d8f", fillOpacity: 1,
    });
    mapRef.current = map;
    // Posisi awal: titik terakhir yang diketahui (tanpa tracking)
    if (!DEMO && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => map.setView([p.coords.latitude, p.coords.longitude], 16),
        () => {}, { maximumAge: 600000, timeout: 5000 }
      );
    }
    setTimeout(() => map.invalidateSize(), 50);
    return () => map.remove();
  }, []);

  // Layar tetap menyala selama tracking
  useEffect(() => {
    if (status !== "tracking" || !navigator.wakeLock) return;
    let lock = null;
    navigator.wakeLock.request("screen").then((l) => { lock = l; }).catch(() => {});
    return () => { lock?.release().catch(() => {}); };
  }, [status]);

  // Timer durasi
  useEffect(() => {
    if (status !== "tracking") return;
    const id = setInterval(() => setDur((d) => d + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  const onPosition = (pos) => {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    if (accuracy > 35) return; // sinyal buruk, abaikan
    setGps("ok");
    const map = mapRef.current;
    dotRef.current.setLatLng([lat, lng]).addTo(map);
    if (statusRef.current !== "tracking") return;

    const path = pathRef.current;
    const pt = { lat, lng, t: pos.timestamp || Date.now() };
    const last = path[path.length - 1];
    if (last) {
      const d = haversine(last, pt);
      const dt = Math.max(0.5, (pt.t - last.t) / 1000);
      if (d / dt > 8) return;  // lompatan tak wajar (> 8 m/s), abaikan
      if (d < 2) return;       // belum bergerak berarti
      setDist((v) => v + d);
    }
    path.push(pt);
    lineRef.current.addLatLng([lat, lng]);
    map.setView([lat, lng], Math.max(map.getZoom(), 16));

    // Pace saat ini dari jendela ~30 detik terakhir
    const cutoff = pt.t - 30000;
    let wd = 0, first = pt;
    for (let i = path.length - 1; i > 0 && path[i].t > cutoff; i--) {
      wd += haversine(path[i - 1], path[i]);
      first = path[i - 1];
    }
    const wt = (pt.t - first.t) / 1000;
    setCurPace(wd > 5 ? (wt / wd) * 1000 : Infinity);
  };

  const startWatch = () => {
    if (DEMO) {
      stopWatchRef.current = demoWatch(onPosition);
      return;
    }
    if (!navigator.geolocation) { setGps("denied"); return; }
    const id = navigator.geolocation.watchPosition(onPosition,
      (e) => setGps(e.code === 1 ? "denied" : "wait"),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
    stopWatchRef.current = () => navigator.geolocation.clearWatch(id);
  };

  const start = () => {
    setViewing(null);
    savedLineRef.current.setLatLngs([]);
    if (status === "idle" || status === "done") {
      pathRef.current = [];
      lineRef.current.setLatLngs([]);
      setDur(0); setDist(0); setSaved(false); setCurPace(Infinity);
    }
    setGps("wait");
    setStatus("tracking");
    startWatch();
  };

  const pause = () => {
    stopWatchRef.current?.();
    setStatus("paused");
  };

  const finish = () => {
    stopWatchRef.current?.();
    setStatus("done");
    const pts = pathRef.current;
    if (pts.length > 1) {
      mapRef.current.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])), { padding: [24, 24] });
    }
  };

  useEffect(() => () => stopWatchRef.current?.(), []); // bersihkan watch saat pindah tab

  // ?gps-demo=auto → langsung mulai (untuk pengujian)
  useEffect(() => {
    if (DEMO && new URLSearchParams(window.location.search).get("gps-demo") === "auto") start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const km = dist / 1000;
  const kcal = Math.round(weight * km * KCAL_PER_KG_KM[mode]);
  const avgPace = km > 0.01 ? dur / km : Infinity;

  const saveRun = () => {
    const entry = {
      date: new Date().toISOString(),
      mode, dur,
      km: Math.round(km * 100) / 100,
      kcal,
      path: downsample(pathRef.current.map((p) => [
        Math.round(p.lat * 1e5) / 1e5, Math.round(p.lng * 1e5) / 1e5,
      ])),
    };
    const arr = [entry, ...runs].slice(0, 30);
    setRuns(arr);
    setSaved(true);
    store.set("tm-runs", JSON.stringify(arr));
  };

  const viewRun = (i) => {
    if (status === "tracking") return;
    setViewing(i === viewing ? null : i);
    const line = savedLineRef.current;
    if (i === viewing || !runs[i]?.path?.length) {
      line.setLatLngs([]);
      return;
    }
    line.setLatLngs(runs[i].path);
    mapRef.current.fitBounds(line.getBounds(), { padding: [24, 24] });
  };

  const tracking = status === "tracking";

  return (
    <div className="view">
      <header className="head">
        <div>
          <div className="hello">Outdoor</div>
          <h1>{MODES.find((m) => m.id === mode).label} GPS</h1>
        </div>
        <span className={`gps-dot ${gps}`} title="Status GPS">
          <Ic d={IC.pin} size={15} />
          {gps === "ok" ? "GPS" : gps === "wait" ? "MENCARI…" : gps === "denied" ? "DITOLAK" : "GPS"}
        </span>
      </header>

      {status === "idle" && (
        <div className="mode-row" role="tablist" aria-label="Jenis aktivitas">
          {MODES.map((m) => (
            <button key={m.id} className={`mode-pill${mode === m.id ? " on" : ""}`}
              role="tab" aria-selected={mode === m.id} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      )}

      <div className="run-map" ref={mapEl} aria-label="Peta rute" />
      {gps === "denied" && (
        <p className="run-note">
          Izin lokasi ditolak. Aktifkan izin lokasi untuk situs ini di pengaturan browser,
          lalu coba lagi.
        </p>
      )}

      <section className="week-card run-stats">
        <div className="cell">
          <div className="val">{fmtClock(dur)}</div>
          <div className="lbl">Durasi</div>
        </div>
        <div className="sep" />
        <div className="cell">
          <div className="val">{km.toFixed(2)}<small>km</small></div>
          <div className="lbl">Jarak</div>
        </div>
        <div className="sep" />
        <div className="cell">
          <div className="val">{fmtPace(tracking ? curPace : avgPace)}<small>/km</small></div>
          <div className="lbl">{tracking ? "Pace" : "Pace rata²"}</div>
        </div>
        <div className="sep" />
        <div className="cell">
          <div className="val">{kcal}<small>kkal</small></div>
          <div className="lbl">Kalori</div>
        </div>
      </section>

      <div className="controls">
        {status !== "done" && (
          <button className="btn-main" onClick={tracking ? pause : start}>
            <Ic d={tracking ? IC.pause : IC.play} size={20} />
            {tracking ? "JEDA" : status === "paused" ? "LANJUT" : "MULAI"}
          </button>
        )}
        {(tracking || status === "paused") && (
          <button className="btn-round" onClick={finish} aria-label="Selesaikan aktivitas">
            <Ic d={IC.stop} size={18} />
          </button>
        )}
        {status === "done" && (
          <>
            <button className={`btn-main${saved ? "" : " save"}`} onClick={saveRun} disabled={saved || km < 0.05}>
              {saved ? "TERSIMPAN ✓" : "SIMPAN AKTIVITAS"}
            </button>
            <button className="btn-round" onClick={() => { setStatus("idle"); setDur(0); setDist(0); lineRef.current.setLatLngs([]); }}
              aria-label="Aktivitas baru">
              <Ic d={IC.play} size={18} />
            </button>
          </>
        )}
      </div>

      {runs.length > 0 && <h2 className="run-h2">Riwayat outdoor</h2>}
      {runs.map((r, i) => {
        const d = new Date(r.date);
        return (
          <button key={r.date + i} className={`session run-item${viewing === i ? " viewing" : ""}`}
            onClick={() => viewRun(i)} aria-label="Lihat rute di peta">
            <span className="ic" style={{ background: r.mode === "run" ? "var(--pink)" : "var(--blue)" }}>
              <Ic d={IC.pin} size={18} />
            </span>
            <div className="info">
              <div className="date">
                {d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "short" })}
              </div>
              <div className="meta">
                {r.mode === "run" ? "Lari" : "Jalan"} · {fmtClock(r.dur)} · pace {fmtPace(r.km > 0 ? r.dur / r.km : Infinity)}/km
              </div>
            </div>
            <div className="nums">
              <div className="steps">{r.km.toFixed(2)} km</div>
              <div className="kcal">{r.kcal} KKAL</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
