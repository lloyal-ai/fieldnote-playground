/**
 * Inline citations are research's invariant: a report's grammar-forced
 * `sources` are woven into its findings at capture, so the synth reads — and
 * mirrors — cited findings. Pinned at the seam, over the real pool and the
 * real policy, so the recut and the migration cannot drop it unnoticed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { runHarness, docIdOfQuery } from "./harness.js";

const PLAN_JSON = JSON.stringify({
  intent: "research",
  tasks: [{ description: "investigate the topic" }],
  clarifyQuestions: [],
});
const FINDINGS = "Oslo sits on the fjord, see https://a.io/oslo and https://a.io.";
const SOURCES = [{ title: "A", url: "https://a.io" }, { title: "Oslo", url: "https://a.io/oslo" }];
const WOVEN = "Oslo sits on the fjord, see [Oslo](https://a.io/oslo) and [A](https://a.io).\n\nSources:\n- [Oslo](https://a.io/oslo)\n- [A](https://a.io)";

test("a voluntary report's sources are woven into its findings: on the wire, and in the annexure on disk", async () => {
  const run = await runHarness({
    utterances: [
      { text: PLAN_JSON, kind: "text" },
      { text: FINDINGS, kind: "report", sources: SOURCES },
      { text: "Settled answer.", kind: "text" },
    ],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: { type: "accept_plan" } },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  const returns = run.events.filter((e) => e.type === "agent:return") as { result: string }[];
  assert.equal(returns.length, 1);
  assert.equal(returns[0].result, WOVEN);
  const dir = path.join(run.outputDir, docIdOfQuery(run.events));
  const annexures = fs.readdirSync(dir).filter((f) => /^annexure-\d+\.md$/.test(f));
  assert.equal(annexures.length, 1, "one annexure per research agent");
  const body = fs.readFileSync(path.join(dir, annexures[0]), "utf8");
  assert.ok(body.includes("[Oslo](https://a.io/oslo)") && body.includes("Sources:"), "the annexure carries the woven findings");
});

// A report produced by recovery — an agent dropped at pressure, time or turns and
// given a forced report turn — is captured without passing through the return
// position, so its sources are not woven. Step 3 routes recovered calls through
// the same position as a voluntary return; this law then gets its body.
test.todo("a recovered report's sources are woven the same way — step 3");
