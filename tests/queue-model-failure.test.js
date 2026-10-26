const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

test('a queued unavailable model pauses with the item retained before typing or sending', async () => {
  const dom = new JSDOM('<!doctype html><body><textarea></textarea></body>', {
    url: 'https://chatgpt.com/c/test', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  const root = path.join(__dirname, '..');
  window.eval(fs.readFileSync(path.join(root, 'references.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'model-picker.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'composer-tools.js'), 'utf8'));
  // Expose production classes without starting the content script's background loops.
  const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8')
    .replace('const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));',
      'const sleep = async () => { if (globalThis.__stopLoop()) throw new Error("TEST_STOP"); };')
    .replace('  const queueManager = new QueueManager();',
      '  globalThis.__queueTest = { QueueManager, DOM, HumanSimulator, modelPicker }; return;\n  const queueManager = new QueueManager();');
  window.eval(source);
  const { QueueManager, DOM, HumanSimulator, modelPicker } = window.__queueTest;
  const queue = new QueueManager();
  queue.items = [{ id: 'item-1', text: 'Keep this prompt', model: 'chatgpt:removed-model' }];
  queue.settings.minReadDelay = 0;
  queue.settings.maxReadDelay = 0;
  queue.notify = () => {};
  let typed = 0;
  let sent = 0;
  let iterations = 0;
  DOM.isGenerating = () => false;
  DOM.getPromptInput = () => window.document.querySelector('textarea');
  DOM.getLastResponseLength = () => 0;
  HumanSimulator.typeText = async () => { typed++; return true; };
  HumanSimulator.clickSend = async () => { sent++; return true; };
  modelPicker.switchTo = async () => { throw new Error('指定モデルは現在の選択候補にありません。'); };
  window.__stopLoop = () => queue.isPaused || ++iterations > 100;
  await assert.rejects(queue.startLoop(), /TEST_STOP/);
  assert.equal(queue.isPaused, true);
  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].text, 'Keep this prompt');
  assert.equal(typed, 0);
  assert.equal(sent, 0);
  assert.match(queue.progressText, /選択候補にありません/);
  dom.window.close();
});

test('Gemini queue reads model metadata and proceeds through typing and send without an effort button', async t => {
  const dom = new JSDOM('<!doctype html><body><textarea></textarea></body>', {
    url: 'https://gemini.google.com/app/test', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  t.after(() => dom.window.close());
  const root = path.join(__dirname, '..');
  window.eval(fs.readFileSync(path.join(root, 'references.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'model-picker.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'composer-tools.js'), 'utf8'));
  const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8')
    .replace('const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));',
      'const sleep = async () => { if (globalThis.__stopLoop()) throw new Error("TEST_STOP"); };')
    .replace('  const queueManager = new QueueManager();',
      '  globalThis.__queueTest = { QueueManager, DOM, HumanSimulator }; return;\n  const queueManager = new QueueManager();');
  window.eval(source);
  const { QueueManager, DOM, HumanSimulator } = window.__queueTest;
  const queue = new QueueManager();
  queue.items = [{ id: 'gemini-item', text: 'Gemini queue test', model: 'auto', effort: 'auto' }];
  Object.assign(queue.settings, { minReadDelay: 0, maxReadDelay: 0, soundNotification: false, autoScroll: false });
  queue.notify = () => {};
  queue.saveQueue = async () => {};
  window.chrome = { storage: { local: { get: async () => ({}) } } };
  DOM.isGenerating = () => false;
  DOM.getPromptInput = () => window.document.querySelector('textarea');
  DOM.getLastResponseLength = () => 0;
  let typed = 0;
  let sent = 0;
  let iterations = 0;
  HumanSimulator.typeText = async () => { typed++; return true; };
  HumanSimulator.clickSend = async () => { sent++; return true; };
  window.__stopLoop = () => sent > 0 || queue.isPaused || ++iterations > 100;
  await assert.rejects(queue.startLoop(), /TEST_STOP/);
  assert.equal(queue.isPaused, false, queue.progressText);
  assert.equal(typed, 1);
  assert.equal(sent, 1);
  assert.equal(queue.items.length, 0);
  const info = DOM.getCurrentModelInfo();
  assert.equal(info.effort, null);
  assert.equal(info.supportsEffort, false);
  dom.window.close();
});

test('a prompt typed and then abandoned (paused mid-typing) is cleared and sent after resuming, not left as a draft forever', async t => {
  const dom = new JSDOM('<!doctype html><body><textarea></textarea></body>', {
    url: 'https://chatgpt.com/c/test', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  t.after(() => dom.window.close());
  const root = path.join(__dirname, '..');
  window.eval(fs.readFileSync(path.join(root, 'references.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'model-picker.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'composer-tools.js'), 'utf8'));
  const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8')
    .replace('const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));',
      'const sleep = async () => { if (globalThis.__stopLoop()) throw new Error("TEST_STOP"); };')
    .replace('  const queueManager = new QueueManager();',
      '  globalThis.__queueTest = { QueueManager, DOM, HumanSimulator }; return;\n  const queueManager = new QueueManager();');
  window.eval(source);
  const { QueueManager, DOM, HumanSimulator } = window.__queueTest;
  const queue = new QueueManager();
  queue.items = [{ id: 'item-1', text: 'Leftover prompt', model: 'auto', effort: 'auto' }];
  Object.assign(queue.settings, { minReadDelay: 0, maxReadDelay: 0, soundNotification: false, autoScroll: false });
  queue.notify = () => {};
  queue.saveQueue = async () => {};
  window.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
  const textarea = window.document.querySelector('textarea');
  DOM.isGenerating = () => false;
  DOM.getPromptInput = () => textarea;
  DOM.getLastResponseLength = () => 0;
  DOM.getConversationLimitWarning = () => null;
  let typed = 0;
  let sentText = null;
  let iterations = 0;
  HumanSimulator.typeText = async (el, text) => {
    typed++;
    el.value = text;
    if (typed === 1) queue.isPaused = true; // the user pauses while the prompt is being typed
    return true;
  };
  HumanSimulator.clickSend = async () => { sentText = textarea.value; textarea.value = ''; return true; };
  window.__stopLoop = () => {
    iterations++;
    if (queue.isPaused && iterations > 5) queue.isPaused = false; // ...and resumes later
    return sentText !== null || iterations > 300;
  };
  await assert.rejects(queue.startLoop(), /TEST_STOP/);
  assert.equal(sentText, 'Leftover prompt', queue.currentAction);
  assert.equal(typed, 2);
  assert.equal(queue.items.length, 0);
});

test('send confirmation can read the user turns of an existing ChatGPT conversation (no ReferenceError)', async t => {
  const dom = new JSDOM(`<!doctype html><body><nav><div data-message-author-role="user">sidebar</div></nav>
    <main><div data-user-message-bubble="true">前の質問</div></main>
    <form><div contenteditable="true" role="textbox"></div></form></body>`, {
    url: 'https://chatgpt.com/c/test', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  t.after(() => dom.window.close());
  const root = path.join(__dirname, '..');
  window.eval(fs.readFileSync(path.join(root, 'references.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'model-picker.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'composer-tools.js'), 'utf8'));
  const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8')
    .replace('  const queueManager = new QueueManager();',
      '  globalThis.__queueTest = { HumanSimulator }; return;\n  const queueManager = new QueueManager();');
  window.eval(source);
  const { HumanSimulator } = window.__queueTest;
  const last = HumanSimulator.lastUserNode();
  assert.equal(last?.textContent, '前の質問', 'the conversation bubble is found and the sidebar copy is ignored');
});

test('a user draft left in the composer is sent once it stops changing, then the queued item follows', async t => {
  const dom = new JSDOM('<!doctype html><body><textarea></textarea></body>', {
    url: 'https://chatgpt.com/c/test', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  t.after(() => dom.window.close());
  const root = path.join(__dirname, '..');
  window.eval(fs.readFileSync(path.join(root, 'references.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'model-picker.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'composer-tools.js'), 'utf8'));
  let clock = 1_000_000;
  const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8')
    .replace('const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));',
      'const sleep = async (ms = 0) => { globalThis.__advance(ms); if (globalThis.__stopLoop()) throw new Error("TEST_STOP"); };')
    .replace('  const queueManager = new QueueManager();',
      '  globalThis.__queueTest = { QueueManager, DOM, HumanSimulator }; return;\n  const queueManager = new QueueManager();');
  window.Date.now = () => clock;
  window.__advance = ms => { clock += ms || 0; };
  window.eval(source);
  const { QueueManager, DOM, HumanSimulator } = window.__queueTest;
  const queue = new QueueManager();
  queue.items = [{ id: 'item-1', text: 'Queued prompt', model: 'auto', effort: 'auto' }];
  Object.assign(queue.settings, { minReadDelay: 0, maxReadDelay: 0, soundNotification: false, autoScroll: false });
  queue.notify = () => {};
  queue.saveQueue = async () => {};
  window.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
  const textarea = window.document.querySelector('textarea');
  textarea.value = 'ユーザーの下書き';
  DOM.isGenerating = () => false;
  DOM.getPromptInput = () => textarea;
  DOM.getLastResponseLength = () => 0;
  DOM.getConversationLimitWarning = () => null;
  const sent = [];
  let iterations = 0;
  HumanSimulator.typeText = async (el, text) => { el.value = text; return true; };
  HumanSimulator.clickSend = async () => { sent.push(textarea.value); textarea.value = ''; return true; };
  window.__stopLoop = () => sent.length >= 2 || ++iterations > 500;
  await assert.rejects(queue.startLoop(), /TEST_STOP/);
  assert.deepEqual(sent, ['ユーザーの下書き', 'Queued prompt']);
  assert.equal(queue.items.length, 0);
});

test('a draft that keeps changing (the user is still typing) is never sent by the queue', async t => {
  const dom = new JSDOM('<!doctype html><body><textarea></textarea></body>', {
    url: 'https://chatgpt.com/c/test', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  t.after(() => dom.window.close());
  const root = path.join(__dirname, '..');
  window.eval(fs.readFileSync(path.join(root, 'references.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'model-picker.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'composer-tools.js'), 'utf8'));
  let clock = 1_000_000;
  const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8')
    .replace('const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));',
      'const sleep = async (ms = 0) => { globalThis.__advance(ms); if (globalThis.__stopLoop()) throw new Error("TEST_STOP"); };')
    .replace('  const queueManager = new QueueManager();',
      '  globalThis.__queueTest = { QueueManager, DOM, HumanSimulator }; return;\n  const queueManager = new QueueManager();');
  window.Date.now = () => clock;
  window.__advance = ms => { clock += ms || 0; };
  window.eval(source);
  const { QueueManager, DOM, HumanSimulator } = window.__queueTest;
  const queue = new QueueManager();
  queue.items = [{ id: 'item-1', text: 'Queued prompt', model: 'auto', effort: 'auto' }];
  Object.assign(queue.settings, { minReadDelay: 0, maxReadDelay: 0, soundNotification: false, autoScroll: false });
  queue.notify = () => {};
  queue.saveQueue = async () => {};
  window.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
  const textarea = window.document.querySelector('textarea');
  textarea.value = 'ユーザーの下書き';
  DOM.isGenerating = () => false;
  DOM.getPromptInput = () => textarea;
  DOM.getLastResponseLength = () => 0;
  DOM.getConversationLimitWarning = () => null;
  const sent = [];
  let iterations = 0;
  HumanSimulator.typeText = async (el, text) => { el.value = text; return true; };
  HumanSimulator.clickSend = async () => { sent.push(textarea.value); textarea.value = ''; return true; };
  window.__stopLoop = () => { textarea.value += 'あ'; return sent.length > 0 || ++iterations > 300; };
  await assert.rejects(queue.startLoop(), /TEST_STOP/);
  assert.deepEqual(sent, []);
  assert.equal(queue.items.length, 1);
});
