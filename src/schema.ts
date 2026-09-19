import { z } from 'zod';

const name = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
export const ValueSchema = z.union([
  z.strictObject({ input: name }),
  z.strictObject({ literal: z.string().max(200) }),
]);
export const StrategySchema = z.discriminatedUnion('by', [
  z.strictObject({ by: z.literal('role'), role: z.enum(['button', 'link', 'textbox']), name: ValueSchema }),
  z.strictObject({ by: z.literal('label'), text: ValueSchema }),
  z.strictObject({ by: z.literal('text'), text: ValueSchema }),
  z.strictObject({ by: z.literal('tableRow'), caption: ValueSchema, control: z.enum(['input', 'button', 'a', 'value']) }),
]);
export const TargetSchema = z.strictObject({
  strategies: z.array(StrategySchema).min(1).max(4),
  discovery: z.strictObject({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
});
export const PredicateSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('route'), path: z.string().regex(/^\/[a-z/-]*$/) }),
  z.strictObject({ kind: z.literal('text'), text: ValueSchema }),
  z.strictObject({ kind: z.literal('visible'), target: TargetSchema }),
  z.strictObject({ kind: z.literal('equals'), target: TargetSchema, read: z.enum(['text', 'value']), value: ValueSchema }),
]);
export const ConditionSchema = z.strictObject({ all: z.array(PredicateSchema).min(1).max(12) });
export const ActionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('click'), target: TargetSchema }),
  z.strictObject({ type: z.literal('type'), target: TargetSchema, value: ValueSchema }),
  z.strictObject({ type: z.literal('scroll'), direction: z.enum(['up', 'down']), pixels: z.number().int().min(1).max(800) }),
  z.strictObject({ type: z.literal('wait'), condition: ConditionSchema }),
  z.strictObject({ type: z.literal('extract'), target: TargetSchema, read: z.enum(['text', 'value']), output: name }),
]);
export const StepSchema = z.strictObject({
  id: name, action: ActionSchema, effect: z.enum(['read', 'reversible', 'irreversible']),
  before: ConditionSchema, checkpoint: ConditionSchema, timeoutMs: z.number().int().min(100).max(15000),
});
const FieldSchema = z.strictObject({
  type: z.literal('string'), required: z.literal(true), sensitive: z.boolean(),
  minLength: z.number().int().min(0).max(200).optional(),
  maxLength: z.number().int().min(1).max(200).optional(),
  format: z.enum(['memberId', 'trimmed']).optional(), literal: z.string().max(100).optional(),
});
export const CapabilitySchema = z.strictObject({
  schemaVersion: z.literal(1), id: name, capabilityVersion: z.literal('1.0.0'), description: z.string().max(300),
  application: z.strictObject({ family: z.literal('legacy-banking-demo'), version: z.literal('1'), entryRoute: z.literal('/search') }),
  inputs: z.record(name, FieldSchema), outputs: z.record(name, FieldSchema),
  precondition: ConditionSchema, steps: z.array(StepSchema).min(1).max(25), successCondition: ConditionSchema,
  businessOutcomes: z.array(z.strictObject({ code: z.enum(['MEMBER_NOT_FOUND', 'PERMISSION_DENIED']), when: ConditionSchema })).max(2),
  recoveries: z.array(z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('wait'), code: z.literal('SLOW_LOAD'), when: ConditionSchema, maxMs: z.number().int().min(100).max(5000) }),
    z.strictObject({ kind: z.literal('dismiss'), code: z.literal('KNOWN_WARNING'), when: ConditionSchema, target: TargetSchema, maxAttempts: z.literal(1) }),
  ])).max(2),
  safety: z.strictObject({ finalCreation: z.literal('human-only'), coordinateReplay: z.literal(false) }),
  provenance: z.strictObject({ source: z.enum(['live-discovery', 'test-fixture']), runId: z.string(), provider: z.string(), model: z.string(), createdAt: z.iso.datetime() }),
}).superRefine((artifact, ctx) => {
  const ids = artifact.steps.map(s => s.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Duplicate step IDs' });
  const checkRefs = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if ('input' in value && typeof value.input === 'string' && !Object.hasOwn(artifact.inputs, value.input)) {
      ctx.addIssue({ code: 'custom', message: 'Undeclared input reference' });
    }
    Object.values(value).forEach(checkRefs);
  };
  checkRefs(artifact);
  const extractions = artifact.steps.flatMap(s => s.action.type === 'extract' ? [s.action.output] : []);
  for (const output of Object.keys(artifact.outputs)) {
    if (extractions.filter(x => x === output).length !== 1) ctx.addIssue({ code: 'custom', message: 'Each output requires exactly one extraction' });
  }
  if (extractions.some(key => !Object.hasOwn(artifact.outputs, key))) ctx.addIssue({ code: 'custom', message: 'Undeclared output' });
});
export type Value = z.infer<typeof ValueSchema>;
export type Target = z.infer<typeof TargetSchema>;
export type Strategy = z.infer<typeof StrategySchema>;
export type Condition = z.infer<typeof ConditionSchema>;
export type Action = z.infer<typeof ActionSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Capability = z.infer<typeof CapabilitySchema>;
export type Fields = Capability['inputs'];
export type Inputs = Record<string, string>;
export type Actor = 'LLM' | 'replay' | 'human';
export type Result = {
  runId: string; evidence: string; recoveries: string[];
} & (
  | { status: 'success'; outputs: Inputs }
  | { status: 'business_outcome'; code: 'MEMBER_NOT_FOUND' | 'PERMISSION_DENIED'; stepId: string }
  | { status: 'failure'; code: string; stepId: string; expected: unknown; observed: unknown }
);
export class RunError extends Error {
  constructor(public code: string, public expected: unknown = null, public observed: unknown = null) { super(code); }
}
