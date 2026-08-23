import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@carbon-ai/protocol/tool-draft": resolve(root, "../../packages/protocol/src/tool-draft.ts"),
      "@carbon-ai/protocol": resolve(root, "../../packages/protocol/src/index.ts"),
    },
  },
  base: "/console/",
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:12580",
      "/v1": "http://127.0.0.1:12580",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsDir: "assets",
  },
});
