#!/usr/bin/env node
// QR pre-flight checker for the Lento `print_qr` tool (and the `qr` block).
//
// It mirrors the kernel's `validateQr` caps so a pass means the printer will
// accept the spec, formats a typed WiFi/vCard payload the same way the tool
// does, and estimates whether the code will be big enough to scan on the paper
// you name — the one thing the strict validator can't tell you.
//
//   node check-qr.mjs args.json                # file (whole print_qr args, or just {data})
//   node check-qr.mjs args.json --paper 58     # declare paper width in mm (default 80)
//   echo '{"url":"https://x"}' | node check-qr.mjs   # or pipe on stdin
//
// Exit code is 1 if any HARD FAIL fired (a cap the kernel would reject), 0
// otherwise — so you can gate a print on it. A too-small-to-scan estimate is a
// loud WARNING, not a hard fail: the real gate is printing it and scanning it.
//
// This is a LOOSER helper, not a byte-for-byte validator mirror — it's a
// hand-copy on purpose (the plugin ships standalone, no monorepo import).
import { readFileSync } from "node:fs";

const USAGE = `check-qr.mjs — pre-flight a Lento QR before printing
  node check-qr.mjs args.json [--paper 58|80]
  echo '{"url":"https://lento.press"}' | node check-qr.mjs --paper 80
Reads a print_qr args object (one of {url}|{text}|{data}|{wifi}|{contact} plus
ecc/format/logo/title/description/caption/module_mm/logo_mm) OR a bare {data}
object. Exit 1 on a hard cap violation. Then PRINT IT AND SCAN IT — a checker
pass is not a scan.`;

// Caps mirror validateQr (packages/thermal-core/src/layout/qr.ts).
const CAPS = { maxDataLen: 2953, maxCaptionLen: 500, maxTitleLen: 200, maxQuietZone: 16 };
const ECC = new Set(["L", "M", "Q", "H"]);
const FORMATS = new Set(["qr", "micro", "rmqr"]);
// Advisory sizing/ECC sanity per format — a looser mirror of validateQr's
// per-format rules (packages/thermal-core/src/layout/qr.ts), not a strict
// parity-tested copy. Micro QR's largest variant (M4-L) tops out around ~21
// alphanumeric chars — most payloads (esp. a URL) won't fit; ECC H has no
// Micro QR version. rMQR only defines ECC M/H.
const MICRO_ADVISORY_MAX_LEN = 21;
const ECC_BY_FORMAT = {
  qr: new Set(["L", "M", "Q", "H"]),
  micro: new Set(["L", "M", "Q"]),
  rmqr: new Set(["M", "H"]),
};
const DPI = 203; // thermal head
const MIN_MODULE_DOTS = 2; // below this a QR is unreliable to scan
const DEFAULT_QR_MM = 35; // the qr block's default square
const USABLE_MM = { 58: 48, 80: 72 }; // paper width minus margins

// QR byte-mode data capacity by ECC, versions 1..40 (module count = 17 + 4*version).
// A coarse-but-real estimate of how dense the code gets — not the encoder itself.
const BYTE_CAP = {
  L: [17, 32, 53, 78, 106, 134, 154, 192, 230, 271, 321, 367, 425, 458, 520, 586, 644, 718, 792, 858, 929, 1003, 1091, 1171, 1273, 1367, 1465, 1528, 1628, 1732, 1840, 1952, 2068, 2188, 2303, 2431, 2563, 2699, 2809, 2953],
  M: [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666, 711, 779, 857, 911, 997, 1059, 1125, 1190, 1264, 1370, 1452, 1538, 1628, 1722, 1809, 1911, 1989, 2099, 2213, 2331],
  Q: [11, 20, 32, 46, 60, 74, 86, 108, 130, 151, 177, 203, 241, 258, 292, 322, 364, 394, 442, 482, 509, 565, 611, 661, 715, 751, 805, 868, 908, 982, 1030, 1112, 1168, 1228, 1283, 1351, 1423, 1499, 1579, 1663],
  H: [7, 14, 24, 34, 44, 58, 64, 84, 98, 119, 137, 155, 177, 194, 220, 250, 280, 310, 338, 382, 403, 439, 461, 511, 535, 593, 625, 658, 698, 742, 790, 842, 898, 958, 983, 1051, 1093, 1139, 1219, 1273],
};

// --- payload builders (hand-copied from @lento/thermal-barcode src/payloads.ts) ---
// WiFi QR grammar: WIFI:T:<auth>;S:<ssid>;P:<pw>;[H:true;];;  — \ ; , : " escaped.
function esc(v) {
  return String(v ?? "").replace(/([\\;,:"])/g, "\\$1");
}
function buildWifiPayload(w) {
  const t = w.security ?? (w.password ? "WPA" : "nopass");
  let out = `WIFI:T:${t};S:${esc(w.ssid)};`;
  if (t !== "nopass" && w.password) out += `P:${esc(w.password)};`;
  if (w.hidden) out += "H:true;";
  return out + ";";
}
// vCard 3.0 text-value escaping (\ , ; and newlines) — mirrors payloads.ts escV.
function escV(v) {
  return String(v ?? "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}
function buildVCardPayload(c) {
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${escV(c.name)}`];
  if (c.org) lines.push(`ORG:${escV(c.org)}`);
  if (c.title) lines.push(`TITLE:${escV(c.title)}`);
  if (c.phone) lines.push(`TEL:${escV(c.phone)}`);
  if (c.email) lines.push(`EMAIL:${escV(c.email)}`);
  if (c.url) lines.push(`URL:${escV(c.url)}`);
  lines.push("END:VCARD");
  return lines.join("\n");
}

// Which payload alternatives are present — exactly one is required (matches the
// print_qr tool, which rejects zero or >1 rather than resolving by precedence).
function presentPayloads(a) {
  const p = [];
  if (typeof a.data === "string") p.push("data");
  if (typeof a.url === "string") p.push("url");
  if (typeof a.text === "string") p.push("text");
  if (a.wifi && typeof a.wifi === "object" && typeof a.wifi.ssid === "string") p.push("wifi");
  if (a.contact && typeof a.contact === "object" && typeof a.contact.name === "string") p.push("contact");
  return p;
}
function payloadFor(a, which) {
  switch (which) {
    case "data": return a.data;
    case "url": return String(a.url).trim();
    case "text": return a.text;
    case "wifi": return buildWifiPayload(a.wifi);
    default: return buildVCardPayload(a.contact);
  }
}

const mmToDots = (mm) => Math.round((mm / 25.4) * DPI);

// Smallest QR version whose byte capacity holds the payload at this ECC, or null.
function estimateVersion(byteLen, ecc) {
  const caps = BYTE_CAP[ecc] ?? BYTE_CAP.M;
  for (let v = 1; v <= 40; v++) if (caps[v - 1] >= byteLen) return v;
  return null;
}

// --- parse argv ---
const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}
const paperIdx = argv.indexOf("--paper");
const paper = paperIdx >= 0 ? Number(argv[paperIdx + 1]) : 80;
const file = argv.find((x) => !x.startsWith("--") && x !== String(paper));

let raw;
try {
  raw = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
} catch (e) {
  console.error("could not read input:", e && e.message ? e.message : String(e));
  process.exit(1);
}

let a;
try {
  const jsonText = raw.replace(/^[\s\S]*?```json\s*/i, "").replace(/```[\s\S]*$/, "").trim() || raw;
  const parsed = JSON.parse(jsonText);
  // Accept the whole tool-call args, a nested {args:{...}}, or a bare spec.
  a = parsed && typeof parsed === "object" && parsed.args && typeof parsed.args === "object" ? parsed.args : parsed;
} catch (e) {
  console.error("input is not valid JSON:", e && e.message ? e.message : String(e));
  process.exit(1);
}
if (!a || typeof a !== "object" || Array.isArray(a)) {
  console.error("✗ input must be a JSON object (a print_qr args object or a bare { data } object)");
  process.exit(1);
}

const hard = [];
const warn = [];

// --- resolve the payload string (exactly one alternative) ---
const present = presentPayloads(a);
if (present.length === 0) {
  console.error("✗ no QR payload — provide exactly one of: data, url, text, wifi { ssid }, contact { name }");
  process.exit(1);
}
if (present.length > 1) {
  console.error(`✗ provide exactly one payload, but got ${present.length}: ${present.join(", ")}`);
  process.exit(1);
}
const data = payloadFor(a, present[0]);
if (typeof data !== "string" || data.length === 0) {
  console.error("✗ QR payload is empty");
  process.exit(1);
}

// --- HARD caps (what the kernel's validateQr rejects) ---
if (data.length > CAPS.maxDataLen) hard.push(`payload is ${data.length} chars; the cap is ${CAPS.maxDataLen} — shorten it or use a URL shortener`);

const format = a.format ?? "qr";
if (a.format !== undefined && !FORMATS.has(a.format)) hard.push(`format "${a.format}" is invalid — use one of qr, micro, rmqr`);
const formatForRules = FORMATS.has(format) ? format : "qr";

if (formatForRules === "micro" && data.length > MICRO_ADVISORY_MAX_LEN) {
  warn.push(`payload is ${data.length} chars — too long for Micro QR (fits ~${MICRO_ADVISORY_MAX_LEN} alphanumeric chars) — use full QR`);
}

// Phone-camera scannability caveat — verified on real paper: Micro QR/rMQR encode
// correctly (an independent decoder reads them fine), but iOS Camera and most
// Android default scanners only decode standard QR. Micro QR support is spotty;
// rMQR is essentially unsupported by consumer scanning apps. This is advisory
// (not a hard fail) because these formats are legitimate for dedicated
// scanners/label readers — just not for "point your phone at it".
if (formatForRules === "micro" || formatForRules === "rmqr") {
  warn.push(
    `format "${formatForRules}" is not reliably readable by phone cameras (iOS Camera / most Android scanners decode standard QR only) — fine for a dedicated scanner or label reader, but use format "qr" (the default) if this needs to scan with a phone`,
  );
}

const ecc = a.ecc ?? "M";
if (a.ecc !== undefined && !ECC.has(a.ecc)) hard.push(`ecc "${a.ecc}" is invalid — use one of L, M, Q, H`);
else if (a.ecc !== undefined && !ECC_BY_FORMAT[formatForRules].has(a.ecc)) {
  hard.push(`ecc "${a.ecc}" is not valid for format "${formatForRules}" (allowed: ${[...ECC_BY_FORMAT[formatForRules]].join(", ")})`);
}

let quietZone = 4;
if (a.quietZone !== undefined) {
  if (!Number.isInteger(a.quietZone) || a.quietZone < 0 || a.quietZone > CAPS.maxQuietZone) {
    hard.push(`quietZone must be an integer between 0 and ${CAPS.maxQuietZone}`);
  } else {
    quietZone = a.quietZone;
  }
}

const moduleMm = a.module_mm ?? a.moduleMm; // tool uses module_mm; the block uses moduleMm
if (moduleMm !== undefined && (typeof moduleMm !== "number" || !Number.isFinite(moduleMm) || moduleMm <= 0)) {
  hard.push("module_mm must be a positive finite number");
}

if (a.caption !== undefined && (typeof a.caption !== "string" || a.caption.length > CAPS.maxCaptionLen)) {
  hard.push(`caption must be a string of at most ${CAPS.maxCaptionLen} chars`);
}
if (a.title !== undefined && (typeof a.title !== "string" || a.title.length > CAPS.maxTitleLen)) {
  hard.push(`title must be a string of at most ${CAPS.maxTitleLen} chars`);
}

// --- sizing sanity (advisory) ---
const eccForSize = ECC.has(ecc) ? ecc : "M";
const byteLen = Buffer.byteLength(data, "utf8");
let version = estimateVersion(byteLen, eccForSize);
if (version === null) {
  // Fits the char cap but not this ECC's data capacity → the encoder returns
  // null at render and the block prints a text hint instead of a scannable code.
  warn.push(`payload is ${byteLen} bytes — too long to encode at ECC ${eccForSize}; it won't produce a scannable code. Shorten it or lower ECC.`);
  version = 40; // size the estimate at the densest code so the dots/module math is honest
}
const modules = 17 + 4 * version;
const totalModules = modules + 2 * quietZone;

const usableMm = USABLE_MM[paper] ?? USABLE_MM[80];
const usableDots = mmToDots(usableMm);
const validModuleMm = typeof moduleMm === "number" && Number.isFinite(moduleMm) && moduleMm > 0;
let targetDots = validModuleMm ? mmToDots(moduleMm) * totalModules : mmToDots(DEFAULT_QR_MM);
targetDots = Math.min(targetDots, usableDots);
const rawModule = Math.floor(targetDots / totalModules);
const effModule = Math.max(MIN_MODULE_DOTS, rawModule);
const codeMm = ((effModule * totalModules) / DPI) * 25.4;

if (rawModule < MIN_MODULE_DOTS) {
  warn.push(
    `at ECC ${eccForSize} this needs a ~v${version} code (${modules}×${modules} modules); on ${paper}mm paper each module floors to ${rawModule} dot(s) — below the ${MIN_MODULE_DOTS}-dot scan minimum, so it will be too small to scan reliably. Shorten the payload, raise module_mm, or lower ECC.`,
  );
}

// --- report ---
console.log("");
console.log(`QR pre-flight — ${paper}mm paper (~${usableMm}mm usable), format ${formatForRules}, ECC ${eccForSize}`);
console.log(`  payload: ${byteLen} bytes  ·  est. version ~${version} (${modules}×${modules} modules, +${quietZone} quiet)`);
console.log(`  prints ~${codeMm.toFixed(0)}mm square at ${effModule} dot(s)/module`);
console.log("");

if (hard.length) {
  console.log("HARD FAILS (fix before printing):");
  for (const h of hard) console.log("  ✗", h);
} else {
  console.log("PASS — within the kernel caps.");
}
if (warn.length) {
  console.log("\nwarnings (won't block, but likely a bad print):");
  for (const w of warn) console.log("  ⚠", w);
}
if (!hard.length && !warn.length) {
  console.log("Sizing looks good. Now the real gate: print it and scan it with a phone before trusting it.");
} else {
  console.log("\nEven on a clean pass: print it and scan it with a phone — confirm it decodes to the intended target.");
}
console.log("");
process.exit(hard.length ? 1 : 0);
