/*
 * The ceph command policy: tiers the ceph CLI (health, OSDs, pools, placement groups, daemons) for Ceph clusters.
 *
 * A fail-closed STUB until this tool's kit lands: every command is Denied,
 * so neither investigations nor remediations can run anything through it.
 * The kit replaces this module (keeping its default export a
 * ResourceToolPolicy named "ceph") with the tool's real grammar.
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
  "the ceph command policy is not implemented yet, so every command is refused";

const CephCommandPolicy: ResourceToolPolicy = {
  name: "ceph",
  programs: ["ceph"],
  readCommandGuide: `- Unavailable: ${NOT_IMPLEMENTED_REASON}.`,
  writeCommandGuide: `- Unavailable: ${NOT_IMPLEMENTED_REASON}.`,
  evaluateArgv(argv: Array<string>): ResourceCommandPolicyResult {
    return deniedResult(argv, NOT_IMPLEMENTED_REASON);
  },
};

export default CephCommandPolicy;
