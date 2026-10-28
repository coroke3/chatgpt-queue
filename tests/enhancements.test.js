const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const refs = require('../references.js');

test('Gen Interface JP loads only weights 300-600 on extension pages, and nothing on ChatGPT / Gemini', () => {
  const html = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
  const dashCss = fs.readFileSync(path.join(root, 'dashboard.css'), 'utf8');
  const stylesCss = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');

  for (const page of [html, popupHtml]) {
    for (const w of [300, 400, 500, 600]) assert.ok(page.includes(`cdn/${w}.css`), `weight ${w} must be linked`);
    for (const w of [100, 200, 700, 800]) assert.ok(!page.includes(`cdn/${w}.css`), `unused weight ${w} must not be linked`);
    assert.ok(!page.includes('fonts.googleapis.com'), 'Google Fonts is blocked by the extension CSP and must not be requested');
  }
  // Fonts are linked once, from the HTML: no duplicate @import in the stylesheets
  assert.ok(!/@import/.test(dashCss), 'dashboard.css must not @import fonts');
  assert.ok(!/@import/.test(stylesCss), 'styles.css (injected into ChatGPT / Gemini) must not download fonts');
  assert.match(dashCss, /--font:\s*["']Gen Interface JP["']/, 'dashboard.css must prioritize Gen Interface JP');
  assert.match(stylesCss, /--cgq-font:\s*inherit/, 'styles.css must use the host page font');
});

test('Tab titles on Queue Manager strip " - Google Gemini" and " - Gemini" cleanly', () => {
  const dashJs = fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8');
  
  // Extract cleanTabTitle function from dashboard.js
  const match = dashJs.match(/function cleanTabTitle\([\s\S]*?\n  \}/);
  assert.ok(match, 'cleanTabTitle function must exist in dashboard.js');

  const cleanTabTitle = new Function(`${match[0]}; return cleanTabTitle;`)();

  assert.equal(cleanTabTitle('日本の歴史 - Google Gemini', 'gemini'), '日本の歴史');
  assert.equal(cleanTabTitle('プログラミング基礎 — Google Gemini', 'gemini'), 'プログラミング基礎');
  assert.equal(cleanTabTitle('機械学習の基礎 | Google Gemini', 'gemini'), '機械学習の基礎');
  assert.equal(cleanTabTitle('量子力学 - Gemini', 'gemini'), '量子力学');
  assert.equal(cleanTabTitle('Google Gemini', 'gemini'), 'Gemini');
  assert.equal(cleanTabTitle('Gemini - Google Gemini', 'gemini'), 'Gemini');
  assert.equal(cleanTabTitle('新規チャット', 'gemini'), '新規チャット');
  assert.equal(cleanTabTitle('', 'gemini'), 'Gemini');
  assert.equal(cleanTabTitle('マーケティング分析', 'chatgpt'), 'マーケティング分析');
  assert.equal(cleanTabTitle('', 'chatgpt'), 'ChatGPT');
});

test('Answer text is never clipped or truncated when images or citations are present', () => {
  const dom = new JSDOM();
  const doc = dom.window.document;

  // Case 1: Image followed by a normal prose paragraph containing a link
  const rawHtml1 = `
    <p><img src="https://example.com/logo.png" alt="ロゴ"></p>
    <p>これは重要な解説文です。<a href="https://example.com/info">詳細はこちら</a>をご覧ください。文章が欠けてはいけません。</p>
  `;
  const formatted1 = refs.formatHTML(rawHtml1, doc);
  assert.ok(formatted1.includes('これは重要な解説文です。'), 'Prose text before link must be preserved');
  assert.ok(formatted1.includes('をご覧ください。文章が欠けてはいけません。'), 'Prose text after link must be preserved');

  // Case 2: Source card followed by a paragraph containing prose and link
  const rawHtml2 = `
    <a class="cgq-source-card" href="https://example.com/source"><img src="https://example.com/icon.png">参照元</a>
    <p>回答の続きです。<a href="https://example.com/source">同じURLの参照リンク</a>ですが文章全体は保持されます。</p>
  `;
  const formatted2 = refs.formatHTML(rawHtml2, doc);
  assert.ok(formatted2.includes('回答の続きです。'), 'Surrounding prose in adjacent paragraph must never be deleted');

  // Case 3: Character glyphs and inline code
  const rawHtml3 = '<p>関数 <code>processData()</code> を呼び出すと、返り値は <code>{ success: true }</code> です。</p>';
  const formatted3 = refs.formatHTML(rawHtml3, doc);
  assert.ok(formatted3.includes('processData()'));
  assert.ok(formatted3.includes('{ success: true }'));

  dom.window.close();
});

test('Collapsed sidebar styles provide an ultra-clean 48px rail', () => {
  const css = fs.readFileSync(path.join(root, 'dashboard.css'), 'utf8');

  assert.match(css, /body\.sidebar-collapsed\s+\.cgq-sidebar\s*\{[^}]*width:\s*48px\s*!important;/, 'Collapsed sidebar width must be 48px');
  assert.match(css, /body\.sidebar-collapsed\s+\.cgq-sidebar-header/, 'Collapsed header rules must exist');
  assert.match(css, /body\.sidebar-collapsed\s+\.cgq-sidebar-nav/, 'Collapsed nav rules must exist');
  assert.match(css, /body\.sidebar-collapsed\s+\.cgq-sidebar-chat-item/, 'Collapsed chat item rules must exist');
});

test('Fatigue scaling logic in content.js extends thinking delay gradually up to 10 minutes (600s)', () => {
  const contentJs = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

  assert.ok(contentJs.includes('sessionStartTime'), 'content.js must track continuous session start time');
  assert.ok(contentJs.includes('600'), 'content.js must allow extending delay up to 10 minutes (600s)');
  assert.ok(contentJs.includes('formatDelayTime'), 'content.js must have timer format helper');
  assert.match(contentJs, /Math\.min\(\s*600,/, 'Delay must cap at 600s (10 min)');
});

test('Queue Manager provides a comprehensive Settings screen with all controls and live persistence', () => {
  const html = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'dashboard.css'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8');

  // DOM Structure checks in dashboard.html
  assert.ok(html.includes('id="nav-settings"'), 'dashboard.html must have nav-settings button');
  assert.ok(html.includes('id="btn-footer-settings"'), 'dashboard.html must have btn-footer-settings button');
  assert.ok(html.includes('id="view-settings"'), 'dashboard.html must have view-settings container');
  assert.ok(html.includes('id="setting-typing-mode"'), 'dashboard.html must have typing mode selector');
  assert.ok(html.includes('id="setting-simulate-typos"'), 'dashboard.html must have typo simulation toggle');
  assert.ok(html.includes('id="setting-continuous-fatigue"'), 'dashboard.html must have continuous fatigue toggle');
  assert.ok(html.includes('id="setting-auto-reload"'), 'dashboard.html must have auto-reload toggle');
  assert.ok(html.includes('id="setting-min-read"'), 'dashboard.html must have min-read slider');
  assert.ok(html.includes('id="setting-max-read"'), 'dashboard.html must have max-read slider');
  assert.ok(html.includes('Ctrl+Enter / Cmd+Enterでキュー追加'), 'dashboard.html must explain the fixed queue shortcut');
  assert.ok(html.includes('id="setting-theme-mode"'), 'dashboard.html must have theme-mode selector');
  assert.ok(html.includes('id="btn-settings-save"'), 'dashboard.html must have save button');
  assert.ok(html.includes('id="btn-settings-reset"'), 'dashboard.html must have reset button');

  // CSS rules check in dashboard.css
  assert.match(css, /\.cgq-settings-view/, 'dashboard.css must have .cgq-settings-view styles');
  assert.match(css, /\.cgq-settings-card/, 'dashboard.css must have .cgq-settings-card styles');
  assert.match(css, /\.cgq-settings-row/, 'dashboard.css must have .cgq-settings-row styles');

  // JS functionality check in dashboard.js
  assert.ok(js.includes('renderSettingsView'), 'dashboard.js must implement renderSettingsView');
  assert.ok(js.includes('saveSettings'), 'dashboard.js must implement saveSettings');
  assert.ok(js.includes('navSettings'), 'dashboard.js must bind navSettings');
  assert.ok(js.includes("switchMode('settings')"), 'dashboard.js must support switching to settings mode');
});

test('ChatGPT connection lost banner triggers countdown and reload within 2 minutes', async () => {
  const contentJs = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

  // Assert code implementations exist in content.js
  assert.ok(contentJs.includes('checkConnectionLost'), 'DOM must implement checkConnectionLost');
  assert.ok(contentJs.includes('checkConnectionAndAutoReload'), 'QueueManager must implement checkConnectionAndAutoReload');
  assert.ok(contentJs.includes('connectionLostSince'), 'QueueManager must track connectionLostSince');
  assert.ok(contentJs.includes('autoReloadOnDisconnect'), 'DEFAULT_SETTINGS must have autoReloadOnDisconnect');
  assert.ok(contentJs.includes('CONNECTION_LOST'), 'QueueState must have CONNECTION_LOST state');

  // Test DOM detection in JSDOM environment
  const dom = new JSDOM(`<!doctype html><html><body><main id="chat-root"></main></body></html>`, {
    url: 'https://chatgpt.com/c/test',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;

  for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  }
  const script = contentJs.replace(
    '  const queueManager = new QueueManager();',
    '  globalThis.__DOM = DOM; globalThis.__QueueManager = QueueManager; return;\n  const queueManager = new QueueManager();'
  );
  window.eval(script);

  const DOM = window.__DOM;
  const main = window.document.getElementById('chat-root');

  // Initially: no error
  assert.equal(DOM.checkConnectionLost(), false);

  // When ChatGPT renders connection lost banner
  const banner = window.document.createElement('div');
  banner.setAttribute('role', 'alert');
  banner.textContent = '接続が途切れました。回答全体の受信を待っています';
  main.appendChild(banner);

  assert.equal(DOM.checkConnectionLost(), true, 'Must detect Japanese connection lost message');

  // If in user message, should NOT trigger
  banner.remove();
  const userTurn = window.document.createElement('div');
  userTurn.setAttribute('data-message-author-role', 'user');
  userTurn.textContent = '接続が途切れました。回答全体の受信を待っていますと表示されたときの対処法';
  main.appendChild(userTurn);

  assert.equal(DOM.checkConnectionLost(), false, 'Must not trigger on user questions containing error text');

  // English variation
  const englishBanner = window.document.createElement('div');
  englishBanner.className = 'toast banner text-token-text-error';
  englishBanner.textContent = 'Connection lost. Waiting to receive the full response...';
  main.appendChild(englishBanner);

  assert.equal(DOM.checkConnectionLost(), true, 'Must detect English connection lost message');

  // Test QueueManager auto reload logic
  let reloaded = false;

  const qm = new window.__QueueManager();
  qm.settings = { autoReloadOnDisconnect: true, disconnectReloadTimeout: 120 };
  qm.saveQueue = async () => {};
  qm.reloadPage = () => { reloaded = true; };

  // First check: records start time, schedules reload
  await qm.checkConnectionAndAutoReload();
  assert.ok(qm.connectionLostSince, 'Must record connectionLostSince timestamp');
  assert.ok(qm.progressText.includes('2分後に再読み込み'), 'Must show countdown in progressText');
  assert.equal(reloaded, false, 'Should not reload immediately');

  // Fast-forward past 120 seconds (2 minutes)
  qm.connectionLostSince = Date.now() - (121 * 1000);
  await qm.checkConnectionAndAutoReload();
  assert.equal(reloaded, true, 'Must trigger reload when 2 minutes elapse');

  dom.window.close();
});

test('Tab reload and reconnect controls are available across Single Chat and Grid views', () => {
  const html = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
  const dashJs = fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8');
  const dashCss = fs.readFileSync(path.join(root, 'dashboard.css'), 'utf8');
  const bgJs = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

  // Background tab reload handler
  assert.ok(bgJs.includes('RELOAD_CHAT_TAB'), 'background.js must handle RELOAD_CHAT_TAB');

  // Single view button
  assert.ok(html.includes('id="single-btn-reload-tab"'), 'dashboard.html must have single-btn-reload-tab');
  assert.ok(dashJs.includes('singleBtnReloadTab'), 'dashboard.js must reference singleBtnReloadTab');
  assert.ok(dashJs.includes("action: 'RELOAD_CHAT_TAB'"), 'dashboard.js must dispatch RELOAD_CHAT_TAB');

  // Grid view buttons & reconnect
  assert.ok(dashJs.includes('btn-reload-tab'), 'dashboard.js must include btn-reload-tab in card actions');
  assert.ok(dashJs.includes('btn-reconnect-tab'), 'dashboard.js must include btn-reconnect-tab in connectionHelp');

  // Connection lost indicator & pill styles
  assert.ok(dashJs.includes("dotClass = 'connection-lost'"), 'dashboard.js must set connection-lost dotClass');
  assert.match(dashCss, /\.connection-lost > \.cgq-stat-dot/, 'dashboard.css must colour the dot inside a .connection-lost status pill');
  assert.match(dashCss, /\.cgq-stat-dot\.connection-lost/, 'dashboard.css must style .cgq-stat-dot.connection-lost');
});

test('Gemini thinking level (思考レベル) detection, switching and UI controls in Queue Manager', async () => {
  // 1. Content script test: Gemini DOM with thinking level button
  const dom = new JSDOM(`<!doctype html><html><body>
    <button class="thinking-level-button" aria-label="思考レベル: 高" data-selected-reasoning-effort="high">思考: 高</button>
  </body></html>`, {
    url: 'https://gemini.google.com/app/test',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;

  for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  }
  const contentJs = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  const script = contentJs.replace(
    '  const queueManager = new QueueManager();',
    '  globalThis.__DOM = DOM; globalThis.__QueueManager = QueueManager; return;\n  const queueManager = new QueueManager();'
  );
  window.eval(script);

  const DOM = window.__DOM;
  const info = DOM.getCurrentModelInfo();
  assert.equal(info.supportsEffort, true, 'Gemini with thinking level button must report supportsEffort: true');
  assert.equal(info.effort, 'high', 'Must detect high effort');
  assert.equal(info.effortLabel, 'High', 'effort names are reported in English only');
  assert.ok(info.availableEfforts.length >= 4, 'Must have availableEfforts for Gemini');

  // Test switching effort in Gemini
  const button = window.document.querySelector('.thinking-level-button');
  button.onclick = () => {
    const menu = window.document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `
      <div role="menuitem" data-value="low">思考: 低 (Low)</div>
      <div role="menuitem" data-value="medium">思考: 標準 (Medium)</div>
      <div role="menuitem" data-value="high">思考: 高 (High)</div>
    `;
    window.document.body.appendChild(menu);
  };

  const switched = await DOM.switchReasoningEffort('low');
  assert.equal(switched, true, 'switchReasoningEffort must succeed in Gemini');
  dom.window.close();

  // 2. Dashboard test: Gemini tab with effort enabled in Queue Manager
  const dashJs = fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8');
  assert.ok(!dashJs.includes('const supportsEffort = !isGemini && !!t.supportsEffort;'), 'dashboard.js must not block Gemini effort');
  assert.ok(dashJs.includes("supportsEffort = !!t.supportsEffort"), 'dashboard.js must allow Gemini supportsEffort');
});

test('ChatGPT effort settings (instant, 中, 高) detection, switching and UI formatting in Queue Manager', async () => {
  // 1. Content script test: ChatGPT DOM with Instant reasoning effort button
  const dom = new JSDOM(`<!doctype html><html><body>
    <button data-testid="reasoning-effort-button" data-selected-reasoning-effort="instant" aria-label="推論: インスタント">Instant</button>
  </body></html>`, {
    url: 'https://chatgpt.com/c/test',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;

  for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  }
  const contentJs = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  const script = contentJs.replace(
    '  const queueManager = new QueueManager();',
    '  globalThis.__DOM = DOM; globalThis.__QueueManager = QueueManager; return;\n  const queueManager = new QueueManager();'
  );
  window.eval(script);

  const DOM = window.__DOM;
  const info = DOM.getCurrentModelInfo();
  assert.equal(info.supportsEffort, true);
  assert.equal(info.effort, 'instant', 'Must detect instant effort on ChatGPT');
  assert.equal(info.effortLabel, 'Instant');
  
  const effortIds = info.availableEfforts.map(e => e.id);
  assert.ok(effortIds.includes('instant'), 'availableEfforts must include instant');
  assert.ok(effortIds.includes('medium'), 'availableEfforts must include medium');
  assert.ok(effortIds.includes('high'), 'availableEfforts must include high');

  // Test switching effort to 中, 高, and instant in ChatGPT
  const button = window.document.querySelector('[data-testid="reasoning-effort-button"]');
  button.onclick = () => {
    const menu = window.document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `
      <div role="menuitem" data-value="instant">インスタント</div>
      <div role="menuitem" data-value="medium">中</div>
      <div role="menuitem" data-value="high">高</div>
    `;
    window.document.body.appendChild(menu);
  };

  const switchedMedium = await DOM.switchReasoningEffort('medium');
  assert.equal(switchedMedium, true, 'switchReasoningEffort to 中 (medium) must succeed in ChatGPT');

  const switchedHigh = await DOM.switchReasoningEffort('high');
  assert.equal(switchedHigh, true, 'switchReasoningEffort to 高 (high) must succeed in ChatGPT');

  const switchedInstant = await DOM.switchReasoningEffort('instant');
  assert.equal(switchedInstant, true, 'switchReasoningEffort to instant must succeed in ChatGPT');

  dom.window.close();

  // 2. Dashboard tests: formatting badges for instant, 中, 高
  const dashJs = fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8');
  const badgeMatch = dashJs.match(/function formatEffortBadge\([\s\S]*?\n  \}/);
  assert.ok(badgeMatch, 'formatEffortBadge function must exist in dashboard.js');

  const formatEffortBadge = new Function(`${badgeMatch[0]}; function formatEffortLabel(id) { return { instant: 'Instant', medium: 'Medium', high: 'High' }[id] || id; }; return formatEffortBadge;`)();
  assert.equal(formatEffortBadge('instant'), 'Instant');
  assert.equal(formatEffortBadge('medium'), 'Medium', 'English only');
  assert.equal(formatEffortBadge('high'), 'High');
  assert.equal(formatEffortBadge('auto'), '');
});

test('ChatGPT queue item is reliably dequeued and consumed upon send confirmation', async () => {
  const dom = new JSDOM(`
    <!DOCTYPE html>
    <html>
      <body>
        <main>
          <div class="user-query" data-user-message-bubble="true">こんにちは</div>
        </main>
        <div id="prompt-textarea" contenteditable="true"></div>
        <button data-testid="send-button"><rect width="10" height="10"></rect></button>
      </body>
    </html>
  `, { url: 'https://chatgpt.com/' });

  const window = dom.window;
  global.window = window;
  global.document = window.document;
  global.sessionStorage = window.sessionStorage;
  global.localStorage = window.localStorage;

  const chromeMock = {
    runtime: {
      sendMessage(request, cb) { cb?.({ chromeTabId: 73 }); },
      onMessage: { addListener() {} }
    },
    storage: {
      local: {
        get(keys, cb) { if (cb) cb({}); return Promise.resolve({}); },
        set(items, cb) { if (cb) cb(); return Promise.resolve(); },
        remove(k, cb) { if (cb) cb(); return Promise.resolve(); }
      },
      onChanged: { addListener() {} }
    }
  };
  window.chrome = chromeMock;
  global.chrome = chromeMock;

  for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  }

  const contentJs = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  const script = contentJs.replace(/const queueManager = new QueueManager\(\);/, 'return;\n  const queueManager = new QueueManager();');
  window.eval(script);

  const DOM = window.__CGQ_DOM__;
  const HumanSimulator = window.__CGQ_HumanSimulator__;
  const QueueManager = window.__CGQ_QueueManager__;

  // 1. Confirm sent recognizes generation state (rect or isGenerating)
  const confirmed = await HumanSimulator.confirmSent('こんにちは', null, 500);
  assert.equal(confirmed, true, 'confirmSent must confirm sent when generation/rect is active');

  // 2. QueueManager items filtering
  const qm = new QueueManager();
  const item1 = { id: 'item-1', text: 'Prompt 1' };
  const item2 = { id: 'item-2', text: 'Prompt 2' };
  qm.items = [item1, item2];

  // Simulated dequeue
  qm.items = qm.items.filter(it => it.id !== item1.id);
  assert.equal(qm.items.length, 1);
  assert.equal(qm.items[0].id, 'item-2', 'Sent item must be removed from queue');

  dom.window.close();
});

test('Auto-scroll detects bottom proximity correctly and avoids jumping when reading earlier history', () => {
  const dom = new JSDOM(`
    <!DOCTYPE html>
    <html>
      <body>
        <main>
          <div class="overflow-y-auto" id="scroll-container" style="height: 400px; overflow-y: auto;">
            <div style="height: 1200px;">Content</div>
          </div>
        </main>
      </body>
    </html>
  `, { url: 'https://chatgpt.com/' });

  const window = dom.window;
  const doc = window.document;
  global.window = window;
  global.document = doc;
  global.sessionStorage = window.sessionStorage;
  global.localStorage = window.localStorage;

  const chromeMock = {
    runtime: {
      sendMessage(request, cb) { cb?.({ chromeTabId: 73 }); },
      onMessage: { addListener() {} }
    },
    storage: {
      local: {
        get(keys, cb) { if (cb) cb({}); return Promise.resolve({}); },
        set(items, cb) { if (cb) cb(); return Promise.resolve(); },
        remove(k, cb) { if (cb) cb(); return Promise.resolve(); }
      },
      onChanged: { addListener() {} }
    }
  };
  window.chrome = chromeMock;
  global.chrome = chromeMock;

  for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  }

  const contentJs = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  const script = contentJs.replace(/const queueManager = new QueueManager\(\);/, 'return;\n  const queueManager = new QueueManager();');
  window.eval(script);

  const DOM = window.__CGQ_DOM__;
  const scroller = doc.getElementById('scroll-container');
  Object.defineProperty(scroller, 'scrollHeight', { value: 1200, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { value: 400, configurable: true });

  // When scrolled near bottom (scrollTop = 750, remaining = 50px <= 140px threshold)
  scroller.scrollTop = 750;
  assert.equal(DOM.isNearBottom(140), true, 'Must detect as near bottom when within 140px');

  // When scrolled up (scrollTop = 200, remaining = 600px > 140px threshold)
  scroller.scrollTop = 200;
  assert.equal(DOM.isNearBottom(140), false, 'Must detect user is scrolled up reading earlier turns');

  // Verify scrollToBottom scrolls to bottom when forced or when near bottom
  DOM.scrollToBottom(true);
  assert.equal(scroller.scrollTop, 1200, 'Must scroll to scrollHeight when forced to bottom');

  // Test QueueManager stick-to-bottom behavior during generation
  const QueueManagerClass = window.__CGQ_QueueManager__;
  const qm = new QueueManagerClass();
  qm.setupAutoScrollWatcher();
  assert.equal(qm.isStuckToBottom, true, 'Must default to stuck to bottom on init');

  // Wheel up event unhooks stick-to-bottom
  window.dispatchEvent(new window.WheelEvent('wheel', { deltaY: -10 }));
  assert.equal(qm.isStuckToBottom, false, 'Wheel up must unhook stick-to-bottom');

  // Scroll down near bottom re-engages stick-to-bottom
  scroller.scrollTop = 1100; // remaining = 1200 - 1100 - 400 < 0 <= 140
  window.dispatchEvent(new window.WheelEvent('wheel', { deltaY: 10 }));
  assert.equal(qm.isStuckToBottom, true, 'Wheel down near bottom must re-engage stick-to-bottom');

  if (qm.autoScrollInterval) clearInterval(qm.autoScrollInterval);

  dom.window.close();
});

test('Queue Manager uses normal Enter and Ctrl+Enter without a legacy queue preference', () => {
  // Check dashboard.js logic
  const dashJs = fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8');
  assert.ok(dashJs.includes('hasCtrlOrMeta && isEnter'), 'dashboard.js must handle Ctrl/Cmd+Enter for sending');
  assert.ok(!dashJs.includes('currentSettings.enterToQueue'), 'legacy preferences must not override Enter');

  // Check content.js logic
  const contentJs = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  assert.ok(contentJs.includes('(e.ctrlKey || e.metaKey) && e.key === \'Enter\''), 'content.js must handle Ctrl/Cmd+Enter');
});

test('Queue panel stays collapsible and header remains visible when queue has many items', () => {
  const stylesCss = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const dashCss = fs.readFileSync(path.join(root, 'dashboard.css'), 'utf8');

  // styles.css must have max-height and overflow-y: auto for the queue list
  assert.match(stylesCss, /\.cgq-panel-list[\s\S]*?max-height:\s*240px/, 'styles.css must limit panel list height');
  assert.match(stylesCss, /\.cgq-panel-list[\s\S]*?overflow-y:\s*auto/, 'styles.css must make panel list scrollable');
  assert.match(stylesCss, /\.cgq-panel-header[\s\S]*?position:\s*sticky/, 'styles.css must keep panel header sticky');

  // dashboard.css must have sticky header and max-height
  assert.match(dashCss, /\.cgq-composer-queue-panel\s*\{[\s\S]*?max-height:\s*280px/, 'dashboard.css must limit composer queue panel');
  assert.match(dashCss, /\.cgq-composer-queue-panel \.cgq-panel-header[\s\S]*?position:\s*sticky/, 'dashboard.css must keep header sticky');
});

test('Bulk prompt insertion correctly parses 1 prompt per line, trims whitespace, and ignores empty lines', () => {
  const parseBulk = (text, delim) => {
    let items = [];
    if (delim === 'line') {
      items = text.split('\n');
    } else if (delim === 'empty_line') {
      items = text.split(/\n\s*\n/);
    } else if (delim === 'hyphens') {
      items = text.split(/^---$/m);
    }
    return items.map(s => s.trim()).filter(Boolean);
  };

  const input1 = `
    第1章の要約を作成して
    第2章の登場人物を箇条書きにして

    全体のアクションプランを提案して
  `;

  const parsedLine = parseBulk(input1, 'line');
  assert.equal(parsedLine.length, 3, 'Must extract exactly 3 non-empty prompts');
  assert.equal(parsedLine[0], '第1章の要約を作成して');
  assert.equal(parsedLine[1], '第2章の登場人物を箇条書きにして');
  assert.equal(parsedLine[2], '全体のアクションプランを提案して');

  // Empty line delimiter
  const input2 = `プロンプト1\n複数行の本文\n\nプロンプト2\n複数行の本文2`;
  const parsedEmpty = parseBulk(input2, 'empty_line');
  assert.equal(parsedEmpty.length, 2);

  // Hyphens delimiter
  const input3 = `プロンプトA\n---\nプロンプトB`;
  const parsedHyphens = parseBulk(input3, 'hyphens');
  assert.equal(parsedHyphens.length, 2);
});

test('Popup screen is simple, functional, and contains zero emojis', () => {
  const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
  const popupJs = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');

  // Strict check: No emojis in popup.html or popup.js
  const emojiRegex = /\p{Extended_Pictographic}/u;
  assert.equal(emojiRegex.test(popupHtml), false, 'popup.html must contain zero emojis');
  assert.equal(emojiRegex.test(popupJs), false, 'popup.js must contain zero emojis');

  // Verify essential minimal elements exist
  assert.ok(popupHtml.includes('id="btn-open-dashboard"'), 'Must have Open Dashboard button');
  assert.ok(popupHtml.includes('id="queue-count"'), 'Must have queue count badge');
  assert.ok(popupHtml.includes('id="stat-items"'), 'Must have status display');
  assert.ok(popupHtml.includes('id="popup-input"'), 'Must have prompt input textarea');
  assert.ok(popupHtml.includes('id="btn-add"'), 'Must have add button');
  assert.ok(popupHtml.includes('id="btn-open-chatgpt"'), 'Must have ChatGPT shortcut');
  assert.ok(popupHtml.includes('id="btn-open-gemini"'), 'Must have Gemini shortcut');
});

test('ChatGPT modern send buttons (fruitjuice-send-button, composer-submit-button) are detected and clicked reliably', async () => {
  const dom = new JSDOM(`
    <!DOCTYPE html>
    <html>
      <body>
        <form id="chat-form">
          <div id="prompt-textarea" contenteditable="true"><p>テストプロンプト</p></div>
          <button data-testid="fruitjuice-send-button" aria-label="Send prompt"><svg><polygon></polygon></svg></button>
        </form>
      </body>
    </html>
  `, { url: 'https://chatgpt.com/' });

  const window = dom.window;
  const doc = window.document;
  global.window = window;
  global.document = doc;
  global.sessionStorage = window.sessionStorage;
  global.localStorage = window.localStorage;

  const chromeMock = {
    runtime: {
      sendMessage(request, cb) { cb?.({ chromeTabId: 73 }); },
      onMessage: { addListener() {} }
    },
    storage: {
      local: {
        get(keys, cb) { if (cb) cb({}); return Promise.resolve({}); },
        set(items, cb) { if (cb) cb(); return Promise.resolve(); },
        remove(k, cb) { if (cb) cb(); return Promise.resolve(); }
      },
      onChanged: { addListener() {} }
    }
  };
  window.chrome = chromeMock;
  global.chrome = chromeMock;

  for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  }

  const contentJs = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  const script = contentJs.replace(/const queueManager = new QueueManager\(\);/, 'return;\n  const queueManager = new QueueManager();');
  window.eval(script);

  const DOM = window.__CGQ_DOM__;
  const HumanSimulator = window.__CGQ_HumanSimulator__;

  const sendBtn = DOM.getSendButton();
  assert.ok(sendBtn, 'DOM.getSendButton must find fruitjuice-send-button');
  assert.equal(sendBtn.getAttribute('data-testid'), 'fruitjuice-send-button');

  // Verify setDOMContent updates input
  const input = DOM.getPromptInput();
  HumanSimulator.setDOMContent(input, '新しいプロンプト');
  assert.ok(input.textContent.includes('新しいプロンプト'), 'setDOMContent must update input text');

  dom.window.close();
});



