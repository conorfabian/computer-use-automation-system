import { RunError, type Action, type Inputs, type Result, type Step } from './schema.js';
import { validateFields } from './parameters.js';
import { contract, screens } from './contract.js';
import { BusinessOutcome, Conditions } from './conditions.js';
import { recordCapability } from './recorder.js';
import { handoff, type Operator } from './handoff.js';
import type { Surface } from './surface.js';
import type { Evidence } from './evidence.js';
import type { DecisionProvider } from './llm/openai.js';
import type { Policy } from './policy.js';

export async function discover(options: { goal: string; values: unknown; surface: Surface; provider: DecisionProvider; policy: Policy; evidence: Evidence; operator: Operator; artifactPath: string }): Promise<Result> {
  const { surface, evidence, provider, policy, operator } = options;
  let stepId = 'entry';
  const steps: Step[] = [];
  const history: { action: string; result: string }[] = [];
  let conditions: Conditions | undefined;
  const base = () => ({ runId: evidence.runId, evidence: evidence.directory, recoveries: conditions?.recovered ?? [] });
  try {
    const inputs = validateFields(contract.inputs, options.values);
    evidence.bindInputs(inputs);
    evidence.allowPublicText(policy.publicText);
    const outputs: Inputs = {};
    let deadline = Date.now() + policy.config.deadlineMs;
    conditions = new Conditions(surface, contract, inputs, evidence, 'LLM', () => deadline);
    let before = contract.precondition;
    let previousText = '';
    let stagnant = 0;
    await conditions.wait(before, inputs, 3000, stepId);
    for (let i = 0; i < policy.config.maxSteps; i++) {
      stepId = `step-${i + 1}`;
      if (Date.now() >= deadline) throw new RunError('RUN_TIMEOUT');
      await conditions.inspect(stepId);
      const observation = await surface.observe();
      stagnant = observation.text === previousText ? stagnant + 1 : 0;
      previousText = observation.text;
      if (stagnant >= 5) {
        const resumed = await handoff(surface, evidence, inputs, { stepId, reason: 'NO_PROGRESS', expected: before, before }, operator);
        deadline += resumed.pausedMs; stagnant = 0; continue;
      }
      const { decision, requestId } = await provider.decide({ goal: options.goal, inputs, observation, history: history.slice(-6), completedOutputs: Object.keys(outputs), remainingMs: deadline - Date.now() });
      if (Date.now() >= deadline) throw new RunError('RUN_TIMEOUT');
      policy.action(surface.location(), ['click', 'type'].includes(decision.action.type) ? 'wait' : decision.action.type);
      const screenshot = await evidence.capture(surface, stepId + '-before');
      await evidence.event('LLM', stepId, decision.action.type, 'decided', { reason: decision.reason, requestId, model: provider.model, evidence: screenshot });
      const chosen = decision.action;
      if (chosen.type === 'done') {
        await conditions.wait(contract.successCondition, inputs, 3000, stepId);
        const typedOutputs = validateFields(contract.outputs, outputs);
        const artifact = recordCapability(steps, { source: provider.source, runId: evidence.runId, provider: provider.source === 'live-discovery' ? 'openai' : 'test', model: provider.model, createdAt: new Date().toISOString() });
        await evidence.artifact(artifact, options.artifactPath);
        const result: Result = { ...base(), status: 'success', outputs: typedOutputs };
        await evidence.event('LLM', stepId, 'complete', 'success', { evidence: await evidence.capture(surface, 'success'), artifact: options.artifactPath });
        await evidence.result(result); return result;
      }
      if (chosen.type === 'escalate') {
        const resumed = await handoff(surface, evidence, inputs, { stepId, reason: 'MODEL_ESCALATION', expected: before, before }, operator);
        deadline += resumed.pausedMs;
        history.push({ action: 'escalate', result: 'resumed' }); continue;
      }
      let action: Action;
      if (chosen.type === 'wait') action = { type: 'wait', condition: screens[chosen.expectedScreen] };
      else if (chosen.type === 'scroll') action = { type: 'scroll', direction: chosen.direction, pixels: chosen.pixels };
      else {
        const target = await surface.captureTarget(observation.id, chosen.target, inputs);
        if (chosen.type === 'click') action = { type: 'click', target };
        else if (chosen.type === 'type') action = { type: 'type', target, value: { input: chosen.input } };
        else action = { type: 'extract', target, read: 'text', output: chosen.output };
      }
      const checkpoint = structuredClone(screens[chosen.expectedScreen]);
      if (action.type === 'type') checkpoint.all.push({ kind: 'equals', target: action.target, read: 'value', value: action.value });
      const step: Step = { id: stepId, action, before, checkpoint, timeoutMs: 5000, effect: ['click', 'type'].includes(action.type) ? 'reversible' : 'read' };
      let value: string | undefined;
      try {
        value = await surface.execute(action, inputs);
        if (action.type === 'wait') await conditions.wait(action.condition, inputs, 5000, stepId);
        await conditions.wait(checkpoint, inputs, 5000, stepId);
      } catch (error) {
        if (!(error instanceof RunError) || !['SESSION_LOCKED', 'CHECKPOINT_FAILED', 'HUMAN_ONLY_ACTION'].includes(error.code)) throw error;
        const resumed = await handoff(surface, evidence, inputs, { stepId, reason: error.code, expected: checkpoint, before }, operator);
        deadline += resumed.pausedMs;
        // A handoff cannot authorize the recorder to pretend a blocked action was automated.
        if (error.code === 'HUMAN_ONLY_ACTION' || resumed.state !== 'after') throw new RunError('DISCOVERY_RESTART_REQUIRED');
      }
      if (action.type === 'extract' && value !== undefined) outputs[action.output] = value;
      steps.push(step); before = checkpoint;
      history.push({ action: chosen.type, result: `Verified ${chosen.expectedScreen}${chosen.type === 'extract' ? `; extracted ${chosen.output}` : chosen.type === 'type' ? `; entered ${chosen.input}` : ''}` });
      await evidence.event('LLM', stepId, action.type, 'verified', { actionSpec: action, checkpoint });
    }
    throw new RunError('STEP_LIMIT');
  } catch (error) {
    const result: Result = error instanceof BusinessOutcome
      ? { ...base(), status: 'business_outcome', code: error.code, stepId }
      : { ...base(), status: 'failure', code: error instanceof RunError ? error.code : 'DISCOVERY_FAILED', stepId,
        expected: error instanceof RunError ? error.expected : null,
        observed: error instanceof RunError ? error.observed : 'Unexpected error; raw details omitted to protect data' };
    await evidence.event('LLM', stepId, 'stop', result.status, { code: result.code, evidence: await evidence.capture(surface, stepId + '-stopped') });
    await evidence.result(result); return result;
  }
}
