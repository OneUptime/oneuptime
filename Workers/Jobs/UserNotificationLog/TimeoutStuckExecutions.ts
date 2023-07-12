import { IsDevelopment } from 'CommonServer/Config';
import RunCron from '../../Utils/Cron';
import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import OneUptimeDate from 'Common/Types/Date';
import QueryHelper from 'CommonServer/Types/Database/QueryHelper';
import UserNotificationLog from 'Model/Models/UserNotificationLog';
import UserNotificationLogService from 'CommonServer/Services/UserNotificationLogService';
import UserNotificationExecutionStatus from 'Common/Types/UserNotification/UserNotificationExecutionStatus';

RunCron(
    'UserNotificationLog:TimeoutStuckExecutions',
    {
        schedule: IsDevelopment ? EVERY_MINUTE : EVERY_MINUTE,
        runOnStartup: false,
    },
    async () => {
        // get all pending on call executions and execute them all at once.
        const startDate: Date = OneUptimeDate.getSomeMinutesAgo(5);

        const stuckExecutions: Array<UserNotificationLog> =
            await UserNotificationLogService.findBy({
                query: {
                    status: UserNotificationExecutionStatus.Started,
                    createdAt: QueryHelper.inBetween(
                        startDate,
                        OneUptimeDate.getCurrentDate()
                    ),
                },
                select: {
                    _id: true,
                    createdAt: true,
                },
                limit: LIMIT_MAX,
                skip: 0,
                props: {
                    isRoot: true,
                },
            });

        for (const executionLog of stuckExecutions) {
            await UserNotificationLogService.updateOneById({
                id: executionLog.id!,
                data: {
                    status: UserNotificationExecutionStatus.Error,
                    statusMessage: 'Rule execution timed out.',
                },
                props: {
                    isRoot: true,
                },
            });
        }
    }
);
