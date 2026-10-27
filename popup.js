document.addEventListener('DOMContentLoaded', async () => {
  const countBadge = document.getElementById('queue-count');
  const statItems = document.getElementById('stat-items');
  const popupInput = document.getElementById('popup-input');
  const btnAdd = document.getElementById('btn-add');
  const btnOpenChatGPT = document.getElementById('btn-open-chatgpt');
  const btnOpenGemini = document.getElementById('btn-open-gemini');
  const btnOpenDashboard = document.getElementById('btn-open-dashboard');

  let activeTabId = null;

  async function updateFromTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const isChatGPT = tab && tab.url && (tab.url.includes('chatgpt.com') || tab.url.includes('chat.openai.com'));
      const isGemini = tab && tab.url && tab.url.includes('gemini.google.com');

      if (!tab || !tab.id || !tab.url || (!isChatGPT && !isGemini)) {
        if (statItems) statItems.textContent = '対象外のタブ';
        if (countBadge) countBadge.textContent = '0';
        if (popupInput) {
          popupInput.disabled = true;
          popupInput.placeholder = 'ChatGPT / Gemini のタブで入力できます';
        }
        if (btnAdd) btnAdd.disabled = true;
        return;
      }

      activeTabId = tab.id;
      if (popupInput) {
        popupInput.disabled = false;
        popupInput.placeholder = 'Enterで送信・Ctrl+Enterでキュー追加';
      }
      if (btnAdd) btnAdd.disabled = false;

      chrome.tabs.sendMessage(tab.id, { action: 'GET_TAB_QUEUE' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          if (statItems) statItems.textContent = '読み込み中...';
          return;
        }

        const queue = response.items || [];
        if (countBadge) countBadge.textContent = String(queue.length);
        const serviceName = isChatGPT ? 'ChatGPT' : 'Gemini';
        if (statItems) {
          statItems.textContent = `${serviceName} (待機 ${queue.length}件)`;
        }
      });
    } catch (e) {
      console.error(e);
    }
  }

  await updateFromTab();

  // Add prompt to active tab
  let adding = false;
  const handleAdd = (queue = true) => {
    if (!popupInput || !activeTabId || adding) return;
    const text = popupInput.value.trim();
    if (!text) return;

    adding = true;
    if (btnAdd) btnAdd.disabled = true;
    chrome.tabs.sendMessage(activeTabId, { action: queue ? 'ADD_TO_TAB_QUEUE' : 'SEND_PROMPT_TO_TAB', text }, (response) => {
      adding = false;
      if (btnAdd) btnAdd.disabled = false;
      if (chrome.runtime.lastError || !response?.success) {
        if (statItems) statItems.textContent = response?.error || '送信・追加できませんでした。対象タブで送信状況を確認してください';
        return;
      }
      if (popupInput.value.trim() === text) popupInput.value = '';
      updateFromTab();
    });
  };

  if (btnAdd) {
    btnAdd.addEventListener('click', () => handleAdd(true));
  }

  if (popupInput) {
    let isComposing = false;
    popupInput.addEventListener('compositionstart', () => { isComposing = true; });
    popupInput.addEventListener('compositionend', () => { isComposing = false; });
    popupInput.addEventListener('keydown', (e) => {
      if (isComposing || e.isComposing || e.keyCode === 229) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleAdd(true);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleAdd(false);
      }
    });
  }

  // Open new ChatGPT tab
  if (btnOpenChatGPT) {
    btnOpenChatGPT.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://chatgpt.com/' });
    });
  }

  // Open new Gemini tab
  if (btnOpenGemini) {
    btnOpenGemini.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://gemini.google.com/app' });
    });
  }

  // Open Dashboard
  if (btnOpenDashboard) {
    btnOpenDashboard.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'OPEN_DASHBOARD' });
      window.close();
    });
  }
});
