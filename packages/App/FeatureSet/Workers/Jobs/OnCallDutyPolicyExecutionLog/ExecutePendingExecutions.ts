import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  ON_CALL_POLICY_ARCHIVED_EXECUTION_STOPPED_MESSAGE,
  ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE,
} from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyArchive";
import {
  getOnCallPolicyRunRecordHandledMessage,
  getOnCallPolicyRunRecordResolvedMessage,
} from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import { isOnCallPageEndedOnlyByAnAnswer } from "Common/Types/OnCallDutyPolicy/OnCallAcknowledgePage";
import { isOnCallObserverPage } from "Common/Types/OnCallDutyPolicy/OnCallObserverPage";
import { isOnCallTestPage } from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import OnCallTestPageRuns from "Common/Server/Utils/OnCall/OnCallTestPageRuns";
import ObjectID from "Common/Types/ObjectID";
import {
  getOnCallPolicyRunEndedWhileWaitingMessage,
  isOnCallPolicyRunWaitOver,
} from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import {
  getOnCallEscalationDueAt,
  getOnCallEscalationWaitInMinutes,
  getOnCallEscalationWaitStartedAt,
  isOnCallEscalationWaitOver,
} from "Common/Types/OnCallDutyPolicy/OnCallEscalationWait";
import { OnCallPolicyAiHoldOutcome } from "Common/Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import AiFirstResponder from "Common/Server/Utils/AI/FirstResponder/AiFirstResponder";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import logger from "Common/Server/Utils/Logger";
import OnCallEscalationAdvance from "Common/Server/Utils/OnCall/OnCallEscalationAdvance";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import { isOnCallDirectPage } from "Common/Types/OnCallDutyPolicy/OnCallDirectPage";
import OnCallRecordStates, {
  OnCallStateCache,
} from "Common/Server/Utils/OnCall/OnCallRecordStates";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import Select from "Common/Server/Types/Database/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OnCallAcknowledgementTimeout from "Common/Server/Utils/OnCall/OnCallAcknowledgementTimeout";
import OnCallPolicyRunRetries from "Common/Server/Utils/OnCall/OnCallPolicyRunRetries";
import OnCallLevelsInFlight, {
  OnCallLevelInFlight,
} from "Common/Server/Utils/OnCall/OnCallLevelsInFlight";
import OnCallMoveOnsInFlight, {
  OnCallMoveOnInFlight,
} from "Common/Server/Utils/OnCall/OnCallMoveOnsInFlight";
import OnCallRunFailure, {
  OnCallRunFailureKind,
} from "Common/Server/Utils/OnCall/OnCallRunFailure";
import {
  addOnCallPolicyRunFailure,
  getOnCallPolicyRunOutOfTriesMessage,
  hasOnCallPolicyRunRunOutOfTries,
  isOnCallPolicyRunRetryDue,
  ON_CALL_POLICY_RUN_MAX_TRIES,
  OnCallPolicyRunFailures,
  toOnCallPolicyRunStatusMessage,
} from "Common/Types/OnCallDutyPolicy/OnCallPolicyRunRetry";
import {
  forEachKeysetPage,
  forEachWithConcurrency,
} from "../../Utils/BatchedWork";

/*
 * How many runs a page of the worker reads, and how many of them are worked
 * on at once.
 */
export const POLICY_RUN_PAGE_SIZE: number = 100;
export const POLICY_RUN_CONCURRENCY: number = 8;

// What the worker reads of each run still going.
export const POLICY_RUN_SELECT: Select<OnCallDutyPolicyExecutionLog> = {
  _id: true,
  projectId: true,
  status: true,
  pagingStartsAt: true,
  onCallDutyPolicyId: true,
  lastEscalationRuleExecutedAt: true,
  lastExecutedEscalationRuleId: true,
  lastExecutedEscalationRuleOrder: true,
  executeNextEscalationRuleInMinutes: true,
  userNotificationEventType: true,
  triggeredByIncidentId: true,
  triggeredByAlertId: true,
  triggeredByAlertEpisodeId: true,
  triggeredByIncidentEpisodeId: true,
  createdAt: true,
  // A page again ends when its record is resolved, not acknowledged.
  pageAgainNumber: true,
  /*
   * So do a page a person asked for (OnCallPersonPage) and a policy a
   * person started by hand (OnCallPolicyStartedByHand), told apart by who
   * started them, with the policy and the event type above.
   */
  triggeredByUserId: true,
  triggeredByWorkflowId: true,
  // And an observer's page (OnCallObserverPage).
  isObserverPage: true,
  // A run OneUptime AI holds says how its hold ended.
  aiHoldOutcome: true,
  // A test page (OnCallTestPage) walks every level, or waits.
  testPageWalksEscalation: true,
  onCallDutyPolicy: {
    repeatPolicyIfNoOneAcknowledges: true,
    repeatPolicyIfNoOneAcknowledgesNoOfTimes: true,
    isArchived: true,
  },
  onCallPolicyExecutionRepeatCount: true,
};

/*
 * Every run still going, every minute: the ones paging, and the ones waiting
 * to page (OnCallDutyPolicyRunWait), which start - or end, unpaged - here.
 *
 * A page of runs at a time, in _id order (forEachKeysetPage), and a few
 * runs of the page at a time (forEachWithConcurrency). Where each page's
 * records stand - acknowledged, resolved - is read for the whole page at
 * once (OnCallRecordStates): one query per kind of record and one per list
 * of states, where each run used to read its record and its project's
 * states for itself. A run with nothing to do this minute - its record not
 * handled, its wait not over - is decided from what was read, and costs no
 * query of its own. The worker used to read every run, then start the work
 * of all of them at the same moment: in an alert storm, thousands of
 * queries at once on a pool of fifty connections.
 *
 * It stops between pages, and between runs, at its deadline: a run it did
 * not reach is still going, and the next minute's run gets to it.
 */
export const executePendingPolicyRuns: (
  deadline?: JobDeadline,
) => Promise<void> = async (
  deadline: JobDeadline = JobDeadline.none(),
): Promise<void> => {
  // Each project's states, read once for the whole run.
  const stateCache: OnCallStateCache = new OnCallStateCache();

  await forEachKeysetPage<OnCallDutyPolicyExecutionLog>({
    jobName: "OnCallDutyPolicyExecutionLog:ExecutePendingExecutions",
    pageSize: POLICY_RUN_PAGE_SIZE,
    deadline: deadline,
    readPage: (
      afterId: ObjectID | null,
    ): Promise<Array<OnCallDutyPolicyExecutionLog>> => {
      return OnCallDutyPolicyExecutionLogService.findBy({
        query: {
          status: QueryHelper.any([
            OnCallDutyPolicyStatus.Executing,
            OnCallDutyPolicyStatus.Waiting,
          ]),
          ...(afterId ? { _id: QueryHelper.greaterThan(afterId) } : {}),
        },
        select: POLICY_RUN_SELECT,
        sort: {
          _id: SortOrder.Ascending,
        },
        skip: 0,
        limit: POLICY_RUN_PAGE_SIZE,
        props: {
          isRoot: true,
        },
      });
    },
    getId: (run: OnCallDutyPolicyExecutionLog): ObjectID | null => {
      return run.id;
    },
    onPage: async (
      runs: Array<OnCallDutyPolicyExecutionLog>,
    ): Promise<void> => {
      let recordStates: OnCallRecordStates;

      try {
        recordStates = await OnCallRecordStates.read({
          /*
           * An archived policy's run ends without reading its record, and a
           * test page has none.
           */
          rows: runs.filter((run: OnCallDutyPolicyExecutionLog): boolean => {
            return (
              run.onCallDutyPolicy?.isArchived !== true &&
              !isOnCallTestPage(run)
            );
          }),
          cache: stateCache,
        });
      } catch (err) {
        /*
         * The page's runs go on as they are and are read again next minute:
         * a read that failed says nothing about any run, so none is ended
         * in error for it.
         */
        logger.error(
          "OnCallDutyPolicyExecutionLog:ExecutePendingExecutions: could not read where a page of runs' records stand; the page waits for the next run.",
        );
        logger.error(err);
        return;
      }

      /*
       * The page's runs whose last try failed, and how (OnCallPolicyRunRetry):
       * one read for the page. A run with none - nearly every run - is
       * worked on as it always was.
       */
      const failures: Map<string, OnCallPolicyRunFailures> =
        await OnCallPolicyRunRetries.read(
          runs.map((run: OnCallDutyPolicyExecutionLog): ObjectID | null => {
            return run.id;
          }),
        );

      /*
       * The page's runs with an escalation level still in flight - maybe one
       * whose paging stopped part way (OnCallLevelsInFlight, issue #8406):
       * one read for the page.
       */
      const levelsInFlight: Map<string, OnCallLevelInFlight> =
        await OnCallLevelsInFlight.read(
          runs.map((run: OnCallDutyPolicyExecutionLog): ObjectID | null => {
            return run.id;
          }),
        );

      /*
       * And the page's runs with a move on still in flight - maybe one whose
       * process stopped after its claim (OnCallMoveOnsInFlight, issue #8410).
       */
      const moveOnsInFlight: Map<string, OnCallMoveOnInFlight> =
        await OnCallMoveOnsInFlight.read(
          runs.map((run: OnCallDutyPolicyExecutionLog): ObjectID | null => {
            return run.id;
          }),
        );

      await forEachWithConcurrency<OnCallDutyPolicyExecutionLog>({
        items: runs,
        concurrency: POLICY_RUN_CONCURRENCY,
        deadline: deadline,
        work: (executionLog: OnCallDutyPolicyExecutionLog): Promise<void> => {
          return workOnRun(
            executionLog,
            recordStates,
            failures.get(executionLog.id?.toString() || "") || null,
            levelsInFlight.get(executionLog.id?.toString() || "") || null,
            moveOnsInFlight.get(executionLog.id?.toString() || "") || null,
          );
        },
      });
    },
  });
};

RunCron(
  "OnCallDutyPolicyExecutionLog:ExecutePendingExecutions",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  executePendingPolicyRuns,
);

/*
 * ONE RUN, ONE MINUTE: what it needs done this minute - start or end a run
 * that waits to page (startOrEndWaitingRun), end or move on one that pages
 * (executeOnCallPolicy) - and what a step of it that fails means
 * (issue #8167).
 *
 * The step used to end the run in Error on any error, and Error is final:
 * one connection reset as a run moved on, and its later escalation rules
 * were never paged. Now (OnCallRunFailure, OnCallPolicyRunRetry):
 *
 *   - a failure a retry cannot fix - the record is gone, the data is bad -
 *     ends the run in Error at once, with the error's words, as before;
 *   - any other failure - the database, the network, the queue, or
 *     something not recognised - leaves the run as it is, and the step is
 *     tried again after a minute, two, four, then every five; a run whose
 *     step failed ON_CALL_POLICY_RUN_MAX_TRIES tries in a row ends in Error,
 *     saying how long it was tried and what the last try failed with.
 *
 * A step tried again pages nobody twice: moving a run on and starting a
 * run that waited are each claimed with one atomic UPDATE
 * (OnCallEscalationAdvance, startWaitingRun). A run that waits out its next
 * try is not worked on, and costs nothing more this minute.
 */
type WorkOnRunFunction = (
  executionLog: OnCallDutyPolicyExecutionLog,
  recordStates: OnCallRecordStates,
  failures: OnCallPolicyRunFailures | null,
  // Its escalation level in flight, if it has one (OnCallLevelsInFlight).
  levelInFlight?: OnCallLevelInFlight | null,
  // Its move on in flight, if it has one (OnCallMoveOnsInFlight).
  moveOnInFlight?: OnCallMoveOnInFlight | null,
) => Promise<void>;

const workOnRun: WorkOnRunFunction = async (
  executionLog: OnCallDutyPolicyExecutionLog,
  recordStates: OnCallRecordStates,
  failures: OnCallPolicyRunFailures | null,
  levelInFlight?: OnCallLevelInFlight | null,
  moveOnInFlight?: OnCallMoveOnInFlight | null,
): Promise<void> => {
  const now: Date = OneUptimeDate.getCurrentDate();

  if (!isOnCallPolicyRunRetryDue({ failures: failures, now: now })) {
    logger.debug(
      `On-call execution log ${executionLog.id?.toString()} waits until ${failures?.retryAt.toISOString()} to try again after ${failures?.failedTries} failed tries.`,
    );
    return;
  }

  try {
    if (executionLog.status === OnCallDutyPolicyStatus.Waiting) {
      await startOrEndWaitingRun(executionLog, recordStates);
    } else {
      await executeOnCallPolicy(
        executionLog,
        recordStates,
        levelInFlight || null,
        moveOnInFlight || null,
      );
    }
  } catch (err) {
    await onRunStepFailed({
      executionLog: executionLog,
      error: err,
      failures: failures,
      failedAt: now,
    });

    return;
  }

  // It went on: its failed tries are over.
  if (failures) {
    logger.info(
      `On-call execution log ${executionLog.id?.toString()} went on after ${failures.failedTries} failed ${failures.failedTries === 1 ? "try" : "tries"}.`,
    );

    await OnCallPolicyRunRetries.forget(executionLog.id);
  }
};

interface RunStepFailure {
  executionLog: OnCallDutyPolicyExecutionLog;
  error: unknown;
  // Its tries in a row that failed before this one.
  failures: OnCallPolicyRunFailures | null;
  failedAt: Date;
}

// A step of a run failed: the run ends, or waits for its next try (workOnRun).
const onRunStepFailed: (data: RunStepFailure) => Promise<void> = async (
  data: RunStepFailure,
): Promise<void> => {
  const executionLog: OnCallDutyPolicyExecutionLog = data.executionLog;
  const runId: string = executionLog.id?.toString() || "";
  const kind: OnCallRunFailureKind = OnCallRunFailure.classify(data.error);
  const error: string = OnCallRunFailure.describe(data.error);

  if (kind === OnCallRunFailureKind.Permanent) {
    logger.error(
      `On-call execution log ${runId} failed for a reason a retry cannot fix, and ends in Error: ${error}`,
    );
    logger.error(data.error as Error);

    await endRunInError(
      executionLog,
      (data.error as Error | null)?.message ||
        "Error occurred while executing the on-call policy.",
    );

    if (data.failures) {
      await OnCallPolicyRunRetries.forget(executionLog.id);
    }

    return;
  }

  const failures: OnCallPolicyRunFailures = addOnCallPolicyRunFailure({
    previous: data.failures,
    failedAt: data.failedAt,
    error: error,
  });

  if (hasOnCallPolicyRunRunOutOfTries(failures)) {
    logger.error(
      `On-call execution log ${runId} failed ${failures.failedTries} tries in a row, and ends in Error: ${error}`,
    );
    logger.error(data.error as Error);

    await endRunInError(
      executionLog,
      getOnCallPolicyRunOutOfTriesMessage({
        failures: failures,
        wasWaiting: executionLog.status === OnCallDutyPolicyStatus.Waiting,
        recordKind:
          OnCallAcknowledgementTimeout.getRunRecord(executionLog)?.kind,
      }),
    );
    await OnCallPolicyRunRetries.forget(executionLog.id);

    return;
  }

  const tryAgain: string = `On-call execution log ${runId}: try ${failures.failedTries} of ${ON_CALL_POLICY_RUN_MAX_TRIES} failed, and it is tried again at ${failures.retryAt.toISOString()}: ${error}`;

  // A blip of the database or the network is expected now and then; anything else is looked at.
  if (kind === OnCallRunFailureKind.Transient) {
    logger.warn(tryAgain);
  } else {
    logger.error(tryAgain);
    logger.error(data.error as Error);
  }

  await OnCallPolicyRunRetries.remember(executionLog.id, failures);
};

// Ends a run in Error, saying why, in as many words as its status message holds.
const endRunInError: (
  executionLog: OnCallDutyPolicyExecutionLog,
  statusMessage: string,
) => Promise<void> = async (
  executionLog: OnCallDutyPolicyExecutionLog,
  statusMessage: string,
): Promise<void> => {
  await OnCallDutyPolicyExecutionLogService.updateOneById({
    id: executionLog.id!,
    data: {
      status: OnCallDutyPolicyStatus.Error,
      statusMessage: toOnCallPolicyRunStatusMessage(statusMessage),
    },
    props: {
      isRoot: true,
    },
  });
};

/*
 * Whether a run ends only when one of its people answers it or its record is
 * resolved - not when somebody else acknowledges the record: a page again
 * (OnCallAcknowledgementTimeout), a page a person asked for
 * (OnCallPersonPage), a policy a person started by hand
 * (OnCallPolicyStartedByHand) and an observer's page (OnCallObserverPage),
 * by the one rule (isOnCallPageEndedOnlyByAnAnswer).
 */
const endsWhenAnsweredOrResolved: (
  executionLog: OnCallDutyPolicyExecutionLog,
) => boolean = (executionLog: OnCallDutyPolicyExecutionLog): boolean => {
  return isOnCallPageEndedOnlyByAnAnswer(executionLog);
};

type ExecuteOnCallPolicyFunction = (
  executionLog: OnCallDutyPolicyExecutionLog,
  recordStates: OnCallRecordStates,
  levelInFlight?: OnCallLevelInFlight | null,
  moveOnInFlight?: OnCallMoveOnInFlight | null,
) => Promise<void>;

// What a run that pages needs this minute. What a failure means is workOnRun's.
const executeOnCallPolicy: ExecuteOnCallPolicyFunction = async (
  executionLog: OnCallDutyPolicyExecutionLog,
  recordStates: OnCallRecordStates,
  levelInFlight?: OnCallLevelInFlight | null,
  moveOnInFlight?: OnCallMoveOnInFlight | null,
): Promise<void> => {
  logger.debug(`Executing on-call policy execution log: ${executionLog.id}`);

  /*
   * The policy was archived while this execution was escalating: an
   * archived policy pages no one, so it stops here. Whoever the earlier
   * rules already paged was paged; nobody else is.
   */
  if (executionLog.onCallDutyPolicy?.isArchived === true) {
    await OnCallDutyPolicyExecutionLogService.updateOneById({
      id: executionLog.id!,
      data: {
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage: ON_CALL_POLICY_ARCHIVED_EXECUTION_STOPPED_MESSAGE,
      },
      props: {
        isRoot: true,
      },
    });

    return;
  }

  /*
   * A test page (OnCallTestPage) has no record to read: it ends once its
   * answer window is over, and a test that walks a policy's every level
   * moves on after a test's short wait (OnCallTestPageRuns).
   */
  if (isOnCallTestPage(executionLog)) {
    await OnCallTestPageRuns.tick({
      run: executionLog,
      now: OneUptimeDate.getCurrentDate(),
    });

    return;
  }

  /*
   * A page again (OnCallAcknowledgementTimeout) pages about a record that
   * was acknowledged all along: it is over once the record is resolved.
   * Somebody acknowledging the page again itself ends it where they do
   * (UserOnCallLogTimelineService).
   *
   * A page a person asked for from Slack or Microsoft Teams
   * (OnCallPersonPage) ends the same way: they asked for these people,
   * and somebody else acknowledging the record - often before they paged
   * at all - does not mean any of them has seen it. So does a policy a
   * person started by hand (OnCallPolicyStartedByHand): started on a
   * record somebody had acknowledged already, it used to end here within
   * a minute, its first level's first notifications all it ever sent.
   *
   * So does an observer's page (OnCallObserverPage): it keeps people
   * informed about a record its responders are on, so the responders
   * acknowledging it ends nothing. One of its people answering it does.
   */
  if (endsWhenAnsweredOrResolved(executionLog)) {
    const resolvedRecordKind: string | null =
      await recordStates.getResolvedRecordKind(executionLog);

    if (resolvedRecordKind) {
      await OnCallDutyPolicyExecutionLogService.updateOneById({
        id: executionLog.id!,
        data: {
          status: OnCallDutyPolicyStatus.Completed,
          statusMessage:
            getOnCallPolicyRunRecordResolvedMessage(resolvedRecordKind),
        },
        props: {
          isRoot: true,
        },
      });

      return;
    }
  } else {
    /*
     * Its record was acknowledged or resolved: nobody else needs paging, so
     * the run is over.
     */
    const handledRecordKind: string | null =
      await recordStates.getHandledRecordKind(executionLog);

    if (handledRecordKind) {
      await OnCallDutyPolicyExecutionLogService.updateOneById({
        id: executionLog.id!,
        data: {
          status: OnCallDutyPolicyStatus.Completed,
          statusMessage:
            getOnCallPolicyRunRecordHandledMessage(handledRecordKind),
        },
        props: {
          isRoot: true,
        },
      });

      return;
    }
  }

  /*
   * A direct page - people, a team or a schedule paged with no on-call
   * policy behind the page - has no escalation rules to go through and
   * none to look up: with no policy to match on, the lookup below would
   * find another policy's rule. It paged everybody when it started, and
   * ends once their pages are over and it has waited for somebody to
   * acknowledge.
   */
  if (isOnCallDirectPage(executionLog)) {
    await OnCallDutyPolicyExecutionLogService.endDirectPageIfItsPagesAreOver({
      executionLogId: executionLog.id!,
      pagingStartedAt:
        executionLog.lastEscalationRuleExecutedAt || executionLog.createdAt,
    });

    return;
  }

  // check if this execution needs to be executed.

  const currentDate: Date = OneUptimeDate.getCurrentDate();

  /*
   * A move on whose process stopped after its claim, before its next rule
   * (issue #8410): its claim restarted the wait of the rule the run is on,
   * and the run would wait that whole wait again before it moved on. The
   * claim is given back, and the run moves on below, now.
   */
  if (moveOnInFlight) {
    await settleMoveOnInFlight({
      run: executionLog,
      moveOn: moveOnInFlight,
      now: currentDate,
    });
  }

  /*
   * The level it is on stopped paging part way - a database error, or a
   * process that stopped, in the middle of its people (issue #8406): the
   * people it did not get to are paged now, once, and the run waits out
   * the level's wait from when it started, as it would have.
   */
  if (
    levelInFlight &&
    (await resumeLevelInFlight({
      run: executionLog,
      level: levelInFlight,
      now: currentDate,
    }))
  ) {
    return;
  }

  logger.debug(
    `Current date: ${currentDate}, Last executed at: ${getOnCallEscalationWaitStartedAt(executionLog)}, Waiting for ${getOnCallEscalationWaitInMinutes(executionLog)} minutes.`,
  );

  // The rule's wait, as the one reading of it says (OnCallEscalationWait).
  if (!isOnCallEscalationWaitOver(executionLog, currentDate)) {
    logger.debug(
      `Execution not needed yet. Waiting for ${executionLog.executeNextEscalationRuleInMinutes} minutes.`,
    );
    return;
  }

  /*
   * The wait is over: the run moves on to its next escalation rule - or
   * starts again from its first, or ends - in the one way a run moves on
   * (OnCallEscalationAdvance), which a page passed on by the person being
   * paged uses too. The move is CLAIMED first, with a single atomic
   * conditional UPDATE, so two overlapping ticks (a tick exceeding the
   * 1-minute cadence, worker replicas) - or a tick and a pass landing
   * together - move the run on once and page the next rule once (audit
   * F13).
   *
   * What it pages was due when the wait ran out, and is timed from then
   * (notification.send.lag): a tick that came late shows.
   */
  await OnCallEscalationAdvance.advance({
    run: executionLog,
    now: currentDate,
    dueAt: getOnCallEscalationDueAt(executionLog),
  });

  return;
};

/*
 * Settles a run's move on in flight that never finished
 * (OnCallMoveOnsInFlight): left to it while it may still be under way;
 * then its claim is given back while the run is as the claim left it -
 * on `run`, as the worker read it, too, so the run moves on this minute -
 * and it is forgotten. One whose next rule started keeps its claim: some
 * of its people may be paged, and its level is resumed if it stopped
 * (OnCallLevelsInFlight). Throws as the database does, and the move on
 * stays in flight for the run's next try.
 */
const settleMoveOnInFlight: (data: {
  run: OnCallDutyPolicyExecutionLog;
  moveOn: OnCallMoveOnInFlight;
  now: Date;
}) => Promise<void> = async (data: {
  run: OnCallDutyPolicyExecutionLog;
  moveOn: OnCallMoveOnInFlight;
  now: Date;
}): Promise<void> => {
  if (!OnCallMoveOnsInFlight.isToGiveBack(data.moveOn, data.now)) {
    return;
  }

  const givenBack: boolean = await OnCallEscalationAdvance.giveBackMoveOnClaim({
    runId: data.run.id!,
    moveOn: data.moveOn,
  });

  await OnCallMoveOnsInFlight.forget(data.run.id);

  if (!givenBack) {
    return;
  }

  logger.warn(
    `On-call execution log ${data.run.id?.toString()}: its move on, claimed at ${data.moveOn.claimedAt.toISOString()}, never finished; its claim is given back, and it moves on now.`,
  );

  if (data.moveOn.previousLastEscalationRuleExecutedAt) {
    data.run.lastEscalationRuleExecutedAt =
      data.moveOn.previousLastEscalationRuleExecutedAt;
  } else {
    delete data.run.lastEscalationRuleExecutedAt;
  }

  // A level that reached nobody has no wait to wait out (issue #8515).
  if (data.moveOn.passesEmptyLevel) {
    data.run.executeNextEscalationRuleInMinutes = 0;
  }
};

/*
 * Resumes a run's level in flight that never finished paging
 * (OnCallLevelsInFlight): one that stopped, or shows no sign of life. One
 * still paging is left to it, and one of a rule the run is no longer on is
 * over, one way or another. Returns whether it was resumed; throws as
 * paging does, and the level is resumed at the run's next try.
 */
const resumeLevelInFlight: (data: {
  run: OnCallDutyPolicyExecutionLog;
  level: OnCallLevelInFlight;
  now: Date;
}) => Promise<boolean> = async (data: {
  run: OnCallDutyPolicyExecutionLog;
  level: OnCallLevelInFlight;
  now: Date;
}): Promise<boolean> => {
  const currentRuleId: string =
    data.run.lastExecutedEscalationRuleId?.toString().toLowerCase() || "";

  if (data.level.ruleId.toLowerCase() !== currentRuleId) {
    await OnCallLevelsInFlight.forget(data.run.id);
    return false;
  }

  if (!OnCallLevelsInFlight.isToResume(data.level, data.now)) {
    return false;
  }

  await OnCallEscalationAdvance.resumeLevel({
    run: data.run,
    level: data.level,
  });

  return true;
};

/*
 * A RUN THAT WAITS TO PAGE (OnCallDutyPolicyRunWait), each minute until it
 * pages or ends. It pages nobody while it waits; then, in this order:
 *
 * - its policy was archived: an archived policy pages no one, so it ends,
 *   having paged nobody, and says so;
 * - its record was acknowledged or resolved: nobody needs paging, so it
 *   ends, having paged nobody;
 * - its moment came: it pages its first escalation rule, and from then on
 *   is a run like any other (executeOnCallPolicy). Its page is timed from
 *   that moment, not from the tick that got to it, so a tick that came late
 *   shows in its time to send (OnCallPageTiming, issue #6708).
 *
 * A run OneUptime AI held (OnCallPolicyAiHold) says how its hold ended, in
 * the same claim: how its record came to be handled (classifyEndedHold), or
 * that its hold time ran out.
 *
 * Starting and ending are each claimed, so of two ticks or two worker
 * replicas that read the same waiting run, one acts and the other does
 * nothing (startWaitingRun, endWaitingRun). A start that fails after its
 * claim hands the run to its escalation, which pages what the start did
 * not (startWaitingRun). What a failure means for the run is workOnRun's.
 */
type StartOrEndWaitingRunFunction = (
  executionLog: OnCallDutyPolicyExecutionLog,
  recordStates: OnCallRecordStates,
) => Promise<void>;

const startOrEndWaitingRun: StartOrEndWaitingRunFunction = async (
  executionLog: OnCallDutyPolicyExecutionLog,
  recordStates: OnCallRecordStates,
): Promise<void> => {
  const isAiHeld: boolean =
    executionLog.aiHoldOutcome === OnCallPolicyAiHoldOutcome.Holding;

  if (executionLog.onCallDutyPolicy?.isArchived === true) {
    await OnCallDutyPolicyExecutionLogService.endWaitingRun({
      executionLogId: executionLog.id!,
      status: OnCallDutyPolicyStatus.Error,
      statusMessage: ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE,
      // Its hold ended with neither a page nor a resolve: it is no hold now.
      aiHoldOutcome: isAiHeld ? null : undefined,
    });

    return;
  }

  /*
   * An observer's page that waits (OnCallObserverPage) is still owed to its
   * people when the responders acknowledge the record: only a resolve ends
   * it unpaged.
   */
  const handledRecordKind: string | null = isOnCallObserverPage(executionLog)
    ? await recordStates.getResolvedRecordKind(executionLog)
    : await recordStates.getHandledRecordKind(executionLog);

  if (handledRecordKind) {
    await OnCallDutyPolicyExecutionLogService.endWaitingRun({
      executionLogId: executionLog.id!,
      status: OnCallDutyPolicyStatus.Completed,
      statusMessage:
        getOnCallPolicyRunEndedWhileWaitingMessage(handledRecordKind),
      aiHoldOutcome: isAiHeld
        ? await AiFirstResponder.classifyEndedHold(executionLog)
        : undefined,
    });

    return;
  }

  const now: Date = OneUptimeDate.getCurrentDate();

  /*
   * Not yet: it goes on waiting. Read as its page's start reads it
   * (getOnCallPolicyRunPagingDueAt, in startWaitingRun): a run started
   * late is timed from its moment, not from this tick.
   */
  if (
    !isOnCallPolicyRunWaitOver({
      pagingStartsAt: executionLog.pagingStartsAt,
      now: now,
    })
  ) {
    return;
  }

  await OnCallDutyPolicyExecutionLogService.startWaitingRun({
    run: executionLog,
    now: now,
    aiHoldOutcome: isAiHeld
      ? OnCallPolicyAiHoldOutcome.HoldTimeRanOut
      : undefined,
  });
};
