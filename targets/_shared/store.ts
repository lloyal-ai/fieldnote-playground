/** The view's handle on the harness: the projection `@lloyal-labs/ui` keeps
 *  over the page's bridge, read through the app's selectors. The bridge is
 *  `window.harness` — installed by the target's boot: desktop's preload
 *  (`preloadBridge`) or web's `createBridge` — so every part reads one thing
 *  and the view never knows which transport it is on. */
import { projectionFor, useConnection, useProjection } from "@lloyal-labs/ui";
import type { Bridge, Projection } from "@lloyal-labs/binding";
import { reduce, initialState, type AppState } from "../../src/ui/state.js";
import type { WorkflowEvent, Command } from "../../src/brief/protocol.js";

declare global {
  interface Window {
    /** Injected by the target's boot: desktop's preload (over IPC) or web's `createBridge` (over wss). */
    harness: Bridge<WorkflowEvent, Command, AppState>;
  }
}

/** Read a derivation of the folded state, memoized per fold (`useProjection`'s contract: a named selector may
 *  build objects; an inline one must return a primitive). */
export const useBrief = <T,>(select: (app: AppState) => T): T => useProjection<AppState, T>(select);

/** Dispatch a command to the harness. */
export const send = (command: Command): void => window.harness.send(command);

/** The page's projection, for a non-React consumer (the web history adapter): the same one the provider reads. */
export const appStore = (): Projection<AppState> => projectionFor(window.harness, initialState, reduce);

export { useConnection };
