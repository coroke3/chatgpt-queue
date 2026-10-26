/**
 * ChatGPT Queue Assistant - Content Script
 * Supports independent per-tab queues (multiple tabs running in parallel),
 * real-time dashboard registry reporting, background tab execution,
 * Enter to Queue (Shift+Enter for newline), bulletproof generation detection,
 * realistic human typing with typo simulation, full IME protection,
 * and seamless dark/light theme switching.
 */

(() => {
  'use strict';

  // Prevent multiple injections
  if (window.__CHATGPT_QUEUE_LOADED__) return;
  window.__CHATGPT_QUEUE_LOADED__ = true;

  // Platform Detection (ChatGPT vs Google Gemini)
  const IS_GEMINI = window.location.hostname.includes('gemini.google.com');
  const IS_CHATGPT = window.location.hostname.includes('chatgpt.com') || window.location.hostname.includes('openai.com');
  const PLATFORM_ID = IS_GEMINI ? 'gemini' : 'chatgpt';
  const modelPicker = new CGQServiceModelPicker(PLATFORM_ID);
  const composerTools = new CGQComposerTools.NativeTools(PLATFORM_ID, {
    getInput: () => DOM.getPromptInput(),
    setText: (input, text, tokens) => HumanSimulator.setDOMContent(input, text, tokens)
  });

  // ==========================================================================
  // Per-Tab & Per-Conversation Identification (Dynamic & URL-Aware)
  // ==========================================================================

  let sessionTabId = sessionStorage.getItem('cgq_tab_id');
  if (!sessionTabId) {
    sessionTabId = 'tab_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
    sessionStorage.setItem('cgq_tab_id', sessionTabId);
  }
  const SESSION_TAB_ID = sessionTabId;

  function extractConversationId(urlStr) {
    try {
      const url = new URL(urlStr || window.location.href);
      const pathname = url.pathname;
      
      if (IS_GEMINI) {
        // 1. Gemini: /app/c/<id>
        const matchAC = pathname.match(/\/app\/c\/([a-zA-Z0-9_-]+)/);
        if (matchAC) return matchAC[1];

        // 2. Gemini: /app/<id> (where id is at least 5 alphanumeric chars)
        const matchA = pathname.match(/\/app\/([a-zA-Z0-9_-]{5,})/);
        if (matchA) return matchA[1];

        // 3. Gemini: /share/<id>
        const matchS = pathname.match(/\/share\/([a-zA-Z0-9_-]+)/);
        if (matchS) return matchS[1];

        return 'new';
      }

      // ChatGPT
      const matchC = pathname.match(/\/c\/([a-zA-Z0-9_-]+)/);
      if (matchC) return matchC[1];

      const matchGC = pathname.match(/\/g\/([a-zA-Z0-9_-]+)\/c\/([a-zA-Z0-9_-]+)/);
      if (matchGC) return matchGC[2];

      const matchG = pathname.match(/\/g\/([a-zA-Z0-9_-]+)/);
      if (matchG) return 'gpt_' + matchG[1];

      return 'new';
    } catch (e) {
      return 'new';
    }
  }

  function computeTabId(sessionTabId, convId) {
    if (!convId || convId === 'new') {
      return `${sessionTabId}_new`;
    }
    return `${sessionTabId}_c_${convId}`;
  }

  // ==========================================================================
  // Constants & Storage Keys
  // ==========================================================================

  const STORAGE_KEY_REGISTRY = 'cgq_tabs_registry';
  const STORAGE_KEY_SETTINGS = 'cgq_user_settings';
  const STORAGE_KEY_UI_STATE = 'cgq_ui_state';
  const SESSION_KEY_TIMEOUT = 'cgq_delivery_timeout_reload';
  const SESSION_KEY_STALL = 'cgq_stalled_send';
  const STALL_MS = 60 * 60 * 1000; // no answer progress this long -> continue in a new chat
  const SESSION_KEY_CHAT_ROLLOVER = 'cgq_chat_rollover';

  const DEFAULT_SETTINGS = {
    enterToQueue: true,         // Queue Manager input preference; native Enter always uses the service.
    minReadDelay: 2.5,          // seconds to wait after ChatGPT completely stops
    maxReadDelay: 4.5,          // seconds
    dynamicDelay: true,         // add slight reading delay for longer prior responses
    continuousFatigue: true,    // fatigue delay scaling when operating continuously
    autoReloadOnDisconnect: true, // reload within 2 minutes if ChatGPT connection is lost
    disconnectReloadTimeout: 120, // 2 minutes in seconds
    typingMode: 'mixed',        // 'mixed' (human typing + occasional paste) | 'human' | 'fast' | 'instant'
    pasteProbability: 'auto',   // 'auto' | 0 | 25 | 50 | 100
    typingSpeed: 45,            // ms per character for human mode
    typingJitter: true,         // add natural cadence randomness
    simulateTypos: true,        // simulate realistic occasional typo & backspace (1.2% chance)
    punctuationPause: true,     // pause slightly at commas, periods, newlines
    preSendDelay: 700,          // ms hesitation before clicking send
    soundNotification: true,    // play subtle chime when queue finishes
    autoScroll: true,           // auto-scroll to latest response
    themeMode: 'auto',          // 'auto' | 'dark' | 'light'
    shortcutKey: 'Alt+Enter',
  };

  const DEFAULT_UI_STATE = {
    minimized: false,
    position: { right: 24, bottom: 84 },
  };

  const QueueState = {
    IDLE: 'idle',
    WAITING_GENERATION: 'waiting_generation',
    READING_DELAY: 'reading_delay',
    TYPING: 'typing',
    PASTING: 'pasting',
    PRE_SEND: 'pre_send',
    PAUSED: 'paused',
    CONNECTION_LOST: 'connection_lost',
  };

  // ==========================================================================
  // Sound Synthesis (Web Audio API)
  // ==========================================================================

  function playChimeSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const now = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(659.25, now);
      gain1.gain.setValueAtTime(0.12, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.35);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880.00, now + 0.12);
      gain2.gain.setValueAtTime(0.12, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.6);
    } catch (e) {}
  }

  // ==========================================================================
  // Helper Utilities
  // ==========================================================================

  // Page chrome that must never be read as conversation content (sidebar, header, composer, our own UI).
  const CHROME_SELECTOR = [
    'nav', 'aside', 'header', 'form', 'rich-textarea',
    'bard-sidenav', 'mat-sidenav',
    '[role="navigation"]', '[role="complementary"]',
    '#prompt-textarea', '#cgq-widget', '#cgq-composer-queue-panel'
  ].join(', ');
  // Progress bar that eases in, fills to 100% when its work ends, then fades out (see .is-visible in styles.css).
  // ChatGPT can keep a hidden copy of a thread (and its composer) mounted after in-app navigation,
  // e.g. /c/<id> -> /g/<project>/c/<id>. Page lookups only consider what is actually rendered.
  // (jsdom has no checkVisibility, so everything counts as shown there.)
  const isShown = el => !!el && (typeof el.checkVisibility !== 'function' || el.checkVisibility());
  const $v = selector => {
    for (const el of document.querySelectorAll(selector)) if (isShown(el)) return el;
    return null;
  };
  const $$v = selector => Array.from(document.querySelectorAll(selector)).filter(isShown);
  // Rich answers (anything Markdown cannot show) are also copied as snapshots for the Queue Manager
  // (snapshot.js). Keys are per turn; the page elements are kept to replay actions from the Queue Manager.
  const SNAP_PREFIX = 'cgq_snap_';
  const snapRoots = new Map(); // snapKey -> [answer root elements]
  const BASIC_COMPONENTS = ['title', 'text', 'code', 'list', 'list-item', 'table', 'table-row', 'table-cell', 'blockquote', 'divider', 'icon'];
  const RICH_ANSWER = IS_GEMINI
    ? 'canvas, iframe, video, info-card, rich-list-card, map-location-reference-link-block, image-gallery, img:not([src^="data:"]):not([width="16"])'
    : `[data-d-component]${BASIC_COMPONENTS.map(c => `:not([data-d-component="${c}"])`).join('')}, canvas, iframe, video`;
  const isRich = root => !!root && (root.matches(RICH_ANSWER) || !!root.querySelector(RICH_ANSWER));
  const rememberSnapRoots = (key, roots) => {
    const list = roots.filter(Boolean);
    if (key && list.some(isRich)) { snapRoots.set(key, list); return true; }
    snapRoots.delete(key);
    return false;
  };
  // Cheap fingerprint of what a snapshot would show: text, structure and control states.
  const snapSignature = root => [
    root.textContent.length,
    root.getElementsByTagName('*').length,
    root.querySelectorAll('[aria-checked="true"], [aria-pressed="true"], [aria-selected="true"], [aria-expanded="true"], ' +
      '[data-state="checked"], [data-state="on"], [data-state="open"], [data-state="active"]').length,
    Array.from(root.querySelectorAll('input, textarea, select'), el => el.value).join('\u0001'),
    Array.from(root.querySelectorAll('img'), img => img.complete ? 1 : 0).join('')
  ].join(':');

  const setProgress = (track, fill, visible, percent) => {
    if (!track || !fill) return;
    if (visible && !track.classList.contains('is-visible')) {
      fill.style.transition = 'none'; // restart from 0 without animating backwards
      fill.style.width = '0%';
      void fill.offsetWidth;
      fill.style.transition = '';
    }
    track.classList.toggle('is-visible', visible);
    fill.style.width = `${visible ? Math.max(0, Math.min(100, percent || 0)) : 100}%`;
  };
  const DRAFT_IDLE_MS = 3000; // a user draft unchanged this long is sent before the next queued item
  // The same turn can be read twice with small differences (another root element, whitespace, sources
  // added after it finished). Compare by the prompt, or by the start of the answer when a prompt is missing.
  const turnText = value => String(value || '').replace(/[\s*_`#>|\-]+/g, ' ').trim();
  const sameTurn = (a, b) => {
    const pa = turnText(a?.prompt), pb = turnText(b?.prompt);
    if (pa && pb) return pa === pb && (!a.answer || !b.answer || turnText(a.answer).slice(0, 120) === turnText(b.answer).slice(0, 120) ||
      turnText(a.answer).startsWith(turnText(b.answer).slice(0, 60)) || turnText(b.answer).startsWith(turnText(a.answer).slice(0, 60)));
    const aa = turnText(a?.answer).slice(0, 120), ab = turnText(b?.answer).slice(0, 120);
    return !!aa && aa === ab;
  };
  // Collapse a turn repeated back to back (keep the later, fuller reading).
  const dropRepeatedTurns = list => list.reduce((out, qa) => {
    const prev = out[out.length - 1];
    if (prev && sameTurn(prev, qa)) out[out.length - 1] = { ...prev, ...qa, prompt: qa.prompt || prev.prompt, answer: qa.answer || prev.answer };
    else out.push(qa);
    return out;
  }, []);
  // Gemini's thinking levels (in its model menu: 思考レベル), keyed by the queue's effort ids.
  const GEMINI_MODE_PICKER = '[data-test-id="bard-mode-menu-button"]';
  const GEMINI_THINKING_LABELS = { low: ['低', 'Low'], medium: ['標準', 'Standard', 'Medium'], high: ['高', 'High'] };
  let geminiThinkingCache = null;
  const normalizeDraft = value => String(value || '').replace(/\s+/g, ' ').trim();
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  function generateId() {
    return 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
  }

  function escapeHtml(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return str.replace(/[&<>"']/g, m => map[m]);
  }

  function showToast(message, duration = 2800) {
    let container = document.getElementById('cgq-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'cgq-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'cgq-toast';
    toast.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="16" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12.01" y2="8"></line>
      </svg>
      <span>${escapeHtml(message)}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px) scale(0.95)';
      setTimeout(() => toast.remove(), 260);
    }, duration);
  }

  const KEYBOARD_NEIGHBORS = {
    'a': 'qwsz', 'b': 'vghn', 'c': 'xdfv', 'd': 'ersfxc', 'e': 'wsdr',
    'f': 'rtgvcd', 'g': 'tyhbvf', 'h': 'yujnbg', 'i': 'ujko', 'j': 'uikmnh',
    'k': 'ijolm', 'l': 'okp', 'm': 'njk', 'n': 'bhjm', 'o': 'iklp',
    'p': 'ol', 'q': 'wa', 'r': 'edft', 's': 'wedxza', 't': 'rfgy',
    'u': 'yhji', 'v': 'cfgb', 'w': 'qase', 'x': 'zsdc', 'y': 'tghu', 'z': 'asx',
    'あ': 'いお', 'か': 'きく', 'さ': 'しす', 'た': 'ちつ', 'な': 'にぬ',
  };

  // ==========================================================================
  // ChatGPT & Gemini DOM Detectors & Interactors
  // ==========================================================================

  const DOM = {
    getPromptInput() {
      if (IS_GEMINI) {
        return (
          $v('rich-textarea [contenteditable="true"]') ||
          $v('.ql-editor[contenteditable="true"]') ||
          $v('div[contenteditable="true"][aria-label*="prompt" i]') ||
          $v('div[contenteditable="true"][aria-label*="プロンプト" i]') ||
          $v('div[contenteditable="true"][role="textbox"]') ||
          $v('rich-textarea') ||
          $v('textarea')
        );
      }
      return (
        $v('#prompt-textarea') ||
        $v('div[contenteditable="true"][role="textbox"]') ||
        $v('textarea[data-id="root"]') ||
        $v('form textarea')
      );
    },

    getSendButton() {
      if (IS_GEMINI) {
        return (
          $v('button[aria-label*="Send message" i]') ||
          $v('button[aria-label*="Send prompt" i]') ||
          $v('button[aria-label*="プロンプトを送信" i]') ||
          $v('button[aria-label*="メッセージを送信" i]') ||
          $v('button[aria-label*="送信" i]') ||
          $v('button.send-button') ||
          $v('button[mattooltip*="Send" i]') ||
          $v('button[mattooltip*="送信" i]') ||
          $v('button[aria-label*="Send" i]')
        );
      }
      return (
        $v('button[data-testid="send-button"]') ||
        $v('button[data-testid="fruitjuice-send-button"]') ||
        $v('button[data-testid*="send" i]') ||
        $v('#composer-submit-button button') ||
        $v('#composer-submit-button') ||
        $v('button[aria-label*="Send prompt" i]') ||
        $v('button[aria-label*="プロンプトを送信" i]') ||
        $v('button[aria-label*="メッセージを送信" i]') ||
        $v('button[aria-label*="Send" i]') ||
        $v('button[aria-label*="送信" i]') ||
        $v('form button[type="submit"]')
      );
    },

    getQueueButtonPlacement() {
      const input = this.getPromptInput();
      if (IS_GEMINI && input) {
        // Gemini swaps microphone/send custom elements when the editor becomes empty.
        // Put our entry point in the persistent toolbar, outside those custom elements.
        const composer = input.closest('.text-input-field, input-area, input-container');
        const toolbar = composer?.querySelector('.input-buttons-wrapper-bottom') ||
          composer?.querySelector('.trailing-actions-wrapper');
        if (toolbar) return { parent: toolbar, before: toolbar.firstElementChild };
      }
      const send = this.getSendButton();
      const host = IS_GEMINI ? send?.closest('gem-icon-button') || send : send;
      if (host?.parentElement) return { parent: host.parentElement, before: host };
      // No send button right now (ChatGPT swaps it out while the input is empty):
      // anchor after the composer's last visible button so the Queue entry point never disappears.
      const form = input?.closest('form, input-container, input-area');
      const buttons = Array.from(form?.querySelectorAll('button') || [])
        .filter(b => !b.id.startsWith('cgq-injected') && b.offsetParent !== null && b.parentElement);
      const last = buttons[buttons.length - 1];
      return last ? { parent: last.parentElement, before: last.nextElementSibling } : null;
    },

    getResearchPlanAction() {
      const roots = $$v(IS_GEMINI ? 'model-response' : '[data-turn-key], [data-testid^="conversation-turn-"], [data-message-author-role="assistant"]');
      const latest = roots[roots.length - 1];
      return Array.from(latest?.querySelectorAll('button') || []).find(button =>
        isShown(button) && !button.closest('[hidden], [inert], [aria-hidden="true"]') && !button.disabled && button.getAttribute('aria-disabled') !== 'true' &&
        /^(?:Start research|Start researching|リサーチを開始|調査を開始|研究を開始)$/i.test(
          (button.getAttribute('aria-label') || button.innerText || button.textContent || '').trim())) || null;
    },

    isGenerating() {
      if (IS_GEMINI) {
        const stopBtn = (
          $v('button[aria-label*="Stop response" i]') ||
          $v('button[aria-label*="Stop" i]') ||
          $v('button[aria-label*="停止" i]') ||
          $v('button[aria-label*="中断" i]') ||
          $v('button.stop-button') ||
          $v('[aria-busy="true"] button')
        );
        if (stopBtn) return true;

        if (
          $v('.sparkle-animating') ||
          $v('.loading-spinner') ||
          $v('mat-progress-bar') ||
          $v('[data-is-generating="true"]') ||
          $v('div.response-streaming') ||
          $v('[aria-label*="Thinking" i]') ||
          $v('[aria-label*="思考中" i]') ||
          $v('model-response[aria-busy="true"], .model-response-label-announcer[aria-busy="true"]')
        ) {
          return true;
        }

        const cursors = $$v('.typing-cursor, .blinking-cursor, model-response .cursor');
        if (cursors.length > 0) return true;

        return false;
      }

      // 1. Explicit stop buttons
      const stopBtn = (
        $v('button[data-testid="stop-button"]') ||
        $v('button[data-testid*="stop" i]') ||
        $v('button[aria-label*="Stop" i]') ||
        $v('button[aria-label*="停止"]') ||
        $v('button[aria-label*="中断"]') ||
        $v('button[aria-label*="ストップ"]') ||
        $v('button[aria-label*="生成を停止"]') ||
        $v('button[aria-label*="streaming" i]') ||
        $v('button[aria-label*="generating" i]') ||
        $v('button[aria-label*="Thinking" i]') ||
        $v('button[aria-label*="思考中" i]')
      );
      if (stopBtn) return true;

      // 2. SVG Stop square inside submit or send buttons
      const stopSvgRect = $v(
        'button[data-testid="send-button"] rect, ' +
        'button[data-testid*="send" i] rect, ' +
        '#composer-submit-button rect, ' +
        'button[aria-label*="Stop" i] rect'
      );
      if (stopSvgRect) return true;

      // 3. Streaming and thinking DOM flags
      if (
        $v('.result-streaming') ||
        $v('[data-is-streaming="true"]') ||
        $v('.result-thinking') ||
        $v('[data-testid*="streaming"]') ||
        $v('[class*="AdaptiveStreaming"]') ||
        $v('[class*="Streaming"]') ||
        $v('[data-talvt-turn-state="in-progress"]') ||
        $v('[data-turn-state="in-progress"]')
      ) {
        return true;
      }

      // 4. Assistant message cursor or agent turn cursor
      const cursors = $$v(
        'div[data-message-author-role="assistant"] .cursor, ' +
        'div.agent-turn .cursor, ' +
        '.markdown .cursor'
      );
      if (cursors.length > 0) {
        return true;
      }

      return false;
    },

    // ChatGPT's activity block above an answer, measured 2026-10: a header row whose first child is
    // button[aria-expanded] (no aria-label), with the label beside it (「思考中」 / 「3件のサイトを検索中」
    // while working, with a shimmer; 「1m 27s考えました」 afterwards), followed by the log: step titles
    // (data-markdown-text-tone="tertiary") and short assistant notes. The log stays in the DOM when collapsed.
    thinkingHeader(turn) {
      return Array.from(turn?.querySelectorAll('button[aria-expanded]:not([aria-label])') || [])
        .find(b => !b.closest('[data-user-message-bubble], [class*="MarkdownRoot"], [id^="cgq-"], form') &&
          b.parentElement?.parentElement) || null;
    },

    // True for answer-looking nodes that belong to the activity log rather than the answer.
    inThinking(node) {
      for (let el = node.parentElement; el && !el.matches('[data-turn-key], article, main, body'); el = el.parentElement) {
        const row = el.firstElementChild;
        if (row && row !== node && !row.contains(node) && row.querySelector(':scope > button[aria-expanded]:not([aria-label])')) return true;
      }
      return false;
    },

    getThinking(turn) {
      if (!IS_CHATGPT) return null;
      const header = this.thinkingHeader(turn);
      if (!header) return null;
      const row = header.parentElement;
      const box = row.parentElement;
      const copy = row.cloneNode(true);
      copy.querySelectorAll('svg, [aria-hidden="true"], [class*="Sweep"], [class*="sweep"]').forEach(n => n.remove());
      let label = (copy.textContent || '').replace(/\s+/g, ' ').trim();
      const half = label.length / 2;
      if (half && label.slice(0, half) === label.slice(half)) label = label.slice(0, half); // shimmer layers repeat the text
      const body = Array.from(box.children).find(child => child !== row);
      const log = [];
      if (body) {
        const roots = Array.from(body.querySelectorAll('[class*="MarkdownRoot"]'))
          .filter((n, i, all) => !all.some((o, j) => j !== i && o.contains(n)));
        for (const root of roots.slice(-30)) {
          const step = root.getAttribute('data-markdown-text-tone') === 'tertiary';
          const text = step ? (root.textContent || '').replace(/\s+/g, ' ').trim() : DOM.domToMarkdown(root).replace(/\n{3,}/g, '\n\n').trim();
          if (text) log.push({ kind: step ? 'step' : 'text', text: text.slice(0, 2000) });
        }
      }
      const skip = Array.from(turn.querySelectorAll('button, a')).find(b =>
        /^(スキップ|Skip)$/i.test((b.textContent || '').trim()) && !b.closest('[data-user-message-bubble], [class*="MarkdownRoot"]'));
      if (!label && !log.length) return null;
      return {
        label: label.slice(0, 120),
        active: !!row.querySelector('[class*="Shimmer"], [class*="shimmer"]'),
        expanded: header.getAttribute('aria-expanded') === 'true',
        canSkip: !!skip && isShown(skip),
        log
      };
    },

    skipThinking() {
      const turns = $$v('[data-turn-key], [data-testid^="conversation-turn-"]');
      const turn = turns[turns.length - 1];
      const skip = turn && Array.from(turn.querySelectorAll('button, a')).find(b => /^(スキップ|Skip)$/i.test((b.textContent || '').trim()) && isShown(b));
      if (!skip) return false;
      skip.click();
      return true;
    },

    // The latest turn while ChatGPT works on it: its activity block and a status line
    // (「接続が途切れました。回答全体の受信を待っています」). The screen-reader-only busy text is not a notice.
    getProgress() {
      if (!IS_CHATGPT || !this.isGenerating()) return null;
      const selector = '[data-turn-key], [data-testid^="conversation-turn-"]';
      const turns = $$v(selector).filter(n => !n.parentElement?.closest(selector));
      const turn = turns[turns.length - 1];
      if (!turn) return null;
      const thinking = this.getThinking(turn);
      const status = Array.from(turn.querySelectorAll('[role="status"]')).find(el => !el.matches('[aria-busy="true"]'));
      const notice = (status?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160);
      return { label: thinking?.label || '', notice, thinking };
    },

    getConversationLimitWarning() {
      if (!IS_CHATGPT) return null;
      // Cheap pre-check: skip the element scan unless the wording is on the page at all.
      if (!/長さの上限|maximum length|length limit|reached the limit/i.test(document.body?.textContent || '')) return null;
      const excluded = 'pre, code, .markdown, [data-message-author-role], [data-user-message-bubble], ' +
        '[id^="cgq-"], [class^="cgq-"], [hidden], [inert], [aria-hidden="true"]';
      // Include notices outside <main> (for example, a portal-rendered alert).
      const candidates = $$v('[role="alert"], [role="status"], [data-testid*="error"], ' +
        '[class*="SurfaceError"], [class*="SurfaceWarning"], main div, main p, main span');
      for (const el of candidates) {
        if (el.closest(excluded)) continue;
        // Never match a container whose text includes quoted conversation content.
        if (el.querySelector(excluded)) continue;
        if (el.children.length > 2 && !el.matches('[role="alert"], [role="status"]')) continue;
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!(/この会話は長さの上限に(?:到達|達)しています/.test(text) ||
          /(?:you(?:'|’)ve reached the maximum length for this conversation|this conversation (?:has reached|is at) (?:the|its) (?:maximum )?(?:length )?limit)/i.test(text))) continue;
        let visible = true;
        for (let parent = el; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden') { visible = false; break; }
        }
        if (visible) return el;
      }
      return null;
    },

    // ChatGPT's "メッセージの配信がタイムアウトしました。もう一度お試しください。" in an alert or the latest turn.
    hasDeliveryTimeout() {
      const pattern = /メッセージの配信がタイムアウトしました|message delivery timed out/i;
      if (!pattern.test(document.body?.textContent || '')) return false;
      const turns = $$v('article, [data-testid^="conversation-turn"]');
      const scopes = [...$$v('[role="alert"], [role="status"], [class*="toast"], [data-testid*="error"]'), turns[turns.length - 1]];
      // Ignore the same words quoted in a prompt, in code, or in our own UI.
      const ownText = el => {
        const copy = el.cloneNode(true);
        copy.querySelectorAll('pre, code, [data-user-message-bubble], [data-message-author-role="user"], [id^="cgq-"], [class*="cgq-"]').forEach(node => node.remove());
        return copy.textContent || '';
      };
      return scopes.some(el => el && !el.closest('[id^="cgq-"], [class*="cgq-"]') && pattern.test(ownText(el)));
    },

    // A retry button next to an error (alerts or the latest turn), e.g. 「再試行」 / "Retry" / "Try again".
    getRetryButton() {
      const turns = $$v('article, [data-testid^="conversation-turn"]');
      const scopes = [...$$v('[role="alert"], [role="status"], [class*="toast"], [data-testid*="error"]'), turns[turns.length - 1]];
      const pattern = /^(?:再試行|もう一度試す|もう一度お試しください|リトライ|retry|try again)$/i;
      for (const scope of scopes) {
        const button = Array.from(scope?.querySelectorAll('button') || []).find(b => !b.disabled &&
          (pattern.test((b.innerText || b.textContent || '').trim()) || pattern.test((b.getAttribute('aria-label') || '').trim())));
        if (button) return button;
      }
      return null;
    },

    getNewChatUrl() {
      const url = new URL(window.location.href);
      if (IS_GEMINI) {
        const account = url.pathname.match(/^\/u\/\d+/);
        return `${url.origin}${account ? account[0] : ''}/app`;
      }
      // Keep the current project or custom GPT when starting its next chat.
      const gpt = url.pathname.match(/^\/g\/[^/]+/);
      url.pathname = gpt ? gpt[0] : '/';
      url.hash = '';
      return url.href;
    },

    checkConnectionLost() {
      if (IS_GEMINI) return false;
      const root = $v('main') || document.body;
      if (!root) return false;

      // 1. Target alert/banner/toast/error containers
      const alerts = root.querySelectorAll(
        '[role="alert"], [class*="banner"], [class*="alert"], [class*="toast"], ' +
        '[data-testid*="error"], [data-testid*="toast"], [data-testid*="banner"], ' +
        '.text-token-text-error, [class*="SurfaceError"], [class*="SurfaceWarning"]'
      );
      for (const el of alerts) {
        if (el.closest('pre, code, [data-message-author-role="user"]')) continue;
        const text = el.textContent || '';
        if (
          (text.includes('接続が途切れました') && (text.includes('受信を待っています') || text.includes('回答全体の受信') || text.includes('受信待'))) ||
          (/connection\s*(?:lost|interrupted)/i.test(text) && /waiting/i.test(text))
        ) {
          return true;
        }
      }

      // 2. Check the latest assistant turn
      const assistantTurns = root.querySelectorAll('div[data-message-author-role="assistant"], div.agent-turn');
      if (assistantTurns.length > 0) {
        const latest = assistantTurns[assistantTurns.length - 1];
        const walker = document.createTreeWalker(latest, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (node.parentElement?.closest('pre, code')) continue;
          const val = node.textContent || '';
          if (
            (val.includes('接続が途切れました') && (val.includes('受信を待っています') || val.includes('回答全体の受信') || val.includes('受信待'))) ||
            (/connection\s*(?:lost|interrupted)/i.test(val) && /waiting/i.test(val))
          ) {
            return true;
          }
        }
      }

      // 3. Fallback: leaf-level text containers
      const elements = root.querySelectorAll('div, p, span');
      for (const el of elements) {
        if (el.children.length > 2) continue;
        if (el.closest('pre, code, [data-message-author-role="user"]')) continue;
        const text = el.textContent || '';
        if (
          (text.includes('接続が途切れました') && (text.includes('受信を待っています') || text.includes('回答全体の受信') || text.includes('受信待'))) ||
          (/connection\s*(?:lost|interrupted)/i.test(text) && /waiting\s*to\s*receive/i.test(text))
        ) {
          return true;
        }
      }

      return false;
    },

    isSendButtonReady() {
      const sendBtn = this.getSendButton();
      if (!sendBtn) return false;
      if (sendBtn.disabled) return false;
      if (sendBtn.getAttribute('aria-disabled') === 'true') return false;
      return true;
    },

    getComposerText() {
      return composerTools.capture().text;
    },

    clearComposer() {
      const input = this.getPromptInput();
      if (!input) return;

      input.focus();

      if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype,
          'value'
        )?.set;
        if (nativeSetter) {
          nativeSetter.call(input, '');
        } else {
          input.value = '';
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }

      // Explicitly purge all mention and hint token elements from the contenteditable DOM
      try {
        input.querySelectorAll('[app-mention-path], [data-system-hint-type], [data-mention], .app-mention, [data-system-hint], strong').forEach(el => {
          if (el.tagName === 'STRONG' && !/^@\S/.test(el.textContent || '')) return;
          el.remove();
        });
      } catch (e) {}

      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
      } catch (e) {}

      // Always reset contenteditable innerHTML to blank paragraph to ensure no stray atom nodes remain
      input.innerHTML = '<p><br></p>';

      // In Gemini, deselect any active tool mode buttons so they do not leak into future prompts
      if (IS_GEMINI) {
        try {
          const geminiButtons = composerTools.geminiSelected();
          for (const item of geminiButtons) {
            if (item.el && typeof item.el.click === 'function') item.el.click();
          }
        } catch (e) {}
      }

      input.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'deleteContentBackward'
      }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },

    getLastResponseLength() {
      try {
        if (IS_GEMINI) {
          const turns = $$v('model-response, message-content, .model-response-text');
          if (turns.length > 0) {
            return (turns[turns.length - 1].textContent || '').length;
          }
        } else {
          const turnElements = $$v('[data-message-author-role="assistant"], div.agent-turn, div.markdown');
          if (turnElements.length > 0) {
            const lastTurn = turnElements[turnElements.length - 1];
            return (lastTurn.textContent || '').length;
          }
        }
      } catch (e) {}
      return 0;
    },

    getEffortButton() {
      // 1. Target direct reasoning/thinking buttons or pills (ChatGPT & Gemini)
      const direct = $v(
        'button[data-testid="reasoning-effort-button"], [data-testid="reasoning-pill"], ' +
        'button[data-selected-reasoning-effort], button[aria-label*="reasoning" i], ' +
        'button[aria-label*="effort" i], button[aria-label*="思考" i], button[aria-label*="推論" i], ' +
        'button[aria-label*="thinking" i], [data-testid*="thinking" i], [data-test-id*="thinking" i], ' +
        '[data-testid*="reasoning" i], [data-test-id*="reasoning" i], .thinking-level-button, ' +
        'mat-select[aria-label*="思考" i], mat-select[aria-label*="thinking" i], ' +
        'gem-model-thinking-control, .thinking-control, .thinking-pill'
      );
      if (direct) return direct;

      // 2. Gemini thinking level menu item if open or rendered in document
      const menuItems = $$v('[role="menuitem"], [role="option"], mat-option');
      for (const item of menuItems) {
        const text = (item.innerText || item.textContent || '').trim();
        if (/^(?:思考レベル|思考モード|thinking\s*level|thinking\s*budget)$/i.test(text) ||
            (text.includes('思考レベル') || text.includes('Thinking level'))) {
          return item;
        }
      }

      return null;
    },

    getCurrentModelInfo() {
      const info = modelPicker.info();
      const effortBtn = DOM.getEffortButton();
      const isReasoningModel = !!(info.current?.isReasoning || (info.model && /thinking|reasoning|推論|思考/i.test(info.model)));
      // Gemini keeps 思考レベル inside its model menu, so it exists whenever the mode picker does.
      const geminiPicker = IS_GEMINI && $v(GEMINI_MODE_PICKER);
      const hasEffort = !!(effortBtn || geminiPicker || (IS_GEMINI && isReasoningModel));

      let effort = null;
      // On Gemini the 思考レベル menu item only opens the levels; it is never a value itself.
      if (IS_GEMINI && (!effortBtn || effortBtn.matches('[role="menuitem"]'))) {
        effort = DOM.readGeminiThinking() || geminiThinkingCache || 'auto';
      } else if (effortBtn) {
        const explicitEffort = effortBtn.getAttribute('data-selected-reasoning-effort') ||
                               effortBtn.getAttribute('data-effort') ||
                               effortBtn.getAttribute('data-value');
        const effortText = (explicitEffort || effortBtn.getAttribute('aria-label') || effortBtn.innerText || effortBtn.textContent || '').toLowerCase();
        effort = explicitEffort || (/high|高/.test(effortText) ? 'high' :
          /medium|standard|中|標準/.test(effortText) ? 'medium' :
          /instant|インスタント|low|低|即時/.test(effortText) ? (IS_GEMINI ? 'low' : 'instant') :
          /off|none|なし|オフ/.test(effortText) ? 'off' : 'auto');
        if (!IS_GEMINI && effort === 'low') effort = 'instant';
      } else if (hasEffort) {
        effort = 'auto';
      }

      return {
        ...info,
        effort: hasEffort ? effort : null,
        effortLabel: hasEffort ? DOM.formatEffortLabel(effort) : '',
        supportsEffort: hasEffort,
        availableEfforts: hasEffort ? (
          IS_GEMINI ? [
            { id: 'auto', label: 'Auto', title: 'Auto', desc: '現在の思考設定を使用' },
            { id: 'low', label: '低', title: '低', desc: '時間をかけず効率的に' },
            { id: 'medium', label: '標準', title: '標準', desc: 'バランスを取って詳しく' },
            { id: 'high', label: '高', title: '高', desc: '徹底的に詳しく' }
          ] : [
            { id: 'auto', label: 'Auto', title: 'Auto', desc: '現在の思考設定を使用' },
            { id: 'instant', label: 'Instant', title: 'Instant (即時)', desc: '思考時間を抑え即時・高速に回答' },
            { id: 'medium', label: 'Medium', title: '中 (Medium)', desc: '標準的な思考深度と速度のバランス' },
            { id: 'high', label: 'High', title: '高 (High)', desc: '難問・複雑なコーディング向けに最大思考' }
          ]
        ) : []
      };
    },

    formatModelLabel(model) {
      return modelPicker.models.find(entry => entry.id === model)?.label || model || 'Auto';
    },

    formatEffortLabel(effort) {
      switch (effort) {
        case 'instant': return 'Instant';
        case 'off':
        case 'none': return 'Off';
        case 'low': return IS_GEMINI ? 'Low' : 'Instant';
        case 'medium': return 'Medium';
        case 'high': return 'High';
        default: return 'Auto';
      }
    },

    async switchModel(targetModel) {
      await modelPicker.switchTo(targetModel);
      return true;
    },

    // Gemini: the level currently checked in an open 思考レベル submenu (null when it is not open).
    readGeminiThinking() {
      const selected = $v('.cdk-overlay-container .submenu-container [role="menuitem"].selected .label');
      const label = selected?.textContent.trim();
      const id = Object.keys(GEMINI_THINKING_LABELS).find(key => GEMINI_THINKING_LABELS[key].includes(label));
      if (id) geminiThinkingCache = id;
      return id || null;
    },

    // Gemini: mode picker -> 思考レベル -> 低 / 標準 / 高, matched by the exact label only
    // (a loose match on "高" would hit "3.1 Pro 高度な推論" and switch the model instead).
    async switchGeminiThinking(targetEffort) {
      const labels = GEMINI_THINKING_LABELS[targetEffort];
      const picker = $v(GEMINI_MODE_PICKER);
      if (!labels || !picker) return false;
      const overlay = () => $v('.cdk-overlay-container');
      const close = () => {
        if (!overlay()?.querySelector('[role="menu"]')) return;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        overlay()?.querySelector('.cdk-overlay-backdrop')?.click();
      };
      try {
        if (!overlay()?.querySelector('[role="menu"]')) { picker.click(); await sleep(300); }
        const trigger = Array.from(overlay()?.querySelectorAll('[role="menuitem"]') || [])
          .find(item => /思考レベル|thinking level/i.test(item.textContent));
        if (!trigger) { close(); return false; }
        for (const type of ['pointerenter', 'mouseenter', 'mouseover']) trigger.dispatchEvent(new MouseEvent(type, { bubbles: true }));
        trigger.click();
        await sleep(300);
        const option = Array.from(overlay()?.querySelectorAll('.submenu-container [role="menuitem"]') || [])
          .find(item => labels.includes(item.querySelector('.label')?.textContent.trim()));
        if (!option) { close(); return false; }
        option.click();
        geminiThinkingCache = targetEffort;
        await sleep(200);
        close();
        return true;
      } catch (e) {
        console.warn('[ChatGPT Queue] Gemini thinking level switch failed:', e);
        close();
        return false;
      }
    },

    async switchReasoningEffort(targetEffort) {
      if (!targetEffort || targetEffort === 'auto') return false;
      if (IS_GEMINI && $v(GEMINI_MODE_PICKER)) return DOM.switchGeminiThinking(targetEffort);

      try {
        let effortBtn = DOM.getEffortButton();

        // If in Gemini and no direct effort button is visible, try opening the mode menu to reveal it
        if (!effortBtn && IS_GEMINI && typeof modelPicker?.triggers === 'function') {
          const triggers = modelPicker.triggers();
          if (triggers.length > 0) {
            triggers[0].click();
            await sleep(200);
            effortBtn = DOM.getEffortButton();
          }
        }

        if (effortBtn) {
          effortBtn.click();
          await sleep(200);
        }

        const options = Array.from($$v(
          '[role="menuitem"], [role="menuitemradio"], [role="radio"], [role="option"], mat-option, [data-radix-collection-item], button'
        ));

        let matched = null;
        for (const opt of options) {
          const text = (opt.innerText || opt.textContent || '').toLowerCase();
          const aria = (opt.getAttribute('aria-label') || '').toLowerCase();
          const val = (opt.getAttribute('data-value') || opt.getAttribute('data-mode-id') || opt.getAttribute('data-effort') || '').toLowerCase();
          const combined = `${text} ${aria} ${val}`;

          if (targetEffort === 'high' && (combined.includes('high') || combined.includes('高'))) {
            matched = opt;
            break;
          } else if (targetEffort === 'medium' && (combined.includes('medium') || combined.includes('中') || combined.includes('標準') || combined.includes('standard'))) {
            matched = opt;
            break;
          } else if ((targetEffort === 'instant' || targetEffort === 'low') && (combined.includes('instant') || combined.includes('インスタント') || combined.includes('low') || combined.includes('低') || combined.includes('即時'))) {
            matched = opt;
            break;
          } else if ((targetEffort === 'off' || targetEffort === 'none') && (combined.includes('off') || combined.includes('なし') || combined.includes('オフ'))) {
            matched = opt;
            break;
          }
        }

        if (matched) {
          matched.click();
          await sleep(150);
          return true;
        } else {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }
      } catch (e) {
        console.warn('[ChatGPT Queue] switchReasoningEffort error:', e);
      }
      return false;
    },

    domToMarkdown(root) {
      if (!root) return '';
      if (root.nodeType === 3) return root.textContent;
      if (root.nodeType !== 1) return '';

      const tag = root.tagName.toLowerCase();

      if (tag === 'script' || tag === 'style' || tag === 'noscript') return '';
      // Interactive answer widgets (e.g. charts) are carried over as HTML or their sandbox URL.
      if (tag === 'iframe') return CGQReferences.widgetToken(root);
      const isCitation = CGQReferences.isCitationElement(root);
      if (!isCitation && (tag === 'button' || root.matches(
        '.cgq-widget, .cgq-composer-queue-panel, .copy-button, .cdk-visually-hidden, .visually-hidden, .sr-only, response-action-bar, .model-response-label-announcer, [class*="action-bar"], [class*="avatar"], [class*="disclaimer"], [data-test-id*="avatar"], [data-test-id*="disclaimer"], [class*="user-image"], [class*="profile-pic"]'
      ))) return '';

      // Skip small decorative icons that are aria-hidden
      if (!isCitation && (tag === 'svg' || tag === 'mat-icon' || tag === 'i') && root.matches('[aria-hidden="true"]')) {
        return '';
      }

      if (CGQReferences.isSourcesContainer(root)) {
        const sources = Array.from(root.querySelectorAll('a[href]')).map(a => CGQReferences.fromElement(a))
          .filter(source => source.url);
        if (sources.length) return '\n\n' + CGQReferences.token({ sources }) + '\n\n';
      }
      if (isCitation) return ' ' + CGQReferences.token(CGQReferences.fromElement(root)) + ' ';

      // KaTeX Math Formulas
      if (root.classList && root.classList.contains('katex-display')) {
        const annot = root.querySelector('annotation[encoding="application/x-tex"]');
        if (annot) return '\n\n$$\n' + annot.textContent.trim() + '\n$$\n\n';
      }
      if (tag === 'span' && root.classList && root.classList.contains('katex')) {
        const annot = root.querySelector('annotation[encoding="application/x-tex"]');
        if (annot) return '$' + annot.textContent.trim() + '$';
      }

      // DIL (Document Interface Language - ChatGPT Rich Grid, Cards, KPI Metrics, Badges)
      const dComp = root.getAttribute ? root.getAttribute('data-d-component') : null;
      if (dComp === 'grid' || (root.classList && root.classList.contains('Grid-CGRmTR'))) {
        const style = root.getAttribute('style') || '';
        let colStyle = '';
        const matchCols = style.match(/repeat\((\d+)[^)]*\)/);
        if (matchCols) {
          colStyle = `grid-template-columns: repeat(${matchCols[1]}, minmax(0, 1fr));`;
        } else if (style.includes('grid-template-columns')) {
          const m = style.match(/grid-template-columns:\s*([^;]+)/);
          if (m) colStyle = `grid-template-columns: ${m[1]};`;
        }
        if (!colStyle) {
          const childCount = root.children.length;
          const cols = childCount === 3 ? 3 : 2;
          colStyle = `grid-template-columns: repeat(${cols}, minmax(0, 1fr));`;
        }
        const childrenHtml = Array.from(root.children).map(child => DOM.domToMarkdown(child)).join('\n');
        return `\n\n<div class="cgq-dil-grid" style="${colStyle}">\n${childrenHtml}\n</div>\n\n`;
      }

      if (dComp === 'grid-item') {
        return Array.from(root.children).map(DOM.domToMarkdown).join('\n');
      }

      if (dComp === 'box') {
        const isKpi = root.getAttribute('data-d-align') === 'center' ||
                      root.querySelector('h1[data-d-size="xl"], h1[data-d-size="2xl"], [data-d-tabular-nums="true"]');
        if (isKpi) {
          const labelEl = root.querySelector('p, span[data-d-size="xs"], [class*="Text"]');
          const valEl = root.querySelector('h1, h2, [data-d-size="xl"], [data-d-size="2xl"], [data-d-component="title"]');
          const label = labelEl ? labelEl.textContent.trim() : '';
          const val = valEl ? valEl.textContent.trim() : '';
          if (val) {
            return `<div class="cgq-dil-card kpi"><div class="cgq-dil-kpi-label">${label}</div><div class="cgq-dil-kpi-val">${val}</div></div>`;
          }
        }

        if (root.hasAttribute('data-d-has-border') || root.closest('[data-d-component="grid"]')) {
          const svgEl = root.querySelector('svg[data-d-component="icon"], svg');
          let iconHtml = '';
          if (svgEl) {
            iconHtml = `<div class="cgq-dil-card-icon">${svgEl.outerHTML}</div>`;
          }
          const titleEl = root.querySelector('span[data-d-default-strong], strong, b, h1, h2, h3, h4');
          const titleText = titleEl ? titleEl.textContent.trim() : '';
          const descEls = Array.from(root.querySelectorAll('p, span')).filter(el => {
            return el !== titleEl && !el.contains(titleEl) && !titleEl?.contains(el) && el.textContent.trim() !== titleText;
          });
          let descText = '';
          if (descEls.length > 0) {
            const longest = descEls.reduce((a, b) => (a.textContent.length > b.textContent.length ? a : b));
            descText = longest.textContent.trim();
          }
          if (titleText || descText) {
            return `<div class="cgq-dil-card border">${iconHtml}<div class="cgq-dil-card-title">${titleText}</div><div class="cgq-dil-card-desc">${descText}</div></div>`;
          }
          return `<div class="cgq-dil-card border">${iconHtml}${Array.from(root.childNodes).map(DOM.domToMarkdown).join('')}</div>`;
        }
      }

      if (dComp === 'badge' || dComp === 'popover-trigger' || (root.classList && root.classList.contains('Badge-_iijmO'))) {
        const favImg = root.querySelector('img[src*="favicon"], [data-d-component="favicon"] img, img');
        const favSrc = favImg ? (favImg.getAttribute('src') || favImg.src || '') : '';
        const allTextEls = Array.from(root.querySelectorAll('[data-d-component="text"], .Text-lIMP0_, [class*="Text-"]'));
        let textEl = allTextEls.find(el => !el.getAttribute('style')?.includes('color-text-tertiary')) || allTextEls[0];
        let label = textEl ? textEl.textContent.trim() : '';
        const countEl = allTextEls.find(el => el !== textEl && el.getAttribute('style')?.includes('color-text-tertiary')) ||
          root.querySelector('[style*="color-text-tertiary"]');
        let countText = countEl && countEl !== textEl ? countEl.textContent.trim() : '';

        if (!label) {
          label = root.textContent.trim();
        }

        const countMatch = label.match(/\+(\d+)$/);
        if (countMatch) {
          if (!countText) countText = '+' + countMatch[1];
          label = label.slice(0, countMatch.index).trim();
        }

        const anchor = root.matches('a[href]') ? root : root.querySelector('a[href]');
        let href = anchor ? anchor.getAttribute('href') : '';
        if (!href && favSrc) {
          try {
            const u = new URL(favSrc);
            const d = u.searchParams.get('domain');
            if (d && (d.startsWith('http://') || d.startsWith('https://'))) {
              href = d;
            }
          } catch (e) {}
        }

        if (label) {
          const inner = `${favSrc ? `<img class="cgq-dil-badge-fav" src="${favSrc}" alt="" />` : ''}<span class="cgq-dil-badge-label">${label}</span>${countText ? `<span class="cgq-dil-badge-extra">${countText}</span>` : ''}`;
          if (href) {
            return ` <a class="cgq-dil-badge" href="${href}" target="_blank" rel="noopener noreferrer" title="${label}\n${href}">${inner}</a> `;
          }
          return ` <span class="cgq-dil-badge" title="${label}">${inner}</span> `;
        }
      }

      // SVG Diagrams / Shapes
      if (tag === 'svg') {
        if (root.getAttribute('data-d-component') === 'icon' || root.closest('[data-d-component="box"], .cgq-dil-card')) {
          return root.outerHTML;
        }
        const p = root.parentElement;
        if (p && (
          p.tagName.toLowerCase() === 'a' ||
          p.tagName.toLowerCase() === 'button' ||
          p.closest('a, button, [data-testid="citation"], .citation, .grounding-link, [aria-label*="citation"]')
        )) {
          return ''; // Suppress tiny inline citation/button icons from breaking layout
        }
        const w = parseInt(root.getAttribute('width') || '100', 10);
        const h = parseInt(root.getAttribute('height') || '100', 10);
        if (w < 32 && h < 32 && !root.classList.contains('mermaid')) {
          return ''; // Suppress small decorative UI icons
        }
        return '\n\n' + root.outerHTML + '\n\n';
      }

      // Images
      if (tag === 'img') {
        const src = root.src || root.getAttribute('src') || '';
        if (!src) return '';

        // If this image is a favicon, citation icon, or inside an anchor/badge/search result, output inline, NEVER as block image!
        const isFavicon = src.includes('favicons') || src.includes('favicon.ico') || src.includes('s2/favicons') ||
          root.closest('[data-d-component="favicon"], [data-d-component="badge"], [data-d-component="popover-trigger"], .favicon, [class*="favicon"], [class*="citation"], [class*="source"], [class*="grounding"], [class*="badge"], [class*="chip"], sources-carousel, sources-list, .cgq-source-card, .cgq-dil-badge, a') ||
          root.parentElement?.querySelector('a[href]') || root.closest('div, p, li, span')?.querySelector('a[href]');
        if (isFavicon) {
          return `<img class="cgq-dil-badge-fav" src="${src}" alt="" />`;
        }

        const w = parseInt(root.getAttribute('width') || '100', 10);
        const h = parseInt(root.getAttribute('height') || '100', 10);
        if ((w < 24 && h < 24) || (root.classList && root.classList.contains('avatar')) || root.getAttribute('role') === 'presentation') {
          return '';
        }
        if (w <= 48 && h <= 48) {
          return `<img class="cgq-dil-badge-fav" src="${src}" alt="" />`;
        }
        const alt = root.alt || root.getAttribute('alt') || '画像';
        return `\n\n![${alt}](${src})\n\n`;
      }

      // Code blocks (<pre> or containers with code)
      // A code block: <pre>; a box holding one <pre> plus a short header ("JavaScript", copy buttons);
      // or a div that wraps code without a <pre>. None of them may hold other answer content
      // (an answer's outer container also has inline <code> and buttons, and must not match).
      const blockContent = 'p, li, h1, h2, h3, h4, h5, h6, table, blockquote';
      const ownText = node => Array.from(node.childNodes).filter(c => c.nodeType === 3).map(c => c.textContent).join('').trim();
      const pres = tag === 'div' ? root.querySelectorAll('pre') : [];
      const isCodeBox = pres.length === 1 && !root.querySelector(blockContent) &&
        root.textContent.length - pres[0].textContent.length < 40;
      const isCodeDiv = tag === 'div' && !pres.length && root.querySelector('code') && !root.querySelector(blockContent) &&
        (root.className.includes('code') || root.querySelector('button, [class*="copy"]'));
      if (tag === 'pre' || isCodeBox || isCodeDiv) {
        const pre = isCodeBox ? pres[0] : root;
        const codeEl = pre.querySelector('code') || pre;
        let lang = '';
        const cls = (codeEl.className || '') + ' ' + (pre.className || '');
        const m = cls.match(/language-([a-zA-Z0-9_-]+)/);
        if (m) lang = m[1];
        // The header label beside the code ("JavaScript"); never the highlighted tokens inside it.
        if (!lang && tag !== 'pre') {
          const label = Array.from(root.querySelectorAll('*')).find(node => !pre.contains(node) && node !== pre &&
            /^[A-Za-z][\w#+.\- ]{0,20}$/.test(ownText(node)) && !/^(copy|コピー)$/i.test(ownText(node)));
          if (label) lang = ownText(label).toLowerCase();
        }
        const codeText = codeEl.textContent.trim();
        // Auto detect diagram languages if not set or set to generic text
        if (!lang || lang === 'text') {
          if (/^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|xychart-beta|C4Context)\b/m.test(codeText)) {
            lang = 'mermaid';
          }
        }
        return `\n\`\`\`${lang}\n${codeText}\n\`\`\`\n\n`;
      }

      // Code elements (standalone code)
      if (tag === 'code') {
        const parentTag = root.parentElement ? root.parentElement.tagName.toLowerCase() : '';
        if (parentTag === 'pre') return root.textContent;

        const text = root.textContent;
        // If code has multiple lines or diagram syntax, treat as fenced code block
        if (text.includes('\n') || /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart)\b/m.test(text.trim())) {
          let lang = '';
          const m = (root.className || '').match(/language-([a-zA-Z0-9_-]+)/);
          if (m) lang = m[1];
          if (!lang && /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart)\b/m.test(text.trim())) {
            lang = 'mermaid';
          }
          return `\n\`\`\`${lang}\n${text.trim()}\n\`\`\`\n\n`;
        }
        return '`' + text + '`';
      }

      // Table support
      if (tag === 'table') {
        let md = '\n';
        const rows = Array.from(root.querySelectorAll('tr'));
        const cellText = cell => Array.from(cell.childNodes).map(DOM.domToMarkdown).join('')
          .trim().replace(/\n/g, ' ').replace(/\|/g, '\\|');
        let hasHeader = false;
        rows.forEach((row, rIdx) => {
          const ths = Array.from(row.querySelectorAll('th'));
          const tds = Array.from(row.querySelectorAll('td'));
          if (ths.length > 0) {
            hasHeader = true;
            md += '| ' + ths.map(cellText).join(' | ') + ' |\n';
            md += '| ' + ths.map(() => '---').join(' | ') + ' |\n';
          } else if (tds.length > 0) {
            if (rIdx === 0 && !hasHeader) {
              hasHeader = true;
              md += '| ' + tds.map(cellText).join(' | ') + ' |\n';
              md += '| ' + tds.map(() => '---').join(' | ') + ' |\n';
            } else {
              md += '| ' + tds.map(cellText).join(' | ') + ' |\n';
            }
          }
        });
        return md + '\n';
      }

      // Headings
      if (/^h[1-6]$/.test(tag)) {
        const level = parseInt(tag[1], 10);
        return `\n${'#'.repeat(level)} ${Array.from(root.childNodes).map(DOM.domToMarkdown).join('').trim()}\n\n`;
      }

      // Blockquote
      if (tag === 'blockquote') {
        const lines = Array.from(root.childNodes).map(DOM.domToMarkdown).join('').trim().split('\n');
        return '\n' + lines.map(l => '> ' + l).join('\n') + '\n\n';
      }

      // Lists
      if (tag === 'li') {
        const parent = root.parentElement;
        const isOrdered = parent && parent.tagName.toLowerCase() === 'ol';
        const index = parent ? Array.from(parent.children).indexOf(root) + 1 : 1;
        const prefix = isOrdered ? `${index}. ` : '- ';
        return prefix + Array.from(root.childNodes).map(DOM.domToMarkdown).join('').trim() + '\n';
      }

      if (tag === 'ul' || tag === 'ol') {
        let listMd = '\n';
        Array.from(root.children).forEach(child => {
          listMd += DOM.domToMarkdown(child);
        });
        return listMd + '\n';
      }

      // Paragraph
      if (tag === 'p') {
        return '\n' + Array.from(root.childNodes).map(DOM.domToMarkdown).join('') + '\n\n';
      }

      // Bold
      // ChatGPT renders **bold** as <span data-d-default-strong> (or a bold data-d-weight).
      if (tag === 'span' && root.hasAttribute('data-d-inline') &&
        (root.hasAttribute('data-d-default-strong') || /^(?:bold|semibold)$/.test(root.getAttribute('data-d-weight') || ''))) {
        return '**' + Array.from(root.childNodes).map(DOM.domToMarkdown).join('') + '**';
      }
      if (tag === 'strong' || tag === 'b') {
        return '**' + Array.from(root.childNodes).map(DOM.domToMarkdown).join('') + '**';
      }

      // Italic
      if (tag === 'em' || tag === 'i') {
        return '*' + Array.from(root.childNodes).map(DOM.domToMarkdown).join('') + '*';
      }

      // Standard Links
      if (tag === 'a') {
        let href = (root.getAttribute('href') || '').trim();
        if (href && !href.startsWith('http') && !href.startsWith('#')) {
          try {
            href = new URL(href, window.location.origin).href;
          } catch (e) {}
        }
        const linkText = Array.from(root.childNodes).map(DOM.domToMarkdown).join('').trim();
        if (!href) return linkText;
        if (!linkText) return href;
        return `[${linkText}](${href})`;
      }

      return Array.from(root.childNodes).map(DOM.domToMarkdown).join('');
    },

    // Choice widgets inside an answer (radio options + a submit button, e.g. 「修正方針を選択」).
    // Each group is identified by its option labels, so the dashboard can apply a choice later.
    choiceGroups(container) {
      const radios = Array.from(container?.querySelectorAll('input[type="radio"], [role="radio"]') || []);
      const groups = [];
      for (const radio of radios) {
        let box = radio.closest('[role="radiogroup"], fieldset');
        if (!box) {
          for (let node = radio.parentElement; node && node !== container; node = node.parentElement) {
            if (node.querySelectorAll('input[type="radio"], [role="radio"]').length > 1) { box = node; break; }
          }
        }
        box ||= radio.parentElement;
        let group = groups.find(g => g.box === box);
        if (!group) groups.push(group = { box, radios: [] });
        group.radios.push(radio);
      }
      return groups.map(({ box, radios: items }) => {
        const options = items.map(radio => {
          const row = (radio.id && box.ownerDocument.querySelector(`label[for="${CSS.escape(radio.id)}"]`)) ||
            radio.closest('label') || (radio.matches('[role="radio"]') ? radio : radio.parentElement);
          // Title + description: rendered lines when available, otherwise the separate text elements.
          let lines = String(row?.innerText || '').split('\n').map(line => line.trim()).filter(Boolean);
          if (lines.length < 2 && row) {
            const leaves = Array.from(row.querySelectorAll('*'))
              .filter(node => !node.children.length && node !== radio && node.textContent.trim())
              .map(node => node.textContent.trim());
            if (leaves.length) lines = leaves;
          }
          if (!lines.length) lines = [String(row?.textContent || radio.getAttribute('aria-label') || '').trim()];
          const checked = radio.matches('input') ? radio.checked : radio.getAttribute('aria-checked') === 'true';
          return { el: radio, label: lines[0] || radio.getAttribute('aria-label') || '', desc: lines.slice(1).join(' '), checked };
        });
        // The submit button: the last labelled button around the group that is not an option itself.
        const scope = box.closest('form') || box.parentElement || box;
        const submit = Array.from(scope.querySelectorAll('button')).filter(button =>
          !button.matches('[role="radio"]') && !items.some(radio => button.contains(radio) || radio.contains(button)) &&
          (button.innerText || button.textContent || '').trim()).pop() || null;
        const done = items.every(radio => radio.disabled || radio.getAttribute('aria-disabled') === 'true') || !!submit?.disabled;
        return { key: options.map(o => o.label).join('|'), options, submit, done };
      }).filter(g => g.options.length > 1 && g.key.replace(/\|/g, ''));
    },

    extractChoices(container) {
      return this.choiceGroups(container).map(({ key, options, submit, done }) => ({
        key, done,
        options: options.map(({ label, desc, checked }) => ({ label, desc, checked })),
        submitLabel: (submit?.innerText || submit?.textContent || '').trim()
      }));
    },

    async applyChoice(key, optionIndex) {
      const group = this.choiceGroups($v('main') || document.body).reverse().find(g => g.key === key);
      const option = group?.options[optionIndex];
      if (!option || group.done) return false;
      option.el.click();
      await sleep(200);
      if (group.submit && !group.submit.disabled) group.submit.click();
      return true;
    },

    extractAnswerMarkdown(node) {
      if (!node) return '';
      try {
        // Gemini puts a screen-reader heading ("Gemini の回答") inside each response; it is not answer text.
        // Also drop the service's AI disclaimer line ("Gemini は AI であり…" / "can make mistakes").
        const md = DOM.domToMarkdown(node)
          .replace(/^[ \t]*(?:Gemini|ChatGPT)[ \t]*(?:の回答|said)[ \t]*$/gim, '')
          .replace(/^[ \t]*(?:Gemini|ChatGPT)\s*(?:は\s*)?(?:AI\s*です(?:が|から)?|AI\s*であり|can make mistakes).*?(?:不正確|確認してください|重要|チェック).*$/gim, '');
        if (md && md.trim().length > 0) {
          return md.replace(/\n{3,}/g, '\n\n').trim();
        }
      } catch (e) {
        console.warn('[ChatGPT Queue] domToMarkdown error:', e);
      }
      const target = (node.querySelector && (node.querySelector('message-content') || node.querySelector('structured-content-container'))) || node;
      let fallback = (target.textContent || target.innerText || '').trim();
      fallback = fallback
        .replace(/^[ \t]*(Gemini|ChatGPT)[ \t]*(の回答|said)[ \t]*/gm, '')
        .replace(/^.*(?:AI\s*であり.*不正確な情報|can make mistakes).*$/gm, '')
        .trim();
      return fallback;
    },

    cleanUserPrompt(node) {
      if (!node) return '';
      // 1. Direct query line check (Gemini isolates prompt text in .query-text-line)
      const lines = Array.from(node.querySelectorAll('.query-text-line'));
      if (lines.length > 0) {
        const text = lines.map(el => (el.textContent || '').trim()).filter(Boolean).join('\n');
        if (text) return text;
      }
      if (node.classList && node.classList.contains('query-text-line')) {
        const text = (node.textContent || '').trim();
        if (text) return text;
      }

      // 2. Clone and strip headers, screen-reader labels, buttons, toolbars
      const clone = node.cloneNode(true);
      clone.querySelectorAll(
        'h1, h2, h3, h4, h5, h6, .sr-only, .cdk-visually-hidden, ' +
        '[class*="visually-hidden"], [class*="screen-reader"], ' +
        '[aria-hidden="true"], button, [class*="action"], [class*="toolbar"]'
      ).forEach(n => n.remove());

      const ws = clone.querySelector('.whitespace-pre-wrap') || clone;
      let text = (ws.textContent || ws.innerText || '').trim();
      text = text.replace(/^(あなたの(?:プロンプト|発言)|You(?: said)?)[ :：\s]*/i, '').trim();

      // Deduplicate identical repeated halves (e.g. Gemini accessibility mirror)
      if (text.length >= 6) {
        const mid = Math.floor(text.length / 2);
        for (let split = mid - 1; split <= mid + 1; split++) {
          const first = text.slice(0, split).trim();
          const second = text.slice(split).trim();
          if (first && first === second) {
            text = first;
            break;
          }
        }
      }
      return text;
    },

    getLatestAnswer(lastSentPrompt) {
      try {
        const isAnswerNode = node => {
          if (node.closest(CHROME_SELECTOR)) return false;
          if (IS_CHATGPT && DOM.inThinking(node)) return false;
          // The sidebar is never an answer (its profile shows 「プロフィールを読み込み中」 with aria-busy).
          if (node.closest('nav, aside, header, [id^="cgq-"]')) return false;
          if (node.querySelectorAll('a[href*="/app/"], a[href*="/c/"]').length >= 3 && !node.closest('model-response, [data-message-author-role="assistant"], chat-window, article')) return false;
          return true;
        };

        const assistantSelectors = [
          'model-response',
          'message-content',
          '.model-response-text',
          '.response-content',
          '[data-test-id="model-response"]',
          '[data-message-author-role="assistant"]',
          '[data-markdown-text-style="assistant-message"]',
          '[class*="DilResponseRoot"]',
          '[class*="DilRenderer"]',
          '[class*="MarkdownRoot"]',
          '[data-dil-message-id]',
          '.markdown',
          'div.markdown',
          'div.agent-turn',
          '[class*="agent-turn"]',
          'article[data-testid^="conversation-turn-"]',
          'div[data-testid^="conversation-turn-"]',
          'div[data-message-id]'
        ];

        let assistantNodes = Array.from($$v(assistantSelectors.join(', ')));
        if (IS_GEMINI) assistantNodes = assistantNodes.filter(node => node.closest('model-response'));
        assistantNodes = assistantNodes.filter(isAnswerNode);

        let answerText = '';
        let isStreaming = DOM.isGenerating();

        // 1. Look for markdown content or model response
        if (IS_GEMINI) {
          const geminiModels = Array.from($$v('model-response')).filter(isAnswerNode);
          if (geminiModels.length > 0) {
            const lastMR = geminiModels[geminiModels.length - 1];
            answerText = DOM.extractAnswerMarkdown(lastMR);
          }
        } else {
          const markdownEls = Array.from($$v(
            'model-response, message-content, .model-response-text, .markdown, [class*="markdown"], [class*="MarkdownRoot"], [class*="DilResponseRoot"], [class*="DilRenderer"], [data-dil-message-id]'
          )).filter(isAnswerNode);

          if (markdownEls.length > 0) {
            const lastMd = markdownEls[markdownEls.length - 1];
            answerText = DOM.extractAnswerMarkdown(lastMd.closest('model-response, [data-message-author-role="assistant"], [class*="DilResponseRoot"]') || lastMd);
          }
        }

        // 2. Fallback: check last assistant turn element directly
        if (!answerText && assistantNodes.length > 0) {
          for (let i = assistantNodes.length - 1; i >= 0; i--) {
            const node = assistantNodes[i];
            const role = node.getAttribute('data-message-author-role');
            const md = node.querySelector('message-content, .model-response-text, .markdown, [class*="MarkdownRoot"]') || node;
            const text = DOM.extractAnswerMarkdown(md);
            if (role !== 'user' && text && text.length > 0) {
              answerText = text;
              break;
            }
          }
        }

        // 3. Fallback: check streaming element
        if (!answerText) {
          const streamEl = $$v(
            '.result-streaming, [data-is-streaming="true"], div.response-streaming, .sparkle-animating, [aria-busy="true"], [class*="AdaptiveStreaming"], [class*="Streaming"]'
          ).find(el => !el.closest('nav, aside, header, form, [id^="cgq-"], [role="status"]'));
          if (streamEl) {
            answerText = DOM.extractAnswerMarkdown(streamEl);
            isStreaming = true;
          }
        }

        // Find user prompt
        let userPrompt = '';
        if (IS_GEMINI) {
          const geminiQueries = Array.from($$v('user-query')).filter(n => !n.closest(CHROME_SELECTOR));
          if (geminiQueries.length > 0) {
            userPrompt = DOM.cleanUserPrompt(geminiQueries[geminiQueries.length - 1]);
          }
        }

        if (!userPrompt) {
          const userNodes = Array.from($$v(
            '[data-message-author-role="user"], ' +
            '[data-user-message-bubble="true"], ' +
            '[class*="user-turn"], ' +
            'user-query, .user-query, div.query-text, [data-test-id="user-query"]'
          )).filter(n => {
            if (n.closest('#prompt-textarea') || n.closest('rich-textarea') || n.closest('#cgq-widget') || n.closest('#cgq-composer-queue-panel')) return false;
            if (n.closest(CHROME_SELECTOR)) return false;
            return true;
          });

          if (userNodes.length > 0) {
            userPrompt = DOM.cleanUserPrompt(userNodes[userNodes.length - 1]);
          }
        }

        if (!userPrompt && !IS_GEMINI) {
          const candidateTurnEls = Array.from($$v(
            'article, [data-turn-key], [data-testid^="conversation-turn-"], [data-message-author-role="user"]'
          )).filter(n => {
            return !n.closest('#prompt-textarea') && !n.closest('rich-textarea') && !n.closest('#cgq-widget') && !n.closest('#cgq-composer-queue-panel') && !n.closest(CHROME_SELECTOR);
          });
          const turnEls = candidateTurnEls.filter((node, idx) => !candidateTurnEls.some((other, oIdx) => oIdx !== idx && other.contains(node)));
          for (let i = turnEls.length - 1; i >= 0; i--) {
            const turn = turnEls[i];
            const hasAssistantRole = turn.getAttribute('data-message-author-role') === 'assistant' ||
              !!turn.querySelector('[data-message-author-role="assistant"], [data-content-search-unit-key*="assistant"], [class*="DilResponseRoot"], [data-dil-message-id], [data-markdown-text-style="assistant-message"]');
            const hasMarkdown = !!turn.querySelector('.markdown, [class*="MarkdownRoot"], [class*="DilRenderer"]');
            const hasStreaming = !!turn.querySelector('.result-streaming, [data-is-streaming="true"], div.response-streaming, .sparkle-animating, [class*="AdaptiveStreaming"], [class*="Streaming"]');
            const isAssistant = hasAssistantRole || hasMarkdown || hasStreaming;
            if (!isAssistant) {
              const uText = DOM.cleanUserPrompt(turn);
              if (uText) {
                userPrompt = uText;
                break;
              }
            }
          }
        }

        if (!userPrompt && lastSentPrompt) {
          userPrompt = lastSentPrompt;
        }

        if (answerText || isStreaming || userPrompt) {
          return {
            text: answerText || (isStreaming ? '（思考中・回答を生成しています...）' : ''),
            userPrompt: userPrompt,
            isStreaming: isStreaming,
            timestamp: Date.now()
          };
        }
      } catch (e) {
        console.warn('[ChatGPT Queue] getLatestAnswer error:', e);
      }
      return null;
    },

    getRecentQAHistory(lastSentPrompt, limit = 50) {
      try {
        const isAnswerNode = node => {
          if (node.closest(CHROME_SELECTOR)) return false;
          if (IS_CHATGPT && DOM.inThinking(node)) return false;
          // The sidebar is never an answer (its profile shows 「プロフィールを読み込み中」 with aria-busy).
          if (node.closest('nav, aside, header, [id^="cgq-"]')) return false;
          if (node.querySelectorAll('a[href*="/app/"], a[href*="/c/"]').length >= 3 && !node.closest('model-response, [data-message-author-role="assistant"], chat-window, article')) return false;
          return true;
        };

        // 1. Gemini explicit pairing (user-query + model-response)
        if (IS_GEMINI) {
          const userNodes = Array.from($$v('user-query')).filter(n => !n.closest(CHROME_SELECTOR));
          const modelNodes = Array.from($$v('model-response')).filter(isAnswerNode);
          const count = Math.max(userNodes.length, modelNodes.length);
          const start = Math.max(0, count - limit);
          const list = [];
          for (let i = start; i < count; i++) {
            const uText = (userNodes[i] ? DOM.cleanUserPrompt(userNodes[i]) : '') || (i === count - 1 ? (lastSentPrompt || '') : '');
            const mNode = modelNodes[i];
            let aText = mNode ? DOM.extractAnswerMarkdown(mNode) : '';
            const isStreaming = (i === count - 1) && DOM.isGenerating();

            if (!aText && isStreaming) {
              const streamEl = $v(
                '.result-streaming, [data-is-streaming="true"], div.response-streaming, .sparkle-animating, [class*="AdaptiveStreaming"], [class*="Streaming"]'
              );
              if (streamEl) {
                aText = DOM.extractAnswerMarkdown(streamEl);
              }
            }

            if (uText || aText) {
              const choices = mNode ? DOM.extractChoices(mNode) : [];
              const snapKey = `m${i}`;
              const snapRoot = mNode && (mNode.querySelector('structured-content-container') || mNode.querySelector('message-content') || mNode);
              const snap = rememberSnapRoots(snapKey, [snapRoot]);
              list.push({
                turn: i + 1,
                prompt: uText,
                answer: aText,
                isStreaming: isStreaming,
                ...(choices.length ? { choices } : {}),
                ...(snap ? { snapKey } : {})
              });
            }
          }

          // If active generation is happening on a newly sent prompt not yet rendered in userNodes
          if (list.length > 0 && DOM.isGenerating() && lastSentPrompt && list[list.length - 1].prompt !== lastSentPrompt) {
            let streamText = '';
            const streamEl = $v(
              '.result-streaming, [data-is-streaming="true"], div.response-streaming, .sparkle-animating, [class*="AdaptiveStreaming"], [class*="Streaming"]'
            );
            if (streamEl) streamText = DOM.extractAnswerMarkdown(streamEl);
            list.push({
              turn: list.length + 1,
              prompt: lastSentPrompt,
              answer: streamText,
              isStreaming: true
            });
          }

          if (list.length > 0) return list;
        }

        // 2. Turn-based matching (Modern & Legacy ChatGPT / DIL)
        const candidateTurnEls = Array.from($$v(
          'article, [data-turn-key], [data-testid^="conversation-turn-"], [data-message-author-role="user"], [data-message-author-role="assistant"], [data-user-message-bubble="true"]'
        )).filter(n => {
          return !n.closest('#prompt-textarea') &&
                 !n.closest('rich-textarea') &&
                 !n.closest('#cgq-widget') &&
                 !n.closest('#cgq-composer-queue-panel') &&
                 !n.closest('header') &&
                 !n.closest('form') &&
                 !n.closest(CHROME_SELECTOR);
        });

        // Filter out elements contained within another candidate element to get top-level turn elements in document order
        // One element per turn: drop nested candidates and any second copy of the same turn key.
        const turnEls = candidateTurnEls.filter((node, idx) =>
          !candidateTurnEls.some((other, oIdx) => oIdx !== idx && other.contains(node))
        ).filter((node, idx, list) => {
          const key = node.getAttribute('data-turn-key');
          return !key || list.findLastIndex(other => other.getAttribute('data-turn-key') === key) === idx;
        });

        if (turnEls.length > 0) {
          // Check if any turn contains both user and assistant (combined turn wrapper)
          const hasCombinedTurns = turnEls.some(t => {
            const hasUser = !!t.querySelector('[data-user-message-bubble="true"], [data-message-author-role="user"]');
            const hasAssistant = !!t.querySelector('[data-content-search-unit-key*="assistant"], [class*="DilResponseRoot"], [data-dil-message-id], [data-markdown-text-style="assistant-message"], .markdown, [class*="MarkdownRoot"], [class*="DilRenderer"]');
            return hasUser && hasAssistant;
          });

          if (hasCombinedTurns) {
            const list = [];
            const start = Math.max(0, turnEls.length - limit);
            for (let i = start; i < turnEls.length; i++) {
              const turn = turnEls[i];
              const userEl = turn.querySelector('[data-user-message-bubble="true"], [data-message-author-role="user"]');
              let uText = DOM.cleanUserPrompt(userEl);
              if (!uText && i === turnEls.length - 1 && lastSentPrompt) {
                uText = lastSentPrompt;
              }

              const assistantEls = Array.from(turn.querySelectorAll(
                '[data-content-search-unit-key*="assistant"], [class*="DilResponseRoot"], [data-dil-message-id], [data-markdown-text-style="assistant-message"], .markdown, [class*="MarkdownRoot"], [class*="DilRenderer"]'
              )).filter(isAnswerNode);

              const roots = assistantEls.filter((node, idx) => !assistantEls.some((other, oIdx) => oIdx !== idx && other.contains(node)));
              let aText = roots.map(r => DOM.extractAnswerMarkdown(r)).filter(Boolean).join('\n\n');

              const isStreaming = (i === turnEls.length - 1) && DOM.isGenerating();
              if (!aText && isStreaming) {
                const streamEl = turn.querySelector(
                  '.result-streaming, [data-is-streaming="true"], div.response-streaming, .sparkle-animating, [class*="AdaptiveStreaming"], [class*="Streaming"]'
                ) || $v('.result-streaming, [data-is-streaming="true"], div.response-streaming, .sparkle-animating, [class*="AdaptiveStreaming"], [class*="Streaming"]');
                if (streamEl) {
                  aText = DOM.extractAnswerMarkdown(streamEl);
                }
              }

              if (uText || aText) {
                const choices = DOM.extractChoices(turn);
                const thinking = DOM.getThinking(turn);
                // The answer's own Markdown roots (not the unit wrapper with its heading and buttons).
                const markdownRoots = roots.flatMap(r => r.matches('[class*="MarkdownRoot"]') ? [r] :
                  Array.from(r.querySelectorAll('[class*="MarkdownRoot"]')).filter(m => !m.parentElement.closest('[class*="MarkdownRoot"]') && !DOM.inThinking(m)));
                const snapKey = turn.getAttribute('data-turn-key') || `t${i}`;
                const snap = rememberSnapRoots(snapKey, markdownRoots.length ? markdownRoots : roots);
                list.push({
                  turn: i + 1,
                  prompt: uText,
                  answer: aText,
                  isStreaming: isStreaming,
                  ...(choices.length ? { choices } : {}),
                  ...(thinking ? { thinking } : {}),
                  ...(snap ? { snapKey } : {})
                });
              }
            }
            if (list.length > 0) return list;
          } else {
            // Modern ChatGPT where each turnEl is an individual message (user OR assistant)
            const list = [];
            let currentQA = null;

            for (let i = 0; i < turnEls.length; i++) {
              const turn = turnEls[i];

              const hasAssistantRole = turn.getAttribute('data-message-author-role') === 'assistant' ||
                !!turn.querySelector('[data-message-author-role="assistant"], [data-content-search-unit-key*="assistant"], [class*="DilResponseRoot"], [data-dil-message-id], [data-markdown-text-style="assistant-message"]');
              const hasMarkdown = !!turn.querySelector('.markdown, [class*="MarkdownRoot"], [class*="DilRenderer"]');
              const hasStreaming = !!turn.querySelector('.result-streaming, [data-is-streaming="true"], div.response-streaming, .sparkle-animating, [class*="AdaptiveStreaming"], [class*="Streaming"]');
              const srHeading = turn.querySelector('h1.sr-only, h2.sr-only, h3.sr-only, h4.sr-only, h5.sr-only, h6.sr-only, .sr-only');
              const headingText = srHeading ? (srHeading.textContent || '') : '';
              const hasAssistantHeading = /(?:ChatGPT|Gemini)(?: said)?/i.test(headingText);

              const isAssistant = hasAssistantRole || hasMarkdown || hasStreaming || hasAssistantHeading;

              const hasUserRole = turn.getAttribute('data-message-author-role') === 'user' ||
                !!turn.querySelector('[data-message-author-role="user"], [data-user-message-bubble="true"], user-query');
              const hasUserHeading = /(?:あなた|You(?: said)?)/i.test(headingText);

              const isUser = hasUserRole || hasUserHeading || (!isAssistant && (!!turn.querySelector('.whitespace-pre-wrap') || !hasMarkdown));

              if (isUser) {
                const userEl = turn.querySelector('[data-user-message-bubble="true"], [data-message-author-role="user"]') ||
                  (turn.getAttribute('data-message-author-role') === 'user' ? turn : null) ||
                  turn.querySelector('.whitespace-pre-wrap') ||
                  turn;
                const uText = DOM.cleanUserPrompt(userEl);

                currentQA = {
                  turn: list.length + 1,
                  prompt: uText,
                  answer: '',
                  isStreaming: false
                };
                list.push(currentQA);
              } else if (isAssistant) {
                // Extract answer markdown prioritizing markdown roots over outer container
                const mdEls = Array.from(turn.querySelectorAll(
                  '.markdown, [class*="MarkdownRoot"], [data-markdown-text-style="assistant-message"], [class*="DilRenderer"]'
                )).filter(isAnswerNode);

                let aText = '';
                if (mdEls.length > 0) {
                  const roots = mdEls.filter((node, idx) => !mdEls.some((other, oIdx) => oIdx !== idx && other.contains(node)));
                  aText = roots.map(r => DOM.extractAnswerMarkdown(r)).filter(Boolean).join('\n\n');
                } else {
                  const assistantEl = turn.querySelector(
                    '[data-message-author-role="assistant"], [data-content-search-unit-key*="assistant"], [class*="DilResponseRoot"], [data-dil-message-id]'
                  ) || turn;
                  if (isAnswerNode(assistantEl)) {
                    aText = DOM.extractAnswerMarkdown(assistantEl);
                  }
                }

                const isStreamingTurn = hasStreaming || (i === turnEls.length - 1 && DOM.isGenerating());
                if (!aText && isStreamingTurn) {
                  const streamEl = turn.querySelector(
                    '.result-streaming, [data-is-streaming="true"], div.response-streaming, .sparkle-animating, [class*="AdaptiveStreaming"], [class*="Streaming"]'
                  ) || $v('.result-streaming, [data-is-streaming="true"], div.response-streaming, .sparkle-animating, [class*="AdaptiveStreaming"], [class*="Streaming"]');
                  if (streamEl) {
                    aText = DOM.extractAnswerMarkdown(streamEl);
                  }
                }

                if (currentQA && !currentQA.answer) {
                  currentQA.answer = aText;
                  currentQA.isStreaming = isStreamingTurn;
                } else if (currentQA && currentQA.answer) {
                  // Regenerated response or continuation for current turn
                  currentQA.answer = aText;
                  currentQA.isStreaming = isStreamingTurn;
                } else {
                  // Standalone assistant turn
                  currentQA = {
                    turn: list.length + 1,
                    prompt: '',
                    answer: aText,
                    isStreaming: isStreamingTurn
                  };
                  list.push(currentQA);
                }
                const choices = DOM.extractChoices(turn);
                if (choices.length) currentQA.choices = choices;
              }
            }

            // Check if active generation / streaming is happening on the last turn
            if (list.length > 0 && DOM.isGenerating()) {
              const lastQA = list[list.length - 1];
              lastQA.isStreaming = true;
              if (!lastQA.answer) {
                const streamEl = $v(
                  '.result-streaming, [data-is-streaming="true"], div.response-streaming, .sparkle-animating, [class*="AdaptiveStreaming"], [class*="Streaming"]'
                );
                if (streamEl) {
                  lastQA.answer = DOM.extractAnswerMarkdown(streamEl);
                }
              }
            }

            // If user just sent a new prompt and is generating, but DOM hasn't rendered the new user turn yet
            if (list.length > 0 && DOM.isGenerating() && lastSentPrompt && list[list.length - 1].prompt !== lastSentPrompt) {
              let streamText = '';
              const streamEl = $v(
                '.result-streaming, [data-is-streaming="true"], div.response-streaming, .sparkle-animating, [class*="AdaptiveStreaming"], [class*="Streaming"]'
              );
              if (streamEl) streamText = DOM.extractAnswerMarkdown(streamEl);
              list.push({
                turn: list.length + 1,
                prompt: lastSentPrompt,
                answer: streamText,
                isStreaming: true
              });
            }

            if (list.length > 0) {
              const lastQA = list[list.length - 1];
              if (!lastQA.prompt && lastSentPrompt) {
                lastQA.prompt = lastSentPrompt;
              }
              return list;
            }
          }
        }

        // 3. Element list matching (Gemini / Standard ChatGPT / Fallback)
        const list = [];
        const users = Array.from($$v(
          '[data-message-author-role="user"], [data-user-message-bubble="true"], [class*="user-turn"], ' +
          'user-query, .user-query, div.query-text, [data-test-id="user-query"]'
        )).filter(n => !n.closest('#prompt-textarea') && !n.closest('rich-textarea') && !n.closest('#cgq-widget') && !n.closest('#cgq-composer-queue-panel') && !n.closest(CHROME_SELECTOR));

        const markdownEls = Array.from($$v(
          'model-response, message-content, .model-response-text, .markdown, [class*="markdown"], [class*="MarkdownRoot"], [class*="DilResponseRoot"], [class*="DilRenderer"], [data-dil-message-id], [data-message-author-role="assistant"], [data-markdown-text-style="assistant-message"]'
        )).filter(isAnswerNode);

        const answerRoots = [...new Set(markdownEls.map(node =>
          node.closest('model-response, [data-message-author-role="assistant"], [class*="DilResponseRoot"]') || node))]
          .filter((node, index, nodes) => !nodes.some((other, otherIndex) => otherIndex !== index && other.contains(node)));
        const userRoots = users.filter((node, index) => !users.some((other, otherIndex) => otherIndex !== index && other.contains(node)));
        const count = Math.max(userRoots.length, answerRoots.length);
        const start = Math.max(0, count - 50);
        for (let i = start; i < count; i++) {
          const uText = (userRoots[i] ? DOM.cleanUserPrompt(userRoots[i]) : '') || (i === count - 1 ? (lastSentPrompt || '') : '');
          const mdEl = answerRoots[i];
          let aText = mdEl ? DOM.extractAnswerMarkdown(mdEl) : '';
          const isStreaming = (i === count - 1) && DOM.isGenerating();

          if (!aText && isStreaming) {
            const streamEl = $v(
              '.result-streaming, [data-is-streaming="true"], div.response-streaming, .sparkle-animating, [class*="AdaptiveStreaming"], [class*="Streaming"]'
            );
            if (streamEl) {
              aText = DOM.extractAnswerMarkdown(streamEl);
            }
          }

          if (uText || aText) {
            list.push({
              turn: i + 1,
              prompt: uText,
              answer: aText,
              isStreaming: isStreaming
            });
          }
        }
        return list;
      } catch (e) {
        return [];
      }
    },

    getScrollContainer() {
      // 1. 会話ターンや入力欄の祖先スクローラーを優先探索
      const anchor = $v(
        'div[data-message-author-role="assistant"]:last-of-type, ' +
        'article[data-testid^="conversation-turn-"]:last-of-type, ' +
        'article:last-of-type, ' +
        'user-query:last-of-type, ' +
        '#prompt-textarea, ' +
        '[role="presentation"] form'
      );
      if (anchor) {
        let cur = anchor.parentElement;
        while (cur && cur !== document.body && cur !== document.documentElement) {
          if (cur.id === 'cgq-widget' || cur.id === 'cgq-composer-queue-panel') {
            cur = cur.parentElement;
            continue;
          }
          if (cur.scrollHeight > cur.clientHeight + 10 && cur.clientHeight >= 150) {
            const style = window.getComputedStyle ? window.getComputedStyle(cur) : null;
            const overflowY = style ? style.overflowY : '';
            if (overflowY === 'auto' || overflowY === 'scroll' || cur.tagName.toLowerCase() === 'infinite-scroller' || (cur.className && String(cur.className).includes('overflow-y-auto'))) {
              return cur;
            }
          }
          cur = cur.parentElement;
        }
      }

      if (IS_GEMINI) {
        const geminiScroller = $v('infinite-scroller, .chat-history, main');
        if (geminiScroller && geminiScroller.scrollHeight > geminiScroller.clientHeight) {
          return geminiScroller;
        }
      }
      const candidates = $$v(
        'main div[class*="react-scroll-to-bottom"], main [class*="overflow-y-auto"], main, [role="presentation"] .overflow-y-auto'
      );
      for (const el of candidates) {
        if (el.scrollHeight > el.clientHeight && el.clientHeight > 150) {
          return el;
        }
      }
      return document.scrollingElement || document.documentElement || document.body;
    },

    isNearBottom(threshold = 140) {
      const el = DOM.getScrollContainer();
      if (!el) return true;
      if (el === document.scrollingElement || el === document.documentElement || el === document.body) {
        const scrollHeight = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
        const clientHeight = window.innerHeight;
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        return (scrollHeight - scrollTop - clientHeight) <= threshold;
      }
      return (el.scrollHeight - el.scrollTop - el.clientHeight) <= threshold;
    },

    scrollToBottom(force = false) {
      const el = DOM.getScrollContainer();
      if (!el) return;
      if (!force && !DOM.isNearBottom(140)) {
        // ユーザーが過去ログ確認等で上にスクロールしている場合は自動スクロールを一時停止
        return;
      }
      if (el === document.scrollingElement || el === document.documentElement || el === document.body) {
        window.scrollTo({ top: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight), behavior: 'instant' });
      } else {
        el.scrollTop = el.scrollHeight;
        if (window.scrollY > 0) {
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
        }
      }
    }
  };

  window.__CGQ_DOM__ = DOM;

  // ==========================================================================
  // Human-Like Input Simulation
  // ==========================================================================

  class HumanSimulator {
    static shouldPaste(text, settings) {
      if (document.hidden) return true;

      if (settings.typingMode === 'instant') return true;
      if (settings.typingMode === 'human' || settings.typingMode === 'fast') return false;

      if (settings.pasteProbability === 100) return true;
      if (settings.pasteProbability === 0) return false;

      const len = text.length;
      let chance = 0.25;
      if (len > 150) chance = 0.75;
      else if (len > 60) chance = 0.40;
      else if (len < 25) chance = 0.12;

      return Math.random() < chance;
    }

    static async pasteText(targetElement, fullText, settings, onProgress, tokens = []) {
      targetElement.focus();
      targetElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      targetElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      targetElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const preDelay = document.hidden ? 150 : (350 + Math.random() * 250);
      await sleep(preDelay);

      this.setDOMContent(targetElement, fullText, tokens);
      if (onProgress) onProgress(fullText.length, fullText.length, 'paste');

      const reviewDelay = document.hidden ? 300 : ((settings.preSendDelay || 700) + 300 + Math.random() * 400);
      await sleep(reviewDelay);

      return true;
    }

    static async typeText(targetElement, fullText, settings, onProgress, tokens = []) {
      if (!targetElement) return false;

      if (this.shouldPaste(fullText, settings)) {
        return this.pasteText(targetElement, fullText, settings, onProgress, tokens);
      }

      targetElement.focus();
      targetElement.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      targetElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      targetElement.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      await sleep(250 + Math.random() * 250);

      const isFast = settings.typingMode === 'fast';
      const baseSpeed = isFast ? 18 : (settings.typingSpeed || 45);

      this.setDOMContent(targetElement, '', tokens);

      let currentText = '';
      let burstCount = 0;
      let burstTarget = Math.floor(3 + Math.random() * 5);

      for (let i = 0; i < fullText.length; i++) {
        if (document.hidden) {
          this.setDOMContent(targetElement, fullText, tokens);
          if (onProgress) onProgress(fullText.length, fullText.length, 'paste');
          await sleep(300);
          return true;
        }

        const char = fullText[i];

        if (settings.simulateTypos && Math.random() < 0.012 && KEYBOARD_NEIGHBORS[char.toLowerCase()]) {
          const neighbors = KEYBOARD_NEIGHBORS[char.toLowerCase()];
          const wrongChar = neighbors[Math.floor(Math.random() * neighbors.length)];

          currentText += wrongChar;
          this.setDOMContent(targetElement, currentText, tokens);
          if (onProgress) onProgress(i, fullText.length, 'typo');

          await sleep(140 + Math.random() * 160);

          currentText = currentText.slice(0, -1);
          this.setDOMContent(targetElement, currentText, tokens);

          await sleep(100 + Math.random() * 120);
        }

        currentText += char;
        this.setDOMContent(targetElement, currentText, tokens);

        if (onProgress) {
          onProgress(i + 1, fullText.length, 'typing');
        }

        let delay = baseSpeed;

        burstCount++;
        if (burstCount >= burstTarget) {
          delay += 40 + Math.random() * 60;
          burstCount = 0;
          burstTarget = Math.floor(3 + Math.random() * 6);
        } else {
          delay *= 0.75;
        }

        if (settings.typingJitter) {
          delay += (Math.random() - 0.5) * baseSpeed * 0.8;
        }

        if (settings.punctuationPause) {
          if ('。、！？!?,\n'.includes(char)) {
            delay += 220 + Math.random() * 260;
          } else if (char === ' ') {
            delay += 50 + Math.random() * 60;
          }
        }

        if (Math.random() < 0.025) {
          delay += 250 + Math.random() * 350;
        }

        await sleep(Math.max(10, Math.round(delay)));
      }

      const hesitation = settings.preSendDelay || 700;
      await sleep(hesitation + Math.random() * 300);

      return true;
    }

    static dispatchEvent(element, eventType, detail = {}) {
      if (!element) return;
      const win = element.ownerDocument?.defaultView || window;
      try {
        const ev = new win.Event(eventType, { bubbles: true, cancelable: true, ...detail });
        element.dispatchEvent(ev);
      } catch (e) {
        try {
          const ev = (element.ownerDocument || document).createEvent('Event');
          ev.initEvent(eventType, true, true);
          element.dispatchEvent(ev);
        } catch (err) {}
      }
    }

    static setDOMContent(element, text, tokens = []) {
      if (!element) return;
      const win = element.ownerDocument?.defaultView || window;

      if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          win.HTMLTextAreaElement?.prototype || window.HTMLTextAreaElement.prototype,
          'value'
        )?.set;
        if (nativeSetter) {
          nativeSetter.call(element, text);
        } else {
          element.value = text;
        }
        HumanSimulator.dispatchEvent(element, 'input');
        HumanSimulator.dispatchEvent(element, 'change');
        return;
      }

      element.focus();

      const doc = element.ownerDocument || document;
      const tokenKey = token => token.getAttribute?.('app-mention-path') ||
        token.getAttribute?.('data-system-hint-type') || token.textContent?.trim();
      const expectedKeys = [...new Set(tokens.map(tokenKey))];
      const readLiveTokens = () => Array.from(element.querySelectorAll('[app-mention-path], [data-system-hint-type], strong'))
        .filter(token => expectedKeys.includes(tokenKey(token)));
      const useNativeAtoms = expectedKeys.length > 0 && typeof doc.execCommand === 'function';
      const liveTokens = useNativeAtoms ? readLiveTokens() : [];
      if (useNativeAtoms && expectedKeys.some((key, index) => tokenKey(liveTokens[index] || {}) !== key)) {
        throw new Error('アプリ・ツールの選択が失われました。キューを再開して選択し直してください。');
      }

      // 1. Try document.execCommand('insertText') which triggers native ProseMirror / Lexical / React transactions
      let execWorked = false;
      try {
        if (typeof doc.execCommand === 'function') {
          const sel = win.getSelection?.() || window.getSelection();
          if (sel) {
            const range = doc.createRange();
            range.selectNodeContents(element);
            // Keep the editor's real mention atoms and their framework state. Replacing the
            // whole editor (or cloning atoms back afterwards) loses native Research selection.
            if (useNativeAtoms) range.setStartAfter(liveTokens[liveTokens.length - 1]);
            sel.removeAllRanges();
            sel.addRange(range);
            // Keep a word boundary after the atom so a following @mention opens natively.
            execWorked = doc.execCommand('insertText', false, useNativeAtoms ? ' ' + text : text);
          }
        }
      } catch (e) {
        execWorked = false;
      }

      if (useNativeAtoms && (!execWorked || expectedKeys.some((key, index) => tokenKey(readLiveTokens()[index] || {}) !== key))) {
        throw new Error('アプリ・ツールを保持して入力できませんでした。本文の送信を中止しました。');
      }

      // If execCommand succeeded and element contains text, notify and return
      if (execWorked && (element.innerText || element.textContent || '').trim().length > 0) {
        HumanSimulator.dispatchEvent(element, 'input');
        HumanSimulator.dispatchEvent(element, 'change');
        return;
      }

      // 2. Fallback / JSDOM / rich mention tokens: DOM reconstruction
      const uniqueTokens = [];
      const seenTokenKeys = new Set();
      for (const token of tokens) {
        const key = token.getAttribute?.('app-mention-path') ||
                    token.getAttribute?.('data-system-hint-type') ||
                    token.textContent?.trim();
        if (key && !seenTokenKeys.has(key)) {
          seenTokenKeys.add(key);
          uniqueTokens.push(token);
        } else if (!key) {
          uniqueTokens.push(token);
        }
      }

      element.replaceChildren();
      text.split('\n').forEach((line, index) => {
        const p = doc.createElement('p');
        p.setAttribute('dir', 'auto');
        if (index === 0) for (const token of uniqueTokens) {
          p.append(token.cloneNode(true), doc.createTextNode(' '));
        }
        if (line) p.appendChild(doc.createTextNode(line));
        else if (!p.childNodes.length) p.appendChild(doc.createElement('br'));
        element.appendChild(p);
      });

      try {
        const sel = win.getSelection?.() || window.getSelection();
        if (sel) {
          const range = doc.createRange();
          range.selectNodeContents(element);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } catch (e) {}

      try {
        const InputEventClass = win.InputEvent || window.InputEvent;
        if (InputEventClass) {
          element.dispatchEvent(new InputEventClass('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: text
          }));
          element.dispatchEvent(new InputEventClass('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: text
          }));
        }
      } catch (e) {}

      HumanSimulator.dispatchEvent(element, 'input');
      HumanSimulator.dispatchEvent(element, 'change');
    }

    static userNodes() {
      return $$v((
        '[data-message-author-role="user"], ' +
        '[data-user-message-bubble="true"], ' +
        '[class*="user-turn"], ' +
        'user-query, .user-query, div.query-text, [data-test-id="user-query"]'
      )).filter(n => {
        if (n.closest('#prompt-textarea') || n.closest('rich-textarea') || n.closest('#cgq-widget') || n.closest('#cgq-composer-queue-panel')) return false;
        if (n.closest(CHROME_SELECTOR)) return false;
        return true;
      });
    }

    static lastUserNode() {
      const nodes = HumanSimulator.userNodes();
      return nodes[nodes.length - 1] || null;
    }

    // Sent when conversation gained user message, generation started, or stop button appeared.
    static async confirmSent(prompt, beforeLast, timeoutMs = 8000) {
      const norm = value => String(value || '').replace(/\s+/g, ' ').trim();
      const probe = norm(prompt).slice(0, 40);
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        // 1. Generation started -> prompt was definitely accepted and sent!
        if (DOM.isGenerating()) return true;

        // 2. Stop button or rect appeared -> definitely generating!
        const sendBtn = DOM.getSendButton();
        if (sendBtn && (sendBtn.matches?.('button[data-testid*="stop" i], button[aria-label*="Stop" i], button[aria-label*="停止" i], button[aria-label*="中断" i], button[aria-label*="ストップ" i]') || sendBtn.querySelector?.('rect'))) {
          return true;
        }

        // 3. User message node added / updated
        const last = HumanSimulator.lastUserNode();
        if (last) {
          const text = norm(last.innerText || last.textContent);
          if (probe && text.includes(probe)) return true;
          if (last !== beforeLast && text.length > 0) return true;
        }

        // 4. Fallback: Composer is cleared after being typed
        const composerText = norm(DOM.getComposerText());
        if (!composerText && (DOM.isGenerating() || (last && last !== beforeLast) || (Date.now() > until - timeoutMs + 1000))) {
          return true;
        }

        await sleep(120);
      }

      // Final post-timeout check: if active generation is now ongoing or composer cleared, treat as sent
      if (DOM.isGenerating()) return true;
      const last = HumanSimulator.lastUserNode();
      if (last && probe && norm(last.innerText || last.textContent).includes(probe)) return true;
      if (!norm(DOM.getComposerText())) return true;

      return false;
    }

    static async clickSend(prompt) {
      const beforeLast = HumanSimulator.lastUserNode();
      const input = DOM.getPromptInput();

      const isButtonDisabled = (btn) => {
        if (!btn) return true;
        return btn.disabled === true ||
               btn.getAttribute('disabled') !== null ||
               btn.getAttribute('aria-disabled') === 'true';
      };

      // 1. Ensure input is focused and change/input event fired so React state settles
      if (input) {
        input.focus();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // 2. Poll for send button to become available & enabled (up to 2000ms)
      const startTime = Date.now();
      let sendBtn = DOM.getSendButton();
      while (isButtonDisabled(sendBtn) && (Date.now() - startTime < 2000)) {
        await sleep(80);
        sendBtn = DOM.getSendButton();
      }

      const triggerFullClick = (el) => {
        if (!el) return;
        try {
          el.focus?.();
          el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
          el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          el.click();
        } catch (e) {}
      };

      // 3. Primary attempt: Click the send button if present
      if (sendBtn) {
        // Force-remove disabled attribute if still stuck
        if (sendBtn.hasAttribute('disabled')) sendBtn.removeAttribute('disabled');
        if (sendBtn.getAttribute('aria-disabled') === 'true') sendBtn.setAttribute('aria-disabled', 'false');

        triggerFullClick(sendBtn);

        const sentQuick = await HumanSimulator.confirmSent(prompt, beforeLast, 2000);
        if (sentQuick) return true;
      }

      // 4. Secondary attempt: Form requestSubmit
      const form = input?.closest('form') || sendBtn?.closest('form') || document.querySelector('form');
      if (form) {
        try {
          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit(sendBtn || undefined);
          } else {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
        } catch (e) {}

        const sentForm = await HumanSimulator.confirmSent(prompt, beforeLast, 2000);
        if (sentForm) return true;
      }

      // 5. Tertiary attempt: Keyboard Enter on the input element
      if (input) {
        input.focus();
        try {
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            range.selectNodeContents(input);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        } catch (e) {}

        const enterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
          composed: true
        });
        input.dispatchEvent(enterEvent);
      }

      // 6. Final confirmation wait
      return await HumanSimulator.confirmSent(prompt, beforeLast, 4500);
    }
  }

  window.__CGQ_HumanSimulator__ = HumanSimulator;

  // ==========================================================================
  // Tab Queue Manager (With Dashboard Registry Reporting)
  // ==========================================================================

  class QueueManager {
    constructor() {
      this.sessionTabId = SESSION_TAB_ID;
      this.currentUrl = window.location.href;
      this.conversationId = extractConversationId(this.currentUrl);
      this.tabId = computeTabId(this.sessionTabId, this.conversationId);
      this.previousTabId = null;
      this.chromeTabId = null;
      this.items = [];
      this.settings = { ...DEFAULT_SETTINGS };
      this.uiState = { ...DEFAULT_UI_STATE };
      this.currentState = QueueState.IDLE;
      this.isPaused = false;
      this.currentAction = '';
      this.progressText = '';
      this.progressPercent = 0;
      this.timerRemaining = 0;
      this.activeItem = null;

      this.lastSentTimestamp = 0;
      this.lastSentPrompt = '';
      this.completedQA = [];

      this.sessionStartTime = Date.now();
      this.lastProcessedTime = Date.now();
      this.connectionLostSince = null;
      this.switchingChatSince = null;
      this.chatRolloverFailed = false;
      this.isStuckToBottom = true;

      this.listeners = [];
      this.loopRunning = false;
    }

    get storageKeyQueue() {
      return `cgq_queue_${this.tabId}`;
    }

    get storageKeyCmd() {
      return `cgq_cmd_${this.tabId}`;
    }

    async init() {
      // Query chrome tab id from background service worker
      try {
        chrome.runtime.sendMessage({ action: 'GET_MY_CHROME_TAB_ID' }, (resp) => {
          if (resp && resp.chromeTabId) {
            this.chromeTabId = resp.chromeTabId;
            this.reportToRegistry();
          }
        });
      } catch (e) {}

      await this.loadFromStorage();
      await this.restoreConversationRollover();
      this.setupStorageListener();
      this.setupRegistryHeartbeat();
      this.setupUrlWatcher();
      this.setupAutoScrollWatcher();
      this.setupConnectionLostWatcher();
      this.startLoop();
    }

    setupAutoScrollWatcher() {
      // 回答生成中にスクロールが下端に張り付いている時の自動追従管理
      this.isStuckToBottom = true;

      // ユーザーの手動スクロール操作を検知
      window.addEventListener('wheel', (e) => {
        if (e.deltaY < -1) {
          // 上スクロール: 張り付き解除（過去ログ閲覧モード）
          this.isStuckToBottom = false;
        } else if (e.deltaY > 1) {
          // 下スクロール: 下端近辺に到達した場合は張り付き再開
          if (DOM.isNearBottom(140)) {
            this.isStuckToBottom = true;
          }
        }
      }, { passive: true });

      window.addEventListener('keydown', (e) => {
        if (['PageUp', 'ArrowUp', 'Home'].includes(e.key)) {
          this.isStuckToBottom = false;
        } else if (['PageDown', 'ArrowDown', 'End'].includes(e.key)) {
          setTimeout(() => {
            if (DOM.isNearBottom(140)) {
              this.isStuckToBottom = true;
            }
          }, 50);
        }
      }, { passive: true });

      let touchStartY = 0;
      window.addEventListener('touchstart', (e) => {
        if (e.touches && e.touches[0]) {
          touchStartY = e.touches[0].clientY;
        }
      }, { passive: true });

      window.addEventListener('touchmove', (e) => {
        if (e.touches && e.touches[0]) {
          const deltaY = e.touches[0].clientY - touchStartY;
          if (deltaY > 5) {
            // スワイプダウン（上スクロール）
            this.isStuckToBottom = false;
          } else if (deltaY < -5) {
            // スワイプアップ（下スクロール）
            if (DOM.isNearBottom(140)) {
              this.isStuckToBottom = true;
            }
          }
        }
      }, { passive: true });

      // captureフェーズで内部スクローラー含む全コンテナのスクロールを監視
      window.addEventListener('scroll', () => {
        if (DOM.isNearBottom(140)) {
          this.isStuckToBottom = true;
        }
      }, { capture: true, passive: true });

      // 回答生成中のDOM変更を検知して即座に下端追従 (MutationObserver)
      let scrollRafId = null;
      const requestAutoScroll = () => {
        if (scrollRafId) return;
        scrollRafId = requestAnimationFrame(() => {
          scrollRafId = null;
          if (this.settings.autoScroll !== false && DOM.isGenerating() && this.isStuckToBottom) {
            DOM.scrollToBottom(true);
          }
        });
      };

      try {
        const target = document.querySelector('main') || document.body;
        const observer = new MutationObserver(() => {
          if (this.settings.autoScroll !== false && DOM.isGenerating() && this.isStuckToBottom) {
            requestAutoScroll();
          }
        });
        observer.observe(target, {
          childList: true,
          subtree: true,
          characterData: true
        });
      } catch (e) {}

      // フォールバック定期タイマー（高速ストリーミング時も60ms間隔で確実に下端追従）
      this.autoScrollInterval = setInterval(() => {
        if (this.settings.autoScroll === false) return;
        if (!DOM.isGenerating()) return;

        if (this.isStuckToBottom) {
          DOM.scrollToBottom(true);
        } else if (DOM.isNearBottom(140)) {
          this.isStuckToBottom = true;
          DOM.scrollToBottom(true);
        }
      }, 60);
      if (this.autoScrollInterval && typeof this.autoScrollInterval.unref === 'function') {
        this.autoScrollInterval.unref();
      }
    }

    setupUrlWatcher() {
      const check = () => this.checkUrlChange();
      setInterval(check, document.hidden ? 1500 : 500);
      window.addEventListener('popstate', check);
      window.addEventListener('hashchange', check);
    }

    setupConnectionLostWatcher() {
      if (IS_GEMINI) return;
      setInterval(() => {
        this.checkConnectionAndAutoReload();
      }, 1000);
    }

    checkConnectionAndAutoReload() {
      if (IS_GEMINI) return false;
      if (this.settings.autoReloadOnDisconnect === false) return false;

      const isLost = DOM.checkConnectionLost();
      if (isLost) {
        const now = Date.now();
        // Wait at least 2 minutes, and start over while the answer is still arriving:
        // reloading mid-receive would throw that text away.
        const answerLength = DOM.getLastResponseLength();
        if (!this.connectionLostSince || answerLength !== this.connectionLostAnswerLength) {
          if (!this.connectionLostSince) {
            console.warn('[ChatGPT Queue] Connection lost detected ("接続が途切れました。回答全体の受信を待っています"). Reloading after at least 2 minutes without new answer text.');
          }
          this.connectionLostSince = now;
          this.connectionLostAnswerLength = answerLength;
        }

        const timeoutSec = Math.max(120, this.settings.disconnectReloadTimeout || 120);
        const timeoutMs = timeoutSec * 1000;
        const elapsed = now - this.connectionLostSince;
        const remainingMs = Math.max(0, timeoutMs - elapsed);
        const remainingSec = Math.ceil(remainingMs / 1000);

        const countdownText = remainingSec >= 60
          ? `${Math.floor(remainingSec / 60)}分${remainingSec % 60 > 0 ? (remainingSec % 60) + '秒' : ''}`
          : `${remainingSec}秒`;

        this.currentAction = `接続切断中: ${countdownText}後に再読込`;
        this.progressText = `接続が途切れました (回答の受信が止まってから2分後に再読み込み: 残り ${countdownText})`;
        this.progressPercent = Math.min(100, Math.round((elapsed / timeoutMs) * 100));

        if (this.currentState !== QueueState.CONNECTION_LOST) {
          this.setState(QueueState.CONNECTION_LOST, this.currentAction);
        } else {
          this.notify();
        }

        if (elapsed >= timeoutMs) {
          console.warn('[ChatGPT Queue] No new answer text for 2 minutes while disconnected. Reloading the page now...');
          this.connectionLostSince = null;
          try { this.saveQueue(); } catch (e) {}
          this.reloadPage();
          return true;
        }
        return true;
      } else {
        if (this.connectionLostSince) {
          console.log('[ChatGPT Queue] Connection restored before reload timeout. Resetting connection lost state.');
          this.connectionLostSince = null;
          if (this.currentState === QueueState.CONNECTION_LOST) {
            this.setState(QueueState.IDLE, '待機中');
          }
          this.notify();
        }
        return false;
      }
    }

    reloadPage() {
      try {
        window.location.reload();
      } catch (e) {
        window.location.href = window.location.href;
      }
    }

    navigateToNewChat(url) {
      window.location.assign(url);
    }

    // Open a new chat in this tab and carry the remaining queue (with each item's tools) over to it.
    async startNewChat(reason, nextItems = this.items, allowSameUrl = false) {
      const originalItems = this.items;
      this.commandOriginalItems = allowSameUrl ? originalItems : null;
      this.switchingChatSince = Date.now();
      this.setState(QueueState.WAITING_GENERATION, reason);
      try {
        // Store before navigating: a full page load must not lose the pending queue.
        await chrome.storage.local.set({ [this.storageKeyQueue]: nextItems });
        sessionStorage.setItem(SESSION_KEY_CHAT_ROLLOVER, JSON.stringify({
          sourceTabId: this.tabId,
          sourceUrl: this.currentUrl,
          targetUrl: DOM.getNewChatUrl(),
          isPaused: this.isPaused,
          allowSameUrl
        }));
        this.items = nextItems;
        sessionStorage.removeItem(SESSION_KEY_STALL);
        sessionStorage.removeItem(SESSION_KEY_TIMEOUT);
        this.navigateToNewChat(DOM.getNewChatUrl());
        return true;
      } catch (error) {
        this.items = originalItems;
        this.commandOriginalItems = null;
        try { await chrome.storage.local.set({ [this.storageKeyQueue]: originalItems }); } catch {}
        this.switchingChatSince = null;
        this.chatRolloverFailed = true;
        sessionStorage.removeItem(SESSION_KEY_CHAT_ROLLOVER);
        this.isPaused = true;
        this.setState(QueueState.PAUSED, '新しいチャットを開けませんでした。キューを保持して停止しました。');
        return false;
      }
    }

    async executeNewChat(item) {
      const parsed = CGQComposerTools.parsePrompt(item?.text);
      if (parsed.action !== 'newchat') return false;
      const nextItems = this.items.slice(1);
      if (parsed.text) nextItems.unshift({ ...item, text: parsed.text });
      await this.startNewChat('新しいチャットを開始中...', nextItems, true);
      return true;
    }

    // Delivery timed out: press the retry button if there is one; still failing after 30s (or no
    // button) -> reload once; still failing after the reload -> continue in a new chat with the
    // timed-out prompt put back at the front of the queue. The step survives the reload in sessionStorage.
    async checkDeliveryTimeout() {
      if (this.switchingChatSince || this.chatRolloverFailed) return false;
      let mark;
      try { mark = JSON.parse(sessionStorage.getItem(SESSION_KEY_TIMEOUT) || 'null'); } catch (e) { mark = null; }
      const now = Date.now();
      if (mark && now - mark.at > 10 * 60 * 1000) mark = null;
      const sentRecord = sessionStorage.getItem(SESSION_KEY_STALL);
      if ((!sentRecord && this.items.length === 0) || !DOM.hasDeliveryTimeout()) {
        if (mark && now - mark.at > 60 * 1000) sessionStorage.removeItem(SESSION_KEY_TIMEOUT); // recovered
        return false;
      }
      const setMark = step => sessionStorage.setItem(SESSION_KEY_TIMEOUT, JSON.stringify({ step, at: now }));

      if (!mark) {
        const retry = DOM.getRetryButton();
        if (retry) {
          setMark('retry');
          console.warn('[ChatGPT Queue] Message delivery timed out. Pressing the retry button.');
          this.setState(QueueState.WAITING_GENERATION, 'メッセージの配信がタイムアウトしたため再試行しています...');
          retry.click();
          return true;
        }
      }
      if (mark?.step === 'retry' && now - mark.at < 30 * 1000) return true; // give the retry time
      if (!mark || mark.step === 'retry') {
        setMark('reload');
        console.warn('[ChatGPT Queue] Message delivery timed out. Reloading the page once.');
        this.setState(QueueState.WAITING_GENERATION, 'メッセージの配信がタイムアウトしたため再読み込みします...');
        await this.saveQueue();
        this.reloadPage();
        return true;
      }
      sessionStorage.removeItem(SESSION_KEY_TIMEOUT);
      try {
        const stall = JSON.parse(sentRecord || 'null');
        if (stall?.item) this.items.unshift({ ...stall.item, id: `timeout_${now}` });
      } catch (e) {}
      sessionStorage.removeItem(SESSION_KEY_STALL);
      console.warn('[ChatGPT Queue] Delivery still timing out after a reload. Continuing in a new chat.');
      await this.startNewChat('再読み込み後も配信がタイムアウトするため、新しいチャットで続けます...');
      return true;
    }

    // After a send, remember what was sent. If the answer then shows no progress at all for
    // STALL_MS (still "generating", disconnected, or never started), put that prompt back at the
    // front of the queue and continue in a new chat. Kept in sessionStorage so the 2-minute
    // reconnect reload does not reset the clock.
    rememberSent(item) {
      try {
        sessionStorage.setItem(SESSION_KEY_STALL, JSON.stringify({
          item: { text: item.text, tools: item.tools || [], model: item.model, effort: item.effort },
          url: this.currentUrl, sentAt: Date.now(), since: Date.now(),
          baseLength: DOM.getLastResponseLength(), sig: ''
        }));
      } catch (e) {}
    }

    async checkStalledAndStartNewChat() {
      let stall;
      try { stall = JSON.parse(sessionStorage.getItem(SESSION_KEY_STALL) || 'null'); } catch (e) { stall = null; }
      if (!stall || this.isPaused || this.switchingChatSince || this.chatRolloverFailed) return false;
      const now = Date.now();
      const generating = DOM.isGenerating();
      const length = DOM.getLastResponseLength();
      // Only real progress counts: the 2-minute reconnect reload flips generating / disconnected flags.
      const sig = `${length}:${HumanSimulator.userNodes().length}`;
      const answered = !generating && !this.connectionLostSince && length !== stall.baseLength && now - stall.sentAt > 5000;
      if (answered) {
        sessionStorage.removeItem(SESSION_KEY_STALL);
        return false;
      }
      if (sig !== stall.sig) {
        stall.sig = sig;
        stall.since = now;
        sessionStorage.setItem(SESSION_KEY_STALL, JSON.stringify(stall));
        return false;
      }
      if (now - stall.since < STALL_MS) return false;
      sessionStorage.removeItem(SESSION_KEY_STALL);
      console.warn('[ChatGPT Queue] No answer progress for 1 hour. Re-queueing the prompt in a new chat.');
      this.items.unshift({ ...stall.item, id: `stall_${now}` });
      await this.startNewChat('1時間以上応答がないため、新しいチャットで続きを送信します...');
      return true;
    }

    async checkConversationLimitAndStartNewChat() {
      if (this.switchingChatSince) {
        if (Date.now() - this.switchingChatSince < 15000) return true;
        this.switchingChatSince = null;
        this.chatRolloverFailed = true;
        sessionStorage.removeItem(SESSION_KEY_CHAT_ROLLOVER);
        this.isPaused = true;
        if (this.commandOriginalItems) {
          this.items = this.commandOriginalItems;
          this.commandOriginalItems = null;
          await this.saveQueue();
        }
        this.setState(QueueState.PAUSED, '新しいチャットを開けませんでした。キューを保持して停止しました。');
      }
      if (this.chatRolloverFailed || !DOM.getConversationLimitWarning()) return false;
      await this.startNewChat('会話の長さ上限に達したため、新しいチャットを開始中...');
      return true;
    }

    async restoreConversationRollover() {
      const saved = sessionStorage.getItem(SESSION_KEY_CHAT_ROLLOVER);
      if (!saved) return false;
      try {
        const pending = JSON.parse(saved);
        const target = new URL(pending.targetUrl);
        const current = new URL(this.currentUrl);
        if (current.origin !== target.origin || current.pathname !== target.pathname ||
          (this.currentUrl === pending.sourceUrl && !pending.allowSameUrl)) return false;
        const sourceKey = `cgq_queue_${pending.sourceTabId}`;
        const result = await chrome.storage.local.get([sourceKey]);
        const items = Array.isArray(result[sourceKey]) ? result[sourceKey] : [];
        await chrome.storage.local.set({ [sourceKey]: [], [this.storageKeyQueue]: items });
        this.items = items;
        this.previousTabId = pending.sourceTabId;
        this.isPaused = pending.isPaused === true;
        this.switchingChatSince = null;
        this.chatRolloverFailed = false;
        sessionStorage.removeItem(SESSION_KEY_CHAT_ROLLOVER);
        this.setState(this.isPaused ? QueueState.PAUSED : QueueState.IDLE,
          '新しいチャットに切り替えました');
        return true;
      } catch (error) {
        // Leave the marker and source queue intact so a reload can retry recovery.
        this.isPaused = true;
        this.setState(QueueState.PAUSED, 'キューの引き継ぎに失敗しました。ページを再読み込みしてください。');
        return false;
      }
    }

    checkUrlChange() {
      const href = window.location.href;
      if (href !== this.currentUrl) {
        return this.handleUrlChange(href);
      }
    }

    async handleUrlChange(newUrl) {
      const oldUrl = this.currentUrl;
      if (newUrl === oldUrl) return;

      this.currentUrl = newUrl;

      const oldConvId = this.conversationId;
      const newConvId = extractConversationId(newUrl);

      // 1. If conversation ID didn't change (e.g. hash or ?model= query parameters):
      if (oldConvId === newConvId && oldConvId !== 'new') {
        this.reportToRegistry();
        return;
      }

      // 2. Initial prompt submission on New Chat -> ChatGPT assigns UUID to active conversation
      const isNewChatBinding = (
        oldConvId === 'new' &&
        newConvId !== 'new' &&
        (this.isBusy() || (Date.now() - this.lastSentTimestamp < 15000) || this.items.length > 0)
      );

      if (isNewChatBinding) {
        console.log(`[ChatGPT Queue] Binding active conversation: new -> ${newConvId}`);
        const oldTabId = this.tabId;
        this.conversationId = newConvId;
        this.tabId = computeTabId(this.sessionTabId, newConvId);
        this.previousTabId = oldTabId;

        // Migrate queue items to the new key
        await this.saveQueue();

        // Remove oldTabId from registry
        try {
          const result = await chrome.storage.local.get([STORAGE_KEY_REGISTRY]);
          const reg = result[STORAGE_KEY_REGISTRY] || {};
          delete reg[oldTabId];
          await chrome.storage.local.set({ [STORAGE_KEY_REGISTRY]: reg });
        } catch (e) {}

        await this.reportToRegistry();
        return;
      }

      // 3. User switched to a DIFFERENT conversation / tab!
      console.log(`[ChatGPT Queue] Switched conversation: ${oldConvId} -> ${newConvId} (${newUrl})`);
      const oldTabId = this.tabId;

      // Save old conversation queue before switching away
      await this.saveQueue();

      // Remove oldTabId from registry so Queue Manager immediately recognizes the switch
      try {
        const result = await chrome.storage.local.get([STORAGE_KEY_REGISTRY]);
        const reg = result[STORAGE_KEY_REGISTRY] || {};
        delete reg[oldTabId];
        await chrome.storage.local.set({ [STORAGE_KEY_REGISTRY]: reg });
      } catch (e) {}

      // Update to new conversation identity
      this.conversationId = newConvId;
      this.tabId = computeTabId(this.sessionTabId, newConvId);
      this.previousTabId = oldTabId;

      // Reset in-memory conversation state
      this.items = [];
      this.currentState = QueueState.IDLE;
      this.currentAction = '待機中 (キューは空です)';
      this.progressText = '';
      this.progressPercent = 0;
      this.activeItem = null;
      this.lastSentPrompt = '';
      this.lastSentTimestamp = 0;
      this.completedQA = [];

      // Load new conversation queue
      await this.loadFromStorage();

      // Notify UI to update mini panel
      this.notify();

      // Report new conversation to registry
      await this.reportToRegistry();
    }

    // キューが入力欄を使って自動入力・送信している間は、入力欄の内容はキューのものなので
    // ユーザーのEnter/送信クリックで横取り・クリアしない
    isComposerLocked() {
      return this.currentState === QueueState.TYPING || this.currentState === QueueState.PRE_SEND;
    }

    isBusy() {
      // 1. ChatGPT DOM is actively generating or streaming
      if (DOM.isGenerating()) return true;

      // 2. Tab queue has items waiting
      if (this.items && this.items.length > 0) return true;

      // 3. QueueManager is actively processing an item
      if (this.currentState !== QueueState.IDLE && this.currentState !== QueueState.PAUSED) return true;

      // 4. Currently executing an active queue item
      if (this.activeItem !== null) return true;

      // 5. User or extension submitted a prompt within cooldown (4000ms)
      if (this.lastSentTimestamp && (Date.now() - this.lastSentTimestamp < 4000)) return true;

      return false;
    }

    subscribe(fn) {
      this.listeners.push(fn);
    }

    notify() {
      this.listeners.forEach(fn => fn(this));
      this.reportToRegistry();
    }

    async loadFromStorage() {
      try {
        const qKey = this.storageKeyQueue;
        const result = await chrome.storage.local.get([
          qKey,
          STORAGE_KEY_SETTINGS,
          STORAGE_KEY_UI_STATE
        ]);

        if (Array.isArray(result[qKey])) {
          this.items = result[qKey];
        } else {
          this.items = [];
        }
        if (result[STORAGE_KEY_SETTINGS]) {
          this.settings = { ...DEFAULT_SETTINGS, ...result[STORAGE_KEY_SETTINGS] };
        }
        if (result[STORAGE_KEY_UI_STATE]) {
          this.uiState = { ...DEFAULT_UI_STATE, ...result[STORAGE_KEY_UI_STATE] };
        }
      } catch (e) {
        console.warn('[ChatGPT Queue] Storage load error:', e);
      }
    }

    setupStorageListener() {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;

        if (changes[STORAGE_KEY_SETTINGS]) {
          this.settings = { ...DEFAULT_SETTINGS, ...changes[STORAGE_KEY_SETTINGS].newValue };
          this.notify();
        }
        const qKey = this.storageKeyQueue;
        if (changes[qKey]) {
          this.items = changes[qKey].newValue || [];
          this.notify();
        }

        // Check for remote commands from Dashboard
        const cmdKey = this.storageKeyCmd;
        if (changes[cmdKey] && changes[cmdKey].newValue) {
          this.handleRemoteCommand(changes[cmdKey].newValue);
        }
      });
    }

    // ------------------------------------------------------------------------
    // Dashboard Registry Reporting (Heartbeat)
    // ------------------------------------------------------------------------
    setupRegistryHeartbeat() {
      // 稼働状況をダッシュボードへ定期同期（非表示かつ待機時は省電力モードで頻度調整）
      const beat = () => {
        this.reportToRegistry();
        const isIdle = this.items.length === 0 && !DOM.isGenerating();
        const interval = (document.hidden && isIdle) ? 3500 : 1500;
        setTimeout(beat, interval);
      };
      setTimeout(beat, 1500);

      // Clean up on tab close
      window.addEventListener('beforeunload', async () => {
        try {
          const result = await chrome.storage.local.get([STORAGE_KEY_REGISTRY]);
          const reg = result[STORAGE_KEY_REGISTRY] || {};
          delete reg[this.tabId];
          await chrome.storage.local.set({ [STORAGE_KEY_REGISTRY]: reg });
        } catch (e) {}
      });
    }

    // Write the snapshot of each rich turn that changed (at most every 1.5s per turn while it streams),
    // each under its own key so only that turn is rewritten; drop snapshots of turns no longer listed.
    async syncSnapshots(history) {
      if (typeof CGQSnapshot === 'undefined' || !this.tabId) return;
      this.snapState = this.snapState || new Map();
      const now = Date.now();
      const live = new Set();
      const writes = {};
      for (const qa of history) {
        const roots = qa.snapKey && snapRoots.get(qa.snapKey);
        if (!roots || !roots.every(r => r.isConnected)) continue;
        live.add(qa.snapKey);
        const sig = roots.map(snapSignature).join('|');
        const prev = this.snapState.get(qa.snapKey);
        if (prev && (prev.sig === sig || now - prev.at < 1500)) continue;
        const parts = roots.map((r, i) => CGQSnapshot.snapshot(r, { prefix: `k${i}_`, path: String(i) }));
        this.snapState.set(qa.snapKey, { sig: parts.some(p => p.pending) ? '' : sig, at: now });
        writes[`${SNAP_PREFIX}${this.tabId}_${qa.snapKey}`] = {
          html: parts.map(p => p.html).join(''), css: parts.map(p => p.css).join('\n'), at: now
        };
      }
      let stale = [...this.snapState.keys()].filter(k => !live.has(k)).map(k => `${SNAP_PREFIX}${this.tabId}_${k}`);
      for (const k of this.snapState.keys()) if (!live.has(k)) this.snapState.delete(k);
      if (!this.snapCleaned) {
        // Snapshots left by this tab's previous page load
        this.snapCleaned = true;
        const all = await chrome.storage.local.get(null);
        stale = stale.concat(Object.keys(all).filter(k => k.startsWith(`${SNAP_PREFIX}${this.tabId}_`) &&
          !live.has(k.slice(`${SNAP_PREFIX}${this.tabId}_`.length))));
      }
      if (Object.keys(writes).length) await chrome.storage.local.set(writes);
      if (stale.length) await chrome.storage.local.remove(stale);
    }

    // A click or a value from a snapshot in the Queue Manager, replayed on the page.
    answerAction(cmd) {
      const roots = snapRoots.get(cmd.key) || [];
      const [rootIndex, ...rest] = String(cmd.path || '').split('.');
      const root = roots[Number(rootIndex)];
      const el = root && CGQSnapshot.resolve(root, ['0', ...rest].join('.'));
      const ok = CGQSnapshot.act(el, cmd);
      if (!ok) showToast('この操作はページに反映できませんでした');
      this.snapState?.delete(cmd.key); // take a fresh snapshot right away
      setTimeout(() => this.reportToRegistry(), 300);
      setTimeout(() => this.reportToRegistry(), 1200);
      return ok;
    }

    async reportToRegistry() {
      try {
        const result = await chrome.storage.local.get([STORAGE_KEY_REGISTRY]);
        const reg = result[STORAGE_KEY_REGISTRY] || {};

        const existing = reg[this.tabId] || {};
        const createdAt = existing.createdAt || Date.now();
        const latestAns = DOM.getLatestAnswer(this.lastSentPrompt);
        const recentHistory = DOM.getRecentQAHistory(this.lastSentPrompt);

        // Record completed QA
        if (latestAns && latestAns.text && !latestAns.isStreaming && latestAns.text !== '（思考中・回答を生成しています...）') {
          const qText = latestAns.userPrompt || this.lastSentPrompt;
          // The latest turn is the same turn while its prompt is unchanged, even when its text changes
          // completely (an agent-style turn shows one log line after another: 「PDFスキル…を確認」→「修正方針を確認」).
          const last = this.completedQA[this.completedQA.length - 1];
          const known = qText && ((last && turnText(last.prompt) === turnText(qText) ? last : null) ||
            this.completedQA.find(c => sameTurn(c, { prompt: qText, answer: latestAns.text })));
          if (known) {
            known.answer = latestAns.text; // the answer can still change after it finished (sources, formatting)
          } else if (qText) {
            this.completedQA.push({
              prompt: qText,
              answer: latestAns.text,
              timestamp: latestAns.timestamp || Date.now()
            });
            if (this.completedQA.length > 50) this.completedQA.shift();
          }
        }

        // Merge DOM history with completedQA so historical turns are never lost
        let mergedQA = [...recentHistory];
        if (this.completedQA && this.completedQA.length > 0) {
          // Only turns the page no longer shows; the same turn read slightly differently is not new.
          // A prompt the page still shows is that turn, whatever its answer looked like when recorded.
          this.completedQA.forEach(c => {
            if (!mergedQA.some(m => sameTurn(m, c) || (c.prompt && turnText(m.prompt) === turnText(c.prompt)))) {
              mergedQA.push({
                prompt: c.prompt,
                answer: c.answer,
                isStreaming: false
              });
            }
          });
        }

        mergedQA = dropRepeatedTurns(mergedQA);
        mergedQA.forEach((qa, idx) => {
          qa.turn = idx + 1;
        });

        // Backfill prompt between latestAns and mergedQA if one is missing
        if (latestAns && !latestAns.userPrompt && mergedQA.length > 0 && mergedQA[mergedQA.length - 1].prompt) {
          latestAns.userPrompt = mergedQA[mergedQA.length - 1].prompt;
        }
        if (mergedQA.length > 0 && !mergedQA[mergedQA.length - 1].prompt && latestAns && latestAns.userPrompt) {
          mergedQA[mergedQA.length - 1].prompt = latestAns.userPrompt;
        }

        // Backfill answer between latestAns and mergedQA if one is missing
        if (latestAns && !latestAns.text && mergedQA.length > 0 && mergedQA[mergedQA.length - 1].answer) {
          latestAns.text = mergedQA[mergedQA.length - 1].answer;
        }
        if (mergedQA.length > 0 && !mergedQA[mergedQA.length - 1].answer && latestAns && latestAns.text) {
          mergedQA[mergedQA.length - 1].answer = latestAns.text;
        }

        // Backfill from completedQA if answer is still empty and not streaming
        if (latestAns && !latestAns.text && !latestAns.isStreaming && this.completedQA.length > 0) {
          const match = this.completedQA.find(c => c.prompt === (latestAns.userPrompt || this.lastSentPrompt));
          if (match && match.answer) {
            latestAns.text = match.answer;
          }
        }

        const finalAnswer = (latestAns && (latestAns.text || latestAns.isStreaming)) ? latestAns : (mergedQA.length > 0 ? {
          text: mergedQA[mergedQA.length - 1].answer,
          userPrompt: mergedQA[mergedQA.length - 1].prompt || (latestAns ? latestAns.userPrompt : ''),
          isStreaming: mergedQA[mergedQA.length - 1].isStreaming || false,
          timestamp: Date.now()
        } : latestAns);

        const progress = DOM.getProgress();
        if (finalAnswer) {
          if (progress && finalAnswer.isStreaming !== false) finalAnswer.progress = progress;
          else delete finalAnswer.progress;
        }

        const modelInfo = DOM.getCurrentModelInfo();

        reg[this.tabId] = {
          tabId: this.tabId,
          previousTabId: this.previousTabId || null,
          chromeTabId: this.chromeTabId,
          platform: PLATFORM_ID,
          createdAt: createdAt,
          title: (document.title || (IS_GEMINI ? 'Gemini' : 'ChatGPT'))
            .replace(/\s*[-–—|]\s*Google\s*Gemini\s*$/i, '')
            .replace(/\s*[-–—|]\s*Gemini\s*$/i, '')
            .trim() || (IS_GEMINI ? 'Gemini' : 'ChatGPT'),
          url: window.location.href,
          lastHeartbeat: Date.now(),
          currentState: this.currentState,
          currentAction: this.currentAction,
          progressText: this.progressText,
          progressPercent: this.progressPercent,
          activeItem: this.activeItem,
          isPaused: this.isPaused,
          itemCount: this.items.length,
          items: this.items,
          latestAnswer: finalAnswer,
          recentQA: mergedQA,
          model: modelInfo.model,
          modelLabel: modelInfo.modelLabel,
          effort: modelInfo.effort,
          effortLabel: modelInfo.effortLabel,
          supportsEffort: modelInfo.supportsEffort,
          availableModels: modelInfo.availableModels,
          modelsError: modelInfo.modelsError,
          availableEfforts: modelInfo.availableEfforts
        };

        // Purge truly dead tabs (no heartbeat in 20 seconds, preventing background throttling flicker)
        const now = Date.now();
        for (const tid in reg) {
          if (tid !== this.tabId && (now - (reg[tid].lastHeartbeat || 0) > 20000)) {
            delete reg[tid];
          }
        }

        await chrome.storage.local.set({ [STORAGE_KEY_REGISTRY]: reg });
        this.syncSnapshots(mergedQA).catch(e => console.warn('[ChatGPT Queue] snapshot failed:', e));
        return reg[this.tabId];
      } catch (e) { return null; }
    }

    async handleRemoteCommand(cmd) {
      if (!cmd || !cmd.action) return;

      if (cmd.action === 'TOGGLE_PAUSE') {
        this.togglePause();
      } else if (cmd.action === 'CLEAR_QUEUE') {
        this.clearQueue();
      } else if (cmd.action === 'SEND_IMMEDIATELY') {
        this.sendImmediately(cmd.id);
      } else if (cmd.action === 'REMOVE_ITEM') {
        this.removeItem(cmd.id);
      } else if (cmd.action === 'MOVE_ITEM') {
        this.moveItem(cmd.id, cmd.direction);
      } else if (cmd.action === 'ANSWER_ACTION') {
        this.answerAction(cmd);
      } else if (cmd.action === 'SKIP_THINKING') {
        showToast(DOM.skipThinking() ? '思考をスキップしました' : 'スキップできる思考はありません');
      } else if (cmd.action === 'CHOOSE_OPTION') {
        DOM.applyChoice(cmd.key, cmd.option).then(ok => {
          showToast(ok ? '選択を送信しました' : 'この選択肢はもう選べません');
        });
      } else if (cmd.action === 'ENQUEUE') {
        this.enqueue(cmd.text, { model: cmd.model, effort: cmd.effort, tools: cmd.tools });
      } else if (cmd.action === 'ENQUEUE_MANY') {
        this.enqueueMany(cmd.texts, { model: cmd.model, effort: cmd.effort, tools: cmd.tools });
      } else if (cmd.action === 'SWITCH_MODEL') {
        try {
          if (DOM.isGenerating() || this.currentState === QueueState.TYPING || this.currentState === QueueState.PRE_SEND) {
            throw new Error('処理中はモデルを切り替えられません。');
          }
          await DOM.switchModel(cmd.model);
          await this.reportToRegistry();
        } catch (error) {
          showToast(error.message);
        }
      } else if (cmd.action === 'SWITCH_EFFORT') {
        await DOM.switchReasoningEffort(cmd.effort);
        await this.reportToRegistry();
      }

      // Clear executed command
      chrome.storage.local.remove(this.storageKeyCmd);
    }

    async saveQueue() {
      try {
        await chrome.storage.local.set({ [this.storageKeyQueue]: this.items });
      } catch (e) {}
      this.notify();
    }

    async saveSettings(newSettings) {
      this.settings = { ...this.settings, ...newSettings };
      try {
        await chrome.storage.local.set({ [STORAGE_KEY_SETTINGS]: this.settings });
      } catch (e) {}
      this.notify();
    }

    async saveUIState(newUIState) {
      this.uiState = { ...this.uiState, ...newUIState };
      try {
        await chrome.storage.local.set({ [STORAGE_KEY_UI_STATE]: this.uiState });
      } catch (e) {}
    }

    async enqueue(text, options = {}) {
      const clean = text.trim();
      if (!clean) return null;

      const item = {
        id: generateId(),
        text: clean,
        model: options.model || null,
        effort: options.effort || null,
        tools: CGQComposerTools.normalize(options.tools),
        createdAt: Date.now(),
      };
      CGQComposerTools.remember(item.tools);

      try {
        const qKey = this.storageKeyQueue;
        const result = await chrome.storage.local.get([qKey]);
        const latestQueue = Array.isArray(result[qKey]) ? result[qKey] : [];
        latestQueue.push(item);
        this.items = latestQueue;
      } catch (e) {
        this.items.push(item);
      }

      await this.saveQueue();
      showToast(`キューに追加しました (#${this.items.length})`);
      return item;
    }

    async enqueueMany(textList, options = {}) {
      const added = [];
      const newItems = [];
      textList.forEach(t => {
        const clean = t.trim();
        if (clean) {
          const item = {
            id: generateId(),
            text: clean,
            model: options.model || null,
            effort: options.effort || null,
            tools: CGQComposerTools.normalize(options.tools),
            createdAt: Date.now(),
          };
          newItems.push(item);
          added.push(item);
        }
      });
      if (added.length === 0) return [];

      try {
        const qKey = this.storageKeyQueue;
        const result = await chrome.storage.local.get([qKey]);
        const latestQueue = Array.isArray(result[qKey]) ? result[qKey] : [];
        this.items = latestQueue.concat(newItems);
      } catch (e) {
        this.items = this.items.concat(newItems);
      }

      await this.saveQueue();
      showToast(`${added.length}件のプロンプトをキューに追加しました`);
      return added;
    }

    async removeItem(id) {
      try {
        const qKey = this.storageKeyQueue;
        const result = await chrome.storage.local.get([qKey]);
        let latestQueue = Array.isArray(result[qKey]) ? result[qKey] : this.items;
        latestQueue = latestQueue.filter(item => item.id !== id);
        this.items = latestQueue;
      } catch (e) {
        this.items = this.items.filter(item => item.id !== id);
      }
      await this.saveQueue();
    }

    async moveItem(id, direction) {
      const idx = this.items.findIndex(item => item.id === id);
      if (idx === -1) return;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= this.items.length) return;

      const [removed] = this.items.splice(idx, 1);
      this.items.splice(targetIdx, 0, removed);
      await this.saveQueue();
    }

    async updateItem(id, newText) {
      if (!String(newText || '').trim()) { showToast('プロンプトを空にはできません'); return false; }
      if (this.activeItem?.id === id && this.isComposerLocked()) { showToast('送信処理中の項目は編集できません'); return false; }
      const item = this.items.find(item => item.id === id);
      if (item) {
        try {
          await chrome.storage.local.set({ [this.storageKeyQueue]: this.items.map(entry =>
            entry.id === id ? { ...entry, text: newText.trim() } : entry) });
        } catch (error) {
          showToast('編集内容を保存できませんでした。入力内容を保持しています。');
          return false;
        }
        item.text = newText.trim();
        this.notify();
        return true;
      }
      showToast('この項目は既に送信または削除されています');
      return false;
    }

    async clearQueue() {
      this.items = [];
      await this.saveQueue();
      showToast('キューをクリアしました');
    }

    togglePause() {
      this.isPaused = !this.isPaused;
      if (!this.isPaused) this.chatRolloverFailed = false;
      this.setState(this.isPaused ? QueueState.PAUSED : QueueState.IDLE);
      showToast(this.isPaused ? 'キューを一時停止しました' : 'キューを再開しました');
    }

    setState(state, actionText = '') {
      this.currentState = state;
      this.currentAction = actionText;
      this.notify();
    }

    // ========================================================================
    // Autonomous Execution Loop (Runs in parallel across all tabs)
    // ========================================================================
    async startLoop() {
      if (this.loopRunning) return;
      this.loopRunning = true;

      while (true) {
        try {
          await this.runLoopStep();
        } catch (error) {
          if (error?.message === 'TEST_STOP') throw error;
          // Any unexpected error: log it, release the composer lock and keep the queue alive.
          console.warn('[ChatGPT Queue] loop error, recovering:', error);
          this.sendingNow = false;
          this.setState(this.isPaused ? QueueState.PAUSED : QueueState.IDLE, '');
          await sleep(1500);
        }
      }
    }

    async runLoopStep() {
      for (let once = true; once; once = false) {
        const isIdle = this.items.length === 0 && !DOM.isGenerating();
        const loopInterval = document.hidden ? (isIdle ? 2500 : 1000) : (isIdle ? 1000 : 400);
        await sleep(loopInterval);
        await this.checkUrlChange();

        if (this.editingItemId && this.items.some(item => item.id === this.editingItemId)) {
          this.setState(QueueState.WAITING_GENERATION, 'キューのプロンプトを編集中...');
          continue;
        }

        // Research plans require a user review. Do not feed the next queued prompt into it,
        // or treat time spent reviewing as a stalled generation that needs a new chat.
        if (DOM.getResearchPlanAction()) {
          if (!this.isPaused) this.setState(QueueState.WAITING_GENERATION, 'Deep Researchの計画確認待ち: 対象タブでリサーチを開始してください');
          continue;
        }

        if (await this.checkConversationLimitAndStartNewChat()) continue;
        if (await this.checkDeliveryTimeout()) continue;
        if (await this.checkStalledAndStartNewChat()) continue;

        if (this.checkConnectionAndAutoReload()) {
          await sleep(1000);
          continue;
        }

        if (this.isPaused) {
          if (this.currentState !== QueueState.PAUSED || !this.currentAction) this.setState(QueueState.PAUSED, '一時停止中');
          continue;
        }

        if (this.items.length === 0) {
          if (this.currentState !== QueueState.IDLE) {
            this.setState(QueueState.IDLE, '待機中');
            this.progressPercent = 0;
            this.progressText = '';
          }
          continue;
        }

        if (modelPicker.pending || composerTools.pending) continue;

        // 1. Post-send safety cooldown
        const timeSinceSend = Date.now() - this.lastSentTimestamp;
        if (timeSinceSend < 4000) {
          this.setState(QueueState.WAITING_GENERATION, 'ChatGPTの応答開始を確認中...');
          this.progressPercent = 0;
          this.progressText = '生成準備中...';
          continue;
        }

        // 2. Generating check
        if (DOM.isGenerating()) {
          this.setState(QueueState.WAITING_GENERATION, 'ChatGPTの回答生成中...');
          this.progressPercent = 0;
          this.progressText = '回答完了を待っています...';
          continue;
        }

        // 3. Stability check (Stop button gone for 1.8 seconds)
        this.setState(QueueState.WAITING_GENERATION, '回答完了の安定性を確認中...');
        let stable = true;
        const checkCount = document.hidden ? 3 : 18;
        const checkDelay = document.hidden ? 600 : 100;

        for (let check = 0; check < checkCount; check++) {
          await sleep(checkDelay);
          if (DOM.getConversationLimitWarning() || DOM.getResearchPlanAction() || DOM.isGenerating() || !DOM.getPromptInput() || this.isPaused || this.items.length === 0) {
            stable = false;
            break;
          }
        }
        if (!stable) continue;

        // 4. Next item ready
        const nextItem = this.items[0];
        this.activeItem = nextItem;

        // Commands are local queue actions. Wait for generation and preserve a user's draft.
        if (CGQComposerTools.parsePrompt(nextItem.text).action === 'newchat') {
          if (composerTools.capture().text || composerTools.capture().tools.length) {
            this.setState(QueueState.WAITING_GENERATION, '新しいチャットを開く前に入力欄の下書きを保存・削除してください');
            continue;
          }
          await this.executeNewChat(nextItem);
          continue;
        }

        // 5. Reading & Thinking Delay (with 2-3 hour continuous operation fatigue scaling)
        const now = Date.now();
        if (!this.sessionStartTime) this.sessionStartTime = now;
        if (!this.lastProcessedTime) this.lastProcessedTime = now;
        if (now - this.lastProcessedTime > 20 * 60 * 1000) {
          // If idle for over 20 min, treat as fresh session
          this.sessionStartTime = now;
        }
        this.lastProcessedTime = now;
        const continuousHours = (now - this.sessionStartTime) / (1000 * 60 * 60);

        const lastRespLen = DOM.getLastResponseLength();
        let readDuration = this.settings.minReadDelay + Math.random() * (this.settings.maxReadDelay - this.settings.minReadDelay);

        if (this.settings.dynamicDelay && lastRespLen > 300) {
          const bonus = Math.min(3.5, (lastRespLen / 1000) * 0.8);
          readDuration += bonus;
        }

        // When running continuously for 2-3 hours, humans naturally take longer pauses (up to 10 minutes)
        if (this.settings.continuousFatigue !== false && continuousHours >= 0.5) {
          // Progress: 0.0 at 30m, 1.0 at 2.5h and beyond
          const fatigueProgress = Math.min(1.0, (continuousHours - 0.5) / 2.0);
          const rand = Math.random();
          let fatigueBonus = 0;
          if (rand < 0.30) {
            // ~30% chance: deep reading / coffee break / context-switching (3 - 10 minutes)
            fatigueBonus = fatigueProgress * (180 + Math.random() * 420);
          } else if (rand < 0.70) {
            // ~40% chance: thorough consideration (45s - 180s)
            fatigueBonus = fatigueProgress * (45 + Math.random() * 135);
          } else {
            // ~30% chance: thoughtful pause (15s - 45s)
            fatigueBonus = fatigueProgress * (15 + Math.random() * 30);
          }
          readDuration += fatigueBonus;
          readDuration = Math.min(600, readDuration); // Maximum 10 minutes (600s)
        }

        if (document.hidden && continuousHours < 0.5) {
          readDuration = Math.min(readDuration, 2.0);
        }

        const formatDelayTime = sec => {
          sec = Math.round(sec);
          if (sec >= 60) {
            const m = Math.floor(sec / 60);
            const s = sec % 60;
            return s > 0 ? `${m}分${s}秒` : `${m}分`;
          }
          return `${sec}秒`;
        };

        const readMs = Math.round(readDuration * 1000);
        const readStart = Date.now();

        const statusMessage = readDuration >= 60
          ? `継続稼働中: 思考・休憩待機 (${formatDelayTime(readDuration)}後に入力)...`
          : '回答を確認中 (読書・思考待機)...';
        this.setState(QueueState.READING_DELAY, statusMessage);

        let aborted = false;
        while (Date.now() - readStart < readMs) {
          if (this.isPaused || this.items.length === 0 || this.items[0].id !== nextItem.id) {
            aborted = true;
            break;
          }
          if (DOM.getConversationLimitWarning() || DOM.getResearchPlanAction() || DOM.isGenerating()) {
            aborted = true;
            break;
          }

          const elapsed = Date.now() - readStart;
          const remainingSec = Math.max(0, (readMs - elapsed) / 1000);
          this.timerRemaining = remainingSec.toFixed(1);
          this.progressPercent = Math.min(100, Math.round((elapsed / readMs) * 100));
          this.progressText = `次回送信まで: 残り ${formatDelayTime(remainingSec)}`;
          this.notify();
          await sleep(document.hidden ? 500 : 100);
        }

        if (aborted || this.editingItemId === nextItem.id || modelPicker.pending || composerTools.pending) continue;
        if (await this.checkConversationLimitAndStartNewChat()) continue;

        // 5.5 Verify the requested model before typing or sending anything.
        try {
          if (nextItem.model && nextItem.model !== 'auto') {
            this.setState(QueueState.TYPING, `モデルを ${DOM.formatModelLabel(nextItem.model)} に切替中...`);
            await DOM.switchModel(nextItem.model);
          }
        } catch (error) {
          this.isPaused = true;
          this.progressText = error.message;
          this.setState(QueueState.PAUSED, `自動送信を停止: ${error.message}`);
          showToast(`自動送信を停止: ${error.message}`);
          continue;
        }

        // The reasoning setting is best effort: if it cannot be changed, send with the current setting.
        const curInfo = DOM.getCurrentModelInfo();
        if (nextItem.effort && nextItem.effort !== 'auto' && curInfo.effort !== nextItem.effort) {
          this.setState(QueueState.TYPING, `推論エフォートを ${DOM.formatEffortLabel(nextItem.effort)} に設定中...`);
          let switched = false;
          try { switched = await DOM.switchReasoningEffort(nextItem.effort); } catch (e) { switched = false; }
          if (!switched) showToast(`思考設定「${DOM.formatEffortLabel(nextItem.effort)}」を変更できなかったため、現在の設定のまま続行します`);
        }
        if (this.isPaused || DOM.getResearchPlanAction() || DOM.isGenerating() || !this.items.length || this.items[0].id !== nextItem.id) continue;

        const draft = DOM.getComposerText();
        if (draft) {
          // Text this loop typed earlier and then abandoned (pause, reorder, limit check):
          // clear it instead of waiting forever for the "user's draft" to disappear.
          if (this.leftoverDraft && normalizeDraft(draft) === normalizeDraft(this.leftoverDraft)) {
            DOM.clearComposer();
            this.leftoverDraft = null;
            await sleep(300);
            continue;
          }
          // The user's own draft: once it has stopped changing for DRAFT_IDLE_MS, send it as typed
          // (tools and all); the queued item follows on the next round.
          const now = Date.now();
          if (this.draftSeen?.text !== draft) {
            this.draftSeen = { text: draft, since: now };
          }
          const waitMs = DRAFT_IDLE_MS - (now - this.draftSeen.since);
          if (waitMs > 0) {
            this.setState(QueueState.WAITING_GENERATION, `入力欄の下書きを送信します (${Math.ceil(waitMs / 1000)}秒入力がなければ)`);
            continue;
          }
          this.draftSeen = null;
          this.setState(QueueState.PRE_SEND, '入力欄の下書きを送信中...');
          let draftSent = false;
          this.sendingNow = true;
          try {
            draftSent = await HumanSimulator.clickSend(draft);
          } catch (error) {
            console.warn('[ChatGPT Queue] draft send failed:', error);
          } finally {
            this.sendingNow = false;
          }
          if (draftSent) {
            this.lastSentTimestamp = Date.now();
            this.lastSentPrompt = draft;
            this.setState(QueueState.IDLE, '入力欄の下書きを送信しました');
            await sleep(2000);
          } else {
            this.isPaused = true;
            this.setState(QueueState.PAUSED, '入力欄の下書きを送信できなかったため停止しました');
            showToast('入力欄の下書きを送信できなかったため一時停止しました');
          }
          continue;
        }
        this.draftSeen = null;
        let promptTokens;
        let resolvedPrompt;
        try {
          this.setState(QueueState.TYPING, 'アプリ・ツールの指定を確認中...');
          resolvedPrompt = await composerTools.resolvePrompt(nextItem.text, nextItem.tools || []);
          promptTokens = await composerTools.prepare(resolvedPrompt.tools, () =>
            this.isPaused || this.items[0]?.id !== nextItem.id || DOM.isGenerating());
        } catch (error) {
          this.isPaused = true;
          this.progressText = error.message;
          this.setState(QueueState.PAUSED, `自動送信を停止: ${error.message}`);
          showToast(`自動送信を停止: ${error.message}`);
          continue;
        }

        // 6. Typing / Pasting Simulation
        const inputElem = DOM.getPromptInput();
        if (!inputElem) {
          this.setState(QueueState.WAITING_GENERATION, '入力欄を探索中...');
          await sleep(1000);
          continue;
        }

        this.setState(QueueState.TYPING, 'プロンプトを入力中...');
        this.progressPercent = 0;

        let typedSuccessfully;
        try {
          typedSuccessfully = await HumanSimulator.typeText(
            inputElem,
            resolvedPrompt.text,
            this.settings,
            (current, total, mode) => {
              this.progressPercent = Math.round((current / total) * 100);
              if (mode === 'paste') {
                this.progressText = `貼り付け完了 (${total}文字)`;
              } else if (mode === 'typo') {
                this.progressText = `入力訂正中...`;
              } else {
                this.progressText = `入力中: ${current} / ${total}文字 (${this.progressPercent}%)`;
              }
              this.notify();
            },
            promptTokens
          );
        } catch (error) {
          DOM.clearComposer();
          this.leftoverDraft = null;
          this.isPaused = true;
          this.setState(QueueState.PAUSED, `自動送信を停止: ${error.message}`);
          showToast(`自動送信を停止: ${error.message}`);
          continue;
        }
        this.leftoverDraft = resolvedPrompt.text;

        if (!typedSuccessfully || this.isPaused || this.items.length === 0 || this.items[0].id !== nextItem.id) {
          continue;
        }
        if (await this.checkConversationLimitAndStartNewChat()) continue;

        const selectedTools = composerTools.capture().tools;
        if (resolvedPrompt.tools.some(tool => !selectedTools.some(actual => actual.type === tool.type &&
          (actual.id === tool.id || (tool.type === 'tool' && actual.label === tool.label))))) {
          this.isPaused = true;
          this.setState(QueueState.PAUSED, 'アプリ・ツールの指定が失われたため送信を停止しました。');
          continue;
        }

        // 7. Pre-send & Click Send
        this.setState(QueueState.PRE_SEND, '送信ボタンをクリック中...');
        this.progressText = '送信中...';
        this.notify();

        let sent = false;
        this.sendingNow = true;
        try {
          sent = await HumanSimulator.clickSend(resolvedPrompt.text);
        } catch (error) {
          // Never let a send error end the loop with the prompt left in the composer.
          console.warn('[ChatGPT Queue] send failed:', error);
          sent = false;
        } finally {
          this.sendingNow = false;
        }

        // A rejected submission can still add a user bubble. Check the limit
        // before treating that bubble as confirmation and removing the item.
        if (await this.checkConversationLimitAndStartNewChat()) continue;

        // Failsafe confirmation: 送信ボタン押下後に回答生成が開始されたか、または最新ターンに対象プロンプトが存在すれば送信成功として扱う
        if (!sent) {
          if (DOM.isGenerating()) {
            sent = true;
          } else {
            const norm = v => String(v || '').replace(/\s+/g, ' ').trim();
            const probe = norm(resolvedPrompt.text).slice(0, 30);
            const latestTurn = DOM.extractLatestTurn?.();
            if (latestTurn && latestTurn.prompt && norm(latestTurn.prompt).includes(probe)) {
              sent = true;
            } else if (!norm(DOM.getComposerText()) && this.lastSentPrompt === resolvedPrompt.text) {
              sent = true;
            }
          }
        }

        if (sent) {
          this.rememberSent(nextItem);
          this.leftoverDraft = null;
          this.sendFailures = 0;
          this.lastSentTimestamp = Date.now();
          this.lastSentPrompt = resolvedPrompt.text;

          // 送信完了したアイテムを即座にメモリから削除
          this.items = this.items.filter(it => it.id !== nextItem.id);

          try {
            const qKey = this.storageKeyQueue;
            const result = await chrome.storage.local.get([qKey]);
            const latestQueue = Array.isArray(result[qKey]) ? result[qKey] : [];
            const filtered = latestQueue.filter(it => it.id !== nextItem.id);
            await chrome.storage.local.set({ [qKey]: filtered });
            this.items = filtered;
          } catch (e) {
            // メモリ上は既に削除済み
          }

          this.activeItem = null;
          await this.saveQueue();

          if (this.settings.autoScroll) {
            this.isStuckToBottom = true;
            DOM.scrollToBottom(true);
            setTimeout(() => DOM.scrollToBottom(true), 200);
            setTimeout(() => DOM.scrollToBottom(true), 500);
          }

          if (this.items.length === 0) {
            if (this.settings.soundNotification) {
              playChimeSound();
            }
            showToast('すべてのキューの送信が完了しました！');
          }

          await sleep(2000);
        } else {
          // Not confirmed as sent. Retry once; if it fails again, pause and keep the item
          // so the same prompt is not re-sent endlessly (or duplicated).
          this.sendFailures = (this.sendFailures || 0) + 1;
          if (this.sendFailures >= 2) {
            this.sendFailures = 0;
            this.isPaused = true;
            this.setState(QueueState.PAUSED, '送信を確認できなかったため停止しました。ChatGPTで送信状況を確認してください');
            showToast('送信を確認できなかったため一時停止しました。ChatGPTで送信状況を確認してください');
            continue;
          }
          DOM.clearComposer();
          this.leftoverDraft = null;
          await sleep(2000);
        }
      }
    }

    async sendImmediately(id) {
      const idx = this.items.findIndex(item => item.id === id);
      if (idx === -1) return;

      const [item] = this.items.splice(idx, 1);
      this.items.unshift(item);
      await this.saveQueue();
      this.isPaused = false;
      showToast('最優先で即時送信を開始します');
    }
  }

  window.__CGQ_QueueManager__ = QueueManager;

  // ==========================================================================
  // Visual UI Components (Fine-Grained DOM Updates & Dashboard Link)
  // ==========================================================================

  class QueueUI {
    constructor(queueManager) {
      this.qm = queueManager;
      this.panelElem = null;
      this.editingId = null;
      this.isCollapsed = false;

      this.domBadge = null;
      this.domSubtext = null;
      this.domChevron = null;
      this.domList = null;
      this.domProgress = null;
      this.domProgressBar = null;

      this.init();
    }

    init() {
      this.createPanelDOM();
      this.anchorToComposer();
      this.setupDOMObserver();
      this.setupKeyboardShortcuts();
      this.setupThemeWatcher();

      this.qm.subscribe(() => this.updateUI());
      this.updateUI();
    }

    detectPageIsDark() {
      if (IS_GEMINI) {
        if (document.body.classList.contains('dark-theme') || 
            document.documentElement.classList.contains('dark-theme') ||
            document.querySelector('body.dark-theme, [theme="dark"]')) {
          return true;
        }
        if (document.body.classList.contains('light-theme') || 
            document.documentElement.classList.contains('light-theme') ||
            document.querySelector('body.light-theme, [theme="light"]')) {
          return false;
        }
      } else {
        const root = document.documentElement;
        const body = document.body;
        if (root.classList.contains('dark') || body.classList.contains('dark') || root.getAttribute('data-color-scheme') === 'dark') {
          return true;
        }
        if (root.classList.contains('light') || body.classList.contains('light') || root.getAttribute('data-color-scheme') === 'light') {
          return false;
        }
      }

      // Check computed background color luminance
      try {
        const checkElemBg = (elem) => {
          if (!elem) return null;
          const bg = window.getComputedStyle(elem).backgroundColor;
          const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
          if (match) {
            const alpha = match[4] !== undefined ? parseFloat(match[4]) : 1;
            if (alpha > 0.1) {
              const r = parseInt(match[1], 10);
              const g = parseInt(match[2], 10);
              const b = parseInt(match[3], 10);
              return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            }
          }
          return null;
        };

        const lumBody = checkElemBg(document.body);
        if (lumBody !== null) return lumBody < 0.5;

        const lumRoot = checkElemBg(document.documentElement);
        if (lumRoot !== null) return lumRoot < 0.5;

        const lumMain = checkElemBg(document.querySelector('main, #__next, .chat-container, chat-window'));
        if (lumMain !== null) return lumMain < 0.5;
      } catch (e) {}

      return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }

    setupThemeWatcher() {
      const applyTheme = () => {
        if (!this.panelElem) return;

        const pref = this.qm.settings.themeMode || 'auto';
        let isDark = false;

        if (pref === 'dark') {
          isDark = true;
        } else if (pref === 'light') {
          isDark = false;
        } else {
          isDark = this.detectPageIsDark();
        }

        // One attribute on <html>: every injected element (panel, Queue button, menus, modals, toasts)
        // follows ChatGPT / Gemini's own light or dark theme through it.
        const theme = isDark ? 'dark' : 'light';
        if (document.documentElement.dataset.cgqTheme !== theme) document.documentElement.dataset.cgqTheme = theme;
      };

      const observer = new MutationObserver(applyTheme);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-color-scheme', 'style', 'data-theme'] });
      observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-color-scheme', 'style', 'data-theme'] });

      if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
      }

      applyTheme();
      setInterval(applyTheme, 1500);
    }

    createPanelDOM() {
      if (document.getElementById('cgq-composer-queue-panel')) return;

      const panel = document.createElement('div');
      panel.id = 'cgq-composer-queue-panel';
      panel.className = 'cgq-composer-queue-panel';

      this.isCollapsed = localStorage.getItem('cgq_panel_collapsed') !== 'false';
      if (this.isCollapsed) {
        panel.classList.add('cgq-collapsed');
      }

      panel.innerHTML = `
        <div class="cgq-panel-header" id="cgq-panel-header">
          <div class="cgq-panel-header-left">
            <div class="cgq-status-pill idle" id="cgq-status-pill" title="現在の実行ステータス">
              <span class="cgq-stat-dot"></span>
              <span class="cgq-status-text" id="cgq-panel-status-text">待機中</span>
            </div>
            <div class="cgq-count-badge" id="cgq-count-badge" title="待機キュー件数">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="8" y1="6" x2="21" y2="6"></line>
                <line x1="8" y1="12" x2="21" y2="12"></line>
                <line x1="8" y1="18" x2="21" y2="18"></line>
                <line x1="3" y1="6" x2="3.01" y2="6"></line>
                <line x1="3" y1="12" x2="3.01" y2="12"></line>
                <line x1="3" y1="18" x2="3.01" y2="18"></line>
              </svg>
              <span id="cgq-panel-badge">0件</span>
            </div>
            <span class="cgq-panel-subtext" id="cgq-panel-subtext">回答生成完了後に自動送信</span>
          </div>
          <div class="cgq-panel-header-right">
            <button type="button" class="cgq-panel-btn" id="cgq-btn-newchat" title="キューの末尾に新しいチャットの開始を追加" aria-label="新しいチャットをキューに追加">/newchat</button>
            <button class="cgq-panel-btn" id="cgq-btn-pause" title="キューを一時停止 / 再開">
              <svg id="cgq-icon-pause" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="6" y="4" width="4" height="16"></rect>
                <rect x="14" y="4" width="4" height="16"></rect>
              </svg>
            </button>
            <button class="cgq-panel-btn" id="cgq-btn-dashboard" title="Queue Manager (管理画面) を開く">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="7" height="7"></rect>
                <rect x="14" y="3" width="7" height="7"></rect>
                <rect x="14" y="14" width="7" height="7"></rect>
                <rect x="3" y="14" width="7" height="7"></rect>
              </svg>
            </button>
            <button class="cgq-panel-btn" id="cgq-btn-bulk" title="プロンプトを追加（複数行・一括入力）" style="display: none;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="8" y1="6" x2="21" y2="6"></line>
                <line x1="8" y1="12" x2="21" y2="12"></line>
                <line x1="8" y1="18" x2="21" y2="18"></line>
                <line x1="3" y1="6" x2="3.01" y2="6"></line>
                <line x1="3" y1="12" x2="3.01" y2="12"></line>
                <line x1="3" y1="18" x2="3.01" y2="18"></line>
              </svg>
            </button>
            <button class="cgq-panel-btn" id="cgq-btn-clear" title="キューをすべてクリア" style="display: none;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
            <button class="cgq-panel-btn" id="cgq-btn-settings" title="人間らしい挙動の設定" style="display: none;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </button>
            <button class="cgq-panel-btn cgq-chevron-btn" id="cgq-btn-chevron" title="詳細キューを展開 / たたむ">
              <svg class="cgq-chevron-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
          </div>
        </div>
        <div class="cgq-panel-progress" id="cgq-panel-progress">
          <div class="cgq-panel-progress-fill" id="cgq-panel-progress-fill" style="width: 0%;"></div>
        </div>
        <div class="cgq-panel-list" id="cgq-panel-list"></div>
      `;

      this.panelElem = panel;
      this.domStatusPill = panel.querySelector('#cgq-status-pill');
      this.domStatusText = panel.querySelector('#cgq-panel-status-text');
      this.domBadge = panel.querySelector('#cgq-panel-badge');
      this.domSubtext = panel.querySelector('#cgq-panel-subtext');
      this.domChevron = panel.querySelector('#cgq-btn-chevron');
      this.domList = panel.querySelector('#cgq-panel-list');
      panel.querySelectorAll('button').forEach(button => { button.type = 'button'; });
      this.domProgress = panel.querySelector('#cgq-panel-progress');
      this.domProgressBar = panel.querySelector('#cgq-panel-progress-fill');
      this.domBtnBulk = panel.querySelector('#cgq-btn-bulk');
      panel.querySelector('#cgq-btn-newchat').onclick = e => {
        e.stopPropagation();
        this.qm.enqueue('/newchat');
      };
      this.domBtnClear = panel.querySelector('#cgq-btn-clear');
      this.domBtnSettings = panel.querySelector('#cgq-btn-settings');

      this.bindStaticEvents();
    }

    anchorToComposer() {
      if (!this.panelElem) return;

      const input = DOM.getPromptInput();
      if (!input) {
        if (!this.panelElem.parentElement) {
          document.body.appendChild(this.panelElem);
        }
        return;
      }

      // Find the best form or composer container (supporting both ChatGPT and Gemini)
      const form = input.closest('form');
      const target = form ||
        input.closest('input-area') ||
        input.closest('div.input-area-container') ||
        input.closest('rich-textarea') ||
        input.closest('div[class*="composer-parent"]') ||
        input.closest('div[class*="composer"]') ||
        input.parentElement;

      if (target && target.parentElement) {
        if (this.panelElem.parentElement !== target.parentElement || this.panelElem.nextElementSibling !== target) {
          target.parentElement.insertBefore(this.panelElem, target);
        }
      } else if (!this.panelElem.parentElement) {
        document.body.appendChild(this.panelElem);
      }
    }

    bindStaticEvents() {
      const qm = this.qm;

      // Click on panel (when collapsed) expands it
      this.panelElem.onclick = (e) => {
        if (this.isCollapsed) {
          this.toggleCollapse();
        }
      };

      // Open Management Dashboard
      this.panelElem.querySelector('#cgq-btn-dashboard').onclick = (e) => {
        e.stopPropagation();
        chrome.runtime.sendMessage({ action: 'OPEN_DASHBOARD' });
      };

      // Pause/Resume
      this.panelElem.querySelector('#cgq-btn-pause').onclick = (e) => {
        e.stopPropagation();
        qm.togglePause();
      };

      // Bulk Add Prompts (expanded only)
      if (this.domBtnBulk) {
        this.domBtnBulk.onclick = (e) => {
          e.stopPropagation();
          this.showBulkAddModal();
        };
      }

      // Clear all items (expanded only)
      if (this.domBtnClear) {
        this.domBtnClear.onclick = (e) => {
          e.stopPropagation();
          if (confirm('キュー内のすべてのプロンプトを消去しますか？')) {
            qm.clearQueue();
          }
        };
      }

      // Settings (expanded only)
      if (this.domBtnSettings) {
        this.domBtnSettings.onclick = (e) => {
          e.stopPropagation();
          this.showSettingsModal();
        };
      }

      // Collapse / Expand toggle button
      this.domChevron.onclick = (e) => {
        e.stopPropagation();
        this.toggleCollapse();
      };
    }

    toggleCollapse() {
      this.isCollapsed = !this.isCollapsed;
      localStorage.setItem('cgq_panel_collapsed', this.isCollapsed ? 'true' : 'false');
      this.panelElem.classList.toggle('cgq-collapsed', this.isCollapsed);
      this.updateUI();
    }

    updateUI() {
      if (!this.panelElem) return;

      const qm = this.qm;
      const count = qm.items.length;

      // Gemini must retain an entry point even before its native send button exists.
      if (count === 0 && !IS_GEMINI) {
        this.panelElem.style.display = 'none';
        return;
      }

      // Show panel above composer
      this.panelElem.style.display = this.isCollapsed ? 'inline-flex' : 'block';
      this.anchorToComposer();

      // Ensure class state matches isCollapsed
      this.panelElem.classList.toggle('cgq-collapsed', this.isCollapsed);

      // Status Pill & Text (Managerテイスト)
      const statusInfo = this.getPanelStatusInfo();
      this.domStatusPill.className = `cgq-status-pill ${statusInfo.statusClass}`;
      this.domStatusText.textContent = statusInfo.statusText;
      this.domSubtext.textContent = statusInfo.subtext;

      // Badge count
      this.domBadge.textContent = `${count}件`;

      // Update Pause Button state
      const btnPause = this.panelElem.querySelector('#cgq-btn-pause');
      btnPause.classList.toggle('active', qm.isPaused);
      btnPause.innerHTML = qm.isPaused ? `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      ` : `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
      `;

      // Bulk, Clear & Settings buttons (visible only when expanded)
      if (this.domBtnBulk) {
        this.domBtnBulk.style.display = (!this.isCollapsed) ? 'inline-flex' : 'none';
      }
      if (this.domBtnClear) {
        this.domBtnClear.style.display = (!this.isCollapsed && count > 0) ? 'inline-flex' : 'none';
      }
      if (this.domBtnSettings) {
        this.domBtnSettings.style.display = (!this.isCollapsed) ? 'inline-flex' : 'none';
      }

      // Progress bar
      setProgress(this.domProgress, this.domProgressBar,
        !this.isCollapsed && (qm.currentState === QueueState.READING_DELAY || qm.currentState === QueueState.TYPING),
        qm.progressPercent);

      // Tooltip on chevron
      this.domChevron.title = this.isCollapsed ? '詳細キューを展開' : '小さく折りたたむ';

      // Render queue items when expanded
      if (!this.isCollapsed) {
        this.renderItems();
      }
    }

    getPanelStatusInfo() {
      const qm = this.qm;
      if (qm.currentState === QueueState.CONNECTION_LOST) {
        return {
          statusClass: 'waiting',
          statusText: '接続切断',
          subtext: qm.progressText || '接続が途切れました。再読み込み待機中...'
        };
      }
      if (qm.isPaused) {
        return {
          statusClass: 'paused',
          statusText: '一時停止中',
          subtext: '一時停止中 (クリックで再開)'
        };
      }
      if (qm.currentState === QueueState.WAITING_GENERATION) {
        const isStreaming = DOM.isGenerating();
        return {
          statusClass: 'waiting',
          statusText: isStreaming ? '回答生成中...' : '回答生成待ち...',
          subtext: '回答生成完了後に送信します...'
        };
      }
      if (qm.currentState === QueueState.READING_DELAY) {
        return {
          statusClass: 'waiting',
          statusText: `回答確認中 (${qm.progressText || '数秒'})`,
          subtext: `回答確認中 (${qm.progressText || '数秒'} 後に入力)...`
        };
      }
      if (qm.currentState === QueueState.PRE_SEND) {
        return { statusClass: 'typing', statusText: '送信中...', subtext: '送信ボタンをクリック中...' };
      }
      if (qm.currentState === QueueState.TYPING || qm.currentState === QueueState.PASTING) {
        return {
          statusClass: 'typing',
          statusText: `入力中 (${qm.progressPercent || 0}%)`,
          subtext: `入力中 (${qm.progressPercent || 0}%)...`
        };
      }
      return {
        statusClass: 'idle',
        statusText: '待機中',
        subtext: qm.items.length > 0 ? '回答生成完了後に自動送信' : 'キューは空です'
      };
    }

    renderItems() {
      const qm = this.qm;

      // Heartbeats and generation progress must not replace a live textarea or its caret.
      if (this.editingId && qm.items.some(item => item.id === this.editingId) &&
        this.domList.querySelector('.cgq-edit-textarea')) return;
      if (this.editingId && !qm.items.some(item => item.id === this.editingId)) {
        this.editingId = null;
        qm.editingItemId = null;
      }

      this.domList.innerHTML = qm.items.map((item, index) => {
        const isEditing = this.editingId === item.id;
        const isActive = qm.activeItem && qm.activeItem.id === item.id;

        if (isEditing) {
          return `
            <div class="cgq-panel-item cgq-editing" data-id="${item.id}">
              <div class="cgq-item-edit-area">
                <textarea class="cgq-edit-textarea" id="cgq-edit-input-${item.id}">${escapeHtml(item.text)}</textarea>
                <div class="cgq-edit-btns">
                  <button class="cgq-btn cgq-btn-secondary" id="cgq-cancel-edit">キャンセル</button>
                  <button class="cgq-btn cgq-btn-primary" id="cgq-save-edit" data-id="${item.id}">保存</button>
                </div>
              </div>
            </div>
          `;
        }

        return `
          <div class="cgq-panel-item ${isActive ? 'cgq-active' : ''}" data-id="${item.id}">
            <div class="cgq-item-text">
              <span>${escapeHtml(item.text)}</span>
              ${CGQComposerTools.normalize(item.tools).map(tool => `<span class="cgq-queued-tool">${tool.type === 'app' ? '@' : '/'}${escapeHtml(tool.label)}</span>`).join('')}
              ${item.model && item.model !== 'auto' ? `
                <span class="cgq-item-model-tag" title="指定モデル: ${escapeHtml(item.model)}">
                  ${escapeHtml(item.model)}${item.effort && item.effort !== 'auto' ? ` [${escapeHtml(item.effort === 'instant' ? 'Instant' : item.effort === 'medium' ? '中' : item.effort === 'high' ? '高' : item.effort)}]` : ''}
                </span>
              ` : ''}
            </div>
            <div class="cgq-item-actions">
              <button class="cgq-item-btn send-now" data-action="send-now" data-id="${item.id}" title="最優先で今すぐ送信">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              </button>
              <button class="cgq-item-btn edit" data-action="edit" data-id="${item.id}" title="編集">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </button>
              <button class="cgq-item-btn delete" data-action="delete" data-id="${item.id}" title="削除">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </div>
        `;
      }).join('');

      this.domList.querySelectorAll('button').forEach(button => { button.type = 'button'; });
      this.domList.querySelectorAll('.cgq-item-btn').forEach(btn => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const action = btn.dataset.action;
          const id = btn.dataset.id;
          if (action === 'delete') {
            qm.removeItem(id);
          } else if (action === 'send-now') {
            qm.sendImmediately(id);
          } else if (action === 'edit') {
            if (qm.activeItem?.id === id && qm.isComposerLocked()) {
              showToast('送信処理中の項目は編集できません');
              return;
            }
            this.editingId = id;
            qm.editingItemId = id;
            this.updateUI();
            this.domList.querySelector('.cgq-edit-textarea')?.focus();
          }
        };
      });

      const btnSaveEdit = this.domList.querySelector('#cgq-save-edit');
      const btnCancelEdit = this.domList.querySelector('#cgq-cancel-edit');
      if (btnSaveEdit) {
        btnSaveEdit.onclick = async e => {
          e.stopPropagation();
          const id = btnSaveEdit.dataset.id;
          const editInput = this.domList.querySelector('.cgq-edit-textarea');
          if (!editInput || !await qm.updateItem(id, editInput.value)) return;
          this.editingId = null;
          qm.editingItemId = null;
          this.updateUI();
        };
      }
      if (btnCancelEdit) {
        btnCancelEdit.onclick = () => {
          this.editingId = null;
          qm.editingItemId = null;
          this.updateUI();
        };
      }
    }

    setupDOMObserver() {
      const updateUIPlacement = () => {
        this.qm.checkUrlChange();
        this.anchorToComposer();
        injectButton();
      };

      // Two icon buttons beside the send button: "+" always adds the composer text to the queue
      // (an empty composer only shows a notice), the list icon opens the bulk panel.
      const injectButton = () => {
        const placement = DOM.getQueueButtonPlacement();
        if (!placement) return;

        let btn = document.getElementById('cgq-injected-btn');
        let bulk = document.getElementById('cgq-injected-bulk-btn');
        if (btn && bulk && btn.parentElement === placement.parent && btn.nextElementSibling === bulk) return;

        if (!btn) {
          btn = document.createElement('button');
          btn.id = 'cgq-injected-btn';
          btn.className = 'cgq-injected-btn';
          btn.type = 'button';
          btn.title = '入力内容をキューに追加';
          btn.setAttribute('aria-label', '入力内容をキューに追加');
          btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
          btn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            // The queue's own typing must not be captured back into the queue.
            if (this.qm.isComposerLocked()) {
              showToast('キューが入力欄を使用中です');
              return;
            }
            const text = DOM.getComposerText();
            if (!text) {
              showToast('入力欄が空です');
              return;
            }
            // Always queued, even when the chat is idle (the queue loop sends it in turn).
            await this.qm.enqueue(text, { tools: composerTools.capture().tools });
            DOM.clearComposer();
            showToast('キューに追加しました');
          };
        }
        if (!bulk) {
          bulk = document.createElement('button');
          bulk.id = 'cgq-injected-bulk-btn';
          bulk.className = 'cgq-injected-btn';
          bulk.type = 'button';
          bulk.title = 'プロンプトを追加（複数行・一括入力）';
          bulk.setAttribute('aria-label', 'プロンプトを一括追加');
          bulk.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>';
          bulk.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showBulkAddModal();
          };
        }
        placement.parent.insertBefore(btn, placement.before);
        placement.parent.insertBefore(bulk, btn.nextSibling);
      };

      updateUIPlacement();
      setInterval(updateUIPlacement, 1000);
      const observer = new MutationObserver(() => updateUIPlacement());
      observer.observe(document.body, { childList: true, subtree: true });
    }

    isBusy() {
      return this.qm.isBusy();
    }

    setupKeyboardShortcuts() {
      // キュー自身が入力欄を操作中は横取りしない（入力欄の文字をキューに取り込んで消してしまうため）
      // True for elements of the prompt composer itself, not buttons or forms elsewhere on the page
      // (an answer's choice widget has its own submit button, e.g. 「この方針で修正する」).
      const isComposerControl = el => {
        const input = DOM.getPromptInput();
        const composer = input?.closest('form, input-area, input-container, .text-input-field');
        return !!(el && ((composer && composer.contains(el)) || el === DOM.getSendButton()));
      };

      const swallowIfLocked = (e) => {
        if (!this.qm.isComposerLocked()) return false;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        showToast('キューが入力欄を使用中です。完了後にもう一度送信してください');
        return true;
      };

      // Preserve slash text so /newchat can be entered in the native composer.
      const enqueueCommand = async e => {
        const text = DOM.getComposerText();
        if (CGQComposerTools.parsePrompt(text).action !== 'newchat') return false;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        if (!this.qm.isComposerLocked()) {
          await this.qm.enqueue(text, { tools: composerTools.capture().tools });
          DOM.clearComposer();
        }
        return true;
      };
      const recordNativeSend = () => {
        const text = DOM.getComposerText();
        if (!text) return;
        this.qm.lastSentPrompt = text;
        this.qm.lastSentTimestamp = Date.now();
        this.qm.isStuckToBottom = true;
        setTimeout(() => DOM.scrollToBottom(true), 150);
      };
      // 1. Enter key in composer:
      // Native Enter sends normally; +, Ctrl/Cmd+Enter and Alt+Enter enqueue.
      document.addEventListener('keydown', async (e) => {
        if (!e.isTrusted) return;
        if (this.qm.sendingNow) return;
        if (e.isComposing || e.keyCode === 229) return;

        const input = DOM.getPromptInput();
        if (!input) return;

        const isInputFocused = (document.activeElement === input || input.contains(document.activeElement));
        if (!isInputFocused) return;
        const commandSubmit = e.key === 'Enter' && !e.shiftKey;
        if (commandSubmit && CGQComposerTools.parsePrompt(DOM.getComposerText()).action === 'newchat') {
          await enqueueCommand(e);
          return;
        }
        if (composerTools.menuOpen()) return;

        // Ctrl + Enter or Cmd + Enter: 常に強制キュー追加
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          if (swallowIfLocked(e)) return;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          const text = DOM.getComposerText();
          if (text) {
            await this.qm.enqueue(text, { tools: composerTools.capture().tools });
            DOM.clearComposer();
            this.qm.isStuckToBottom = true;
            DOM.scrollToBottom(true);
          }
          return;
        }

        // Enter key in composer
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
          if (swallowIfLocked(e)) return;
          recordNativeSend();
          return;
        }

        // Alt + Enter fallback: 常に強制キュー追加
        if (e.altKey && e.key === 'Enter') {
          if (swallowIfLocked(e)) return;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          const text = DOM.getComposerText();
          if (text) {
            await this.qm.enqueue(text, { tools: composerTools.capture().tools });
            DOM.clearComposer();
          }
        }
      }, true);

      // 2. Click interceptor on native Send Button
      document.addEventListener('click', async (e) => {
        if (!e.isTrusted) return;
        if (this.qm.sendingNow) return;

        const sendBtn = e.target.closest(
          'button[data-testid="send-button"], button[data-testid="fruitjuice-send-button"], #composer-submit-button, button[aria-label*="Send" i], button[aria-label*="送信"], button.send-button, button[mattooltip*="Send" i]'
        );
        if (!sendBtn || !isComposerControl(sendBtn)) return;
        if (e.target.closest('#cgq-injected-btn, #cgq-injected-bulk-btn')) return;

        // If it's a stop button, allow user to cancel generation normally
        const isStopBtn = (
          sendBtn.matches('button[data-testid="stop-button"], button[data-testid*="stop" i], button[aria-label*="Stop" i], button[aria-label*="停止"], button[aria-label*="中断"], button.stop-button') ||
          sendBtn.querySelector('rect') ||
          sendBtn.querySelector('mat-progress-bar') ||
          sendBtn.querySelector('.loading-spinner')
        );
        if (isStopBtn) return;

        if (CGQComposerTools.parsePrompt(DOM.getComposerText()).action === 'newchat') {
          await enqueueCommand(e);
          return;
        }

        if (swallowIfLocked(e)) return;

        recordNativeSend();
      }, true);

      // 3. Form submit interceptor (fallback)
      document.addEventListener('submit', async (e) => {
        if (!e.isTrusted) return;
        // Only the prompt composer: forms inside answers (choice widgets etc.) submit normally.
        if (!isComposerControl(e.target)) return;

        // キュー自身の送信（PRE_SEND中の sendBtn.click）は素通しする。
        // ここで止めると送信されず、入力欄の文字がキューに再追加されてしまう。
        if (this.qm.sendingNow) return;
        if (CGQComposerTools.parsePrompt(DOM.getComposerText()).action === 'newchat') {
          await enqueueCommand(e);
          return;
        }
        if (swallowIfLocked(e)) return;

        recordNativeSend();
      }, true);
    }

    showBulkAddModal() {
      const modal = document.createElement('div');
      modal.className = 'cgq-modal-overlay';
      modal.innerHTML = `
        <div class="cgq-modal-container" role="dialog" aria-modal="true" aria-label="プロンプトの一括追加">
          <div class="cgq-modal-header">
            <span>プロンプトの一括追加 (このタブ専用)</span>
            <button class="cgq-icon-btn" id="cgq-modal-close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="cgq-modal-body">
            <div class="cgq-form-desc">
              順番に実行します。/newchat で新しいチャットへ切り替え、@GitHub 質問 や @"Google Drive" 質問 でアプリを指定できます。/"Web search" 質問 でツールも指定できます。
            </div>
            <div class="cgq-form-group">
              <label class="cgq-form-label">区切り方式</label>
              <select id="cgq-bulk-delimiter" style="padding: 6px 10px; border-radius: 6px; border: 1px solid var(--cgq-border); background: var(--cgq-bg); color: var(--cgq-text-main);">
                <option value="single" selected>全体を1プロンプト（改行を保持）</option>
                <option value="line">1行ごとに1プロンプト</option>
                <option value="empty_line">空行（2連続改行）で区切る</option>
                <option value="hyphens">--- の行で区切る（複数行のプロンプトを一括追加）</option>
              </select>
            </div>
            <div class="cgq-form-group">
              <label class="cgq-form-label">プロンプト一覧</label>
              <textarea id="cgq-bulk-textarea" rows="8" placeholder="ここにプロンプトを貼り付けてください..." style="padding: 8px 10px; border-radius: 6px; border: 1px solid var(--cgq-border); background: var(--cgq-bg-card); color: var(--cgq-text-main); font-family: inherit; font-size: 12px; resize: vertical;"></textarea>
            </div>
          </div>
          <div class="cgq-modal-footer">
            <button class="cgq-btn cgq-btn-secondary" id="cgq-modal-cancel">キャンセル</button>
            <button class="cgq-btn cgq-btn-primary" id="cgq-bulk-submit">一括追加する</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);


      let bulkTools = null;
      const closeModal = () => {
        try { bulkTools?.destroy?.(); } catch {}
        modal.remove();
      };
      modal.querySelector('#cgq-modal-close').onclick = closeModal;
      modal.querySelector('#cgq-modal-cancel').onclick = closeModal;
      modal.onclick = (e) => { if (e.target === modal) closeModal(); };
      modal.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !e.isComposing) closeModal();
      });

      bulkTools = CGQComposerTools.attach(modal.querySelector('#cgq-bulk-textarea'), {
        literal: true,
        query: (marker, query) => composerTools.query(marker, query)
      });
      const textarea = modal.querySelector('#cgq-bulk-textarea');
      const delimSelect = modal.querySelector('#cgq-bulk-delimiter');
      const submitBtn = modal.querySelector('#cgq-bulk-submit');

      const getParsedPrompts = () => {
        return CGQComposerTools.splitPrompts(textarea.value, delimSelect.value);
      };

      const updateCount = () => {
        const count = getParsedPrompts().length;
        submitBtn.textContent = count > 0 ? `一括追加する (${count}件)` : '一括追加する';
      };

      textarea.addEventListener('input', updateCount);
      delimSelect.addEventListener('change', updateCount);
      textarea.addEventListener('keydown', (e) => {
        if (!e.isComposing && e.keyCode !== 229 && (e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          submitBtn.click();
        }
      });

      submitBtn.onclick = async () => {
        const validItems = getParsedPrompts();
        if (validItems.length > 0) {
          await this.qm.enqueueMany(validItems, { tools: bulkTools.getTools() });
          closeModal();
          showToast(`${validItems.length}件のプロンプトを一括追加しました`);
        } else {
          showToast('追加するプロンプトが見つかりませんでした');
        }
      };
      textarea.focus();
    }

    showSettingsModal() {
      const s = this.qm.settings;
      const modal = document.createElement('div');
      modal.className = 'cgq-modal-overlay';
      modal.innerHTML = `
        <div class="cgq-modal-container">
          <div class="cgq-modal-header">
            <span>キュー＆人間シミュレーション設定</span>
            <button class="cgq-icon-btn" id="cgq-modal-close">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="cgq-modal-body">
            <!-- Enter to Queue setting -->
            <div class="cgq-form-row">
              <div>
                <div style="font-weight: 600; font-size: 12px;">管理画面のEnterでキューに追加</div>
                <div class="cgq-form-desc">この設定はQueue Managerの入力欄用です。ChatGPT・Geminiの通常入力欄はEnterで通常送信、＋またはCtrl+Enterでキュー追加、Shift+Enterで改行します。</div>
              </div>
              <label class="cgq-switch">
                <input type="checkbox" id="cgq-set-enter-queue" ${s.enterToQueue !== false ? 'checked' : ''}>
                <span class="cgq-slider"></span>
              </label>
            </div>

            <!-- Theme selection -->
            <div class="cgq-form-group">
              <label class="cgq-form-label">テーマ設定 (カラーモード)</label>
              <select id="cgq-set-theme" style="padding: 6px 10px; border-radius: 6px; border: 1px solid var(--cgq-border); background: var(--cgq-bg); color: var(--cgq-text-main);">
                <option value="auto" ${s.themeMode === 'auto' ? 'selected' : ''}>自動連動 (ChatGPT/システム設定に追従)</option>
                <option value="dark" ${s.themeMode === 'dark' ? 'selected' : ''}>ダークモード (暗いテーマ)</option>
                <option value="light" ${s.themeMode === 'light' ? 'selected' : ''}>ライトモード (明るいテーマ)</option>
              </select>
            </div>

            <!-- Typing & Input Mode -->
            <div class="cgq-form-group">
              <label class="cgq-form-label">入力シミュレーション形式</label>
              <select id="cgq-set-mode" style="padding: 6px 10px; border-radius: 6px; border: 1px solid var(--cgq-border); background: var(--cgq-bg); color: var(--cgq-text-main);">
                <option value="mixed" ${s.typingMode === 'mixed' ? 'selected' : ''}>人間風ミックス (タイピング ＋ たまにコピペ貼り付け) [推奨]</option>
                <option value="human" ${s.typingMode === 'human' ? 'selected' : ''}>常時タイピング (1文字ずつ打鍵)</option>
                <option value="fast" ${s.typingMode === 'fast' ? 'selected' : ''}>高速タイピング (テンポよく入力)</option>
                <option value="instant" ${s.typingMode === 'instant' ? 'selected' : ''}>常時即時ペースト (一瞬で貼り付け)</option>
              </select>
            </div>

            <!-- Typo simulation -->
            <div class="cgq-form-row">
              <div>
                <div style="font-weight: 600; font-size: 12px;">打ち間違い (タイポ & 訂正) の再現</div>
                <div class="cgq-form-desc">たまに隣のキーを誤打して、Backspaceで打ち直す動作を再現します</div>
              </div>
              <label class="cgq-switch">
                <input type="checkbox" id="cgq-set-typo" ${s.simulateTypos ? 'checked' : ''}>
                <span class="cgq-slider"></span>
              </label>
            </div>

            <!-- Reading Delay -->
            <div class="cgq-form-group">
              <div class="cgq-form-label">
                <span>思考・読書待機時間 (秒)</span>
                <span class="cgq-range-val" id="cgq-val-read">${s.minReadDelay}s - ${s.maxReadDelay}s</span>
              </div>
              <div class="cgq-form-desc">ChatGPTの回答が完了した後、人間が読んで考える待機時間です。</div>
              <div style="display: flex; gap: 10px; align-items: center;">
                <span style="font-size: 11px;">最小</span>
                <input type="range" id="cgq-set-min-read" min="0.5" max="10" step="0.5" value="${s.minReadDelay}">
                <span style="font-size: 11px;">最大</span>
                <input type="range" id="cgq-set-max-read" min="1.0" max="15" step="0.5" value="${s.maxReadDelay}">
              </div>
            </div>

            <!-- Dynamic delay switch -->
            <div class="cgq-form-row">
              <div>
                <div style="font-weight: 600; font-size: 12px;">回答文字数に応じた読書時間の動的延長</div>
                <div class="cgq-form-desc">直前の回答が長文の場合、読む時間を自動で少し伸ばします</div>
              </div>
              <label class="cgq-switch">
                <input type="checkbox" id="cgq-set-dynamic" ${s.dynamicDelay ? 'checked' : ''}>
                <span class="cgq-slider"></span>
              </label>
            </div>

            <!-- Continuous operation fatigue switch -->
            <div class="cgq-form-row">
              <div>
                <div style="font-weight: 600; font-size: 12px;">2〜3時間継続稼働時の休憩・思考待機延長 (最大10分)</div>
                <div class="cgq-form-desc">長時間連続で稼働している際、徐々に待機時間を最大10分まで伸ばし人間風の休憩を再現します</div>
              </div>
              <label class="cgq-switch">
                <input type="checkbox" id="cgq-set-fatigue" ${s.continuousFatigue !== false ? 'checked' : ''}>
                <span class="cgq-slider"></span>
              </label>
            </div>

            <!-- Connection lost auto reload switch -->
            <div class="cgq-form-row">
              <div>
                <div style="font-weight: 600; font-size: 12px;">接続切断時の自動再読み込み (2分以内)</div>
                <div class="cgq-form-desc">「接続が途切れました。回答全体の受信を待っています」表示時、2分以内に自動でページを再読み込みします</div>
              </div>
              <label class="cgq-switch">
                <input type="checkbox" id="cgq-set-auto-reload" ${s.autoReloadOnDisconnect !== false ? 'checked' : ''}>
                <span class="cgq-slider"></span>
              </label>
            </div>

            <!-- Typing Speed Slider -->
            <div class="cgq-form-group">
              <div class="cgq-form-label">
                <span>タイピング速度基準</span>
                <span class="cgq-range-val" id="cgq-val-speed">${s.typingSpeed} ms/文字</span>
              </div>
              <input type="range" id="cgq-set-speed" min="20" max="120" step="5" value="${s.typingSpeed}">
            </div>

            <!-- Punctuation Pause Switch -->
            <div class="cgq-form-row">
              <div>
                <div style="font-weight: 600; font-size: 12px;">句読点・改行での一息ポーズ</div>
                <div class="cgq-form-desc">句読点や改行で少し長めに休止し、より人間らしく見せます</div>
              </div>
              <label class="cgq-switch">
                <input type="checkbox" id="cgq-set-punct" ${s.punctuationPause ? 'checked' : ''}>
                <span class="cgq-slider"></span>
              </label>
            </div>

            <!-- Typing Jitter Switch -->
            <div class="cgq-form-row">
              <div>
                <div style="font-weight: 600; font-size: 12px;">キーストロークの自然なゆらぎ</div>
                <div class="cgq-form-desc">打鍵ごとの速度に単語ごとのバーストと揺らぎを加えます</div>
              </div>
              <label class="cgq-switch">
                <input type="checkbox" id="cgq-set-jitter" ${s.typingJitter ? 'checked' : ''}>
                <span class="cgq-slider"></span>
              </label>
            </div>

            <!-- Sound Switch -->
            <div class="cgq-form-row">
              <div>
                <div style="font-weight: 600; font-size: 12px;">キュー消化完了時のチャイム音</div>
                <div class="cgq-form-desc">すべての送信が終了した際に心地よいチャイム音でお知らせ</div>
              </div>
              <label class="cgq-switch">
                <input type="checkbox" id="cgq-set-sound" ${s.soundNotification ? 'checked' : ''}>
                <span class="cgq-slider"></span>
              </label>
            </div>
          </div>
          <div class="cgq-modal-footer">
            <button class="cgq-btn cgq-btn-secondary" id="cgq-modal-cancel">キャンセル</button>
            <button class="cgq-btn cgq-btn-primary" id="cgq-settings-save">設定を保存</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);


      const closeModal = () => modal.remove();
      modal.querySelector('#cgq-modal-close').onclick = closeModal;
      modal.querySelector('#cgq-modal-cancel').onclick = closeModal;
      modal.onclick = (e) => { if (e.target === modal) closeModal(); };

      const minRead = modal.querySelector('#cgq-set-min-read');
      const maxRead = modal.querySelector('#cgq-set-max-read');
      const valRead = modal.querySelector('#cgq-val-read');
      const updateReadLabel = () => {
        if (parseFloat(minRead.value) > parseFloat(maxRead.value)) {
          maxRead.value = minRead.value;
        }
        valRead.textContent = `${minRead.value}s - ${maxRead.value}s`;
      };
      minRead.oninput = updateReadLabel;
      maxRead.oninput = updateReadLabel;

      const speedInput = modal.querySelector('#cgq-set-speed');
      const valSpeed = modal.querySelector('#cgq-val-speed');
      speedInput.oninput = () => {
        valSpeed.textContent = `${speedInput.value} ms/文字`;
      };

      modal.querySelector('#cgq-settings-save').onclick = () => {
        const newSettings = {
          enterToQueue: modal.querySelector('#cgq-set-enter-queue').checked,
          themeMode: modal.querySelector('#cgq-set-theme').value,
          typingMode: modal.querySelector('#cgq-set-mode').value,
          simulateTypos: modal.querySelector('#cgq-set-typo').checked,
          minReadDelay: parseFloat(minRead.value),
          maxReadDelay: parseFloat(maxRead.value),
          dynamicDelay: modal.querySelector('#cgq-set-dynamic').checked,
          continuousFatigue: modal.querySelector('#cgq-set-fatigue').checked,
          autoReloadOnDisconnect: modal.querySelector('#cgq-set-auto-reload').checked,
          typingSpeed: parseInt(speedInput.value, 10),
          punctuationPause: modal.querySelector('#cgq-set-punct').checked,
          typingJitter: modal.querySelector('#cgq-set-jitter').checked,
          soundNotification: modal.querySelector('#cgq-set-sound').checked,
        };
        this.qm.saveSettings(newSettings);
        showToast('設定を保存しました');
        closeModal();
      };
    }
  }

  // ==========================================================================
  // Initialization & Popup Communication
  // ==========================================================================

  const queueManager = new QueueManager();
  queueManager.init().then(() => {
    new QueueUI(queueManager);
  });

  // Nearest scrollable ancestor (the page's own conversation scroller).
  const scrollParentOf = el => {
    for (let node = el?.parentElement; node && node !== document.body; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowY;
      if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight + 1) return node;
    }
    return document.scrollingElement;
  };

  // Every turn the page holds. When the dashboard already has them all, scroll the page's own
  // conversation to the top once so ChatGPT / Gemini load older turns, then put the scroll back.
  async function getOlderHistory(have) {
    const read = () => DOM.getRecentQAHistory(queueManager.lastSentPrompt, Infinity);
    let turns = read();
    if (turns.length <= have) {
      const scroller = scrollParentOf(HumanSimulator.userNodes()[0]);
      if (scroller) {
        const { scrollTop, scrollHeight } = scroller;
        const before = HumanSimulator.userNodes().length;
        scroller.scrollTop = 1;
        scroller.scrollTop = 0;
        for (let i = 0; i < 12 && HumanSimulator.userNodes().length <= before; i++) await sleep(250);
        await sleep(300); // let the newly loaded turns finish rendering
        scroller.scrollTop = scrollTop + (scroller.scrollHeight - scrollHeight);
        turns = read();
      }
    }
    return { success: true, turns, exhausted: turns.length <= have };
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'GET_OLDER_HISTORY') {
      getOlderHistory(Number(request.have) || 0)
        .then(sendResponse, error => sendResponse({ success: false, error: error.message }));
      return true;
    } else if (request.action === 'GET_DASHBOARD_STATE') {
      queueManager.reportToRegistry().then(state => {
        sendResponse(state ? { success: true, state } : { success: false });
      });
      return true;
    } else if (request.action === 'REFRESH_MODELS' || request.action === 'SELECT_MODEL') {
      (async () => {
        try {
          if (queueManager.currentState === QueueState.TYPING || queueManager.currentState === QueueState.PRE_SEND) {
            throw new Error('プロンプトの処理中です。処理が終わってから操作してください。');
          }
          if (request.action === 'SELECT_MODEL') {
            if (DOM.isGenerating()) throw new Error('回答生成中はモデルを切り替えられません。');
            await DOM.switchModel(request.model);
          } else {
            await modelPicker.refresh();
          }
          await queueManager.reportToRegistry();
          sendResponse({ success: true, ...DOM.getCurrentModelInfo() });
        } catch (error) {
          await queueManager.reportToRegistry();
          sendResponse({ ...DOM.getCurrentModelInfo(), success: false, error: error.message });
        }
      })();
      return true;
    } else if (request.action === 'GET_COMPOSER_OPTIONS') {
      (async () => {
        try {
          if (modelPicker.pending || queueManager.currentState === QueueState.TYPING || queueManager.currentState === QueueState.PRE_SEND) {
            throw new Error('送信処理中です。処理が終わってから候補を取得してください。');
          }
          const options = await composerTools.query(request.marker === '/' ? '/' : '@', String(request.query || '').slice(0, 60));
          sendResponse({ success: true, options });
        } catch (error) { sendResponse({ success: false, error: error.message }); }
      })();
      return true;
    } else if (request.action === 'GET_TAB_QUEUE') {
      sendResponse({
        items: queueManager.items,
        settings: queueManager.settings,
        tabId: queueManager.tabId
      });
    } else if (request.action === 'ADD_TO_TAB_QUEUE') {
      queueManager.enqueue(request.text, { tools: request.tools }).then(item => {
        sendResponse({ success: true, item });
      });
      return true;
    } else if (request.action === 'ADD_MANY_TO_TAB_QUEUE') {
      queueManager.enqueueMany(request.texts, { tools: request.tools }).then(items => {
        sendResponse({ success: true, items });
      });
      return true;
    }
  });

})();
