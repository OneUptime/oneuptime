import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { ON_CALL_POLICY_ARCHIVED_EXECUTION_STOPPED_MESSAGE } from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyArchive";
import { getOnCallPolicyRunRecordHandledMessage } from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
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
    // get all pending on-call executions and execute them all at once.

    const pendingExecutions: Array<OnCallDutyPolicyExecutionLog> =
      await OnCallDutyPolicyExecutionLogService.findAllBy({
        query: {
          status: OnCallDutyPolicyStatus.Executing,
        },
        select: {
          _id: true,
          projectId: true,
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
      promises.push(executeOnCallPolicy(executionLog));
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

    // get trigger by alert
    if (executionLog.triggeredByAlertId) {
      logger.debug(`Triggered by alert: ${executionLog.triggeredByAlertId}`);

      // check if this alert is ack.
      const isAcknowledged: boolean = await AlertService.isAlertAcknowledged({
        alertId: executionLog.triggeredByAlertId,
      });

      logger.debug(`Alert is acknowledged: ${isAcknowledged}`);

      if (isAcknowledged) {
        // then mark this policy as executed.
        await OnCallDutyPolicyExecutionLogService.updateOneById({
          id: executionLog.id!,
          data: {
            status: OnCallDutyPolicyStatus.Completed,
            statusMessage: getOnCallPolicyRunRecordHandledMessage("alert"),
          },
          props: {
            isRoot: true,
          },
        });

        return;
      }
    }

    // get trigger by incident
    if (executionLog.triggeredByIncidentId) {
      logger.debug(
        `Triggered by incident: ${executionLog.triggeredByIncidentId}`,
      );

      // check if this incident is ack.
      const isAcknowledged: boolean =
        await IncidentService.isIncidentAcknowledged({
          incidentId: executionLog.triggeredByIncidentId,
        });

      logger.debug(`Incident is acknowledged: ${isAcknowledged}`);

      if (isAcknowledged) {
        // then mark this policy as executed.
        await OnCallDutyPolicyExecutionLogService.updateOneById({
          id: executionLog.id!,
          data: {
            status: OnCallDutyPolicyStatus.Completed,
            statusMessage: getOnCallPolicyRunRecordHandledMessage("incident"),
          },
          props: {
            isRoot: true,
          },
        });

        return;
      }
    }

    // get trigger by alert episode
    if (executionLog.triggeredByAlertEpisodeId) {
      logger.debug(
        `Triggered by alert episode: ${executionLog.triggeredByAlertEpisodeId}`,
      );

      // check if this episode is ack.
      const isAcknowledged: boolean =
        await AlertEpisodeService.isEpisodeAcknowledged({
          episodeId: executionLog.triggeredByAlertEpisodeId,
        });

      logger.debug(`Alert episode is acknowledged: ${isAcknowledged}`);

      if (isAcknowledged) {
        // then mark this policy as executed.
        await OnCallDutyPolicyExecutionLogService.updateOneById({
          id: executionLog.id!,
          data: {
            status: OnCallDutyPolicyStatus.Completed,
            statusMessage:
              getOnCallPolicyRunRecordHandledMessage("alert episode"),
          },
          props: {
            isRoot: true,
          },
        });

        return;
      }
    }

    // get trigger by incident episode
    if (executionLog.triggeredByIncidentEpisodeId) {
      logger.debug(
        `Triggered by incident episode: ${executionLog.triggeredByIncidentEpisodeId}`,
      );

      // check if this episode is ack.
      const isAcknowledged: boolean =
        await IncidentEpisodeService.isEpisodeAcknowledged({
          episodeId: executionLog.triggeredByIncidentEpisodeId,
        });

      logger.debug(`Incident episode is acknowledged: ${isAcknowledged}`);

      if (isAcknowledged) {
        // then mark this policy as executed.
        await OnCallDutyPolicyExecutionLogService.updateOneById({
          id: executionLog.id!,
          data: {
            status: OnCallDutyPolicyStatus.Completed,
            statusMessage:
              getOnCallPolicyRunRecordHandledMessage("incident episode"),
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
