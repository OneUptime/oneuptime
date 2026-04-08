import { PORT } from "./Config";
import AliveJob from "./Jobs/Alive";
import startTaskProcessingLoop from "./Jobs/ProcessScheduledTasks";
import Register from "./Services/Register";
import MetricsAPI from "./API/Metrics";
import {
  getTaskHandlerRegistry,
  FixExceptionTaskHandler,
} from "./TaskHandlers/Index";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import logger, { LogAttributes } from "Common/Server/Utils/Logger";
import App from "Common/Server/Utils/StartServer";
import Telemetry from "Common/Server/Utils/Telemetry";
import Profiling from "Common/Server/Utils/Profiling";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import "ejs";

const APP_NAME: string = "ai-agent";

const init: PromiseVoidFunction = async (): Promise<void> => {
  try {
    // Initialize telemetry
    Telemetry.init({
      serviceName: APP_NAME,
    });

    // Initialize profiling (opt-in via ENABLE_PROFILING env var)
    Profiling.init({
      serviceName: APP_NAME,
    });

    logger.info("AI Agent Service - Starting...", { serviceName: APP_NAME } as LogAttributes);

    // init the app
    await App.init({
      appName: APP_NAME,
      port: PORT,
      isFrontendApp: false,
      statusOptions: {
        liveCheck: async () => {},
        readyCheck: async () => {},
      },
    });

    // Add metrics API routes for KEDA autoscaling
    const app: ExpressApplication = Express.getExpressApp();
    app.use("/metrics", MetricsAPI);

    // add default routes
    await App.addDefaultRoutes();

    try {
      // Register this AI Agent.
      await Register.registerAIAgent();

      logger.debug("AI Agent registered", { serviceName: APP_NAME } as LogAttributes);

      AliveJob();

      // Register task handlers
      logger.debug("Registering task handlers...", { serviceName: APP_NAME } as LogAttributes);
      const taskHandlerRegistry: ReturnType<typeof getTaskHandlerRegistry> =
        getTaskHandlerRegistry();
      taskHandlerRegistry.register(new FixExceptionTaskHandler());
      logger.debug(
        `Registered ${taskHandlerRegistry.getHandlerCount()} task handler(s): ${taskHandlerRegistry.getRegisteredTaskTypes().join(", ")}`,
        { serviceName: APP_NAME } as LogAttributes,
      );

      // Start task processing loop (runs in background)
      startTaskProcessingLoop().catch((err: Error) => {
        logger.error("Task processing loop failed:", { serviceName: APP_NAME } as LogAttributes);
        logger.error(err, { serviceName: APP_NAME } as LogAttributes);
      });
    } catch (err) {
      logger.error("Register AI Agent failed", { serviceName: APP_NAME } as LogAttributes);
      logger.error(err, { serviceName: APP_NAME } as LogAttributes);
      throw err;
    }
  } catch (err) {
    logger.error("App Init Failed:", { serviceName: APP_NAME } as LogAttributes);
    logger.error(err, { serviceName: APP_NAME } as LogAttributes);
    throw err;
  }
};

init().catch((err: Error) => {
  logger.error(err, { serviceName: APP_NAME } as LogAttributes);
  logger.error("Exiting node process", { serviceName: APP_NAME } as LogAttributes);
  process.exit(1);
});
