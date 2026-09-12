#!/usr/bin/env node
// Pre-print gate for a Lento LESSON PrintDoc. Runs ALONGSIDE check-doc.mjs
// (which validates PrintDoc structure); this adds the lesson-specific rules:
//   1. glyph-safety — no characters outside the verified-safe set (they print as tofu)
//   2. skeleton     — required lesson sections are present
//   3. marks        — every [FACT]/[CONTESTED]/[EMERGING]/[HISTORY] marked claim carries a [NN]
//                      citation on its own line, every referenced [NN] is defined, and no
//                      unrecognized pseudo-mark (e.g. [OK], or a legacy glyph mark) is used
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
  ..."✓✗☐☑⚖",                 // checks + boxes + scales (fallback). NOT mark vocabulary any
                              // more — the marks are text labels — but still safe to use in prose.
  ..."→←↑↓",                  // arrows (fallback)
  ..."─│┌┐└┘├┤┬┴┼",           // box-drawing (mono fallback — for diagrams)
  ..."•◦▪▸★",                 // bullets + star (fallback)
]);
const isSafe = (ch) => {
  const c = ch.codePointAt(0);
  return c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126) || SAFE_NONASCII.has(ch);
};

function collectLines(block, out) {
  if (!block || typeof block !== "object") return;
  if (block.type === "text" && Array.isArray(block.runs)) {
    // One text block is ONE line — its runs are styled spans of the same line, not
    // separate lines. Pushing each run separately would make the mark and its [NN]
    // land on different "lines" the moment an author bolds the citation, failing the
    // per-line citation rule on a lesson that visibly carries it. verify-claims.mjs
    // joins runs the same way; the two must agree on what a line is.
    //
    // The RUNS are kept, not just the joined text: a mark is now a *formatted* label
    // (a bold line above its claim), so the gate has to see styling, not only
    // characters. A flattened-text checker cannot tell "FACT" the label from "FACT"
    // the word.
    const runs = block.runs.filter((r) => r && typeof r.text === "string");
    out.push({ text: runs.map((r) => r.text).join(""), runs });
  }
  // A container emits a BREAK on each side of its children, and any non-text block
  // (rule, spacer, flow, image) emits one too. That is what scopes a section label:
  // a label governs the claims that follow it until the next label or the next break,
  // so grouping is structural — the author puts a label and its claims in one stack —
  // rather than guessed from how far apart lines happen to be.
  if (Array.isArray(block.children)) {
    out.push({ brk: true });
    for (const c of block.children) collectLines(c, out);
    out.push({ brk: true });
  } else if (block.type !== "text") {
    out.push({ brk: true });
  }
  // Table/grid cells are plain strings — no runs, so they can never carry a mark.
  if (block.type === "table" && Array.isArray(block.rows)) {
    for (const row of block.rows) if (Array.isArray(row)) for (const cell of row) if (typeof cell === "string") out.push({ text: cell, runs: [] });
  }
  if (block.type === "grid" && Array.isArray(block.cells)) {
    for (const cell of block.cells) if (cell && typeof cell.text === "string") out.push({ text: cell.text, runs: [] });
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

  const lines = [];
  collectLines(doc.content, lines);
  const all = lines.filter((l) => !l.brk).map((l) => l.text).join("\n");
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

  // 3. marks + citations.
  //
  // A mark is a FORMATTED LABEL, not a token in the prose: a **bold** line whose whole
  // text is one of the four words, stacked directly above the claim it marks. The claim
  // and its [NN] citation live on the FOLLOWING line.
  //
  //     FACT                                   <- bold, alone on its line
  //     The default resolution is 203 dpi. [03]
  //
  // Two earlier forms are dead and are rejected with migration messages rather than a
  // generic error, because each shipped and each has content written against it:
  //   - glyph marks [✓]/[⚖]/[~]/[H] — dropped 2026-08-19; at body size (~24 dots at
  //     203 dpi) their thin interior strokes alias, and a pictograph substitute printed
  //     no better (both tested on paper).
  //   - bracketed words [FACT] — the brief intermediate form; a bracket is not a label.
  const MARK_WORDS = ["FACT", "CONTESTED", "EMERGING", "HISTORY"];
  const refRe = /\[(\d{1,3}[a-z]?)\]/g;
  const hasRef = (t) => { refRe.lastIndex = 0; const r = refRe.test(t); refRe.lastIndex = 0; return r; };

  const defined = new Set([...all.matchAll(/(?:^|\s)\[(\d{1,3}[a-z]?)\][ \t]+\S/g)].map((m) => m[1]));
  const allRefs = [...all.matchAll(refRe)].map((m) => m[1]);
  const undefinedRefs = [...new Set(allRefs)].filter((r) => !defined.has(r));
  if (undefinedRefs.length) errors.push(`citation(s) referenced but never defined: ${undefinedRefs.map((r) => `[${r}]`).join(", ")}.`);

  let markCount = 0, claimCount = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.brk) continue;
    const t = line.text.trim();

    // A line that merely STARTS with a mark word is the old inline form. Catch it
    // explicitly, or it is silently ignored and only surfaces as the confusing
    // "no marked claims at all".
    const inline = MARK_WORDS.find((w) => t.startsWith(w + " "));
    if (inline) {
      errors.push(`${inline} label is inline — put it bold on its OWN line, heading the claims below it: ${JSON.stringify(t.slice(0, 60))}`);
      continue;
    }
    // A table/grid cell has no runs, so it cannot carry the bold styling a label
    // needs — counting it as a mark only produced a confusing "not bold" error.
    if (!MARK_WORDS.includes(t) || !line.runs.length) continue;
    markCount++;

    // It must actually be bold — that is the whole point of "a formatted label".
    // Whitespace-only runs are ignored so trailing spacing doesn't fail it.
    const inked = line.runs.filter((r) => r.text.trim() !== "");
    if (!inked.length || !inked.every((r) => r.bold === true)) {
      errors.push(`the ${t} label is not bold — a mark is a formatted label, so its run needs "bold": true.`);
    }

    // A label heads a SECTION: it governs every claim line after it until the next
    // label or the next break. One label over six claims, not six labels. Each claim
    // still carries its OWN [NN] — the mark is shared, the citation never is.
    let n = 0;
    for (let j = i + 1; j < lines.length; j++) {
      const nxt = lines[j];
      if (nxt.brk) break;
      const nt = nxt.text.trim();
      if (!nt) continue;
      if (MARK_WORDS.includes(nt) || MARK_WORDS.some((w) => nt.startsWith(w + " "))) break;
      n++; claimCount++;
      if (!hasRef(nt)) {
        errors.push(`a ${t} claim carries no [NN] citation: ${JSON.stringify(nt.slice(0, 60))}`);
      }
    }
    if (!n) errors.push(`the ${t} label heads no claims — put its claim line(s) directly after it, inside the same stack.`);
  }

  // A lesson with NO marked claims must fail, not pass. Every other rule here is
  // conditional on a mark being present, so a doc that simply omits them satisfies
  // all of them vacuously — and dropping the marks is the stronger form of the
  // [OK]-substitution dodge this gate exists to stop (the no-skill baseline did
  // exactly that). Absent input is its own failure class, not a mild version of
  // wrong input.
  if (!markCount || !claimCount) {
    errors.push(`no marked claims at all — a lesson must state what it teaches under a bold ${MARK_WORDS.join("/")} section label, each claim carrying its own [NN] citation.`);
  }

  const legacyGlyph = ["[✓]", "[⚖]", "[~]", "[H]"].filter((m) => all.includes(m));
  if (legacyGlyph.length) {
    errors.push(`legacy glyph mark(s) ${legacyGlyph.join(", ")} — marks are now a bold ${MARK_WORDS.join("/")} label on its own line.`);
  }
  const legacyBracket = MARK_WORDS.map((w) => `[${w}]`).filter((m) => all.includes(m));
  if (legacyBracket.length) {
    errors.push(`bracketed mark(s) ${legacyBracket.join(", ")} — drop the brackets: the mark is a bold label on its own line, not a token in the text.`);
  }
  // Reject a bracketed token that is a MARK ATTEMPT — a case-variant of one of the
  // four words, or the known `[OK]` substitute the no-skill baseline produced. This
  // is deliberately narrow. The previous rule flagged any bracketed alphanumeric
  // token, which rejected ordinary prose a lesson about code has every reason to
  // contain: `children[i]`, `prints as [x]`, and — worst — `[NN]`, the citation
  // placeholder SKILL.md itself teaches. A lesson explaining the citation system
  // could not print. A novel wrong label like `[SETTLED]` slips through this
  // narrower rule, but it cannot pass the gate: with no real label anywhere, the
  // "no marked claims at all" check above fires. That guard is the backstop; this
  // one only has to give a BETTER message for the near-misses.
  const attempts = [...all.matchAll(/\[([A-Za-z][A-Za-z]{0,14})\]/g)]
    .map((m) => m[0])
    .filter((tok) => {
      if (legacyBracket.includes(tok)) return false; // reported above, with better advice
      const word = tok.slice(1, -1);
      return word.toUpperCase() === "OK" || MARK_WORDS.includes(word.toUpperCase());
    });
  if (attempts.length) errors.push(`unrecognized mark(s) — use a bold ${MARK_WORDS.join("/")} label on its own line: ${[...new Set(attempts)].join(", ")}`);

  if (errors.length) {
    console.error("LESSON CHECK FAILED:\n- " + errors.join("\n- "));
    process.exit(1);
  }
  console.log("lesson OK: glyphs safe, skeleton present, marks + citations resolved.");
}

main();
