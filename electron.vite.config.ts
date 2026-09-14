import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * The desktop target's 3-process build (`npm run dev:desktop` / `build:desktop`).
 * `main` + `preload` run in Node (externalize node_modules; the local
 * `harness/*` sources bundle in — they're node-free). The `renderer` is a normal
 * Vite React app rooted at `targets/desktop`, folding `harness/state.ts`'s
 * `reduce`. Source lives in `targets/desktop/`; this config is at the project
 * root because that's where `electron-vite` looks for it.
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { preserveSymlinks: true }, // LOCAL-LINK ONLY — see the renderer's note.
    build: {
      lib: { entry: resolve(__dirname, "targets/desktop/main.ts") },
    },
  },
  preload: {
    // The preload runs before the renderer, in a context with constrained
    // module resolution — a bare specifier left for runtime is the one import
    // that can fail with no console to report it, leaving `window.harness`
    // undefined and a blank window. So the bridge is BUNDLED in; `electron`
    // itself stays external, as it must.
    plugins: [externalizeDepsPlugin({ exclude: ["@lloyal-labs/desktop"] })],
    resolve: { preserveSymlinks: true }, // LOCAL-LINK ONLY — see the renderer's note.
    build: {
      lib: { entry: resolve(__dirname, "targets/desktop/preload.ts") },
    },
  },
  renderer: {
    root: resolve(__dirname, "targets/desktop"),
    plugins: [react()],
    // LOCAL-LINK ONLY — not part of the template. Our `@lloyal-labs/*` packages
    // ship CommonJS, and a symlinked one resolves to its real path outside this
    // project, where neither the dev pre-bundler nor the build's commonjs
    // plugin looks — so a NAMED value import off it fails at module eval with
    // "does not provide an export named …", and a renderer that throws there
    // paints nothing at all. Keeping the symlinked path puts them back under
    // `node_modules/`, and makes `@lloyal-labs/ui` share this project's React.
    resolve: { preserveSymlinks: true },
    // Dev-server pre-bundling for the same packages; the line above is what
    // makes `build:desktop` work too.
    optimizeDeps: { include: ["@lloyal-labs/media"] },
    build: {
      rollupOptions: { input: resolve(__dirname, "targets/desktop/index.html") },
    },
  },
});
