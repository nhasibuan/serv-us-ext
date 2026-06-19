/* ============================================================
   WA Message Reader — content script  v1.1
   Runs ON TOP of the real https://web.whatsapp.com/ page.
   It reads message text straight from the WhatsApp DOM
   (the same document — no iframe possible due to X-Frame-Options/CSP)
   and renders results in an injected overlay panel ("Frame 2").

   v1.1 fixes:
     1. console.log now includes [time] to match README / copyAll() format
     2. Outgoing detection uses data-id^="true_" (stable) not message-out class
     3. MutationObserver debounced via requestAnimationFrame
     4. manifest permissions trimmed to [] (activeTab+storage unused)
     5. Media/sticker/emoji skip is intentional — comment added
   ============================================================ */

(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────
  const ROOT_ID   = 'wa-reader-root';
  const PANEL_ID  = 'wa-reader-panel';
  const BODY_ID   = 'wa-reader-body';
  const COUNT_ID  = 'wa-reader-count';
  const SEARCH_ID = 'wa-reader-search';
  const STATUS_ID = 'wa-reader-status';

  // ── State ──────────────────────────────────────────────────────────
  const SEEN     = new WeakSet();   // idempotency guard; GC-safe
  const messages = [];              // session log — never persisted
  let   observer = null;
  let   rafPending = false;         // RAF debounce gate

  // ── Utility ────────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── DOM Selectors ──────────────────────────────────────────────────
  /** Returns all message bubble containers visible in the current chat. */
  function getMessageContainers() {
    // Priority 1: stable data-testid (present in most WA builds)
    let nodes = document.querySelectorAll('[data-testid="msg-container"]');
    if (nodes.length) return nodes;
    // Priority 2: semi-stable class names
    nodes = document.querySelectorAll('div.message-in, div.message-out');
    if (nodes.length) return nodes;
    // Priority 3: broadest fallback
    return document.querySelectorAll('[data-pre-plain-text]');
  }

  /** Extracts plain message text from a bubble container. */
  function extractText(container) {
    // Priority 1: stable data-testid text node
    const sel = container.querySelector('[data-testid="selectable-text"]');
    if (sel && sel.innerText.trim()) return sel.innerText.trim();
    // Priority 2: span with selectable-text class
    const sel2 = container.querySelector('span.selectable-text');
    if (sel2 && sel2.innerText.trim()) return sel2.innerText.trim();
    // Priority 3: .copyable-text span.selectable-text
    const sel3 = container.querySelector('.copyable-text span.selectable-text');
    if (sel3 && sel3.innerText.trim()) return sel3.innerText.trim();
    // Priority 4: loosest fallback
    const sel4 = container.querySelector('.copyable-text span');
    if (sel4 && sel4.innerText.trim()) return sel4.innerText.trim();
    // Returns "" for media, stickers, voice, emoji-only — intentionally skipped
    return '';
  }

  /**
   * Extracts { time, sender, outgoing } from a bubble container.
   * Primary source: data-pre-plain-text="[8:19 PM, 6/13/2026] bundaa: "
   * Outgoing flag:  data-id^="true_" on the ancestor list row (stable across builds)
   */
  function extractMeta(container) {
    let time = '', sender = '', outgoing = false;

    // --- sender + time from data-pre-plain-text ---
    const meta = container.querySelector('[data-pre-plain-text]');
    if (meta) {
      const raw = meta.getAttribute('data-pre-plain-text') || '';
      // Format: "[8:19 PM, 6/13/2026] bundaa: "
      const m = raw.match(/^\[(.*)\]\s*(.*?):\s*$/);
      if (m) {
        time   = m[1].trim();
        sender = m[2].trim();
      }
    }

    // --- outgoing detection: data-id^="true_" is stable across WA obfuscated builds ---
    const listRow = container.closest('[data-id^="true_"]') ||
                    container.closest('div[data-id]');
    if (listRow) {
      outgoing = (listRow.getAttribute('data-id') || '').startsWith('true_');
    } else {
      // Last-resort fallback to obfuscated class (may not exist)
      outgoing = !!(container.matches?.('div.message-out') ||
                    container.closest?.('div.message-out'));
    }

    // Derive sender label when data-pre-plain-text is absent
    if (!sender) sender = outgoing ? 'You' : 'Them';

    return { time, sender, outgoing };
  }

  // ── Processing ─────────────────────────────────────────────────────
  function processContainer(container) {
    if (SEEN.has(container)) return;

    const text = extractText(container);
    // Empty text = media / sticker / voice / emoji-only — skip intentionally
    if (!text) return;

    SEEN.add(container);

    const { time, sender, outgoing } = extractMeta(container);
    const msg = { text, sender, time, outgoing, ts: Date.now() };
    messages.push(msg);

    // FIX #1: console output matches README and copyAll() format: [time] sender: text
    console.log(
      `%c[WA Reader] ${time ? `[${time}] ` : ''}${sender ? sender + ': ' : ''}${text}`,
      'color:#25d366'
    );

    renderRow(msg);
  }

  function scanAll() {
    const containers = getMessageContainers();
    containers.forEach(processContainer);
    updateCount();
  }

  // ── MutationObserver (RAF-debounced) ───────────────────────────────
  // FIX #3: WhatsApp mutates document.body constantly (typing indicators,
  // presence, etc.). The RAF gate coalesces all mutations in one frame
  // into a single scanAll() call — zero-cost when idle.
  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(() => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        scanAll();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── Panel UI ───────────────────────────────────────────────────────
  function buildPanel() {
    if (document.getElementById(ROOT_ID)) return;

    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = `
      <button id="wa-reader-fab" aria-label="Toggle WA Message Reader">
        <span class="wa-reader-fab-dot"></span>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </button>

      <section id="${PANEL_ID}" role="complementary" aria-label="WA Message Reader Panel">
        <header class="wa-reader-head">
          <div class="wa-reader-title">
            <div class="wa-reader-logo" aria-hidden="true">WA</div>
            <div>
              <h1>Message Reader</h1>
              <p>
                <span id="${STATUS_ID}" class="wa-reader-statusdot" aria-label="Live"></span>
                Live · <span id="${COUNT_ID}" class="wa-reader-count">0</span>
              </p>
            </div>
          </div>
          <div class="wa-reader-head-actions">
            <button id="wa-reader-close" class="wa-reader-iconbtn" aria-label="Close panel" title="Close">&times;</button>
          </div>
        </header>

        <div class="wa-reader-toolbar">
          <input id="${SEARCH_ID}" type="search" placeholder="Filter messages…" aria-label="Filter messages" />
          <button id="wa-reader-rescan" class="wa-reader-btn" title="Re-scan DOM for new messages">Re-scan</button>
          <button id="wa-reader-copy"   class="wa-reader-btn" title="Copy all to clipboard">Copy all</button>
          <button id="wa-reader-clear"  class="wa-reader-btn ghost" title="Clear session log">Clear</button>
        </div>

        <div id="${BODY_ID}" class="wa-reader-body" role="log" aria-live="polite" aria-label="Extracted messages">
          <div class="wa-reader-empty">Open a chat — messages will appear here automatically.</div>
        </div>
      </section>
    `;

    document.body.appendChild(root);
    attachEvents();
  }

  function attachEvents() {
    const fab    = document.getElementById('wa-reader-fab');
    const panel  = document.getElementById(PANEL_ID);
    const close  = document.getElementById('wa-reader-close');
    const search = document.getElementById(SEARCH_ID);
    const rescan = document.getElementById('wa-reader-rescan');
    const copy   = document.getElementById('wa-reader-copy');
    const clear  = document.getElementById('wa-reader-clear');

    fab.addEventListener('click', () => {
      const open = panel.classList.toggle('open');
      if (open) scanAll();
    });
    close.addEventListener('click', () => panel.classList.remove('open'));
    search.addEventListener('input', applyFilter);
    rescan.addEventListener('click', scanAll);
    copy.addEventListener('click', copyAll);
    clear.addEventListener('click', clearAll);
  }

  function renderRow(msg) {
    const body = document.getElementById(BODY_ID);
    if (!body) return;

    // Remove empty-state placeholder on first message
    const empty = body.querySelector('.wa-reader-empty');
    if (empty) empty.remove();

    const row = document.createElement('div');
    row.className = 'wa-reader-row' + (msg.outgoing ? ' out' : '');
    row.innerHTML = `
      <div class="wa-reader-row-meta">
        <span class="wa-reader-sender">${escapeHtml(msg.sender)}</span>
        <span class="wa-reader-time">${escapeHtml(msg.time)}</span>
      </div>
      <div class="wa-reader-text">${escapeHtml(msg.text)}</div>
    `;
    body.appendChild(row);
    body.scrollTop = body.scrollHeight;
  }

  function applyFilter() {
    const q = (document.getElementById(SEARCH_ID)?.value || '').toLowerCase();
    document.querySelectorAll(`#${BODY_ID} .wa-reader-row`).forEach(row => {
      const text   = row.querySelector('.wa-reader-text')?.textContent  || '';
      const sender = row.querySelector('.wa-reader-sender')?.textContent || '';
      row.style.display = (!q || text.toLowerCase().includes(q) || sender.toLowerCase().includes(q))
        ? '' : 'none';
    });
  }

  function updateCount() {
    const el = document.getElementById(COUNT_ID);
    if (el) el.textContent = messages.length;
  }

  function flashStatus() {
    const dot = document.getElementById(STATUS_ID);
    if (!dot) return;
    dot.classList.add('flash');
    setTimeout(() => dot.classList.remove('flash'), 600);
  }

  function copyAll() {
    if (!messages.length) return;
    const text = messages
      .map(m => `${m.time ? `[${m.time}] ` : ''}${m.sender ? m.sender + ': ' : ''}${m.text}`)
      .join('\n');
    navigator.clipboard.writeText(text).then(flashStatus);
  }

  function clearAll() {
    messages.length = 0;
    const body = document.getElementById(BODY_ID);
    if (body) {
      body.innerHTML = '<div class="wa-reader-empty">Cleared. Re-scan or scroll to reload.</div>';
    }
    updateCount();
    // Note: WeakSet (SEEN) is NOT cleared — refresh the tab to fully reset.
  }

  // ── Boot ───────────────────────────────────────────────────────────
  // WhatsApp Web is a SPA; the chat UI loads asynchronously.
  // Poll until document.body is ready, then inject once.
  function init() {
    if (!document.body) return;
    buildPanel();
    scanAll();
    startObserver();
  }

  const boot = setInterval(() => {
    if (document.body) {
      clearInterval(boot);
      init();
    }
  }, 300);

})();
