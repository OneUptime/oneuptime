/*
 * The resource command policy: the ONE entry point every caller uses to
 * decide what a command for an infrastructure resource may do — the server's
 * investigation and remediation tools, the enqueue chokepoint
 * (RunnerJobService.enqueueAiResourceCommand), the approval path, the
 * dashboard's allowlist form and the resource AI agent itself.
 *
 * It tokenizes (never a shell), checks that the command starts with one of
 * the resource type's programs, dispatches the argv to that type's tool
 * policy, and wraps the answer in the shared rules: the auto-execution
 * ladder, the allowlist, and the agent's write scope (read-only unless
 * ONEUPTIME_AI_ALLOW_WRITES=true, only ONEUPTIME_AI_WRITE_TARGETS, never the
 * agent's own protected targets).
 *
 * Import-closed like the rest of this directory (see
 * ResourceCommandPolicyCore): the agent carries a byte-identical copy.
 */

import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  AiResourceTypeInfo,
  isAiResourceType,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  RESOURCE_AI_ALLOW_WRITES_ENV,
  RESOURCE_AI_WRITE_TARGETS_ENV,
  ResourceCommandTier,
} from "../../../Types/ResourceAiAgent/ResourceAiAccess";
import { MAX_COMMAND_LENGTH_CHARS } from "../../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import {
  ALLOWLIST_WILDCARD_TOKEN,
  MAX_RESOURCE_COMMAND_TOKENS,
  ResourceAutoExecutionVerdict,
  ResourceCommandPolicyResult,
  ResourceTokenizeResult,
  ResourceToolPolicy,
  allowlistPatternMatches,
  applyAutoExecutionLadder,
  deniedResult,
  getPrivilegeEscalationRefusal,
  globMatchesTarget,
  tokenizeResourceCommand,
} from "./ResourceCommandPolicyCore";
import DockerEngineCommandPolicy from "./DockerEngineCommandPolicy";
import DockerSwarmCommandPolicy from "./DockerSwarmCommandPolicy";
import ProxmoxCommandPolicy from "./ProxmoxCommandPolicy";
import GovcCommandPolicy from "./GovcCommandPolicy";
import CephCommandPolicy from "./CephCommandPolicy";
import DatabaseCommandPolicy from "./DatabaseCommandPolicy";
import HostCommandPolicy from "./HostCommandPolicy";

/*
 * Bounds on a resource's command allowlist, exported so the server's save
 * validation and the dashboard's form hold entries to exactly what the
 * matcher reads.
 */
export const RESOURCE_ALLOWLIST_MAX_PATTERNS: number = 50;
export const RESOURCE_ALLOWLIST_MAX_PATTERN_LENGTH: number = 500;

/*
 * Values a `*` in an allowlist entry is tried as, when deciding whether the
 * entry could ever pre-approve a change: two names, two large numbers (a
 * pid, a VMID) and two small ones (an OSD id), plus the words the tool's
 * own grammar accepts there (ResourceToolPolicy.allowlistStandIns). The
 * entry is valid when ANY combination makes it a write. Two values of each
 * kind let isBroadAllowlistPattern see whether a `*` changes what a write
 * touches.
 */
const GENERIC_WILDCARD_STAND_INS: ReadonlyArray<string> = [
  "placeholder-1",
  "placeholder-2",
  "1000",
  "1001",
  "1",
  "2",
];

/*
 * How many combinations of stand-ins an entry is tried with at most. Every
 * `*` multiplies them, so an entry with many `*`s is only partly explored —
 * it can then be refused as "can never match" although some value would
 * make it a write, which fails toward pre-approving less.
 */
const MAX_WILDCARD_COMBINATIONS: number = 4096;

// Which tool policy answers for each resource type.
const TOOL_POLICY_BY_TYPE: Readonly<
  Record<AiResourceType, ResourceToolPolicy>
> = {
  [AiResourceType.DockerHost]: DockerEngineCommandPolicy,
  [AiResourceType.PodmanHost]: DockerEngineCommandPolicy,
  [AiResourceType.DockerSwarmCluster]: DockerSwarmCommandPolicy,
  [AiResourceType.ProxmoxCluster]: ProxmoxCommandPolicy,
  [AiResourceType.VMwareVCenter]: GovcCommandPolicy,
  [AiResourceType.CephCluster]: CephCommandPolicy,
  [AiResourceType.DatabaseServer]: DatabaseCommandPolicy,
  [AiResourceType.Host]: HostCommandPolicy,
};

// Refuses everything, for a resource type this build does not know.
const UNKNOWN_TYPE_POLICY: ResourceToolPolicy = {
  name: "unknown",
  programs: [],
  readCommandGuide:
    "- Unavailable: this resource type has no command policy, so every command is refused.",
  writeCommandGuide:
    "- Unavailable: this resource type has no command policy, so every command is refused.",
  evaluateArgv(argv: Array<string>): ResourceCommandPolicyResult {
    return deniedResult(
      argv,
      "this resource type has no command policy, so every command is refused",
    );
  },
};

const ALL_TIERS: ReadonlyArray<string> = Object.values(ResourceCommandTier);

function isWriteTier(tier: ResourceCommandTier): boolean {
  return (
    tier === ResourceCommandTier.SafeWrite ||
    tier === ResourceCommandTier.RiskyWrite
  );
}

// Hex a container or image id (or a prefix of one) is written in.
const HEX_ID_REGEX: RegExp = /^[0-9a-f]+$/;
const FULL_HEX_ID_REGEX: RegExp = /^[0-9a-f]{12,}$/;

/*
 * Does this target name a protected one? Over-matching is the safe
 * direction here, so the comparison is case-insensitive, ignores a leading
 * "/" (docker prints container names as "/name"), honours `*` in the
 * protected entry, and treats a hex word as the id PREFIX docker would
 * resolve it as ("3f2a" names the protected container 3f2a9c...).
 */
function isProtectedTarget(target: string, protectedTarget: string): boolean {
  const left: string = target.trim().replace(/^\/+/, "").toLowerCase();
  const right: string = protectedTarget
    .trim()
    .replace(/^\/+/, "")
    .toLowerCase();

  if (!left || !right) {
    return false;
  }

  if (left === right || globMatchesTarget(right, left)) {
    return true;
  }

  return (
    HEX_ID_REGEX.test(left) &&
    FULL_HEX_ID_REGEX.test(right) &&
    right.startsWith(left)
  );
}

function typeInfo(resourceType: AiResourceType): AiResourceTypeInfo | null {
  return isAiResourceType(resourceType)
    ? AI_RESOURCE_TYPE_INFO[resourceType]
    : null;
}

/*
 * A tool policy's answer, checked before anyone acts on it: a tool that
 * throws, returns something that is not a result, or names a tier that does
 * not exist is read as Denied. The program is always argv[0] (the dispatcher
 * already checked it against the type's programs, and a job's payload is
 * built from this result); the arguments the tool normalized are kept; a
 * missing list becomes [].
 */
function sanitizeToolResult(
  argv: Array<string>,
  raw: unknown,
): ResourceCommandPolicyResult {
  if (!raw || typeof raw !== "object") {
    return deniedResult(
      argv,
      "the command policy returned no verdict for this command",
    );
  }

  const result: Record<string, unknown> = raw as Record<string, unknown>;
  const tier: unknown = result["tier"];

  if (typeof tier !== "string" || !ALL_TIERS.includes(tier)) {
    return deniedResult(
      argv,
      "the command policy returned an unknown tier for this command",
    );
  }

  const words: (value: unknown) => Array<string> = (
    value: unknown,
  ): Array<string> => {
    return Array.isArray(value)
      ? value.filter((word: unknown): word is string => {
          return typeof word === "string";
        })
      : [];
  };

  const reason: unknown = result["reason"];
  const verb: unknown = result["verb"];
  const displayCommand: unknown = result["displayCommand"];

  const sanitized: ResourceCommandPolicyResult = {
    tier: tier as ResourceCommandTier,
    reason:
      typeof reason === "string" && reason ? reason : "no reason was given",
    program: argv[0] || "",
    args: Array.isArray(result["args"]) ? words(result["args"]) : argv.slice(1),
    verb: typeof verb === "string" ? verb : "",
    displayCommand:
      typeof displayCommand === "string" && displayCommand
        ? displayCommand
        : deniedResult(argv, "").displayCommand,
    targets: words(result["targets"]),
  };

  if (result["requiresHuman"] === true) {
    sanitized.requiresHuman = true;
  }

  return sanitized;
}

export default class ResourceCommandPolicy {
  /*
   * The tool policy for a resource type: DockerHost and PodmanHost share the
   * docker engine policy, DockerSwarmCluster has the swarm one, and so on.
   * An unknown type gets a policy that refuses everything.
   */
  public static getToolPolicy(
    resourceType: AiResourceType,
  ): ResourceToolPolicy {
    if (!isAiResourceType(resourceType)) {
      return UNKNOWN_TYPE_POLICY;
    }

    return TOOL_POLICY_BY_TYPE[resourceType];
  }

  // Tokenize (never a shell), then evaluate the argv.
  public static evaluateCommand(data: {
    resourceType: AiResourceType;
    command: string;
  }): ResourceCommandPolicyResult {
    const command: string =
      data && typeof data.command === "string" ? data.command : "";
    const tokenized: ResourceTokenizeResult = tokenizeResourceCommand(command);

    if (!tokenized.argv) {
      return {
        tier: ResourceCommandTier.Denied,
        reason: tokenized.errorMessage || "Could not parse the command.",
        program: "",
        args: [],
        verb: "",
        displayCommand: command.trim().slice(0, 200),
        targets: [],
      };
    }

    return ResourceCommandPolicy.evaluateArgv({
      resourceType: data.resourceType,
      argv: tokenized.argv,
    });
  }

  /*
   * The evaluation proper, on an argv that includes the program. The agent
   * calls this on the argv it received, so its verdict never depends on
   * re-tokenizing a string the same way the server did. Fails closed on
   * anything malformed before a tool policy ever sees it.
   */
  public static evaluateArgv(data: {
    resourceType: AiResourceType;
    argv: Array<string>;
  }): ResourceCommandPolicyResult {
    const rawArgv: unknown = data ? data.argv : undefined;

    if (!Array.isArray(rawArgv) || rawArgv.length === 0) {
      return deniedResult([], "Empty command.");
    }

    if (
      rawArgv.some((word: unknown): boolean => {
        return typeof word !== "string";
      })
    ) {
      return deniedResult(
        rawArgv as Array<string>,
        "Every word of the command must be a string.",
      );
    }

    const argv: Array<string> = (rawArgv as Array<string>).slice();

    if (argv.length > MAX_RESOURCE_COMMAND_TOKENS) {
      return deniedResult(
        argv,
        `A command may have at most ${MAX_RESOURCE_COMMAND_TOKENS} words.`,
      );
    }

    const totalLength: number = argv.reduce(
      (sum: number, word: string): number => {
        return sum + word.length;
      },
      0,
    );

    if (totalLength > MAX_COMMAND_LENGTH_CHARS) {
      return deniedResult(
        argv,
        `Command exceeds the ${MAX_COMMAND_LENGTH_CHARS}-character limit.`,
      );
    }

    if (
      argv.some((word: string): boolean => {
        return (
          word.includes("\n") || word.includes("\r") || word.includes("\0")
        );
      })
    ) {
      return deniedResult(
        argv,
        "A command must be a single line: no word may hold a newline or a NUL character.",
      );
    }

    const program: string = argv[0] || "";
    const privilegeRefusal: string | null =
      getPrivilegeEscalationRefusal(program);

    if (privilegeRefusal) {
      return deniedResult(argv, privilegeRefusal);
    }

    const info: AiResourceTypeInfo | null = typeInfo(data.resourceType);

    if (!info) {
      return deniedResult(
        argv,
        "this resource type has no command policy, so every command is refused",
      );
    }

    if (!info.programs.includes(program)) {
      const programList: string = info.programs
        .map((name: string): string => {
          return `"${name}"`;
        })
        .join(", ");

      return deniedResult(
        argv,
        `"${program}" is not a program the ${info.agentDisplayName} runs: a command for a ${info.displayName} starts with ${programList}${
          program.includes("/")
            ? " (write the program name without a path)"
            : ""
        }`,
      );
    }

    const tool: ResourceToolPolicy = ResourceCommandPolicy.getToolPolicy(
      data.resourceType,
    );

    if (!tool.programs.includes(program)) {
      return deniedResult(
        argv,
        `the ${tool.name} command policy does not cover "${program}"`,
      );
    }

    let raw: unknown;

    try {
      // A copy: a tool policy must never be able to change the caller's argv.
      raw = tool.evaluateArgv(argv.slice());
    } catch {
      return deniedResult(
        argv,
        `the ${tool.name} command policy could not evaluate this command`,
      );
    }

    return sanitizeToolResult(argv, raw);
  }

  public static isReadOnly(data: {
    resourceType: AiResourceType;
    command: string;
  }): boolean {
    return (
      ResourceCommandPolicy.evaluateCommand(data).tier ===
      ResourceCommandTier.Read
    );
  }

  /*
   * The remediation verdict for one command under a resource's settings
   * (see applyAutoExecutionLadder). The allowlist is consulted only for a
   * RiskyWrite, the one tier it can promote.
   */
  public static evaluateForAutoExecution(data: {
    resourceType: AiResourceType;
    command: string;
    allowlistPatterns: Array<string>;
    bypassApproval: boolean;
  }): ResourceAutoExecutionVerdict {
    const result: ResourceCommandPolicyResult =
      ResourceCommandPolicy.evaluateCommand({
        resourceType: data.resourceType,
        command: data.command,
      });

    const allowlistMatched: boolean =
      result.tier === ResourceCommandTier.RiskyWrite &&
      result.requiresHuman !== true &&
      ResourceCommandPolicy.matchesAllowlist({
        resourceType: data.resourceType,
        command: data.command,
        patterns: data.allowlistPatterns,
      });

    return applyAutoExecutionLadder(result, {
      allowlistMatched,
      bypassApproval: data.bypassApproval === true,
    });
  }

  /*
   * Whether any of the resource's allowlist entries names this command,
   * word by word (allowlistPatternMatches). Only the first
   * RESOURCE_ALLOWLIST_MAX_PATTERNS entries are read, and an entry
   * describeAllowlistPatternProblem refuses is skipped — so what the matcher
   * reads and what the server and the dashboard accept are one set.
   * Tier-blind: the ladder decides what a match may promote.
   */
  public static matchesAllowlist(data: {
    resourceType: AiResourceType;
    command: string;
    patterns: Array<string>;
  }): boolean {
    const tokenized: ResourceTokenizeResult = tokenizeResourceCommand(
      data ? data.command : "",
    );

    if (!tokenized.argv || !Array.isArray(data.patterns)) {
      return false;
    }

    const patterns: Array<unknown> = data.patterns.slice(
      0,
      RESOURCE_ALLOWLIST_MAX_PATTERNS,
    );

    for (const pattern of patterns) {
      if (
        ResourceCommandPolicy.describeAllowlistPatternProblem({
          resourceType: data.resourceType,
          pattern,
        }) !== null
      ) {
        continue;
      }

      const patternArgv: Array<string> | undefined = tokenizeResourceCommand(
        pattern as string,
      ).argv;

      if (patternArgv && allowlistPatternMatches(patternArgv, tokenized.argv)) {
        return true;
      }
    }

    return false;
  }

  /*
   * Why an allowlist entry can never pre-approve anything, in words for the
   * person typing it — or null when it is valid. The ONE definition of a
   * valid entry: the server validates saves with it, the dashboard validates
   * its form with it, and matchesAllowlist skips every entry it refuses.
   * (The number of entries is checked by describeAllowlistProblems.)
   */
  public static describeAllowlistPatternProblem(data: {
    resourceType: AiResourceType;
    pattern: unknown;
  }): string | null {
    const pattern: unknown = data ? data.pattern : undefined;

    if (typeof pattern !== "string" || !pattern.trim()) {
      return "An allowlist entry cannot be blank.";
    }

    if (pattern.length > RESOURCE_ALLOWLIST_MAX_PATTERN_LENGTH) {
      return `An allowlist entry can be at most ${RESOURCE_ALLOWLIST_MAX_PATTERN_LENGTH} characters long.`;
    }

    const shown: string = pattern.trim();
    const info: AiResourceTypeInfo | null = typeInfo(data.resourceType);

    if (!info) {
      return `"${shown}" cannot be checked: this resource type has no command policy.`;
    }

    const tokenized: ResourceTokenizeResult = tokenizeResourceCommand(pattern);

    if (!tokenized.argv) {
      return `"${shown}" cannot be read as one command: ${
        tokenized.errorMessage || "it could not be split into words."
      }`;
    }

    const argv: Array<string> = tokenized.argv;
    const program: string = argv[0] || "";

    if (!info.programs.includes(program)) {
      return `"${shown}" does not start with a program the ${
        info.agentDisplayName
      } runs (${info.programs.join(", ")}), so it can never match one of its commands.`;
    }

    if (argv.length < 3) {
      return `"${shown}" has fewer than two words after "${program}", so it can never name a change to pre-approve. Write out the full command, with a * for each word that may vary.`;
    }

    if (argv[1] === ALLOWLIST_WILDCARD_TOKEN) {
      return `"${shown}" has a * where the command goes (right after "${program}"). A * stands for exactly one word, and that word decides what kind of change runs, so write it out.`;
    }

    const results: Array<ResourceCommandPolicyResult> =
      ResourceCommandPolicy.evaluateWithStandIns(data.resourceType, argv);

    if (
      results.some((result: ResourceCommandPolicyResult): boolean => {
        return isWriteTier(result.tier);
      })
    ) {
      return null;
    }

    const read: ResourceCommandPolicyResult | undefined = results.find(
      (result: ResourceCommandPolicyResult): boolean => {
        return result.tier === ResourceCommandTier.Read;
      },
    );

    if (read) {
      return `"${shown}" is a read-only command (${read.reason}). Reads never need approval, so an allowlist entry for one pre-approves nothing.`;
    }

    return `"${shown}" can never match a command that runs: ${
      results[0] ? results[0].reason : "the command policy refuses it"
    }.`;
  }

  /*
   * Every problem with a whole allowlist, or null when it is valid: not a
   * list, more than RESOURCE_ALLOWLIST_MAX_PATTERNS entries, or the first
   * entry describeAllowlistPatternProblem refuses.
   */
  public static describeAllowlistProblems(data: {
    resourceType: AiResourceType;
    patterns: unknown;
  }): string | null {
    const patterns: unknown = data ? data.patterns : undefined;

    if (!Array.isArray(patterns)) {
      return "The allowlist must be a list of commands.";
    }

    if (patterns.length > RESOURCE_ALLOWLIST_MAX_PATTERNS) {
      return `An allowlist can hold at most ${RESOURCE_ALLOWLIST_MAX_PATTERNS} entries (this one has ${patterns.length}).`;
    }

    for (const pattern of patterns) {
      const problem: string | null =
        ResourceCommandPolicy.describeAllowlistPatternProblem({
          resourceType: data.resourceType,
          pattern,
        });

      if (problem) {
        return problem;
      }
    }

    return null;
  }

  /*
   * Does this allowlist entry pre-approve changes to objects it does not
   * name? True when a `*` stands for a target of the change (a container, a
   * service, a VM, a unit, a pid, ...) — the dashboard asks for an explicit
   * confirmation before saving such an entry. An invalid entry is never
   * broad: it is refused before anyone could be asked to confirm it.
   */
  public static isBroadAllowlistPattern(data: {
    resourceType: AiResourceType;
    pattern: unknown;
  }): boolean {
    if (ResourceCommandPolicy.describeAllowlistPatternProblem(data) !== null) {
      return false;
    }

    const argv: Array<string> | undefined = tokenizeResourceCommand(
      data.pattern as string,
    ).argv;

    if (!argv) {
      return false;
    }

    if (!argv.includes(ALLOWLIST_WILDCARD_TOKEN)) {
      return false;
    }

    /*
     * A `*` names a target when putting different words in its place
     * changes what the write touches: the entry then pre-approves changes
     * to objects nobody typed. A `*` in a value (a timeout, a replica
     * count) leaves the targets alone.
     */
    const targetSets: Set<string> = new Set<string>();

    for (const result of ResourceCommandPolicy.evaluateWithStandIns(
      data.resourceType,
      argv,
    )) {
      if (!isWriteTier(result.tier)) {
        continue;
      }

      targetSets.add(JSON.stringify([...result.targets].sort()));

      if (targetSets.size > 1) {
        return true;
      }
    }

    return false;
  }

  /*
   * Where the agent's own posture stops a write, or null when it may run.
   * The same rule is asked at every enforcement point — the remediation
   * tools, the enqueue chokepoint, the approval path and the agent — with
   * the agent's reported (or, on the agent, configured) posture:
   *   - a read is never refused here;
   *   - a Denied command is refused (it never runs anywhere);
   *   - an agent without ONEUPTIME_AI_ALLOW_WRITES=true runs no write;
   *   - a write never touches one of the agent's protected targets;
   *   - with ONEUPTIME_AI_WRITE_TARGETS set, every target must match one of
   *     its globs, and a write that names no target is refused (it cannot
   *     be shown to stay inside them).
   */
  public static getWriteScopeRefusal(data: {
    result: ResourceCommandPolicyResult;
    allowWrites: boolean;
    writeTargets: Array<string>;
    protectedTargets: Array<string>;
    resourceType: AiResourceType;
  }): string | null {
    const result: ResourceCommandPolicyResult | undefined = data
      ? data.result
      : undefined;

    if (!result || typeof result !== "object") {
      return "The command could not be evaluated, so it cannot run.";
    }

    if (result.tier === ResourceCommandTier.Read) {
      return null;
    }

    const info: AiResourceTypeInfo | null = typeInfo(data.resourceType);
    const agentName: string = info ? info.agentDisplayName : "AI agent";
    const shown: string = result.displayCommand || "this command";

    if (!isWriteTier(result.tier)) {
      return `"${shown}" is denied by the command policy (${result.reason}), so it never runs.`;
    }

    if (data.allowWrites !== true) {
      return `The ${agentName} for this ${
        info ? info.displayName : "resource"
      } is read-only, so it refuses every change, including "${shown}". To let OneUptime AI change it, set ${RESOURCE_AI_ALLOW_WRITES_ENV}=true on the agent and restart it.`;
    }

    const targets: Array<string> = Array.isArray(result.targets)
      ? result.targets.filter((target: unknown): target is string => {
          return typeof target === "string" && target.trim().length > 0;
        })
      : [];

    const protectedTargets: Array<string> = Array.isArray(data.protectedTargets)
      ? data.protectedTargets.filter((entry: unknown): entry is string => {
          return typeof entry === "string" && entry.trim().length > 0;
        })
      : [];

    for (const target of targets) {
      const protectedTarget: string | undefined = protectedTargets.find(
        (entry: string): boolean => {
          return isProtectedTarget(target, entry);
        },
      );

      if (protectedTarget !== undefined) {
        return `"${shown}" would change ${target}, which the ${agentName} protects (${protectedTarget}): OneUptime AI never changes the agent itself or what it runs in.`;
      }
    }

    const writeTargets: Array<string> = Array.isArray(data.writeTargets)
      ? data.writeTargets
          .filter((entry: unknown): entry is string => {
            return typeof entry === "string";
          })
          .map((entry: string): string => {
            return entry.trim();
          })
          .filter((entry: string): boolean => {
            return entry.length > 0;
          })
      : [];

    if (writeTargets.length === 0) {
      return null;
    }

    const allowed: string = `${RESOURCE_AI_WRITE_TARGETS_ENV}=${writeTargets.join(",")}`;

    if (targets.length === 0) {
      return `"${shown}" does not name the objects it changes, and the ${agentName} only changes the targets its ${allowed} allows. Leave this change to a human, or clear ${RESOURCE_AI_WRITE_TARGETS_ENV} on the agent.`;
    }

    for (const target of targets) {
      const inScope: boolean = writeTargets.some((glob: string): boolean => {
        return globMatchesTarget(glob, target);
      });

      if (!inScope) {
        return `"${shown}" would change ${target}, which is outside the targets the ${agentName} may change (${allowed}). Add it to ${RESOURCE_AI_WRITE_TARGETS_ENV} on the agent and restart it, or leave this change to a human.`;
      }
    }

    return null;
  }

  // The tool's read-command cheat-sheet, for the investigation tool's description.
  public static getReadCommandGuide(resourceType: AiResourceType): string {
    return ResourceCommandPolicy.getToolPolicy(resourceType).readCommandGuide;
  }

  // The tool's write-command cheat-sheet, for the remediation tools' descriptions.
  public static getWriteCommandGuide(resourceType: AiResourceType): string {
    return ResourceCommandPolicy.getToolPolicy(resourceType).writeCommandGuide;
  }

  /*
   * The entry's argv evaluated with its `*`s replaced by every combination
   * of stand-ins (the generic ones and the tool's own), up to
   * MAX_WILDCARD_COMBINATIONS. An entry without a `*` is evaluated once.
   */
  private static evaluateWithStandIns(
    resourceType: AiResourceType,
    argv: Array<string>,
  ): Array<ResourceCommandPolicyResult> {
    const positions: Array<number> = [];

    argv.forEach((word: string, index: number): void => {
      if (word === ALLOWLIST_WILDCARD_TOKEN) {
        positions.push(index);
      }
    });

    if (positions.length === 0) {
      return [ResourceCommandPolicy.evaluateArgv({ resourceType, argv })];
    }

    const toolStandIns: ReadonlyArray<string> =
      ResourceCommandPolicy.getToolPolicy(resourceType).allowlistStandIns || [];

    const candidates: Array<string> = Array.from(
      new Set<string>([...GENERIC_WILDCARD_STAND_INS, ...toolStandIns]),
    ).filter((word: string): boolean => {
      return typeof word === "string" && word !== ALLOWLIST_WILDCARD_TOKEN;
    });

    const results: Array<ResourceCommandPolicyResult> = [];

    // One counter per `*`, counting in base candidates.length.
    const counters: Array<number> = positions.map((): number => {
      return 0;
    });

    while (results.length < MAX_WILDCARD_COMBINATIONS) {
      const concrete: Array<string> = [...argv];

      positions.forEach((position: number, index: number): void => {
        concrete[position] = candidates[counters[index] || 0] || "";
      });

      results.push(
        ResourceCommandPolicy.evaluateArgv({ resourceType, argv: concrete }),
      );

      let carry: number = counters.length - 1;

      while (carry >= 0) {
        counters[carry] = (counters[carry] || 0) + 1;

        if ((counters[carry] || 0) < candidates.length) {
          break;
        }

        counters[carry] = 0;
        carry--;
      }

      if (carry < 0) {
        break;
      }
    }

    return results;
  }
}
