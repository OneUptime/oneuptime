import { IsDevelopment } from 'CommonServer/Config';
import RunCron from '../../Utils/Cron';
import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import OneUptimeDate from 'Common/Types/Date';
import QueryHelper from 'CommonServer/Types/Database/QueryHelper';
import UserOnCallLog from 'Model/Models/UserOnCallLog';
import UserOnCallLogService from 'CommonServer/Services/UserOnCallLogService';
import UserNotificationExecutionStatus from 'Common/Types/UserNotification/UserNotificationExecutionStatus';

/**
 * Jobs move from Started to Executing in seconds. If it takes more than 5 minutes, it's stuck. So, mark them as error
 */

RunCron(
    'UserOnCallLog:TimeoutStuckExecutions',
    {
        schedule: IsDevelopment ? EVERY_MINUTE : EVERY_MINUTE,
        runOnStartup: false,
    },
    async () => {
        // get all pending on call executions and execute them all at once.
        const fiveMinsAgo: Date = OneUptimeDate.getSomeMinutesAgo(5);

        const stuckExecutions: Array<UserOnCallLog> =
            await UserOnCallLogService.findBy({
                query: {
                    status: UserNotificationExecutionStatus.Started,
                    createdAt: QueryHelper.lessThan(fiveMinsAgo),
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
            await UserOnCallLogService.updateOneById({
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
