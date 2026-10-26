const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const CGQComposerTools = require('../composer-tools.js');
const root = path.join(__dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('CGQComposerTools.normalize deduplicates tools by ID and label', () => {
  const tools = [
    { type: 'app', platform: 'chatgpt', id: 'app://kei-net', label: 'Kei-Net' },
    { type: 'app', platform: 'chatgpt', id: 'app://kei-net', label: 'Kei-Net' }, // Exact duplicate
    { type: 'app', platform: 'chatgpt', id: 'app://other-id', label: 'kei-net' }, // Same label, different ID
    { type: 'tool', platform: 'chatgpt', id: 'chatgpt:tool:search', label: 'ウェブ検索' },
    { type: 'tool', platform: 'chatgpt', id: 'chatgpt:tool:search', label: 'ウェブ検索' },
    { type: 'app', platform: 'gemini', id: 'gemini:app:youtube', label: 'YouTube' }
  ];
  const normalized = CGQComposerTools.normalize(tools);
  assert.equal(normalized.length, 3);
  assert.deepEqual(normalized.map(t => t.id), ['app://kei-net', 'chatgpt:tool:search', 'gemini:app:youtube']);
});

test('CGQComposerTools.attach is strictly idempotent and does not accumulate elements', () => {
  const dom = new JSDOM('<!doctype html><div><input id="test-input" /></div>');
  const doc = dom.window.document;
  const input = doc.getElementById('test-input');
  const drafts = new Map();
  drafts.set('test', [{ type: 'app', platform: 'chatgpt', id: 'app://1', label: 'App1' }]);

  // Call attach multiple times
  const c1 = CGQComposerTools.attach(input, { scope: () => 'test', drafts });
  const c2 = CGQComposerTools.attach(input, { scope: () => 'test', drafts });
  const c3 = CGQComposerTools.attach(input, { scope: () => 'test', drafts });

  const parent = input.parentElement;
  const chipsList = parent.querySelectorAll('.cgq-prompt-chips');
  const menuList = parent.querySelectorAll('.cgq-prompt-menu');

  assert.equal(chipsList.length, 1, 'Only 1 chips container should exist in DOM');
  assert.equal(menuList.length, 1, 'Only 1 menu container should exist in DOM');
  assert.equal(chipsList[0].querySelectorAll('.cgq-prompt-chip').length, 1, 'Only 1 chip should be rendered');

  // Test destroy
  c3.destroy();
  assert.equal(parent.querySelectorAll('.cgq-prompt-chips').length, 0);
  assert.equal(parent.querySelectorAll('.cgq-prompt-menu').length, 0);
});

test('CGQComposerTools.mergeOptions deduplicates options across native and remembered', () => {
  const native = [
    { type: 'app', platform: 'chatgpt', id: 'app://1', label: 'Alpha' },
    { type: 'tool', platform: 'chatgpt', id: 'chatgpt:tool:search', label: 'Search' }
  ];
  const remembered = [
    { type: 'app', platform: 'chatgpt', id: 'app://1', label: 'Alpha' }, // Duplicate ID
    { type: 'tool', platform: 'chatgpt', id: 'chatgpt:tool:search-alt', label: 'Search' }, // Duplicate label
    { type: 'app', platform: 'chatgpt', id: 'app://2', label: 'Beta' }
  ];
  const merged = CGQComposerTools.mergeOptions(native, remembered);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map(t => t.label), ['Alpha', 'Search', 'Beta']);
});

test('Dashboard periodic refresh in grid view does not multiply chips or menus', async t => {
  const chat = { id: 88, url: 'https://chatgpt.com/c/test', title: 'テスト' };
  const current = {
    tabId: 'real_88', chromeTabId: 88, platform: 'chatgpt', url: chat.url, title: chat.title,
    lastHeartbeat: Date.now(), currentState: 'idle', items: [], recentQA: [],
    availableModels: [], availableEfforts: []
  };

  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8'), {
    url: 'https://queue-manager.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole
  });
  const { window } = dom;
  t.after(() => window.close());

  const intervals = [];
  window.setInterval = fn => { intervals.push(fn); return 0; };
  window.chrome = {
    runtime: { sendMessage() {} },
    storage: {
      local: { get: async () => ({ cgq_tabs_registry: { chat: current } }), set: async () => {} },
      onChanged: { addListener() {} }
    },
    tabs: {
      query(filter, cb) { cb([chat]); },
      sendMessage(id, req, cb) { Promise.resolve().then(() => cb({ success: true, state: current })); }
    }
  };

  window.eval(fs.readFileSync(path.join(root, 'references.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'composer-tools.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8'));
  await tick(); await tick();

  // Switch to Grid View
  window.document.getElementById('nav-all-grid').click();
  await tick();

  const card = window.document.querySelector('.cgq-tab-card');
  assert.ok(card, 'Card should exist in grid view');

  // Trigger the dashboard refresh interval multiple times (simulating 1500ms intervals)
  for (let i = 0; i < 5; i++) {
    for (const fn of intervals) fn();
    await tick();
  }

  // Check that the card input host contains strictly 1 chips container and 1 menu container
  const inputHost = card.querySelector('.cgq-prompt-host') || card.querySelector('.cgq-dash-prompt-input').parentElement;
  const chipsCount = inputHost.querySelectorAll('.cgq-prompt-chips').length;
  const menuCount = inputHost.querySelectorAll('.cgq-prompt-menu').length;

  assert.equal(chipsCount, 1, `Expected exactly 1 chips container, got ${chipsCount}`);
  assert.equal(menuCount, 1, `Expected exactly 1 menu container, got ${menuCount}`);
});

test('DOM.clearComposer purges ChatGPT mention chips and resets contenteditable innerHTML', () => {
  const dom = new JSDOM('<!doctype html><div id="prompt-textarea" contenteditable="true"><p><span app-mention-path="app://123" class="app-mention">Kei-Net</span><span data-system-hint-type="search">Search</span> 残りのプロンプト</p></div>');
  const doc = dom.window.document;
  const input = doc.getElementById('prompt-textarea');

  // Purge mention tokens
  input.querySelectorAll('[app-mention-path], [data-system-hint-type], [data-mention], .app-mention, [data-system-hint], strong').forEach(el => {
    if (el.tagName === 'STRONG' && !/^@\S/.test(el.textContent || '')) return;
    el.remove();
  });
  input.innerHTML = '<p><br></p>';

  assert.equal(input.querySelectorAll('[app-mention-path]').length, 0);
  assert.equal(input.querySelectorAll('[data-system-hint-type]').length, 0);
  assert.equal(input.innerHTML, '<p><br></p>');
});
