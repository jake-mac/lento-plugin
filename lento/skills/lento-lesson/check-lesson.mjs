#!/usr/bin/env node
// Pre-print gate for a Lento LESSON PrintDoc. Runs ALONGSIDE check-doc.mjs
// (which validates PrintDoc structure); this adds the lesson-specific rules:
//   1. glyph-safety — no characters outside the verified-safe set (they print as tofu)
//   2. skeleton     — required lesson sections are present
//   3. marks        — every [✓]/[⚖]/[~]/[H] marked claim carries a [NN] citation on its own line,
//                      every referenced [NN] is defined, and no unrecognized pseudo-mark (e.g. [OK]) is used
// Exit 1 on any hard failure, else 0.
//   node check-lesson.mjs lesson.json        # {printer_id, document} tool args, or a bare PrintDoc
//   cat lesson.json | node check-lesson.mjs
import { readFileSync } from "node:fs";

// Curated safe set (Option 1) — printable ASCII plus non-ASCII glyphs confirmed to render.
// Per PR #97's DejaVu glyph fallback (documented in packages/thermal-core/AGENTS.md), arrows,
// box-drawing, checkboxes, and geometric bullets/stars now render instead of tofu on the wired
// MCP print path. This is a hand-maintained whitelist: re-run `pnpm glyph-probe <host>` and update
// this ONE constant if the fallback font ever changes. Anything not listed is rejected as unconfirmed.
const SAFE_NONASCII = new Set([
  ..."·—–…“”‘’",              // punctuation (Public Sans native)
  ..."✓✗☐☑⚖",                 // checks + boxes, + the contested mark ⚖ (fallback)
  ..."→←↑↓",                  // arrows (fallback)
  ..."─│┌┐└┘├┤┬┴┼",           // box-drawing (mono fallback — for diagrams)
  ..."•◦▪▸★",                 // bullets + star (fallback)
]);
const isSafe = (ch) => {
  const c = ch.codePointAt(0);
  return c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126) || SAFE_NONASCII.has(ch);
};

function collectText(block, out) {
  if (!block || typeof block !== "object") return;
  if (block.type === "text" && Array.isArray(block.runs)) {
    // One text block is ONE line — its runs are styled spans of the same line, not
    // separate lines. Pushing each run separately would make the mark and its [NN]
    // land on different "lines" the moment an author bolds the citation, failing the
    // per-line citation rule on a lesson that visibly carries it. verify-claims.mjs
    // joins runs the same way; the two must agree on what a line is.
    out.push(block.runs.map((r) => (r && typeof r.text === "string" ? r.text : "")).join(""));
  }
  if (Array.isArray(block.children)) for (const c of block.children) collectText(c, out);
  if (block.type === "table" && Array.isArray(block.rows)) {
    for (const row of block.rows) if (Array.isArray(row)) for (const cell of row) if (typeof cell === "string") out.push(cell);
  }
  if (block.type === "grid" && Array.isArray(block.cells)) {
    for (const cell of block.cells) if (cell && typeof cell.text === "string") out.push(cell.text);
  }
}

function main() {
  const arg = process.argv[2];
  let raw;
  try { raw = arg ? readFileSync(arg, "utf8") : readFileSync(0, "utf8"); }
  catch (e) { console.error("could not read input:", e.message); process.exit(1); }

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { console.error("input is not valid JSON:", e.message); process.exit(1); }

  const doc = parsed && parsed.document ? parsed.document : parsed;
  if (!doc || doc.version !== 1 || !doc.content) {
    console.error("not a PrintDoc ({version:1, page, content}) — run check-doc.mjs first");
    process.exit(1);
  }

  const texts = [];
  collectText(doc.content, texts);
  const all = texts.join("\n");
  const errors = [];

  // 1. glyph-safety
  const bad = new Map();
  for (const ch of all) if (!isSafe(ch)) bad.set(ch, (bad.get(ch) ?? 0) + 1);
  if (bad.size) {
    const list = [...bad].map(([c, n]) => `${JSON.stringify(c)} (U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")})×${n}`).join(", ");
    errors.push(`glyph(s) not in the confirmed-safe set (may print as tofu): ${list} — if your printer renders it, add it to SAFE_NONASCII after confirming with "pnpm glyph-probe".`);
  }

  // 2. skeleton
  if (!/LESSON\s+\d+/i.test(all)) errors.push('missing masthead — expected a "LESSON <n>" line.');
  if (!/tomorrow/i.test(all)) errors.push('missing the "Tomorrow ->" teaser (progression).');
  if (!/\btone:/i.test(all)) errors.push('missing the profile footer ("tone: ... level: ... goal: ...").');

  // 3. marks + citations — every line bearing a mark must carry a [NN] token
  //    on that line, and every referenced [NN] must be defined as "[NN] text".
  const MARKS = ["[✓]", "[⚖]", "[~]", "[H]"];
  const lines = all.split("\n");
  const refRe = /\[(\d{1,3}[a-z]?)\]/g;
  const defined = new Set([...all.matchAll(/(?:^|\s)\[(\d{1,3}[a-z]?)\][ \t]+\S/g)].map((m) => m[1]));
  const allRefs = [...all.matchAll(refRe)].map((m) => m[1]);
  const undefinedRefs = [...new Set(allRefs)].filter((r) => !defined.has(r));
  for (const line of lines) {
    if (!MARKS.some((mk) => line.includes(mk))) continue;
    if (!refRe.test(line)) { refRe.lastIndex = 0;
      errors.push(`a marked claim carries no [NN] citation: ${JSON.stringify(line.trim().slice(0, 60))}`);
    }
    refRe.lastIndex = 0;
  }
  if (undefinedRefs.length) errors.push(`citation(s) referenced but never defined: ${undefinedRefs.map((r) => `[${r}]`).join(", ")}.`);
  // reject unrecognized pseudo-marks that look like a mark but aren't one of the four
  const pseudo = [...all.matchAll(/\[(OK|verified|fact|\?|!|x|X)\]/g)].map((m) => m[0]);
  if (pseudo.length) errors.push(`unrecognized mark(s) — use exactly [✓]/[⚖]/[~]/[H]: ${[...new Set(pseudo)].join(", ")}`);

  if (errors.length) {
    console.error("LESSON CHECK FAILED:\n- " + errors.join("\n- "));
    process.exit(1);
  }
  console.log("lesson OK: glyphs safe, skeleton present, marks + citations resolved.");
}

main();
