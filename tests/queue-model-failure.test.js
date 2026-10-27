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
    .replace('const sleep = (ms) => globalThis.CGQQueueTiming?.wait(ms) || new Promise(resolve => setTimeout(resolve, ms));',
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
    .replace('const sleep = (ms) => globalThis.CGQQueueTiming?.wait(ms) || new Promise(resolve => setTimeout(resolve, ms));',
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
  window.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
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
    .replace('const sleep = (ms) => globalThis.CGQQueueTiming?.wait(ms) || new Promise(resolve => setTimeout(resolve, ms));',
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
    .replace('const sleep = (ms) => globalThis.CGQQueueTiming?.wait(ms) || new Promise(resolve => setTimeout(resolve, ms));',
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
    .replace('const sleep = (ms) => globalThis.CGQQueueTiming?.wait(ms) || new Promise(resolve => setTimeout(resolve, ms));',
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

test('a sent prompt with no answer progress for 1 hour is re-queued (with its tools) and continued in a new chat', async t => {
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
    .replace('  const queueManager = new QueueManager();',
      '  globalThis.__queueTest = { QueueManager, DOM }; return;\n  const queueManager = new QueueManager();');
  let clock = 1_000_000;
  window.Date.now = () => clock;
  window.eval(source);
  const { QueueManager, DOM } = window.__queueTest;
  const queue = new QueueManager();
  queue.notify = () => {};
  queue.items = [{ id: 'next', text: 'Next prompt' }];
  let length = 100;
  let generating = true;
  DOM.getLastResponseLength = () => length;
  DOM.isGenerating = () => generating;
  const switched = [];
  queue.startNewChat = async reason => { switched.push(reason); };

  const tools = [{ platform: 'chatgpt', type: 'app', id: 'chatgpt:app:github', label: 'GitHub' }];
  queue.rememberSent({ id: 'sent', text: 'Stalled prompt', tools, model: 'auto', effort: 'auto' });
  assert.equal(await queue.checkStalledAndStartNewChat(), false); // records the baseline
  clock += 30 * 60 * 1000;
  length = 140; // the answer is still arriving: the hour starts over
  assert.equal(await queue.checkStalledAndStartNewChat(), false);
  clock += 59 * 60 * 1000;
  assert.equal(await queue.checkStalledAndStartNewChat(), false, 'not yet an hour without progress');
  clock += 2 * 60 * 1000;
  assert.equal(await queue.checkStalledAndStartNewChat(), true);
  assert.equal(switched.length, 1);
  assert.equal(queue.items[0].text, 'Stalled prompt');
  assert.equal(JSON.stringify(queue.items[0].tools.map(tool => tool.id)), '["chatgpt:app:github"]');
  assert.equal(queue.items[1].text, 'Next prompt');

  // An answer that finished is not treated as stalled.
  queue.rememberSent({ id: 'ok', text: 'Answered prompt' });
  clock += 10_000;
  generating = false;
  length = 300;
  assert.equal(await queue.checkStalledAndStartNewChat(), false);
  clock += 2 * 60 * 60 * 1000;
  assert.equal(await queue.checkStalledAndStartNewChat(), false);
  assert.equal(switched.length, 1);
});

test('a delivery timeout reloads once, and if it persists after the reload continues in a new chat with the prompt re-queued', async t => {
  const html = body => `<!doctype html><body><main><article data-testid="conversation-turn-1">
    <div data-user-message-bubble="true">メッセージの配信がタイムアウトしました。もう一度お試しください。 と書かれたら？</div></article>${body}</main></body>`;
  const dom = new JSDOM(html(''), { url: 'https://chatgpt.com/c/test', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  t.after(() => dom.window.close());
  const root = path.join(__dirname, '..');
  for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8')
    .replace('  const queueManager = new QueueManager();', '  globalThis.__queueTest = { QueueManager, DOM }; return;\n  const queueManager = new QueueManager();');
  window.eval(source);
  const { QueueManager, DOM } = window.__queueTest;
  const queue = new QueueManager();
  queue.notify = () => {};
  queue.saveQueue = async () => {};
  let reloads = 0;
  const switched = [];
  queue.reloadPage = () => { reloads++; };
  queue.startNewChat = async reason => { switched.push(reason); };
  queue.rememberSent({ text: 'Timed-out prompt', tools: [] });

  assert.equal(DOM.hasDeliveryTimeout(), false, 'the words inside the user\'s own prompt do not count');
  assert.equal(await queue.checkDeliveryTimeout(), false);

  window.document.querySelector('main').insertAdjacentHTML('beforeend',
    '<article data-testid="conversation-turn-2"><div class="text-token-text-error">メッセージの配信がタイムアウトしました。もう一度お試しください。</div></article>');
  assert.equal(DOM.hasDeliveryTimeout(), true);
  assert.equal(await queue.checkDeliveryTimeout(), true);
  assert.equal(reloads, 1, 'no retry button: reload');
  assert.equal(switched.length, 0);

  // Same tab after the reload (sessionStorage persists): still timing out -> new chat.
  assert.equal(await queue.checkDeliveryTimeout(), true);
  assert.equal(reloads, 1);
  assert.equal(switched.length, 1);
  assert.equal(queue.items[0].text, 'Timed-out prompt');
});

test('a delivery timeout with a retry button presses it first, then reloads if the error stays', async t => {
  const dom = new JSDOM(`<!doctype html><body><main><article data-testid="conversation-turn-1">
    <div class="text-token-text-error">メッセージの配信がタイムアウトしました。もう一度お試しください。</div>
    <button type="button">再試行</button></article></main></body>`, { url: 'https://chatgpt.com/c/test', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  t.after(() => dom.window.close());
  const root = path.join(__dirname, '..');
  for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  let clock = 1_000_000;
  window.Date.now = () => clock;
  const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8')
    .replace('  const queueManager = new QueueManager();', '  globalThis.__queueTest = { QueueManager }; return;\n  const queueManager = new QueueManager();');
  window.eval(source);
  const queue = new window.__queueTest.QueueManager();
  queue.notify = () => {};
  queue.saveQueue = async () => {};
  let reloads = 0;
  let retries = 0;
  queue.reloadPage = () => { reloads++; };
  queue.startNewChat = async () => {};
  window.document.querySelector('button').addEventListener('click', () => retries++);
  queue.rememberSent({ text: 'Timed-out prompt', tools: [] });

  assert.equal(await queue.checkDeliveryTimeout(), true);
  assert.equal(retries, 1, 'the retry button is pressed first');
  assert.equal(reloads, 0);
  clock += 10 * 1000;
  assert.equal(await queue.checkDeliveryTimeout(), true, 'waiting for the retry');
  assert.equal(retries, 1);
  assert.equal(reloads, 0);
  clock += 25 * 1000;
  assert.equal(await queue.checkDeliveryTimeout(), true);
  assert.equal(reloads, 1, 'still failing 30s after the retry: reload');
});

test('a finished answer that changes later (sources added) is not appended again as a new turn', async t => {
  const dom = new JSDOM('<!doctype html><body><main></main></body>', { url: 'https://chatgpt.com/c/test', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  t.after(() => dom.window.close());
  const root = path.join(__dirname, '..');
  for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'content.js'), 'utf8')
    .replace('  const queueManager = new QueueManager();', '  globalThis.__queueTest = { QueueManager, DOM }; return;\n  const queueManager = new QueueManager();'));
  const { QueueManager, DOM } = window.__queueTest;
  const queue = new QueueManager();
  let answer = '回答本文です。';
  DOM.getLatestAnswer = () => ({ userPrompt: '質問', text: answer, isStreaming: false });
  DOM.getRecentQAHistory = () => [{ turn: 1, prompt: '質問', answer, isStreaming: false }];
  DOM.getCurrentModelInfo = () => ({});
  let registry = {};
  window.chrome = { storage: { local: { get: async () => ({ cgq_tabs_registry: registry }), set: async value => { registry = value.cgq_tabs_registry || registry; } } } };
  await queue.reportToRegistry();
  answer = '回答本文です。\n\n参照: 出典A'; // the same turn, after sources were added
  const state = await queue.reportToRegistry();
  assert.equal(state.recentQA.length, 1);
  assert.match(state.recentQA[0].answer, /出典A/);
});

// Reported 2026-10-26: an agent-style turn showed 「PDFスキル…を確認」 then 「修正方針を確認」 as its text,
// and the Queue Manager listed the same prompt three times, once per text.
test('a turn whose text changes completely is still one turn', async t => {
  const dom = new JSDOM('<!doctype html><body><main></main></body>', { url: 'https://chatgpt.com/c/test', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  t.after(() => dom.window.close());
  const root = path.join(__dirname, '..');
  for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'content.js'), 'utf8')
    .replace('  const queueManager = new QueueManager();', '  globalThis.__queueTest = { QueueManager, DOM }; return;\n  const queueManager = new QueueManager();'));
  const { QueueManager, DOM } = window.__queueTest;
  const queue = new QueueManager();
  const prompt = '修正を行なって　一旦最低限の変更のみ行なって';
  let answer = 'PDFスキルと19〜21ページの赤字注記を確認';
  DOM.getLatestAnswer = () => ({ userPrompt: prompt, text: answer, isStreaming: false });
  DOM.getRecentQAHistory = () => [{ turn: 1, prompt: '前の質問', answer: '前の回答', isStreaming: false }, { turn: 2, prompt, answer, isStreaming: false }];
  DOM.getCurrentModelInfo = () => ({});
  let registry = {};
  window.chrome = { storage: { local: { get: async () => ({ cgq_tabs_registry: registry }), set: async value => { registry = value.cgq_tabs_registry || registry; } } } };
  await queue.reportToRegistry();
  answer = '修正方針を確認';
  await queue.reportToRegistry();
  answer = '添付PDFの赤字指摘に直接対応する箇所だけを修正します。';
  const state = await queue.reportToRegistry();
  assert.deepEqual(Array.from(state.recentQA, qa => qa.prompt), ['前の質問', prompt]);
  assert.equal(state.recentQA[1].answer, answer);
});
