# WA Message Reader — serv-us-ext
## Product Documentation Suite

> **Repository:** https://github.com/nhasibuan/serv-us-ext  
> **Extension version:** 1.1.0 · Manifest V3 · Chrome / Chromium  
> **Author:** nhasibuan  
> **Last updated:** 2026-06-19

---

# Part 1 — Product Requirements Document (PRD)

## 1.1 Product Overview

WA Message Reader (`serv-us-ext`) is a Manifest V3 Chrome extension that injects a floating reader panel ("Frame 2") directly on top of `https://web.whatsapp.com/`. It reads message bubbles from the live WhatsApp Web DOM in real time, extracts the message body, sender name, and timestamp, and surfaces all of that information in a searchable, copyable on-page panel and the DevTools console.

The extension requires **no external server**, **no API key**, and **no iframe** — WhatsApp's `X-Frame-Options: SAMEORIGIN` / `CSP frame-ancestors` headers make framing impossible. Everything executes entirely inside the user's browser.

---

## 1.2 Problem Statement

WhatsApp Web provides no native export, search-across-history, or structured message-logging capability. Power users — researchers, support agents, compliance reviewers, and personal users who want a local audit trail — have no built-in way to extract and copy structured message data (`[time] sender: text`) from an active chat without resorting to screenshots or manual copy-paste.

---

## 1.3 Goals & Non-Goals

### Goals
- Read message text, sender, and timestamp directly from the WhatsApp Web DOM with no screen-scraping tools or external services.
- Display extracted messages in a persistent, searchable overlay panel that does not disrupt normal WhatsApp usage.
- Emit structured `[time] sender: text` lines to DevTools console for developer inspection.
- Support live updates: new messages appear in the panel automatically via `MutationObserver`.
- Run entirely offline and locally — zero data egress.

### Non-Goals
- **No message sending** — the extension is read-only.
- **No message storage** beyond the in-memory session (no `localStorage`, no IndexedDB, no cloud sync).
- **No multi-chat aggregation** — reads only the currently open conversation.
- **No media/voice/sticker extraction** — text-only. Media messages are intentionally skipped.
- **No WhatsApp API usage** — DOM-only approach.

---

## 1.4 Target Users

| User Segment | Use Case |
|---|---|
| Personal users | Keep a readable log of a conversation without downloading the full WhatsApp backup |
| Developers / QA | Inspect live message bubble structure; validate DOM selectors |
| Support agents | Quickly copy a conversation thread to a ticket system |
| Researchers / compliance | Capture timestamped message records for later review |

---

## 1.5 Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | Inject a floating FAB onto `web.whatsapp.com` | P0 |
| FR-02 | On FAB click, display the reader panel with all messages extracted from the current chat DOM | P0 |
| FR-03 | Extract text, sender, and timestamp from each `[data-testid="msg-container"]` bubble | P0 |
| FR-04 | Detect outgoing vs. incoming messages using `data-id^="true_"` | P0 |
| FR-05 | Update the panel live as new messages arrive via `MutationObserver` | P0 |
| FR-06 | Emit `[time] sender: text` lines to DevTools console in green | P1 |
| FR-07 | Allow keyword filtering of the displayed messages | P1 |
| FR-08 | "Copy all" — copies the full session log to clipboard in `[time] sender: text` format | P1 |
| FR-09 | "Re-scan" — manually triggers a fresh DOM sweep | P1 |
| FR-10 | "Clear" — wipes the in-panel message list (does not affect WhatsApp DOM) | P2 |
| FR-11 | Toolbar popup with one-click link to `web.whatsapp.com` | P2 |

---

## 1.6 Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Performance** | `MutationObserver` debounced via `requestAnimationFrame`; no repeated scans within a single frame |
| **Correctness** | `WeakSet` prevents any bubble from being rendered twice per session |
| **Privacy** | Zero network requests from extension code; `permissions: []` in manifest |
| **Fragility tolerance** | Primary selectors use stable `data-testid` hooks; obfuscated-class fallbacks exist |
| **Compatibility** | Manifest V3; Chrome 109+; any Chromium-based browser (Edge, Brave, Arc) |
| **CSP compliance** | Styles loaded via `content_scripts.css` field; no `eval`, no remote scripts |

---

## 1.7 Constraints & Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| WhatsApp removes `data-testid` attributes | Medium | Fallback chain: `.selectable-text` → `.copyable-text span` |
| WhatsApp removes `data-pre-plain-text` | Low | Load-bearing for WA's accessibility layer; unlikely to disappear |
| WhatsApp removes `data-id` on list rows | Low | Falls back to `div.message-out` class detection |
| Chrome MV3 stricter CSP | Low | Styles bundled in `content.css`, not inline |
| WhatsApp ToS enforcement | Policy | Local-only, read-only, personal-use; no automation or sending |

---

# Part 2 — Architecture Blueprint

## 2.1 High-Level Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Chrome Browser                                          │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │  Tab: https://web.whatsapp.com/                  │    │
│  │                                                  │    │
│  │  ┌────────────────────────┐                      │    │
│  │  │  WhatsApp Web SPA      │  ← real WA DOM       │    │
│  │  │  (Frame 1)             │                      │    │
│  │  └────────────────────────┘                      │    │
│  │           │  DOM mutations                        │    │
│  │           ▼                                      │    │
│  │  ┌────────────────────────────────────────────┐  │    │
│  │  │  Content Script (content.js + content.css) │  │    │
│  │  │  Injected by Chrome at document_idle       │  │    │
│  │  │                                            │  │    │
│  │  │  ┌──────────────┐  ┌─────────────────┐    │  │    │
│  │  │  │ DOM Reader   │  │ MutationObserver│    │  │    │
│  │  │  │ extractText()│◄─│ (RAF-debounced) │    │  │    │
│  │  │  │ extractMeta()│  └─────────────────┘    │  │    │
│  │  │  └──────┬───────┘                         │  │    │
│  │  │         │ msg {text,sender,time,outgoing}  │  │    │
│  │  │         ▼                                  │  │    │
│  │  │  ┌──────────────────────────────────────┐  │  │    │
│  │  │  │  Overlay Panel  #wa-reader-root      │  │  │    │
│  │  │  │  (Frame 2 — position:fixed overlay)  │  │  │    │
│  │  │  │  FAB → Panel → rows + filter + copy  │  │  │    │
│  │  │  └──────────────────────────────────────┘  │  │    │
│  │  │         │                                   │  │    │
│  │  │         └──► console.log (DevTools)         │  │    │
│  │  └────────────────────────────────────────────┘  │    │
│  └──────────────────────────────────────────────────┘    │
│                                                          │
│  ┌────────────────────────────┐                          │
│  │  Extension Toolbar Popup   │  popup.html              │
│  └────────────────────────────┘                          │
└──────────────────────────────────────────────────────────┘
```

---

## 2.2 Component Breakdown

### `manifest.json` — Extension Manifest (MV3)

| Field | Value | Purpose |
|---|---|---|
| `manifest_version` | `3` | Required for all new Chrome extensions |
| `permissions` | `[]` | No sensitive APIs needed |
| `host_permissions` | `https://web.whatsapp.com/*` | Grants content script injection on WA |
| `content_scripts[].run_at` | `document_idle` | Injects after DOM is interactive |
| `action.default_popup` | `popup.html` | Toolbar icon click target |

---

### `content.js` — Core Content Script

| Module | Function(s) | Responsibility |
|---|---|---|
| **DOM Reader** | `getMessageContainers()` | Locate all message bubbles via selector chain |
| **DOM Reader** | `extractText(container)` | Pull body text from a bubble node |
| **DOM Reader** | `extractMeta(container)` | Pull sender + time + outgoing flag |
| **Processor** | `processContainer(container)` | Gate on WeakSet, extract, push, log, render |
| **Processor** | `scanAll()` | Iterate all containers through `processContainer` |
| **Observer** | `startObserver()` | RAF-debounced MutationObserver on `document.body` |
| **Panel UI** | `buildPanel()` | Inject `#wa-reader-root` DOM tree |
| **Panel UI** | `renderRow(msg)` | Append a message card to the panel body |
| **Panel UI** | `applyFilter()` | Show/hide rows based on search input |
| **Panel UI** | `clearAll()` / `copyAll()` | Clear session or copy log to clipboard |
| **Utility** | `escapeHtml(s)` | XSS-safe HTML encoding for injected text |
| **Boot** | `init()` + `setInterval` | Idempotency guard; polls until WA SPA is ready |

---

### `content.css` — Injected Panel Styles

Scoped entirely under `#wa-reader-root` and `#wa-reader-root *` to prevent CSS bleed.

| Element | Key CSS | Notes |
|---|---|---|
| `#wa-reader-fab` | `position:fixed; right:22px; bottom:22px; z-index:2147483646` | Just below Chrome's native UI layer |
| `#wa-reader-panel` | `position:fixed; right:22px; bottom:88px; z-index:2147483647; width:360px` | Highest possible z-index |
| `.wa-reader-row.out` | `border-left: 3px solid #25d366` | Green = outgoing |
| `.wa-reader-row` | `border-left: 3px solid #2a3942` | Navy = incoming |
| `@keyframes wa-pulse` | Green glow on status dot | Live observer indicator |
| `@keyframes wa-in` | `opacity 0→1, translateY 6→0` | Per-message entrance animation |

---

### `popup.html` — Toolbar Popup

Static 300px popup with usage instructions and a direct link to `https://web.whatsapp.com/`. No JavaScript, no permissions consumed.

---

## 2.3 Selector Fallback Chain

```
Priority 1 (stable, semantic):
  [data-testid="msg-container"]       ← bubble container
  [data-testid="selectable-text"]     ← message body text
  [data-pre-plain-text]               ← "[time] sender: " metadata
  [data-id^="true_"]                  ← fromMe signal on list row

Priority 2 (semi-stable):
  span.selectable-text
  span.copyable-text
  div.message-in / div.message-out

Priority 3 (loosest fallback):
  .copyable-text span.selectable-text
  .copyable-text span
```

---

# Part 3 — Data Flow Diagram

## 3.1 Message Ingestion Flow

```
WhatsApp Web SPA
      │  renders <div data-testid="msg-container"> into document.body
      ▼
MutationObserver  (childList:true, subtree:true on document.body)
      │  fires on any DOM child change
      ▼
RAF debounce gate
      │  rafPending=true? → drop
      │  else → requestAnimationFrame → rafPending=false
      ▼
scanAll()
      │  querySelectorAll('[data-testid="msg-container"]') + fallbacks
      │
      ├─► for each container node
      │       │
      │       ├── SEEN.has(container)? → skip
      │       │
      │       ├── extractText()
      │       │     [data-testid="selectable-text"] .innerText
      │       │     text==""? → skip (media/sticker/emoji — intentional)
      │       │
      │       ├── SEEN.add(container)
      │       │
      │       ├── extractMeta()
      │       │     data-pre-plain-text = "[8:19 PM, 6/13/2026] bundaa: "
      │       │     regex → time="8:19 PM, 6/13/2026", sender="bundaa"
      │       │     data-id^="true_"? → outgoing=true
      │       │
      │       ├── push to messages[]
      │       │
      │       ├── console.log
      │       │     "[WA Reader] [8:19 PM, 6/13/2026] bundaa: Bunda blg depan rumah ya"
      │       │
      │       └── renderRow(msg)
      │             append .wa-reader-row to #wa-reader-body
      │             applyFilter() → filter by search query
      │
      └── updateCount() → #wa-reader-count badge
```

---

## 3.2 User Action Flows

```
FAB click
  → panel.classList toggle "open"
  → scanAll() triggered immediately

Search input
  → applyFilter()
  → each .wa-reader-row: display="" or display="none"

Re-scan
  → scanAll()
  → WeakSet prevents re-rendering already-seen nodes

Copy all
  → messages[].map("[time] sender: text").join("\n")
  → navigator.clipboard.writeText(...)
  → flashStatus(): status dot turns yellow for 600ms

Clear
  → messages.length = 0
  → panelBody.innerHTML = empty state
  → WeakSet NOT cleared (refresh tab to fully reset)
```

---

# Part 4 — Data Dictionary

## 4.1 `messages[]` — Session Message Array

In-memory array. Cleared by `clearAll()`. Never persisted to disk or network.

| Field | Type | Source | Example |
|---|---|---|---|
| `text` | `string` | `.innerText` of `[data-testid="selectable-text"]` | `"Bunda blg depan rumah ya"` |
| `sender` | `string` | Parsed from `data-pre-plain-text`; fallback `"You"` / `"Them"` | `"bundaa"` |
| `time` | `string` | Regex capture group 1 of `data-pre-plain-text` | `"8:19 PM, 6/13/2026"` |
| `outgoing` | `boolean` | `true` if ancestor `[data-id]` starts with `"true_"` | `false` |
| `ts` | `number` | `Date.now()` at extraction time (ms since epoch) | `1749814740000` |

---

## 4.2 `SEEN` — `WeakSet<Element>`

| Property | Value |
|---|---|
| Type | `WeakSet<HTMLElement>` |
| Cleared by | Page reload only (not by `clearAll()`) |
| Purpose | Idempotency guard — prevents duplicate message rows |
| Memory safety | Entries are GC'd when WA removes nodes from DOM |

---

## 4.3 DOM Attributes Used as Data Sources

| Attribute | Element | Value Format | Extracted Fields |
|---|---|---|---|
| `data-testid="msg-container"` | `<div>` | Fixed string | Bubble container selector |
| `data-testid="selectable-text"` | `<span>` | Fixed string | Message body text node |
| `data-pre-plain-text` | `.copyable-text <div>` | `"[HH:MM AM, M/DD/YYYY] sender: "` | `time`, `sender` |
| `data-id` | List item `<div>` | `"true_<jid>_<hash>"` / `"false_..."` | `outgoing` flag |

---

## 4.4 DOM Elements Injected by Extension

| Element ID / Class | Tag | Purpose |
|---|---|---|
| `#wa-reader-root` | `div` | Extension root — all injected DOM lives here |
| `#wa-reader-fab` | `button` | Toggle FAB (bottom-right) |
| `.wa-reader-fab-dot` | `span` | Red notification dot on FAB |
| `#wa-reader-panel` | `section` | Main reader panel container |
| `.wa-reader-head` | `header` | Panel header with title + count badge |
| `#wa-reader-status` | `span` | Animated green live-status dot |
| `#wa-reader-count` | `span` | Message count badge |
| `#wa-reader-close` | `button` | × close button |
| `.wa-reader-toolbar` | `div` | Search + action buttons row |
| `#wa-reader-search` | `input` | Live keyword filter |
| `#wa-reader-rescan` | `button` | Trigger manual `scanAll()` |
| `#wa-reader-copy` | `button` | Copy all to clipboard |
| `#wa-reader-clear` | `button` | Clear session messages |
| `#wa-reader-body` | `div` | Scrollable message list |
| `.wa-reader-row` | `div` | Incoming message card |
| `.wa-reader-row.out` | `div` | Outgoing message card |
| `.wa-reader-sender` | `span` | Sender name inside a row |
| `.wa-reader-time` | `span` | Timestamp inside a row |
| `.wa-reader-text` | `div` | Message body inside a row |
| `.wa-reader-empty` | `div` | Empty-state placeholder |

---

## 4.5 Manifest Fields

| Field | Value | Description |
|---|---|---|
| `manifest_version` | `3` | MV3 — required for all new Chrome extensions from 2023 |
| `name` | `"WA Message Reader"` | Display name in Chrome extensions list |
| `version` | `"1.1.0"` | Semantic version |
| `permissions` | `[]` | Empty — no sensitive Chrome API access |
| `host_permissions` | `["https://web.whatsapp.com/*"]` | Content script scope: WA only |
| `content_scripts[].run_at` | `"document_idle"` | Inject after DOM is fully parsed |
| `action.default_popup` | `"popup.html"` | Toolbar icon click target |

---

# Part 5 — Step-by-Step User Guide

## 5.1 Installation

**Prerequisites:** Google Chrome 109+ (or Edge, Brave, Arc). Developer Mode enabled in `chrome://extensions`.

**Step 1 — Download the extension**

Clone or download the repository:

```bash
git clone https://github.com/nhasibuan/serv-us-ext.git
```

Ensure the folder contains:

```
serv-us-ext/
├── manifest.json
├── content.js
├── content.css
├── popup.html
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

**Step 2 — Open Chrome Extensions**

Navigate to `chrome://extensions` in Chrome.

**Step 3 — Enable Developer Mode**

Toggle **Developer mode** ON in the top-right corner.

**Step 4 — Load unpacked**

Click **Load unpacked** → select the `serv-us-ext/` folder → confirm.

**Step 5 — Confirm installation**

The **WA Message Reader** card appears in the extensions list. The speech-bubble icon appears in the Chrome toolbar.

---

## 5.2 First Use

1. Open https://web.whatsapp.com/ and log in with your phone's QR code.
2. Click any conversation in the left sidebar.
3. The reader panel appears automatically in the bottom-right corner.
4. If the panel is closed, click the **green circular FAB button** (bottom-right) to toggle it open.

---

## 5.3 Reading Messages

Each extracted message appears as a card in the panel:

```
bundaa                              8:19 PM, 6/13/2026
Bunda blg depan rumah ya
```

- **Green left border** = incoming message
- **Navy left border** = outgoing message (sent by you)
- The panel auto-scrolls to the newest message.
- New messages appear in real time via `MutationObserver`.

---

## 5.4 Filtering Messages

Type any keyword into the **search bar** in the panel toolbar. Non-matching rows hide instantly. Clear the field to show all messages.

---

## 5.5 Copying the Message Log

Click **Copy all**. The full session log is placed on the clipboard in structured format:

```
[8:19 PM, 6/13/2026] bundaa: Bunda blg depan rumah ya
[8:20 PM, 6/13/2026] You: Ok bun
[8:21 PM, 6/13/2026] bundaa: Makasih ya
```

Paste directly into any text editor, spreadsheet, or ticketing system.

---

## 5.6 Re-scanning for Older Messages

Scroll up in the chat to load older message history, then click **Re-scan**. Already-extracted messages are not duplicated (WeakSet idempotency guard).

---

## 5.7 Clearing the Session Log

Click **Clear** to wipe the panel display. Does **not** affect WhatsApp itself. To re-read all messages after a clear, refresh the `web.whatsapp.com` tab.

---

## 5.8 DevTools Console Output

Open DevTools (`F12`) → **Console** tab. Every extracted message prints in green:

```
[WA Reader] [8:19 PM, 6/13/2026] bundaa: Bunda blg depan rumah ya
```

---

## 5.9 Toolbar Popup

Click the **WA Message Reader** icon in the Chrome toolbar for a quick-reference popup with a shortcut to open `web.whatsapp.com`.

---

## 5.10 Uninstalling

Go to `chrome://extensions` → find **WA Message Reader** → click **Remove**. No data is left behind (everything is session-memory only).

---

## 5.11 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Panel does not appear | Extension not loaded or tab opened before install | Reload the `web.whatsapp.com` tab |
| Messages show `"Them"` instead of real name | Group system messages lack sender in `data-pre-plain-text` | Expected behavior |
| `"You"` label on all outgoing messages | Outgoing bubbles omit sender in `data-pre-plain-text` | Expected behavior |
| Panel empty after Re-scan | All visible bubbles already in WeakSet | Scroll to load more history, then Re-scan |
| No messages after Clear + Re-scan | WeakSet persists across the clear | Refresh the WA tab to fully reset |
| Media / sticker / voice not shown | No text node — intentionally skipped | Expected — text-only extraction |
| Extension icon missing from toolbar | Moved to extensions menu | Click puzzle-piece icon → pin WA Message Reader |

---

## 5.12 Privacy & Security

- Declares **zero sensitive permissions** (`permissions: []`).
- Runs **only on `https://web.whatsapp.com/`** via `host_permissions`.
- **No data is sent anywhere** — no network requests, no remote servers, no analytics.
- All extracted text lives in browser memory for the tab session only and is discarded on tab close or navigation.
- The extension **cannot send messages** or interact with WhatsApp's backend in any way.
