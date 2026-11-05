---
name: lento-qr
description: Use when someone asks the Lento to make, generate, or print a QR code — a link QR, a "scan to join WiFi" QR, or a contact (vCard) QR — on their thermal printer, anything routed to the print_qr tool.
---

# Making QR codes for the Lento

## The core principle

A printed QR is only good if a phone actually **scans it and lands on the thing you meant**. Two failure modes ruin it, and neither shows up as an error — the printer prints whatever you send:

1. **A malformed payload string** — a WiFi QR with the wrong grammar or unescaped characters scans to gibberish, so the phone never offers to join.
2. **A code too dense to read** — a long payload makes a QR with more modules; squeezed onto narrow paper, each module falls below the scan minimum and no phone can lock on.

So the job is: **build the right payload string, keep it short enough to print big, then print it and scan it before trusting it.**

## The three payload types (and their exact string formats)

`print_qr` builds the payload string for you from a typed input — but you must know the formats anyway, because a QR can *also* be embedded mid-document (a flyer footer, a ticket) via `print_document`'s `qr` block or a ` ```qr ` markdown fence, and there **you** format the string yourself. The kernel `qr` block takes only a finished `data` string; it knows nothing about WiFi or contacts.

**URL / link** — the payload is the URL, passed through verbatim (trimmed):

```
https://lento.press/welcome
```

**WiFi join** — grammar `WIFI:T:<auth>;S:<ssid>;P:<password>;[H:true;];;`. The reserved characters `\ ; , : "` inside the SSID or password **must be backslash-escaped**, and the string ends with a bare `;` (two semicolons total at the end):

```
WIFI:T:WPA;S:CafeNet;P:hunter2;;
```

- `T` is the auth type: `WPA` (covers WPA/WPA2/WPA3), `WEP`, or `nopass` (open network).
- Escaping example: SSID `Cafe;Net` and password `p:w"d` become `WIFI:T:WPA;S:Cafe\;Net;P:p\:w\"d;;`.
- Hidden network: add `H:true;` before the trailing `;` → `WIFI:T:WPA;S:Secret;P:pw;H:true;;`.
- Open network: `WIFI:T:nopass;S:FreeWifi;;` (no `P:` field).

**Contact (vCard 3.0)** — a newline-joined vCard, `FN` (full name) required, everything else optional:

```
BEGIN:VCARD
VERSION:3.0
FN:Ada Lovelace
ORG:Analytical Engines
TITLE:Programmer
TEL:+1-555-0100
EMAIL:ada@example.com
URL:https://example.com
END:VCARD
```

## Formats — `format: "qr" | "micro" | "rmqr"` (default `"qr"`)

Three symbologies share the same `qr` block / `print_qr` tool. Picking the right one is mostly about **how little data you actually need to encode**:

- **`"qr"` (default)** — the standard square code. Use this unless you have a specific reason not to; it has the most capacity, the fewest ECC restrictions, and the widest phone-scanner support. **This is the phone-scannable choice — recommend it for anything a user will scan with their own camera.** When in doubt, use full QR.
- **`"micro"`** — Micro QR. Meaningfully smaller/denser-looking for genuinely short payloads, but its capacity is tiny: the largest Micro QR variant (M4-L) tops out around **~21 alphanumeric characters** (numeric-only payloads can run longer, up to ~35 digits, but a URL or mixed-case string will not fit). **A typical URL will not fit in a Micro QR** — the tool/checker errors clearly rather than silently truncating, so don't reach for `"micro"` for a link unless you've confirmed the payload is short (e.g. a short numeric code, a 5-digit PIN). ECC `H` is **not available** for Micro QR (`micro`'s allowed levels are `L`, `M`, `Q` — no `H`); requesting `H` is rejected.
- **`"rmqr"`** — rectangular Micro QR (rMQR): a narrow horizontal strip, good for labels or spaces too short vertically for a square code. Capacity is larger than Micro QR (up to ~361 chars) but still well below full QR. **Only `M` and `H` ECC are defined for rMQR** — `L` and `Q` are rejected.

If a payload doesn't fit the format's capacity, or the ECC isn't valid for the format, `validateQr` (and the bundled checker) reject with a clear per-format reason — prefer catching this before printing over discovering it as a printer error.

### Scanner caveat — Micro QR and rMQR are NOT reliably phone-scannable

**Verified on real paper (2026-07-26): the encoding itself is correct** — an independent decoder reads a printed Micro QR and rMQR back cleanly — but **most phone cameras can't scan them**. iOS Camera and the default scanner on most Android devices decode **standard QR only**; Micro QR support across consumer apps is spotty at best, and rMQR is essentially unsupported outside dedicated scanning hardware/software.

- **Micro QR / rMQR are for dedicated scanners or label readers** (POS hardware, industrial scanners, a purpose-built app that explicitly supports the symbology) — not for "hand someone a printout and have them point their phone at it."
- **If the code needs to be scanned by an ordinary person's phone, use `format: "qr"` (the default).** Don't reach for `micro`/`rmqr` just because the payload is short — the space savings aren't worth losing phone-scannability unless you already know the reader is a dedicated scanner.
- The bundled checker (below) prints this same caveat as a warning whenever `format` is `micro` or `rmqr`.

## The `logo` flag — an opt-in Lento brand mark

`logo: true` composes a small Lento logomark into the code. The kernel stays asset-free (no art baked into the layout engine) — the mark is injected by the host. **What follows describes the `print_qr` tool's behavior**, which auto-selects between two treatments; a raw `qr` block used mid-content (`print_document`/a ` ```qr ` fence) does **not** get this auto-selection — see "Mid-content" below for what actually happens there.

- **Full QR (`format: "qr"`, the default) with `logo: true`** — a **centered, normal** (black-on-white) mark drawn on a small knocked-out-to-white square in the middle of the code. This occludes real data modules, so it needs real error-correction headroom: `print_qr` forces ECC to **`H`** for this treatment, **silently** (no warning if you asked for something lower — the tool just overrides it). Because it needs that headroom, this treatment is **full-QR only**.
- **Micro QR / rMQR with `logo: true`** — these formats have no ECC headroom to spare for occlusion (Micro QR can't even reach `H`), so `print_qr` instead places the mark **beside** the code as a separate **black-fill** square (`row([ logo, gap, qrCode ])`), never inside it.

If `logo: true` is set but the brand mark isn't wired into the render environment, the code still prints without a logo (a `qr-logo-unresolved` warning, not a hard failure) — never a broken or unscannable code. The kernel applies that same graceful-degrade rule to a raw Micro/rMQR block with `logo: true`, even when the mark IS wired in — see below.

## Card options — `title`, `description`, `logo`/`logo_mm` (all optional)

`print_qr` builds a small "card": an optional label, an optional lighter secondary line, then the code. Every piece is independently optional — a card can be just the bare code, or the full stack:

- **`title`** — the card's label, printed as a heading **on top** of the code.
- **`description`** — a lighter secondary line, printed under `title` (or on top, if there's no title) and above the code.
- **`logo`** — opt-in (see above); when set, composes the Lento mark **centered** on a full QR or **beside** a Micro/rMQR code.
- **`logo_mm`** — sizes the **beside** logo square (Micro/rMQR treatment only); ignored for the centered full-QR treatment, which sizes itself to the code. Defaults to a sensible size (~18mm) when omitted.

A card with none of these set is just a bare centered code (plus whatever `caption` you gave the underlying `qr` block).

## Error correction (ECC)

ECC adds redundancy so a smudged or partially-covered code still reads — but higher ECC means **more modules**, i.e. a denser code, which fights against printing it big enough.

- **`M` is the default** and right for most short links.
- **Use `Q`** for a longer payload (long URL, WiFi password) or a scan-critical code — the extra redundancy survives thermal-print imperfections and handling.
- **`H`** only when robustness genuinely matters (a code that will get wet, folded, or partly covered by a logo). It's the densest; on narrow paper it's the first thing to make a code unscannable.

Rule of thumb: a longer payload *and* higher ECC both push the code denser. If a code comes out too small (below), drop ECC before anything else.

## Sizing for the paper

The code prints **~35mm square by default**. Module size snaps to whole printer dots (203 dpi), and a module must be **at least 2 dots** to scan reliably. A long payload yields a high QR "version" (more modules); divided into the fixed print width, each module can floor below 2 dots — at which point the printer emits a **`qr-undersized`** warning and the code is a coin-toss to scan.

Usable width is the constraint:

- **58mm paper → ~48mm usable.**
- **80mm paper → ~72mm usable.**

If a payload is too dense to print big enough, in order of preference:

1. **Shorten the payload** — prefer a short URL or a URL shortener over a 200-char link. This is almost always the real fix.
2. **Raise `module_mm`** — force a bigger module (the code grows; fine if it fits the paper).
3. **Lower ECC** — `Q → M`, or `M → L` — fewer modules for the same payload.

## Verification gate — do this before every print

**Step 1 — if a code sandbox is available (e.g. Claude Code), run the bundled checker.** It mirrors the kernel's `validateQr` caps, formats the same WiFi/vCard payload the tool will, and estimates whether the code prints big enough on your paper:

```bash
node check-qr.mjs your-args.json --paper 80   # or 58
echo '{"wifi":{"ssid":"CafeNet","password":"hunter2","security":"WPA"}}' | node check-qr.mjs --paper 58
```

Feed it the `print_qr` args (or a bare `{ "data": "..." }`). **Exit 1 = do not print** — a cap is violated. A `⚠ too small to scan` warning is exit 0 but means the print will probably fail to read; heed it.

**Step 2 — and this is the real gate — PRINT IT AND SCAN IT WITH A PHONE.** Point a phone camera at the printout and confirm it decodes to the intended target: the URL actually opens, or the phone offers to join the right WiFi network. **A QR that passes the checker but doesn't scan is still a failed print.** Never hand a QR to a user without scanning the paper yourself.

No sandbox (e.g. Claude Desktop)? Do the caps by hand — payload ≤ 2953 chars, `ecc` ∈ L/M/Q/H, `quietZone` an int 0–16, `module_mm` > 0, `caption` ≤ 500 chars, `title` ≤ 200 chars — then still print and scan.

## Calling the tool

A link QR:

```json
{
  "printer_id": "<from lento_search, kind printer>",
  "url": "https://lento.press",
  "title": "Follow along",
  "caption": "lento.press"
}
```

A "scan to join WiFi" QR (the tool escapes and formats the WiFi string for you):

```json
{
  "printer_id": "<from lento_search, kind printer>",
  "wifi": { "ssid": "CafeNet", "password": "hunter2", "security": "WPA" },
  "ecc": "Q",
  "title": "Guest WiFi",
  "caption": "Scan to join"
}
```

Supply **exactly one** payload: `url`, `text`, `wifi`, `contact`, or a pre-formatted `data` string. Options: `ecc` (default `M`), `format` (`qr`|`micro`|`rmqr`, default `qr` — see Formats above), `logo` (add the Lento logomark — see above), `logo_mm` (beside-logo size on Micro/rMQR; see Card options above), `title` (heading above), `description` (lighter secondary line, see Card options above), `caption` (line below the code), `module_mm` (exact module size; otherwise ~35mm).

## Mid-content: a QR inside a larger document

**Don't use `print_qr` when the QR is one piece of a bigger layout** (a flyer with a WiFi footer, a ticket with a check-in code). `print_qr` prints a standalone, auto-cut, centered code. To place a QR in the middle of other content, use **`print_document` with a `qr` block** (see the **lento-layout** skill), or a ` ```qr ` fence in `print_markdown`.

The `qr` block shape (kernel-level fields only — **no** WiFi/contact typing; you format the payload string yourself):

```json
{ "type": "qr", "data": "WIFI:T:WPA;S:CafeNet;P:hunter2;;", "ecc": "Q", "format": "qr", "quietZone": 4, "moduleMm": 8, "caption": "Scan to join", "align": "center" }
```

The block defaults to **left-aligned** so it composes cleanly mid-stack; set `align: "center"` if you want it centered. Same for the ` ```qr ` fence — its body is a raw payload line **or** a small JSON of those kernel fields (`{data, ecc, format, logo, caption, quietZone, moduleMm}`), so a typed WiFi/vCard code means writing the `WIFI:`/`BEGIN:VCARD` string yourself.

A mid-content block also takes `format` and `logo` — but a raw block gets **none** of the treatment auto-selection that `print_qr` does; that logic lives only in the tool, not the kernel:

- The kernel's center logo is **full-QR only**. On a raw `format: "micro"` or `"rmqr"` block, `logo: true` does **not** get a beside treatment for free — the kernel simply **skips the logo** (with a `qr-logo-unresolved` warning) and prints the plain, scannable code. There is no `row([logo, qr])` composition unless you build it yourself. If you want a beside logo on a Micro/rMQR code mid-content, either compose the `row([image, qr])` by hand, or use `print_qr` (which does this for its own standalone output).
- On a raw **full-QR** block with `logo: true`, the kernel draws the center knockout at **whatever `ecc` you gave it** (default `M`) — it does **not** auto-force `H` the way `print_qr` does; only the tool does that. A center logo at low ECC occludes modules the code can't afford to lose and may not scan. **Set `ecc: "H"` yourself** whenever you set `logo: true` on a mid-content `qr` block.

## Common mistakes

| Mistake | Fix |
|---|---|
| Guessing that letters/case in a URL don't matter | They do — a QR encodes the exact bytes. Verify by scanning the paper. |
| Cramming a huge payload into one code | Shorten it (URL shortener); a long payload floors module size below the scan minimum. |
| Printing before scanning | Print then scan with a phone every time — a checker pass is not a scan. |
| Forgetting WiFi escaping | `\ ; , : "` inside SSID/password must be backslash-escaped, or the join string is malformed. |
| Using a raw ` ```qr ` fence for a typed WiFi/contact code | The fence and `qr` block take kernel fields only — format the `WIFI:`/`BEGIN:VCARD` string yourself, then pass it as `data`. |
| Cranking ECC to `H` for a link | Higher ECC = denser = harder to print big enough. Default `M`, `Q` for scan-critical; reach for `H` only for real robustness needs. |
| Reaching for `format: "micro"` for a URL | Micro QR's largest variant holds ~21 alphanumeric chars — almost no URL fits. Use full `"qr"` unless the payload is genuinely tiny. |
| Requesting ECC `H` on `format: "micro"` | Not a valid combination — Micro QR has no version that supports `H`. Use `L`/`M`/`Q`. |
| Requesting ECC `L` or `Q` on `format: "rmqr"` | rMQR only defines `M` and `H`. |
| Setting `logo: true` on a mid-content Micro/rMQR `qr` block and expecting a beside logo | Only `print_qr` composes the beside `row`. A raw block just drops the logo (with a warning) and prints the plain code — build the `row([image, qr])` yourself if you need it mid-content. |
| Setting `logo: true` on a mid-content full-QR block without also raising `ecc` | Only `print_qr` auto-forces ECC `H` for a center logo. A raw block draws the knockout at whatever `ecc` you gave it (default `M`) — set `ecc: "H"` yourself. |
