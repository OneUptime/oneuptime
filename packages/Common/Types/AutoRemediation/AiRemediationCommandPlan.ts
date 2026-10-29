import RunbookStepType from "../Runbook/RunbookStepType";
import { JSONObject } from "../JSON";
import {
  KubectlCommandTier,
  PROTECTED_KUBERNETES_NAMESPACES,
} from "../Kubernetes/KubernetesClusterAiAccess";
import {
  AiRemediationCommandPolicyVerdict,
  MAX_COMMAND_LENGTH_CHARS,
} from "./AiRemediationCommandPolicyVerdict";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  isAiResourceType,
} from "../ResourceAiAgent/AiResourceType";
import {
  RESOURCE_AI_ALLOW_WRITES_ENV,
  RESOURCE_AI_WRITE_TARGETS_ENV,
  ResourceCommandTier,
} from "../ResourceAiAgent/ResourceAiAccess";
import {
  AiRemediationCommandGitOps,
  AiRemediationGitOpsUtil,
  AiRemediationRevertWatch,
} from "./AiRemediationGitOps";

/*
 * Defined in a leaf module of their own (no imports) so the pure kubectl
 * policy closure — KubectlPolicy, KubectlWriteScope, CommandPolicy and the
 * types they read — can be copied verbatim into the standalone Kubernetes AI
 * agent (agents/KubernetesAIAgent) without dragging this file, and through
 * its JSON import most of Common, along. Re-exported here so every existing
 * importer keeps working.
 */
export { AiRemediationCommandPolicyVerdict, MAX_COMMAND_LENGTH_CHARS };

/*
 * The AI-composed command plan stored on
 * AutoRemediationSuggestion.commandPlan (jsonb). Everything in here is
 * DATA authored by an AI run and frozen at settle time — approval executes
 * exactly what was recorded, never a re-derived command. Secret material
 * never appears here, and no command carries a credential. (An SSH command
 * named a runbook credential by id until runbook credentials were removed:
 * a stored plan with one still reads, as history, but never runs -
 * STORED_AI_COMMAND_STEP_TYPES.)
 */

/*
 * The only step types an AI remediation run may compose, and the only ones
 * that run. Bash runs on the Runner's own host. The structured Kubernetes
 * step (restart/scale) stays runbook-only; AI reaches a cluster through the
 * Kubectl step instead, whose argv is tiered by KubectlPolicy and which
 * targets the cluster's Kubernetes AI agent (or the in-cluster Runner an
 * older chart installed). Every other infrastructure resource (Docker,
 * Podman, Swarm, Proxmox, VMware, Ceph, a database server, a host) is
 * reached through ResourceCommand, whose argv is tiered by the resource
 * command policy and which targets the resource's own AI agent — never a
 * Runner.
 *
 * SSH is not one any more: it reached another host with a runbook
 * credential assigned to the Runner, and runbook credentials were removed
 * now that hosts and clusters have AI agents of their own. A runbook's SSH
 * step (signing in with a secret runbook variable) is unaffected, and
 * OneUptime AI may pick the runbook.
 */
export const AI_COMMAND_STEP_TYPES: Array<RunbookStepType> = [
  RunbookStepType.Bash,
  RunbookStepType.Kubectl,
  RunbookStepType.ResourceCommand,
];

/*
 * The step types a STORED plan may hold: what AI composes now, and SSH,
 * which plans composed before runbook credentials were removed hold. A plan
 * with an SSH command still reads - a suggestion's card shows what was
 * proposed or ran - but approving it is refused and its SSH command never
 * runs (isRemovedSshCommand).
 */
export const STORED_AI_COMMAND_STEP_TYPES: Array<RunbookStepType> = [
  ...AI_COMMAND_STEP_TYPES,
  RunbookStepType.SSH,
];

/*
 * Whether a stored command is an SSH command OneUptime AI composed before
 * runbook credentials were removed: one that no longer runs.
 */
export function isRemovedSshCommand(command: {
  stepType: RunbookStepType;
}): boolean {
  return command.stepType === RunbookStepType.SSH;
}

/*
 * What such a command's record says when a run reaches it, and what
 * approving a plan that holds one is answered, before
 * REMOVED_SSH_COMMAND_NEXT_STEP.
 */
export const REMOVED_SSH_COMMAND_MESSAGE: string =
  "OneUptime AI no longer runs SSH commands: they reached a host with a runbook credential, and runbook credentials were removed.";

/*
 * What to do with a plan whose approval is refused for such a command. Only
 * the refusal says it: a command a run reached belongs to a plan that was
 * approved already, which has nothing left to dismiss.
 */
export const REMOVED_SSH_COMMAND_NEXT_STEP: string =
  "Dismiss this suggestion. A host with the Host AI agent is fixed through it, and a runbook with an SSH step can be picked for a fix.";

export enum AiRemediationCommandExecutionStatus {
  Pending = "Pending",
  Running = "Running",
  Succeeded = "Succeeded",
  Failed = "Failed",
  /*
   * Never ran: an earlier command in the plan failed, the remediation was
   * settled before this command's turn, or — for a rollback — the cluster
   * no longer allowed the undo to run unattended, so a human was told to
   * undo it instead.
   */
  Skipped = "Skipped",
}

export enum AiRemediationPlanExecutionStatus {
  NotStarted = "NotStarted",
  Running = "Running",
  Completed = "Completed",
  Failed = "Failed",
}

export enum AiRemediationRollbackStatus {
  NotAttempted = "NotAttempted",
  Completed = "Completed",
  Failed = "Failed",
  // No executed command carried a rollback command.
  NotApplicable = "NotApplicable",
}

/*
 * A DRY RUN of one change a plan proposes, checked for the person about to
 * approve it: the resource's AI agent ran the change's checks and the reads
 * it makes first, and stopped before the call that makes it (for a cloud
 * account, `cloud dry-run <change>`, CloudOperationCatalog). Facts about
 * the change, never what decides whether it runs: approving runs the
 * change exactly as recorded, and the agent checks it again then.
 */
export enum AiRemediationDryRunStatus {
  // OneUptime asked the agent; the answer is on its way.
  Running = "Running",
  // The agent found nothing that would stop the change.
  WouldRun = "WouldRun",
  // Something would stop it; summary says what.
  WouldBeRefused = "WouldBeRefused",
  // The dry run could not answer (no agent, a read it could not make, no answer in time).
  Failed = "Failed",
}

export interface AiRemediationCommandDryRun {
  status: AiRemediationDryRunStatus;
  // ISO 8601: when it was asked for (Running) or answered.
  checkedAt: string;
  /*
   * What the agent said, in its own words (English, like a command's
   * output): what would change and how it would be undone, or why it would
   * not run, or why the dry run could not answer. Redacted and capped.
   */
  summary?: string | undefined;
  // What the change would replace, read from the agent's replaced-value line.
  replaced?: Record<string, string> | undefined;
  // The job that ran it, for the resource's AI Logs.
  runnerJobId?: string | undefined;
}

// The longest dry-run summary kept on a plan.
export const MAX_DRY_RUN_SUMMARY_CHARS: number = 1500;

export interface AiRemediationCommandExecutionState {
  status: AiRemediationCommandExecutionStatus;
  runnerJobId?: string | undefined;
  output?: string | undefined;
  exitCode?: number | undefined;
  errorMessage?: string | undefined;
  startedAt?: string | undefined; // ISO 8601
  completedAt?: string | undefined; // ISO 8601
}

export interface AiRemediationCommand {
  // 1-based position; plans execute strictly in sequence order.
  sequence: number;
  /*
   * One of STORED_AI_COMMAND_STEP_TYPES: what AI composes now
   * (AI_COMMAND_STEP_TYPES), or SSH in a plan composed before runbook
   * credentials were removed (isRemovedSshCommand), which never runs.
   */
  stepType: RunbookStepType;
  /*
   * The access target the command runs through. For Bash (and a Kubectl
   * step through the previous in-cluster Runner) a Runner row; for a
   * Kubectl step through the Kubernetes AI agent the KubernetesAiAgent row
   * id and KUBERNETES_AI_AGENT_DISPLAY_NAME; for a ResourceCommand step the
   * ResourceAiAgent row id and the type's agentDisplayName ("Docker AI
   * agent").
   */
  runnerId: string;
  runnerNameSnapshot: string;
  /*
   * Kubectl only: the cluster the command runs against and the tier
   * KubectlPolicy assigned when the plan was composed. The tier is
   * informational on the card; execution re-evaluates it.
   */
  kubernetesClusterId?: string | undefined;
  kubernetesClusterNameSnapshot?: string | undefined;
  kubectlTier?: KubectlCommandTier | undefined;
  /*
   * ResourceCommand only: the resource the command runs against and the
   * tier the resource command policy assigned when the plan was composed.
   * The tier is informational on the card; execution re-evaluates it. A
   * ResourceCommand step never carries a credential — the resource's AI
   * agent uses only credentials from its own environment.
   */
  resourceType?: AiResourceType | undefined;
  resourceId?: string | undefined;
  resourceNameSnapshot?: string | undefined;
  resourceCommandTier?: ResourceCommandTier | undefined;
  /*
   * ResourceCommand on a cloud account only: the code that declares the
   * resource the change names ('CloudFormation stack "web"', "Terraform"),
   * read from its tags when the change was composed. Such a change is only
   * ever proposed — a person approves it — and the card says the next
   * apply may put the old value back. Absent when no code declares it.
   */
  managedAsCode?: string | undefined;
  command: string;
  timeoutInMs: number;
  // Why the AI wants to run this — shown verbatim on the approval card.
  rationale: string;
  expectedEffect: string;
  /*
   * Optional undo command, validated by the same policy as the forward
   * command. Executed on verification failure only when it, too, passed
   * policy (approval of the plan covers the rollback commands shown on it).
   */
  rollbackCommand?: string | undefined;
  policyVerdict: AiRemediationCommandPolicyVerdict;
  /*
   * The recorded change this command rolls back, when OneUptime built it
   * from that change (roll_back_change) rather than the model writing it.
   */
  rolledBackChangeId?: string | undefined;
  // True when a FullAuto run already executed this inline during planning.
  wasAutoExecuted?: boolean | undefined;
  /*
   * Kubectl only: who declares the object the command changes (Argo CD,
   * Flux or a Helm release), whether that owner puts this change back,
   * and OneUptime's sentence saying so — read from the object's markers
   * when the command was proposed or run. Absent when nothing declares it,
   * or it was not read.
   */
  gitOps?: AiRemediationCommandGitOps | undefined;
  /*
   * Kubectl only, once the command ran: the fields it changed on its
   * object, which verification reads again to notice the change put back.
   */
  revertWatch?: AiRemediationRevertWatch | undefined;
  /*
   * A change proposed for approval, on a resource whose agent can dry-run
   * it (a cloud account's Cloud AI agent): the latest dry run of it.
   * Absent when none was asked for.
   */
  dryRun?: AiRemediationCommandDryRun | undefined;
  execution?: AiRemediationCommandExecutionState | undefined;
  rollbackExecution?: AiRemediationCommandExecutionState | undefined;
}

export interface AiRemediationCommandPlan {
  commands: Array<AiRemediationCommand>;
  /*
   * Lifecycle of the approved-plan execution sweep. FullAuto inline
   * commands are executed during the AI run itself and settle with
   * Completed here.
   */
  executionStatus?: AiRemediationPlanExecutionStatus | undefined;
  executionStartedAt?: string | undefined;
  executionCompletedAt?: string | undefined;
  rollbackStatus?: AiRemediationRollbackStatus | undefined;
  /*
   * ISO 8601. Written by the rollback arm when it starts and refreshed
   * before every step it waits on, until rollbackStatus settles. A Failed
   * verification whose rollback never settled and whose heartbeat went
   * stale was interrupted (a Worker restart mid-rollback): the verifier's
   * recovery sweep resumes it instead of leaving the cluster half-reverted.
   */
  rollbackHeartbeatAt?: string | undefined;
}

/*
 * A command's execution record has reached an outcome. Pending and Running
 * records may still change: the job they name can finish later.
 */
export function isSettledCommandExecutionStatus(
  status: AiRemediationCommandExecutionStatus | undefined,
): boolean {
  return (
    status === AiRemediationCommandExecutionStatus.Succeeded ||
    status === AiRemediationCommandExecutionStatus.Failed ||
    status === AiRemediationCommandExecutionStatus.Skipped
  );
}

/*
 * RunnerJob.stepId prefixes of the three ways a plan's commands reach a
 * Runner: executed INLINE by a FullAuto run while it plans, executed by the
 * approved-plan executor after a human's click, or run by the rollback arm
 * after verification failed. The per-cluster circuit breaker counts inline
 * kubectl jobs by the first; the rollback arm resolves an interrupted
 * command through the prefix its lane used when the job id never reached
 * the command's record. Spelled out here, once, so the lanes never drift.
 */
export const INLINE_COMMAND_STEP_ID_PREFIX: string = "ai-command-";
export const APPROVED_COMMAND_STEP_ID_PREFIX: string = "ai-approved-";
export const ROLLBACK_COMMAND_STEP_ID_PREFIX: string = "ai-rollback-";
/*
 * The dry run OneUptime asks for a change a plan proposes, before anyone
 * approves it: a read, never a forward change or a rollback, so the
 * per-resource breakers never count it, and the project's hourly brake for
 * fixes neither (it has a brake of its own).
 */
export const DRY_RUN_COMMAND_STEP_ID_PREFIX: string = "ai-dry-run-";

/*
 * The stepId the FORWARD job of a command carries: inline when a FullAuto
 * run executed it while planning, approved otherwise. Unique per suggestion
 * — a plan executes at most once and a retried run never re-executes.
 */
export function getForwardCommandStepId(
  command: Pick<AiRemediationCommand, "sequence" | "wasAutoExecuted">,
): string {
  return `${
    command.wasAutoExecuted === true
      ? INLINE_COMMAND_STEP_ID_PREFIX
      : APPROVED_COMMAND_STEP_ID_PREFIX
  }${command.sequence}`;
}

export function getRollbackCommandStepId(
  command: Pick<AiRemediationCommand, "sequence">,
): string {
  return `${ROLLBACK_COMMAND_STEP_ID_PREFIX}${command.sequence}`;
}

export function getDryRunCommandStepId(
  command: Pick<AiRemediationCommand, "sequence">,
): string {
  return `${DRY_RUN_COMMAND_STEP_ID_PREFIX}${command.sequence}`;
}

// Hard caps — enforced at plan acceptance, not just in the prompt.
export const MAX_PLAN_COMMANDS: number = 5;
export const MIN_COMMAND_TIMEOUT_MS: number = 1000;
export const MAX_COMMAND_TIMEOUT_MS: number = 5 * 60 * 1000;
export const DEFAULT_COMMAND_TIMEOUT_MS: number = 60 * 1000;

/*
 * The kubectl tiers and the unattended cluster modes in the words every
 * remediation prompt, tool description and feed item uses. They restate the
 * KubectlCommandTier and KubernetesAiRemediationMode doc comments in
 * Types/Kubernetes/KubernetesClusterAiAccess and must keep matching them —
 * and the policy (KubectlPolicy), which is what actually decides. One copy,
 * so a prompt can never describe a tier the policy no longer has.
 */

/*
 * Each summary that names a node operation also comes without it, for a
 * cluster whose Runner reported node operations off
 * (aiAccess.remediation.nodeOperations=false): that Runner refuses every
 * node operation, approved or not, so the model is never offered one there
 * (list_command_targets and the cluster round's prompt). The constants are
 * the full wording.
 */
export interface KubectlChangeSummaryOptions {
  allowNodeOperations: boolean;
}

// SafeWrite: what an Automatic cluster runs without a human.
export function getKubectlSafeChangesSummary(
  options: KubectlChangeSummaryOptions,
): string {
  return `rollout restart/undo/pause/resume of one workload, scale of one workload to a non-zero replica count, delete of one named pod, ${
    options.allowNodeOperations ? "cordon/uncordon of one node, " : ""
  }and label/annotate of one pod or workload with unreserved keys — each on exactly ONE named object (TYPE/NAME, e.g. deployment/web), never a selector, --all, several names or a bare kind`;
}

// RiskyWrite: needs a human unless the allowlist names it or approvals are bypassed.
export function getKubectlRiskierChangesSummary(
  options: KubectlChangeSummaryOptions,
): string {
  return `patch, set image/env/resources, ${
    options.allowNodeOperations ? "drain, taint, " : ""
  }scale to zero, deleting a workload or a job, create job --from=cronjob/<name>, and any change that touches several objects at once`;
}

/*
 * Asks a human whatever the cluster's mode, allowlist included: a
 * protected-namespace write, and — where the Runner may change nodes at
 * all — a node drain, a node taint and a patch of a Node (the canonical
 * mode text in KubernetesClusterAiAccess).
 */
export function getKubectlAlwaysAsksSummary(
  options: KubectlChangeSummaryOptions,
): string {
  return `a write in a protected namespace (${PROTECTED_KUBERNETES_NAMESPACES.join(
    ", ",
  )})${
    options.allowNodeOperations
      ? ", a node drain, a node taint and a patch of a Node always need"
      : " always needs"
  } a human, in every mode — Bypass approval and the allowlist included`;
}

export const KUBECTL_SAFE_CHANGES_SUMMARY: string =
  getKubectlSafeChangesSummary({ allowNodeOperations: true });

export const KUBECTL_RISKIER_CHANGES_SUMMARY: string =
  getKubectlRiskierChangesSummary({ allowNodeOperations: true });

export const KUBECTL_ALWAYS_ASKS_SUMMARY: string = getKubectlAlwaysAsksSummary({
  allowNodeOperations: true,
});

// Denied: never runs, whoever approves it.
export const KUBECTL_NEVER_RUNS_SUMMARY: string =
  "destructive commands never run, even with approval: exec, cp, port-forward, run, apply, edit, deleting namespaces/volumes/nodes/secrets/CRDs, any write to RBAC, admission-webhook or API-extension objects, create deployment/cronjob/job with --image, and a patch whose body is not JSON or that changes a pod's identity, privileges, host access, Secrets or command";

// How the cluster's allowlist is read.
export const KUBECTL_ALLOWLIST_SUMMARY: string =
  "the cluster's kubectl allowlist is matched token by token: a pattern must have exactly as many tokens as the command, a * matches within one token only, and a flag must be spelled as the pattern spells it";

export function getKubectlAutomaticModeSummary(
  options: KubectlChangeSummaryOptions,
): string {
  return `Automatic: safe changes run without a human (${getKubectlSafeChangesSummary(
    options,
  )}). A riskier change (${getKubectlRiskierChangesSummary(
    options,
  )}) never runs without one: when the round could only find riskier fixes it ends by proposing exactly those for one-click approval; when it also ran safe fixes, a riskier fix is proposed only if verification shows the safe ones did not recover the signal (the follow-up round, which asks). Shapes on the cluster's kubectl allowlist run on their own.`;
}

export const KUBECTL_AUTOMATIC_MODE_SUMMARY: string =
  getKubectlAutomaticModeSummary({ allowNodeOperations: true });

/*
 * Interpolated into prompts and feed copy on its own, so it names the
 * exceptions instead of pointing at a list "below".
 */
export const KUBECTL_BYPASS_MODE_SUMMARY: string =
  "Bypass approval: AI does not ask. Every change the policy allows — safe AND riskier — runs on its own, follow-up rounds included, except for what always needs a human.";

export const KUBECTL_EVERY_MODE_LIMITS_SUMMARY: string = `In every mode, Bypass approval included: ${KUBECTL_NEVER_RUNS_SUMMARY}; ${KUBECTL_ALWAYS_ASKS_SUMMARY}; the cluster's in-cluster Runner never changes its own namespace, nor a namespace outside the ones its chart lets it change, nor nodes when its chart turned node operations off; and an unattended run becomes a proposal when the hourly per-cluster circuit breaker trips or another unattended round already holds the cluster.`;

/*
 * The resource command tiers and the unattended resource modes in the words
 * every resource remediation prompt, tool description and feed item uses —
 * for the Docker and Podman hosts, Docker Swarm, Proxmox, VMware and Ceph
 * clusters, database servers and hosts reached through their resource AI
 * agents. They restate the ResourceCommandTier and ResourceAiRemediationMode
 * doc comments in Types/ResourceAiAgent/ResourceAiAccess and must keep
 * matching them — and the resource command policy (ResourceCommandPolicy),
 * which is what actually decides. What each kind of resource accepts is its
 * tool policy's own guide (ResourceCommandPolicy.getWriteCommandGuide); these
 * are the rules every kind shares. One copy, so a prompt can never describe
 * a tier the policy no longer has.
 */

// SafeWrite: what an Automatic resource runs without a human.
export const RESOURCE_SAFE_CHANGES_SUMMARY: string =
  "a reversible change to exactly ONE named object — restart or start one container, a rolling restart of one service, start one VM, restart one unit, cancel one query — never several objects at once";

// RiskyWrite: needs a human unless the allowlist names it or approvals are bypassed.
export const RESOURCE_RISKIER_CHANGES_SUMMARY: string =
  "a change that can take something down or alter what runs — stop, kill or pause a container, update limits, scale a service to zero, shut down, power off or reset a VM, mark an OSD out, stop a unit, terminate a session — and a change to several objects at once";

/*
 * Asks a human whatever the resource's mode, allowlist included: what the
 * resource command policy marks requiresHuman (the canonical mode text in
 * ResourceAiAccess).
 */
export const RESOURCE_ALWAYS_ASKS_SUMMARY: string =
  "a change the resource's command policy marks as always needing a human (draining a Swarm node, migrating a VM, putting an ESXi host into maintenance, killing a process on a host, ...) always needs a human, in every mode — Bypass approval and the allowlist included";

// Denied: never runs, whoever approves it.
export const RESOURCE_NEVER_RUNS_SUMMARY: string =
  "destructive commands never run, even with approval: exec, run, rm, prune, deleting or destroying anything, anything that reads or changes credentials, anything the resource's command policy does not know, and anything written as a shell line (pipes, redirects, ;, &&, $( ), sudo)";

// How the resource's allowlist is read.
export const RESOURCE_ALLOWLIST_SUMMARY: string =
  "the resource's command allowlist is matched word by word: a pattern must have exactly as many words as the command, a * stands for exactly one whole word (never part of one), and every other word must be spelled exactly as the command spells it";

/*
 * The every-mode clause about unattended resource runs (the resource
 * sibling of ClusterAccessContext's UNATTENDED_ROUND_BECOMES_PROPOSAL_SUMMARY).
 */
export const RESOURCE_UNATTENDED_ROUND_BECOMES_PROPOSAL_SUMMARY: string =
  "an unattended run becomes a proposal when the hourly per-resource circuit breaker trips or another unattended round already holds the resource";

export const RESOURCE_AUTOMATIC_MODE_SUMMARY: string = `Automatic: safe changes run without a human (${RESOURCE_SAFE_CHANGES_SUMMARY}). A riskier change (${RESOURCE_RISKIER_CHANGES_SUMMARY}) never runs without one: when the round could only find riskier fixes it ends by proposing exactly those for one-click approval; when it also ran safe fixes, a riskier fix is proposed only if verification shows the safe ones did not recover the signal (the follow-up round, which asks). Shapes on the resource's command allowlist run on their own.`;

/*
 * Interpolated into prompts and feed copy on its own, so it names the
 * exceptions instead of pointing at a list "below".
 */
export const RESOURCE_BYPASS_MODE_SUMMARY: string =
  "Bypass approval: AI does not ask. Every change the policy allows — safe AND riskier — runs on its own, follow-up rounds included, except for what always needs a human.";

export const RESOURCE_EVERY_MODE_LIMITS_SUMMARY: string = `In every mode, Bypass approval included: ${RESOURCE_NEVER_RUNS_SUMMARY}; ${RESOURCE_ALWAYS_ASKS_SUMMARY}; the resource's AI agent changes nothing unless it was started with ${RESOURCE_AI_ALLOW_WRITES_ENV}=true, never changes its own protected targets (itself and what it runs in), and with ${RESOURCE_AI_WRITE_TARGETS_ENV} set changes only the targets it names; and ${RESOURCE_UNATTENDED_ROUND_BECOMES_PROPOSAL_SUMMARY}.`;

// A change event's id.
const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AiRemediationCommandPlanUtil {
  /*
   * Parse a jsonb column value back into a typed plan. Fail-closed: any
   * structural problem returns null rather than a partially-valid plan,
   * because the executor and verifier act on what this returns.
   */
  public static parse(
    json: JSONObject | undefined | null,
  ): AiRemediationCommandPlan | null {
    if (!json || typeof json !== "object") {
      return null;
    }

    const commandsRaw: unknown = json["commands"];
    if (!Array.isArray(commandsRaw) || commandsRaw.length === 0) {
      return null;
    }

    if (commandsRaw.length > MAX_PLAN_COMMANDS) {
      return null;
    }

    const commands: Array<AiRemediationCommand> = [];

    for (const item of commandsRaw) {
      if (!item || typeof item !== "object") {
        return null;
      }
      const obj: JSONObject = item as JSONObject;

      const stepType: string = String(obj["stepType"] || "");
      if (!STORED_AI_COMMAND_STEP_TYPES.includes(stepType as RunbookStepType)) {
        return null;
      }

      const command: string =
        typeof obj["command"] === "string" ? obj["command"] : "";
      const runnerId: string =
        typeof obj["runnerId"] === "string" ? obj["runnerId"] : "";
      if (!command.trim() || !runnerId.trim()) {
        return null;
      }

      if (command.length > MAX_COMMAND_LENGTH_CHARS) {
        return null;
      }

      if (
        stepType === RunbookStepType.Kubectl &&
        (typeof obj["kubernetesClusterId"] !== "string" ||
          !obj["kubernetesClusterId"].trim())
      ) {
        return null;
      }

      /*
       * A ResourceCommand step names its resource by type and id, runs
       * through the resource's AI agent (runnerId holds the ResourceAiAgent
       * id) and never carries a credential or a cluster. Anything else is a
       * plan this build cannot execute safely, so the whole plan is refused.
       */
      let resourceFields: Pick<
        AiRemediationCommand,
        | "resourceType"
        | "resourceId"
        | "resourceNameSnapshot"
        | "resourceCommandTier"
        | "managedAsCode"
      > | null = null;

      if (stepType === RunbookStepType.ResourceCommand) {
        resourceFields = AiRemediationCommandPlanUtil.parseResourceFields(obj);

        if (!resourceFields) {
          return null;
        }
      }

      const kubectlTierRaw: string = String(obj["kubectlTier"] || "");
      const kubectlTier: KubectlCommandTier | undefined = Object.values(
        KubectlCommandTier,
      ).includes(kubectlTierRaw as KubectlCommandTier)
        ? (kubectlTierRaw as KubectlCommandTier)
        : undefined;

      const verdict: string = String(obj["policyVerdict"] || "");
      if (
        verdict !== AiRemediationCommandPolicyVerdict.AutoApproved &&
        verdict !== AiRemediationCommandPolicyVerdict.RequiresApproval
      ) {
        // Denied commands must never have been stored.
        return null;
      }

      const timeoutRaw: unknown = obj["timeoutInMs"];
      const timeoutInMs: number =
        typeof timeoutRaw === "number" && Number.isFinite(timeoutRaw)
          ? Math.min(
              MAX_COMMAND_TIMEOUT_MS,
              Math.max(MIN_COMMAND_TIMEOUT_MS, Math.floor(timeoutRaw)),
            )
          : DEFAULT_COMMAND_TIMEOUT_MS;

      commands.push({
        sequence:
          typeof obj["sequence"] === "number"
            ? obj["sequence"]
            : commands.length + 1,
        stepType: stepType as RunbookStepType,
        runnerId: runnerId,
        runnerNameSnapshot:
          typeof obj["runnerNameSnapshot"] === "string"
            ? obj["runnerNameSnapshot"]
            : resourceFields?.resourceType
              ? AI_RESOURCE_TYPE_INFO[resourceFields.resourceType]
                  .agentDisplayName
              : "Runner",
        kubernetesClusterId:
          typeof obj["kubernetesClusterId"] === "string"
            ? obj["kubernetesClusterId"]
            : undefined,
        kubernetesClusterNameSnapshot:
          typeof obj["kubernetesClusterNameSnapshot"] === "string"
            ? obj["kubernetesClusterNameSnapshot"]
            : undefined,
        kubectlTier,
        ...(resourceFields || {}),
        command: command,
        timeoutInMs: timeoutInMs,
        rationale: typeof obj["rationale"] === "string" ? obj["rationale"] : "",
        expectedEffect:
          typeof obj["expectedEffect"] === "string"
            ? obj["expectedEffect"]
            : "",
        rollbackCommand:
          typeof obj["rollbackCommand"] === "string" &&
          obj["rollbackCommand"].trim()
            ? obj["rollbackCommand"]
            : undefined,
        policyVerdict: verdict as AiRemediationCommandPolicyVerdict,
        // Only on a rollback built from a recorded change; absent otherwise.
        ...(typeof obj["rolledBackChangeId"] === "string" &&
        UUID_PATTERN.test(obj["rolledBackChangeId"])
          ? { rolledBackChangeId: obj["rolledBackChangeId"] }
          : {}),
        wasAutoExecuted: obj["wasAutoExecuted"] === true,
        /*
         * Facts about the command, never what decides whether it runs: a
         * malformed one is dropped, never the plan.
         */
        ...(stepType === RunbookStepType.Kubectl
          ? AiRemediationCommandPlanUtil.parseKubectlFacts(obj)
          : {}),
        ...AiRemediationCommandPlanUtil.parseDryRunFact(obj["dryRun"]),
        execution: AiRemediationCommandPlanUtil.parseExecutionState(
          obj["execution"],
        ),
        rollbackExecution: AiRemediationCommandPlanUtil.parseExecutionState(
          obj["rollbackExecution"],
        ),
      });
    }

    // Execution order must be unambiguous.
    commands.sort((a: AiRemediationCommand, b: AiRemediationCommand) => {
      return a.sequence - b.sequence;
    });

    const plan: AiRemediationCommandPlan = { commands };

    const executionStatus: string = String(json["executionStatus"] || "");
    if (
      Object.values(AiRemediationPlanExecutionStatus).includes(
        executionStatus as AiRemediationPlanExecutionStatus,
      )
    ) {
      plan.executionStatus =
        executionStatus as AiRemediationPlanExecutionStatus;
    }
    if (typeof json["executionStartedAt"] === "string") {
      plan.executionStartedAt = json["executionStartedAt"];
    }
    if (typeof json["executionCompletedAt"] === "string") {
      plan.executionCompletedAt = json["executionCompletedAt"];
    }
    const rollbackStatus: string = String(json["rollbackStatus"] || "");
    if (
      Object.values(AiRemediationRollbackStatus).includes(
        rollbackStatus as AiRemediationRollbackStatus,
      )
    ) {
      plan.rollbackStatus = rollbackStatus as AiRemediationRollbackStatus;
    }
    if (typeof json["rollbackHeartbeatAt"] === "string") {
      plan.rollbackHeartbeatAt = json["rollbackHeartbeatAt"];
    }

    return plan;
  }

  /*
   * The resource fields of a stored ResourceCommand step, or null when the
   * step must not be trusted: an unknown resourceType, a blank resourceId,
   * any credential or cluster field, or a tier that is Denied or not a
   * tier at all.
   */
  private static parseResourceFields(
    obj: JSONObject,
  ): Pick<
    AiRemediationCommand,
    | "resourceType"
    | "resourceId"
    | "resourceNameSnapshot"
    | "resourceCommandTier"
    | "managedAsCode"
  > | null {
    const resourceType: unknown = obj["resourceType"];

    if (!isAiResourceType(resourceType)) {
      return null;
    }

    const resourceId: unknown = obj["resourceId"];

    if (typeof resourceId !== "string" || !resourceId.trim()) {
      return null;
    }

    for (const field of [
      "credentialId",
      "credentialNameSnapshot",
      "credential",
      "kubernetesClusterId",
    ]) {
      if (obj[field] !== undefined && obj[field] !== null) {
        return null;
      }
    }

    const tierRaw: unknown = obj["resourceCommandTier"];
    let resourceCommandTier: ResourceCommandTier | undefined = undefined;

    if (tierRaw !== undefined && tierRaw !== null && tierRaw !== "") {
      if (
        typeof tierRaw !== "string" ||
        !(Object.values(ResourceCommandTier) as Array<string>).includes(
          tierRaw,
        ) ||
        tierRaw === ResourceCommandTier.Denied
      ) {
        return null;
      }

      resourceCommandTier = tierRaw as ResourceCommandTier;
    }

    const managedAsCode: unknown = obj["managedAsCode"];

    return {
      resourceType,
      resourceId,
      resourceNameSnapshot:
        typeof obj["resourceNameSnapshot"] === "string"
          ? obj["resourceNameSnapshot"]
          : undefined,
      resourceCommandTier,
      ...(typeof managedAsCode === "string" && managedAsCode.trim()
        ? { managedAsCode: managedAsCode.trim().slice(0, 256) }
        : {}),
    };
  }

  // A stored Kubectl step's GitOps facts and revert watch, when well-formed.
  private static parseKubectlFacts(
    obj: JSONObject,
  ): Pick<AiRemediationCommand, "gitOps" | "revertWatch"> {
    const gitOps: AiRemediationCommandGitOps | undefined =
      AiRemediationGitOpsUtil.parseCommandGitOps(obj["gitOps"]);
    const revertWatch: AiRemediationRevertWatch | undefined =
      AiRemediationGitOpsUtil.parseRevertWatch(obj["revertWatch"]);

    return {
      ...(gitOps ? { gitOps } : {}),
      ...(revertWatch ? { revertWatch } : {}),
    };
  }

  /*
   * A stored dry run, when well-formed: a status this build knows and a
   * time; its summary capped, its replaced value kept to short strings.
   * Anything else is dropped (a fact, never what decides a run).
   */
  public static parseDryRunFact(
    value: unknown,
  ): Pick<AiRemediationCommand, "dryRun"> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    const obj: JSONObject = value as JSONObject;
    const status: string = String(obj["status"] || "");
    const checkedAt: unknown = obj["checkedAt"];

    if (
      !Object.values(AiRemediationDryRunStatus).includes(
        status as AiRemediationDryRunStatus,
      ) ||
      typeof checkedAt !== "string" ||
      !checkedAt.trim()
    ) {
      return {};
    }

    const dryRun: AiRemediationCommandDryRun = {
      status: status as AiRemediationDryRunStatus,
      checkedAt,
    };

    if (typeof obj["summary"] === "string" && obj["summary"].trim()) {
      dryRun.summary = obj["summary"].slice(0, MAX_DRY_RUN_SUMMARY_CHARS);
    }

    const replacedRaw: unknown = obj["replaced"];

    if (
      replacedRaw &&
      typeof replacedRaw === "object" &&
      !Array.isArray(replacedRaw)
    ) {
      const replaced: Record<string, string> = {};

      for (const key of Object.keys(replacedRaw as JSONObject).slice(0, 8)) {
        const entry: unknown = (replacedRaw as JSONObject)[key];

        if (typeof entry === "string" && key.length <= 32) {
          replaced[key] = entry.slice(0, 256);
        }
      }

      if (Object.keys(replaced).length > 0) {
        dryRun.replaced = replaced;
      }
    }

    if (typeof obj["runnerJobId"] === "string" && obj["runnerJobId"].trim()) {
      dryRun.runnerJobId = obj["runnerJobId"];
    }

    return { dryRun };
  }

  public static toJSON(plan: AiRemediationCommandPlan): JSONObject {
    return JSON.parse(JSON.stringify(plan)) as JSONObject;
  }

  private static parseExecutionState(
    value: unknown,
  ): AiRemediationCommandExecutionState | undefined {
    if (!value || typeof value !== "object") {
      return undefined;
    }
    const obj: JSONObject = value as JSONObject;
    const status: string = String(obj["status"] || "");
    if (
      !Object.values(AiRemediationCommandExecutionStatus).includes(
        status as AiRemediationCommandExecutionStatus,
      )
    ) {
      return undefined;
    }
    return {
      status: status as AiRemediationCommandExecutionStatus,
      runnerJobId:
        typeof obj["runnerJobId"] === "string" ? obj["runnerJobId"] : undefined,
      output: typeof obj["output"] === "string" ? obj["output"] : undefined,
      exitCode:
        typeof obj["exitCode"] === "number" ? obj["exitCode"] : undefined,
      errorMessage:
        typeof obj["errorMessage"] === "string"
          ? obj["errorMessage"]
          : undefined,
      startedAt:
        typeof obj["startedAt"] === "string" ? obj["startedAt"] : undefined,
      completedAt:
        typeof obj["completedAt"] === "string" ? obj["completedAt"] : undefined,
    };
  }
}
