import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIAgent from "../../../../Models/DatabaseModels/AIAgent";
import AIRunService from "../../../Services/AIRunService";
import AIAgentService from "../../../Services/AIAgentService";
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
 *      mid-fix. Unlike investigations these are NOT requeued — the agent
 *      may already have pushed a partial fix branch or opened a PR, so
 *      re-running the fix from the top is not safe to do automatically.
 *      The run is finalized as Error and the user retries explicitly.
 *
 *   2. A Queued run no agent ever picked up because none is online for its
 *      project: without this, the exception page would show "queued"
 *      forever and block retries (the duplicate guard sees a live run).
 */

// How long a Queued run may wait for an agent before it is failed.
export const ORPHANED_QUEUED_TIMEOUT_MINUTES: number = 30;

// How many runs one sweep will look at.
const SWEEP_BATCH_SIZE: number = 100;

export default class CodeFixRunQueue {
  /*
   * Finalize a heartbeat-stale Running code-fix run as Error. CAS-guarded
   * on Running, so a run that completed between the sweeper's read and this
   * write is never clobbered. Deliberately never requeues — see above.
   */
  @CaptureSpan()
  public static async markStaleRunAsError(run: {
    id: ObjectID;
  }): Promise<void> {
    await AIRunService.attemptStatusTransition({
      aiRunId: run.id,
      fromStatus: AIRunStatus.Running,
      set: {
        status: AIRunStatus.Error,
        completedAt: OneUptimeDate.getCurrentDate(),
        errorMessage:
          "The AI agent working on this fix stopped reporting progress — its container may have crashed or been terminated. The fix was not retried automatically because the agent may already have pushed a partial branch. Check the agent container, then retry the fix from the exception page.",
      },
    });
  }

  /*
   * Fail Queued code-fix runs that have waited past the timeout while their
   * project has no alive agent to pick them up. A project WITH an alive
   * agent just has a deep queue — its runs are left alone.
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
      },
      select: {
        _id: true,
        projectId: true,
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

    // One alive-agent lookup per project, not per run.
    const projectHasAliveAgent: Map<string, boolean> = new Map();

    for (const run of waitingRuns) {
      if (!run.projectId) {
        continue;
      }

      const projectIdStr: string = run.projectId.toString();

      if (!projectHasAliveAgent.has(projectIdStr)) {
        const aliveAgent: AIAgent | null =
          await AIAgentService.getConnectedAIAgentForProject(run.projectId);
        projectHasAliveAgent.set(projectIdStr, Boolean(aliveAgent));
      }

      if (projectHasAliveAgent.get(projectIdStr)) {
        continue;
      }

      try {
        await AIRunService.attemptStatusTransition({
          aiRunId: run.id!,
          fromStatus: AIRunStatus.Queued,
          set: {
            status: AIRunStatus.Error,
            completedAt: OneUptimeDate.getCurrentDate(),
            errorMessage: `No AI agent picked this task up within ${ORPHANED_QUEUED_TIMEOUT_MINUTES} minutes and none is currently online. Check that your agent container is running (Settings > AI > AI Agents), then retry the fix from the exception page.`,
          },
        });

        logger.info(
          `Failed orphaned Queued code-fix run ${run.id?.toString()} (no alive agent for project ${projectIdStr})`,
        );
      } catch (error) {
        logger.error(
          `Failed to mark orphaned code-fix run ${run.id?.toString()} as Error: ${error}`,
        );
      }
    }
  }
}
