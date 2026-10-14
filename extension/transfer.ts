import { receive, browserRecovery } from '../shared/client';
import { safeUrls } from '../shared/crypto';
declare const browser: any;
declare const BRIDGE_ORIGIN: string;
const code = document.querySelector<HTMLTextAreaElement>('#transfer-code')!;
const status = document.querySelector<HTMLElement>('#transfer-status')!;
const preview = document.querySelector<HTMLElement>('#preview')!;
const open = document.querySelector<HTMLButtonElement>('#open-received')!;
let urls: string[] = [], opened = 0;
document.querySelector<HTMLAnchorElement>('#web-link')!.href = `${BRIDGE_ORIGIN}/`;
browser.storage.session.get('sendError').then(async (value: any) => { if (value.sendError) { status.textContent = value.sendError; await browser.storage.session.remove('sendError'); } });
document.querySelector('#retrieve')!.addEventListener('click', async () => {
  const button = document.querySelector<HTMLButtonElement>('#retrieve')!; button.disabled = true;
  try {
    const result = await receive(code.value, browserRecovery, BRIDGE_ORIGIN);
    urls = result.urls; opened = 0; preview.textContent = urls.join('\n'); open.disabled = false;
    status.textContent = result.pendingAck ? 'Recovered. Server deletion pending; retrieve again to retry acknowledgment.' : `${urls.length} tabs recovered. Review them, then open.`;
  } catch (error) { status.textContent = (error as Error).message + ' Retry here with the same code.'; }
  finally { button.disabled = false; }
});
open.addEventListener('click', async () => {
  open.disabled = true;
  try {
    const validated = safeUrls(urls);
    for (; opened < validated.length; opened++) await browser.tabs.create({ url: validated[opened], active: false });
    status.textContent = `Opened ${opened} tabs.`;
  } catch { status.textContent = `Opened ${opened} tabs. Click again to resume the remaining tabs.`; open.disabled = false; }
});
document.querySelector('#forget')!.addEventListener('click', () => {
  for (const key of Object.keys(localStorage).filter(k => k.startsWith('tb-recovery:'))) localStorage.removeItem(key);
  code.value = ''; preview.textContent = ''; urls = []; open.disabled = true; status.textContent = 'Local recovery data cleared.';
});
