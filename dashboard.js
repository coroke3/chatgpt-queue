/**
 * ChatGPT Queue Assistant - Management Dashboard Logic
 * Modern Dual-Mode UI: Real AI Chat Tool Layout + Multi-Chat Parallel Grid.
 * Complete IME Protection, In-Place DOM Reconciliation, and 6s+ Disconnect Grace Period.
 */

document.addEventListener('DOMContentLoaded', () => {
  const STORAGE_KEY_REGISTRY = 'cgq_tabs_registry';
  const STORAGE_KEY_SETTINGS = 'cgq_user_settings';

  // Navigation & Mode Elements
  const navSingleChat = document.getElementById('nav-single-chat');
  // Windows renders the light weight thin, so the dashboard uses 400 there instead of 300.
  document.body.classList.toggle('is-windows', /Windows/i.test(navigator.userAgent));

  const navAllGrid = document.getElementById('nav-all-grid');
  const navManage = document.getElementById('nav-manage');
  const navSettings = document.getElementById('nav-settings');
  const btnFooterSettings = document.getElementById('btn-footer-settings');
  const viewManage = document.getElementById('view-manage');
  const viewSettings = document.getElementById('view-settings');
  const manageList = document.getElementById('manage-list');
  const viewSingleChat = document.getElementById('view-single-chat');
  const viewAllGridContainer = document.getElementById('view-all-grid-container');
  const emptyState = document.getElementById('empty-state');
  const btnSettingsReset = document.getElementById('btn-settings-reset');
  const btnSettingsSave = document.getElementById('btn-settings-save');

  // Sidebar Elements
  const sidebarEl = document.getElementById('dash-sidebar');
  const btnSidebarCollapse = document.getElementById('btn-sidebar-collapse');
  const btnSidebarOpenSingle = document.getElementById('btn-sidebar-open-single');
  const btnSidebarOpenGrid = document.getElementById('btn-sidebar-open-grid');
  const sidebarChatList = document.getElementById('sidebar-chat-list');
  const searchInput = document.getElementById('dash-search-input');
  const statActiveTabs = document.getElementById('stat-active-tabs');
  const statTotalItems = document.getElementById('stat-total-items');
  const countFilterAll = document.getElementById('count-filter-all');
  const countFilterAnswering = document.getElementById('count-filter-answering');
  const countFilterQueued = document.getElementById('count-filter-queued');
  const btnSidebarNewChat = document.getElementById('btn-sidebar-new-chat');
  const btnGridNewChat = document.getElementById('btn-grid-new-chat');
  const btnEmptyOpen = document.getElementById('btn-empty-open');
  const btnThemeToggle = document.getElementById('btn-theme-toggle');
  const btnRefresh = document.getElementById('btn-refresh');
  const toastElem = document.getElementById('cgq-dash-toast');

  // Single Chat View Elements
  const singleChatTitle = document.getElementById('single-chat-title');
  const singleChatStatus = document.getElementById('single-chat-status');
  const singleChatStatusText = document.getElementById('single-chat-status-text');
  const singleBtnFocusTab = document.getElementById('single-btn-focus-tab');
  const singleBtnReloadTab = document.getElementById('single-btn-reload-tab');
  const singleBtnPause = document.getElementById('single-btn-pause');
  const singleBtnCopyAnswer = document.getElementById('single-btn-copy-answer');
  const singleChatActivity = document.getElementById('single-chat-activity');
  const singleChatBody = document.getElementById('single-chat-body');
  const singleAnswersArea = document.getElementById('single-answers-area');
  const singleQueuePanel = document.getElementById('single-queue-panel');
  const singleQueueBadge = document.getElementById('single-queue-badge');
  const singleQueueSubtext = document.getElementById('single-queue-subtext');
  const singleQueueList = document.getElementById('single-queue-list');
  const singleQueueBtnClear = document.getElementById('single-queue-btn-clear');
  const singleChatInput = document.getElementById('single-chat-input');
  const singleBtnSend = document.getElementById('single-btn-send');
  const singleChatModelBadge = document.getElementById('single-chat-model-badge');
  const singleChatModelText = document.getElementById('single-chat-model-text');
  const singleChatEffortText = document.getElementById('single-chat-effort-text');
  const singleModelSelect = document.getElementById('single-model-select');
  const singleEffortSelect = document.getElementById('single-effort-select');
  const singleEffortGroup = document.getElementById('single-effort-group');

  // ChatGPT-style Model & Effort Dropdown Elements
  const singleModelWrapper = document.getElementById('single-model-wrapper');
  const singleModelPillBtn = document.getElementById('single-model-pill-btn');
  const singleModelPillLabel = document.getElementById('single-model-pill-label');
  const singleModelPillIcon = document.getElementById('single-model-pill-icon');
  const singleModelPopover = document.getElementById('single-model-popover');
  const singleModelPopoverList = document.getElementById('single-model-popover-list');

  const singleEffortWrapper = document.getElementById('single-effort-wrapper');
  const singleEffortPillLabel = document.getElementById('single-effort-pill-label');
  const singleEffortPopoverList = document.getElementById('single-effort-popover-list');

  const selectedModelOverride = {};  // tabId -> explicitly requested model or current setting
  const modelRequests = new Map();
  const modelRequestErrors = new Map();
  const selectedEffortOverride = {}; // tabId -> effortId

  function getModelIconSvg(modelId) {
    const m = (modelId || '').toLowerCase();
    if (m.startsWith('o') || m.includes('reasoning')) {
      return `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.04z"></path>
          <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.04z"></path>
        </svg>
      `;
    }
    if (m.includes('mini') || m.includes('flash')) {
      return `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
        </svg>
      `;
    }
    return `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z"></path>
      </svg>
    `;
  }

  function getEffortIconSvg(effortId) {
    return `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="9"></circle>
        <path d="M12 7v5l3 3"></path>
      </svg>
    `;
  }

  function closeAllPopovers() {
    document.querySelectorAll('.cgq-chatgpt-popover').forEach(p => p.style.display = 'none');
    document.querySelectorAll('.cgq-chatgpt-pill-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
  }

  if (singleModelPillBtn) {
    singleModelPillBtn.onclick = (e) => {
      e.stopPropagation();
      const isOpen = singleModelPopover && singleModelPopover.style.display === 'block';
      closeAllPopovers();
      if (!isOpen && singleModelPopover) {
        singleModelPopover.style.display = 'block';
        singleModelPillBtn.setAttribute('aria-expanded', 'true');
        const t = cachedTabsData.get(selectedTabId);
        if (t) refreshServiceModels(t);
      }
    };
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.cgq-dropdown-wrapper')) {
      closeAllPopovers();
    }
  });

  // Grid Mode Elements
  const tabsGrid = document.getElementById('tabs-grid');

  // App State
  let currentMode = 'grid'; // 'single' | 'grid' (初期表示は並列)
  let selectedTabId = null;
  let currentRegistry = {};
  let currentSettings = {};
  let openBrowserTabs = null;
  let dashboardRefreshing = false;
  const discoveredStates = new Map();
  const snapshotRequests = new Map();
  const snapshotAttempts = new Map();
  let activeFilter = 'all';
  let searchQuery = '';
  const olderHistory = new Map(); // tabId -> { all, loading, exhaustedAt } (see loadOlderTurns)
  let composerObserver = null; // ResizeObserver for floating composers (see observeComposer)
  let singleChatHistoryMode = 'all'; // 'all' | 'latest' (for single chat history view)
  const cardModelSelections = {}; // tabId -> { model, effort }

  // Grace Period & Stability Maps
  const cachedTabsData = new Map();     // tabId -> tabData
  const missingSinceMap = new Map();    // tabId -> timestamp when it stopped responding
  const tabInputDrafts = new Map();     // tabId -> text draft
  const toolDrafts = new Map();
  const cardToolInputs = new WeakMap();

  function cleanTabTitle(rawTitle, platform) {
    let title = (rawTitle || '').trim();
    if (platform === 'gemini' || /gemini/i.test(title) || (platform && /gemini/i.test(platform))) {
      title = title.replace(/\s*[-–—|]\s*Google\s*Gemini\s*$/i, '')
                   .replace(/\s*[-–—|]\s*Gemini\s*$/i, '')
                   .trim();
      if (/^google\s*gemini$/i.test(title)) {
        title = 'Gemini';
      }
    }
    return title || (platform === 'gemini' ? 'Gemini' : 'ChatGPT');
  }
  const singleToolInput = CGQComposerTools.attach(singleChatInput, {
    query: (marker, query) => queryComposerOptions(selectedTabId, marker, query),
    scope: () => selectedTabId, drafts: toolDrafts
  });

  function queryNativeOptions(tabId, marker, query) {
    const t = cachedTabsData.get(tabId);
    if (!t?.chromeTabId || t.needsConnection) return Promise.reject(new Error('対象のチャットタブを再読み込みして接続してください。'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('対象タブから応答がありません。タブを開いて再試行してください。')), 6000);
      chrome.tabs.sendMessage(t.chromeTabId, { action: 'GET_COMPOSER_OPTIONS', marker, query }, response => {
        clearTimeout(timer);
        if (chrome.runtime.lastError || !response?.success) reject(new Error(response?.error || '対象タブと通信できません。拡張機能とページを再読み込みしてください。'));
        else resolve(response.options || []);
      });
    });
  }

  // @ / candidates: the tab's live menu first, then tools used before (kept even when the tab cannot answer).
  async function queryComposerOptions(tabId, marker, query) {
    const platform = cachedTabsData.get(tabId)?.platform || 'chatgpt';
    const remembered = await CGQComposerTools.recall(platform, marker, query);
    try {
      return CGQComposerTools.mergeOptions(await queryNativeOptions(tabId, marker, query), remembered);
    } catch (error) {
      if (remembered.length) return remembered;
      throw error;
    }
  }

  const DISCONNECT_GRACE_MS = 6000;     // 6 seconds grace period
  const tabStableOrderMap = new Map();
  let tabOrderSequence = 0;

  function getStableOrderKey(t) {
    if (!tabStableOrderMap.has(t.tabId)) {
      if (t.previousTabId && tabStableOrderMap.has(t.previousTabId)) {
        const prevInfo = tabStableOrderMap.get(t.previousTabId);
        tabStableOrderMap.set(t.tabId, { ...prevInfo, chromeTabId: t.chromeTabId || prevInfo.chromeTabId });
      } else {
        tabOrderSequence++;
        tabStableOrderMap.set(t.tabId, {
          seq: tabOrderSequence,
          chromeTabId: t.chromeTabId || null,
          createdAt: t.createdAt || Date.now()
        });
      }
    }
    const info = tabStableOrderMap.get(t.tabId);
    if (!info.chromeTabId && t.chromeTabId) {
      info.chromeTabId = t.chromeTabId;
    }
    return info;
  }

  // --------------------------------------------------------------------------
  // Markdown & Mermaid Diagram Setup
  // --------------------------------------------------------------------------
  const CODE_LANGUAGE_NAMES = { js: 'JavaScript', javascript: 'JavaScript', jsx: 'JSX', ts: 'TypeScript', typescript: 'TypeScript',
    tsx: 'TSX', py: 'Python', python: 'Python', sh: 'Bash', bash: 'Bash', shell: 'Shell', zsh: 'Zsh', json: 'JSON', html: 'HTML',
    css: 'CSS', sql: 'SQL', md: 'Markdown', markdown: 'Markdown', yaml: 'YAML', yml: 'YAML', java: 'Java', go: 'Go', rust: 'Rust',
    rb: 'Ruby', ruby: 'Ruby', php: 'PHP', swift: 'Swift', kotlin: 'Kotlin', c: 'C', cpp: 'C++', 'c++': 'C++', cs: 'C#', csharp: 'C#' };
  const codeLanguageName = lang => CODE_LANGUAGE_NAMES[lang] || (lang ? lang[0].toUpperCase() + lang.slice(1) : 'Code');

  function setupMarkedRenderer() {
    if (!window.marked) return;

    const renderer = new window.marked.Renderer();

    renderer.code = function(token, langArg) {
      let code = (typeof token === 'object' && token !== null) ? (token.text || '') : (token || '');
      let lang = (typeof token === 'object' && token !== null) ? (token.lang || '') : (langArg || '');
      lang = (lang || '').trim().toLowerCase();

      // Check if it's a Mermaid diagram (by language tag or auto-detected syntax)
      const isMermaid = lang === 'mermaid' || /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|xychart-beta|C4Context)\b/m.test(code);

      if (isMermaid) {
        const id = 'mermaidSvg' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
        return `<div class="cgq-mermaid-wrapper">
          <div class="cgq-mermaid-header">
            <span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
              </svg>
              ダイアグラム / 図形
            </span>
            <button class="cgq-code-copy" data-target="raw-${id}" title="コードをコピー" aria-label="コードをコピー"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>
          </div>
          <div class="cgq-mermaid-svg-container" id="${id}">
            <div class="cgq-mermaid-loading">図形を描画中...</div>
          </div>
          <pre class="cgq-mermaid-raw" style="display:none;"><code id="raw-${id}">${escapeHtml(code)}</code></pre>
        </div>`;
      }

      // Check if it's an SVG diagram
      if (lang === 'svg' || (code.trim().startsWith('<svg') && code.trim().endsWith('</svg>'))) {
        return `<div class="cgq-svg-diagram-wrapper">
          <div class="cgq-svg-diagram-header">
            <span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
              SVG図形
            </span>
          </div>
          <div class="cgq-svg-diagram-content">${code}</div>
        </div>`;
      }

      const codeId = 'code-' + Math.random().toString(36).substring(2, 9);
      // Header as on chatgpt.com: "</> JavaScript" and an icon copy button.
      return `<div class="cgq-code-block">
        <div class="cgq-code-header">
          <span class="cgq-code-lang"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>${escapeHtml(codeLanguageName(lang))}</span>
          <button class="cgq-code-copy" data-target="${codeId}" title="コピー" aria-label="コピー"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>
        </div>
        <pre><code id="${codeId}">${escapeHtml(code)}</code></pre>
      </div>`;
    };

    renderer.table = function(token, bodyArg) {
      if (token && typeof token === 'object' && Array.isArray(token.header)) {
        const cell = value => this.parser.parseInline(value.tokens || []);
        const header = token.header.map(value => `<th>${cell(value)}</th>`).join('');
        const rows = (token.rows || []).map(row => `<tr>${row.map(value => `<td>${cell(value)}</td>`).join('')}</tr>`).join('');
        return `<div class="cgq-md-table-wrapper"><table class="cgq-md-table"><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;
      }
      const header = (typeof token === 'object' && token !== null) ? token.header : token;
      const body = (typeof token === 'object' && token !== null) ? token.body : bodyArg;
      return `<div class="cgq-md-table-wrapper"><table class="cgq-md-table"><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
    };

    renderer.image = function(token, titleArg, textArg) {
      const href = (typeof token === 'object' && token) ? token.href : token;
      const title = (typeof token === 'object' && token) ? token.title : titleArg;
      const text = (typeof token === 'object' && token) ? token.text : textArg;
      const cleanHref = href || '';
      const cleanAlt = escapeHtml(text || '画像');
      const cleanTitle = title ? escapeHtml(title) : '';
      return `<div class="cgq-md-image-wrapper">
        <a href="${cleanHref}" target="_blank" rel="noopener noreferrer" class="cgq-image-link" title="新しいタブで原寸大表示">
          <img src="${cleanHref}" alt="${cleanAlt}" class="cgq-md-img" loading="lazy" />
        </a>
        ${cleanTitle ? `<div class="cgq-md-image-caption">${cleanTitle}</div>` : ''}
      </div>`;
    };

    renderer.link = function(token, titleArg, textArg) {
      const href = (typeof token === 'object' && token) ? token.href : token;
      const title = (typeof token === 'object' && token) ? token.title : titleArg;
      const text = (typeof token === 'object' && token) ? token.text : textArg;
      const cleanHref = href || '#';
      const cleanTitle = title ? ` title="${escapeHtml(title)}"` : '';
      const trimmedText = (text || '').trim();

      // If the link text is just a citation number like "1", "[1]", "2"
      if (/^\[?\d+\]?$/.test(trimmedText)) {
        const num = trimmedText.replace(/^\[+|\]+$/g, '');
        return `<a class="cgq-citation-pill" href="${cleanHref}" target="_blank" rel="noopener noreferrer"${cleanTitle}>${num}</a>`;
      }

      return `<a class="cgq-md-link" href="${cleanHref}" target="_blank" rel="noopener noreferrer"${cleanTitle}>${text || cleanHref}</a>`;
    };

    window.marked.use({
      renderer,
      gfm: true,
      breaks: true
    });
  }

  // mermaid (3.2MB) is loaded only when an answer actually contains a diagram.
  let mermaidLoading = null;
  function loadMermaid() {
    if (window.mermaid) return Promise.resolve(true);
    return mermaidLoading ||= new Promise(resolve => {
      const script = document.createElement('script');
      script.src = 'libs/mermaid.min.js';
      script.onload = () => { initMermaid(document.body.classList.contains('dark')); resolve(true); };
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  }

  function initMermaid(isDark) {
    if (!window.mermaid) return;
    try {
      window.mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default', securityLevel: 'loose', fontFamily: 'inherit' });
    } catch (e) {
      console.warn('[Dashboard] Mermaid init error:', e);
    }
  }

  async function renderMermaidDiagrams(container) {
    if (!container) return;
    const wrappers = [...container.querySelectorAll('.cgq-mermaid-wrapper')]
      .filter(w => w.querySelector('.cgq-mermaid-svg-container')?.dataset.rendered !== 'true');
    if (!wrappers.length || !(await loadMermaid())) return;
    for (const wrapper of wrappers) {
      const svgContainer = wrapper.querySelector('.cgq-mermaid-svg-container');
      const rawCode = wrapper.querySelector('.cgq-mermaid-raw code')?.textContent.trim();
      if (!svgContainer || !rawCode) continue;
      const uniqueId = 'mermaidSvg' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
      try {
        const res = await window.mermaid.render(uniqueId, rawCode);
        const svg = typeof res === 'object' && res ? res.svg : res;
        if (svg) {
          svgContainer.innerHTML = svg;
          svgContainer.dataset.rendered = 'true';
        }
      } catch {
        document.getElementById('d' + uniqueId)?.remove();
        svgContainer.innerHTML = `<div class="cgq-mermaid-error"><span>図形を描画できませんでした</span><pre>${escapeHtml(rawCode)}</pre></div>`;
      }
    }
  }

  // Setup marked renderer & mermaid immediately at startup
  setupMarkedRenderer();

  // --------------------------------------------------------------------------
  // Theme Handling
  // --------------------------------------------------------------------------
  function applyTheme(isDark) {
    document.body.classList.toggle('dark', isDark);
    document.body.classList.toggle('light', !isDark);
    initMermaid(isDark);
    document.querySelectorAll('.cgq-mermaid-svg-container[data-rendered="true"]').forEach(el => {
      delete el.dataset.rendered;
    });
    if (currentMode === 'single') {
      renderMermaidDiagrams(singleAnswersArea);
    } else {
      renderMermaidDiagrams(tabsGrid);
    }
  }

  // [slider id, setting key, default, value label id]
  const DISPLAY_SLIDERS = [
    ['setting-answer-size', 'answerFontSize', 14, 'setting-val-answer-size'],
    ['setting-card-min-width', 'cardMinWidth', 280, 'setting-val-card-min']
  ];

  // Display settings from the sliders: answer text size (every turn scales from it, see .cgq-answer-card)
  // and the minimum width of a parallel-view card (see .cgq-tabs-grid).
  function applyDisplaySettings() {
    const clamp = (value, min, max, fallback) => Math.min(max, Math.max(min, Number(value) || fallback));
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--answer-size', String(clamp(currentSettings?.answerFontSize, 11, 20, 14)));
    rootStyle.setProperty('--card-min-width', `${clamp(currentSettings?.cardMinWidth, 200, 800, 280)}px`);
  }

  chrome.storage.local.get([STORAGE_KEY_SETTINGS], (res) => {
    currentSettings = res[STORAGE_KEY_SETTINGS] || {};
    applyDisplaySettings();
    const pref = currentSettings.themeMode || 'auto';
    if (pref === 'dark') applyTheme(true);
    else if (pref === 'light') applyTheme(false);
    else {
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      applyTheme(prefersDark);
    }
  });

  btnThemeToggle.addEventListener('click', () => {
    const isDark = document.body.classList.contains('dark');
    applyTheme(!isDark);
    chrome.storage.local.get([STORAGE_KEY_SETTINGS], (res) => {
      const s = res[STORAGE_KEY_SETTINGS] || {};
      s.themeMode = !isDark ? 'dark' : 'light';
      chrome.storage.local.set({ [STORAGE_KEY_SETTINGS]: s });
    });
  });

  // --------------------------------------------------------------------------
  // Toast Helper
  // --------------------------------------------------------------------------
  let toastTimer = null;
  function showToast(message) {
    if (!toastElem) return;
    toastElem.textContent = message;
    toastElem.style.display = 'block';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastElem.style.display = 'none';
    }, 2200);
  }

  // --------------------------------------------------------------------------
  // Mode Navigation (Single Chat vs Parallel Grid)
  // --------------------------------------------------------------------------
  let previousModeBeforeSettings = 'grid';
  function switchMode(newMode) {
    if (currentMode !== 'settings' && newMode === 'settings') {
      previousModeBeforeSettings = currentMode;
    }
    currentMode = newMode;
    if (navSingleChat) navSingleChat.classList.toggle('active', newMode === 'single');
    navAllGrid.classList.toggle('active', newMode === 'grid');
    if (navManage) navManage.classList.toggle('active', newMode === 'manage');
    if (navSettings) navSettings.classList.toggle('active', newMode === 'settings');
    updateDashboard();
  }

  if (navSingleChat) navSingleChat.addEventListener('click', () => switchMode('single'));
  navAllGrid.addEventListener('click', () => switchMode('grid'));
  if (navManage) navManage.addEventListener('click', () => switchMode('manage'));
  if (navSettings) navSettings.addEventListener('click', () => switchMode('settings'));
  if (btnFooterSettings) btnFooterSettings.addEventListener('click', () => switchMode('settings'));

  // --------------------------------------------------------------------------
  // Left Sidebar Collapse / Expand Functionality
  // --------------------------------------------------------------------------
  const SIDEBAR_COLLAPSED_KEY = 'cgq_sidebar_collapsed';

  function setSidebarCollapsed(collapsed) {
    if (collapsed) {
      document.body.classList.add('sidebar-collapsed');
      if (sidebarEl) sidebarEl.classList.add('collapsed');
      if (btnSidebarCollapse) btnSidebarCollapse.title = 'サイドバーを開く (Ctrl+B)';
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'true'); } catch (e) {}
    } else {
      document.body.classList.remove('sidebar-collapsed');
      if (sidebarEl) sidebarEl.classList.remove('collapsed');
      if (btnSidebarCollapse) btnSidebarCollapse.title = 'サイドバーを閉じる (Ctrl+B)';
      try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'false'); } catch (e) {}
    }
  }

  function toggleSidebar() {
    const isCurrentlyCollapsed = document.body.classList.contains('sidebar-collapsed');
    setSidebarCollapsed(!isCurrentlyCollapsed);
  }

  // Restore saved state
  try {
    if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true') {
      setSidebarCollapsed(true);
    }
  } catch (e) {}

  if (btnSidebarCollapse) {
    // The same control folds the sidebar to the rail and opens it again from the rail.
    btnSidebarCollapse.addEventListener('click', () => toggleSidebar());
  }
  if (btnSidebarOpenSingle) {
    btnSidebarOpenSingle.addEventListener('click', () => setSidebarCollapsed(false));
  }
  if (btnSidebarOpenGrid) {
    btnSidebarOpenGrid.addEventListener('click', () => setSidebarCollapsed(false));
  }

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentMode === 'settings') {
      const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      if (tag !== 'textarea' && tag !== 'input' && tag !== 'select') {
        switchMode(previousModeBeforeSettings || 'grid');
        return;
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      if (tag !== 'textarea' && tag !== 'input') {
        e.preventDefault();
        toggleSidebar();
      }
    }
  });

  // --------------------------------------------------------------------------
  // Search & Filter Events
  // --------------------------------------------------------------------------

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      updateDashboard();
    });
  }

  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      refreshDashboard();
      showToast('ダッシュボードを更新しました');
    });
  }

  // --------------------------------------------------------------------------
  // Status Helper
  // --------------------------------------------------------------------------
  function getStatusInfo(t) {
    if (t.needsConnection) return { dotClass: 'waiting', statusLabel: 'ページを再読み込みしてください', isStreaming: false };
    if (t.isReconnecting) {
      return { dotClass: 'waiting', statusLabel: '接続確認中...', isStreaming: false };
    }
    const isStreaming = t.latestAnswer ? t.latestAnswer.isStreaming : (t.currentState === 'waiting_generation');
    let dotClass = 'idle';
    let statusLabel = '待機中';

    if (t.isPaused) {
      dotClass = 'paused';
      statusLabel = '一時停止中';
    } else if (isStreaming) {
      dotClass = 'typing';
      statusLabel = '回答生成中...';
    } else if (t.currentState === 'waiting_generation') {
      dotClass = 'waiting';
      statusLabel = '生成待機中';
    } else if (t.currentState === 'reading_delay') {
      dotClass = 'waiting';
      statusLabel = '回答確認中';
    } else if (t.currentState === 'connection_lost') {
      dotClass = 'connection-lost';
      statusLabel = '接続切断 (2分以内再読込)';
    } else if (t.currentState === 'typing' || t.currentState === 'pre_send') {
      dotClass = 'typing';
      statusLabel = '入力中';
    }
    return { dotClass, statusLabel, isStreaming };
  }

  // --------------------------------------------------------------------------
  // Refresh & Main Update Cycle
  // --------------------------------------------------------------------------
  function platformFromURL(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') return null;
      if (url.hostname === 'gemini.google.com') return 'gemini';
      if (url.hostname === 'chatgpt.com' || url.hostname === 'chat.openai.com') return 'chatgpt';
    } catch {}
    return null;
  }

  function sameConversation(a, b) {
    try {
      const left = new URL(a), right = new URL(b);
      return left.origin === right.origin && left.pathname === right.pathname;
    } catch { return false; }
  }

  function queryChatTabs() {
    if (!chrome.tabs?.query) return Promise.resolve(null);
    return new Promise(resolve => {
      try {
        chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*', 'https://gemini.google.com/*'] }, tabs => {
          resolve(chrome.runtime.lastError ? null : (tabs || []).filter(tab => platformFromURL(tab.url)));
        });
      } catch { resolve(null); }
    });
  }

  async function refreshDashboard() {
    if (dashboardRefreshing) return;
    dashboardRefreshing = true;
    try {
      const [result, tabs] = await Promise.all([
        chrome.storage.local.get([STORAGE_KEY_REGISTRY, STORAGE_KEY_SETTINGS]), queryChatTabs()
      ]);
      currentRegistry = result[STORAGE_KEY_REGISTRY] || {};
      currentSettings = result[STORAGE_KEY_SETTINGS] || {};
      applyDisplaySettings();
      if (tabs) {
        openBrowserTabs = new Map(tabs.map(tab => [tab.id, tab]));
        for (const id of discoveredStates.keys()) if (!openBrowserTabs.has(id)) discoveredStates.delete(id);
        for (const id of snapshotAttempts.keys()) if (!openBrowserTabs.has(id)) snapshotAttempts.delete(id);
      }
      updateDashboard();
    } catch (e) {
      console.error('[Dashboard] Refresh error:', e);
    } finally {
      dashboardRefreshing = false;
    }
  }

  function requestTabSnapshot(tab) {
    const attempt = snapshotAttempts.get(tab.id);
    if (snapshotRequests.has(tab.id) || (attempt?.url === tab.url && Date.now() - attempt.at < 5000)) return;
    snapshotAttempts.set(tab.id, { url: tab.url, at: Date.now() });
    const request = {};
    snapshotRequests.set(tab.id, request);
    const finish = response => {
      if (snapshotRequests.get(tab.id) !== request) return;
      snapshotRequests.delete(tab.id);
      clearTimeout(timer);
      if (openBrowserTabs?.get(tab.id)?.url !== tab.url || !response?.success ||
        typeof response.state?.tabId !== 'string' || !sameConversation(response.state.url, tab.url)) return;
      discoveredStates.set(tab.id, { ...response.state, chromeTabId: tab.id, platform: platformFromURL(tab.url) });
      updateDashboard();
    };
    const timer = setTimeout(() => finish(null), 2000);
    try {
      chrome.tabs.sendMessage(tab.id, { action: 'GET_DASHBOARD_STATE' }, response => {
        finish(chrome.runtime.lastError ? null : response);
      });
    } catch { finish(null); }
  }

  function getDiscoveredTabs(now) {
    const result = [];
    const candidates = [...Object.values(currentRegistry), ...discoveredStates.values(),
      ...Array.from(cachedTabsData.values()).filter(state => !state.needsConnection)];
    for (const tab of openBrowserTabs.values()) {
      const known = candidates.filter(state => state?.chromeTabId === tab.id && sameConversation(state.url, tab.url))
        .sort((a, b) => (b.lastHeartbeat || 0) - (a.lastHeartbeat || 0))[0];
      const platform = platformFromURL(tab.url);
      const state = known || { tabId: `browser_${tab.id}`, createdAt: now, items: [], recentQA: [],
        availableModels: [], currentState: 'idle', lastHeartbeat: 0 };
      const t = { ...state, chromeTabId: tab.id, platform, url: tab.url,
        title: cleanTabTitle(tab.title || state.title, platform),
        needsConnection: !known, isReconnecting: !known || now - (state.lastHeartbeat || 0) > 4500 };
      for (const [id, previous] of cachedTabsData) {
        if (previous.chromeTabId === tab.id && id !== t.tabId) {
          if (selectedTabId === id) selectedTabId = t.tabId;
          if (toolDrafts.has(id)) { toolDrafts.set(t.tabId, toolDrafts.get(id)); toolDrafts.delete(id); }
          if (previous.needsConnection && tabInputDrafts.has(id)) tabInputDrafts.set(t.tabId, tabInputDrafts.get(id));
          cachedTabsData.delete(id);
          missingSinceMap.delete(id);
        }
      }
      cachedTabsData.set(t.tabId, t);
      result.push(t);
      if (t.isReconnecting) requestTabSnapshot(tab);
    }
    for (const [id, state] of cachedTabsData) {
      if (!openBrowserTabs.has(state.chromeTabId)) {
        cachedTabsData.delete(id);
        missingSinceMap.delete(id);
      }
    }
    return result.sort((a, b) => a.chromeTabId - b.chromeTabId);
  }

  function getActiveTabList() {
    const now = Date.now();
    if (openBrowserTabs) return getDiscoveredTabs(now);
    const allActiveTabs = [];

    // 0. Clean up any previous tab IDs that have transitioned to a new conversation
    for (const tid in currentRegistry) {
      const prevId = currentRegistry[tid]?.previousTabId;
      if (prevId && prevId !== tid) {
        cachedTabsData.delete(prevId);
        missingSinceMap.delete(prevId);
        tabInputDrafts.delete(prevId);
      }
    }

    // 1. Ingest new / active tabs from currentRegistry
    for (const tid in currentRegistry) {
      const t = currentRegistry[tid];
      if (t) {
        cachedTabsData.set(tid, t);
        missingSinceMap.delete(tid);
      }
    }

    // 2. Evaluate all known tabs against Grace Period (6s+ tolerance)
    for (const [tid, t] of cachedTabsData.entries()) {
      const lastHb = t.lastHeartbeat || 0;
      const isHbStale = (now - lastHb > 4500);
      const isInRegistry = !!currentRegistry[tid];

      if (!isInRegistry || isHbStale) {
        if (!missingSinceMap.has(tid)) {
          missingSinceMap.set(tid, now);
        }
        const missingDuration = now - missingSinceMap.get(tid);

        // Check if user is typing in single composer or card textarea
        const singleTextarea = (selectedTabId === tid) ? singleChatInput : null;
        const cardElem = document.getElementById(`card-${tid}`);
        const cardTextarea = cardElem ? cardElem.querySelector('.cgq-dash-prompt-input') : null;
        const isUserTyping = (
          (singleTextarea && (document.activeElement === singleTextarea || singleTextarea.value.trim().length > 0)) ||
          (cardTextarea && (document.activeElement === cardTextarea || cardTextarea.value.trim().length > 0)) ||
          (tabInputDrafts.get(tid) || '').trim().length > 0
        );

        const maxAllowedGrace = isUserTyping ? 30000 : DISCONNECT_GRACE_MS;

        if (missingDuration > maxAllowedGrace) {
          cachedTabsData.delete(tid);
          missingSinceMap.delete(tid);
          tabInputDrafts.delete(tid);
          continue;
        } else {
          t.isReconnecting = true;
          allActiveTabs.push(t);
        }
      } else {
        t.isReconnecting = false;
        allActiveTabs.push(t);
      }
    }

    // Sort stably
    allActiveTabs.sort((a, b) => {
      if (a.chromeTabId && b.chromeTabId && a.chromeTabId !== b.chromeTabId) {
        return a.chromeTabId - b.chromeTabId;
      }
      const orderA = getStableOrderKey(a);
      const orderB = getStableOrderKey(b);
      if (orderA.createdAt !== orderB.createdAt) {
        return orderA.createdAt - orderB.createdAt;
      }
      return orderA.seq - orderB.seq;
    });

    return allActiveTabs;
  }

  function updateDashboard() {
    const allActiveTabs = getActiveTabList();

    // Stats calculations
    statActiveTabs.textContent = allActiveTabs.length;
    let totalItems = 0;
    let answeringCount = 0;
    let queuedCount = 0;

    allActiveTabs.forEach(t => {
      const qLen = (t.items || []).length;
      totalItems += qLen;
      if (qLen > 0) queuedCount++;
      if (t.latestAnswer || t.currentState === 'waiting_generation') answeringCount++;
    });

    statTotalItems.textContent = totalItems;
    if (countFilterAll) countFilterAll.textContent = allActiveTabs.length;
    if (countFilterAnswering) countFilterAnswering.textContent = answeringCount;
    if (countFilterQueued) countFilterQueued.textContent = queuedCount;

    // Filter tabs for sidebar & grid
    const filteredTabs = allActiveTabs.filter(t => {
      const qLen = (t.items || []).length;
      if (activeFilter === 'answering' && !t.latestAnswer && t.currentState !== 'waiting_generation') return false;
      if (activeFilter === 'queued' && qLen === 0) return false;

      if (searchQuery) {
        const titleMatch = (t.title || '').toLowerCase().includes(searchQuery);
        const answerMatch = t.latestAnswer && (t.latestAnswer.text || '').toLowerCase().includes(searchQuery);
        const promptMatch = t.latestAnswer && (t.latestAnswer.userPrompt || '').toLowerCase().includes(searchQuery);
        const queueMatch = (t.items || []).some(item => (item.text || '').toLowerCase().includes(searchQuery));
        if (!titleMatch && !answerMatch && !promptMatch && !queueMatch) return false;
      }
      return true;
    });

    // Check empty state
    if (allActiveTabs.length === 0) {
      viewSingleChat.style.display = 'none';
      viewAllGridContainer.style.display = 'none';
      viewManage.style.display = 'none';
      if (currentMode === 'settings') {
        emptyState.style.display = 'none';
        if (viewSettings) viewSettings.style.display = 'flex';
        renderSettingsView();
      } else {
        if (viewSettings) viewSettings.style.display = 'none';
        emptyState.style.display = 'flex';
      }
      sidebarChatList.innerHTML = `<div style="padding: 16px; font-size: 12px; color: var(--text-muted); text-align: center;">チャットがありません</div>`;
      selectedTabId = null;
      return;
    }

    emptyState.style.display = 'none';

    // Auto-select first tab if none selected or selected was closed/transitioned
    const activeIds = new Set(allActiveTabs.map(t => t.tabId));
    if (!selectedTabId || !activeIds.has(selectedTabId)) {
      const transitioned = allActiveTabs.find(t => t.previousTabId === selectedTabId);
      if (transitioned) {
        selectedTabId = transitioned.tabId;
      } else {
        selectedTabId = filteredTabs.length > 0 ? filteredTabs[0].tabId : allActiveTabs[0].tabId;
      }
    }

    // Render Sidebar List
    renderSidebarList(filteredTabs);

    // Render Current View
    viewManage.style.display = 'none';
    if (viewSettings) viewSettings.style.display = 'none';
    if (currentMode === 'single') {
      viewSingleChat.style.display = 'flex';
      viewAllGridContainer.style.display = 'none';
      renderSingleChatView();
    } else if (currentMode === 'manage') {
      viewSingleChat.style.display = 'none';
      viewAllGridContainer.style.display = 'none';
      viewManage.style.display = 'flex';
      renderManageView(allActiveTabs);
    } else if (currentMode === 'settings') {
      viewSingleChat.style.display = 'none';
      viewAllGridContainer.style.display = 'none';
      if (viewSettings) viewSettings.style.display = 'flex';
      renderSettingsView();
    } else {
      viewSingleChat.style.display = 'none';
      viewAllGridContainer.style.display = 'flex';
      renderGridMode(filteredTabs.filter(t => !isExcludedFromGrid(t.tabId)));
    }
  }

  // --------------------------------------------------------------------------
  // Render Left Sidebar Chat List
  // --------------------------------------------------------------------------
  // Close a chat's browser tab from the sidebar; warn first when its queue still has items.
  function closeChatTab(t) {
    const qLen = (t.items || []).length;
    if (qLen > 0 && !confirm(`キューが${qLen}件残っています。このチャットタブを閉じますか？`)) return;
    if (!t.chromeTabId) { showToast('閉じるタブが見つかりません'); return; }
    chrome.runtime.sendMessage({ action: 'CLOSE_CHAT_TAB', chromeTabId: t.chromeTabId });
    showToast('チャットタブを閉じました');
  }

  // Answer images open in an in-page viewer: dimmed backdrop, the image centred,
  // and only an optional caption plus open-in-tab and close icons above it.
  let lightboxEl = null;
  const LIGHTBOX_ICON_OPEN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>';
  const LIGHTBOX_ICON_CLOSE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

  function closeLightbox() { if (lightboxEl) lightboxEl.hidden = true; }

  function openLightbox(src, caption = '') {
    if (!src || !/^https?:\/\//i.test(src)) return;
    if (!lightboxEl) {
      lightboxEl = document.createElement('div');
      lightboxEl.className = 'cgq-lightbox';
      lightboxEl.hidden = true;
      lightboxEl.innerHTML = `
        <div class="cgq-lightbox-bar">
          <span class="cgq-lightbox-caption"></span>
          <div class="cgq-lightbox-actions">
            <a class="cgq-lightbox-btn" target="_blank" rel="noopener noreferrer" title="新しいタブで開く" aria-label="新しいタブで開く">${LIGHTBOX_ICON_OPEN}</a>
            <button type="button" class="cgq-lightbox-btn" data-lightbox-close title="閉じる" aria-label="閉じる">${LIGHTBOX_ICON_CLOSE}</button>
          </div>
        </div>
        <figure class="cgq-lightbox-figure"><img alt=""></figure>`;
      // Backdrop and close button dismiss; clicks on the image itself do not.
      lightboxEl.addEventListener('click', e => {
        if (e.target === lightboxEl || e.target.closest('[data-lightbox-close]')) closeLightbox();
      });
      document.body.appendChild(lightboxEl);
      document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });
    }
    lightboxEl.querySelector('.cgq-lightbox-caption').textContent = caption;
    lightboxEl.querySelector('.cgq-lightbox-btn').href = src;
    const img = lightboxEl.querySelector('img');
    img.alt = caption;
    img.src = src;
    lightboxEl.hidden = false;
  }
  document.addEventListener('click', e => {
    const link = e.target.closest && e.target.closest('a.cgq-image-link');
    if (!link) return;
    e.preventDefault();
    const img = link.querySelector('img');
    openLightbox(img?.getAttribute('src') || link.getAttribute('href'), img?.getAttribute('alt') || '');
  });

  // Queue panels can be folded to a single header line; the choice is remembered per panel.
  const QUEUE_COLLAPSE_KEY = 'cgq_queue_collapsed';
  function readQueueCollapsed() {
    try { return JSON.parse(localStorage.getItem(QUEUE_COLLAPSE_KEY) || '{}'); } catch { return {}; }
  }
  function isQueueCollapsed(key) { return !!readQueueCollapsed()[key]; }
  function setQueueCollapsed(key, collapsed) {
    const all = readQueueCollapsed();
    if (collapsed) all[key] = true; else delete all[key];
    try { localStorage.setItem(QUEUE_COLLAPSE_KEY, JSON.stringify(all)); } catch {}
  }
  document.addEventListener('click', e => {
    const btn = e.target.closest && e.target.closest('.cgq-panel-collapse');
    const panel = btn && btn.closest('[data-queue-key]');
    if (!panel) return;
    const collapsed = !panel.classList.contains('is-collapsed');
    panel.classList.toggle('is-collapsed', collapsed);
    btn.setAttribute('aria-expanded', String(!collapsed));
    setQueueCollapsed(panel.dataset.queueKey, collapsed);
  });
  const queuePanelOfSingle = document.getElementById('single-queue-panel');
  if (queuePanelOfSingle) {
    const collapsed = isQueueCollapsed('single');
    queuePanelOfSingle.classList.toggle('is-collapsed', collapsed);
    queuePanelOfSingle.querySelector('.cgq-panel-collapse')?.setAttribute('aria-expanded', String(!collapsed));
  }

  // Delegated reconnect button handler
  document.addEventListener('click', (e) => {
    const reconnectBtn = e.target.closest && e.target.closest('.btn-reconnect-tab');
    if (reconnectBtn) {
      const chromeTabId = parseInt(reconnectBtn.dataset.chromeTabId, 10);
      if (chromeTabId) {
        chrome.runtime.sendMessage({ action: 'RELOAD_CHAT_TAB', chromeTabId });
        showToast('タブを再読み込みしています...');
      }
    }
  });

  // Interactive answer widgets report their height so each frame fits its content.
  window.addEventListener('message', event => {
    const data = event.data;
    if (!data || data.type !== 'cgq-widget-height') return;
    document.querySelectorAll('iframe.cgq-widget-frame').forEach(frame => {
      if (frame.contentWindow === event.source) frame.style.height = `${Math.min(Math.max(Number(data.height) || 0, 160), 900)}px`;
    });
  });

  // Chats the user keeps out of the parallel view (they stay in the sidebar and detail view).
  const GRID_EXCLUDED_KEY = 'cgq_grid_excluded';
  function readGridExcluded() {
    try { return JSON.parse(localStorage.getItem(GRID_EXCLUDED_KEY) || '{}'); } catch { return {}; }
  }
  function isExcludedFromGrid(tabId) { return !!readGridExcluded()[tabId]; }
  function setGridExcluded(tabId, excluded) {
    const all = readGridExcluded();
    if (excluded) all[tabId] = true; else delete all[tabId];
    try { localStorage.setItem(GRID_EXCLUDED_KEY, JSON.stringify(all)); } catch {}
  }

  // Tab management view: parallel-view inclusion and closing each chat's browser tab.
  let lastManageTabs = [];
  let manageSignature = '';
  function renderManageView(tabs) {
    lastManageTabs = tabs;
    const excluded = readGridExcluded();
    const signature = JSON.stringify(tabs.map(t => [t.tabId, t.title, (t.items || []).length, t.currentState, !!excluded[t.tabId]]));
    if (signature === manageSignature) return;
    manageSignature = signature;
    const gridCount = tabs.filter(t => !excluded[t.tabId]).length;
    document.getElementById('manage-count').textContent = `並列表示 ${gridCount} / ${tabs.length}`;
    manageList.innerHTML = tabs.length ? tabs.map(t => {
      const platform = t.platform === 'gemini' ? 'Gemini' : 'ChatGPT';
      const { dotClass, statusLabel } = getStatusInfo(t);
      const included = !excluded[t.tabId];
      const qLen = (t.items || []).length;
      return `
        <div class="cgq-manage-row ${included ? '' : 'is-excluded'}" data-tab-id="${escapeHtml(t.tabId)}">
          <div class="cgq-manage-main">
            <span class="cgq-stat-dot ${dotClass}"></span>
            <div class="cgq-manage-info">
              <span class="cgq-manage-title" title="${escapeHtml(cleanTabTitle(t.title, t.platform))}">${escapeHtml(cleanTabTitle(t.title, t.platform))}</span>
              <span class="cgq-manage-meta"><span class="cgq-manage-platform">${platform}</span>${escapeHtml(statusLabel)}</span>
            </div>
          </div>
          <div class="cgq-manage-side">
            <span class="cgq-manage-queue ${qLen > 0 ? 'has-items' : ''}">キュー ${qLen}</span>
            <button type="button" class="cgq-manage-action manage-detail" data-tab-id="${escapeHtml(t.tabId)}" title="個別チャットを表示" aria-label="個別チャットを表示">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            </button>
            <button type="button" class="cgq-manage-action manage-focus" data-chrome-tab-id="${t.chromeTabId ? escapeHtml(String(t.chromeTabId)) : ''}" ${t.chromeTabId ? '' : 'disabled'} title="このチャットのタブへ移動" aria-label="タブへ移動">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </button>
            <label class="cgq-switch" title="並列表示に含める">
              <input type="checkbox" class="manage-grid-check" ${included ? 'checked' : ''}>
              <span class="cgq-switch-track"></span>
            </label>
            <button type="button" class="cgq-manage-close manage-close" data-tab-id="${escapeHtml(t.tabId)}" title="タブを閉じる" aria-label="タブを閉じる">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        </div>`;
    }).join('') : '<p class="cgq-manage-empty">開いているチャットがありません</p>';
  }
  manageList.addEventListener('change', e => {
    const check = e.target.closest && e.target.closest('.manage-grid-check');
    const row = check && check.closest('[data-tab-id]');
    if (!row) return;
    setGridExcluded(row.dataset.tabId, !check.checked);
    manageSignature = '';
    updateDashboard();
  });
  manageList.addEventListener('click', e => {
    const detail = e.target.closest && e.target.closest('.manage-detail');
    if (detail) { selectedTabId = detail.dataset.tabId; switchMode('single'); return; }
    const focus = e.target.closest && e.target.closest('.manage-focus');
    if (focus && focus.dataset.chromeTabId) {
      chrome.runtime.sendMessage({ action: 'FOCUS_TAB', chromeTabId: Number(focus.dataset.chromeTabId) });
      return;
    }
    const btn = e.target.closest && e.target.closest('.manage-close');
    const t = btn && lastManageTabs.find(item => item.tabId === btn.dataset.tabId);
    if (t) closeChatTab(t);
  });

  // --------------------------------------------------------------------------
  // Settings View Implementation
  // --------------------------------------------------------------------------
  const DEFAULT_SETTINGS = {
    typingMode: 'mixed',
    simulateTypos: true,
    punctuationPause: true,
    typingJitter: true,
    typingSpeed: 45,
    minReadDelay: 2.5,
    maxReadDelay: 4.5,
    dynamicDelay: true,
    continuousFatigue: true,
    autoReloadOnDisconnect: true,
    disconnectReloadTimeout: 120,
    enterToQueue: true,
    soundNotification: true,
    autoScroll: true,
    themeMode: 'auto',
    singleChatHistoryMode: 'all',
    answerFontSize: 14,
    cardMinWidth: 280,
  };

  let settingsInitialized = false;

  function getEffectiveSettings() {
    return { ...DEFAULT_SETTINGS, ...(currentSettings || {}) };
  }

  function renderSettingsView() {
    const s = getEffectiveSettings();

    const setMode = document.getElementById('setting-typing-mode');
    const setTypos = document.getElementById('setting-simulate-typos');
    const setPunct = document.getElementById('setting-punctuation-pause');
    const setJitter = document.getElementById('setting-typing-jitter');
    const setSpeed = document.getElementById('setting-typing-speed');
    const valSpeed = document.getElementById('setting-val-speed');
    const setMinRead = document.getElementById('setting-min-read');
    const setMaxRead = document.getElementById('setting-max-read');
    const valRead = document.getElementById('setting-val-read');
    const setDynamic = document.getElementById('setting-dynamic-delay');
    const setFatigue = document.getElementById('setting-continuous-fatigue');
    const setEnterQueue = document.getElementById('setting-enter-queue');
    const setAutoReload = document.getElementById('setting-auto-reload');
    const setSound = document.getElementById('setting-sound-notification');
    const setScroll = document.getElementById('setting-auto-scroll');
    const setTheme = document.getElementById('setting-theme-mode');
    const setHistory = document.getElementById('setting-history-mode');

    if (setMode) setMode.value = s.typingMode || 'mixed';
    if (setTypos) setTypos.checked = !!s.simulateTypos;
    if (setPunct) setPunct.checked = !!s.punctuationPause;
    if (setJitter) setJitter.checked = !!s.typingJitter;
    if (setSpeed) {
      setSpeed.value = s.typingSpeed || 45;
      if (valSpeed) valSpeed.textContent = setSpeed.value;
    }
    if (setMinRead && setMaxRead) {
      setMinRead.value = s.minReadDelay ?? 2.5;
      setMaxRead.value = s.maxReadDelay ?? 4.5;
      if (valRead) valRead.textContent = `${setMinRead.value}s - ${setMaxRead.value}s`;
    }
    if (setDynamic) setDynamic.checked = s.dynamicDelay !== false;
    if (setFatigue) setFatigue.checked = s.continuousFatigue !== false;
    if (setEnterQueue) setEnterQueue.checked = s.enterToQueue !== false;
    if (setAutoReload) setAutoReload.checked = s.autoReloadOnDisconnect !== false;
    if (setSound) setSound.checked = s.soundNotification !== false;
    if (setScroll) setScroll.checked = s.autoScroll !== false;
    if (setTheme) setTheme.value = s.themeMode || 'auto';
    if (setHistory) setHistory.value = s.singleChatHistoryMode || singleChatHistoryMode || 'all';
    for (const [id, key, fallback, label] of DISPLAY_SLIDERS) {
      const slider = document.getElementById(id);
      if (!slider) continue;
      slider.value = s[key] || fallback;
      document.getElementById(label).textContent = slider.value;
    }

    if (!settingsInitialized) {
      settingsInitialized = true;
      initSettingsEvents();
    }
  }

  function readSettingsFromUI() {
    const setMode = document.getElementById('setting-typing-mode');
    const setTypos = document.getElementById('setting-simulate-typos');
    const setPunct = document.getElementById('setting-punctuation-pause');
    const setJitter = document.getElementById('setting-typing-jitter');
    const setSpeed = document.getElementById('setting-typing-speed');
    const setMinRead = document.getElementById('setting-min-read');
    const setMaxRead = document.getElementById('setting-max-read');
    const setDynamic = document.getElementById('setting-dynamic-delay');
    const setFatigue = document.getElementById('setting-continuous-fatigue');
    const setEnterQueue = document.getElementById('setting-enter-queue');
    const setAutoReload = document.getElementById('setting-auto-reload');
    const setSound = document.getElementById('setting-sound-notification');
    const setScroll = document.getElementById('setting-auto-scroll');
    const setTheme = document.getElementById('setting-theme-mode');
    const setHistory = document.getElementById('setting-history-mode');

    return {
      typingMode: setMode ? setMode.value : 'mixed',
      simulateTypos: setTypos ? setTypos.checked : true,
      punctuationPause: setPunct ? setPunct.checked : true,
      typingJitter: setJitter ? setJitter.checked : true,
      typingSpeed: setSpeed ? parseInt(setSpeed.value, 10) : 45,
      minReadDelay: setMinRead ? parseFloat(setMinRead.value) : 2.5,
      maxReadDelay: setMaxRead ? parseFloat(setMaxRead.value) : 4.5,
      dynamicDelay: setDynamic ? setDynamic.checked : true,
      continuousFatigue: setFatigue ? setFatigue.checked : true,
      enterToQueue: setEnterQueue ? setEnterQueue.checked : true,
      autoReloadOnDisconnect: setAutoReload ? setAutoReload.checked : true,
      soundNotification: setSound ? setSound.checked : true,
      autoScroll: setScroll ? setScroll.checked : true,
      themeMode: setTheme ? setTheme.value : 'auto',
      singleChatHistoryMode: setHistory ? setHistory.value : 'all',
    };
  }

  async function saveSettings(newSettings, showFeedback = false) {
    currentSettings = { ...currentSettings, ...newSettings };
    try {
      await chrome.storage.local.set({ [STORAGE_KEY_SETTINGS]: currentSettings });
    } catch (e) {
      console.warn('[Dashboard] Failed to save settings:', e);
    }

    if (newSettings.themeMode) {
      if (newSettings.themeMode === 'dark') applyTheme(true);
      else if (newSettings.themeMode === 'light') applyTheme(false);
      else {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        applyTheme(prefersDark);
      }
    }

    applyDisplaySettings();

    if (newSettings.singleChatHistoryMode && newSettings.singleChatHistoryMode !== singleChatHistoryMode) {
      singleChatHistoryMode = newSettings.singleChatHistoryMode;
      delete singleAnswersArea.dataset.ansSig;
    }

    if (showFeedback) {
      showToast('設定を保存しました');
    }
  }

  function initSettingsEvents() {
    for (const [id, key, , label] of DISPLAY_SLIDERS) {
      const slider = document.getElementById(id);
      slider?.addEventListener('input', () => {
        document.getElementById(label).textContent = slider.value;
        saveSettings({ [key]: parseFloat(slider.value) });
      });
    }

    const setSpeed = document.getElementById('setting-typing-speed');
    const valSpeed = document.getElementById('setting-val-speed');
    if (setSpeed && valSpeed) {
      setSpeed.addEventListener('input', () => {
        valSpeed.textContent = setSpeed.value;
        saveSettings({ typingSpeed: parseInt(setSpeed.value, 10) });
      });
    }

    const setMinRead = document.getElementById('setting-min-read');
    const setMaxRead = document.getElementById('setting-max-read');
    const valRead = document.getElementById('setting-val-read');
    const onReadChange = () => {
      let minVal = parseFloat(setMinRead.value);
      let maxVal = parseFloat(setMaxRead.value);
      if (minVal > maxVal) {
        setMaxRead.value = minVal;
        maxVal = minVal;
      }
      if (valRead) valRead.textContent = `${minVal}s - ${maxVal}s`;
      saveSettings({ minReadDelay: minVal, maxReadDelay: maxVal });
    };
    if (setMinRead) setMinRead.addEventListener('input', onReadChange);
    if (setMaxRead) setMaxRead.addEventListener('input', onReadChange);

    const inputs = [
      'setting-typing-mode',
      'setting-simulate-typos',
      'setting-punctuation-pause',
      'setting-typing-jitter',
      'setting-dynamic-delay',
      'setting-continuous-fatigue',
      'setting-enter-queue',
      'setting-auto-reload',
      'setting-sound-notification',
      'setting-auto-scroll',
      'setting-theme-mode',
      'setting-history-mode'
    ];

    inputs.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => {
        const updated = readSettingsFromUI();
        saveSettings(updated);
      });
    });

    if (btnSettingsSave) {
      btnSettingsSave.addEventListener('click', () => {
        const updated = readSettingsFromUI();
        saveSettings(updated, true);
      });
    }

    if (btnSettingsReset) {
      btnSettingsReset.addEventListener('click', () => {
        currentSettings = { ...DEFAULT_SETTINGS };
        saveSettings(currentSettings, false);
        renderSettingsView();
        showToast('設定を初期値に戻しました');
      });
    }
  }

  function renderSidebarList(tabs) {
    const existingItems = {};
    sidebarChatList.querySelectorAll('.cgq-sidebar-chat-item').forEach(el => {
      if (el.dataset.tabId) existingItems[el.dataset.tabId] = el;
    });

    tabs.forEach((t, index) => {
      const qLen = (t.items || []).length;
      const { dotClass, statusLabel } = getStatusInfo(t);
      const isSelected = (t.tabId === selectedTabId);

      let itemEl = existingItems[t.tabId];
      if (!itemEl) {
        itemEl = document.createElement('div');
        itemEl.className = 'cgq-sidebar-chat-item';
        itemEl.dataset.tabId = t.tabId;
        itemEl.onclick = () => {
          const prevTabId = selectedTabId;
          selectedTabId = t.tabId;
          if (prevTabId !== t.tabId && singleAnswersArea) {
            singleAnswersArea.dataset.ansSig = '';
          }
          if (currentMode !== 'single') {
            switchMode('single');
          } else {
            updateDashboard();
          }
          if (singleChatInput) singleChatInput.focus();
        };
      } else {
        delete existingItems[t.tabId];
      }

      itemEl.classList.toggle('selected', isSelected);
      const isGemini = t.platform === 'gemini';
      const platformName = isGemini ? 'Gemini' : 'ChatGPT';
      const itemTitle = cleanTabTitle(t.title, t.platform);
      itemEl.title = `${itemTitle} (${statusLabel})${qLen > 0 ? ` - キュー ${qLen}件` : ''}`;
      itemEl.setAttribute('aria-label', itemEl.title);
      itemEl.dataset.hasQueue = qLen > 0 ? 'true' : 'false';
      itemEl.innerHTML = `
        <div class="cgq-chat-item-left">
          <span class="cgq-stat-dot ${dotClass}"></span>
          <span class="cgq-chat-item-title" title="${escapeHtml(itemTitle)}">${escapeHtml(itemTitle)}</span>
        </div>
        <div class="cgq-chat-item-right">
          <span class="cgq-chat-queue-badge ${qLen > 0 ? 'has-items' : ''}" title="キュー件数">${qLen}</span>
        </div>
      `;

      if (sidebarChatList.children[index] !== itemEl) {
        sidebarChatList.insertBefore(itemEl, sidebarChatList.children[index] || null);
      }
    });

    for (const tid in existingItems) {
      existingItems[tid].remove();
    }
  }

  // --------------------------------------------------------------------------
  // Mode 1: Render Single Chat Focus View (AI Chat tool layout)
  // --------------------------------------------------------------------------
  function renderSingleChatView() {
    if (!selectedTabId) return;
    const t = cachedTabsData.get(selectedTabId);
    if (!t) return;

    const { dotClass, statusLabel, isStreaming } = getStatusInfo(t);
    const items = Array.isArray(t.items) ? t.items : [];
    const isGemini = t.platform === 'gemini';
    const platformName = isGemini ? 'Gemini' : 'ChatGPT';

    singleToolInput.sync();

    // 1. Header Info
    const cleanTitle = cleanTabTitle(t.title, t.platform);
    singleChatTitle.textContent = cleanTitle;
    singleChatTitle.title = cleanTitle;
    singleChatStatus.className = `cgq-chat-status-pill ${dotClass}`;
    singleChatStatusText.textContent = statusLabel;

    [singleChatInput, singleBtnSend, singleBtnPause, singleModelPillBtn].forEach(el => {
      if (el) el.disabled = !!t.needsConnection;
    });
    if (!singleChatInput.dataset.defaultPlaceholder) singleChatInput.dataset.defaultPlaceholder = singleChatInput.placeholder;
    singleChatInput.placeholder = t.needsConnection ? '対象タブを再読み込みして接続してください' : singleChatInput.dataset.defaultPlaceholder;

    // Active Model & Effort Badge
    if (singleChatModelText) {
      singleChatModelText.textContent = t.modelLabel || 'Auto';
    }
    if (singleChatEffortText) {
      if (t.effort && t.effort !== 'auto') {
        singleChatEffortText.textContent = formatEffortBadge(t.effort, t.effortLabel);
        singleChatEffortText.style.display = 'inline-block';
      } else {
        singleChatEffortText.style.display = 'none';
      }
    }
    if (singleChatModelBadge) {
      const isReasoning = (!isGemini && t.model && t.model.startsWith('o')) || (isGemini && /thinking|思考/i.test(t.model || ''));
      singleChatModelBadge.classList.toggle('reasoning', !!isReasoning);
      singleChatModelBadge.onclick = () => singleModelPillBtn?.click();
    }

    // Dynamic model dropdown and effort select
    updateSingleModelOptions(t);

    // Focus Tab Button
    if (t.chromeTabId) {
      singleBtnFocusTab.style.display = 'inline-flex';
      singleBtnFocusTab.onclick = () => {
        chrome.runtime.sendMessage({ action: 'FOCUS_TAB', chromeTabId: t.chromeTabId });
      };
    } else {
      singleBtnFocusTab.style.display = 'none';
    }

    // Reload Tab Button
    if (singleBtnReloadTab) {
      if (t.chromeTabId) {
        singleBtnReloadTab.style.display = 'inline-flex';
        singleBtnReloadTab.onclick = () => {
          chrome.runtime.sendMessage({ action: 'RELOAD_CHAT_TAB', chromeTabId: t.chromeTabId });
          showToast('タブを再読み込みしています...');
        };
      } else {
        singleBtnReloadTab.style.display = 'none';
      }
    }

    // Pause Button
    singleBtnPause.title = t.isPaused ? '再開' : '一時停止';
    singleBtnPause.innerHTML = t.isPaused ? `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
    ` : `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="6" y="4" width="4" height="16"></rect>
        <rect x="14" y="4" width="4" height="16"></rect>
      </svg>
    `;
    singleBtnPause.onclick = () => sendRemoteCommand(selectedTabId, { action: 'TOGGLE_PAUSE' });

    // Copy Answer Button
    singleBtnCopyAnswer.onclick = async () => {
      const turns = getUnifiedTurns(t);
      const latestTurn = turns.length > 0 ? turns[turns.length - 1] : null;
      const text = latestTurn?.answer || (t.latestAnswer ? t.latestAnswer.text : '');
      if (text) {
        await navigator.clipboard?.writeText(CGQReferences.plainText(text));
        showToast('回答全文をクリップボードにコピーしました');
        singleBtnCopyAnswer.classList.add('copied');
        setTimeout(() => singleBtnCopyAnswer.classList.remove('copied'), 1500);
      }
    };

    // 2. Activity Bar
    updateActivityBar(singleChatActivity, t);

    // 3. Answers Area
    singleAnswersArea.dataset.platform = t.platform === 'gemini' ? 'gemini' : 'chatgpt';
    const ansSig = getAnswerSig(t);
    if (singleAnswersArea.dataset.ansSig !== ansSig) {
      const scrollEl = singleChatBody || singleAnswersArea;
      const isNearBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 150;
      const isInitial = !singleAnswersArea.dataset.ansSig;
      singleAnswersArea.dataset.ansSig = ansSig;
      singleAnswersArea.innerHTML = buildSingleAnswersHtml(t);
      bindCodeBlockCopy(singleAnswersArea);
      bindSingleAnswersEvents();
      renderMermaidDiagrams(singleAnswersArea);
      if (isNearBottom || isInitial) {
        scrollEl.scrollTop = scrollEl.scrollHeight;
      }
    }

    // 4. Queued Messages Panel (Anchored Above Composer)
    singleQueuePanel.hidden = items.length === 0;
    if (singleQueueBadge.textContent !== String(items.length)) {
      singleQueueBadge.textContent = items.length;
      if (items.length > 0) {
        singleQueueBadge.classList.add('pop');
        setTimeout(() => singleQueueBadge.classList.remove('pop'), 350);
      }
    }
    singleQueueSubtext.textContent = getQueueStatusSubtext(t);

    singleQueueBtnClear.style.display = items.length > 0 ? 'inline-flex' : 'none';
    singleQueueBtnClear.onclick = () => {
      if (confirm('キュー内のすべてのプロンプトを消去しますか？')) {
        sendRemoteCommand(selectedTabId, { action: 'CLEAR_QUEUE' });
      }
    };

    renderSingleQueueItems(items);

    // 5. Composer Draft Restoration (If switching tabs)
    if (singleChatInput.dataset.activeTabId !== selectedTabId) {
      singleChatInput.dataset.activeTabId = selectedTabId;
      singleChatInput.value = tabInputDrafts.get(selectedTabId) || '';
      fitSingleInput();
    }
  }

  function buildModelCatalogFooter(t) {
    const busy = modelRequests.has(t.tabId);
    const error = modelRequestErrors.get(t.tabId) || t.modelsError;
    const message = busy ? 'サービスのモデル一覧を確認中...' : error ||
      (t.availableModels?.length ? '対象タブのモデルメニューから取得' : 'モデル一覧を取得してください');
    return `<div class="cgq-model-catalog-footer">
      <span role="status">${escapeHtml(message)}</span>
      <button type="button" class="cgq-btn secondary sm" data-refresh-models ${busy ? 'disabled' : ''}>再取得</button>
    </div>`;
  }

  async function requestServiceModels(t, action, model) {
    if (modelRequests.has(t.tabId)) return null;
    modelRequests.set(t.tabId, action);
    modelRequestErrors.delete(t.tabId);
    updateDashboard();
    try {
      if (!t.chromeTabId) throw new Error('対象タブに接続できません。対象ページを再読み込みしてください。');
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('モデル操作がタイムアウトしました。対象タブで選択状態を確認してください。')), 20000);
        chrome.tabs.sendMessage(t.chromeTabId, { action, model }, result => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            reject(new Error('対象タブと通信できません。拡張機能と対象ページを再読み込みしてください。'));
          } else if (!result) {
            reject(new Error('モデル情報の応答がありません。対象ページを再読み込みしてください。'));
          } else resolve(result);
        });
      });
      const { model: currentModel, modelLabel, availableModels, modelsError, effort, effortLabel, supportsEffort, availableEfforts } = response;
      const info = { model: currentModel, modelLabel, availableModels, modelsError, effort, effortLabel, supportsEffort, availableEfforts };
      const updated = { ...(cachedTabsData.get(t.tabId) || t), ...info };
      cachedTabsData.set(t.tabId, updated);
      currentRegistry[t.tabId] = { ...(currentRegistry[t.tabId] || t), ...info };
      if (!response.success) throw new Error(response.error || 'モデル操作を確認できませんでした。');
      return updated;
    } catch (error) {
      modelRequestErrors.set(t.tabId, error.message);
      showToast(error.message);
      return null;
    } finally {
      modelRequests.delete(t.tabId);
      updateDashboard();
    }
  }

  function refreshServiceModels(t) {
    return requestServiceModels(t, 'REFRESH_MODELS');
  }

  function bindModelCatalogActions(list, t) {
    list.querySelector('[data-refresh-models]')?.addEventListener('click', e => {
      e.stopPropagation();
      refreshServiceModels(cachedTabsData.get(t.tabId) || t);
    });
    list.querySelectorAll('[data-model-id]').forEach(item => {
      item.onclick = async e => {
        e.stopPropagation();
        if (modelRequests.has(t.tabId)) return;
        const id = item.dataset.modelId;
        if (id === 'auto') {
          selectedModelOverride[t.tabId] = 'auto';
          delete cardModelSelections[t.tabId];
          closeAllPopovers();
          updateDashboard();
          return;
        }
        const updated = await requestServiceModels(cachedTabsData.get(t.tabId) || t, 'SELECT_MODEL', id);
        if (!updated) return;
        delete selectedModelOverride[t.tabId];
        delete cardModelSelections[t.tabId];
        showToast(`モデルを ${updated.modelLabel} に切り替えました`);
        closeAllPopovers();
        updateDashboard();
      };
    });
  }

  function formatEffortLabel(id, label = '') {
    const labels = {
      auto: 'Auto',
      instant: 'Instant',
      low: 'Low',
      medium: 'Medium',
      high: 'High',
      minimal: 'Minimal',
      standard: 'Standard',
      extended: 'Extended',
      xhigh: 'Extra high',
      max: 'Max',
      off: 'Off',
      none: 'Off'
    };
    return labels[id] || label.match(/[(（]([^()（）]+)[)）]/)?.[1] || label || id;
  }

  function formatEffortBadge(effort, effortLabel = '') {
    if (!effort || effort === 'auto') return '';
    return formatEffortLabel(effort, effortLabel);
  }

  function getModelAndEffortData(t) {
    if (!t) return null;
    const isGemini = t.platform === 'gemini';
    const discovered = Array.isArray(t.availableModels) ? t.availableModels.filter(m =>
      m && typeof m.id === 'string' && typeof m.label === 'string' && m.id !== 'auto') : [];
    const models = [{ id: 'auto', label: 'Auto', desc: '送信時のモデルを変更しません' }, ...discovered];
    const requested = selectedModelOverride[t.tabId];
    const activeModelId = models.some(m => m.id === requested) ? requested :
      models.some(m => m.id === t.model) ? t.model : 'auto';
    const curModelEntry = models.find(m => m.id === activeModelId);
    const supportsEffort = !!t.supportsEffort || (isGemini && (
      !!t.effort ||
      (curModelEntry && curModelEntry.isReasoning) ||
      (Array.isArray(t.availableEfforts) && t.availableEfforts.length > 0)
    ));
    const activeEffortId = selectedEffortOverride[t.tabId] || t.effort || 'auto';

    const rawEfforts = Array.isArray(t.availableEfforts) && t.availableEfforts.length > 0 ? t.availableEfforts : (
      isGemini ? [
        { id: 'auto', label: 'Auto', title: 'Auto', desc: 'モデルのデフォルト推論設定' },
        { id: 'low', label: 'Low', title: 'Low', desc: '思考時間を抑え高速に回答' },
        { id: 'medium', label: 'Medium', title: 'Medium', desc: '標準的な思考深度と速度のバランス' },
        { id: 'high', label: 'High', title: 'High', desc: '難問・複雑なコーディング向けに最大思考' }
      ] : [
        { id: 'auto', label: 'Auto', title: 'Auto', desc: '現在の思考設定を使用' },
        { id: 'instant', label: 'Instant', title: 'Instant', desc: '思考時間を抑え即時・高速に回答' },
        { id: 'medium', label: 'Medium', title: 'Medium', desc: '標準的な思考深度と速度のバランス' },
        { id: 'high', label: 'High', title: 'High', desc: '難問・複雑なコーディング向けに最大思考' }
      ]
    );

    // Effort names are shown in English only (Auto / Low / Medium / High …), whatever the page's language.
    const efforts = rawEfforts.map(e => {
      const label = formatEffortLabel(e.id, e.label);
      return { ...e, label, title: label };
    });

    let normalizedEffortId = activeEffortId;
    if (!isGemini && normalizedEffortId === 'low') normalizedEffortId = 'instant';
    let curEffortEntry = efforts.find(e => e.id === normalizedEffortId) ||
                         efforts.find(e => e.id === activeEffortId) ||
                         efforts[0];

    return {
      isGemini,
      activeModelId,
      models,
      curModelEntry,
      supportsEffort,
      activeEffortId,
      efforts,
      curEffortEntry
    };
  }

  function updateSingleModelOptions(t) {
    if (!t) return;
    const modelData = getModelAndEffortData(t);
    if (!modelData) return;
    const { isGemini, activeModelId, models, curModelEntry, supportsEffort, curEffortEntry, efforts } = modelData;

    // Update Model Pill Label & Icon
    if (singleModelPillLabel) {
      singleModelPillLabel.textContent = curModelEntry.label;
    }
    if (singleModelPillIcon) {
      singleModelPillIcon.innerHTML = getModelIconSvg(curModelEntry.id);
    }
    if (singleModelSelect) {
      singleModelSelect.innerHTML = models.map(m => `<option value="${escapeHtml(m.id)}" ${m.id === curModelEntry.id ? 'selected' : ''}>${escapeHtml(m.label)}</option>`).join('');
      singleModelSelect.value = curModelEntry.id;
    }

    // Populate Model Popover List
    if (singleModelPopoverList) {
      singleModelPopoverList.innerHTML = models.map(m => {
        const isSelected = (m.id === curModelEntry.id);
        return `
          <div class="cgq-popover-item ${isSelected ? 'selected' : ''}" data-model-id="${escapeHtml(m.id)}" aria-disabled="${modelRequests.has(t.tabId)}">
            <div class="cgq-popover-item-left">
              <span class="cgq-popover-item-icon">
                ${getModelIconSvg(m.id)}
              </span>
              <div class="cgq-popover-item-content">
                <div class="cgq-popover-item-title-row">
                  <span class="cgq-popover-item-title">${escapeHtml(m.label)}</span>
                  ${m.isReasoning ? `<span class="cgq-popover-item-badge">推論</span>` : ''}
                </div>
                ${m.desc ? `<span class="cgq-popover-item-desc">${escapeHtml(m.desc)}</span>` : ''}
              </div>
            </div>
            ${isSelected ? `
              <div class="cgq-popover-item-check">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>
            ` : ''}
          </div>
        `;
      }).join('');

      singleModelPopoverList.insertAdjacentHTML('beforeend', buildModelCatalogFooter(t));
      bindModelCatalogActions(singleModelPopoverList, t);
    }

    // 2. Reasoning Effort Handling
    if (singleEffortWrapper) {
      if (supportsEffort) {
        singleEffortWrapper.style.display = 'block';
        if (singleEffortPillLabel) {
          singleEffortPillLabel.textContent = curEffortEntry.label;
        }
        if (singleEffortSelect) {
          singleEffortSelect.innerHTML = efforts.map(e => `<option value="${e.id}" ${e.id === curEffortEntry.id ? 'selected' : ''}>${escapeHtml(e.label)}</option>`).join('');
          singleEffortSelect.value = curEffortEntry.id;
        }

        renderEffortSlider(singleEffortPopoverList, t, efforts, curEffortEntry, () => {
          if (singleEffortSelect) singleEffortSelect.value = selectedEffortOverride[t.tabId];
          updateDashboard();
        });
      } else {
        singleEffortWrapper.style.display = 'none';
        if (singleEffortPillLabel) singleEffortPillLabel.textContent = '';
      }
    }
  }

  function getQueueStatusSubtext(t) {
    if (!t) return '待機中';
    if (t.isPaused) return '一時停止中 (クリックで再開)';
    if (t.currentState === 'waiting_generation') return '回答生成完了後に送信します...';
    if (t.currentState === 'reading_delay') return `回答確認中 (${t.progressText || '数秒'} 後に入力)...`;
    if (t.currentState === 'typing') return `入力中 (${t.progressPercent || 0}%)...`;
    if (Array.isArray(t.items) && t.items.length > 0) return '回答生成完了後に自動送信';
    return '待機中';
  }

  function buildQueueItemHtml(item, tabId) {
    return `
      <div class="cgq-panel-item" data-id="${item.id}">
        <div class="cgq-item-text">
          <span>${escapeHtml(item.text)}</span>
          ${CGQComposerTools.normalize(item.tools).map(tool => `<span class="cgq-queued-tool">${tool.type === 'app' ? '@' : '/'}${escapeHtml(tool.label)}</span>`).join('')}
          ${item.model && item.model !== 'auto' ? `
            <span class="cgq-item-model-tag" title="指定モデル: ${escapeHtml(item.model)}">
              ${escapeHtml(item.model)}${item.effort && item.effort !== 'auto' ? ` [${escapeHtml(formatEffortBadge(item.effort))}]` : ''}
            </span>
          ` : ''}
        </div>
        <div class="cgq-item-actions">
          <button class="cgq-item-btn send-now" data-action="send-now" ${tabId ? `data-tab-id="${tabId}"` : ''} data-id="${item.id}" title="最優先で今すぐ送信">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <line x1="5" y1="12" x2="19" y2="12"></line>
              <polyline points="12 5 19 12 12 19"></polyline>
            </svg>
          </button>
          <button class="cgq-item-btn delete" data-action="delete" ${tabId ? `data-tab-id="${tabId}"` : ''} data-id="${item.id}" title="削除">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  function renderSingleQueueItems(items) {
    if (items.length === 0) {
      singleQueueList.innerHTML = `
        <div style="padding: 10px 0; font-size: 13px; color: var(--text-muted); text-align: center;">
          待機中のキューはありません。下の入力欄から Enter で追加できます。
        </div>
      `;
      return;
    }

    singleQueueList.innerHTML = items.map(item => buildQueueItemHtml(item, selectedTabId)).join('');

    singleQueueList.querySelectorAll('.cgq-item-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (action === 'delete') {
          sendRemoteCommand(selectedTabId, { action: 'REMOVE_ITEM', id });
        } else if (action === 'send-now') {
          sendRemoteCommand(selectedTabId, { action: 'SEND_IMMEDIATELY', id });
        }
      };
    });
  }

  // --------------------------------------------------------------------------
  // Older history: scrolling to the top first reveals turns already held (「最新のみ」 / collapsed
  // card), then asks the tab for every turn it has and prepends the ones before the heartbeat window.
  // --------------------------------------------------------------------------
  const turnKey = qa => `${String(qa.prompt || '').trim().slice(0, 200)}\u0001${String(qa.answer || '').trim().slice(0, 200)}`;

  function olderTurnsBefore(t) {
    const all = olderHistory.get(t.tabId)?.all;
    const recent = Array.isArray(t.recentQA) ? t.recentQA : [];
    if (!all?.length) return [];
    if (!recent.length) return all.map(qa => ({ ...qa }));
    const first = turnKey(recent[0]);
    let idx = all.findIndex(qa => turnKey(qa) === first);
    if (idx < 0) idx = all.findIndex(qa => String(qa.prompt || '').trim() === String(recent[0].prompt || '').trim());
    if (idx >= 0) return all.slice(0, idx).map(qa => ({ ...qa }));
    const known = new Set(recent.map(turnKey));
    return all.filter(qa => !known.has(turnKey(qa))).map(qa => ({ ...qa }));
  }

  // Run a re-render while keeping the visible content where it is (content is added above it).
  function keepScroll(el, render) {
    const height = el.scrollHeight;
    const top = el.scrollTop;
    render();
    el.scrollTop = el.scrollHeight - height + top;
  }

  function rerenderTurns(kind, tabId) {
    const t = cachedTabsData.get(tabId);
    if (!t) return;
    if (kind === 'single') {
      if (tabId !== selectedTabId) return;
      delete singleAnswersArea.dataset.ansSig;
      renderSingleChatView();
    } else {
      const card = document.getElementById(`card-${tabId}`);
      if (!card) return;
      delete card.dataset.answerSig;
      updateExistingCard(card, t, Date.now());
    }
  }

  function loadOlderTurns(scrollEl, indicatorEl, tabId, kind) {
    const t = cachedTabsData.get(tabId);
    if (!t || t.needsConnection || !t.chromeTabId) return;
    const state = olderHistory.get(tabId) || {};
    olderHistory.set(tabId, state);
    if (state.loading || (state.exhaustedAt && Date.now() - state.exhaustedAt < 15000)) return;

    const turns = getUnifiedTurns(t);
    if (kind === 'single' && turns.length > 1 && singleChatHistoryMode === 'latest') {
      keepScroll(scrollEl, () => {
        singleChatHistoryMode = 'all';
        rerenderTurns(kind, tabId);
      });
      return;
    }

    state.loading = true;
    indicatorEl.classList.add('cgq-loading-older');
    const done = response => {
      clearTimeout(timer);
      if (!state.loading) return;
      state.loading = false;
      indicatorEl.classList.remove('cgq-loading-older');
      if (!response?.success) return;
      const before = getUnifiedTurns(cachedTabsData.get(tabId) || t).length;
      state.all = response.turns || [];
      const after = getUnifiedTurns(cachedTabsData.get(tabId) || t).length;
      if (after <= before) {
        state.exhaustedAt = Date.now();
        return;
      }
      keepScroll(scrollEl, () => rerenderTurns(kind, tabId));
    };
    const timer = setTimeout(() => done(null), 8000);
    try {
      chrome.tabs.sendMessage(t.chromeTabId, { action: 'GET_OLDER_HISTORY', have: turns.length }, response => {
        done(chrome.runtime.lastError ? null : response);
      });
    } catch {
      done(null);
    }
  }

  function bindOlderTurns(scrollEl, indicatorEl, getTabId, kind) {
    if (!scrollEl || scrollEl.dataset.olderBound) return;
    scrollEl.dataset.olderBound = '1';
    const load = () => { const tabId = getTabId(); if (tabId) loadOlderTurns(scrollEl, indicatorEl, tabId, kind); };
    scrollEl.addEventListener('scroll', () => { if (scrollEl.scrollTop <= 80) load(); }, { passive: true });
    // Content that does not fill the view never scrolls: an upward wheel at the top asks too.
    scrollEl.addEventListener('wheel', e => { if (e.deltaY < 0 && scrollEl.scrollTop <= 0) load(); }, { passive: true });
  }

  // The tab reports its turns and, separately, the latest answer; the same turn can arrive twice with small
  // differences (another root element, whitespace, sources added later). Compare by the prompt, or by the
  // start of the answer when a prompt is missing.
  const turnText = value => String(value || '').replace(/[\s*_`#>|\-]+/g, ' ').trim();
  function sameTurn(a, b) {
    const pa = turnText(a?.prompt), pb = turnText(b?.prompt);
    if (pa && pb) return pa === pb && (!a.answer || !b.answer || turnText(a.answer).slice(0, 120) === turnText(b.answer).slice(0, 120) ||
      turnText(a.answer).startsWith(turnText(b.answer).slice(0, 60)) || turnText(b.answer).startsWith(turnText(a.answer).slice(0, 60)));
    const aa = turnText(a?.answer).slice(0, 120), ab = turnText(b?.answer).slice(0, 120);
    return !!aa && aa === ab;
  }

  function getUnifiedTurns(t) {
    const turns = [...olderTurnsBefore(t), ...(Array.isArray(t.recentQA) ? t.recentQA : [])].map(qa => ({ ...qa }));
    const latestAns = t.latestAnswer;
    if (latestAns && (latestAns.text || latestAns.isStreaming || latestAns.userPrompt)) {
      const latest = { prompt: latestAns.userPrompt || '', answer: latestAns.text || '', isStreaming: latestAns.isStreaming || false,
        progress: latestAns.progress || null, thinking: latestAns.progress?.thinking || undefined,
        timestamp: latestAns.timestamp || Date.now() };
      const last = turns[turns.length - 1];
      // latestAnswer always describes the page's last turn: the same prompt is the same turn.
      const isSameTurn = last && (sameTurn(last, latest) || (!!latest.prompt && turnText(last.prompt) === turnText(latest.prompt)) ||
        (!last.prompt && latest.prompt && !last.answer) || (last.isStreaming && !latest.prompt));
      if (isSameTurn) {
        if (latest.answer) last.answer = latest.answer;
        if (latest.prompt) last.prompt = latest.prompt;
        last.isStreaming = latest.isStreaming;
        last.progress = latest.progress;
        if (latest.progress?.thinking) last.thinking = latest.progress.thinking;
      } else {
        turns.push(latest);
      }
    }
    // Collapse a turn repeated back to back (keep the later, fuller reading).
    const unique = turns.reduce((out, qa) => {
      const prev = out[out.length - 1];
      if (prev && sameTurn(prev, qa)) out[out.length - 1] = { ...prev, ...qa, prompt: qa.prompt || prev.prompt, answer: qa.answer || prev.answer };
      else out.push(qa);
      return out;
    }, []);
    unique.forEach((qa, idx) => { qa.turn = idx + 1; });
    return unique;
  }

  function buildSingleAnswersHtml(t) {
    if (t.needsConnection) return connectionHelp(t);
    const turns = getUnifiedTurns(t);

    if (turns.length === 0) {
      return `
        <div class="cgq-answer-card" style="align-items: center; justify-content: center; padding: 48px 20px; text-align: center;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" style="color: var(--text-muted); margin-bottom: 12px;">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <h3 style="font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 4px;">まだ回答がありません</h3>
          <p style="font-size: 12.5px; color: var(--text-muted); max-width: 380px;">ChatGPT / Geminiタブで質問を送信するか、下の入力欄からキューに追加すると、回答結果および会話履歴がここにリアルタイム表示されます。</p>
        </div>
      `;
    }

    let html = '';

    const displayTurns = (singleChatHistoryMode === 'latest' && turns.length > 1) ? turns.slice(-1) : turns;
    displayTurns.forEach(qa => { html += buildTurnHtml(qa, t, qa === turns[turns.length - 1], 'single'); });

    return html;
  }

  function bindSingleAnswersEvents() {
    bindTurnCopyButtons(singleAnswersArea);
  }

  // --------------------------------------------------------------------------
  // Single Chat Composer: Event Bindings with Complete IME Protection
  // --------------------------------------------------------------------------
  let isSingleComposing = false;

  const submitSingleAdd = () => {
    if (!selectedTabId) return;
    if (modelRequests.has(selectedTabId)) {
      showToast('モデルの確認が終わってからキューに追加してください。');
      return;
    }
    const text = singleChatInput.value.trim();
    if (text) {
      const t = cachedTabsData.get(selectedTabId);
      const modelData = getModelAndEffortData(t);
      const model = selectedModelOverride[selectedTabId] || modelData?.activeModelId || (singleModelSelect ? singleModelSelect.value : 'auto');
      const effort = selectedEffortOverride[selectedTabId] || modelData?.activeEffortId || (singleEffortSelect ? singleEffortSelect.value : 'auto');
      if (!sendRemoteCommand(selectedTabId, { action: 'ENQUEUE', text, model, effort, tools: singleToolInput.getTools() })) return;
      if (singleBtnSend) {
        singleBtnSend.classList.add('sent');
        setTimeout(() => singleBtnSend.classList.remove('sent'), 350);
      }
      singleChatInput.value = '';
      fitSingleInput();
      tabInputDrafts.delete(selectedTabId);
      singleToolInput.clear();
      showToast('キューに追加しました');
      singleChatInput.focus();
    }
  };

  if (singleModelSelect) {
    singleModelSelect.addEventListener('change', () => {
      const isReasoning = singleModelSelect.value.startsWith('o');
      if (singleEffortGroup) {
        singleEffortGroup.style.opacity = isReasoning ? '1' : '0.6';
      }
    });
  }

  singleChatInput.addEventListener('input', () => {
    if (selectedTabId) {
      tabInputDrafts.set(selectedTabId, singleChatInput.value);
    }
    fitSingleInput();
  });

  // Composers float over their answers (position: absolute); the answers end with a spacer of the
  // composer's height (--composer-h, set on the composer's parent) so the last turn can scroll clear of it.
  function observeComposer(el) {
    if (!el || !window.ResizeObserver) return;
    composerObserver ||= new ResizeObserver(entries => {
      for (const { target } of entries) {
        target.parentElement?.style.setProperty('--composer-h', `${target.offsetHeight}px`);
      }
    });
    composerObserver.observe(el);
  }

  // Empty inputs stay one line (the placeholder is not measured); typed text grows up to max.
  function fitInput(el, max) {
    el.style.height = '';
    if (el.value) el.style.height = Math.min(max, el.scrollHeight) + 'px';
  }

  function fitSingleInput() {
    fitInput(singleChatInput, 160);
  }

  observeComposer(document.querySelector('#view-single-chat .cgq-chat-composer-container'));
  bindOlderTurns(singleChatBody, singleAnswersArea, () => selectedTabId, 'single');

  singleChatInput.addEventListener('compositionstart', () => {
    isSingleComposing = true;
  });

  singleChatInput.addEventListener('compositionend', () => {
    isSingleComposing = false;
    if (selectedTabId) {
      tabInputDrafts.set(selectedTabId, singleChatInput.value);
    }
  });

  singleChatInput.addEventListener('keydown', (e) => {
    if (isSingleComposing || e.isComposing || e.keyCode === 229) return;
    const isEnter = e.key === 'Enter';
    const hasCtrlOrMeta = e.ctrlKey || e.metaKey;

    if (hasCtrlOrMeta && isEnter) {
      e.preventDefault();
      submitSingleAdd();
      return;
    }

    if (isEnter && !e.shiftKey) {
      if (currentSettings.enterToQueue === false) {
        // enterToQueue が OFF の場合は Enter で改行を許容（複数行の長文・命令入力をスムーズに行えるようにする）
        return;
      }
      e.preventDefault();
      submitSingleAdd();
    }
  });

  singleBtnSend.addEventListener('click', submitSingleAdd);

  // --------------------------------------------------------------------------
  // Mode 2: Multi-Chat Parallel Grid Mode (横並び並列表示モード)
  // --------------------------------------------------------------------------
  function renderGridMode(tabs) {
    const now = Date.now();
    const count = tabs.length;

    // Column widths come from CSS (.cgq-tabs-grid: equal share, --card-min-width minimum).

    const existingCards = {};
    tabsGrid.querySelectorAll('.cgq-tab-card').forEach(card => {
      if (card.dataset.tabId) existingCards[card.dataset.tabId] = card;
    });

    tabs.forEach((t, targetIndex) => {
      let card = existingCards[t.tabId];
      if (card) {
        updateExistingCard(card, t, now);
        delete existingCards[t.tabId];
      } else {
        card = createCardElement(t, now);
      }

      if (tabsGrid.children[targetIndex] !== card) {
        tabsGrid.insertBefore(card, tabsGrid.children[targetIndex] || null);
      }
    });

    for (const tid in existingCards) {
      const deadCard = existingCards[tid];
      const textarea = deadCard.querySelector('.cgq-dash-prompt-input');
      if (textarea && (document.activeElement === textarea || (textarea.value && textarea.value.trim().length > 0))) {
        continue;
      }
      cardToolInputs.get(deadCard)?.destroy?.();
      deadCard.remove();
    }
  }

  function connectionHelp(t) {
    const platform = t.platform === 'gemini' ? 'Gemini' : 'ChatGPT';
    const reloadBtn = t.chromeTabId ? `
      <div style="margin-top: 10px;">
        <button type="button" class="cgq-btn secondary sm btn-reconnect-tab" data-chrome-tab-id="${t.chromeTabId}" style="display: inline-flex; align-items: center; gap: 6px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"></path>
          </svg>
          ページを再読み込みして接続
        </button>
      </div>` : '';
    return `<div class="cgq-connection-help-box"><p class="cgq-connection-help">${platform}のタブを開いてページを再読み込みしてください。接続後に回答とキューが表示されます。</p>${reloadBtn}</div>`;
  }

  function updateCardConnection(card, t) {
    const tabId = t.tabId;
    card.querySelectorAll('.cgq-dash-prompt-input, .btn-add-prompt, .btn-toggle-pause, .btn-clear-queue, .card-model-pill')
      .forEach(el => { el.disabled = !!t.needsConnection; });
    const input = card.querySelector('.cgq-dash-prompt-input');
    let toolInput = cardToolInputs.get(card);
    if (!toolInput && input) {
      toolInput = CGQComposerTools.attach(input, {
        query: (marker, query) => queryComposerOptions(tabId, marker, query),
        scope: () => tabId, drafts: toolDrafts
      });
      cardToolInputs.set(card, toolInput);
    } else if (toolInput) {
      toolInput.sync();
    }
    if (input) input.placeholder = t.needsConnection ? '対象タブを再読み込みして接続してください' : 'キューに追加 (Enter)';
  }

  function createCardElement(t, now) {
    const card = document.createElement('div');
    card.className = 'cgq-tab-card';
    card.id = `card-${t.tabId}`;
    card.dataset.tabId = t.tabId;
    card.dataset.platform = t.platform === 'gemini' ? 'gemini' : 'chatgpt';

    const items = Array.isArray(t.items) ? t.items : [];
    const { dotClass, statusLabel, isStreaming } = getStatusInfo(t);
    const isGemini = t.platform === 'gemini';
    const platformName = isGemini ? 'Gemini' : 'ChatGPT';

    const modelData = getModelAndEffortData(t);
    const { activeModelId, models, curModelEntry, supportsEffort, efforts, curEffortEntry } = modelData;


    card.innerHTML = `
      <div class="cgq-tab-card-header">
        <div class="cgq-tab-info">
          <span class="cgq-tab-title" title="${escapeHtml(cleanTabTitle(t.title, t.platform))}">${escapeHtml(cleanTabTitle(t.title, t.platform))}</span>
          <div class="cgq-tab-status-pill ${dotClass}">
            <span class="cgq-stat-dot"></span>
            <span>${statusLabel}</span>
          </div>
          <div class="cgq-tab-model-pill sm ${(!isGemini && t.model && t.model.startsWith('o')) || (isGemini && /thinking|思考/i.test(t.model || '')) ? 'reasoning' : ''}" title="現在のモデル">
            ${escapeHtml(t.modelLabel || 'Auto')}${t.effort && t.effort !== 'auto' ? ` [${escapeHtml(formatEffortBadge(t.effort, t.effortLabel))}]` : ''}
          </div>
        </div>
        <div class="cgq-tab-card-actions">
          <button class="cgq-icon-btn sm btn-open-single" data-tab-id="${t.tabId}" title="個別チャット表示に切り替え" aria-label="個別チャット表示に切り替え">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            
          </button>
          ${t.chromeTabId ? `
            <button class="cgq-icon-btn sm btn-focus-tab" data-chrome-tab-id="${t.chromeTabId}" title="このチャットタブを開く">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
            </button>
            <button class="cgq-icon-btn sm btn-reload-tab" data-chrome-tab-id="${t.chromeTabId}" title="このチャットタブを再読み込み">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"></path>
              </svg>
            </button>
          ` : ''}
          <button class="cgq-icon-btn sm btn-toggle-pause" title="${t.isPaused ? '再開' : '一時停止'}">
            ${t.isPaused ? `
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
            ` : `
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="6" y="4" width="4" height="16"></rect>
                <rect x="14" y="4" width="4" height="16"></rect>
              </svg>
            `}
          </button>
        </div>
      </div>

      <div class="cgq-tab-activity-slot">
        ${buildActivityHtml(t)}
      </div>

      <div class="cgq-tab-view active" data-view="results">
        ${buildResultsHtml(t)}
      </div>

      <div class="cgq-tab-card-footer">
        <div class="cgq-card-queue-slot">${buildQueueHtml(t)}</div>
        <div class="cgq-dash-input-row">
          <textarea class="cgq-dash-prompt-input" data-tab-id="${t.tabId}" placeholder="キューに追加 (Enter)" rows="1">${escapeHtml(tabInputDrafts.get(t.tabId) || '')}</textarea>
          <div class="cgq-composer-actions">
            <div class="cgq-card-composer-toolbar">
              <div class="cgq-dropdown-wrapper">
                <button type="button" class="cgq-chatgpt-pill-btn sm card-model-pill" data-tab-id="${t.tabId}" aria-haspopup="menu" aria-expanded="false" title="モデルと思考レベルを選択">
                  <span class="cgq-pill-icon-box">${getModelIconSvg(activeModelId)}</span>
                  <span class="cgq-pill-label card-model-label">${escapeHtml(curModelEntry.label)}</span>
                  <span class="cgq-pill-label cgq-pill-sub card-effort-label">${supportsEffort ? escapeHtml(curEffortEntry.label) : ''}</span>
                  <svg class="cgq-pill-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>
                <div class="cgq-chatgpt-popover card-model-popover" style="display: none;">
                  <div class="cgq-popover-section card-effort-wrapper" style="display: ${supportsEffort ? 'block' : 'none'};">
                    <div class="cgq-popover-header">思考レベル</div>
                    <div class="card-effort-popover-list"></div>
                  </div>
                  <div class="cgq-popover-header">モデル</div>
                  <div class="cgq-popover-list card-model-popover-list">
                    ${models.map(m => `
                      <div class="cgq-popover-item ${m.id === curModelEntry.id ? 'selected' : ''}" data-model-id="${escapeHtml(m.id)}" aria-disabled="${modelRequests.has(t.tabId)}">
                        <div class="cgq-popover-item-left">
                          <span class="cgq-popover-item-icon">${getModelIconSvg(m.id)}</span>
                          <div class="cgq-popover-item-content">
                            <div class="cgq-popover-item-title-row">
                              <span class="cgq-popover-item-title">${escapeHtml(m.label)}</span>
                              ${m.isReasoning ? `<span class="cgq-popover-item-badge">推論</span>` : ''}
                            </div>
                            ${m.desc ? `<span class="cgq-popover-item-desc">${escapeHtml(m.desc)}</span>` : ''}
                          </div>
                        </div>
                        ${m.id === curModelEntry.id ? `
                          <div class="cgq-popover-item-check">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                              <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                          </div>
                        ` : ''}
                      </div>
                    `).join('')}
                  </div>
                </div>
              </div>

              <!-- Card Bulk Add Button (1 prompt per line) -->
              <button type="button" class="cgq-chatgpt-pill-btn sm cgq-icon-only card-bulk-add-btn" data-tab-id="${t.tabId}" title="プロンプトを一括追加 (1行1プロンプト)" aria-label="プロンプトを一括追加">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                    <line x1="8" y1="6" x2="21" y2="6"></line>
                    <line x1="8" y1="12" x2="21" y2="12"></line>
                    <line x1="8" y1="18" x2="21" y2="18"></line>
                    <line x1="3" y1="6" x2="3.01" y2="6"></line>
                    <line x1="3" y1="12" x2="3.01" y2="12"></line>
                    <line x1="3" y1="18" x2="3.01" y2="18"></line>
                  </svg>
                </button>
            </div>
            <button class="btn-add-prompt" title="このタブのキューに追加 (Enter)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="12" y1="19" x2="12" y2="5"></line>
                <polyline points="5 12 12 5 19 12"></polyline>
              </svg>
            </button>
          </div>
        </div>
        <div class="cgq-dash-card-toolbar">
          <span class="cgq-tab-sync-time" style="font-size: 11px; color: var(--text-muted);">
            同期: ${new Date(t.lastHeartbeat || now).toLocaleTimeString()}
          </span>
          <button class="cgq-text-btn danger btn-clear-queue" style="display: ${items.length > 0 ? 'inline-block' : 'none'};">
            キューをクリア
          </button>
        </div>
      </div>
    `;

    card.dataset.queueSig = getQueueSig(t);
    card.dataset.answerSig = getCardAnswerSig(t);

    renderCardModelPopoverList(card, t);
    if (supportsEffort) {
      renderCardEffortPopoverList(card, t);
    }

    bindCardStaticEvents(card, t.tabId);
    bindQueueItemEvents(card, t.tabId);
    bindCodeBlockCopy(card);
    bindGridHistoryEvents(card, t.tabId);
    renderMermaidDiagrams(card);

    // Detail view switcher button
    const openSingleBtn = card.querySelector('.btn-open-single');
    if (openSingleBtn) {
      openSingleBtn.onclick = () => {
        selectedTabId = t.tabId;
        switchMode('single');
      };
    }

    updateCardConnection(card, t);
    observeComposer(card.querySelector('.cgq-tab-card-footer'));
    const resultsView = card.querySelector('.cgq-tab-view[data-view="results"]');
    bindOlderTurns(resultsView, resultsView, () => t.tabId, 'card');
    return card;
  }

  function updateExistingCard(card, t, now) {
    updateCardConnection(card, t);
    const tid = t.tabId;
    const { dotClass, statusLabel, isStreaming } = getStatusInfo(t);
    const isGemini = t.platform === 'gemini';
    const platformName = isGemini ? 'Gemini' : 'ChatGPT';

    // Platform Pill
    const cleanTitle = cleanTabTitle(t.title, t.platform);
    const titleEl = card.querySelector('.cgq-tab-title');
    if (titleEl && titleEl.textContent !== cleanTitle) {
      titleEl.textContent = cleanTitle;
      titleEl.title = cleanTitle;
    }

    // Status Pill
    const pillEl = card.querySelector('.cgq-tab-status-pill');
    if (pillEl) {
      pillEl.className = `cgq-tab-status-pill ${dotClass}`;
      pillEl.innerHTML = `<span class="cgq-stat-dot"></span><span>${statusLabel}</span>`;
    }

    // Model Pill
    const modelPill = card.querySelector('.cgq-tab-model-pill');
    if (modelPill) {
      const isReasoning = (!isGemini && t.model && t.model.startsWith('o')) || (isGemini && /thinking|思考/i.test(t.model || ''));
      modelPill.className = `cgq-tab-model-pill sm ${isReasoning ? 'reasoning' : ''}`;
      const effortSuffix = (t.effort && t.effort !== 'auto') ? ` [${formatEffortBadge(t.effort, t.effortLabel)}]` : '';
      modelPill.textContent = `${t.modelLabel || 'Auto'}${effortSuffix}`;
    }

    cardToolInputs.get(card)?.sync();

    // Update Card Composer Model & Effort Pill
    const cardModelData = getModelAndEffortData(t);
    if (cardModelData) {
      const { curModelEntry, supportsEffort, curEffortEntry } = cardModelData;
      const cardModelLabel = card.querySelector('.card-model-label');
      if (cardModelLabel && cardModelLabel.textContent !== curModelEntry.label) {
        cardModelLabel.textContent = curModelEntry.label;
      }
      const cardModelIconBox = card.querySelector('.card-model-pill .cgq-pill-icon-box');
      if (cardModelIconBox) {
        cardModelIconBox.innerHTML = getModelIconSvg(curModelEntry.id);
      }

      if (card.querySelector('.card-model-popover')?.style.display === 'block') {
        renderCardModelPopoverList(card, t);
      }

      const cardEffortWrapper = card.querySelector('.card-effort-wrapper');
      if (cardEffortWrapper) {
        cardEffortWrapper.style.display = supportsEffort ? 'block' : 'none';
      }
      const cardEffortLabel = card.querySelector('.card-effort-label');
      if (cardEffortLabel) {
        cardEffortLabel.textContent = supportsEffort ? curEffortEntry.label : '';
      }
    }

    // Activity slot
    updateActivityBar(card.querySelector('.cgq-tab-activity-slot .cgq-chat-activity-bar'), t);

    // Composer queue controls
    const items = Array.isArray(t.items) ? t.items : [];
    const footerClearBtn = card.querySelector('.btn-clear-queue');
    if (footerClearBtn) {
      footerClearBtn.style.display = items.length > 0 ? 'inline-block' : 'none';
    }


    // Results View Update
    const newAnswerSig = getCardAnswerSig(t);
    if (card.dataset.answerSig !== newAnswerSig) {
      card.dataset.answerSig = newAnswerSig;
      const resView = card.querySelector('.cgq-tab-view[data-view="results"]');
      if (resView) {
        const isNearBottom = resView.scrollHeight - resView.scrollTop - resView.clientHeight < 100;
        resView.innerHTML = buildResultsHtml(t);
        bindCodeBlockCopy(resView);
        bindGridHistoryEvents(card, tid);
        renderMermaidDiagrams(resView);
        if (isNearBottom) {
          resView.scrollTop = resView.scrollHeight;
        }
      }
    }

    // Composer Queue Update
    const newQueueSig = getQueueSig(t);
    if (card.dataset.queueSig !== newQueueSig) {
      card.dataset.queueSig = newQueueSig;
      const qView = card.querySelector('.cgq-card-queue-slot');
      if (qView) {
        qView.innerHTML = buildQueueHtml(t);
        bindQueueItemEvents(card, tid);
      }
    }

    // Sync time
    const syncTime = card.querySelector('.cgq-tab-sync-time');
    if (syncTime) {
      syncTime.textContent = `同期: ${new Date(t.lastHeartbeat || now).toLocaleTimeString()}`;
    }
  }

  // --------------------------------------------------------------------------
  // Markdown & HTML Builders
  // --------------------------------------------------------------------------
  function formatMarkdown(text) {
    if (!text) return '';

    // Normalize line endings
    let processed = text.replace(/\r\n/g, '\n');

    // Display math blocks $$ ... $$
    processed = processed.replace(/\$\$([\s\S]+?)\$\$/g, (m, math) => {
      return `\n<div class="cgq-math-block">${escapeHtml(math.trim())}</div>\n`;
    });

    if (window.marked && typeof window.marked.parse === 'function') {
      try {
        return CGQReferences.formatHTML(window.marked.parse(processed), document);
      } catch (err) {
        console.warn('[Dashboard] Marked parse error, falling back:', err);
      }
    }

    // High-fidelity fallback parser
    let safe = escapeHtml(processed);

    // Markdown images in fallback: ![alt](url)
    safe = safe.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => {
      return `<div class="cgq-md-image-wrapper"><a href="${src}" target="_blank" rel="noopener noreferrer" class="cgq-image-link" title="新しいタブで原寸大表示"><img src="${src}" alt="${alt || '画像'}" class="cgq-md-img" loading="lazy" /></a></div>`;
    });

    // Markdown links & citation pills in fallback: [text](url)
    safe = safe.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, txt, href) => {
      const trimmed = txt.trim();
      if (/^\[?\d+\]?$/.test(trimmed)) {
        return `<a class="cgq-citation-pill" href="${href}" target="_blank" rel="noopener noreferrer">${trimmed.replace(/^\[+|\]+$/g, '')}</a>`;
      }
      return `<a class="cgq-md-link" href="${href}" target="_blank" rel="noopener noreferrer">${txt}</a>`;
    });

    // Mermaid code blocks in fallback
    safe = safe.replace(/```(?:mermaid)?\n((?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline)[\s\S]*?)```/g, (m, code) => {
      const id = 'mermaidSvg' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
      return `<div class="cgq-mermaid-wrapper">
        <div class="cgq-mermaid-header">
          <span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
            </svg>
            ダイアグラム / 図形
          </span>
          <button class="cgq-code-copy" data-target="raw-${id}" title="コードをコピー" aria-label="コードをコピー"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>
        </div>
        <div class="cgq-mermaid-svg-container" id="${id}">
          <div class="cgq-mermaid-loading">図形を描画中...</div>
        </div>
        <pre class="cgq-mermaid-raw" style="display:none;"><code id="raw-${id}">${escapeHtml(code.trim())}</code></pre>
      </div>`;
    });

    // SVG shapes in fallback
    safe = safe.replace(/&lt;svg([\s\S]*?)&gt;([\s\S]*?)&lt;\/svg&gt;/gi, '<svg$1>$2</svg>');

    // Standard code blocks
    safe = safe.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const codeId = 'code-' + Math.random().toString(36).substring(2, 9);
      return `<div class="cgq-code-block">
        <div class="cgq-code-header">
          <span>${escapeHtml(lang || 'code')}</span>
          <button class="cgq-code-copy" data-target="${codeId}">コピー</button>
        </div>
        <pre><code id="${codeId}">${escapeHtml(code.trim())}</code></pre>
      </div>`;
    });

    safe = safe.replace(/`([^`\n]+)`/g, '<code class="cgq-inline-code">$1</code>');
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return CGQReferences.formatHTML(`<p>${safe.replace(/\n/g, '<br>')}</p>`, document);
  }

  const isActive = t => !(t.isPaused || !t.currentState || t.currentState === 'idle');

  // One element per view, updated in place so it can ease in and fade out (.is-visible in dashboard.css).
  function buildActivityHtml(t) {
    return `
      <div class="cgq-chat-activity-bar${isActive(t) ? ' is-visible' : ''}">
        <div class="cgq-activity-row">
          <span class="cgq-activity-text">${escapeHtml(t.currentAction || '処理中...')}</span>
          <span class="cgq-activity-timer">${escapeHtml(t.progressText || '')}</span>
        </div>
        <div class="cgq-progress-track"><div class="cgq-progress-fill" style="width: ${t.progressPercent || 0}%;"></div></div>
      </div>
    `;
  }

  function updateActivityBar(bar, t) {
    if (!bar) return;
    const active = isActive(t);
    const fill = bar.querySelector('.cgq-progress-fill');
    if (active && !bar.classList.contains('is-visible') && fill) {
      fill.style.transition = 'none'; // restart from 0 without animating backwards
      fill.style.width = '0%';
      void fill.offsetWidth;
      fill.style.transition = '';
    }
    bar.classList.toggle('is-visible', active);
    if (active) {
      bar.querySelector('.cgq-activity-text').textContent = t.currentAction || '処理中...';
      bar.querySelector('.cgq-activity-timer').textContent = t.progressText || '';
    }
    if (fill) fill.style.width = `${active ? t.progressPercent || 0 : 100}%`;
  }

  function buildResultsHtml(t) {
    if (t.needsConnection) return connectionHelp(t);
    const turns = getUnifiedTurns(t);
    if (turns.length === 0) return '<div class="cgq-empty-turns">まだ回答がありません</div>';
    return turns.map(qa => buildTurnHtml(qa, t, qa === turns[turns.length - 1], 'card')).join('');
  }

  // ChatGPT's activity block (measured 2026-10): a header line that shimmers while it works
  // (「思考中」 / 「3件のサイトを検索中」, later 「1m 27s考えました」), a chevron that opens the log of
  // step titles and notes, and 「スキップ」 while it is still thinking. Opening and closing follows the
  // page until the viewer toggles it here; new log lines and a changed label animate in once.
  const activityOpen = new Map();
  const activitySeen = new Set();
  const activityLabels = new Map();
  function buildActivityBlock(qa, t, pending) {
    const th = qa.thinking;
    if (!th || (!th.label && !th.log?.length)) return '';
    const key = `${t.tabId}|${turnText(qa.prompt).slice(0, 60)}`;
    const active = pending && th.active;
    const open = activityOpen.has(key) ? activityOpen.get(key) : !!th.expanded;
    const changed = activityLabels.has(key) && activityLabels.get(key) !== th.label;
    activityLabels.set(key, th.label);
    const log = (th.log || []).map((entry, i) => {
      const id = `${key}|${i}|${entry.text.slice(0, 24)}`;
      const fresh = !activitySeen.has(id);
      activitySeen.add(id);
      return entry.kind === 'step'
        ? `<div class="cgq-activity-step${fresh ? ' is-new' : ''}">${escapeHtml(entry.text)}</div>`
        : `<div class="cgq-activity-note cgq-answer-markdown${fresh ? ' is-new' : ''}">${formatMarkdown(entry.text)}</div>`;
    }).join('');
    return `
      <div class="cgq-activity${open ? ' is-open' : ''}${active ? ' is-active' : ''}" data-activity-key="${escapeHtml(key)}">
        <div class="cgq-activity-row">
          <button type="button" class="cgq-activity-header" aria-expanded="${open}">
            <span class="cgq-activity-label${changed ? ' is-changed' : ''}" data-text="${escapeHtml(th.label)}">${escapeHtml(th.label)}</span>
            <svg class="cgq-activity-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          ${active && th.canSkip ? `<button type="button" class="cgq-activity-skip" data-tab-id="${escapeHtml(String(t.tabId))}">スキップ</button>` : ''}
        </div>
        ${log ? `<div class="cgq-activity-body"><div class="cgq-activity-inner">${log}</div></div>` : ''}
      </div>`;
  }

  document.addEventListener('click', e => {
    const header = e.target.closest('.cgq-activity-header');
    if (header) {
      const block = header.closest('.cgq-activity');
      const open = !block.classList.contains('is-open');
      block.classList.toggle('is-open', open);
      header.setAttribute('aria-expanded', String(open));
      activityOpen.set(block.dataset.activityKey, open);
      return;
    }
    const skip = e.target.closest('.cgq-activity-skip');
    if (skip && sendRemoteCommand(skip.dataset.tabId, { action: 'SKIP_THINKING' })) skip.disabled = true;
  });

  // One turn, laid out like ChatGPT / Gemini: the prompt bubble, the answer, its choices and a copy
  // action under the answer. Nothing else (no turn badges or history bars).
  function buildTurnHtml(qa, t, isLatest, kind) {
    const card = kind === 'card';
    const pending = qa.isStreaming || (isLatest && ['answering', 'waiting_generation', 'typing'].includes(t.currentState));
    return `
      <div class="${card ? 'cgq-grid-turn-item' : 'cgq-answer-card'}">
        ${qa.prompt ? `
          <div class="cgq-user-prompt-row${card ? ' card-mode' : ''}">
            <div class="cgq-user-prompt-bubble${card ? ' card-mode' : ''}">${escapeHtml(qa.prompt)}</div>
          </div>` : ''}
        ${buildActivityBlock(qa, t, pending)}
        <div class="cgq-answer-markdown">
          ${qa.answer ? formatMarkdown(qa.answer) : qa.thinking ? '' : pending ? '<span class="cgq-busy-dot" role="status" aria-label="応答中"></span>' : '<p class="cgq-answer-pending">（回答なし）</p>'}
        </div>
        ${pending && qa.progress?.notice ? `<div class="cgq-thinking-notice">${escapeHtml(qa.progress.notice)}</div>` : ''}
        ${buildChoicesHtml(qa, t)}
        ${qa.answer && !qa.isStreaming ? `
          <div class="cgq-turn-actions">
            <button class="cgq-turn-btn btn-copy-turn" data-text="${escapeHtml(qa.answer)}" title="コピー" aria-label="コピー">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
          </div>` : ''}
      </div>`;
  }


  function buildQueueHtml(t) {
    const items = Array.isArray(t.items) ? t.items : [];
    const subtext = getQueueStatusSubtext(t);
    if (items.length === 0) return '';

    return `
      <div class="cgq-card-queue-panel ${isQueueCollapsed('card:' + t.tabId) ? 'is-collapsed' : ''}" data-queue-key="card:${t.tabId}">
        <div class="cgq-panel-header">
          <div class="cgq-panel-header-left">
            <button type="button" class="cgq-panel-collapse" title="キューを開閉" aria-label="キューを開閉" aria-expanded="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="6 9 12 15 18 9"></polyline></svg></button>
            <span class="cgq-panel-title">待機中のキュー</span>
            <span class="cgq-panel-badge">${items.length}</span>
            <span class="cgq-panel-subtext">${subtext}</span>
          </div>
          <div class="cgq-panel-header-right">
            ${items.length > 0 ? `
              <button class="cgq-panel-btn btn-card-clear-queue" data-tab-id="${t.tabId}" title="キューをすべてクリア">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            ` : ''}
          </div>
        </div>
        <div class="cgq-panel-list">
          ${items.length === 0 ? `
            <div style="padding: 24px 10px; font-size: 12.5px; color: var(--text-muted); text-align: center;">
              待機中のキューはありません。下の入力欄から Enter で追加できます。
            </div>
          ` : items.map(item => buildQueueItemHtml(item, t.tabId)).join('')}
        </div>
      </div>
    `;
  }

  function getQueueSig(t) {
    if (!t) return '';
    const items = Array.isArray(t.items) ? t.items : [];
    const itemsSig = items.map(it => `${it.id}:${it.text}:${it.model || ''}:${it.effort || ''}:${JSON.stringify(it.tools || [])}`).join('|');
    const subtext = getQueueStatusSubtext(t);
    return `${subtext}::${items.length}::${itemsSig}`;
  }

  const choiceSig = qa => (qa.choices || []).map(g => `${g.key}${g.done ? '#' : ''}${g.options.findIndex(o => o.checked)}`).join(',');

  function getAnswerSig(t) {
    const turns = getUnifiedTurns(t);
    const a = t.latestAnswer || {};
    const turnSummary = turns.map(tr => `${tr.turn}:${tr.prompt?.length || 0}:${tr.answer?.length || 0}:${tr.isStreaming ? 1 : 0}:${choiceSig(tr)}:${tr.thinking?.label || ''}:${tr.thinking?.log?.length || 0}:${tr.thinking?.active ? 1 : 0}:${tr.thinking?.expanded ? 1 : 0}`).join('|');
    const last = turns.length > 0 ? turns[turns.length - 1] : {};
    return `${t.tabId}::${!!t.needsConnection}::${turns.length}::${singleChatHistoryMode}::${a.isStreaming ? '1' : '0'}::${turnSummary}::${last.answer || ''}::${last.prompt || ''}::${last.progress?.label || ''}|${last.progress?.notice || ''}`;
  }

  function getCardAnswerSig(t) {
    const turns = getUnifiedTurns(t);
    const a = t.latestAnswer || {};
    const turnSummary = turns.map(tr => `${tr.turn}:${tr.prompt?.length || 0}:${tr.answer?.length || 0}:${tr.isStreaming ? 1 : 0}:${choiceSig(tr)}:${tr.thinking?.label || ''}:${tr.thinking?.log?.length || 0}:${tr.thinking?.active ? 1 : 0}:${tr.thinking?.expanded ? 1 : 0}`).join('|');
    const last = turns.length > 0 ? turns[turns.length - 1] : {};
    return `${t.tabId}::${!!t.needsConnection}::${turns.length}::${a.isStreaming ? '1' : '0'}::${turnSummary}::${last.answer || ''}::${last.prompt || ''}::${last.progress?.label || ''}|${last.progress?.notice || ''}`;
  }

  function bindCodeBlockCopy(container) {
    if (!container) return;
    CGQReferences.bindIcons(container);
    container.querySelectorAll('.cgq-code-copy').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const targetId = btn.dataset.target;
        const codeEl = container.querySelector('#' + targetId) || document.getElementById(targetId);
        if (codeEl) {
          navigator.clipboard?.writeText(codeEl.innerText || codeEl.textContent || '');
          btn.classList.add('copied');
          setTimeout(() => btn.classList.remove('copied'), 2000);
        }
      };
    });
  }

  function bindTurnCopyButtons(container) {
    if (!container) return;
    container.querySelectorAll('.btn-copy-turn').forEach(btn => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const text = btn.dataset.text || '';
        if (text) {
          await navigator.clipboard?.writeText(CGQReferences.plainText(text));
          showToast('回答をコピーしました');
          btn.classList.add('copied');
          const span = btn.querySelector('span');
          if (span) {
            const orig = span.textContent;
            span.textContent = '完了';
            setTimeout(() => {
              span.textContent = orig;
              btn.classList.remove('copied');
            }, 1800);
          } else {
            setTimeout(() => btn.classList.remove('copied'), 1800);
          }
        }
      };
    });
  }

  function bindGridHistoryEvents(card) {
    bindTurnCopyButtons(card);
  }


  function renderCardModelPopoverList(card, t) {
    const list = card.querySelector('.card-model-popover-list');
    if (!list) return;
    const modelData = getModelAndEffortData(t);
    if (!modelData) return;
    const { models, curModelEntry } = modelData;

    list.innerHTML = models.map(m => {
      const isSelected = (m.id === curModelEntry.id);
      return `
        <div class="cgq-popover-item ${isSelected ? 'selected' : ''}" data-model-id="${escapeHtml(m.id)}" aria-disabled="${modelRequests.has(t.tabId)}">
          <div class="cgq-popover-item-left">
            <span class="cgq-popover-item-icon">${getModelIconSvg(m.id)}</span>
            <div class="cgq-popover-item-content">
              <div class="cgq-popover-item-title-row">
                <span class="cgq-popover-item-title">${escapeHtml(m.label)}</span>
                ${m.isReasoning ? `<span class="cgq-popover-item-badge">推論</span>` : ''}
              </div>
              ${m.desc ? `<span class="cgq-popover-item-desc">${escapeHtml(m.desc)}</span>` : ''}
            </div>
          </div>
          ${isSelected ? `
            <div class="cgq-popover-item-check">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    list.insertAdjacentHTML('beforeend', buildModelCatalogFooter(t));
    bindModelCatalogActions(list, t);
  }

  // Thinking level as ChatGPT shows it: the level's name above a track with one stop per level.
  // A transparent native range on top keeps pointer and keyboard input; the visual layer
  // follows the pointer while dragging and settles on the nearest stop on release.
  const EFFORT_HOLD_MS = 4000;
  function renderEffortSlider(container, t, efforts, current, onPicked) {
    if (!container) return;
    const remoteIndex = Math.max(0, efforts.findIndex(e => e.id === current.id));
    const layout = `${t.tabId}|${efforts.map(e => e.id).join(',')}`;
    const live = container.cgqSlider;
    if (live && container.dataset.signature === layout) {
      // Same slider: move it in place (animated) unless the user just picked a level
      // and the page has not reported it yet.
      if (!live.busy() && Date.now() > live.holdUntil) live.moveTo(remoteIndex, true);
      return;
    }
    container.dataset.signature = layout;
    const max = efforts.length - 1;
    const name = i => efforts[i].title || efforts[i].label;
    container.innerHTML = `
      <div class="cgq-effort-slider">
        <div class="cgq-effort-value" aria-hidden="true"><span>${escapeHtml(name(remoteIndex))}</span></div>
        <div class="cgq-effort-track">
          <span class="cgq-effort-fill"></span>
          ${efforts.map((_, i) => `<span class="cgq-effort-tick" style="--at:${max ? i / max : 0}"></span>`).join('')}
          <span class="cgq-effort-thumb-rail"><span class="cgq-effort-thumb"></span></span>
          <input type="range" min="0" max="${max}" step="any" value="${remoteIndex}" aria-label="思考レベル">
        </div>
        <div class="cgq-effort-stops" aria-hidden="true">${efforts.map((e, i) => `<span style="--at:${max ? i / max : 0}">${escapeHtml(e.label)}</span>`).join('')}</div>
      </div>`;
    const root = container.querySelector('.cgq-effort-slider');
    const input = root.querySelector('input');
    const value = root.querySelector('.cgq-effort-value');
    const ticks = [...root.querySelectorAll('.cgq-effort-tick')];
    const stops = [...root.querySelectorAll('.cgq-effort-stops span')];
    let shown = remoteIndex;
    let index = remoteIndex;
    let dragging = false;
    let commitTimer = null;
    let pendingCommit = false;
    let committedId = efforts[remoteIndex].id;
    const calm = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const paint = (pos, animate) => {
      root.classList.toggle('is-instant', !animate);
      root.style.setProperty('--pos', max ? pos / max : 0);
      ticks.forEach((tick, i) => {
        tick.classList.toggle('is-covered', i < pos - 0.05);
        tick.classList.toggle('is-hidden', Math.abs(i - pos) < 0.35);
      });
      const near = Math.round(pos);
      stops.forEach((stop, i) => stop.classList.toggle('is-active', i === near));
      if (near !== shown) {
        const dir = near > shown ? 1 : -1;
        shown = near;
        const label = value.firstElementChild;
        label.textContent = name(near);
        if (!calm) label.animate?.([
          { opacity: 0, transform: `translateX(${dir * 6}px)` },
          { opacity: 1, transform: 'none' }
        ], { duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
      }
      input.setAttribute('aria-valuetext', name(near));
    };

    const commit = () => {
      clearTimeout(commitTimer);
      pendingCommit = true;
      commitTimer = setTimeout(() => {
        pendingCommit = false;
        const effort = efforts[index];
        if (effort.id === committedId) return;
        committedId = effort.id;
        selectedEffortOverride[t.tabId] = effort.id;
        cardModelSelections[t.tabId] = { model: selectedModelOverride[t.tabId] || t.model || 'auto', effort: effort.id };
        sendRemoteCommand(t.tabId, { action: 'SWITCH_EFFORT', effort: effort.id });
        showToast(`思考レベルを ${name(index)} に設定しました`);
        onPicked?.();
      }, 350); // rapid arrow presses send only the level they end on
    };

    const moveTo = (i, animate) => {
      index = Math.min(max, Math.max(0, i));
      input.value = index;
      paint(index, animate);
    };
    const pick = i => {
      container.cgqSlider.holdUntil = Date.now() + EFFORT_HOLD_MS;
      moveTo(i, true);
      commit();
    };

    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('pointerdown', () => { dragging = true; root.classList.add('is-pressed'); });
    input.addEventListener('input', () => paint(Number(input.value), !dragging));
    const release = () => {
      if (!dragging) return;
      dragging = false;
      root.classList.remove('is-pressed');
      pick(Math.round(Number(input.value)));
    };
    input.addEventListener('pointerup', release);
    input.addEventListener('pointercancel', release);
    input.addEventListener('change', () => { if (!dragging) pick(Math.round(Number(input.value))); });
    input.addEventListener('keydown', e => {
      const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      const to = e.key === 'Home' ? 0 : e.key === 'End' ? max : step === undefined ? null : index + step;
      if (to === null) return;
      e.preventDefault();
      pick(to);
    });

    container.cgqSlider = {
      moveTo: (i, animate) => { committedId = efforts[i].id; moveTo(i, animate); },
      busy: () => dragging || pendingCommit,
      holdUntil: 0
    };
    paint(remoteIndex, false);
  }

  function renderCardEffortPopoverList(card, t) {
    const modelData = getModelAndEffortData(t);
    if (!modelData) return;
    renderEffortSlider(card.querySelector('.card-effort-popover-list'), t, modelData.efforts, modelData.curEffortEntry,
      () => updateExistingCard(card, cachedTabsData.get(t.tabId) || t, Date.now()));
  }

  function bindCardStaticEvents(card, tabId) {
    const focusBtn = card.querySelector('.btn-focus-tab');
    if (focusBtn) {
      focusBtn.onclick = () => {
        const chromeTabId = parseInt(focusBtn.dataset.chromeTabId, 10);
        if (chromeTabId) chrome.runtime.sendMessage({ action: 'FOCUS_TAB', chromeTabId });
      };
    }

    const reloadBtn = card.querySelector('.btn-reload-tab');
    if (reloadBtn) {
      reloadBtn.onclick = () => {
        const chromeTabId = parseInt(reloadBtn.dataset.chromeTabId, 10);
        if (chromeTabId) {
          chrome.runtime.sendMessage({ action: 'RELOAD_CHAT_TAB', chromeTabId });
          showToast('タブを再読み込みしています...');
        }
      };
    }

    const pauseBtn = card.querySelector('.btn-toggle-pause');
    if (pauseBtn) {
      pauseBtn.onclick = () => sendRemoteCommand(tabId, { action: 'TOGGLE_PAUSE' });
    }

    const clearBtn = card.querySelector('.btn-clear-queue');
    if (clearBtn) {
      clearBtn.onclick = () => {
        if (confirm('キューをクリアしますか？')) sendRemoteCommand(tabId, { action: 'CLEAR_QUEUE' });
      };
    }

    // Model and Effort popover triggers
    const modelPillBtn = card.querySelector('.card-model-pill');
    const modelPopover = card.querySelector('.card-model-popover');
    if (modelPillBtn && modelPopover) {
      modelPillBtn.onclick = (e) => {
        e.stopPropagation();
        const isOpen = modelPopover.style.display === 'block';
        closeAllPopovers();
        if (!isOpen) {
          const t = cachedTabsData.get(tabId);
          if (t) {
            renderCardModelPopoverList(card, t);
            renderCardEffortPopoverList(card, t);
          }
          modelPopover.style.display = 'block';
          modelPillBtn.setAttribute('aria-expanded', 'true');
          if (t) refreshServiceModels(t);
        }
      };
    }

    const input = card.querySelector('.cgq-dash-prompt-input');
    const toolInput = CGQComposerTools.attach(input, {
      query: (marker, query) => queryComposerOptions(tabId, marker, query),
      scope: () => tabId, drafts: toolDrafts
    });
    cardToolInputs.set(card, toolInput);
    const addBtn = card.querySelector('.btn-add-prompt');
    let isComposing = false;

    const submitAdd = () => {
      if (modelRequests.has(tabId)) {
        showToast('モデルの確認が終わってからキューに追加してください。');
        return;
      }
      const text = input.value.trim();
      if (text) {
        const t = cachedTabsData.get(tabId);
        const modelData = getModelAndEffortData(t);
        const model = selectedModelOverride[tabId] || cardModelSelections[tabId]?.model || modelData?.activeModelId || 'auto';
        const effort = selectedEffortOverride[tabId] || cardModelSelections[tabId]?.effort || modelData?.activeEffortId || 'auto';
        if (!sendRemoteCommand(tabId, { action: 'ENQUEUE', text, model, effort, tools: toolInput.getTools() })) return;
        if (addBtn) {
          addBtn.classList.add('sent');
          setTimeout(() => addBtn.classList.remove('sent'), 350);
        }
        input.value = '';
        fitInput(input, 100);
        tabInputDrafts.delete(tabId);
        toolInput.clear();
        showToast('キューに追加しました');
        input.focus();
      }
    };

    if (input) {
      input.addEventListener('input', () => {
        tabInputDrafts.set(tabId, input.value);
        fitInput(input, 100);
      });
      input.addEventListener('compositionstart', () => { isComposing = true; });
      input.addEventListener('compositionend', () => {
        isComposing = false;
        tabInputDrafts.set(tabId, input.value);
      });
      input.addEventListener('keydown', (e) => {
        if (isComposing || e.isComposing || e.keyCode === 229) return;
        const isEnter = e.key === 'Enter';
        const hasCtrlOrMeta = e.ctrlKey || e.metaKey;

        if (hasCtrlOrMeta && isEnter) {
          e.preventDefault();
          submitAdd();
          return;
        }

        if (isEnter && !e.shiftKey) {
          if (currentSettings.enterToQueue === false) {
            // enterToQueue が OFF の場合は Enter で改行を許容（複数行の長文・命令入力をスムーズに行えるようにする）
            return;
          }
          e.preventDefault();
          submitAdd();
        }
      });
    }

    if (addBtn) addBtn.onclick = submitAdd;
  }

  function bindQueueItemEvents(card, tabId) {
    if (!card) return;
    card.querySelectorAll('.cgq-item-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const itemId = btn.dataset.id;
        const act = btn.dataset.action;
        if (act === 'send-now') {
          sendRemoteCommand(tabId, { action: 'SEND_IMMEDIATELY', id: itemId });
        } else if (act === 'delete') {
          sendRemoteCommand(tabId, { action: 'REMOVE_ITEM', id: itemId });
        }
      };
    });

    const clearBtn = card.querySelector('.btn-card-clear-queue');
    if (clearBtn) {
      clearBtn.onclick = (e) => {
        e.stopPropagation();
        if (confirm('キュー内のすべてのプロンプトを消去しますか？')) {
          sendRemoteCommand(tabId, { action: 'CLEAR_QUEUE' });
        }
      };
    }
  }

  // Returns false when the command was not sent, so the caller keeps the user's input.
  // Choice widgets from the answer (radio options + submit button): choose here, applied in the tab.
  function buildChoicesHtml(qa, t) {
    if (!Array.isArray(qa.choices) || !qa.choices.length) return '';
    return qa.choices.map((group, g) => {
      const name = `cgq-choice-${t.tabId}-${qa.turn}-${g}`;
      return `
        <form class="cgq-choice" data-tab-id="${escapeHtml(t.tabId)}" data-key="${escapeHtml(group.key)}">
          ${group.options.map((option, i) => `
            <label class="cgq-choice-option">
              <input type="radio" name="${escapeHtml(name)}" value="${i}" ${option.checked ? 'checked' : ''} ${group.done ? 'disabled' : ''}>
              <span class="cgq-choice-text">
                <span class="cgq-choice-label">${escapeHtml(option.label)}</span>
                ${option.desc ? `<span class="cgq-choice-desc">${escapeHtml(option.desc)}</span>` : ''}
              </span>
            </label>
          `).join('')}
          ${group.submitLabel ? `<button type="submit" class="cgq-btn primary cgq-choice-submit" ${group.done ? 'disabled' : ''}>${escapeHtml(group.submitLabel)}</button>` : ''}
        </form>
      `;
    }).join('');
  }

  document.addEventListener('submit', e => {
    const form = e.target.closest?.('.cgq-choice');
    if (!form) return;
    e.preventDefault();
    const picked = form.querySelector('input[type="radio"]:checked');
    if (!picked) return showToast('選択肢を選んでください');
    if (sendRemoteCommand(form.dataset.tabId, { action: 'CHOOSE_OPTION', key: form.dataset.key, option: Number(picked.value) })) {
      form.querySelectorAll('input, button').forEach(el => { el.disabled = true; });
    }
  });

  function sendRemoteCommand(tabId, command) {
    if (cachedTabsData.get(tabId)?.needsConnection) {
      showToast('対象タブを再読み込みして接続してください。');
      return false;
    }
    const key = `cgq_cmd_${tabId}`;
    // A unique nonce makes every command a real change, so identical prompts are not dropped by storage
    const payload = { ...command, nonce: `${Date.now()}_${Math.random().toString(36).slice(2)}` };
    Promise.resolve(chrome.storage.local.set({ [key]: payload })).catch(error => {
      showToast(`キューに追加できませんでした: ${error?.message || error}`);
    });
    setTimeout(refreshDashboard, 200);
    return true;
  }

  function escapeHtml(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return str.replace(/[&<>"']/g, m => map[m]);
  }

  // Global Actions (New Chat Buttons)
  const openNewChatGPT = () => {
    chrome.runtime.sendMessage({ action: 'CREATE_CHATGPT_TAB' });
  };
  const openNewGemini = () => {
    chrome.runtime.sendMessage({ action: 'CREATE_GEMINI_TAB' });
  };

  // "+" opens a small menu to choose ChatGPT or Gemini.
  if (btnSidebarNewChat) {
    const newChatMenu = document.getElementById('sidebar-new-chat-menu');
    btnSidebarNewChat.addEventListener('click', e => {
      e.stopPropagation();
      if (newChatMenu) newChatMenu.hidden = !newChatMenu.hidden;
      else openNewChatGPT();
    });
    newChatMenu?.querySelectorAll('button[data-platform]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      newChatMenu.hidden = true;
      if (btn.dataset.platform === 'gemini') openNewGemini(); else openNewChatGPT();
    }));
    document.addEventListener('click', () => { if (newChatMenu) newChatMenu.hidden = true; });
  }

  const btnGridNewChatgpt = document.getElementById('btn-grid-new-chatgpt');
  const btnGridNewGemini = document.getElementById('btn-grid-new-gemini');
  const btnEmptyOpenChatgpt = document.getElementById('btn-empty-open-chatgpt');
  const btnEmptyOpenGemini = document.getElementById('btn-empty-open-gemini');

  if (btnGridNewChatgpt) btnGridNewChatgpt.addEventListener('click', openNewChatGPT);
  if (btnGridNewGemini) btnGridNewGemini.addEventListener('click', openNewGemini);
  if (btnEmptyOpenChatgpt) btnEmptyOpenChatgpt.addEventListener('click', openNewChatGPT);
  if (btnEmptyOpenGemini) btnEmptyOpenGemini.addEventListener('click', openNewGemini);

  // --------------------------------------------------------------------------
  // Bulk Prompt Insertion Modal (1 prompt per line)
  // --------------------------------------------------------------------------
  const bulkModal = document.getElementById('dashboard-bulk-modal');
  const bulkTargetSelect = document.getElementById('bulk-modal-target-tab');
  const bulkDelimSelect = document.getElementById('bulk-modal-delimiter');
  const bulkTextarea = document.getElementById('bulk-modal-textarea');
  const bulkCounter = document.getElementById('bulk-modal-counter');
  const bulkSubmitBtn = document.getElementById('bulk-modal-submit');
  const bulkCancelBtn = document.getElementById('bulk-modal-cancel');
  const bulkCloseBtn = document.getElementById('bulk-modal-close');
  const singleBulkAddBtn = document.getElementById('single-btn-bulk-add');
  const navBulkAdd = document.getElementById('nav-bulk-add');

  function getBulkPrompts() {
    if (!bulkTextarea || !bulkDelimSelect) return [];
    const text = bulkTextarea.value || '';
    const delim = bulkDelimSelect.value;
    let items = [];
    if (delim === 'line') {
      items = text.split('\n');
    } else if (delim === 'empty_line') {
      items = text.split(/\n\s*\n/);
    } else if (delim === 'hyphens') {
      items = text.split(/^---$/m);
    }
    return items.map(s => s.trim()).filter(Boolean);
  }

  function updateBulkCounter() {
    if (!bulkCounter || !bulkSubmitBtn) return;
    const count = getBulkPrompts().length;
    bulkCounter.textContent = `${count}件検出`;
    bulkSubmitBtn.textContent = count > 0 ? `一括追加する (${count}件)` : '一括追加する';
  }

  function openBulkModal(defaultTabId = null) {
    if (!bulkModal || !bulkTargetSelect) return;
    const tabs = Array.from(cachedTabsData.values());
    if (tabs.length === 0) {
      showToast('開いているチャットタブが見つかりません');
      return;
    }
    bulkTargetSelect.innerHTML = tabs.map(t => {
      const title = cleanTabTitle(t.title, t.platform);
      const isSel = (defaultTabId && t.tabId === defaultTabId) || (!defaultTabId && t.tabId === selectedTabId);
      return `<option value="${escapeHtml(t.tabId)}" ${isSel ? 'selected' : ''}>${escapeHtml(title)} (${t.platform === 'gemini' ? 'Gemini' : 'ChatGPT'})</option>`;
    }).join('') + (tabs.length > 1 ? '<option value="__ALL__">【全チャットタブに一括追加】</option>' : '');

    bulkModal.style.display = 'flex';
    updateBulkCounter();
    setTimeout(() => bulkTextarea?.focus(), 60);
  }

  function closeBulkModal() {
    if (bulkModal) bulkModal.style.display = 'none';
  }

  if (singleBulkAddBtn) {
    singleBulkAddBtn.addEventListener('click', () => openBulkModal(selectedTabId));
  }
  if (navBulkAdd) {
    navBulkAdd.addEventListener('click', () => openBulkModal(selectedTabId));
  }

  document.addEventListener('click', (e) => {
    const cardBulkBtn = e.target.closest && e.target.closest('.card-bulk-add-btn');
    if (cardBulkBtn) {
      const tabId = cardBulkBtn.dataset.tabId;
      openBulkModal(tabId);
    }
  });

  if (bulkCloseBtn) bulkCloseBtn.addEventListener('click', closeBulkModal);
  if (bulkCancelBtn) bulkCancelBtn.addEventListener('click', closeBulkModal);
  if (bulkModal) {
    bulkModal.addEventListener('click', (e) => {
      if (e.target === bulkModal) closeBulkModal();
    });
  }

  if (bulkTextarea) {
    bulkTextarea.addEventListener('input', updateBulkCounter);
    bulkTextarea.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        bulkSubmitBtn?.click();
      }
    });
  }
  if (bulkDelimSelect) {
    bulkDelimSelect.addEventListener('change', updateBulkCounter);
  }

  if (bulkSubmitBtn) {
    bulkSubmitBtn.addEventListener('click', async () => {
      const prompts = getBulkPrompts();
      if (prompts.length === 0) {
        showToast('追加するプロンプトが見つかりませんでした');
        return;
      }
      const targetTabId = bulkTargetSelect?.value;
      if (!targetTabId) return;

      if (targetTabId === '__ALL__') {
        const tabs = Array.from(cachedTabsData.values());
        for (const t of tabs) {
          sendRemoteCommand(t.tabId, { action: 'ENQUEUE_MANY', texts: prompts });
        }
        showToast(`${tabs.length}個のチャットに各${prompts.length}件のプロンプトを一括追加しました`);
      } else {
        sendRemoteCommand(targetTabId, { action: 'ENQUEUE_MANY', texts: prompts });
        showToast(`${prompts.length}件のプロンプトを一括追加しました`);
      }
      if (bulkTextarea) bulkTextarea.value = '';
      closeBulkModal();
    });
  }

  // Storage listener & auto refresh
  refreshDashboard();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes[STORAGE_KEY_REGISTRY]) {
        currentRegistry = changes[STORAGE_KEY_REGISTRY].newValue || {};
        updateDashboard();
      }
      if (changes[STORAGE_KEY_SETTINGS]) {
        currentSettings = changes[STORAGE_KEY_SETTINGS].newValue || {};
        if (currentMode === 'settings') {
          renderSettingsView();
        }
      }
    }
  });

  setInterval(refreshDashboard, 1500);
});
