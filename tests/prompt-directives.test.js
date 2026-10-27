const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { parsePrompt, NativeTools, attach } = require('../composer-tools.js');

test('prefix directives support multiple apps, tools, quoted names, and local newchat', () => {
  assert.deepEqual(parsePrompt('@GitHub @"Google Drive" /[Web search] Compare the documents'), {
    text: 'Compare the documents', requests: [
      { marker: '@', label: 'GitHub' }, { marker: '@', label: 'Google Drive' }, { marker: '/', label: 'Web search' }
    ]
  });
  assert.deepEqual(parsePrompt('/NEWCHAT @GitHub Review'), { action: 'newchat', text: '@GitHub Review', requests: [] });
  assert.deepEqual(parsePrompt('/newchat'), { action: 'newchat', text: '', requests: [] });
  assert.notEqual(parsePrompt('/newchatty question').action, 'newchat');
  for (const text of ['hello @GitHub', 'mail@example.com', 'https://example.com/a', '/tmp/file.txt', '`@GitHub test`', '@GitHub']) {
    assert.deepEqual(parsePrompt(text), { text, requests: [] }, text);
  }
});

test('plain directives resolve live IDs and reject ambiguous or missing selections', async () => {
  const native = new NativeTools('chatgpt', { doc: {} });
  await assert.rejects(native.resolvePrompt('Question', [{ type: 'invalid' }]), /読み取れません/);
  const github = { type: 'app', platform: 'chatgpt', label: 'GitHub', id: 'app://actual-id' };
  native.query = async () => [github];
  assert.deepEqual(await native.resolvePrompt('@github Question'), { text: 'Question', tools: [github] });
  native.query = async () => [github, { ...github, id: 'app://another-id' }];
  await assert.rejects(native.resolvePrompt('@GitHub Question'), /一意に選択できません/);
  native.query = async () => [];
  await assert.rejects(native.resolvePrompt('@GitHub Question'), /一意に選択できません/);
});

test('best effort resolution retains available apps and failed skill instructions without swallowing strict errors', async () => {
  const native = new NativeTools('chatgpt', { doc: {} });
  const github = { type: 'app', platform: 'chatgpt', label: 'GitHub', id: 'app://github' };
  native.query = async (marker, label) => label === 'GitHub' ? [github] : [];
  const errors = [];
  const prompt = '@GitHub /my-skill Summarize\nwith sources';
  const result = await native.resolvePrompt(prompt, [], error => errors.push(error.message));
  assert.equal(result.text, prompt);
  assert.deepEqual(result.tools, [github]);
  assert.equal(errors.length, 1);
  await assert.rejects(native.resolvePrompt(prompt), /my-skill/);
});

test('bulk autocomplete inserts app text on the current row without sharing chips with other rows', async t => {
  const dom = new JSDOM('<div><textarea></textarea></div>', { pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const input = dom.window.document.querySelector('textarea');
  const controller = attach(input, { literal: true, query: async () => [
    { type: 'app', platform: 'chatgpt', label: 'Google Drive', id: 'app://drive' }
  ] });
  input.value = 'Ordinary question\n@Go';
  input.setSelectionRange(input.value.length, input.value.length);
  input.dispatchEvent(new dom.window.Event('input'));
  await new Promise(resolve => setTimeout(resolve, 330));
  dom.window.document.querySelector('[role="option"]').click();
  assert.equal(input.value, 'Ordinary question\n@"Google Drive" ');
  assert.deepEqual(controller.getTools(), []);
  controller.destroy();
});

test('newchat autocomplete works without a connected app menu and Ctrl+Enter can submit', t => {
  const dom = new JSDOM('<div><textarea></textarea></div>');
  t.after(() => dom.window.close());
  const input = dom.window.document.querySelector('textarea');
  let queried = false;
  attach(input, { query: async () => { queried = true; throw new Error('offline'); } });
  input.value = '/newchat'; input.setSelectionRange(8, 8);
  input.dispatchEvent(new dom.window.Event('input'));
  const option = dom.window.document.querySelector('[role="option"]');
  assert.equal(option.textContent, '/ newchat');
  const event = new dom.window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  assert.equal(queried, false);
});

test('pasted directives stay editable and show recognition above the composer without menu queries', t => {
  const dom = new JSDOM('<div><textarea></textarea></div>');
  t.after(() => dom.window.close());
  const input = dom.window.document.querySelector('textarea');
  const controller = attach(input, { query: () => assert.fail('complete pasted directives do not open native menus') });
  const value = '/deepresearch @"Google Drive" 調査してください\n結果は日本語で';
  input.value = value; input.setSelectionRange(value.length, value.length);
  input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(input.value, value);
  assert.equal(input.previousElementSibling.className, 'cgq-prompt-chips');
  assert.match(input.previousElementSibling.textContent, /deepresearch · 指定を認識/);
  assert.match(input.previousElementSibling.textContent, /Google Drive · 指定を認識/);
  assert.deepEqual(controller.getTools(), []);
  input.value = '普通の本文 user@example.com /deepresearch';
  controller.sync();
  assert.equal(input.previousElementSibling.hidden, true);
});

test('normal autocomplete preserves copyable tool syntax and updates badges when removed', async t => {
  const dom = new JSDOM('<div><textarea></textarea></div>');
  t.after(() => dom.window.close());
  const input = dom.window.document.querySelector('textarea');
  attach(input, { query: async () => [{ type: 'app', platform: 'chatgpt', label: 'Google Drive', id: 'app://drive' }] });
  input.value = '@Go'; input.setSelectionRange(3, 3);
  input.dispatchEvent(new dom.window.Event('input'));
  await new Promise(resolve => setTimeout(resolve, 330));
  dom.window.document.querySelector('[role="option"]').click();
  assert.equal(input.value, '@"Google Drive" ');
  assert.match(input.previousElementSibling.textContent, /指定を認識/);
  input.value = ''; input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(input.previousElementSibling.hidden, true);
});

test('dashboard bulk input forwards directives verbatim and ignores IME confirmation', async t => {
  const root = path.join(__dirname, '..');
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8'), {
    url: 'https://queue-manager.test', runScripts: 'outside-only', pretendToBeVisual: true
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const commands = [];
  const tab = { tabId: 'tab_1', chromeTabId: 1, title: 'ChatGPT', platform: 'chatgpt',
    url: 'https://chatgpt.com/c/test', lastHeartbeat: Date.now(), items: [], recentQA: [] };
  window.setInterval = () => 0;
  window.chrome = {
    runtime: { sendMessage: command => commands.push(command) },
    storage: { local: { get: async () => ({ cgq_tabs_registry: { tab_1: tab } }), set: async values => commands.push(...Object.values(values)) }, onChanged: { addListener() {} } },
    tabs: { query: (options, reply) => reply([{ id: 1, title: tab.title, url: tab.url }]),
      sendMessage: (id, request, reply) => reply({ success: true, state: tab }) }
  };
  for (const file of ['references.js', 'composer-tools.js', 'dashboard.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  await new Promise(resolve => setImmediate(resolve));
  window.document.getElementById('nav-bulk-add').click();
  const input = window.document.getElementById('bulk-modal-textarea');
  assert.equal(window.document.getElementById('bulk-modal-delimiter').value, 'single');
  const multiline = '/deepresearch\n公式資料を使ってください。\n\n出典を記載してください。';
  input.value = multiline;
  window.document.getElementById('bulk-modal-submit').click();
  assert.deepEqual(Array.from(commands.find(cmd => cmd.action === 'ENQUEUE_MANY').texts), [multiline]);
  commands.length = 0;
  window.document.getElementById('nav-bulk-add').click();
  window.document.getElementById('bulk-modal-delimiter').value = 'line';
  input.value = 'Question\n/newchat\n@GitHub Review';
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true }));
  assert.equal(commands.some(cmd => cmd.action === 'ENQUEUE_MANY'), false);
  window.document.getElementById('bulk-modal-submit').click();
  const bulk = commands.find(cmd => cmd.action === 'ENQUEUE_MANY');
  assert.ok(bulk, JSON.stringify(commands));
  assert.deepEqual(Array.from(bulk.texts), ['Question', '/newchat', '@GitHub Review']);
  assert.equal(window.document.getElementById('dashboard-bulk-modal').style.display, 'none');
});
