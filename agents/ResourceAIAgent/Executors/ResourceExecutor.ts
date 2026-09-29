import { spawn } from "child_process";
import { AgentConfig } from "../Config";
import { AgentLogger } from "../Logger";
import AiResourceType from "../Common/Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAgentPosture,
  ResourceCommandTier,
} from "../Common/Types/ResourceAiAgent/ResourceAiAccess";
import { ResourceCommandPolicyResult } from "../Common/Utils/AiRemediation/Resource/ResourceCommandPolicyCore";

/*
 * The contract between the resource-agnostic core of the agent (JobLoop,
 * Agent, Posture) and the one executor that knows how to reach this agent's
 * resource: the docker CLI, the Proxmox VE API, govc, the ceph CLI, a
 * database driver, or the host's own programs through nsenter.
 *
 * ExecutorFactory picks the executor class from the configured resource
 * type and constructs it with ExecutorOptions — every executor class has
 * exactly the constructor `constructor(options: ExecutorOptions)`, so the
 * factory never needs to know one from another and a tool's kit can replace
 * its executor file wholesale.
 *
 * What every executor must do:
 *   - prepare() runs PrepareGuard FIRST (the policy re-check, investigation
 *     implies Read, the write switch and write scope, the resource's
 *     identity), then its own tool-specific checks, and returns either a
 *     refusal or a command ready to run. Nothing may run before prepare()
 *     answers, and prepare() itself never runs anything.
 *   - run() never throws: every failure is {success: false, errorMessage}
 *     with a message that tells an operator what to change. A refusal is
 *     reported with no exitCode, which is how the server reads "never ran".
 *   - Output is capped at MAX_RESOURCE_AGENT_OUTPUT_BYTES and passed through
 *     the Common copy's redactResourceCommandOutput before it leaves the
 *     agent (SpawnSandbox does both for spawned programs).
 *   - probePosture() never throws either: an unreachable resource is
 *     {reachable: false, reachError}.
 */

// What one command did, as reported to OneUptime.
export interface ExecResult {
  success: boolean;
  // The program's exit code; absent when it never ran (or was killed).
  exitCode?: number | null | undefined;
  // Redacted and capped; "" when nothing ran.
  output: string;
  errorMessage?: string | null | undefined;
}

/*
 * One command as the job loop hands it over. payload is the claim answer's
 * payload exactly as received — untrusted JSON, which PrepareGuard checks
 * against ResourceCommandJobPayload before anything reads it.
 */
export interface ResourceCommandRequest {
  payload: Record<string, unknown>;
  // A RunnerJobOrigin value: "AiInvestigation" or "AiRemediation".
  origin: string;
  // The command's time budget, already normalized by the job loop.
  timeoutInMs: number;
  /*
   * The resource id the server returned when this agent registered, when
   * known: a payload naming another resource id is refused.
   */
  agentResourceId?: string | null | undefined;
}

// A command that passed every check, ready to run.
export interface PreparedCommand {
  refusal: null;
  displayCommand: string;
  tier: ResourceCommandTier;
  run: () => Promise<ExecResult>;
}

export interface RefusedCommand {
  // Why the command will not run; reported as the job's errorMessage.
  refusal: string;
}

export type PrepareResult = RefusedCommand | PreparedCommand;

// What an executor can say about the resource it reaches.
export type ResourcePostureProbe = Pick<
  ResourceAiAgentPosture,
  "toolVersion" | "reachable" | "reachError" | "details" | "protectedTargets"
>;

export interface ResourceExecutor {
  /*
   * Every check that decides whether the command may run (PrepareGuard
   * first), before anything runs. Synchronous and side-effect free.
   */
  prepare(request: ResourceCommandRequest): PrepareResult;
  /*
   * What the resource looks like from here: its version, whether it is
   * reachable (and why not), type-specific details, and the targets this
   * agent must never change (its own container, the collector beside it,
   * ...). prepare() must enforce the same protectedTargets it reports here.
   */
  probePosture(): Promise<ResourcePostureProbe>;
  /*
   * Remove the private job directories a previous life of the agent left
   * behind (start-up), and every one, including those of commands still
   * running (shutdown). Best effort; never throw.
   */
  sweepOrphanedJobDirs(): Promise<void>;
  removeAllJobDirs(): Promise<void>;
  /*
   * Optional: the resource's identity when the configuration does not name
   * it — a Host without HOST_NAME answers with the host's own hostname.
   * The agent asks once at start-up, only when config.resourceIdentifier is
   * null; null (or an empty answer) leaves the agent misconfigured.
   */
  resolveResourceIdentifier?(): Promise<string | null>;
}

// child_process.spawn, or a fake with the same shape (tests).
export type SpawnFunction = typeof spawn;

/*
 * The policy PrepareGuard asks: ResourceCommandPolicy (the byte-identical
 * copy) unless a test injects another through ExecutorOptions.guardPolicy.
 */
export interface GuardPolicy {
  evaluateArgv: (data: {
    resourceType: AiResourceType;
    argv: Array<string>;
  }) => ResourceCommandPolicyResult;
  getWriteScopeRefusal: (data: {
    result: ResourceCommandPolicyResult;
    allowWrites: boolean;
    writeTargets: Array<string>;
    protectedTargets: Array<string>;
    resourceType: AiResourceType;
  }) => string | null;
}

/*
 * What every executor is constructed with. Kits inject fakes through
 * spawnImpl (a fake child process) and now (a fixed clock).
 */
export interface ExecutorOptions {
  /*
   * The agent's configuration — the SAME object the agent holds, so an
   * identity resolved at start-up (resolveResourceIdentifier) is seen here.
   */
  config: AgentConfig;
  // The agent's own environment: tool settings (DOCKER_HOST, PVE_HOST, ...).
  env: NodeJS.ProcessEnv;
  // The parent of the private per-job directories (os.tmpdir() by default).
  tmpDir: string;
  logger: AgentLogger;
  spawnImpl?: SpawnFunction | undefined;
  now?: (() => Date) | undefined;
  /*
   * TESTS ONLY: the policy PrepareGuard asks instead of the real one, so a
   * test can reach the paths behind a permitted command. The agent never
   * sets it; executors pass it to PrepareGuard.check as `policy`.
   */
  guardPolicy?: GuardPolicy | undefined;
}

// Every executor class: the factory only ever calls this constructor.
export type ResourceExecutorClass = new (
  options: ExecutorOptions,
) => ResourceExecutor;

export function isRefusal(result: PrepareResult): result is RefusedCommand {
  return result.refusal !== null;
}
