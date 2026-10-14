import { safeUrls, seal } from '../shared/crypto';
declare const browser: any;
declare const BRIDGE_ORIGIN: string;

browser.menus.create({ id: 'send', title: 'Tab Bridge: Send selected tabs', contexts: ['tab'] });
browser.menus.create({ id: 'copy', title: 'Tab Bridge: Copy selected tab links', contexts: ['tab'] });

// Wait for the exact intended origin to load before injecting any transfer secret.
async function waitForPage(tabId: number) {
  return new Promise<void>((resolve, reject) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onRemoved.removeListener(onRemoved);
      if (error) reject(error); else resolve();
    };
    const inspect = async () => {
      try {
        const tab = await browser.tabs.get(tabId);
        if (tab.status !== 'complete') return;
        if (new URL(tab.url).origin !== BRIDGE_ORIGIN) {
          finish(new Error('Unexpected destination URL; transfer was not injected.'));
        } else finish();
      } catch (error) { finish(error as Error); }
    };
    const onUpdated = (id: number, change: any) => {
      if (id === tabId && (change.status === 'complete' || change.url)) void inspect();
    };
    const onRemoved = (id: number) => {
      if (id === tabId) finish(new Error('Tab closed before transfer handoff.'));
    };
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);
    timer = setTimeout(() => finish(new Error('Timed out waiting for Tab Bridge to load.')), 15000);
    void inspect();
  });
}

browser.menus.onClicked.addListener(async (info: any, clicked: any) => {
  if (!clicked || !['send', 'copy'].includes(info.menuItemId)) return;
  try {
    const highlighted = await browser.tabs.query({ windowId: clicked.windowId, highlighted: true });
    const selected = highlighted.some((t: any) => t.id === clicked.id) ? highlighted : [clicked];
    const urls = selected.sort((a: any, b: any) => a.index - b.index)
      .map((t: any) => t.url).filter((url: string) => {
        try { safeUrls([url]); return true; } catch { return false; }
      });
    if (info.menuItemId === 'copy') {
      await navigator.clipboard.writeText(safeUrls(urls).join('\n'));
      return;
    }

    // Check explicitly: MV3 site access can be disabled in Firefox's add-on settings.
    const sitePattern = new URL(BRIDGE_ORIGIN).protocol + '//' + new URL(BRIDGE_ORIGIN).hostname + '/*';
    if (!await browser.permissions.contains({ origins: [sitePattern] })) {
      throw new Error('Site permission missing. Grant Tab Bridge access to ' + BRIDGE_ORIGIN + ' in Firefox add-on settings.');
    }

    const draft = await seal(urls);
    const tab = await browser.tabs.create({ url: `${BRIDGE_ORIGIN}/` });
    await waitForPage(tab.id);
    // Firefox 128+ MAIN world: write directly to the page's sessionStorage.
    // This avoids the fragile page-event -> isolated content script -> background relay.
    // The key never enters a URL or the server; the page reads the draft on reload.
    const results = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: (value: object, expectedOrigin: string) => {
        if (location.origin !== expectedOrigin) throw new Error('Origin changed before injection.');
        sessionStorage.setItem('tb-draft', JSON.stringify(value));
        return true;
      },
      args: [draft, BRIDGE_ORIGIN],
    });
    if (results?.[0]?.result !== true) throw new Error('Firefox did not confirm the handoff.');
    await browser.tabs.reload(tab.id);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    await browser.storage.session.set({ sendError: `Tab Bridge send failed: ${detail}` });
    await browser.tabs.create({ url: browser.runtime.getURL('transfer.html') });
  }
});
