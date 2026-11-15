import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import UserNotificationExecutionStatus from "Common/Types/UserNotification/UserNotificationExecutionStatus";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import UserOnCallLogService, {
  NO_LONGER_A_PROJECT_MEMBER_STATUS_MESSAGE,
} from "Common/Server/Services/UserOnCallLogService";
import logger from "Common/Server/Utils/Logger";
import ProjectMembership, {
  ProjectUserPair,
} from "Common/Server/Utils/TeamMember/ProjectMembership";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import UserOnCallLog from "Common/Models/DatabaseModels/UserOnCallLog";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import {
  getDueRuleExecution,
  isRuleFullyExecuted,
} from "Common/Types/NotificationRule/NotificationRepeat";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ObjectID from "Common/Types/ObjectID";
import { isOnCallPageEndedOnlyByAnAnswer } from "Common/Types/OnCallDutyPolicy/OnCallAcknowledgePage";
import { isOnCallTestPage } from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import {
  getOnCallPageRecordDeletedMessage,
  OnCallPageRecordGoneException,
} from "Common/Types/OnCallDutyPolicy/OnCallPageRecordGone";
import OnCallAcknowledgementTimeout, {
  OnCallTimeoutRecordKind,
} from "Common/Server/Utils/OnCall/OnCallAcknowledgementTimeout";
import { OnCallRulesTick } from "Common/Server/Utils/OnCall/OnCallSendLag";
import OnCallRecordStates, {
  OnCallRecordState,
  OnCallStateCache,
} from "Common/Server/Utils/OnCall/OnCallRecordStates";
import { UserOnCallLogRetries } from "Common/Server/Utils/OnCall/OnCallPolicyRunRetries";
import OnCallRuleClaimsInFlight, {
  OnCallRuleClaimInFlight,
} from "Common/Server/Utils/OnCall/OnCallRuleClaimsInFlight";
import OnCallRunFailure, {
  OnCallRunFailureKind,
} from "Common/Server/Utils/OnCall/OnCallRunFailure";
import {
  addOnCallPolicyRunFailure,
  getUserOnCallLogOutOfTriesMessage,
  hasOnCallPolicyRunRunOutOfTries,
  isOnCallPolicyRunRetryDue,
  ON_CALL_POLICY_RUN_MAX_TRIES,
  OnCallPolicyRunFailures,
  toOnCallPolicyRunStatusMessage,
} from "Common/Types/OnCallDutyPolicy/OnCallPolicyRunRetry";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Select from "Common/Server/Types/Database/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  forEachKeysetPage,
  forEachWithConcurrency,
} from "../../Utils/BatchedWork";

/*
 * How many logs a page of the worker reads, and how many of them are worked
 * on at once.
 */
export const USER_LOG_PAGE_SIZE: number = 100;
export const USER_LOG_CONCURRENCY: number = 8;

// What the worker reads of each log still paging.
export const USER_LOG_SELECT: Select<UserOnCallLog> = {
  _id: true,
  projectId: true,
  createdAt: true,
  executedNotificationRules: true,
  userId: true,
  userNotificationEventType: true,
  triggeredByIncidentId: true,
  triggeredByAlertId: true,
  triggeredByAlertEpisodeId: true,
  triggeredByIncidentEpisodeId: true,
  onCallDutyPolicyEscalationRuleId: true,
  onCallDutyPolicyExecutionLogTimelineId: true,
  onCallDutyPolicyExecutionLogId: true,
  onCallDutyPolicyId: true,
  onCallDutyScheduleId: true,
  userBelongsToTeamId: true,
  /*
   * A page again goes on until the run itself is acknowledged
   * (OnCallAcknowledgementTimeout): its record was acknowledged all along.
   * So do a page a person asked for (OnCallPersonPage) and a policy a person
   * started by hand (OnCallPolicyStartedByHand), told apart by who started
   * them, the policy and the event type that tells a test page apart, and an
   * observer's page (OnCallObserverPage).
   */
  onCallDutyPolicyExecutionLog: {
    pageAgainNumber: true,
    acknowledgedAt: true,
    onCallDutyPolicyId: true,
    triggeredByUserId: true,
    triggeredByWorkflowId: true,
    isObserverPage: true,
    userNotificationEventType: true,
  },
};

/*
 * Every log still paging, every minute.
 *
 * A page of logs at a time, in _id order (forEachKeysetPage), and a few logs
 * of the page at a time (forEachWithConcurrency). What every log of a page
 * needs to know is read for the page at once: whether each person is still a
 * member (ProjectMembership), where each record stands and its severity
 * (OnCallRecordStates), and each person's rules - once for all of a page's
 * logs that page the same person in the same project, for the same kind and
 * severity of record. Each log used to read its record, its record's state
 * and its rules for itself, and every log was started at the same moment.
 *
 * It stops between pages, and between logs, at its deadline: a log it did
 * not reach is still paging, and the next minute's run gets to it.
 */
export const executePendingUserOnCallLogs: (
  deadline?: JobDeadline,
) => Promise<void> = async (
  deadline: JobDeadline = JobDeadline.none(),
): Promise<void> => {
  // Each project's states, read once for the whole run.
  const stateCache: OnCallStateCache = new OnCallStateCache();

  // Whether each person is a member of each project, read once for the run.
  const membershipRead: ProjectMembershipRead = new ProjectMembershipRead();

  await forEachKeysetPage<UserOnCallLog>({
    jobName: "UserOnCallLog:ExecutePendingExecutions",
    pageSize: USER_LOG_PAGE_SIZE,
    deadline: deadline,
    readPage: (afterId: ObjectID | null): Promise<Array<UserOnCallLog>> => {
      return UserOnCallLogService.findBy({
        query: {
          status: UserNotificationExecutionStatus.Executing,
          ...(afterId ? { _id: QueryHelper.greaterThan(afterId) } : {}),
        },
        select: USER_LOG_SELECT,
        sort: {
          _id: SortOrder.Ascending,
        },
        skip: 0,
        limit: USER_LOG_PAGE_SIZE,
        props: {
          isRoot: true,
        },
      });
    },
    getId: (log: UserOnCallLog): ObjectID | null => {
      return log.id;
    },
    onPage: async (
      pendingNotificationLogs: Array<UserOnCallLog>,
    ): Promise<void> => {
      /*
       * A log keeps running its later rules ("call me after 10 minutes")
       * for as long as the incident is not acknowledged, so the person it
       * pages may have left the project since it started. Whether each one
       * is still a member is read once for the run (ProjectMembershipRead).
       *
       * If membership cannot be read, the page runs every log as it did
       * before this check rather than none of them: a page lost to a failed
       * read is worse than one more read next minute. That cannot reach
       * somebody who is not a member: the read of the rules a log runs
       * carries the membership condition itself.
       */
      let memberKeys: Set<string> | null = null;

      try {
        memberKeys = await membershipRead.getMemberKeys(
          pendingNotificationLogs
            .filter((log: UserOnCallLog): boolean => {
              return Boolean(log.projectId && log.userId);
            })
            .map((log: UserOnCallLog): ProjectUserPair => {
              return {
                projectId: log.projectId!,
                userId: log.userId!,
              };
            }),
        );
      } catch (err) {
        logger.error(
          "Could not read project membership for pending on-call logs; running them without the membership check.",
        );
        logger.error(err as Error);
      }

      let recordStates: OnCallRecordStates;

      try {
        // A test page has no record.
        recordStates = await OnCallRecordStates.read({
          rows: pendingNotificationLogs.filter((log: UserOnCallLog) => {
            return !isOnCallTestPage(log);
          }),
          cache: stateCache,
        });
      } catch (err) {
        /*
         * The page's logs go on paging and are read again next minute: a
         * read that failed says nothing about any of them.
         */
        logger.error(
          "UserOnCallLog:ExecutePendingExecutions: could not read where a page of logs' records stand; the page waits for the next run.",
        );
        logger.error(err);
        return;
      }

      // Each person's rules, read once for all the page's logs that share them.
      const rulesRead: NotificationRulesRead = new NotificationRulesRead();

      /*
       * The page's logs whose last try failed, and how (OnCallPolicyRunRetry,
       * issue #8408): one read for the page. A log with none - nearly every
       * log - is worked on as it always was.
       */
      const failures: Map<string, OnCallPolicyRunFailures> =
        await UserOnCallLogRetries.read(
          pendingNotificationLogs.map((log: UserOnCallLog): ObjectID | null => {
            return log.id;
          }),
        );

      /*
       * The page's logs with a rule's claim whose page never finished
       * (OnCallRuleClaimsInFlight, issue #8407): one read for the page.
       */
      const claimsInFlight: Map<string, OnCallRuleClaimInFlight> =
        await OnCallRuleClaimsInFlight.read(
          pendingNotificationLogs.map((log: UserOnCallLog): ObjectID | null => {
            return log.id;
          }),
        );

      await forEachWithConcurrency<UserOnCallLog>({
        items: pendingNotificationLogs,
        concurrency: USER_LOG_CONCURRENCY,
        deadline: deadline,
        work: (pendingNotificationLog: UserOnCallLog): Promise<void> => {
          return executePendingNotificationLog(
            pendingNotificationLog,
            {
              isProjectMember:
                memberKeys === null ||
                Boolean(
                  pendingNotificationLog.projectId &&
                    pendingNotificationLog.userId &&
                    memberKeys.has(
                      ProjectMembership.getKey(
                        pendingNotificationLog.projectId,
                        pendingNotificationLog.userId,
                      ),
                    ),
                ),
            },
            { recordStates, rulesRead, failures, claimsInFlight },
          );
        },
      });
    },
  });
};

RunCron(
  "UserOnCallLog:ExecutePendingExecutions",
  {
    schedule: IsDevelopment ? EVERY_MINUTE : EVERY_MINUTE,
    runOnStartup: false,
  },
  executePendingUserOnCallLogs,
);

/*
 * Whether each person a run's logs page is a member of the log's project
 * (ProjectMembership), read once for the run: one read for the people the
 * first page names, and one more only for a page that names somebody new.
 */
export class ProjectMembershipRead {
  private readonly isMember: Map<string, boolean> = new Map();

  public async getMemberKeys(
    pairs: Array<ProjectUserPair>,
  ): Promise<Set<string>> {
    const unread: Map<string, ProjectUserPair> = new Map();

    for (const pair of pairs) {
      const key: string = ProjectMembership.getKey(pair.projectId, pair.userId);

      if (!this.isMember.has(key)) {
        unread.set(key, pair);
      }
    }

    if (unread.size > 0) {
      const members: Set<string> = await ProjectMembership.getMemberKeys([
        ...unread.values(),
      ]);

      for (const key of unread.keys()) {
        this.isMember.set(key, members.has(key));
      }
    }

    const memberKeys: Set<string> = new Set();

    for (const pair of pairs) {
      const key: string = ProjectMembership.getKey(pair.projectId, pair.userId);

      if (this.isMember.get(key)) {
        memberKeys.add(key);
      }
    }

    return memberKeys;
  }
}

/*
 * The rules a page runs for a person (UserOnCallLogService
 * .getPagingRulesQuery), read once per person, project, kind and severity
 * of record for all of a page's logs that share them: in an alert storm one
 * person is paged by many logs at once, for records of the same severity.
 */
export class NotificationRulesRead {
  private readonly reads: Map<string, Promise<Array<UserNotificationRule>>> =
    new Map();

  public get(data: {
    userId: ObjectID;
    projectId: ObjectID;
    ruleType: NotificationRuleType;
    incidentSeverityId?: ObjectID | undefined;
    alertSeverityId?: ObjectID | undefined;
  }): Promise<Array<UserNotificationRule>> {
    const key: string = [
      data.userId.toString(),
      data.projectId.toString(),
      data.ruleType,
      data.incidentSeverityId?.toString() || "",
      data.alertSeverityId?.toString() || "",
    ].join("|");

    let read: Promise<Array<UserNotificationRule>> | undefined =
      this.reads.get(key);

    if (!read) {
      read = UserNotificationRuleService.findBy({
        query: UserOnCallLogService.getPagingRulesQuery({
          userId: data.userId,
          projectId: data.projectId,
          ruleType: data.ruleType,
          incidentSeverityId: data.incidentSeverityId,
          alertSeverityId: data.alertSeverityId,
        }),
        select: {
          _id: true,
          notifyAfterMinutes: true,
          // Whether the rule's push repeats until acknowledged.
          repeatEveryMinutes: true,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      });

      // A read that failed is read again by the next log that needs it.
      read.catch(() => {
        this.reads.delete(key);
      });

      this.reads.set(key, read);
    }

    return read;
  }
}

type ExecutePendingNotificationLogFunction = (
  pendingNotificationLog: UserOnCallLog,
  membership: {
    // Whether the person this log pages is a member of its project now.
    isProjectMember: boolean;
  },
  /*
   * What the log's page read for all its logs at once. A log run on its own
   * reads its records and rules for itself.
   */
  page?: {
    // Where the page's records stand, read for the page at once.
    recordStates: OnCallRecordStates;
    // The page's people's rules, each read once.
    rulesRead: NotificationRulesRead;
    // The page's logs' failed tries, by log (OnCallPolicyRunRetry).
    failures?: Map<string, OnCallPolicyRunFailures> | undefined;
    // The page's logs' rule claims whose page never finished (OnCallRuleClaimsInFlight).
    claimsInFlight?: Map<string, OnCallRuleClaimInFlight> | undefined;
  },
) => Promise<void>;

/*
 * ONE LOG, ONE MINUTE: its rules that are due, and what a failure of them
 * means (issue #8408).
 *
 * Only a failure a retry cannot fix (OnCallRunFailure: bad or missing data)
 * ends the log in Error at once: Error is final - no worker reads an Error
 * log again - and one transient DB blip (a connection reset, a pool
 * timeout) during a tick used to drop the person's rules not yet sent,
 * the loud last-resort "call at N minutes" among them (audit H3). Any
 * other failure leaves the log paging, and it is tried again after a
 * minute, two, four, then every five (OnCallPolicyRunRetry) - each try
 * safe, since every delivery already sent is in executedNotificationRules
 * and is not sent again. A log whose tries all fail - ten in a row, over
 * about 37 minutes, a bug most likely - ends in Error saying how long it
 * was tried and what the last try failed with, rather than failing every
 * minute, forever, as #8106 did. A record deleted as a rule was sent ends
 * the log Completed, saying so (issue #8168): nothing failed.
 */
const executePendingNotificationLog: ExecutePendingNotificationLogFunction =
  async (
    pendingNotificationLog: UserOnCallLog,
    membership: { isProjectMember: boolean },
    pageRead?: {
      recordStates: OnCallRecordStates;
      rulesRead: NotificationRulesRead;
      failures?: Map<string, OnCallPolicyRunFailures> | undefined;
      claimsInFlight?: Map<string, OnCallRuleClaimInFlight> | undefined;
    },
  ): Promise<void> => {
    // Its failed tries in a row: the page's read, or its own for a log run on its own.
    const failures: OnCallPolicyRunFailures | null = pageRead?.failures
      ? pageRead.failures.get(pendingNotificationLog.id?.toString() || "") ||
        null
      : (await UserOnCallLogRetries.read([pendingNotificationLog.id])).get(
          pendingNotificationLog.id?.toString() || "",
        ) || null;
    const now: Date = OneUptimeDate.getCurrentDate();

    if (!isOnCallPolicyRunRetryDue({ failures: failures, now: now })) {
      logger.debug(
        `On-call log ${pendingNotificationLog._id} waits until ${failures?.retryAt.toISOString()} to try again after ${failures?.failedTries} failed tries.`,
      );
      return;
    }

    try {
      /*
       * A rule's claim whose page never finished - its give-back failed, or
       * its process stopped before the send (issue #8407) - is settled
       * first: one that sent nothing is given back, and sent below.
       */
      const claimInFlight: OnCallRuleClaimInFlight | undefined = pageRead
        ? pageRead.claimsInFlight?.get(
            pendingNotificationLog.id?.toString() || "",
          )
        : (
            await OnCallRuleClaimsInFlight.read([pendingNotificationLog.id])
          ).get(pendingNotificationLog.id?.toString() || "");

      if (claimInFlight) {
        await UserOnCallLogService.settleRuleClaimInFlight({
          log: pendingNotificationLog,
          claim: claimInFlight,
          now: now,
        });
      }

      await runPendingNotificationLog(
        pendingNotificationLog,
        membership,
        pageRead,
      );
    } catch (err) {
      await onLogFailed({
        log: pendingNotificationLog,
        error: err,
        failures: failures,
        failedAt: now,
      });

      return;
    }

    // It went on: its failed tries are over.
    if (failures) {
      logger.info(
        `On-call log ${pendingNotificationLog._id} went on after ${failures.failedTries} failed ${failures.failedTries === 1 ? "try" : "tries"}.`,
      );

      await UserOnCallLogRetries.forget(pendingNotificationLog.id);
    }
  };

interface LogFailure {
  log: UserOnCallLog;
  error: unknown;
  // Its tries in a row that failed before this one.
  failures: OnCallPolicyRunFailures | null;
  failedAt: Date;
}

// A try of a log failed: it ends, or waits for its next try (executePendingNotificationLog).
const onLogFailed: (data: LogFailure) => Promise<void> = async (
  data: LogFailure,
): Promise<void> => {
  const log: UserOnCallLog = data.log;

  /*
   * A record deleted after this tick read where it stands is found gone by
   * the send (OnCallPageRecordGoneException): the page is over, as it is
   * for a log whose record the tick finds gone, and it ends with the same
   * words - Completed, not Error (issue #8168). Nothing failed.
   */
  if (data.error instanceof OnCallPageRecordGoneException) {
    logger.info(
      `On-call log ${log._id}: its ${data.error.recordKind} was deleted as a rule was sent; the page is over.`,
    );

    await UserOnCallLogService.updateOneById({
      id: log.id!,
      data: {
        status: UserNotificationExecutionStatus.Completed,
        statusMessage: getOnCallPageRecordDeletedMessage(data.error.recordKind),
      },
      props: {
        isRoot: true,
      },
    });

    if (data.failures) {
      await UserOnCallLogRetries.forget(log.id);
    }

    return;
  }

  const kind: OnCallRunFailureKind = OnCallRunFailure.classify(data.error);
  const error: string = OnCallRunFailure.describe(data.error);

  if (kind === OnCallRunFailureKind.Permanent) {
    logger.error(
      `On-call log ${log._id} failed for a reason a retry cannot fix, and ends in Error: ${error}`,
    );
    logger.error(data.error as Error);

    await endLogInError(
      log,
      (data.error as Error | null)?.message || "Unknown error",
    );

    if (data.failures) {
      await UserOnCallLogRetries.forget(log.id);
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
      `On-call log ${log._id} failed ${failures.failedTries} tries in a row, and ends in Error: ${error}`,
    );
    logger.error(data.error as Error);

    await endLogInError(
      log,
      getUserOnCallLogOutOfTriesMessage({
        failures: failures,
        recordKind: OnCallAcknowledgementTimeout.getRunRecord(log)?.kind,
      }),
    );
    await UserOnCallLogRetries.forget(log.id);

    return;
  }

  const tryAgain: string = `On-call log ${log._id}: try ${failures.failedTries} of ${ON_CALL_POLICY_RUN_MAX_TRIES} failed, and it is tried again at ${failures.retryAt.toISOString()}: ${error}`;

  // A blip of the database or the network is expected now and then; anything else is looked at.
  if (kind === OnCallRunFailureKind.Transient) {
    logger.warn(tryAgain);
  } else {
    logger.error(tryAgain);
    logger.error(data.error as Error);
  }

  await UserOnCallLogRetries.remember(log.id, failures);
};

// Ends a log in Error, saying why, in as many words as its status message holds.
const endLogInError: (
  log: UserOnCallLog,
  statusMessage: string,
) => Promise<void> = async (
  log: UserOnCallLog,
  statusMessage: string,
): Promise<void> => {
  await UserOnCallLogService.updateOneById({
    id: log.id!,
    data: {
      status: UserNotificationExecutionStatus.Error,
      statusMessage: toOnCallPolicyRunStatusMessage(statusMessage),
    },
    props: {
      isRoot: true,
    },
  });
};

// What a log needs this minute. What a failure means is executePendingNotificationLog's.
const runPendingNotificationLog: ExecutePendingNotificationLogFunction = async (
  pendingNotificationLog: UserOnCallLog,
  membership: { isProjectMember: boolean },
  pageRead?: {
    recordStates: OnCallRecordStates;
    rulesRead: NotificationRulesRead;
  },
): Promise<void> => {
  const page: {
    recordStates: OnCallRecordStates;
    rulesRead: NotificationRulesRead;
  } = pageRead || {
    recordStates: await OnCallRecordStates.read({
      rows: isOnCallTestPage(pendingNotificationLog)
        ? []
        : [pendingNotificationLog],
    }),
    rulesRead: new NotificationRulesRead(),
  };

  if (!membership.isProjectMember) {
    /*
     * Somebody who has left is not paged again on the project's behalf:
     * the log ends here and the rules still due for them are not run.
     */
    await UserOnCallLogService.updateOneById({
      id: pendingNotificationLog.id!,
      data: {
        status: UserNotificationExecutionStatus.Completed,
        statusMessage: NO_LONGER_A_PROJECT_MEMBER_STATUS_MESSAGE,
      },
      props: {
        isRoot: true,
      },
    });

    return;
  }

  /*
   * A test page (OnCallTestPage) runs every one of a person's rules at
   * once, as its log is written, and none of them repeats: there is
   * nothing left to send, and no record to read. A test log still
   * paging - its verified methods were paged for a severity with no
   * rule - is complete.
   */
  if (isOnCallTestPage(pendingNotificationLog)) {
    await UserOnCallLogService.updateOneById({
      id: pendingNotificationLog.id!,
      data: {
        status: UserNotificationExecutionStatus.Completed,
      },
      props: {
        isRoot: true,
      },
    });

    return;
  }

  const ruleType: NotificationRuleType =
    UserOnCallLogService.getNotificationRuleType(
      pendingNotificationLog.userNotificationEventType!,
    );

  /*
   * Its records, as the page read them (OnCallRecordStates): null for
   * one that is gone, as reading it on its own found nothing.
   */
  const incident: OnCallRecordState | null =
    pendingNotificationLog.triggeredByIncidentId
      ? await page.recordStates.readRecord(
          "incident",
          pendingNotificationLog.triggeredByIncidentId,
        )
      : null;

  const alert: OnCallRecordState | null =
    pendingNotificationLog.triggeredByAlertId
      ? await page.recordStates.readRecord(
          "alert",
          pendingNotificationLog.triggeredByAlertId,
        )
      : null;

  const alertEpisode: OnCallRecordState | null =
    pendingNotificationLog.triggeredByAlertEpisodeId
      ? await page.recordStates.readRecord(
          "alert episode",
          pendingNotificationLog.triggeredByAlertEpisodeId,
        )
      : null;

  const incidentEpisode: OnCallRecordState | null =
    pendingNotificationLog.triggeredByIncidentEpisodeId
      ? await page.recordStates.readRecord(
          "incident episode",
          pendingNotificationLog.triggeredByIncidentEpisodeId,
        )
      : null;

  /*
   * Every record it pages about is gone - deleted while some of the
   * person's rules were still due - or it names none: nothing is left
   * to page about, and that does not change with a retry. The log ends
   * here, saying so (OnCallPageRecordGone). It used to throw a plain
   * Error, which the catch below reads as transient: the log stayed
   * Executing and failed, and logged an error, every minute, forever
   * (issue #8106).
   */
  if (!incident && !alert && !alertEpisode && !incidentEpisode) {
    await UserOnCallLogService.updateOneById({
      id: pendingNotificationLog.id!,
      data: {
        status: UserNotificationExecutionStatus.Completed,
        statusMessage: getOnCallPageRecordDeletedMessage(
          OnCallAcknowledgementTimeout.getRunRecord(pendingNotificationLog)
            ?.kind,
        ),
      },
      props: {
        isRoot: true,
      },
    });

    return;
  }

  /*
   * A person's page in a page again (OnCallAcknowledgementTimeout) is
   * about a record that was acknowledged all along, so the record being
   * acknowledged ends nothing: the page goes on until somebody
   * acknowledges the page again, or the record is resolved.
   *
   * So does a page a person asked for from Slack or Microsoft Teams
   * (OnCallPersonPage): somebody else acknowledging the record does not
   * mean the people they paged have seen it - the record is often
   * acknowledged before they page at all. And so does a policy a person
   * started by hand (OnCallPolicyStartedByHand), for the same reason:
   * its people get every notification their On-Call Rules send until
   * one of them answers it.
   *
   * And so does an observer's page (OnCallObserverPage): the responders
   * acknowledging the record is no sign the observers have seen it.
   */
  const pageRun: OnCallDutyPolicyExecutionLog | undefined =
    pendingNotificationLog.onCallDutyPolicyExecutionLog;
  const endsWhenAnsweredOrResolved: boolean =
    isOnCallPageEndedOnlyByAnAnswer(pageRun);

  if (endsWhenAnsweredOrResolved) {
    const record: {
      kind: OnCallTimeoutRecordKind;
      recordId: ObjectID;
    } | null = OnCallAcknowledgementTimeout.getRunRecord(
      pendingNotificationLog,
    );

    const overReason: string | null = record
      ? await OnCallAcknowledgementTimeout.getPageAgainOverReason({
          run: pageRun!,
          kind: record.kind,
          recordId: record.recordId,
        })
      : null;

    if (overReason) {
      await UserOnCallLogService.updateOneById({
        id: pendingNotificationLog.id!,
        data: {
          status: UserNotificationExecutionStatus.Completed,
          statusMessage: `Execution completed because ${overReason}.`,
        },
        props: {
          isRoot: true,
        },
      });
      return;
    }
  }

  if (incident && !endsWhenAnsweredOrResolved) {
    // check if the incident is acknowledged.
    const isAcknowledged: boolean = await page.recordStates.isAcknowledged(
      "incident",
      pendingNotificationLog.triggeredByIncidentId!,
    );
    if (isAcknowledged) {
      // then mark this policy as executed.
      await UserOnCallLogService.updateOneById({
        id: pendingNotificationLog.id!,
        data: {
          status: UserNotificationExecutionStatus.Completed,
          statusMessage:
            "Execution completed because incident is acknowledged.",
        },
        props: {
          isRoot: true,
        },
      });
      return;
    }
  }

  if (alert && !endsWhenAnsweredOrResolved) {
    // check if the alert is acknowledged.
    const isAcknowledged: boolean = await page.recordStates.isAcknowledged(
      "alert",
      pendingNotificationLog.triggeredByAlertId!,
    );

    if (isAcknowledged) {
      // then mark this policy as executed.
      await UserOnCallLogService.updateOneById({
        id: pendingNotificationLog.id!,
        data: {
          status: UserNotificationExecutionStatus.Completed,
          statusMessage: "Execution completed because alert is acknowledged.",
        },
        props: {
          isRoot: true,
        },
      });
      return;
    }
  }

  if (alertEpisode && !endsWhenAnsweredOrResolved) {
    // check if the alert episode is acknowledged.
    const isAcknowledged: boolean = await page.recordStates.isAcknowledged(
      "alert episode",
      pendingNotificationLog.triggeredByAlertEpisodeId!,
    );

    if (isAcknowledged) {
      // then mark this policy as executed.
      await UserOnCallLogService.updateOneById({
        id: pendingNotificationLog.id!,
        data: {
          status: UserNotificationExecutionStatus.Completed,
          statusMessage:
            "Execution completed because alert episode is acknowledged.",
        },
        props: {
          isRoot: true,
        },
      });
      return;
    }
  }

  if (incidentEpisode && !endsWhenAnsweredOrResolved) {
    // check if the incident episode is acknowledged.
    const isAcknowledged: boolean = await page.recordStates.isAcknowledged(
      "incident episode",
      pendingNotificationLog.triggeredByIncidentEpisodeId!,
    );

    if (isAcknowledged) {
      // then mark this policy as executed.
      await UserOnCallLogService.updateOneById({
        id: pendingNotificationLog.id!,
        data: {
          status: UserNotificationExecutionStatus.Completed,
          statusMessage:
            "Execution completed because incident episode is acknowledged.",
        },
        props: {
          isRoot: true,
        },
      });
      return;
    }
  }

  /*
   * The rules a page runs for the person (UserOnCallLogService
   * .getPagingRulesQuery) - the same read a test page runs its rules
   * with, so a test reaches exactly what a real page reaches over time:
   *
   *   - the person's rules, and only while they are a member of the
   *     project: the condition rides on this read, so a log run without
   *     the tick's membership check (it could not be read) still
   *     reaches nobody who is not a member (ProjectMembership);
   *   - of the page's kind and severity;
   *   - opt-out rows left out. They carry exactly the columns this
   *     query filters on and no notification method at all, so without
   *     the predicate one would be selected here, handed to
   *     executeNotificationRuleItem, and "executed" - sending nothing
   *     while its timeline row reports a notification. It would also
   *     count as an outstanding rule for `isAllExecuted`, so the log
   *     stays Executing for an extra tick and burns its claim on a
   *     delivery that never happens. notOptOutRuleQuery is NULL-safe on
   *     purpose; isOptOut is nullable and is NULL on every rule written
   *     before the column existed, so a plain `false` would exclude
   *     every real rule and stop all escalation.
   */
  const notificationRules: Array<UserNotificationRule> =
    await page.rulesRead.get({
      userId: pendingNotificationLog.userId!,
      projectId: pendingNotificationLog.projectId!,
      ruleType: ruleType,
      incidentSeverityId:
        incident?.severityId || incidentEpisode?.severityId || undefined,
      alertSeverityId:
        alert?.severityId || alertEpisode?.severityId || undefined,
    });

  let isAllExecuted: boolean = true;

  const now: Date = OneUptimeDate.getCurrentDate();

  const minutesSinceExecutionStarted: number =
    OneUptimeDate.getDifferenceInMinutes(
      pendingNotificationLog.createdAt!,
      now,
    );

  /*
   * Every delivery already sent on this log: each rule's first push under
   * the rule's id, each repeat under a key of its own (NotificationRepeat).
   */
  const executedClaimKeys: Array<string> = Object.keys(
    pendingNotificationLog.executedNotificationRules! || {},
  );

  /*
   * Each delivery sent below is timed from when its rule's schedule
   * made it due (notification.send.lag, OnCallSendLag).
   */
  const rulesTick: OnCallRulesTick = new OnCallRulesTick({
    userOnCallLogId: pendingNotificationLog.id,
    logCreatedAt: pendingNotificationLog.createdAt,
    executedClaimKeys: executedClaimKeys,
    checkedAt: now,
  });

  for (const notificationRule of notificationRules) {
    const ruleId: string = notificationRule.id?.toString() || "";

    // Its first push, and every repeat it has, already sent.
    if (
      isRuleFullyExecuted({
        executedClaimKeys: executedClaimKeys,
        ruleId: ruleId,
        repeatEveryMinutes: notificationRule.repeatEveryMinutes,
      })
    ) {
      continue;
    }

    isAllExecuted = false;

    /*
     * The first push once it is due, then - for a rule that repeats until
     * acknowledged - the latest repeat due. Acknowledging ends the log
     * above, which is what stops the repeats.
     */
    const dueExecution: number | null = getDueRuleExecution({
      executedClaimKeys: executedClaimKeys,
      ruleId: ruleId,
      notifyAfterMinutes: notificationRule.notifyAfterMinutes || 0,
      repeatEveryMinutes: notificationRule.repeatEveryMinutes,
      minutesSinceStart: minutesSinceExecutionStarted,
    });

    if (dueExecution === null) {
      continue;
    }

    // execute this rule, as the scheduled send it is.

    await rulesTick.runSend(
      {
        ruleId: ruleId,
        notifyAfterMinutes: notificationRule.notifyAfterMinutes || 0,
        repeatEveryMinutes: notificationRule.repeatEveryMinutes,
        executionNumber: dueExecution,
      },
      (): Promise<void> => {
        return UserNotificationRuleService.executeNotificationRuleItem(
          notificationRule.id!,
          {
            userNotificationLogId: pendingNotificationLog.id!,
            projectId: pendingNotificationLog.projectId!,
            triggeredByIncidentId: pendingNotificationLog.triggeredByIncidentId,
            triggeredByAlertId: pendingNotificationLog.triggeredByAlertId,
            triggeredByAlertEpisodeId:
              pendingNotificationLog.triggeredByAlertEpisodeId,
            triggeredByIncidentEpisodeId:
              pendingNotificationLog.triggeredByIncidentEpisodeId,
            userNotificationEventType:
              pendingNotificationLog.userNotificationEventType!,
            onCallPolicyExecutionLogId:
              pendingNotificationLog.onCallDutyPolicyExecutionLogId,
            onCallPolicyId: pendingNotificationLog.onCallDutyPolicyId,
            onCallPolicyEscalationRuleId:
              pendingNotificationLog.onCallDutyPolicyEscalationRuleId,
            userBelongsToTeamId: pendingNotificationLog.userBelongsToTeamId,
            onCallDutyPolicyExecutionLogTimelineId:
              pendingNotificationLog.onCallDutyPolicyExecutionLogTimelineId,
            onCallScheduleId: pendingNotificationLog.onCallDutyScheduleId,
            ...(dueExecution > 0 ? { repeatNumber: dueExecution } : {}),
          },
        );
      },
    );
  }

  /*
   * Its rules were gone through: a delivery the next tick finds due that
   * this one did not came due in between - a rule added or changed, the
   * record's severity changed - and is timed from no earlier than now
   * (OnCallSendLag). A log that is done is not ticked again.
   */
  if (!isAllExecuted) {
    await rulesTick.finish();
  }

  if (isAllExecuted) {
    // mark this log as complete.
    await UserOnCallLogService.updateOneById({
      id: pendingNotificationLog.id!,
      data: {
        status: UserNotificationExecutionStatus.Completed,
      },
      props: {
        isRoot: true,
      },
    });
  }
};

export { executePendingNotificationLog };
