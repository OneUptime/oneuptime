/*
 * The pvesh command policy: tiers pvesh paths, executed by the agent as calls to the Proxmox VE API for Proxmox clusters.
 *
 * A fail-closed STUB until this tool's kit lands: every command is Denied,
 * so neither investigations nor remediations can run anything through it.
 * The kit replaces this module (keeping its default export a
 * ResourceToolPolicy named "pvesh") with the tool's real grammar.
 *
 * Part of the import-closed resource policy directory that the resource AI
 * agent carries a byte-identical copy of: relative imports of that set only.
 */

import {
  ResourceCommandPolicyResult,
  ResourceToolPolicy,
  deniedResult,
} from "./ResourceCommandPolicyCore";

const NOT_IMPLEMENTED_REASON: string =
  "the pvesh command policy is not implemented yet, so every command is refused";

const ProxmoxCommandPolicy: ResourceToolPolicy = {
  name: "pvesh",
  programs: ["pvesh"],
  readCommandGuide: `- Unavailable: ${NOT_IMPLEMENTED_REASON}.`,
  writeCommandGuide: `- Unavailable: ${NOT_IMPLEMENTED_REASON}.`,
  evaluateArgv(argv: Array<string>): ResourceCommandPolicyResult {
    return deniedResult(argv, NOT_IMPLEMENTED_REASON);
  },
};

export default ProxmoxCommandPolicy;
