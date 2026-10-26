/* Read and operate the service's own model picker. No model catalog is bundled. */
(() => {
  'use strict';

  class ServiceModelPicker {
    constructor(platform, { doc = document, wait = ms => new Promise(r => setTimeout(r, ms)), isVisible } = {}) {
      this.platform = platform;
      this.doc = doc;
      this.wait = wait;
      this.visible = isVisible || (el => !!el && !el.closest('[hidden], [inert], [aria-hidden="true"]') && el.getClientRects().length > 0);
      this.models = [];
      this.current = null;
      this.error = '';
      this.pending = null;
    }

    text(el) {
      return (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    }

    trigger() {
      const selectors = this.platform === 'gemini'
        ? '[data-test-id="bard-mode-menu-button"], [data-test-id="model-picker-btn"], button.model-selector, button.model-select-button'
        : 'button[data-testid="model-switcher-dropdown"], button[data-codex-intelligence-trigger]';
      const explicit = Array.from(this.doc.querySelectorAll(selectors)).find(el => this.visible(el));
      if (explicit) return explicit;
      return Array.from(this.doc.querySelectorAll('button[aria-haspopup]')).find(el => {
        if (!this.visible(el) || el.closest('[id^="cgq-"], .cgq-modal-overlay')) return false;
        const label = el.getAttribute('aria-label') || '';
        return /(?:model|モデル).*(?:select|選択|切り替え)|(?:select|選択|切り替え).*(?:model|モデル)/i.test(label);
      });
    }

    menus(trigger = this.trigger()) {
      if (!trigger) return [];
      const ids = (trigger.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean);
      let roots = ids.map(id => this.doc.getElementById(id)).filter(el => el && this.visible(el));
      if (!roots.length && trigger.id) {
        roots = Array.from(this.doc.querySelectorAll('[role="menu"], [role="listbox"]'))
          .filter(el => this.visible(el) && el.getAttribute('aria-labelledby') === trigger.id);
      }
      if (!roots.length && trigger.getAttribute('aria-expanded') === 'true') {
        roots = Array.from(this.doc.querySelectorAll(this.platform === 'gemini'
          ? '[data-test-id="gem-mode-menu"], .model-menu[role="menu"]'
          : '[role="menu"], [role="listbox"]')).filter(el => this.visible(el) && (
          this.platform === 'gemini' || el.querySelector('[data-model-picker-view], [data-model-slug], [role="menuitemradio"]')
        ));
      }
      return roots;
    }

    selected(el) {
      return el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true' ||
        el.getAttribute('data-model-selected') === 'true' || el.classList.contains('selected');
    }

    entries(root, path = []) {
      const selector = this.platform === 'gemini'
        ? '[data-mode-id], [role="option"], mat-option, [role="menuitem"]'
        : '[role="menuitemradio"], [role="option"], [role="menuitem"]';
      return Array.from(root.querySelectorAll(selector)).flatMap(el => {
        if (!this.visible(el) || el.closest('[role="menu"], [role="listbox"]') !== root) return [];
        if (el.matches('[data-model-picker-view-toggle], [data-reasoning-slider]')) return [];
        if (el.disabled || el.getAttribute('aria-disabled') === 'true' || el.hasAttribute('data-disabled') ||
          el.getAttribute('data-locked') === 'true' || el.getAttribute('aria-haspopup') === 'menu' ||
          el.getAttribute('aria-haspopup') === 'true') return [];
        const title = el.querySelector(this.platform === 'gemini'
          ? '.label, .model-name, [data-testid="model-name"]'
          : '[data-model-name], [data-testid="model-name"], .font-semibold, .truncate');
        const label = title ? this.text(title) : (el.innerText || el.textContent || '').trim().split('\n')[0].trim();
        const nativeId = el.getAttribute('data-mode-id') || el.getAttribute('data-model-slug') || el.getAttribute('data-value');
        const role = el.getAttribute('role');
        if (!label || label.length > 100 || /upgrade|アップグレード|プランを|subscribe/i.test(label)) return [];
        // Plain menu actions (power slider, account settings, thinking levels) are not models.
        if (!nativeId && role !== 'menuitemradio' && role !== 'option' && el.tagName !== 'MAT-OPTION' &&
          !/^(?:GPT[-\s]?\d|ChatGPT\s+\w|o\d|Gemini\b|\d+(?:\.\d+)?\s+(?:Flash|Pro|Argon)|Auto$|Instant$|Thinking$|Pro$|自動$|高速モード$|思考モード$)/i.test(label)) return [];
        const key = nativeId || label.normalize('NFKC').toLowerCase().replace(/\s+/g, '-');
        const desc = this.text(el.querySelector('.sublabel, .text-xs, .text-token-text-tertiary'));
        return [{ el, model: { id: `${this.platform}:${key}`, label, desc, path,
          isReasoning: /thinking|reasoning|推論|思考|^o\d/i.test(label) }, selected: this.selected(el) }];
      });
    }

    capture(roots = this.menus(), path = []) {
      const entries = roots.flatMap(root => this.entries(root, path));
      const current = entries.find(entry => entry.selected);
      if (current) this.current = current.model;
      return entries;
    }

    info() {
      if (!this.pending) {
        const entries = this.capture();
        // Only a real model menu can replace the catalog; other menus never contribute.
        if (entries.length) {
          const merged = new Map([...this.models, ...entries.map(entry => entry.model)].map(model => [model.id, model]));
          this.models = Array.from(merged.values());
        }
      }
      return {
        model: this.current?.id || null,
        modelLabel: this.current?.label || 'Auto',
        availableModels: this.models,
        modelsError: this.error
      };
    }

    async until(read, message) {
      for (let i = 0; i < 20; i++) {
        const value = read();
        if (value) return value;
        await this.wait(100);
      }
      throw new Error(message);
    }

    escape(trigger) {
      const target = this.doc.activeElement || trigger;
      target?.dispatchEvent(new this.doc.defaultView.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    }

    async withMenu(work) {
      const trigger = this.trigger();
      if (!trigger || trigger.disabled || trigger.getAttribute('aria-disabled') === 'true') {
        throw new Error('サービス側のモデル選択ボタンが見つかりません。対象タブを開いてください。');
      }
      const opened = this.menus(trigger).length === 0;
      // Do not dismiss an unrelated user dialog or menu to force access to the picker.
      if (opened && Array.from(this.doc.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"]'))
        .some(el => this.visible(el) && !el.closest('[id^="cgq-"]'))) {
        throw new Error('対象タブの別のメニューやダイアログを閉じてから再取得してください。');
      }
      let viewToggle = null;
      try {
        if (opened) trigger.click();
        const roots = await this.until(() => {
          const list = this.menus(trigger);
          return list.length ? list : null;
        }, 'モデル一覧を開けませんでした。');
        // Current ChatGPT first shows the power slider; its models live in a second view.
        viewToggle = roots.flatMap(root => Array.from(root.querySelectorAll('[data-model-picker-view-toggle]')))
          .find(el => this.visible(el) && el.closest('[data-model-picker-view="simple"]'));
        if (viewToggle) {
          viewToggle.click();
          await this.until(() => this.capture(this.menus(trigger)).length, 'モデル一覧の表示を確認できませんでした。');
        }
        return await work(trigger);
      } finally {
        if (opened) {
          // Escape the submenu first, then the main picker if both are still open.
          for (let i = 0; i < 3 && this.menus(trigger).length; i++) {
            this.escape(trigger);
            await this.wait(50);
          }
        } else if (viewToggle?.isConnected && this.visible(viewToggle) &&
          viewToggle.closest('[data-model-picker-view="advanced"]')) {
          viewToggle.click();
        }
      }
    }

    async collect(trigger) {
      this.current = null;
      const entries = await this.until(() => {
        const found = this.capture(this.menus(trigger));
        return found.length ? found : null;
      }, '選択可能なモデルを取得できませんでした。');
      // Older ChatGPT pickers expose more models through one explicitly named submenu.
      const more = this.menus(trigger).flatMap(root => Array.from(root.querySelectorAll('[aria-haspopup="menu"]')))
        .find(el => this.visible(el) && /other models|more models|legacy|その他.*モデル|他のモデル|以前のモデル|レガシー/i.test(this.text(el)));
      if (more) {
        const path = [this.text(more)];
        const before = new Set(this.doc.querySelectorAll('[role="menu"]'));
        more.click();
        const submenu = await this.until(() => Array.from(this.doc.querySelectorAll('[role="menu"]'))
          .find(el => !before.has(el) && this.visible(el)), '追加モデルの一覧を開けませんでした。');
        entries.push(...this.capture([submenu], path));
        this.escape(trigger);
        await this.wait(100);
      }
      const unique = new Map(entries.map(entry => [entry.model.id, entry.model]));
      this.models = Array.from(unique.values());
      if (!this.models.length) throw new Error('選択可能なモデルを取得できませんでした。');
      return entries;
    }

    refresh() {
      if (this.pending) return this.pending;
      this.pending = this.withMenu(trigger => this.collect(trigger))
        .then(() => { this.error = ''; return this.info(); })
        .catch(error => { this.models = []; this.error = error.message; throw error; })
        .finally(() => { this.pending = null; });
      return this.pending;
    }

    async switchTo(id) {
      if (!id || id === 'auto') return this.info();
      if (this.pending) throw new Error('モデル一覧の取得または切り替え中です。少し待ってください。');
      const operation = this.withMenu(async trigger => {
        // Re-read availability immediately before clicking; stale queued IDs must fail closed.
        await this.collect(trigger);
        const model = this.models.find(model => model.id === id);
        if (!model) throw new Error('指定モデルは現在の選択候補にありません。モデル一覧を再取得してください。');
        let roots = this.menus(trigger);
        for (const label of model.path) {
          const parent = roots.flatMap(root => Array.from(root.querySelectorAll('[aria-haspopup="menu"]')))
            .find(el => this.visible(el) && this.text(el) === label);
          if (!parent) throw new Error('指定モデルのメニューを開けませんでした。');
          const before = new Set(this.doc.querySelectorAll('[role="menu"]'));
          parent.click();
          roots = [await this.until(() => Array.from(this.doc.querySelectorAll('[role="menu"]'))
            .find(el => !before.has(el) && this.visible(el)), 'モデルのサブメニューを開けませんでした。')];
        }
        const target = roots.flatMap(root => this.entries(root, model.path)).find(entry => entry.model.id === id);
        if (!target) throw new Error('指定モデルは現在選択できません。');
        if (target.selected) return;
        target.el.click();
        await this.wait(200);
        // Reopen and read the checked option. A click or a changed URL is not success.
        await this.withMenu(async checkTrigger => {
          await this.collect(checkTrigger);
          await this.until(() => {
            this.capture(this.menus(checkTrigger));
            return this.current?.id === id;
          }, 'モデルの切り替えを確認できませんでした。');
        });
      });
      this.pending = operation;
      try {
        await operation;
        this.error = '';
        return this.info();
      } catch (error) {
        this.error = error.message;
        throw error;
      } finally {
        this.pending = null;
      }
    }
  }

  globalThis.CGQServiceModelPicker = ServiceModelPicker;
  if (typeof module !== 'undefined' && module.exports) module.exports = ServiceModelPicker;
})();
