/**
 * A document's identity, and the directory that reserves it.
 *
 * One string names a document everywhere: the fold's DocState, `/brief/:docId`,
 * and `outputDir/<docId>/` on disk. The identity is minted here, and RESERVED
 * here: the directory is created non-recursively when the id is minted, so two
 * sessions over one library cannot name one document, and a collision retries
 * or refuses before anything — the trunk, the wire — carries the id. A
 * reservation lives exactly as long as its document is unfinished: `report.md`
 * settles it, and `releaseUnfinished` removes one that never got there.
 *
 * Filesystem only, no harness state: the harness owns WHEN to reserve and
 * release (`harness.ts`), this file owns HOW, so the edges — which errors retry,
 * how many times, what a release may touch — are testable on their own.
 */
import crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DocId } from "./state-core.js";

/** How many fresh identities `reserveDocId` tries before giving up. A UUID
 *  collides in theory only; the bound exists so a forced one is refused, not
 *  looped. */
export const MINT_ATTEMPTS = 4;

/** The one identity mint: an ISO timestamp for sorting and reading, then a
 *  UUID so two mints never name one document — in one millisecond, in one
 *  session or two. URL-safe and filename-safe as minted. Pure; `crypto` is read
 *  off the module object so a test can force a collision. */
export function mintDocId(now: Date = new Date()): DocId {
  return `${now.toISOString().replace(/[:.]/g, "-").replace("Z", "")}-${crypto.randomUUID()}`;
}

/**
 * Mint an identity and reserve it in one step. The library directory is
 * created first (recursively; it may not exist yet); the document's own is
 * created non-recursively, so `EEXIST` — another session, a planted fixture, a
 * forced clock — means try again with a fresh identity. Any other failure is
 * the library's, not the identity's, and is thrown at once. After `attempts`
 * collisions the caller refuses its submit with nothing changed.
 */
export function reserveDocId(
  libraryDir: string,
  opts: { mint?: () => DocId; attempts?: number } = {},
): DocId {
  const mint = opts.mint ?? mintDocId;
  const attempts = opts.attempts ?? MINT_ATTEMPTS;
  fs.mkdirSync(libraryDir, { recursive: true });
  for (let attempt = 0; attempt < attempts; attempt++) {
    const id = mint();
    try {
      fs.mkdirSync(path.join(libraryDir, id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    }
    return id;
  }
  throw new Error(`could not reserve a document identity after ${attempts} attempts`);
}

/**
 * Release a document that never settled: its directory goes — annexures
 * written mid-run go with it — if it holds no `report.md`. A settled report is
 * never touched, and a directory already gone is nothing to do. Returns
 * whether a directory was removed.
 */
export function releaseUnfinished(libraryDir: string, docId: DocId): boolean {
  const dir = path.join(libraryDir, docId);
  if (!fs.existsSync(dir) || fs.existsSync(path.join(dir, "report.md"))) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

/**
 * What a run writes into a document's directory. A new document writes its
 * own report; a follow-up (`warm`) on a document the user selected threads
 * beside its report if it has one, and writes the first report if the
 * document is still unfinished (an ask while its plan was parked). Decided by
 * what the caller KNOWS — never by probing the disk for a new document, so no
 * collision can turn a new document into a follow-up.
 */
export function runDirMode(warm: boolean, settled: boolean): "start" | "thread" {
  return warm && settled ? "thread" : "start";
}
