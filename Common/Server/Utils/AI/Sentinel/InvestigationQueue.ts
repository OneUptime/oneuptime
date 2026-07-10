import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunService from "../../../Services/AIRunService";
import AIService, { AutonomousBudgetStatus } from "../../../Services/AIService";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * Sentinel — the durable investigation queue (Phase 2's first item; Q1
 * decided as the DB-claim pattern on AIRun rows, no new infrastructure).
 *
 * The problem it replaces: investigations ran as detached in-process
 * promises, so a pod restart orphaned them silently (Deviations log D2).
 *
 * The shape:
 *   1. enqueue() records the durable intent as an AIRun in status Queued
 *      BEFORE any expensive work, then immediately tries to process it
 *      in-process — same latency as before when the pod stays alive.
 *   2. Claims are a status-guarded CAS (Queued -> Running, attemptCount+1),
 *      so the enqueueing pod and the poller can both try and exactly one
 *      wins — double-processing is impossible.
 *   3. A Workers poller drains whatever the inline path left behind
 *      (pod died, cap was full, budget was exhausted) and expires runs
 *      that sat queued past their usefulness window.
 *   4. Failed attempts requeue (transient errors and stale heartbeats)
 *      until MAX_ATTEMPTS, then finalize as Error/Stale — G9's retry
 *      policy. Permanent errors (bad configuration) never retry.
 *
 * Mid-run message-level checkpointing is deliberately NOT here: a retried
 * investigation re-runs from the top, which is safe because investigations
 * are read-only until the single postAnalysis at the end.
 */

// Initial attempt + one retry.
export const MAX_INVESTIGATION_ATTEMPTS: number = 2;

/*
 * G4 cost guardrail: at most this many investigations may be Running per
 * project at once. Enforced at CLAIM time, so a storm queues (bounded by
 * dedupe + severity gates + this TTL) and drains at cap rate instead of
 * being dropped.
 */
export const MAX_CONCURRENT_INVESTIGATIONS_PER_PROJECT: number = 3;

/*
 * A first-pass RCA is only useful while the incident is fresh. Queued runs
 * older than this are expired rather than run late — this also caps queue
 * growth when the daily budget blocks claiming for hours.
 */
export const QUEUE_TTL_MINUTES: number = 30;

// How many queued runs one poller tick will try to claim.
const POLLER_BATCH_SIZE: number = 10;

export interface QueuedRunRef {
  id: ObjectID;
  projectId: ObjectID;
  attemptCount: number;
  triggeredByIncidentId?: ObjectID | undefined;
  triggeredByAlertId?: ObjectID | undefined;
}

export default class SentinelInvestigationQueue {
  /*
   * Record the durable intent to investigate, then try to process it
   * immediately (detached — the poller is the safety net if this pod dies).
   * Callers have already passed the subject-specific gates (opt-in,
   * severity floor, dedupe window).
   */
  @CaptureSpan()
  public static async enqueue(data: {
    projectId: ObjectID;
    subjectIncidentId?: ObjectID | undefined;
    subjectAlertId?: ObjectID | undefined;
    subjectMonitorId?: ObjectID | undefined;
  }): Promise<void> {
    const { projectId } = data;

    /*
     * Budget quiet-skip at enqueue: when the daily budget is already
     * exhausted there is no point recording intent that the TTL would
     * expire anyway. Fails cheap (skip) like all the cost gates.
     */
    try {
      const budget: AutonomousBudgetStatus =
        await AIService.getAutonomousDailyBudgetStatus(projectId);

      if (budget.exhausted) {
        logger.debug(
          `Sentinel: not enqueueing investigation for project ${projectId.toString()} — daily autonomous token budget exhausted (${budget.usedTokensToday} of ${budget.limitInTokens} tokens used today).`,
        );
        return;
      }
    } catch (error) {
      logger.error(
        `Sentinel: budget check failed, not enqueueing investigation: ${error}`,
      );
      return;
    }

    const run: AIRun = new AIRun();
    run.projectId = projectId;
    run.runType = AIRunType.Investigation;
    run.status = AIRunStatus.Queued;

    if (data.subjectIncidentId) {
      run.triggeredByIncidentId = data.subjectIncidentId;
    }
    if (data.subjectAlertId) {
      run.triggeredByAlertId = data.subjectAlertId;
    }
    if (data.subjectMonitorId) {
      run.monitorId = data.subjectMonitorId;
    }

    let createdRun: AIRun;
    try {
      createdRun = await AIRunService.create({
        data: run,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(`Sentinel: failed to enqueue investigation run: ${error}`);
      return;
    }

    // Inline kick — preserves the 1-3 minute RCA latency on the happy path.
    this.processRun({
      id: createdRun.id!,
      projectId,
      attemptCount: 0,
      triggeredByIncidentId: data.subjectIncidentId,
      triggeredByAlertId: data.subjectAlertId,
    }).catch((error: Error) => {
      logger.error(
        `Sentinel: inline processing of queued run ${createdRun.id?.toString()} failed: ${error}`,
      );
    });
  }

  /*
   * Claim a queued run and execute it. Safe to call from multiple places
   * concurrently — the CAS guarantees a single winner. Leaves the run
   * Queued (for the poller / TTL) when the concurrency cap is full or the
   * budget is exhausted.
   */
  @CaptureSpan()
  public static async processRun(run: QueuedRunRef): Promise<void> {
    try {
      const runningCount: number = (
        await AIRunService.countBy({
          query: {
            projectId: run.projectId,
            runType: AIRunType.Investigation,
            status: AIRunStatus.Running,
          },
          props: { isRoot: true },
        })
      ).toNumber();

      if (runningCount >= MAX_CONCURRENT_INVESTIGATIONS_PER_PROJECT) {
        logger.debug(
          `Sentinel: leaving run ${run.id.toString()} queued — ${runningCount} investigations already running (cap: ${MAX_CONCURRENT_INVESTIGATIONS_PER_PROJECT}).`,
        );
        return;
      }

      const budget: AutonomousBudgetStatus =
        await AIService.getAutonomousDailyBudgetStatus(run.projectId);

      if (budget.exhausted) {
        logger.debug(
          `Sentinel: leaving run ${run.id.toString()} queued — daily autonomous token budget exhausted.`,
        );
        return;
      }

      const attempt: number = (run.attemptCount || 0) + 1;

      const claimedCount: number = await AIRunService.updateOneBy({
        query: {
          _id: run.id.toString(),
          status: AIRunStatus.Queued,
        },
        data: {
          status: AIRunStatus.Running,
          startedAt: OneUptimeDate.getCurrentDate(),
          lastHeartbeatAt: OneUptimeDate.getCurrentDate(),
          attemptCount: attempt,
        } as never,
        props: { isRoot: true },
      });

      if (claimedCount === 0) {
        // Another worker won the claim (or the run was expired/cancelled).
        return;
      }

      if (run.triggeredByIncidentId) {
        /*
         * Lazy require: the runners import this queue to enqueue, so a
         * top-level import here would be circular at module-init time
         * (same pattern as DatabaseService -> AuditLogService).
         */
        const incidentRunner: typeof import("./IncidentInvestigationRunner").default =
          // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
          require("./IncidentInvestigationRunner").default;

        await incidentRunner.executeInvestigation({
          aiRunId: run.id,
          projectId: run.projectId,
          incidentId: run.triggeredByIncidentId,
          attemptCount: attempt,
        });
        return;
      }

      if (run.triggeredByAlertId) {
        const alertRunner: typeof import("./AlertInvestigationRunner").default =
          // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
          require("./AlertInvestigationRunner").default;

        await alertRunner.executeInvestigation({
          aiRunId: run.id,
          projectId: run.projectId,
          alertId: run.triggeredByAlertId,
          attemptCount: attempt,
        });
        return;
      }

      // A queued investigation without a subject cannot be executed.
      await AIRunService.updateOneBy({
        query: { _id: run.id.toString(), status: AIRunStatus.Running },
        data: {
          status: AIRunStatus.Error,
          completedAt: OneUptimeDate.getCurrentDate(),
          errorMessage: "Queued investigation has no subject to investigate.",
        } as never,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(
        `Sentinel: failed to process queued run ${run.id.toString()}: ${error}`,
      );
    }
  }

  /*
   * One poller tick: expire runs that queued past their usefulness window,
   * then drain a batch of the rest. Called every minute from Workers; also
   * the recovery path for runs orphaned by pod restarts.
   */
  @CaptureSpan()
  public static async processQueuedRuns(): Promise<void> {
    const expiryThreshold: Date =
      OneUptimeDate.getSomeMinutesAgo(QUEUE_TTL_MINUTES);

    const expiredRuns: Array<AIRun> = await AIRunService.findBy({
      query: {
        runType: AIRunType.Investigation,
        status: AIRunStatus.Queued,
        createdAt: QueryHelper.lessThan(expiryThreshold),
      },
      select: { _id: true },
      limit: 100,
      skip: 0,
      props: { isRoot: true },
    });

    for (const expired of expiredRuns) {
      await AIRunService.updateOneBy({
        query: { _id: expired.id!.toString(), status: AIRunStatus.Queued },
        data: {
          status: AIRunStatus.Cancelled,
          completedAt: OneUptimeDate.getCurrentDate(),
          errorMessage: `Expired in the investigation queue after ${QUEUE_TTL_MINUTES} minutes — a first-pass analysis this late would no longer be useful. The project may have been at its concurrency cap or daily token budget.`,
        } as never,
        props: { isRoot: true },
      });
    }

    const queuedRuns: Array<AIRun> = await AIRunService.findBy({
      query: {
        runType: AIRunType.Investigation,
        status: AIRunStatus.Queued,
      },
      select: {
        _id: true,
        projectId: true,
        attemptCount: true,
        triggeredByIncidentId: true,
        triggeredByAlertId: true,
      },
      sort: { createdAt: SortOrder.Ascending },
      limit: POLLER_BATCH_SIZE,
      skip: 0,
      props: { isRoot: true },
    });

    for (const queued of queuedRuns) {
      // Sequential on purpose: lets the concurrency cap settle between claims.
      await this.processRun({
        id: queued.id!,
        projectId: queued.projectId!,
        attemptCount: queued.attemptCount || 0,
        triggeredByIncidentId: queued.triggeredByIncidentId,
        triggeredByAlertId: queued.triggeredByAlertId,
      });
    }
  }

  /*
   * Finalize a failed attempt: requeue transient failures while attempts
   * remain, otherwise mark the run Error. The CAS guards on Running so a
   * run that already completed (e.g. only postAnalysis failed) is never
   * clobbered or re-run.
   */
  @CaptureSpan()
  public static async failOrRequeue(data: {
    aiRunId: ObjectID;
    attemptCount: number;
    errorMessage: string;
    isPermanent: boolean;
  }): Promise<void> {
    const truncatedMessage: string = data.errorMessage.substring(0, 400);

    if (!data.isPermanent && data.attemptCount < MAX_INVESTIGATION_ATTEMPTS) {
      const requeued: number = await AIRunService.updateOneBy({
        query: { _id: data.aiRunId.toString(), status: AIRunStatus.Running },
        data: {
          status: AIRunStatus.Queued,
          errorMessage: `Attempt ${data.attemptCount} failed and the run was requeued: ${truncatedMessage}`,
        } as never,
        props: { isRoot: true },
      });

      if (requeued > 0) {
        logger.debug(
          `Sentinel: requeued run ${data.aiRunId.toString()} after attempt ${data.attemptCount} failed.`,
        );
      }
      return;
    }

    await AIRunService.updateOneBy({
      query: { _id: data.aiRunId.toString(), status: AIRunStatus.Running },
      data: {
        status: AIRunStatus.Error,
        completedAt: OneUptimeDate.getCurrentDate(),
        errorMessage: truncatedMessage.substring(0, 480),
      } as never,
      props: { isRoot: true },
    });
  }

  /*
   * Called by the stale-run sweeper for an Investigation run whose
   * heartbeat went silent (the pod running it died). Requeues while
   * attempts remain; otherwise marks it Stale as before.
   */
  @CaptureSpan()
  public static async requeueOrMarkStale(run: {
    id: ObjectID;
    attemptCount: number;
  }): Promise<"requeued" | "stale"> {
    if ((run.attemptCount || 0) < MAX_INVESTIGATION_ATTEMPTS) {
      const requeued: number = await AIRunService.updateOneBy({
        query: { _id: run.id.toString(), status: AIRunStatus.Running },
        data: {
          status: AIRunStatus.Queued,
          errorMessage: `Attempt ${run.attemptCount} stopped reporting progress (the server processing it may have restarted) and the run was requeued.`,
        } as never,
        props: { isRoot: true },
      });

      if (requeued > 0) {
        return "requeued";
      }
    }

    await AIRunService.updateOneBy({
      query: { _id: run.id.toString(), status: AIRunStatus.Running },
      data: {
        status: AIRunStatus.Stale,
        completedAt: OneUptimeDate.getCurrentDate(),
        errorMessage:
          "The run stopped reporting progress and was marked as stale after exhausting its retry attempts. The server processing it may have restarted.",
      } as never,
      props: { isRoot: true },
    });

    return "stale";
  }
}
