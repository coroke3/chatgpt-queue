const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.join(__dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function bootContent({ platform = 'chatgpt' } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(`<!doctype html><body></body>`, {
    url: platform === 'gemini' ? 'https://gemini.google.com/app' : 'https://chatgpt.com/',
    runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole
  });
  const { window } = dom;
  const store = {};
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  window.chrome = {
    runtime: {
      sendMessage(request, respond) { respond?.({ chromeTabId: 101 }); },
      onMessage: { addListener() {} }
    },
    storage: {
      local: {
        async get(keys) { return Object.fromEntries(keys.filter(key => key in store).map(key => [key, store[key]])); },
        async set(values) { Object.assign(store, values); },
        async remove(key) { delete store[key]; }
      },
      onChanged: { addListener() {} }
    }
  };
  window.eval(fs.readFileSync(path.join(root, 'references.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'model-picker.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'composer-tools.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'content.js'), 'utf8'));
  await tick(); await tick();
  return { dom, window, doc: window.document };
}

async function bootDashboard({ tabs = [], snapshots = {}, registry = {} } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8'), {
    url: 'https://queue-manager.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole
  });
  const { window } = dom;
  const native = { tabs, registry, snapshots };
  const events = [];
  const intervals = [];
  const commands = [];
  const requests = [];
  window.setInterval = fn => { intervals.push(fn); return 0; };
  window.chrome = {
    runtime: { sendMessage(request) { commands.push(request); } },
    storage: {
      local: { get: async () => ({ cgq_tabs_registry: native.registry }), set: async values => { commands.push(values); } },
      onChanged: { addListener(fn) { events.push(fn); } }
    },
    tabs: {
      query(filter, callback) { requests.push({ query: filter }); callback(native.tabs); },
      sendMessage(id, request, callback) {
        requests.push({ id, ...request });
        Promise.resolve().then(() => callback(native.snapshots[id] ? { success: true, state: native.snapshots[id] } : undefined));
      }
    }
  };
  window.eval(fs.readFileSync(path.join(root, 'references.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'composer-tools.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8'));
  await tick(); await tick();
  return { dom, window, doc: window.document, native };
}

test('ChatGPT multi-turn conversation extraction pairs prompts and answers 1-to-1', async t => {
  const f = await bootContent({ platform: 'chatgpt' });
  t.after(() => f.dom.window.close());

  const conversationHtml = `
    <main>
      <article data-testid="conversation-turn-2">
        <div data-message-author-role="user">
          <div class="whitespace-pre-wrap">最初の質問です</div>
        </div>
      </article>
      <article data-testid="conversation-turn-3">
        <div data-message-author-role="assistant">
          <div class="markdown prose">最初の回答です。詳しく解説します。</div>
        </div>
      </article>
      <article data-testid="conversation-turn-4">
        <div data-message-author-role="user">
          <div class="whitespace-pre-wrap">2つ目の質問です</div>
        </div>
      </article>
      <article data-testid="conversation-turn-5">
        <div data-message-author-role="assistant">
          <div class="markdown prose">2つ目の回答です。結論は次の通りです。</div>
        </div>
      </article>
    </main>
  `;
  f.doc.body.insertAdjacentHTML('beforeend', conversationHtml);

  const history = f.window.__CGQ_DOM__.getRecentQAHistory();
  assert.equal(history.length, 2, 'Must have exactly 2 paired turns, not 4 fragmented turns');
  assert.equal(history[0].turn, 1);
  assert.equal(history[0].prompt, '最初の質問です');
  assert.ok(history[0].answer.includes('最初の回答です。'));

  assert.equal(history[1].turn, 2);
  assert.equal(history[1].prompt, '2つ目の質問です');
  assert.ok(history[1].answer.includes('2つ目の回答です。'));

  const latest = f.window.__CGQ_DOM__.getLatestAnswer();
  assert.ok(latest, 'Latest answer must exist');
  assert.equal(latest.userPrompt, '2つ目の質問です');
  assert.ok(latest.text.includes('2つ目の回答です。'));
});

test('ChatGPT active streaming pairs prompt with stream text on latest turn', async t => {
  const f = await bootContent({ platform: 'chatgpt' });
  t.after(() => f.dom.window.close());

  // Simulate generating
  f.window.__CGQ_DOM__.isGenerating = () => true;

  const conversationHtml = `
    <main>
      <article data-testid="conversation-turn-2">
        <div data-message-author-role="user">
          <div class="whitespace-pre-wrap">生成中の質問です</div>
        </div>
      </article>
      <article data-testid="conversation-turn-3">
        <div data-message-author-role="assistant">
          <div class="result-streaming">リアルタイムでストリーミング中...</div>
        </div>
      </article>
    </main>
  `;
  f.doc.body.insertAdjacentHTML('beforeend', conversationHtml);

  const history = f.window.__CGQ_DOM__.getRecentQAHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].prompt, '生成中の質問です');
  assert.ok(history[0].answer.includes('リアルタイムでストリーミング中...'));
  assert.equal(history[0].isStreaming, true);

  const latest = f.window.__CGQ_DOM__.getLatestAnswer();
  assert.equal(latest.userPrompt, '生成中の質問です');
  assert.ok(latest.text.includes('リアルタイムでストリーミング中...'));
  assert.equal(latest.isStreaming, true);
});

test('Queue Manager renders user prompts in chat bubble design for both Single and Grid views', async t => {
  const chatgptTab = { id: 10, url: 'https://chatgpt.com/c/test', title: 'ChatGPTの会話' };
  const snapshot = {
    tabId: 'real_10',
    chromeTabId: 10,
    platform: 'chatgpt',
    url: chatgptTab.url,
    title: chatgptTab.title,
    lastHeartbeat: Date.now(),
    currentState: 'idle',
    items: [],
    recentQA: [
      { turn: 1, prompt: 'ChatGPTへの1通目のプロンプト', answer: '1通目の回答です', isStreaming: false },
      { turn: 2, prompt: 'ChatGPTへの2通目のプロンプト', answer: '2通目の回答です', isStreaming: false }
    ],
    latestAnswer: {
      userPrompt: 'ChatGPTへの2通目のプロンプト',
      text: '2通目の回答です',
      isStreaming: false
    }
  };

  const f = await bootDashboard({
    tabs: [chatgptTab],
    snapshots: { 10: snapshot },
    registry: { real_10: snapshot }
  });
  t.after(() => f.dom.window.close());

  // 1. Single Chat View
  f.doc.querySelector('.cgq-sidebar-chat-item')?.click();
  await tick();

  const singleAnswersArea = f.doc.getElementById('single-answers-area');
  assert.ok(singleAnswersArea);

  // Check chat bubble row and bubble element
  const singleRows = singleAnswersArea.querySelectorAll('.cgq-user-prompt-row');
  assert.ok(singleRows.length > 0, 'Single chat view must render .cgq-user-prompt-row');

  const singleBubbles = singleAnswersArea.querySelectorAll('.cgq-user-prompt-bubble');
  assert.ok(singleBubbles.length > 0, 'Single chat view must render .cgq-user-prompt-bubble');
  assert.ok(Array.from(singleBubbles).some(b => b.textContent.includes('ChatGPTへの2通目のプロンプト')));

  // Old labels like "Q:" must NOT be present
  assert.equal(singleAnswersArea.querySelectorAll('.cgq-user-prompt-badge').length, 0);
  assert.ok(!singleAnswersArea.innerHTML.includes('<strong>Q:</strong>'));

  // 2. Parallel Grid View
  f.doc.getElementById('nav-all-grid').click();
  await tick();

  const gridRows = f.doc.querySelectorAll('.cgq-user-prompt-row.card-mode');
  assert.ok(gridRows.length > 0, 'Grid view must render .cgq-user-prompt-row.card-mode');

  const gridBubbles = f.doc.querySelectorAll('.cgq-user-prompt-bubble.card-mode');
  assert.ok(gridBubbles.length > 0, 'Grid view must render .cgq-user-prompt-bubble.card-mode');
  assert.ok(Array.from(gridBubbles).some(b => b.textContent.includes('ChatGPTへの2通目のプロンプト')));

  // No "Q:" prefix in grid mode either
  assert.ok(!f.doc.getElementById('tabs-grid').innerHTML.includes('<strong>Q:</strong>'));
});

test('Queue Manager renders Gemini user prompts in the same chat bubble design', async t => {
  const geminiTab = { id: 20, url: 'https://gemini.google.com/app/test', title: 'Geminiの会話' };
  const snapshot = {
    tabId: 'real_20',
    chromeTabId: 20,
    platform: 'gemini',
    url: geminiTab.url,
    title: geminiTab.title,
    lastHeartbeat: Date.now(),
    currentState: 'idle',
    items: [],
    recentQA: [
      { turn: 1, prompt: 'Geminiへの質問プロンプト', answer: 'Geminiの回答です', isStreaming: false }
    ],
    latestAnswer: {
      userPrompt: 'Geminiへの質問プロンプト',
      text: 'Geminiの回答です',
      isStreaming: false
    }
  };

  const f = await bootDashboard({
    tabs: [geminiTab],
    snapshots: { 20: snapshot },
    registry: { real_20: snapshot }
  });
  t.after(() => f.dom.window.close());

  // Single view
  f.doc.querySelector('.cgq-sidebar-chat-item')?.click();
  await tick();

  const singleAnswersArea = f.doc.getElementById('single-answers-area');
  const bubble = singleAnswersArea.querySelector('.cgq-user-prompt-bubble');
  assert.ok(bubble, 'Gemini must also render .cgq-user-prompt-bubble in single view');
  assert.equal(bubble.textContent.trim(), 'Geminiへの質問プロンプト');

  // Grid view
  f.doc.getElementById('nav-all-grid').click();
  await tick();

  const gridBubble = f.doc.querySelector('.cgq-user-prompt-bubble.card-mode');
  assert.ok(gridBubble, 'Gemini must also render .cgq-user-prompt-bubble.card-mode in grid view');
  assert.equal(gridBubble.textContent.trim(), 'Geminiへの質問プロンプト');
});

test('ChatGPT modern DOM without data-testid pairs multi-turn conversations and ignores toolbar buttons', async t => {
  const f = await bootContent({ platform: 'chatgpt' });
  t.after(() => f.dom.window.close());

  // Realistic modern ChatGPT DOM without data-testid="conversation-turn-X"
  const conversationHtml = `
    <main>
      <div class="flex flex-col text-sm">
        <!-- Turn 1 User -->
        <article class="w-full text-token-text-primary">
          <h5 class="sr-only">You said:</h5>
          <div class="relative max-w-[70%]">
            <div class="whitespace-pre-wrap">1回目のプロンプト：VueとReactの違いを教えて</div>
          </div>
        </article>

        <!-- Turn 1 Assistant -->
        <article class="w-full text-token-text-primary">
          <h6 class="sr-only">ChatGPT said:</h6>
          <div data-message-author-role="assistant">
            <div class="markdown prose">VueとReactの主な違いは双方向バインディングと学習曲線です。</div>
            <div class="action-buttons flex gap-2">
              <button class="copy-btn">コピー</button>
              <button class="thumb-up">高評価</button>
            </div>
          </div>
        </article>

        <!-- Turn 2 User -->
        <article class="w-full text-token-text-primary">
          <h5 class="sr-only">You said:</h5>
          <div class="relative max-w-[70%]">
            <div class="whitespace-pre-wrap">2回目のプロンプト：それぞれの長所と短所は？</div>
          </div>
        </article>

        <!-- Turn 2 Assistant -->
        <article class="w-full text-token-text-primary">
          <h6 class="sr-only">ChatGPT said:</h6>
          <div data-message-author-role="assistant">
            <div class="markdown prose">Vueは直感的で、Reactは柔軟性が高いです。</div>
            <div class="action-buttons flex gap-2">
              <button class="copy-btn">コピー</button>
              <button class="thumb-up">高評価</button>
            </div>
          </div>
        </article>

        <!-- Turn 3 User -->
        <article class="w-full text-token-text-primary">
          <h5 class="sr-only">You said:</h5>
          <div class="relative max-w-[70%]">
            <div class="whitespace-pre-wrap">3回目のプロンプト：初心者におすすめなのはどちら？</div>
          </div>
        </article>

        <!-- Turn 3 Assistant -->
        <article class="w-full text-token-text-primary">
          <h6 class="sr-only">ChatGPT said:</h6>
          <div data-message-author-role="assistant">
            <div class="markdown prose">HTML/CSSの知識があればVueが始めやすいです。</div>
            <div class="action-buttons flex gap-2">
              <button class="copy-btn">コピー</button>
              <button class="thumb-up">高評価</button>
            </div>
          </div>
        </article>
      </div>
    </main>
  `;
  f.doc.body.insertAdjacentHTML('beforeend', conversationHtml);

  const history = f.window.__CGQ_DOM__.getRecentQAHistory();
  assert.equal(history.length, 3, 'Must successfully extract all 3 multi-turn QA pairs from modern <article> elements');

  assert.equal(history[0].turn, 1);
  assert.equal(history[0].prompt, '1回目のプロンプト：VueとReactの違いを教えて');
  assert.ok(history[0].answer.includes('VueとReactの主な違いは双方向バインディング'));
  assert.ok(!history[0].answer.includes('高評価'), 'Assistant answer must strip action toolbar buttons');

  assert.equal(history[1].turn, 2);
  assert.equal(history[1].prompt, '2回目のプロンプト：それぞれの長所と短所は？');
  assert.ok(history[1].answer.includes('Vueは直感的で、Reactは柔軟性が高いです。'));

  assert.equal(history[2].turn, 3);
  assert.equal(history[2].prompt, '3回目のプロンプト：初心者におすすめなのはどちら？');
  assert.ok(history[2].answer.includes('HTML/CSSの知識があればVueが始めやすいです。'));

  const latest = f.window.__CGQ_DOM__.getLatestAnswer();
  assert.ok(latest, 'Latest answer must exist');
  assert.equal(latest.userPrompt, '3回目のプロンプト：初心者におすすめなのはどちら？');
  assert.ok(latest.text.includes('HTML/CSSの知識があればVueが始めやすいです。'));
});

test('ChatGPT regenerated answers update the turn answer instead of creating orphan turns', async t => {
  const f = await bootContent({ platform: 'chatgpt' });
  t.after(() => f.dom.window.close());

  // Turn 1 User + Original Assistant response followed by Regenerated Assistant response
  const conversationHtml = `
    <main>
      <article class="w-full">
        <h5 class="sr-only">You said:</h5>
        <div class="whitespace-pre-wrap">質問：再生成をテストします</div>
      </article>
      <article class="w-full">
        <div data-message-author-role="assistant">
          <div class="markdown prose">最初のバージョンです。</div>
        </div>
      </article>
      <article class="w-full">
        <div data-message-author-role="assistant">
          <div class="markdown prose">再生成された最新の回答バージョンです。</div>
        </div>
      </article>
    </main>
  `;
  f.doc.body.insertAdjacentHTML('beforeend', conversationHtml);

  const history = f.window.__CGQ_DOM__.getRecentQAHistory();
  assert.equal(history.length, 1, 'Must pair regenerated answer with the user prompt as 1 turn');
  assert.equal(history[0].prompt, '質問：再生成をテストします');
  assert.ok(history[0].answer.includes('再生成された最新の回答バージョンです。'));
});

test('Queue Manager displays all ChatGPT multi-turn conversation history in Single View and Grid View', async t => {
  const chatgptTab = { id: 30, url: 'https://chatgpt.com/c/multi-history-test', title: 'ChatGPT会話履歴テスト' };
  const snapshot = {
    tabId: 'real_30',
    chromeTabId: 30,
    platform: 'chatgpt',
    url: chatgptTab.url,
    title: chatgptTab.title,
    lastHeartbeat: Date.now(),
    currentState: 'idle',
    items: [],
    recentQA: [
      { turn: 1, prompt: '第1問：日本の首都は？', answer: '日本の首都は東京です。', isStreaming: false },
      { turn: 2, prompt: '第2問：人口はどのくらい？', answer: '東京都の人口は約1400万人です。', isStreaming: false },
      { turn: 3, prompt: '第3問：有名な観光地は？', answer: '浅草寺や東京タワー、渋谷などが有名です。', isStreaming: false }
    ],
    latestAnswer: {
      userPrompt: '第3問：有名な観光地は？',
      text: '浅草寺や東京タワー、渋谷などが有名です。',
      isStreaming: false
    }
  };

  const f = await bootDashboard({
    tabs: [chatgptTab],
    snapshots: { 30: snapshot },
    registry: { real_30: snapshot }
  });
  t.after(() => f.dom.window.close());

  // 1. Single Chat View: Verify all 3 turns are rendered with badges and prompt bubbles
  f.doc.querySelector('.cgq-sidebar-chat-item')?.click();
  await tick();

  const singleAnswersArea = f.doc.getElementById('single-answers-area');
  assert.ok(singleAnswersArea);

  // Laid out like ChatGPT: no thread header, history toggles or turn badges, just the turns.
  assert.equal(singleAnswersArea.querySelector('.cgq-thread-count-badge, .cgq-thread-toggle-btn, .cgq-turn-badge'), null);

  const singleCards = singleAnswersArea.querySelectorAll('.cgq-answer-card');
  assert.equal(singleCards.length, 3, 'Single Chat View must render all 3 conversation turns');

  assert.ok(singleCards[0].textContent.includes('第1問：日本の首都は？'));
  assert.ok(singleCards[0].textContent.includes('日本の首都は東京です。'));
  assert.ok(singleCards[1].textContent.includes('第2問：人口はどのくらい？'));
  assert.ok(singleCards[1].textContent.includes('東京都の人口は約1400万人です。'));
  assert.ok(singleCards[2].textContent.includes('第3問：有名な観光地は？'));
  assert.ok(singleCards[2].textContent.includes('浅草寺や東京タワー'));
  assert.ok(singleCards[2].querySelector('.btn-copy-turn'), 'each answer keeps a copy action under it');

  // 2. Parallel Grid View: every turn is shown in order, with no history bar or expand banner
  f.doc.getElementById('nav-all-grid').click();
  await tick();

  const gridCard = f.doc.querySelector('.cgq-tab-card');
  assert.ok(gridCard, 'Grid card must exist');
  assert.equal(gridCard.querySelector('.cgq-history-expand-banner, .cgq-grid-history-bar'), null);

  const gridTurnItems = gridCard.querySelectorAll('.cgq-grid-turn-item');
  assert.equal(gridTurnItems.length, 3, 'Grid card must render all 3 turns when expanded');

  assert.ok(gridTurnItems[0].textContent.includes('第1問：日本の首都は？'));
  assert.ok(gridTurnItems[0].textContent.includes('日本の首都は東京です。'));
  assert.ok(gridTurnItems[1].textContent.includes('第2問：人口はどのくらい？'));
  assert.ok(gridTurnItems[1].textContent.includes('東京都の人口は約1400万人です。'));
  assert.ok(gridTurnItems[2].textContent.includes('第3問：有名な観光地は？'));
  assert.ok(gridTurnItems[2].textContent.includes('浅草寺や東京タワー'));
});

test('Queue Manager displays and allows selecting individual chat indicators when sidebar is collapsed', async t => {
  const tab1 = { id: 41, url: 'https://chatgpt.com/c/chat1', title: 'ChatGPT タスク' };
  const tab2 = { id: 42, url: 'https://gemini.google.com/app/chat2', title: 'Gemini タスク' };
  const snap1 = {
    tabId: 'real_41', chromeTabId: 41, platform: 'chatgpt',
    url: tab1.url, title: tab1.title, lastHeartbeat: Date.now(), currentState: 'idle', items: [],
    latestAnswer: { userPrompt: 'Q1', text: 'A1', isStreaming: false }
  };
  const snap2 = {
    tabId: 'real_42', chromeTabId: 42, platform: 'gemini',
    url: tab2.url, title: tab2.title, lastHeartbeat: Date.now(), currentState: 'answering', items: [],
    latestAnswer: { userPrompt: 'Q2', text: 'A2', isStreaming: true }
  };

  const f = await bootDashboard({
    tabs: [tab1, tab2],
    snapshots: { 41: snap1, 42: snap2 },
    registry: { real_41: snap1, real_42: snap2 }
  });
  t.after(() => f.dom.window.close());

  // 1. Collapse the sidebar
  const collapseBtn = f.doc.getElementById('btn-sidebar-collapse');
  assert.ok(collapseBtn, 'Collapse button must exist');
  collapseBtn.click();
  await tick();

  assert.ok(f.doc.body.classList.contains('sidebar-collapsed'), 'Body must have .sidebar-collapsed class');
  assert.equal(collapseBtn.title, 'サイドバーを開く (Ctrl+B)');

  // 2. Chat list and indicators remain present and have status dots
  const chatItems = f.doc.querySelectorAll('.cgq-sidebar-chat-item');
  assert.equal(chatItems.length, 2, 'Chat items must still exist in the collapsed rail');

  const dot1 = chatItems[0].querySelector('.cgq-stat-dot');
  const dot2 = chatItems[1].querySelector('.cgq-stat-dot');
  assert.ok(dot1, 'First chat must have a status dot indicator');
  assert.ok(dot2, 'Second chat must have a status dot indicator');

  // Tooltip with title and status is set on each indicator item
  assert.ok(chatItems[0].title.includes('ChatGPT タスク'), 'Indicator item must have chat title tooltip');
  assert.ok(chatItems[1].title.includes('Gemini タスク'), 'Indicator item must have chat title tooltip');

  // 3. Click the second chat indicator while collapsed to select it
  chatItems[1].click();
  await tick();

  // It should select real_42, highlight it, and display it in single chat view
  assert.ok(chatItems[1].classList.contains('selected'), 'Second chat item must be selected');
  assert.equal(f.doc.getElementById('single-chat-title').textContent, 'Gemini タスク');

  // Click the first chat indicator while collapsed to switch back
  chatItems[0].click();
  await tick();
  assert.ok(chatItems[0].classList.contains('selected'), 'First chat item must be selected');
  assert.equal(f.doc.getElementById('single-chat-title').textContent, 'ChatGPT タスク');
});

test('cleanUserPrompt preserves intentional repetitive text and only removes genuine duplicate halves', async t => {
  const f = await bootContent({ platform: 'chatgpt' });
  t.after(() => f.dom.window.close());

  const div = f.doc.createElement('div');
  div.innerHTML = '<div class="whitespace-pre-wrap">123 123 456</div>';
  const cleaned = f.window.__CGQ_DOM__.cleanUserPrompt(div);
  assert.equal(cleaned, '123 123 456');

  // Exact duplicate halves (like Gemini accessibility mirroring)
  const divDup = f.doc.createElement('div');
  divDup.innerHTML = '<div class="whitespace-pre-wrap">建築学科についてしらべて 建築学科についてしらべて</div>';
  const cleanedDup = f.window.__CGQ_DOM__.cleanUserPrompt(divDup);
  assert.equal(cleanedDup, '建築学科についてしらべて');
});

test('Queue Manager top chat bar is transparent without menu open button and bottom composer margins are transparent', async t => {
  const css = fs.readFileSync(path.join(root, 'dashboard.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');

  // 1. Single chat header: No menu button in top bar HTML
  assert.ok(!html.includes('id="btn-sidebar-open-single"'), 'dashboard.html must not contain #btn-sidebar-open-single');

  // 2. CSS ensures top bar is transparent and borderless
  assert.ok(
    css.includes('.cgq-chat-header {') &&
    css.includes('background: transparent !important') &&
    css.includes('border-bottom: none !important'),
    'dashboard.css must style .cgq-chat-header transparent without bottom border'
  );

  // 3. CSS ensures bottom composer container has transparent background & no border
  assert.ok(
    css.includes('.cgq-chat-composer-container {') &&
    css.includes('background: transparent !important;') &&
    css.includes('border: none !important;'),
    'dashboard.css must style .cgq-chat-composer-container with transparent background and no border'
  );

  // 4. CSS ensures floating composer box is styled with capsule border-radius 26px
  assert.ok(
    css.includes('.cgq-chat-composer-box {') &&
    css.includes('border-radius: 26px;'),
    'dashboard.css must style .cgq-chat-composer-box with 26px border radius'
  );

  // 5. CSS ensures Grid card footer is transparent without border-top
  assert.ok(
    css.includes('.cgq-tab-card-footer {') &&
    css.includes('border-top: none !important;'),
    'dashboard.css must style .cgq-tab-card-footer without border-top'
  );

  // 6. Test in DOM boot
  const tab = { id: 50, url: 'https://chatgpt.com/c/50', title: 'テストチャット' };
  const snap = {
    tabId: 'real_50', chromeTabId: 50, platform: 'chatgpt',
    url: tab.url, title: tab.title, lastHeartbeat: Date.now(), currentState: 'idle', items: [],
    latestAnswer: { userPrompt: 'こんにちは', text: 'はい、こんにちは！', isStreaming: false }
  };

  const f = await bootDashboard({
    tabs: [tab],
    snapshots: { 50: snap },
    registry: { real_50: snap }
  });
  t.after(() => f.dom.window.close());

  // In single chat view:
  f.doc.querySelector('.cgq-sidebar-chat-item')?.click();
  await tick();

  const header = f.doc.getElementById('single-chat-header');
  assert.ok(header, 'Single chat header must exist');
  assert.equal(header.querySelector('#btn-sidebar-open-single'), null, 'Header must not contain #btn-sidebar-open-single');
  assert.equal(f.doc.getElementById('single-chat-title').textContent, 'テストチャット');

  const composerContainer = f.doc.querySelector('.cgq-chat-composer-container');
  assert.ok(composerContainer, 'Composer container must exist');
  const composerBox = f.doc.querySelector('.cgq-chat-composer-box');
  assert.ok(composerBox, 'Composer box must exist');
  assert.ok(f.doc.getElementById('single-chat-input'), 'Textarea must exist inside composer');

  // In grid view:
  f.doc.getElementById('nav-all-grid').click();
  await tick();

  const cardFooter = f.doc.querySelector('.cgq-tab-card-footer');
  assert.ok(cardFooter, 'Card footer must exist');
  const dashInputRow = f.doc.querySelector('.cgq-dash-input-row');
  assert.ok(dashInputRow, 'Input row must exist inside card footer');
});

test('Queue Manager is flat: no shadows, no bounce or hover motion, feedback states kept', async t => {
  const css = fs.readFileSync(path.join(root, 'dashboard.css'), 'utf8');

  // 1. Flat: shadow tokens are none and queue panels / composers carry no shadow of their own
  for (const token of ['--shadow-sm', '--shadow-card', '--shadow-card-hover', '--shadow-float']) {
    assert.match(css, new RegExp(`${token}: none;`), `${token} must be none`);
  }
  const shadows = css.match(/box-shadow:\s*(?!none|var\(|inset)[^;]+;/g) || [];
  assert.ok(shadows.length <= 1, `only the image lightbox may cast a shadow, found: ${shadows.join(' ')}`);

  // 2. No bounce / pop keyframes and no movement on hover or press
  for (const name of ['cgq-btn-pop', 'cgq-badge-pop', 'cgq-bubble-in', 'cgq-turn-enter', 'cgq-item-enter']) {
    assert.ok(!css.includes(`@keyframes ${name}`), `${name} must be gone`);
  }
  const interactive = css.match(/[^{}]*:(?:hover|active)[^{}]*\{[^}]*\}/g) || [];
  assert.ok(interactive.every(rule => !/\btransform:/.test(rule)), 'hover/active rules must not move elements');

  // 3. Accessibility reduced motion support
  assert.ok(css.includes('prefers-reduced-motion: reduce'), 'Must respect prefers-reduced-motion');

  // 4. Test live DOM interactive feedback (copy feedback & send pop)
  const tab = { id: 60, url: 'https://chatgpt.com/c/60', title: 'アニメーション確認' };
  const snap = {
    tabId: 'real_60', chromeTabId: 60, platform: 'chatgpt',
    url: tab.url, title: tab.title, lastHeartbeat: Date.now(), currentState: 'idle', items: [],
    recentQA: [
      { turn: 1, prompt: 'プロンプト1', answer: '回答テキスト1', isStreaming: false }
    ],
    latestAnswer: { userPrompt: 'プロンプト1', text: '回答テキスト1', isStreaming: false }
  };

  const f = await bootDashboard({
    tabs: [tab],
    snapshots: { 60: snap },
    registry: { real_60: snap }
  });
  t.after(() => f.dom.window.close());

  // Click chat item
  f.doc.querySelector('.cgq-sidebar-chat-item')?.click();
  await tick();

  // Test copy button feedback class
  const copyBtn = f.doc.querySelector('.btn-copy-turn');
  assert.ok(copyBtn, 'Copy turn button must exist');
  copyBtn.click();
  await tick();
  assert.ok(copyBtn.classList.contains('copied'), 'Copy button must receive the .copied feedback class on click');

  // Queue additions retain their feedback on the dedicated plus button.
  const sendBtn = f.doc.getElementById('single-btn-enqueue');
  const input = f.doc.getElementById('single-chat-input');
  input.value = 'アニメーションテスト入力';
  sendBtn.click();
  await tick();
  assert.ok(sendBtn.classList.contains('sent'), 'Queue button must receive the .sent feedback class on submit');
});
