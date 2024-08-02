import { PROBE_MONITORING_WORKERS } from "./Config";
import "./Jobs/Alive";
import FetchListAndProbe from "./Jobs/Monitor/FetchList";
import Register from "./Services/Register";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Sleep from "Common/Types/Sleep";
import logger from "CommonServer/Utils/Logger";
import App from "CommonServer/Utils/StartServer";
import Telemetry from "CommonServer/Utils/Telemetry";
import "ejs";

const APP_NAME: string = "probe";

const init: PromiseVoidFunction = async (): Promise<void> => {
  try {
    // Initialize telemetry
    Telemetry.init({
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

    try {
      // Register this probe.
      await Register.registerProbe();

      logger.debug("Probe registered");

      await Register.reportIfOffline();
    } catch (err) {
      logger.error("Register probe failed");
      logger.error(err);
      throw err;
    }

    try {
      let workers: number = 0;

      while (workers < PROBE_MONITORING_WORKERS) {
        workers++;

        const currentWorker: number = workers;

        logger.debug(`Starting worker ${currentWorker}`);

        new FetchListAndProbe("Worker " + currentWorker)
          .run()
          .catch((err: any) => {
            logger.error(`Worker ${currentWorker} failed: `);
            logger.error(err);
          });

        await Sleep.sleep(1000);
      }
    } catch (err) {
      logger.error("Starting workers failed");
      logger.error(err);
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
