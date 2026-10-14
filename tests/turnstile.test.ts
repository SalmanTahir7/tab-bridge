import { expect, it } from 'vitest';
import { turnstileVerifier } from '../server/turnstile';
it('checks success, expected hostname and upload action; fails closed on outages', async () => {
  for (const [body, expected] of [[{ success: true, hostname: 'tabs.example.com', action: 'upload' }, true], [{ success: true, hostname: 'evil.example', action: 'upload' }, false], [{ success: true, hostname: 'tabs.example.com', action: 'login' }, false], [{ success: false }, false]] as const) {
    const mock = (async () => new Response(JSON.stringify(body))) as typeof fetch;
    expect(await turnstileVerifier('secret', 'tabs.example.com', mock)('token', '127.0.0.1')).toBe(expected);
  }
  const failing = (async () => { throw new Error('offline'); }) as typeof fetch;
  expect(await turnstileVerifier('secret', 'tabs.example.com', failing)('token', '127.0.0.1')).toBe(false);
});
