import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import {
  ON_CALL_DIRECT_PAGE_NEVER_STARTED_MESSAGE,
  ON_CALL_DIRECT_PAGE_TIMED_OUT_MESSAGE,
  isOnCallDirectPage,
} from "Common/Types/OnCallDutyPolicy/OnCallDirectPage";
import { isOnCallTestPage } from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import {
  ON_CALL_POLICY_RUN_NEVER_STARTED_MESSAGE,
  ON_CALL_POLICY_RUN_TIMED_OUT_MESSAGE,
} from "Common/Types/OnCallDutyPolicy/OnCallRunStart";

/*
 * What a run that cannot be handed over ends with, as it always did: kept
 * with the lines a run starts with (OnCallRunStart), where the on-call logs
 * read them back to word them in the reader's language (#8434).
 */
export {
  ON_CALL_POLICY_RUN_NEVER_STARTED_MESSAGE,
  ON_CALL_POLICY_RUN_TIMED_OUT_MESSAGE,
};

/**
 * Runs move from Scheduled to Started to Executing in seconds. One still
 * Scheduled or Started after 5 minutes did not finish starting.
 */

RunCron(
  "OnCallDutyPolicyExecutionLog:TimeoutStuckExecutions",
  {
    schedule: IsDevelopment ? EVERY_MINUTE : EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    // get all pending on-call executions and execute them all at once.
    const fiveMinsAgo: Date = OneUptimeDate.getSomeMinutesAgo(5);

    /*
     * A log sits in "Started" only for the brief moment between creation and the
     * first rule beginning to execute. If it is still "Started" after 5 minutes
     * it is genuinely stuck.
     *
     * We deliberately DO NOT time out "Executing" logs on wall-clock alone. An
     * Executing log is a live, in-progress escalation: ExecutePendingExecutions
     * advances it every minute and marks it Completed once the alert/incident is
     * acknowledged/resolved or all escalation rules and repeats are exhausted.
     * A policy with several rules and repeat cycles can legitimately stay
     * Executing for many hours; the previous 3-hour cutoff force-errored these
     * healthy escalations and silently dropped every remaining rule/repeat,
     * meaning later responders were never paged for an unacknowledged incident.
     */
    const startedExecutions: Array<OnCallDutyPolicyExecutionLog> =
      await OnCallDutyPolicyExecutionLogService.findAllBy({
        query: {
          status: OnCallDutyPolicyStatus.Started,
          createdAt: QueryHelper.lessThan(fiveMinsAgo),
        },
        select: {
          _id: true,
          createdAt: true,
          // Whether it is a policy's run or a direct page, for what it is told.
          onCallDutyPolicyId: true,
          pagingStartsAt: true,
          // Whether it is a test page, which is not handed over.
          userNotificationEventType: true,
        },
        props: {
          isRoot: true,
        },
      });

    /*
     * A run that waited to page (OnCallDutyPolicyRunWait) - held until
     * working hours, for hours or days - was created long before it starts:
     * it is started from Waiting, and its pagingStartsAt is the moment it
     * was. It is stuck only five minutes after that, not at once. A Waiting
     * run itself is not read here at all: it is not stuck, it waits.
     */
    const stuckExecutions: Array<OnCallDutyPolicyExecutionLog> =
      startedExecutions.filter(
        (executionLog: OnCallDutyPolicyExecutionLog): boolean => {
          return isStartedLongerThan(executionLog, fiveMinsAgo);
        },
      );

    /*
     * A log is created in "Scheduled" and advanced to "Started" inside the
     * create-success hook. If the worker crashes (or a create-hook await throws)
     * after the row is committed but before the status flips, the log stays
     * "Scheduled" forever: ExecutePendingExecutions only processes "Executing"
     * and the reaper above only covers "Started", so the escalation would never
     * run and no error would ever surface (audit F14). Once a healthy log
     * leaves Scheduled within seconds it drops out of this set, so the
     * 5-minute cutoff only ever catches genuinely stuck rows.
     */
    const scheduledStuckExecutions: Array<OnCallDutyPolicyExecutionLog> =
      await OnCallDutyPolicyExecutionLogService.findAllBy({
        query: {
          status: OnCallDutyPolicyStatus.Scheduled,
          createdAt: QueryHelper.lessThan(fiveMinsAgo),
        },
        select: {
          _id: true,
          createdAt: true,
          onCallDutyPolicyId: true,
          userNotificationEventType: true,
        },
        props: {
          isRoot: true,
        },
      });

    for (const executionLog of stuckExecutions) {
      await settleStuckRun({
        run: executionLog,
        status: OnCallDutyPolicyStatus.Started,
        statusMessage: isOnCallDirectPage(executionLog)
          ? ON_CALL_DIRECT_PAGE_TIMED_OUT_MESSAGE
          : ON_CALL_POLICY_RUN_TIMED_OUT_MESSAGE,
      });
    }

    for (const executionLog of scheduledStuckExecutions) {
      await settleStuckRun({
        run: executionLog,
        status: OnCallDutyPolicyStatus.Scheduled,
        statusMessage: isOnCallDirectPage(executionLog)
          ? ON_CALL_DIRECT_PAGE_NEVER_STARTED_MESSAGE
          : ON_CALL_POLICY_RUN_NEVER_STARTED_MESSAGE,
      });
    }
  },
);

/*
 * A run that did not finish starting (issue #8405).
 *
 * A policy's run is handed to its escalation (Executing): its start was
 * cut short - the process stopped as it started, a database error the
 * create hook could not hand over - and it used to be ended in Error here,
 * having paged nobody, with none of its later rules paged either. Its
 * escalation pages what the start did not: from its first rule at once,
 * due when its page was, when no rule was recorded on it, or on from the
 * rule recorded, the way every run moves on (OnCallEscalationAdvance) -
 * claimed, so nobody is paged twice. The worker checks first that its
 * record still needs somebody, and ends a run that keeps failing, saying
 * why (OnCallPolicyRunRetry).
 *
 * A direct page has no escalation to hand it to, and a test page of a
 * policy's first level must not walk on to its later levels: each is
 * ended in Error, as it always was. So is a run that cannot be handed
 * over: one that moved on since it was read is left as it is.
 */
async function settleStuckRun(data: {
  run: OnCallDutyPolicyExecutionLog;
  status: OnCallDutyPolicyStatus;
  statusMessage: string;
}): Promise<void> {
  const run: OnCallDutyPolicyExecutionLog = data.run;

  if (!isOnCallDirectPage(run) && !isOnCallTestPage(run)) {
    const handedOver: boolean =
      await OnCallDutyPolicyExecutionLogService.handStartedRunToEscalation({
        executionLogId: run.id!,
        dueAt: getPagingDueAt(run),
        fromStatuses: [data.status],
      });

    if (handedOver) {
      logger.warn(
        `On-call execution log ${run.id?.toString()} was still ${data.status} five minutes after it started; handed to its escalation, which pages what its start did not.`,
      );
    }

    return;
  }

  await OnCallDutyPolicyExecutionLogService.updateOneById({
    id: run.id!,
    data: {
      status: OnCallDutyPolicyStatus.Error,
      statusMessage: data.statusMessage,
    },
    props: {
      isRoot: true,
    },
  });
}

// When a stuck run's page was due: when its paging started, or when it was created.
function getPagingDueAt(run: OnCallDutyPolicyExecutionLog): Date {
  const pagingStartsAt: Date | null = run.pagingStartsAt
    ? OneUptimeDate.fromString(run.pagingStartsAt)
    : null;

  if (pagingStartsAt && !isNaN(pagingStartsAt.getTime())) {
    return pagingStartsAt;
  }

  return run.createdAt
    ? OneUptimeDate.fromString(run.createdAt)
    : OneUptimeDate.getCurrentDate();
}

/*
 * Whether a run in Started began starting before `before`: when it was
 * created, or - for a run that waited to page - when its paging started.
 */
function isStartedLongerThan(
  executionLog: OnCallDutyPolicyExecutionLog,
  before: Date,
): boolean {
  if (!executionLog.pagingStartsAt) {
    return true;
  }

  const pagingStartedAt: Date = OneUptimeDate.fromString(
    executionLog.pagingStartsAt,
  );

  if (isNaN(pagingStartedAt.getTime())) {
    return true;
  }

  return OneUptimeDate.isBefore(pagingStartedAt, before);
}
