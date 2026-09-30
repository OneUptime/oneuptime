/*
 * OneUptime AI access to an infrastructure resource through its resource AI
 * agent: the command tiers and remediation modes, the agent's posture, the
 * access status the dashboard and the AI runs read, the agent <-> server
 * wire protocol and the shared caps.
 *
 * The tier and mode enums carry exactly the string values of the Kubernetes
 * ones (KubectlCommandTier, KubernetesAiRemediationMode — a Common test
 * asserts it), so stored strings are interchangeable and every prompt,
 * card and ladder that reads a tier or a mode means the same thing for a
 * cluster and for any other resource.
 *
 * Imports only ./AiResourceType on purpose: the resource AI agent
 * (agents/ResourceAIAgent) carries a byte-identical copy of this directory
 * and must compile without the rest of Common.
 */

import AiResourceType, { isAiResourceType } from "./AiResourceType";

/*
 * The tier the resource command policy assigns to one command. Tiers are the
 * whole safety model: what a run may execute is a function of (tier, mode),
 * never of prose in a prompt.
 *
 * Read:       inspects the resource and changes nothing (docker ps, pvesh
 *             get, govc vm.info, ceph health, systemctl status, ...).
 *             Investigations only ever run these.
 * SafeWrite:  a reversible change to exactly ONE named object (restart one
 *             container, start one VM, restart one unit, ...). Automatic mode
 *             runs these without a human.
 * RiskyWrite: a change that can take something down or alter what runs
 *             (stop, kill, update, migrate, ...). Needs a human unless the
 *             operator allowlisted the exact shape on the resource or the
 *             resource bypasses approvals.
 * Denied:     never runs, even with human approval (exec, run, rm, prune,
 *             anything reading credentials, anything the policy does not
 *             know).
 */
export enum ResourceCommandTier {
  Read = "Read",
  SafeWrite = "SafeWrite",
  RiskyWrite = "RiskyWrite",
  Denied = "Denied",
}

/*
 * How OneUptime AI may change a resource once it has diagnosed a signal —
 * the same four modes a Kubernetes cluster has.
 *
 * Disabled:        AI never proposes or runs a change on this resource.
 * RequireApproval: AI composes a command plan and a human approves it with
 *                  one click before anything runs.
 * Automatic:       safe changes (SafeWrite) run without a human; a riskier
 *                  change is proposed for approval unless the resource's
 *                  allowlist names its exact shape.
 * BypassApproval:  every change the policy allows — safe AND riskier — runs
 *                  on its own, except what always needs a human.
 *
 * In EVERY mode: Denied commands never run, commands the policy marks
 * requiresHuman always ask, and the agent itself refuses every write unless
 * it was started with RESOURCE_AI_ALLOW_WRITES_ENV=true (and then only on
 * the targets RESOURCE_AI_WRITE_TARGETS_ENV allows, never its protected
 * targets).
 */
export enum ResourceAiRemediationMode {
  Disabled = "Disabled",
  RequireApproval = "RequireApproval",
  Automatic = "Automatic",
  BypassApproval = "BypassApproval",
}

// The modes in which OneUptime AI executes changes without a human.
export const UNATTENDED_RESOURCE_REMEDIATION_MODES: Array<ResourceAiRemediationMode> =
  [
    ResourceAiRemediationMode.Automatic,
    ResourceAiRemediationMode.BypassApproval,
  ];

export function isUnattendedResourceRemediationMode(
  mode: ResourceAiRemediationMode | undefined | null,
): boolean {
  return (
    mode !== undefined &&
    mode !== null &&
    UNATTENDED_RESOURCE_REMEDIATION_MODES.includes(mode)
  );
}

/*
 * A stored or submitted mode, exactly as spelled. Anything unknown is
 * Disabled: a value this build cannot read must never widen what AI may do.
 */
export function parseResourceAiRemediationMode(
  value: unknown,
): ResourceAiRemediationMode {
  if (
    typeof value === "string" &&
    (Object.values(ResourceAiRemediationMode) as Array<string>).includes(value)
  ) {
    return value as ResourceAiRemediationMode;
  }

  return ResourceAiRemediationMode.Disabled;
}

/*
 * What the agent last told the server about its connection: "connected"
 * from registration and every heartbeat, "disconnected" when it signs off
 * (or an admin resets it). Online additionally needs a heartbeat within
 * RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES.
 */
export type ResourceAiAgentConnectionStatus = "connected" | "disconnected";

// The agent heartbeats every 30 seconds; it counts as online this long after.
export const RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES: number = 5;

// Every agent route (register, heartbeat, claim-next-job, ...) lives under it.
export const RESOURCE_AI_AGENT_INGEST_PATH: string =
  "/resource-ai-agent-ingest";

export const RESOURCE_AI_AGENT_IMAGE_REPOSITORY: string =
  "oneuptime/resource-ai-agent";

// The Kubernetes AI agent uses 3876; both can run on one host.
export const RESOURCE_AI_AGENT_DEFAULT_HEALTH_PORT: number = 3877;

/*
 * Environment the resource AI agent reads. The single source of truth: the
 * agent's Config imports these from its copy of this file, and the install
 * docs are pinned against them.
 *
 * RESOURCE_TYPE: which resource the agent serves (an agentAlias or an enum
 *                value, read with parseAiResourceType).
 * RESOURCE_NAME: overrides the identity otherwise read from the type's
 *                identityEnvVars (the collector's own variables).
 * ALLOW_WRITES:  "true" lets the agent run writes at all. Anything else —
 *                unset included — keeps it read-only, whatever the dashboard
 *                says.
 * WRITE_TARGETS: comma-separated globs of the targets (container, service,
 *                VM, unit, ... names) a write may touch. Empty or unset means
 *                any target except the agent's protected ones.
 * API_KEY:       the first non-empty of these authenticates registration
 *                (the collectors already set one of them).
 */
export const RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV: string =
  "ONEUPTIME_AI_AGENT_RESOURCE_TYPE";
export const RESOURCE_AI_AGENT_RESOURCE_NAME_ENV: string =
  "ONEUPTIME_AI_AGENT_RESOURCE_NAME";
export const RESOURCE_AI_ALLOW_WRITES_ENV: string = "ONEUPTIME_AI_ALLOW_WRITES";
export const RESOURCE_AI_WRITE_TARGETS_ENV: string =
  "ONEUPTIME_AI_WRITE_TARGETS";
export const RESOURCE_AI_AGENT_API_KEY_ENVS: ReadonlyArray<string> = [
  "ONEUPTIME_API_KEY",
  "ONEUPTIME_TELEMETRY_INGESTION_KEY",
  "ONEUPTIME_SERVICE_TOKEN",
];

/*
 * What the agent reports about itself on registration and every heartbeat.
 * The agent is the only component holding the resource's credentials, so
 * the server learns its write posture from the agent itself and never
 * enqueues a write the agent said it would refuse.
 */
export interface ResourceAiAgentPosture {
  resourceType: AiResourceType;
  resourceIdentifier: string;
  agentVersion?: string | null | undefined;
  // Whether the agent runs writes at all (RESOURCE_AI_ALLOW_WRITES_ENV).
  allowWrites: boolean;
  // The raw RESOURCE_AI_ALLOW_WRITES_ENV value, for "set X=true" messages.
  allowWritesSetting?: string | null | undefined;
  // RESOURCE_AI_WRITE_TARGETS_ENV as globs; [] means any target (except protected).
  writeTargets: Array<string>;
  /*
   * What the agent never changes: its own container name and id, its
   * compose project, its own systemd unit, ...
   */
  protectedTargets: Array<string>;
  /*
   * The resource's own version as the agent last saw it: docker server
   * version, vCenter version, ceph version, PVE version, database server
   * version, kernel/systemd version.
   */
  toolVersion?: string | null | undefined;
  // Could the agent reach the resource at its last probe.
  reachable: boolean;
  reachError?: string | null | undefined;
  /*
   * Type-specific facts: swarmRole ("manager"/"worker"), podmanRootless,
   * databaseSystem, cephClientId, ...
   */
  details?: Record<string, string | number | boolean | null> | undefined;
  // ISO 8601, stamped by the agent.
  reportedAt?: string | undefined;
}

// Bounds parseResourceAiAgentPosture holds every posture to.
export const MAX_POSTURE_LIST_ENTRIES: number = 64;
export const MAX_POSTURE_STRING_LENGTH: number = 256;

// Keys that would reach an object's prototype if assigned.
const UNSAFE_OBJECT_KEYS: ReadonlyArray<string> = [
  "__proto__",
  "constructor",
  "prototype",
];

// A display-only string: kept (trimmed, capped) when it is one, else null.
function readDisplayString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed: string = value.trim();

  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, MAX_POSTURE_STRING_LENGTH);
}

/*
 * A list the write scope depends on. Absent reads as []; anything else must
 * be an array of at most MAX_POSTURE_LIST_ENTRIES non-empty strings of at
 * most MAX_POSTURE_STRING_LENGTH characters. A list that breaks the rules is
 * reported as malformed (never partially trusted): dropping one entry of a
 * protected list, or one of an allowlist, would change what a write may
 * touch.
 */
function readTargetList(value: unknown): {
  list: Array<string>;
  malformed: boolean;
} {
  if (value === undefined || value === null) {
    return { list: [], malformed: false };
  }

  if (!Array.isArray(value) || value.length > MAX_POSTURE_LIST_ENTRIES) {
    return { list: [], malformed: true };
  }

  const list: Array<string> = [];

  for (const entry of value) {
    if (typeof entry !== "string") {
      return { list: [], malformed: true };
    }

    const trimmed: string = entry.trim();

    if (!trimmed || trimmed.length > MAX_POSTURE_STRING_LENGTH) {
      return { list: [], malformed: true };
    }

    if (!list.includes(trimmed)) {
      list.push(trimmed);
    }
  }

  return { list, malformed: false };
}

function readDetails(
  value: unknown,
): Record<string, string | number | boolean | null> {
  const details: Record<string, string | number | boolean | null> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return details;
  }

  let count: number = 0;

  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (count >= MAX_POSTURE_LIST_ENTRIES) {
      break;
    }

    if (
      !key ||
      key.length > MAX_POSTURE_STRING_LENGTH ||
      UNSAFE_OBJECT_KEYS.includes(key)
    ) {
      continue;
    }

    const entry: unknown = (value as Record<string, unknown>)[key];

    if (typeof entry === "string") {
      details[key] = entry.slice(0, MAX_POSTURE_STRING_LENGTH);
    } else if (typeof entry === "number" && Number.isFinite(entry)) {
      details[key] = entry;
    } else if (typeof entry === "boolean" || entry === null) {
      details[key] = entry;
    } else {
      continue;
    }

    count++;
  }

  return details;
}

/*
 * Read a posture from an agent's request body or the ResourceAiAgent.posture
 * column. Strict and fail-closed:
 *   - null unless resourceType is exactly an AiResourceType value and
 *     resourceIdentifier a non-empty string of at most 256 characters;
 *   - allowWrites is true only for the boolean true;
 *   - a malformed writeTargets or protectedTargets list (not an array of
 *     non-empty strings, over 64 entries, an entry over 256 characters)
 *     forces allowWrites to false rather than being partly trusted;
 *   - display strings are trimmed and capped at 256 characters, details keep
 *     only scalar values (at most 64 of them), and reportedAt only a
 *     parseable date.
 */
export function parseResourceAiAgentPosture(
  value: unknown,
): ResourceAiAgentPosture | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: Record<string, unknown> = value as Record<string, unknown>;

  const resourceType: unknown = raw["resourceType"];

  if (!isAiResourceType(resourceType)) {
    return null;
  }

  const identifierRaw: unknown = raw["resourceIdentifier"];

  if (typeof identifierRaw !== "string") {
    return null;
  }

  const resourceIdentifier: string = identifierRaw.trim();

  if (
    !resourceIdentifier ||
    resourceIdentifier.length > MAX_POSTURE_STRING_LENGTH
  ) {
    return null;
  }

  const writeTargets: { list: Array<string>; malformed: boolean } =
    readTargetList(raw["writeTargets"]);
  const protectedTargets: { list: Array<string>; malformed: boolean } =
    readTargetList(raw["protectedTargets"]);

  const posture: ResourceAiAgentPosture = {
    resourceType,
    resourceIdentifier,
    agentVersion: readDisplayString(raw["agentVersion"]),
    allowWrites:
      raw["allowWrites"] === true &&
      !writeTargets.malformed &&
      !protectedTargets.malformed,
    allowWritesSetting: readDisplayString(raw["allowWritesSetting"]),
    writeTargets: writeTargets.list,
    protectedTargets: protectedTargets.list,
    toolVersion: readDisplayString(raw["toolVersion"]),
    reachable: raw["reachable"] === true,
    reachError: readDisplayString(raw["reachError"]),
    details: readDetails(raw["details"]),
  };

  const reportedAt: unknown = raw["reportedAt"];

  if (
    typeof reportedAt === "string" &&
    reportedAt.length <= 64 &&
    !Number.isNaN(Date.parse(reportedAt))
  ) {
    posture.reportedAt = reportedAt;
  }

  return posture;
}

/*
 * Why AI cannot (fully) use a resource right now. Each code renders as one
 * row of the "what is missing" checklist on the resource's AI agent page and
 * on the investigation panel, with a next step a human can act on.
 *
 * ai_agent_not_connected:        no agent ever registered for the resource.
 * ai_agent_offline:              the agent has not heartbeated within
 *                                RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES.
 * ai_agent_unreachable_resource: the agent is online but could not reach
 *                                the resource at its last probe.
 * investigation_disabled:        "Investigate" is off on the resource.
 * remediation_disabled:          the remediation mode is Disabled.
 * remediation_write_access_missing: the agent runs read-only
 *                                (RESOURCE_AI_ALLOW_WRITES_ENV is not true).
 * ai_disabled_for_project / auto_remediation_disabled_for_project /
 * llm_provider_missing / ai_balance_insufficient: the project-wide gates.
 */
export type ResourceAiAccessGapCode =
  | "ai_agent_not_connected"
  | "ai_agent_offline"
  | "ai_agent_unreachable_resource"
  | "investigation_disabled"
  | "remediation_disabled"
  | "remediation_write_access_missing"
  | "ai_disabled_for_project"
  | "auto_remediation_disabled_for_project"
  | "llm_provider_missing"
  | "ai_balance_insufficient";

export interface ResourceAiAccessGap {
  code: ResourceAiAccessGapCode;
  title: string;
  nextStep: string;
  blocksInvestigation: boolean;
  blocksRemediation: boolean;
}

/*
 * The resource's AI agent as the dashboard shows it. Never carries the agent
 * key or its hash.
 */
export interface ResourceAiAgentSummary {
  agentId: string;
  connectionStatus: ResourceAiAgentConnectionStatus;
  isOnline: boolean;
  agentVersion?: string | null | undefined;
  lastAliveAt?: string | null | undefined;
  lastRegisteredAt?: string | null | undefined;
  posture?: ResourceAiAgentPosture | null | undefined;
  /*
   * The last time another agent tried to register for this resource while
   * this one was online, and why it was refused.
   */
  lastRefusedRegistrationAt?: string | null | undefined;
  lastRefusedRegistrationReason?: string | null | undefined;
}

/*
 * The complete answer to "can OneUptime AI reach this resource, and how?".
 * Computed from current configuration every time it is asked for — a
 * readiness check, not a recorded decision.
 */
export interface ResourceAiAccessStatus {
  resourceType: AiResourceType;
  resourceId: string;
  resourceName: string;
  isAiInvestigationEnabled: boolean;
  aiRemediationMode: ResourceAiRemediationMode;
  /*
   * Operator-authored command patterns Automatic mode may run without
   * approval even though they are RiskyWrite. Normalized; empty when unset.
   */
  aiCommandAllowlist: Array<string>;
  aiAccessConfiguredAt?: string | null | undefined;
  aiAccessLastVerifiedAt?: string | null | undefined;
  aiAccessLastError?: string | null | undefined;
  agent: ResourceAiAgentSummary | null;
  gaps: Array<ResourceAiAccessGap>;
  // True only when every gap that blocks investigation is absent.
  isInvestigationReady: boolean;
  // True only when remediation is enabled AND every remediation gap is absent.
  isRemediationReady: boolean;
}

/*
 * Wire protocol (agent <-> server). Every path is relative to
 * RESOURCE_AI_AGENT_INGEST_PATH and every body is JSON; registration
 * authenticates with the ingestion key header, every other route with the
 * agentId/agentKey pair registration returned.
 *
 *   POST /register        ResourceAiAgentRegisterRequest -> ResourceAiAgentRegisterResponse,
 *                         or 403 {message, reason: ResourceAiAgentRegistrationRefusalReason,
 *                         retryAfterSeconds?} (+ Retry-After for transient reasons)
 *   POST /heartbeat       {agentId, agentKey, agentVersion, posture} -> {status: "ok"}
 *   POST /claim-next-job  {agentId, agentKey} -> {job: null} or {job: {...}} where the job
 *                         carries the same fields as the Kubernetes AI agent's claim answer
 *                         (KubernetesAiAgentIngressAPI.toWireJob: jobId, origin
 *                         "AiInvestigation" or "AiRemediation", stepId, stepType
 *                         "ResourceCommand", timeoutInMs, leaseExpiresAt) and
 *                         payload: ResourceCommandJobPayload
 *   POST /job/:id/heartbeat {agentId, agentKey} -> {status: "ok"}; 404 means the lease is lost
 *   POST /job/:id/result  {agentId, agentKey, success, exitCode?, output, errorMessage?}
 *                         (no exitCode means the command never ran)
 *   POST /disconnect      {agentId, agentKey} -> {status: "ok"}
 *
 * Apart from /register these are the Kubernetes AI agent's shapes.
 */
export interface ResourceAiAgentRegisterRequest {
  resourceType: AiResourceType;
  resourceIdentifier: string;
  // Set when the operator pinned the row (DATABASE_SERVER_ID for databases).
  resourceId?: string | null | undefined;
  agentVersion?: string | null | undefined;
  // The key this agent held before, proving it is the same instance.
  previousAgentKey?: string | null | undefined;
  posture: ResourceAiAgentPosture;
}

export interface ResourceAiAgentRegisterResponse {
  agentId: string;
  agentKey: string;
  resourceId: string;
  resourceName: string;
}

/*
 * Why POST /register refused an agent (HTTP 403, `reason` in the body).
 *
 * resource_type_invalid:       the resourceType is not an AiResourceType.
 *                              Needs an operator.
 * resource_identifier_invalid: the identity is empty or too long. Needs an
 *                              operator (fix the identity variable).
 * resource_not_found:          the resource could not be resolved (a
 *                              DATABASE_SERVER_ID that is not this
 *                              project's). Needs an operator.
 * previous_instance_online:    this resource's agent row is online and the
 *                              request did not present its current key (a
 *                              second install with the same identity, or a
 *                              container replaced without a clean
 *                              shutdown). Clears on its own once the old
 *                              instance goes quiet.
 * agent_cap_reached:           the project hit the agent row cap or the
 *                              hourly new-agent brake. Needs an operator (or
 *                              time).
 */
export type ResourceAiAgentRegistrationRefusalReason =
  | "resource_type_invalid"
  | "resource_identifier_invalid"
  | "resource_not_found"
  | "previous_instance_online"
  | "agent_cap_reached";

// The refusals that clear without anyone doing anything; retrying is right.
export const TRANSIENT_RESOURCE_AI_AGENT_REGISTRATION_REFUSALS: ReadonlyArray<ResourceAiAgentRegistrationRefusalReason> =
  ["previous_instance_online"];

export function isTransientResourceAiAgentRegistrationRefusal(
  reason: unknown,
): boolean {
  return (
    typeof reason === "string" &&
    (
      TRANSIENT_RESOURCE_AI_AGENT_REGISTRATION_REFUSALS as ReadonlyArray<string>
    ).includes(reason)
  );
}

/*
 * RunnerJob.payload of a ResourceCommand job, as the server writes it and
 * the agent receives it. An argv (program + args), never a shell line, and
 * never a credential: the agent uses only credentials from its own
 * environment and mounts.
 */
export interface ResourceCommandJobPayload {
  resourceType: AiResourceType;
  resourceId: string;
  resourceIdentifier: string;
  // argv[0], one of the type's AiResourceTypeInfo.programs.
  program: string;
  // argv without the program.
  args: Array<string>;
  displayCommand: string;
  tier: ResourceCommandTier;
}

/*
 * Caps shared by the investigation tool, the remediation toolkit and the
 * agent. The command count is a runaway guard, not a ration. The agent keeps
 * up to a megabyte of a command's output, and the investigation and
 * conversation toolkits read all of it and page it (ToolOutputPager); the
 * character cap is only what a caller that does not page gets.
 */
export const MAX_RESOURCE_COMMANDS_PER_INVESTIGATION: number = 200;
export const DEFAULT_RESOURCE_COMMAND_TIMEOUT_MS: number = 30 * 1000;
export const MAX_RESOURCE_COMMAND_TIMEOUT_MS: number = 2 * 60 * 1000;
export const MAX_RESOURCE_COMMAND_OUTPUT_CHARS_FOR_LLM: number = 40_000;
export const MAX_RESOURCE_AGENT_OUTPUT_BYTES: number = 1024 * 1024;
