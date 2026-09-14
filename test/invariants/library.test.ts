/**
 * The library on its own: its reads are confined (a planted symlink named like
 * an exchange must not pull a file from outside the folder onto the wire), and
 * the run record is shared by every session on a brief, so a file name is a
 * reservation — two records on one brief never write over each other's
 * evidence — and the roots a tool admitted ride the meta line once each.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { run, createChannel } from "effection";
import type { Operation } from "effection";
import { createBus } from "@lloyal-labs/binding";
import type { EventBus } from "@lloyal-labs/binding";
import { Attachments } from "@lloyal-labs/lloyal-agents";
import { NullAttachmentStore } from "@lloyal-labs/media";
import { createAbilityRegistry, createInMemoryConfigStore } from "@lloyal-labs/rig";
import { openLibrary } from "../../src/brief/library.js";
import type { Library } from "../../src/brief/library.js";
import type { WorkflowEvent } from "../../src/brief/protocol.js";
import type { Inputs } from "../../src/research/research.js";

const REPORT = "# Q?\n\n> 2026-01-01T00:00:00.000Z · flat · 1.0s\n\nThe body.\n";
const EXCHANGE = "# Follow-up?\n\n> 2026-01-01T00:01:00.000Z · flat · 1.0s\n\nThe follow-up body.\n";
const ev = (e: Record<string, unknown>): WorkflowEvent => e as unknown as WorkflowEvent;
const ask = (docId: string, attachments: { digest: string }[] = []): Inputs =>
  ({ docId, text: "Q?", mode: "flat", direct: false, effort: "low", attachments, excluded: [], sources: [] }) as unknown as Inputs;

/** One session's library over `dir`, with the bus it reads. */
function* opened(dir: string): Operation<{ lib: Library; bus: EventBus<WorkflowEvent> }> {
  const registry = yield* createAbilityRegistry({ configStore: createInMemoryConfigStore() });
  const bus = createBus<WorkflowEvent>();
  bus.subscribe(() => {});
  yield* Attachments.set(new NullAttachmentStore());
  const lib = yield* openLibrary(() => dir, { events: bus, registry, wire: createChannel<WorkflowEvent, void>(), run: { busy: false } as never, abilities: [] });
  return { lib, bus };
}

test("read ignores an exchange whose real path lies outside the brief's folder", async () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), "lib-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
  const id = "2026-01-01T00-00-00-000";
  fs.mkdirSync(path.join(lib, id));
  fs.writeFileSync(path.join(lib, id, "report.md"), REPORT);
  fs.writeFileSync(path.join(lib, id, "exchange-1.md"), EXCHANGE);
  fs.writeFileSync(path.join(outside, "secret.md"), "# leaked\n\n> x\n\nSECRET\n");
  fs.symlinkSync(path.join(outside, "secret.md"), path.join(lib, id, "exchange-2.md"));
  const thread = await run(function* () { return (yield* opened(lib)).lib.read(id); });
  assert.ok(thread);
  assert.equal(thread.exchanges.length, 1);
  assert.equal(thread.exchanges[0].question, "Follow-up?");
  assert.doesNotMatch(thread.thread, /SECRET/);
});

test("two sessions' records on one brief reserve distinct annexure names", async () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), "lib-"));
  const id = "2026-01-01T00-00-00-000";
  fs.mkdirSync(path.join(lib, id));
  fs.writeFileSync(path.join(lib, id, "report.md"), REPORT);
  fs.writeFileSync(path.join(lib, id, "annexure-1.md"), "# Annexure 1\n\n---\n\nold\n");
  await run(function* () {
    const a = yield* opened(lib);
    const b = yield* opened(lib);
    a.lib.begin(id, ask(id), { warm: true });
    b.lib.begin(id, ask(id), { warm: true });   // the same brief, the same moment
    for (const s of [a, b]) s.bus.send(ev({ type: "research:start" }));
    a.bus.send(ev({ type: "agent:spawn", agentId: 11 }));
    b.bus.send(ev({ type: "agent:spawn", agentId: 22 }));
    a.bus.send(ev({ type: "agent:return", agentId: 11, result: "A's evidence" }));
    b.bus.send(ev({ type: "agent:return", agentId: 22, result: "B's evidence" }));
  });
  const written = fs.readdirSync(path.join(lib, id)).filter((n) => /^annexure-\d+\.md$/.test(n)).sort();
  assert.deepEqual(written, ["annexure-1.md", "annexure-2.md", "annexure-3.md"]);
  const bodies = written.map((n) => fs.readFileSync(path.join(lib, id, n), "utf8"));
  assert.ok(bodies.some((t) => /A's evidence/.test(t)) && bodies.some((t) => /B's evidence/.test(t)));
});

test("roots a tool result admitted ride the meta line beside the ask's own, once each", async () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), "lib-"));
  const own = "sha256:" + "a".repeat(64);
  const admitted = "sha256:" + "b".repeat(64);
  const root = (digest: string) => ({ mediaType: "application/vnd.oci.image.manifest.v1+json", digest, size: 700 });
  const id = await run(function* () {
    const { lib: library, bus } = yield* opened(lib);
    const docId = library.reserve();
    library.begin(docId, ask(docId, [root(own)]), { warm: false });
    bus.send(ev({ type: "agent:prefilled", agentId: 3, cells: 1629, role: "toolResult", attachments: [root(admitted), root(own)] }));
    bus.send(ev({ type: "answer", text: "the answer" }));
    bus.send(ev({ type: "complete", data: {} }));   // the report lands as `complete` is said
    yield* library.settled(docId);
    return docId;
  });
  const meta = fs.readFileSync(path.join(lib, id, "report.md"), "utf8").split("\n")[2] ?? "";
  assert.ok(meta.includes(`media ${own} ${admitted}`), meta);
  assert.equal(meta.split(own).length - 1, 1);
});
