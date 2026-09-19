import { CapabilitySchema, type Capability, type Step } from './schema.js';
import { contract } from './contract.js';
export function recordCapability(steps: Step[], provenance: Capability['provenance']): Capability {
  return CapabilitySchema.parse({ ...contract, steps, provenance });
}
