import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { RunError, type Actor, type Inputs, type Result } from './schema.js';
import type { Surface } from './surface.js';

// These fields describe the engine protocol, not user-provided text. Keep links and IDs intact.
const protocolFields = new Set(['runId', 'timestamp', 'actor', 'step', 'stepId', 'action', 'result', 'code', 'type', 'by', 'kind', 'role', 'tag', 'control', 'read', 'input', 'output', 'route', 'path', 'evidence', 'artifact', 'model', 'requestId', 'status', 'reason']);

export class Evidence {
  readonly runId = randomUUID();
  readonly directory: string;
  private pending = Promise.resolve();
  private runtimeValues: string[];
  constructor(root: string, inputs: Inputs, private secretValues: string[] = [], private publicText: string[] = []) {
    this.directory = join(root, this.runId);
    this.runtimeValues = Object.values(inputs);
  }
  async init() { await mkdir(this.directory, { recursive: true }); }
  bindInputs(inputs: Inputs) {
    this.runtimeValues = [...new Set([...this.runtimeValues, ...Object.values(inputs)])];
  }
  allowPublicText(text: string[]) { this.publicText = text; }
  redact(value: unknown, key = ''): unknown {
    if (typeof value === 'string') {
      let result = value;
      const runtimeValues = protocolFields.has(key) || key === 'literal' && this.publicText.includes(value) ? [] : this.runtimeValues;
      for (const secret of [...runtimeValues, ...this.secretValues].filter(Boolean).sort((a, b) => b.length - a.length)) result = result.replaceAll(secret, '[REDACTED]');
      return result;
    }
    if (Array.isArray(value)) return value.map(v => this.redact(v));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, /^(authorization|cookie|token|password|apiKey)$/i.test(key) ? '[REDACTED]' : this.redact(v, key)]));
    return value;
  }
  event(actor: Actor, step: string, action: string, result: string, detail: Record<string, unknown> = {}) {
    const event = this.redact({ runId: this.runId, timestamp: new Date().toISOString(), actor, step, action, result, ...detail });
    this.pending = this.pending.then(() => appendFile(join(this.directory, 'events.jsonl'), `${JSON.stringify(event)}\n`));
    return this.pending;
  }
  async capture(surface: Surface, label: string) {
    const path = join(this.directory, `${label.replace(/[^a-zA-Z0-9_-]/g, '-')}.png`);
    return surface.evidence(path, [...this.runtimeValues, ...this.secretValues]);
  }
  async result(result: Result) {
    await this.pending;
    await writeFile(join(this.directory, 'result.json'), JSON.stringify(this.redact(result), null, 2) + '\n');
  }
  async artifact(artifact: unknown, path: string) {
    // Runtime values can coincide with public UI text or metadata (e.g. nickname 'Search' or 'a').
    // Inspect value literals rather than substring-redacting the artifact's protocol/description.
    const serialized = JSON.stringify(artifact);
    if (this.secretValues.filter(Boolean).some(secret => serialized.includes(secret))) throw new RunError('SENSITIVE_ARTIFACT');
    const check = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if ('literal' in value && typeof value.literal === 'string' && !this.publicText.includes(value.literal)) {
        const literal = value.literal;
        if (this.runtimeValues.filter(Boolean).some(input => literal.includes(input))) throw new RunError('SENSITIVE_ARTIFACT');
      }
      Object.values(value).forEach(check);
    };
    check(artifact);
    await writeFile(path, JSON.stringify(artifact, null, 2) + '\n');
  }
}
