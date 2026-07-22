import OTelIngestAPI from "./API/OTelIngest";
import MetricsAPI from "./API/Metrics";
import SyslogAPI from "./API/Syslog";
import FluentAPI from "./API/Fluent";
import PyroscopeAPI from "./API/Pyroscope";
import TelemetryWriterAPI from "./API/TelemetryWriter";
// ProbeIngest routes
import ProbeIngestRegisterAPI from "./API/ProbeIngest/Register";
import ProbeIngestMonitorAPI from "./API/ProbeIngest/Monitor";
import ProbeIngestDiscoveryScanAPI from "./API/ProbeIngest/DiscoveryScan";
import ProbeIngestAPI from "./API/ProbeIngest/Probe";
import ProbeIngestSyslogAPI from "./API/ProbeIngest/Syslog";
import ProbeIngestNetworkFlowAPI from "./API/ProbeIngest/NetworkFlow";
import IncomingEmailAPI from "./API/ProbeIngest/IncomingEmail";
// ServerMonitorIngest routes
import ServerMonitorAPI from "./API/ServerMonitorIngest/ServerMonitor";
// IncomingRequestIngest routes
import IncomingRequestAPI from "./API/IncomingRequestIngest/IncomingRequest";

import "./Jobs/TelemetryIngest/ProcessTelemetry";
import { TELEMETRY_CONCURRENCY } from "./Config";
import { startGrpcServer } from "./GrpcServer";
import { startMqttServer } from "./MqttServer";

import FeatureSet from "Common/Server/Types/FeatureSet";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import {
  createTelemetryWriterTransport,
  getTelemetryWriterUrl,
  isTelemetryWriterForwardingEnabled,
} from "Common/Server/Utils/Telemetry/TelemetryWriterClient";

const app: ExpressApplication = Express.getExpressApp();

/*
 * Install the remote insert transport at MODULE SCOPE, not in init():
 * ProcessTelemetry registers its BullMQ consumer at module load, so jobs can
 * start processing (and inserting) before the feature-set init() runs. The
 * synchronous module graph finishes evaluating before the event loop can
 * deliver any job, so installing here guarantees no insert ever bypasses the
 * writer tier on a forwarding pod.
 */
if (isTelemetryWriterForwardingEnabled()) {
  TelemetryFanInWriter.setInsertTransport(createTelemetryWriterTransport());
}

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
       * Internal cluster-key-protected insert endpoint for the
       * telemetry-writer tier (absolute path — reached service-to-service,
       * never via the public ingress). Mounted on every pod; pods that
       * forward (TELEMETRY_WRITER_URL set) refuse to serve it.
       */
      app.use("/", TelemetryWriterAPI);

      // Transport itself is installed at module scope above (boot-race note there).
      if (isTelemetryWriterForwardingEnabled()) {
        logger.info(
          `Telemetry Service - forwarding ClickHouse inserts to telemetry-writer tier at ${getTelemetryWriterUrl()}`,
          { service: "telemetry" },
        );
      }

      /*
       * ProbeIngest routes under ["/probe-ingest", "/ingestor", "/"]
       * "/ingestor" is used for backward compatibility because probes are already deployed with this path in client environments.
       */
      app.use(PROBE_INGEST_PREFIXES, ProbeIngestRegisterAPI);
      app.use(PROBE_INGEST_PREFIXES, ProbeIngestMonitorAPI);
      app.use(PROBE_INGEST_PREFIXES, ProbeIngestDiscoveryScanAPI);
      app.use(PROBE_INGEST_PREFIXES, ProbeIngestAPI);
      app.use(PROBE_INGEST_PREFIXES, ProbeIngestSyslogAPI);
      app.use(PROBE_INGEST_PREFIXES, ProbeIngestNetworkFlowAPI);
      app.use(["/probe-ingest", "/"], IncomingEmailAPI);

      // ServerMonitorIngest routes under ["/server-monitor-ingest", "/"]
      app.use(SERVER_MONITOR_PREFIXES, ServerMonitorAPI);

      // IncomingRequestIngest routes under ["/incoming-request-ingest", "/"]
      app.use(INCOMING_REQUEST_PREFIXES, IncomingRequestAPI);

      logger.info(
        `Telemetry Service - Queue concurrency: ${TELEMETRY_CONCURRENCY}`,
        { service: "telemetry" },
      );

      if (TelemetryIngestionDisabled.isDisabled()) {
        logger.warn(
          "DISABLE_TELEMETRY_INGESTION=true — telemetry ingestion endpoints will accept requests but drop all data.",
          { service: "telemetry" },
        );
      }

      // Start gRPC OTLP server on port 4317
      startGrpcServer();

      // Start MQTT ingest listeners (TCP 1883 + WebSocket /mqtt)
      startMqttServer();
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
