const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');

const boot = html => {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url: 'https://chatgpt.com/c/x', runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.eval(fs.readFileSync(path.join(root, 'snapshot.js'), 'utf8'));
  return dom.window;
};

// Shape measured on chatgpt.com (2026-10): Intelligent UI components carry data-d-component, buttons and
// pressables are interactive, the code copy button is chrome.
test('a snapshot keeps structure, data-d attributes and styles, tags interactive elements, drops chrome', () => {
  const window = boot(`<div id="answer" style="display:flex;gap:8px;color:rgb(1, 2, 3)">
    <div data-d-component="badge" style="border:1px solid rgb(9, 9, 9);border-radius:999px">デモ環境</div>
    <button data-d-component="button" type="button">ダッシュボードを生成する</button>
    <button aria-label="コピー">copy</button>
    <script>alert(1)</script>
    <a href="javascript:alert(1)">bad</a>
  </div>`);
  const snap = window.CGQSnapshot.snapshot(window.document.getElementById('answer'));
  window.close();
  assert.match(snap.html, /data-d-component="badge"/);
  assert.match(snap.html, /<button [^>]*data-cgq-act="0\.1"[^>]*>ダッシュボードを生成する<\/button>/);
  assert.doesNotMatch(snap.html, /copy|<script|javascript:/);
  assert.match(snap.css, /display:flex/);
  assert.match(snap.css, /border-top-color:rgb\(9, 9, 9\)/, 'real borders are kept');
  assert.doesNotMatch(snap.css, /:;/, 'no empty values');
});

test('a path from the snapshot finds the same page element and replays the click', () => {
  const window = boot(`<div id="answer"><p>text</p><div><span>x</span><button>押す</button></div></div>`);
  const answer = window.document.getElementById('answer');
  const snap = window.CGQSnapshot.snapshot(answer);
  const pathOf = snap.html.match(/data-cgq-act="([\d.]+)"/)[1];
  let clicked = 0;
  answer.querySelector('button').addEventListener('click', () => clicked++);
  const el = window.CGQSnapshot.resolve(answer, pathOf);
  assert.equal(el.textContent, '押す');
  assert.equal(window.CGQSnapshot.act(el, { kind: 'click' }), true);
  assert.equal(clicked, 1);
  const input = window.document.createElement('input');
  answer.append(input);
  let changed = '';
  input.addEventListener('change', () => { changed = input.value; });
  window.CGQSnapshot.act(input, { kind: 'value', value: '新しい値' });
  window.close();
  assert.equal(changed, '新しい値');
});

// Measured on gemini.google.com (2026-10): the map is a canvas with a 「マップで開く」 link to /maps/dir/A/B.
test('Google Maps links become an interactive embed URL', () => {
  const window = boot(`<div id="r"><a href="https://www.google.com/maps/dir/%E6%9D%B1%E4%BA%AC/%E5%BA%83%E5%B3%B6/@34,135,6z">マップで開く</a></div>`);
  const url = window.CGQSnapshot.mapEmbedUrl(window.document.getElementById('r'));
  window.close();
  assert.equal(url, 'https://maps.google.com/maps?saddr=%E6%9D%B1%E4%BA%AC&daddr=%E5%BA%83%E5%B3%B6&output=embed');
});
