const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const ModelPicker = require('../model-picker.js');

// Menu shapes and attributes observed in Chrome on ChatGPT and Gemini.
function fixture(platform, { ignoreSelection = false, initialOpen = false, legacy = false } = {}) {
  const dom = new JSDOM('<!doctype html><body><button id="picker"></button><div id="chat-history">GPT-4o Gemini 1.5 Pro</div></body>', { url: 'https://example.test/' });
  const doc = dom.window.document;
  const trigger = doc.getElementById('picker');
  const models = platform === 'gemini' ? [
    { id: '8c46e95b1a07cecc', label: '3.5 Flash-Lite', desc: 'すばやく回答を得るのに最適' },
    { id: '56fdd199312815e2', label: '3.8 Flash', desc: 'あらゆる場面でサポート' },
    { id: 'e6fa609c3fa255c0', label: '3.1 Pro', desc: '高度な推論' },
    { id: '95a4c0abcba24364', label: '4 Argon', desc: '複雑なタスク' }
  ] : [{ label: 'GPT-6' }, { label: 'GPT-5.6 Sol' }];
  let selected = platform === 'gemini' ? 1 : 0;
  const clicks = [];
  const visible = el => !!el && el.isConnected && !el.closest('[hidden], [inert], [aria-hidden="true"]');
  trigger.setAttribute(platform === 'gemini' ? 'data-test-id' : 'data-codex-intelligence-trigger', platform === 'gemini' ? 'bard-mode-menu-button' : 'true');
  trigger.setAttribute('aria-controls', 'model-menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.textContent = platform === 'gemini' ? 'Flash' : '思考量 高';
  let simple = true;
  function close() {
    doc.getElementById('legacy-menu')?.remove();
    doc.getElementById('model-menu')?.remove();
    trigger.setAttribute('aria-expanded', 'false');
  }
  function row(model, index) {
    const el = doc.createElement(platform === 'gemini' ? 'gem-menu-item' : 'div');
    el.setAttribute('role', platform === 'gemini' ? 'menuitem' : 'menuitemradio');
    if (model.disabled) el.setAttribute('aria-disabled', 'true');
    if (platform === 'gemini') {
      el.setAttribute('data-mode-id', model.id);
      el.setAttribute('data-active', index === 0 ? 'true' : 'false'); // Focus is not selection.
      if (index === selected) el.className = 'selected';
      el.innerHTML = `<span class="label"></span><div class="sublabel"></div>`;
      el.querySelector('.label').textContent = model.label;
      el.querySelector('.sublabel').textContent = model.desc;
    } else {
      el.setAttribute('aria-checked', String(index === selected));
      el.innerHTML = '<div data-menu-row-content><span class="truncate"></span></div>';
      el.querySelector('.truncate').textContent = model.label;
    }
    el.addEventListener('click', () => {
      clicks.push(model.label);
      if (!ignoreSelection) selected = index;
      close();
    });
    return el;
  }
  function open() {
    const menu = doc.createElement('div');
    menu.id = 'model-menu';
    menu.setAttribute('role', 'menu');
    if (platform === 'gemini') {
      menu.setAttribute('data-test-id', 'gem-mode-menu');
      models.forEach((model, index) => menu.append(row(model, index)));
      const level = doc.createElement('div');
      level.setAttribute('role', 'menuitem');
      level.setAttribute('aria-haspopup', 'true');
      level.innerHTML = '<span class="label">思考レベル</span>';
      menu.append(level);
    } else {
      const view = doc.createElement('div');
      view.setAttribute('data-model-picker-view', simple ? 'simple' : 'advanced');
      view.innerHTML = '<div role="menuitem" data-model-picker-view-toggle aria-label="モデルを選択">高</div><div role="menuitem" data-reasoning-slider>パワー</div><div class="models"></div>';
      const track = view.querySelector('.models');
      if (simple) track.setAttribute('inert', '');
      models.forEach((model, index) => track.append(row(model, index)));
      view.querySelector('[data-model-picker-view-toggle]').onclick = () => {
        simple = !simple;
        view.setAttribute('data-model-picker-view', simple ? 'simple' : 'advanced');
        track.toggleAttribute('inert', simple);
      };
      if (legacy) {
        const more = doc.createElement('div');
        more.setAttribute('role', 'menuitem');
        more.setAttribute('aria-haspopup', 'menu');
        more.textContent = '以前のモデル';
        more.onclick = () => {
          const sub = doc.createElement('div');
          sub.id = 'legacy-menu';
          sub.setAttribute('role', 'menu');
          sub.append(row({ label: 'GPT-6 Mini' }, 50));
          doc.body.append(sub);
        };
        track.append(more);
      }
      menu.append(view);
    }
    doc.body.append(menu);
    trigger.setAttribute('aria-expanded', 'true');
  }
  trigger.onclick = () => doc.getElementById('model-menu') ? close() : open();
  doc.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const sub = doc.getElementById('legacy-menu');
    if (sub) sub.remove(); else close();
  });
  if (initialOpen) open();
  const picker = new ModelPicker(platform, { doc, isVisible: visible, wait: async () => {} });
  return { dom, doc, picker, trigger, models, clicks, open, close };
}

test('ChatGPT reads its advanced model view and never invents baseline models', async () => {
  const f = fixture('chatgpt');
  assert.deepEqual(f.picker.info().availableModels, []);
  const info = await f.picker.refresh();
  assert.deepEqual(info.availableModels.map(m => m.label), ['GPT-6', 'GPT-5.6 Sol']);
  assert.equal(info.modelLabel, 'GPT-6');
  assert.equal(f.trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(f.picker.info().availableModels.length, 2, 'catalog survives menu closure');
  assert.deepEqual(f.clicks, []);
  f.dom.window.close();
});

test('Gemini reads native mode IDs and ignores focus and thinking-level actions', async () => {
  const f = fixture('gemini');
  const info = await f.picker.refresh();
  assert.equal(info.availableModels.length, 4);
  assert.equal(info.model, 'gemini:56fdd199312815e2');
  assert.equal(info.modelLabel, '3.8 Flash');
  assert.equal(info.availableModels[0].desc, 'すばやく回答を得るのに最適');
  f.dom.window.close();
});

for (const platform of ['chatgpt', 'gemini']) {
  test(`${platform}: switches the exact option and verifies it in the reopened menu`, async () => {
    const f = fixture(platform);
    const info = await f.picker.refresh();
    const target = info.availableModels[platform === 'gemini' ? 2 : 1];
    const updated = await f.picker.switchTo(target.id);
    assert.equal(updated.model, target.id);
    assert.equal(updated.modelLabel, target.label);
    assert.deepEqual(f.clicks, [target.label]);
    assert.equal(f.trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(f.dom.window.location.href, 'https://example.test/');
    f.dom.window.close();
  });

  test(`${platform}: a click without a selected-state change is a failure`, async () => {
    const f = fixture(platform, { ignoreSelection: true });
    const info = await f.picker.refresh();
    const target = info.availableModels[platform === 'gemini' ? 2 : 1];
    await assert.rejects(f.picker.switchTo(target.id), /切り替えを確認できません/);
    assert.equal(f.picker.info().model, info.model);
    f.dom.window.close();
  });
}

test('removed, disabled and fabricated IDs never click another option', async () => {
  const f = fixture('gemini');
  const old = await f.picker.refresh();
  f.models[2].disabled = true;
  await assert.rejects(f.picker.switchTo(old.availableModels[2].id), /選択候補にありません/);
  f.models.pop();
  await assert.rejects(f.picker.switchTo(old.availableModels[3].id), /選択候補にありません/);
  await assert.rejects(f.picker.switchTo('gemini-1.5-pro'), /選択候補にありません/);
  assert.deepEqual(f.clicks, []);
  f.dom.window.close();
});

test('an unrelated menu blocks discovery and its actions are never read or clicked', async () => {
  const f = fixture('chatgpt');
  const menu = f.doc.createElement('div');
  menu.setAttribute('role', 'menu');
  menu.innerHTML = '<button role="menuitem">アカウント設定</button>';
  f.doc.body.append(menu);
  await assert.rejects(f.picker.refresh(), /別のメニュー/);
  assert.deepEqual(f.picker.info().availableModels, []);
  assert.equal(f.trigger.getAttribute('aria-expanded'), 'false');
  assert.ok(menu.isConnected);
  f.dom.window.close();
});

test('a user-opened simple ChatGPT menu is restored without closing it', async () => {
  const f = fixture('chatgpt', { initialOpen: true });
  await f.picker.refresh();
  assert.equal(f.trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(f.doc.querySelector('[data-model-picker-view]').getAttribute('data-model-picker-view'), 'simple');
  f.dom.window.close();
});

test('explicit legacy submenu entries keep their selection path', async () => {
  const f = fixture('chatgpt', { legacy: true });
  const info = await f.picker.refresh();
  assert.deepEqual(info.availableModels.map(m => m.label), ['GPT-6', 'GPT-5.6 Sol', 'GPT-6 Mini']);
  const target = info.availableModels[2];
  assert.deepEqual(target.path, ['以前のモデル']);
  const updated = await f.picker.switchTo(target.id);
  assert.equal(updated.model, target.id);
  assert.deepEqual(f.clicks, ['GPT-6 Mini']);
  f.dom.window.close();
});

test('concurrent discovery is deduplicated; failed discovery clears stale candidates', async () => {
  const f = fixture('chatgpt');
  const first = f.picker.refresh();
  assert.equal(f.picker.refresh(), first);
  await assert.rejects(f.picker.switchTo('chatgpt:gpt-6'), /取得または切り替え中/);
  await first;
  f.trigger.remove();
  await assert.rejects(f.picker.refresh(), /選択ボタンが見つかりません/);
  assert.deepEqual(f.picker.info().availableModels, []);
  f.dom.window.close();
});

test('model catalogs remain isolated between tabs and services', async () => {
  const a = fixture('chatgpt');
  const b = fixture('gemini');
  await Promise.all([a.picker.refresh(), b.picker.refresh()]);
  assert.ok(a.picker.info().availableModels.every(m => m.id.startsWith('chatgpt:')));
  assert.ok(b.picker.info().availableModels.every(m => m.id.startsWith('gemini:')));
  a.dom.window.close(); b.dom.window.close();
});
