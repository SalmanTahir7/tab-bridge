export function turnstileVerifier(secret, hostname, request = fetch) {
    return async (token, ip) => {
        try {
            const response = await request('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
                method: 'POST', body: new URLSearchParams({ secret, response: token, remoteip: ip }), signal: AbortSignal.timeout(5000)
            });
            if (!response.ok)
                return false;
            const data = await response.json();
            return data.success === true && data.hostname === hostname && data.action === 'upload';
        }
        catch {
            return false;
        }
    };
}
