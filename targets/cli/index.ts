/**
 * The CLI target — where your research harness runs in a terminal.
 *
 * Generated for you and rarely touched. It resolves the resident model (and
 * its vision projector, when the catalog pairs one), provisions the services
 * the abilities declare (a reranker), builds the edge `Runner` over the layered
 * config, picks a surface, and runs your app over it. The surface pick is the
 * whole "one harness, many targets" idea in miniature — the same
 * `harness(ctx, events, commands)` mounts on Ink (a terminal), `ipc` (when a
 * desktop shell forks this bin), or `ndjson` (a pipe), all over one binding.
 */
import { main, call, ensure } from "effection";
import { createBus } from "@lloyal-labs/binding";
import { ipc, ndjson } from "@lloyal-labs/binding/node";
import { startHostResources } from "@lloyal-labs/dev-tools/node";
import { parseArgs } from "node:util";
import { createContext } from "@lloyal-labs/lloyal.node";
import { provisionAbilityModels, resolveRuntimeModels, useTraceWriter, createProjectMediaStore, loadYml, runnerConfig } from "@lloyal-labs/rig/node";
import { createContentIngress } from "@lloyal-labs/media/node";
import { Ingress } from "@lloyal-labs/lloyal-agents";
import { makeEdgeRunner, RunnerCtx } from "@lloyal-labs/rig";
import { harness, abilities, config } from "../../src/app.js";
import type { Config, Origin } from "../../src/app.js";
import { HarnessExit } from "../../src/brief/protocol.js";
import type { Command, WorkflowEvent } from "../../src/brief/protocol.js";
import { applyServedGpuEnv, bufferedCommandSignal } from "../_shared/served-runtime.js";
import { renderCli } from "./view.js";
import { serveIngest } from "./ingest.js";

// Where `harness.yml` was found — the project. `media/` and `models/` belong to it,
// not to wherever the operator started the process.
const projectRoot = process.cwd();
// Snapshotted before `applyServedGpuEnv` writes LLOYAL_GPU, so a re-layering
// after a save reads the user's env, never our own write.
const bootEnv = { ...process.env };

// The one flag the boot owns: `--query` runs scripted. A TTY auto-submits it
// into the command loop; a bare pipe runs it one-shot to a settled report.
const { values: cliFlags } = parseArgs({ options: { query: { type: "string" } }, strict: false });
const initialQuery = typeof cliFlags.query === "string" ? cliFlags.query : undefined;
const oneShot = !process.env.RR_BRIDGE && !process.stdout.isTTY;

// The layered config: cli > env > harness.json > harness.yml > default. A bad
// manifest fails HERE, before any model fetch.
function loadOrExit(): ReturnType<typeof runnerConfig<typeof config>> {
  try {
    return runnerConfig(config, loadYml(config, projectRoot), { env: bootEnv, cwd: projectRoot });
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
const loaded = loadOrExit();
const context = loaded.config.model.nCtx ?? 32768;

main(function* () {
  // The reasoning model and, when the catalog pairs one, its vision projector:
  // files in models/<role>/, fetched and digest-verified on first run.
  let models: Awaited<ReturnType<typeof resolveRuntimeModels>>;
  let fetching = false;
  try {
    models = yield* call(() =>
      resolveRuntimeModels({
        projectRoot,
        config: loaded.config.model,
        llmId: loaded.config.model.id,
        onProgress: (role, got, total) => {
          fetching = true;
          process.stderr.write(`\rfetching ${role} — ${total > 0 ? Math.round((100 * got) / total) : 0}%   `);
        },
      }),
    );
  } catch (err) {
    process.stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
  if (fetching) process.stderr.write("\n");

  // The live config the app reads through the Runner: the layered result with the model path RESOLVED.
  // Built before the context, so a configured `gpu` steers both the resident context and the reranker.
  const cfg: Config = { ...loaded.config, model: { ...loaded.config.model, path: models.modelPath, nCtx: context } };
  applyServedGpuEnv(cfg);

  // The resident model context — one shared `llama_context`; every agent is a branch over it.
  const ctx = yield* call(() =>
    createContext(
      {
        modelPath: models.modelPath,
        nCtx: context,
        nSeqMax: cfg.model.branches ?? 32,
        typeK: cfg.model.kvCache ?? "q4_0",
        typeV: cfg.model.kvCache ?? "q4_0",
        ...(models.mmprojPath ? { mmprojPath: models.mmprojPath } : {}),
        ...(cfg.model.imageMinTokens ? { imageMinTokens: cfg.model.imageMinTokens } : {}),
        ...(cfg.model.imageMaxTokens ? { imageMaxTokens: cfg.model.imageMaxTokens } : {}),
      },
      cfg.model.gpu ? { gpuVariant: cfg.model.gpu } : undefined,
    ),
  );

  // The services the abilities declare: the reranker, resolved and published on RerankerCtx.
  let fetchingReranker = false;
  try {
    yield* provisionAbilityModels({
      abilities,
      projectRoot,
      reranker: cfg.model.reranker ? { path: cfg.model.reranker } : cfg.model.rerankerId ? { id: cfg.model.rerankerId } : undefined,
      rerankerLoad: { nSeqMax: 10, nCtx: 16384 },
      onProgress: (got, total) => {
        fetchingReranker = true;
        process.stderr.write(`\rfetching reranker — ${total > 0 ? Math.round((100 * got) / total) : 0}%   `);
      },
    });
  } catch (err) {
    process.stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
  if (fetchingReranker) process.stderr.write("\n");

  // Two sinks, two lifetimes: the trace is per-session and dev-gated; the content store is durable and never gated.
  const dev = process.env.LLOYAL_DEV === "1";
  const events = createBus<WorkflowEvent>();
  const traceWriter = yield* useTraceWriter(cfg.sources.outputDir, dev, (ev) => events.send(ev));
  const media = createProjectMediaStore(projectRoot);
  const ingress = createContentIngress(media);
  yield* RunnerCtx.set({
    ...makeEdgeRunner<Config, Origin>(cfg, {
      traceWriter, attachmentStore: media, dev,
      origin: loaded.origin, persist: loaded.persist, sessionOriginMap: loaded.sessionOriginMap, frozen: loaded.frozen,
    }),
    mode: oneShot ? "oneshot" : "interactive",
    initialQuery,
  });
  yield* Ingress.set(ingress);

  // Buffered: the bindings dispatch from the moment they mount; the command loop arms after boot.
  const commands = bufferedCommandSignal<Command>();
  const dispatch = (c: Command): void => { commands.send(c); };
  const bootstrap: WorkflowEvent[] = [];

  // Surface pick — the same events/commands, a different binding.
  let dispose: () => void;
  if (process.env.RR_BRIDGE) {
    dispose = ipc<WorkflowEvent, Command>()(events, dispatch, bootstrap);
    yield* ensure(serveIngest(ingress));
  } else if (process.stdout.isTTY) {
    dispose = renderCli(events, dispatch, bootstrap);
  } else {
    dispose = ndjson<WorkflowEvent, Command>()(events, dispatch, bootstrap);
  }
  yield* ensure(() => dispose());

  if (dev) yield* ensure(startHostResources((ev) => events.send(ev)));
  try {
    yield* harness(ctx, events, commands);
  } catch (err) {
    // A one-shot run the harness could not proceed past: its message is the diagnosis, its exitCode the verdict.
    if (err instanceof HarnessExit) {
      process.stderr.write(`${err.message}\n`);
      process.exitCode = err.exitCode;
      return;
    }
    throw err;
  }
});
