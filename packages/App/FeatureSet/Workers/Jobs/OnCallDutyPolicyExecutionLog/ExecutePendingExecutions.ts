import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  ON_CALL_POLICY_ARCHIVED_EXECUTION_STOPPED_MESSAGE,
  ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE,
} from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyArchive";
import { getOnCallPolicyRunRecordHandledMessage } from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import { getOnCallPolicyRunEndedWhileWaitingMessage } from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import logger from "Common/Server/Utils/Logger";
import OnCallEscalationAdvance from "Common/Server/Utils/OnCall/OnCallEscalationAdvance";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import IncidentService from "Common/Server/Services/IncidentService";
import AlertService from "Common/Server/Services/AlertService";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import { isOnCallDirectPage } from "Common/Types/OnCallDutyPolicy/OnCallDirectPage";

RunCron(
  "OnCallDutyPolicyExecutionLog:ExecutePendingExecutions",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    /*
     * Every run still going: the ones paging, and the ones waiting to page
     * (OnCallDutyPolicyRunWait), which start - or end, unpaged - here.
     */
    const pendingExecutions: Array<OnCallDutyPolicyExecutionLog> =
      await OnCallDutyPolicyExecutionLogService.findAllBy({
        query: {
          status: QueryHelper.any([
            OnCallDutyPolicyStatus.Executing,
            OnCallDutyPolicyStatus.Waiting,
          ]),
        },
        select: {
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
          onCallDutyPolicy: {
            repeatPolicyIfNoOneAcknowledges: true,
            repeatPolicyIfNoOneAcknowledgesNoOfTimes: true,
            isArchived: true,
          },
          onCallPolicyExecutionRepeatCount: true,
        },
        props: {
          isRoot: true,
        },
      });

    const promises: Array<Promise<void>> = [];

    for (const executionLog of pendingExecutions) {
      promises.push(
        executionLog.status === OnCallDutyPolicyStatus.Waiting
          ? startOrEndWaitingRun(executionLog)
          : executeOnCallPolicy(executionLog),
      );
    }

    await Promise.allSettled(promises);
  },
);

type ExecuteOnCallPolicyFunction = (
  executionLog: OnCallDutyPolicyExecutionLog,
) => Promise<void>;

const executeOnCallPolicy: ExecuteOnCallPolicyFunction = async (
  executionLog: OnCallDutyPolicyExecutionLog,
): Promise<void> => {
  try {
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
     * Its record was acknowledged or resolved: nobody else needs paging, so
     * the run is over.
     */
    const handledRecordKind: string | null =
      await getHandledRecordKind(executionLog);

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

    const lastExecutedAt: Date =
      executionLog.lastEscalationRuleExecutedAt || executionLog.createdAt!;

    const getDifferenceInMinutes: number = OneUptimeDate.getDifferenceInMinutes(
      lastExecutedAt,
      currentDate,
    );

    logger.debug(
      `Current date: ${currentDate}, Last executed at: ${lastExecutedAt}, Difference in minutes: ${getDifferenceInMinutes}`,
    );

    if (
      getDifferenceInMinutes <
      (executionLog.executeNextEscalationRuleInMinutes || 0)
    ) {
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
     */
    await OnCallEscalationAdvance.advance({
      run: executionLog,
      now: currentDate,
    });

    return;
  } catch (err: any) {
    logger.error(err);

    // update this log with error message.
    await OnCallDutyPolicyExecutionLogService.updateOneById({
      id: executionLog.id!,
      data: {
        status: OnCallDutyPolicyStatus.Error,
        statusMessage:
          err.message || "Error occurred while executing the on-call policy.",
      },
      props: {
        isRoot: true,
      },
    });
  }
};

/*
 * The kind of record a run pages about - "alert", "incident", "alert
 * episode", "incident episode" - when that record is acknowledged or
 * resolved; null while it is not, or the run pages about none.
 */
type GetHandledRecordKindFunction = (
  executionLog: OnCallDutyPolicyExecutionLog,
) => Promise<string | null>;

const getHandledRecordKind: GetHandledRecordKindFunction = async (
  executionLog: OnCallDutyPolicyExecutionLog,
): Promise<string | null> => {
  if (executionLog.triggeredByAlertId) {
    logger.debug(`Triggered by alert: ${executionLog.triggeredByAlertId}`);

    const isAcknowledged: boolean = await AlertService.isAlertAcknowledged({
      alertId: executionLog.triggeredByAlertId,
    });

    logger.debug(`Alert is acknowledged: ${isAcknowledged}`);

    if (isAcknowledged) {
      return "alert";
    }
  }

  if (executionLog.triggeredByIncidentId) {
    logger.debug(
      `Triggered by incident: ${executionLog.triggeredByIncidentId}`,
    );

    const isAcknowledged: boolean =
      await IncidentService.isIncidentAcknowledged({
        incidentId: executionLog.triggeredByIncidentId,
      });

    logger.debug(`Incident is acknowledged: ${isAcknowledged}`);

    if (isAcknowledged) {
      return "incident";
    }
  }

  if (executionLog.triggeredByAlertEpisodeId) {
    logger.debug(
      `Triggered by alert episode: ${executionLog.triggeredByAlertEpisodeId}`,
    );

    const isAcknowledged: boolean =
      await AlertEpisodeService.isEpisodeAcknowledged({
        episodeId: executionLog.triggeredByAlertEpisodeId,
      });

    logger.debug(`Alert episode is acknowledged: ${isAcknowledged}`);

    if (isAcknowledged) {
      return "alert episode";
    }
  }

  if (executionLog.triggeredByIncidentEpisodeId) {
    logger.debug(
      `Triggered by incident episode: ${executionLog.triggeredByIncidentEpisodeId}`,
    );

    const isAcknowledged: boolean =
      await IncidentEpisodeService.isEpisodeAcknowledged({
        episodeId: executionLog.triggeredByIncidentEpisodeId,
      });

    logger.debug(`Incident episode is acknowledged: ${isAcknowledged}`);

    if (isAcknowledged) {
      return "incident episode";
    }
  }

  return null;
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
 *   is a run like any other (executeOnCallPolicy).
 *
 * Starting and ending are each claimed, so of two ticks or two worker
 * replicas that read the same waiting run, one acts and the other does
 * nothing (startWaitingRun, endWaitingRun).
 */
type StartOrEndWaitingRunFunction = (
  executionLog: OnCallDutyPolicyExecutionLog,
) => Promise<void>;

const startOrEndWaitingRun: StartOrEndWaitingRunFunction = async (
  executionLog: OnCallDutyPolicyExecutionLog,
): Promise<void> => {
  try {
    if (executionLog.onCallDutyPolicy?.isArchived === true) {
      await OnCallDutyPolicyExecutionLogService.endWaitingRun({
        executionLogId: executionLog.id!,
        status: OnCallDutyPolicyStatus.Error,
        statusMessage: ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE,
      });

      return;
    }

    const handledRecordKind: string | null =
      await getHandledRecordKind(executionLog);

    if (handledRecordKind) {
      await OnCallDutyPolicyExecutionLogService.endWaitingRun({
        executionLogId: executionLog.id!,
        status: OnCallDutyPolicyStatus.Completed,
        statusMessage:
          getOnCallPolicyRunEndedWhileWaitingMessage(handledRecordKind),
      });

      return;
    }

    const now: Date = OneUptimeDate.getCurrentDate();

    // Not yet: it goes on waiting.
    if (
      executionLog.pagingStartsAt &&
      OneUptimeDate.isAfter(
        OneUptimeDate.fromString(executionLog.pagingStartsAt),
        now,
      )
    ) {
      return;
    }

    await OnCallDutyPolicyExecutionLogService.startWaitingRun({
      run: executionLog,
      now: now,
    });
  } catch (err: any) {
    logger.error(err);

    await OnCallDutyPolicyExecutionLogService.updateOneById({
      id: executionLog.id!,
      data: {
        status: OnCallDutyPolicyStatus.Error,
        statusMessage:
          err.message || "Error occurred while executing the on-call policy.",
      },
      props: {
        isRoot: true,
      },
    });
  }
};
