import Express, {
    ExpressApplication,
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
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

const APP_NAME: string = 'workflow';

const app: ExpressApplication = Express.getExpressApp();

app.use(`/${APP_NAME}/manual`, new ManualAPI().router);

app.get(
    `/${APP_NAME}/docs/:componentName`,
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.sendFile(__dirname + '/Docs/ComponentDocumentation/Webhook.md');
    }
);

// Job process.
QueueWorker.getWorker(
    QueueName.Workflow,
    async (job: QueueJob) => {
        await new RunWorkflow().runWorkflow({
            workflowId: new ObjectID(job.data['workflowId'] as string),
            workflowLogId: new ObjectID(job.data['workflowLogId'] as string),
            arguments: job.data.data as JSONObject,
            timeout: 5000,
        });
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
