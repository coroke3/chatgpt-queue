/**
 * ChatGPT Queue Assistant - Background Service Worker
 */

console.log('[ChatGPT Queue Assistant] Service Worker initialized successfully.');

// Browser-owned session storage survives page reloads, site storage resets and worker restarts.
let contextWrite = Promise.resolve();
const serializeContext = operation => {
  const pending = contextWrite.then(operation);
  contextWrite = pending.catch(() => {});
  return pending;
};
const platformOf = url => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.hostname === 'gemini.google.com') return 'gemini';
    if (['chatgpt.com', 'chat.openai.com'].includes(parsed.hostname)) return 'chatgpt';
  } catch {}
  return null;
};

chrome.tabs?.onRemoved?.addListener(tabId => {
  serializeContext(async () => {
    const stored = await chrome.storage.session.get('cgq_tab_contexts');
    const contexts = stored.cgq_tab_contexts || {};
    for (const key of Object.keys(contexts)) if (key.startsWith(`${tabId}:`)) delete contexts[key];
    await chrome.storage.session.set({ cgq_tab_contexts: contexts });
  }).catch(error => console.warn('[ChatGPT Queue] Tab context cleanup failed:', error));
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'GET_QUEUE_CONTEXT') {
    const platform = platformOf(sender.tab?.url);
    if (!platform || !Number.isInteger(sender.tab?.id)) {
      sendResponse({ success: false });
      return false;
    }
    serializeContext(async () => {
      const stored = await chrome.storage.session.get('cgq_tab_contexts');
      const contexts = stored.cgq_tab_contexts || {};
      const key = `${sender.tab.id}:${platform}`;
      if (!contexts[key]) {
        const proposed = request.sessionTabId;
        const unused = typeof proposed === 'string' && /^tab_[a-z0-9_]{1,160}$/i.test(proposed) &&
          !Object.values(contexts).includes(proposed);
        contexts[key] = unused ? proposed : `tab_${sender.tab.id}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
        await chrome.storage.session.set({ cgq_tab_contexts: contexts });
      }
      return { success: true, chromeTabId: sender.tab.id, sessionTabId: contexts[key] };
    }).then(sendResponse, error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (request.action === 'QUEUE_WAIT') {
    // A bounded response keeps the worker alive for this wait. No tabs.update,
    // focus, visibility spoofing, or access to service APIs is needed.
    const allowed = sender.tab?.url && /^https:\/\/(?:gemini\.google\.com|chatgpt\.com|chat\.openai\.com)\//.test(sender.tab.url);
    if (!allowed || !Number.isInteger(request.delay) || request.delay < 0 || request.delay > 10000) {
      sendResponse({ success: false });
      return false;
    }
    setTimeout(() => sendResponse({ success: true, waited: request.delay }), request.delay);
    return true;
  }

  // Return the sender's chrome tab ID
  if (request.action === 'GET_MY_CHROME_TAB_ID') {
    sendResponse({ chromeTabId: sender.tab ? sender.tab.id : null });
    return true;
  }

  // Open or focus the management dashboard
  if (request.action === 'OPEN_DASHBOARD') {
    const dashboardUrl = chrome.runtime.getURL('dashboard.html');
    chrome.tabs.query({}, (tabs) => {
      if (chrome.runtime.lastError) {
        chrome.tabs.create({ url: dashboardUrl });
        return;
      }
      const existing = (tabs || []).find(t => t.url && t.url.startsWith(dashboardUrl));
      if (existing) {
        chrome.tabs.update(existing.id, { active: true }, () => {
          if (chrome.runtime.lastError) {}
        });
        if (existing.windowId) {
          chrome.windows.update(existing.windowId, { focused: true }, () => {
            if (chrome.runtime.lastError) {}
          });
        }
      } else {
        chrome.tabs.create({ url: dashboardUrl });
      }
    });
    sendResponse({ success: true });
    return true;
  }

  // Focus a specific ChatGPT tab
  if (request.action === 'FOCUS_TAB') {
    if (request.chromeTabId) {
      chrome.tabs.update(request.chromeTabId, { active: true }, () => {
        if (chrome.runtime.lastError) {}
      });
      chrome.tabs.get(request.chromeTabId, (tab) => {
        if (chrome.runtime.lastError) return;
        if (tab && tab.windowId) {
          chrome.windows.update(tab.windowId, { focused: true }, () => {
            if (chrome.runtime.lastError) {}
          });
        }
      });
    }
    sendResponse({ success: true });
    return true;
  }

  // Close a ChatGPT / Gemini tab chosen in the Queue Manager sidebar
  if (request.action === 'CLOSE_CHAT_TAB') {
    if (request.chromeTabId) {
      chrome.tabs.remove(request.chromeTabId, () => {
        if (chrome.runtime.lastError) {}
      });
    }
    sendResponse({ success: true });
    return true;
  }

  // Reload a specific ChatGPT / Gemini tab
  if (request.action === 'RELOAD_CHAT_TAB' || request.action === 'RELOAD_TAB') {
    if (request.chromeTabId) {
      chrome.tabs.reload(request.chromeTabId, () => {
        if (chrome.runtime.lastError) {}
      });
    }
    sendResponse({ success: true });
    return true;
  }

  // Create a new ChatGPT or Gemini tab
  if (request.action === 'CREATE_CHATGPT_TAB' || request.action === 'CREATE_GEMINI_TAB' || request.action === 'CREATE_NEW_CHAT_TAB') {
    const platform = request.platform || (request.action === 'CREATE_GEMINI_TAB' ? 'gemini' : 'chatgpt');
    const model = request.model;
    let url = platform === 'gemini' ? 'https://gemini.google.com/app' : 'https://chatgpt.com/';
    if (platform === 'chatgpt' && model && model !== 'auto') {
      url += `?model=${encodeURIComponent(model)}`;
    }
    chrome.tabs.create({ url }, () => {
      if (chrome.runtime.lastError) {}
    });
    sendResponse({ success: true });
    return true;
  }
});
