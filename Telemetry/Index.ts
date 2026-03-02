import OTelIngestAPI from "./API/OTelIngest";
import MetricsAPI from "./API/Metrics";
import SyslogAPI from "./API/Syslog";
import FluentAPI from "./API/Fluent";
// ProbeIngest routes
import ProbeIngestRegisterAPI from "./API/ProbeIngest/Register";
import ProbeIngestMonitorAPI from "./API/ProbeIngest/Monitor";
import ProbeIngestAPI from "./API/ProbeIngest/Probe";
import IncomingEmailAPI from "./API/ProbeIngest/IncomingEmail";
// ServerMonitorIngest routes
import ServerMonitorAPI from "./API/ServerMonitorIngest/ServerMonitor";
// IncomingRequestIngest routes
import IncomingRequestAPI from "./API/IncomingRequestIngest/IncomingRequest";
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
import "./Jobs/TelemetryIngest/ProcessTelemetry";
import { TELEMETRY_CONCURRENCY } from "./Config";
import type { StatusAPIOptions } from "Common/Server/API/StatusAPI";
import "ejs";

const app: ExpressApplication = Express.getExpressApp();

const APP_NAME: string = "telemetry";
const TELEMETRY_PREFIXES: Array<string> = [`/${APP_NAME}`, "/"];

// Existing telemetry routes
app.use(TELEMETRY_PREFIXES, OTelIngestAPI);
app.use(TELEMETRY_PREFIXES, MetricsAPI);
app.use(TELEMETRY_PREFIXES, SyslogAPI);
app.use(TELEMETRY_PREFIXES, FluentAPI);

// ProbeIngest routes under ["/probe-ingest", "/ingestor", "/"]
// "/ingestor" is used for backward compatibility because probes are already deployed with this path in client environments.
const PROBE_INGEST_PREFIXES: Array<string> = ["/probe-ingest", "/ingestor", "/"];
app.use(PROBE_INGEST_PREFIXES, ProbeIngestRegisterAPI);
app.use(PROBE_INGEST_PREFIXES, ProbeIngestMonitorAPI);
app.use(PROBE_INGEST_PREFIXES, ProbeIngestAPI);
app.use(["/probe-ingest", "/"], IncomingEmailAPI);

// ServerMonitorIngest routes under ["/server-monitor-ingest", "/"]
const SERVER_MONITOR_PREFIXES: Array<string> = ["/server-monitor-ingest", "/"];
app.use(SERVER_MONITOR_PREFIXES, ServerMonitorAPI);

// IncomingRequestIngest routes under ["/incoming-request-ingest", "/"]
const INCOMING_REQUEST_PREFIXES: Array<string> = ["/incoming-request-ingest", "/"];
app.use(INCOMING_REQUEST_PREFIXES, IncomingRequestAPI);

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
      `Telemetry Service - Queue concurrency: ${TELEMETRY_CONCURRENCY}`,
    );

    // init the app
    const statusOptions: StatusAPIOptions = {
      liveCheck: statusCheck,
      readyCheck: statusCheck,
    };

    await App.init({
      appName: APP_NAME,
      statusOptions: statusOptions,
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
