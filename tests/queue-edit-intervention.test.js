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
    .replace('const sleep = (ms) => globalThis.CGQQueueTiming?.wait(ms) || new Promise(resolve => setTimeout(resolve, ms));', 'const sleep = async () => {};')
    .replace('  const queueManager = new QueueManager();', '  globalThis.__test = { QueueManager, QueueUI, DOM, composerTools }; return;\n  const queueManager = new QueueManager();'));
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

test('native Enter passes through in both services, while Ctrl+Enter still enqueues', async t => {
  for (const platform of ['chatgpt', 'gemini']) for (const generating of [false, true]) {
    const f = fixture(t, { generating, platform }); f.ui.setupKeyboardShortcuts(); f.input.focus(); f.input.value = 'Normal send';
    f.queue.settings.enterToQueue = generating; // Legacy preferences must not affect native Enter.
    const enter = new f.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    f.input.dispatchEvent(enter); await tick(); await tick();
    assert.equal(enter.defaultPrevented, false);
    assert.equal(f.queue.items.length, 0); assert.equal(f.input.value, 'Normal send');
    const submit = new f.window.Event('submit', { bubbles: true, cancelable: true });
    f.window.document.querySelector('form').dispatchEvent(submit); await tick();
    assert.equal(submit.defaultPrevented, false); assert.equal(f.queue.items.length, 0);
    f.input.value = 'Queued';
    f.input.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    await tick(); await tick();
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

test('queue shortcuts preserve the composer on save failure and avoid duplicate submissions', async t => {
  const f = fixture(t);
  f.ui.setupKeyboardShortcuts(); f.input.focus(); f.input.value = 'Keep my draft';
  const key = () => f.input.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  const set = f.window.chrome.storage.local.set;
  f.window.chrome.storage.local.set = async () => { throw new Error('quota'); };
  key(); await tick(); await tick();
  assert.equal(f.input.value, 'Keep my draft');
  assert.equal(f.queue.items.length, 0);
  let release;
  f.window.chrome.storage.local.set = async values => {
    await new Promise(resolve => { release = resolve; });
    await set(values);
  };
  key(); key(); await tick();
  f.input.value = 'New draft typed during save';
  release(); await tick(); await tick();
  assert.deepEqual(Array.from(f.queue.items, x => x.text), ['Keep my draft']);
  assert.equal(f.input.value, 'New draft typed during save');
});

test('native Enter does not enqueue even a newchat command', async t => {
  const f = fixture(t); f.ui.setupKeyboardShortcuts(); f.input.focus(); f.input.value = '/newchat';
  const event = new f.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  f.input.dispatchEvent(event); await tick();
  assert.equal(event.defaultPrevented, false);
  assert.equal(f.queue.items.length, 0);
  f.window.__test.composerTools.menuOpen = () => true;
  f.input.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
  await tick(); await tick();
  assert.equal(f.queue.items[0].text, '/newchat', 'explicit queue shortcut also works while the native slash menu is open');
});

test('direct sending bypasses the queue, keeps its pause state and preserves queued items', async t => {
  for (const platform of ['chatgpt', 'gemini']) {
    const f = fixture(t, { platform }); await f.queue.enqueue('Queued'); f.queue.isPaused = true;
    let sent = 0;
    f.window.__CGQ_HumanSimulator__.clickSend = async () => {
      assert.equal(f.input.value, 'Direct\nmessage'); sent++; f.input.value = ''; return true;
    };
    const response = await f.queue.sendPrompt('Direct\nmessage');
    assert.equal(response.success, true); assert.equal(sent, 1);
    assert.equal(f.queue.items[0].text, 'Queued'); assert.equal(f.queue.isPaused, true);
    assert.equal(f.store[f.queue.storageKeyQueue].length, 1);
    f.queue.isPaused = false;
    await f.queue.runLoopStep(); assert.equal(sent, 1, 'manual sends retain the automatic send cooldown');
  }
});

test('direct sending refuses busy composers and source drafts, and never clicks the generation stop button', async t => {
  const f = fixture(t); await f.queue.enqueue('Queued');
  f.input.value = 'Source draft';
  assert.equal((await f.queue.sendPrompt('Direct')).success, false);
  assert.equal(f.input.value, 'Source draft');
  f.input.value = ''; f.queue.manualSending = true;
  assert.equal((await f.queue.sendPrompt('Duplicate')).success, false);
  f.queue.manualSending = false;
  f.send.className = 'stop-button'; f.send.setAttribute('aria-label', '停止');
  let clicked = false; f.send.onclick = () => { clicked = true; };
  const response = await f.queue.sendPrompt('Direct');
  assert.equal(response.success, false); assert.equal(clicked, false);
  assert.equal(f.input.value, 'Direct'); assert.equal(f.queue.items.length, 1);
  assert.equal(f.queue.isPaused, true, 'failed manual text is not later sent by the queue as an idle draft');
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

test('native normal send waits while the same composer is being saved to the queue', t => {
  const f = fixture(t);
  f.ui.setupKeyboardShortcuts();
  f.ui.enqueuePending = true;
  f.input.focus(); f.input.value = 'Still saving';
  const enter = new f.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  f.input.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true);
  const click = new f.window.MouseEvent('click', { bubbles: true, cancelable: true });
  f.send.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true);
  assert.equal(f.input.value, 'Still saving');
});

test('saving a native composer also holds automatic injection until the draft has been persisted', async t => {
  const f = fixture(t);
  await f.queue.enqueue('Already queued');
  f.input.value = 'Save this draft';
  const originalSet = f.window.chrome.storage.local.set;
  let release;
  f.window.chrome.storage.local.set = values => new Promise(resolve => {
    release = async () => { await originalSet(values); resolve(); };
  });
  const saving = f.ui.enqueueComposer();
  await tick();
  assert.equal(f.queue.composerEnqueuePending, true);
  f.window.__CGQ_HumanSimulator__.typeText = () => assert.fail('must not inject while native draft save is pending');
  await f.queue.runLoopStep();
  assert.equal(f.input.value, 'Save this draft');
  await release(); assert.equal(await saving, true);
  assert.equal(f.queue.composerEnqueuePending, false);
  assert.equal(f.input.value, '');
  assert.deepEqual(Array.from(f.queue.items, item => item.text), ['Already queued', 'Save this draft']);
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
