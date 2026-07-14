import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Untuk GitHub Pages (project site), set BASE_PATH=/TreadmillCoach/ saat build.
// Default "/" untuk dev & preview lokal.
const base = process.env.BASE_PATH || "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "Treadmill Coach",
        short_name: "Treadmill",
        description: "Program treadmill 30 menit / ±5.000 langkah — timer fase, BMR & TDEE, log berat dan asupan harian.",
        lang: "id",
        display: "standalone",
        orientation: "portrait",
        start_url: base,
        scope: base,
        theme_color: "#F7F2EE",
        background_color: "#F7F2EE",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg}"],
        // Font Google di-cache saat pertama online supaya tetap ada saat offline
        runtimeCaching: [
          {
            // Peta OpenStreetMap — cache tile yang pernah dilihat
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\//,
            handler: "CacheFirst",
            options: {
              cacheName: "osm-tiles",
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-css" },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-woff",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
