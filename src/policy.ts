import { z } from 'zod';
import { RunError } from './schema.js';
import type { Control } from './surface.js';
export const PolicySchema = z.strictObject({
  allowedOrigins: z.array(z.url()).min(1), allowedRoutes: z.array(z.string()).min(1),
  allowedActions: z.array(z.enum(['click', 'type', 'scroll', 'wait', 'extract', 'done', 'escalate'])),
  controls: z.array(z.strictObject({ route: z.string(), action: z.enum(['click', 'type']), name: z.string(), tag: z.enum(['input', 'button', 'a']) })),
  publicText: z.array(z.string()).default([]),
  humanOnlyControls: z.array(z.string()), maxSteps: z.number().int().min(1).max(25), deadlineMs: z.number().int().min(1000).max(180000),
});
export type PolicyConfig = z.infer<typeof PolicySchema>;
export class Policy {
  constructor(public config: PolicyConfig) {}
  get publicText() { return [...this.config.publicText, ...this.config.controls.map(control => control.name), ...this.config.humanOnlyControls]; }
  location(url: string): void {
    const parsed = new URL(url);
    if (parsed.username || parsed.password || !this.config.allowedOrigins.includes(parsed.origin) || !this.config.allowedRoutes.includes(parsed.pathname)) throw new RunError('POLICY_LOCATION_BLOCKED');
    // Scenario selection is a fixture allowed only at initial entry; never carries member data.
    for (const [key, value] of parsed.searchParams) if (parsed.pathname !== '/search' || key !== 'scenario' || !['normal', 'slow', 'warning', 'locked'].includes(value)) throw new RunError('POLICY_QUERY_BLOCKED');
    if (parsed.hash) throw new RunError('POLICY_LOCATION_BLOCKED');
  }
  request(url: string, method: string): boolean {
    try {
      const parsed = new URL(url);
      if (method !== 'GET' || parsed.username || parsed.password || !this.config.allowedOrigins.includes(parsed.origin)) return false;
      if (['/app.js', '/style.css', '/favicon.ico'].includes(parsed.pathname)) return !parsed.search && !parsed.hash;
      this.location(url); return true;
    } catch { return false; }
  }
  action(url: string, type: string, control?: Control): void {
    this.location(url);
    if (!this.config.allowedActions.includes(type as PolicyConfig['allowedActions'][number])) throw new RunError('POLICY_ACTION_BLOCKED');
    if (control && this.config.humanOnlyControls.includes(control.name)) throw new RunError('HUMAN_ONLY_ACTION');
    if (type === 'click' || type === 'type') {
      if (!control || !this.config.controls.some(rule => rule.route === new URL(url).pathname && rule.action === type && rule.name === control.name && rule.tag === control.tag)) throw new RunError('POLICY_CONTROL_BLOCKED');
      if (type === 'type' && control.inputType !== 'text') throw new RunError('POLICY_CONTROL_BLOCKED');
    }
  }
}
