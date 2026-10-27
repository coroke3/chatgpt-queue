const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture(t) {
  const root = path.join(__dirname, '..');
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'popup.html'), 'utf8'), { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  await tick();
  const { window } = dom, pending = [];
  window.chrome = {
    runtime: {},
    tabs: {
      query: async () => [{ id: 1, url: 'https://chatgpt.com/c/test' }],
      sendMessage: (id, message, callback) => {
        if (message.action === 'GET_TAB_QUEUE') callback({ items: [] });
        else pending.push({ message, callback });
      }
    }
  };
  window.eval(fs.readFileSync(path.join(root, 'popup.js'), 'utf8'));
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await tick();
  return { window, pending, input: window.document.getElementById('popup-input'), button: window.document.getElementById('btn-add') };
}

test('popup retains failed additions, blocks repeat clicks and clears only confirmed saved text', async t => {
  const f = await fixture(t);
  f.input.value = 'Multiline\nprompt';
  f.button.click(); f.button.click();
  assert.equal(f.pending.length, 1);
  assert.equal(f.button.disabled, true);
  f.pending.shift().callback({ success: false });
  assert.equal(f.input.value, 'Multiline\nprompt');
  assert.equal(f.button.disabled, false);
  f.button.click();
  f.window.chrome.runtime.lastError = { message: 'Connection lost' };
  f.pending.shift().callback();
  delete f.window.chrome.runtime.lastError;
  assert.equal(f.input.value, 'Multiline\nprompt');
  f.button.click();
  f.input.value = 'New draft';
  f.pending.shift().callback({ success: true });
  await tick();
  assert.equal(f.input.value, 'New draft');
  f.button.click(); f.pending.shift().callback({ success: true });
  await tick();
  assert.equal(f.input.value, '');
});

test('popup Enter sends directly while Ctrl/Cmd+Enter queue, with newline and IME preserved', async t => {
  const f = await fixture(t);
  const key = extra => {
    const event = new f.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...extra });
    f.input.dispatchEvent(event); return event;
  };
  f.input.value = 'Direct'; key();
  assert.equal(f.pending[0].message.action, 'SEND_PROMPT_TO_TAB');
  f.pending.shift().callback({ success: true });
  for (const modifier of ['ctrlKey', 'metaKey']) {
    f.input.value = 'Queue'; key({ [modifier]: true });
    assert.equal(f.pending[0].message.action, 'ADD_TO_TAB_QUEUE');
    f.pending.shift().callback({ success: true });
  }
  for (const extra of [{ shiftKey: true }, { isComposing: true }, { ctrlKey: true, isComposing: true }]) assert.equal(key(extra).defaultPrevented, false);
  assert.equal(f.pending.length, 0);
});
