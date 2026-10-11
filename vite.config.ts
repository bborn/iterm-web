import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  publicDir: "web/public",
  build: { outDir: "dist/web", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    proxy: { "/api": { target: "http://127.0.0.1:47823", ws: true } },
  },
});
