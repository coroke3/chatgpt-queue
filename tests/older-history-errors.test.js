const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));
const root = path.join(__dirname, '..');
const turn = n => ({ turn: n, prompt: `質問${n}`, answer: `回答${n}`, isStreaming: false });

async function fixture(t, mode = 'single') {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8'), {
    url: 'https://extension-preview.test/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom; t.after(() => window.close());
  const tab = { tabId: 'tab_1', chromeTabId: 7, platform: 'chatgpt', title: '会話', url: 'https://chatgpt.com/c/test',
    lastHeartbeat: Date.now(), currentState: 'idle', items: [], recentQA: [turn(3), turn(4)] };
  const requests = [], timeouts = [];
  let now = Date.now(); window.Date.now = () => now;
  const timeout = window.setTimeout.bind(window);
  window.setTimeout = (fn, ms) => ms === 8000 ? (timeouts.push(fn), 0) : timeout(fn, ms);
  window.setInterval = () => 0;
  window.chrome = {
    storage: { local: { get: async () => ({ cgq_tabs_registry: { tab_1: tab } }), set: async () => {} }, onChanged: { addListener() {} } },
    runtime: { sendMessage() {} }, tabs: {
      query: (query, callback) => callback([{ id: 7, title: tab.title, url: tab.url }]),
      sendMessage: (id, request, callback) => { if (request.action === 'GET_OLDER_HISTORY') requests.push(callback); else callback?.(null); }
    }
  };
  for (const file of ['references.js', 'libs/marked.min.js', 'composer-tools.js', 'dashboard.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  await tick(); await tick();
  if (mode === 'single') window.document.querySelector('.cgq-sidebar-chat-item').click();
  await tick();
  const area = mode === 'single' ? window.document.getElementById('single-answers-area') : window.document.querySelector('.cgq-tab-view[data-view="results"]');
  const scroller = mode === 'single' ? window.document.getElementById('single-chat-body') : area;
  const load = () => scroller.dispatchEvent(new window.WheelEvent('wheel', { deltaY: -100 }));
  return { window, area, scroller, requests, timeouts, load, advance: () => { now += 16000; } };
}

test('single and grid history failures retain answers and display the requested status', async t => {
  for (const mode of ['single', 'grid']) for (const response of [null, { success: false }, { success: true, turns: [turn(3), turn(4)], exhausted: true }]) {
    const f = await fixture(t, mode);
    f.load();
    assert.equal(f.area.querySelector('[role="status"]').textContent, '過去のログを読み込み中…');
    f.requests[0](response); await tick();
    assert.equal(f.area.querySelector('[role="status"]').textContent, 'ログが取得できません');
    assert.match(f.area.textContent, /質問3/);
    f.load(); assert.equal(f.requests.length, 1, 'repeat scrolls are throttled');
    f.advance(); f.load();
    f.requests[1]({ success: true, turns: [turn(1), turn(2), turn(3), turn(4)] }); await tick();
    assert.equal(f.area.querySelector('[role="status"]'), null);
    assert.ok(f.area.textContent.indexOf('質問1') < f.area.textContent.indexOf('質問3'));
  }
});

test('timed out responses cannot complete a later history request', async t => {
  const f = await fixture(t);
  f.load(); f.timeouts[0]();
  assert.equal(f.area.querySelector('[role="status"]').textContent, 'ログが取得できません');
  f.advance(); f.load();
  f.requests[0]({ success: true, turns: [turn(2), turn(3), turn(4)] });
  assert.equal(f.area.querySelector('[role="status"]').textContent, '過去のログを読み込み中…');
  f.requests[1]({ success: true, turns: [turn(1), turn(2), turn(3), turn(4)] });
  assert.match(f.area.textContent, /質問1/);
  assert.equal(f.area.querySelector('[role="status"]'), null);
});

test('subsequent virtualized pages preserve already retrieved history without duplicates', async t => {
  const f = await fixture(t);
  f.load(); f.requests[0]({ success: true, turns: [turn(1), turn(2), turn(3), turn(4)] });
  f.load(); f.requests[1]({ success: true, turns: [turn(0), turn(1), turn(2)] });
  const text = f.area.textContent;
  for (let n = 0; n <= 4; n++) assert.equal((text.match(new RegExp(`質問${n}`, 'g')) || []).length, 1);
  assert.ok(text.indexOf('質問0') < text.indexOf('質問1'));
});
