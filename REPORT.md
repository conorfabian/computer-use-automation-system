# 1. Architecture

The system turns an observed UI workflow into a reusable capability. A single Node.js application uses TypeScript, Playwright, Zod, and one OpenAI adapter. Discovery receives a natural-language goal, typed invocation values, screenshots, and a compact inventory of visible controls. The model chooses one constrained action at a time; it cannot generate code. The engine checks policy, acts, verifies the resulting state, and records the action. A model's `done` response cannot declare success without independent checks.

Replay consumes the saved JSON and typed arguments. It has no provider import or model recovery path. Discovery and replay share the browser adapter, condition evaluation, policy, and evidence writer. A plain local banking UI provides member search, details, a savings form, and review. Tables and weak label associations make structural targeting useful without manufacturing test IDs. All data is synthetic and page-local.

The contract is intentionally predeclared. The model discovers which visible controls to use, action order, and when the goal appears complete; the adapter captures metadata from the selected controls. Reviewed code defines input/output types, allowed application states, verified success, known business outcomes, bounded recovery, and safety policy. The model may discover navigation but cannot redefine trusted business semantics or safety from one successful run. This keeps each decision visible in a small module without a generalized agent framework.

# 2. Artifact schema

Zod validates a strict, versioned JSON contract: identity, description, application family/version, typed input/output descriptors, precondition, ordered steps, success condition, business outcomes, recoveries, safety declarations, and discovery provenance. Format and capability versions are separate. Cross-field validation rejects duplicate steps, undeclared references, and missing output extractions. The file contains no executable expressions.

Each step records an action, effect, precondition, checkpoint, and bounded timeout. Values use explicit input references, for example `{"input":"memberId"}`, instead of storing the member used in discovery. Target strategies use exact role/name, associated label, visible text, or a table-row caption plus control relationship. Discovery captures metadata from the actual selected control and confirms that the recorded strategy resolves back to it. Coordinates and viewport can be retained as provenance but are never used in replay.

The output contract declares status, member ID, nickname, and account type. The UI values are extracted and validated; final success also compares the displayed member and nickname to invocation values. This prevents a visually plausible but incorrect review screen from counting as success.

# 3. Determinism & error handling

Replay walks the recorded steps and resolves targets in a fixed order. Zero matches allow the next recorded strategy; multiple matches stop rather than selecting the first. Condition-based waiting replaces timing guesses. A click with an uncertain result is not blindly retried. Screen checkpoints and the application version banner detect incompatible states; this is conservative validation, not automatic drift repair.

The result is `success` with typed outputs, `business_outcome` with a code, or `failure` with step, expected state, observed context, and evidence. MEMBER_NOT_FOUND and PERMISSION_DENIED are legitimate terminal outcomes. A known warning has one permitted dismissal; a slow load has a bounded wait. Recovery events remain visible in the terminal result. Unknown states, failed checkpoints, ambiguous targets, or session locks can request intervention. Noninteractive execution fails explicitly when intervention is needed.

Structured JSONL events retain run/step identity, actor, timestamps, action, result, and evidence references. Browser failures omit raw exception text because it can include sensitive values. Rich evidence is a masked screenshot, with a sanitized fallback if capture is unavailable. Tests exercise both positive and negative paths against real Chromium. Genuine model evidence is distinguished from hand-authored fixtures and simulated-operator tests.

# 4. Heterogeneity & multi-tenant

`Surface` separates observing, capturing targets, acting, matching conditions, extracting values, and transferring control from workflow semantics. Playwright implements that boundary today. Desktop support would supply accessibility and coordinate perception, native control identities, and equivalent action/condition evaluation. Browser structural hints are explicitly browser-specific. A browser artifact is not automatically a portable desktop artifact.

The artifact identifies an application family and version; trusted runtime configuration supplies the deployment origin and policy. Institutions sharing a vendor version could reuse a reviewed capability. A future specialization would version a reviewed target/condition override against the base artifact, with isolated tenant configuration and regression runs. Failed identity/checkpoint checks would quarantine incompatible variants for review. No tenant registry, override engine, worker pool, or desktop adapter is implemented.

# 5. Escalation & handoff

Handoff uses headed Chromium and terminal input, not an operator dashboard. Automation completes its outstanding operation, records the reason and expected state, and changes ownership from AUTOMATION to HUMAN while keeping the exact page/context alive. The operator acts in that browser and types `resume` or `abort`. Resume rechecks policy and accepts only the verified before/after conditions. The engine cannot act while ownership is HUMAN. Human time is excluded from the automation deadline.

A session-lock scenario demonstrates recovery: the human clicks Unlock session, the original savings form appears, and automation proceeds to review. Page-level click/change/navigation events and before/after evidence preserve intervention context without recording field values. Events outside the page are not captured. Automated tests use a simulated operator and are explicitly not proof of a genuine human demonstration. Submitted run status is documented in `evidence/README.md`.

# 6. Safety

Trusted configuration allows exact origins/routes, action types, and named controls on each screen. Checks apply to the resolved control, not the LLM's proposed risk classification. External requests, unapproved navigation, popups, and downloads are blocked. Input values are passed as data. Create Account and Unlock session are human-only; the normal capability ends before account creation. There is no generic keypress or arbitrary-code action that could submit the form indirectly.

Sensitive inputs are references in artifacts and redacted in persisted logs/results. Trusted public UI text is classified separately so a nickname such as "Search" cannot parameterize a button label or corrupt protocol identifiers. Input fields and matching displayed values are masked in screenshots. API keys remain in ignored environment configuration. Raw prompts, model transcripts, browser traces, cookies, and storage dumps are not saved. The provider receives synthetic observations with response storage disabled; this is not a claim about all provider retention. The TypeScript caller receives extracted values in memory while CLI summaries are redacted.

These guards target a trusted local demonstration with known synthetic data. They are not a hardened OS sandbox, a complete PII detector, or a production banking authorization system. Human intervention does not rewrite artifacts or expand automation policy.

# 7. Cuts

No microservices, database, authentication, queues, tenant infrastructure, polished UI, arbitrary scripting, selector healing, coordinate replay, or optional capability catalog. The mock session lock is an interruption fixture, not authentication. Account creation is only a synthetic page state; automation never invokes it. One provider and one browser are enough to demonstrate the architecture.

With more time, prioritize reviewed artifact lifecycle/version compatibility, stronger data classification and visual redaction, and a desktop adapter against a real sandbox surface. Broad infrastructure would follow demonstrated workload needs. Evidence is never fabricated: missing live model or human runs are identified explicitly until performed.
