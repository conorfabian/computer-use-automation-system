import type { Action, Condition, Inputs, Target } from './schema.js';
export type Control = { name: string; tag: string; inputType: string; role: string; label: string; caption: string; text: string };
export type Observation = { id: string; location: string; text: string; controls: { ref: string; control: Control; bounds: { x: number; y: number; width: number; height: number } }[]; image: Buffer };
export type Choice = { ref: string } | { x: number; y: number };
export interface Surface {
  location(): string;
  observe(): Promise<Observation>;
  captureTarget(observationId: string, choice: Choice, inputs: Inputs): Promise<Target>;
  matches(condition: Condition, inputs: Inputs): Promise<boolean>;
  execute(action: Action, inputs: Inputs): Promise<string | undefined>;
  evidence(path: string, secrets: string[]): Promise<string>;
  onHumanEvent(listener: (event: Record<string, unknown>) => void): void;
  setOwner(owner: 'AUTOMATION' | 'HUMAN' | 'STOPPED'): Promise<void>;
  close(): Promise<void>;
}
