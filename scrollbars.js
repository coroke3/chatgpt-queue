// Overlay thumbs keep the native scroll containers and their keyboard/wheel behavior.
// Only the dashboard opts in; ChatGPT and Gemini's own scrollbars are untouched.
document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('cgq-overlay-scrollbars');
  let active = null, drag = null, frame = 0, hideTimer;
  const bars = ['y', 'x'].map(axis => {
    const track = document.createElement('div');
    track.className = `cgq-overlay-scrollbar cgq-overlay-scrollbar-${axis}`;
    track.setAttribute('aria-hidden', 'true');
    const thumb = document.createElement('div');
    thumb.className = 'cgq-overlay-scrollbar-thumb';
    track.append(thumb);
    document.body.append(track);
    const bar = { axis, track, thumb, range: 0, travel: 0 };
    thumb.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !active || !bar.travel) return;
      event.preventDefault();
      drag = { bar, target: active, start: axis === 'y' ? event.clientY : event.clientX,
        offset: axis === 'y' ? active.scrollTop : active.scrollLeft };
      thumb.setPointerCapture?.(event.pointerId);
      clearTimeout(hideTimer);
    });
    thumb.addEventListener('pointermove', event => {
      if (!drag || drag.bar !== bar) return;
      const delta = (axis === 'y' ? event.clientY : event.clientX) - drag.start;
      drag.target[axis === 'y' ? 'scrollTop' : 'scrollLeft'] = drag.offset + delta * bar.range / bar.travel;
      draw();
    });
    const release = () => { if (drag?.bar === bar) { drag = null; show(); } };
    thumb.addEventListener('pointerup', release);
    thumb.addEventListener('pointercancel', release);
    thumb.addEventListener('lostpointercapture', release);
    return bar;
  });

  function draw() {
    frame = 0;
    if (!active?.isConnected) { bars.forEach(bar => bar.track.hidden = true); return; }
    const rect = active.getBoundingClientRect();
    const style = getComputedStyle(active);
    for (const bar of bars) {
      const vertical = bar.axis === 'y';
      const viewport = vertical ? active.clientHeight : active.clientWidth;
      const total = vertical ? active.scrollHeight : active.scrollWidth;
      const overflow = vertical ? style.overflowY : style.overflowX;
      bar.track.hidden = !viewport || total <= viewport + 1 || !/^(auto|scroll|overlay)$/.test(overflow);
      if (bar.track.hidden) continue;
      const extent = Math.max(0, viewport - 4);
      const size = Math.min(extent, Math.max(24, extent * viewport / total));
      bar.range = total - viewport;
      bar.travel = extent - size;
      const offset = Math.max(0, Math.min(bar.range, vertical ? active.scrollTop : active.scrollLeft));
      Object.assign(bar.track.style, vertical ? {
        left: `${rect.left + active.clientLeft + active.clientWidth - 10}px`,
        top: `${rect.top + active.clientTop + 2}px`, height: `${extent}px`
      } : {
        left: `${rect.left + active.clientLeft + 2}px`,
        top: `${rect.top + active.clientTop + active.clientHeight - 10}px`, width: `${extent}px`
      });
      bar.thumb.style[vertical ? 'height' : 'width'] = `${size}px`;
      bar.thumb.style.transform = `${vertical ? 'translateY' : 'translateX'}(${offset / bar.range * bar.travel}px)`;
    }
  }

  function show() {
    bars.forEach(bar => bar.track.classList.add('is-visible'));
    if (!frame) frame = requestAnimationFrame(draw);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!drag) bars.forEach(bar => bar.track.classList.remove('is-visible'));
    }, 1200);
  }

  document.addEventListener('pointerover', event => {
    if (drag || event.target.closest?.('.cgq-overlay-scrollbar')) return;
    for (let node = event.target; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if ((node.scrollHeight > node.clientHeight + 1 && /^(auto|scroll|overlay)$/.test(style.overflowY)) ||
          (node.scrollWidth > node.clientWidth + 1 && /^(auto|scroll|overlay)$/.test(style.overflowX))) {
        active = node; show(); return;
      }
    }
  }, { passive: true });
  document.addEventListener('scroll', event => {
    if (drag) { show(); return; }
    const node = event.target;
    if (node instanceof Element) { active = node; show(); }
  }, { capture: true, passive: true });
  window.addEventListener('resize', () => { if (active) show(); });
  window.addEventListener('blur', () => {
    drag = null;
    bars.forEach(bar => bar.track.classList.remove('is-visible'));
  });
});
