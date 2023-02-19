import Express, { ExpressApplication } from 'CommonServer/Utils/Express';
import App from 'CommonServer/Utils/StartServer';
import { PostgresAppInstance } from 'CommonServer/Infrastructure/PostgresDatabase';
import Redis from 'CommonServer/Infrastructure/Redis';
import logger from 'CommonServer/Utils/Logger';
import ManualAPI from './API/Manual';
import ComponentCode from './API/ComponentCode';
import { QueueJob, QueueName } from 'CommonServer/Infrastructure/Queue';
import QueueWorker from 'CommonServer/Infrastructure/QueueWorker';
import RunWorkflow from './Services/RunWorkflow';
import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import TimeoutException from 'Common/Types/Exception/TimeoutException';
import WorkflowLogService from 'CommonServer/Services/WorkflowLogService';
import WorkflowStatus from 'Common/Types/Workflow/WorkflowStatus';
import OneUptimeDate from 'Common/Types/Date';

const APP_NAME: string = 'workflow';

const app: ExpressApplication = Express.getExpressApp();

app.use(`/${APP_NAME}/manual`, new ManualAPI().router);


// Job process.
QueueWorker.getWorker(
    QueueName.Workflow,
    async (job: QueueJob) => {
        try {
            await QueueWorker.runJobWithTimeout(5000, async () => {
                await new RunWorkflow().runWorkflow({
                    workflowId: new ObjectID(job.data['workflowId'] as string),
                    workflowLogId: new ObjectID(
                        job.data['workflowLogId'] as string
                    ),
                    arguments: job.data.data as JSONObject,
                });
            });
        } catch (err: any) {
            // WOrkflow might have timed out.
            if (err instanceof TimeoutException) {
                // update workflow log.
                await WorkflowLogService.updateOneById({
                    id: new ObjectID(job.data['workflowLogId'] as string),
                    data: {
                        workflowStatus: WorkflowStatus.Timeout,
                        logs: err.toString(),
                        completedAt: OneUptimeDate.getCurrentDate(),
                    },
                    props: {
                        isRoot: true,
                    },
                });
            } else {
                await WorkflowLogService.updateOneById({
                    id: new ObjectID(job.data['workflowLogId'] as string),
                    data: {
                        workflowStatus: WorkflowStatus.Error,
                        logs: err.toString(),
                        completedAt: OneUptimeDate.getCurrentDate(),
                    },
                    props: {
                        isRoot: true,
                    },
                });
            }

            throw err;
        }
    },
    { concurrency: 10 }
);

const init: Function = async (): Promise<void> => {
    try {
        // init the app
        await App(APP_NAME);
        // connect to the database.
        await PostgresAppInstance.connect(
            PostgresAppInstance.getDatasourceOptions()
        );

        app.use(`/${APP_NAME}/`, new ComponentCode().router);

        // connect redis
        await Redis.connect();
    } catch (err) {
        logger.error('App Init Failed:');
        logger.error(err);
    }
};

init();

export default app;
