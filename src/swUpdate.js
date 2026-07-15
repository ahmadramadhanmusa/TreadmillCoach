import { registerSW } from "virtual:pwa-register";

// Pembaruan PWA: daftarkan service worker, beri tahu App saat versi baru
// siap, dan cek pembaruan setiap kali aplikasi dibuka lagi dari background
// (di PWA terpasang, halaman jarang di-load ulang — tanpa ini pembaruan
// baru terlihat setelah aplikasi ditutup penuh dua kali).

let ready = false;
let listener = null;

export function onUpdateReady(fn) {
  listener = fn;
  if (ready) fn();
}

export const applyUpdate = registerSW({
  immediate: true,
  onNeedRefresh() {
    ready = true;
    listener?.();
  },
  onRegisteredSW(_url, reg) {
    if (!reg) return;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reg.update().catch(() => {});
    });
  },
});
