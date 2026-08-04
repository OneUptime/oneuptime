import RunbookAPI from "./API/Runbook";
import RunnerIngressAPI from "./API/RunnerIngress";
import QueueRunbook from "./Services/QueueRunbook";
import RunRunbook from "./Services/RunRunbook";
import ObjectID from "Common/Types/ObjectID";
import { QueueJob, QueueName } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import { DisableQueueWorkers } from "Common/Server/EnvironmentConfig";
import RunbookRuleEngineService from "Common/Server/Services/RunbookRuleEngineService";
import FeatureSet from "Common/Server/Types/FeatureSet";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";

const APP_NAME: string = "runbook";
/*
 * The Runner's work mount. Renamed from runbook-agent-ingest when the
 * Runbook Agent and AI Agent merged into the OneUptime Runner.
 */
const AGENT_INGRESS_PATH: string = "runner-ingest";

/*
 * The pre-merge Runbook Agent hardcoded this path, so an agent container that
 * has not been redeployed still calls it. Without this mount every heartbeat
 * and claim from one 404s: the container keeps running and logging, the
 * dashboard quietly shows the Runner Disconnected, and steps targeting it fail
 * with TimedOut — a failure mode that says nothing about its own cause.
 *
 * The credentials behind both paths are identical (same Runner row, same
 * id and key), so this is purely the URL an older container happens to know.
 * Safe to remove once the legacy-use log below has been quiet for a release.
 */
const LEGACY_AGENT_INGRESS_PATH: string = "runbook-agent-ingest";

/*
 * An old agent polls every few seconds, so logging every request would bury
 * the signal it carries. One line per agent per process is enough to answer
 * "is anyone still on the old path, and who".
 */
const legacyAgentsSeen: Set<string> = new Set<string>();

const RunbookFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    try {
      const app: ExpressApplication = Express.getExpressApp();

      app.use(`/${APP_NAME}`, new RunbookAPI().router);
      app.use(`/${AGENT_INGRESS_PATH}`, new RunnerIngressAPI().router);

      /*
       * Same router, older URL — see LEGACY_AGENT_INGRESS_PATH. The agent id
       * is read straight off the unauthenticated request purely to name the
       * agent in the log; authorization happens inside the router exactly as
       * it does on the current path.
       */
      app.use(
        `/${LEGACY_AGENT_INGRESS_PATH}`,
        (
          req: ExpressRequest,
          _res: ExpressResponse,
          next: NextFunction,
        ): void => {
          const body: JSONObject = (req.body as JSONObject) || {};
          const agentId: string = String(
            body["agentId"] || req.headers["x-agent-id"] || "unknown",
          );

          if (!legacyAgentsSeen.has(agentId)) {
            legacyAgentsSeen.add(agentId);
            logger.warn(
              `Runbook Agent ${agentId} is calling the pre-merge /${LEGACY_AGENT_INGRESS_PATH} endpoint. It still works, but that agent is running the retired oneuptime/runbook-agent image — redeploy it as oneuptime/runner with ONEUPTIME_RUNNER_ID and ONEUPTIME_RUNNER_KEY (its id and key are unchanged).`,
            );
          }

          next();
        },
        new RunnerIngressAPI().router,
      );

      // Hand the engine a queue enqueuer so rule-triggered runs actually start.
      RunbookRuleEngineService.registerExecutionEnqueuer(
        async (data: { runbookExecutionId: ObjectID }) => {
          await QueueRunbook.addExecutionToQueue(data);
        },
      );

      /*
       * Job process. Skipped in the "api" role (DISABLE_QUEUE_WORKERS=true) —
       * the dedicated worker deployment drains the Runbook queue. The
       * execution enqueuer registered above stays active so rule-triggered
       * runs still enqueue from the api role.
       */
      if (DisableQueueWorkers) {
        logger.info(
          "DISABLE_QUEUE_WORKERS=true — Runbook queue consumer not registered (api role).",
          { service: "runbook" },
        );
      } else {
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
          {
            concurrency: 25,
            /*
             * A runbook execution occupies its job for the whole run, and a
             * single step may now be configured to wait up to an hour for an
             * agent and run for another hour. BullMQ renews the lock while the
             * process is alive, so this is not a cap on job length — it is how
             * long after a Worker dies before the job is treated as stalled and
             * handed to another Worker. Kept short deliberately: redelivery is
             * how an interrupted execution resumes, and the dispatcher
             * re-attaches to an in-flight agent job instead of dispatching a
             * second one, so recovering quickly is safe.
             */
            lockDuration: 30_000,
            /*
             * Default is 1, which spends the execution's only recovery on the
             * first restart — a rolling deploy that bounces this pod twice
             * during an hour-long step would drop the run on the floor. Three
             * covers an ordinary deploy while still bounding a job that stalls
             * because of something about the job itself. Past that the
             * TimeoutStuckExecutions sweep fails the execution with a reason.
             */
            maxStalledCount: 3,
          },
        );
      }
    } catch (err) {
      logger.error("App Init Failed:", { service: "runbook" });
      logger.error(err, { service: "runbook" });
      throw err;
    }
  },
};

export default RunbookFeatureSet;
