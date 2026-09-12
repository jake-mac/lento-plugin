#!/usr/bin/env node
// Extract a review worklist of marked claims + their citations from a lesson
// PrintDoc (or a Codex markdown file via --codex). The output feeds the
// adversarial verification pass — a human/agent confirms each [FACT] against its
// cited source. Extraction only; makes no judgement. Zero-dep, like check-lesson.mjs.
import { readFileSync } from "node:fs";
const refRe = /\[(\d{1,3}[a-z]?)\]/g;
const defRe = /\[(\d{1,3}[a-z]?)\][ \t]+/g;

// BREAK is a section boundary, not text. A label governs the claims after it until the
// next label or the next break, so the extractor has to see container/non-text edges
// the same way check-lesson.mjs does — otherwise one tool sections a lesson differently
// from the other, which is exactly how this pair has drifted before.
const BREAK = "\u0000";
function textFromDoc(doc, out) {
  if (!doc || typeof doc !== "object") return;
  if (doc.type === "text" && Array.isArray(doc.runs))
    out.push(doc.runs.map((r) => (r && typeof r.text === "string" ? r.text : "")).join(""));
  if (Array.isArray(doc.children)) {
    out.push(BREAK);
    for (const c of doc.children) textFromDoc(c, out);
    out.push(BREAK);
  } else if (doc.type !== "text") {
    out.push(BREAK);
  }
}

// Resolve each [NN] to the source text of its definition line ("[01] file.ts:33").
// Definition lines carry no mark (skeleton item 7 puts them on their own line), and
// skipping both the label line and the claim beneath it is what keeps a mid-claim
// citation from being misread as a definition of that [NN].
// Several definitions may share one line, separated by "·", as the good fixture does.
function sourcesFrom(lines, consumed, BREAK) {
  const sources = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === BREAK) continue;
    // Skip EXACTLY the lines the claim scan consumed — labels, claims, fenced code.
    // Re-deriving that here from a second copy of the boundary rules is what let the
    // two disagree: on the PrintDoc path the markdown list rule closed the section on
    // the first claim, so a mid-claim "[01]" was read as a DEFINITION and silently
    // overwrote the real source with a fragment of prose.
    if (consumed.has(i)) continue;
    const hits = [...line.matchAll(defRe)];
    for (let h = 0; h < hits.length; h++) {
      const startAt = hits[h].index + hits[h][0].length;
      const endAt = h + 1 < hits.length ? hits[h + 1].index : line.length;
      const text = line.slice(startAt, endAt).replace(/\s*[·|,;]+\s*$/, "").trim();
      if (text) sources[hits[h][1]] = text;
    }
  }
  return sources;
}

function main() {
  const args = process.argv.slice(2);
  const codexIdx = args.indexOf("--codex");
  const isCodex = codexIdx !== -1;
  let lines = [];
  if (codexIdx !== -1) {
    lines = readFileSync(args[codexIdx + 1], "utf8").split("\n");
  } else {
    const parsed = JSON.parse(readFileSync(args[0], "utf8"));
    const doc = parsed && parsed.document ? parsed.document : parsed;
    const out = []; textFromDoc(doc.content, out); lines = out.join("\n").split("\n");
  }

  // One rule, two surfaces. In a lesson PrintDoc the mark is a bold label ALONE on its
  // line and the claim is the line below (stacked). In the Codex — plain markdown, where
  // there is no bold-run styling to read — the same word may sit inline at the start of
  // the claim's own line, optionally wrapped in ** or [ ]. Both forms resolve here, so
  // the two surfaces never need separate extractors to drift apart.
  // The optional leading list marker matters: the Codex writes its claims as markdown
  // bullets / numbered steps, so the label sits after "- " or "3. ", not at column 0.
  // Without it every Codex claim extracts as zero claims — and a worklist that is
  // silently empty passes any downstream "all confirmed" check vacuously.
  const markOf = (line) => {
    // The trailing lookahead is load-bearing: without it the word matches as a PREFIX,
    // so a claim opening "HISTORY-mode dithering shipped..." reads as a HISTORY label,
    // closes the section it sits in, and every later claim in that stack is dropped —
    // silently, with check-lesson.mjs still passing. check-lesson.mjs requires a space
    // after the word for the same reason; the two must agree on what a mark is.
    const m = /^\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:\*\*|\[)?(FACT|CONTESTED|EMERGING|HISTORY)(?![A-Za-z0-9_-])(?:\*\*|\])?\s*(.*)$/.exec(line);
    return m ? { mark: m[1], rest: m[2] } : null;
  };

  const claims = [];
  let section = null; // the label currently in force, or null outside a section
  let inFence = false; // inside a ``` block: not claims, and NOT a section boundary
  const push = (mark, body) => {
    const citations = [...body.matchAll(refRe)].map((m) => m[1]);
    const text = body.replace(refRe, "").replace(/\s+/g, " ").trim();
    if (text || citations.length) claims.push({ id: `c${String(claims.length + 1).padStart(2, "0")}`, mark, text, citations });
  };

  // What ends a section differs by surface, and it has to, because the surfaces carry
  // structure differently. A PrintDoc has real containers, so a BREAK closes the
  // section — grouping is declared by the stack the label heads. Markdown has none, so
  // a bare label would otherwise govern every remaining line to end-of-file (it did:
  // 47 lines of headings and prose). There a section holds LIST ITEMS, which is how the
  // Codex writes claims, and the first non-list line closes it.
  const isListItem = (l) => /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(l);
  // An INDENTED line continues the list item above it — a wrapped claim, or a
  // parenthetical under a numbered step. It is neither a new claim nor a boundary.
  // Treating it as a boundary silently truncated a section mid-list and dropped
  // every claim after it (7 of 23), with no error anywhere: the worklist just got
  // shorter, which is the quiet failure this whole gate exists to prevent.
  const continuesList = (l) => /^\s+\S/.test(l);
  const consumed = new Set(); // line indices the claim scan took (labels + claims)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === BREAK) { section = null; inFence = false; continue; }
    const line = raw;
    if (isCodex && /^\s*(?:```|~~~)/.test(line)) { inFence = !inFence; consumed.add(i); continue; }
    if (inFence) { consumed.add(i); continue; }
    if (!line.trim()) continue;
    if (isCodex && section && !isListItem(line) && !continuesList(line) && !markOf(line)) { section = null; continue; }
    if (isCodex && section && continuesList(line) && !isListItem(line)) continue;
    const hit = markOf(line);
    if (hit) {
      // Inline ("FACT the thing [01]") is one claim on its own; a bare label opens a
      // SECTION and governs the claims beneath it until the next label or break.
      consumed.add(i);
      if (hit.rest.trim()) { section = null; push(hit.mark, hit.rest.trim()); }
      else section = hit.mark;
      continue;
    }
    if (section) { consumed.add(i); push(section, line.trim()); }
  }

  process.stdout.write(JSON.stringify({ claims, sources: sourcesFrom(lines, consumed, BREAK) }, null, 2) + "\n");
}
main();
