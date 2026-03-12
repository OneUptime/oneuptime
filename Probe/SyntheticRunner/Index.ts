import { PORT, SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS } from "./Config";
import SyntheticMonitorAPI from "./API/SyntheticMonitor";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import logger from "Common/Server/Utils/Logger";
import App from "Common/Server/Utils/StartServer";
import Telemetry from "Common/Server/Utils/Telemetry";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import "ejs";

const APP_NAME: string = "synthetic-runner";

const init: PromiseVoidFunction = async (): Promise<void> => {
  try {
    Telemetry.init({
      serviceName: APP_NAME,
    });

    logger.info(
      `Synthetic Runner Service - Script timeout: ${SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS}ms`,
    );

    await App.init({
      appName: APP_NAME,
      port: PORT,
      isFrontendApp: false,
      statusOptions: {
        liveCheck: async () => {},
        readyCheck: async () => {},
      },
    });

    const app: ExpressApplication = Express.getExpressApp();
    app.use("/synthetic-monitor", SyntheticMonitorAPI);

    await App.addDefaultRoutes();
  } catch (err: unknown) {
    logger.error("Synthetic runner init failed:");
    logger.error(err);
    throw err;
  }
};

init().catch((err: Error) => {
  logger.error(err);
  logger.error("Exiting node process");
  process.exit(1);
});
