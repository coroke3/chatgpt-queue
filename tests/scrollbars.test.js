const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

test('overlay thumbs follow vertical and horizontal scrolling and support dragging without canceling wheel input', async t => {
  const dom = new JSDOM('<!doctype html><body><div id="scroller" style="overflow-x:auto;overflow-y:auto"><p>Conversation</p></div></body>', {
    runScripts: 'outside-only', pretendToBeVisual: true
  });
  const { window } = dom; t.after(() => window.close());
  await new Promise(resolve => setImmediate(resolve));
  const frames = [];
  window.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  const scroller = window.document.getElementById('scroller');
  for (const [key, value] of Object.entries({ clientWidth: 100, clientHeight: 100, scrollWidth: 500, scrollHeight: 500 })) {
    Object.defineProperty(scroller, key, { value });
  }
  scroller.getBoundingClientRect = () => ({ left: 20, top: 40, width: 100, height: 100 });
  window.eval(fs.readFileSync(path.join(__dirname, '../scrollbars.js'), 'utf8'));
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  assert.ok(window.document.documentElement.classList.contains('cgq-overlay-scrollbars'));
  scroller.querySelector('p').dispatchEvent(new window.MouseEvent('pointerover', { bubbles: true }));
  frames.splice(0).forEach(callback => callback());
  const vertical = window.document.querySelector('.cgq-overlay-scrollbar-y');
  const horizontal = window.document.querySelector('.cgq-overlay-scrollbar-x');
  assert.equal(vertical.hidden, false); assert.equal(horizontal.hidden, false);
  assert.equal(vertical.style.left, '110px');
  assert.equal(vertical.style.height, '96px');
  for (const [track, axis, scroll] of [[vertical, 'clientY', 'scrollTop'], [horizontal, 'clientX', 'scrollLeft']]) {
    const thumb = track.firstElementChild;
    thumb.dispatchEvent(new window.MouseEvent('pointerdown', { button: 0, [axis]: 0 }));
    thumb.dispatchEvent(new window.MouseEvent('pointermove', { [axis]: 36 }));
    assert.equal(scroller[scroll], 200);
    assert.match(thumb.style.transform, /\(36px\)/);
    thumb.dispatchEvent(new window.MouseEvent('pointerup'));
  }
  const wheel = new window.WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
  scroller.dispatchEvent(wheel);
  assert.equal(wheel.defaultPrevented, false);
  window.dispatchEvent(new window.Event('blur'));
  assert.equal(vertical.classList.contains('is-visible'), false);
});
