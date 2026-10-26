/* Native app/tool selections are data, never arbitrary saved HTML. */
(() => {
  'use strict';
  const clean = value => String(value || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  const text = el => clean(el?.innerText || el?.textContent);
  const hintNames = {
    search: /^(ウェブ検索|Web search|Search)$/i,
    picture_v2: /^(画像を作成|画像作成|Create image|Create an image)$/i,
    research: /^(Deep Research|ディープリサーチ)$/i,
    study: /^(勉強する|Study and learn)$/i
  };
  const normalize = values => {
    if (!Array.isArray(values)) return [];
    const seen = new Set();
    return values.slice(0, 20).flatMap(value => {
      if (!value || !['app', 'tool'].includes(value.type) || !['chatgpt', 'gemini'].includes(value.platform)) return [];
      const id = clean(value.id), label = clean(value.label);
      const labelKey = `${value.platform}:${value.type}:${label.toLowerCase()}`;
      if (!id || id.length > 200 || !label || label.length > 100 || seen.has(id) || seen.has(labelKey)) return [];
      seen.add(id);
      seen.add(labelKey);
      return [{ type: value.type, platform: value.platform, id, label }];
    });
  };

  class NativeTools {
    constructor(platform, { doc = document, getInput, setText, wait = ms => new Promise(r => setTimeout(r, ms)), isVisible } = {}) {
      this.platform = platform;
      this.doc = doc;
      this.getInput = getInput;
      this.setText = setText;
      this.wait = wait;
      this.visible = isVisible || (el => !!el && !el.closest('[hidden], [inert], [aria-hidden="true"]') && el.getClientRects().length > 0);
      this.pending = null;
      this.lastSelection = [];
    }

    nativeTokens(input = this.getInput()) {
      if (!input) return [];
      if (this.platform === 'gemini') {
        const tokens = Array.from(input.querySelectorAll('strong')).filter(el => /^@\S/.test(text(el)))
          .map(el => ({ el, tool: { platform: 'gemini', type: 'app', id: `gemini:app:${text(el).slice(1)}`, label: text(el).slice(1) } }));
        const seen = new Set();
        return tokens.filter(t => {
          if (seen.has(t.tool.id)) return false;
          seen.add(t.tool.id);
          return true;
        });
      }
      const tokens = Array.from(input.querySelectorAll('[app-mention-path], [data-system-hint-type]')).flatMap(el => {
        const path = el.getAttribute('app-mention-path');
        if (path?.startsWith('app://')) return [{ el, tool: { platform: 'chatgpt', type: 'app', id: path,
          label: el.getAttribute('app-mention-display-name') || text(el) } }];
        const name = el.getAttribute('data-system-hint-type');
        if (name && /^[a-z\d_-]+$/i.test(name)) return [{ el, tool: { platform: 'chatgpt', type: 'tool', id: `chatgpt:tool:${name}`,
          label: el.getAttribute('data-system-hint-label') || text(el) } }];
        return [];
      });
      const seen = new Set();
      return tokens.filter(t => {
        const key = `${t.tool.platform}:${t.tool.type}:${t.tool.label.toLowerCase()}`;
        if (seen.has(t.tool.id) || seen.has(key)) return false;
        seen.add(t.tool.id);
        seen.add(key);
        return true;
      });
    }

    geminiSelected() {
      const composer = this.getInput()?.closest('input-container, input-area, .text-input-field');
      if (!composer) return [];
      return Array.from(composer.querySelectorAll('button[aria-label]')).filter(el => /選択を解除|deselect|remove.*(?:tool|mode)/i.test(el.getAttribute('aria-label')))
        .flatMap(el => {
          const icon = el.querySelector('[data-mat-icon-name]:not([data-mat-icon-name="close"])')?.getAttribute('data-mat-icon-name');
          const label = text(el.querySelector('.gds-body-m'));
          return icon && label ? [{ el, tool: { platform: 'gemini', type: 'tool', id: `gemini:tool:${icon}`, label } }] : [];
        });
    }

    capture() {
      const input = this.getInput();
      if (!input) return { text: '', tools: [] };
      const tokens = this.nativeTokens(input);
      let body;
      if (input.matches('textarea, input')) body = input.value;
      else {
        const walk = node => {
          if (tokens.some(token => token.el === node)) return '';
          if (node.nodeType === 3) return node.nodeValue;
          if (node.nodeType !== 1 || node.matches('script,style,[aria-hidden="true"]')) return '';
          if (node.tagName === 'BR') return '\n';
          const content = Array.from(node.childNodes).map(walk).join('');
          return /^(P|DIV|LI)$/.test(node.tagName) && node !== input ? content + '\n' : content;
        };
        body = walk(input);
      }
      return { text: clean(body), tools: normalize([...tokens.map(token => token.tool), ...this.geminiSelected().map(token => token.tool)]) };
    }

    menuOpen() {
      return Array.from(this.doc.querySelectorAll('[data-mention-section-items], #at-mentions-v2-panel, .toolbox-drawer-item-list-button[role="menuitemcheckbox"]')).some(el => this.visible(el));
    }

    entries() {
      if (this.platform === 'chatgpt') {
        return Array.from(this.doc.querySelectorAll('[data-mention-section-items] button[data-list-navigation-item]')).flatMap(el => {
          if (!this.visible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') return [];
          const label = text(el.querySelector('[data-menu-row-content] .shrink-0.truncate')) || text(el).split('\n')[0];
          const plugin = el.getAttribute('data-plugin-impression-id');
          if (plugin) return [{ el, tool: { platform: 'chatgpt', type: 'app', id: `app://${plugin}`, label } }];
          const name = Object.keys(hintNames).find(key => hintNames[key].test(label));
          return name ? [{ el, tool: { platform: 'chatgpt', type: 'tool', id: `chatgpt:tool:${name}`, label } }] : [];
        });
      }
      const apps = Array.from(this.doc.querySelectorAll('#at-mentions-v2-panel [role="group"] button[role="menuitem"]')).flatMap(el => {
        const label = text(el.querySelector('.at-mentions-v2-item-title'));
        if (!this.visible(el) || !label || /すべて.*表示|show all/i.test(label)) return [];
        return [{ el, tool: { platform: 'gemini', type: 'app', id: `gemini:app:${label}`, label } }];
      });
      const tools = Array.from(this.doc.querySelectorAll('.toolbox-drawer-item-list-button[role="menuitemcheckbox"]')).flatMap(el => {
        const icon = el.querySelector('[data-mat-icon-name]')?.getAttribute('data-mat-icon-name');
        if (!this.visible(el) || !icon || el.disabled || el.getAttribute('aria-disabled') === 'true') return [];
        return [{ el, tool: { platform: 'gemini', type: 'tool', id: `gemini:tool:${icon}`, label: text(el.querySelector('.gem-menu-item-label, .menu-text')) || text(el), selected: el.getAttribute('aria-checked') === 'true' } }];
      });
      return [...apps, ...tools];
    }

    escape() {
      (this.doc.activeElement || this.getInput())?.dispatchEvent(new this.doc.defaultView.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    }

    async until(read, message) {
      for (let i = 0; i < 25; i++) {
        const result = read();
        if (result) return result;
        await this.wait(80);
      }
      throw new Error(message);
    }

    geminiTrigger() {
      return Array.from(this.doc.querySelectorAll('button')).find(el => this.visible(el) && /^(アップロードとツール|Upload.*tools|Tools)$/i.test(el.getAttribute('aria-label') || ''));
    }

    async open(kind, query = '', prefix = []) {
      if (this.platform === 'gemini' && kind === 'tool') {
        if (!this.entries().some(entry => entry.tool.type === 'tool')) {
          const trigger = this.geminiTrigger();
          if (!trigger) throw new Error('Geminiのツールメニューが見つかりません。');
          trigger.click();
        }
      } else {
        this.setText(this.getInput(), '@' + query, prefix);
      }
      await this.until(() => this.menuOpen(), '候補を開けませんでした。対象のチャットタブを開いて再試行してください。');
      // Search results may update asynchronously after the menu has appeared.
      await this.wait(180);
      return this.entries();
    }

    async exclusive(work) {
      if (this.pending) throw new Error('候補の確認中です。少し待って再試行してください。');
      const operation = Promise.resolve().then(work);
      this.pending = operation;
      try { return await operation; } finally { this.pending = null; }
    }

    async query(marker, query) {
      return this.exclusive(async () => {
        const kind = marker === '/' ? 'tool' : 'app';
        if (this.menuOpen()) return normalize(this.entries().map(entry => entry.tool)).filter(tool => (marker !== '/' || tool.type === 'tool') && tool.label.toLowerCase().includes(query.toLowerCase()));
        const input = this.getInput();
        if (!input) throw new Error('対象タブの入力欄が見つかりません。');
        const draft = this.capture();
        if (draft.text || draft.tools.length) throw new Error('対象タブに下書きがあります。下書きをキューに追加するか消してから候補を取得してください。');
        const focus = this.doc.activeElement;
        try {
          const entries = await this.open(this.platform === 'gemini' ? kind : 'app', this.platform === 'chatgpt' && marker === '/' ? '' : query);
          return normalize(entries.map(entry => entry.tool)).filter(tool => (marker !== '/' || tool.type === 'tool') && tool.label.toLowerCase().includes(query.toLowerCase()));
        } finally {
          this.escape();
          this.setText(input, '');
          if (focus?.isConnected) focus.focus();
        }
      });
    }

    async prepare(values, isCancelled = () => false) {
      const tools = normalize(values);
      if (Array.isArray(values) && tools.length !== values.length) throw new Error('保存されたアプリ・ツール指定を読み取れません。');
      if (tools.some(tool => tool.platform !== this.platform)) throw new Error('別サービスのアプリ・ツールは使用できません。');
      if (this.capture().text) throw new Error('対象タブに下書きがあるため自動送信を待機します。');
      const selectedNodes = [];
      await this.exclusive(async () => {
        try {
          // Gemini modes live outside the editor and otherwise leak into the next queued prompt.
          for (const selected of this.geminiSelected()) selected.el.click();
          if (this.platform === 'gemini') await this.until(() => !this.geminiSelected().length, '前のツール設定を解除できませんでした。');
          this.setText(this.getInput(), '');
          for (const tool of tools) {
            if (isCancelled()) throw new Error('ツールの選択を中止しました。');
            const entries = await this.open(tool.type, tool.label, selectedNodes);
            // ChatGPT hint IDs can change; only the exact native label is clicked, then its real token is checked.
            const entry = entries.find(entry => entry.tool.id === tool.id) || entries.find(entry => entry.tool.type === tool.type && entry.tool.label === tool.label);
            if (!entry) throw new Error(`${tool.label} は現在利用できません。`);
            if (!entry.selected) entry.el.click();
            await this.until(() => this.capture().tools.some(actual => actual.type === tool.type &&
              (actual.id === tool.id || (tool.type === 'tool' && actual.label === tool.label))), `${tool.label} の選択を確認できませんでした。`);
            this.escape();
            selectedNodes.splice(0, selectedNodes.length, ...this.nativeTokens().map(token => token.el.cloneNode(true)));
          }
          const actual = this.capture().tools;
          if (!tools.every(tool => actual.some(item => item.type === tool.type && (item.id === tool.id || item.label === tool.label)))) {
            throw new Error('指定したアプリ・ツールを同時に選択できません。');
          }
          this.lastSelection = actual;
          this.setText(this.getInput(), '', selectedNodes);
        } catch (error) {
          this.escape();
          this.setText(this.getInput(), '');
          throw error;
        }
      });
      return selectedNodes;
    }
  }

  // Shared autocomplete for Queue Manager and the bulk queue editor.
  function attach(input, { query, scope = () => 'draft', drafts = new Map(), onError = () => {} }) {
    if (!input) return { getTools: () => [], sync: () => {}, close: () => {}, clear: () => {}, destroy: () => {} };

    // Clean up previous attachment if it exists on this input
    if (input.__cgqAttached && typeof input.__cgqAttached.destroy === 'function') {
      try { input.__cgqAttached.destroy(); } catch {}
    }

    const doc = input.ownerDocument;
    const host = input.parentElement;
    if (host) {
      host.classList.add('cgq-prompt-host');
      // Clean up any stray chips or menus in host to prevent DOM accumulation
      host.querySelectorAll(':scope > .cgq-prompt-chips, :scope > .cgq-prompt-menu').forEach(el => el.remove());
    }

    const chips = doc.createElement('div'); chips.className = 'cgq-prompt-chips';
    const menu = doc.createElement('div'); menu.className = 'cgq-prompt-menu'; menu.hidden = true; menu.setAttribute('role', 'listbox');
    input.insertAdjacentElement('afterend', chips);
    if (host) host.append(menu);

    let timer, sequence = 0, options = [], index = 0, match = null, renderedSignature;
    const getTools = () => normalize(drafts.get(scope()));
    const close = () => { sequence++; menu.hidden = true; input.removeAttribute('aria-expanded'); };
    const sync = () => {
      const signature = `${scope()}:${JSON.stringify(getTools())}`;
      if (signature === renderedSignature) return;
      renderedSignature = signature;
      close(); chips.replaceChildren();
      for (const tool of getTools()) {
        const button = doc.createElement('button'); button.type = 'button'; button.className = 'cgq-prompt-chip';
        button.textContent = `${tool.type === 'app' ? '@' : '/'}${tool.label} ×`;
        button.title = `${tool.label} を解除`;
        button.onclick = () => {
          drafts.set(scope(), getTools().filter(item => item.id !== tool.id && item.label.toLowerCase() !== tool.label.toLowerCase()));
          sync();
        };
        chips.append(button);
      }
      chips.hidden = !chips.childElementCount;
    };
    const choose = tool => {
      if (!match) return;
      let values = getTools();
      values = values.filter(item => item.id !== tool.id && item.label.toLowerCase() !== tool.label.toLowerCase());
      if (tool.type === 'tool') {
        values = values.filter(item => item.type !== 'tool');
      }
      values.push(tool);
      drafts.set(scope(), normalize(values));
      const end = input.selectionStart;
      input.value = input.value.slice(0, match.start) + input.value.slice(end);
      input.setSelectionRange(match.start, match.start);
      sync();
      input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
      input.focus();
    };
    const render = (message = '') => {
      menu.replaceChildren();
      if (message) { const status = doc.createElement('div'); status.className = 'cgq-prompt-menu-status'; status.textContent = message; menu.append(status); }
      options.forEach((tool, i) => {
        const button = doc.createElement('button'); button.type = 'button'; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(i === index));
        button.textContent = `${tool.type === 'app' ? '@' : '/'} ${tool.label}`;
        button.onmousedown = event => event.preventDefault(); button.onclick = () => choose(tool); menu.append(button);
      });
    };
    const update = () => {
      clearTimeout(timer);
      if (input.disabled) return close();
      const before = input.value.slice(0, input.selectionStart);
      const found = before.match(/(?:^|\s)([@/])([^\s@/]{0,60})$/);
      if (!found) return close();
      match = { start: before.length - found[1].length - found[2].length, marker: found[1], query: found[2] };
      const ticket = ++sequence, key = scope(); options = []; index = 0;
      menu.hidden = false; input.setAttribute('aria-expanded', 'true'); render('候補を確認中…');
      timer = setTimeout(async () => {
        try {
          const result = await query(match.marker, match.query);
          if (sequence !== ticket || scope() !== key || !input.isConnected) return;
          options = normalize(result); render(options.length ? '' : '利用できる候補がありません');
        } catch (error) {
          if (sequence !== ticket || scope() !== key) return;
          render(error.message || '候補を取得できませんでした'); onError(error);
        }
      }, 280);
    };

    const onInput = event => { if (!event.isComposing) update(); };
    const onCompositionEnd = () => update();
    const onKeyDown = event => {
      if (event.isComposing || event.keyCode === 229 || menu.hidden) return;
      if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.key === 'Escape') close();
        else if (event.key === 'Enter') { if (options[index]) choose(options[index]); }
        else if (options.length) { index = (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length; render(); }
      }
    };
    const onBlur = () => { setTimeout(close, 160); };

    input.addEventListener('input', onInput);
    input.addEventListener('compositionend', onCompositionEnd);
    input.addEventListener('keydown', onKeyDown, true);
    input.addEventListener('blur', onBlur);

    const destroy = () => {
      clearTimeout(timer);
      close();
      input.removeEventListener('input', onInput);
      input.removeEventListener('compositionend', onCompositionEnd);
      input.removeEventListener('keydown', onKeyDown, true);
      input.removeEventListener('blur', onBlur);
      chips.remove();
      menu.remove();
      if (input.__cgqAttached === controller) {
        delete input.__cgqAttached;
      }
    };

    const controller = {
      getTools,
      sync,
      close,
      clear() { drafts.delete(scope()); sync(); },
      destroy
    };
    input.__cgqAttached = controller;
    sync();
    return controller;
  }

  // Tools used before are kept per service, so @ / candidates still appear when the tab's own menu cannot be read.
  const HISTORY_KEY = 'cgq_tool_history';
  const HISTORY_LIMIT = 60;
  const localStore = () => (typeof chrome !== 'undefined' && chrome.storage?.local) || null;

  async function readHistory() {
    try { return (await localStore()?.get(HISTORY_KEY))?.[HISTORY_KEY] || {}; } catch { return {}; }
  }

  async function remember(values) {
    const tools = normalize(values), store = localStore();
    if (!tools.length || !store) return;
    try {
      const all = await readHistory(), now = Date.now();
      for (const tool of tools) {
        const list = Array.isArray(all[tool.platform]) ? all[tool.platform] : [];
        const found = list.find(item => item.id === tool.id || (item.type === tool.type && item.label.toLowerCase() === tool.label.toLowerCase()));
        if (found) Object.assign(found, { id: tool.id, label: tool.label, count: (found.count || 0) + 1, lastUsed: now });
        else list.push({ ...tool, count: 1, lastUsed: now });
        all[tool.platform] = list.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0)).slice(0, HISTORY_LIMIT);
      }
      await store.set({ [HISTORY_KEY]: all });
    } catch {}
  }

  // Same filtering as the native menu: "/" shows tools only, "@" shows apps and tools.
  async function recall(platform, marker, query = '') {
    const needle = clean(query).toLowerCase();
    return normalize((await readHistory())[platform] || [])
      .filter(tool => (marker !== '/' || tool.type === 'tool') && tool.label.toLowerCase().includes(needle));
  }

  function mergeOptions(native, remembered) {
    const current = normalize(native);
    const seenIds = new Set(current.map(tool => tool.id));
    const seenLabels = new Set(current.map(tool => `${tool.type}:${tool.label.toLowerCase()}`));
    const extra = normalize(remembered).filter(tool =>
      !seenIds.has(tool.id) && !seenLabels.has(`${tool.type}:${tool.label.toLowerCase()}`)
    );
    return [...current, ...extra];
  }

  const api = { NativeTools, normalize, attach, remember, recall, mergeOptions };
  globalThis.CGQComposerTools = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
