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
  isSettledCommandExecutionStatus,
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
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
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
 *
 * The two arms can overlap: verification fails a plan that overran its
 * window while the executor is still waiting on a command. Three rules keep
 * them from undoing each other:
 *   - the executor starts each command (its stand-down check, the enqueue,
 *     and the write that names the job) under a per-plan lock, and the
 *     rollback arm reads the plan under the same lock — so every forward
 *     job that will ever exist is either on the record the rollback arm
 *     reads, or its command stands down;
 *   - the rollback arm WAITS for a forward job still in flight and rolls it
 *     back once it succeeds, instead of skipping it;
 *   - both write the plan read-modify-write under that lock, each writing
 *     only its own fields (the executor: forward executions and the plan's
 *     execution lifecycle; the rollback arm: rollbacks and rollbackStatus),
 *     so neither erases the other's record.
 *
 * A Worker restart mid-rollback leaves the plan's rollbackStatus unset with
 * a heartbeat that goes stale; the verifier's recovery sweep resumes it
 * (executeRollback settles rollbacks already handed to a Runner from their
 * jobs, and never re-runs one that ran).
 */

const AI_COMMAND_CLAIM_TIMEOUT_MS: number = 60_000;
const MAX_STORED_OUTPUT_CHARS: number = 6000;
const MAX_FEED_REASON_CHARS: number = 400;

/*
 * The per-plan lock covers database writes and one enqueue — never a wait
 * on a Runner. It expires on its own if the pod dies holding it.
 */
const PLAN_LOCK_NAMESPACE: string = "AutoRemediationCommandPlan";
const PLAN_LOCK_TIMEOUT_MS: number = 30_000;
const PLAN_LOCK_ACQUIRE_TIMEOUT_MS: number = 15_000;

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

// Who is writing the plan — each side owns different fields of it.
type PlanWriter = "executor" | "rollback";

/*
 * What the rollback arm did, for the verifier: it gates the follow-up round
 * on it and records it on the verification note. rollbackStatus is
 * undefined when the arm could not settle the rollback (no plan, or the
 * status could not be written).
 */
export interface CommandPlanRollbackOutcome {
  rollbackStatus: AiRemediationRollbackStatus | undefined;
  // Rollbacks that ran and succeeded.
  rolledBack: number;
  // Rollbacks that ran and failed, or that the command policy refused.
  failed: number;
  // Rollbacks left for a human to run by hand (their outcome says why).
  leftForHuman: number;
  // One sentence for the verification note.
  summary: string;
}

interface StartedCommand {
  state: AiRemediationCommandExecutionState;
  // Set when the command reached a Runner; null when it was refused first.
  job: RunnerJob | null;
  // Whether the cluster's AI page should record this outcome.
  recordsClusterOutcome: boolean;
}

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
      await this.persistPlan(suggestion, plan, "executor");

      let failed: boolean = false;
      // What stopped the plan, for the feed: the first non-Succeeded outcome.
      let firstFailure: string | null = null;
      // Verification settled the remediation while the plan was executing.
      let settledMidPlan: boolean = false;

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
         * Start the command under the plan lock: the stand-down check, the
         * Pending marker, the enqueue and the write that names the job. The
         * rollback arm reads the plan under the same lock, so it either sees
         * this command's job (and waits for it) or this command sees the
         * settled verification and never starts.
         */
        const mutex: SemaphoreMutex | null = await this.lockPlan(
          suggestion.id!,
        );

        let started: StartedCommand | null = null;

        try {
          /*
           * Abort check between commands. Verification runs on its own
           * sweep and can fail this remediation while the plan is still
           * executing (a slow Runner, a long command); once it does, it
           * rolls the executed commands back. Continuing to push NEW
           * forward commands into a rollback that is already under way is
           * how a plan and its undo end up fighting each other, so the
           * executor stops the moment verification is no longer Pending or
           * a human moved the suggestion off Approved.
           */
          if (!(await this.isStillExecutable(suggestion.id!))) {
            command.execution = {
              status: AiRemediationCommandExecutionStatus.Skipped,
              errorMessage:
                "Skipped: this remediation was settled (verified, failed, or actioned by a human) before the command ran.",
            };
            failed = true;
            settledMidPlan = true;
          } else {
            /*
             * Persist the Pending marker BEFORE the side effect: a pod death
             * mid-command must leave a record that this command may have
             * run.
             */
            command.execution = {
              status: AiRemediationCommandExecutionStatus.Pending,
              startedAt: OneUptimeDate.getCurrentDate().toISOString(),
            };
            await this.persistPlan(suggestion, plan, "executor", {
              planLocked: true,
            });

            started = await this.startOneCommand({ suggestion, plan, command });
          }
        } finally {
          await this.unlockPlan(mutex);
        }

        if (!started) {
          continue;
        }

        const state: AiRemediationCommandExecutionState =
          await this.finishOneCommand({ command, started });

        command.execution = state;
        await this.persistPlan(suggestion, plan, "executor");

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
      await this.persistPlan(suggestion, plan, "executor");

      /*
       * The last command can still be running when verification concludes
       * (a plan that overran its window). "Verification is watching" would
       * then contradict the verification and rollback notes already on the
       * feed.
       */
      if (!settledMidPlan && !(await this.isStillExecutable(suggestion.id!))) {
        settledMidPlan = true;
      }

      await this.postFeedItem({
        suggestion,
        markdown: settledMidPlan
          ? `⚠️ **Approved AI command plan finished after its verification had already concluded**${
              firstFailure ? ` — ${firstFailure}` : ""
            }. Commands that had not started yet were skipped; the verification and rollback notes on this suggestion say what was judged and what was undone. Review the per-command record.`
          : failed
            ? `⚠️ **Approved AI command plan did not complete** — ${
                firstFailure || "a command failed"
              }; the remaining commands were skipped. Review the per-command output on the suggestion. Verification will judge (and roll back) what ran.`
            : `⚡ **Approved AI command plan executed** (${plan.commands.length} command(s)). Verification is watching the monitors for recovery.`,
        pingWorkspace: failed || settledMidPlan,
        displayColor: failed || settledMidPlan ? Red500 : Green500,
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
   * after it wins the Failed verification transition, and by its recovery
   * sweep for a rollback a Worker restart interrupted. Never throws.
   */
  @CaptureSpan()
  public static async executeRollback(data: {
    suggestion: AutoRemediationSuggestion;
  }): Promise<CommandPlanRollbackOutcome> {
    const { suggestion } = data;

    let plan: AiRemediationCommandPlan | null = null;

    try {
      /*
       * Read the plan as stored NOW, under the plan lock — not the copy the
       * verifier read before it won the verification transition. An
       * approved plan's executor may have enqueued a command since; the
       * lock guarantees its job is on this read, or that the command stands
       * down and never starts.
       */
      plan = await this.readPlanForRollback(suggestion);

      if (!plan) {
        return this.describeRollbackOutcome(null);
      }

      if (
        plan.rollbackStatus &&
        plan.rollbackStatus !== AiRemediationRollbackStatus.NotAttempted
      ) {
        // Already rolled back (or judged not applicable).
        return this.describeRollbackOutcome(plan);
      }

      plan.rollbackHeartbeatAt = OneUptimeDate.getCurrentDate().toISOString();
      await this.persistPlan(suggestion, plan, "rollback");

      /*
       * A command whose record still says Pending may nonetheless have run:
       * the executor persists Pending, enqueues, and can die before writing
       * the outcome — or it is simply still waiting on the job. The
       * RunnerJob row is the authority on what actually happened, so
       * resolve those first, WAITING for a job still in flight: skipping it
       * would leave a change that is about to land exempt from its undo.
       */
      await this.reconcilePendingExecutions(suggestion, plan, {
        waitForInFlight: true,
      });

      /*
       * A resumed rollback: undos an interrupted attempt already handed to
       * a Runner are settled from their jobs, never run twice.
       */
      await this.reconcilePendingRollbacks(suggestion, plan);

      let anyFailed: boolean = false;
      // Rollbacks nobody may run unattended now — a human undoes them.
      const leftForHuman: Array<AiRemediationCommand> = [];

      /*
       * A forward command whose job could not be resolved even after
       * waiting may or may not have run. Its undo is not run blind; a human
       * is told to check.
       */
      for (const command of plan.commands) {
        const execution: AiRemediationCommandExecutionState | undefined =
          command.execution;

        if (
          execution &&
          !isSettledCommandExecutionStatus(execution.status) &&
          execution.runnerJobId &&
          command.rollbackCommand &&
          !command.rollbackExecution
        ) {
          command.rollbackExecution = {
            status: AiRemediationCommandExecutionStatus.Skipped,
            errorMessage: `Rollback not run: whether the command ran could not be confirmed from its job. If it ran, undo it manually: ${command.rollbackCommand}`,
          };
          leftForHuman.push(command);
          anyFailed = true;
        }
      }

      if (
        plan.commands.some((command: AiRemediationCommand) => {
          return (
            command.rollbackExecution !== undefined &&
            !isSettledCommandExecutionStatus(command.rollbackExecution.status)
          );
        })
      ) {
        // A rollback of an interrupted attempt whose outcome is unknown.
        anyFailed = true;
      }

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

      if (rollbackTargets.length === 0 && !anyFailed) {
        plan.rollbackStatus = plan.commands.some(
          (command: AiRemediationCommand) => {
            return (
              command.rollbackExecution?.status ===
              AiRemediationCommandExecutionStatus.Succeeded
            );
          },
        )
          ? AiRemediationRollbackStatus.Completed
          : AiRemediationRollbackStatus.NotApplicable;
        await this.persistPlan(suggestion, plan, "rollback");
        return this.describeRollbackOutcome(plan);
      }

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
          await this.persistPlan(suggestion, plan, "rollback");
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
          leftForHuman.push(command);
          anyFailed = true;
          await this.persistPlan(suggestion, plan, "rollback");
          continue;
        }

        command.rollbackExecution = {
          status: AiRemediationCommandExecutionStatus.Pending,
          startedAt: OneUptimeDate.getCurrentDate().toISOString(),
        };
        plan.rollbackHeartbeatAt = OneUptimeDate.getCurrentDate().toISOString();
        await this.persistPlan(suggestion, plan, "rollback");

        try {
          const job: RunnerJob = await this.enqueue({
            suggestion,
            command,
            commandText: rollbackCommand,
            stepId: getRollbackCommandStepId(command),
          });

          // The job id lands before the wait — see startOneCommand.
          command.rollbackExecution.runnerJobId = job.id?.toString();
          await this.persistPlan(suggestion, plan, "rollback");

          const terminalJob: RunnerJob =
            await RunnerJobService.pollUntilTerminal({
              jobId: job.id!,
              claimTimeoutInMs: AI_COMMAND_CLAIM_TIMEOUT_MS,
              executionTimeoutInMs: command.timeoutInMs,
            });

          this.settleFromJob(
            command.rollbackExecution,
            terminalJob,
            "Rollback",
          );
          if (
            command.rollbackExecution.status !==
            AiRemediationCommandExecutionStatus.Succeeded
          ) {
            anyFailed = true;
          }
        } catch (error) {
          command.rollbackExecution.status =
            AiRemediationCommandExecutionStatus.Failed;
          command.rollbackExecution.errorMessage =
            error instanceof Error ? error.message : String(error);
          anyFailed = true;
        }

        await this.persistPlan(suggestion, plan, "rollback");
      }

      plan.rollbackStatus = anyFailed
        ? AiRemediationRollbackStatus.Failed
        : AiRemediationRollbackStatus.Completed;
      await this.persistPlan(suggestion, plan, "rollback");

      await this.postFeedItem({
        suggestion,
        markdown:
          leftForHuman.length > 0
            ? `⚠️ **Auto-remediation rollback was not run for ${leftForHuman.length} command(s)** — the cluster no longer allows them unattended, or whether they ran could not be confirmed, so a human has to undo them. ${leftForHuman
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

      return this.describeRollbackOutcome(plan);
    } catch (error) {
      logger.error(
        `CommandPlanExecutor: rollback failed for suggestion ${suggestion.id?.toString()}: ${error}`,
      );

      /*
       * Settle it as Failed so nobody assumes it was undone — and so the
       * recovery sweep does not retry a rollback that throws every time.
       */
      if (plan) {
        plan.rollbackStatus = AiRemediationRollbackStatus.Failed;
        await this.persistPlan(suggestion, plan, "rollback");
        await this.postFeedItem({
          suggestion,
          markdown: `⚠️ **Auto-remediation rollback could not complete** — an unexpected error stopped it. Review the suggestion's per-command record; manual intervention may be needed.`,
          pingWorkspace: true,
          displayColor: Red500,
        });
      }

      return this.describeRollbackOutcome(plan);
    }
  }

  // ------------------------------------------------------------------

  /*
   * Everything up to and including the enqueue: the execution-time policy
   * floor, the cluster re-check, the enqueue, and the write that names the
   * job. Runs under the plan lock (see executeApprovedPlan).
   */
  private static async startOneCommand(data: {
    suggestion: AutoRemediationSuggestion;
    plan: AiRemediationCommandPlan;
    command: AiRemediationCommand;
  }): Promise<StartedCommand> {
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
        state: {
          status: AiRemediationCommandExecutionStatus.Failed,
          errorMessage: `Refused by the remediation command policy at execution time: ${denyReason}.`,
        },
        job: null,
        recordsClusterOutcome: false,
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
        state: {
          status: AiRemediationCommandExecutionStatus.Failed,
          errorMessage: `Refused at execution time: ${clusterRefusal}.`,
        },
        job: null,
        recordsClusterOutcome: false,
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
      await this.persistPlan(suggestion, plan, "executor", {
        planLocked: true,
      });

      return { state, job, recordsClusterOutcome: true };
    } catch (error) {
      state.status = AiRemediationCommandExecutionStatus.Failed;
      state.completedAt = OneUptimeDate.getCurrentDate().toISOString();
      state.errorMessage =
        error instanceof Error ? error.message : String(error);

      return { state, job: null, recordsClusterOutcome: true };
    }
  }

  // The wait (outside the plan lock) and the outcome.
  private static async finishOneCommand(data: {
    command: AiRemediationCommand;
    started: StartedCommand;
  }): Promise<AiRemediationCommandExecutionState> {
    const { command, started } = data;
    const state: AiRemediationCommandExecutionState = started.state;

    if (started.job) {
      try {
        const terminalJob: RunnerJob = await RunnerJobService.pollUntilTerminal(
          {
            jobId: started.job.id!,
            claimTimeoutInMs: AI_COMMAND_CLAIM_TIMEOUT_MS,
            executionTimeoutInMs: command.timeoutInMs,
          },
        );

        if (!isTerminalAgentJobStatus(terminalJob.status)) {
          throw new Error("Command job did not reach a terminal state.");
        }

        this.settleFromJob(state, terminalJob, "Command");
      } catch (error) {
        state.status = AiRemediationCommandExecutionStatus.Failed;
        state.completedAt = OneUptimeDate.getCurrentDate().toISOString();
        state.errorMessage =
          error instanceof Error ? error.message : String(error);
      }
    }

    if (
      started.recordsClusterOutcome &&
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

  // Copy a terminal job's outcome onto an execution record.
  private static settleFromJob(
    state: AiRemediationCommandExecutionState,
    job: RunnerJob,
    label: "Command" | "Rollback",
  ): void {
    const succeeded: boolean = job.status === RunnerJobStatus.Succeeded;

    state.status = succeeded
      ? AiRemediationCommandExecutionStatus.Succeeded
      : AiRemediationCommandExecutionStatus.Failed;
    state.completedAt = OneUptimeDate.getCurrentDate().toISOString();
    state.exitCode = job.exitCode;
    state.output = this.capOutput(job.output || "");
    state.errorMessage = succeeded
      ? undefined
      : job.errorMessage || `${label} ended with status ${job.status}.`;
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
   * The job a command's step ran under, when its record never got the job
   * id. The enqueue and the write that names the job are two steps; a pod
   * death or a failed write between them leaves a Pending record for a job
   * the Runner was nonetheless handed. (suggestion, stepId) is unique per
   * forward command — a plan executes at most once and a retried run never
   * re-executes — and per rollback; the newest row wins should that ever
   * change.
   */
  private static async findJobByStepId(data: {
    suggestion: AutoRemediationSuggestion;
    stepId: string;
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
        stepId: data.stepId,
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
   * Failed. A job still in flight is WAITED for when `waitForInFlight` is
   * set (the rollback arm: the change is about to land, and its undo must
   * not be skipped); otherwise it is left alone.
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
    options: { waitForInFlight: boolean },
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
        let job: RunnerJob | null = execution.runnerJobId
          ? await RunnerJobService.findOneById({
              id: new ObjectID(execution.runnerJobId),
              select: RECONCILE_JOB_SELECT,
              props: { isRoot: true },
            })
          : await this.findJobByStepId({
              suggestion,
              stepId: getForwardCommandStepId(command),
            });

        if (!job) {
          continue;
        }

        // Recovered by stepId: name the job so the record stays resolvable.
        if (!execution.runnerJobId && job.id) {
          execution.runnerJobId = job.id.toString();
          changed = true;
        }

        if (!isTerminalAgentJobStatus(job.status)) {
          if (!options.waitForInFlight || !job.id) {
            continue;
          }

          // Say where the rollback stands before a wait that can take minutes.
          if (changed) {
            await this.persistPlan(suggestion, plan, "rollback");
            changed = false;
          }
          plan.rollbackHeartbeatAt =
            OneUptimeDate.getCurrentDate().toISOString();
          await this.persistPlan(suggestion, plan, "rollback");

          job = await RunnerJobService.pollUntilTerminal({
            jobId: job.id,
            claimTimeoutInMs: AI_COMMAND_CLAIM_TIMEOUT_MS,
            executionTimeoutInMs: command.timeoutInMs,
          });

          if (!isTerminalAgentJobStatus(job.status)) {
            continue;
          }
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
      await this.persistPlan(suggestion, plan, "rollback");
    }
  }

  /*
   * A rollback resumed after a Worker restart: settle the undos the
   * interrupted attempt had already started. One with a job — on the record
   * or found under its rollback step id — is settled from that job
   * (waiting for it when it is still running): it is never run a second
   * time, because running an undo twice (a second `rollout undo`) can put
   * the bad change right back. One that never reached a Runner is cleared,
   * so it runs now. One whose job cannot be looked up stays unsettled, and
   * the rollback is not reported complete.
   */
  private static async reconcilePendingRollbacks(
    suggestion: AutoRemediationSuggestion,
    plan: AiRemediationCommandPlan,
  ): Promise<void> {
    let changed: boolean = false;

    for (const command of plan.commands) {
      const rollback: AiRemediationCommandExecutionState | undefined =
        command.rollbackExecution;

      if (!rollback || isSettledCommandExecutionStatus(rollback.status)) {
        continue;
      }

      try {
        let job: RunnerJob | null = rollback.runnerJobId
          ? await RunnerJobService.findOneById({
              id: new ObjectID(rollback.runnerJobId),
              select: RECONCILE_JOB_SELECT,
              props: { isRoot: true },
            })
          : await this.findJobByStepId({
              suggestion,
              stepId: getRollbackCommandStepId(command),
            });

        if (!job) {
          // Never reached a Runner: run it now.
          command.rollbackExecution = undefined;
          changed = true;
          continue;
        }

        if (!rollback.runnerJobId && job.id) {
          rollback.runnerJobId = job.id.toString();
          changed = true;
        }

        if (!isTerminalAgentJobStatus(job.status) && job.id) {
          plan.rollbackHeartbeatAt =
            OneUptimeDate.getCurrentDate().toISOString();
          await this.persistPlan(suggestion, plan, "rollback");

          job = await RunnerJobService.pollUntilTerminal({
            jobId: job.id,
            claimTimeoutInMs: AI_COMMAND_CLAIM_TIMEOUT_MS,
            executionTimeoutInMs: command.timeoutInMs,
          });
        }

        if (isTerminalAgentJobStatus(job.status)) {
          this.settleFromJob(rollback, job, "Rollback");
          changed = true;
        }
      } catch (error) {
        logger.error(
          `CommandPlanExecutor: could not reconcile the rollback of command ${command.sequence} of suggestion ${suggestion.id?.toString()}: ${error}`,
        );
      }
    }

    if (changed) {
      await this.persistPlan(suggestion, plan, "rollback");
    }
  }

  private static describeRollbackOutcome(
    plan: AiRemediationCommandPlan | null,
  ): CommandPlanRollbackOutcome {
    let rolledBack: number = 0;
    let failed: number = 0;
    let leftForHuman: number = 0;

    for (const command of plan?.commands || []) {
      switch (command.rollbackExecution?.status) {
        case AiRemediationCommandExecutionStatus.Succeeded:
          rolledBack += 1;
          break;
        case AiRemediationCommandExecutionStatus.Failed:
          failed += 1;
          break;
        case AiRemediationCommandExecutionStatus.Skipped:
          leftForHuman += 1;
          break;
        default:
          break;
      }
    }

    const rollbackStatus: AiRemediationRollbackStatus | undefined =
      plan?.rollbackStatus &&
      plan.rollbackStatus !== AiRemediationRollbackStatus.NotAttempted
        ? plan.rollbackStatus
        : undefined;

    let summary: string;

    switch (rollbackStatus) {
      case AiRemediationRollbackStatus.Completed:
        summary = `Rollback completed: ${rolledBack} command(s) undone.`;
        break;
      case AiRemediationRollbackStatus.NotApplicable:
        summary =
          "Nothing was rolled back: no executed command carried a rollback command.";
        break;
      case AiRemediationRollbackStatus.Failed:
        summary = `Rollback did NOT fully complete: ${rolledBack} command(s) undone, ${failed} rollback(s) failed, ${leftForHuman} left for a human to undo — the change may still be applied.`;
        break;
      default:
        summary =
          "The rollback did not finish; whatever it did not undo may still be applied.";
        break;
    }

    return { rollbackStatus, rolledBack, failed, leftForHuman, summary };
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

  /*
   * The plan the rollback arm works from: the stored one, read under the
   * plan lock. Falls back to the copy the caller holds when the stored plan
   * cannot be read.
   */
  private static async readPlanForRollback(
    suggestion: AutoRemediationSuggestion,
  ): Promise<AiRemediationCommandPlan | null> {
    const mutex: SemaphoreMutex | null = suggestion.id
      ? await this.lockPlan(suggestion.id)
      : null;

    try {
      const stored: AiRemediationCommandPlan | null = suggestion.id
        ? await this.readStoredPlan(suggestion.id)
        : null;

      return (
        stored || AiRemediationCommandPlanUtil.parse(suggestion.commandPlan)
      );
    } finally {
      await this.unlockPlan(mutex);
    }
  }

  // The plan as stored right now, or null when it cannot be read.
  private static async readStoredPlan(
    suggestionId: ObjectID,
  ): Promise<AiRemediationCommandPlan | null> {
    try {
      /*
       * findOneBy, not findOneById: this is the column read for a merge,
       * not a status re-check, and it must not be mistaken for one.
       */
      const stored: AutoRemediationSuggestion | null =
        await AutoRemediationSuggestionService.findOneBy({
          query: { _id: suggestionId.toString() },
          select: { _id: true, commandPlan: true },
          props: { isRoot: true },
        });

      return AiRemediationCommandPlanUtil.parse(stored?.commandPlan);
    } catch (error) {
      logger.warn(
        `CommandPlanExecutor: could not read the stored plan of suggestion ${suggestionId.toString()} to merge into; writing this writer's copy as is: ${error}`,
      );
      return null;
    }
  }

  /*
   * Persist the plan without erasing what the OTHER arm wrote. The stored
   * plan is re-read (under the plan lock) and only this writer's fields are
   * taken from its copy: the executor owns forward executions and the
   * plan's execution lifecycle; the rollback arm owns rollbacks,
   * rollbackStatus and the rollback heartbeat. A forward execution the
   * rollback arm settled from its job is kept over a stale unsettled copy
   * either way. When the stored plan cannot be read, this writer's copy is
   * written as is — the record must still land.
   */
  private static async persistPlan(
    suggestion: AutoRemediationSuggestion,
    plan: AiRemediationCommandPlan,
    writer: PlanWriter,
    options?: { planLocked?: boolean | undefined },
  ): Promise<void> {
    const mutex: SemaphoreMutex | null =
      options?.planLocked || !suggestion.id
        ? null
        : await this.lockPlan(suggestion.id);

    try {
      const stored: AiRemediationCommandPlan | null = suggestion.id
        ? await this.readStoredPlan(suggestion.id)
        : null;

      const toWrite: AiRemediationCommandPlan = stored
        ? this.mergePlans({ mine: plan, stored, writer })
        : plan;

      await AutoRemediationSuggestionService.updateOneById({
        id: suggestion.id!,
        data: {
          commandPlan: AiRemediationCommandPlanUtil.toJSON(toWrite),
        } as never,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `CommandPlanExecutor: failed to persist plan progress for suggestion ${suggestion.id?.toString()}: ${error}`,
      );
    } finally {
      await this.unlockPlan(mutex);
    }
  }

  private static mergePlans(data: {
    mine: AiRemediationCommandPlan;
    stored: AiRemediationCommandPlan;
    writer: PlanWriter;
  }): AiRemediationCommandPlan {
    const { mine, stored } = data;

    if (data.writer === "executor") {
      const storedBySequence: Map<number, AiRemediationCommand> = new Map<
        number,
        AiRemediationCommand
      >(
        stored.commands.map((command: AiRemediationCommand) => {
          return [command.sequence, command];
        }),
      );

      return {
        ...mine,
        commands: mine.commands.map((command: AiRemediationCommand) => {
          const storedCommand: AiRemediationCommand | undefined =
            storedBySequence.get(command.sequence);

          return {
            ...command,
            execution: this.pickExecution(
              command.execution,
              storedCommand?.execution,
            ),
            rollbackExecution: storedCommand?.rollbackExecution,
          };
        }),
        rollbackStatus: stored.rollbackStatus,
        rollbackHeartbeatAt: stored.rollbackHeartbeatAt,
      };
    }

    const mineBySequence: Map<number, AiRemediationCommand> = new Map<
      number,
      AiRemediationCommand
    >(
      mine.commands.map((command: AiRemediationCommand) => {
        return [command.sequence, command];
      }),
    );

    return {
      ...stored,
      commands: stored.commands.map((storedCommand: AiRemediationCommand) => {
        const command: AiRemediationCommand | undefined = mineBySequence.get(
          storedCommand.sequence,
        );

        if (!command) {
          return storedCommand;
        }

        return {
          ...storedCommand,
          execution: this.pickExecution(
            command.execution,
            storedCommand.execution,
          ),
          rollbackExecution: command.rollbackExecution,
        };
      }),
      rollbackStatus: mine.rollbackStatus ?? stored.rollbackStatus,
      rollbackHeartbeatAt:
        mine.rollbackHeartbeatAt ?? stored.rollbackHeartbeatAt,
    };
  }

  /*
   * The more settled of two records of one command's forward execution: a
   * record with an outcome beats one still waiting for it; with both
   * settled (or both not) the writer's own wins, keeping any job id either
   * of them knows.
   */
  private static pickExecution(
    mine: AiRemediationCommandExecutionState | undefined,
    stored: AiRemediationCommandExecutionState | undefined,
  ): AiRemediationCommandExecutionState | undefined {
    if (!mine) {
      return stored;
    }

    if (!stored) {
      return mine;
    }

    if (isSettledCommandExecutionStatus(mine.status)) {
      return mine;
    }

    if (isSettledCommandExecutionStatus(stored.status)) {
      return stored;
    }

    return mine.runnerJobId || !stored.runnerJobId
      ? mine
      : { ...mine, runnerJobId: stored.runnerJobId };
  }

  /*
   * The per-plan lock, or null when it cannot be had (Redis unavailable):
   * the plan's writes then proceed unserialized rather than not at all — a
   * remediation must never be stranded half-recorded for want of a lock.
   */
  private static async lockPlan(
    suggestionId: ObjectID,
  ): Promise<SemaphoreMutex | null> {
    try {
      return await Semaphore.lock({
        key: suggestionId.toString(),
        namespace: PLAN_LOCK_NAMESPACE,
        lockTimeout: PLAN_LOCK_TIMEOUT_MS,
        acquireTimeout: PLAN_LOCK_ACQUIRE_TIMEOUT_MS,
      });
    } catch (error) {
      logger.warn(
        `CommandPlanExecutor: could not take the plan lock of suggestion ${suggestionId.toString()}; continuing unserialized: ${error}`,
      );
      return null;
    }
  }

  private static async unlockPlan(mutex: SemaphoreMutex | null): Promise<void> {
    if (!mutex) {
      return;
    }

    try {
      await Semaphore.release(mutex);
    } catch (error) {
      logger.error(
        `CommandPlanExecutor: failed to release the plan lock: ${error}`,
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
