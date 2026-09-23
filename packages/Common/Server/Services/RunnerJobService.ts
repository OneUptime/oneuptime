import DatabaseService from "./DatabaseService";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import Model from "../../Models/DatabaseModels/RunnerJob";
import RunnerJobStatus from "../../Types/Runbook/RunnerJobStatus";
import RunnerJobOrigin, {
  AI_COMMAND_JOB_ORIGINS,
} from "../../Types/Runbook/RunnerJobOrigin";
import RunbookStepType, {
  isPayloadCarryingStepType,
  isRunnerExecutedStepType,
} from "../../Types/Runbook/RunbookStepType";
import { AI_COMMAND_STEP_TYPES } from "../../Types/AutoRemediation/AiRemediationCommandPlan";
import CommandPolicy from "../../Utils/AiRemediation/CommandPolicy";
import KubectlPolicy, {
  KubectlPolicyResult,
} from "../../Utils/AiRemediation/KubectlPolicy";
import KubectlOutputRedactor from "../../Utils/AiRemediation/KubectlOutputRedactor";
import KubectlWriteScope, {
  KubectlWriteScopeRefusal,
} from "../../Utils/AiRemediation/KubectlWriteScope";
import ToolResultSerializer from "../Utils/AI/Toolbox/Serializer";
import {
  KUBECTL_ALLOW_NODE_OPERATIONS_ENV,
  KUBECTL_WRITE_NAMESPACES_ENV,
  KubectlCommandTier,
  KubernetesAiRemediationMode,
  KubernetesRunnerPosture,
  isInClusterPostureForCluster,
  parseKubernetesRunnerPosture,
} from "../../Types/Kubernetes/KubernetesClusterAiAccess";
import RunbookCredentialType from "../../Types/Runbook/RunbookCredentialType";
import AIRunType from "../../Types/AI/AIRunType";
import AIRun from "../../Models/DatabaseModels/AIRun";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import RunbookCredential from "../../Models/DatabaseModels/RunbookCredential";
import Runner from "../../Models/DatabaseModels/Runner";
import AIRunService from "./AIRunService";
import KubernetesClusterService from "./KubernetesClusterService";
import RunbookCredentialService from "./RunbookCredentialService";
import RunnerService, { Service as RunnerServiceClass } from "./RunnerService";
import QueryHelper from "../Types/Database/QueryHelper";

/*
 * The cluster remediation modes in which a kubectl job for remediation may
 * be enqueued at all. Anything else — Disabled, or a value the dashboard
 * does not know — reads as "remediation is off".
 */
const ENABLED_REMEDIATION_MODES: Array<KubernetesAiRemediationMode> = [
  KubernetesAiRemediationMode.RequireApproval,
  KubernetesAiRemediationMode.Automatic,
  KubernetesAiRemediationMode.BypassApproval,
];

// AI runs whose cluster reads are governed by the remediation switch.
const REMEDIATION_RUN_TYPES: Array<AIRunType> = [
  AIRunType.RemediationExecution,
  AIRunType.RemediationPlan,
];

/*
 * Project-wide hourly ceiling on AI-composed command jobs, counted on the
 * RunnerJob rows themselves so every path (FullAuto inline execution,
 * approved plans, rollbacks) shares one brake.
 */
export const MAX_AI_COMMAND_JOBS_PER_PROJECT_PER_HOUR: number = 30;

/*
 * Separate, looser brake for READ-ONLY kubectl during investigations: a
 * busy hour of alerts on a large cluster legitimately runs many describe /
 * logs / events calls, and none of them can change anything. Still a
 * ceiling, because every call spends Runner time and LLM budget.
 */
export const MAX_AI_INVESTIGATION_COMMAND_JOBS_PER_PROJECT_PER_HOUR: number = 240;
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../Types/Date";
import { JSONObject } from "../../Types/JSON";
import PostgresAppInstance from "../Infrastructure/PostgresDatabase";
import logger from "../Utils/Logger";
import Sleep from "../../Types/Sleep";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * Lease the Worker grants on each successful claim. While the lease is fresh
 * the job belongs to that agent; once it elapses, another agent (or the
 * Worker's poll loop) can mark the job TimedOut.
 */
const DEFAULT_LEASE_MS: number = 30_000;
/*
 * If the agent's executor heartbeats faster than this, the Worker keeps
 * extending the lease. The agent should call the job heartbeat endpoint at
 * least once every (DEFAULT_LEASE_MS / 2) ms.
 */
const DEFAULT_CLAIM_TIMEOUT_MS: number = 2 * 60_000;

const POLL_INTERVAL_MS: number = 500;

/*
 * A job in one of these states will never change again, so its row is a
 * durable record of what the step did. Everything else is still in flight and
 * can be waited on.
 */
const TERMINAL_STATUSES: Array<RunnerJobStatus> = [
  RunnerJobStatus.Succeeded,
  RunnerJobStatus.Failed,
  RunnerJobStatus.TimedOut,
  RunnerJobStatus.Cancelled,
];

export function isTerminalAgentJobStatus(
  status: RunnerJobStatus | undefined,
): boolean {
  return Boolean(status && TERMINAL_STATUSES.includes(status));
}

/*
 * TypeORM's dataSource.query returns `[rows, rowCount]` for UPDATE/DELETE
 * (even with RETURNING), and just `rows` for SELECT/INSERT. This helper
 * normalises the response so callers always see the rows array.
 */
function unwrapRows(result: unknown): Array<JSONObject> {
  if (Array.isArray(result)) {
    if (
      result.length === 2 &&
      Array.isArray(result[0]) &&
      typeof result[1] === "number"
    ) {
      return result[0] as Array<JSONObject>;
    }
    return result as Array<JSONObject>;
  }
  return [];
}

/*
 * What stands in for a character a Postgres text column cannot hold: the
 * Unicode replacement character, so a reader of the stored output can see
 * that something was there instead of the bytes silently closing up.
 */
export const RUNNER_JOB_UNSTORABLE_CHARACTER_REPLACEMENT: string = "\uFFFD";

/*
 * U+0000. Postgres rejects it anywhere in a text value (22021 "invalid byte
 * sequence for encoding UTF8: 0x00") — at bind time, so even a parameter
 * the statement's CASE would not pick fails the whole UPDATE.
 */
// eslint-disable-next-line no-control-regex
const NUL_CHARACTER_PATTERN: RegExp = /\u0000/g;

/*
 * A UTF-16 surrogate pair, or a surrogate half on its own. A lone half has
 * no UTF-8 encoding at all (a Runner that cut a string between the two
 * halves sends one); the driver would quietly turn it into U+FFFD on the
 * wire, so it is replaced here explicitly, before redaction, and the text
 * the redaction passes read is exactly the text that is stored. A whole
 * pair is matched first and kept.
 */
const SURROGATE_PATTERN: RegExp =
  /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g;

function keepSurrogatePairOnly(match: string): string {
  return match.length === 2
    ? match
    : RUNNER_JOB_UNSTORABLE_CHARACTER_REPLACEMENT;
}

/*
 * Why a timed-out job timed out, in words that fit what it was. A runbook
 * step is waited on by a runbook agent; an AI-composed kubectl command is
 * run by the cluster's Runner, and for it the difference between "nobody
 * picked it up" (nothing ran) and "it was picked up and then went silent"
 * (what it did is unknown) is what the access test, the AI page's command
 * history and a remediation run must each be told — so the row itself
 * carries it, and every reader shows the same text.
 */
export type RunnerJobTimeoutKind = "unclaimed" | "lease_expired" | "overall";

export function describeRunnerJobTimeout(data: {
  kind: RunnerJobTimeoutKind;
  /*
   * Whether any Runner claimed the job. A job still Pending when the
   * overall window ran out was never picked up, whatever its claim deadline
   * said, and a kubectl command is worded that way ("nothing was run").
   */
  wasClaimed?: boolean | undefined;
  origin: RunnerJobOrigin | undefined;
  stepType: RunbookStepType | undefined;
  claimTimeoutInMs: number;
  executionTimeoutInMs: number;
}): string {
  const isAiKubectl: boolean =
    data.stepType === RunbookStepType.Kubectl &&
    AI_COMMAND_JOB_ORIGINS.includes(data.origin || RunnerJobOrigin.Runbook);

  if (!isAiKubectl) {
    switch (data.kind) {
      case "unclaimed":
        return "No runbook agent picked up this step before the wait window expired. The agent may be offline — check that it is running and reachable, then try again.";
      case "lease_expired":
        return "The runbook agent stopped responding while this step was running. The agent may have crashed or lost its network connection — check that it is still online, then try running the runbook again.";
      default:
        return "This step ran longer than the allowed execution window. Increase the timeout on the step or make the script complete faster.";
    }
  }

  /*
   * A change that may have been applied must not read as "try again": for
   * a remediation command, say to look first.
   */
  const checkFirst: string =
    data.origin === RunnerJobOrigin.AiRemediation
      ? " Check the cluster before running a change again."
      : "";

  const kind: RunnerJobTimeoutKind =
    data.kind === "overall" && data.wasClaimed === false
      ? "unclaimed"
      : data.kind;

  switch (kind) {
    case "unclaimed":
      return `The cluster's Runner did not pick up this kubectl command within ${describeSeconds(
        data.claimTimeoutInMs,
      )} — it may be offline, restarting or busy with other work. Nothing was run on the cluster.`;
    case "lease_expired":
      return `The cluster's Runner stopped responding while this kubectl command was running — it may have restarted or lost its connection. What the command did is unknown.${checkFirst}`;
    default:
      return `The cluster's Runner did not report a result for this kubectl command in time — kubectl may have outlived its ${describeSeconds(
        data.executionTimeoutInMs,
      )} timeout. What the command did is unknown.${checkFirst}`;
  }
}

function describeSeconds(milliseconds: number): string {
  return `${Math.max(1, Math.round(milliseconds / 1000))}s`;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Why the target Runner, by its own reported posture, will refuse this
   * kubectl WRITE — or null when nothing it reported rules the write out.
   * The rule is the Runner's own (KubectlWriteScope.getRefusal, the one the
   * Runner asks before it spawns kubectl), asked here with what the Runner
   * reported instead of what it was started with. Refusing here means
   * nothing is approved, enqueued or counted by the cluster's circuit
   * breaker only to be refused on the Runner (or answered Forbidden by the
   * API server). Each refusal names the chart value to change.
   *
   * - writeNamespaces (aiAccess.remediation.namespaces) and podNamespace
   *   are the Runner's scope; a Runner that did not report one has none.
   * - allowNodeOperations === false (aiAccess.remediation.nodeOperations):
   *   no node operation. A Runner that never said (absent) is not
   *   second-guessed.
   * - usesCredential: a write that names no namespace lands in "default"
   *   through a credential's kubeconfig, and in the pod's own namespace
   *   in-cluster.
   *
   * Reads, and commands the policy denies outright, are never refused for
   * scope.
   */
  public static getRunnerWriteScopeRefusal(data: {
    policy: KubectlPolicyResult;
    posture: KubernetesRunnerPosture | undefined;
    usesCredential: boolean;
  }): string | null {
    const { policy, posture } = data;

    if (
      !posture ||
      policy.tier === KubectlCommandTier.Read ||
      policy.tier === KubectlCommandTier.Denied
    ) {
      return null;
    }

    const refusal: KubectlWriteScopeRefusal | null =
      KubectlWriteScope.getRefusal({
        command: policy,
        writeNamespaces: posture.writeNamespaces || [],
        podNamespace: posture.podNamespace || null,
        allowNodeOperations: posture.allowNodeOperations !== false,
        usesCredential: data.usesCredential,
      });

    return refusal ? Service.describeRunnerWriteScopeRefusal(refusal) : null;
  }

  // A write-scope refusal, worded for whoever enqueued the command.
  private static describeRunnerWriteScopeRefusal(
    refusal: KubectlWriteScopeRefusal,
  ): string {
    const command: string = `"${refusal.displayCommand}"`;
    const wouldRefuse: string =
      "so the Runner would refuse it. It was not enqueued.";
    const scopeList: string = `${refusal.writeNamespaces
      .map((allowed: string) => {
        return `"${allowed}"`;
      })
      .join(
        ", ",
      )}: aiAccess.remediation.namespaces on the Kubernetes agent chart, ${KUBECTL_WRITE_NAMESPACES_ENV}`;
    const namespace: string = refusal.namespace || "";
    const fix: string = refusal.fix ? ` ${refusal.fix}` : "";

    switch (refusal.code) {
      case "node_operations":
        return `${
          refusal.uncertainty === null
            ? `${command} changes a node`
            : `The cluster's Runner cannot tell for certain whether ${command} changes a node (${refusal.uncertainty})`
        }, and the cluster's Runner does not allow node operations (cordon, uncordon, drain, taint, or labelling, annotating or patching a Node): its Kubernetes agent was installed with aiAccess.remediation.nodeOperations=false (${KUBECTL_ALLOW_NODE_OPERATIONS_ENV}), ${wouldRefuse}${fix} To let OneUptime AI change nodes, upgrade the agent with --set aiAccess.remediation.nodeOperations=true.`;
      case "objects_uncertain":
      case "namespace_uncertain":
        return `The cluster's Runner cannot tell for certain which ${
          refusal.code === "namespace_uncertain" ? "namespace" : "objects"
        } ${command} changes (${refusal.uncertainty}), ${wouldRefuse}${fix}`;
      case "verb_mismatch":
        return `The cluster's Runner reads the verb of ${command} as "${refusal.readVerb}", but the kubectl policy read "${refusal.policyVerb}", so it cannot tell for certain what the command changes, ${wouldRefuse}`;
      case "unnamed_namespace_objects":
        return `${command} would change Namespace objects without naming them (a selector, --all or no name at all), so the cluster's Runner cannot tell whether one of them is ${
          refusal.podNamespace
            ? `"${refusal.podNamespace}", the namespace it runs in`
            : "outside the namespaces it lets OneUptime AI change"
        }, ${wouldRefuse}${fix}`;
      case "cluster_scoped":
        return `${command} changes ${refusal.clusterScopedKinds.join(
          ", ",
        )} objects, which are cluster-scoped: they live outside every namespace, so outside the namespaces the cluster's Runner lets OneUptime AI change (${scopeList}) whatever -n says, ${wouldRefuse}`;
      case "all_namespaces":
        return `${command} would change every namespace, including ones the cluster's Runner may not change, ${wouldRefuse}${fix}`;
      case "no_namespace":
        return `${command} names no namespace, and the cluster's Runner reported no namespace of its own for kubectl to use there, ${wouldRefuse}${fix}`;
      case "own_namespace":
        return refusal.namespaceSource === "namespace_object"
          ? `${command} would change the Namespace object "${namespace}", the namespace the cluster's in-cluster Runner itself runs in. OneUptime AI never changes it — a change there could reconfigure the Kubernetes agent or the Runner — ${wouldRefuse}`
          : `${command} would change namespace "${namespace}"${
              refusal.namespaceSource === "default_namespace"
                ? " (the command names none, so kubectl would use that one)"
                : ""
            }, the namespace the cluster's in-cluster Runner itself runs in. OneUptime AI never changes it — a change there could scale away the Kubernetes agent or the Runner — ${wouldRefuse} Name the namespace of the workload to fix with -n <namespace>.`;
      case "outside_scope":
        return `${command} would change ${
          refusal.namespaceSource === "namespace_object"
            ? `the Namespace object "${namespace}" (a Namespace object is judged by its name; -n does not apply to it)`
            : `namespace "${namespace}"${
                refusal.namespaceSource === "default_namespace"
                  ? " (the command names none, so kubectl would use that one)"
                  : ""
              }`
        }, which is outside the namespaces the cluster's Runner lets OneUptime AI change (${scopeList}), ${wouldRefuse} To let OneUptime AI change "${namespace}", add it to aiAccess.remediation.namespaces and upgrade the agent.`;
      default: {
        const unhandled: never = refusal.code;
        return unhandled;
      }
    }
  }

  @CaptureSpan()
  public async enqueue(data: {
    projectId: ObjectID;
    runbookExecutionId: ObjectID;
    stepId: string;
    stepType: RunbookStepType;
    targetAgentId: ObjectID;
    script: string;
    timeoutInMs: number;
    claimTimeoutInMs?: number | undefined;
    payload?: JSONObject | undefined;
  }): Promise<Model> {
    if (!data.targetAgentId) {
      throw new BadDataException(
        "targetAgentId is required to dispatch a step to a Runner.",
      );
    }

    if (!isRunnerExecutedStepType(data.stepType)) {
      throw new BadDataException(
        `Runner does not execute step type "${data.stepType}".`,
      );
    }

    /*
     * Each runner-executed type carries its instruction in exactly one place:
     * a script, or a structured payload. Enforced here rather than as a
     * required column because it is per-type — the column check would reject
     * an SSH job's empty script, which is the shape SSH jobs are supposed to
     * have. A job dispatched with neither would reach a Runner that has
     * nothing to do and report success, which looks identical to a step that
     * actually ran.
     */
    if (isPayloadCarryingStepType(data.stepType)) {
      if (!data.payload) {
        throw new BadDataException(
          `A ${data.stepType} job needs structured instructions to send to the Runner.`,
        );
      }
    } else if (!data.script) {
      throw new BadDataException(
        `A ${data.stepType} job needs a script for the Runner to execute.`,
      );
    }

    const claimDeadlineAt: Date = OneUptimeDate.addRemoveSeconds(
      OneUptimeDate.getCurrentDate(),
      Math.ceil((data.claimTimeoutInMs ?? DEFAULT_CLAIM_TIMEOUT_MS) / 1000),
    );

    const row: Model = new Model();
    row.projectId = data.projectId;
    row.runbookExecutionId = data.runbookExecutionId;
    row.origin = RunnerJobOrigin.Runbook;
    row.stepId = data.stepId;
    row.stepType = data.stepType;
    row.targetAgentId = data.targetAgentId;
    // The column is NOT NULL, so a payload-carrying job stores "" rather than null.
    row.script = data.script || "";
    if (data.payload) {
      row.payload = data.payload;
    }
    row.timeoutInMs = data.timeoutInMs;
    row.status = RunnerJobStatus.Pending;
    row.claimDeadlineAt = claimDeadlineAt;

    return this.create({ data: row, props: { isRoot: true } });
  }

  /*
   * Enqueue an ad-hoc AI-composed command as an AiRemediation-origin job.
   * This is a server-side chokepoint on the path an LLM's output takes to a
   * shell, so it re-validates what the tool layer already checked: step
   * type and the hard command denylist. The claim path then only serves
   * these jobs to Runners whose canRunAiCommands capability is on.
   */
  @CaptureSpan()
  public async enqueueAiCommand(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
    autoRemediationSuggestionId: ObjectID;
    stepId: string;
    stepType: RunbookStepType;
    targetAgentId: ObjectID;
    command: string;
    credentialId?: string | undefined;
    timeoutInMs: number;
    claimTimeoutInMs?: number | undefined;
  }): Promise<Model> {
    if (!data.targetAgentId) {
      throw new BadDataException(
        "targetAgentId is required to dispatch a command to a Runner.",
      );
    }

    if (!AI_COMMAND_STEP_TYPES.includes(data.stepType)) {
      throw new BadDataException(
        `AI remediation does not execute step type "${data.stepType}".`,
      );
    }

    /*
     * kubectl has its own policy and its own payload shape (an argv, a
     * cluster, an optional credential) — enqueueAiKubectlCommand owns it.
     */
    if (data.stepType === RunbookStepType.Kubectl) {
      throw new BadDataException(
        "Kubectl commands are enqueued through enqueueAiKubectlCommand.",
      );
    }

    const command: string = (data.command || "").trim();
    if (!command) {
      throw new BadDataException("An AI command job needs a command.");
    }

    const denyReason: string | null = CommandPolicy.getDenyReason(command);
    if (denyReason) {
      throw new BadDataException(
        `Denied by the remediation command policy: ${denyReason}.`,
      );
    }

    if (data.stepType === RunbookStepType.SSH && !data.credentialId) {
      throw new BadDataException("An SSH command job needs a credentialId.");
    }

    /*
     * The target must be one of this project's Runners, and never a
     * kubernetes-agent Runner. That Runner exists to run policy-tiered
     * kubectl with its own ServiceAccount: the claim path serves it kubectl
     * only, so a Bash or SSH job aimed at it would sit unclaimed until its
     * deadline after a human approved it — and its identity is minted with
     * the project's telemetry ingestion key, so it must never be handed
     * AI-composed shell work or an SSH credential. Checked here, at the
     * enqueue chokepoint, so an already-stored plan is refused too.
     */
    const targetRunner: Runner | null = await RunnerService.findOneBy({
      query: {
        _id: data.targetAgentId.toString(),
        projectId: data.projectId,
      },
      select: { _id: true, name: true, hostInfo: true },
      props: { isRoot: true },
    });

    if (!targetRunner) {
      throw new BadDataException(
        "The target Runner was not found or it does not belong to this project.",
      );
    }

    // The one "is an agent row" rule: the name marker or an agent posture.
    if (RunnerServiceClass.isKubernetesAgentRunnerRow(targetRunner)) {
      throw new BadDataException(
        `Runner "${targetRunner.name}" is a cluster's in-cluster Runner: it runs kubectl through its cluster only, never ${data.stepType} commands. Target the Kubernetes cluster instead, or pick a Runner you created under Project Settings → Runners.`,
      );
    }

    /*
     * Project-wide hourly storm brake for the whole AI-command lane. It
     * lives HERE, at the single enqueue chokepoint, so it also bounds the
     * approved-plan and rollback paths — not just the FullAuto inline tool
     * that has its own pre-check for a friendlier message to the model.
     * Check-then-act, so a burst of concurrent runs can overshoot slightly;
     * the cap is a storm brake, not a quota.
     */
    const jobsInLastHour: number = (
      await this.countBy({
        query: {
          projectId: data.projectId,
          origin: RunnerJobOrigin.AiRemediation,
          createdAt: QueryHelper.greaterThan(OneUptimeDate.getSomeHoursAgo(1)),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    if (jobsInLastHour >= MAX_AI_COMMAND_JOBS_PER_PROJECT_PER_HOUR) {
      throw new BadDataException(
        `This project has run ${jobsInLastHour} AI remediation commands in the last hour, which is its limit (${MAX_AI_COMMAND_JOBS_PER_PROJECT_PER_HOUR}). No further AI commands can run this hour.`,
      );
    }

    const claimDeadlineAt: Date = OneUptimeDate.addRemoveSeconds(
      OneUptimeDate.getCurrentDate(),
      Math.ceil((data.claimTimeoutInMs ?? DEFAULT_CLAIM_TIMEOUT_MS) / 1000),
    );

    const row: Model = new Model();
    row.projectId = data.projectId;
    row.origin = RunnerJobOrigin.AiRemediation;
    row.aiRunId = data.aiRunId;
    row.autoRemediationSuggestionId = data.autoRemediationSuggestionId;
    row.stepId = data.stepId;
    row.stepType = data.stepType;
    row.targetAgentId = data.targetAgentId;
    /*
     * Same layout the runbook step executors use: Bash carries the command
     * as the script; SSH carries an empty script plus structured payload,
     * and the credential is resolved at claim time — never stored here.
     */
    if (data.stepType === RunbookStepType.Bash) {
      row.script = command;
    } else {
      row.script = "";
      row.payload = {
        credentialId: data.credentialId as string,
        command: command,
      };
    }
    row.timeoutInMs = data.timeoutInMs;
    row.status = RunnerJobStatus.Pending;
    row.claimDeadlineAt = claimDeadlineAt;

    return this.create({ data: row, props: { isRoot: true } });
  }

  /*
   * Enqueue ONE kubectl command OneUptime AI composed against a cluster.
   *
   * This is the server-side chokepoint between an LLM's output and a
   * cluster's API server, so it re-runs the kubectl policy regardless of
   * what the tool layer checked: Denied never enqueues, and an
   * investigation-origin job must be Read tier — an investigation can never
   * write, no matter which prompt produced the call. The Runner re-checks
   * the same policy on the argv it receives.
   *
   * The command travels as an argv in the payload (never a shell line) plus
   * the cluster and, for Runners outside the cluster, the credential id the
   * ingress resolves at claim time. In-cluster Runners carry no credential:
   * kubectl uses the pod's own ServiceAccount — which reaches whatever
   * cluster that pod lives in. So a credential-less job is only ever
   * enqueued for the in-cluster Runner OF THIS CLUSTER (its posture names
   * the cluster), and the payload carries the cluster's identifier so the
   * claim path and the Runner can refuse a job that reaches the wrong pod.
   * A credential is never sent to a kubernetes-agent Runner (its identity
   * is minted with the project's telemetry ingestion key).
   *
   * It also re-reads the cluster's CURRENT AI access configuration, because
   * every caller acts on a snapshot (an investigation reads the cluster's
   * status once when it starts, a remediation run when it composes): the
   * target must still be the cluster's bound Runner, a credential must still
   * be its bound Kubernetes credential, an investigation's reads need "Let
   * AI investigate with kubectl" still on, and a remediation run's commands
   * (its reads included) need the cluster's remediation still enabled. An
   * operator who revokes or re-points access therefore stops an in-flight
   * run at its next command.
   */
  @CaptureSpan()
  public async enqueueAiKubectlCommand(data: {
    projectId: ObjectID;
    /*
     * The AI run the command belongs to. Required for an investigation job;
     * absent only for the dashboard's access test (isAccessTest), which
     * runs a read command with no AI run behind it.
     */
    aiRunId?: ObjectID | undefined;
    origin: RunnerJobOrigin.AiInvestigation | RunnerJobOrigin.AiRemediation;
    autoRemediationSuggestionId?: ObjectID | undefined;
    kubernetesClusterId: ObjectID;
    stepId: string;
    targetAgentId: ObjectID;
    credentialId?: string | undefined;
    command: string;
    timeoutInMs: number;
    claimTimeoutInMs?: number | undefined;
    /*
     * The cluster AI page's "Test access" check. It is how an operator
     * verifies access BEFORE turning AI on, so it is exempt from the
     * investigation switch — never from the binding, the policy or the
     * read-only rule — and it is kept out of the project-wide investigation
     * brake (the test route has its own per-cluster and per-user limits),
     * so testing can never starve real incident investigations.
     */
    isAccessTest?: boolean | undefined;
  }): Promise<Model> {
    if (!data.targetAgentId) {
      throw new BadDataException(
        "targetAgentId is required to dispatch a kubectl command to a Runner.",
      );
    }

    if (!data.kubernetesClusterId) {
      throw new BadDataException(
        "kubernetesClusterId is required for a kubectl command.",
      );
    }

    if (
      data.origin !== RunnerJobOrigin.AiInvestigation &&
      data.origin !== RunnerJobOrigin.AiRemediation
    ) {
      throw new BadDataException(
        `A kubectl command job cannot have origin "${String(data.origin)}".`,
      );
    }

    if (
      data.origin === RunnerJobOrigin.AiRemediation &&
      !data.autoRemediationSuggestionId
    ) {
      throw new BadDataException(
        "A kubectl remediation job needs its auto-remediation suggestion.",
      );
    }

    const isAccessTest: boolean = data.isAccessTest === true;

    /*
     * The access test is the only kubectl job without an AI run, and it is
     * a read: that is what lets the investigation brake below count real
     * investigations only (rows with an AI run) without the test slipping
     * work past it under another name.
     */
    if (
      isAccessTest &&
      (data.origin !== RunnerJobOrigin.AiInvestigation || data.aiRunId)
    ) {
      throw new BadDataException(
        "An access test is a read-only check with no AI run behind it.",
      );
    }

    if (
      data.origin === RunnerJobOrigin.AiInvestigation &&
      !isAccessTest &&
      !data.aiRunId
    ) {
      throw new BadDataException(
        "An investigation kubectl job needs the AI run it belongs to.",
      );
    }

    const policy: KubectlPolicyResult = KubectlPolicy.evaluateCommand(
      data.command,
    );

    if (policy.tier === KubectlCommandTier.Denied) {
      throw new BadDataException(
        `Denied by the kubectl command policy: ${policy.reason}.`,
      );
    }

    if (
      data.origin === RunnerJobOrigin.AiInvestigation &&
      policy.tier !== KubectlCommandTier.Read
    ) {
      throw new BadDataException(
        `An investigation may only run read-only kubectl commands; "${policy.displayCommand}" would change the cluster (${policy.tier}).`,
      );
    }

    /*
     * The access test is bounded by its own route limits instead, and an
     * investigation's brake counts only rows with an AI run, so tests never
     * spend the budget real investigations share.
     */
    if (!isAccessTest) {
      const hourlyCap: number =
        data.origin === RunnerJobOrigin.AiInvestigation
          ? MAX_AI_INVESTIGATION_COMMAND_JOBS_PER_PROJECT_PER_HOUR
          : MAX_AI_COMMAND_JOBS_PER_PROJECT_PER_HOUR;

      const jobsInLastHour: number = (
        await this.countBy({
          query: {
            projectId: data.projectId,
            origin: data.origin,
            createdAt: QueryHelper.greaterThan(
              OneUptimeDate.getSomeHoursAgo(1),
            ),
            ...(data.origin === RunnerJobOrigin.AiInvestigation
              ? { aiRunId: QueryHelper.notNull() }
              : {}),
          },
          props: { isRoot: true },
        })
      ).toNumber();

      if (jobsInLastHour >= hourlyCap) {
        throw new BadDataException(
          data.origin === RunnerJobOrigin.AiInvestigation
            ? `This project has run ${jobsInLastHour} AI investigation commands in the last hour, which is its limit (${hourlyCap}). No further cluster commands can run this hour.`
            : `This project has run ${jobsInLastHour} AI remediation commands in the last hour, which is its limit (${hourlyCap}). No further AI commands can run this hour.`,
        );
      }
    }

    /*
     * The cluster and the target Runner must both be THIS project's. The
     * cluster's identifier travels in the payload; without a credential the
     * Runner must be that cluster's own in-cluster agent, because its
     * ServiceAccount reaches only the cluster its pod lives in.
     */
    const cluster: KubernetesCluster | null =
      await KubernetesClusterService.findOneBy({
        query: {
          _id: data.kubernetesClusterId.toString(),
          projectId: data.projectId,
        },
        select: {
          _id: true,
          name: true,
          clusterIdentifier: true,
          aiAccessRunnerId: true,
          aiAccessCredentialId: true,
          isAiInvestigationEnabled: true,
          aiRemediationMode: true,
        },
        props: { isRoot: true },
      });

    if (!cluster) {
      throw new BadDataException(
        "Kubernetes cluster not found or it does not belong to this project.",
      );
    }

    const clusterIdentifier: string = (cluster.clusterIdentifier || "").trim();
    const clusterLabel: string =
      cluster.name || clusterIdentifier || data.kubernetesClusterId.toString();

    const bindingRefusal: string | null = Service.getClusterBindingRefusal({
      cluster,
      clusterLabel,
      targetAgentId: data.targetAgentId,
      credentialId: data.credentialId,
      requiredSwitch: await this.getRequiredClusterSwitch({
        projectId: data.projectId,
        origin: data.origin,
        aiRunId: data.aiRunId,
        isAccessTest,
      }),
    });

    if (bindingRefusal) {
      throw new BadDataException(bindingRefusal);
    }

    const targetRunner: Runner | null = await RunnerService.findOneBy({
      query: {
        _id: data.targetAgentId.toString(),
        projectId: data.projectId,
      },
      select: { _id: true, name: true, hostInfo: true },
      props: { isRoot: true },
    });

    if (!targetRunner) {
      throw new BadDataException(
        "The target Runner was not found or it does not belong to this project.",
      );
    }

    if (data.credentialId) {
      /*
       * A kubernetes-agent Runner is never handed credential material: its
       * identity is issued with the project's telemetry ingestion key, so
       * anyone holding that key could come to hold the credential too. The
       * claim path refuses it as well (by the same name-or-posture rule);
       * refusing here keeps the job from ever existing.
       */
      if (RunnerServiceClass.isKubernetesAgentRunnerRow(targetRunner)) {
        throw new BadDataException(
          `Runner "${targetRunner.name}" is a cluster's in-cluster Runner and is never given a credential, so a kubectl command for cluster "${clusterLabel}" that needs one cannot run on it. Create a Runner under Project Settings → Runners, assign the Kubernetes credential to it and select both on the cluster's AI page.`,
        );
      }

      const credential: RunbookCredential | null = ObjectID.isValidUUID(
        data.credentialId,
      )
        ? await RunbookCredentialService.findOneBy({
            query: {
              _id: data.credentialId,
              projectId: data.projectId,
            },
            select: { _id: true, name: true, credentialType: true },
            props: { isRoot: true },
          })
        : null;

      if (
        !credential ||
        credential.credentialType !== RunbookCredentialType.Kubernetes
      ) {
        throw new BadDataException(
          `The credential this kubectl command names is not a Kubernetes credential of this project, so it was not enqueued for cluster "${clusterLabel}".`,
        );
      }
    }

    const posture: KubernetesRunnerPosture | undefined =
      parseKubernetesRunnerPosture(targetRunner.hostInfo);

    if (!data.credentialId) {
      if (!isInClusterPostureForCluster(posture, clusterIdentifier)) {
        throw new BadDataException(
          `A kubectl command without a Kubernetes credential can only run on the in-cluster Runner of cluster "${
            clusterIdentifier || cluster.name || cluster.id?.toString()
          }", and Runner "${targetRunner.name}" ${
            posture?.inCluster
              ? `is the in-cluster Runner of ${
                  posture.clusterIdentifier?.trim()
                    ? `cluster "${posture.clusterIdentifier.trim()}"`
                    : "an unnamed cluster"
                }`
              : "runs outside the cluster"
          }. Select a Kubernetes credential for this Runner on the cluster's AI page, or install the in-cluster Runner on this cluster.`,
        );
      }
    }

    /*
     * A remediation write the Runner's own posture says it will refuse — a
     * namespace outside its write scope, its own namespace, or a node
     * operation its chart did not grant — is refused here, before it can be
     * approved, enqueued or counted by the cluster's circuit breaker, with
     * the chart value that would allow it. Reads are never refused for
     * scope.
     */
    if (data.origin === RunnerJobOrigin.AiRemediation) {
      const scopeRefusal: string | null = Service.getRunnerWriteScopeRefusal({
        policy,
        posture,
        usesCredential: Boolean(data.credentialId),
      });

      if (scopeRefusal) {
        throw new BadDataException(scopeRefusal);
      }
    }

    const claimDeadlineAt: Date = OneUptimeDate.addRemoveSeconds(
      OneUptimeDate.getCurrentDate(),
      Math.ceil((data.claimTimeoutInMs ?? DEFAULT_CLAIM_TIMEOUT_MS) / 1000),
    );

    const row: Model = new Model();
    row.projectId = data.projectId;
    row.origin = data.origin;
    if (data.aiRunId) {
      row.aiRunId = data.aiRunId;
    }
    if (data.autoRemediationSuggestionId) {
      row.autoRemediationSuggestionId = data.autoRemediationSuggestionId;
    }
    row.kubernetesClusterId = data.kubernetesClusterId;
    row.stepId = data.stepId;
    row.stepType = RunbookStepType.Kubectl;
    row.targetAgentId = data.targetAgentId;
    row.script = "";
    row.payload = {
      args: policy.args,
      displayCommand: policy.displayCommand,
      tier: policy.tier,
      kubernetesClusterId: data.kubernetesClusterId.toString(),
      ...(clusterIdentifier ? { clusterIdentifier } : {}),
      ...(data.credentialId ? { credentialId: data.credentialId } : {}),
    };
    row.timeoutInMs = data.timeoutInMs;
    row.status = RunnerJobStatus.Pending;
    row.claimDeadlineAt = claimDeadlineAt;

    return this.create({ data: row, props: { isRoot: true } });
  }

  /*
   * Which of the cluster's AI switches must still be on for this kubectl
   * job, or null for none (the access test, which is how an operator checks
   * access before turning AI on).
   *
   * A remediation job needs remediation. A read-only (investigation-origin)
   * job follows the run it belongs to: a remediation run reads the cluster
   * it may fix through the same read-only lane — even when the operator
   * left investigation off — so its reads need remediation, and every
   * other run's reads need the investigation switch.
   */
  private async getRequiredClusterSwitch(data: {
    projectId: ObjectID;
    origin: RunnerJobOrigin;
    aiRunId?: ObjectID | undefined;
    isAccessTest: boolean;
  }): Promise<"investigation" | "remediation" | null> {
    if (data.origin === RunnerJobOrigin.AiRemediation) {
      return "remediation";
    }

    if (data.isAccessTest || !data.aiRunId) {
      return null;
    }

    const run: AIRun | null = await AIRunService.findOneBy({
      query: {
        _id: data.aiRunId.toString(),
        projectId: data.projectId,
      },
      select: { _id: true, runType: true },
      props: { isRoot: true },
    });

    return run?.runType && REMEDIATION_RUN_TYPES.includes(run.runType)
      ? "remediation"
      : "investigation";
  }

  /*
   * Why a kubectl job may NOT be enqueued for this cluster as it is
   * configured right now, or null when it may. Pure, so the rule reads in
   * one place: the job must go through the cluster's CURRENT binding, and
   * the capability it is for must still be switched on.
   *
   * A credential-less job does not require the credential binding to be
   * empty: the in-cluster Runner of the cluster wins over a bound
   * credential (the readiness status prefers it), so such a job is
   * legitimate with a credential still selected.
   */
  public static getClusterBindingRefusal(data: {
    cluster: KubernetesCluster;
    clusterLabel: string;
    targetAgentId: ObjectID;
    credentialId?: string | undefined;
    // The switch that must still be on; null for the access test.
    requiredSwitch: "investigation" | "remediation" | null;
  }): string | null {
    const { cluster, clusterLabel } = data;

    if (
      !cluster.aiAccessRunnerId ||
      cluster.aiAccessRunnerId.toString() !== data.targetAgentId.toString()
    ) {
      return `Cluster "${clusterLabel}" is no longer reached through this Runner (its AI access binding changed or was cleared on the cluster's AI page), so this kubectl command was not enqueued.`;
    }

    if (
      data.credentialId &&
      (!cluster.aiAccessCredentialId ||
        cluster.aiAccessCredentialId.toString() !== data.credentialId)
    ) {
      return `Cluster "${clusterLabel}" is no longer reached with this Kubernetes credential (its AI access binding changed or was cleared on the cluster's AI page), so this kubectl command was not enqueued.`;
    }

    if (
      data.requiredSwitch === "investigation" &&
      cluster.isAiInvestigationEnabled !== true
    ) {
      return `"Let AI investigate with kubectl" is turned off for cluster "${clusterLabel}", so this investigation command was not enqueued.`;
    }

    if (
      data.requiredSwitch === "remediation" &&
      !ENABLED_REMEDIATION_MODES.includes(
        cluster.aiRemediationMode as KubernetesAiRemediationMode,
      )
    ) {
      return `AI remediation is turned off for cluster "${clusterLabel}", so this kubectl command was not enqueued.`;
    }

    return null;
  }

  /*
   * The job this (execution, step) pair already produced, if any.
   *
   * A runbook execution runs inside a single BullMQ job, so a Worker restart
   * mid-step means the execution is re-delivered and RunRunbook walks back to
   * the same step — which is still persisted as Running. Without this lookup
   * the step would be dispatched a second time and the agent would run the
   * script again. The dispatcher calls this first: a terminal row is the
   * step's result, a live row is something to re-attach to.
   *
   * A step is dispatched at most once per execution, so the newest row is the
   * only one there can be; ordering is belt-and-braces against a torn write
   * from a previous release.
   */
  @CaptureSpan()
  public async findLatestJobForStep(data: {
    runbookExecutionId: ObjectID;
    stepId: string;
  }): Promise<Model | null> {
    const jobs: Array<Model> = await this.findBy({
      query: {
        runbookExecutionId: data.runbookExecutionId,
        stepId: data.stepId,
      },
      select: {
        _id: true,
        status: true,
        output: true,
        exitCode: true,
        errorMessage: true,
        createdAt: true,
      },
      sort: { createdAt: SortOrder.Descending },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    return jobs[0] || null;
  }

  /*
   * Atomically claim the oldest Pending job in the agent's project targeted
   * at this specific agent. Uses FOR UPDATE SKIP LOCKED so concurrent agents
   * don't fight over the same row.
   */
  @CaptureSpan()
  public async claimNextJob(data: {
    agentId: ObjectID;
    projectId: ObjectID;
    leaseMs?: number | undefined;
    /*
     * Which job origins this Runner's capabilities entitle it to claim.
     * Defaults to runbook jobs only — the AiRemediation origin must be
     * asked for explicitly by the ingress after checking canRunAiCommands.
     */
    allowedOrigins?: Array<RunnerJobOrigin> | undefined;
    /*
     * Which step types this Runner may be handed. Undefined means every
     * runner-executed type (the historical contract); an explicit empty
     * list means nothing at all and returns null without touching the
     * database. The ingress narrows this for the kubernetes-agent Runner
     * (kubectl only) and for a Runner that declares its own list on the
     * claim, so an AI-composed shell command can never be leased by a pod
     * that only exists to run kubectl.
     */
    allowedStepTypes?: Array<RunbookStepType> | undefined;
  }): Promise<Model | null> {
    if (data.allowedStepTypes && data.allowedStepTypes.length === 0) {
      return null;
    }

    const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
      PostgresAppInstance.getDataSource();

    if (!dataSource) {
      throw new BadDataException("Database is not connected");
    }

    const leaseMs: number = data.leaseMs ?? DEFAULT_LEASE_MS;

    const allowedOrigins: Array<RunnerJobOrigin> =
      data.allowedOrigins && data.allowedOrigins.length > 0
        ? data.allowedOrigins
        : [RunnerJobOrigin.Runbook];

    const allowedStepTypes: Array<RunbookStepType> | null =
      data.allowedStepTypes ?? null;

    const sql: string = `
      WITH claimed AS (
        SELECT "_id" FROM "RunnerJob"
        WHERE "projectId" = $1::uuid
          AND "status" = $2
          AND "targetAgentId" = $3::uuid
          AND "origin" = ANY($6::text[])
          AND ($7::text[] IS NULL OR "stepType" = ANY($7::text[]))
          AND "claimDeadlineAt" > NOW()
          AND "deletedAt" IS NULL
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "RunnerJob" j
      SET "status" = $4,
          "assignedAgentId" = $3::uuid,
          "claimedAt" = NOW(),
          "leaseExpiresAt" = NOW() + ($5 || ' milliseconds')::interval,
          "updatedAt" = NOW(),
          "version" = j."version" + 1
      FROM claimed
      WHERE j."_id" = claimed."_id"
      RETURNING j."_id", j."projectId", j."runbookExecutionId", j."origin",
                j."aiRunId", j."autoRemediationSuggestionId",
                j."stepId", j."stepType", j."targetAgentId", j."script",
                j."payload", j."timeoutInMs", j."status", j."claimedAt",
                j."leaseExpiresAt";
    `;

    const rows: Array<JSONObject> = unwrapRows(
      await dataSource.query(sql, [
        data.projectId.toString(),
        RunnerJobStatus.Pending,
        data.agentId.toString(),
        RunnerJobStatus.Claimed,
        leaseMs.toString(),
        allowedOrigins,
        allowedStepTypes,
      ]),
    );

    if (!rows || rows.length === 0) {
      return null;
    }

    const r: JSONObject = rows[0]!;
    const job: Model = new Model();
    job._id = String(r["_id"]);
    job.projectId = new ObjectID(String(r["projectId"]));
    if (r["runbookExecutionId"]) {
      job.runbookExecutionId = new ObjectID(String(r["runbookExecutionId"]));
    }
    job.origin = (r["origin"] as RunnerJobOrigin) || RunnerJobOrigin.Runbook;
    if (r["aiRunId"]) {
      job.aiRunId = new ObjectID(String(r["aiRunId"]));
    }
    if (r["autoRemediationSuggestionId"]) {
      job.autoRemediationSuggestionId = new ObjectID(
        String(r["autoRemediationSuggestionId"]),
      );
    }
    job.stepId = String(r["stepId"]);
    job.stepType = r["stepType"] as RunbookStepType;
    job.targetAgentId = new ObjectID(String(r["targetAgentId"]));
    job.script = String(r["script"]);
    if (r["payload"] && typeof r["payload"] === "object") {
      job.payload = r["payload"] as JSONObject;
    }
    job.timeoutInMs = Number(r["timeoutInMs"]);
    job.status = r["status"] as RunnerJobStatus;
    if (r["claimedAt"]) {
      job.claimedAt = new Date(String(r["claimedAt"]));
    }
    if (r["leaseExpiresAt"]) {
      job.leaseExpiresAt = new Date(String(r["leaseExpiresAt"]));
    }
    job.assignedAgentId = data.agentId;
    return job;
  }

  @CaptureSpan()
  public async heartbeatJob(data: {
    jobId: ObjectID;
    agentId: ObjectID;
    leaseMs?: number | undefined;
  }): Promise<boolean> {
    const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
      PostgresAppInstance.getDataSource();
    if (!dataSource) {
      throw new BadDataException("Database is not connected");
    }

    const leaseMs: number = data.leaseMs ?? DEFAULT_LEASE_MS;

    /*
     * Only refresh the lease if this agent still owns the job and it hasn't
     * reached a terminal state. If another agent reclaimed it, the agent
     * should stop executing.
     */
    const sql: string = `
      UPDATE "RunnerJob"
      SET "status" = CASE WHEN "status" = $4 THEN $5 ELSE "status" END,
          "startedAt" = COALESCE("startedAt", NOW()),
          "leaseExpiresAt" = NOW() + ($1 || ' milliseconds')::interval,
          "updatedAt" = NOW(),
          "version" = "version" + 1
      WHERE "_id" = $2::uuid
        AND "assignedAgentId" = $3::uuid
        AND "status" IN ($4, $5)
      RETURNING "_id";
    `;
    const rows: Array<JSONObject> = unwrapRows(
      await dataSource.query(sql, [
        leaseMs.toString(),
        data.jobId.toString(),
        data.agentId.toString(),
        RunnerJobStatus.Claimed,
        RunnerJobStatus.Running,
      ]),
    );

    return rows.length > 0;
  }

  /*
   * What an AI-origin job's output looks like on the row. The dashboard
   * renders RunnerJob.output verbatim on the cluster's AI page and the
   * remediation card, so a `kubectl get secret -o yaml` an investigation
   * ran must never land there with its data values intact: the same two
   * passes KubectlJobRunner applies before the model sees the output are
   * applied here before the row does. Both are pure text transforms (the
   * redactor is dependency-free by design; importing KubectlJobRunner into
   * this service would be an import cycle). A runbook step's output is the
   * operator's own script and is stored as it was.
   */
  public static redactAiJobText(text: string): string {
    return ToolResultSerializer.redact(KubectlOutputRedactor.redact(text).text)
      .text;
  }

  /*
   * A Runner's text as a Postgres text column can hold it. A NUL byte is
   * ordinary in what a Runner reports — `kubectl logs` of a log that was
   * rotated with copytruncate, a ConfigMap value `describe` prints
   * verbatim, a script that writes binary — and Postgres refuses the whole
   * UPDATE over one, so the result could never be stored: every submission
   * failed the same way, the Runner retried it as if the server were down,
   * and the job ended "result unknown" although the command had run. Each
   * such character becomes U+FFFD instead, for every origin, and before
   * anything else reads the text.
   */
  public static toStorableText(text: string): string {
    return text
      .replace(
        NUL_CHARACTER_PATTERN,
        RUNNER_JOB_UNSTORABLE_CHARACTER_REPLACEMENT,
      )
      .replace(SURROGATE_PATTERN, keepSurrogatePairOnly);
  }

  @CaptureSpan()
  public async submitResult(data: {
    jobId: ObjectID;
    agentId: ObjectID;
    success: boolean;
    output?: string | undefined;
    exitCode?: number | undefined;
    errorMessage?: string | undefined;
  }): Promise<boolean> {
    const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
      PostgresAppInstance.getDataSource();
    if (!dataSource) {
      throw new BadDataException("Database is not connected");
    }

    const status: RunnerJobStatus = data.success
      ? RunnerJobStatus.Succeeded
      : RunnerJobStatus.Failed;

    /*
     * Made storable first: every text parameter below is bound whichever
     * branch of the CASE the row takes, so one unstorable character in any
     * of them would fail the write for every origin.
     */
    const rawOutput: string | null =
      typeof data.output === "string"
        ? Service.toStorableText(data.output)
        : null;
    const rawErrorMessage: string | null =
      typeof data.errorMessage === "string"
        ? Service.toStorableText(data.errorMessage)
        : null;

    /*
     * The origin decides which text is stored, and it is read in the same
     * statement rather than looked up first so the lease check and the
     * write stay one atomic step (and one round trip): the CASE picks the
     * redacted text for an AI-origin row and the verbatim text otherwise.
     */
    const redactedOutput: string | null =
      rawOutput === null ? null : Service.redactAiJobText(rawOutput);
    const redactedErrorMessage: string | null =
      rawErrorMessage === null
        ? null
        : Service.redactAiJobText(rawErrorMessage);

    /*
     * Only the agent that holds the lease is allowed to write the terminal
     * result. If the lease has already moved on (Worker timed out and
     * reclaimed), this is a no-op.
     */
    const sql: string = `
      UPDATE "RunnerJob"
      SET "status" = $1,
          "output" = CASE
            WHEN "origin" = ANY($9::text[]) THEN $10::text
            ELSE $2::text
          END,
          "exitCode" = $3,
          "errorMessage" = CASE
            WHEN "origin" = ANY($9::text[]) THEN $11::text
            ELSE $4::text
          END,
          "completedAt" = NOW(),
          "updatedAt" = NOW(),
          "version" = "version" + 1
      WHERE "_id" = $5::uuid
        AND "assignedAgentId" = $6::uuid
        AND "status" IN ($7, $8)
      RETURNING "_id";
    `;
    const rows: Array<JSONObject> = unwrapRows(
      await dataSource.query(sql, [
        status,
        rawOutput,
        data.exitCode ?? null,
        rawErrorMessage,
        data.jobId.toString(),
        data.agentId.toString(),
        RunnerJobStatus.Claimed,
        RunnerJobStatus.Running,
        AI_COMMAND_JOB_ORIGINS,
        redactedOutput,
        redactedErrorMessage,
      ]),
    );

    return rows.length > 0;
  }

  /*
   * Called by the Worker after enqueueing. Polls the job row every
   * POLL_INTERVAL_MS until the job reaches a terminal status, or until the
   * combined claim + execution window is exhausted (in which case we mark
   * the job TimedOut ourselves and return it).
   *
   * waitStartedAt anchors that window. It defaults to now — right for a job
   * this Worker just enqueued — but a Worker re-attaching to a job left behind
   * by a restart passes the job's createdAt, so the step keeps the single
   * window its author configured instead of earning a fresh one per redelivery.
   */
  @CaptureSpan()
  public async pollUntilTerminal(data: {
    jobId: ObjectID;
    claimTimeoutInMs: number;
    executionTimeoutInMs: number;
    waitStartedAt?: Date | undefined;
  }): Promise<Model> {
    const overallDeadline: Date = OneUptimeDate.addRemoveSeconds(
      data.waitStartedAt || OneUptimeDate.getCurrentDate(),
      Math.ceil(
        (data.claimTimeoutInMs + data.executionTimeoutInMs + 5_000) / 1000,
      ),
    );

    while (true) {
      const job: Model | null = await this.findOneById({
        id: data.jobId,
        select: {
          _id: true,
          status: true,
          output: true,
          exitCode: true,
          errorMessage: true,
          claimDeadlineAt: true,
          leaseExpiresAt: true,
          claimedAt: true,
          startedAt: true,
          completedAt: true,
          assignedAgentId: true,
          // The timeout reason is worded for what the job is.
          origin: true,
          stepType: true,
        },
        props: { isRoot: true },
      });

      if (!job) {
        throw new BadDataException(
          `RunnerJob ${data.jobId.toString()} disappeared while waiting.`,
        );
      }

      if (isTerminalAgentJobStatus(job.status)) {
        return job;
      }

      const now: Date = OneUptimeDate.getCurrentDate();
      let timeoutKind: RunnerJobTimeoutKind | null = null;

      if (
        job.status === RunnerJobStatus.Pending &&
        job.claimDeadlineAt &&
        now > job.claimDeadlineAt
      ) {
        // Pending with claim deadline elapsed -> no agent picked it up.
        timeoutKind = "unclaimed";
      } else if (
        (job.status === RunnerJobStatus.Claimed ||
          job.status === RunnerJobStatus.Running) &&
        job.leaseExpiresAt &&
        now > job.leaseExpiresAt
      ) {
        // Claimed/Running with lease elapsed -> agent went silent.
        timeoutKind = "lease_expired";
      } else if (now > overallDeadline) {
        timeoutKind = "overall";
      }

      if (timeoutKind) {
        return this.timeoutJob({
          jobId: data.jobId,
          reason: describeRunnerJobTimeout({
            kind: timeoutKind,
            wasClaimed: job.status !== RunnerJobStatus.Pending,
            origin: job.origin,
            stepType: job.stepType,
            claimTimeoutInMs: data.claimTimeoutInMs,
            executionTimeoutInMs: data.executionTimeoutInMs,
          }),
        });
      }

      await Sleep.sleep(POLL_INTERVAL_MS);
    }
  }

  @CaptureSpan()
  public async timeoutJob(data: {
    jobId: ObjectID;
    reason: string;
  }): Promise<Model> {
    const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
      PostgresAppInstance.getDataSource();
    if (!dataSource) {
      throw new BadDataException("Database is not connected");
    }

    /*
     * Move to TimedOut only if the job hasn't already reached a terminal
     * state. The same agent's late-arriving result must lose to this race.
     */
    const sql: string = `
      UPDATE "RunnerJob"
      SET "status" = $1,
          "errorMessage" = $2,
          "completedAt" = NOW(),
          "updatedAt" = NOW(),
          "version" = "version" + 1
      WHERE "_id" = $3::uuid
        AND "status" NOT IN ($4, $5, $6, $7)
      RETURNING "_id";
    `;
    await dataSource.query(sql, [
      RunnerJobStatus.TimedOut,
      data.reason,
      data.jobId.toString(),
      RunnerJobStatus.Succeeded,
      RunnerJobStatus.Failed,
      RunnerJobStatus.TimedOut,
      RunnerJobStatus.Cancelled,
    ]);

    /*
     * The claim facts come back with the row, so a caller can tell whether
     * any Runner ever picked the job up (claimedAt / assignedAgentId) or
     * started it (startedAt) — "nothing ran" versus "unknown" — without a
     * second read.
     */
    const updated: Model | null = await this.findOneById({
      id: data.jobId,
      select: {
        _id: true,
        status: true,
        output: true,
        exitCode: true,
        errorMessage: true,
        completedAt: true,
        claimedAt: true,
        startedAt: true,
        assignedAgentId: true,
      },
      props: { isRoot: true },
    });

    if (!updated) {
      throw new BadDataException(
        `RunnerJob ${data.jobId.toString()} not found while timing out.`,
      );
    }

    return updated;
  }

  @CaptureSpan()
  public async cancelJobsForExecution(data: {
    runbookExecutionId: ObjectID;
  }): Promise<void> {
    const dataSource: ReturnType<typeof PostgresAppInstance.getDataSource> =
      PostgresAppInstance.getDataSource();
    if (!dataSource) {
      throw new BadDataException("Database is not connected");
    }
    try {
      await dataSource.query(
        `UPDATE "RunnerJob"
         SET "status" = $1, "completedAt" = NOW(), "updatedAt" = NOW(), "version" = "version" + 1
         WHERE "runbookExecutionId" = $2::uuid
           AND "status" NOT IN ($3, $4, $5, $6)`,
        [
          RunnerJobStatus.Cancelled,
          data.runbookExecutionId.toString(),
          RunnerJobStatus.Succeeded,
          RunnerJobStatus.Failed,
          RunnerJobStatus.TimedOut,
          RunnerJobStatus.Cancelled,
        ],
      );
    } catch (err) {
      logger.error("Failed to cancel RunnerJobs for execution");
      logger.error(err);
    }
  }
}

export default new Service();
