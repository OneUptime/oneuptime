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
  AiRemediationPlanExecutionStatus,
  AiRemediationRollbackStatus,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import CommandPolicy from "../../../Utils/AiRemediation/CommandPolicy";
import { Green500, Red500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import AlertFeedService from "../../Services/AlertFeedService";
import AutoRemediationSuggestionService from "../../Services/AutoRemediationSuggestionService";
import IncidentFeedService from "../../Services/IncidentFeedService";
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
 */

const AI_COMMAND_CLAIM_TIMEOUT_MS: number = 60_000;
const MAX_STORED_OUTPUT_CHARS: number = 6000;

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
          await this.executeOneCommand({ suggestion, command });

        command.execution = state;
        await this.persistPlan(suggestion, plan);

        if (state.status !== AiRemediationCommandExecutionStatus.Succeeded) {
          failed = true;
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
          ? `⚠️ **Approved AI command plan did not complete** — a command failed; the remaining commands were skipped. Review the per-command output on the suggestion. Verification will judge (and roll back) what ran.`
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

      for (const command of rollbackTargets) {
        const rollbackCommand: string = command.rollbackCommand as string;

        const denyReason: string | null =
          CommandPolicy.getDenyReason(rollbackCommand);

        if (denyReason) {
          command.rollbackExecution = {
            status: AiRemediationCommandExecutionStatus.Failed,
            errorMessage: `Rollback refused by the command policy: ${denyReason}.`,
          };
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
          const job: RunnerJob = await RunnerJobService.enqueueAiCommand({
            projectId: suggestion.projectId!,
            aiRunId: suggestion.aiRunId!,
            autoRemediationSuggestionId: suggestion.id!,
            stepId: `ai-rollback-${command.sequence}`,
            stepType: command.stepType,
            targetAgentId: new ObjectID(command.runnerId),
            command: rollbackCommand,
            credentialId: command.credentialId,
            timeoutInMs: command.timeoutInMs,
            claimTimeoutInMs: AI_COMMAND_CLAIM_TIMEOUT_MS,
          });

          command.rollbackExecution.runnerJobId = job.id?.toString();

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
        markdown: anyFailed
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
    command: AiRemediationCommand;
  }): Promise<AiRemediationCommandExecutionState> {
    const { suggestion, command } = data;

    /*
     * Execution-time denylist re-check: the plan was validated when it was
     * composed, but the policy may have been tightened since.
     */
    const denyReason: string | null = CommandPolicy.getDenyReason(
      command.command,
    );

    if (denyReason) {
      return {
        status: AiRemediationCommandExecutionStatus.Failed,
        errorMessage: `Refused by the remediation command policy at execution time: ${denyReason}.`,
      };
    }

    const state: AiRemediationCommandExecutionState = {
      status: AiRemediationCommandExecutionStatus.Pending,
      startedAt:
        command.execution?.startedAt ||
        OneUptimeDate.getCurrentDate().toISOString(),
    };

    try {
      const job: RunnerJob = await RunnerJobService.enqueueAiCommand({
        projectId: suggestion.projectId!,
        aiRunId: suggestion.aiRunId!,
        autoRemediationSuggestionId: suggestion.id!,
        stepId: `ai-approved-${command.sequence}`,
        stepType: command.stepType,
        targetAgentId: new ObjectID(command.runnerId),
        command: command.command,
        credentialId: command.credentialId,
        timeoutInMs: command.timeoutInMs,
        claimTimeoutInMs: AI_COMMAND_CLAIM_TIMEOUT_MS,
      });

      state.runnerJobId = job.id?.toString();

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

    return state;
  }

  /*
   * Settle commands left in Pending/Running by reading their RunnerJob. A
   * job that reached Succeeded really ran, so the command becomes Succeeded
   * (and therefore rollback-eligible); any other terminal state, or a
   * missing job, becomes Failed. Jobs still in flight are left alone.
   */
  private static async reconcilePendingExecutions(
    suggestion: AutoRemediationSuggestion,
    plan: AiRemediationCommandPlan,
  ): Promise<void> {
    let changed: boolean = false;

    for (const command of plan.commands) {
      const status: AiRemediationCommandExecutionStatus | undefined =
        command.execution?.status;

      const isUnsettled: boolean =
        status === AiRemediationCommandExecutionStatus.Pending ||
        status === AiRemediationCommandExecutionStatus.Running;

      if (!isUnsettled || !command.execution?.runnerJobId) {
        continue;
      }

      try {
        const job: RunnerJob | null = await RunnerJobService.findOneById({
          id: new ObjectID(command.execution.runnerJobId),
          select: {
            _id: true,
            status: true,
            output: true,
            exitCode: true,
            errorMessage: true,
          },
          props: { isRoot: true },
        });

        if (!job || !isTerminalAgentJobStatus(job.status)) {
          continue;
        }

        const succeeded: boolean = job.status === RunnerJobStatus.Succeeded;

        command.execution.status = succeeded
          ? AiRemediationCommandExecutionStatus.Succeeded
          : AiRemediationCommandExecutionStatus.Failed;
        command.execution.exitCode = job.exitCode;
        command.execution.output = this.capOutput(job.output || "");
        command.execution.errorMessage = succeeded
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
