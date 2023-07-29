import { IsDevelopment } from 'CommonServer/Config';
import RunCron from '../../Utils/Cron';
import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import OnCallDutyPolicyExecutionLog from 'Model/Models/OnCallDutyPolicyExecutionLog';
import OnCallDutyPolicyExecutionLogService from 'CommonServer/Services/OnCallDutyPolicyExecutionLogService';
import OnCallDutyPolicyStatus from 'Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus';
import OneUptimeDate from 'Common/Types/Date';
import OnCallDutyPolicyEscalationRuleService from 'CommonServer/Services/OnCallDutyPolicyEscalationRuleService';
import OnCallDutyPolicyEscalationRule from 'Model/Models/OnCallDutyPolicyEscalationRule';
import logger from 'CommonServer/Utils/Logger';

RunCron(
    'OnCallDutyPolicyExecutionLog:ExecutePendingExecutions',
    {
        schedule: IsDevelopment ? EVERY_MINUTE : EVERY_MINUTE,
        runOnStartup: false,
    },
    async () => {
        // get all pending on-call executions and execute them all at once.

        const pendingExecutions: Array<OnCallDutyPolicyExecutionLog> =
            await OnCallDutyPolicyExecutionLogService.findBy({
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
                    createdAt: true,
                    onCallDutyPolicy: {
                        repeatPolicyIfNoOneAcknowledgesNoOfTimes: true,
                    },
                    onCallPolicyExecutionRepeatCount: true,
                },
                limit: LIMIT_MAX,
                skip: 0,
                props: {
                    isRoot: true,
                },
            });

        const promises: Array<Promise<void>> = [];

        for (const executionLog of pendingExecutions) {
            promises.push(executeOnCallPolicy(executionLog));
        }

        await Promise.allSettled(promises);
    }
);

const executeOnCallPolicy: Function = async (
    executionLog: OnCallDutyPolicyExecutionLog
): Promise<void> => {
    try {
        // check if this execution needs to be executed.

        const currentDate: Date = OneUptimeDate.getCurrentDate();

        const lastExecutedAt: Date =
            executionLog.lastEscalationRuleExecutedAt ||
            executionLog.createdAt!;

        const getDifferenceInMinutes: number =
            OneUptimeDate.getDifferenceInMinutes(lastExecutedAt, currentDate);

        if (
            getDifferenceInMinutes <
            (executionLog.executeNextEscalationRuleInMinutes || 0)
        ) {
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
                            onCallDutyPolicyId:
                                executionLog.onCallDutyPolicyId!,
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
                    // mark this as complete.
                    await OnCallDutyPolicyExecutionLogService.updateOneById({
                        id: executionLog.id!,
                        data: {
                            status: OnCallDutyPolicyStatus.Completed,
                            statusMessage: 'Execution completed.',
                        },
                        props: {
                            isRoot: true,
                        },
                    });

                    return;
                }

                // update the execution log.
                await OnCallDutyPolicyEscalationRuleService.startRuleExecution(
                    firstEscalationRule.id!,
                    {
                        projectId: executionLog.projectId!,
                        triggeredByIncidentId:
                            executionLog.triggeredByIncidentId,
                        userNotificationEventType:
                            executionLog.userNotificationEventType!,
                        onCallPolicyExecutionLogId: executionLog.id!,
                        onCallPolicyId: executionLog.onCallDutyPolicyId!,
                    }
                );

                return;
            }
            // mark this as complete as we have no rules to execute.
            await OnCallDutyPolicyExecutionLogService.updateOneById({
                id: executionLog.id!,
                data: {
                    status: OnCallDutyPolicyStatus.Completed,
                    statusMessage: 'Execution completed.',
                },
                props: {
                    isRoot: true,
                },
            });
            return;
        }
        await OnCallDutyPolicyEscalationRuleService.startRuleExecution(
            nextEscalationRule!.id!,
            {
                projectId: executionLog.projectId!,
                triggeredByIncidentId: executionLog.triggeredByIncidentId,
                userNotificationEventType:
                    executionLog.userNotificationEventType!,
                onCallPolicyExecutionLogId: executionLog.id!,
                onCallPolicyId: executionLog.onCallDutyPolicyId!,
            }
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
                    err.message ||
                    'Error occurred while executing the on-call policy.',
            },
            props: {
                isRoot: true,
            },
        });
    }
};
