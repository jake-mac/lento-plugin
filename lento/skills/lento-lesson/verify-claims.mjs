#!/usr/bin/env node
// Extract a review worklist of marked claims + their citations from a lesson
// PrintDoc (or a Codex markdown file via --codex). The output feeds the
// adversarial verification pass — a human/agent confirms each [✓] against its
// cited source. Extraction only; makes no judgement. Zero-dep, like check-lesson.mjs.
import { readFileSync } from "node:fs";
const MARKS = ["[✓]", "[⚖]", "[~]", "[H]"];
const refRe = /\[(\d{1,3}[a-z]?)\]/g;

function textFromDoc(doc, out) {
  if (!doc || typeof doc !== "object") return;
  if (doc.type === "text" && Array.isArray(doc.runs))
    out.push(doc.runs.map((r) => (r && typeof r.text === "string" ? r.text : "")).join(""));
  if (Array.isArray(doc.children)) for (const c of doc.children) textFromDoc(c, out);
}

function main() {
  const args = process.argv.slice(2);
  const codexIdx = args.indexOf("--codex");
  let lines = [];
  if (codexIdx !== -1) {
    lines = readFileSync(args[codexIdx + 1], "utf8").split("\n");
  } else {
    const parsed = JSON.parse(readFileSync(args[0], "utf8"));
    const doc = parsed && parsed.document ? parsed.document : parsed;
    const out = []; textFromDoc(doc.content, out); lines = out.join("\n").split("\n");
  }
  const claims = [];
  for (const line of lines) {
    const mk = MARKS.find((m) => line.includes(m));
    if (!mk) continue;
    // a definition line ("[01] text") is not a claim
    if (/^\s*\[(\d{1,3}[a-z]?)\]\s+\S/.test(line) && !MARKS.some((m) => line.trimStart().startsWith(m))) continue;
    const citations = [...line.matchAll(refRe)].map((m) => m[1]);
    const text = line.replace(mk, "").replace(refRe, "").replace(/\s+/g, " ").trim();
    claims.push({ mark: mk, text, citations });
  }
  process.stdout.write(JSON.stringify({ claims }, null, 2) + "\n");
}
main();
