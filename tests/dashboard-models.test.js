const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function dashboard({ failSwitch = false, noModels = false, answer = '', marked = false } = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8'), {
    url: 'https://extension-preview.test/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  const models = noModels ? [] : [
    { id: 'chatgpt:gpt-6', label: 'GPT-6', desc: '' },
    { id: 'chatgpt:custom"<value>', label: 'Future "Model" <safe>', desc: '<script>untrusted</script>' }
  ];
  const tab = { tabId: 'test_tab', chromeTabId: 42, platform: 'chatgpt', title: 'モデル選択の確認',
    url: 'https://chatgpt.com/c/models',
    lastHeartbeat: Date.now(), currentState: 'idle', items: [], availableModels: [], model: null,
    modelLabel: 'Auto', effort: 'auto', availableEfforts: [] };
  const registry = { test_tab: tab };
  if (answer) tab.latestAnswer = { text: answer, userPrompt: '参照元の表示確認', isStreaming: false };
  const calls = [];
  window.setInterval = () => 0;
  window.chrome = {
    storage: { local: { get: async () => ({ cgq_tabs_registry: registry }), set: async () => {} }, onChanged: { addListener() {} } },
    runtime: { sendMessage() {} },
    tabs: { query(filter, respond) { respond([{ id: 42, title: tab.title, url: tab.url }]); }, sendMessage(id, request, respond) {
      calls.push({ id, ...request });
      Promise.resolve().then(() => {
        const selected = request.action === 'SELECT_MODEL' && !failSwitch ? models.find(m => m.id === request.model) : models[0];
        const info = { model: selected?.id || null, modelLabel: selected?.label || 'Auto', availableModels: models,
          effort: 'auto', supportsEffort: false, availableEfforts: [], modelsError: '' };
        Object.assign(tab, info);
        respond({ ...info, success: request.action !== 'SELECT_MODEL' || !failSwitch, error: failSwitch ? '切り替え未確認' : '' });
      });
    } }
  };
  window.eval(fs.readFileSync(path.join(root, 'references.js'), 'utf8'));
  if (marked) window.eval(fs.readFileSync(path.join(root, 'libs/marked.min.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'composer-tools.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8'));
  await tick(); await tick();
  // 初期表示は並列。単一表示の検証のため、サイドバーのチャットを選択してから検証する
  window.document.querySelector('.cgq-sidebar-chat-item')?.click();
  await tick();
  return { dom, doc: window.document, models, calls };
}

test('single view loads the real catalog on open, escapes service text, and confirms selection', async () => {
  const f = await dashboard();
  f.doc.getElementById('single-model-pill-btn').click();
  await tick(); await tick();
  const list = f.doc.getElementById('single-model-popover-list');
  assert.deepEqual(Array.from(list.querySelectorAll('[data-model-id]')).map(el => el.dataset.modelId), ['auto', ...f.models.map(m => m.id)]);
  assert.equal(list.querySelectorAll('script').length, 0);
  assert.match(list.textContent, /<script>untrusted<\/script>/);
  const target = Array.from(list.querySelectorAll('[data-model-id]'))[2];
  target.click();
  await tick(); await tick();
  assert.equal(f.calls.at(-1).action, 'SELECT_MODEL');
  assert.equal(f.calls.at(-1).model, f.models[1].id);
  assert.equal(f.doc.getElementById('single-chat-model-text').textContent, f.models[1].label);
  assert.match(f.doc.getElementById('cgq-dash-toast').textContent, /に切り替えました/);
  f.dom.window.close();
});

test('failed selection retains the confirmed current model and displays the error', async () => {
  const f = await dashboard({ failSwitch: true });
  f.doc.getElementById('single-model-pill-btn').click();
  await tick(); await tick();
  Array.from(f.doc.querySelectorAll('#single-model-popover-list [data-model-id]'))[2].click();
  await tick(); await tick();
  assert.equal(f.doc.getElementById('single-chat-model-text').textContent, 'GPT-6');
  assert.match(f.doc.getElementById('cgq-dash-toast').textContent, /切り替え未確認/);
  assert.doesNotMatch(f.doc.getElementById('cgq-dash-toast').textContent, /切り替えました/);
  f.dom.window.close();
});

test('grid view also refreshes and selects only discovered models', async () => {
  const f = await dashboard();
  f.doc.getElementById('nav-all-grid').click();
  f.doc.querySelector('.card-model-pill').click();
  await tick(); await tick();
  const items = Array.from(f.doc.querySelectorAll('.card-model-popover [data-model-id]'));
  assert.deepEqual(items.map(el => el.dataset.modelId), ['auto', ...f.models.map(m => m.id)]);
  assert.ok(f.doc.querySelector('.card-model-popover [data-refresh-models]'));
  items[2].click();
  await tick(); await tick();
  assert.equal(f.doc.querySelector('.card-model-label').textContent, f.models[1].label);
  f.dom.window.close();
});

test('an empty catalog offers the current-setting option without fabricated model names', async () => {
  const f = await dashboard({ noModels: true });
  f.doc.getElementById('single-model-pill-btn').click();
  await tick(); await tick();
  const list = f.doc.getElementById('single-model-popover-list');
  assert.deepEqual(Array.from(list.querySelectorAll('[data-model-id]')).map(el => el.dataset.modelId), ['auto']);
  assert.equal(list.querySelector('[data-model-id="auto"] .cgq-popover-item-title').textContent, 'Auto');
  assert.match(list.textContent, /モデル一覧を取得してください/);
  assert.doesNotMatch(list.textContent, /GPT-4o|Gemini 1\.5|o3-mini/);
  f.dom.window.close();
});

for (const marked of [true, false]) {
  test(`source metadata renders in both dashboard views using ${marked ? 'bundled Marked' : 'fallback parsing'}`, async () => {
    const refs = require('../references.js');
    const token = refs.token({ url: 'https://example.com/article?x=1&y=2', title: '引用元の記事', icon: 'https://example.com/icon.png' });
    const f = await dashboard({ answer: `本文【重要】 ${token}\n\n\`【4:0†https://example.net/code】\``, marked });
    for (const view of ['single', 'grid']) {
      if (view === 'grid') f.doc.getElementById('nav-all-grid').click();
      const area = f.doc.querySelector(view === 'single' ? '#single-answers-area' : '#tabs-grid');
      const card = area.querySelector('a.cgq-source-card');
      assert.equal(card?.getAttribute('href'), 'https://example.com/article?x=1&y=2');
      assert.equal(card.querySelector('.cgq-source-name').textContent, '引用元の記事');
      assert.equal(card.querySelector('img').getAttribute('src'), 'https://example.com/icon.png');
      assert.match(area.textContent, /本文【重要】/);
      assert.equal(area.querySelector('code').textContent, '【4:0†https://example.net/code】');
      assert.equal(area.querySelectorAll('.cgq-source-card').length, 1);
    }
    f.dom.window.close();
  });
}

test('bundled Markdown table renderer preserves references inside cells', async () => {
  const refs = require('../references.js');
  const token = refs.token({ url: 'https://example.com/source', title: '表の引用元' });
  const f = await dashboard({ answer: `| 資料 | 参照元 |\n| --- | --- |\n| 公開資料 | ${token} |`, marked: true });
  const cell = f.doc.querySelector('#single-answers-area table tbody td:last-child');
  assert.equal(cell.querySelector('a.cgq-source-card').href, 'https://example.com/source');
  assert.equal(cell.querySelector('a').textContent, '表の引用元');
  assert.doesNotMatch(f.doc.getElementById('single-answers-area').textContent, /\[object Object\]/);
  f.dom.window.close();
});
