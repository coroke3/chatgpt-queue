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
