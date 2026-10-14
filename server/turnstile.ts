export function turnstileVerifier(secret: string, hostname: string, request = fetch) {
  return async (token: string, ip: string) => {
    try {
      const response = await request('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', body: new URLSearchParams({ secret, response: token, remoteip: ip }), signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) return false;
      const data = await response.json() as { success?: boolean; hostname?: string; action?: string };
      return data.success === true && data.hostname === hostname && data.action === 'upload';
    } catch { return false; }
  };
}
