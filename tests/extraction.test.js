const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');

// Shape measured on chatgpt.com (2026-10): the answer container holds inline <code> and action buttons,
// bold is <span data-d-default-strong>, and a code block's language label sits beside the <pre>.
test('ChatGPT answers keep their structure: bold spans, inline code, and code blocks with their language', () => {
  const dom = new JSDOM(`<!doctype html><body><main><article data-testid="conversation-turn-1">
    <div data-user-message-bubble="true">表示確認</div>
    <div data-content-search-unit-key="assistant-1"><div class="MarkdownRoot-x"><div class="DilResponseRoot-x" data-dil-message-id="m1">
      <h2>表示確認テスト</h2>
      <p data-d-component="text">これは<span data-d-inline="" data-d-default-strong="">太字の表示</span>と<code>インラインコード</code>です。</p>
      <div class="box"><div class="header"><div><svg width="16" height="16"></svg>JavaScript</div><button aria-label="コピー"></button></div>
        <div><pre class="font-mono"><code><span>const</span> message = "Hello";</code></pre></div></div>
      <blockquote><p>引用</p></blockquote>
    </div></div><button aria-label="コピー">コピー</button></div>
  </article></main></body>`, { url: 'https://chatgpt.com/c/x', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'content.js'), 'utf8')
    .replace('  const queueManager = new QueueManager();', '  globalThis.__queueTest = { DOM }; return;\n  const queueManager = new QueueManager();'));
  const md = window.__queueTest.DOM.extractAnswerMarkdown(window.document.querySelector('[data-content-search-unit-key]'));
  window.close();
  assert.match(md, /^## 表示確認テスト/m);
  assert.match(md, /\*\*太字の表示\*\*/);
  assert.match(md, /`インラインコード`/);
  assert.match(md, /```javascript\nconst message = "Hello";\n```/);
  assert.doesNotMatch(md, /^JavaScript$/m, 'the code header label is not repeated as text');
  assert.match(md, /^> 引用/m);
});

// Measured on chatgpt.com (2026-10): after /c/<id> redirects into a project (/g/<project>/c/<id>),
// the old thread stays mounted but not rendered (checkVisibility() === false), with the same
// data-turn-key values and its own composer. It must not double the history or take the queue's input.
test('a hidden second copy of the thread is ignored for history, composer and generating state', () => {
  const thread = (cls, answer, stop) => `<div class="${cls}">
    <div data-turn-key="t1"><div data-user-message-bubble="true">質問A</div>
      <div data-content-search-unit-key="assistant-1"><div class="MarkdownRoot-x"><p>回答A</p></div></div></div>
    <div data-turn-key="t2"><div data-user-message-bubble="true">質問B</div>
      <div data-content-search-unit-key="assistant-2"><div class="MarkdownRoot-x"><p>${answer}</p></div></div></div>
    <form><div contenteditable="true" role="textbox" class="${cls}-input"></div>${stop ? '<button aria-label="停止"></button>' : '<button aria-label="送信"></button>'}</form>
  </div>`;
  const dom = new JSDOM(`<!doctype html><body><main>${thread('stale', '回答B（古い）', true)}${thread('live', '回答B', false)}</main></body>`,
    { url: 'https://chatgpt.com/g/g-p-x/c/x', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  window.Element.prototype.checkVisibility = function () { return !this.closest('.stale'); };
  for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'content.js'), 'utf8')
    .replace('  const queueManager = new QueueManager();', '  globalThis.__queueTest = { DOM }; return;\n  const queueManager = new QueueManager();'));
  const { DOM } = window.__queueTest;
  const history = JSON.parse(JSON.stringify(DOM.getRecentQAHistory('')));
  const input = DOM.getPromptInput();
  const generating = DOM.isGenerating();
  window.close();
  assert.deepEqual(history.map(qa => [qa.prompt, qa.answer]), [['質問A', '回答A'], ['質問B', '回答B']]);
  assert.ok(input.classList.contains('live-input'), 'the queue types into the rendered composer');
  assert.equal(generating, false, "the stale copy's stop button does not count as generating");
});

// Shape measured on chatgpt.com (2026-10-26, 表示確認テスト) while a turn is in progress: an activity
// header row (button[aria-expanded] + shimmering label whose highlight layer repeats the text), the log
// (a tertiary step title and a note) and the answer outside that block.
const activityTurn = ({ label, shimmer, answer, expanded = 'true' }) => `<div data-turn-key="t1"><div data-talvt-turn-state="in_progress">
    <div data-user-message-bubble="true"><button aria-expanded="false">プロンプト内のボタン</button>続けて</div>
    <div class="flex flex-col">
      <div class="activity-header"><button aria-labelledby="r1" aria-expanded="${expanded}"></button>
        <span><span class="${shimmer ? 'cadencedShimmer-uMTG1d' : ''}">${label}${shimmer ? `<span class="cadencedShimmerSweep-ICUAVH" aria-hidden="true"><span>${label}</span></span>` : ''}</span></span><span><svg></svg></span></div>
      <div><div><div class="MarkdownRoot-a" data-markdown-text-tone="tertiary"><p><span>追加UIを調査した</span></p></div></div>
        <div><h4>ChatGPT の発言:</h4><div class="MarkdownRoot-b"><p>前回の表示に含まれていないUIを確認します。</p></div></div></div>
    </div>
    <button>スキップ</button>
    <div><h4>ChatGPT の発言:</h4><div class="MarkdownRoot-c AdaptiveStreaming-x">${answer}</div></div>
  </div><div><div role="status"><span>接続が途切れました。回答全体の受信を待っています</span></div></div></div>`;

const bootChat = html => {
  const dom = new JSDOM(`<!doctype html><body><main>${html}
    <form><div contenteditable="true" role="textbox"></div><button aria-label="停止"></button></form></main></body>`,
  { url: 'https://chatgpt.com/c/x', runScripts: 'outside-only', pretendToBeVisual: true });
  for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) dom.window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(root, 'content.js'), 'utf8')
    .replace('  const queueManager = new QueueManager();', '  globalThis.__queueTest = { DOM }; return;\n  const queueManager = new QueueManager();'));
  return dom.window;
};

test('ChatGPT activity block: label without the shimmer copy, its log, skip, and kept out of the answer', () => {
  const window = bootChat(activityTurn({ label: '3件のサイトを検索中', shimmer: true, answer: '<p>本文です。</p>' }));
  const { DOM } = window.__queueTest;
  const progress = JSON.parse(JSON.stringify(DOM.getProgress()));
  const history = JSON.parse(JSON.stringify(DOM.getRecentQAHistory('')));
  window.close();
  assert.equal(progress.label, '3件のサイトを検索中', 'the highlight layer does not double the label');
  assert.equal(progress.notice, '接続が途切れました。回答全体の受信を待っています');
  assert.deepEqual(progress.thinking, {
    label: '3件のサイトを検索中', active: true, expanded: true, canSkip: true,
    log: [{ kind: 'step', text: '追加UIを調査した' }, { kind: 'text', text: '前回の表示に含まれていないUIを確認します。' }]
  });
  assert.equal(history.length, 1);
  assert.equal(history[0].answer, '本文です。', 'the log is not part of the answer');
  assert.equal(history[0].thinking.label, '3件のサイトを検索中');
});

test('a finished activity header keeps its summary and the log while collapsed', () => {
  const window = bootChat(activityTurn({ label: '1m 27s考えました', shimmer: false, answer: '<p>完了。</p>', expanded: 'false' }));
  const history = JSON.parse(JSON.stringify(window.__queueTest.DOM.getRecentQAHistory('')));
  window.close();
  assert.equal(history[0].thinking.label, '1m 27s考えました');
  assert.equal(history[0].thinking.active, false);
  assert.equal(history[0].thinking.expanded, false);
  assert.equal(history[0].thinking.log.length, 2);
  assert.equal(history[0].answer, '完了。');
});

// Measured 2026-10-26: a conversation that fails to load leaves only the sidebar, whose profile
// shows 「プロフィールを読み込み中」 inside an aria-busy element. That is not an answer.
test('the sidebar profile placeholder is never read as an answer', () => {
  const window = bootChat(`<nav><div aria-busy="true">プロフィールを読み込み中</div><div>Y N</div><div>Plus</div></nav>
    <div>この ChatGPT の会話を読み込めませんでした</div>`);
  const answer = JSON.parse(JSON.stringify(window.__queueTest.DOM.getLatestAnswer('')));
  window.close();
  assert.ok(!answer || !/プロフィール/.test(answer.text || ''), JSON.stringify(answer));
});
