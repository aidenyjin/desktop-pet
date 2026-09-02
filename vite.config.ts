import { defineConfig } from "vite";

// Vite serves the frontend to Tauri in development and builds static assets
// for the bundle. See https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: false,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: ["es2022", "safari16"],
    minify: "esbuild",
    sourcemap: false,
    assetsInlineLimit: 0,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
} as any);
