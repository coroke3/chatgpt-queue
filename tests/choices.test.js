const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));

const widget = `
  <div class="choice-card">
    <div role="radiogroup">
      <label><input type="radio" name="p" checked><span>推奨：両方とも構成から整理</span><br><span>考察を再編し、冗長部分を削減</span></label>
      <label><input type="radio" name="p"><span>現行構成のまま厳密に添削</span><br><span>各段落の論理と日本語を改善する</span></label>
      <label><input type="radio" name="p"><span>減点リスクを最優先で修正</span><br><span>不足する根拠に絞って直す</span></label>
    </div>
    <button type="button" class="submit">この方針で修正する</button>
  </div>`;

test('ChatGPT choice widgets are extracted with their options and can be applied in the tab', async t => {
  const dom = new JSDOM(`<!doctype html><body><main>
    <article data-testid="conversation-turn-1"><div data-user-message-bubble="true">レポートを直して</div>
      <div data-message-author-role="assistant"><div class="markdown"><h3>4. 修正方針を選択</h3></div>${widget}</div></article>
  </main><form><div contenteditable="true" role="textbox"></div></form></body>`, {
    url: 'https://chatgpt.com/c/choices', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  t.after(() => window.close());
  for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8')
    .replace('  const queueManager = new QueueManager();', '  globalThis.__queueTest = { DOM }; return;\n  const queueManager = new QueueManager();');
  window.eval(source);
  const { DOM } = window.__queueTest;

  const [choice] = DOM.extractChoices(window.document.querySelector('main'));
  assert.ok(choice, 'the radio group is found');
  assert.equal(JSON.stringify(choice.options.map(o => o.label)), JSON.stringify(['推奨：両方とも構成から整理', '現行構成のまま厳密に添削', '減点リスクを最優先で修正']));
  assert.equal(choice.options[1].desc, '各段落の論理と日本語を改善する');
  assert.equal(choice.options[0].checked, true);
  assert.equal(choice.submitLabel, 'この方針で修正する');
  assert.equal(choice.done, false);

  let submitted = 0;
  window.document.querySelector('.submit').addEventListener('click', () => submitted++);
  assert.equal(await DOM.applyChoice(choice.key, 2), true);
  assert.equal(window.document.querySelectorAll('input[type="radio"]')[2].checked, true);
  assert.equal(submitted, 1);
});

test('the dashboard shows the choices under the answer and sends the selection to the tab', async t => {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8'), {
    url: 'https://extension-preview.test/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  t.after(() => window.close());
  const choices = [{ key: 'A|B', done: false, submitLabel: 'この方針で修正する',
    options: [{ label: 'A', desc: 'a の説明', checked: true }, { label: 'B', desc: '', checked: false }] }];
  const tab = { tabId: 'tab_c', chromeTabId: 9, platform: 'chatgpt', title: '選択', url: 'https://chatgpt.com/c/choice',
    lastHeartbeat: Date.now(), currentState: 'idle', items: [],
    recentQA: [{ turn: 1, prompt: '直して', answer: '方針を選んでください', isStreaming: false, choices }],
    latestAnswer: { userPrompt: '直して', text: '方針を選んでください', isStreaming: false } };
  const writes = [];
  window.setInterval = () => 0;
  window.chrome = {
    storage: { local: { get: async () => ({ cgq_tabs_registry: { tab_c: tab } }), set: async value => { writes.push(value); } }, onChanged: { addListener() {} } },
    runtime: { sendMessage() {} },
    tabs: { query(filter, respond) { respond([{ id: 9, title: tab.title, url: tab.url }]); }, sendMessage(id, request, respond) { respond?.(null); } }
  };
  for (const file of ['references.js', 'libs/marked.min.js', 'composer-tools.js', 'dashboard.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  await tick(); await tick();
  window.document.querySelector('.cgq-sidebar-chat-item')?.click();
  await tick();
  const form = window.document.querySelector('#single-answers-area .cgq-choice');
  assert.ok(form, 'choice form rendered');
  assert.match(form.textContent, /a の説明/);
  form.querySelectorAll('input[type="radio"]')[1].checked = true;
  form.querySelector('.cgq-choice-submit').click();
  await tick();
  const command = writes.map(w => w.cgq_cmd_tab_c).find(Boolean);
  assert.equal(command?.action, 'CHOOSE_OPTION');
  assert.equal(command.key, 'A|B');
  assert.equal(command.option, 1);
});

test('Gemini choice widgets inside a model response are extracted too', async t => {
  const dom = new JSDOM(`<!doctype html><body><main>
    <user-query>どちらにする？</user-query>
    <model-response><message-content><p>選んでください</p></message-content>
      <div role="radiogroup"><mat-radio-button><input type="radio" name="g"><label>案A</label></mat-radio-button>
      <mat-radio-button><input type="radio" name="g"><label>案B</label></mat-radio-button></div>
      <button>この案で進める</button></model-response>
  </main></body>`, { url: 'https://gemini.google.com/app/choice', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  t.after(() => window.close());
  for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  const source = fs.readFileSync(path.join(root, 'content.js'), 'utf8')
    .replace('  const queueManager = new QueueManager();', '  globalThis.__queueTest = { DOM }; return;\n  const queueManager = new QueueManager();');
  window.eval(source);
  const { DOM } = window.__queueTest;
  const turns = DOM.getRecentQAHistory('');
  const last = turns[turns.length - 1];
  assert.equal(JSON.stringify(last.choices?.[0]?.options.map(o => o.label)), JSON.stringify(['案A', '案B']));
  assert.equal(last.choices[0].submitLabel, 'この案で進める');
});
