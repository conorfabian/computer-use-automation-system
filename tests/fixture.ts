// Hand-authored test fixture. Never presented as model discovery evidence.
import { contract, rowTarget, screens } from '../src/contract.js';
import { recordCapability } from '../src/recorder.js';
import type { Action, Step, Target } from '../src/schema.js';
const button = (name: string): Target => ({ strategies: [{ by: 'role', role: 'button', name: { literal: name } }] });
const input = (caption: string): Target => ({ strategies: [{ by: 'tableRow', caption: { literal: caption }, control: 'input' }] });
export function fixture() {
  const steps: Step[] = [];
  let before = contract.precondition;
  function add(action: Action, screen: keyof typeof screens) {
    const checkpoint = structuredClone(screens[screen]);
    if (action.type === 'type') checkpoint.all.push({ kind: 'equals', target: action.target, read: 'value', value: action.value });
    steps.push({ id: `step-${steps.length + 1}`, action, before, checkpoint, timeoutMs: 5000, effect: ['click', 'type'].includes(action.type) ? 'reversible' : 'read' });
    before = checkpoint;
  }
  add({ type: 'type', target: input('Member number'), value: { input: 'memberId' } }, 'search');
  add({ type: 'click', target: button('Search') }, 'results');
  add({ type: 'click', target: button('View member') }, 'details');
  add({ type: 'click', target: button('Open Savings Sub-Account') }, 'form');
  add({ type: 'type', target: input('Nickname'), value: { input: 'nickname' } }, 'form');
  add({ type: 'click', target: button('Review') }, 'review');
  for (const [output, caption] of [['status', 'Status'], ['memberId', 'Member number'], ['nickname', 'Nickname'], ['accountType', 'Account type']]) {
    add({ type: 'extract', target: rowTarget(caption!), read: 'text', output: output! }, 'review');
  }
  return recordCapability(steps, { source: 'test-fixture', runId: 'fixture', provider: 'none', model: 'none', createdAt: '2026-09-19T00:00:00.000Z' });
}
