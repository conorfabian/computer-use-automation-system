import { CapabilitySchema, RunError, type Capability, type Inputs, type Result, type Step } from './schema.js';
import { validateFields } from './parameters.js';
import type { Surface } from './surface.js';
import { BusinessOutcome, Conditions } from './conditions.js';
import { handoff, type Operator } from './handoff.js';
import type { Evidence } from './evidence.js';

const interventionCodes = new Set(['SESSION_LOCKED', 'TARGET_NOT_FOUND', 'AMBIGUOUS_TARGET', 'CHECKPOINT_FAILED', 'HUMAN_ONLY_ACTION']);
export async function replay(raw: unknown, values: unknown, surface: Surface, evidence: Evidence, operator: Operator, deadlineMs = 180000): Promise<Result> {
  let stepId = 'validation';
  let conditions: Conditions | undefined;
  let current: Step | undefined;
  const base = () => ({ runId: evidence.runId, evidence: evidence.directory, recoveries: conditions?.recovered ?? [] });
  try {
    const parsed = CapabilitySchema.safeParse(raw);
    if (!parsed.success) throw new RunError('INVALID_ARTIFACT', null, 'Schema or reference validation failed');
    const artifact: Capability = parsed.data;
    const inputs = validateFields(artifact.inputs, values);
    evidence.bindInputs(inputs);
    let deadline = Date.now() + deadlineMs;
    conditions = new Conditions(surface, artifact, inputs, evidence, 'replay', () => deadline);
    const outputs: Inputs = {};
    await conditions.wait(artifact.precondition, inputs, 3000, 'entry');
    for (const step of artifact.steps) {
      current = step; stepId = step.id;
      if (Date.now() > deadline) throw new RunError('RUN_TIMEOUT');
      let executed = false;
      try {
        await conditions.wait(step.before, inputs, step.timeoutMs, stepId);
        await evidence.event('replay', stepId, step.action.type, 'started', { actionSpec: step.action });
        const value = await surface.execute(step.action, inputs);
        executed = true;
        if (step.action.type === 'extract' && value !== undefined) outputs[step.action.output] = value;
        if (step.action.type === 'wait') await conditions.wait(step.action.condition, inputs, step.timeoutMs, stepId);
        await conditions.wait(step.checkpoint, inputs, step.timeoutMs, stepId);
      } catch (error) {
        if (!(error instanceof RunError) || !interventionCodes.has(error.code)) throw error;
        const resumed = await handoff(surface, evidence, inputs, { stepId, reason: error.code, expected: step.checkpoint, before: step.before }, operator);
        deadline += resumed.pausedMs;
        if (resumed.state === 'before') {
          // Never replay a possibly executed mutation. Human must establish its postcondition.
          if (executed && step.action.type === 'click') throw new RunError('UNCERTAIN_ACTION_STATE');
          const value = await surface.execute(step.action, inputs);
          if (step.action.type === 'extract' && value !== undefined) outputs[step.action.output] = value;
        } else if (step.action.type === 'extract') {
          const value = await surface.execute(step.action, inputs);
          if (value !== undefined) outputs[step.action.output] = value;
        }
        if (step.action.type === 'wait') await conditions.wait(step.action.condition, inputs, step.timeoutMs, stepId);
        await conditions.wait(step.checkpoint, inputs, step.timeoutMs, stepId);
      }
      await evidence.event('replay', stepId, step.action.type, 'verified');
    }
    stepId = 'success';
    if (Date.now() >= deadline) throw new RunError('RUN_TIMEOUT');
    await conditions.wait(artifact.successCondition, inputs, 3000, stepId);
    const result: Result = { ...base(), status: 'success', outputs: validateFields(artifact.outputs, outputs) };
    const path = await evidence.capture(surface, 'success');
    await evidence.event('replay', stepId, 'complete', 'success', { evidence: path });
    await evidence.result(result); return result;
  } catch (error) {
    const result: Result = error instanceof BusinessOutcome
      ? { ...base(), status: 'business_outcome', code: error.code, stepId }
      : { ...base(), status: 'failure', code: error instanceof RunError ? error.code : 'EXECUTION_FAILED', stepId,
          expected: error instanceof RunError ? error.expected ?? current?.checkpoint ?? null : current?.checkpoint ?? null,
          observed: error instanceof RunError ? error.observed ?? { route: safeRoute(surface) } : { route: safeRoute(surface), detail: 'Browser operation failed; raw exception omitted to protect data' } };
    const path = await evidence.capture(surface, stepId + '-stopped');
    await evidence.event('replay', stepId, 'stop', result.status, { code: result.code, evidence: path });
    await evidence.result(result); return result;
  }
}
function safeRoute(surface: Surface) { try { return new URL(surface.location()).pathname; } catch { return 'unavailable'; } }
