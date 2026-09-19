import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Conditions } from '../src/conditions.js';
import { Evidence } from '../src/evidence.js';
import { screen } from '../src/contract.js';
import type { Surface } from '../src/surface.js';

test('separate loading episodes get separate budgets; pending waits are not reported as recovered', async () => {
  let loading = true;
  const surface = { location: () => 'http://127.0.0.1:3000/results', matches: async () => loading } as unknown as Surface;
  const evidence = new Evidence('.tmp/tests', {}); await evidence.init();
  const conditions = new Conditions(surface, { businessOutcomes: [], recoveries: [
    { kind: 'wait', code: 'SLOW_LOAD', when: screen('/results', 'Loading'), maxMs: 100 },
  ] }, {}, evidence, 'replay');
  await conditions.inspect('first');
  assert.deepEqual(conditions.recovered, []);
  loading = false;
  await conditions.inspect('first');
  assert.deepEqual(conditions.recovered, ['SLOW_LOAD']);
  await delay(120);
  loading = true;
  await conditions.inspect('second'); // The first episode's timestamp must not expire this one.
  loading = false;
  await conditions.inspect('second');
  assert.equal(conditions.recovered.length, 2);
});
test('a condition wait respects the remaining run deadline, not only the step timeout', async () => {
  const surface = { location: () => 'http://127.0.0.1:3000/search', matches: async () => false } as unknown as Surface;
  const evidence = new Evidence('.tmp/tests', {}); await evidence.init();
  const deadline = Date.now() + 50;
  const conditions = new Conditions(surface, { businessOutcomes: [], recoveries: [] }, {}, evidence, 'replay', () => deadline);
  await assert.rejects(conditions.wait(screen('/results', 'Results'), {}, 5000, 'test'), /RUN_TIMEOUT/);
});
