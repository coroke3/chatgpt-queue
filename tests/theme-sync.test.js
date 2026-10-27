const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function media(window, dark = false) {
  const listeners = new Set();
  const query = { matches: dark, addEventListener: (_, fn) => listeners.add(fn),
    change(value) { query.matches = value; listeners.forEach(fn => fn({ matches: value })); } };
  window.matchMedia = () => query;
  return query;
}

function storage(window, themeMode) {
  const listeners = [];
  const values = { cgq_user_settings: { themeMode } };
  const change = settings => {
    values.cgq_user_settings = settings;
    listeners.forEach(fn => fn({ cgq_user_settings: { newValue: settings } }, 'local'));
  };
  window.chrome = {
    runtime: { sendMessage() {} },
    storage: { local: {
      get(keys, callback) {
        const result = keys === null ? { ...values } : Object.fromEntries(keys.map(key => [key, values[key]]));
        if (callback) queueMicrotask(() => callback(result));
        return Promise.resolve(result);
      },
      async set(update) {
        Object.assign(values, update);
        if ('cgq_user_settings' in update) change(update.cgq_user_settings);
      }
    }, onChanged: { addListener: fn => listeners.push(fn) } },
    tabs: { query: (_, callback) => callback ? callback([]) : Promise.resolve([]), sendMessage() {} }
  };
  return { change, values };
}

test('dashboard follows external theme settings and live OS changes only in auto mode', async t => {
  const dom = new JSDOM(read('dashboard.html'), { runScripts: 'outside-only', url: 'https://queue.test/' });
  const { window } = dom; t.after(() => window.close());
  const system = media(window);
  const store = storage(window, 'auto');
  const intervals = [];
  window.setInterval = fn => { intervals.push(fn); return 0; };
  let initializations = 0;
  window.mermaid = { initialize: () => initializations++ };
  for (const file of ['references.js', 'composer-tools.js', 'dashboard.js']) window.eval(read(file));
  await tick(); await tick();
  const dark = () => window.document.body.classList.contains('dark');
  assert.equal(dark(), false);
  system.change(true); assert.equal(dark(), true);
  store.change({ themeMode: 'light' }); assert.equal(dark(), false);
  system.change(false); system.change(true); assert.equal(dark(), false);
  store.change({ themeMode: 'dark' }); system.change(false); assert.equal(dark(), true);
  assert.equal(window.document.documentElement.style.colorScheme, 'dark');
  const count = initializations;
  intervals.forEach(fn => fn()); await tick(); await tick();
  assert.equal(initializations, count, 'heartbeat refresh must not rerender every diagram');
  store.change(undefined); assert.equal(dark(), false);
  system.change(true); assert.equal(dark(), true);
  window.document.getElementById('btn-theme-toggle').click();
  system.change(false); system.change(true);
  assert.equal(dark(), false, 'manual toggle must take priority immediately');
  await tick();
  assert.equal(store.values.cgq_user_settings.themeMode, 'light');
});

test('popup uses saved preferences even when the OS is opposite, and updates while open', async t => {
  for (const pref of ['dark', 'light']) {
    const dom = new JSDOM(read('popup.html'), { runScripts: 'outside-only' });
    const { window } = dom; t.after(() => window.close());
    await tick();
    const system = media(window, pref !== 'dark');
    const store = storage(window, pref);
    window.setInterval = () => 0;
    window.eval(read('popup.js'));
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await tick();
    const theme = () => window.document.documentElement.dataset.cgqTheme;
    assert.equal(theme(), pref);
    assert.equal(window.getComputedStyle(window.document.documentElement).getPropertyValue('--bg').trim(), pref === 'dark' ? '#1e1e1e' : '#ffffff');
    store.change({ themeMode: 'auto' });
    system.change(true); assert.equal(theme(), 'dark');
    system.change(false); assert.equal(theme(), 'light');
    store.change({ themeMode: 'dark' });
    system.change(false); assert.equal(theme(), 'dark');
    store.change({ themeMode: 'light' });
    system.change(true); assert.equal(theme(), 'light');
  }
});

test('late initial reads and dashboard refreshes cannot undo a newer theme setting', async t => {
  for (const page of ['dashboard', 'popup']) {
    const dom = new JSDOM(read(`${page}.html`), { runScripts: 'outside-only', url: 'https://queue.test/' });
    const { window } = dom; t.after(() => window.close());
    await tick();
    media(window);
    const store = storage(window, 'light');
    const originalGet = window.chrome.storage.local.get;
    const pending = [], intervals = [];
    window.setInterval = fn => { intervals.push(fn); return 0; };
    window.chrome.storage.local.get = (keys, callback) => {
      const stale = { cgq_user_settings: { themeMode: 'light' }, cgq_tabs_registry: {} };
      if (callback && keys?.includes('cgq_user_settings')) { pending.push(() => callback(stale)); return; }
      if (keys?.includes('cgq_tabs_registry')) return new Promise(resolve => pending.push(() => resolve(stale)));
      return originalGet(keys, callback);
    };
    if (page === 'dashboard') {
      for (const file of ['references.js', 'composer-tools.js']) window.eval(read(file));
    }
    window.eval(read(`${page}.js`));
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    intervals.forEach(fn => fn());
    store.change({ themeMode: 'dark' });
    pending.forEach(resolve => resolve());
    await tick(); await tick();
    assert.equal(page === 'dashboard' ? window.document.body.dataset.cgqTheme : window.document.documentElement.dataset.cgqTheme, 'dark', page);
    if (page === 'dashboard') {
      const start = pending.length;
      const button = window.document.getElementById('btn-theme-toggle');
      button.click(); button.click();
      pending.slice(start).reverse().forEach(resolve => resolve());
      await tick();
      assert.equal(store.values.cgq_user_settings.themeMode, 'dark', 'the last click wins even if storage callbacks arrive backwards');
      assert.equal(window.document.body.dataset.cgqTheme, 'dark');
    }
  }
});

test('in-page themes honor explicit host attributes and settings updates without waiting for timers', async t => {
  for (const platform of ['chatgpt', 'gemini']) {
    const dom = new JSDOM('<!doctype html><body style="background-color:white"></body>', {
      runScripts: 'outside-only', url: platform === 'gemini' ? 'https://gemini.google.com/app/test' : 'https://chatgpt.com/c/test'
    });
    const { window } = dom; t.after(() => window.close());
    const system = media(window);
    window.setInterval = () => 0;
    for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) window.eval(read(file));
    window.eval(read('content.js').replace('  const queueManager = new QueueManager();',
      '  globalThis.__themeTest = { QueueUI }; return;\n  const queueManager = new QueueManager();'));
    const ui = Object.create(window.__themeTest.QueueUI.prototype);
    const subscribers = [];
    ui.qm = { settings: { themeMode: 'auto' }, subscribe: fn => subscribers.push(fn) };
    ui.panelElem = window.document.createElement('div');
    const host = platform === 'gemini' ? window.document.body : window.document.documentElement;
    host.setAttribute('data-theme', 'dark');
    ui.setupThemeWatcher();
    const theme = () => window.document.documentElement.dataset.cgqTheme;
    assert.equal(theme(), 'dark', 'host setting must override a white body and light OS');
    host.setAttribute('data-theme', 'light'); await tick(); assert.equal(theme(), 'light');
    host.removeAttribute('data-theme'); host.setAttribute('theme', 'dark'); await tick(); assert.equal(theme(), 'dark');
    ui.qm.settings.themeMode = 'light'; subscribers.forEach(fn => fn()); assert.equal(theme(), 'light');
    host.setAttribute('theme', 'dark'); system.change(true); await tick(); assert.equal(theme(), 'light');
    ui.qm.settings.themeMode = 'dark'; subscribers.forEach(fn => fn()); assert.equal(theme(), 'dark');
    ui.qm.settings.themeMode = 'auto'; host.setAttribute('theme', 'light'); subscribers.forEach(fn => fn()); assert.equal(theme(), 'light');
  }
});
