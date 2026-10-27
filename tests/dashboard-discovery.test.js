const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.join(__dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));
const geminiTab = { id: 41, url: 'https://gemini.google.com/app/example', title: 'Geminiのチャット' };

function state(tab, extra = {}) {
  return { tabId: `real_${tab.id}`, chromeTabId: tab.id, platform: tab.url.includes('gemini') ? 'gemini' : 'chatgpt',
    url: tab.url, title: tab.title, lastHeartbeat: Date.now(), currentState: 'idle', items: [], recentQA: [],
    availableModels: [], availableEfforts: [], ...extra };
}

async function boot({ tabs = [geminiTab], registry = {}, snapshots = {} } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8'), {
    url: 'https://queue-manager.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole
  });
  const { window } = dom;
  const native = { tabs, registry, snapshots };
  const events = [];
  const intervals = [];
  const commands = [];
  const requests = [];
  window.setInterval = fn => { intervals.push(fn); return 0; };
  window.chrome = {
    runtime: { sendMessage(request) { commands.push(request); } },
    storage: {
      local: { get: async () => ({ cgq_tabs_registry: native.registry }), set: async values => { commands.push(values); } },
      onChanged: { addListener(fn) { events.push(fn); } }
    },
    tabs: {
      query(filter, callback) { requests.push({ query: filter }); callback(native.tabs); },
      sendMessage(id, request, callback) {
        requests.push({ id, ...request });
        Promise.resolve().then(() => callback(native.snapshots[id] ? { success: true, state: native.snapshots[id] } : undefined));
      }
    }
  };
  window.eval(fs.readFileSync(path.join(root, 'references.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'composer-tools.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8'));
  await tick(); await tick();
  // 初期表示は並列。単一表示の検証のため、サイドバーのチャットを選択してから検証する
  window.document.querySelector('.cgq-sidebar-chat-item')?.click();
  await tick();
  const refresh = async () => { await intervals.at(-1)(); await tick(); await tick(); };
  const publish = next => {
    native.registry = next;
    events.forEach(fn => fn({ cgq_tabs_registry: { newValue: next } }, 'local'));
  };
  return { dom, window, doc: window.document, native, errors, commands, requests, refresh, publish };
}

test('Queue Manager discovers an unregistered Gemini and displays its real snapshot in both views', async t => {
  const current = state(geminiTab, { latestAnswer: { text: 'Geminiから取得した回答', userPrompt: '質問', isStreaming: false },
    items: [{ id: 'queued', text: '次の質問' }] });
  const f = await boot({ snapshots: { 41: current } });
  t.after(() => f.dom.window.close());
  assert.ok(f.requests.some(request => request.action === 'GET_DASHBOARD_STATE' && request.id === 41));
  assert.equal(f.doc.querySelectorAll('.cgq-sidebar-chat-item').length, 1);
  assert.equal(f.doc.querySelector('.cgq-sidebar-chat-item').dataset.tabId, 'real_41');
  assert.equal(f.doc.getElementById('single-chat-title').textContent, geminiTab.title);
  assert.match(f.doc.getElementById('single-answers-area').textContent, /Geminiから取得した回答/);
  assert.equal(f.doc.getElementById('single-chat-input').disabled, false);
  f.doc.getElementById('nav-all-grid').click();
  assert.equal(f.doc.querySelectorAll('.cgq-tab-card').length, 1);
  assert.equal(f.doc.querySelector('.cgq-tab-card .cgq-tab-title').textContent, geminiTab.title);
  assert.match(f.doc.querySelector('.cgq-tab-card').textContent, /Geminiから取得した回答/);
  const input = f.doc.querySelector('.cgq-dash-prompt-input');
  input.value = '追加する質問';
  f.doc.querySelector('.btn-enqueue-prompt').click();
  assert.ok(f.requests.some(request => request.action === 'ADD_TO_TAB_QUEUE' && request.text === '追加する質問' && request.expectedTabId === 'real_41'));
  assert.ok(!f.requests.some(request => request.action === 'ADD_TO_TAB_QUEUE' && request.expectedTabId === 'browser_41'));
  assert.deepEqual(f.errors, []);
});

test('an unresponsive Gemini stays listed with reload guidance and disabled queue controls', async t => {
  const f = await boot();
  t.after(() => f.dom.window.close());
  assert.equal(f.doc.querySelector('.cgq-sidebar-chat-item .cgq-chat-item-title').textContent, geminiTab.title);
  assert.equal(f.doc.getElementById('single-chat-status-text').textContent, 'ページを再読み込みしてください');
  assert.match(f.doc.getElementById('single-answers-area').textContent, /Geminiのタブを開いて/);
  assert.equal(f.doc.getElementById('single-chat-input').disabled, true);
  assert.equal(f.doc.getElementById('single-btn-send').disabled, true);
  f.doc.getElementById('single-btn-focus-tab').click();
  assert.ok(f.commands.some(command => command.action === 'FOCUS_TAB' && command.chromeTabId === 41));
  f.doc.getElementById('nav-all-grid').click();
  assert.equal(f.doc.querySelector('.cgq-dash-prompt-input').disabled, true);
  assert.equal(f.doc.querySelector('.btn-add-prompt').disabled, true);
  assert.match(f.doc.querySelector('.cgq-tab-card').textContent, /再読み込みしてください/);
  assert.deepEqual(f.errors, []);
});

test('ChatGPT and Gemini appear together, with one entry per live browser tab', async t => {
  const chat = { id: 42, url: 'https://chatgpt.com/c/example', title: 'ChatGPTのチャット' };
  const gem = state(geminiTab);
  const f = await boot({ tabs: [geminiTab, chat, { id: 99, url: 'https://gemini.google.com.evil.test/app', title: '除外対象' }],
    registry: { oldGem: { ...gem, tabId: 'older-gem', lastHeartbeat: 1 }, gem, chat: state(chat), closed: state({ id: 90, url: 'https://gemini.google.com/app/closed' }) } });
  t.after(() => f.dom.window.close());
  assert.deepEqual(Array.from(f.doc.querySelectorAll('.cgq-sidebar-chat-item .cgq-chat-item-title')).map(el => el.textContent), [geminiTab.title, chat.title]);
  assert.equal(f.doc.getElementById('stat-active-tabs').textContent, '2');
  f.doc.getElementById('nav-all-grid').click();
  assert.equal(f.doc.querySelectorAll('.cgq-tab-card').length, 2);
  assert.deepEqual(f.errors, []);
});

test('an open background Gemini stays listed after its heartbeat expires or registry entry disappears', async t => {
  const gem = state(geminiTab, { lastHeartbeat: Date.now() - 60000 });
  const f = await boot({ registry: { gem } });
  t.after(() => f.dom.window.close());
  f.publish({});
  const now = f.window.Date.now();
  f.window.Date.now = () => now + 120000;
  await f.refresh();
  assert.equal(f.doc.querySelectorAll('.cgq-sidebar-chat-item').length, 1);
  assert.equal(f.doc.querySelector('.cgq-sidebar-chat-item').dataset.tabId, gem.tabId);
  assert.equal(f.doc.getElementById('single-chat-title').textContent, geminiTab.title);
  assert.deepEqual(f.errors, []);
});

test('closing a Gemini removes it even when storage still contains an old heartbeat', async t => {
  const gem = state(geminiTab);
  const f = await boot({ registry: { gem } });
  t.after(() => f.dom.window.close());
  f.native.tabs = [];
  await f.refresh();
  assert.equal(f.doc.querySelectorAll('.cgq-sidebar-chat-item').length, 0);
  assert.equal(f.doc.getElementById('stat-active-tabs').textContent, '0');
  assert.equal(f.doc.getElementById('empty-state').style.display, 'flex');
  assert.ok(f.native.registry.gem, 'discovery never deletes stored queues or registry entries');
});

test('a newly connected Gemini replaces its placeholder without leaving a duplicate tab', async t => {
  const f = await boot();
  t.after(() => f.dom.window.close());
  assert.equal(f.doc.getElementById('single-chat-input').disabled, true);
  f.publish({ gem: state(geminiTab) });
  assert.equal(f.doc.querySelectorAll('.cgq-sidebar-chat-item').length, 1);
  assert.equal(f.doc.querySelector('.cgq-sidebar-chat-item').dataset.tabId, 'real_41');
  assert.equal(f.doc.getElementById('single-chat-input').disabled, false);
  assert.doesNotMatch(f.doc.getElementById('single-answers-area').textContent, /ページを再読み込みしてください/);
  assert.deepEqual(f.errors, []);
});

test('composer queues update in place while drafts and queue actions work in both views', async t => {
  const chat = { id: 42, url: 'https://chatgpt.com/c/layout', title: 'レイアウト確認' };
  const current = state(chat, { effort: 'high', effortLabel: '高 (High)', supportsEffort: true,
    availableEfforts: [{ id: 'high', label: '高 (High)' }], items: [{ id: 'next', text: '次の質問' }],
    latestAnswer: { text: '回答本文', isStreaming: false } });
  const f = await boot({ tabs: [chat], registry: { chat: current } });
  t.after(() => f.dom.window.close());
  const singleQueue = f.doc.getElementById('single-queue-panel');
  assert.equal(singleQueue.closest('.cgq-chat-composer-container') !== null, true);
  assert.equal(f.doc.getElementById('single-effort-pill-label').textContent, 'High');
  assert.equal(f.doc.querySelectorAll('.cgq-platform-pill, .cgq-platform-badge').length, 0);
  const draft = f.doc.getElementById('single-chat-input');
  draft.value = '書きかけ';
  draft.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  f.publish({ chat: { ...current, items: [] } });
  assert.equal(singleQueue.hidden, true);
  assert.equal(draft.value, '書きかけ');

  f.doc.getElementById('nav-all-grid').click();
  const card = f.doc.querySelector('.cgq-tab-card');
  const input = card.querySelector('.cgq-dash-prompt-input');
  input.value = '並列の書きかけ';
  input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  f.publish({ chat: current });
  assert.equal(card.querySelector('.cgq-tab-card-footer .cgq-card-queue-slot .cgq-panel-item').dataset.id, 'next');
  assert.equal(card.querySelector('.card-effort-label').textContent, 'High');
  assert.equal(card.querySelector('.cgq-dash-prompt-input'), input);
  assert.equal(input.value, '並列の書きかけ');
  card.querySelector('[data-action="delete"]').click();
  assert.ok(f.commands.some(command => command.cgq_cmd_real_42?.action === 'REMOVE_ITEM' && command.cgq_cmd_real_42.id === 'next'));
  f.publish({ chat: { ...current, items: [] } });
  assert.equal(card.querySelector('.cgq-card-queue-slot').textContent, '');
  assert.match(card.querySelector('[data-view="results"]').textContent, /回答本文/);
  assert.deepEqual(f.errors, []);
});
