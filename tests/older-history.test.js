const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('scrolling to the top of a chat fetches older turns from the tab and prepends them', async t => {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8'), {
    url: 'https://extension-preview.test/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  t.after(() => window.close());
  const turn = n => ({ turn: n, prompt: `質問${n}`, answer: `回答${n}`, isStreaming: false });
  const tab = { tabId: 'tab_1', chromeTabId: 7, platform: 'chatgpt', title: '長い会話', url: 'https://chatgpt.com/c/long',
    lastHeartbeat: Date.now(), currentState: 'idle', items: [], recentQA: [turn(3), turn(4)],
    latestAnswer: { userPrompt: '質問4', text: '回答4', isStreaming: false } };
  const requests = [];
  window.setInterval = () => 0;
  window.chrome = {
    storage: { local: { get: async () => ({ cgq_tabs_registry: { tab_1: tab } }), set: async () => {} }, onChanged: { addListener() {} } },
    runtime: { sendMessage() {} },
    tabs: { query(filter, respond) { respond([{ id: 7, title: tab.title, url: tab.url }]); }, sendMessage(id, request, respond) {
      requests.push(request.action);
      if (request.action === 'GET_OLDER_HISTORY') respond({ success: true, turns: [turn(1), turn(2), turn(3), turn(4)], exhausted: false });
      else respond?.(null);
    } }
  };
  for (const file of ['references.js', 'libs/marked.min.js', 'composer-tools.js', 'dashboard.js']) {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  }
  await tick(); await tick();
  window.document.querySelector('.cgq-sidebar-chat-item')?.click();
  await tick();
  const area = window.document.getElementById('single-answers-area');
  assert.ok(!area.textContent.includes('質問1'));

  const body = window.document.getElementById('single-chat-body');
  body.scrollTop = 0;
  body.dispatchEvent(new window.Event('scroll'));
  await tick(); await tick();

  assert.ok(requests.includes('GET_OLDER_HISTORY'));
  const text = area.textContent;
  assert.ok(text.indexOf('質問1') >= 0 && text.indexOf('質問1') < text.indexOf('質問2') && text.indexOf('質問2') < text.indexOf('質問3'),
    'older turns are prepended in order, before the ones already shown');
  assert.equal((text.match(/質問3/g) || []).length, 1, 'the overlap with the heartbeat window is not duplicated');
});

test('settings sliders set the answer text size and the minimum card width, and save them', async t => {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8'), {
    url: 'https://extension-preview.test/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  t.after(() => window.close());
  const saved = [];
  window.setInterval = () => 0;
  window.chrome = {
    storage: { local: { get: async () => ({ cgq_user_settings: { answerFontSize: 16 } }), set: async value => { saved.push(value); } }, onChanged: { addListener() {} } },
    runtime: { sendMessage() {} },
    tabs: { query(filter, respond) { respond([]); }, sendMessage() {} }
  };
  // The dashboard reads settings with the callback form too.
  const get = window.chrome.storage.local.get;
  window.chrome.storage.local.get = (keys, callback) => { const p = get(keys); if (callback) p.then(callback); return p; };
  for (const file of ['references.js', 'libs/marked.min.js', 'composer-tools.js', 'dashboard.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  await tick(); await tick();
  const rootStyle = window.document.documentElement.style;
  assert.equal(rootStyle.getPropertyValue('--answer-size'), '16', 'saved size is applied on load');

  window.document.getElementById('btn-footer-settings')?.click();
  await tick();
  const size = window.document.getElementById('setting-answer-size');
  size.value = '12';
  size.dispatchEvent(new window.Event('input'));
  const width = window.document.getElementById('setting-card-min-width');
  width.value = '420';
  width.dispatchEvent(new window.Event('input'));
  await tick();
  assert.equal(rootStyle.getPropertyValue('--answer-size'), '12');
  assert.equal(rootStyle.getPropertyValue('--card-min-width'), '420px');
  const last = saved[saved.length - 1].cgq_user_settings;
  assert.equal(last.answerFontSize, 12);
  assert.equal(last.cardMinWidth, 420);
});

test('the same answer read twice with small differences is shown once, not twice in a row', async t => {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8'), {
    url: 'https://extension-preview.test/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  t.after(() => window.close());
  const tab = { tabId: 'tab_d', chromeTabId: 5, platform: 'chatgpt', title: '重複', url: 'https://chatgpt.com/c/dup',
    lastHeartbeat: Date.now(), currentState: 'idle', items: [],
    // The tab's list already carries a repeated turn, and the latest answer is read from another element.
    recentQA: [
      { turn: 1, prompt: '最初の質問', answer: '最初の回答です。', isStreaming: false },
      { turn: 2, prompt: '次の質問', answer: '## 結論\n回答本文です。', isStreaming: false },
      { turn: 3, prompt: '次の質問 ', answer: '## 結論\n\n回答本文です。\n\n参照: 出典A', isStreaming: false }
    ],
    latestAnswer: { userPrompt: '次の質問\n', text: '結論\n回答本文です。 参照: 出典A', isStreaming: false } };
  window.setInterval = () => 0;
  window.chrome = {
    storage: { local: { get: async () => ({ cgq_tabs_registry: { tab_d: tab } }), set: async () => {} }, onChanged: { addListener() {} } },
    runtime: { sendMessage() {} },
    tabs: { query(filter, respond) { respond([{ id: 5, title: tab.title, url: tab.url }]); }, sendMessage(id, request, respond) { respond?.(null); } }
  };
  for (const file of ['references.js', 'libs/marked.min.js', 'composer-tools.js', 'dashboard.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  await tick(); await tick();
  window.document.querySelector('.cgq-sidebar-chat-item')?.click();
  await tick();
  const cards = window.document.querySelectorAll('#single-answers-area .cgq-answer-card');
  assert.equal(cards.length, 2, 'two real turns, no repeated one');
  assert.match(cards[1].textContent, /出典A/, 'the later, fuller reading is kept');
});
