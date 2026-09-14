/**
 * The identity mint and the reservation, on their own: the edges the harness
 * scenarios drive through only as flows — which failures retry and which do
 * not, how many attempts, what a release may touch, and how a run dir's
 * meaning is decided.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MINT_ATTEMPTS, mintDocId, reserveDocId, releaseUnfinished, runDirMode } from "../../harness/reservation.js";

const lib = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "reservation-"));
const SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test("mintDocId: a sortable stamp, then a UUID; safe as a path segment and as a file name", () => {
  const id = mintDocId(new Date("2026-03-01T12:34:56.789Z"));
  assert.match(id, SHAPE);
  assert.ok(id.startsWith("2026-03-01T12-34-56-789-"), "the stamp leads, in the library's sort order");
  assert.equal(encodeURIComponent(id), id, "nothing the route would have to escape");
  assert.equal(path.basename(id), id, "nothing the filesystem would split");
});

test("mintDocId: a thousand mints in one millisecond are a thousand identities", () => {
  const now = new Date("2026-03-01T12:00:00.000Z");
  const ids = new Set(Array.from({ length: 1000 }, () => mintDocId(now)));
  assert.equal(ids.size, 1000);
});

test("reserveDocId: creates the library if needed, and the document's directory exclusively", () => {
  const library = path.join(lib(), "not", "yet", "there");
  const id = reserveDocId(library);
  assert.match(id, SHAPE);
  assert.ok(fs.statSync(path.join(library, id)).isDirectory(), "the directory is the reservation");
  assert.deepEqual(fs.readdirSync(path.join(library, id)), [], "reserved, not written");
});

test("reserveDocId: a collision retries with a fresh identity and leaves the planted document alone", () => {
  const library = lib();
  const dup = mintDocId(new Date(0));
  fs.mkdirSync(path.join(library, dup));
  fs.writeFileSync(path.join(library, dup, "report.md"), "# planted\n");
  const mint = mock.fn(() => (mint.mock.callCount() === 0 ? dup : mintDocId(new Date(1))));
  const id = reserveDocId(library, { mint });
  assert.notEqual(id, dup);
  assert.equal(mint.mock.callCount(), 2, "one collision, one retry");
  assert.deepEqual(fs.readdirSync(path.join(library, dup)), ["report.md"], "the planted document is untouched");
  assert.deepEqual(fs.readdirSync(library).sort(), [dup, id].sort(), "exactly one new directory");
});

test("reserveDocId: after the bound it refuses, having created nothing", () => {
  const library = lib();
  const dup = mintDocId(new Date(0));
  fs.mkdirSync(path.join(library, dup));
  const mint = mock.fn(() => dup);
  assert.throws(() => reserveDocId(library, { mint }), new RegExp(`after ${MINT_ATTEMPTS} attempts`));
  assert.equal(mint.mock.callCount(), MINT_ATTEMPTS, "the bound is the number of attempts, not one more");
  assert.deepEqual(fs.readdirSync(library), [dup], "no stray directory");
  const two = mock.fn(() => dup);
  assert.throws(() => reserveDocId(library, { mint: two, attempts: 2 }), /after 2 attempts/);
  assert.equal(two.mock.callCount(), 2);
});

test("reserveDocId: only EEXIST retries — any other failure is the library's and is thrown at once", (t) => {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    t.skip("root ignores directory permissions");
    return;
  }
  const parent = lib();
  const library = path.join(parent, "library");
  fs.mkdirSync(library);
  fs.chmodSync(library, 0o500);   // readable, not writable: the exclusive create fails EACCES
  try {
    const mint = mock.fn(() => mintDocId(new Date(0)));
    assert.throws(() => reserveDocId(library, { mint }), (err: NodeJS.ErrnoException) => err.code === "EACCES");
    assert.equal(mint.mock.callCount(), 1, "not retried: a fresh identity would not fix a library that cannot be written");
  } finally {
    fs.chmodSync(library, 0o700);
  }
});

test("reserveDocId: the default mint is the real one, so a forced crypto collision is what the harness sees", () => {
  const library = lib();
  const dup = "0f0f0f0f-0000-4000-8000-00000000dead";
  const now = new Date("2026-03-01T12:00:00.000Z");
  mock.timers.enable({ apis: ["Date"], now });
  const real = crypto.randomUUID;
  const uuids = [dup, dup, "0f0f0f0f-0000-4000-8000-0000000f0e5"];
  mock.method(crypto, "randomUUID", () => uuids.shift() ?? real());
  try {
    fs.mkdirSync(path.join(library, `${mintDocId(now).slice(0, 24)}${dup}`));
    const id = reserveDocId(library);
    assert.ok(id.endsWith("0f0f0f0f-0000-4000-8000-0000000f0e5"), `took the third identity, got ${id}`);
  } finally {
    mock.timers.reset();
    mock.restoreAll();
  }
});

test("releaseUnfinished: an unfinished directory goes with everything in it; a settled one is never touched; a missing one is nothing to do", () => {
  const library = lib();
  const unfinished = reserveDocId(library);
  fs.writeFileSync(path.join(library, unfinished, "annexure-1.md"), "evidence\n");
  assert.equal(releaseUnfinished(library, unfinished), true);
  assert.equal(fs.existsSync(path.join(library, unfinished)), false);

  const settled = reserveDocId(library);
  fs.writeFileSync(path.join(library, settled, "report.md"), "# settled\n");
  fs.writeFileSync(path.join(library, settled, "annexure-1.md"), "evidence\n");
  assert.equal(releaseUnfinished(library, settled), false);
  assert.deepEqual(fs.readdirSync(path.join(library, settled)).sort(), ["annexure-1.md", "report.md"]);

  assert.equal(releaseUnfinished(library, "never-existed"), false);
});

test("runDirMode: only a follow-up on a settled document threads; everything else writes the document's own report", () => {
  assert.equal(runDirMode(false, false), "start", "a new document");
  assert.equal(runDirMode(false, true), "start", "a new document never probes — a settled twin on disk changes nothing");
  assert.equal(runDirMode(true, false), "start", "a follow-up on a document still awaiting its plan writes its first report");
  assert.equal(runDirMode(true, true), "thread", "a follow-up on a settled document threads beside it");
});
