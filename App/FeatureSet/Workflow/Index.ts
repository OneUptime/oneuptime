import ComponentCodeAPI from "./API/ComponentCode";
import QueueWorkflow from "./Services/QueueWorkflow";
import GitHubWebhookQueue, {
  GitHubWebhookDelivery,
} from "Common/Server/Utils/CodeRepository/GitHub/GitHubWebhookQueue";
import GitHubWebhookProcessor from "Common/Server/Utils/CodeRepository/GitHub/GitHubWebhookProcessor";
import { GitHubEventEnvelope } from "Common/Types/CodeRepository/GitHubEvent";
import GitHubEventTrigger from "Common/Server/Types/Workflow/Components/GitHub/GitHubEvent";
import ManualAPI from "./API/Manual";
import RunStepAPI from "./API/RunStep";
import ModelSchemaAPI from "./API/ModelSchema";
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
import path from "path";
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

      app.use(`/${APP_NAME}`, new WorkflowAPI().router);

      app.get(
        `/${APP_NAME}/docs/:componentName`,
        (req: ExpressRequest, res: ExpressResponse) => {
          const docsDir: string =
            "/usr/src/app/FeatureSet/Workflow/Docs/ComponentDocumentation";
          const componentName: string = path.basename(
            req.params["componentName"] || "",
          );

          if (!componentName) {
            res.status(404).send("Not Found");
            return;
          }

          const filePath: string = path.join(docsDir, componentName);

          // Ensure resolved path is within the docs directory
          if (!filePath.startsWith(docsDir + "/")) {
            res.status(404).send("Not Found");
            return;
          }

          res.sendFile(filePath);
        },
      );

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
        const gitHubTrigger: GitHubEventTrigger = new GitHubEventTrigger();
        QueueWorker.getWorker(
          QueueName.GitHubWebhook,
          async (job: QueueJob): Promise<void> => {
            await GitHubWebhookQueue.process(
              job.data as GitHubWebhookDelivery,
              async (delivery: GitHubWebhookDelivery): Promise<void> => {
                await GitHubWebhookProcessor.process(
                  delivery,
                  async (data: {
                    projectId: ObjectID;
                    envelope: GitHubEventEnvelope;
                  }): Promise<void> => {
                    await gitHubTrigger.dispatch(
                      data,
                      QueueWorkflow.addWorkflowToQueue.bind(QueueWorkflow),
                    );
                  },
                );
              },
            );
          },
          { concurrency: 5 },
        );
        QueueWorker.getWorker(
          QueueName.Workflow,
          async (job: QueueJob) => {
            await new RunWorkflow().runWorkflow({
              workflowId: new ObjectID(job.data["workflowId"] as string),
              workflowLogId: job.data["workflowLogId"]
                ? new ObjectID(job.data["workflowLogId"] as string)
                : null,
              arguments: job.data.data as JSONObject,
              timeout: WorkflowTimeoutInMs || 120000,
              callChain:
                (job.data["callChain"] as Array<string> | undefined) || [],
              isResume: job.data["isResume"] === true,
              runOnlyComponentId:
                (job.data["runOnlyComponentId"] as string | undefined) ||
                undefined,
            });
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
