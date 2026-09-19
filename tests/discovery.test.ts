import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startDemo } from '../demo/server.js';
import { PlaywrightSurface } from '../src/playwright-surface.js';
import { Policy, PolicySchema } from '../src/policy.js';
import { Evidence } from '../src/evidence.js';
import { discover } from '../src/discovery.js';
import { replay } from '../src/replay.js';
import { RunError, CapabilitySchema } from '../src/schema.js';
import type { Decision, DecisionProvider } from '../src/llm/openai.js';

// This is a deterministic test double, explicitly marked test-fixture.
// It tests recording, not model intelligence, and writes only under .tmp/tests.
function provider(final: 'done' | 'risky' = 'done'): DecisionProvider {
  const actions = [
    ['type', 'Member number', 'memberId', 'search'],
    ['click', 'Search', '', 'results'],
    ['click', 'View member', '', 'details'],
    ['click', 'Open Savings Sub-Account', '', 'form'],
    ['type', 'Nickname', 'nickname', 'form'],
    ['click', 'Review', '', 'review'],
    ['extract', 'Status', 'status', 'review'],
    ['extract', 'Member number', 'memberId', 'review'],
    ['extract', 'Nickname', 'nickname', 'review'],
    ['extract', 'Account type', 'accountType', 'review'],
  ];
  let index = 0;
  return { model: 'scripted-test-double', source: 'test-fixture', async decide({ observation }) {
    const row = actions[index++];
    if (!row) return { requestId: 'test', decision: final === 'done' ? { reason: 'goal_met', action: { type: 'done' } } : {
      reason: 'navigate', action: { type: 'click', expectedScreen: 'review', target: { ref: observation.controls.find(c => c.control.name === 'Create Account')!.ref } },
    } };
    const [type, label, binding, expectedScreen] = row;
    const control = observation.controls.find(c => type === 'extract' ? c.control.caption === label && c.control.tag === 'td' : c.control.name === label)!;
    const target = { ref: control.ref };
    const action = { type, target, expectedScreen, ...(type === 'type' ? { input: binding } : type === 'extract' ? { output: binding } : {}) } as Decision['action'];
    return { requestId: 'test', decision: { reason: 'navigate', action } };
  } };
}

for (const nickname of ['Vacation', 'Search', 'a']) test(`recorder handles nickname ${nickname} and replays with new inputs`, async () => {
  const server = await startDemo(0);
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const config = PolicySchema.parse(JSON.parse(await readFile('config/demo-policy.json', 'utf8'))); config.allowedOrigins = [origin];
  const policy = new Policy(config);
  const operator = async (): Promise<'resume'> => { throw new RunError('INTERVENTION_REQUIRED'); };
  const inputs = { memberId: '12345', nickname };
  const evidence = new Evidence('.tmp/tests', inputs); await evidence.init();
  const surface = await PlaywrightSurface.open(`${origin}/search`, policy, false);
  const artifactPath = `${evidence.directory}/fixture-capability.json`;
  try {
    const result = await discover({ goal: 'Test recording only', values: inputs, surface, policy, provider: provider(), evidence, operator, artifactPath });
    assert.equal(result.status, 'success', JSON.stringify(result));
    const text = await readFile(artifactPath, 'utf8');
    assert.equal(text.includes('12345'), false);
    if (nickname === 'Vacation') assert.equal(text.includes('Vacation'), false);
    const artifact = CapabilitySchema.parse(JSON.parse(text));
    assert.equal(artifact.provenance.source, 'test-fixture');
    await surface.close();
    const replaySurface = await PlaywrightSurface.open(`${origin}/search`, policy, false);
    try {
      const values = { memberId: '67890', nickname: 'Emergency' };
      const replayEvidence = new Evidence('.tmp/tests', values); await replayEvidence.init();
      const replayed = await replay(artifact, values, replaySurface, replayEvidence, operator);
      assert.equal(replayed.status, 'success', JSON.stringify(replayed));
    } finally { await replaySurface.close(); }
  } finally { await surface.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('discovery cannot execute risky final action or publish an unverified artifact', async () => {
  const server = await startDemo(0);
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const config = PolicySchema.parse(JSON.parse(await readFile('config/demo-policy.json', 'utf8'))); config.allowedOrigins = [origin];
  const policy = new Policy(config);
  const inputs = { memberId: '12345', nickname: 'Vacation' };
  const evidence = new Evidence('.tmp/tests', inputs); await evidence.init();
  const surface = await PlaywrightSurface.open(`${origin}/search`, policy, false);
  const artifactPath = `${evidence.directory}/must-not-exist.json`;
  try {
    const result = await discover({ goal: 'Adversarial test only', values: inputs, surface, policy, provider: provider('risky'), evidence,
      operator: async () => { throw new RunError('INTERVENTION_REQUIRED'); }, artifactPath });
    assert.equal(result.status, 'failure');
    assert.equal(new URL(surface.location()).pathname, '/review');
    await assert.rejects(readFile(artifactPath));
  } finally { await surface.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
