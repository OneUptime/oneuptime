import { PORT } from "./Config";
import AliveJob from "./Jobs/Alive";
import startTaskProcessingLoop from "./Jobs/ProcessScheduledTasks";
import Register from "./Services/Register";
import {
  getTaskHandlerRegistry,
  FixExceptionTaskHandler,
} from "./TaskHandlers/Index";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import logger from "Common/Server/Utils/Logger";
import App from "Common/Server/Utils/StartServer";
import Telemetry from "Common/Server/Utils/Telemetry";
import "ejs";

const APP_NAME: string = "ai-agent";

const init: PromiseVoidFunction = async (): Promise<void> => {
  try {
    // Initialize telemetry
    Telemetry.init({
      serviceName: APP_NAME,
    });

    logger.info("AI Agent Service - Starting...");

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

    // add default routes
    await App.addDefaultRoutes();

    try {
      // Register this AI Agent.
      await Register.registerAIAgent();

      logger.debug("AI Agent registered");

      AliveJob();

      // Register task handlers
      logger.debug("Registering task handlers...");
      const taskHandlerRegistry = getTaskHandlerRegistry();
      taskHandlerRegistry.register(new FixExceptionTaskHandler());
      logger.debug(
        `Registered ${taskHandlerRegistry.getHandlerCount()} task handler(s): ${taskHandlerRegistry.getRegisteredTaskTypes().join(", ")}`,
      );

      // Start task processing loop (runs in background)
      startTaskProcessingLoop().catch((err: Error) => {
        logger.error("Task processing loop failed:");
        logger.error(err);
      });
    } catch (err) {
      logger.error("Register AI Agent failed");
      logger.error(err);
      throw err;
    }
  } catch (err) {
    logger.error("App Init Failed:");
    logger.error(err);
    throw err;
  }
};

init().catch((err: Error) => {
  logger.error(err);
  logger.error("Exiting node process");
  process.exit(1);
});
