import type { Capability, Condition, Target } from './schema.js';
export const textTarget = (text: string): Target => ({ strategies: [{ by: 'text', text: { literal: text } }] });
export const rowTarget = (caption: string): Target => ({ strategies: [{ by: 'tableRow', caption: { literal: caption }, control: 'value' }] });
export const screen = (path: string, text: string): Condition => ({ all: [
  { kind: 'route', path }, { kind: 'text', text: { literal: text } },
] });
export const screens = {
  search: screen('/search', 'Member Search'), results: screen('/results', 'View member'),
  details: screen('/details', 'Member Details'), form: screen('/savings', 'Open Savings Sub-Account'),
  review: screen('/review', 'Review Savings Sub-Account'),
};
export type Screen = keyof typeof screens;
export const contract: Omit<Capability, 'steps' | 'provenance'> = {
  schemaVersion: 1, id: 'prepare-savings', capabilityVersion: '1.0.0',
  description: 'Find a member and prepare a savings sub-account for human review. Does not create an account.',
  application: { family: 'legacy-banking-demo', version: '1', entryRoute: '/search' },
  inputs: {
    memberId: { type: 'string', required: true, sensitive: true, format: 'memberId', minLength: 5, maxLength: 5 },
    nickname: { type: 'string', required: true, sensitive: true, format: 'trimmed', minLength: 1, maxLength: 30 },
  },
  outputs: {
    status: { type: 'string', required: true, sensitive: false, literal: 'READY_FOR_REVIEW' },
    memberId: { type: 'string', required: true, sensitive: true, format: 'memberId' },
    nickname: { type: 'string', required: true, sensitive: true, format: 'trimmed', maxLength: 30 },
    accountType: { type: 'string', required: true, sensitive: false, literal: 'SAVINGS' },
  },
  precondition: { all: [...screens.search.all, { kind: 'text', text: { literal: 'Ledger Office / Demo v1' } }] },
  successCondition: { all: [...screens.review.all,
    { kind: 'text', text: { literal: 'No account has been created.' } },
    { kind: 'equals', target: rowTarget('Member number'), read: 'text', value: { input: 'memberId' } },
    { kind: 'equals', target: rowTarget('Nickname'), read: 'text', value: { input: 'nickname' } },
    { kind: 'equals', target: rowTarget('Account type'), read: 'text', value: { literal: 'SAVINGS' } },
    { kind: 'equals', target: rowTarget('Status'), read: 'text', value: { literal: 'READY_FOR_REVIEW' } },
  ] },
  businessOutcomes: [
    { code: 'MEMBER_NOT_FOUND', when: screen('/results', 'MEMBER_NOT_FOUND') },
    { code: 'PERMISSION_DENIED', when: screen('/savings', 'PERMISSION_DENIED') },
  ],
  recoveries: [
    { kind: 'wait', code: 'SLOW_LOAD', when: screen('/results', 'Loading member records...'), maxMs: 4000 },
    { kind: 'dismiss', code: 'KNOWN_WARNING', when: screen('/savings', 'Notice: verify the member before continuing.'), target: { strategies: [{ by: 'role', role: 'button', name: { literal: 'Acknowledge' } }] }, maxAttempts: 1 },
  ],
  safety: { finalCreation: 'human-only', coordinateReplay: false },
};
