const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.join(__dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));

// Gemini's empty composer, observed in Chrome: no send button, a persistent mic,
// and a sibling model picker in the trailing toolbar.
const composer = `<input-container><input-area><fieldset><div class="text-input-field">
  <div><rich-textarea><div class="ql-editor" contenteditable="true" role="textbox" aria-label="Gemini へのプロンプトを入力"><p><br></p></div></rich-textarea></div>
  <div class="trailing-actions-wrapper">
    <div class="model-picker-container"><bard-mode-switcher><button data-test-id="bard-mode-menu-button">Flash</button></bard-mode-switcher></div>
    <div class="input-buttons-wrapper-bottom persistent-mic"><gem-icon-button class="mic-button"><button aria-label="音声入力"></button></gem-icon-button></div>
  </div>
</div></fieldset></input-area></input-container>`;

async function boot({ platform = 'gemini', delayed = false, expanded = false } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(`<!doctype html><body>${delayed ? '' : composer}</body>`, {
    url: platform === 'gemini' ? 'https://gemini.google.com/app' : 'https://chatgpt.com/',
    runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole
  });
  const { window } = dom;
  const store = {};
  const messages = [];
  const messageHandlers = [];
  const style = window.document.createElement('style');
  style.textContent = fs.readFileSync(path.join(root, 'styles.css'), 'utf8').replace(/^@import.*$/gm, '');
  window.document.head.append(style);
  if (expanded) window.localStorage.setItem('cgq_panel_collapsed', 'false');
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  window.chrome = {
    runtime: {
      sendMessage(request, respond) { messages.push(request); respond?.({ chromeTabId: 73 }); },
      onMessage: { addListener(handler) { messageHandlers.push(handler); } }
    },
    storage: {
      local: {
        async get(keys) { return Object.fromEntries(keys.filter(key => key in store).map(key => [key, store[key]])); },
        async set(values) { Object.assign(store, values); },
        async remove(key) { delete store[key]; }
      },
      onChanged: { addListener() {} }
    }
  };
  window.eval(fs.readFileSync(path.join(root, 'references.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'model-picker.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'composer-tools.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'content.js'), 'utf8'));
  await tick(); await tick();
  return { dom, window, doc: window.document, errors, store, messages, messageHandlers };
}

test('Gemini initializes with a visible empty panel and Queue button before a native send button exists', async t => {
  const f = await boot();
  t.after(() => f.dom.window.close());
  assert.equal(f.doc.querySelector('[aria-label="プロンプトを送信"]'), null);
  assert.notEqual(f.window.getComputedStyle(f.doc.getElementById('cgq-composer-queue-panel')).display, 'none');
  const button = f.doc.getElementById('cgq-injected-btn');
  assert.ok(button);
  assert.ok(button.parentElement.matches('.input-buttons-wrapper-bottom'));
  assert.equal(button.closest('gem-icon-button, rich-textarea'), null);
  assert.equal(f.doc.getElementById('cgq-panel-badge').textContent, '0件');
  const registered = Object.values(f.store.cgq_tabs_registry || {});
  assert.equal(registered.length, 1, 'Gemini must report metadata without silently swallowing an error');
  assert.equal(registered[0].effort, 'auto', 'Gemini offers its thinking level (思考レベル) from the mode picker');
  assert.equal(registered[0].supportsEffort, true);
  assert.equal(registered[0].availableEfforts.length, 4, 'Auto plus the Gemini levels 低 / 標準 / 高');
  button.click();
  assert.equal(f.doc.getElementById('cgq-bulk-textarea'), null, '"+" only queues the composer text; empty shows a notice');
  const bulk = f.doc.getElementById('cgq-injected-bulk-btn');
  assert.ok(bulk, 'an icon-only bulk button sits next to "+"');
  assert.equal(bulk.previousElementSibling, button);
  assert.equal(button.textContent.trim(), '', '"+" is icon only');
  bulk.click();
  assert.ok(f.doc.getElementById('cgq-bulk-textarea'), 'the bulk button opens the bulk panel');
  f.doc.getElementById('cgq-modal-cancel').click();
  f.doc.getElementById('cgq-btn-dashboard').click();
  assert.ok(f.messages.some(message => message.action === 'OPEN_DASHBOARD'));
  assert.deepEqual(f.errors, []);
  f.dom.window.close();
});

test('Gemini Queue button survives microphone/send replacement and composer rerender without duplicates', async () => {
  const f = await boot();
  const button = f.doc.getElementById('cgq-injected-btn');
  const nativeHost = f.doc.querySelector('gem-icon-button');
  nativeHost.outerHTML = '<gem-icon-button class="send-button"><button aria-label="プロンプトを送信"></button></gem-icon-button>';
  await tick();
  assert.equal(f.doc.getElementById('cgq-injected-btn'), button);
  f.doc.querySelector('gem-icon-button').remove();
  await tick();
  assert.equal(f.doc.getElementById('cgq-injected-btn'), button);
  f.doc.querySelector('input-container').outerHTML = composer;
  await tick(); await tick();
  assert.equal(f.doc.querySelectorAll('#cgq-injected-btn').length, 1);
  assert.equal(f.doc.querySelectorAll('#cgq-composer-queue-panel').length, 1);
  assert.ok(f.doc.getElementById('cgq-composer-queue-panel').parentElement.matches('input-container'));
  assert.ok(f.doc.getElementById('cgq-injected-btn').parentElement.matches('.input-buttons-wrapper-bottom'));
  assert.deepEqual(f.errors, []);
  f.dom.window.close();
});

test('Gemini late-loaded composer gets the Queue controls after startup', async () => {
  const f = await boot({ delayed: true });
  assert.ok(f.doc.getElementById('cgq-composer-queue-panel'));
  f.doc.body.insertAdjacentHTML('beforeend', composer);
  await tick(); await tick();
  assert.ok(f.doc.getElementById('cgq-injected-btn'));
  assert.ok(f.doc.getElementById('cgq-composer-queue-panel').parentElement.matches('input-container'));
  assert.deepEqual(f.errors, []);
  f.dom.window.close();
});

test('Gemini empty expanded panel can open settings and collapse', async () => {
  const f = await boot({ expanded: true });
  assert.equal(f.window.getComputedStyle(f.doc.getElementById('cgq-composer-queue-panel')).display, 'block');
  assert.equal(f.doc.getElementById('cgq-btn-settings').style.display, 'inline-flex');
  f.doc.getElementById('cgq-btn-settings').click();
  assert.ok(f.doc.getElementById('cgq-settings-save'));
  f.doc.getElementById('cgq-modal-cancel').click();
  f.doc.getElementById('cgq-btn-chevron').click();
  assert.equal(f.doc.getElementById('cgq-composer-queue-panel').style.display, 'inline-flex');
  assert.deepEqual(f.errors, []);
  f.dom.window.close();
});

test('ChatGPT retains its existing hidden empty-panel behavior', async () => {
  const f = await boot({ platform: 'chatgpt' });
  assert.equal(f.window.getComputedStyle(f.doc.getElementById('cgq-composer-queue-panel')).display, 'none');
  assert.deepEqual(f.errors, []);
  f.dom.window.close();
});

test('Gemini responds to Queue Manager discovery even with an empty queue', async t => {
  const f = await boot();
  t.after(() => f.dom.window.close());
  const response = await new Promise(resolve => {
    const keepAlive = f.messageHandlers[0]({ action: 'GET_DASHBOARD_STATE' }, {}, resolve);
    assert.equal(keepAlive, true);
  });
  assert.equal(response.success, true);
  assert.equal(response.state.platform, 'gemini');
  assert.equal(response.state.chromeTabId, 73);
  assert.equal(response.state.url, 'https://gemini.google.com/app');
  assert.equal(response.state.items.length, 0);
  assert.equal(response.state.effort, 'auto', 'Gemini offers its thinking level (思考レベル) from the mode picker');
  assert.ok(response.state.tabId);
});

test('Gemini prompt extraction avoids "あなたのプロンプト" and duplicated query text', async t => {
  const f = await boot();
  t.after(() => f.dom.window.close());

  const queryHtml = `
    <user-query>
      <div class="query-content">
        <div class="query-text gds-body-l">
          <h5 class="cdk-visually-hidden screen-reader-user-query-label">
            <span>あなたのプロンプト</span> 建築学科についてしらべて
          </h5>
          <p class="query-text-line">建築学科についてしらべて</p>
        </div>
      </div>
    </user-query>
  `;
  f.doc.body.insertAdjacentHTML('beforeend', queryHtml);

  const uq = f.doc.querySelector('user-query');
  const cleaned = f.window.__CGQ_DOM__.cleanUserPrompt(uq);
  assert.equal(cleaned, '建築学科についてしらべて');
  assert.ok(!cleaned.includes('あなたのプロンプト'), 'Should not contain screen reader prefix');
});

test('Gemini answer extraction inside side-navigation-v2 succeeds after generation completes', async t => {
  const f = await boot();
  t.after(() => f.dom.window.close());

  const conversationHtml = `
    <main class="chat-app">
      <bard-sidenav role="navigation"></bard-sidenav>
      <side-navigation-v2 class="content enable-mweb-nav-improvements lr26">
        <chat-window>
          <user-query>
            <div class="query-content">
              <div class="query-text gds-body-l">
                <h5 class="cdk-visually-hidden screen-reader-user-query-label">
                  <span>あなたのプロンプト</span> 日本大学の偏差値を教えて
                </h5>
                <p class="query-text-line">日本大学の偏差値を教えて</p>
              </div>
            </div>
          </user-query>
          <model-response>
            <div class="model-response-label-announcer">Gemini の回答</div>
            <structured-content-container>
              <message-content>
                <p>日本大学の偏差値は全体で 35.0〜65.0 です。</p>
              </message-content>
            </structured-content-container>
            <response-action-bar><button aria-label="Good response"></button></response-action-bar>
          </model-response>
        </chat-window>
      </side-navigation-v2>
    </main>
  `;
  f.doc.body.insertAdjacentHTML('beforeend', conversationHtml);

  assert.equal(f.window.__CGQ_DOM__.isGenerating(), false);

  const latest = f.window.__CGQ_DOM__.getLatestAnswer();
  assert.ok(latest, 'Latest answer must not be null');
  assert.equal(latest.userPrompt, '日本大学の偏差値を教えて');
  assert.ok(latest.text.includes('日本大学の偏差値は全体で 35.0〜65.0 です。'));
  assert.equal(latest.isStreaming, false);

  const history = f.window.__CGQ_DOM__.getRecentQAHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].prompt, '日本大学の偏差値を教えて');
  assert.ok(history[0].answer.includes('日本大学の偏差値は全体で 35.0〜65.0 です。'));
  assert.equal(history[0].isStreaming, false);
});

test('Gemini multi-turn conversation extraction pairs prompts and answers correctly', async t => {
  const f = await boot();
  t.after(() => f.dom.window.close());

  const conversationHtml = `
    <main class="chat-app">
      <bard-sidenav role="navigation"></bard-sidenav>
      <side-navigation-v2 class="content enable-mweb-nav-improvements lr26">
        <chat-window>
          <user-query>
            <div class="query-content">
              <div class="query-text gds-body-l">
                <h5 class="cdk-visually-hidden screen-reader-user-query-label">
                  <span>あなたのプロンプト</span> 日本大学の偏差値を教えて
                </h5>
                <p class="query-text-line">日本大学の偏差値を教えて</p>
              </div>
            </div>
          </user-query>
          <model-response>
            <div class="model-response-label-announcer">Gemini の回答</div>
            <structured-content-container>
              <message-content>
                <p>日本大学の偏差値は全体で 35.0〜65.0 です。</p>
              </message-content>
            </structured-content-container>
            <response-action-bar><button aria-label="Good response"></button></response-action-bar>
          </model-response>

          <user-query>
            <div class="query-content">
              <div class="query-text gds-body-l">
                <h5 class="cdk-visually-hidden screen-reader-user-query-label">
                  <span>あなたのプロンプト</span> 建築学科についてしらべて
                </h5>
                <p class="query-text-line">建築学科についてしらべて</p>
              </div>
            </div>
          </user-query>
          <model-response>
            <div class="model-response-label-announcer">Gemini の回答</div>
            <structured-content-container>
              <message-content>
                <p>建築学科は100年以上の歴史を持つ看板学科です。</p>
              </message-content>
            </structured-content-container>
            <response-action-bar><button aria-label="Good response"></button></response-action-bar>
          </model-response>
        </chat-window>
      </side-navigation-v2>
    </main>
  `;
  f.doc.body.insertAdjacentHTML('beforeend', conversationHtml);

  const history = f.window.__CGQ_DOM__.getRecentQAHistory();
  assert.equal(history.length, 2);
  assert.equal(history[0].turn, 1);
  assert.equal(history[0].prompt, '日本大学の偏差値を教えて');
  assert.ok(history[0].answer.includes('日本大学の偏差値は全体で 35.0〜65.0 です。'));

  assert.equal(history[1].turn, 2);
  assert.equal(history[1].prompt, '建築学科についてしらべて');
  assert.ok(history[1].answer.includes('建築学科は100年以上の歴史を持つ看板学科です。'));

  const latest = f.window.__CGQ_DOM__.getLatestAnswer();
  assert.equal(latest.userPrompt, '建築学科についてしらべて');
  assert.ok(latest.text.includes('建築学科は100年以上の歴史を持つ看板学科です。'));
});

test('Gemini thinking level is switched through the mode menu by exact label, never the "高度な推論" model', async t => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(`<!doctype html><body>
    <button data-test-id="bard-mode-menu-button" aria-label="モード選択ツールを開く（現在のモデル: Flash）">Flash</button>
    <div class="cdk-overlay-container"></div></body>`, { url: 'https://gemini.google.com/app', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  t.after(() => window.close());
  const overlay = window.document.querySelector('.cdk-overlay-container');
  const clicked = [];
  // Real structure (2026-10): models, then a 思考レベル item that opens a submenu with 低 / 標準 / 高.
  window.document.querySelector('[data-test-id="bard-mode-menu-button"]').addEventListener('click', () => {
    overlay.innerHTML = `<gem-menu role="menu">
      <gem-menu-item role="menuitem"><span class="label">3.1 Pro</span><span>高度な推論</span></gem-menu-item>
      <gem-menu-item role="menuitem" aria-haspopup="true" class="thinking"><span class="label">思考レベル</span></gem-menu-item></gem-menu>`;
    overlay.querySelector('.thinking').addEventListener('click', () => {
      overlay.insertAdjacentHTML('beforeend', `<div class="submenu-container"><gem-menu role="menu">
        <gem-menu-item role="menuitem" class="selected"><div><span class="label">低</span></div></gem-menu-item>
        <gem-menu-item role="menuitem"><div><span class="label">標準</span></div></gem-menu-item>
        <gem-menu-item role="menuitem"><div><span class="label">高</span></div></gem-menu-item></gem-menu></div>`);
      overlay.querySelectorAll('.submenu-container [role="menuitem"]').forEach(item => item.addEventListener('click', () => {
        clicked.push(item.textContent.trim());
        overlay.querySelectorAll('.submenu-container .selected').forEach(other => other.classList.remove('selected'));
        item.classList.add('selected'); // Gemini moves the check to the chosen level
      }));
    });
    overlay.querySelector('[role="menuitem"]').addEventListener('click', () => clicked.push('3.1 Pro'));
  });
  for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'content.js'), 'utf8')
    .replace('const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));', 'const sleep = async () => {};')
    .replace('  const queueManager = new QueueManager();', '  globalThis.__queueTest = { DOM }; return;\n  const queueManager = new QueueManager();'));
  const { DOM } = window.__queueTest;
  assert.equal(await DOM.switchReasoningEffort('high'), true);
  assert.deepEqual([...clicked], ['高'], 'only the 高 thinking level is clicked');
  const info = DOM.getCurrentModelInfo();
  assert.equal(info.effort, 'high');
  assert.equal(info.effortLabel, '高');
});
