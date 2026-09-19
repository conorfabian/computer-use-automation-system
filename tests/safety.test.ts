import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Policy, PolicySchema } from '../src/policy.js';
import { Evidence } from '../src/evidence.js';
const policy = new Policy(PolicySchema.parse(JSON.parse(await readFile('config/demo-policy.json', 'utf8'))));
const button = (name: string) => ({ name, tag: 'button', inputType: 'submit', role: 'button', label: '', caption: '', text: name });
test('policy enforces exact origins, routes, queries, methods, and resolved controls', () => {
  assert.doesNotThrow(() => policy.action('http://127.0.0.1:3000/search', 'click', button('Search')));
  assert.throws(() => policy.location('http://127.0.0.1:3000.evil.test/search'));
  assert.throws(() => policy.location('http://127.0.0.1:3000/search?member=12345'));
  assert.throws(() => policy.action('http://127.0.0.1:3000/review', 'click', button('Create Account')), /HUMAN_ONLY_ACTION/);
  assert.throws(() => policy.action('http://127.0.0.1:3000/locked', 'click', button('Unlock session')), /HUMAN_ONLY_ACTION/);
  assert.throws(() => policy.action('http://127.0.0.1:3000/search', 'click', button('Unknown')));
  assert.equal(policy.request('http://127.0.0.1:3000/review', 'POST'), false);
  assert.equal(policy.request('https://example.com/collect', 'GET'), false);
});
test('evidence redacts nested runtime values and secret fields', () => {
  const evidence = new Evidence('.tmp', { memberId: '12345', nickname: 'Vacation' }, ['secret-key']);
  const serialized = JSON.stringify(evidence.redact({ nested: ['Member 12345', 'Vacation'], apiKey: 'anything', error: 'secret-key' }));
  for (const value of ['12345', 'Vacation', 'anything', 'secret-key']) assert.equal(serialized.includes(value), false);
});

test('a short nickname cannot corrupt protocol IDs, evidence paths, or public UI literals', () => {
  const evidence = new Evidence('.tmp', { memberId: '12345', nickname: 'a' }, [], ['Search']);
  const result = evidence.redact({ runId: 'aaaa', evidence: 'evidence/abc.png', action: 'extract',
    outputs: { nickname: 'a' }, target: { literal: 'Search' } });
  assert.deepEqual(result, { runId: 'aaaa', evidence: 'evidence/abc.png', action: 'extract',
    outputs: { nickname: '[REDACTED]' }, target: { literal: 'Search' } });
});
test('normalized caller inputs are also redacted', () => {
  const evidence = new Evidence('.tmp', { memberId: '12345', nickname: ' Vacation ' });
  evidence.bindInputs({ memberId: '12345', nickname: 'Vacation' });
  assert.equal(JSON.stringify(evidence.redact({ nickname: 'Vacation', message: ' Vacation ' })).includes('Vacation'), false);
});
