// Faithful copies of rich answers for the Queue Manager.
//
// ChatGPT answers can hold far more than Markdown can say (rows, grids, cards, carousels, charts,
// maps, inputs, sliders, date pickers …; measured 2026-10: 40 kinds of data-d-component in one test
// chat), and Gemini answers embed Google Maps and place cards. Instead of re-implementing each one,
// a snapshot copies the rendered DOM with the computed styles that decide its look, deduplicated into
// classes, so the Queue Manager can show it exactly as the page does (inside a shadow root).
// Interactive elements are tagged with their path so a click or a value in the Queue Manager can be
// replayed on the page; the next snapshot then shows the result.
(function (global) {
  'use strict';

  // Properties that decide how an element looks. Inherited ones are written only where they change.
  const INHERITED = ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
    'letter-spacing', 'text-align', 'text-transform', 'white-space', 'word-break', 'overflow-wrap',
    'list-style-type', 'list-style-position', 'visibility', 'cursor', 'font-variant-numeric', 'text-indent'];
  const OWN = {
    display: null, position: 'static', top: 'auto', right: 'auto', bottom: 'auto', left: 'auto', 'z-index': 'auto',
    'flex-direction': 'row', 'flex-wrap': 'nowrap', 'justify-content': 'normal', 'align-items': 'normal',
    'align-self': 'auto', 'align-content': 'normal', 'justify-items': 'normal', 'justify-self': 'auto',
    'row-gap': 'normal', 'column-gap': 'normal',
    'flex-grow': '0', 'flex-shrink': '1', 'flex-basis': 'auto', order: '0',
    'grid-template-columns': 'none', 'grid-template-rows': 'none', 'grid-column-start': 'auto', 'grid-column-end': 'auto',
    'grid-row-start': 'auto', 'grid-row-end': 'auto', 'grid-auto-flow': 'row', 'grid-auto-columns': 'auto',
    'padding-top': '0px', 'padding-right': '0px', 'padding-bottom': '0px', 'padding-left': '0px',
    'margin-top': '0px', 'margin-right': '0px', 'margin-bottom': '0px', 'margin-left': '0px',
    'border-top-width': '0px', 'border-right-width': '0px', 'border-bottom-width': '0px', 'border-left-width': '0px',
    'border-top-style': 'none', 'border-right-style': 'none', 'border-bottom-style': 'none', 'border-left-style': 'none',
    'border-top-color': null, 'border-right-color': null, 'border-bottom-color': null, 'border-left-color': null,
    'border-top-left-radius': '0px', 'border-top-right-radius': '0px', 'border-bottom-left-radius': '0px', 'border-bottom-right-radius': '0px',
    'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none', 'background-size': 'auto',
    'background-position': '0% 0%', 'background-repeat': 'repeat',
    'box-shadow': 'none', opacity: '1', 'overflow-x': 'visible', 'overflow-y': 'visible',
    'text-decoration-line': 'none', 'text-decoration-style': 'solid', 'text-decoration-color': null,
    'text-underline-offset': 'auto', 'vertical-align': 'baseline', 'object-fit': 'fill', 'object-position': '50% 50%',
    'aspect-ratio': 'auto', transform: 'none', 'border-collapse': 'separate', 'border-spacing': '0px 0px',
    'table-layout': 'auto', 'scroll-snap-type': 'none', 'scroll-snap-align': 'none', 'box-sizing': 'content-box',
    'text-overflow': 'clip', '-webkit-line-clamp': 'none', '-webkit-box-orient': 'horizontal',
    'max-width': 'none', 'min-width': 'auto', 'max-height': 'none', 'min-height': 'auto', 'fill': null, 'stroke': null
  };
  // Sizes are copied only where the page fixes them; everything else flows in the narrower Queue Manager.
  const SIZED = 'img, svg, canvas, video, picture, iframe, input, textarea, select, [data-d-has-width], [data-d-has-height]';
  const DROP = 'script, style, noscript, template, link, meta, button[aria-label*="コピー"], [data-testid*="copy"], ' +
    '.katex-html, [id^="cgq-"], [class*="cgq-"], gmp-internal-camera-control, thinking-overlay, ' +
    'sensitive-memories-banner, freemium-rag-disclaimer, election-info-disclaimer, finance-info-disclaimer';
  const ATTRS = new Set(['href', 'src', 'srcset', 'alt', 'title', 'colspan', 'rowspan', 'type', 'value', 'placeholder',
    'checked', 'selected', 'disabled', 'readonly', 'min', 'max', 'step', 'role', 'aria-label', 'aria-checked',
    'aria-pressed', 'aria-selected', 'aria-expanded', 'aria-valuenow', 'aria-valuemin', 'aria-valuemax', 'open',
    'viewBox', 'd', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'points',
    'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'transform', 'opacity',
    'fill-opacity', 'stroke-opacity', 'fill-rule', 'clip-rule', 'text-anchor', 'dominant-baseline', 'font-size',
    'font-weight', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'preserveAspectRatio',
    'xmlns', 'id', 'clip-path', 'mask', 'marker-end', 'marker-start', 'dx', 'dy', 'lang', 'dir', 'display',
    'mathvariant', 'encoding', 'stretchy', 'fence', 'separator', 'lspace', 'rspace', 'accent', 'columnalign']);
  const INTERACTIVE = 'button, a, input, textarea, select, summary, label, [role="button"], [role="checkbox"], ' +
    '[role="radio"], [role="switch"], [role="tab"], [role="option"], [role="menuitem"], [role="slider"], ' +
    '[data-d-component="pressable"], [data-d-component="popover-trigger"]';

  const escapeAttr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const escapeText = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // "240px 240px 240px" from a computed grid becomes equal fractions, so the grid still fits a narrow card.
  const fluidTracks = value => {
    const parts = value.split(/\s+(?![^(]*\))/);
    if (!parts.length || !parts.every(p => /^[\d.]+px$/.test(p))) return value;
    const sizes = parts.map(parseFloat);
    const total = sizes.reduce((a, b) => a + b, 0) || 1;
    return sizes.map(s => `minmax(0, ${Math.max(0.01, (s / total) * parts.length).toFixed(3)}fr)`).join(' ');
  };

  // Icons use <use href="/cdn/assets/icons-….svg#id">; a cross-origin page cannot load that sprite,
  // so the symbols are fetched here (same origin) and copied into each icon.
  const sprites = new Map(); // url -> Document | 'loading' | 'failed'
  function loadSprite(url) {
    if (sprites.has(url)) return;
    sprites.set(url, 'loading');
    fetch(url, { credentials: 'same-origin' }).then(r => r.ok ? r.text() : Promise.reject(r.status))
      .then(text => sprites.set(url, new DOMParser().parseFromString(text, 'image/svg+xml')))
      .catch(() => sprites.set(url, 'failed'));
  }
  function symbolFor(href) {
    const [file, id] = String(href || '').split('#');
    if (!id) return null;
    if (!file) return document.getElementById(id);
    const url = new URL(file, location.href).href;
    const doc = sprites.get(url);
    if (!doc) { loadSprite(url); return undefined; }
    if (typeof doc === 'string') return doc === 'loading' ? undefined : null;
    return doc.getElementById(id);
  }

  // Google Maps inside an answer (Gemini, measured 2026-10: a canvas map with a 「マップで開く」 link
  // to /maps/dir/… or maps?ll=…) becomes Google's own embeddable, interactive map.
  function mapEmbedUrl(container) {
    const link = Array.from(container.querySelectorAll('a[href*="google.com/maps"], a[href*="maps.google."]'))
      .map(a => a.href).find(Boolean);
    if (!link) return null;
    try {
      const url = new URL(link);
      const dir = url.pathname.match(/\/maps\/dir\/([^/]+)\/([^/@]+)/);
      if (dir) return `https://maps.google.com/maps?saddr=${dir[1]}&daddr=${dir[2]}&output=embed`;
      const place = url.pathname.match(/\/maps\/(?:place|search)\/([^/@]+)/);
      if (place) return `https://maps.google.com/maps?q=${place[1]}&output=embed`;
      const ll = url.searchParams.get('ll') || url.searchParams.get('q');
      if (ll) return `https://maps.google.com/maps?q=${encodeURIComponent(ll)}&z=${url.searchParams.get('z') || 12}&output=embed`;
    } catch { /* not a URL */ }
    return null;
  }
  const isMapCanvasBox = el => el.tagName === 'DIV' && el.querySelector('canvas') &&
    (el.querySelector('gmp-internal-camera-control, [aria-label*="地図"], [aria-label*="Map" i], [class*="gm-"]') ||
      /Google|地図データ|Map data/.test(el.textContent || '')) && el.getBoundingClientRect().height > 120;

  // A chart or map canvas as a compact picture (at most 900px wide, WebP).
  function canvasImage(canvas) {
    try {
      const scale = Math.min(1, 900 / (canvas.width || 1));
      if (scale >= 1) return canvas.toDataURL('image/webp', 0.85);
      const copy = document.createElement('canvas');
      copy.width = Math.round(canvas.width * scale);
      copy.height = Math.round(canvas.height * scale);
      copy.getContext('2d').drawImage(canvas, 0, 0, copy.width, copy.height);
      return copy.toDataURL('image/webp', 0.85);
    } catch {
      return 'data:,'; // a tainted canvas cannot be copied
    }
  }

  function snapshot(root, options = {}) {
    const prefix = options.prefix || 's';
    const base = options.path || '0';
    if (!root) return null;
    const classes = new Map(); // style text -> class name
    const rootStyle = getComputedStyle(root);
    let pending = false;
    let count = 0;
    const viewBoxes = new Map(); // <svg> whose icon symbol brings the viewBox

    const styleText = (el, cs, parentCs, isRoot) => {
      const out = [];
      for (const prop of INHERITED) {
        const v = cs.getPropertyValue(prop);
        if (v && (isRoot || v !== parentCs.getPropertyValue(prop))) out.push(`${prop}:${v}`);
      }
      const sized = el.matches(SIZED);
      for (const prop in OWN) {
        let v = cs.getPropertyValue(prop);
        if (!v || v === OWN[prop]) continue;
        // Tailwind's reset gives every element a solid 0px border: only real borders are copied.
        if (prop.startsWith('border-') && /-(color|style)$/.test(prop) && !parseFloat(cs.getPropertyValue(prop.replace(/(color|style)$/, 'width')))) continue;
        if (prop === 'box-sizing' || prop === 'border-spacing' && /^0px( 0px)?$/.test(v)) continue; // the shadow root's base rule sets border-box
        if (prop === 'text-decoration-color' && cs.getPropertyValue('text-decoration-line') === 'none') continue;
        if ((prop === 'fill' || prop === 'stroke') && !(el instanceof SVGElement)) continue;
        if (prop.startsWith('grid-template')) v = fluidTracks(v);
        if (/^(top|right|bottom|left)$/.test(prop) && cs.position === 'static') continue;
        out.push(`${prop}:${v}`);
      }
      if (cs.boxSizing === 'content-box' && !isRoot) out.push('box-sizing:content-box');
      if (sized) {
        const w = cs.width, h = cs.height;
        if (w && w !== 'auto') out.push(`width:${w}`);
        if (h && h !== 'auto' && !(el.tagName === 'IMG' && cs.objectFit === 'fill')) out.push(`height:${h}`);
        if (el.tagName === 'IMG' && cs.objectFit === 'fill') out.push('height:auto');
      }
      return out.join(';');
    };

    const classFor = text => {
      if (!text) return '';
      let name = classes.get(text);
      if (!name) { name = `${prefix}${classes.size}`; classes.set(text, name); }
      return name;
    };

    const attrsOf = (el, extra) => {
      let out = '';
      for (const a of el.attributes) {
        if (!ATTRS.has(a.name) && !a.name.startsWith('data-d-')) continue;
        if (a.name === 'id' && !(el instanceof SVGElement)) continue;
        let v = a.value;
        if ((a.name === 'href' || a.name === 'src') && !/^(data:|https?:|#|mailto:)/.test(v)) {
          try { v = new URL(v, location.href).href; } catch { continue; }
        }
        if (/^javascript:/i.test(v)) continue;
        out += ` ${a.name}="${escapeAttr(v)}"`;
      }
      if (el.tagName === 'IMG' && el.currentSrc && !el.getAttribute('src')?.startsWith('data:')) out = out.replace(/ src="[^"]*"/, '') + ` src="${escapeAttr(el.currentSrc)}"`;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') out += ` value="${escapeAttr(el.value)}"`;
      if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio') && el.checked) out += ' checked';
      return out + extra;
    };

    const walk = (el, parentCs, path, isRoot) => {
      if (++count > 20000) return '';
      if (el.nodeType === Node.TEXT_NODE) return escapeText(el.nodeValue);
      if (el.nodeType !== Node.ELEMENT_NODE) return '';
      if (!isRoot && el.matches(DROP)) return '';
      // KaTeX: keep the MathML twin (rendered natively) instead of HTML that needs KaTeX's fonts.
      if (el.classList?.contains('katex')) {
        const math = el.querySelector('math');
        if (math) return math.outerHTML.replace(/<annotation[\s\S]*?<\/annotation>/g, '');
      }
      const cs = getComputedStyle(el);
      if (cs.display === 'none') return '';
      if (options.map !== false && isMapCanvasBox(el)) {
        const embed = mapEmbedUrl(el.closest('model-response, [class*="MarkdownRoot"], [data-turn-key]') || root);
        const h = Math.round(el.getBoundingClientRect().height) || 300;
        if (embed) return `<iframe class="${classFor(`display:block;width:100%;height:${h}px;border:0;border-radius:${cs.borderTopLeftRadius}`)}" src="${escapeAttr(embed)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" data-cgq-map=""></iframe>`;
      }
      const tag = el.tagName.toLowerCase();
      const act = !isRoot && el.matches(INTERACTIVE) ? ` data-cgq-act="${path}"` : '';
      const cls = classFor(styleText(el, cs, parentCs, isRoot));
      const clsAttr = cls ? ` class="${cls}"` : '';
      if (tag === 'canvas') {
        return `<img${clsAttr} src="${canvasImage(el)}" alt=""${act}>`;
      }
      if (tag === 'use') {
        const symbol = symbolFor(el.getAttribute('href') || el.getAttribute('xlink:href'));
        if (symbol === undefined) { pending = true; return ''; }
        if (!symbol) return '';
        const vb = symbol.getAttribute('viewBox');
        const svg = el.ownerSVGElement;
        if (vb && svg && !svg.getAttribute('viewBox')) viewBoxes.set(svg, vb);
        return symbol.innerHTML;
      }
      let inner = '';
      let index = 0;
      for (const child of el.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) inner += walk(child, cs, `${path}.${index++}`, false);
        else inner += walk(child, cs, path, false);
      }
      if (tag === 'svg') {
        const vb = viewBoxes.get(el);
        const extra = vb && !el.getAttribute('viewBox') ? ` viewBox="${escapeAttr(vb)}"` : '';
        return `<svg xmlns="http://www.w3.org/2000/svg"${clsAttr}${attrsOf(el, extra + act)}>${inner}</svg>`;
      }
      if (tag === 'textarea') return `<textarea${clsAttr}${attrsOf(el, act)}>${escapeText(el.value)}</textarea>`;
      if (/^(img|input|br|hr|source|wbr|area|col|embed)$/.test(tag)) return `<${tag}${clsAttr}${attrsOf(el, act)}>`;
      const safeTag = /^[a-z][a-z0-9-]*$/.test(tag) ? (tag.includes('-') ? 'div' : tag) : 'div';
      return `<${safeTag}${clsAttr}${attrsOf(el, act)}>${inner}</${safeTag}>`;
    };

    const parentCs = root.parentElement ? getComputedStyle(root.parentElement) : rootStyle;
    const html = walk(root, parentCs, base, true);
    const css = Array.from(classes, ([text, name]) => `.${name}{${text}}`).join('\n');
    return { html, css, pending, size: html.length + css.length };
  }

  // The element at a snapshot path ("0.3.1" = root, its 4th child element, that one's 2nd …).
  function resolve(root, path) {
    let el = root;
    for (const step of String(path).split('.').slice(1)) {
      el = el?.children[Number(step)];
      if (!el) return null;
    }
    return el;
  }

  // Replay a Queue Manager action on the page element.
  function act(el, action) {
    if (!el) return false;
    if (action.kind === 'value' && ('value' in el)) {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, action.value); else el.value = action.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (el.matches('[aria-haspopup="menu"], [aria-haspopup="listbox"]')) {
      // Radix menus and selects open on pointerdown, not on click.
      const Pointer = global.PointerEvent || MouseEvent;
      el.dispatchEvent(new Pointer('pointerdown', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', view: global }));
      el.dispatchEvent(new Pointer('pointerup', { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', view: global }));
      return true;
    }
    el.click();
    return true;
  }

  global.CGQSnapshot = { snapshot, resolve, act, mapEmbedUrl };
})(typeof window !== 'undefined' ? window : globalThis);
