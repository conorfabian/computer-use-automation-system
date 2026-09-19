import { z } from 'zod';
import type { Fields, Inputs, Value } from './schema.js';
import { RunError } from './schema.js';

export function validateFields(fields: Fields, values: unknown): Inputs {
  const shape: Record<string, z.ZodString> = {};
  for (const [key, field] of Object.entries(fields)) {
    let validator = z.string().min(field.minLength ?? 0).max(field.maxLength ?? 200);
    if (field.format === 'memberId') validator = validator.regex(/^\d{5}$/);
    if (field.format === 'trimmed') validator = validator.trim().min(1);
    if (field.literal !== undefined) validator = validator.refine(v => v === field.literal);
    shape[key] = validator;
  }
  const result = z.strictObject(shape).safeParse(values);
  if (!result.success) throw new RunError('INVALID_VALUES', Object.keys(fields), 'Values do not match the declared contract');
  return result.data;
}
export function resolveValue(value: Value, inputs: Inputs): string {
  if ('literal' in value) return value.literal;
  if (!Object.hasOwn(inputs, value.input)) throw new RunError('MISSING_INPUT', value.input);
  return inputs[value.input]!;
}
// Capture whole values as references. Never perform interpolation inside selector code.
export function parameterize(value: string, inputs: Inputs, publicText: string[] = []): Value {
  // A UI caption named Search stays Search even when that is also the nickname.
  if (publicText.includes(value)) return { literal: value };
  const matches = Object.entries(inputs).filter(([, runtime]) => value === runtime);
  if (matches.length > 1) throw new RunError('AMBIGUOUS_PARAMETER');
  if (matches.length === 1) return { input: matches[0]![0] };
  if (Object.values(inputs).some(runtime => value.includes(runtime))) throw new RunError('SENSITIVE_TARGET', null, 'Choose a non-sensitive structural anchor');
  return { literal: value };
}
