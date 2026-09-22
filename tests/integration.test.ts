import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import type { Server } from 'node:http';
import { startDemo } from '../demo/server.js';
import { Policy, PolicySchema } from '../src/policy.js';
import { PlaywrightSurface } from '../src/playwright-surface.js';
import { Evidence } from '../src/evidence.js';
import { replay } from '../src/replay.js';
import { RunError } from '../src/schema.js';
import { fixture } from './fixture.js';
import { contract } from '../src/contract.js';
import type { Operator } from '../src/handoff.js';
let server: Server;
let origin: string;
let policy: Policy;
before(async () => {
  server = await startDemo(0);
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const config = PolicySchema.parse(JSON.parse(await readFile('config/demo-policy.json', 'utf8')));
  config.allowedOrigins = [origin]; policy = new Policy(config);
});
after(() => new Promise<void>(resolve => server.close(() => resolve())));
const noOperator: Operator = async () => { throw new RunError('INTERVENTION_REQUIRED'); };

async function run(memberId: string, scenario = 'normal', operator?: (surface: PlaywrightSurface) => Operator) {
  const inputs = { memberId, nickname: 'Travel "fund"' };
  const evidence = new Evidence('.tmp/tests', inputs); await evidence.init();
  const surface = await PlaywrightSurface.open(`${origin}/search?scenario=${scenario}`, policy, false);
  try {
    const result = await replay(fixture(), inputs, surface, evidence, operator?.(surface) ?? noOperator);
    return { result, events: await readFile(`${evidence.directory}/events.jsonl`, 'utf8'), dir: evidence.directory };
  } finally { await surface.close(); }
}
test('replays same artifact with two inputs, extracts values, and saves redacted evidence', async () => {
  for (const member of ['12345', '67890']) {
    const { result, events, dir } = await run(member);
    assert.equal(result.status, 'success', JSON.stringify(result));
    if (result.status === 'success') assert.deepEqual(result.outputs, { status: 'READY_FOR_REVIEW', memberId: member, nickname: 'Travel "fund"', accountType: 'SAVINGS' });
    assert.equal(events.includes(member), false);
    assert.equal(events.includes('Travel'), false);
    assert.ok((await readdir(dir)).includes('success.png'));
  }
});
test('not-found and permission-denied are business outcomes', async () => {
  for (const [member, code] of [['99999', 'MEMBER_NOT_FOUND'], ['54321', 'PERMISSION_DENIED']]) {
    const { result } = await run(member!); assert.equal(result.status, 'business_outcome');
    if (result.status === 'business_outcome') assert.equal(result.code, code);
  }
});
test('known warning and slow load recover deterministically', async () => {
  for (const [scenario, code] of [['warning', 'KNOWN_WARNING'], ['slow', 'SLOW_LOAD']]) {
    const { result } = await run('12345', scenario); assert.equal(result.status, 'success', JSON.stringify(result));
    assert.ok(result.recoveries.includes(code!));
  }
});
test('session handoff preserves page and suspends automation; simulated operator is only test evidence', async () => {
  const { result, events } = await run('12345', 'locked', surface => async () => {
    const page = surface.page;
    await assert.rejects(surface.execute({ type: 'scroll', direction: 'down', pixels: 10 }, {}), /CONTROL_NOT_OWNED/);
    await page.getByRole('button', { name: 'Unlock session', exact: true }).click();
    assert.equal(page, surface.page);
    return 'resume';
  });
  assert.equal(result.status, 'success', JSON.stringify(result));
  assert.match(events, /control-transfer/); assert.match(events, /Unlock session/);
});
test('noninteractive handoff fails explicitly', async () => {
  const { result } = await run('12345', 'locked'); assert.equal(result.status, 'failure');
  if (result.status === 'failure') assert.equal(result.code, 'INTERVENTION_REQUIRED');
});
test('ambiguous targets fail; coordinates capture structural metadata; stale observations fail', async () => {
  const surface = await PlaywrightSurface.open(`${origin}/search`, policy, false);
  try {
    const observation = await surface.observe();
    const input = observation.controls.find(c => c.control.tag === 'input')!;
    const target = await surface.captureTarget(observation.id, { x: input.bounds.x + 5, y: input.bounds.y + 5 }, { memberId: '12345', nickname: 'Vacation' });
    assert.equal(target.strategies[0]?.by, 'tableRow');
    const missing = { by: 'label' as const, text: { literal: 'Absent label' } };
    const fallback = await surface.resolve({ ...target, strategies: [missing, ...target.strategies] }, {});
    assert.equal(await fallback.getAttribute('type'), 'text');
    // Even coordinates over a real input cannot rescue missing replay strategies.
    await assert.rejects(surface.resolve({ ...target, strategies: [missing] }, {}), /TARGET_NOT_FOUND/);
    await surface.page.locator('main').evaluate(el => el.insertAdjacentHTML('beforeend', '<button>Search</button>'));
    await assert.rejects(surface.resolve({ strategies: [{ by: 'role', role: 'button', name: { literal: 'Search' } }] }, {}), /AMBIGUOUS_TARGET/);
    await assert.rejects(surface.captureTarget(observation.id, { ref: input.ref }, {}), /STALE_OBSERVATION/);
  } finally { await surface.close(); }
});
test('incorrect review value cannot pass final success and irreversible click is blocked', async () => {
  const surface = await PlaywrightSurface.open(`${origin}/search`, policy, false);
  const inputs = { memberId: '12345', nickname: 'Vacation' };
  const evidence = new Evidence('.tmp/tests', inputs); await evidence.init();
  try {
    assert.equal((await replay(fixture(), inputs, surface, evidence, noOperator)).status, 'success');
    assert.equal(await surface.matches(contract.successCondition, { ...inputs, nickname: 'Wrong' }), false);
    await assert.rejects(surface.execute({ type: 'click', target: { strategies: [{ by: 'role', role: 'button', name: { literal: 'Create Account' } }] } }, inputs), /HUMAN_ONLY_ACTION/);
    assert.equal(new URL(surface.location()).pathname, '/review');
  } finally { await surface.close(); }
});

test('resume rejects an unrelated screen without advancing automation', async () => {
  const { result } = await run('12345', 'locked', surface => async () => {
    await surface.page.goto(`${origin}/search`);
    return 'resume';
  });
  assert.equal(result.status, 'failure');
  if (result.status === 'failure') assert.equal(result.code, 'RESUME_STATE_REJECTED');
});
test('external requests are blocked by the browser adapter, not only a policy unit test', async () => {
  const surface = await PlaywrightSurface.open(`${origin}/search`, policy, false);
  try {
    await assert.rejects(surface.page.goto('https://example.com/collect'));
    await assert.rejects(surface.observe(), /POLICY_NETWORK_BLOCKED/);
  } finally { await surface.close(); }
});
test('failure evidence references a real fallback file when the page is closed', async () => {
  const surface = await PlaywrightSurface.open(`${origin}/search`, policy, false);
  const evidence = new Evidence('.tmp/tests', { memberId: '12345' }); await evidence.init();
  await surface.close();
  const path = await evidence.capture(surface, 'closed-page');
  assert.ok(path.endsWith('.png.json'));
  assert.equal(JSON.parse(await readFile(path, 'utf8')).kind, 'sanitized-observation');
});

test('a value equal to another row caption does not make structural targets ambiguous', async () => {
  const surface = await PlaywrightSurface.open(`${origin}/search`, policy, false);
  const inputs = { memberId: '12345', nickname: 'Member number' };
  const evidence = new Evidence('.tmp/tests', inputs, [], policy.publicText); await evidence.init();
  try {
    const result = await replay(fixture(), inputs, surface, evidence, noOperator);
    assert.equal(result.status, 'success', JSON.stringify(result));
    if (result.status === 'success') assert.equal(result.outputs.nickname, 'Member number');
  } finally { await surface.close(); }
});

test('human interaction recording survives a full page reload', async () => {
  const surface = await PlaywrightSurface.open(`${origin}/search`, policy, false);
  const events: Record<string, unknown>[] = [];
  try {
    surface.onHumanEvent(event => events.push(event));
    await surface.setOwner('HUMAN');
    await surface.page.reload();
    await surface.page.getByRole('button', { name: 'Search', exact: true }).click();
    await surface.setOwner('AUTOMATION');
    assert.ok(events.some(event => event.control === 'Search' && event.action === 'click'));
  } finally { await surface.close(); }
});

test('resuming a wait step still verifies its action condition', async () => {
  const artifact = fixture();
  artifact.steps.unshift({ id: 'wait-for-results', effect: 'read', timeoutMs: 100,
    before: contract.precondition, checkpoint: contract.precondition,
    action: { type: 'wait', condition: { all: [{ kind: 'route', path: '/results' }] } },
  });
  const inputs = { memberId: '12345', nickname: 'Vacation' };
  const evidence = new Evidence('.tmp/tests', inputs); await evidence.init();
  const surface = await PlaywrightSurface.open(`${origin}/search`, policy, false);
  let interventions = 0;
  try {
    const result = await replay(artifact, inputs, surface, evidence, async () => { interventions++; return 'resume'; });
    assert.equal(interventions, 1);
    assert.equal(result.status, 'failure');
    if (result.status === 'failure') assert.equal(result.code, 'CHECKPOINT_FAILED');
  } finally { await surface.close(); }
});
