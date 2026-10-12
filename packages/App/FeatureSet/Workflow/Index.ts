import ComponentCodeAPI from "./API/ComponentCode";
import ManualAPI from "./API/Manual";
import RunStepAPI from "./API/RunStep";
import ModelSchemaAPI from "./API/ModelSchema";
import StepSamplesAPI from "./API/StepSamples";
import WorkflowAPI from "./API/Workflow";
import RunWorkflow from "./Services/RunWorkflow";
import { getRunPropsFromJobData } from "./Utils/WorkflowRunJob";
import { JSONObject } from "Common/Types/JSON";
import { QueueJob, QueueName } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import FeatureSet from "Common/Server/Types/FeatureSet";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import {
  DisableQueueWorkers,
  WorkflowTimeoutInMs,
} from "Common/Server/EnvironmentConfig";

const APP_NAME: string = "workflow";

const WorkflowFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    try {
      const app: ExpressApplication = Express.getExpressApp();

      app.use(`/${APP_NAME}/manual`, new ManualAPI().router);
      app.use(`/${APP_NAME}`, new RunStepAPI().router);

      app.use(`/${APP_NAME}`, new ModelSchemaAPI().router);

      // What each step held the last times it ran, for the value picker.
      app.use(`/${APP_NAME}`, new StepSamplesAPI().router);

      app.use(`/${APP_NAME}`, new WorkflowAPI().router);

      /*
       * There is no /workflow/docs route any more. Each step's "How to use"
       * help is built in the dashboard from the step itself
       * (Common/Types/Workflow/Documentation), so there are no Markdown files
       * left to serve.
       */

      const componentCodeAPI: ComponentCodeAPI = new ComponentCodeAPI();
      componentCodeAPI.init();

      app.use(`/${APP_NAME}`, componentCodeAPI.router);

      /*
       * Job process. Skipped in the "api" role (DISABLE_QUEUE_WORKERS=true) —
       * the dedicated worker deployment drains the Workflow queue.
       */
      if (DisableQueueWorkers) {
        logger.info(
          "DISABLE_QUEUE_WORKERS=true — Workflow queue consumer not registered (api role).",
          { service: "workflow" },
        );
      } else {
        QueueWorker.getWorker(
          QueueName.Workflow,
          async (job: QueueJob) => {
            // What QueueWorkflow wrote (Utils/WorkflowRunJob).
            await new RunWorkflow().runWorkflow(
              getRunPropsFromJobData(
                (job.data as JSONObject) || {},
                WorkflowTimeoutInMs || 120000,
              ),
            );
          },
          { concurrency: 100 },
        );
      }
    } catch (err) {
      logger.error("App Init Failed:", { service: "workflow" });
      logger.error(err, { service: "workflow" });
      throw err;
    }
  },
};

export default WorkflowFeatureSet;
