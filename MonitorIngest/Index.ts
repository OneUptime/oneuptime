import MonitorAPI from "./Services/ProbeIngest/API/Monitor";
import ProbeIngest from "./Services/ProbeIngest/API/Probe";
import RegisterAPI from "./Services/ProbeIngest/API/Register";
import MetricsAPI from "./Services/ProbeIngest/API/Metrics";
import IncomingEmailAPI from "./Services/ProbeIngest/API/IncomingEmail";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { ClickhouseAppInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import Redis from "Common/Server/Infrastructure/Redis";
import InfrastructureStatus from "Common/Server/Infrastructure/Status";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Realtime from "Common/Server/Utils/Realtime";
import App from "Common/Server/Utils/StartServer";
import Telemetry from "Common/Server/Utils/Telemetry";
import "./Services/ProbeIngest/Jobs/ProbeIngest/ProcessProbeIngest";
import { PROBE_INGEST_CONCURRENCY } from "./Config";
import "ejs";

const app: ExpressApplication = Express.getExpressApp();

const APP_NAME: string = "monitor-ingest";

// "/probe-ingest" and "/ingestor" are used for backward compatibility because probes are already deployed with these paths in client environments.
app.use([`/${APP_NAME}`, "/probe-ingest", "/ingestor", "/"], RegisterAPI);
app.use([`/${APP_NAME}`, "/probe-ingest", "/ingestor", "/"], MonitorAPI);
app.use([`/${APP_NAME}`, "/probe-ingest", "/ingestor", "/"], ProbeIngest);
app.use([`/${APP_NAME}`, "/probe-ingest", "/"], MetricsAPI);
app.use([`/${APP_NAME}`, "/probe-ingest", "/"], IncomingEmailAPI);

const init: PromiseVoidFunction = async (): Promise<void> => {
  try {
    const statusCheck: PromiseVoidFunction = async (): Promise<void> => {
      return await InfrastructureStatus.checkStatusWithRetry({
        checkClickhouseStatus: true,
        checkPostgresStatus: true,
        checkRedisStatus: true,
        retryCount: 3,
      });
    };

    // Initialize telemetry
    Telemetry.init({
      serviceName: APP_NAME,
    });

    logger.info(
      `MonitorIngest Service - Queue concurrency: ${PROBE_INGEST_CONCURRENCY}`,
    );

    // init the app
    await App.init({
      appName: APP_NAME,
      statusOptions: {
        liveCheck: statusCheck,
        readyCheck: statusCheck,
      },
    });

    // connect to the database.
    await PostgresAppInstance.connect();

    // connect redis
    await Redis.connect();

    await ClickhouseAppInstance.connect(
      ClickhouseAppInstance.getDatasourceOptions(),
    );

    await Realtime.init();

    // add default routes
    await App.addDefaultRoutes();
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
