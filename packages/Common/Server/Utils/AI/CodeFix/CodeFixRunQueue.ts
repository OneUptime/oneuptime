import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import { TransientAIFailureKind } from "../../../../Types/AI/TransientAIFailure";
import CodeFixAutoRetry from "./CodeFixAutoRetry";
import { CodeFixTaskTypeHelper } from "../../../../Types/AI/CodeFixTaskType";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import AIRunService from "../../../Services/AIRunService";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import CodeRepositoryRunnerChoice from "./CodeRepositoryRunnerChoice";
import {
  describeRepositoryRunnerStatus,
  NO_RUNNER_ONLINE_FOR_PROJECT_DETAIL,
} from "./CodeFixReadiness";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * Queue maintenance for CodeFix AIRuns — the runs an EXTERNAL agent
 * container claims over HTTP (unlike investigations, which run in-process).
 *
 * Two failure modes need sweeping:
 *
 *   1. A Running run whose heartbeat went silent: the agent container died
 *      mid-fix. It is tried again by itself, in place, only when nothing
 *      says it may already have pushed a branch or opened a pull request
 *      and it has attempts left (CodeFixAutoRetry); otherwise it is
 *      finalized as Error and the person tries again from the task.
 *
 *   2. A Queued run no Runner ever picked up because none is online to do
 *      it - the Runner its repository picks (its Runner setting in Code),
 *      or a global Runner for one that picks none: without this, the
 *      exception page would show "queued" forever and block retries (the
 *      duplicate guard sees a live run).
 */

// How long a Queued run may wait for an agent before it is failed.
export const ORPHANED_QUEUED_TIMEOUT_MINUTES: number = 30;

// What an attempt whose Runner went away failed with, when it is tried again.
export const STALE_RUN_FAILURE: string =
  "The Runner working on it stopped reporting progress (it may have restarted).";

/*
 * What a stale run that is not tried again fails with: it may already have
 * pushed, or it used every attempt.
 */
export const STALE_RUN_ERROR_MESSAGE: string =
  "The AI agent working on this fix stopped reporting progress — its container may have crashed or been terminated. It was not tried again automatically: it may already have pushed a partial branch, or it had no attempts left. Check the agent container, then try again.";

// How many runs one sweep will look at.
const SWEEP_BATCH_SIZE: number = 100;

export default class CodeFixRunQueue {
  /*
   * Finalize a heartbeat-stale Running code-fix run as Error - unless it
   * may be tried again by itself (CodeFixAutoRetry: nothing pushed, nothing
   * opened, attempts left), when it goes back to the queue instead and this
   * answers true. CAS-guarded on Running, so a run that completed between
   * the sweeper's read and this write is never clobbered.
   */
  @CaptureSpan()
  public static async markStaleRunAsError(run: {
    id: ObjectID;
  }): Promise<boolean> {
    if (
      await CodeFixAutoRetry.tryAgainLater({
        runId: run.id,
        failure: STALE_RUN_FAILURE,
        kind: TransientAIFailureKind.RunnerWentAway,
      })
    ) {
      return true;
    }

    await AIRunService.attemptStatusTransition({
      aiRunId: run.id,
      fromStatus: AIRunStatus.Running,
      set: {
        status: AIRunStatus.Error,
        completedAt: OneUptimeDate.getCurrentDate(),
        errorMessage: STALE_RUN_ERROR_MESSAGE,
      },
    });

    return false;
  }

  /*
   * Fail Queued code-fix runs that have waited past the timeout while
   * nothing that may take them is online: the Runner their repository picks,
   * or a global Runner for one that picks none - and, for a run that has not
   * found its repository yet, anything online for its project's
   * repositories. A run that something online may take just waits in a deep
   * queue, and is left alone. Its error says why, in the words Code's gate
   * uses, and what to do.
   */
  @CaptureSpan()
  public static async failOrphanedQueuedRuns(): Promise<void> {
    const waitThreshold: Date = OneUptimeDate.getSomeMinutesAgo(
      ORPHANED_QUEUED_TIMEOUT_MINUTES,
    );

    const waitingRuns: Array<AIRun> = await AIRunService.findBy({
      query: {
        runType: AIRunType.CodeFix,
        status: AIRunStatus.Queued,
        createdAt: QueryHelper.lessThan(waitThreshold),
        /*
         * Never a recipe the server runs itself (a production review): no
         * Runner takes one, so none being online says nothing about it.
         */
        codeFixTaskType: QueryHelper.notInOrNull(
          CodeFixTaskTypeHelper.getServerRunTaskTypes(),
        ),
      },
      select: {
        _id: true,
        projectId: true,
        codeRepositoryId: true,
        nextAttemptAt: true,
      },
      limit: SWEEP_BATCH_SIZE,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    if (waitingRuns.length === 0) {
      return;
    }

    /*
     * Why nothing can take a run, or null while something can: looked up
     * once per repository (and once per project, for runs with none), not
     * once per run.
     */
    const whyNothingTakes: Map<string, string | null> = new Map();

    for (const run of waitingRuns) {
      if (!run.projectId) {
        continue;
      }

      /*
       * A turn queued again by itself (CodeFixAutoRetry) has waited only
       * since its next attempt was due, not since it was first queued.
       */
      if (
        run.nextAttemptAt &&
        new Date(run.nextAttemptAt).getTime() > waitThreshold.getTime()
      ) {
        continue;
      }

      const projectIdStr: string = run.projectId.toString();
      const key: string = run.codeRepositoryId
        ? `repository:${run.codeRepositoryId.toString()}`
        : `project:${projectIdStr}`;

      if (!whyNothingTakes.has(key)) {
        whyNothingTakes.set(
          key,
          await CodeFixRunQueue.getWhyNothingTakesRun({
            projectId: run.projectId,
            codeRepositoryId: run.codeRepositoryId,
          }),
        );
      }

      const why: string | null = whyNothingTakes.get(key) || null;

      if (!why) {
        continue;
      }

      try {
        await AIRunService.attemptStatusTransition({
          aiRunId: run.id!,
          fromStatus: AIRunStatus.Queued,
          set: {
            status: AIRunStatus.Error,
            completedAt: OneUptimeDate.getCurrentDate(),
            errorMessage: CodeFixRunQueue.getOrphanedRunMessage(why),
          },
        });

        logger.info(
          `Failed orphaned Queued code-fix run ${run.id?.toString()} (nothing online to take it in project ${projectIdStr})`,
        );
      } catch (error) {
        logger.error(
          `Failed to mark orphaned code-fix run ${run.id?.toString()} as Error: ${error}`,
        );
      }
    }
  }

  /*
   * What an orphaned run fails with: how long it waited, then why and what
   * to do - each reason ends with its own next step. Nothing after it: the
   * failed turn has its own Try again, and "Then start the task again"
   * after "try again once the global Runner is back" said it twice.
   */
  public static getOrphanedRunMessage(why: string): string {
    return `No Runner picked this task up within ${ORPHANED_QUEUED_TIMEOUT_MINUTES} minutes. ${why}`;
  }

  /*
   * Why nothing online may take a run of this repository (or, with no
   * repository yet, of this project), or null while something can.
   */
  @CaptureSpan()
  public static async getWhyNothingTakesRun(data: {
    projectId: ObjectID;
    codeRepositoryId?: ObjectID | undefined;
  }): Promise<string | null> {
    const repository: CodeRepository | null = data.codeRepositoryId
      ? await CodeRepositoryService.findOneBy({
          query: {
            _id: data.codeRepositoryId.toString(),
            projectId: data.projectId,
          },
          select: {
            _id: true,
            runnerId: true,
            isGlobalRunnerPicked: true,
          },
          props: { isRoot: true },
        })
      : null;

    if (!repository) {
      return (await CodeRepositoryRunnerChoice.isAnyRunnerOnlineForProject(
        data.projectId,
      ))
        ? null
        : NO_RUNNER_ONLINE_FOR_PROJECT_DETAIL;
    }

    return describeRepositoryRunnerStatus(
      await CodeRepositoryRunnerChoice.getStatusForRepository({
        projectId: data.projectId,
        runnerId: repository.runnerId,
        isGlobalRunnerPicked: repository.isGlobalRunnerPicked,
      }),
    );
  }
}
