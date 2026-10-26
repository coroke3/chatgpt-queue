/**
 * ChatGPT Queue Assistant - Background Service Worker
 */

console.log('[ChatGPT Queue Assistant] Service Worker initialized successfully.');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
