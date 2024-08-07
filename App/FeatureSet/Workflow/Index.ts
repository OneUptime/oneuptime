import ComponentCodeAPI from "./API/ComponentCode";
import ManualAPI from "./API/Manual";
import WorkflowAPI from "./API/Workflow";
import RunWorkflow from "./Services/RunWorkflow";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { QueueJob, QueueName } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import FeatureSet from "Common/Server/Types/FeatureSet";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";

const APP_NAME: string = "api/workflow";

const WorkflowFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    try {
      const app: ExpressApplication = Express.getExpressApp();

      app.use(`/${APP_NAME}/manual`, new ManualAPI().router);

      app.use(`/${APP_NAME}`, new WorkflowAPI().router);

      app.get(
        `/${APP_NAME}/docs/:componentName`,
        (req: ExpressRequest, res: ExpressResponse) => {
          res.sendFile(
            "/usr/src/app/FeatureSet/Workflow/Docs/ComponentDocumentation/" +
              req.params["componentName"],
          );
        },
      );

      const componentCodeAPI: ComponentCodeAPI = new ComponentCodeAPI();
      componentCodeAPI.init();

      app.use(`/${APP_NAME}`, componentCodeAPI.router);

      // Job process.
      QueueWorker.getWorker(
        QueueName.Workflow,
        async (job: QueueJob) => {
          await new RunWorkflow().runWorkflow({
            workflowId: new ObjectID(job.data["workflowId"] as string),
            workflowLogId: job.data["workflowLogId"]
              ? new ObjectID(job.data["workflowLogId"] as string)
              : null,
            arguments: job.data.data as JSONObject,
            timeout: 5000,
          });
        },
        { concurrency: 10 },
      );
    } catch (err) {
      logger.error("App Init Failed:");
      logger.error(err);
      throw err;
    }
  },
};

export default WorkflowFeatureSet;
