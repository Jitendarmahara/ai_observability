import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dashboard lives in web/. In dev, /api/* is proxied to the ingest
// server so the browser never deals with CORS or hard-coded ports.
export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.PORT ?? 4318}`,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
