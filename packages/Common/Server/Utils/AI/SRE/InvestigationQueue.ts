import { InvestigationNotStartedCode } from "../../../../Types/AI/InvestigationNotStartedReason";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import Query from "../../../../Types/BaseDatabase/Query";
import AIRunType from "../../../../Types/AI/AIRunType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunCodeFixRecommendation from "../../../../Types/AI/AIRunCodeFixRecommendation";
import AIWorkloadLimits from "../../../../Types/AI/AIWorkloadLimits";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Project from "../../../../Models/DatabaseModels/Project";
import AIRunService from "../../../Services/AIRunService";
import ProjectService from "../../../Services/ProjectService";
import AIService, { AutonomousBudgetStatus } from "../../../Services/AIService";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import QueryHelper from "../../../Types/Database/QueryHelper";
import Queue, { QueueJob, QueueName } from "../../../Infrastructure/Queue";
import QueueWorker from "../../../Infrastructure/QueueWorker";
import { JSONObject } from "../../../../Types/JSON";
import GracefulShutdown, { ShutdownPriority } from "../../GracefulShutdown";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import InvestigationSubjectLock from "./InvestigationSubjectLock";

/*
 * AI SRE — the durable investigation queue (Phase 2's first item; Q1
 * decided as the DB-claim pattern on AIRun rows, no new infrastructure).
 *
 * The problem it replaces: investigations ran as detached in-process
 * promises, so a pod restart orphaned them silently (Deviations log D2).
 *
 * The shape:
 *   1. enqueue() records the durable intent as an AIRun in status Queued
 *      BEFORE any expensive work, then sends it to the workers: a job on
 *      the AIInvestigation BullMQ queue, which only worker-role servers
 *      consume, each running at most AI_INVESTIGATION_CONCURRENCY runs at
 *      once (startWorker). A free worker takes the job within seconds, as
 *      fast as when the enqueueing process ran the investigation itself,
 *      but a storm can no longer start more runs on one server than it
 *      can hold, and an API server never runs one.
 *   2. Claims go through AIRunService.attemptStatusTransition — one
 *      conditional UPDATE guarded on BOTH status=Queued and the expected
 *      attemptCount — so two jobs for one run can race and exactly one
 *      wins, and a stale job can never claim (or re-number) a run that
 *      moved on. The attempts that count — attemptCount less
 *      handedBackCount — can therefore never exceed
 *      MAX_INVESTIGATION_ATTEMPTS.
 *   3. A Workers poller sends to the workers whatever is still Queued (a
 *      job that could not be added, a run a cap or the budget held back, a
 *      requeued attempt) and expires runs that sat queued past their
 *      usefulness window.
 *   4. Failed attempts requeue (transient errors and stale heartbeats)
 *      until MAX_ATTEMPTS, then finalize as Error/Stale — G9's retry
 *      policy. Permanent errors (bad configuration) never retry.
 *   5. A server shutting down hands the runs it is executing back
 *      (handBackRunsInFlight): another server picks each one up within
 *      seconds instead of after the stale sweep's twelve minutes, and the
 *      claim is not counted as a failed attempt (handedBackCount).
 *
 * Mid-run message-level checkpointing is deliberately NOT here: a retried
 * investigation re-runs from the top, which is safe because investigations
 * are read-only until the single postAnalysis at the end.
 */

// Initial attempt + one retry.
export const MAX_INVESTIGATION_ATTEMPTS: number = 2;

/*
 * G4 cost guardrail, opt-in: a project may cap how many runs go at once in
 * its incident lane and in its alert lane (Incidents or Alerts → Settings →
 * AI). Unset means no cap — a run is claimed as soon as it passes the budget
 * gate, however many are already Running — and subjectless work (insight
 * triage) has no setting and no cap (see AIWorkloadLimits). Where a cap is
 * set it is enforced at CLAIM time, so a storm queues (bounded by
 * QUEUE_TTL_MINUTES) and drains at cap rate instead of being dropped.
 *
 * Lane priority inside a capped lane. Two kinds of run share its slots:
 *   - INTERACTIVE work (the incident/alert RCA) — a human is waiting;
 *   - BACKGROUND work (remediation plans and executions; insight triage is
 *     counted the same way, though its own lane has no cap) — nobody is
 *     waiting, and it is storm-shaped.
 *
 * Without a sub-cap background work can hold every slot, and since the
 * poller drains oldest-first, an incident that fires after a burst queues
 * BEHIND that backlog — the exact RCA latency the product promises.
 *
 * So background work may hold at most (cap - RESERVED) slots: at least one
 * slot is always unreachable by it. Combined with the job that enqueue()
 * sends for every run — an incident/alert run's at the highest priority,
 * so a worker takes it before any background job — that reserved slot is
 * enough on its own: an incident/alert run is claimed as soon as a worker
 * is free, against a cap that background work cannot have saturated,
 * without ever waiting for the poller (so it can also never be TTL-expired
 * behind it). Splitting the poller's oldest-first query into two lane
 * queries would therefore only re-order runs that are ALREADY late, at the
 * cost of an extra query every tick — deliberately not done.
 */
export const INSIGHT_TRIAGE_RESERVED_SLOTS: number = 1;

/*
 * A first-pass RCA is only useful while the incident is fresh. Queued runs
 * older than this are expired rather than run late — this also caps queue
 * growth when a configured cap or daily budget blocks claiming for hours.
 */
export const QUEUE_TTL_MINUTES: number = 30;

// How many queued runs one poller tick sends to the workers.
const POLLER_BATCH_SIZE: number = 10;

// The name of an AIInvestigation job; its data names the run it is for.
const RUN_JOB_NAME: string = "ProcessQueuedRun";

/*
 * The priority of a background run's job (isBackgroundRun). An incident or
 * alert RCA's job keeps BullMQ's default, 0, the highest: a paged human is
 * waiting for it, so a worker takes it before any background job, however
 * many are waiting.
 */
const BACKGROUND_RUN_JOB_PRIORITY: number = 10;

/*
 * How many times a run may be handed back by a server shutting down without
 * the claim counting as a failed attempt. A run that keeps taking its server
 * down — one that holds the event loop past the liveness probe, say — would
 * otherwise move from server to server for ever; past this, a shutdown
 * leaves it to the stale sweep, which counts the attempt.
 */
export const MAX_INVESTIGATION_HAND_BACKS: number = 3;

export interface QueuedRunRef {
  id: ObjectID;
  projectId: ObjectID;
  attemptCount: number;
  /*
   * How many times a server shutting down handed the run back, read with
   * attemptCount: neither changes while the run is Queued, so the claim of
   * an attemptCount is the claim of this count too.
   */
  handedBackCount?: number | undefined;
  runType?: AIRunType | undefined;
  triggeredByIncidentId?: ObjectID | undefined;
  triggeredByAlertId?: ObjectID | undefined;
  triggeredByAiInsightId?: ObjectID | undefined;
  triggeredByAutoRemediationSuggestionId?: ObjectID | undefined;
  // Set on an incident's follow-up check (IncidentFollowUpCheck).
  followUpForAlertId?: ObjectID | undefined;
  /*
   * Set on an investigation an investigation rule made wait
   * (InvestigationRuleWait): its subject's remediation did not wait for it.
   */
  ruleWaitMinutes?: number | undefined;
}

// A run this server claimed and is executing: the attempt its claim gave it.
interface RunInFlight extends QueuedRunRef {
  attempt: number;
}

export default class AIInvestigationQueue {
  /*
   * The runs this server is executing (processRun), by run id: what it hands
   * back when it shuts down, and where failOrRequeue reads how many times a
   * run was handed back.
   */
  private static runsInFlight: Map<string, RunInFlight> = new Map<
    string,
    RunInFlight
  >();

  // Set when this server starts shutting down: from then on it claims nothing.
  private static isHandingBack: boolean = false;

  /*
   * Record the durable intent to investigate, then send it to the workers
   * (a worker-role server claims and runs it; the poller is the safety net
   * if the job is lost). Callers have already passed the subject-specific
   * gates (opt-in, severity floor, dedupe window).
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
    onNotEnqueued?:
      | ((
          code: InvestigationNotStartedCode,
          budget?: AutonomousBudgetStatus,
        ) => Promise<void>)
      | undefined;
    /*
     * When set, the run is a remediation run (not an Investigation): by
     * default a read-only RemediationPlan that picks a runbook for this
     * suggestion, or a RemediationExecution when remediationRunType says so.
     * dispatch() routes on runType FIRST, so the incident/alert subject ids
     * above may still be set for dashboard linkage.
     */
    subjectAutoRemediationSuggestionId?: ObjectID | undefined;
    /*
     * Only meaningful with subjectAutoRemediationSuggestionId: which kind
     * of remediation run to enqueue. Defaults to RemediationPlan.
     */
    remediationRunType?:
      | AIRunType.RemediationPlan
      | AIRunType.RemediationExecution
      | undefined;
    /*
     * An incident's follow-up check (IncidentFollowUpCheck): the alert that
     * opened on its linked infrastructure after the first investigation.
     */
    followUpForAlertId?: ObjectID | undefined;
    /*
     * Asked inside the subject lock, right before the run is created: false
     * leaves the subject as it is and creates nothing. The follow-up check
     * uses it so two triggers at once can only ever add one run.
     */
    admitInsideSubjectLock?: (() => Promise<boolean>) | undefined;
    /*
     * An investigation an investigation rule made wait
     * (InvestigationRuleWait): the minutes it waited. Its subject's auto
     * remediation started when the subject was created instead of waiting
     * for it, so it never hands the subject to remediation when it settles.
     */
    ruleWaitMinutes?: number | undefined;
  }): Promise<ObjectID | null> {
    const { projectId } = data;

    // Diagnostic persistence must never change queue admission or remediation.
    const recordSkip: (
      code: InvestigationNotStartedCode,
      budget?: AutonomousBudgetStatus,
    ) => Promise<void> = async (
      code: InvestigationNotStartedCode,
      budget?: AutonomousBudgetStatus,
    ): Promise<void> => {
      try {
        await data.onNotEnqueued?.(code, budget);
      } catch (error) {
        logger.error(`AI: could not record queue admission decision: ${error}`);
      }
    };

    if (data.subjectIncidentId && data.subjectAlertId) {
      logger.error(
        `AI: not enqueueing investigation for project ${projectId.toString()} — a run cannot belong to both an incident and an alert.`,
      );
      return null;
    }

    /*
     * Budget quiet-skip at enqueue: when the daily budget is already
     * exhausted there is no point recording intent that the TTL would
     * expire anyway. Fails cheap (skip) like all the cost gates.
     */
    try {
      const budget: AutonomousBudgetStatus =
        await AIService.getAutonomousDailyBudgetStatus(projectId, {
          incidentId: data.subjectIncidentId,
          alertId: data.subjectAlertId,
        });

      if (budget.exhausted) {
        await recordSkip("daily_budget_exhausted", budget);
        logger.debug(
          `AI: not enqueueing investigation for project ${projectId.toString()} — daily autonomous token budget exhausted (${budget.usedTokensToday} of ${budget.limitInTokens} tokens used today).`,
        );
        return null;
      }
    } catch (error) {
      await recordSkip("budget_check_failed");
      logger.error(
        `AI: budget check failed, not enqueueing investigation: ${error}`,
      );
      return null;
    }

    /*
     * The project's own daily AI limits (Project Settings → AI → AI
     * Features → More settings), a ceiling over every lane: once one is reached every
     * model call is refused until midnight UTC, so recording intent now
     * would only queue a run that fails or expires. Fails open (the model
     * call still enforces the limits).
     */
    if (await AIService.getReachedProjectDailyLimit({ projectId })) {
      await recordSkip("project_daily_limit_reached");
      logger.debug(
        `AI: not enqueueing investigation for project ${projectId.toString()} — the project has reached its own daily AI limit.`,
      );
      return null;
    }

    const runType: AIRunType = data.subjectAutoRemediationSuggestionId
      ? data.remediationRunType || AIRunType.RemediationPlan
      : AIRunType.Investigation;

    const run: AIRun = new AIRun();
    run.projectId = projectId;
    run.runType = runType;
    run.status = AIRunStatus.Queued;
    /*
     * Queued and Running rows must never advertise an unresolved code-fix
     * decision. The engine atomically moves eligible incident/alert runs to
     * Pending only when it wins the Running -> Completed transition; until
     * then the fail-closed default is NotRecommended.
     */
    run.codeFixRecommendation = AIRunCodeFixRecommendation.NotRecommended;

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
    if (data.subjectAutoRemediationSuggestionId) {
      run.triggeredByAutoRemediationSuggestionId =
        data.subjectAutoRemediationSuggestionId;
    }
    if (data.followUpForAlertId) {
      run.followUpForAlertId = data.followUpForAlertId;
    }
    if (data.ruleWaitMinutes && data.ruleWaitMinutes > 0) {
      run.ruleWaitMinutes = data.ruleWaitMinutes;
    }

    let createdRun: AIRun | null;
    try {
      const createRun: () => Promise<AIRun | null> =
        async (): Promise<AIRun | null> => {
          if (
            data.admitInsideSubjectLock &&
            !(await data.admitInsideSubjectLock())
          ) {
            return null;
          }

          return AIRunService.create({
            data: run,
            props: { isRoot: true },
          });
        };

      /*
       * Linearize subject Investigation creation with FixFromIncident's
       * final latest-source validation and INSERT. Whichever writer gets the
       * shared lock first becomes authoritative: a fix inserted first is
       * valid at that instant; an Investigation inserted first is observed by
       * the fix gate and makes the stale request fail closed.
       */
      createdRun =
        runType === AIRunType.Investigation &&
        (data.subjectIncidentId || data.subjectAlertId)
          ? await InvestigationSubjectLock.runExclusive(
              {
                projectId,
                incidentId: data.subjectIncidentId,
                alertId: data.subjectAlertId,
              },
              createRun,
            )
          : await createRun();
    } catch (error) {
      await recordSkip("enqueue_failed");
      logger.error(`AI: failed to enqueue investigation run: ${error}`);
      return null;
    }

    // Not admitted inside the subject lock: nothing was created.
    if (!createdRun) {
      logger.debug(
        `AI: not enqueueing investigation for project ${projectId.toString()} — it was not admitted under the subject lock.`,
      );
      return null;
    }

    const createdRunId: ObjectID | null = createdRun.id;

    // To the workers — a free one claims it within seconds (the RCA latency).
    await this.sendToWorkers({
      id: createdRunId!,
      projectId,
      attemptCount: 0,
      handedBackCount: 0,
      runType,
      triggeredByIncidentId: data.subjectIncidentId,
      triggeredByAlertId: data.subjectAlertId,
      triggeredByAiInsightId: data.subjectAIInsightId,
      triggeredByAutoRemediationSuggestionId:
        data.subjectAutoRemediationSuggestionId,
      followUpForAlertId: data.followUpForAlertId,
      ruleWaitMinutes: run.ruleWaitMinutes,
    });

    return createdRunId || null;
  }

  /*
   * Run this server's share of the queue: a worker on the AIInvestigation
   * queue that runs up to `concurrency` runs at once, and the hand-back of
   * those still running when the server shuts down. Workers starts it on
   * worker-role servers only (not with DISABLE_QUEUE_WORKERS), so an API
   * server never runs an investigation.
   */
  public static startWorker(options: { concurrency: number }): void {
    QueueWorker.getWorker(
      QueueName.AIInvestigation,
      async (job: QueueJob): Promise<void> => {
        await this.processQueueJob(job.data as JSONObject);
      },
      { concurrency: options.concurrency },
    );

    GracefulShutdown.registerHandler(
      "AIInvestigationQueue:HandBackRunsInFlight",
      ShutdownPriority.Workers,
      () => {
        return this.handBackRunsInFlight();
      },
    );
  }

  /*
   * Send a Queued run to the workers: a job on the AIInvestigation queue,
   * for a worker-role server to claim and run (processQueueJob). The job id
   * is the run's and the attempt count it is queued at, so sending a run
   * whose job is still there adds nothing (BullMQ keeps the job it has),
   * and a run requeued at a new count gets a new job. Never throws: a run
   * whose job could not be added stays Queued, and the poller sends it
   * again.
   */
  @CaptureSpan()
  public static async sendToWorkers(run: QueuedRunRef): Promise<void> {
    try {
      await Queue.addJob(
        QueueName.AIInvestigation,
        `${run.id.toString()}-${run.attemptCount || 0}`,
        RUN_JOB_NAME,
        this.toJobData(run),
        {
          skipExistenceCheck: true,
          removeWhenDone: true,
          priority: this.isBackgroundRun(run) ? BACKGROUND_RUN_JOB_PRIORITY : 0,
        },
      );
    } catch (error) {
      logger.error(
        `AI: could not send run ${run.id.toString()} to the workers; the poller sends it again: ${error}`,
      );
    }
  }

  /*
   * A worker's job: claim and run the run it names. A job that names no run
   * is dropped — there is nothing to claim.
   */
  @CaptureSpan()
  public static async processQueueJob(data: JSONObject): Promise<void> {
    const run: QueuedRunRef | null = this.fromJobData(data);

    if (!run) {
      logger.error(
        `AI: dropping an ${QueueName.AIInvestigation} job that names no run.`,
      );
      return;
    }

    await this.processRun(run);
  }

  /*
   * Claim a queued run and execute it to completion — what a worker does
   * with each job. Safe to call from multiple places concurrently — the
   * claim is one conditional UPDATE, so exactly one caller wins. Leaves the
   * run Queued (for the poller / TTL) when a concurrency cap the project set
   * is full, the budget is exhausted, or this server is shutting down.
   */
  @CaptureSpan()
  public static async processRun(run: QueuedRunRef): Promise<void> {
    try {
      // A server shutting down starts nothing: another one takes the run.
      if (this.isHandingBack) {
        return;
      }

      if (!(await this.passesClaimGates(run))) {
        return;
      }

      const attempt: number | null = await this.claim(run);

      if (attempt === null) {
        return;
      }

      const runInFlight: RunInFlight = { ...run, attempt };

      /*
       * Won as the server began shutting down: straight back to the queue.
       * Nothing ran yet, so even a remediation execution goes back.
       */
      if (this.isHandingBack) {
        await this.handBack(runInFlight);
        return;
      }

      const runKey: string = run.id.toString();

      this.runsInFlight.set(runKey, runInFlight);

      try {
        await this.dispatch(run, attempt);
      } finally {
        if (this.runsInFlight.get(runKey) === runInFlight) {
          this.runsInFlight.delete(runKey);
        }
      }
    } catch (error) {
      logger.error(
        `AI: failed to process queued run ${run.id.toString()}: ${error}`,
      );
    }
  }

  /*
   * When this server shuts down (startWorker registers it): hand every run
   * it is executing back to the queue, so another server picks it up within
   * seconds instead of after the stale sweep's twelve minutes. From then on
   * this server claims nothing (processRun).
   */
  public static async handBackRunsInFlight(): Promise<void> {
    this.isHandingBack = true;

    await Promise.all(
      Array.from(this.runsInFlight.values())
        /*
         * A remediation execution stays, for the stale sweep to requeue and
         * its interrupted-execution check to settle: its commands change
         * things and are not fenced by the attempt, so this server's
         * execution could start one after another server took the run.
         */
        .filter((run: RunInFlight): boolean => {
          return run.runType !== AIRunType.RemediationExecution;
        })
        .map((run: RunInFlight): Promise<void> => {
          return this.handBack(run);
        }),
    );
  }

  // Tests only: forget the runs in flight and any shutdown hand-back.
  public static resetForTests(): void {
    this.runsInFlight.clear();
    this.isHandingBack = false;
  }

  /*
   * One poller tick: expire runs that queued past their usefulness window,
   * then send the oldest of the rest to the workers again — a run whose job
   * is still there is not added twice (sendToWorkers). Called every minute
   * from Workers; the recovery path for a job that could not be added, a
   * run a cap or the budget held back, and a requeued attempt.
   */
  @CaptureSpan()
  public static async processQueuedRuns(): Promise<void> {
    const expiryThreshold: Date =
      OneUptimeDate.getSomeMinutesAgo(QUEUE_TTL_MINUTES);

    const expiredRuns: Array<AIRun> = await AIRunService.findBy({
      query: {
        runType: QueryHelper.any([
          AIRunType.Investigation,
          AIRunType.RemediationPlan,
          AIRunType.RemediationExecution,
        ]),
        status: AIRunStatus.Queued,
        createdAt: QueryHelper.lessThan(expiryThreshold),
      },
      select: {
        _id: true,
        projectId: true,
        runType: true,
        triggeredByIncidentId: true,
        triggeredByAlertId: true,
        followUpForAlertId: true,
        ruleWaitMinutes: true,
      },
      limit: 100,
      skip: 0,
      props: { isRoot: true },
    });

    for (const expired of expiredRuns) {
      const expiredCount: number = await AIRunService.attemptStatusTransition({
        aiRunId: expired.id!,
        fromStatus: AIRunStatus.Queued,
        set: {
          status: AIRunStatus.Cancelled,
          codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
          completedAt: OneUptimeDate.getCurrentDate(),
          errorMessage: `Expired in the investigation queue after ${QUEUE_TTL_MINUTES} minutes — a first-pass analysis this late would no longer be useful. The project may have been at a concurrency cap or daily token limit it set.`,
        },
      });

      /*
       * An expired incident/alert investigation is terminally settled —
       * release the subject to auto-remediation (RCA-first ordering must
       * not swallow remediation when the RCA never ran). Guarded on the
       * WON transition so a run claimed between the query and this
       * transition is settled by its executor instead.
       */
      if (expiredCount > 0) {
        await this.handOffSettledInvestigationToRemediation({
          runType: expired.runType,
          projectId: expired.projectId,
          triggeredByIncidentId: expired.triggeredByIncidentId,
          triggeredByAlertId: expired.triggeredByAlertId,
          followUpForAlertId: expired.followUpForAlertId,
          ruleWaitMinutes: expired.ruleWaitMinutes,
        });
      }
    }

    const queuedRuns: Array<AIRun> = await AIRunService.findBy({
      query: {
        runType: QueryHelper.any([
          AIRunType.Investigation,
          AIRunType.RemediationPlan,
          AIRunType.RemediationExecution,
        ]),
        status: AIRunStatus.Queued,
      },
      select: {
        _id: true,
        projectId: true,
        attemptCount: true,
        handedBackCount: true,
        runType: true,
        triggeredByIncidentId: true,
        triggeredByAlertId: true,
        triggeredByAiInsightId: true,
        triggeredByAutoRemediationSuggestionId: true,
        followUpForAlertId: true,
        ruleWaitMinutes: true,
      },
      sort: { createdAt: SortOrder.Ascending },
      limit: POLLER_BATCH_SIZE,
      skip: 0,
      props: { isRoot: true },
    });

    for (const queued of queuedRuns) {
      await this.sendToWorkers({
        id: queued.id!,
        projectId: queued.projectId!,
        attemptCount: queued.attemptCount || 0,
        handedBackCount: queued.handedBackCount || 0,
        runType: queued.runType,
        triggeredByIncidentId: queued.triggeredByIncidentId,
        triggeredByAlertId: queued.triggeredByAlertId,
        triggeredByAiInsightId: queued.triggeredByAiInsightId,
        triggeredByAutoRemediationSuggestionId:
          queued.triggeredByAutoRemediationSuggestionId,
        followUpForAlertId: queued.followUpForAlertId,
        ruleWaitMinutes: queued.ruleWaitMinutes,
      });
    }
  }

  /*
   * Finalize a failed attempt: requeue transient failures while attempts
   * remain, otherwise mark the run Error. The transition guards on Running
   * so a run that already completed (e.g. only postAnalysis failed) is
   * never clobbered or re-run.
   *
   * Returns what actually happened, so callers can settle post-terminal
   * work (the remediation hand-off) exactly once: "requeued" — a later
   * attempt owns the run now; "finalized" — THIS call moved the run to
   * Error, the run is settled; "noop" — another actor moved the run first
   * (that actor owns settlement).
   */
  @CaptureSpan()
  public static async failOrRequeue(data: {
    aiRunId: ObjectID;
    attemptCount: number;
    errorMessage: string;
    isPermanent: boolean;
  }): Promise<"requeued" | "finalized" | "noop"> {
    const truncatedMessage: string = data.errorMessage.substring(0, 400);

    // A claim a server shutting down handed back is not a failed attempt.
    const countedAttempts: number =
      data.attemptCount - this.getHandedBackCount(data);

    if (!data.isPermanent && countedAttempts < MAX_INVESTIGATION_ATTEMPTS) {
      const requeued: number = await AIRunService.attemptStatusTransition({
        aiRunId: data.aiRunId,
        fromStatus: AIRunStatus.Running,
        expectedAttemptCount: data.attemptCount,
        set: {
          status: AIRunStatus.Queued,
          codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
          errorMessage: `Attempt ${data.attemptCount} failed and the run was requeued: ${truncatedMessage}`,
        },
      });

      if (requeued > 0) {
        logger.debug(
          `AI: requeued run ${data.aiRunId.toString()} after attempt ${data.attemptCount} failed.`,
        );
        return "requeued";
      }
      return "noop";
    }

    const finalized: number = await AIRunService.attemptStatusTransition({
      aiRunId: data.aiRunId,
      fromStatus: AIRunStatus.Running,
      expectedAttemptCount: data.attemptCount,
      set: {
        status: AIRunStatus.Error,
        codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
        completedAt: OneUptimeDate.getCurrentDate(),
        errorMessage: truncatedMessage,
      },
    });

    return finalized > 0 ? "finalized" : "noop";
  }

  /*
   * Called by the stale-run sweeper for an Investigation run whose
   * heartbeat went silent (the pod running it died). Requeues while
   * attempts remain; otherwise marks it Stale as before.
   *
   * The optional subject fields let the sweeper hand a terminally-staled
   * incident/alert investigation to auto-remediation: remediation is
   * deferred until the investigation settles (RCA-first ordering), so a
   * run that dies without retries left must still release the subject to
   * the rule engine — otherwise a dead investigation would silently
   * swallow remediation for that incident/alert.
   */
  @CaptureSpan()
  public static async requeueOrMarkStale(run: {
    id: ObjectID;
    attemptCount: number;
    // The claims a server shutting down handed back, which do not count.
    handedBackCount?: number | undefined;
    lastHeartbeatAt?: Date | undefined;
    runType?: AIRunType | undefined;
    projectId?: ObjectID | undefined;
    triggeredByIncidentId?: ObjectID | undefined;
    triggeredByAlertId?: ObjectID | undefined;
    followUpForAlertId?: ObjectID | undefined;
    ruleWaitMinutes?: number | undefined;
  }): Promise<"requeued" | "stale" | "noop"> {
    if (
      (run.attemptCount || 0) - (run.handedBackCount || 0) <
      MAX_INVESTIGATION_ATTEMPTS
    ) {
      const requeued: number = await AIRunService.attemptStatusTransition({
        aiRunId: run.id,
        fromStatus: AIRunStatus.Running,
        expectedAttemptCount: run.attemptCount,
        expectedLastHeartbeatAt: run.lastHeartbeatAt,
        set: {
          status: AIRunStatus.Queued,
          codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
          errorMessage: `Attempt ${run.attemptCount} stopped reporting progress (the server processing it may have restarted) and the run was requeued.`,
        },
      });

      if (requeued > 0) {
        return "requeued";
      }
    }

    const staled: number = await AIRunService.attemptStatusTransition({
      aiRunId: run.id,
      fromStatus: AIRunStatus.Running,
      expectedAttemptCount: run.attemptCount,
      expectedLastHeartbeatAt: run.lastHeartbeatAt,
      set: {
        status: AIRunStatus.Stale,
        codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
        completedAt: OneUptimeDate.getCurrentDate(),
        errorMessage:
          "The run stopped reporting progress and was marked as stale after exhausting its retry attempts. The server processing it may have restarted.",
      },
    });

    /*
     * Only the actor that WON the terminal transition may settle — a lost
     * transition means the run moved on and another actor owns settlement.
     */
    if (staled > 0) {
      await this.handOffSettledInvestigationToRemediation(run);
      return "stale";
    }

    return "noop";
  }

  /*
   * Hand one run this server claimed back to the queue: Queued again at the
   * attempt count its claim gave it, and sent to the workers. That count is
   * a fence: this server's execution goes on until the process exits, but it
   * can no longer heartbeat, complete or fail the run — each of those is
   * guarded on Running at its attempt — and the next claim moves the count
   * on. handedBackCount records the hand-back, so failOrRequeue and
   * requeueOrMarkStale do not count the claim as a failed attempt.
   *
   * A run already handed back MAX_INVESTIGATION_HAND_BACKS times stays with
   * the server, for the stale sweep to requeue. Never throws.
   */
  private static async handBack(run: RunInFlight): Promise<void> {
    const handedBackCount: number = run.handedBackCount || 0;

    if (handedBackCount >= MAX_INVESTIGATION_HAND_BACKS) {
      logger.warn(
        `AI: not handing run ${run.id.toString()} back — it was handed back ${handedBackCount} times already; the stale sweep requeues it.`,
      );
      return;
    }

    try {
      const handedBack: number = await AIRunService.attemptStatusTransition({
        aiRunId: run.id,
        fromStatus: AIRunStatus.Running,
        expectedAttemptCount: run.attempt,
        set: {
          status: AIRunStatus.Queued,
          handedBackCount: handedBackCount + 1,
          codeFixRecommendation: AIRunCodeFixRecommendation.NotRecommended,
          errorMessage: `Attempt ${run.attempt} was handed back to the queue because the server running it shut down.`,
        },
      });

      // The run moved on first (it completed, or failed): nothing to hand back.
      if (handedBack === 0) {
        return;
      }

      await this.sendToWorkers({
        ...run,
        attemptCount: run.attempt,
        handedBackCount: handedBackCount + 1,
      });
    } catch (error) {
      logger.error(
        `AI: could not hand run ${run.id.toString()} back; the stale sweep requeues it: ${error}`,
      );
    }
  }

  /*
   * How many times a run that is failing here was handed back. The attempt
   * fails in the server executing it, whose claim read the count with the
   * attempt count, and a hand-back — the one change to the count — takes the
   * run off Running first, so the claim's count is still the run's. 0 for an
   * attempt this server is not executing.
   */
  private static getHandedBackCount(data: {
    aiRunId: ObjectID;
    attemptCount: number;
  }): number {
    const run: RunInFlight | undefined = this.runsInFlight.get(
      data.aiRunId.toString(),
    );

    if (!run || run.attempt !== data.attemptCount) {
      return 0;
    }

    return run.handedBackCount || 0;
  }

  /*
   * Background work — insight triage, remediation plans and remediation
   * executions — is storm-shaped, and nobody is waiting for it. Incident and
   * alert RCAs are the work a paged human waits for.
   */
  private static isBackgroundRun(run: QueuedRunRef): boolean {
    return (
      Boolean(run.triggeredByAiInsightId) ||
      run.runType === AIRunType.RemediationPlan ||
      run.runType === AIRunType.RemediationExecution
    );
  }

  /*
   * A run as its job carries it: plain JSON, ids as strings. projectId,
   * incidentId and alertId are names the worker's telemetry context reads,
   * so the job's spans and logs carry them.
   */
  private static toJobData(run: QueuedRunRef): JSONObject {
    return {
      aiRunId: run.id.toString(),
      projectId: run.projectId.toString(),
      attemptCount: run.attemptCount || 0,
      handedBackCount: run.handedBackCount || 0,
      runType: run.runType || null,
      incidentId: run.triggeredByIncidentId?.toString() || null,
      alertId: run.triggeredByAlertId?.toString() || null,
      aiInsightId: run.triggeredByAiInsightId?.toString() || null,
      autoRemediationSuggestionId:
        run.triggeredByAutoRemediationSuggestionId?.toString() || null,
      followUpForAlertId: run.followUpForAlertId?.toString() || null,
      ruleWaitMinutes: run.ruleWaitMinutes || null,
    };
  }

  // The run a job names (toJobData), or null when it names none.
  private static fromJobData(data: JSONObject): QueuedRunRef | null {
    const readId: (key: string) => ObjectID | undefined = (
      key: string,
    ): ObjectID | undefined => {
      const value: unknown = data[key];
      return typeof value === "string" && value
        ? new ObjectID(value)
        : undefined;
    };

    const readCount: (key: string) => number = (key: string): number => {
      const value: unknown = data[key];
      return typeof value === "number" && value > 0 ? value : 0;
    };

    const id: ObjectID | undefined = readId("aiRunId");
    const projectId: ObjectID | undefined = readId("projectId");

    if (!id || !projectId) {
      return null;
    }

    const runType: unknown = data["runType"];
    const ruleWaitMinutes: number = readCount("ruleWaitMinutes");

    return {
      id,
      projectId,
      attemptCount: readCount("attemptCount"),
      handedBackCount: readCount("handedBackCount"),
      runType: Object.values(AIRunType).includes(runType as AIRunType)
        ? (runType as AIRunType)
        : undefined,
      triggeredByIncidentId: readId("incidentId"),
      triggeredByAlertId: readId("alertId"),
      triggeredByAiInsightId: readId("aiInsightId"),
      triggeredByAutoRemediationSuggestionId: readId(
        "autoRemediationSuggestionId",
      ),
      followUpForAlertId: readId("followUpForAlertId"),
      ruleWaitMinutes: ruleWaitMinutes > 0 ? ruleWaitMinutes : undefined,
    };
  }

  /*
   * Release a terminally-settled incident/alert investigation to the
   * auto-remediation rule engine (the RCA-first ordering's terminal
   * fallback for runs that expired or went stale — the happy path hands
   * off from the engine via InvestigationRequest.onSettled). Only fires
   * for Investigation runs with an incident/alert subject; remediation
   * runs and insight triage never hand off. Never throws.
   *
   * An incident's follow-up check never hands off either: its first
   * investigation already released the incident's remediation when it
   * settled, and a second release would run the rules again. Nor does a
   * run an investigation rule made wait (ruleWaitMinutes): its subject's
   * rules ran when it was created, since nothing was queued then.
   */
  private static async handOffSettledInvestigationToRemediation(run: {
    runType?: AIRunType | undefined;
    projectId?: ObjectID | undefined;
    triggeredByIncidentId?: ObjectID | undefined;
    triggeredByAlertId?: ObjectID | undefined;
    followUpForAlertId?: ObjectID | undefined;
    ruleWaitMinutes?: number | undefined;
  }): Promise<void> {
    if (run.runType !== AIRunType.Investigation) {
      return;
    }

    if (run.followUpForAlertId) {
      return;
    }

    if (run.ruleWaitMinutes && run.ruleWaitMinutes > 0) {
      return;
    }

    if (
      !run.projectId ||
      (!run.triggeredByIncidentId && !run.triggeredByAlertId)
    ) {
      return;
    }

    try {
      /*
       * Lazy require: RemediationHandoff imports the rule engine, which
       * imports this queue — a top-level import here would be circular at
       * module-init time (same pattern as the runner dispatch below).
       */
      const remediationHandoff: typeof import("./RemediationHandoff").default =
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        require("./RemediationHandoff").default;

      await remediationHandoff.runForSettledInvestigation({
        projectId: run.projectId,
        incidentId: run.triggeredByIncidentId,
        alertId: run.triggeredByAlertId,
      });
    } catch (error) {
      logger.error(
        `AI: remediation hand-off after a settled investigation failed: ${error}`,
      );
    }
  }

  /*
   * The claim-time cost gates: the concurrency cap and the preventive-lane
   * sub-cap (only when the lane has a cap), then the lane's daily budget and
   * the project's own daily AI limits. A run failing these stays Queued —
   * the poller retries and the TTL expires what never fits. Fails cheap
   * (skip) on gate errors.
   */
  private static async passesClaimGates(run: QueuedRunRef): Promise<boolean> {
    if (run.triggeredByIncidentId && run.triggeredByAlertId) {
      logger.error(
        `AI: leaving run ${run.id.toString()} queued — a run cannot belong to both an incident and an alert.`,
      );
      return false;
    }

    /*
     * Each subject lane owns its own concurrency pool. Insight triage and any
     * future subjectless queue work have no setting, so no cap.
     */
    let configuredConcurrencyCap: number | undefined = undefined;

    if (run.triggeredByIncidentId || run.triggeredByAlertId) {
      const project: Project | null = await ProjectService.findOneById({
        id: run.projectId,
        select: run.triggeredByIncidentId
          ? { incidentAiMaxConcurrentInvestigations: true }
          : { alertAiMaxConcurrentInvestigations: true },
        props: { isRoot: true },
      });

      configuredConcurrencyCap = run.triggeredByIncidentId
        ? project?.incidentAiMaxConcurrentInvestigations
        : project?.alertAiMaxConcurrentInvestigations;
    }

    const concurrencyCap: number | null =
      AIWorkloadLimits.getMaxConcurrentInvestigations(configuredConcurrencyCap);

    // No cap, nothing to count: the run is only held back by the budget.
    if (
      concurrencyCap !== null &&
      !(await this.hasFreeSlot(run, concurrencyCap))
    ) {
      return false;
    }

    const budget: AutonomousBudgetStatus =
      await AIService.getAutonomousDailyBudgetStatus(run.projectId, {
        incidentId: run.triggeredByIncidentId,
        alertId: run.triggeredByAlertId,
      });

    if (budget.exhausted) {
      logger.debug(
        `AI: leaving run ${run.id.toString()} queued — daily autonomous token budget exhausted.`,
      );
      return false;
    }

    // The project's own daily AI limits, over every lane (see enqueue).
    if (
      await AIService.getReachedProjectDailyLimit({ projectId: run.projectId })
    ) {
      logger.debug(
        `AI: leaving run ${run.id.toString()} queued — the project has reached its own daily AI limit.`,
      );
      return false;
    }

    return true;
  }

  /*
   * Whether the run's lane has a slot free under the cap the project set for
   * it, including the background lane's share of that cap.
   */
  private static async hasFreeSlot(
    run: QueuedRunRef,
    concurrencyCap: number,
  ): Promise<boolean> {
    const subjectLaneQuery: Query<AIRun> = this.getSubjectLaneQuery(run);

    /*
     * Investigations, remediation plans and remediation executions share
     * the cap inside their incident, alert or subjectless lane. Work in one
     * lane never consumes another lane's concurrency slots.
     */
    const runningCount: number = (
      await AIRunService.countBy({
        query: {
          projectId: run.projectId,
          runType: QueryHelper.any([
            AIRunType.Investigation,
            AIRunType.RemediationPlan,
            AIRunType.RemediationExecution,
          ]),
          status: AIRunStatus.Running,
          ...subjectLaneQuery,
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
     * The background lane's sub-cap: insight triage AND remediation plans
     * may never occupy the slot(s) reserved for incident/alert RCA (see
     * INSIGHT_TRIAGE_RESERVED_SLOTS) — the RCA is what a paged human is
     * waiting for, and both background kinds are storm-shaped. The two
     * kinds share ONE combined sub-cap, so together they always leave the
     * reserved slot reachable. Floored at 1 so a project running at the
     * minimum cap of 1 still drains its background work (slower, one at a
     * time) instead of deadlocking the lane entirely — foreground work keeps
     * its priority through the lane cap check above, which a single running
     * background run cannot outlast for long (both kinds are read-only and
     * short).
     */
    if (this.isBackgroundRun(run)) {
      const backgroundCap: number = Math.max(
        1,
        concurrencyCap - INSIGHT_TRIAGE_RESERVED_SLOTS,
      );

      /*
       * Triage runs are Investigations with an insight subject; plan runs
       * are their own runType — the two counts never overlap.
       */
      const runningTriageCount: number = (
        await AIRunService.countBy({
          query: {
            projectId: run.projectId,
            runType: AIRunType.Investigation,
            status: AIRunStatus.Running,
            triggeredByAiInsightId: QueryHelper.notNull(),
            ...subjectLaneQuery,
          },
          props: { isRoot: true },
        })
      ).toNumber();

      const runningPlanCount: number = (
        await AIRunService.countBy({
          query: {
            projectId: run.projectId,
            runType: QueryHelper.any([
              AIRunType.RemediationPlan,
              AIRunType.RemediationExecution,
            ]),
            status: AIRunStatus.Running,
            ...subjectLaneQuery,
          },
          props: { isRoot: true },
        })
      ).toNumber();

      const runningBackgroundCount: number =
        runningTriageCount + runningPlanCount;

      if (runningBackgroundCount >= backgroundCap) {
        logger.debug(
          `AI: leaving background run ${run.id.toString()} queued — ${runningBackgroundCount} background runs (triage + remediation plans) already running (background lane cap: ${backgroundCap} of ${concurrencyCap}).`,
        );
        return false;
      }
    }

    return true;
  }

  /*
   * Scope queue counts to one independent lane. The concrete subject id is
   * deliberately not compared: all incidents share the incident cap, all
   * alerts share the alert cap, and subjectless work must have neither link.
   */
  private static getSubjectLaneQuery(run: {
    triggeredByIncidentId?: ObjectID | undefined;
    triggeredByAlertId?: ObjectID | undefined;
  }): Query<AIRun> {
    if (run.triggeredByIncidentId) {
      return {
        triggeredByIncidentId: QueryHelper.notNull(),
        triggeredByAlertId: QueryHelper.isNull(),
      };
    }

    if (run.triggeredByAlertId) {
      return {
        triggeredByIncidentId: QueryHelper.isNull(),
        triggeredByAlertId: QueryHelper.notNull(),
      };
    }

    return {
      triggeredByIncidentId: QueryHelper.isNull(),
      triggeredByAlertId: QueryHelper.isNull(),
    };
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
    /*
     * RemediationPlan runs also carry triggeredByIncidentId/AlertId (for
     * dashboard linkage), so the runType discriminator MUST come before the
     * subject-column routing below — otherwise a plan run would be executed
     * as an RCA investigation.
     */
    if (run.runType === AIRunType.RemediationPlan) {
      if (!run.triggeredByAutoRemediationSuggestionId) {
        await AIRunService.attemptStatusTransition({
          aiRunId: run.id,
          fromStatus: AIRunStatus.Running,
          expectedAttemptCount: attempt,
          set: {
            status: AIRunStatus.Error,
            completedAt: OneUptimeDate.getCurrentDate(),
            errorMessage:
              "Queued remediation plan has no suggestion to plan for.",
          },
        });
        return;
      }

      const remediationPlanRunner: typeof import("../Remediation/RemediationPlanRunner").default =
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        require("../Remediation/RemediationPlanRunner").default;

      await remediationPlanRunner.executePlan({
        aiRunId: run.id,
        projectId: run.projectId,
        suggestionId: run.triggeredByAutoRemediationSuggestionId,
        attemptCount: attempt,
      });
      return;
    }

    if (run.runType === AIRunType.RemediationExecution) {
      if (!run.triggeredByAutoRemediationSuggestionId) {
        await AIRunService.attemptStatusTransition({
          aiRunId: run.id,
          fromStatus: AIRunStatus.Running,
          expectedAttemptCount: attempt,
          set: {
            status: AIRunStatus.Error,
            completedAt: OneUptimeDate.getCurrentDate(),
            errorMessage:
              "Queued remediation execution has no suggestion to work on.",
          },
        });
        return;
      }

      const remediationExecutionRunner: typeof import("../Remediation/RemediationExecutionRunner").default =
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        require("../Remediation/RemediationExecutionRunner").default;

      await remediationExecutionRunner.executeRemediation({
        aiRunId: run.id,
        projectId: run.projectId,
        suggestionId: run.triggeredByAutoRemediationSuggestionId,
        attemptCount: attempt,
      });
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
        ...(run.followUpForAlertId
          ? { followUpForAlertId: run.followUpForAlertId }
          : {}),
        ...(run.ruleWaitMinutes
          ? { ruleWaitMinutes: run.ruleWaitMinutes }
          : {}),
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
        ...(run.ruleWaitMinutes
          ? { ruleWaitMinutes: run.ruleWaitMinutes }
          : {}),
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
      expectedAttemptCount: attempt,
      set: {
        status: AIRunStatus.Error,
        completedAt: OneUptimeDate.getCurrentDate(),
        errorMessage: "Queued investigation has no subject to investigate.",
      },
    });
  }
}
