const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const refs = require('../references.js');
const root = path.join(__dirname, '..');

function content(html, platform = 'gemini') {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, {
    url: platform === 'gemini' ? 'https://gemini.google.com/app/test' : 'https://chatgpt.com/c/test',
    runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom;
  for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  const script = fs.readFileSync(path.join(root, 'content.js'), 'utf8').replace(
    '  const queueManager = new QueueManager();',
    '  globalThis.__DOM = DOM; return;\n  const queueManager = new QueueManager();');
  window.eval(script);
  return { dom, doc: window.document, DOM: window.__DOM };
}

function rendered(text, doc) {
  const el = doc.createElement('div');
  el.innerHTML = refs.formatHTML(text, doc);
  return el;
}

test('Gemini citation-N highlights preserve answer prose, with only actual footnotes becoming references', () => {
  const f = content('<model-response><message-content><p><span class="citation-21">キー押下イベントを </span><span class="citation-21">event.preventDefault()</span><span class="citation-21 citation-end-21"> で捕捉。<source-footnote><sup data-turn-source-index="3"></sup></source-footnote></span></p></message-content></model-response>');
  const md = f.DOM.extractAnswerMarkdown(f.doc.querySelector('model-response'));
  const html = rendered(md, f.doc);
  assert.match(html.textContent, /キー押下イベントを event.preventDefault\(\) で捕捉。/);
  assert.equal(html.querySelectorAll('.cgq-source-card').length, 1);
  assert.equal(html.querySelector('.cgq-source-card').textContent, '参照 3');
  assert.equal(html.querySelector('a'), null, 'unknown URLs are not invented');
  f.dom.window.close();
});

test('ChatGPT button-link citations retain the exact target URL, source name and favicon', () => {
  const f = content('<div data-message-author-role="assistant"><p>説明 <a class="button-link" aria-label="prtimes.jp" href="https://prtimes.jp/main/html/rd/p/000000011.html?utm_source=chatgpt.com"><img src="https://prtimes.jp/favicon.ico"><span class="truncate">prtimes.jp</span></a></p></div>', 'chatgpt');
  const md = f.DOM.extractAnswerMarkdown(f.doc.querySelector('[data-message-author-role]'));
  const html = rendered(md, f.doc);
  const card = html.querySelector('a.cgq-source-card');
  assert.equal(card.href, 'https://prtimes.jp/main/html/rd/p/000000011.html?utm_source=chatgpt.com');
  assert.equal(card.textContent, 'prtimes.jp');
  assert.equal(card.querySelector('img').src, 'https://prtimes.jp/favicon.ico');
  assert.equal(html.querySelectorAll('img').length, 1, 'favicon is not a separate answer image');
  assert.equal(card.querySelector('img').getAttribute('referrerpolicy'), 'no-referrer');
  f.dom.window.close();
});

test('source carousels deduplicate exact targets and use one compact row without a separate heading', () => {
  const f = content('<model-response><message-content>回答です</message-content><sources-carousel><a href="https://example.com/a"><img src="https://example.com/icon.png">引用元 A</a><a href="https://example.com/a">重複</a><a href="https://example.org/b">引用元 B</a></sources-carousel></model-response>');
  const md = f.DOM.extractAnswerMarkdown(f.doc.querySelector('model-response'));
  const html = rendered(md, f.doc);
  assert.equal(html.querySelectorAll('.cgq-sources-list').length, 1);
  assert.equal(html.querySelectorAll('a.cgq-source-card').length, 2);
  assert.equal(html.querySelector('.cgq-sources-header'), null);
  const latest = f.DOM.getLatestAnswer('');
  assert.equal(rendered(latest.text, f.doc).querySelectorAll('.cgq-source-card').length, 2, 'latest answer includes the carousel outside message-content');
  const history = f.DOM.getRecentQAHistory('');
  assert.equal(history.length, 1, 'nested model-response and message-content count as one answer');
  assert.equal(rendered(history[0].answer, f.doc).querySelectorAll('.cgq-source-card').length, 2);
  f.dom.window.close();
});

test('citations in lists and headings retain their targets', () => {
  const f = content('<model-response><h2>見出し <a class="citation" href="https://example.com/h">1</a></h2><ul><li>項目 <a class="citation" href="https://example.com/l">2</a></li></ul></model-response>');
  const html = rendered(f.DOM.extractAnswerMarkdown(f.doc.querySelector('model-response')), f.doc);
  assert.deepEqual(Array.from(html.querySelectorAll('a.cgq-source-card')).map(el => el.href), ['https://example.com/h', 'https://example.com/l']);
  f.dom.window.close();
});

test('table cells retain citations and ordinary link destinations during extraction', () => {
  const f = content('<model-response><table><tr><th>資料</th><th>参照元</th></tr><tr><td>情報</td><td><a class="citation" href="https://example.com/citation">1</a> <a href="https://example.com/document">公式資料</a></td></tr></table></model-response>');
  const md = f.DOM.extractAnswerMarkdown(f.doc.querySelector('model-response'));
  assert.match(md, /\[公式資料\]\(https:\/\/example.com\/document\)/);
  assert.equal(rendered(md, f.doc).querySelector('.cgq-source-card').getAttribute('href'), 'https://example.com/citation');
  f.dom.window.close();
});

test('unknown raw citation IDs do not create guessed links; normal brackets and code remain intact', () => {
  const f = content('');
  const html = rendered('<p>【重要】 【1】 【4:0†example.com】 citeturn0search0</p><pre><code>【4:0†https://example.com/code】</code></pre>', f.doc);
  assert.match(html.querySelector('p').textContent, /【重要】 【1】/);
  assert.equal(html.querySelectorAll('a').length, 0);
  assert.equal(html.querySelectorAll('.cgq-source-unresolved').length, 2);
  assert.equal(html.querySelector('code').textContent, '【4:0†https://example.com/code】');
  f.dom.window.close();
});

test('legacy cached source HTML and numeric Markdown links upgrade to the same cards', () => {
  const f = content('');
  const html = rendered('<p><a class="cgq-citation-pill" href="https://example.com/a" title="元の記事">1</a></p><div class="cgq-sources-container"><div class="cgq-sources-header">参照元</div><div class="cgq-sources-list"><a class="cgq-source-chip" href="https://example.org/b"><span class="cgq-source-chip-domain">example.org</span><span class="cgq-source-chip-title">別の記事</span></a></div></div><a class="cgq-md-link" href="https://example.net/c">[3]</a>', f.doc);
  assert.equal(html.querySelectorAll('.cgq-source-card').length, 3);
  assert.equal(html.querySelector('.cgq-sources-header'), null);
  assert.equal(html.querySelector('.cgq-source-card').textContent, '元の記事');
  assert.equal(html.querySelectorAll('img.cgq-source-favicon').length, 3);
  f.dom.window.close();
});

test('unsafe URLs, markup in titles and unknown footnote targets cannot become executable links', () => {
  const f = content('<model-response><a class="citation" href="#same">1</a></model-response><model-response><a id="same" href="https://other-answer.example/">別の回答</a></model-response>');
  assert.equal(refs.fromElement(f.doc.querySelector('a.citation')).url, '');
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://user:secret@example.com/']) {
    const html = rendered(refs.token({ url, title: '<img src=x onerror=alert(1)>', icon: 'javascript:alert(1)' }), f.doc);
    assert.equal(html.querySelectorAll('a, img, [onerror]').length, 0);
    assert.match(html.textContent, /<img src=x onerror=alert\(1\)>/);
  }
  f.dom.window.close();
});

test('broken favicons are removed while the compact fallback icon remains', () => {
  const f = content('');
  const html = rendered(refs.token({ url: 'https://example.com/page', title: '記事' }), f.doc);
  refs.bindIcons(html);
  html.querySelector('img').dispatchEvent(new f.dom.window.Event('error'));
  assert.equal(html.querySelector('img'), null);
  assert.ok(html.querySelector('.cgq-source-icon svg'));
  assert.equal(html.querySelector('a').textContent, '記事');
  f.dom.window.close();
});

test('copying an answer produces source names and original URLs instead of transport tokens', () => {
  const text = '説明 ' + refs.token({ sources: [{ url: 'https://example.com/a', title: '記事 A' }, { title: '参照 2' }] });
  assert.equal(refs.plainText(text), '説明 記事 A (https://example.com/a) / 参照 2');
});

test('reference cards and favicons stay compact in both themes', () => {
  const f = content('');
  const style = f.doc.createElement('style');
  style.textContent = fs.readFileSync(path.join(root, 'dashboard.css'), 'utf8').replace(/^@import.*$/gm, '');
  f.doc.head.append(style);
  const answer = f.doc.createElement('div');
  answer.className = 'cgq-answer-markdown';
  answer.innerHTML = refs.renderGroup([{ url: 'https://example.com/a', title: 'とても長い引用元の記事名'.repeat(10) }]);
  f.doc.body.append(answer);
  for (const theme of ['', 'dark']) {
    f.doc.body.className = theme;
    const computed = el => f.dom.window.getComputedStyle(el);
    assert.equal(computed(answer.querySelector('.cgq-source-icon')).width, '22px');
    assert.equal(computed(answer.querySelector('a.cgq-source-card')).flexDirection, 'row');
    assert.equal(computed(answer.querySelector('img')).height, '16px');
    assert.equal(computed(answer.querySelector('img')).marginTop, '0px');
    assert.equal(computed(answer.querySelector('.cgq-sources-list')).flexWrap, 'wrap');
    assert.equal(computed(answer.querySelector('.cgq-source-name')).textOverflow, 'ellipsis');
  }
  f.dom.window.close();
});

test('latest answer ignores Gemini sidebar chat links when no response exists yet', () => {
  const sidebar = '<nav><div class="markdown"><a href="https://gemini.google.com/app/abc12345">チャットA</a>' +
    '<a href="https://gemini.google.com/app/def67890">チャットB</a><a href="https://gemini.google.com/app/ghi13579">チャットC</a></div></nav>';
  const f = content(sidebar);
  assert.equal(f.DOM.getLatestAnswer(''), null, 'sidebar links are not an answer');
});

test('reference groups show up to three tiles and collapse the rest into +N', () => {
  const f = content('');
  const many = [1, 2, 3, 4, 5].map(i => ({ url: `https://example.com/${i}`, title: `記事${i}` }));
  const html = refs.renderGroup(many);
  const wrap = f.doc.createElement('div');
  wrap.innerHTML = html;
  assert.equal(wrap.querySelectorAll('a.cgq-source-card').length, 3);
  assert.equal(wrap.querySelector('.cgq-source-more').textContent, '+2');
  f.dom.window.close();
});

test('links with icons upgrade to compact single-line source cards instead of block images', () => {
  const f = content('<model-response><message-content><p>データ：<a href="https://search.keinet.ne.jp/search"><img src="https://search.keinet.ne.jp/logo.png">河合塾Kei-Net大学検索システム</a></p></message-content></model-response>');
  const md = f.DOM.extractAnswerMarkdown(f.doc.querySelector('model-response'));
  const html = rendered(md, f.doc);
  const card = html.querySelector('a.cgq-source-card');
  assert.ok(card, 'Link with icon must upgrade to a source card');
  assert.equal(card.textContent, '河合塾Kei-Net大学検索システム');
  assert.equal(card.querySelector('img').src, 'https://search.keinet.ne.jp/logo.png');
  assert.equal(html.querySelectorAll('img').length, 1);
  assert.equal(html.querySelector('p > img'), null, 'Icon must never be a separate block image');
  f.dom.window.close();
});

test('ChatGPT search result card with icon and link upgrades to compact single-line card', () => {
  const f = content('<div data-message-author-role="assistant"><div class="flex items-center gap-2"><img src="https://search.keinet.ne.jp/logo.png" alt="Kei-Net"><a href="https://search.keinet.ne.jp/search">河合塾Kei-Net大学検索システム</a></div></div>', 'chatgpt');
  const md = f.DOM.extractAnswerMarkdown(f.doc.querySelector('[data-message-author-role]'));
  const html = rendered(md, f.doc);
  const card = html.querySelector('a.cgq-source-card');
  assert.ok(card, 'ChatGPT search card must become a compact source card');
  assert.equal(card.textContent, '河合塾Kei-Net大学検索システム');
  assert.equal(card.querySelector('img').src, 'https://search.keinet.ne.jp/logo.png');
  assert.equal(html.querySelectorAll('a.cgq-source-card').length, 1);
  assert.equal(html.querySelectorAll('img').length, 1);
  assert.equal(html.querySelector('p > img'), null, 'Must never produce a block image');
  f.dom.window.close();
});

test('ChatGPT markdown image followed by link merges into compact single-line source card', () => {
  const marked = require(path.join(root, 'libs/marked.min.js'));
  const rawMarkdown = '![河合塾Kei-Net大学検索システム](https://search.keinet.ne.jp/logo.png)\n\n[河合塾Kei-Net大学検索システム](https://search.keinet.ne.jp/search)';
  const parsed = marked.parse(rawMarkdown);
  const dom = new JSDOM();
  const html = refs.formatHTML(parsed, dom.window.document);
  const wrap = dom.window.document.createElement('div');
  wrap.innerHTML = html;
  const card = wrap.querySelector('a.cgq-source-card');
  assert.ok(card, 'Markdown image + link must merge into a single source card');
  assert.equal(card.textContent, '河合塾Kei-Net大学検索システム');
  assert.equal(card.querySelector('img').src, 'https://search.keinet.ne.jp/logo.png');
  assert.equal(wrap.querySelectorAll('a').length, 1, 'Only one link should remain');
  assert.equal(wrap.querySelectorAll('img').length, 1, 'Only favicon image should remain');
  assert.equal(wrap.querySelector('p > img'), null, 'No block image should exist');
  dom.window.close();
});

test('scrollbars are themed for light and dark modes', () => {
  const css = fs.readFileSync(path.join(root, 'dashboard.css'), 'utf8');
  assert.match(css, /color-scheme:\s*light;/, 'Light mode must specify color-scheme: light');
  assert.match(css, /color-scheme:\s*dark;/, 'Dark mode must specify color-scheme: dark');
  assert.match(css, /--scrollbar-thumb:/, 'Scrollbar thumb variable must be defined');
  assert.match(css, /::-webkit-scrollbar/, 'WebKit scrollbar rules must be defined');
});
