const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function fixture(t) {
  const dom = new JSDOM('<body></body>', { url: 'https://chatgpt.com/c/test', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const store = {}, root = path.join(__dirname, '..'), window = dom.window;
  window.chrome = { storage: { local: {
    get: async keys => {
      const snapshot = JSON.parse(JSON.stringify(Object.fromEntries(keys.filter(k => k in store).map(k => [k, store[k]]))));
      await new Promise(resolve => setImmediate(resolve));
      return snapshot;
    },
    set: async values => { Object.assign(store, JSON.parse(JSON.stringify(values))); }
  } } };
  for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'content.js'), 'utf8').replace(
    '  const queueManager = new QueueManager();',
    '  globalThis.__test = { QueueManager, HumanSimulator, DOM }; return;\n  const queueManager = new QueueManager();'));
  const queue = new window.__test.QueueManager(); queue.notify = () => {};
  return { queue, store, window };
}

test('simultaneous single and bulk additions retain every prompt in order', async t => {
  const { queue, store } = fixture(t);
  await Promise.all([queue.enqueue('First'), queue.enqueueMany(['Second\nline', 'Third']), queue.enqueue('Fourth')]);
  assert.deepEqual(Array.from(queue.items, x => x.text), ['First', 'Second\nline', 'Third', 'Fourth']);
  assert.deepEqual(store[queue.storageKeyQueue].map(x => x.text), ['First', 'Second\nline', 'Third', 'Fourth']);
});

test('overlapping edit, add, remove and reorder preserve unrelated items', async t => {
  const { queue, store } = fixture(t);
  const [a, b, c] = await queue.enqueueMany(['A', 'B', 'C']);
  await Promise.all([queue.enqueue('D'), queue.updateItem(b.id, 'Edited\nB'), queue.removeItem(a.id), queue.moveItem(c.id, 'up')]);
  assert.deepEqual(Array.from(queue.items, x => x.text), ['C', 'Edited\nB', 'D']);
  assert.deepEqual(store[queue.storageKeyQueue].map(x => x.text), ['C', 'Edited\nB', 'D']);
});

test('failed persistence does not acknowledge or retain an unsaved addition and later additions recover', async t => {
  const { queue, window, store } = fixture(t);
  await queue.enqueue('Saved');
  const set = window.chrome.storage.local.set;
  window.chrome.storage.local.set = async () => { throw new Error('quota'); };
  assert.equal(await queue.enqueue('Unsaved'), null);
  assert.deepEqual(Array.from(queue.items, x => x.text), ['Saved']);
  window.chrome.storage.local.set = set;
  await queue.enqueue('Recovered');
  assert.deepEqual(store[queue.storageKeyQueue].map(x => x.text), ['Saved', 'Recovered']);
});

test('pause survives reload and is restored separately for each conversation', async t => {
  const { queue, window } = fixture(t);
  queue.togglePause();
  const restored = new window.__test.QueueManager();
  assert.equal(restored.isPaused, true);
  restored.tabId = 'another-conversation';
  await restored.loadFromStorage();
  assert.equal(restored.isPaused, false);
  queue.togglePause();
  assert.equal(new window.__test.QueueManager().isPaused, false);
});

test('priority changes and multiline edits survive reload; clearing then adding keeps only the new item', async t => {
  const { queue, window, store } = fixture(t);
  const [a, b] = await queue.enqueueMany(['A', 'B']);
  await queue.updateItem(b.id, 'B\nsecond line');
  queue.togglePause();
  await queue.sendImmediately(b.id);
  assert.equal(queue.isPaused, false);
  const restored = new window.__test.QueueManager(); restored.notify = () => {};
  await restored.loadFromStorage();
  assert.deepEqual(Array.from(restored.items, x => x.id), [b.id, a.id]);
  assert.equal(restored.items[0].text, 'B\nsecond line');
  await Promise.all([restored.clearQueue(), restored.enqueue('After clear')]);
  assert.deepEqual(store[restored.storageKeyQueue].map(x => x.text), ['After clear']);
});

test('storage notifications update the same item object already captured by the sender', async t => {
  const { queue, window } = fixture(t);
  await queue.enqueue('Original');
  const active = queue.items[0];
  let notifyStorage;
  window.chrome.storage.onChanged = { addListener: listener => { notifyStorage = listener; } };
  queue.setupStorageListener();
  notifyStorage({ [queue.storageKeyQueue]: { newValue: [{ ...active, text: 'Edited during read delay' }] } }, 'local');
  assert.equal(queue.items[0], active);
  assert.equal(active.text, 'Edited during read delay');
});

test('disabled native send controls are never enabled, clicked or bypassed', async t => {
  for (const attribute of ['disabled', 'aria-disabled="true"']) {
    const { window } = fixture(t);
    window.document.body.innerHTML = `<form><textarea></textarea><button ${attribute}>Send</button></form>`;
    const { HumanSimulator, DOM } = window.__test;
    const button = window.document.querySelector('button');
    DOM.getPromptInput = () => window.document.querySelector('textarea');
    DOM.getSendButton = () => button;
    let interactions = 0;
    button.addEventListener('click', () => interactions++);
    window.document.querySelector('form').addEventListener('submit', e => { e.preventDefault(); interactions++; });
    window.document.querySelector('textarea').addEventListener('keydown', () => interactions++);
    let now = 0; window.Date.now = () => now += 2100;
    assert.equal(await HumanSimulator.clickSend('Keep queued'), false);
    assert.equal(interactions, 0);
    assert.ok(button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true');
  }
});
