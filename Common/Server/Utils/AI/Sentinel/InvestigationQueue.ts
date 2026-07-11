import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRunService from "../../../Services/AIRunService";
import ProjectService from "../../../Services/ProjectService";
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
 *   2. Claims go through AIRunService.attemptStatusTransition — one
 *      conditional UPDATE guarded on BOTH status=Queued and the expected
 *      attemptCount — so the enqueueing pod and the poller can race and
 *      exactly one wins, and a stale queue snapshot can never claim (or
 *      re-number) a run that moved on. attemptCount can therefore never
 *      exceed MAX_INVESTIGATION_ATTEMPTS.
 *   3. A Workers poller claims whatever the inline path left behind
 *      (pod died, cap was full, budget was exhausted) and expires runs
 *      that sat queued past their usefulness window. The poller claims
 *      sequentially (so the concurrency cap sees each claim) but executes
 *      detached, keeping the every-minute tick fast.
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
 * project at once (per-project override in
 * Project.aiMaxConcurrentInvestigations). Enforced at CLAIM time, so a storm
 * queues (bounded by dedupe + severity gates + this TTL) and drains at cap
 * rate instead of being dropped.
 */
export const DEFAULT_MAX_CONCURRENT_INVESTIGATIONS: number = 3;
/*
 * Clamp bounds for the per-project override. Pausing has its own switches
 * (the opt-in toggles, daily limit 0), so the floor is 1, not 0.
 */
const MIN_CONCURRENT_INVESTIGATIONS: number = 1;
const MAX_CONCURRENT_INVESTIGATIONS: number = 25;

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
   * Claim a queued run and execute it to completion. Safe to call from
   * multiple places concurrently — the claim is one conditional UPDATE, so
   * exactly one caller wins. Leaves the run Queued (for the poller / TTL)
   * when the concurrency cap is full or the budget is exhausted.
   */
  @CaptureSpan()
  public static async processRun(run: QueuedRunRef): Promise<void> {
    try {
      if (!(await this.passesClaimGates(run))) {
        return;
      }

      const attempt: number | null = await this.claim(run);

      if (attempt === null) {
        return;
      }

      await this.dispatch(run, attempt);
    } catch (error) {
      logger.error(
        `Sentinel: failed to process queued run ${run.id.toString()}: ${error}`,
      );
    }
  }

  /*
   * One poller tick: expire runs that queued past their usefulness window,
   * then claim a batch of the rest. Claims happen sequentially — each claim
   * sets Running immediately, so the next iteration's concurrency-cap count
   * sees it — but execution is detached so the tick finishes in seconds
   * instead of holding the job open for the length of the investigations.
   * Called every minute from Workers; also the recovery path for runs
   * orphaned by pod restarts.
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
      await AIRunService.attemptStatusTransition({
        aiRunId: expired.id!,
        fromStatus: AIRunStatus.Queued,
        set: {
          status: AIRunStatus.Cancelled,
          completedAt: OneUptimeDate.getCurrentDate(),
          errorMessage: `Expired in the investigation queue after ${QUEUE_TTL_MINUTES} minutes — a first-pass analysis this late would no longer be useful. The project may have been at its concurrency cap or daily token budget.`,
        },
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
      const ref: QueuedRunRef = {
        id: queued.id!,
        projectId: queued.projectId!,
        attemptCount: queued.attemptCount || 0,
        triggeredByIncidentId: queued.triggeredByIncidentId,
        triggeredByAlertId: queued.triggeredByAlertId,
      };

      try {
        if (!(await this.passesClaimGates(ref))) {
          continue;
        }

        const attempt: number | null = await this.claim(ref);

        if (attempt === null) {
          continue;
        }

        /*
         * Execute detached — the run is claimed (Running + heartbeat), so
         * the sweeper owns recovery if this pod dies mid-flight.
         */
        this.dispatch(ref, attempt).catch((error: Error) => {
          logger.error(
            `Sentinel: detached execution of run ${ref.id.toString()} failed: ${error}`,
          );
        });
      } catch (error) {
        logger.error(
          `Sentinel: poller failed on queued run ${ref.id.toString()}: ${error}`,
        );
      }
    }
  }

  /*
   * Finalize a failed attempt: requeue transient failures while attempts
   * remain, otherwise mark the run Error. The transition guards on Running
   * so a run that already completed (e.g. only postAnalysis failed) is
   * never clobbered or re-run.
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
      const requeued: number = await AIRunService.attemptStatusTransition({
        aiRunId: data.aiRunId,
        fromStatus: AIRunStatus.Running,
        set: {
          status: AIRunStatus.Queued,
          errorMessage: `Attempt ${data.attemptCount} failed and the run was requeued: ${truncatedMessage}`,
        },
      });

      if (requeued > 0) {
        logger.debug(
          `Sentinel: requeued run ${data.aiRunId.toString()} after attempt ${data.attemptCount} failed.`,
        );
      }
      return;
    }

    await AIRunService.attemptStatusTransition({
      aiRunId: data.aiRunId,
      fromStatus: AIRunStatus.Running,
      set: {
        status: AIRunStatus.Error,
        completedAt: OneUptimeDate.getCurrentDate(),
        errorMessage: truncatedMessage,
      },
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
      const requeued: number = await AIRunService.attemptStatusTransition({
        aiRunId: run.id,
        fromStatus: AIRunStatus.Running,
        set: {
          status: AIRunStatus.Queued,
          errorMessage: `Attempt ${run.attemptCount} stopped reporting progress (the server processing it may have restarted) and the run was requeued.`,
        },
      });

      if (requeued > 0) {
        return "requeued";
      }
    }

    await AIRunService.attemptStatusTransition({
      aiRunId: run.id,
      fromStatus: AIRunStatus.Running,
      set: {
        status: AIRunStatus.Stale,
        completedAt: OneUptimeDate.getCurrentDate(),
        errorMessage:
          "The run stopped reporting progress and was marked as stale after exhausting its retry attempts. The server processing it may have restarted.",
      },
    });

    return "stale";
  }

  /*
   * The claim-time cost gates: concurrency cap and daily budget. A run
   * failing these stays Queued — the poller retries and the TTL expires
   * what never fits. Fails cheap (skip) on gate errors.
   */
  private static async passesClaimGates(run: QueuedRunRef): Promise<boolean> {
    // Per-project cap override, defaulting to 3 and clamped to [1, 25].
    const project: Project | null = await ProjectService.findOneById({
      id: run.projectId,
      select: { aiMaxConcurrentInvestigations: true },
      props: { isRoot: true },
    });

    const concurrencyCap: number = Math.min(
      MAX_CONCURRENT_INVESTIGATIONS,
      Math.max(
        MIN_CONCURRENT_INVESTIGATIONS,
        project?.aiMaxConcurrentInvestigations ??
          DEFAULT_MAX_CONCURRENT_INVESTIGATIONS,
      ),
    );

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

    if (runningCount >= concurrencyCap) {
      logger.debug(
        `Sentinel: leaving run ${run.id.toString()} queued — ${runningCount} investigations already running (cap: ${concurrencyCap}).`,
      );
      return false;
    }

    const budget: AutonomousBudgetStatus =
      await AIService.getAutonomousDailyBudgetStatus(run.projectId);

    if (budget.exhausted) {
      logger.debug(
        `Sentinel: leaving run ${run.id.toString()} queued — daily autonomous token budget exhausted.`,
      );
      return false;
    }

    return true;
  }

  /*
   * The atomic claim: Queued -> Running, guarded on the attemptCount the
   * caller observed, so a stale queue snapshot can neither double-claim
   * nor reset the attempt numbering. Returns the claimed attempt number,
   * or null when another actor won.
   */
  private static async claim(run: QueuedRunRef): Promise<number | null> {
    const attempt: number = (run.attemptCount || 0) + 1;

    const claimedCount: number = await AIRunService.attemptStatusTransition({
      aiRunId: run.id,
      fromStatus: AIRunStatus.Queued,
      expectedAttemptCount: run.attemptCount || 0,
      set: {
        status: AIRunStatus.Running,
        startedAt: OneUptimeDate.getCurrentDate(),
        lastHeartbeatAt: OneUptimeDate.getCurrentDate(),
        attemptCount: attempt,
      },
    });

    if (claimedCount === 0) {
      return null;
    }

    return attempt;
  }

  // Route a claimed run to its subject's executor.
  private static async dispatch(
    run: QueuedRunRef,
    attempt: number,
  ): Promise<void> {
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
    await AIRunService.attemptStatusTransition({
      aiRunId: run.id,
      fromStatus: AIRunStatus.Running,
      set: {
        status: AIRunStatus.Error,
        completedAt: OneUptimeDate.getCurrentDate(),
        errorMessage: "Queued investigation has no subject to investigate.",
      },
    });
  }
}
