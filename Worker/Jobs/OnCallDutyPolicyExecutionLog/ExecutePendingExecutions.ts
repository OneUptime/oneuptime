import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import OnCallDutyPolicyStatus from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import OnCallDutyPolicyEscalationRuleService from "Common/Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import logger from "Common/Server/Utils/Logger";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import IncidentService from "Common/Server/Services/IncidentService";
import AlertService from "Common/Server/Services/AlertService";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";

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
          createdAt: true,
          onCallDutyPolicy: {
            repeatPolicyIfNoOneAcknowledgesNoOfTimes: true,
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
            statusMessage:
              "Execution completed because alert is acknowledged or resolved.",
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
            statusMessage:
              "Execution completed because incident is acknowledged or resolved.",
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
              "Execution completed because alert episode is acknowledged or resolved.",
          },
          props: {
            isRoot: true,
          },
        });

        return;
      }
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

    // get the next escalation rule to execute.
    const nextEscalationRule: OnCallDutyPolicyEscalationRule | null =
      await OnCallDutyPolicyEscalationRuleService.findOneBy({
        query: {
          projectId: executionLog.projectId!,
          onCallDutyPolicyId: executionLog.onCallDutyPolicyId!,
          order: executionLog.lastExecutedEscalationRuleOrder! + 1,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
        },
      });

    if (!nextEscalationRule) {
      logger.debug(
        `No next escalation rule found. Checking if we need to repeat this execution.`,
      );

      // check if we need to repeat this execution.
      if (
        executionLog.onCallPolicyExecutionRepeatCount &&
        executionLog.onCallPolicyExecutionRepeatCount <
          executionLog.onCallDutyPolicy!
            .repeatPolicyIfNoOneAcknowledgesNoOfTimes!
      ) {
        // repeating execution

        const newRepeatCount: number =
          executionLog.onCallPolicyExecutionRepeatCount + 1;

        logger.debug(
          `Repeating execution. New repeat count: ${newRepeatCount}`,
        );

        await OnCallDutyPolicyExecutionLogService.updateOneById({
          id: executionLog.id!,
          data: {
            onCallPolicyExecutionRepeatCount: newRepeatCount,
          },
          props: {
            isRoot: true,
          },
        });

        // get first escalation rule.
        const firstEscalationRule: OnCallDutyPolicyEscalationRule | null =
          await OnCallDutyPolicyEscalationRuleService.findOneBy({
            query: {
              projectId: executionLog.projectId!,
              onCallDutyPolicyId: executionLog.onCallDutyPolicyId!,
              order: 1,
            },
            props: {
              isRoot: true,
            },
            select: {
              _id: true,
            },
          });

        if (!firstEscalationRule) {
          logger.debug(
            `No first escalation rule found. Marking execution as complete.`,
          );

          // mark this as complete.
          await OnCallDutyPolicyExecutionLogService.updateOneById({
            id: executionLog.id!,
            data: {
              status: OnCallDutyPolicyStatus.Completed,
              statusMessage: "Execution completed.",
            },
            props: {
              isRoot: true,
            },
          });

          return;
        }

        logger.debug(
          `Starting execution of the first escalation rule: ${firstEscalationRule.id}`,
        );

        // update the execution log.
        await OnCallDutyPolicyEscalationRuleService.startRuleExecution(
          firstEscalationRule.id!,
          {
            projectId: executionLog.projectId!,
            triggeredByIncidentId: executionLog.triggeredByIncidentId,
            triggeredByAlertId: executionLog.triggeredByAlertId,
            triggeredByAlertEpisodeId: executionLog.triggeredByAlertEpisodeId,
            userNotificationEventType: executionLog.userNotificationEventType!,
            onCallPolicyExecutionLogId: executionLog.id!,
            onCallPolicyId: executionLog.onCallDutyPolicyId!,
          },
        );

        return;
      }

      logger.debug(
        `No rules to execute and no repeats left. Marking execution as complete.`,
      );

      // mark this as complete as we have no rules to execute.
      await OnCallDutyPolicyExecutionLogService.updateOneById({
        id: executionLog.id!,
        data: {
          status: OnCallDutyPolicyStatus.Completed,
          statusMessage: "Execution completed.",
        },
        props: {
          isRoot: true,
        },
      });
      return;
    }

    logger.debug(
      `Starting execution of the next escalation rule: ${nextEscalationRule.id}`,
    );

    await OnCallDutyPolicyEscalationRuleService.startRuleExecution(
      nextEscalationRule!.id!,
      {
        projectId: executionLog.projectId!,
        triggeredByIncidentId: executionLog.triggeredByIncidentId,
        triggeredByAlertId: executionLog.triggeredByAlertId,
        triggeredByAlertEpisodeId: executionLog.triggeredByAlertEpisodeId,
        userNotificationEventType: executionLog.userNotificationEventType!,
        onCallPolicyExecutionLogId: executionLog.id!,
        onCallPolicyId: executionLog.onCallDutyPolicyId!,
      },
    );

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
