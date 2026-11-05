#!/usr/bin/env node
// Pre-flight checker for a `print_document` PrintDoc. It mirrors the printer's
// real `validatePrintDoc` (packages/thermal-core) so it rejects exactly what the
// printer would, and adds lint hints for the mistakes agents make most:
// flexbox align words, fraction fills, px/pt units.
//
//   node check-doc.mjs doc.json          # the `document` object (or whole tool args)
//   cat doc.json | node check-doc.mjs
//
// Exit 1 on any hard rejection, else 0.
import { readFileSync } from "node:fs";

const CAPS = { maxNodes: 2000, maxDepth: 32, maxStrLen: 50000 };
const FLOW_CAPS = { maxNodes: 40, maxEdges: 60 };
const ALIGNS = new Set(["left", "center", "right"]);
const CROSS_ALIGNS = new Set(["top", "center", "bottom"]);
const EMOJI_STYLES = new Set(["line", "silhouette", "duotone"]);
const ECC_LEVELS = new Set(["L", "M", "Q", "H"]);
const QR_FORMATS = new Set(["qr", "micro", "rmqr"]);
const MAX_SHORTCODE_LEN = 64;
const FLEX_WORDS = new Set(["start", "end", "flex-start", "flex-end", "justify", "space-between", "space-around", "center-left", "middle"]);
const lint = [];

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const checkStr = (v, p) => (typeof v !== "string" ? `${p} must be a string` : v.length > CAPS.maxStrLen ? `${p} exceeds ${CAPS.maxStrLen}-char cap` : null);

function checkEmoji(v, p) {
  if (v === undefined) return null;
  if (!isObj(v)) return `${p} must be an object`;
  if (v.shortcode !== undefined && (typeof v.shortcode !== "string" || v.shortcode.length > MAX_SHORTCODE_LEN || !/^[a-z0-9_+-]+$/i.test(v.shortcode))) return `${p}.shortcode is invalid`;
  if (v.codepoint !== undefined && (!Number.isInteger(v.codepoint) || v.codepoint < 0 || v.codepoint > 0x10ffff)) return `${p}.codepoint is out of range`;
  if (v.style !== undefined && !EMOJI_STYLES.has(v.style)) return `${p}.style is invalid`;
  if (v.shortcode === undefined && v.codepoint === undefined) return `${p} needs a shortcode or codepoint`;
  return null;
}

function checkSize(v, p) {
  if (v === undefined) return null;
  if (v === "fill" || v === "fit") return null;
  if (isObj(v)) {
    if (typeof v.fill === "number") {
      if (v.fill > 0 && v.fill <= 1) lint.push(`${p}.size.fill is ${v.fill} — fill is a PERCENT 0–100, not a fraction (did you mean ${Math.round(v.fill * 100)}?)`);
      return (!Number.isFinite(v.fill) || v.fill < 0 || v.fill > 100) ? `${p}.size.fill must be a number 0–100` : null;
    }
    if (typeof v.mm === "number") return (!Number.isFinite(v.mm) || v.mm < 0) ? `${p}.size.mm must be a non-negative number` : null;
  }
  if (typeof v === "number") return `${p}.size must be "fill" | "fit" | {fill:n} | {mm:n} — a bare number is not valid (sizes are millimetres via {mm:n})`;
  return `${p}.size must be "fill", "fit", {fill:n}, or {mm:n}`;
}

function checkBoolMatrix(v, rowsExp, colsExp, p) {
  if (!Array.isArray(v) || v.length !== rowsExp) return `${p} must be a ${rowsExp}-row array`;
  for (let r = 0; r < rowsExp; r++) { const row = v[r]; if (!Array.isArray(row) || row.length !== colsExp) return `${p}[${r}] must be a ${colsExp}-cell row`; for (let c = 0; c < colsExp; c++) if (typeof row[c] !== "boolean") return `${p}[${r}][${c}] must be a boolean`; }
  return null;
}
function checkOpening(v, rows, cols, p) {
  if (!isObj(v)) return `${p} must be an object`;
  if (!Number.isInteger(v.row) || v.row < 0 || v.row >= rows) return `${p}.row is out of range`;
  if (!Number.isInteger(v.col) || v.col < 0 || v.col >= cols) return `${p}.col is out of range`;
  if (!["N", "S", "E", "W"].includes(v.side)) return `${p}.side must be "N", "S", "E", or "W"`;
  if (v.side === "N" && v.row !== 0) return `${p} on side N must be in row 0`;
  if (v.side === "S" && v.row !== rows - 1) return `${p} on side S must be in the last row`;
  if (v.side === "W" && v.col !== 0) return `${p} on side W must be in col 0`;
  if (v.side === "E" && v.col !== cols - 1) return `${p} on side E must be in the last col`;
  return null;
}

function checkAlign(v, p) {
  if (v === undefined) return null;
  if (ALIGNS.has(v)) return null;
  if (FLEX_WORDS.has(v)) return `${p}.align is "${v}" — the printer only accepts "left" | "center" | "right" (no flexbox words). To push content to the right edge, give the LEFT sibling size:"fill" instead.`;
  return `${p}.align must be "left", "center", or "right"`;
}

function checkBlock(b, p, depth, ctr) {
  if (depth > CAPS.maxDepth) return `${p} nests past the ${CAPS.maxDepth}-level cap`;
  if (++ctr.n > CAPS.maxNodes) return `document exceeds the ${CAPS.maxNodes}-block cap`;
  if (!isObj(b)) return `${p} must be a block object`;
  const se = checkSize(b.size, p); if (se) return se;
  if (b.fallbackText !== undefined) { const e = checkStr(b.fallbackText, `${p}.fallbackText`); if (e) return e; }
  if (b.borderLeft !== undefined && typeof b.borderLeft !== "boolean") lint.push(`${p}.borderLeft is ${JSON.stringify(b.borderLeft)} — borderLeft is a boolean (a thin left rule); use type:"rule" for a dashed divider.`);
  switch (b.type) {
    case "stack": case "row": {
      if (!Array.isArray(b.children)) return `${p}.children must be an array`;
      const ae = checkAlign(b.align, p); if (ae) return ae;
      if (b.type === "row" && b.crossAlign !== undefined && !CROSS_ALIGNS.has(b.crossAlign)) {
        return `${p}.crossAlign must be one of top,center,bottom`;
      }
      for (let i = 0; i < b.children.length; i++) { const e = checkBlock(b.children[i], `${p}.children[${i}]`, depth + 1, ctr); if (e) return e; }
      return null;
    }
    case "text": {
      if (!Array.isArray(b.runs)) return `${p}.runs must be an array of {text,...} runs — a bare "text" string is not valid`;
      for (let i = 0; i < b.runs.length; i++) { if (!isObj(b.runs[i])) return `${p}.runs[${i}] must be an object`; const e = checkStr(b.runs[i].text, `${p}.runs[${i}].text`); if (e) return e; const em = checkEmoji(b.runs[i].emoji, `${p}.runs[${i}].emoji`); if (em) return em; }
      const ae = checkAlign(b.align, p); if (ae) return ae;
      return null;
    }
    case "grid": {
      if (!Number.isInteger(b.cols) || b.cols < 0 || !Number.isInteger(b.rows) || b.rows < 0) return `${p} grid needs non-negative integer cols and rows`;
      if (b.cols * b.rows > CAPS.maxNodes) return `${p} grid cols*rows exceeds the ${CAPS.maxNodes}-cell cap`;
      if (!Array.isArray(b.cells)) return `${p}.cells must be an array`;
      for (let i = 0; i < b.cells.length; i++) { if (!isObj(b.cells[i])) return `${p}.cells[${i}] must be an object`; if (b.cells[i].text !== undefined) { const e = checkStr(b.cells[i].text, `${p}.cells[${i}].text`); if (e) return e; } }
      if (b.blockSize !== undefined) { const bs = b.blockSize; if (!isObj(bs) || !Number.isInteger(bs.rows) || bs.rows < 1 || !Number.isInteger(bs.cols) || bs.cols < 1) return `${p}.blockSize must have positive integer rows and cols`; }
      if (b.maxCellSize !== undefined) { const mc = b.maxCellSize; if (!isObj(mc) || typeof mc.mm !== "number" || !Number.isFinite(mc.mm) || mc.mm <= 0) return `${p}.maxCellSize must be { mm: positive number }`; }
      if (b.cellHeight !== undefined) { const ch = b.cellHeight; if (!isObj(ch) || typeof ch.mm !== "number" || !Number.isFinite(ch.mm) || ch.mm <= 0) return `${p}.cellHeight must be { mm: positive number }`; }
      if (b.cornerText !== undefined && typeof b.cornerText !== "boolean") return `${p}.cornerText must be a boolean`;
      if (b.omitTopBorder !== undefined && typeof b.omitTopBorder !== "boolean") return `${p}.omitTopBorder must be a boolean`;
      if (b.cellTextMm !== undefined && (typeof b.cellTextMm !== "number" || !Number.isFinite(b.cellTextMm) || b.cellTextMm <= 0)) return `${p}.cellTextMm must be a positive number`;
      return null;
    }
    case "table": {
      if (!Array.isArray(b.columns)) return `${p}.columns must be an array`;
      for (let i = 0; i < b.columns.length; i++) { const e = checkStr(b.columns[i], `${p}.columns[${i}]`); if (e) return e; }
      if (!Array.isArray(b.rows)) return `${p}.rows must be an array of string[] rows`;
      for (let i = 0; i < b.rows.length; i++) { if (!Array.isArray(b.rows[i])) return `${p}.rows[${i}] must be an array`; for (let j = 0; j < b.rows[i].length; j++) { const e = checkStr(b.rows[i][j], `${p}.rows[${i}][${j}]`); if (e) return e; } }
      return null;
    }
    case "chart": {
      if (b.chartType !== "bar") return `${p}.chartType must be "bar"`;
      if (!Array.isArray(b.categories)) return `${p}.categories must be an array`;
      for (let i = 0; i < b.categories.length; i++) { const e = checkStr(b.categories[i], `${p}.categories[${i}]`); if (e) return e; }
      if (!Array.isArray(b.series)) return `${p}.series must be an array`;
      for (let i = 0; i < b.series.length; i++) {
        const s = b.series[i];
        if (!isObj(s) || !Array.isArray(s.values)) return `${p}.series[${i}] needs a values array`;
        for (const v of s.values) if (typeof v !== "number" || !Number.isFinite(v)) return `${p}.series[${i}].values must be finite numbers`;
      }
      return null;
    }
    case "image":
      if (b.reflow !== undefined && typeof b.reflow !== "boolean") return `${p}.reflow must be a boolean`;
      return checkStr(b.src, `${p}.src`);
    case "rule": return (b.style !== undefined && b.style !== "solid" && b.style !== "dashed") ? `${p}.style must be "solid" or "dashed"` : null;
    case "spacer": return null;
    case "cut": return null;
    case "flow": {
      if (!Array.isArray(b.nodes) || b.nodes.length === 0) return `${p}.nodes must be a non-empty array`;
      if (b.nodes.length > FLOW_CAPS.maxNodes) return `${p}.nodes exceed ${FLOW_CAPS.maxNodes}`;
      for (let i = 0; i < b.nodes.length; i++) { const n = b.nodes[i]; if (!isObj(n)) return `${p}.nodes[${i}] must be an object`; const eid = checkStr(n.id, `${p}.nodes[${i}].id`); if (eid) return eid; const el = checkStr(n.label, `${p}.nodes[${i}].label`); if (el) return el; }
      if (!Array.isArray(b.edges)) return `${p}.edges must be an array`;
      if (b.edges.length > FLOW_CAPS.maxEdges) return `${p}.edges exceed ${FLOW_CAPS.maxEdges}`;
      for (let i = 0; i < b.edges.length; i++) { const ed = b.edges[i]; if (!isObj(ed)) return `${p}.edges[${i}] must be an object`; const ef = checkStr(ed.from, `${p}.edges[${i}].from`); if (ef) return ef; const et = checkStr(ed.to, `${p}.edges[${i}].to`); if (et) return et; }
      if (b.direction !== undefined && b.direction !== "LR" && b.direction !== "TD") return `${p}.direction must be "LR" or "TD"`;
      return null;
    }
    case "qr": {
      const e = checkStr(b.data, `${p}.data`);
      if (e) return e;
      if (b.ecc !== undefined && !ECC_LEVELS.has(b.ecc)) return `${p}.ecc must be one of L,M,Q,H`;
      if (b.quietZone !== undefined && (!Number.isInteger(b.quietZone) || b.quietZone < 0 || b.quietZone > 16)) return `${p}.quietZone must be an integer between 0 and 16`;
      if (b.moduleMm !== undefined && (typeof b.moduleMm !== "number" || !Number.isFinite(b.moduleMm) || b.moduleMm <= 0)) return `${p}.moduleMm must be a positive finite number`;
      if (b.caption !== undefined) { const ce = checkStr(b.caption, `${p}.caption`); if (ce) return ce; }
      if (b.align !== undefined && !ALIGNS.has(b.align)) return `${p}.align is invalid`;
      if (b.format !== undefined && !QR_FORMATS.has(b.format)) return `${p}.format must be one of qr,micro,rmqr`;
      if (b.logo !== undefined && typeof b.logo !== "boolean") return `${p}.logo must be a boolean`;
      return null;
    }
    case "maze": {
      if (!Number.isInteger(b.rows) || b.rows < 1 || !Number.isInteger(b.cols) || b.cols < 1) return `${p}.rows and ${p}.cols must be positive integers`;
      if (b.rows * b.cols > CAPS.maxNodes) return `${p} maze rows*cols exceeds the ${CAPS.maxNodes}-cell cap`;
      const orErr = checkBoolMatrix(b.openRight, b.rows, b.cols - 1, `${p}.openRight`); if (orErr) return orErr;
      const odErr = checkBoolMatrix(b.openDown, b.rows - 1, b.cols, `${p}.openDown`); if (odErr) return odErr;
      const enErr = checkOpening(b.entrance, b.rows, b.cols, `${p}.entrance`); if (enErr) return enErr;
      const exErr = checkOpening(b.exit, b.rows, b.cols, `${p}.exit`); if (exErr) return exErr;
      if (b.solution !== undefined) { if (!Array.isArray(b.solution)) return `${p}.solution must be an array`; for (let i = 0; i < b.solution.length; i++) { const s = b.solution[i]; if (!isObj(s) || !Number.isInteger(s.row) || !Number.isInteger(s.col)) return `${p}.solution[${i}] must be { row, col } integers`; } }
      if (b.maxCellSize !== undefined) { const mc = b.maxCellSize; if (!isObj(mc) || typeof mc.mm !== "number" || !Number.isFinite(mc.mm) || mc.mm <= 0) return `${p}.maxCellSize must be { mm: positive number }`; }
      const cse = checkSize(b.cellSize, p); if (cse) return cse;
      return null;
    }
    default: return `${p} has unknown block type ${JSON.stringify(b.type)} (valid: stack, row, grid, text, image, rule, spacer, cut, chart, table, flow, qr, maze)`;
  }
}

const src = process.argv[2] ? readFileSync(process.argv[2], "utf8") : readFileSync(0, "utf8");
const jt = src.replace(/^[\s\S]*?```json\s*/i, "").replace(/```[\s\S]*$/, "").trim() || src;
const parsed = JSON.parse(jt);
const doc = parsed.document ?? parsed;

let reason = null;
if (!isObj(doc)) reason = "document must be an object";
else if (doc.version !== 1) reason = "document.version must be 1";
else if (!isObj(doc.page)) reason = "document.page must be an object";
else if (doc.page.finish !== undefined && !["cut", "feed", "none"].includes(doc.page.finish)) reason = 'document.page.finish must be "cut", "feed", or "none"';
else if (doc.page.branding !== undefined && !isObj(doc.page.branding)) reason = "document.page.branding must be an object";
else if (isObj(doc.page.branding) && doc.page.branding.enabled !== undefined && typeof doc.page.branding.enabled !== "boolean") reason = "document.page.branding.enabled must be a boolean";
else if (doc.page.theme !== undefined && typeof doc.page.theme !== "string") reason = "document.page.theme must be a string";
else if (doc.page.orientation !== undefined && doc.page.orientation !== "portrait" && doc.page.orientation !== "landscape") reason = 'document.page.orientation must be "portrait" or "landscape"';
else if (doc.content === undefined) reason = "document.content is required";
else reason = checkBlock(doc.content, "content", 0, { n: 0 });

if (reason) { console.log(`REJECTED ✗  ${reason}\n`); if (lint.length) { console.log("also:"); for (const l of lint) console.log("  •", l); } process.exit(1); }
console.log("VALID ✓ — the printer's validatePrintDoc would accept this.");
if (lint.length) { console.log("\nlint (valid, but check these):"); for (const l of lint) console.log("  •", l); }
console.log("");
process.exit(0);
