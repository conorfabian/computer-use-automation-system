import { parseArgs } from 'node:util';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { Policy, PolicySchema } from './policy.js';
import { PlaywrightSurface } from './playwright-surface.js';
import { Evidence } from './evidence.js';
import { terminalOperator } from './handoff.js';
import { replay } from './replay.js';
import { contract } from './contract.js';
import { validateFields } from './parameters.js';
import { RunError } from './schema.js';

let surface: PlaywrightSurface | undefined;
try {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    goal: { type: 'string' }, memberId: { type: 'string' }, nickname: { type: 'string' },
    url: { type: 'string', default: 'http://127.0.0.1:3000/search' },
    artifact: { type: 'string', default: 'evidence/capability.json' },
    evidence: { type: 'string' }, policy: { type: 'string', default: 'config/demo-policy.json' },
    headless: { type: 'boolean', default: false },
  } });
  const command = positionals[0];
  if (!['discover', 'replay'].includes(command ?? '')) throw new RunError('USAGE: discover|replay --memberId 12345 --nickname Vacation');
  const inputs = validateFields(contract.inputs, { memberId: values.memberId, nickname: values.nickname });
  const policy = new Policy(PolicySchema.parse(JSON.parse(await readFile(values.policy!, 'utf8'))));
  let provider;
  if (command === 'discover') {
    if (!values.goal) throw new RunError('GOAL_REQUIRED');
    const { OpenAIProvider } = await import('./llm/openai.js');
    provider = new OpenAIProvider(process.env.OPENAI_MODEL ?? '', process.env.OPENAI_API_KEY ?? '');
  }
  const artifact = command === 'replay' ? JSON.parse(await readFile(values.artifact!, 'utf8')) : null;
  const evidence = new Evidence(values.evidence ?? `evidence/${command === 'discover' ? 'discovery' : 'replay-success'}`, inputs, [process.env.OPENAI_API_KEY ?? ''], policy.publicText);
  await evidence.init();
  surface = await PlaywrightSurface.open(values.url!, policy, !values.headless);
  const operator = values.headless ? async () => { throw new RunError('INTERVENTION_REQUIRED'); } : terminalOperator;
  let result;
  if (command === 'discover' && provider) {
    const { discover } = await import('./discovery.js');
    await mkdir(dirname(values.artifact!), { recursive: true });
    result = await discover({ goal: values.goal!, values: inputs, surface, provider, policy, evidence, operator, artifactPath: values.artifact! });
  } else result = await replay(artifact, inputs, surface, evidence, operator, policy.config.deadlineMs);
  console.log(JSON.stringify(evidence.redact(result), null, 2));
  process.exitCode = result.status === 'failure' ? 1 : 0;
} catch (error) {
  console.error(JSON.stringify({ status: 'failure', code: error instanceof RunError ? error.code : 'SETUP_FAILED', detail: 'Check configuration, dependencies, and local demo server. Raw errors are omitted to protect secrets.' }));
  process.exitCode = 1;
} finally { await surface?.close(); }
