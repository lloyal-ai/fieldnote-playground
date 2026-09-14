/**
 * Served (B-host) placement — the harness-RUNNING half. Isolated from the
 * compute glue in `../_shared/served-runtime` because it imports the app (and
 * so its `.eta` prompts): anything importing this file must be esbuilt with
 * `--loader:.eta=text`. `serve.ts` injects this as the host's `run`.
 */
import { ensure } from "effection";
import type { Operation, Signal } from "effection";
import type { SessionContext } from "@lloyal-labs/sdk";
import type { EventBus } from "@lloyal-labs/binding";
import { provisionAbilityModels, useTraceWriter } from "@lloyal-labs/rig/node";
import type { AttachmentStore, ContentIngress } from "@lloyal-labs/media";
import { Ingress } from "@lloyal-labs/lloyal-agents";
import { startHostResources } from "@lloyal-labs/dev-tools/node";
import { makeServedRunner, RunnerCtx } from "@lloyal-labs/rig";
import type { RunnerConfigOpts } from "@lloyal-labs/rig";
import { harness, abilities } from "../../src/app.js";
import type { Config, Origin } from "../../src/app.js";
import { applyServedGpuEnv } from "../_shared/served-runtime.js";
import type { WorkflowEvent, Command } from "../../src/brief/protocol.js";

/**
 * Run ONE served Session end to end: provision its per-session reranker, build
 * the served `Runner` (its own config clone, in-memory saves), publish it on
 * `RunnerCtx`, and run the UNCHANGED `harness(...)` over this Session. The host
 * spawns this as the per-session child; its scope owns the reranker and the
 * runner binding, so N sessions share no runner state.
 */
export function* runServedSession(
  cfg: Config,
  /** The layered config's plumbing (provenance, the session marks, the frozen model block) — never `persist`. */
  plumbing: Omit<RunnerConfigOpts<Config, Origin>, "persist">,
  /** The host's ONE project content store and ingress, shared by every Session. */
  media: AttachmentStore,
  ingress: ContentIngress,
  ctx: SessionContext,
  events: EventBus<WorkflowEvent>,
  commands: Signal<Command, void>,
): Operation<void> {
  applyServedGpuEnv(cfg);
  yield* provisionAbilityModels({
    abilities,
    projectRoot: process.cwd(),
    reranker: cfg.model.reranker ? { path: cfg.model.reranker } : undefined,
    rerankerLoad: { nSeqMax: 10, nCtx: 16384 },
  });
  const dev = process.env.LLOYAL_DEV === "1";
  if (dev) yield* ensure(startHostResources((ev) => events.send(ev)));
  const traceWriter = yield* useTraceWriter(cfg.sources.outputDir, dev, (ev) => events.send(ev));
  yield* RunnerCtx.set(makeServedRunner<Config, Origin>(cfg, { traceWriter, attachmentStore: media, dev, ...plumbing }));
  yield* Ingress.set(ingress);
  yield* harness(ctx, events, commands);
}
