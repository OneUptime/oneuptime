import { AgentConfig } from "../Config";
import { GuardPolicy, ResourceCommandRequest } from "./ResourceExecutor";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  AiResourceTypeInfo,
  isAiResourceType,
} from "../Common/Types/ResourceAiAgent/AiResourceType";
import {
  MAX_POSTURE_LIST_ENTRIES,
  RESOURCE_AI_ALLOW_WRITES_ENV,
  ResourceCommandTier,
} from "../Common/Types/ResourceAiAgent/ResourceAiAccess";
import RunnerJobOrigin, {
  AI_COMMAND_JOB_ORIGINS,
} from "../Common/Types/Runbook/RunnerJobOrigin";
import ResourceCommandPolicy from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicy";
import { ResourceCommandPolicyResult } from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicyCore";

/*
 * The checks every executor runs FIRST in prepare(), before any
 * tool-specific ones. The server tiered the command and refused what it
 * should before enqueueing, but this binary runs on the customer's side of
 * the trust boundary, next to the resource's credentials, so it re-checks
 * whatever the server said:
 *
 *   1. the payload has the ResourceCommandJobPayload shape (a program, an
 *      argv of strings, a tier) and came from OneUptime AI;
 *   2. it is for THIS agent's resource: the same type, the identity the
 *      agent registered with (and, once known, its resource id);
 *   3. the program is one this resource type runs;
 *   4. the same pure ResourceCommandPolicy the server ran (the agent's
 *      byte-identical copy), on the argv itself: Denied never runs, and the
 *      policy must read the argv exactly as the server sent it — same
 *      program, same normalized arguments, a tier no lower than the server
 *      claimed — or the two sides disagree and the command is refused;
 *   5. an investigation may only run Read-tier commands;
 *   6. a write needs ONEUPTIME_AI_ALLOW_WRITES=true on this agent;
 *   7. the write scope: never a protected target, only
 *      ONEUPTIME_AI_WRITE_TARGETS when set.
 *
 * Every refusal starts with "Refused by the <agent display name>".
 */

/*
 * The policy the guard asks (GuardPolicy): the real one by default; tests
 * inject a fake (the per-tool policies are strict, and some are stubs that
 * deny everything) to reach the paths behind a permitted command.
 */
export type { GuardPolicy };

export const DEFAULT_GUARD_POLICY: GuardPolicy = {
  evaluateArgv: (data: {
    resourceType: AiResourceType;
    argv: Array<string>;
  }): ResourceCommandPolicyResult => {
    return ResourceCommandPolicy.evaluateArgv(data);
  },
  getWriteScopeRefusal: (data: {
    result: ResourceCommandPolicyResult;
    allowWrites: boolean;
    writeTargets: Array<string>;
    protectedTargets: Array<string>;
    resourceType: AiResourceType;
  }): string | null => {
    return ResourceCommandPolicy.getWriteScopeRefusal(data);
  },
};

// A command every check allowed, as the executor runs it.
export interface GuardedCommand {
  refusal: null;
  resourceType: AiResourceType;
  // argv[0]: one of the type's programs.
  program: string;
  // The arguments to run: the payload's, which equal the policy's reading.
  args: Array<string>;
  // program + args.
  argv: Array<string>;
  // The agent's own tier for the command (never lower than the payload's).
  tier: ResourceCommandTier;
  displayCommand: string;
  // The agent's policy result, for tool-specific checks (verb, targets).
  policy: ResourceCommandPolicyResult;
  timeoutInMs: number;
}

export type GuardResult = { refusal: string } | GuardedCommand;

export interface GuardInput {
  // The agent's configuration (the executor's options.config).
  config: AgentConfig;
  request: ResourceCommandRequest;
  /*
   * Targets the executor found it must never change (its own container,
   * the collector beside it, ...) — the ones its probePosture() reports.
   * Joined with the configured ONEUPTIME_AI_PROTECTED_TARGETS.
   */
  protectedTargets?: Array<string> | undefined;
  policy?: GuardPolicy | undefined;
}

// How far a tier reaches, for "the agent reads it as at least as risky".
const TIER_RANK: Readonly<Record<string, number>> = {
  [ResourceCommandTier.Read]: 0,
  [ResourceCommandTier.SafeWrite]: 1,
  [ResourceCommandTier.RiskyWrite]: 2,
};

export function getAgentDisplayName(
  resourceType: AiResourceType | null,
): string {
  return resourceType && isAiResourceType(resourceType)
    ? AI_RESOURCE_TYPE_INFO[resourceType].agentDisplayName
    : "resource AI agent";
}

export function refusalPrefix(resourceType: AiResourceType | null): string {
  return `Refused by the ${getAgentDisplayName(resourceType)}`;
}

function isStringArray(value: unknown): value is Array<string> {
  return (
    Array.isArray(value) &&
    value.every((entry: unknown): boolean => {
      return typeof entry === "string";
    })
  );
}

function sameWords(left: Array<string>, right: Array<string>): boolean {
  return (
    left.length === right.length &&
    left.every((word: string, index: number): boolean => {
      return word === right[index];
    })
  );
}

function foldIdentifier(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

// Both non-blank and equal, ignoring case and surrounding whitespace.
export function isSameResourceIdentifier(
  left: unknown,
  right: unknown,
): boolean {
  const a: string = foldIdentifier(left);
  const b: string = foldIdentifier(right);

  return a.length > 0 && a === b;
}

// The configured protected targets and the executor's, without duplicates.
export function mergeTargets(
  ...lists: Array<Array<string> | undefined>
): Array<string> {
  const merged: Array<string> = [];

  for (const list of lists) {
    for (const entry of list || []) {
      const target: string = typeof entry === "string" ? entry.trim() : "";

      if (target && !merged.includes(target)) {
        merged.push(target);
      }
    }
  }

  return merged;
}

function describeWriteSwitch(setting: string | null): string {
  return setting === null || setting.trim() === ""
    ? `${RESOURCE_AI_ALLOW_WRITES_ENV} is not set`
    : `${RESOURCE_AI_ALLOW_WRITES_ENV}="${setting}"`;
}

export default class PrepareGuard {
  public static check(input: GuardInput): GuardResult {
    const config: AgentConfig = input.config;
    const request: ResourceCommandRequest = input.request;
    const policy: GuardPolicy = input.policy || DEFAULT_GUARD_POLICY;
    const resourceType: AiResourceType | null = config.resourceType;
    const refused: string = refusalPrefix(resourceType);

    // ---- The agent itself must know what it serves. ----

    if (!resourceType || !isAiResourceType(resourceType)) {
      return {
        refusal: `${refused}: it has no resource type configured, so it runs nothing.`,
      };
    }

    const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[resourceType];

    if (!config.resourceIdentifier || !config.resourceIdentifier.trim()) {
      return {
        refusal: `${refused}: it does not know which ${info.displayName} it serves, so it runs nothing.`,
      };
    }

    // ---- The payload's shape and origin. ----

    const payload: Record<string, unknown> | null =
      request &&
      request.payload &&
      typeof request.payload === "object" &&
      !Array.isArray(request.payload)
        ? request.payload
        : null;

    if (!payload) {
      return { refusal: `${refused}: the job arrived without a command.` };
    }

    if (
      !(AI_COMMAND_JOB_ORIGINS as Array<string>).includes(
        String(request.origin),
      )
    ) {
      return {
        refusal: `${refused}: it only runs commands for OneUptime AI investigations and fixes, and this job came from "${
          request.origin || "(unknown)"
        }".`,
      };
    }

    const program: unknown = payload["program"];
    const args: unknown = payload["args"];

    if (
      typeof program !== "string" ||
      !program.trim() ||
      !isStringArray(args)
    ) {
      return {
        refusal: `${refused}: the job arrived without a command to run (a program and its arguments).`,
      };
    }

    // ---- The resource: this agent's, and no other. ----

    if (payload["resourceType"] !== resourceType) {
      return {
        refusal: `${refused}: this command is for a "${String(
          payload["resourceType"] ?? "(not specified)",
        )}" resource, and this agent serves a ${info.displayName}.`,
      };
    }

    if (
      !isSameResourceIdentifier(
        payload["resourceIdentifier"],
        config.resourceIdentifier,
      )
    ) {
      return {
        refusal: `${refused}: this command is for ${info.displayName} "${
          typeof payload["resourceIdentifier"] === "string" &&
          payload["resourceIdentifier"].trim()
            ? payload["resourceIdentifier"].trim()
            : "(not specified)"
        }", but this agent serves "${config.resourceIdentifier.trim()}". Check ${
          config.identitySource || info.identityEnvVars.join(" / ")
        } on the agent installed next to that ${info.displayName}.`,
      };
    }

    if (
      request.agentResourceId &&
      !isSameResourceIdentifier(payload["resourceId"], request.agentResourceId)
    ) {
      return {
        refusal: `${refused}: this command is for resource id "${String(
          payload["resourceId"] ?? "(not specified)",
        )}", but this agent is registered for "${request.agentResourceId}".`,
      };
    }

    // ---- The program. ----

    if (!info.programs.includes(program)) {
      return {
        refusal: `${refused}: "${program}" is not a program the ${info.agentDisplayName} runs (it runs ${info.programs.join(
          ", ",
        )}).`,
      };
    }

    // ---- The policy, re-evaluated here on the argv itself. ----

    const argv: Array<string> = [program, ...args];
    let result: ResourceCommandPolicyResult;

    try {
      result = policy.evaluateArgv({ resourceType, argv: argv.slice() });
    } catch {
      return {
        refusal: `${refused}: its command policy could not evaluate this command, so it does not run.`,
      };
    }

    if (!result || result.tier === ResourceCommandTier.Denied) {
      return {
        refusal: `${refused}: ${
          result && result.reason ? result.reason : "the command is denied"
        }.`,
      };
    }

    if (
      TIER_RANK[result.tier] === undefined ||
      result.program !== program ||
      !isStringArray(result.args) ||
      !sameWords(result.args, args)
    ) {
      return {
        refusal: `${refused}: its command policy reads "${
          result.displayCommand || program
        }" differently from OneUptime, so the command does not run. Run the agent image version that matches your OneUptime server.`,
      };
    }

    const claimedTier: unknown = payload["tier"];

    if (
      typeof claimedTier !== "string" ||
      TIER_RANK[claimedTier] === undefined
    ) {
      return {
        refusal: `${refused}: the job does not say which tier "${result.displayCommand}" is, so it does not run.`,
      };
    }

    if ((TIER_RANK[result.tier] ?? 0) > (TIER_RANK[claimedTier] ?? 0)) {
      return {
        refusal: `${refused}: OneUptime sent "${result.displayCommand}" as ${claimedTier}, but this agent's policy reads it as ${result.tier}, so it was not approved for what it does. Run the agent image version that matches your OneUptime server.`,
      };
    }

    if (
      request.origin === RunnerJobOrigin.AiInvestigation &&
      result.tier !== ResourceCommandTier.Read
    ) {
      return {
        refusal: `${refused}: an investigation may only run read-only commands, and "${result.displayCommand}" is ${result.tier}.`,
      };
    }

    // ---- Writes: the switch, then where they may land. ----

    const protectedTargets: Array<string> = mergeTargets(
      config.protectedTargets,
      input.protectedTargets,
    );

    if (result.tier !== ResourceCommandTier.Read) {
      if (!config.allowWrites) {
        return {
          refusal: `${refused}: "${result.displayCommand}" changes the ${info.displayName}, and this agent is read-only (${describeWriteSwitch(
            config.allowWritesSetting,
          )}). To let OneUptime AI apply fixes, set ${RESOURCE_AI_ALLOW_WRITES_ENV}=true on the agent and restart it.`,
        };
      }

      if (protectedTargets.length > MAX_POSTURE_LIST_ENTRIES) {
        return {
          refusal: `${refused}: it protects ${protectedTargets.length} targets, more than the ${MAX_POSTURE_LIST_ENTRIES} OneUptime accepts, so it runs no changes. Shorten ONEUPTIME_AI_PROTECTED_TARGETS.`,
        };
      }

      let scopeRefusal: string | null;

      try {
        scopeRefusal = policy.getWriteScopeRefusal({
          result,
          allowWrites: config.allowWrites,
          writeTargets: config.writeTargets,
          protectedTargets,
          resourceType,
        });
      } catch {
        scopeRefusal =
          "its write scope could not be checked for this command, so it does not run.";
      }

      if (scopeRefusal) {
        return { refusal: `${refused}: ${scopeRefusal}` };
      }
    }

    return {
      refusal: null,
      resourceType,
      program,
      args: args.slice(),
      argv,
      tier: result.tier,
      displayCommand: result.displayCommand,
      policy: result,
      timeoutInMs: request.timeoutInMs,
    };
  }
}
