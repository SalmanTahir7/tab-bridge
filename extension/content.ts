declare const browser: any;
window.addEventListener('tab-bridge-ready', async () => {
  try {
    const draft = await browser.runtime.sendMessage({ type: 'get-tab-bridge-draft' });
    // JSON string is intentional: Firefox isolates content-script objects from page scripts.
    if (draft) window.dispatchEvent(new CustomEvent('tab-bridge-draft', { detail: JSON.stringify(draft) }));
  } catch { /* A restarted or removed extension leaves the ordinary web form usable. */ }
});
