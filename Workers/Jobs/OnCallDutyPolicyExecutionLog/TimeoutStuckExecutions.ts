import { IsDevelopment } from 'CommonServer/Config';
import RunCron from '../../Utils/Cron';
import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import OnCallDutyPolicyExecutionLog from 'Model/Models/OnCallDutyPolicyExecutionLog';
import OnCallDutyPolicyExecutionLogService from 'CommonServer/Services/OnCallDutyPolicyExecutionLogService';
import OnCallDutyPolicyStatus from 'Common/Types/OnCallDutyPolicy/OnCallDutyPolicyStatus';
import OneUptimeDate from 'Common/Types/Date';
import QueryHelper from 'CommonServer/Types/Database/QueryHelper';



/**
 * Jobs move from Started to Executing in seconds. If it takes more than 5 minutes, it's stuck. So, mark them as error
 */

RunCron(
    'OnCallDutyPolicyExecutionLog:TimeoutStuckExecutions',
    {
        schedule: IsDevelopment ? EVERY_MINUTE : EVERY_MINUTE,
        runOnStartup: false,
    },
    async () => {
        // get all pending on call executions and execute them all at once.
        const fiveMinsAgo: Date = OneUptimeDate.getSomeMinutesAgo(5);

        const stuckExecutions: Array<OnCallDutyPolicyExecutionLog> =
            await OnCallDutyPolicyExecutionLogService.findBy({
                query: {
                    status: OnCallDutyPolicyStatus.Started,
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
            await OnCallDutyPolicyExecutionLogService.updateOneById({
                id: executionLog.id!,
                data: {
                    status: OnCallDutyPolicyStatus.Error,
                    statusMessage: 'Policy Execution timed out.',
                },
                props: {
                    isRoot: true,
                },
            });
        }
    }
);
