import AliveAPI from "./API/Alive";
import FluentIngestAPI from "./API/FluentIngest";
import IncomingRequestAPI from "./API/IncomingRequest";
import MonitorAPI from "./API/Monitor";
import OTelIngestAPI from "./API/OTelIngest";
import Ingestor from "./API/Probe";
import RegisterAPI from "./API/Register";
import ServerMonitorAPI from "./API/ServerMonitor";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { ClickhouseAppInstance } from "Common/Server/Infrastructure/ClickhouseDatabase";
import { PostgresAppInstance } from "Common/Server/Infrastructure/PostgresDatabase";
import Redis from "Common/Server/Infrastructure/Redis";
import InfrastructureStatus from "Common/Server/Infrastructure/Status";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Realtime from "Common/Server/Utils/Realtime";
import App from "Common/Server/Utils/StartServer";
import Telemetry from "Common/Server/Utils/Telemetry";
import "ejs";

const app: ExpressApplication = Express.getExpressApp();

const APP_NAME: string = "ingestor";

app.use([`/${APP_NAME}`, "/"], AliveAPI);
app.use([`/${APP_NAME}`, "/"], RegisterAPI);
app.use([`/${APP_NAME}`, "/"], MonitorAPI);
app.use([`/${APP_NAME}`, "/"], Ingestor);
app.use([`/${APP_NAME}`, "/"], IncomingRequestAPI);
app.use([`/${APP_NAME}`, "/"], OTelIngestAPI);
app.use([`/${APP_NAME}`, "/"], FluentIngestAPI);
app.use([`/${APP_NAME}`, "/"], ServerMonitorAPI);

const init: PromiseVoidFunction = async (): Promise<void> => {
  try {
    const statusCheck: PromiseVoidFunction = async (): Promise<void> => {
      return await InfrastructureStatus.checkStatus({
        checkClickhouseStatus: true,
        checkPostgresStatus: true,
        checkRedisStatus: true,
      });
    };

    // Initialize telemetry
    Telemetry.init({
      serviceName: APP_NAME,
    });

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
