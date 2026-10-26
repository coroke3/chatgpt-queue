const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(t, { generating = false, platform = 'chatgpt' } = {}) {
  const dom = new JSDOM('<body><form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button" aria-label="送信"></button></form><div id="items"></div></body>', {
    url: platform === 'chatgpt' ? 'https://chatgpt.com/c/test' : 'https://gemini.google.com/app/test', runScripts: 'outside-only', pretendToBeVisual: true
  });
  t.after(() => dom.window.close());
  const { window } = dom, root = path.join(__dirname, '..'), store = {};
  window.chrome = { storage: { local: { get: async keys => Object.fromEntries(keys.map(key => [key, store[key]])), set: async values => Object.assign(store, values) } } };
  for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  // JSDOM cannot create trusted UI events; remove only that entry gate to exercise routing.
  window.eval(fs.readFileSync(path.join(root, 'content.js'), 'utf8')
    .replaceAll('if (!e.isTrusted) return;', '')
    .replace('const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));', 'const sleep = async () => {};')
    .replace('  const queueManager = new QueueManager();', '  globalThis.__test = { QueueManager, QueueUI, DOM }; return;\n  const queueManager = new QueueManager();'));
  const { QueueManager, QueueUI, DOM } = window.__test;
  const queue = new QueueManager(); queue.notify = () => {};
  const input = window.document.querySelector('textarea'), send = window.document.querySelector('button');
  DOM.isGenerating = () => generating;
  DOM.scrollToBottom = () => {};
  const ui = Object.create(QueueUI.prototype);
  Object.assign(ui, { qm: queue, editingId: null, domList: window.document.getElementById('items') });
  ui.updateUI = () => ui.renderItems();
  return { window, queue, ui, input, send, store };
}

test('queue editing keeps the live textarea, caret and multiline draft across notifications', async t => {
  const f = fixture(t);
  await f.queue.enqueue('Original', { model: 'model-id', effort: 'high' });
  f.queue.notify = () => f.ui.updateUI();
  f.ui.renderItems();
  f.ui.domList.querySelector('[data-action="edit"]').click();
  const editor = f.ui.domList.querySelector('textarea');
  assert.equal(f.ui.domList.querySelector('#cgq-save-edit').type, 'button');
  assert.equal(f.ui.domList.querySelector('#cgq-cancel-edit').type, 'button');
  editor.value = 'Edited\n\nSecond paragraph'; editor.setSelectionRange(6, 6);
  f.queue.notify(); f.queue.notify();
  assert.equal(f.ui.domList.querySelector('textarea'), editor);
  assert.equal(editor.value, 'Edited\n\nSecond paragraph');
  assert.equal(editor.selectionStart, 6);
  await f.queue.runLoopStep();
  assert.equal(f.queue.items.length, 1);
  f.ui.domList.querySelector('#cgq-save-edit').click();
  await tick(); await tick();
  assert.equal(f.queue.items[0].text, 'Edited\n\nSecond paragraph');
  assert.equal(f.queue.items[0].model, 'model-id');
  assert.equal(f.queue.items[0].effort, 'high');
  assert.equal(f.ui.domList.querySelector('textarea'), null);
  assert.equal(f.queue.editingItemId, null);
  assert.equal(f.store[f.queue.storageKeyQueue][0].text, 'Edited\n\nSecond paragraph');
});

test('empty edits stay open, cancel preserves the prompt, and sending items cannot be edited', async t => {
  const f = fixture(t);
  const item = await f.queue.enqueue('Keep');
  f.ui.renderItems(); f.ui.domList.querySelector('[data-action="edit"]').click();
  f.ui.domList.querySelector('textarea').value = '  \n';
  f.ui.domList.querySelector('#cgq-save-edit').click(); await tick();
  assert.ok(f.ui.domList.querySelector('textarea'));
  assert.equal(f.queue.items[0].text, 'Keep');
  f.ui.domList.querySelector('#cgq-cancel-edit').click();
  assert.equal(f.queue.editingItemId, null);
  f.queue.activeItem = item; f.queue.currentState = 'typing';
  f.ui.domList.querySelector('[data-action="edit"]').click();
  assert.equal(f.ui.domList.querySelector('textarea'), null);
});

test('Enter enqueues even when idle, while Shift+Enter and IME confirmation do not submit', async t => {
  for (const generating of [false, true]) {
    const f = fixture(t, { generating }); f.ui.setupKeyboardShortcuts(); f.input.focus(); f.input.value = 'Queued';
    const enter = new f.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    f.input.dispatchEvent(enter); await tick(); await tick();
    assert.equal(enter.defaultPrevented, true);
    assert.equal(f.queue.items[0].text, 'Queued'); assert.equal(f.input.value, '');
    f.input.value = 'Draft';
    for (const extra of [{ shiftKey: true }, { isComposing: true }]) {
      const event = new f.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...extra });
      f.input.dispatchEvent(event); assert.equal(event.defaultPrevented, false);
    }
    assert.equal(f.queue.items.length, 1);
  }
});

test('failed edit persistence keeps the draft open and leaves the original queued text intact', async t => {
  const f = fixture(t);
  await f.queue.enqueue('Original');
  f.ui.renderItems(); f.ui.domList.querySelector('[data-action="edit"]').click();
  const editor = f.ui.domList.querySelector('textarea'); editor.value = 'Unsaved edit';
  f.window.chrome.storage.local.set = async () => { throw new Error('write failed'); };
  f.ui.domList.querySelector('#cgq-save-edit').click(); await tick();
  assert.equal(f.queue.items[0].text, 'Original');
  assert.equal(f.ui.domList.querySelector('textarea'), editor);
  assert.equal(editor.value, 'Unsaved edit');
});

test('ChatGPT native send and form submit pass through during generation without being queued', async t => {
  const f = fixture(t, { generating: true }); f.ui.setupKeyboardShortcuts();
  await f.queue.enqueue('Waiting item'); f.input.value = 'Intervention';
  const click = new f.window.MouseEvent('click', { bubbles: true, cancelable: true });
  f.send.dispatchEvent(click);
  const submit = new f.window.Event('submit', { bubbles: true, cancelable: true });
  f.window.document.querySelector('form').dispatchEvent(submit); await tick();
  assert.equal(click.defaultPrevented, false); assert.equal(submit.defaultPrevented, false);
  assert.equal(f.queue.items.length, 1); assert.equal(f.queue.items[0].text, 'Waiting item');
  assert.equal(f.input.value, 'Intervention'); assert.equal(f.queue.lastSentPrompt, 'Intervention');
  assert.ok(f.queue.lastSentTimestamp > 0);
});

test('native stop remains usable, and the queue composer lock still prevents duplicate sends', t => {
  const f = fixture(t, { generating: true }); f.ui.setupKeyboardShortcuts();
  f.queue.currentState = 'typing'; f.input.value = 'Queue is typing';
  let click = new f.window.MouseEvent('click', { bubbles: true, cancelable: true });
  f.send.dispatchEvent(click); assert.equal(click.defaultPrevented, true);
  f.send.setAttribute('data-testid', 'stop-button'); f.send.setAttribute('aria-label', '停止');
  click = new f.window.MouseEvent('click', { bubbles: true, cancelable: true });
  f.send.dispatchEvent(click); assert.equal(click.defaultPrevented, false);
});
