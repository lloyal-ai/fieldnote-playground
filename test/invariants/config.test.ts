/**
 * The layered config carries every documented model key through the same
 * rungs. `model.llm.mmproj` is documented as the projector override; the
 * boot reads `config.model.mmproj`, so the loader must put it there —
 * from harness.yml, and from the local overlay above it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig } from "../../harness/config.js";

test("model.llm.mmproj reaches config.model.mmproj", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-"));
  const llm = { id: "qwen3.5-4b-q4", mmproj: "mmproj-qwen3.5-4b-f16" };
  const { config } = loadConfig({ model: { llm } }, {}, {}, cwd);
  assert.equal(config.model.mmproj, "mmproj-qwen3.5-4b-f16");
});

test("the local overlay's model.mmproj wins over harness.yml", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-"));
  fs.writeFileSync(path.join(cwd, "harness.json"),
    JSON.stringify({ version: 1, sources: {}, abilities: {}, defaults: {}, model: { mmproj: "local-projector" } }));
  const llm = { id: "qwen3.5-4b-q4", mmproj: "yml-projector" };
  const { config } = loadConfig({ model: { llm } }, {}, {}, cwd);
  assert.equal(config.model.mmproj, "local-projector");
});

// ── defaults.guards: the harness's scope for the abilities' gates ──────────
import { fileURLToPath } from "node:url";
import { run } from "effection";
import { AbilityConfigStoreCtx } from "@lloyal-labs/lloyal-agents";
import { createInMemoryConfigStore } from "@lloyal-labs/rig";
import { createWebAbility } from "@lloyal-labs/web-ability";
import { loadYml, saveLocalConfig } from "../../harness/config.js";

const GUARDS = { url_dedup: { scope: "cohort" as const }, query_dedup: { scope: "cohort" as const } };

test("a committed defaults.guards loads, and survives a local effort save", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-"));
  const yml = { defaults: { guards: GUARDS } };
  assert.deepEqual(loadConfig(yml, {}, {}, cwd).config.defaults.guards, GUARDS);
  // set_effort saves only `effort`; the local rung's shallow merge must not shadow the committed guards.
  saveLocalConfig({ defaults: { effort: "medium" } }, cwd);
  const { config } = loadConfig(yml, {}, {}, cwd);
  assert.equal(config.defaults.effort, "medium");
  assert.deepEqual(config.defaults.guards, GUARDS);
});

test("absent defaults.guards stays absent: the framework's default applies", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-"));
  assert.equal(loadConfig({}, {}, {}, cwd).config.defaults.guards, undefined);
});

test("the committed rung fails loud on a malformed defaults.guards; the local rung falls through", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-"));
  fs.writeFileSync(path.join(cwd, "harness.yml"), "defaults:\n  guards:\n    url_dedup: sometimes\n");
  assert.throws(() => loadYml(cwd), /defaults\.guards/);
  fs.writeFileSync(path.join(cwd, "harness.json"),
    JSON.stringify({ version: 1, sources: {}, abilities: {}, defaults: { guards: { url_dedup: "sometimes" } } }));
  assert.deepEqual(loadConfig({ defaults: { guards: GUARDS } }, {}, {}, cwd).config.defaults.guards, GUARDS);
});

test("every gate harness.yml names is one the web ability declares", async () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const named = Object.keys(loadYml(root).defaults?.guards ?? {});
  assert.ok(named.length > 0, "harness.yml commits the research scope for the web gates");
  const web = await run(function* () {
    const store = createInMemoryConfigStore();
    yield* store.set("web", { tavilyKey: "test-key" });
    yield* AbilityConfigStoreCtx.set(store);
    return yield* createWebAbility();
  });
  const declared = web.tools.flatMap((t) => t.hooks?.beforeDispatch ?? []).map((g) => g.name);
  for (const name of named) assert.ok(declared.includes(name), `${name} is not a gate the web ability declares (${declared.join(", ")})`);
});
