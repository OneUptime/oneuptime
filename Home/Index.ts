import HomeRoutes from "./Routes";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import InfrastructureStatus from "Common/Server/Infrastructure/Status";
import logger from "Common/Server/Utils/Logger";
import App from "Common/Server/Utils/StartServer";
import Telemetry from "Common/Server/Utils/Telemetry";
import Profiling from "Common/Server/Utils/Profiling";
import "ejs";

const APP_NAME: string = "home";

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

    const statusCheck: PromiseVoidFunction = async (): Promise<void> => {
      // Check the status of infrastructure components
      return await InfrastructureStatus.checkStatusWithRetry({
        checkClickhouseStatus: false,
        checkPostgresStatus: false,
        checkRedisStatus: false,
        retryCount: 3,
      });
    };

    // Initialize the app with service name and status checks
    await App.init({
      appName: APP_NAME,
      statusOptions: {
        liveCheck: statusCheck,
        readyCheck: statusCheck,
      },
    });

    // Initialize home routes at the end since it has a catch-all route
    await HomeRoutes.init();

    // Add default routes to the app
    await App.addDefaultRoutes();
  } catch (err) {
    logger.error("App Init Failed:", { service: APP_NAME });
    logger.error(err, { service: APP_NAME });
    throw err;
  }
};

init().catch((err: Error) => {
  logger.error(err, { service: APP_NAME });
  logger.error("Exiting node process", { service: APP_NAME });
  process.exit(1);
});
