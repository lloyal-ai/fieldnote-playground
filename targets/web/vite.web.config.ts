import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * The web target's browser app (`npm run dev:web` / `npm run build:web`). Rooted
 * at `targets/web`; it connects to the local `npm run serve` host over wss (see
 * `web-bridge.ts`). Point it elsewhere with `VITE_WSS_URL` or `?server=`; the
 * content plane follows the same host automatically (`VITE_CONTENT_URL` /
 * `?content=` override it independently).
 */
export default defineConfig({
  root: resolve(__dirname),
  plugins: [react()],
  server: {
    port: 5173,
    // Both planes of the served host reach the browser through THIS origin in
    // dev: the page is on :5173, the host on :8787. Proxying the content plane
    // keeps its requests same-origin, so no CORS preflight is involved and the
    // host needs no `allowedOrigin` for local work. `/v1/media` carries uploads
    // and representations; `/v1/content` answers existence by digest.
    proxy: {
      "/v1/media": { target: "http://127.0.0.1:8787", changeOrigin: true },
      "/v1/content": { target: "http://127.0.0.1:8787", changeOrigin: true },
    },
  },
  // LOCAL-LINK ONLY — not part of the template. Our `@lloyal-labs/*` packages
  // ship CommonJS. Vite gives an INSTALLED CJS dependency named-export interop
  // automatically, but a symlinked one resolves to its real path outside this
  // project, where neither the dev pre-bundler nor the build's commonjs plugin
  // looks — so its named exports vanish ("does not provide an export named
  // 'createBridge'"). Keeping the symlinked path puts them back under
  // `node_modules/`, where both stages treat them like any installed package.
  // It also makes `@lloyal-labs/ui` resolve ITS react peer through this
  // project, so the app and the package share one React rather than two.
  resolve: { preserveSymlinks: true },
  // Dev-server pre-bundling for the same packages. `optimizeDeps` covers the
  // dev server only; the line above is what makes `build:web` work too.
  optimizeDeps: { include: ["@lloyal-labs/binding/web", "@lloyal-labs/media"] },
  build: { outDir: resolve(__dirname, "../../dist-web"), emptyOutDir: true },
});
