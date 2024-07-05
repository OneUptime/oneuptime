import FluentIngestAPI from "../TelemetryIngestor/API/FluentIngest";
import OTelIngestAPI from "../TelemetryIngestor/API/OTelIngest";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { ClickhouseAppInstance } from "CommonServer/Infrastructure/ClickhouseDatabase";
import { PostgresAppInstance } from "CommonServer/Infrastructure/PostgresDatabase";
import Redis from "CommonServer/Infrastructure/Redis";
import InfrastructureStatus from "CommonServer/Infrastructure/Status";
import Express, { ExpressApplication } from "CommonServer/Utils/Express";
import logger from "CommonServer/Utils/Logger";
import Realtime from "CommonServer/Utils/Realtime";
import App from "CommonServer/Utils/StartServer";
import "ejs";

const app: ExpressApplication = Express.getExpressApp();

const APP_NAME: string = "telemetry-ingestor";

app.use([`/${APP_NAME}`, "/"], OTelIngestAPI);
app.use([`/${APP_NAME}`, "/"], FluentIngestAPI);

const init: PromiseVoidFunction = async (): Promise<void> => {
  try {
    const statusCheck: PromiseVoidFunction = async (): Promise<void> => {
      return await InfrastructureStatus.checkStatus({
        checkClickhouseStatus: true,
        checkPostgresStatus: true,
        checkRedisStatus: true,
      });
    };

    // init the app
    await App.init({
      appName: APP_NAME,
      statusOptions: {
        liveCheck: statusCheck,
        readyCheck: statusCheck,
      },
    });

    // connect to the database.
    await PostgresAppInstance.connect(
      PostgresAppInstance.getDatasourceOptions(),
    );

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
