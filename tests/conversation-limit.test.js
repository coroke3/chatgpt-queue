const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const warning = 'この会話は長さの上限に到達していますが、新しいチャットを始めて会話を続けることができます。';
const markerKey = 'cgq_chat_rollover';
const root = path.join(__dirname, '..');

function fixture(t, { url = 'https://chatgpt.com/c/old-chat', html = '', data = {}, session = {} } = {}) {
  const dom = new JSDOM(`<!doctype html><body><main>${html}</main></body>`, {
    url, runScripts: 'outside-only', pretendToBeVisual: true
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  Object.entries(session).forEach(([key, value]) => window.sessionStorage.setItem(key, value));
  window.chrome = { storage: { local: {
    get: async keys => Object.fromEntries(keys.map(key => [key, data[key]])),
    set: async values => Object.assign(data, JSON.parse(JSON.stringify(values)))
  } } };
  for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  }
  window.eval(fs.readFileSync(path.join(root, 'content.js'), 'utf8')
    .replace('const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));',
      'const sleep = async () => { if (globalThis.__stopLoop?.()) throw new Error("TEST_STOP"); };')
    .replace('  const queueManager = new QueueManager();',
      '  globalThis.__test = { QueueManager, DOM, HumanSimulator }; return;\n  const queueManager = new QueueManager();'));
  const { QueueManager, DOM, HumanSimulator } = window.__test;
  const queue = new QueueManager();
  queue.notify = () => {};
  Object.assign(queue.settings, { minReadDelay: 0, maxReadDelay: 0, autoScroll: false, soundNotification: false });
  return { window, queue, DOM, HumanSimulator, data };
}

test('detects Japanese and English limit notices, including split text and portal alerts', t => {
  const f = fixture(t, { html: `<div><span>この会話は長さの上限に</span><span>到達していますが、新しいチャットを始めて会話を続けることができます。</span></div>` });
  assert.ok(f.DOM.getConversationLimitWarning());
  f.window.document.querySelector('main').innerHTML = '';
  f.window.document.body.insertAdjacentHTML('beforeend', `<div role="alert">You've reached the maximum length for this conversation, but you can keep talking by starting a new chat.</div>`);
  assert.ok(f.DOM.getConversationLimitWarning());
});

test('ignores quoted messages, code, extension UI, hidden notices, and unrelated limits', t => {
  const f = fixture(t);
  for (const html of [
    `<div data-message-author-role="user"><div role="alert">${warning}</div></div>`,
    `<div data-message-author-role="assistant"><p>${warning}</p></div>`,
    `<div class="markdown"><p>${warning}</p></div>`,
    `<pre><code>${warning}</code></pre>`,
    `<div id="cgq-panel"><p>${warning}</p></div>`,
    `<div hidden><div role="alert">${warning}</div></div>`,
    `<div style="display:none"><p>${warning}</p></div>`,
    `<div aria-hidden="true"><p>${warning}</p></div>`,
    '<div role="alert">You have reached your message limit. Try again later.</div>'
  ]) {
    f.window.document.querySelector('main').innerHTML = html;
    assert.equal(f.DOM.getConversationLimitWarning(), null, html);
  }
});

test('Gemini never triggers ChatGPT conversation rollover', async t => {
  const f = fixture(t, { url: 'https://gemini.google.com/app/test', html: `<div role="alert">${warning}</div>` });
  assert.equal(f.DOM.getConversationLimitWarning(), null);
  assert.equal(await f.queue.checkConversationLimitAndStartNewChat(), false);
});

test('navigates only once and transfers the ordered queue across a full page load', async t => {
  const f = fixture(t, { html: `<div role="alert">${warning}</div>` });
  const items = [
    { id: 'first', text: 'Continue', model: 'model-id', effort: 'high', tools: [{ type: 'tool', id: 'search' }] },
    { id: 'second', text: 'Then this' }
  ];
  f.queue.items = items;
  f.queue.isPaused = true;
  let navigations = 0;
  let destination;
  f.queue.navigateToNewChat = url => { navigations++; destination = url; };
  await f.queue.checkConversationLimitAndStartNewChat();
  await f.queue.checkConversationLimitAndStartNewChat();
  assert.equal(navigations, 1);
  assert.equal(destination, 'https://chatgpt.com/');
  assert.deepEqual(f.data[f.queue.storageKeyQueue], items);

  const next = fixture(t, { url: destination, data: f.data, session: {
    cgq_tab_id: f.window.sessionStorage.getItem('cgq_tab_id'),
    [markerKey]: f.window.sessionStorage.getItem(markerKey)
  } });
  await next.queue.loadFromStorage();
  assert.equal(await next.queue.restoreConversationRollover(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(next.queue.items)), items);
  assert.equal(next.queue.previousTabId, f.queue.tabId);
  assert.equal(next.queue.isPaused, true);
  assert.deepEqual(f.data[f.queue.storageKeyQueue], []);
  assert.deepEqual(f.data[next.queue.storageKeyQueue], items);
  assert.equal(next.window.sessionStorage.getItem(markerKey), null);
  assert.equal(await next.queue.restoreConversationRollover(), false);
});

test('keeps the custom GPT and model query when opening the next chat', t => {
  const f = fixture(t, { url: 'https://chatgpt.com/g/g-custom-assistant/c/old-chat?model=test#bottom' });
  assert.equal(f.DOM.getNewChatUrl(), 'https://chatgpt.com/g/g-custom-assistant?model=test');
});

test('the restored queue resumes automatic sending once and does not populate another chat', async t => {
  const f = fixture(t, { html: `<div role="alert">${warning}</div>` });
  f.queue.items = [{ id: 'continue', text: 'Next prompt' }];
  f.queue.navigateToNewChat = () => {};
  await f.queue.checkConversationLimitAndStartNewChat();
  const session = {
    cgq_tab_id: f.window.sessionStorage.getItem('cgq_tab_id'),
    [markerKey]: f.window.sessionStorage.getItem(markerKey)
  };
  const other = fixture(t, { url: 'https://chatgpt.com/c/unrelated', data: f.data, session });
  assert.equal(await other.queue.restoreConversationRollover(), false);
  assert.equal(other.queue.items.length, 0);
  assert.equal(f.data[f.queue.storageKeyQueue][0].id, 'continue');

  const next = fixture(t, { url: 'https://chatgpt.com/', html: '<textarea id="prompt-textarea"></textarea>', data: f.data, session });
  await next.queue.loadFromStorage();
  await next.queue.restoreConversationRollover();
  assert.equal(next.queue.isPaused, false);
  next.DOM.getLastResponseLength = () => 0;
  next.HumanSimulator.typeText = async () => true;
  let sends = 0;
  let iterations = 0;
  next.HumanSimulator.clickSend = async text => {
    assert.equal(text, 'Next prompt');
    sends++;
    return true;
  };
  next.window.__stopLoop = () => sends > 0 || ++iterations > 100;
  await assert.rejects(next.queue.startLoop(), /TEST_STOP/);
  assert.equal(sends, 1);
  assert.equal(next.queue.items.length, 0);
  assert.deepEqual(next.data[next.queue.storageKeyQueue], []);
});

test('failed queue migration retains the recovery marker and original queue', async t => {
  const f = fixture(t, { html: `<div role="alert">${warning}</div>` });
  f.queue.items = [{ id: 'keep', text: 'Recover me' }];
  f.queue.navigateToNewChat = () => {};
  await f.queue.checkConversationLimitAndStartNewChat();
  const next = fixture(t, { url: 'https://chatgpt.com/', data: f.data, session: {
    cgq_tab_id: f.window.sessionStorage.getItem('cgq_tab_id'),
    [markerKey]: f.window.sessionStorage.getItem(markerKey)
  } });
  next.window.chrome.storage.local.set = async () => { throw new Error('write failed'); };
  assert.equal(await next.queue.restoreConversationRollover(), false);
  assert.equal(next.queue.isPaused, true);
  assert.ok(next.window.sessionStorage.getItem(markerKey));
  assert.equal(f.data[f.queue.storageKeyQueue][0].id, 'keep');
});

test('navigation failure and timeout pause without losing the source queue', async t => {
  for (const throws of [true, false]) {
    const f = fixture(t, { html: `<div role="alert">${warning}</div>` });
    f.queue.items = [{ id: 'keep', text: 'Retain this' }];
    f.queue.navigateToNewChat = () => { if (throws) throw new Error('navigation failed'); };
    await f.queue.checkConversationLimitAndStartNewChat();
    if (!throws) {
      f.queue.switchingChatSince = Date.now() - 16000;
      await f.queue.checkConversationLimitAndStartNewChat();
    }
    assert.equal(f.queue.isPaused, true);
    assert.equal(f.queue.items[0].id, 'keep');
    assert.equal(f.data[f.queue.storageKeyQueue][0].id, 'keep');
    assert.equal(f.window.sessionStorage.getItem(markerKey), null);
  }
});

test('storage failure prevents navigation and retains queued work', async t => {
  const f = fixture(t, { html: `<div role="alert">${warning}</div>` });
  f.queue.items = [{ id: 'keep', text: 'Retain this' }];
  f.window.chrome.storage.local.set = async () => { throw new Error('storage unavailable'); };
  f.queue.navigateToNewChat = () => assert.fail('must persist before navigating');
  await f.queue.checkConversationLimitAndStartNewChat();
  assert.equal(f.queue.isPaused, true);
  assert.equal(f.queue.items[0].id, 'keep');
});

test('the loop opens a new chat even when the composer and queue are empty', async t => {
  const f = fixture(t, { html: `<div role="alert">${warning}</div>` });
  let navigated = false;
  f.queue.navigateToNewChat = () => { navigated = true; };
  f.window.__stopLoop = () => navigated;
  await assert.rejects(f.queue.startLoop(), /TEST_STOP/);
  assert.equal(navigated, true);
});

test('a submission rejected by the limit is retained instead of confirmed by its user bubble', async t => {
  const f = fixture(t, { html: '<textarea id="prompt-textarea"></textarea>' });
  f.queue.items = [{ id: 'retry', text: 'Please continue' }];
  f.DOM.getLastResponseLength = () => 0;
  f.HumanSimulator.typeText = async () => true;
  f.HumanSimulator.clickSend = async () => {
    f.window.document.querySelector('main').insertAdjacentHTML('beforeend', `<div role="alert">${warning}</div>`);
    return true;
  };
  let navigated = false;
  let iterations = 0;
  f.queue.navigateToNewChat = () => { navigated = true; };
  f.window.__stopLoop = () => navigated || ++iterations > 100;
  await assert.rejects(f.queue.startLoop(), /TEST_STOP/);
  assert.equal(navigated, true);
  assert.equal(f.queue.items[0].id, 'retry');
  assert.equal(f.data[f.queue.storageKeyQueue][0].id, 'retry');
});
