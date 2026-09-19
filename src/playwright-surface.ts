import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { RunError, type Action, type Condition, type Inputs, type Strategy, type Target } from './schema.js';
import { parameterize, resolveValue } from './parameters.js';
import type { Choice, Control, Observation, Surface } from './surface.js';
import { Policy } from './policy.js';

const controlsSelector = 'button,a,input,select,textarea,tr > td:nth-child(2):not(:has(input,button,a,select,textarea))';
// This function runs in the browser. It reads generic markup, not demo internals.
function describe(el: Element): Control {
  const text = (el.textContent ?? '').trim();
  const input = el as HTMLInputElement;
  const label = input.labels ? [...input.labels].map(l => l.textContent?.trim() ?? '').join(' ') : '';
  const caption = el.closest('tr')?.querySelector(':scope > td:first-child')?.textContent?.trim() ?? '';
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role') ?? (tag === 'button' ? 'button' : tag === 'a' ? 'link' : tag === 'input' ? 'textbox' : '');
  return { name: el.getAttribute('aria-label') || label || (tag === 'input' ? caption : text), tag, role, label, caption, text, inputType: input.type ?? '' };
}
export class PlaywrightSurface implements Surface {
  private owner: 'AUTOMATION' | 'HUMAN' | 'STOPPED' = 'AUTOMATION';
  private observation?: { id: string; url: string; text: string; refs: Map<string, { locator: Locator; control: Control }> };
  private humanListener: (event: Record<string, unknown>) => void = () => {};
  private policyViolation = false;
  private constructor(public readonly page: Page, private browser: Browser, private policy: Policy) {}
  static async open(url: string, policy: Policy, headed = true): Promise<PlaywrightSurface> {
    policy.location(url);
    const browser = await chromium.launch({ headless: !headed });
    try {
      const context = await browser.newContext({ viewport: { width: 1100, height: 760 }, acceptDownloads: false, serviceWorkers: 'block' });
      context.setDefaultTimeout(2000);
      context.setDefaultNavigationTimeout(10000);
      const page = await context.newPage();
      const surface = new PlaywrightSurface(page, browser, policy);
      await context.route('**/*', async route => {
        if (!policy.request(route.request().url(), route.request().method())) {
          surface.policyViolation = true; await route.abort();
        } else await route.continue();
      });
      await context.exposeBinding('__recordHuman', (_source, event: Record<string, unknown>) => {
        if (surface.owner === 'HUMAN') {
          const allowedNames = [...policy.config.humanOnlyControls, ...policy.config.controls.map(c => c.name)];
          surface.humanListener({ action: ['click', 'change'].includes(String(event.action)) ? event.action : 'unknown',
            tag: ['button', 'a', 'input', 'select', 'textarea'].includes(String(event.tag)) ? event.tag : 'unknown',
            route: policy.config.allowedRoutes.includes(String(event.route)) ? event.route : 'unapproved',
            control: allowedNames.includes(String(event.control)) ? event.control : 'field-or-unknown', trusted: event.trusted === true });
        }
      });
      await context.addInitScript(() => {
        const scope = window as unknown as { __recordHuman: (event: unknown) => Promise<void> };
        for (const type of ['click', 'change']) document.addEventListener(type, event => {
          if (!(event.target instanceof Element)) return;
          const el = event.target.closest('button,a,input,select,textarea');
          if (!el) return;
          // Only report interaction shape. No values, page text, URLs with query strings, or credentials.
          void scope.__recordHuman({ action: type, tag: el.tagName.toLowerCase(), route: location.pathname,
            control: el.tagName === 'BUTTON' ? el.textContent?.trim() : 'field', trusted: event.isTrusted });
        }, true);
      });
      page.on('framenavigated', frame => {
        if (frame === page.mainFrame() && surface.owner === 'HUMAN') surface.humanListener({ action: 'navigate', route: policy.config.allowedRoutes.includes(new URL(frame.url()).pathname) ? new URL(frame.url()).pathname : 'unapproved' });
      });
      context.on('page', popup => { if (popup !== page) { surface.policyViolation = true; void popup.close(); } });
      page.on('download', download => { surface.policyViolation = true; void download.cancel(); });
      await page.goto(url);
      return surface;
    } catch (error) { await browser.close(); throw error; }
  }
  location() { return this.page.url(); }
  private guard() {
    if (this.owner !== 'AUTOMATION') throw new RunError('CONTROL_NOT_OWNED');
    if (this.policyViolation) throw new RunError('POLICY_NETWORK_BLOCKED');
    this.policy.location(this.location());
  }
  private async locator(strategy: Strategy, inputs: Inputs): Promise<Locator> {
    if (strategy.by === 'role') return this.page.getByRole(strategy.role, { name: resolveValue(strategy.name, inputs), exact: true });
    if (strategy.by === 'label') return this.page.getByLabel(resolveValue(strategy.text, inputs), { exact: true });
    if (strategy.by === 'text') return this.page.getByText(resolveValue(strategy.text, inputs), { exact: true });
    const row = this.page.locator('tr').filter({ has: this.page.locator(':scope > td:first-child').filter({ hasText: new RegExp(`^${escapeRegex(resolveValue(strategy.caption, inputs))}$`) }) });
    return strategy.control === 'value' ? row.locator(':scope > td:nth-child(2)') : row.locator(strategy.control);
  }
  async resolve(target: Target, inputs: Inputs): Promise<Locator> {
    for (const strategy of target.strategies) {
      const locator = (await this.locator(strategy, inputs)).filter({ visible: true });
      const count = await locator.count();
      if (count > 1) throw new RunError('AMBIGUOUS_TARGET', target, 'Multiple visible matches');
      if (count === 1) return locator;
    }
    throw new RunError('TARGET_NOT_FOUND', target, 'No visible match');
  }
  async observe(): Promise<Observation> {
    this.guard();
    const id = randomUUID();
    const inventory: Observation['controls'] = [];
    const refs = new Map<string, { locator: Locator; control: Control }>();
    for (const locator of await this.page.locator(controlsSelector).all()) {
      if (!(await locator.isVisible())) continue;
      const bounds = await locator.boundingBox(); if (!bounds) continue;
      const control = await locator.evaluate(describe);
      const ref = `${id}:${inventory.length}`;
      inventory.push({ ref, control, bounds }); refs.set(ref, { locator, control });
    }
    const text = await this.page.locator('body').innerText();
    this.observation = { id, url: this.location(), text, refs };
    return { id, location: this.location(), text, controls: inventory, image: await this.page.screenshot() };
  }
  async captureTarget(observationId: string, choice: Choice, inputs: Inputs): Promise<Target> {
    this.guard();
    const observation = this.observation;
    if (!observation || observation.id !== observationId || observation.url !== this.location() || observation.text !== await this.page.locator('body').innerText()) throw new RunError('STALE_OBSERVATION');
    let locator: Locator;
    if ('ref' in choice) {
      const cached = observation.refs.get(choice.ref);
      if (!cached) throw new RunError('STALE_OBSERVATION');
      locator = cached.locator;
      if (JSON.stringify(await locator.evaluate(describe)) !== JSON.stringify(cached.control)) throw new RunError('STALE_OBSERVATION');
    } else {
      const index = await this.page.evaluate(({ x, y, selector }) => {
        const el = document.elementFromPoint(x, y)?.closest(selector);
        return el ? [...document.querySelectorAll(selector)].indexOf(el) : -1;
      }, { ...choice, selector: controlsSelector });
      if (index < 0) throw new RunError('TARGET_NOT_FOUND');
      locator = this.page.locator(controlsSelector).nth(index);
    }
    const meta = await locator.evaluate(describe);
    const strategies: Strategy[] = [];
    if (['button', 'link'].includes(meta.role) && meta.name) strategies.push({ by: 'role', role: meta.role as 'button' | 'link', name: parameterize(meta.name, inputs, this.policy.publicText) });
    if (meta.label) strategies.push({ by: 'label', text: parameterize(meta.label, inputs, this.policy.publicText) });
    if (meta.caption && ['input', 'button', 'a', 'td'].includes(meta.tag)) strategies.push({ by: 'tableRow', caption: parameterize(meta.caption, inputs, this.policy.publicText), control: meta.tag === 'td' ? 'value' : meta.tag as 'input' | 'button' | 'a' });
    if (!strategies.length) throw new RunError('NO_REPLAY_TARGET');
    const bounds = await locator.boundingBox();
    const target: Target = { strategies, ...(bounds ? { discovery: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, width: 1100, height: 760 } } : {}) };
    // Ensure the reusable description resolves to the exact discovered element.
    const resolved = await this.resolve(target, inputs);
    const originalHandle = await locator.elementHandle();
    try { if (!originalHandle || !await resolved.evaluate((el, original) => el === original, originalHandle)) throw new RunError('TARGET_CAPTURE_MISMATCH'); }
    finally { await originalHandle?.dispose(); }
    return target;
  }
  async matches(condition: Condition, inputs: Inputs): Promise<boolean> {
    this.guard();
    for (const predicate of condition.all) {
      if (predicate.kind === 'route') { if (new URL(this.location()).pathname !== predicate.path) return false; continue; }
      if (predicate.kind === 'text') { if (!await this.page.getByText(resolveValue(predicate.text, inputs), { exact: true }).isVisible().catch(() => false)) return false; continue; }
      let target: Locator;
      try { target = await this.resolve(predicate.target, inputs); }
      catch (error) { if (error instanceof RunError && error.code === 'TARGET_NOT_FOUND') return false; throw error; }
      if (predicate.kind === 'equals') {
        const actual = predicate.read === 'value' ? await target.inputValue() : (await target.innerText()).trim();
        if (actual !== resolveValue(predicate.value, inputs)) return false;
      }
    }
    return true;
  }
  async execute(action: Action, inputs: Inputs): Promise<string | undefined> {
    this.guard();
    if (action.type !== 'click' && action.type !== 'type') this.policy.action(this.location(), action.type);
    if (action.type === 'scroll') { await this.page.mouse.wheel(0, action.direction === 'down' ? action.pixels : -action.pixels); return; }
    if (action.type === 'wait') return;
    const locator = await this.resolve(action.target, inputs);
    if (action.type === 'extract') return action.read === 'value' ? locator.inputValue() : (await locator.innerText()).trim();
    this.policy.action(this.location(), action.type, await locator.evaluate(describe));
    // Pin the checked DOM node so a locator cannot silently retarget during the action.
    const handle = await locator.elementHandle();
    if (!handle) throw new RunError('TARGET_NOT_FOUND');
    try {
      this.policy.action(this.location(), action.type, await handle.evaluate(describe));
      if (action.type === 'click') await handle.click({ timeout: 2000 });
      else await handle.fill(resolveValue(action.value, inputs), { timeout: 2000 });
    } finally { await handle.dispose(); }
    this.guard();
  }
  async evidence(path: string, secrets: string[]): Promise<string> {
    // Mask all fields and any text node containing a runtime value. No DOM dump is persisted.
    const masks = [this.page.locator('input,textarea,select')];
    for (const secret of secrets.filter(Boolean)) masks.push(this.page.getByText(secret, { exact: false }));
    try { await this.page.screenshot({ path, mask: masks, maskColor: '#222222', animations: 'disabled' }); return path; }
    catch { await writeFile(`${path}.json`, JSON.stringify({ kind: 'sanitized-observation', screenshot: 'unavailable', location: safePath(this.location()) })); return `${path}.json`; }
  }
  onHumanEvent(listener: (event: Record<string, unknown>) => void) { this.humanListener = listener; }
  async setOwner(owner: 'AUTOMATION' | 'HUMAN' | 'STOPPED') {
    this.owner = owner;
    // Ownership lives in Node, so a full page navigation cannot silently reset capture.
  }
  close() { return this.browser.close(); }
}
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function safePath(url: string) { try { return new URL(url).pathname; } catch { return 'unavailable'; } }
