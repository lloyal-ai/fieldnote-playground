/**
 * Admission is the pool's. When retained ancestors hold every sequence before
 * an inquiry starts, the inquiry is refused with a named reason, its outcome is
 * delivered once, the run settles, and Stop completes — nothing waits forever
 * on a seat that cannot come.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runHarness, accept } from "./harness.js";

const PLAN_JSON = JSON.stringify({ intent: "research", tasks: [{ description: "investigate the topic" }], clarifyQuestions: [] });

test("the sequence budget exhausted before an inquiry starts: a named refusal, the run settles, Stop completes", async () => {
  const run = await runHarness({
    nSeqMax: 2,   // the root and the spine hold both sequences; no inquiry can fork beneath them
    utterances: [{ text: PLAN_JSON, kind: "text" }, { text: "never seated", kind: "report" }],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => ev.type === "complete", send: { type: "stop" } },
      { send: { type: "library_list" } },
      { on: (ev) => ev.type === "library:list" },
    ],
  });
  const refused = run.trace.filter((t) => t.type === "pool:spawnRefused") as { reason: string; key?: string }[];
  assert.deepEqual(refused.map((r) => [r.key, r.reason]), [["task:0", "no_sequence"]], "the inquiry was refused, once, by name");
  assert.equal(run.events.filter((e) => e.type === "agent:spawn").length, 1, "the planner's agent; the inquiry never spawned");
  assert.equal(run.events.filter((e) => e.type === "complete").length, 1, "the run settled");
  assert.equal(run.events.filter((e) => e.type === "run:aborted").length, 0, "Stop found nothing running");
});
