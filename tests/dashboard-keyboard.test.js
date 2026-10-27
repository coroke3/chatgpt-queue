const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture(t, mode, platform, legacyFlag, withOther = false) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8'), {
    url: 'https://queue.test/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom; t.after(() => window.close());
  const tab = { tabId: 'keyboard', chromeTabId: 7, platform, title: 'Keyboard', url: platform === 'gemini' ? 'https://gemini.google.com/app/test' : 'https://chatgpt.com/c/test',
    lastHeartbeat: Date.now(), currentState: 'idle', items: [] };
  const commands = [], pending = [];
  const other = { ...tab, tabId: 'other', chromeTabId: 8, title: 'Other', url: 'https://chatgpt.com/c/other' };
  const registry = withOther ? { keyboard: tab, other } : { keyboard: tab };
  window.setInterval = () => 0;
  window.chrome = {
    runtime: { sendMessage() {} },
    storage: { local: {
      get: async () => ({ cgq_tabs_registry: registry, cgq_user_settings: { enterToQueue: legacyFlag } }),
      set: async value => { commands.push(value); }
    }, onChanged: { addListener() {} } },
    tabs: { query: (query, callback) => callback(Object.values(registry).map(state => ({ id: state.chromeTabId, url: state.url, title: state.title }))),
      sendMessage: (id, request, callback) => {
        if (request.action === 'SEND_PROMPT_TO_TAB') pending.push({ request, callback });
        else callback?.({ success: true, state: id === 8 ? other : tab });
      }
    }
  };
  for (const file of ['references.js', 'libs/marked.min.js', 'composer-tools.js', 'dashboard.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  await tick(); await tick();
  if (mode === 'single') window.document.querySelector('.cgq-sidebar-chat-item').click();
  const input = mode === 'single' ? window.document.getElementById('single-chat-input') : window.document.querySelector('.cgq-dash-prompt-input');
  const key = extra => {
    const event = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...extra });
    input.dispatchEvent(event); return event;
  };
  return { window, input, key, commands, pending, queued: () => commands.filter(value => value.cgq_cmd_keyboard?.action === 'ENQUEUE') };
}

test('both dashboard views use Enter for direct send and Ctrl/Cmd+Enter for queue regardless of legacy preferences', async t => {
  for (const mode of ['single', 'grid']) for (const platform of ['chatgpt', 'gemini']) for (const legacyFlag of [true, false]) {
    const f = await fixture(t, mode, platform, legacyFlag);
    f.input.value = 'Direct\nmessage';
    assert.equal(f.key().defaultPrevented, true);
    f.key();
    assert.equal(f.pending.length, 1, 'repeated Enter is blocked while awaiting confirmation');
    assert.equal(f.pending[0].request.text, 'Direct\nmessage');
    assert.equal(f.queued().length, 0);
    assert.equal(f.input.value, 'Direct\nmessage');
    f.pending[0].callback({ success: true });
    assert.equal(f.input.value, '');
    for (const modifier of ['ctrlKey', 'metaKey']) {
      f.input.value = 'Queue'; f.key({ [modifier]: true });
    }
    assert.equal(f.queued().length, 2);
    f.input.value = 'Draft';
    for (const extra of [{ shiftKey: true }, { isComposing: true }, { ctrlKey: true, isComposing: true }]) {
      assert.equal(f.key(extra).defaultPrevented, false);
    }
    assert.equal(f.pending.length, 1); assert.equal(f.queued().length, 2);
    f.key(); f.pending[1].callback({ success: false, error: 'Send failed' });
    assert.equal(f.input.value, 'Draft');
    const button = mode === 'single' ? f.window.document.getElementById('single-btn-enqueue') : f.window.document.querySelector('.btn-enqueue-prompt');
    button.click(); assert.equal(f.queued().length, 3);
  }
});

test('confirming a direct send after switching chats preserves the other chat draft', async t => {
  const f = await fixture(t, 'single', 'chatgpt', true, true);
  f.input.value = 'Same text'; f.input.dispatchEvent(new f.window.Event('input', { bubbles: true })); f.key();
  f.window.document.querySelector('.cgq-sidebar-chat-item[data-tab-id="other"]').click();
  f.input.value = 'Same text'; f.input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  f.pending[0].callback({ success: true });
  assert.equal(f.input.value, 'Same text');
  f.window.document.querySelector('.cgq-sidebar-chat-item[data-tab-id="keyboard"]').click();
  assert.equal(f.input.value, '');
});
