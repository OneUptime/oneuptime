import { IsDevelopment } from 'CommonServer/Config';
import RunCron from '../../Utils/Cron';
import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import UserNotificationLog from 'Model/Models/UserNotificationLog';
import UserNotificationLogService from 'CommonServer/Services/UserNotificationLogService';
import LIMIT_MAX, { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import UserNotificationExecutionStatus from 'Common/Types/UserNotification/UserNotificationExecutionStatus';
import logger from 'CommonServer/Utils/Logger';
import UserNotificationRuleService from 'CommonServer/Services/UserNotificationRuleService';
import NotificationRuleType from 'Common/Types/NotificationRule/NotificationRuleType';
import UserNotificationRule from 'Model/Models/UserNotificationRule';
import OneUptimeDate from 'Common/Types/Date';
import Incident from 'Model/Models/Incident';
import IncidentService from 'CommonServer/Services/IncidentService';

RunCron(
    'UserNotificationLog:ExecutePendingExecutions',
    {
        schedule: IsDevelopment ? EVERY_MINUTE : EVERY_MINUTE,
        runOnStartup: false,
    },
    async () => {
        const pendingNotiifcationLogs: Array<UserNotificationLog> =
            await UserNotificationLogService.findBy({
                query: {
                    status: UserNotificationExecutionStatus.Running,
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

        for (const pendingNotificationLog of pendingNotiifcationLogs) {
            promises.push(
                executePendingNotificationLog(pendingNotificationLog)
            );
        }

        await Promise.allSettled(promises);
    }
);

const executePendingNotificationLog: Function = async (
    pendingNotificationLog: UserNotificationLog
): Promise<void> => {
    try {
        const ruleType: NotificationRuleType =
            UserNotificationLogService.getNotificationRuleType(
                pendingNotificationLog.userNotificationEventType!
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

        const notificaionRules: Array<UserNotificationRule> =
            await UserNotificationRuleService.findBy({
                query: {
                    projectId: pendingNotificationLog.projectId!,
                    userId: pendingNotificationLog.userId!,
                    ruleType: ruleType,
                    incidentSeverityId: incident?.incidentSeverityId!,
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
                OneUptimeDate.getCurrentDate()
            );

        for (const notificationRule of notificaionRules) {
            // check if this rule is already executed.
            const isAlreadyExecuted: boolean = Object.keys(
                pendingNotificationLog.executedNotificationRules! || {}
            ).includes(notificationRule.id?.toString() || '');

            if (isAlreadyExecuted) {
                continue;
            }

            isAllExecuted = false;

            if (
                notificationRule.notifyAfterMinutes! >
                minutesSinceExecutionStarted
            ) {
                continue;
            }

            // execute this rule.

            await UserNotificationRuleService.executeNotificationRuleItem(
                notificationRule.id!,
                {
                    userNotificationLogId: pendingNotificationLog.id!,
                    projectId: pendingNotificationLog.projectId!,
                    triggeredByIncidentId:
                        pendingNotificationLog.triggeredByIncidentId,
                    userNotificationEventType:
                        pendingNotificationLog.userNotificationEventType!,
                    onCallPolicyExecutionLogId:
                        pendingNotificationLog.onCallDutyPolicyExecutionLogId,
                    onCallPolicyId: pendingNotificationLog.onCallDutyPolicyId,
                    onCallPolicyEscalationRuleId:
                        pendingNotificationLog.onCallDutyPolicyEscalationRuleId,
                    userBelongsToTeamId:
                        pendingNotificationLog.userBelongsToTeamId,
                    onCallDutyPolicyExecutionLogTimelineId:
                        pendingNotificationLog.onCallDutyPolicyExecutionLogTimelineId,
                }
            );
        }

        if (isAllExecuted) {
            // mark this log as complete.
            await UserNotificationLogService.updateOneById({
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
            err
        );

        await UserNotificationLogService.updateOneById({
            id: pendingNotificationLog.id!,
            data: {
                status: UserNotificationExecutionStatus.Error,
                statusMessage: err.message ? err.message : 'Unknown error',
            },
            props: {
                isRoot: true,
            },
        });
    }
};
