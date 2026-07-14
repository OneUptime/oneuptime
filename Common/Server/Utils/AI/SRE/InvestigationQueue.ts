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
 * AI SRE — the durable investigation queue (Phase 2's first item; Q1
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
 * Lane priority. Two kinds of run share this queue and the per-project
 * concurrency cap above:
 *   - the INTERACTIVE lane (incident/alert RCA) — a human is waiting;
 *   - the PREVENTIVE lane (AI-insight triage, identified by
 *     triggeredByAiInsightId) — nobody is waiting, and one scan tick
 *     can file up to MAX_NEW_INSIGHTS_PER_PROJECT_PER_SCAN (10) of them.
 *
 * Without a sub-cap the preventive lane can hold every slot, and since the
 * poller drains oldest-first, an incident that fires after a scan queues
 * BEHIND that backlog — the exact RCA latency the product promises.
 *
 * So the preventive lane may hold at most (cap - RESERVED) slots: at least
 * one slot is always unreachable by triage. Combined with the inline kick
 * that enqueue() fires for every run, that reserved slot is enough on its
 * own — an incident/alert enqueue calls processRun immediately, passes the
 * gates against a cap that triage cannot have saturated, and dispatches
 * without ever touching the poller (so it can also never be TTL-expired
 * behind triage). Splitting the poller's oldest-first query into two lane
 * queries would therefore only re-order runs that are ALREADY late, at the
 * cost of an extra query every tick — deliberately not done.
 */
export const INSIGHT_TRIAGE_RESERVED_SLOTS: number = 1;

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
  triggeredByAiInsightId?: ObjectID | undefined;
}

export default class AIInvestigationQueue {
  /*
   * Record the durable intent to investigate, then try to process it
   * immediately (detached — the poller is the safety net if this pod dies).
   * Callers have already passed the subject-specific gates (opt-in,
   * severity floor, dedupe window).
   *
   * Returns the created run's id (so subject rows can link back to it), or
   * null when the enqueue was quiet-skipped (budget) or failed — enqueue
   * itself never throws.
   */
  @CaptureSpan()
  public static async enqueue(data: {
    projectId: ObjectID;
    subjectIncidentId?: ObjectID | undefined;
    subjectAlertId?: ObjectID | undefined;
    subjectMonitorId?: ObjectID | undefined;
    subjectAIInsightId?: ObjectID | undefined;
  }): Promise<ObjectID | null> {
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
          `AI: not enqueueing investigation for project ${projectId.toString()} — daily autonomous token budget exhausted (${budget.usedTokensToday} of ${budget.limitInTokens} tokens used today).`,
        );
        return null;
      }
    } catch (error) {
      logger.error(
        `AI: budget check failed, not enqueueing investigation: ${error}`,
      );
      return null;
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
    if (data.subjectAIInsightId) {
      run.triggeredByAiInsightId = data.subjectAIInsightId;
    }

    let createdRun: AIRun;
    try {
      createdRun = await AIRunService.create({
        data: run,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error(`AI: failed to enqueue investigation run: ${error}`);
      return null;
    }

    // Inline kick — preserves the 1-3 minute RCA latency on the happy path.
    this.processRun({
      id: createdRun.id!,
      projectId,
      attemptCount: 0,
      triggeredByIncidentId: data.subjectIncidentId,
      triggeredByAlertId: data.subjectAlertId,
      triggeredByAiInsightId: data.subjectAIInsightId,
    }).catch((error: Error) => {
      logger.error(
        `AI: inline processing of queued run ${createdRun.id?.toString()} failed: ${error}`,
      );
    });

    return createdRun.id || null;
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
        `AI: failed to process queued run ${run.id.toString()}: ${error}`,
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
        triggeredByAiInsightId: true,
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
        triggeredByAiInsightId: queued.triggeredByAiInsightId,
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
            `AI: detached execution of run ${ref.id.toString()} failed: ${error}`,
          );
        });
      } catch (error) {
        logger.error(
          `AI: poller failed on queued run ${ref.id.toString()}: ${error}`,
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
          `AI: requeued run ${data.aiRunId.toString()} after attempt ${data.attemptCount} failed.`,
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
   * The claim-time cost gates: concurrency cap, the preventive-lane sub-cap
   * and the daily budget. A run failing these stays Queued — the poller
   * retries and the TTL expires what never fits. Fails cheap (skip) on gate
   * errors.
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
        `AI: leaving run ${run.id.toString()} queued — ${runningCount} investigations already running (cap: ${concurrencyCap}).`,
      );
      return false;
    }

    /*
     * The preventive lane's sub-cap: insight triage may never occupy the
     * slot(s) reserved for incident/alert RCA (see
     * INSIGHT_TRIAGE_RESERVED_SLOTS). Floored at 1 so a project running at
     * the minimum cap of 1 still triages its insights (slower, one at a
     * time) instead of deadlocking the lane entirely — the interactive lane
     * keeps its priority through the global cap check above, which a single
     * running triage run cannot outlast for long (triage is read-only and
     * short).
     */
    if (run.triggeredByAiInsightId) {
      const triageCap: number = Math.max(
        1,
        concurrencyCap - INSIGHT_TRIAGE_RESERVED_SLOTS,
      );

      const runningTriageCount: number = (
        await AIRunService.countBy({
          query: {
            projectId: run.projectId,
            runType: AIRunType.Investigation,
            status: AIRunStatus.Running,
            triggeredByAiInsightId: QueryHelper.notNull(),
          },
          props: { isRoot: true },
        })
      ).toNumber();

      if (runningTriageCount >= triageCap) {
        logger.debug(
          `AI: leaving insight triage run ${run.id.toString()} queued — ${runningTriageCount} triage runs already running (triage lane cap: ${triageCap} of ${concurrencyCap}).`,
        );
        return false;
      }
    }

    const budget: AutonomousBudgetStatus =
      await AIService.getAutonomousDailyBudgetStatus(run.projectId);

    if (budget.exhausted) {
      logger.debug(
        `AI: leaving run ${run.id.toString()} queued — daily autonomous token budget exhausted.`,
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

    /*
     * AI-insight triage runs carry their subject in
     * triggeredByAiInsightId — they must be recognized here as
     * subject-BEARING, or the fallthrough below would fail every one of
     * them as subject-less.
     */
    if (run.triggeredByAiInsightId) {
      const insightTriageRunner: typeof import("./Insights/InsightTriageRunner").default =
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        require("./Insights/InsightTriageRunner").default;

      await insightTriageRunner.executeTriage({
        aiRunId: run.id,
        projectId: run.projectId,
        sentinelInsightId: run.triggeredByAiInsightId,
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
