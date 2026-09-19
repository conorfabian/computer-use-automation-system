import { setTimeout as delay } from 'node:timers/promises';
import type { Actor, Capability, Condition, Inputs } from './schema.js';
import { RunError } from './schema.js';
import type { Surface } from './surface.js';
import type { Evidence } from './evidence.js';

export class BusinessOutcome extends Error {
  constructor(public code: 'MEMBER_NOT_FOUND' | 'PERMISSION_DENIED') { super(code); }
}
export class Conditions {
  readonly recovered: string[] = [];
  private dismissed = new Set<string>();
  private loadingStarted?: number;
  constructor(private surface: Surface, private artifact: Pick<Capability, 'businessOutcomes' | 'recoveries'>, private inputs: Inputs, private evidence: Evidence, private actor: Actor, private runDeadline: () => number = () => Infinity) {}
  async inspect(stepId: string) {
    if (Date.now() >= this.runDeadline()) throw new RunError('RUN_TIMEOUT');
    for (const outcome of this.artifact.businessOutcomes) if (await this.surface.matches(outcome.when, this.inputs)) throw new BusinessOutcome(outcome.code);
    for (const recovery of this.artifact.recoveries) {
      if (!await this.surface.matches(recovery.when, this.inputs)) {
        if (recovery.kind === 'wait' && this.loadingStarted !== undefined) {
          this.loadingStarted = undefined;
          this.recovered.push(recovery.code);
          await this.evidence.event(this.actor, stepId, 'recover', 'recovered', { code: recovery.code });
        }
        continue;
      }
      if (recovery.kind === 'dismiss') {
        if (this.dismissed.has(recovery.code)) throw new RunError('RECOVERY_EXHAUSTED');
        this.dismissed.add(recovery.code);
        await this.surface.execute({ type: 'click', target: recovery.target }, this.inputs);
        this.recovered.push(recovery.code);
        await this.evidence.event(this.actor, stepId, 'recover', 'dismissed', { code: recovery.code });
      } else {
        if (this.loadingStarted === undefined) {
          this.loadingStarted = Date.now();
          await this.evidence.event(this.actor, stepId, 'recover', 'waiting', { code: recovery.code });
        }
        if (Date.now() - this.loadingStarted > recovery.maxMs) throw new RunError('RECOVERY_EXHAUSTED');
      }
    }
    if (new URL(this.surface.location()).pathname === '/locked') throw new RunError('SESSION_LOCKED');
  }
  async wait(condition: Condition, inputs: Inputs, timeoutMs: number, stepId: string) {
    const deadline = Math.min(Date.now() + timeoutMs, this.runDeadline());
    do {
      await this.inspect(stepId);
      if (await this.surface.matches(condition, inputs)) {
        if (Date.now() >= this.runDeadline()) throw new RunError('RUN_TIMEOUT');
        return;
      }
      await delay(100);
    } while (Date.now() < deadline);
    if (Date.now() >= this.runDeadline()) throw new RunError('RUN_TIMEOUT');
    throw new RunError('CHECKPOINT_FAILED', condition, 'Expected condition not observed before deadline');
  }
}
