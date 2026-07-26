#!/usr/bin/env node
// Pre-print gate for a Lento LESSON PrintDoc. Runs ALONGSIDE check-doc.mjs
// (which validates PrintDoc structure); this adds the lesson-specific rules:
//   1. glyph-safety — no characters outside the verified-safe set (they print as tofu)
//   2. skeleton     — required lesson sections are present
//   3. citations    — every [✓] verified claim references a citation that is also defined
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
  ..."✓✗☐☑",                  // checks + boxes (fallback)
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
    for (const r of block.runs) if (r && typeof r.text === "string") out.push(r.text);
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

  // 3. citations — DOC-LEVEL gate (not per-[✓]-line binding): if any [✓] exists there must be at
  //    least one [NN] marker, and every referenced [NN] must be defined as a "[NN] text" line. It
  //    catches dangling refs + a wholly-uncited doc; binding each [✓] line to its own citation is a
  //    filed follow-up (see SKILLS-BACKLOG.md). Note a definition line "[NN] ..." also counts as a ref.
  const hasVerified = all.includes("[✓]");
  const refs = [...all.matchAll(/\[(\d{1,3}[a-z]?)\]/g)].map((m) => m[1]);
  const defined = new Set([...all.matchAll(/^\s*\[(\d{1,3}[a-z]?)\]\s+\S/gm)].map((m) => m[1]));
  const undefinedRefs = [...new Set(refs)].filter((r) => !defined.has(r));
  if (hasVerified && refs.length === 0) errors.push("a [✓] verified line carries no citation marker like [01] — every verified claim must cite its source.");
  if (undefinedRefs.length) errors.push(`citation(s) referenced but never defined: ${undefinedRefs.map((r) => `[${r}]`).join(", ")}.`);

  if (errors.length) {
    console.error("LESSON CHECK FAILED:\n- " + errors.join("\n- "));
    process.exit(1);
  }
  console.log("lesson OK: glyphs safe, skeleton present, citations resolved.");
}

main();
