/* Shared citation extraction and compact rendering for both services. */
(() => {
  'use strict';
  const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cleanText = value => String(value || '').replace(/\s+/g, ' ').trim();
  const globe = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2c4 4 4 8 0 12-4-4-4-8 0-12Z"/></svg>';
  const tokenPattern = /\uE000CGQREF:([^\uE001]+)\uE001|【\d+(?::\d+)?†([^】]+)】|\uE200cite\uE202[^\uE201]*\uE201|\uE000CGQWIDGET:([^\uE001]+)\uE001/g;

  function safeURL(value, base) {
    try {
      if (!value || String(value).trim().startsWith('#')) return '';
      const url = new URL(value, base);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
      if (/(^|\.)google\.com$/.test(url.hostname) && url.pathname === '/url') {
        const target = url.searchParams.get('q') || url.searchParams.get('url');
        if (target && /^https?:\/\//i.test(target)) return safeURL(target);
      }
      return url.href;
    } catch { return ''; }
  }

  function isSourcesContainer(el) {
    return el.matches('sources-carousel, .sources-carousel, .grounding-sources, .sources-container, .sources-list, [data-testid="sources"], [data-test-id="sources"], [data-testid*="sources"], [data-testid*="search-result"], [class*="search-sources"], [class*="SourcesCarousel"], [class*="SourceAttributions"]');
  }

  function isCitationElement(el) {
    if (el.matches('source-footnote, cite, [data-testid="citation"], [data-testid*="citation"], [data-source-index], [data-turn-source-index]')) return true;
    if (el.matches('sup')) return /^\[?\d+\]?$/.test(cleanText(el.textContent)) || !!el.querySelector('a[href]');
    // Gemini's citation-N spans are highlights around ordinary answer text, not source badges.
    if (!el.matches('a, button, span, div, li')) return false;
    if (el.querySelector('p, pre, table, source-footnote, h1, h2, h3, h4, h5, h6')) return false;
    if (el.matches('.citation, .citation-link, .citation-pill, .grounding-link, .source-chip, .source-pill, [data-testid*="citation"], [data-testid*="source"]')) return true;
    if (/citation|参照元|引用元/i.test(el.getAttribute('aria-label') || '') && el.matches('a, button, span')) return true;

    // Anchor or container with a single anchor
    if (el.querySelectorAll('a[href]').length > 1) return false;
    const anchor = el.tagName === 'A' ? el : el.querySelector('a[href]');
    if (anchor) {
      const href = anchor.getAttribute('href');
      if (safeURL(href, el.baseURI)) {
        const text = cleanText(el.textContent);
        if (/^\[?\d+\]?$/.test(text)) return true;
        if (anchor.classList.contains('button-link') || el.classList.contains('button-link')) return true;
        const hasIcon = !!el.querySelector('img, svg, [class*="favicon"], [class*="icon"]');
        const imgAlt = cleanText(el.querySelector('img')?.getAttribute('alt') || el.querySelector('img')?.getAttribute('title'));
        if (hasIcon && (text.length > 0 || imgAlt.length > 0) && text.length <= 160) {
          return true;
        }
      }
    }
    return false;
  }

  function fromElement(el) {
    const anchor = el.matches('a[href]') ? el : el.querySelector('a[href]');
    let href = anchor?.getAttribute('href') || el.getAttribute('data-source-url') || el.getAttribute('data-url') || '';
    if (href.startsWith('#')) {
      // Resolve footnote anchors only within this answer; never borrow another answer's URL.
      const scope = el.closest('model-response, [data-message-author-role="assistant"], .agent-turn') || el.parentElement;
      let target;
      try { target = el.ownerDocument.getElementById(decodeURIComponent(href.slice(1))); } catch {}
      const linked = target?.matches('a[href]') ? target : target?.querySelector('a[href]');
      href = scope?.contains(target) ? linked?.getAttribute('href') || '' : '';
    }
    const url = safeURL(href, el.baseURI);
    const imgEl = el.querySelector('img');
    const imgAlt = cleanText(imgEl?.getAttribute('alt') || imgEl?.getAttribute('title'));
    const clone = el.cloneNode(true);
    clone.querySelectorAll('svg, img, button, [aria-hidden="true"], .sr-only, [role="tooltip"], .sublabel').forEach(node => node.remove());
    const titleNode = clone.querySelector('.source-title, .source-name, .title, .cgq-source-chip-title');
    const text = cleanText(titleNode?.textContent || clone.textContent);
    const title = cleanText(el.getAttribute('title') || anchor?.getAttribute('title') || text || imgAlt || el.getAttribute('aria-label'));
    const indexNode = el.matches('[data-turn-source-index], [data-source-index]') ? el : el.querySelector('[data-turn-source-index], [data-source-index]');
    const index = indexNode?.getAttribute('data-turn-source-index') ||
      (indexNode?.hasAttribute('data-source-index') ? String(Number(indexNode.getAttribute('data-source-index')) + 1) : '');
    const icon = safeURL(imgEl?.getAttribute('src') || imgEl?.src, el.baseURI);
    return { url, title: title || (index ? `参照 ${index}` : '参照'), icon };
  }

  function token(source) {
    return `\uE000CGQREF:${encodeURIComponent(JSON.stringify(source))}\uE001`;
  }

  function render(source = {}) {
    const url = safeURL(source.url);
    const domain = url ? new URL(url).hostname.replace(/^www\./, '') : '';
    const title = cleanText(source.title);
    const label = title && !/^\[?\d+\]?$|^(?:参照|引用|source|citation)(?:\s*\d+)?$/i.test(title) ? title : domain || title || '参照';
    const tooltip = url ? `${title && title !== domain ? title + '\n' : ''}${url}` : `${label}（引用先のリンク未取得）`;
    const favicon = url ? safeURL(source.icon) || new URL('/favicon.ico', url).href : '';
    const icon = `<span class="cgq-source-icon">${favicon ? `<img class="cgq-source-favicon" src="${escape(favicon)}" alt="" width="16" height="16" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : globe}</span>`;
    const content = `${icon}<span class="cgq-source-name">${escape(label)}</span>`;
    const attrs = `class="cgq-source-card${url ? '' : ' cgq-source-unresolved'}" title="${escape(tooltip)}"`;
    return url ? `<a ${attrs} href="${escape(url)}" target="_blank" rel="noopener noreferrer">${content}</a>` : `<span ${attrs}>${content}</span>`;
  }

  // Up to three source tiles are shown; the rest collapse into a "+N" tile whose tooltip lists them.
  const GROUP_VISIBLE = 3;
  function renderGroup(sources) {
    const seen = new Set();
    const unique = sources.filter(source => {
      const key = safeURL(source.url) || cleanText(source.title);
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    });
    const shown = unique.slice(0, GROUP_VISIBLE).map(render).join('');
    const hidden = unique.slice(GROUP_VISIBLE);
    const more = hidden.length
      ? `<span class="cgq-source-more" title="${escape(hidden.map(source => cleanText(source.title) || safeURL(source.url)).filter(Boolean).join('\n'))}">+${hidden.length}</span>`
      : '';
    return `<span class="cgq-sources-list" aria-label="参照元">${shown}${more}</span>`;
  }

  // Reports the widget's height to the dashboard, which sizes the frame to fit.
  const WIDGET_RESIZE = "<script>(function(){function s(){parent.postMessage({type:'cgq-widget-height',height:document.documentElement.scrollHeight},'*');}if(window.ResizeObserver)new ResizeObserver(s).observe(document.documentElement);window.addEventListener('load',s);})();</script>";
  const WIDGET_LIMIT = 400000;

  function widgetToken(frame) {
    let payload = null;
    const srcdoc = frame.getAttribute('srcdoc');
    if (srcdoc) payload = { html: srcdoc };
    else {
      try {
        const doc = frame.contentDocument;
        if (doc?.documentElement) payload = { html: '<!doctype html>' + doc.documentElement.outerHTML };
      } catch {}
    }
    if (!payload) {
      const src = safeURL(frame.getAttribute('src'), frame.baseURI);
      if (src) payload = { src };
    }
    const encoded = payload && encodeURIComponent(JSON.stringify(payload));
    if (!encoded || encoded.length > WIDGET_LIMIT) {
      return '\n\n（インタラクティブ表示：この画面では再現できません。ChatGPTタブで確認してください）\n\n';
    }
    return `\n\n\uE000CGQWIDGET:${encoded}\uE001\n\n`;
  }

  function renderWidget(payload) {
    let data;
    try { data = JSON.parse(decodeURIComponent(payload)); } catch { return ''; }
    if (typeof data.html === 'string') {
      const html = data.html.includes('</body>') ? data.html.replace('</body>', WIDGET_RESIZE + '</body>') : data.html + WIDGET_RESIZE;
      return `<iframe class="cgq-widget-frame" sandbox="allow-scripts" title="インタラクティブ表示" srcdoc="${escape(html)}"></iframe>`;
    }
    const src = safeURL(data.src);
    return src ? `<iframe class="cgq-widget-frame" sandbox="allow-scripts" title="インタラクティブ表示" src="${escape(src)}"></iframe>` : '';
  }

  function formatHTML(html, doc) {
    const template = doc.createElement('template');
    template.innerHTML = html;
    const root = template.content;
    // Upgrade cached answers produced by earlier versions as well as numeric Markdown links and icon links.
    root.querySelectorAll('a.cgq-citation-pill, a.cgq-source-chip, span.cgq-citation-pill, a.cgq-md-link, a').forEach(el => {
      if (el.closest('pre, code, .cgq-source-card')) return;
      const hasImg = !!el.querySelector('img, svg');
      const text = cleanText(el.textContent);
      const imgAlt = cleanText(el.querySelector('img')?.getAttribute('alt') || el.querySelector('img')?.getAttribute('title'));
      const isNumericLink = el.matches('a.cgq-md-link') && /^\[?\d+\]?$/.test(text);
      const isLegacy = el.matches('.cgq-citation-pill, .cgq-source-chip');
      const isButtonLink = el.classList.contains('button-link');
      const isIconLink = hasImg && (text.length > 0 || imgAlt.length > 0 || !!el.getAttribute('title')) && text.length <= 160;

      if (el.tagName === 'A' && !isLegacy && !isButtonLink && !isNumericLink && !isIconLink) {
        return;
      }
      if (el.tagName === 'SPAN' && !el.getAttribute('title') && text.length > 32) {
        el.replaceWith(doc.createTextNode(el.textContent)); return;
      }
      const replacement = doc.createElement('template');
      replacement.innerHTML = render(fromElement(el));
      el.replaceWith(replacement.content);
    });

    // Merge standalone/block <img> followed by an adjacent <a> into a single .cgq-source-card
    // ONLY when the parent has no other text besides the image, and next has no other text besides the link
    root.querySelectorAll('img').forEach(img => {
      if (img.closest('.cgq-source-card, pre, code')) return;
      const parent = img.closest('p, div') || img;
      const next = parent.nextElementSibling;
      const nextAnchor = next?.matches('a[href]') ? next : (next?.childElementCount === 1 ? next?.querySelector('a[href]') : null);
      if (nextAnchor && !nextAnchor.closest('pre, code')) {
        const src = img.getAttribute('src') || '';
        const alt = cleanText(img.getAttribute('alt') || img.getAttribute('title'));
        const href = nextAnchor.getAttribute('href') || '';
        const text = cleanText(nextAnchor.textContent);
        const parentText = cleanText(parent.textContent);
        const nextText = cleanText(next.textContent);
        const nextIsOnlyAnchor = nextText === text;
        const parentIsOnlyImg = !parentText || parentText === alt;

        if (parentIsOnlyImg && nextIsOnlyAnchor && href && safeURL(href, nextAnchor.baseURI)) {
          let isMatch = (alt && text && (alt.includes(text) || text.includes(alt)));
          if (!isMatch && src && href) {
            try {
              const u1 = new URL(src, 'https://example.com');
              const u2 = new URL(href, 'https://example.com');
              if (u1.hostname === u2.hostname) isMatch = true;
            } catch (e) {}
          }
          const isIconSrc = src.includes('favicon') || src.includes('s2/favicons') || (img.naturalWidth && img.naturalWidth <= 48);
          if (isMatch || isIconSrc || (text.length > 0 && text.length <= 80 && !alt)) {
            const cardHtml = render({
              url: href,
              title: text || alt || '参照',
              icon: src
            });
            const rep = doc.createElement('template');
            rep.innerHTML = cardHtml;
            parent.replaceWith(rep.content);
            next.remove();
          }
        }
      }
    });

    // Remove redundant duplicate text links immediately following a .cgq-source-card with the same href
    root.querySelectorAll('a.cgq-source-card').forEach(card => {
      const next = card.nextElementSibling || card.closest('p')?.nextElementSibling;
      const nextAnchor = next?.matches('a[href]') ? next : next?.querySelector('a[href]');
      if (nextAnchor && !nextAnchor.classList.contains('cgq-source-card')) {
        const cardHref = card.getAttribute('href');
        const nextHref = nextAnchor.getAttribute('href');
        if (cardHref && nextHref && cardHref === nextHref) {
          // Only remove next if it only contains the link text itself, preserving any surrounding prose
          if (next === nextAnchor || cleanText(next.textContent) === cleanText(nextAnchor.textContent)) {
            next.remove();
          } else {
            nextAnchor.remove();
          }
        }
      }
    });
    root.querySelectorAll('.cgq-sources-header').forEach(el => el.remove());
    root.querySelectorAll('.cgq-sources-list').forEach(list => {
      const seen = new Set();
      list.querySelectorAll('a.cgq-source-card').forEach(el => {
        if (seen.has(el.href)) el.remove(); else seen.add(el.href);
      });
    });
    const walker = doc.createTreeWalker(root, doc.defaultView.NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    texts.forEach(node => {
      if (node.parentElement?.closest('pre, code, a, .cgq-source-card')) return;
      const value = node.textContent;
      tokenPattern.lastIndex = 0;
      if (!tokenPattern.test(value)) return;
      tokenPattern.lastIndex = 0;
      let start = 0;
      let output = '';
      for (const match of value.matchAll(tokenPattern)) {
        output += escape(value.slice(start, match.index));
        if (match[1]) {
          try {
            const source = JSON.parse(decodeURIComponent(match[1]));
            output += Array.isArray(source.sources) ? renderGroup(source.sources) : render(source);
          } catch { output += escape(match[0]); }
        } else if (match[3]) {
          output += renderWidget(match[3]);
        } else {
          const raw = cleanText(match[2]);
          output += render({ url: /^https?:\/\//i.test(raw) ? safeURL(raw) : '', title: raw && raw !== 'source' ? raw : '参照' });
        }
        start = match.index + match[0].length;
      }
      output += escape(value.slice(start));
      const replacement = doc.createElement('template');
      replacement.innerHTML = output;
      node.replaceWith(replacement.content);
    });
    return template.innerHTML;
  }

  function bindIcons(container) {
    container.querySelectorAll('img.cgq-source-favicon').forEach(img => {
      // A failed favicon falls back to the generic globe icon inside the same tile.
      const fallback = () => { if (img.parentElement) img.parentElement.innerHTML = globe; };
      img.addEventListener('error', fallback, { once: true });
      if (img.complete && !img.naturalWidth) fallback();
    });
  }

  function plainText(text) {
    const label = source => {
      const url = safeURL(source?.url);
      const title = cleanText(source?.title) || (url ? new URL(url).hostname : '参照');
      return url ? `${title} (${url})` : title;
    };
    return String(text || '').replace(tokenPattern, (match, payload, raw, widget) => {
      if (widget) return '（インタラクティブ表示）';
      if (!payload) return raw || '参照';
      try {
        const source = JSON.parse(decodeURIComponent(payload));
        return Array.isArray(source.sources) ? source.sources.map(label).join(' / ') : label(source);
      } catch { return '参照'; }
    });
  }

  const api = { safeURL, isCitationElement, isSourcesContainer, fromElement, token, render, renderGroup, widgetToken, formatHTML, bindIcons, plainText };
  globalThis.CGQReferences = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
