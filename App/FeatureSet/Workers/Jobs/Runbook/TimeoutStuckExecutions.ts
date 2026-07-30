import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import RunbookExecutionService from "Common/Server/Services/RunbookExecutionService";
import RunbookAgentJobService from "Common/Server/Services/RunbookAgentJobService";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import RunbookStepExecutionStatus from "Common/Types/Runbook/RunbookStepExecutionStatus";
import { RunbookStepExecutionState } from "Common/Types/Runbook/RunbookStepExecution";
import {
  getRunningExecutionDeadline,
  STUCK_EXECUTION_GRACE_IN_MS,
} from "Common/Types/Runbook/RunbookExecutionDeadline";
import logger from "Common/Server/Utils/Logger";

/*
 * A runbook execution runs synchronously inside one queue job, so its only
 * keeper is the Worker holding that job. Kill that Worker — a deploy, an OOM,
 * a node eviction — and the execution is either redelivered (which the
 * dispatcher now handles idempotently) or lost. Lost means a row that says
 * Running forever: no step advances, no failure is recorded, and the person
 * who ran the runbook during an incident watches a spinner that will never
 * resolve.
 *
 * This sweep is the backstop. It fails executions that have outlived the
 * window their own steps were configured for, so an execution always reaches a
 * terminal state and always says why.
 *
 * Deliberately NOT swept:
 *  - Scheduled executions. Those are queued but not yet picked up, and with 25
 *    concurrent slots against steps that may now run for an hour each, a
 *    healthy backlog can legitimately sit Scheduled for a long time. Failing
 *    on age would kill runs that were about to start.
 *  - WaitingForManualStep executions. Waiting on a human is intended to be
 *    unbounded.
 */

// Bound the work per tick so one bad window cannot monopolise the Worker queue.
const MAX_EXECUTIONS_PER_RUN: number = 100;

RunCron(
  "Runbook:TimeoutStuckExecutions",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    /*
     * Cheap prefilter. An execution's updatedAt is stamped when its current
     * step is marked Running, and the deadline is always at least that instant
     * plus the grace margin — so nothing past its deadline can be excluded
     * here. The exact per-execution deadline is computed below.
     */
    const candidates: Array<RunbookExecution> =
      await RunbookExecutionService.findBy({
        query: {
          status: RunbookExecutionStatus.Running,
          updatedAt: QueryHelper.lessThan(
            new Date(
              OneUptimeDate.getCurrentDate().getTime() -
                STUCK_EXECUTION_GRACE_IN_MS,
            ),
          ),
        },
        select: {
          _id: true,
          projectId: true,
          runbookNameSnapshot: true,
          stepExecutions: true,
          updatedAt: true,
        },
        limit: MAX_EXECUTIONS_PER_RUN,
        skip: 0,
        props: { isRoot: true },
      });

    if (candidates.length === 0) {
      return;
    }

    const now: Date = OneUptimeDate.getCurrentDate();

    for (const execution of candidates) {
      try {
        const stepExecutions: Array<RunbookStepExecutionState> =
          (execution.stepExecutions as unknown as Array<RunbookStepExecutionState>) ||
          [];

        const deadline: Date = getRunningExecutionDeadline({
          stepExecutions,
          executionUpdatedAt: execution.updatedAt || now,
        });

        if (now <= deadline) {
          // Still inside its own window — a Worker is plausibly still on it.
          continue;
        }

        /*
         * Fail the step that was in flight so the timeline names it, rather
         * than leaving a Running step under a Failed execution.
         */
        const runningStep: RunbookStepExecutionState | undefined =
          stepExecutions.find((stepExecution: RunbookStepExecutionState) => {
            return stepExecution.status === RunbookStepExecutionStatus.Running;
          });

        const stepMessage: string =
          "This step stopped being tracked because the server running it restarted or stopped responding. It may have partially run — check the target system before running this runbook again.";

        if (runningStep) {
          runningStep.status = RunbookStepExecutionStatus.Failed;
          runningStep.completedAt = now.toISOString();
          runningStep.errorMessage = stepMessage;
        }

        const failureReason: string = runningStep
          ? `Step "${runningStep.step.title}" was interrupted: ${stepMessage}`
          : "This runbook execution stopped making progress because the server running it restarted or stopped responding. Run the runbook again to retry it.";

        await RunbookExecutionService.updateOneById({
          id: execution.id!,
          data: {
            status: RunbookExecutionStatus.Failed,
            completedAt: now,
            failureReason,
            stepExecutions: stepExecutions as unknown as JSONArray,
          } as unknown as JSONObject,
          props: { isRoot: true },
        });

        /*
         * Release any agent job the execution left behind. Without this a
         * Pending job stays claimable and an agent could start a script for an
         * execution nobody is reading the result of any more.
         */
        await RunbookAgentJobService.cancelJobsForExecution({
          runbookExecutionId: execution.id!,
        });

        logger.warn(
          `Runbook execution ${execution.id?.toString()} ("${
            execution.runbookNameSnapshot
          }") was stuck in Running past its deadline (${deadline.toISOString()}) and has been failed.`,
          { service: "workers" },
        );
      } catch (err) {
        logger.error(
          `Failed to reconcile stuck runbook execution ${execution.id?.toString()}:`,
          { service: "workers" },
        );
        logger.error(err, { service: "workers" });
      }
    }
  },
);
