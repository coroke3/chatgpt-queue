const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function fixture(t, platform) {
  const dom = new JSDOM('<!doctype html><body><main style="overflow-y:auto"><div id="first">Question 3</div><div id="second">Question 4</div></main></body>', {
    url: platform === 'gemini' ? 'https://gemini.google.com/app/test' : 'https://chatgpt.com/c/test', runScripts: 'outside-only'
  });
  const { window } = dom; t.after(() => window.close());
  window.chrome = { runtime: { onMessage: { addListener() {} } } };
  window.__onSleep = async () => {};
  const root = path.join(__dirname, '..');
  for (const file of ['references.js', 'model-picker.js', 'composer-tools.js']) window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  window.eval(fs.readFileSync(path.join(root, 'content.js'), 'utf8')
    .replace('const sleep = (ms) => globalThis.CGQQueueTiming?.wait(ms) || new Promise(resolve => setTimeout(resolve, ms));', 'const sleep = async ms => globalThis.__onSleep(ms);')
    .replace(/  queueManager\.init\(\)\.then\(\(\) => \{\s*new QueueUI\(queueManager\);\s*\}\);/,
      '  globalThis.__historyTest = { queueManager, getOlderHistory, DOM, HumanSimulator };'));
  const api = window.__historyTest;
  const scroller = window.document.querySelector('main');
  let height = 1000;
  Object.defineProperty(scroller, 'clientHeight', { value: 100 });
  Object.defineProperty(scroller, 'scrollHeight', { get: () => height });
  scroller.scrollTop = 300;
  api.HumanSimulator.userNodes = () => Array.from(scroller.children);
  let turns = [3, 4].map(n => ({ prompt: `Question ${n}`, answer: `Answer ${n}` }));
  api.DOM.getRecentQAHistory = () => turns;
  return { window, scroller, api, load: () => {
    height = 1200; scroller.firstElementChild.textContent = 'Question 1';
    turns = [1, 2, 3, 4].map(n => ({ prompt: `Question ${n}`, answer: `Answer ${n}` }));
  } };
}

test('source history loading detects replaced virtual turns and restores the original reading position in both services', async t => {
  for (const platform of ['chatgpt', 'gemini']) {
    const f = fixture(t, platform);
    let sleeps = 0;
    f.window.__onSleep = async () => {
      assert.equal(f.api.queueManager.isStuckToBottom, false);
      if (++sleeps === 1) f.load();
    };
    const result = await f.api.getOlderHistory(2);
    assert.equal(result.turns.length, 4);
    assert.equal(f.scroller.scrollTop, 500);
    assert.equal(f.api.queueManager.isStuckToBottom, true);
    assert.equal(sleeps, 2, 'stops waiting when a virtualized first turn changes');
  }
});

test('source history loading preserves a deliberate scroll while fetching', async t => {
  const f = fixture(t, 'chatgpt');
  f.window.__onSleep = async () => { f.load(); f.scroller.scrollTop = 150; };
  await f.api.getOlderHistory(2);
  assert.equal(f.scroller.scrollTop, 150);
});
