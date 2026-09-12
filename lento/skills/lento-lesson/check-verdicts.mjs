#!/usr/bin/env node
// Validate an adversarial verifier's RESPONSE against the worklist it answered.
//
// check-lesson.mjs enforces that a claim carries a citation. This enforces that a
// claim's CONFIRMATION is true to its source: no [FACT] may be earned by a model's
// assertion alone (see docs/superpowers/specs/2026-08-17-agent-facing-injection-
// threat-model.md §A4). An injected instruction can make a model WRITE "CONFIRMED";
// it cannot manufacture a quote that exists on disk, and that asymmetry is the whole
// boundary. Zero-dep, like its sibling checkers.
//
//   node check-verdicts.mjs <worklist.json> <verdicts.json> [--root <dir>] [--require-all-confirmed]
import { readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

const VERDICTS = ["CONFIRMED", "UNSUPPORTED", "WRONG-MARK", "NO-SUCH-SOURCE"];

const WINDOW = 3; // lines either side of the cited line — tolerates code drift,
                  // while still catching a claim that cites line 33 and quotes line 900.

const MIN_QUOTE_LEN = 8; // a blank or near-blank quote is a substring of everything —
                          // `"".includes("")` and `"}"` are both nearly free to satisfy,
                          // so this is what actually forces the quote to name real text.

const norm = (s) => s.replace(/\s+/g, " ").trim();

/**
 * A citation definition -> {file, line}; anything unlocatable -> null.
 *
 * SKILL.md's skeleton teaches `[NN] <what> -> <file path or source>`, so the
 * definition text `verify-claims.mjs` hands us usually carries a human-readable
 * label in front of the locator — and that label PRINTS on the paper next to the
 * citation, which is why it is kept in the worklist rather than parsed away at
 * extraction time. Locating the file is this checker's job: take everything after
 * the last arrow (`->`, or the `→` glyph the skill's safe set also blesses) as the
 * locator, then apply the `file:line` match. A bare `path:line` still works, so
 * both the taught form and the terse form resolve to the same {file, line}.
 */
function parseSource(src) {
  let text = String(src ?? "").trim();
  const arrow = Math.max(text.lastIndexOf("->"), text.lastIndexOf("→"));
  if (arrow !== -1) text = text.slice(arrow + (text[arrow] === "→" ? 1 : 2)).trim();
  const m = /^(.*):(\d+)$/.exec(text);
  return m ? { file: m[1], line: Number(m[2]) } : null;
}

/**
 * Realpath the target under an ALREADY-REALPATHED root, then require containment.
 * Resolving the TARGET (not string-prefix matching the input) is what defeats a
 * symlink inside the root pointing out of it — same technique as upload_image's
 * resolveConfinedPath. The root is resolved once, up front (see resolveRoot), so a
 * bad `--root` reports itself instead of masquerading as a missing evidence file.
 */
function confinedPath(file, realRoot) {
  const real = realpathSync(resolve(realRoot, file));
  return real === realRoot || real.startsWith(realRoot + sep) ? real : null;
}

/** Resolve --root up front; a directory we cannot open is its own failure, not the file's. */
function resolveRoot(root) {
  let real;
  try { real = realpathSync(root); }
  catch (e) { console.error(`source root could not be resolved: ${root} (${e.code ?? e.message}) — pass --root <dir> pointing at the directory citations are relative to`); process.exit(1); }
  if (!statSync(real).isDirectory()) {
    console.error(`source root is not a directory: ${root} — pass --root <dir> pointing at the directory citations are relative to`);
    process.exit(1);
  }
  return real;
}

/** Does the quote occur, whitespace-normalized, within ±WINDOW lines of `line`? */
function quoteAt(realFile, line, quote) {
  const lines = readFileSync(realFile, "utf8").split("\n");
  const start = Math.max(0, line - 1 - WINDOW);
  const end = Math.min(lines.length, line + WINDOW);
  return norm(lines.slice(start, end).join(" ")).includes(norm(quote));
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { console.error(`could not read ${path}: ${e.message}`); process.exit(1); }
}

function main() {
  const args = process.argv.slice(2);
  const requireAll = args.includes("--require-all-confirmed");
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") { i++; continue; }
    if (args[i].startsWith("--")) continue;
    positional.push(args[i]);
  }
  const rootIdx = args.indexOf("--root");
  if (rootIdx !== -1 && (args[rootIdx + 1] === undefined || args[rootIdx + 1].startsWith("--"))) {
    console.error("--root requires a directory argument");
    process.exit(1);
  }
  const [worklistPath, verdictsPath] = positional;
  if (!worklistPath || !verdictsPath) {
    console.error("usage: check-verdicts.mjs <worklist.json> <verdicts.json> [--root <dir>] [--require-all-confirmed]");
    process.exit(1);
  }
  const root = resolveRoot(rootIdx !== -1 ? args[rootIdx + 1] : process.cwd());

  const worklist = readJson(worklistPath);
  const response = readJson(verdictsPath);
  const claims = Array.isArray(worklist.claims) ? worklist.claims : [];
  const verdicts = Array.isArray(response.verdicts) ? response.verdicts : [];
  const errors = [];

  // 1. completeness, no invention, no duplicates. A dropped claim is the quiet
  //    failure this catches: silently reviewing 9 of 10 claims still exits 0
  //    everywhere else in the pipeline.
  //    The verdicts file is entirely model-authored JSON, so a malformed entry is
  //    the likeliest bad input there is: report it as a checker error rather than
  //    letting `v.id` throw and abort the report for every other claim.
  const byId = new Map();
  for (const v of verdicts) {
    if (!v || typeof v !== "object" || typeof v.id !== "string") {
      errors.push(`malformed verdict entry — expected an object with a string id, got ${JSON.stringify(v) ?? String(v)}`);
      continue;
    }
    if (byId.has(v.id)) errors.push(`duplicate verdict for claim: ${v.id}`);
    byId.set(v.id, v);
  }
  const claimIds = new Set(claims.map((c) => c.id));
  for (const id of claimIds) if (!byId.has(id)) errors.push(`claim never reviewed: ${id}`);
  for (const id of byId.keys()) if (!claimIds.has(id)) errors.push(`verdict for unknown claim id: ${id}`);

  const notConfirmed = [];
  for (const claim of claims) {
    const v = byId.get(claim.id);
    if (!v) continue;

    // 2. closed enum — a verdict outside the four is not a judgement we accept.
    if (!VERDICTS.includes(v.verdict)) {
      errors.push(`${claim.id}: unrecognized verdict ${JSON.stringify(v.verdict)} — use one of ${VERDICTS.join(", ")}`);
      continue;
    }
    if (v.verdict !== "CONFIRMED") { notConfirmed.push(`${claim.id} ${v.verdict}`); continue; }

    // 3. evidence is required exactly when the verdict is CONFIRMED.
    const ev = v.evidence;
    if (!ev || typeof ev.file !== "string" || typeof ev.quote !== "string" || !Number.isInteger(ev.line)) {
      errors.push(`${claim.id}: CONFIRMED without complete evidence {file, line, quote}`);
      continue;
    }
    if (norm(ev.quote).length < MIN_QUOTE_LEN) {
      errors.push(`${claim.id}: CONFIRMED evidence quote is too short to be checkable (need ≥${MIN_QUOTE_LEN} characters after whitespace normalization) — quote more of the surrounding passage`);
      continue;
    }

    // 4. EVERY ONE of the claim's OWN citations must be a locatable file:line — not
    //    just one. A citation the checker cannot open is not checkable (§A4.5), and
    //    letting a single good citation carry an unlocatable sibling would quietly
    //    defeat that: the sibling prints beside the same [FACT], looking equally
    //    verified, and nothing ever opens it. A ref with no entry in `sources` at
    //    all (a [NN] used but never defined) counts as unlocatable too, not skipped.
    // `claims` and `verdicts` are already shape-guarded above; `citations` is the
    // last nested array taken on trust. A truncated or hand-edited worklist reaches
    // here (SKILL.md has the author write one to /tmp), and an uncaught TypeError
    // would abort the whole run with a stack trace instead of reporting the claims
    // it could still check — the same failure already fixed for EISDIR and for a
    // malformed verdict entry.
    const refs = Array.isArray(claim.citations) ? claim.citations : [];
    if (!Array.isArray(claim.citations) && claim.citations !== undefined) {
      errors.push(`${claim.id}: "citations" is not an array — the worklist is malformed; regenerate it with verify-claims.mjs`);
      continue;
    }
    if (!refs.length) {
      errors.push(`${claim.id}: cites no sources at all — a marked claim needs at least one citation in "<what> -> <path>:<line>" form before it can be mechanically confirmed`);
      continue;
    }
    const parsedRefs = refs.map((ref) => {
      const def = (worklist.sources ?? {})[ref];
      return { ref, def, loc: def === undefined ? null : parseSource(def) };
    });
    const bad = parsedRefs.filter((p) => !p.loc);
    if (bad.length) {
      const named = bad
        .map((p) => `[${p.ref}] ${p.def === undefined ? "(no [" + p.ref + "] definition in sources)" : JSON.stringify(p.def)}`)
        .join(", ");
      errors.push(
        `${claim.id}: citation(s) ${named} do not resolve to a file:line — a citation nothing can open cannot back a [FACT]. ` +
        `Adjudicate each one on its own: retain the source and cite it as "<what> -> <path>:<line>", drop the citation, or downgrade the claim's mark.`
      );
      continue;
    }
    const locatable = parsedRefs.map((p) => p.loc);

    // 5. Evidence must answer the claim's own source, not some other file the
    //    verifier preferred — otherwise "confirm this using X" is a free move.
    if (!locatable.some((p) => p.file === ev.file && p.line === ev.line)) {
      errors.push(`${claim.id}: evidence cites ${ev.file}:${ev.line}, which is not among the claim's own citations (${locatable.map((p) => `${p.file}:${p.line}`).join(", ")})`);
      continue;
    }

    // 6. Confinement. The root was resolved before the loop, so anything that
    //    throws here is the evidence path itself — the message can say so.
    let real;
    try { real = confinedPath(ev.file, root); }
    catch { errors.push(`${claim.id}: evidence file not found under the source root: ${ev.file}`); continue; }
    if (!real) { errors.push(`${claim.id}: evidence file escapes the source root: ${ev.file}`); continue; }

    // 7. THE rule: the quote must exist where cited. quoteAt's readFileSync is
    //    contained here too — a citation pointing at a directory (EISDIR) inside
    //    the root must fail closed as a normal checker error for THIS claim, not
    //    as an uncaught throw that aborts the run and leaves later claims unreported.
    let found;
    try { found = quoteAt(real, ev.line, ev.quote); }
    catch (e) { errors.push(`${claim.id}: could not read evidence at ${ev.file}:${ev.line}: ${e.message}`); continue; }
    if (!found) {
      errors.push(`${claim.id}: quote not found at ${ev.file}:${ev.line} (±${WINDOW} lines) — ${JSON.stringify(ev.quote.slice(0, 50))}`);
    }
  }

  report(errors, claims, notConfirmed, requireAll);
}

function report(errors, claims, notConfirmed, requireAll) {
  if (errors.length) {
    console.error("VERDICT CHECK FAILED:\n- " + errors.join("\n- "));
    process.exit(1);
  }
  if (notConfirmed.length) {
    // Not an error: a well-formed response reporting a failed review. The claim
    // gets fixed, downgraded, or cut — it just may not print as [FACT].
    console.error(`${notConfirmed.length} claim(s) NOT confirmed — these may not print as [FACT]:\n- ` + notConfirmed.join("\n- "));
    if (requireAll) process.exit(1);
  }
  console.log(`verdicts OK: ${claims.length} claim(s) reviewed, ${claims.length - notConfirmed.length} confirmed against source.`);
}

main();
