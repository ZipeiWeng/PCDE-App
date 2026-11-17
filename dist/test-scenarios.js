import { createSnapshot } from './model.js';

const scenarios = new Set(['good', 'watch', 'alert']);
const eligible = account => account?.isTest === true && typeof account.id === 'string' && account.id.length > 0;

// This override is intentionally memory-only. The authenticated data client
// continues receiving measurements; ending a preview reveals its latest value.
export function createTestScenarios() {
  let selected = null;
  const active = account => eligible(account) && selected?.accountId === account.id;
  return {
    active,
    select(account, scenario) {
      if (!eligible(account) || !scenarios.has(scenario)) return null;
      const snapshot = {...createSnapshot(scenario, {observationSource:'demo'}), simulated:true, preview:'test-scenario'};
      selected = {accountId:account.id, snapshot};
      return snapshot;
    },
    resolve(account, savedSnapshot) { return active(account) ? selected.snapshot : savedSnapshot; },
    clear() { selected = null; },
  };
}
