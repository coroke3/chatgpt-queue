const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const copy = value => JSON.parse(JSON.stringify(value));

function browser() {
  const data = {}, session = {};
  let handler, removed;
  const restart = () => vm.runInNewContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), {
    URL, console, setTimeout,
    chrome: {
      runtime: { onMessage: { addListener(fn) { handler = fn; } } },
      tabs: { onRemoved: { addListener(fn) { removed = fn; } } },
      storage: { session: {
        get: async key => ({ [key]: session[key] ? copy(session[key]) : undefined }),
        set: async values => Object.assign(session, copy(values))
      } }
    }
  });
  restart();
  return { data, restart, remove: id => removed(id),
    request: (tabId, url, request) => new Promise(resolve => handler(request, { tab: { id: tabId, url } }, resolve)) };
}

async function page(t, browser, { tabId = 7, url = 'https://chatgpt.com/c/original', session = {}, reload = false,
  legacyReload = false, discarded = false, storageFailure = false, contextFailure = false } = {}) {
  const dom = new JSDOM('<!doctype html><body><main></main></body>', { url, runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  Object.entries(session).forEach(([key, value]) => window.sessionStorage.setItem(key, value));
  window.performance.getEntriesByType = () => reload ? [{ type: 'reload' }] : [];
  if (legacyReload) window.performance.navigation = { type: 1 };
  Object.defineProperty(window.document, 'wasDiscarded', { value: discarded });
  window.chrome = {
    runtime: { sendMessage: (request, callback) => contextFailure
      ? callback({ success: false, error: 'Context unavailable' })
      : browser.request(tabId, window.location.href, request).then(callback) },
    storage: { local: {
      get: async keys => Object.fromEntries(keys.map(key => [key, browser.data[key] && copy(browser.data[key])])),
      set: async values => {
        if (storageFailure) throw new Error('Storage unavailable');
        Object.assign(browser.data, copy(values));
      }
    } }
  };
  for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) {
    window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  }
  window.eval(fs.readFileSync(path.join(root, 'content.js'), 'utf8').replace(
    '  const queueManager = new QueueManager();',
    '  globalThis.__reloadTest = { QueueManager }; return;\n  const queueManager = new QueueManager();'));
  const queue = new window.__reloadTest.QueueManager();
  queue.notify = () => {};
  queue.reportToRegistry = async () => null;
  await queue.initializeTabContext();
  await queue.loadFromStorage();
  await queue.restoreConversationRollover();
  return { queue, window, session: () => Object.fromEntries(Object.entries(window.sessionStorage)) };
}

test('manual reload into a fresh conversation survives complete page session-storage loss on both services', async t => {
  for (const [oldUrl, newUrl] of [
    ['https://chatgpt.com/c/original', 'https://chatgpt.com/'],
    ['https://gemini.google.com/app/original', 'https://gemini.google.com/app']
  ]) {
    const b = browser(), original = await page(t, b, { url: oldUrl });
    await original.queue.enqueue('First\n\nSecond paragraph', { model: 'chosen', effort: 'high',
      tools: [{ type: 'app', id: 'app://github', label: 'GitHub', platform: oldUrl.includes('gemini') ? 'gemini' : 'chatgpt' }] });
    await original.queue.enqueue('Last');
    original.queue.isPaused = true;
    await original.queue.queueWrite;
    const expected = copy(original.queue.items);
    assert.equal(expected[0].tools.length, 1);
    b.restart();
    const restored = await page(t, b, { url: newUrl });
    assert.equal(restored.queue.sessionTabId, original.queue.sessionTabId);
    assert.deepEqual(copy(restored.queue.items), expected);
    assert.equal(restored.queue.isPaused, true);
    assert.deepEqual(b.data[original.queue.storageKeyQueue], []);
    const again = await page(t, b, { url: newUrl });
    assert.deepEqual(copy(again.queue.items), expected, 'repeated reloads must not duplicate items');
  }
});

test('reload redirects to assigned IDs and custom GPT sessions retain the queue without a page marker', async t => {
  for (const options of [
    { url: 'https://chatgpt.com/c/new-id', reload: true },
    { url: 'https://gemini.google.com/app/new-id', legacyReload: true },
    { url: 'https://chatgpt.com/c/restored-id', discarded: true },
    { url: 'https://chatgpt.com/g/g-custom' }
  ]) {
    const b = browser();
    const original = await page(t, b, { url: options.url.includes('gemini')
      ? 'https://gemini.google.com/app/original' : 'https://chatgpt.com/c/original' });
    await original.queue.enqueue('Pending');
    const restored = await page(t, b, options);
    assert.deepEqual(Array.from(restored.queue.items, item => item.text), ['Pending']);
  }
});

test('ChatGPT origin redirects preserve work while separate browser tabs remain isolated', async t => {
  const b = browser(), original = await page(t, b, { url: 'https://chat.openai.com/c/original' });
  await original.queue.enqueue('Original tab only');
  const duplicate = await page(t, b, { tabId: 8, url: 'https://chatgpt.com/', session: original.session() });
  assert.notEqual(duplicate.queue.sessionTabId, original.queue.sessionTabId);
  assert.equal(duplicate.queue.items.length, 0);
  const restored = await page(t, b, { url: 'https://chatgpt.com/', reload: true });
  assert.deepEqual(Array.from(restored.queue.items, item => item.text), ['Original tab only']);
});

test('explicit new-chat recovery survives loss of its page marker and preserves destination work', async t => {
  const b = browser(), original = await page(t, b);
  await original.queue.enqueueMany(['/newchat', 'Continue']);
  original.queue.navigateToNewChat = () => {};
  await original.queue.executeNewChat(original.queue.items[0]);
  const targetKey = `cgq_queue_${original.queue.sessionTabId}_new`;
  b.data[targetKey] = [{ id: 'destination', text: 'Destination' }];
  const restored = await page(t, b, { url: 'https://chatgpt.com/' });
  assert.deepEqual(Array.from(restored.queue.items, item => item.text), ['Continue', 'Destination']);
  assert.ok(!b.data[restored.queue.storageKeyRecovery].rollover);
});

test('a later normal switch to existing history does not inherit the document reload flag', async t => {
  const b = browser(), original = await page(t, b);
  await original.queue.enqueue('Original');
  const restored = await page(t, b, { reload: true });
  restored.window.history.pushState({}, '', '/c/other-existing');
  await restored.queue.handleUrlChange(restored.window.location.href);
  assert.equal(restored.queue.items.length, 0);
  assert.equal(b.data[original.queue.storageKeyQueue][0].text, 'Original');
});

test('failed recovery preserves its durable source for retry instead of overwriting it with an empty queue', async t => {
  const b = browser(), original = await page(t, b);
  await original.queue.enqueue('Keep');
  const checkpoint = copy(b.data[original.queue.storageKeyRecovery]);
  const failed = await page(t, b, { url: 'https://chatgpt.com/', storageFailure: true });
  assert.equal(failed.queue.isPaused, true);
  assert.deepEqual(b.data[original.queue.storageKeyRecovery], checkpoint);
  const restored = await page(t, b, { url: 'https://chatgpt.com/' });
  assert.deepEqual(Array.from(restored.queue.items, item => item.text), ['Keep']);
});

test('closing a tab removes its browser identity so a reused tab number cannot inherit its queue', async t => {
  const b = browser(), original = await page(t, b);
  await original.queue.enqueue('Closed tab');
  b.remove(7);
  const next = await page(t, b, { url: 'https://chatgpt.com/' });
  assert.notEqual(next.queue.sessionTabId, original.queue.sessionTabId);
  assert.equal(next.queue.items.length, 0);
});

test('reload restores the latest edits and order without resurrecting removed or cleared work', async t => {
  const b = browser(), original = await page(t, b);
  const [first, second, third] = await original.queue.enqueueMany(['First', 'Second', 'Third']);
  await original.queue.updateItem(second.id, 'Second\nupdated');
  await original.queue.moveItem(third.id, 'up');
  await original.queue.removeItem(first.id);
  const restored = await page(t, b, { url: 'https://chatgpt.com/', reload: true });
  assert.deepEqual(Array.from(restored.queue.items, item => item.text), ['Third', 'Second\nupdated']);
  await restored.queue.clearQueue();
  const again = await page(t, b, { url: 'https://chatgpt.com/' });
  assert.equal(again.queue.items.length, 0);
});

test('unavailable browser identity pauses recovery without writing a replacement empty checkpoint', async t => {
  const b = browser(), original = await page(t, b);
  await original.queue.enqueue('Keep');
  const before = copy(b.data);
  const failed = await page(t, b, { url: 'https://chatgpt.com/', contextFailure: true });
  assert.equal(failed.queue.isPaused, true);
  assert.deepEqual(b.data, before);
  assert.equal(await failed.queue.enqueue('Must retain input'), null);
  const restored = await page(t, b, { url: 'https://chatgpt.com/' });
  assert.deepEqual(Array.from(restored.queue.items, item => item.text), ['Keep']);
});

test('browser context requests are serialized and limited to supported service tabs', async () => {
  const b = browser(), url = 'https://chatgpt.com/';
  const request = { action: 'GET_QUEUE_CONTEXT', sessionTabId: 'tab_legacy' };
  const [first, again, other] = await Promise.all([
    b.request(7, url, request), b.request(7, url, request), b.request(8, url, request)
  ]);
  assert.equal(first.sessionTabId, again.sessionTabId);
  assert.notEqual(first.sessionTabId, other.sessionTabId);
  assert.equal((await b.request(9, 'https://chatgpt.com.evil.test/', request)).success, false);
});

test('an immediate reload retains a page pause that has not reached extension storage yet', async t => {
  const b = browser(), original = await page(t, b);
  await original.queue.enqueue('Keep paused');
  const session = original.session();
  session[`cgq_paused_${original.queue.tabId}`] = 'true';
  const restored = await page(t, b, { session, reload: true });
  assert.equal(restored.queue.isPaused, true);
  assert.equal(restored.queue.items.length, 1);
});

test('explicit recovery tolerates ChatGPT origin redirects and Gemini account-specific new-chat paths', async t => {
  for (const [oldUrl, newUrl] of [
    ['https://chat.openai.com/c/original', 'https://chatgpt.com/'],
    ['https://gemini.google.com/app/original', 'https://gemini.google.com/u/0/app']
  ]) {
    const b = browser(), original = await page(t, b, { url: oldUrl });
    await original.queue.enqueue('Continue');
    original.queue.navigateToNewChat = () => {};
    await original.queue.startNewChat('Recover');
    const restored = await page(t, b, { url: newUrl });
    assert.deepEqual(Array.from(restored.queue.items, item => item.text), ['Continue']);
  }
});
