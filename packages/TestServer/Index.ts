import MainAPI from "./API/Main";
import SettingsAPI from "./API/Settings";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import App from "Common/Server/Utils/StartServer";
import Telemetry from "Common/Server/Utils/Telemetry";
import Profiling from "Common/Server/Utils/Profiling";
import "ejs";

const app: ExpressApplication = Express.getExpressApp();

const APP_NAME: string = "test-server";

app.use([`/${APP_NAME}`, "/"], MainAPI);
app.use([`/${APP_NAME}`, "/"], SettingsAPI);

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

    // init the app
    await App.init({
      appName: APP_NAME,
      port: undefined,
      isFrontendApp: false,
      statusOptions: {
        liveCheck: async () => {},
        readyCheck: async () => {},
      },
    });

    // add default routes
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
