import RunbookExecutionService from "../../Services/RunbookExecutionService";
import RunbookService from "../../Services/RunbookService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import RunbookStarter, {
  RUNBOOK_START_SELECT,
  RunbookStartRefusal,
  RunbookStartResult,
} from "./RunbookStarter";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import RunbookExecution from "../../../Models/DatabaseModels/RunbookExecution";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import PartialEntity from "../../../Types/Database/PartialEntity";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import RunbookExecutionStatus from "../../../Types/Runbook/RunbookExecutionStatus";
import {
  DEFAULT_RUNBOOK_SCHEDULE_MISSED_RUN_POLICY,
  DEFAULT_RUNBOOK_SCHEDULE_OVERLAP_POLICY,
  DEFAULT_RUNBOOK_SCHEDULE_TIMEZONE,
  RUNBOOK_SCHEDULE_MISSED_RUN_GRACE_IN_MS,
  RunbookScheduleMissedRunPolicy,
  RunbookScheduleOverlapPolicy,
  getNextRunbookRun,
} from "../../../Types/Runbook/RunbookSchedule";
import RunbookTriggerType from "../../../Types/Runbook/RunbookTriggerType";

/*
 * STARTS THE RUNS A RUNBOOK'S SCHEDULE IS DUE FOR.
 *
 * A Worker job runs runDueSchedules once a minute (Workers/Jobs/Runbook/
 * StartScheduledRuns). Each runbook's next scheduled run is a column
 * (Runbook.scheduleNextRunAt), worked out when the schedule changes
 * (planNextRun, from RunbookService) and moved on by the pass that starts
 * the run. A pass:
 *
 *   1. works out the next run of a schedule that has none yet - one whose
 *      change was saved while planNextRun could not run;
 *   2. for every schedule whose next run has come, CLAIMS that time: a
 *      compare-and-set that moves the column from the time it read to the
 *      schedule's next time after now. Only one pass's write can land, so
 *      however many Workers run the job at once, each time starts at most
 *      one run. Then:
 *        - a time more than RUNBOOK_SCHEDULE_MISSED_RUN_GRACE_IN_MS old was
 *          missed (OneUptime was down): it starts a run when the schedule
 *          says RunOnce - one run, however many times were missed, since the
 *          claim moved the column past all of them - and nothing when it
 *          says Skip;
 *        - while a run of the runbook is still going (queued, running or
 *          waiting for someone - however it started), Skip starts nothing
 *          and RunAfter marks one run to wait (scheduleQueuedRunAt): never
 *          more than one;
 *        - otherwise the run starts, through the one start path
 *          (RunbookStarter), recorded as started by the Schedule with the
 *          time it was due;
 *   3. starts each waiting run whose runbook has no run going any more,
 *      claimed the same way (scheduleQueuedRunAt back to empty).
 *
 * A runbook or schedule that is turned off is not looked at, and turning
 * either back on works the next run out from that moment
 * (RunbookService): times that passed while it was off are not missed,
 * they are skipped.
 *
 * A start that fails before the run is written (the database, say) gives
 * the time back - the column moves back to it - so the next pass tries
 * again; a refusal (the runbook has no steps, the project is blocked) does
 * not, and the schedule goes on to its next time.
 */

// How many schedules one pass looks at in each step.
export const RUNBOOK_SCHEDULER_BATCH_SIZE: number = 200;

export enum RunbookScheduledTimeOutcome {
  Started = "Started",
  // Another Worker claimed the time first.
  AlreadyClaimed = "AlreadyClaimed",
  // Missed while OneUptime was down, and the schedule skips missed times.
  SkippedMissed = "SkippedMissed",
  // A run is still going, and the schedule skips the time.
  SkippedStillRunning = "SkippedStillRunning",
  // A run is still going; one run waits for it.
  Queued = "Queued",
  // A run is still going and one already waits.
  AlreadyQueued = "AlreadyQueued",
  // The start path refused it: no steps, project blocked, gone.
  Refused = "Refused",
  // The run was written but could not be queued; it was failed.
  NotQueued = "NotQueued",
  // The start failed before the run was written; the time was given back.
  Failed = "Failed",
}

export interface RunbookSchedulerPassResult {
  planned: number;
  outcomes: Array<{
    runbookId: string;
    dueAt: string;
    outcome: RunbookScheduledTimeOutcome;
  }>;
  startedFromQueue: number;
}

// What a pass reads of a runbook.
export const RUNBOOK_SCHEDULE_SELECT: {
  _id: true;
  projectId: true;
  name: true;
  steps: true;
  isEnabled: true;
  isScheduleEnabled: true;
  scheduleCron: true;
  scheduleTimezone: true;
  scheduleOverlapPolicy: true;
  scheduleMissedRunPolicy: true;
  scheduleNextRunAt: true;
  scheduleQueuedRunAt: true;
} = {
  ...RUNBOOK_START_SELECT,
  isScheduleEnabled: true,
  scheduleCron: true,
  scheduleTimezone: true,
  scheduleOverlapPolicy: true,
  scheduleMissedRunPolicy: true,
  scheduleNextRunAt: true,
  scheduleQueuedRunAt: true,
};

// The runs that keep a scheduled time from starting another.
export const ACTIVE_RUNBOOK_EXECUTION_STATUSES: ReadonlyArray<RunbookExecutionStatus> =
  [
    RunbookExecutionStatus.Scheduled,
    RunbookExecutionStatus.Running,
    RunbookExecutionStatus.WaitingForManualStep,
  ];

export class RunbookSchedulerClass {
  /*
   * When the runbook's schedule runs next after `after`, or null when it
   * does not run: turned off, the runbook turned off, no cron, or a cron or
   * time zone that is not valid (logged - the service refuses those, so
   * only a row written some other way holds one).
   */
  public static getNextRunAt(runbook: Runbook, after: Date): Date | null {
    if (
      runbook.isEnabled === false ||
      runbook.isScheduleEnabled !== true ||
      !runbook.scheduleCron
    ) {
      return null;
    }

    try {
      return getNextRunbookRun({
        cron: runbook.scheduleCron,
        timezone: runbook.scheduleTimezone || DEFAULT_RUNBOOK_SCHEDULE_TIMEZONE,
        after: after,
      });
    } catch (error) {
      logger.error(
        `RunbookScheduler: runbook ${runbook._id?.toString()} has a schedule that cannot be read (${(error as Error).message}); it does not run on it.`,
      );
      return null;
    }
  }

  public static getOverlapPolicy(
    runbook: Runbook,
  ): RunbookScheduleOverlapPolicy {
    return runbook.scheduleOverlapPolicy ===
      RunbookScheduleOverlapPolicy.RunAfter
      ? RunbookScheduleOverlapPolicy.RunAfter
      : DEFAULT_RUNBOOK_SCHEDULE_OVERLAP_POLICY;
  }

  public static getMissedRunPolicy(
    runbook: Runbook,
  ): RunbookScheduleMissedRunPolicy {
    return runbook.scheduleMissedRunPolicy ===
      RunbookScheduleMissedRunPolicy.Skip
      ? RunbookScheduleMissedRunPolicy.Skip
      : DEFAULT_RUNBOOK_SCHEDULE_MISSED_RUN_POLICY;
  }

  /*
   * Works the next run out for one runbook whose schedule just changed -
   * saved, turned on, or its runbook turned back on - from `now`. Written
   * only over an empty column (the change cleared it), so a pass that
   * already worked it out is left alone.
   */
  @CaptureSpan()
  public async planNextRun(data: {
    runbookId: ObjectID;
    now?: Date | undefined;
  }): Promise<Date | null> {
    const runbook: Runbook | null = await RunbookService.findOneById({
      id: data.runbookId,
      select: RUNBOOK_SCHEDULE_SELECT,
      props: { isRoot: true },
    });

    if (!runbook || runbook.scheduleNextRunAt) {
      return runbook?.scheduleNextRunAt || null;
    }

    const next: Date | null = RunbookSchedulerClass.getNextRunAt(
      runbook,
      data.now || OneUptimeDate.getCurrentDate(),
    );

    if (!next) {
      return null;
    }

    await RunbookService.compareAndSetColumnsByIdWithoutHooks({
      id: data.runbookId,
      data: { scheduleNextRunAt: next } as PartialEntity<Runbook>,
      expectedData: { scheduleNextRunAt: null } as PartialEntity<Runbook>,
    });

    return next;
  }

  // Whether a run of the runbook is queued, running or waiting for someone.
  public async hasActiveRun(runbookId: ObjectID): Promise<boolean> {
    const active: RunbookExecution | null =
      await RunbookExecutionService.findOneBy({
        query: {
          runbookId: runbookId,
          status: QueryHelper.any(
            ACTIVE_RUNBOOK_EXECUTION_STATUSES as Array<string>,
          ),
        },
        select: { _id: true },
        props: { isRoot: true },
      });

    return Boolean(active);
  }

  @CaptureSpan()
  public async runDueSchedules(
    now: Date = OneUptimeDate.getCurrentDate(),
  ): Promise<RunbookSchedulerPassResult> {
    const result: RunbookSchedulerPassResult = {
      planned: 0,
      outcomes: [],
      startedFromQueue: 0,
    };

    // 1. Schedules without a next run yet.
    const unplanned: Array<Runbook> = await RunbookService.findBy({
      query: {
        isScheduleEnabled: true,
        isEnabled: true,
        scheduleNextRunAt: QueryHelper.isNull(),
      },
      select: RUNBOOK_SCHEDULE_SELECT,
      limit: RUNBOOK_SCHEDULER_BATCH_SIZE,
      skip: 0,
      props: { isRoot: true },
    });

    for (const runbook of unplanned) {
      try {
        const next: Date | null = RunbookSchedulerClass.getNextRunAt(
          runbook,
          now,
        );

        if (
          next &&
          (await RunbookService.compareAndSetColumnsByIdWithoutHooks({
            id: new ObjectID(runbook._id!.toString()),
            data: { scheduleNextRunAt: next } as PartialEntity<Runbook>,
            expectedData: {
              scheduleNextRunAt: null,
            } as PartialEntity<Runbook>,
          }))
        ) {
          result.planned++;
        }
      } catch (error) {
        this.logError(
          runbook,
          "could not work its next scheduled run out",
          error,
        );
      }
    }

    // 2. Schedules whose next run has come, earliest first.
    const due: Array<Runbook> = await RunbookService.findBy({
      query: {
        isScheduleEnabled: true,
        isEnabled: true,
        scheduleNextRunAt: QueryHelper.lessThanEqualTo(now),
      },
      select: RUNBOOK_SCHEDULE_SELECT,
      sort: { scheduleNextRunAt: SortOrder.Ascending },
      limit: RUNBOOK_SCHEDULER_BATCH_SIZE,
      skip: 0,
      props: { isRoot: true },
    });

    for (const runbook of due) {
      try {
        const outcome: RunbookScheduledTimeOutcome = await this.runDueTime({
          runbook,
          now,
        });

        result.outcomes.push({
          runbookId: runbook._id!.toString(),
          dueAt: runbook.scheduleNextRunAt!.toISOString(),
          outcome,
        });
      } catch (error) {
        this.logError(runbook, "could not start its scheduled run", error);
      }
    }

    // 3. Runs waiting for the run before them to end.
    const waiting: Array<Runbook> = await RunbookService.findBy({
      query: {
        isScheduleEnabled: true,
        isEnabled: true,
        scheduleQueuedRunAt: QueryHelper.notNull(),
      },
      select: RUNBOOK_SCHEDULE_SELECT,
      limit: RUNBOOK_SCHEDULER_BATCH_SIZE,
      skip: 0,
      props: { isRoot: true },
    });

    for (const runbook of waiting) {
      try {
        if (await this.startWaitingRun(runbook)) {
          result.startedFromQueue++;
        }
      } catch (error) {
        this.logError(runbook, "could not start its waiting run", error);
      }
    }

    return result;
  }

  /*
   * One schedule whose next run has come: claim the time, then start a run
   * for it, skip it, or have one wait. See the top of this file.
   */
  @CaptureSpan()
  public async runDueTime(data: {
    runbook: Runbook;
    now: Date;
  }): Promise<RunbookScheduledTimeOutcome> {
    const runbook: Runbook = data.runbook;
    const runbookId: ObjectID = new ObjectID(runbook._id!.toString());
    const dueAt: Date = runbook.scheduleNextRunAt!;
    const next: Date | null = RunbookSchedulerClass.getNextRunAt(
      runbook,
      data.now,
    );

    const claimed: boolean =
      await RunbookService.compareAndSetColumnsByIdWithoutHooks({
        id: runbookId,
        data: { scheduleNextRunAt: next } as PartialEntity<Runbook>,
        expectedData: { scheduleNextRunAt: dueAt } as PartialEntity<Runbook>,
      });

    if (!claimed) {
      return RunbookScheduledTimeOutcome.AlreadyClaimed;
    }

    const isMissed: boolean =
      data.now.getTime() - dueAt.getTime() >
      RUNBOOK_SCHEDULE_MISSED_RUN_GRACE_IN_MS;

    if (
      isMissed &&
      RunbookSchedulerClass.getMissedRunPolicy(runbook) ===
        RunbookScheduleMissedRunPolicy.Skip
    ) {
      this.logInfo(
        runbook,
        `skipped the run due at ${dueAt.toISOString()}: OneUptime missed it, and the schedule skips missed runs`,
      );
      return RunbookScheduledTimeOutcome.SkippedMissed;
    }

    if (await this.hasActiveRun(runbookId)) {
      if (
        RunbookSchedulerClass.getOverlapPolicy(runbook) ===
        RunbookScheduleOverlapPolicy.RunAfter
      ) {
        const queued: boolean =
          await RunbookService.compareAndSetColumnsByIdWithoutHooks({
            id: runbookId,
            data: { scheduleQueuedRunAt: dueAt } as PartialEntity<Runbook>,
            expectedData: {
              scheduleQueuedRunAt: null,
            } as PartialEntity<Runbook>,
          });

        return queued
          ? RunbookScheduledTimeOutcome.Queued
          : RunbookScheduledTimeOutcome.AlreadyQueued;
      }

      this.logInfo(
        runbook,
        `skipped the run due at ${dueAt.toISOString()}: a run of it is still going`,
      );
      return RunbookScheduledTimeOutcome.SkippedStillRunning;
    }

    let started: RunbookStartResult;

    try {
      started = await RunbookStarter.start({
        projectId: runbook.projectId!,
        runbookId: runbookId,
        trigger: RunbookTriggerType.Schedule,
        triggerDetails: {
          scheduledFor: dueAt.toISOString(),
          ...(isMissed ? { isCatchUp: true } : {}),
        } as JSONObject,
        runbook: runbook,
      });
    } catch (error) {
      /*
       * Nothing was written: give the time back, so the next pass tries
       * again - unless something else moved the column meanwhile.
       */
      await RunbookService.compareAndSetColumnsByIdWithoutHooks({
        id: runbookId,
        data: { scheduleNextRunAt: dueAt } as PartialEntity<Runbook>,
        expectedData: { scheduleNextRunAt: next } as PartialEntity<Runbook>,
      });

      this.logError(
        runbook,
        `could not start the run due at ${dueAt.toISOString()}; the next pass tries again`,
        error,
      );

      return RunbookScheduledTimeOutcome.Failed;
    }

    return this.toOutcome(runbook, dueAt, started);
  }

  // A waiting run: started once no run of its runbook is going any more.
  @CaptureSpan()
  public async startWaitingRun(runbook: Runbook): Promise<boolean> {
    const runbookId: ObjectID = new ObjectID(runbook._id!.toString());
    const queuedFor: Date | undefined = runbook.scheduleQueuedRunAt;

    if (!queuedFor || (await this.hasActiveRun(runbookId))) {
      return false;
    }

    const claimed: boolean =
      await RunbookService.compareAndSetColumnsByIdWithoutHooks({
        id: runbookId,
        data: { scheduleQueuedRunAt: null } as PartialEntity<Runbook>,
        expectedData: {
          scheduleQueuedRunAt: queuedFor,
        } as PartialEntity<Runbook>,
      });

    if (!claimed) {
      return false;
    }

    const started: RunbookStartResult = await RunbookStarter.start({
      projectId: runbook.projectId!,
      runbookId: runbookId,
      trigger: RunbookTriggerType.Schedule,
      triggerDetails: {
        scheduledFor: queuedFor.toISOString(),
        waitedForPreviousRun: true,
      },
      runbook: runbook,
    });

    return (
      this.toOutcome(runbook, queuedFor, started) ===
      RunbookScheduledTimeOutcome.Started
    );
  }

  private toOutcome(
    runbook: Runbook,
    dueAt: Date,
    started: RunbookStartResult,
  ): RunbookScheduledTimeOutcome {
    if (started.isStarted) {
      return RunbookScheduledTimeOutcome.Started;
    }

    if (started.refusal === RunbookStartRefusal.NotQueued) {
      return RunbookScheduledTimeOutcome.NotQueued;
    }

    this.logInfo(
      runbook,
      `did not start the run due at ${dueAt.toISOString()}: ${started.refusal}`,
    );

    return RunbookScheduledTimeOutcome.Refused;
  }

  private logInfo(runbook: Runbook, message: string): void {
    logger.info(
      `RunbookScheduler: runbook ${runbook._id?.toString()} ${message}.`,
      {
        projectId: runbook.projectId?.toString(),
        runbookId: runbook._id?.toString(),
      } as LogAttributes,
    );
  }

  private logError(runbook: Runbook, message: string, error: unknown): void {
    logger.error(
      `RunbookScheduler: runbook ${runbook._id?.toString()} ${message}.`,
      {
        projectId: runbook.projectId?.toString(),
        runbookId: runbook._id?.toString(),
      } as LogAttributes,
    );
    logger.error(error);
  }
}

const RunbookScheduler: RunbookSchedulerClass = new RunbookSchedulerClass();

export default RunbookScheduler;
