import Express, {
    ExpressApplication,
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';
import ManualAPI from './API/Manual';
import ComponentCodeAPI from './API/ComponentCode';
import { QueueJob, QueueName } from 'CommonServer/Infrastructure/Queue';
import QueueWorker from 'CommonServer/Infrastructure/QueueWorker';
import RunWorkflow from './Services/RunWorkflow';
import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import WorkflowAPI from './API/Workflow';
import FeatureSet from 'CommonServer/Types/FeatureSet';

const APP_NAME: string = 'api/workflow';

const WorkflowFeatureSet: FeatureSet = {
    init: async (): Promise<void> => {
        try {
            const componentCodeAPI: ComponentCodeAPI = new ComponentCodeAPI();
            componentCodeAPI.init();

            const app: ExpressApplication = Express.getExpressApp();

            app.use(`/${APP_NAME}/manual`, new ManualAPI().router);

            app.use(`/${APP_NAME}`, new WorkflowAPI().router);

            app.get(
                `/${APP_NAME}/docs/:componentName`,
                (req: ExpressRequest, res: ExpressResponse) => {
                    res.sendFile(
                        '/usr/src/app/FeatureSet/Workflow/Docs/ComponentDocumentation/' +
                            req.params['componentName']
                    );
                }
            );

            app.use(`/${APP_NAME}`, componentCodeAPI.router);

            // Job process.
            QueueWorker.getWorker(
                QueueName.Workflow,
                async (job: QueueJob) => {
                    await new RunWorkflow().runWorkflow({
                        workflowId: new ObjectID(
                            job.data['workflowId'] as string
                        ),
                        workflowLogId: job.data['workflowLogId']
                            ? new ObjectID(job.data['workflowLogId'] as string)
                            : null,
                        arguments: job.data.data as JSONObject,
                        timeout: 5000,
                    });
                },
                { concurrency: 10 }
            );
        } catch (err) {
            logger.error('App Init Failed:');
            logger.error(err);
            throw err;
        }
    },
};

export default WorkflowFeatureSet;
