import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CapabilitySchema } from '../src/schema.js';
import { validateFields, resolveValue, parameterize } from '../src/parameters.js';
import { contract } from '../src/contract.js';
import { fixture } from './fixture.js';

test('artifact rejects unsupported versions, duplicate IDs, dangling refs, and missing extractions', () => {
  assert.ok(CapabilitySchema.safeParse(fixture()).success);
  for (const change of [
    (a: any) => a.schemaVersion = 2,
    (a: any) => a.steps[1].id = a.steps[0].id,
    (a: any) => a.steps[0].action.value.input = 'undeclared',
    (a: any) => a.steps.pop(),
    (a: any) => a.steps[0].action.target.strategies = [],
  ]) { const artifact = fixture(); change(artifact); assert.equal(CapabilitySchema.safeParse(artifact).success, false); }
});
test('inputs retain string identity and references never execute or interpolate selector code', () => {
  const values = validateFields(contract.inputs, { memberId: '00123', nickname: '  Summer "fund"  ' });
  assert.equal(values.memberId, '00123');
  assert.equal(resolveValue({ input: 'nickname' }, values), 'Summer "fund"');
  assert.deepEqual(parameterize('00123', values), { input: 'memberId' });
  assert.throws(() => parameterize('Member 00123', values));
  assert.throws(() => validateFields(contract.inputs, { memberId: '1', nickname: 'Trip' }));
  assert.throws(() => validateFields(contract.inputs, { memberId: '00123', nickname: ' ' }));
  assert.throws(() => validateFields(contract.inputs, { memberId: '00123', nickname: 'Trip', extra: true }));
});
