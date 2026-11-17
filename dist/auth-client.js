/** The server owns credentials, email challenges and HttpOnly sessions. */
export async function authRequest(path, body, { signal } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(`/api/auth${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const emailOperation = ['/signup/start','/reset/start','/resend'].includes(path);
      const fallback = response.status === 503 || response.status === 404
        ? emailOperation ? 'Verification email is unavailable right now. Please try again later.' : 'Account sign-in is unavailable right now. Please try again later.'
        : response.status === 429 ? 'Too many attempts. Please wait a moment and try again.'
        : 'This request could not finish. Please try again.';
      const setupHelp = result.code === 'email_not_configured'
        ? 'Verification email is not set up yet. No code was sent.'
        : result.code === 'auth_not_configured' ? 'Account services are not set up yet. Please try again later.'
        : result.code === 'email_sender_configuration' ? 'Verification email is unavailable. The sender needs attention.'
        : result.code === 'email_rate_limited' ? 'Email sending is busy. Please wait before trying again.'
        : result.code === 'email_unavailable' ? 'We could not confirm email delivery. Please try again later.' : '';
      const error = new Error(setupHelp || (typeof result.message === 'string' ? result.message : fallback));
      error.code = result.code || (response.status === 503 || response.status === 404 ? 'not_configured' : 'request_failed');
      error.status = response.status;
      const retryAfter = response.headers.get('retry-after') || '';
      if (/^\d+$/.test(retryAfter)) error.retryAfter = Math.max(1, Math.min(3600, Number(retryAfter)));
      throw error;
    }
    return result;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The connection took too long. Please try again.');
    if (error instanceof TypeError) throw new Error('Could not connect. Check your connection and try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
