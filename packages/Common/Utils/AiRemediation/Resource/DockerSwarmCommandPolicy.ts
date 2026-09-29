/*
 * The docker-swarm command policy: tiers the docker CLI on a swarm manager (nodes, services, tasks, stacks) for Docker Swarm clusters.
 *
 * A fail-closed STUB until this tool's kit lands: every command is Denied,
 * so neither investigations nor remediations can run anything through it.
 * The kit replaces this module (keeping its default export a
 * ResourceToolPolicy named "docker-swarm") with the tool's real grammar.
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
  "the docker-swarm command policy is not implemented yet, so every command is refused";

const DockerSwarmCommandPolicy: ResourceToolPolicy = {
  name: "docker-swarm",
  programs: ["docker"],
  readCommandGuide: `- Unavailable: ${NOT_IMPLEMENTED_REASON}.`,
  writeCommandGuide: `- Unavailable: ${NOT_IMPLEMENTED_REASON}.`,
  evaluateArgv(argv: Array<string>): ResourceCommandPolicyResult {
    return deniedResult(argv, NOT_IMPLEMENTED_REASON);
  },
};

export default DockerSwarmCommandPolicy;
