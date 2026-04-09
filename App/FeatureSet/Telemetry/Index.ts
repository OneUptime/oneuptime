import OTelIngestAPI from "./API/OTelIngest";
import MetricsAPI from "./API/Metrics";
import SyslogAPI from "./API/Syslog";
import FluentAPI from "./API/Fluent";
import PyroscopeAPI from "./API/Pyroscope";
// ProbeIngest routes
import ProbeIngestRegisterAPI from "./API/ProbeIngest/Register";
import ProbeIngestMonitorAPI from "./API/ProbeIngest/Monitor";
import ProbeIngestAPI from "./API/ProbeIngest/Probe";
import IncomingEmailAPI from "./API/ProbeIngest/IncomingEmail";
// ServerMonitorIngest routes
import ServerMonitorAPI from "./API/ServerMonitorIngest/ServerMonitor";
// IncomingRequestIngest routes
import IncomingRequestAPI from "./API/IncomingRequestIngest/IncomingRequest";

import "./Jobs/TelemetryIngest/ProcessTelemetry";
import { TELEMETRY_CONCURRENCY } from "./Config";
import { startGrpcServer } from "./GrpcServer";

import FeatureSet from "Common/Server/Types/FeatureSet";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";

const app: ExpressApplication = Express.getExpressApp();

const TELEMETRY_PREFIXES: Array<string> = ["/telemetry", "/"];
const PROBE_INGEST_PREFIXES: Array<string> = [
  "/probe-ingest",
  "/ingestor",
  "/",
];
const SERVER_MONITOR_PREFIXES: Array<string> = ["/server-monitor-ingest", "/"];
const INCOMING_REQUEST_PREFIXES: Array<string> = [
  "/incoming-request-ingest",
  "/",
];

const TelemetryFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    try {
      /*
       * Mount telemetry routes only during feature-set init so they sit behind
       * the shared middleware stack from StartServer (body parsers, headers, etc.).
       */
      app.use(TELEMETRY_PREFIXES, OTelIngestAPI);
      app.use(TELEMETRY_PREFIXES, MetricsAPI);
      app.use(TELEMETRY_PREFIXES, SyslogAPI);
      app.use(TELEMETRY_PREFIXES, FluentAPI);
      app.use(TELEMETRY_PREFIXES, PyroscopeAPI);

      /*
       * ProbeIngest routes under ["/probe-ingest", "/ingestor", "/"]
       * "/ingestor" is used for backward compatibility because probes are already deployed with this path in client environments.
       */
      app.use(PROBE_INGEST_PREFIXES, ProbeIngestRegisterAPI);
      app.use(PROBE_INGEST_PREFIXES, ProbeIngestMonitorAPI);
      app.use(PROBE_INGEST_PREFIXES, ProbeIngestAPI);
      app.use(["/probe-ingest", "/"], IncomingEmailAPI);

      // ServerMonitorIngest routes under ["/server-monitor-ingest", "/"]
      app.use(SERVER_MONITOR_PREFIXES, ServerMonitorAPI);

      // IncomingRequestIngest routes under ["/incoming-request-ingest", "/"]
      app.use(INCOMING_REQUEST_PREFIXES, IncomingRequestAPI);

      logger.info(
        `Telemetry Service - Queue concurrency: ${TELEMETRY_CONCURRENCY}`,
        { service: "telemetry" },
      );

      // Start gRPC OTLP server on port 4317
      startGrpcServer();
    } catch (err) {
      logger.error("Telemetry FeatureSet Init Failed:", {
        service: "telemetry",
      });
      logger.error(err, { service: "telemetry" });
      throw err;
    }
  },
};

export default TelemetryFeatureSet;
