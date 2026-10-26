const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { NativeTools, normalize, toolKind, matchesQuery } = require('../composer-tools.js');

// Menu rows, native mention attributes, and mode chips observed in Chrome, 2026-10-26.
function fixture(t, platform, { missing = false, ignoreSelection = false, legacy = false, nested = false, clickToggles = false } = {}) {
  const dom = new JSDOM(`<body><input-container><input-area><div class="text-input-field">
    <div><div><div><div><div id="input" contenteditable="true"></div></div></div></div></div>
    <button id="tools" aria-label="${platform === 'gemini' ? 'アップロードとツール' : 'ファイルなどを追加'}"></button>
    <div id="selection"></div></div></input-area></input-container></body>`, { pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const doc = dom.window.document, input = doc.getElementById('input');
  let clicks = 0;
  const close = () => doc.getElementById('menu')?.remove();
  function open() {
    close();
    const menu = doc.createElement('div'); menu.id = 'menu';
    if (legacy) menu.setAttribute('data-mention-section-items', '');
    const rows = platform === 'gemini'
      ? [{ icon: 'deep_research', label: 'Deep Research' }, { icon: 'canvas', label: 'Canvas' }]
      : [{ label: 'Deep Research', plugin: 'connector_openai_deep_research' }, { label: 'GitHub', plugin: 'github' }];
    for (const row of rows.filter(row => !missing || row.label !== 'Deep Research')) {
      const button = doc.createElement('button');
      if (platform === 'gemini') {
        button.className = 'toolbox-drawer-item-list-button'; button.setAttribute('role', 'menuitemcheckbox');
        button.setAttribute('aria-checked', 'false');
        button.innerHTML = `<mat-icon data-mat-icon-name="${row.icon}"></mat-icon><div class="gem-menu-item-label">${row.label}</div>`;
      } else {
        button.setAttribute('data-list-navigation-item', 'true');
        if (!legacy) button.setAttribute('data-plugin-impression-id', row.plugin);
        button.innerHTML = `<div data-menu-row-content><span class="shrink-0 truncate">${row.label}</span><span>説明文</span></div>`;
      }
      button.onclick = () => {
        clicks++; close();
        if (ignoreSelection) return;
        if (platform === 'gemini') {
          const selected = doc.createElement('button'); selected.setAttribute('aria-label', `${row.label}の選択を解除`);
          selected.innerHTML = `<mat-icon data-mat-icon-name="${row.icon}"></mat-icon><span class="gds-body-m">${row.label}</span><mat-icon data-mat-icon-name="close"></mat-icon>`;
          selected.onclick = () => selected.remove(); doc.getElementById('selection').replaceChildren(selected);
        } else {
          const token = doc.createElement('span'); token.setAttribute('contenteditable', 'false'); token.textContent = row.label;
          if (legacy) { token.setAttribute('data-system-hint-type', 'research'); token.setAttribute('data-system-hint-label', row.label); }
          else { token.setAttribute('app-mention-path', `app://${row.plugin}`); token.setAttribute('app-mention-display-name', row.label); }
          input.replaceChildren(token);
        }
      };
      if (nested && row.label === 'Deep Research') {
        const more = doc.createElement('button'); more.setAttribute('data-test-id', 'more-tools-button');
        more.setAttribute('aria-expanded', 'false'); more.setAttribute('aria-label', 'その他のツール');
        more.onmouseenter = () => { more.setAttribute('aria-expanded', 'true'); menu.append(button); };
        if (clickToggles) more.onclick = () => {
          const opened = more.getAttribute('aria-expanded') === 'true';
          more.setAttribute('aria-expanded', String(!opened));
          if (opened) button.remove(); else menu.append(button);
        };
        menu.append(more);
      } else menu.append(button);
    }
    doc.body.append(menu);
  }
  doc.getElementById('tools').onclick = open;
  doc.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  input.focus();
  const native = new NativeTools(platform, { doc, getInput: () => input,
    setText: (element, value, prefix = []) => { element.replaceChildren(...prefix.map(n => n.cloneNode(true)), doc.createTextNode(value)); if (value.startsWith('@')) open(); },
    isVisible: element => !!element && element.isConnected && !element.closest('[hidden]'), wait: async () => {} });
  return { native, input, doc, get clicks() { return clicks; } };
}

test('both providers resolve /deepresearch and select verified native Research state', async t => {
  for (const platform of ['chatgpt', 'gemini']) {
    const f = fixture(t, platform);
    for (const prefix of ['/deepresearch', '/"Deep Research"', '/ディープリサーチ', '/deep-research']) {
      const resolved = await f.native.resolvePrompt(`${prefix} 調査して`);
      assert.equal(resolved.text, '調査して');
      assert.equal(toolKind(resolved.tools[0]), 'research');
      const nodes = await f.native.prepare(resolved.tools);
      assert.equal(f.native.capture().tools[0].id, resolved.tools[0].id);
      if (platform === 'chatgpt') {
        assert.equal(nodes.length, 1);
        assert.equal(nodes[0].getAttribute('app-mention-path'), 'app://connector_openai_deep_research');
        await f.native.prepare([]);
      }
    }
    assert.equal(f.clicks, 4);
  }
});

test('Gemini Research is discovered inside the hover-only More tools submenu', async t => {
  for (const clickToggles of [false, true]) {
    const f = fixture(t, 'gemini', { nested: true, clickToggles });
    const options = await f.native.query('/', 'deepresearch');
    assert.equal(options[0].label, 'Deep Research');
    const resolved = await f.native.resolvePrompt('/deepresearch 調査');
    await f.native.prepare(resolved.tools);
    assert.equal(toolKind(f.native.capture().tools[0]), 'research');
  }
});

test('Gemini Canvas, Research and ordinary prompts switch modes without leaking prior selections', async t => {
  const f = fixture(t, 'gemini');
  for (const prompt of ['/canvas 作って', '/deepresearch 調べて', '/キャンバス 作って']) {
    const resolved = await f.native.resolvePrompt(prompt);
    await f.native.prepare(resolved.tools);
    assert.equal(f.native.capture().tools.length, 1);
    assert.equal(f.native.capture().tools[0].label, prompt.includes('deepresearch') ? 'Deep Research' : 'Canvas');
  }
  await f.native.prepare([]);
  assert.equal(f.native.capture().tools.length, 0);
  const both = (await f.native.resolvePrompt('/canvas /deepresearch 比較')).tools;
  await assert.rejects(f.native.prepare(both), /1つ指定/);
  assert.equal(f.native.capture().tools.length, 0);
});

test('legacy ChatGPT Research hints still work, and migrated app metadata is treated as a tool', async t => {
  const f = fixture(t, 'chatgpt', { legacy: true });
  const resolved = await f.native.resolvePrompt('/deepresearch 調査');
  assert.equal(resolved.tools[0].id, 'chatgpt:tool:research');
  await f.native.prepare(resolved.tools);
  assert.equal(f.native.capture().tools[0].type, 'tool');
  assert.equal(normalize([{ platform: 'chatgpt', type: 'app', id: 'app://connector_openai_deep_research', label: 'Deep Research' }])[0].type, 'tool');
});

test('unavailable Research and an unconfirmed click fail before the prompt can be sent', async t => {
  for (const platform of ['chatgpt', 'gemini']) {
    const missing = fixture(t, platform, { missing: true });
    await assert.rejects(missing.native.resolvePrompt('/deepresearch 調査'), /一意に選択できません/);
    assert.equal(missing.input.textContent, '');
    const ignored = fixture(t, platform, { ignoreSelection: true });
    const resolved = await ignored.native.resolvePrompt('/deepresearch 調査');
    await assert.rejects(ignored.native.prepare(resolved.tools), /選択を確認できません/);
    assert.equal(ignored.input.textContent, '');
  }
});

test('aliases apply to actual native tools without changing ordinary app name matching', () => {
  const research = { type: 'tool', label: 'Deep Research', id: 'gemini:tool:deep_research' };
  assert.equal(matchesQuery(research, 'deepresearch'), true);
  assert.equal(matchesQuery(research, 'research', true), true);
  assert.equal(matchesQuery({ ...research, type: 'app', id: 'app://custom' }, 'deepresearch', true), false);
  assert.equal(matchesQuery({ type: 'app', label: 'GitHub' }, 'github', true), true);
});
