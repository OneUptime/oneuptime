import RunbookAPI from "./API/Runbook";
import RunbookAgentIngressAPI from "./API/RunbookAgentIngress";
import QueueRunbook from "./Services/QueueRunbook";
import RunRunbook from "./Services/RunRunbook";
import ObjectID from "Common/Types/ObjectID";
import { QueueJob, QueueName } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import RunbookRuleEngineService from "Common/Server/Services/RunbookRuleEngineService";
import FeatureSet from "Common/Server/Types/FeatureSet";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";

const APP_NAME: string = "runbook";
const AGENT_INGRESS_PATH: string = "runbook-agent-ingest";

const RunbookFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    try {
      const app: ExpressApplication = Express.getExpressApp();

      app.use(`/${APP_NAME}`, new RunbookAPI().router);
      app.use(`/${AGENT_INGRESS_PATH}`, new RunbookAgentIngressAPI().router);

      // Hand the engine a queue enqueuer so rule-triggered runs actually start.
      RunbookRuleEngineService.registerExecutionEnqueuer(
        async (data: { runbookExecutionId: ObjectID }) => {
          await QueueRunbook.addExecutionToQueue(data);
        },
      );

      QueueWorker.getWorker(
        QueueName.Runbook,
        async (job: QueueJob) => {
          const runbookExecutionId: string = job.data[
            "runbookExecutionId"
          ] as string;
          if (!runbookExecutionId) {
            return;
          }
          await new RunRunbook().runExecution({
            runbookExecutionId: new ObjectID(runbookExecutionId),
          });
        },
        { concurrency: 25 },
      );
    } catch (err) {
      logger.error("App Init Failed:", { service: "runbook" });
      logger.error(err, { service: "runbook" });
      throw err;
    }
  },
};

export default RunbookFeatureSet;
