import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import UserNotificationExecutionStatus from "Common/Types/UserNotification/UserNotificationExecutionStatus";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import IncidentService from "Common/Server/Services/IncidentService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "Common/Server/Services/UserOnCallLogService";
import logger from "Common/Server/Utils/Logger";
import Incident from "Common/Models/DatabaseModels/Incident";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import UserOnCallLog from "Common/Models/DatabaseModels/UserOnCallLog";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertService from "Common/Server/Services/AlertService";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";

RunCron(
  "UserOnCallLog:ExecutePendingExecutions",
  {
    schedule: IsDevelopment ? EVERY_MINUTE : EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    const pendingNotificationLogs: Array<UserOnCallLog> =
      await UserOnCallLogService.findAllBy({
        query: {
          status: UserNotificationExecutionStatus.Executing,
        },
        select: {
          _id: true,
          projectId: true,
          createdAt: true,
          executedNotificationRules: true,
          userId: true,
          userNotificationEventType: true,
          triggeredByIncidentId: true,
          triggeredByAlertId: true,
          triggeredByAlertEpisodeId: true,
          onCallDutyPolicyEscalationRuleId: true,
          onCallDutyPolicyExecutionLogTimelineId: true,
          onCallDutyPolicyExecutionLogId: true,
          onCallDutyPolicyId: true,
          onCallDutyScheduleId: true,
          userBelongsToTeamId: true,
        },
        props: {
          isRoot: true,
        },
      });

    const promises: Array<Promise<void>> = [];

    for (const pendingNotificationLog of pendingNotificationLogs) {
      promises.push(executePendingNotificationLog(pendingNotificationLog));
    }

    await Promise.allSettled(promises);
  },
);

type ExecutePendingNotificationLogFunction = (
  pendingNotificationLog: UserOnCallLog,
) => Promise<void>;

const executePendingNotificationLog: ExecutePendingNotificationLogFunction =
  async (pendingNotificationLog: UserOnCallLog): Promise<void> => {
    try {
      const ruleType: NotificationRuleType =
        UserOnCallLogService.getNotificationRuleType(
          pendingNotificationLog.userNotificationEventType!,
        );

      let incident: Incident | null = null;
      let alert: Alert | null = null;
      let alertEpisode: AlertEpisode | null = null;

      if (pendingNotificationLog.triggeredByIncidentId) {
        incident = await IncidentService.findOneById({
          id: pendingNotificationLog.triggeredByIncidentId!,
          props: {
            isRoot: true,
          },
          select: {
            incidentSeverityId: true,
          },
        });
      }

      if (pendingNotificationLog.triggeredByAlertId) {
        alert = await AlertService.findOneById({
          id: pendingNotificationLog.triggeredByAlertId!,
          props: {
            isRoot: true,
          },
          select: {
            alertSeverityId: true,
          },
        });
      }

      if (pendingNotificationLog.triggeredByAlertEpisodeId) {
        alertEpisode = await AlertEpisodeService.findOneById({
          id: pendingNotificationLog.triggeredByAlertEpisodeId!,
          props: {
            isRoot: true,
          },
          select: {
            alertSeverityId: true,
          },
        });
      }

      if (!incident && !alert && !alertEpisode) {
        throw new Error("Incident, Alert, or Alert Episode not found.");
      }

      if (incident) {
        // check if the incident is acknowledged.
        const isAcknowledged: boolean =
          await IncidentService.isIncidentAcknowledged({
            incidentId: pendingNotificationLog.triggeredByIncidentId!,
          });
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

      if (alert) {
        // check if the alert is acknowledged.
        const isAcknowledged: boolean = await AlertService.isAlertAcknowledged({
          alertId: pendingNotificationLog.triggeredByAlertId!,
        });

        if (isAcknowledged) {
          // then mark this policy as executed.
          await UserOnCallLogService.updateOneById({
            id: pendingNotificationLog.id!,
            data: {
              status: UserNotificationExecutionStatus.Completed,
              statusMessage:
                "Execution completed because alert is acknowledged.",
            },
            props: {
              isRoot: true,
            },
          });
          return;
        }
      }

      if (alertEpisode) {
        // check if the alert episode is acknowledged.
        const isAcknowledged: boolean =
          await AlertEpisodeService.isEpisodeAcknowledged({
            episodeId: pendingNotificationLog.triggeredByAlertEpisodeId!,
          });

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

      const notificationRules: Array<UserNotificationRule> =
        await UserNotificationRuleService.findBy({
          query: {
            projectId: pendingNotificationLog.projectId!,
            userId: pendingNotificationLog.userId!,
            ruleType: ruleType,
            incidentSeverityId: incident?.incidentSeverityId || undefined,
            alertSeverityId:
              alert?.alertSeverityId ||
              alertEpisode?.alertSeverityId ||
              undefined,
          },
          select: {
            _id: true,
            notifyAfterMinutes: true,
          },
          props: {
            isRoot: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
        });

      let isAllExecuted: boolean = true;

      const minutesSinceExecutionStarted: number =
        OneUptimeDate.getDifferenceInMinutes(
          pendingNotificationLog.createdAt!,
          OneUptimeDate.getCurrentDate(),
        );

      for (const notificationRule of notificationRules) {
        // check if this rule is already executed.
        const isAlreadyExecuted: boolean = Object.keys(
          pendingNotificationLog.executedNotificationRules! || {},
        ).includes(notificationRule.id?.toString() || "");

        if (isAlreadyExecuted) {
          continue;
        }

        isAllExecuted = false;

        if (
          notificationRule.notifyAfterMinutes! > minutesSinceExecutionStarted
        ) {
          continue;
        }

        // execute this rule.

        await UserNotificationRuleService.executeNotificationRuleItem(
          notificationRule.id!,
          {
            userNotificationLogId: pendingNotificationLog.id!,
            projectId: pendingNotificationLog.projectId!,
            triggeredByIncidentId: pendingNotificationLog.triggeredByIncidentId,
            triggeredByAlertId: pendingNotificationLog.triggeredByAlertId,
            triggeredByAlertEpisodeId:
              pendingNotificationLog.triggeredByAlertEpisodeId,
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
          },
        );
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
    } catch (err: any) {
      logger.error(
        `Error executing pending notification log: ${pendingNotificationLog._id}`,
      );
      logger.error(err);

      await UserOnCallLogService.updateOneById({
        id: pendingNotificationLog.id!,
        data: {
          status: UserNotificationExecutionStatus.Error,
          statusMessage: err.message ? err.message : "Unknown error",
        },
        props: {
          isRoot: true,
        },
      });
    }
  };
