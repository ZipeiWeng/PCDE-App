import test from 'node:test';
import assert from 'node:assert/strict';
import { emailAvailabilityStatus } from '../dist/auth.js';

test('registration availability distinguishes storage and email without assuming delivery', () => {
  assert.equal(emailAvailabilityStatus({storageReady:true,emailConfigured:false,configured:false}), 'unavailable');
  assert.equal(emailAvailabilityStatus({storageReady:false,emailConfigured:true,configured:false}), 'storage');
  assert.equal(emailAvailabilityStatus({storageReady:true,emailConfigured:true,configured:true}), 'ready');
  assert.equal(emailAvailabilityStatus({configured:false}), 'unavailable');
  assert.equal(emailAvailabilityStatus({configured:true}), 'ready');
  assert.equal(emailAvailabilityStatus({}), 'unknown');
});
