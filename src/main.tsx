import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { seal, parseCode } from '../shared/crypto';
import { api, browserRecovery, receive } from '../shared/client';
import './style.css';
declare global { interface Window { turnstile?: { render: (element: HTMLElement, options: object) => string; reset: (id: string) => void; remove: (id: string) => void }; } }
type Draft = Awaited<ReturnType<typeof seal>>;
function App() {
  const [tab, setTab] = useState<'send' | 'receive'>('send'), [text, setText] = useState(''), [code, setCode] = useState('');
  const [draft, setDraft] = useState<Draft | null>(() => { try { return JSON.parse(sessionStorage.getItem('tb-draft') || 'null'); } catch { return null; } });
  const [ttl, setTtl] = useState(900), [urls, setUrls] = useState<string[]>([]), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const [siteKey, setSiteKey] = useState<string | null>(null), [token, setToken] = useState('');
  const [created, setCreated] = useState(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem('tb-draft') || 'null') as Draft | null;
      return !!stored && sessionStorage.getItem('tb-confirmed-id') === stored.envelope.id;
    } catch { return false; }
  });
  const [uploadError, setUploadError] = useState(false);
  const challenge = useRef<HTMLDivElement>(null), widget = useRef<string | null>(null);
  useEffect(() => {
    const hash = location.hash.slice(1);
    history.replaceState(null, '', location.pathname);
    if (hash.startsWith('tb1.')) { setCode(hash); setTab('receive'); }
    api('/config').then(c => { setSiteKey(c.siteKey); if (!c.siteKey) setToken('local-demo'); }).catch(() => setStatus('API unavailable. Start the backend, then reload.'));
    const handoff = (event: Event) => {
      try {
        const incoming = JSON.parse((event as CustomEvent).detail) as Draft;
        parseCode(incoming.code);
        if (JSON.stringify(incoming).length > 74000 || !incoming.envelope || !incoming.auth) throw new Error();
        sessionStorage.setItem('tb-draft', JSON.stringify(incoming)); sessionStorage.removeItem('tb-confirmed-id'); setDraft(incoming); setTab('send'); setCreated(false); setUploadError(false);
        setStatus('Selected Firefox tabs are encrypted and ready. Complete verification to upload.');
      } catch { setStatus('Could not receive the extension transfer.'); }
    };
    window.addEventListener('tab-bridge-draft', handoff);
    window.dispatchEvent(new Event('tab-bridge-ready'));
    return () => window.removeEventListener('tab-bridge-draft', handoff);
  }, []);
  useEffect(() => {
    if (!siteKey || !challenge.current || tab !== 'send' || created) return;
    let stopped = false;
    const render = () => { if (!stopped && challenge.current && window.turnstile) widget.current = window.turnstile.render(challenge.current, { sitekey: siteKey, action: 'upload', callback: setToken, 'expired-callback': () => setToken(''), 'error-callback': () => setToken('') }); };
    if (window.turnstile) render();
    else { const script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true; script.onload = render; script.onerror = () => setStatus('Verification could not load. Check your connection and reload.'); document.head.append(script); }
    return () => { stopped = true; if (widget.current) window.turnstile?.remove(widget.current); widget.current = null; setToken(''); };
  }, [siteKey, tab, created]);
  async function upload() {
    setBusy(true); setUploadError(false); setStatus('Encrypting and uploading…');
    try {
      const prepared = draft || await seal(text.split(/\r?\n/).map(v => v.trim()).filter(Boolean), ttl);
      // Save the exact encrypted request before sending so a lost response can be retried.
      sessionStorage.setItem('tb-draft', JSON.stringify(prepared)); setDraft(prepared);
      await api('/transfers', { ...prepared.envelope, auth: prepared.auth, turnstileToken: token });
      sessionStorage.setItem('tb-confirmed-id', prepared.envelope.id);
      setCreated(true); setStatus('Transfer created. The link and code are ready to share privately.');
    } catch (error) {
      setUploadError(true);
      setStatus((error as Error).message + ' Upload not confirmed. Retry the same prepared transfer.');
    } finally { setBusy(false); if (siteKey && widget.current) { window.turnstile?.reset(widget.current); setToken(''); } }
  }
  async function retrieve() {
    setBusy(true); setStatus('Retrieving and decrypting…'); setUrls([]);
    try { const result = await receive(code, browserRecovery); setUrls(result.urls); setStatus(result.pendingAck ? 'Tabs recovered locally. Server confirmation is pending; retry with this code to confirm deletion.' : 'Tabs recovered. Server copy deleted. Review the links before opening.'); }
    catch (error) { setStatus((error as Error).message + ' Retry in this browser with the same code.'); }
    finally { setBusy(false); }
  }
  async function copy(value: string) { try { await navigator.clipboard.writeText(value); setStatus('Copied. Share privately.'); } catch { setStatus('Clipboard unavailable. Select and copy the text manually.'); } }
  function startNewTransfer() {
    sessionStorage.removeItem('tb-draft'); sessionStorage.removeItem('tb-confirmed-id');
    setDraft(null); setCreated(false); setUploadError(false); setText(''); setStatus('');
  }
  function clear() { startNewTransfer(); for (const key of Object.keys(localStorage).filter(k => k.startsWith('tb-recovery:'))) localStorage.removeItem(key); setUrls([]); setCode(''); setStatus('Local drafts and recovery data cleared. Existing server transfers expire automatically.'); }
  return <main>
    <nav><a href="/" className="brand"><span className="mark">↗</span> Tab Bridge</a><span className="pill">No account. Just your tabs.</span></nav>
    <header><p className="eyebrow">A SMALL BRIDGE BETWEEN YOUR COMPUTERS</p><h1>New screen.<br/><span>Same train of thought.</span></h1><p className="intro">Move your tabs in one private bundle. Encrypted in your browser, opened on your next computer, then gone.</p></header>
    <div className="workspace"><section className="card">
      <div className="tabs" role="group" aria-label="Transfer direction"><button className={tab === 'send' ? 'active' : ''} onClick={() => setTab('send')}>↗ Send tabs</button><button className={tab === 'receive' ? 'active' : ''} onClick={() => setTab('receive')}>↙ Receive tabs</button></div>
      {tab === 'send' ? <><h2>Take your tabs with you.</h2><p>Paste one website URL per line, or send selected tabs from the Firefox extension.</p>
        {!draft ? <><label htmlFor="urls">Your tabs</label><textarea id="urls" value={text} onChange={e => setText(e.target.value)} placeholder={'https://developer.mozilla.org\nhttps://github.com'} spellCheck={false}/><div className="row"><span className="subtle">100 tabs · 48 KiB maximum</span><select aria-label="Transfer expiration" value={ttl} onChange={e => setTtl(Number(e.target.value))}><option value={300}>Expires in 5 minutes</option><option value={900}>Expires in 15 minutes</option><option value={3600}>Expires in 1 hour</option></select></div></> : !created && <div className="prepared">✓ Encrypted bundle prepared. Your tabs are still on this device; upload is required before the link will work.<button className="text" onClick={startNewTransfer}>Start a different transfer</button></div>}
        {!created && <><div ref={challenge}/>{siteKey === '' && <p className="demo">Local demo — temporary memory storage; public verification disabled.</p>}
          <button className="primary" disabled={busy || !token} onClick={upload}>{busy ? 'Uploading encrypted tabs…' : draft ? 'Upload encrypted transfer →' : 'Create private transfer →'}</button>
          {draft && uploadError && <div className="result recovery" role="status"><strong>Upload not confirmed</strong><p>Retry your prepared transfer using the button above. If the server received it but the response was lost, retrying uses the same transfer. This recovery code does not prove the upload succeeded; do not share it yet.</p><code>{draft.code}</code><button onClick={() => copy(draft.code)}>Copy recovery code</button></div>}
        </>}
        {created && draft && <section className="result transfer-success" aria-label="Transfer created successfully"><h3>✓ Transfer created successfully</h3><p>Your encrypted tabs have been uploaded. You can now retrieve them from another computer using the private link or code.</p><label>Your private transfer code</label><code>{draft.code}</code><div className="row"><button onClick={() => copy(draft.code)}>Copy code</button><button onClick={() => copy(`${location.origin}/#${draft.code}`)}>Copy secure link</button></div><p className="subtle">Anyone holding this link or code can retrieve the bundle. Share privately and keep it until your tabs have been opened.</p><button className="text" onClick={startNewTransfer}>Start a new transfer</button></section>}
      </> : <><h2>Pick up where you left off.</h2><p>Paste the full link or transfer code. The first recipient claims the bundle.</p><label htmlFor="code">Link or transfer code</label><textarea id="code" value={code} onChange={e => setCode(e.target.value)} placeholder="tb1.…" spellCheck={false}/><button className="primary" disabled={busy || !code.trim()} onClick={retrieve}>Retrieve tabs →</button>
      {urls.length > 0 && <div className="result"><h3>{urls.length} tabs ready</h3><p>Open links individually; browsers may block bulk popups. Use the Firefox extension to import all tabs.</p><ul>{urls.map(url => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer">{url}</a></li>)}</ul><button onClick={() => copy(urls.join('\n'))}>Copy URL list</button></div>}</>}
      <p className="status" role="status" aria-live="polite">{status}</p>
    </section><aside><div className="step"><span>01</span><h3>Encrypted before it leaves.</h3><p>Your browser locks the bundle. The server stores ciphertext, not your URLs.</p></div><div className="step"><span>02</span><h3>The link is the key.</h3><p>Anyone with your full link or code can claim it. Share privately, like a password.</p></div><div className="step"><span>03</span><h3>One recipient. A short stay.</h3><p>Transfers expire within an hour. Interrupted downloads can resume in the same browser.</p></div><div className="note">A personal homelab project.<br/>Free to use. Built to be understood.</div></aside></div>
    <footer><span>No accounts · No URL analytics · HTTP(S) tabs only</span><button className="text" onClick={clear}>Clear local transfer data</button><p>Keep your code until tabs are open. Recovery ciphertext expires locally on next use; clearing browser data loses recovery. Encryption does not protect against a compromised device or a malicious version of this site.</p></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
