import RunCron from "../../Utils/Cron";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import ObjectID from "Common/Types/ObjectID";
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

RunCron(
  "UserOnCallLog:ExecutePendingExecutions",
  {
    schedule: IsDevelopment ? EVERY_MINUTE : EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    const pendingNotificationLogs: Array<UserOnCallLog> =
      await UserOnCallLogService.findBy({
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
          onCallDutyPolicyEscalationRuleId: true,
          onCallDutyPolicyExecutionLogTimelineId: true,
          onCallDutyPolicyExecutionLogId: true,
          onCallDutyPolicyId: true,
          userBelongsToTeamId: true,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
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

      const incident: Incident | null = await IncidentService.findOneById({
        id: pendingNotificationLog.triggeredByIncidentId!,
        props: {
          isRoot: true,
        },
        select: {
          incidentSeverityId: true,
        },
      });

      const notificationRules: Array<UserNotificationRule> =
        await UserNotificationRuleService.findBy({
          query: {
            projectId: pendingNotificationLog.projectId!,
            userId: pendingNotificationLog.userId!,
            ruleType: ruleType,
            incidentSeverityId: incident?.incidentSeverityId as ObjectID,
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
