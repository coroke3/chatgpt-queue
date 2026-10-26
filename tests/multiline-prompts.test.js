const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { splitPrompts } = require('../composer-tools.js');

test('multiline prompts default to one item, retaining code, indentation and blank lines', () => {
  const body = '/deepresearch\n調査条件:\n・公式資料を使う\n\n```js\n  const n = 2;\n```';
  assert.deepEqual(splitPrompts(body), [body]);
  assert.deepEqual(splitPrompts(body.replace(/\n/g, '\r\n'), 'single'), [body]);
  assert.deepEqual(splitPrompts('  \n '), []);
});

test('batch delimiters preserve each multiline body and support Windows line endings', () => {
  assert.deepEqual(splitPrompts('first\r\nsecond\r\n --- \r\nthird\r\nfourth', 'hyphens'), ['first\nsecond', 'third\nfourth']);
  assert.deepEqual(splitPrompts('a\nb\n\n c\nd', 'empty_line'), ['a\nb', 'c\nd']);
  assert.deepEqual(splitPrompts('a\r\nb\r\n\r\nc', 'line'), ['a', 'b', 'c']);
});

test('native editors round-trip multiline bodies and empty paragraphs without adding blank lines', t => {
  const root = path.join(__dirname, '..');
  for (const platform of ['chatgpt', 'gemini']) {
    const dom = new JSDOM('<body><div id="input" contenteditable="true"></div><textarea></textarea></body>', {
      url: platform === 'gemini' ? 'https://gemini.google.com/app/test' : 'https://chatgpt.com/c/test', runScripts: 'outside-only'
    });
    t.after(() => dom.window.close());
    const { window } = dom;
    for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
    window.eval(fs.readFileSync(path.join(root, 'content.js'), 'utf8').replace('  const queueManager = new QueueManager();',
      '  globalThis.__multiline = { HumanSimulator }; return;\n  const queueManager = new QueueManager();'));
    const input = window.document.getElementById('input');
    const native = new window.CGQComposerTools.NativeTools(platform, { getInput: () => input });
    const body = '調査条件:\n・公式資料\n\nコード:\n  const n = 2;\n\n結論を説明';
    window.__multiline.HumanSimulator.setDOMContent(input, body);
    assert.equal(native.capture().text, body);
    window.__multiline.HumanSimulator.setDOMContent(window.document.querySelector('textarea'), body);
    assert.equal(window.document.querySelector('textarea').value, body);
    if (platform === 'chatgpt') {
      const token = window.document.createElement('span');
      token.setAttribute('app-mention-path', 'app://connector_openai_deep_research');
      token.setAttribute('app-mention-display-name', 'Deep Research');
      token.textContent = 'Deep Research';
      window.__multiline.HumanSimulator.setDOMContent(input, body, [token]);
      assert.equal(native.capture().text, body);
      assert.equal(native.capture().tools.length, 1);
    }
  }
});
