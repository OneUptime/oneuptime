import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import RunnerJob from "../../../Models/DatabaseModels/RunnerJob";
import { AlertFeedEventType } from "../../../Models/DatabaseModels/AlertFeed";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  AiRemediationCommand,
  AiRemediationCommandExecutionState,
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
  AiRemediationCommandPolicyVerdict,
  AiRemediationPlanExecutionStatus,
  AiRemediationRollbackStatus,
  getForwardCommandStepId,
  getRollbackCommandStepId,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import CommandPolicy from "../../../Utils/AiRemediation/CommandPolicy";
import KubectlPolicy, {
  KubectlAutoExecutionVerdict,
  KubectlPolicyResult,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import {
  KubectlCommandTier,
  KubernetesAiAccessGap,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "../../../Types/Runbook/RunnerJobOrigin";
import { Green500, Red500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import AlertFeedService from "../../Services/AlertFeedService";
import AutoRemediationSuggestionService from "../../Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../Services/IncidentFeedService";
import KubernetesClusterAiAccessService from "../../Services/KubernetesClusterAiAccessService";
import RunnerJobService, {
  isTerminalAgentJobStatus,
} from "../../Services/RunnerJobService";
import RunnerJobStatus from "../../../Types/Runbook/RunnerJobStatus";
import ToolResultSerializer from "../AI/Toolbox/Serializer";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * Auto-remediation — the approved-command-plan executor and the rollback
 * arm.
 *
 * When a human approves a CommandPlan suggestion, this executes EXACTLY the
 * frozen plan, command by command, through the same RunnerJob claim path
 * runbook steps use (origin AiRemediation, so only canRunAiCommands Runners
 * serve it). Progress is persisted onto the suggestion after every command,
 * so a pod death mid-plan leaves a truthful record — the verifier treats a
 * plan that never completes inside the window as a failed remediation.
 *
 * The rollback arm runs when verification FAILS: every successfully
 * executed command that carried a rollbackCommand is undone, in reverse
 * order. Rollback commands were visible on the approval card (or, for
 * FullAuto, passed the same policy the forward command did) and are
 * re-checked against the hard denylist here anyway.
 *
 * Kubectl commands — forward and rollback — are additionally re-checked
 * against the cluster's AI page AS IT IS NOW, right before they are
 * enqueued: an approval can be clicked hours after the plan was composed,
 * and a rollback fires at the end of the verification window. The
 * operator's current choice (remediation off, a different Runner bound, a
 * mode that no longer bypasses approvals) wins over the frozen plan.
 */

const AI_COMMAND_CLAIM_TIMEOUT_MS: number = 60_000;
const MAX_STORED_OUTPUT_CHARS: number = 6000;
const MAX_FEED_REASON_CHARS: number = 400;

// What the rollback arm needs from a RunnerJob to settle its command.
const RECONCILE_JOB_SELECT: {
  _id: true;
  status: true;
  output: true;
  exitCode: true;
  errorMessage: true;
} = {
  _id: true,
  status: true,
  output: true,
  exitCode: true,
  errorMessage: true,
};

export default class CommandPlanExecutor {
  /*
   * Execute an Approved plan end-to-end. Detached-callable (the approve API
   * fires it without awaiting): never throws.
   */
  @CaptureSpan()
  public static async executeApprovedPlan(data: {
    suggestionId: ObjectID;
  }): Promise<void> {
    try {
      const suggestion: AutoRemediationSuggestion | null =
        await AutoRemediationSuggestionService.findOneById({
          id: data.suggestionId,
          select: {
            _id: true,
            projectId: true,
            status: true,
            suggestionType: true,
            commandPlan: true,
            aiRunId: true,
            incidentId: true,
            alertId: true,
            ruleNameSnapshot: true,
          },
          props: { isRoot: true },
        });

      if (
        !suggestion ||
        suggestion.status !== AutoRemediationSuggestionStatus.Approved ||
        suggestion.suggestionType !== AutoRemediationSuggestionType.CommandPlan
      ) {
        return;
      }

      const plan: AiRemediationCommandPlan | null =
        AiRemediationCommandPlanUtil.parse(suggestion.commandPlan);

      if (!plan) {
        logger.error(
          `CommandPlanExecutor: suggestion ${data.suggestionId.toString()} is Approved but its command plan is missing or invalid; nothing executed.`,
        );
        return;
      }

      /*
       * Idempotence: only NotStarted plans execute. A re-fired executor (or
       * a second pod racing the same approval) sees Running/terminal and
       * leaves it alone.
       */
      if (
        plan.executionStatus &&
        plan.executionStatus !== AiRemediationPlanExecutionStatus.NotStarted
      ) {
        return;
      }

      plan.executionStatus = AiRemediationPlanExecutionStatus.Running;
      plan.executionStartedAt = OneUptimeDate.getCurrentDate().toISOString();
      await this.persistPlan(suggestion, plan);

      let failed: boolean = false;
      // What stopped the plan, for the feed: the first non-Succeeded outcome.
      let firstFailure: string | null = null;

      for (const command of plan.commands) {
        // FullAuto-executed entries never appear in approved Suggest plans.
        if (command.execution) {
          continue;
        }

        if (failed) {
          command.execution = {
            status: AiRemediationCommandExecutionStatus.Skipped,
            errorMessage: "Skipped because an earlier command failed.",
          };
          continue;
        }

        /*
         * Abort check between commands. Verification runs on its own sweep
         * and can fail this remediation while the plan is still executing
         * (a slow Runner, a long command); once it does, it rolls the
         * executed commands back. Continuing to push NEW forward commands
         * into a rollback that is already under way is how a plan and its
         * undo end up fighting each other, so the executor stops the moment
         * verification is no longer Pending or a human moved the
         * suggestion off Approved.
         */
        if (!(await this.isStillExecutable(suggestion.id!))) {
          command.execution = {
            status: AiRemediationCommandExecutionStatus.Skipped,
            errorMessage:
              "Skipped: this remediation was settled (verified, failed, or actioned by a human) before the command ran.",
          };
          failed = true;
          continue;
        }

        /*
         * Persist the Pending marker BEFORE the side effect: a pod death
         * mid-command must leave a record that this command may have run.
         */
        command.execution = {
          status: AiRemediationCommandExecutionStatus.Pending,
          startedAt: OneUptimeDate.getCurrentDate().toISOString(),
        };
        await this.persistPlan(suggestion, plan);

        const state: AiRemediationCommandExecutionState =
          await this.executeOneCommand({ suggestion, plan, command });

        command.execution = state;
        await this.persistPlan(suggestion, plan);

        if (state.status !== AiRemediationCommandExecutionStatus.Succeeded) {
          failed = true;
          firstFailure =
            firstFailure ||
            `command ${command.sequence} ${
              state.errorMessage
                ? `failed: ${this.capForFeed(state.errorMessage)}`
                : "failed"
            }`;
        }
      }

      plan.executionStatus = failed
        ? AiRemediationPlanExecutionStatus.Failed
        : AiRemediationPlanExecutionStatus.Completed;
      plan.executionCompletedAt = OneUptimeDate.getCurrentDate().toISOString();
      await this.persistPlan(suggestion, plan);

      await this.postFeedItem({
        suggestion,
        markdown: failed
          ? `⚠️ **Approved AI command plan did not complete** — ${
              firstFailure || "a command failed"
            }; the remaining commands were skipped. Review the per-command output on the suggestion. Verification will judge (and roll back) what ran.`
          : `⚡ **Approved AI command plan executed** (${plan.commands.length} command(s)). Verification is watching the monitors for recovery.`,
        pingWorkspace: failed,
        displayColor: failed ? Red500 : Green500,
      });
    } catch (error) {
      logger.error(
        `CommandPlanExecutor: failed to execute approved plan for suggestion ${data.suggestionId.toString()}: ${error}`,
      );
    }
  }

  /*
   * Undo a failed remediation: run the rollbackCommand of every command
   * that executed successfully, in REVERSE order. Called by the verifier
   * after it wins the Failed verification transition — single caller by
   * construction. Never throws.
   */
  @CaptureSpan()
  public static async executeRollback(data: {
    suggestion: AutoRemediationSuggestion;
  }): Promise<void> {
    const { suggestion } = data;

    try {
      const plan: AiRemediationCommandPlan | null =
        AiRemediationCommandPlanUtil.parse(suggestion.commandPlan);

      if (!plan) {
        return;
      }

      if (
        plan.rollbackStatus &&
        plan.rollbackStatus !== AiRemediationRollbackStatus.NotAttempted
      ) {
        return; // Already rolled back (or judged not applicable).
      }

      /*
       * A command whose record still says Pending may nonetheless have run:
       * the executor persists Pending, enqueues, and can die before writing
       * the outcome. The RunnerJob row is the authority on what actually
       * happened, so resolve those before deciding what to undo — otherwise a
       * pod death silently exempts a real state change from rollback.
       */
      await this.reconcilePendingExecutions(suggestion, plan);

      const rollbackTargets: Array<AiRemediationCommand> = plan.commands
        .filter((command: AiRemediationCommand) => {
          return (
            command.execution?.status ===
              AiRemediationCommandExecutionStatus.Succeeded &&
            Boolean(command.rollbackCommand) &&
            !command.rollbackExecution
          );
        })
        .reverse();

      if (rollbackTargets.length === 0) {
        plan.rollbackStatus = AiRemediationRollbackStatus.NotApplicable;
        await this.persistPlan(suggestion, plan);
        return;
      }

      let anyFailed: boolean = false;
      // Rollbacks the cluster no longer allows unattended — a human undoes them.
      const notRunUnattended: Array<AiRemediationCommand> = [];

      for (const command of rollbackTargets) {
        const rollbackCommand: string = command.rollbackCommand as string;

        const denyReason: string | null = this.getDenyReason({
          stepType: command.stepType,
          command: rollbackCommand,
        });

        if (denyReason) {
          command.rollbackExecution = {
            status: AiRemediationCommandExecutionStatus.Failed,
            errorMessage: `Rollback refused by the command policy: ${denyReason}.`,
          };
          anyFailed = true;
          await this.persistPlan(suggestion, plan);
          continue;
        }

        /*
         * A rollback runs with nobody watching, so it has to be allowed
         * unattended by the cluster as it is configured NOW — not as it was
         * when the plan accepted the rollback. A RiskyWrite undo accepted
         * while the operator bypassed approvals must not run once they
         * stopped bypassing them; a cluster whose remediation was turned
         * off must not be changed at all. Left for a human, and said so.
         */
        const clusterRefusal: string | null =
          await this.getClusterExecutionRefusal({
            suggestion,
            command,
            commandText: rollbackCommand,
            purpose: "rollback",
          });

        if (clusterRefusal) {
          command.rollbackExecution = {
            status: AiRemediationCommandExecutionStatus.Skipped,
            errorMessage: `Rollback not run: ${clusterRefusal}. Undo it manually: ${rollbackCommand}`,
          };
          notRunUnattended.push(command);
          anyFailed = true;
          await this.persistPlan(suggestion, plan);
          continue;
        }

        command.rollbackExecution = {
          status: AiRemediationCommandExecutionStatus.Pending,
          startedAt: OneUptimeDate.getCurrentDate().toISOString(),
        };
        await this.persistPlan(suggestion, plan);

        try {
          const job: RunnerJob = await this.enqueue({
            suggestion,
            command,
            commandText: rollbackCommand,
            stepId: getRollbackCommandStepId(command),
          });

          // The job id lands before the wait — see executeOneCommand.
          command.rollbackExecution.runnerJobId = job.id?.toString();
          await this.persistPlan(suggestion, plan);

          const terminalJob: RunnerJob =
            await RunnerJobService.pollUntilTerminal({
              jobId: job.id!,
              claimTimeoutInMs: AI_COMMAND_CLAIM_TIMEOUT_MS,
              executionTimeoutInMs: command.timeoutInMs,
            });

          const succeeded: boolean =
            terminalJob.status === RunnerJobStatus.Succeeded;

          command.rollbackExecution.status = succeeded
            ? AiRemediationCommandExecutionStatus.Succeeded
            : AiRemediationCommandExecutionStatus.Failed;
          command.rollbackExecution.completedAt =
            OneUptimeDate.getCurrentDate().toISOString();
          command.rollbackExecution.exitCode = terminalJob.exitCode;
          command.rollbackExecution.output = this.capOutput(
            terminalJob.output || "",
          );
          if (!succeeded) {
            command.rollbackExecution.errorMessage =
              terminalJob.errorMessage ||
              `Rollback ended with status ${terminalJob.status}.`;
            anyFailed = true;
          }
        } catch (error) {
          command.rollbackExecution.status =
            AiRemediationCommandExecutionStatus.Failed;
          command.rollbackExecution.errorMessage =
            error instanceof Error ? error.message : String(error);
          anyFailed = true;
        }

        await this.persistPlan(suggestion, plan);
      }

      plan.rollbackStatus = anyFailed
        ? AiRemediationRollbackStatus.Failed
        : AiRemediationRollbackStatus.Completed;
      await this.persistPlan(suggestion, plan);

      await this.postFeedItem({
        suggestion,
        markdown:
          notRunUnattended.length > 0
            ? `⚠️ **Auto-remediation rollback was not run for ${notRunUnattended.length} command(s)** — the cluster no longer allows them unattended, so a human has to undo them. ${notRunUnattended
                .map((command: AiRemediationCommand) => {
                  return this.capForFeed(
                    command.rollbackExecution?.errorMessage || "",
                  );
                })
                .join(
                  " ",
                )} Review the suggestion's per-command record; manual intervention is needed.`
            : anyFailed
              ? `⚠️ **Auto-remediation rollback did not fully complete** — at least one rollback command failed. Review the suggestion's per-command record; manual intervention may be needed.`
              : `↩️ **Auto-remediation rolled back** — the executed commands' rollback commands ran after verification failed. Escalation continues as normal.`,
        pingWorkspace: true,
        displayColor: anyFailed ? Red500 : Green500,
      });
    } catch (error) {
      logger.error(
        `CommandPlanExecutor: rollback failed for suggestion ${suggestion.id?.toString()}: ${error}`,
      );
    }
  }

  // ------------------------------------------------------------------

  private static async executeOneCommand(data: {
    suggestion: AutoRemediationSuggestion;
    plan: AiRemediationCommandPlan;
    command: AiRemediationCommand;
  }): Promise<AiRemediationCommandExecutionState> {
    const { suggestion, plan, command } = data;

    /*
     * Execution-time denylist re-check: the plan was validated when it was
     * composed, but the policy may have been tightened since.
     */
    const denyReason: string | null = this.getDenyReason({
      stepType: command.stepType,
      command: command.command,
    });

    if (denyReason) {
      return {
        status: AiRemediationCommandExecutionStatus.Failed,
        errorMessage: `Refused by the remediation command policy at execution time: ${denyReason}.`,
      };
    }

    /*
     * Execution-time cluster re-check: the approve API re-checks the
     * project switches, this re-checks the cluster's own AI page. An
     * operator who turned remediation off, or bound a different Runner,
     * after the plan was composed expects that to stop the plan too.
     */
    const clusterRefusal: string | null = await this.getClusterExecutionRefusal(
      {
        suggestion,
        command,
        commandText: command.command,
        purpose: "command",
      },
    );

    if (clusterRefusal) {
      return {
        status: AiRemediationCommandExecutionStatus.Failed,
        errorMessage: `Refused at execution time: ${clusterRefusal}.`,
      };
    }

    const state: AiRemediationCommandExecutionState = {
      status: AiRemediationCommandExecutionStatus.Pending,
      startedAt:
        command.execution?.startedAt ||
        OneUptimeDate.getCurrentDate().toISOString(),
    };

    try {
      const job: RunnerJob = await this.enqueue({
        suggestion,
        command,
        commandText: command.command,
        // Approved plans never hold inline-executed commands (skipped above).
        stepId: getForwardCommandStepId(command),
      });

      /*
       * The job id lands on the record BEFORE the wait: a pod death while
       * polling must leave a Pending command that names its RunnerJob, so
       * the rollback arm can resolve what really happened instead of
       * treating the command as one that never reached the Runner.
       */
      state.runnerJobId = job.id?.toString();
      command.execution = state;
      await this.persistPlan(suggestion, plan);

      const terminalJob: RunnerJob = await RunnerJobService.pollUntilTerminal({
        jobId: job.id!,
        claimTimeoutInMs: AI_COMMAND_CLAIM_TIMEOUT_MS,
        executionTimeoutInMs: command.timeoutInMs,
      });

      if (!isTerminalAgentJobStatus(terminalJob.status)) {
        throw new Error("Command job did not reach a terminal state.");
      }

      const succeeded: boolean =
        terminalJob.status === RunnerJobStatus.Succeeded;

      state.status = succeeded
        ? AiRemediationCommandExecutionStatus.Succeeded
        : AiRemediationCommandExecutionStatus.Failed;
      state.completedAt = OneUptimeDate.getCurrentDate().toISOString();
      state.exitCode = terminalJob.exitCode;
      state.output = this.capOutput(terminalJob.output || "");
      if (!succeeded) {
        state.errorMessage =
          terminalJob.errorMessage ||
          `Command ended with status ${terminalJob.status}.`;
      }
    } catch (error) {
      state.status = AiRemediationCommandExecutionStatus.Failed;
      state.completedAt = OneUptimeDate.getCurrentDate().toISOString();
      state.errorMessage =
        error instanceof Error ? error.message : String(error);
    }

    if (
      command.stepType === RunbookStepType.Kubectl &&
      command.kubernetesClusterId &&
      ObjectID.isValidUUID(command.kubernetesClusterId)
    ) {
      await KubernetesClusterAiAccessService.recordCommandOutcome({
        clusterId: new ObjectID(command.kubernetesClusterId),
        succeeded:
          state.status === AiRemediationCommandExecutionStatus.Succeeded,
        errorMessage: state.errorMessage,
      });
    }

    return state;
  }

  /*
   * One enqueue for both lanes. Bash/SSH go through enqueueAiCommand
   * (script or SSH payload); Kubectl goes through enqueueAiKubectlCommand
   * (argv + cluster + optional credential), whose policy is re-run there.
   */
  private static async enqueue(data: {
    suggestion: AutoRemediationSuggestion;
    command: AiRemediationCommand;
    commandText: string;
    stepId: string;
  }): Promise<RunnerJob> {
    const { suggestion, command } = data;

    if (command.stepType === RunbookStepType.Kubectl) {
      if (
        !command.kubernetesClusterId ||
        !ObjectID.isValidUUID(command.kubernetesClusterId)
      ) {
        throw new Error("The kubectl command names no cluster.");
      }

      return RunnerJobService.enqueueAiKubectlCommand({
        projectId: suggestion.projectId!,
        aiRunId: suggestion.aiRunId!,
        origin: RunnerJobOrigin.AiRemediation,
        autoRemediationSuggestionId: suggestion.id!,
        kubernetesClusterId: new ObjectID(command.kubernetesClusterId),
        stepId: data.stepId,
        targetAgentId: new ObjectID(command.runnerId),
        credentialId: command.credentialId,
        command: data.commandText,
        timeoutInMs: command.timeoutInMs,
        claimTimeoutInMs: AI_COMMAND_CLAIM_TIMEOUT_MS,
      });
    }

    return RunnerJobService.enqueueAiCommand({
      projectId: suggestion.projectId!,
      aiRunId: suggestion.aiRunId!,
      autoRemediationSuggestionId: suggestion.id!,
      stepId: data.stepId,
      stepType: command.stepType,
      targetAgentId: new ObjectID(command.runnerId),
      command: data.commandText,
      credentialId: command.credentialId,
      timeoutInMs: command.timeoutInMs,
      claimTimeoutInMs: AI_COMMAND_CLAIM_TIMEOUT_MS,
    });
  }

  /*
   * Why a kubectl command may NOT run on its cluster right now, or null.
   *
   * The plan froze the cluster, the Runner and the credential the cluster's
   * AI page bound when the plan was composed. Before anything is enqueued
   * the page is read again: remediation must still be enabled and ready
   * (Disabled means "AI never runs a change on this cluster", whatever was
   * approved earlier), and the bound Runner and credential must still be
   * the ones on the plan — a re-bound cluster never receives a job meant
   * for its previous access path. A rollback must ALSO be allowed
   * unattended under the cluster's CURRENT mode and allowlist: nothing
   * shows a rollback to a human when it fires.
   *
   * Fails closed: a status that cannot be read is a refusal. Bash/SSH
   * commands have no cluster and pass through.
   */
  private static async getClusterExecutionRefusal(data: {
    suggestion: AutoRemediationSuggestion;
    command: AiRemediationCommand;
    commandText: string;
    purpose: "command" | "rollback";
  }): Promise<string | null> {
    const { suggestion, command } = data;

    if (command.stepType !== RunbookStepType.Kubectl) {
      return null;
    }

    const clusterLabel: string =
      command.kubernetesClusterNameSnapshot ||
      command.kubernetesClusterId ||
      "(unknown)";

    if (
      !command.kubernetesClusterId ||
      !ObjectID.isValidUUID(command.kubernetesClusterId) ||
      !suggestion.projectId
    ) {
      return `the kubectl command names no valid cluster`;
    }

    let status: KubernetesClusterAiAccessStatus | null;

    try {
      status = await KubernetesClusterAiAccessService.getStatusForCluster({
        clusterId: new ObjectID(command.kubernetesClusterId),
        projectId: suggestion.projectId,
      });
    } catch (error) {
      logger.error(
        `CommandPlanExecutor: could not read the AI access status of cluster ${command.kubernetesClusterId} before a ${data.purpose}: ${error}`,
      );
      return `could not confirm that cluster "${clusterLabel}" still allows AI remediation`;
    }

    if (!status) {
      return `cluster "${clusterLabel}" no longer exists in this project`;
    }

    if (!status.isRemediationReady) {
      const gap: KubernetesAiAccessGap | undefined = status.gaps.find(
        (candidate: KubernetesAiAccessGap) => {
          return candidate.blocks !== "investigation";
        },
      );
      return `cluster "${status.clusterName}" no longer allows AI remediation${
        gap ? ` (${gap.title})` : ""
      }`;
    }

    if (!status.runner || status.runner.id !== command.runnerId) {
      return `cluster "${status.clusterName}" is no longer reached through Runner "${command.runnerNameSnapshot}", which this plan was composed for`;
    }

    if (
      (status.credentialId || undefined) !== (command.credentialId || undefined)
    ) {
      return `cluster "${status.clusterName}" is no longer reached with the credential this plan was composed for`;
    }

    if (data.purpose === "rollback") {
      const verdict: KubectlAutoExecutionVerdict =
        KubectlPolicy.evaluateForAutoExecution({
          command: data.commandText,
          allowlistPatterns: status.kubectlAllowlist,
          bypassApproval:
            status.remediationMode ===
            KubernetesAiRemediationMode.BypassApproval,
        });

      if (verdict.verdict !== AiRemediationCommandPolicyVerdict.AutoApproved) {
        return `cluster "${status.clusterName}" no longer allows this change unattended (its AI remediation mode is now ${status.remediationMode}): ${verdict.reason}`;
      }
    }

    return null;
  }

  /*
   * The forward job of a command whose record never got its job id. The
   * enqueue and the write that names the job are two steps; a pod death or
   * a failed write between them leaves a Pending record for a job the
   * Runner was nonetheless handed. (suggestion, stepId) is unique per
   * forward command — a plan executes at most once and a retried run never
   * re-executes — and the newest row wins should that ever change.
   */
  private static async findForwardJobByStepId(data: {
    suggestion: AutoRemediationSuggestion;
    command: AiRemediationCommand;
  }): Promise<RunnerJob | null> {
    if (!data.suggestion.id) {
      return null;
    }

    const jobs: Array<RunnerJob> = await RunnerJobService.findBy({
      query: {
        ...(data.suggestion.projectId
          ? { projectId: data.suggestion.projectId }
          : {}),
        autoRemediationSuggestionId: data.suggestion.id,
        origin: RunnerJobOrigin.AiRemediation,
        stepId: getForwardCommandStepId(data.command),
      },
      select: RECONCILE_JOB_SELECT,
      sort: { createdAt: SortOrder.Descending },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    return jobs[0] || null;
  }

  private static capForFeed(text: string): string {
    const collapsed: string = text.trim().replace(/\s+/g, " ");
    return collapsed.length > MAX_FEED_REASON_CHARS
      ? `${collapsed.slice(0, MAX_FEED_REASON_CHARS)}…`
      : collapsed;
  }

  /*
   * Execution-time policy floor per lane: the bash denylist for Bash/SSH,
   * the Denied tier for Kubectl. Null when the command may run.
   */
  private static getDenyReason(data: {
    stepType: RunbookStepType;
    command: string;
  }): string | null {
    if (data.stepType === RunbookStepType.Kubectl) {
      const policy: KubectlPolicyResult = KubectlPolicy.evaluateCommand(
        data.command,
      );
      return policy.tier === KubectlCommandTier.Denied ? policy.reason : null;
    }

    return CommandPolicy.getDenyReason(data.command);
  }

  /*
   * Settle commands left in Pending/Running by reading their RunnerJob. A
   * job that reached Succeeded really ran, so the command becomes Succeeded
   * (and therefore rollback-eligible); any other terminal state becomes
   * Failed. Jobs still in flight are left alone.
   *
   * The job is found by the id on the record, or — when the record never
   * got one, because the pod died or the write failed between the enqueue
   * and the persist that names the job — by the (suggestion, stepId) pair
   * the lane enqueued it under. A command with neither never reached the
   * Runner and is left alone.
   */
  private static async reconcilePendingExecutions(
    suggestion: AutoRemediationSuggestion,
    plan: AiRemediationCommandPlan,
  ): Promise<void> {
    let changed: boolean = false;

    for (const command of plan.commands) {
      const execution: AiRemediationCommandExecutionState | undefined =
        command.execution;

      if (!execution) {
        continue;
      }

      const isUnsettled: boolean =
        execution.status === AiRemediationCommandExecutionStatus.Pending ||
        execution.status === AiRemediationCommandExecutionStatus.Running;

      if (!isUnsettled) {
        continue;
      }

      try {
        const job: RunnerJob | null = execution.runnerJobId
          ? await RunnerJobService.findOneById({
              id: new ObjectID(execution.runnerJobId),
              select: RECONCILE_JOB_SELECT,
              props: { isRoot: true },
            })
          : await this.findForwardJobByStepId({ suggestion, command });

        if (!job) {
          continue;
        }

        // Recovered by stepId: name the job so the record stays resolvable.
        if (!execution.runnerJobId && job.id) {
          execution.runnerJobId = job.id.toString();
          changed = true;
        }

        if (!isTerminalAgentJobStatus(job.status)) {
          continue;
        }

        const succeeded: boolean = job.status === RunnerJobStatus.Succeeded;

        execution.status = succeeded
          ? AiRemediationCommandExecutionStatus.Succeeded
          : AiRemediationCommandExecutionStatus.Failed;
        execution.exitCode = job.exitCode;
        execution.output = this.capOutput(job.output || "");
        execution.errorMessage = succeeded
          ? undefined
          : job.errorMessage ||
            `Command ended with status ${job.status} (recovered from the job record).`;
        changed = true;
      } catch (error) {
        logger.error(
          `CommandPlanExecutor: could not reconcile command ${command.sequence} of suggestion ${suggestion.id?.toString()}: ${error}`,
        );
      }
    }

    if (changed) {
      await this.persistPlan(suggestion, plan);
    }
  }

  /*
   * Whether the suggestion is still an Approved remediation whose
   * verification window is open. False means someone (the verifier, or a
   * human) has settled it — or the window has closed — and no further
   * forward command may run.
   *
   * The deadline is checked HERE rather than waiting to be told: the
   * verifier's sweep settles a plan that overran its window and then rolls
   * back what already succeeded, so the executor has to stand down on the
   * same clock instead of pushing new changes into an in-flight rollback.
   */
  private static async isStillExecutable(
    suggestionId: ObjectID,
  ): Promise<boolean> {
    try {
      const current: AutoRemediationSuggestion | null =
        await AutoRemediationSuggestionService.findOneById({
          id: suggestionId,
          select: {
            _id: true,
            status: true,
            verificationStatus: true,
            verificationDeadlineAt: true,
          },
          props: { isRoot: true },
        });

      if (!current) {
        return false;
      }

      if (
        current.verificationDeadlineAt &&
        current.verificationDeadlineAt.getTime() <
          OneUptimeDate.getCurrentDate().getTime()
      ) {
        return false;
      }

      return (
        current.status === AutoRemediationSuggestionStatus.Approved &&
        current.verificationStatus === AutoRemediationVerificationStatus.Pending
      );
    } catch (error) {
      /*
       * Fail OPEN here on purpose: a transient read failure must not turn a
       * half-applied remediation into a permanently half-applied one. The
       * command's own record still lands before it runs.
       */
      logger.error(
        `CommandPlanExecutor: could not re-check suggestion ${suggestionId.toString()} before the next command; continuing: ${error}`,
      );
      return true;
    }
  }

  private static async persistPlan(
    suggestion: AutoRemediationSuggestion,
    plan: AiRemediationCommandPlan,
  ): Promise<void> {
    try {
      await AutoRemediationSuggestionService.updateOneById({
        id: suggestion.id!,
        data: {
          commandPlan: AiRemediationCommandPlanUtil.toJSON(plan),
        } as never,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `CommandPlanExecutor: failed to persist plan progress for suggestion ${suggestion.id?.toString()}: ${error}`,
      );
    }
  }

  private static capOutput(output: string): string {
    const redacted: string = ToolResultSerializer.redact(output).text;
    if (redacted.length <= MAX_STORED_OUTPUT_CHARS) {
      return redacted;
    }
    return `${redacted.slice(0, MAX_STORED_OUTPUT_CHARS)}\n... [output truncated]`;
  }

  private static async postFeedItem(data: {
    suggestion: AutoRemediationSuggestion;
    markdown: string;
    pingWorkspace: boolean;
    displayColor: Color;
  }): Promise<void> {
    try {
      if (data.suggestion.incidentId && data.suggestion.projectId) {
        await IncidentFeedService.createIncidentFeedItem({
          incidentId: data.suggestion.incidentId,
          projectId: data.suggestion.projectId,
          incidentFeedEventType: IncidentFeedEventType.AutoRemediation,
          displayColor: data.displayColor,
          feedInfoInMarkdown: data.markdown,
          workspaceNotification: {
            sendWorkspaceNotification: data.pingWorkspace,
          },
        });
      } else if (data.suggestion.alertId && data.suggestion.projectId) {
        await AlertFeedService.createAlertFeedItem({
          alertId: data.suggestion.alertId,
          projectId: data.suggestion.projectId,
          alertFeedEventType: AlertFeedEventType.AutoRemediation,
          displayColor: data.displayColor,
          feedInfoInMarkdown: data.markdown,
          workspaceNotification: {
            sendWorkspaceNotification: data.pingWorkspace,
          },
        });
      }
    } catch (error) {
      logger.error(`CommandPlanExecutor: failed to create feed item: ${error}`);
    }
  }
}
