# serv-us-ext — WA Message Reader

A **Manifest V3 Chrome extension** that runs on top of the real [`https://web.whatsapp.com/`](https://web.whatsapp.com/) — no iframe (WhatsApp blocks framing via `X-Frame-Options` / CSP). It reads message bubbles straight from the page DOM and prints **text + sender + time** into an injected on-page panel and the DevTools console, updating live via `MutationObserver`.

---

## Quick Start

```bash
git clone https://github.com/nhasibuan/serv-us-ext.git
```

1. Open `chrome://extensions` → enable **Developer mode**
2. Click **Load unpacked** → select the cloned folder
3. Open [https://web.whatsapp.com/](https://web.whatsapp.com/) and log in
4. Open any chat — the reader panel appears bottom-right automatically
5. Click the green FAB to toggle the panel open/closed

---

## Files

| File | Purpose |
|---|---|
| `manifest.json` | MV3 config, `host_permissions` for WhatsApp Web |
| `content.js` | DOM reader + overlay panel logic (v1.1) |
| `content.css` | Panel styling, scoped under `#wa-reader-root` |
| `popup.html` | Toolbar popup with quick instructions |
| `DOCS.md` | Full PRD, architecture, data flow, data dictionary, user guide |

---

## Documentation

See **[DOCS.md](./DOCS.md)** for the complete product documentation:

- **Part 1** — Product Requirements Document (PRD)
- **Part 2** — Architecture Blueprint & component breakdown
- **Part 3** — Data Flow Diagram
- **Part 4** — Data Dictionary
- **Part 5** — Step-by-Step User Guide & troubleshooting

---

## How It Works

- `content.js` is injected into `web.whatsapp.com` at `document_idle`
- Finds message bubbles via `[data-testid="msg-container"]` with fallbacks for obfuscated builds
- Extracts **text**, **sender**, and **time** from `data-pre-plain-text="[8:19 PM, 6/13/2026] bundaa: "`
- Detects outgoing messages via `data-id^="true_"` (stable across WA builds)
- `MutationObserver` (RAF-debounced) watches `document.body` for new messages live
- Results render in a `position:fixed` overlay panel and are logged to DevTools console

**Example console output:**
```
[WA Reader] [8:19 PM, 6/13/2026] bundaa: Bunda blg depan rumah ya
```

---

## Privacy

`permissions: []` — no sensitive Chrome APIs. Runs locally, read-only. Zero data leaves the page.
