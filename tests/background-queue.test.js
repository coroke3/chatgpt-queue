const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');

function worker(setTimeout) {
  let handler;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), {
    console: { log() {} }, setTimeout,
    chrome: { runtime: { onMessage: { addListener: fn => { handler = fn; } } } }
  });
  return handler;
}

test('worker waits accept only bounded delays from service tabs and never focus a tab', () => {
  const scheduled = [];
  const handler = worker((fn, ms) => scheduled.push({ fn, ms }));
  for (const url of ['https://gemini.google.com/app/test', 'https://chatgpt.com/c/test']) {
    let response;
    assert.equal(handler({ action: 'QUEUE_WAIT', delay: 600 }, { tab: { url } }, value => { response = value; }), true);
    assert.equal(response, undefined);
    assert.equal(scheduled.at(-1).ms, 600);
    scheduled.at(-1).fn();
    assert.equal(response.success, true); assert.equal(response.waited, 600);
  }
  const count = scheduled.length;
  for (const [delay, sender] of [[-1, { tab: { url: 'https://gemini.google.com/app' } }], [10001, { tab: { url: 'https://gemini.google.com/app' } }],
    [0.5, { tab: { url: 'https://gemini.google.com/app' } }], [10, {}], [10, { tab: { url: 'https://gemini.google.com.evil.test/app' } }]]) {
    let response;
    assert.equal(handler({ action: 'QUEUE_WAIT', delay }, sender, value => { response = value; }), false);
    assert.equal(response.success, false);
  }
  assert.equal(scheduled.length, count);
});

test('visible pages keep local waits, and worker errors fall back without advancing early', async t => {
  const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' }); t.after(() => dom.window.close());
  const { window } = dom;
  let hidden = false, callback;
  const scheduled = [], messages = [];
  Object.defineProperty(window.document, 'hidden', { get: () => hidden });
  window.setTimeout = (fn, delay) => { scheduled.push({ fn, delay }); return scheduled.length; };
  window.chrome = { runtime: { sendMessage: (message, done) => { messages.push(message); callback = done; } } };
  window.eval(fs.readFileSync(path.join(root, 'queue-timing.js'), 'utf8'));
  let done = false;
  const visible = window.CGQQueueTiming.wait(100).then(() => { done = true; });
  assert.equal(messages.length, 0); assert.equal(done, false);
  scheduled.shift().fn(); await visible;
  hidden = true; done = false;
  const unavailable = window.CGQQueueTiming.wait(150).then(() => { done = true; });
  window.chrome.runtime.lastError = { message: 'Worker disconnected' };
  callback(undefined); delete window.chrome.runtime.lastError;
  await Promise.resolve();
  assert.equal(done, false);
  assert.equal(scheduled[0].delay, 150);
  scheduled.shift().fn(); await unavailable;
  assert.equal(done, true);
});

test('hidden Gemini injects and sends consecutive multiline items with page timers frozen', { timeout: 5000 }, async t => {
  const dom = new JSDOM('<!doctype html><body><rich-textarea><div class="ql-editor" contenteditable="true" role="textbox"><p><br></p></div></rich-textarea><button class="send-button" aria-label="プロンプトを送信" disabled>Send</button></body>', {
    url: 'https://gemini.google.com/app/test', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom; t.after(() => window.close());
  Object.defineProperty(window.document, 'hidden', { value: true });
  Object.defineProperty(window.document, 'visibilityState', { value: 'hidden' });
  const pageTimers = [], waits = [], sent = [], stored = {};
  window.setTimeout = (fn, delay) => { pageTimers.push(delay); return pageTimers.length; };
  let clock = Date.now(); window.Date.now = () => clock;
  const handleWait = worker((fn, ms) => { waits.push(ms); clock += ms; queueMicrotask(fn); });
  window.chrome = { runtime: {
    sendMessage: (request, callback) => handleWait(request, { tab: { url: window.location.href } }, callback)
  }, storage: { local: {
    get: async keys => Object.fromEntries(keys.filter(key => key in stored).map(key => [key, stored[key]])),
    set: async values => { Object.assign(stored, JSON.parse(JSON.stringify(values))); }
  } } };
  for (const file of ['queue-timing.js', 'references.js', 'model-picker.js', 'composer-tools.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'content.js'), 'utf8').replace(
    '  const queueManager = new QueueManager();',
    '  globalThis.__test = { QueueManager, DOM, modelPicker, composerTools }; return;\n  const queueManager = new QueueManager();'));
  const queue = new window.__test.QueueManager(); queue.notify = () => {};
  Object.assign(queue.settings, { minReadDelay: 0, maxReadDelay: 0, autoScroll: false, soundNotification: false });
  const editor = window.document.querySelector('.ql-editor'), button = window.document.querySelector('.send-button');
  editor.addEventListener('input', () => { button.disabled = !editor.textContent.trim(); });
  button.addEventListener('click', () => {
    const prompt = window.__test.DOM.getComposerText(); sent.push(prompt);
    const node = window.document.createElement('user-query'); node.textContent = prompt; window.document.body.append(node);
    editor.innerHTML = '<p><br></p>'; button.disabled = true;
  });
  await queue.enqueueMany(['First\n\nSecond paragraph', 'Next prompt']);
  queue.isPaused = true;
  await queue.runLoopStep(); assert.equal(sent.length, 0);
  queue.isPaused = false;
  const stop = window.document.createElement('button'); stop.className = 'stop-button'; window.document.body.append(stop);
  await queue.runLoopStep(); assert.equal(sent.length, 0); stop.remove();
  for (let i = 0; i < 8 && queue.items.length; i++) await queue.runLoopStep();
  assert.deepEqual(sent, ['First\n\nSecond paragraph', 'Next prompt']);
  assert.equal(queue.items.length, 0);
  assert.equal(stored[queue.storageKeyQueue].length, 0);
  assert.ok(waits.includes(600), 'stability checks use worker waits');
  assert.ok(waits.includes(150), 'hidden editor injection uses worker waits');
  assert.equal(pageTimers.includes(600), false, 'critical waits never depend on frozen page timers');
  await window.__test.modelPicker.wait(40);
  await window.__test.composerTools.wait(60);
  assert.ok(waits.includes(40) && waits.includes(60), 'model and tool adapters share background-safe waits');
  let beats = 0;
  queue.reportToRegistry = async () => { if (++beats === 2) queue.heartbeatStopped = true; };
  queue.setupRegistryHeartbeat();
  await queue.heartbeatTask;
  assert.equal(beats, 2);
  assert.ok(waits.includes(3500), 'idle background heartbeats do not rely on page timers');
  assert.equal(window.document.hidden, true);
});
