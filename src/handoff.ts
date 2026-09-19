import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import type { Condition, Inputs } from './schema.js';
import { RunError } from './schema.js';
import type { Surface } from './surface.js';
import type { Evidence } from './evidence.js';

export type Intervention = { stepId: string; reason: string; expected: Condition; before: Condition };
export type Operator = (request: Intervention) => Promise<'resume' | 'abort'>;
export const terminalOperator: Operator = async request => {
  if (!stdin.isTTY) throw new RunError('INTERVENTION_REQUIRED');
  console.log(`\nHUMAN control: ${request.reason} at ${request.stepId}.\nUse the existing browser. For a locked session, click Unlock session. Then type resume or abort.`);
  const terminal = createInterface({ input: stdin, output: stdout });
  try {
    for (;;) { const command = (await terminal.question('handoff> ')).trim(); if (command === 'resume' || command === 'abort') return command; }
  } finally { terminal.close(); }
};
export async function handoff(surface: Surface, evidence: Evidence, inputs: Inputs, request: Intervention, operator: Operator): Promise<{ state: 'before' | 'after'; pausedMs: number }> {
  const start = Date.now();
  const path = await evidence.capture(surface, `${request.stepId}-handoff-before`);
  await evidence.event('human', request.stepId, 'intervention', 'requested', { reason: request.reason, capability: 'prepare-savings', expected: request.expected, evidence: path });
  surface.onHumanEvent(event => { void evidence.event('human', request.stepId, 'interaction', 'observed', { interaction: event }); });
  await surface.setOwner('HUMAN');
  await evidence.event('human', request.stepId, 'control-transfer', 'HUMAN');
  try {
    if (await operator(request) === 'abort') throw new RunError('HUMAN_ABORTED');
    await surface.setOwner('AUTOMATION');
    await evidence.event('human', request.stepId, 'control-transfer', 'AUTOMATION');
    const after = await evidence.capture(surface, `${request.stepId}-handoff-after`);
    await evidence.event('human', request.stepId, 'resume', 'checking', { evidence: after });
    if (await surface.matches(request.expected, inputs)) return { state: 'after', pausedMs: Date.now() - start };
    if (await surface.matches(request.before, inputs)) return { state: 'before', pausedMs: Date.now() - start };
    throw new RunError('RESUME_STATE_REJECTED', request.expected, 'Neither verified resume condition holds');
  } catch (error) {
    await surface.setOwner('STOPPED').catch(() => {});
    throw error;
  } finally { surface.onHumanEvent(() => {}); }
}
