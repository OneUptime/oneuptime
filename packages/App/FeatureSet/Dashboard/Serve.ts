import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import App from "Common/Server/Utils/StartServer";
import "ejs";

export const APP_NAME: string = "dashboard";

const app: ExpressApplication = Express.getExpressApp();

const init: PromiseVoidFunction = async (): Promise<void> => {
  try {
    // init the app
    await App.init({
      appName: APP_NAME,
      port: undefined,
      isFrontendApp: true,
      statusOptions: {
        liveCheck: async () => {},
        readyCheck: async () => {},
      },
    });

    // add default routes
    await App.addDefaultRoutes();
  } catch (err) {
    logger.error("App Init Failed:", { service: "dashboard" });
    logger.error(err, { service: "dashboard" });
    throw err;
  }
};

init().catch((err: Error) => {
  logger.error(err, { service: "dashboard" });
  logger.error("Exiting node process", { service: "dashboard" });
  process.exit(1);
});

export default app;
