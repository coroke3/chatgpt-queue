// Page timers can be throttled heavily in a hidden tab. Queue waits use the
// extension worker instead, without activating the tab or changing visibility.
(() => {
  const localWait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = ms => {
    const delay = Math.max(0, Math.ceil(Number(ms) || 0));
    if (!document.hidden || delay > 10000 || !globalThis.chrome?.runtime?.sendMessage) return localWait(delay);
    return new Promise(resolve => {
      let finished = false;
      const done = response => {
        if (finished) return;
        finished = true;
        const failed = chrome.runtime.lastError || !response?.success || response.waited !== delay;
        if (failed) localWait(delay).then(resolve);
        else resolve();
      };
      try {
        chrome.runtime.sendMessage({ action: 'QUEUE_WAIT', delay }, done);
      } catch (error) {
        done(null);
      }
    });
  };
  globalThis.CGQQueueTiming = { wait };
})();
