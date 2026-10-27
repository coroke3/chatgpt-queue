const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function native(t, platform = 'chatgpt') {
  const dom = new JSDOM('<!doctype html><body><main></main><form><textarea id="prompt-textarea"></textarea><button type="submit" data-testid="send-button">Send</button></form></body>', {
    url: platform === 'gemini' ? 'https://gemini.google.com/app/test' : 'https://chatgpt.com/c/test', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom; t.after(() => window.close());
  const data = {};
  let clock = Date.now(), listener;
  window.Date.now = () => clock;
  window.__wait = async ms => { clock += ms; await window.__duringWait?.(ms); };
  window.chrome = { storage: { local: {
    get: async keys => Object.fromEntries(keys.map(key => [key, data[key]])),
    set: async values => Object.assign(data, JSON.parse(JSON.stringify(values)))
  } }, runtime: { onMessage: { addListener(fn) { listener = fn; } } } };
  for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) window.eval(read(file));
  window.eval(read('content.js')
    .replace('const sleep = (ms) => globalThis.CGQQueueTiming?.wait(ms) || new Promise(resolve => setTimeout(resolve, ms));', 'const sleep = async ms => globalThis.__wait(ms);')
    .replace(/  queueManager\.init\(\)\.then\(\(\) => \{\s*new QueueUI\(queueManager\);\s*\}\);/, '  globalThis.__basic = { queueManager, DOM, HumanSimulator };'));
  const { queueManager: queue, DOM, HumanSimulator: human } = window.__basic;
  queue.notify = () => {};
  Object.assign(queue.settings, { minReadDelay: 0, maxReadDelay: 0, autoScroll: false, soundNotification: false });
  const input = window.document.querySelector('textarea');
  DOM.getPromptInput = () => input;
  return { window, queue, DOM, human, data, input, message: (request, response) => listener(request, {}, response) };
}

test('send evidence excludes historical repeats, truncated matches, unrelated turns and an empty editor alone', async t => {
  const f = native(t);
  const old = f.window.document.createElement('div'); old.dataset.messageAuthorRole = 'user';
  old.textContent = 'Repeated question'; f.window.document.querySelector('main').append(old);
  f.input.value = 'Repeated question';
  assert.equal(await f.human.confirmSent('Repeated question', old, 250), false);
  f.input.value = '';
  assert.equal(await f.human.confirmSent('Repeated question', old, 250), false);
  const next = old.cloneNode(true); next.textContent = 'Unrelated question'; old.after(next);
  assert.equal(f.human.hasSendEvidence('Repeated question', old, old.textContent), false);
  next.textContent = 'x'.repeat(45) + 'different ending';
  assert.equal(f.human.hasSendEvidence('x'.repeat(45) + 'requested ending', old, old.textContent), false);
  next.textContent = 'Repeated question';
  assert.equal(f.human.hasSendEvidence('Repeated question', old, old.textContent), true);
});

test('an unacknowledged click never resubmits a cleared editor or presses a generation stop control', async t => {
  for (const mode of ['cleared', 'stop']) {
    const f = native(t);
    const button = f.window.document.querySelector('button');
    f.input.value = 'Question';
    let clicks = 0, submits = 0, enters = 0;
    button.addEventListener('click', event => { event.preventDefault(); clicks++; f.input.value = ''; });
    f.window.document.querySelector('form').addEventListener('submit', event => { event.preventDefault(); submits++; });
    f.input.addEventListener('keydown', () => enters++);
    if (mode === 'stop') {
      button.disabled = true;
      f.window.__duringWait = () => { button.disabled = false; button.dataset.testid = 'stop-button'; button.setAttribute('aria-label', 'Stop'); };
    }
    assert.equal(await f.human.clickSend('Question'), false, mode);
    assert.equal(clicks, mode === 'cleared' ? 1 : 0);
    assert.equal(submits, 0); assert.equal(enters, 0);
  }
});

test('a rejected duplicate question remains queued instead of being confirmed by history', async t => {
  const f = native(t);
  f.window.document.querySelector('main').innerHTML = '<div data-message-author-role="user">Same question</div>';
  await f.queue.enqueue('Same question');
  f.queue.lastSentPrompt = 'Same question';
  f.human.typeText = async (_, text) => { f.input.value = text; return true; };
  f.human.clickSend = async () => false;
  await f.queue.runLoopStep(); await f.queue.runLoopStep();
  assert.equal(f.queue.items.length, 1);
  assert.equal(f.queue.isPaused, true);
});

test('runtime queue additions acknowledge saved items, keep model options, and reject stale conversations', async t => {
  for (const platform of ['chatgpt', 'gemini']) {
    const f = native(t, platform);
    let release;
    const save = f.window.chrome.storage.local.set;
    f.window.chrome.storage.local.set = values => new Promise(resolve => { release = async () => { await save(values); resolve(); }; });
    let response;
    assert.equal(f.message({ action: 'ADD_TO_TAB_QUEUE', expectedTabId: f.queue.tabId, text: 'First\nsecond', model: 'chosen', effort: 'high' }, value => { response = value; }), true);
    await tick(); assert.equal(response, undefined);
    await release(); await tick();
    assert.equal(response.success, true);
    assert.equal(f.data[f.queue.storageKeyQueue][0].text, 'First\nsecond');
    assert.equal(response.item.model, 'chosen'); assert.equal(response.item.effort, 'high');
    f.window.chrome.storage.local.set = async () => { throw new Error('quota'); };
    response = null;
    f.message({ action: 'ADD_MANY_TO_TAB_QUEUE', expectedTabId: f.queue.tabId, texts: ['Unsaved'] }, value => { response = value; });
    await tick(); assert.equal(response.success, false); assert.equal(f.queue.items.length, 1);
    response = null;
    f.message({ action: 'ADD_TO_TAB_QUEUE', expectedTabId: 'old-conversation', text: 'Wrong chat' }, value => { response = value; });
    assert.equal(response.success, false); assert.equal(f.queue.items.length, 1);
    f.window.history.pushState({}, '', platform === 'gemini' ? '/app/another' : '/c/another');
    f.message({ action: 'ADD_TO_TAB_QUEUE', expectedTabId: f.queue.tabId, text: 'Wrong chat' }, value => { response = value; });
    assert.equal(response.success, false); assert.equal(f.queue.items.length, 1);
  }
});

async function dashboard(t, mode = 'single') {
  const dom = new JSDOM(read('dashboard.html'), { runScripts: 'outside-only', url: 'https://queue.test/', pretendToBeVisual: true });
  const { window } = dom; t.after(() => window.close());
  const states = [1, 2].map(id => ({ tabId: `chat_${id}`, chromeTabId: id, platform: 'chatgpt', url: `https://chatgpt.com/c/chat${id}`, title: `Chat ${id}`, items: [], lastHeartbeat: Date.now() }));
  const pending = [];
  window.setInterval = () => 0;
  window.chrome = { runtime: { sendMessage() {} }, storage: {
    local: { get: async () => ({ cgq_tabs_registry: Object.fromEntries(states.map(s => [s.tabId, s])) }), set: async () => {} }, onChanged: { addListener() {} }
  }, tabs: {
    query: (_, done) => done(states.map(s => ({ id: s.chromeTabId, url: s.url, title: s.title }))),
    sendMessage(id, request, done) {
      if (request.action.startsWith('ADD_')) pending.push({ id, request, done });
      else done({ success: true, state: states.find(s => s.chromeTabId === id) });
    }
  } };
  for (const file of ['references.js', 'composer-tools.js', 'dashboard.js']) window.eval(read(file));
  await tick(); await tick();
  if (mode === 'single') window.document.querySelector('[data-tab-id="chat_1"].cgq-sidebar-chat-item').click();
  const input = mode === 'single' ? window.document.getElementById('single-chat-input') : window.document.querySelector('.cgq-dash-prompt-input');
  const add = () => input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  return { window, input, pending, add };
}

test('dashboard single and grid drafts survive failed saves and edits while awaiting acknowledgement', async t => {
  for (const mode of ['single', 'grid']) {
    const f = await dashboard(t, mode);
    f.input.value = 'Keep\nthis'; f.add(); f.add();
    f.input.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(f.pending.length, 1); assert.equal(f.input.value, 'Keep\nthis');
    f.pending[0].done({ success: false });
    assert.equal(f.input.value, 'Keep\nthis');
    f.add(); f.input.value = 'New draft';
    f.pending[1].done({ success: true });
    assert.equal(f.input.value, 'New draft');
    f.add(); f.pending[2].done({ success: true });
    assert.equal(f.input.value, '');
  }
});

test('a queue save acknowledgement after switching chats never clears the other chat draft', async t => {
  const f = await dashboard(t);
  f.input.value = 'Same text'; f.input.dispatchEvent(new f.window.Event('input')); f.add();
  f.window.document.querySelector('.cgq-sidebar-chat-item[data-tab-id="chat_2"]').click();
  f.input.value = 'Same text'; f.input.dispatchEvent(new f.window.Event('input'));
  f.pending[0].done({ success: true });
  assert.equal(f.input.value, 'Same text');
  f.window.document.querySelector('.cgq-sidebar-chat-item[data-tab-id="chat_1"]').click();
  assert.equal(f.input.value, '');
});

test('partial bulk save keeps the modal and retries only targets not already saved', async t => {
  const f = await dashboard(t);
  const doc = f.window.document;
  doc.getElementById('nav-bulk-add').click();
  doc.getElementById('bulk-modal-target-tab').value = '__ALL__';
  const input = doc.getElementById('bulk-modal-textarea'); input.value = 'First\nsecond';
  const button = doc.getElementById('bulk-modal-submit'); button.click(); button.click();
  assert.equal(f.pending.length, 2); assert.equal(input.disabled, true);
  f.pending[0].done({ success: true }); f.pending[1].done({ success: false });
  await tick();
  assert.equal(input.value, 'First\nsecond'); assert.equal(input.disabled, false);
  assert.equal(doc.getElementById('dashboard-bulk-modal').style.display, 'flex');
  button.click(); assert.equal(f.pending.length, 3); assert.equal(f.pending[2].id, f.pending[1].id);
  f.pending[2].done({ success: true }); await tick();
  assert.equal(input.value, ''); assert.equal(doc.getElementById('dashboard-bulk-modal').style.display, 'none');
});
