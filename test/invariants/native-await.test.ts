/**
 * Two rules the harness can break silently, checked mechanically — the twins
 * of `packages/agents/test/native-await-invariant.test.ts` and
 * `effection-contract.test.ts`, which cover the framework's sources and not
 * this harness's.
 *
 * 1. A native decode (a trunk prefill or commit, a reranker score, a prune) is
 *    queued on the libuv pool and cannot be recalled. `yield* call(() => …)`
 *    abandons the promise on halt: the JS side moves on, the disconnect's
 *    teardown disposes the context, and the batch is still writing it. Every
 *    such await goes through `waitUntilSettled`, which exits only once the
 *    promise has settled — on return, error and halt alike.
 *
 * 2. Cleanup that needs `yield*` goes through `ensure()`, never a `finally`
 *    block: a halt unwinds a generator with `return()`, a yielding `finally`
 *    suspends that frame, the resume takes it out of unwind mode, and execution
 *    continues past the operation that was being halted. Effection's AGENTS.md
 *    states the rule; the pool reproduced the lost halt before adopting it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOTS = ["src", "targets"];
const DECODES =
  "prefill|prefillMultimodal|prefillUser|prefillUserMultimodal|prefillAssistant|commit|commitTurn|promote|retainOnly|dispose|scoreBatch";
const BARE = new RegExp(String.raw`\b(?:call|until)\(\s*(?:\(\)\s*=>\s*)?(?:[\w.]+\.(?:${DECODES}))\(`, "g");

function* tsFiles(dir: string): Generator<string> {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) yield* tsFiles(p);
    else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts")) yield p;
  }
}

/** Source with comments and string bodies blanked, so a rule reads code only. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length))
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/'(?:\\.|[^'\\\n])*'/g, (m) => " ".repeat(m.length))
    .replace(/"(?:\\.|[^"\\\n])*"/g, (m) => " ".repeat(m.length));
}

/** Every `finally { ... }` block body, found by brace matching on code only. */
function* finallyBodies(code: string): Generator<{ line: number; body: string }> {
  for (const m of code.matchAll(/\bfinally\s*\{/g)) {
    let depth = 1;
    let i = m.index! + m[0].length;
    const start = i;
    while (i < code.length && depth > 0) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}") depth--;
      i++;
    }
    yield { line: code.slice(0, m.index).split("\n").length, body: code.slice(start, i - 1) };
  }
}

const files = ROOTS.flatMap((r) => [...tsFiles(path.join(ROOT, r))]);

test("no native decode is awaited with a bare call() or until() — every one goes through waitUntilSettled", () => {
  const hits: string[] = [];
  for (const file of files) {
    const code = codeOnly(fs.readFileSync(file, "utf8"));
    for (const m of code.matchAll(BARE)) {
      hits.push(`${path.relative(ROOT, file)}:${code.slice(0, m.index).split("\n").length}  ${m[0].replace(/\s+/g, " ")}`);
    }
  }
  assert.deepEqual(hits, [], `bare native awaits:\n  ${hits.join("\n  ")}`);
});

test("no yield* inside a finally block — asynchronous cleanup goes through ensure()", () => {
  const hits: string[] = [];
  for (const file of files) {
    const code = codeOnly(fs.readFileSync(file, "utf8"));
    for (const f of finallyBodies(code)) {
      if (/\byield\*/.test(f.body)) hits.push(`${path.relative(ROOT, file)}:${f.line}`);
    }
  }
  assert.deepEqual(hits, [], `finally blocks that yield:\n  ${hits.join("\n  ")}`);
});
