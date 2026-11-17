// Account-scoped completion survives sign-out; test accounts deliberately bypass it.
export function createOnboardingState({ storage, completeRemote = async () => {} } = {}) {
  const completed = new Set();
  const pending = new Map();
  const key = account => account?.demo ? 'demo' : account?.id;
  const storageKey = id => `pawprint.onboarding.completed.v1:${id}`;
  function remember(id) {
    completed.add(id);
    try { storage?.setItem(storageKey(id), 'true'); } catch { /* In-memory state still works. */ }
  }
  function hasCompleted(id) {
    try { return completed.has(id) || storage?.getItem(storageKey(id)) === 'true'; }
    catch { return completed.has(id); }
  }
  function sync(account) {
    const id = key(account);
    if (!id || account.demo || account.isTest || account.onboardingCompleted) return Promise.resolve();
    if (pending.has(id)) return pending.get(id);
    // Capture identity before the request so a later account switch cannot mark another account.
    const request = Promise.resolve().then(() => completeRemote(id)).catch(() => {}).finally(() => pending.delete(id));
    pending.set(id, request);
    return request;
  }
  function shouldShow(account) {
    if (account?.isTest) return true;
    const id = key(account);
    if (!id) return false;
    if (account.onboardingCompleted) { remember(id); return false; }
    if (hasCompleted(id)) { void sync(account); return false; }
    return true;
  }
  function finish(account) {
    if (account?.isTest) return Promise.resolve();
    const id = key(account);
    if (!id) return Promise.resolve();
    remember(id);
    return sync(account);
  }
  return { shouldShow, finish };
}
