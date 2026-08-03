import {
  ENABLE_CODE_FIXES,
  ENABLE_RUNBOOKS,
  IS_CLUSTER_SCOPED,
  ONEUPTIME_BASE_URL,
  POLL_INTERVAL_MS,
  PORT,
  RUNNER_VERSION,
} from "./Config";
import startHeartbeat from "./Jobs/Heartbeat";
import startRunbookPolling from "./Jobs/PollRunbookWork";
import startCodeFixPolling from "./Jobs/PollCodeFixWork";
import startCodeFixAlive from "./Jobs/CodeFixAlive";
import Register from "./Services/RegisterRunner";
import RunnerIdentity from "./Utils/RunnerIdentity";
import MetricsAPI from "./API/Metrics";
import {
  getTaskHandlerRegistry,
  FixExceptionTaskHandler,
  WriteRegressionTestTaskHandler,
  ImproveExceptionHandlingTaskHandler,
  ImproveInstrumentationTaskHandler,
  ImproveLoggingTaskHandler,
  ImproveTracingTaskHandler,
  FixFromIncidentTaskHandler,
  FixPerformanceTaskHandler,
} from "./TaskHandlers/Index";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import logger, { LogAttributes } from "Common/Server/Utils/Logger";
import App from "Common/Server/Utils/StartServer";
import Telemetry from "Common/Server/Utils/Telemetry";
import Profiling from "Common/Server/Utils/Profiling";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import "ejs";

const APP_NAME: string = "runner";

/*
 * OneUptime Runner — one agent, two kinds of work.
 *
 * Runbook capability: claims Bash/JavaScript runbook steps and executes
 * them here, in the customer's own infrastructure, so the credentials for
 * the systems being operated on never leave their network.
 *
 * Code-fix capability: claims AI code-fix runs, works in the project's code
 * repository and opens draft pull requests. Opt-in, because it needs a
 * connected repository and writes to it.
 *
 * Both loops share one registration, one credential and one heartbeat.
 */
const init: PromiseVoidFunction = async (): Promise<void> => {
  try {
    Telemetry.init({ serviceName: APP_NAME });
    Profiling.init({ serviceName: APP_NAME });

    logger.info(
      `OneUptime Runner ${RUNNER_VERSION} starting | server=${ONEUPTIME_BASE_URL.toString()} | scope=${
        IS_CLUSTER_SCOPED ? "cluster" : "project"
      } | runbooks=${ENABLE_RUNBOOKS ? "on" : "off"} | codeFixes=${
        ENABLE_CODE_FIXES ? "on" : "off"
      } | poll=${POLL_INTERVAL_MS}ms`,
      { serviceName: APP_NAME } as LogAttributes,
    );

    if (!ENABLE_RUNBOOKS && !ENABLE_CODE_FIXES) {
      logger.error(
        "Both capabilities are disabled — this Runner would do nothing. Enable ONEUPTIME_RUNNER_ENABLE_RUNBOOKS or ONEUPTIME_RUNNER_ENABLE_CODE_FIXES.",
        { serviceName: APP_NAME } as LogAttributes,
      );
      process.exit(1);
    }

    await App.init({
      appName: APP_NAME,
      port: PORT,
      isFrontendApp: false,
      statusOptions: {
        liveCheck: async () => {},
        readyCheck: async () => {},
      },
    });

    // Queue-depth metrics for KEDA autoscaling of the code-fix lane.
    const app: ExpressApplication = Express.getExpressApp();
    app.use("/metrics", MetricsAPI);

    await App.addDefaultRoutes();

    /*
     * Registration resolves this Runner's identity: in project mode it
     * validates the dashboard-issued id + key; in cluster mode the server
     * assigns an id. Retries forever — a temporarily unreachable server
     * must never kill the container.
     */
    await Register.registerRunner();

    logger.debug(
      `Runner registered | runnerId=${RunnerIdentity.getRunnerId().toString()}`,
      { serviceName: APP_NAME } as LogAttributes,
    );

    startHeartbeat();

    if (ENABLE_RUNBOOKS) {
      startRunbookPolling();
      logger.info("Runbook capability enabled — polling for runbook steps.", {
        serviceName: APP_NAME,
      } as LogAttributes);
    }

    if (ENABLE_CODE_FIXES) {
      startCodeFixAlive();

      const registry: ReturnType<typeof getTaskHandlerRegistry> =
        getTaskHandlerRegistry();
      registry.register(new FixExceptionTaskHandler());
      registry.register(new WriteRegressionTestTaskHandler());
      registry.register(new ImproveExceptionHandlingTaskHandler());
      registry.register(new ImproveInstrumentationTaskHandler());
      registry.register(new ImproveLoggingTaskHandler());
      registry.register(new ImproveTracingTaskHandler());
      registry.register(new FixFromIncidentTaskHandler());
      registry.register(new FixPerformanceTaskHandler());

      logger.info(
        `Code-fix capability enabled — ${registry.getHandlerCount()} task handler(s) registered: ${registry
          .getRegisteredTaskTypes()
          .join(", ")}`,
        { serviceName: APP_NAME } as LogAttributes,
      );

      // Runs in the background for the life of the process.
      startCodeFixPolling().catch((err: Error) => {
        logger.error("Code-fix task loop failed:", {
          serviceName: APP_NAME,
        } as LogAttributes);
        logger.error(err, { serviceName: APP_NAME } as LogAttributes);
      });
    }

    logger.info("OneUptime Runner ready.", {
      serviceName: APP_NAME,
    } as LogAttributes);
  } catch (err) {
    logger.error("Runner init failed:", {
      serviceName: APP_NAME,
    } as LogAttributes);
    logger.error(err, { serviceName: APP_NAME } as LogAttributes);
    throw err;
  }
};

init().catch((err: Error) => {
  logger.error(err, { serviceName: APP_NAME } as LogAttributes);
  process.exit(1);
});
