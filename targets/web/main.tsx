// Web renderer entry. The side-effect import runs FIRST — it installs
// `window.harness` (the wss bridge) before the view mounts and subscribes.
import "./boot.js";
import { createRoot } from "react-dom/client";
import { HarnessProvider } from "@lloyal-labs/ui";
import { HarnessApp } from "../_shared/App.js";
import { appStore, send } from "../_shared/store.js";
import { initialState, reduce } from "../../src/ui/state.js";
import { installHistory } from "./history.js";

createRoot(document.getElementById("root")!).render(
  <HarnessProvider bridge={window.harness} initialState={initialState} reduce={reduce}>
    <HarnessApp />
  </HarnessProvider>,
);

// The URL rides the fold: '/brief/<docId>' ⇄ activeDocId, back/forward as
// document navigation, deep links restored from disk. Web-only — the shared
// view never knows URLs exist.
installHistory(appStore(), send);
