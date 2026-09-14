/**
 * The plug point is where `app.ts` says it is: the algorithm is handed to the
 * brief. Two of the five change points, run as scenarios over the real
 * composition with one part exchanged: the stock writer with only its settling
 * stage replaced runs to a settled brief; a replaced planner keeps the stock
 * review, continuation and library behaviour. Each scenario composes the
 * harness the way `app.ts` does, with the one line changed.
 *
 * The planner's contract is the sharp one, so it is walked to the canvas: a
 * replacement RETURNS a PlanResult and nothing else — the brief publishes it —
 * so the plan it returned is the outline the reader reviews, the sections the
 * brief is written into, and the questions the composer asks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Operation } from "effection";
import type { Branch } from "@lloyal-labs/sdk";
import { initializeHarness, useExecution, serveCommands } from "@lloyal-labs/rig";
import type { PlanResult } from "@lloyal-labs/rig";
import { settings } from "@lloyal-labs/rig/node";
import { abilities, config, harness } from "../../src/app.js";
import { briefs } from "../../src/brief/brief.js";
import { openLibrary } from "../../src/brief/library.js";
import type { Command, WorkflowEvent } from "../../src/brief/protocol.js";
import * as research from "../../src/research/research.js";
import type { Inputs, Research } from "../../src/research/research.js";
import { reduce, initialState } from "../../src/ui/state.js";
import type { AppState } from "../../src/ui/state.js";
import { selectClarify, selectOutline, selectSections } from "../../src/ui/select.js";
import { runHarness, docIdOfQuery, accept } from "./harness.js";

const TWO_TASKS = JSON.stringify({ intent: "research", tasks: [{ description: "one" }, { description: "two" }], clarifyQuestions: [] });

/** `app.ts`'s composition with the algorithm exchanged — the one line a developer changes. */
const composed = (algorithm: Research): typeof harness => function* (ctx, events, commands) {
  const { session, wire, runner, registry, store } = yield* initializeHarness(ctx, events, { abilities, config });
  const run = yield* useExecution();
  const library = yield* openLibrary(() => runner.config().sources.outputDir, { events, registry, wire, run, abilities });
  const brief = briefs({ session, library, run, wire, config: runner.config, research: algorithm });
  yield* wire.send({ type: "weights:done" });
  yield* serveCommands<Command>(commands, [brief, library, settings({ runner, registry, store, wire, run, abilities, config })], { onError: brief.fail });
};

/** What the canvas holds the moment `at` is announced: the real fold over the wire this run carried. */
const foldTo = (events: readonly WorkflowEvent[], at: WorkflowEvent["type"]): AppState => {
  const end = events.findIndex((e) => e.type === at);
  assert.ok(end >= 0, `the wire never carried ${at}`);
  return events.slice(0, end + 1).reduce(reduce, initialState);
};

test("the stock writer with only its settling stage replaced runs to a settled brief", async () => {
  const settle = function* (_spine: Branch, _ask: Inputs, _plan: PlanResult, found: readonly string[]): Operation<{ answer: string; tokens: number; timeMs: number }> {
    return { answer: `SETTLED BY HAND: ${found.map((f) => f.trim()).join(" + ")}`, tokens: 0, timeMs: 0 };
  };
  const run = await runHarness({
    harness: composed({ ...research, write: (trunk, ask, plan) => research.write(trunk, ask, plan, { settle }) }),
    utterances: [
      { text: TWO_TASKS, kind: "text" },
      { text: "first finding", kind: "report" },
      { text: "second finding", kind: "report" },
    ],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  assert.equal(run.events.filter((e) => e.type === "synthesize:start").length, 0, "the stock settling pass never ran");
  assert.equal(run.events.filter((e) => e.type === "research:start").length, 1, "the stock inquiries did");
  const report = fs.readFileSync(path.join(run.outputDir, docIdOfQuery(run.events), "report.md"), "utf8");
  assert.match(report, /SETTLED BY HAND: (first finding \+ second finding|second finding \+ first finding)/);
});

test("a replaced planner keeps the stock review, continuation and library behaviour", async () => {
  const plan = function* (_trunk: Branch | null, ask: Inputs): Operation<PlanResult> {
    return { intent: "research", tasks: [{ description: `look into: ${ask.text}` }], clarifyQuestions: [], tokenCount: 0, timeMs: 0 } as PlanResult;
  };
  const run = await runHarness({
    harness: composed({ ...research, plan }),
    utterances: [{ text: "the finding", kind: "report" }, { text: "The follow-up.", kind: "text" }],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => ev.type === "complete", send: { type: "submit_query", query: "And then?", mode: "flat", skipPlanner: true } },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  assert.equal(run.events.filter((e) => e.type === "plan:start").length, 1, "the stock planner never ran; the direct ask says its own plan");
  assert.equal(run.events.filter((e) => e.type === "ui:plan_review").length, 1, "the review is the brief's, kept");
  const tasks = (run.events.find((e) => e.type === "fanout:tasks") as { tasks: { description: string }[] }).tasks;
  assert.deepEqual(tasks.map((t) => t.description), ["look into: Q?"]);
  const dir = path.join(run.outputDir, docIdOfQuery(run.events));
  assert.ok(fs.existsSync(path.join(dir, "report.md")), "the library kept the brief");
  assert.equal(fs.readdirSync(dir).filter((f) => /^exchange-\d+\.md$/.test(f)).length, 1, "and the continuation threaded beside it");
});

test("a replacement planner's RETURNED plan is the outline the reader reviews and the sections the brief is written into", async () => {
  const plan = function* (_trunk: Branch | null, ask: Inputs): Operation<PlanResult> {
    return {
      intent: "research",
      tasks: [{ description: `the near half of: ${ask.text}` }, { description: "the far half" }],
      clarifyQuestions: [], tokenCount: 0, timeMs: 0,
    } as PlanResult;
  };
  const settle = function* (_spine: Branch, _ask: Inputs, _plan: PlanResult, found: readonly string[]): Operation<{ answer: string; tokens: number; timeMs: number }> {
    return { answer: `the brief, from ${found.length} inquiries`, tokens: 0, timeMs: 0 };
  };
  const run = await runHarness({
    harness: composed({ ...research, plan, write: (trunk, ask, p) => research.write(trunk, ask, p, { settle }) }),
    utterances: [
      { text: "near findings", kind: "report" },
      { text: "far findings", kind: "report" },
    ],
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:plan_review", send: accept },
      { on: (ev) => ev.type === "complete" },
    ],
  });
  // The reader's yes is a yes to THIS plan: the review shows what the planner returned.
  assert.deepEqual(selectOutline(foldTo(run.events, "ui:plan_review")), ["the near half of: Q?", "the far half"]);
  // And the Write moment is written into its tasks — the sections ARE the plan.
  const sections = selectSections(foldTo(run.events, "research:done"));
  assert.deepEqual(sections.map((s) => s.title), ["the near half of: Q?", "the far half"]);
  assert.deepEqual([...sections.map((s) => s.prose)].sort(), ["far findings", "near findings"]);
});

test("a replacement planner's questions are the ones the composer asks the reader to answer", async () => {
  const plan = function* (): Operation<PlanResult> {
    return { intent: "clarify", tasks: [], clarifyQuestions: ["Which timeframe?", "Which region?"], tokenCount: 0, timeMs: 0 } as PlanResult;
  };
  const run = await runHarness({
    harness: composed({ ...research, plan }),
    script: [
      { send: { type: "submit_query", query: "Q?", mode: "flat" } },
      { on: (ev) => ev.type === "ui:clarify" },
    ],
  });
  assert.deepEqual(selectClarify(foldTo(run.events, "ui:clarify")), ["Which timeframe?", "Which region?"]);
});
