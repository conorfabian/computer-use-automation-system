# Computer-Use Automation System

A small TypeScript implementation of **discover once, replay without a model**. A real LLM observes a local banking UI, chooses constrained actions, and records a typed capability. Deterministic replay accepts new inputs, verifies checkpoints, extracts outputs, and stops at review. It never clicks Create Account.

## Setup

Requires Node.js 22+ and npm. All banking data is synthetic; the demo has no external business API or persistent storage.

```sh
npm ci
npx playwright install chromium
cp .env.example .env
```

For discovery, configure `OPENAI_API_KEY` and `OPENAI_MODEL` in `.env`. Choose a Responses API model supporting images and structured outputs. The key is never committed. Screenshots and synthetic goal data are sent to OpenAI during discovery; requests use `store: false`. This flag is not a claim of zero provider retention.

Start the app in another terminal:

```sh
npm run demo
```

The app runs at http://127.0.0.1:3000/search. Policy uses this exact origin; `localhost` is deliberately not an alias. If changing the port, change `config/demo-policy.json` too.

## End-to-end demo

Generate the capability with genuine model decisions:

```sh
npm run discover -- \
  --goal 'Find member 12345, prepare a new savings sub-account with nickname Vacation, and reach the review screen.' \
  --memberId 12345 --nickname Vacation
```

The goal expresses intent; explicit typed parameters provide the reusable invocation contract. The model chooses visible controls, action order, and when the goal appears complete; the adapter captures reusable metadata from those controls. Reviewed code defines input/output types, allowed application states, verified success, known business outcomes, bounded recovery, and safety. The model discovers navigation without redefining trusted business semantics. A verified run writes `evidence/capability.json`.

Replay with different inputs:

```sh
env OPENAI_API_KEY= OPENAI_MODEL= npm run replay -- --memberId 67890 --nickname Emergency
```

Replay does not import the OpenAI adapter and needs no key or model access. `src/cli.ts` dynamically imports the provider only for `discover`; replay and its recovery path use deterministic code. Empty environment variables override any discovery credentials in `.env`. Browser requests are restricted to the configured local application. The default is headed Chromium; use `--headless` for automated checks. CLI output and persisted results redact member IDs and nicknames; the TypeScript `replay()` result returns typed values in memory.

Exercise explicit business outcomes:

```sh
npm run replay -- --memberId 99999 --nickname Vacation --evidence evidence/replay-error
npm run replay -- --memberId 54321 --nickname Vacation --evidence evidence/replay-error
```

Exercise bounded recovery:

```sh
npm run replay -- --memberId 12345 --nickname Vacation --url 'http://127.0.0.1:3000/search?scenario=slow' --evidence evidence/replay-recovery
npm run replay -- --memberId 12345 --nickname Vacation --url 'http://127.0.0.1:3000/search?scenario=warning' --evidence evidence/replay-recovery
```

Exercise **real human takeover** in an interactive terminal:

```sh
npm run replay -- --memberId 12345 --nickname Vacation --url 'http://127.0.0.1:3000/search?scenario=locked' --evidence evidence/handoff
```

When the terminal reports HUMAN control, click **Unlock session** in the existing browser. Type `resume` in the terminal. Automation rechecks the screen and finishes at review. `abort` stops the run. Do not close or refresh the page: session state is intentionally in memory. Headless/noninteractive runs return `INTERVENTION_REQUIRED` instead of pretending a human participated.

## What to inspect

- `src/schema.ts`: versioned JSON artifact, action unions, typed fields, references, targets, and conditions.
- `src/contract.ts`: reviewed inputs, outputs, success condition, business outcomes, and recovery rules. No ordered happy path.
- `src/discovery.ts` / `src/llm/openai.ts`: live observe–decide–act loop and the only provider dependency.
- `src/replay.ts`: deterministic execution and structured results.
- `src/playwright-surface.ts`: weak-markup perception, target capture, and deterministic resolution.
- `src/policy.ts` / `config/demo-policy.json`: trusted policy, separate from model and artifact.
- `src/handoff.ts`: browser ownership and validated resume.
- `REPORT.md`: design rationale and deliberate limits.

The surface interface exposes observations/actions/conditions, not Playwright objects. Its implementation exposes a page only to integration tests. No test IDs or private demo state are read by automation.

## Artifact and evidence

`schemaVersion` versions the serialization format; `capabilityVersion` versions behavior. Trusted public UI text is declared in policy so values matching button labels remain data rather than rewriting targets. Input references such as `{"input":"memberId"}` are substituted as values, never interpolated into code. Targets contain ordered semantic/structural strategies and optional discovery coordinates. Replay requires exactly one visible stable match and never uses coordinate fallback.

Every run gets a UUID directory with `events.jsonl`, `result.json`, and masked screenshots. Events include run ID, time, actor, step, action, result, reason where applicable, and evidence references. Model response IDs establish provider-call provenance without retaining raw transcripts. Business outcomes use exit code 0; failures use 1.

`tests/fixture.ts` is explicitly hand-authored test data. `.tmp/tests` contains automated verification, including a **simulated operator**; it is not submitted as genuine discovery or human evidence. See `evidence/README.md` for the genuine successful discovery, changed-input replay, business outcomes, recovery runs, and real human handoff.

## Verification

```sh
npm run typecheck
npm test
```

Tests need Chromium but no model access. They cover artifact validation, parameter binding, policy blocking, checkpoints, multiple inputs, business outcomes, slow-load/warning recovery, and same-session handoff. These are ordinary Node tests with Playwright; no test framework or mocked banking API is required.

Provider integration follows the official [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) and [image inputs](https://developers.openai.com/api/docs/guides/images-vision) documentation.

## Limits

One app, one browser, one capability, one model provider. No desktop adapter, tenant service, artifact approval workflow, unattended account creation, automatic selector healing, or arbitrary code execution. The UI is deliberately basic. Synthetic creation is an in-page state change, not a real bank transaction. Browser-side control checks protect this constrained demonstration, not a hostile application or OS. Human action capture covers page clicks/field changes/navigation; it is not full screen recording or an OS audit trail.
