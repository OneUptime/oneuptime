import Telemetry, {
  TelemetryCounter,
  TelemetryHistogram,
  TelemetryUpDownCounter,
} from "../Telemetry";

/**
 * Central catalog of metric instruments emitted by OneUptime services about
 * themselves (server-side observability of the OneUptime platform). All
 * instruments are lazy-created on first access and cached, so importing this
 * module from multiple call sites is safe.
 *
 * Naming follows OpenTelemetry semantic conventions where applicable, with a
 * `oneuptime.` prefix for application-specific signals.
 *
 * Cardinality rule: never attach high-cardinality identifiers (userId,
 * projectId, monitorId, requestId, raw URLs) to metric attributes — those
 * belong on traces and logs. Stick to bounded enums (method, status_code,
 * monitor type, queue name, channel, outcome).
 */
export default class AppMetrics {
  // -- HTTP server -------------------------------------------------------

  private static httpRequestCounter: TelemetryCounter | null = null;
  private static httpRequestDuration: TelemetryHistogram | null = null;
  private static httpRequestsInFlight: TelemetryUpDownCounter | null = null;

  public static getHttpRequestCounter(): TelemetryCounter {
    if (!this.httpRequestCounter) {
      this.httpRequestCounter = Telemetry.getCounter({
        name: "http.server.request.count",
        description:
          "Number of HTTP requests handled by the server, partitioned by method, route and status class.",
        unit: "1",
      });
    }

    return this.httpRequestCounter;
  }

  public static getHttpRequestDuration(): TelemetryHistogram {
    if (!this.httpRequestDuration) {
      this.httpRequestDuration = Telemetry.getHistogram({
        name: "http.server.request.duration",
        description: "Duration of HTTP server requests.",
        unit: "ms",
      });
    }

    return this.httpRequestDuration;
  }

  public static getHttpRequestsInFlight(): TelemetryUpDownCounter {
    if (!this.httpRequestsInFlight) {
      this.httpRequestsInFlight = Telemetry.getGauge({
        name: "http.server.active_requests",
        description: "Number of HTTP requests currently being processed.",
        unit: "1",
      });
    }

    return this.httpRequestsInFlight;
  }

  // -- Worker / background jobs -----------------------------------------

  private static workerJobCounter: TelemetryCounter | null = null;
  private static workerJobDuration: TelemetryHistogram | null = null;
  private static workerJobsInFlight: TelemetryUpDownCounter | null = null;

  public static getWorkerJobCounter(): TelemetryCounter {
    if (!this.workerJobCounter) {
      this.workerJobCounter = Telemetry.getCounter({
        name: "worker.job.count",
        description:
          "Number of background worker jobs processed, partitioned by queue, job name and outcome.",
        unit: "1",
      });
    }

    return this.workerJobCounter;
  }

  public static getWorkerJobDuration(): TelemetryHistogram {
    if (!this.workerJobDuration) {
      this.workerJobDuration = Telemetry.getHistogram({
        name: "worker.job.duration",
        description: "Duration of background worker job execution.",
        unit: "ms",
      });
    }

    return this.workerJobDuration;
  }

  public static getWorkerJobsInFlight(): TelemetryUpDownCounter {
    if (!this.workerJobsInFlight) {
      this.workerJobsInFlight = Telemetry.getGauge({
        name: "worker.job.active",
        description: "Number of worker jobs currently executing.",
        unit: "1",
      });
    }

    return this.workerJobsInFlight;
  }

  // -- Probe monitor checks ---------------------------------------------

  private static probeCheckCounter: TelemetryCounter | null = null;
  private static probeCheckDuration: TelemetryHistogram | null = null;

  public static getProbeCheckCounter(): TelemetryCounter {
    if (!this.probeCheckCounter) {
      this.probeCheckCounter = Telemetry.getCounter({
        name: "probe.monitor.check.count",
        description:
          "Number of monitor checks executed by the probe, partitioned by monitor type and outcome.",
        unit: "1",
      });
    }

    return this.probeCheckCounter;
  }

  public static getProbeCheckDuration(): TelemetryHistogram {
    if (!this.probeCheckDuration) {
      this.probeCheckDuration = Telemetry.getHistogram({
        name: "probe.monitor.check.duration",
        description: "Duration of probe monitor checks.",
        unit: "ms",
      });
    }

    return this.probeCheckDuration;
  }

  // -- Notification dispatch (Mail/SMS/Call/Push) -----------------------

  private static notificationCounter: TelemetryCounter | null = null;
  private static notificationDuration: TelemetryHistogram | null = null;

  public static getNotificationCounter(): TelemetryCounter {
    if (!this.notificationCounter) {
      this.notificationCounter = Telemetry.getCounter({
        name: "notification.send.count",
        description:
          "Number of notifications dispatched, partitioned by channel and outcome.",
        unit: "1",
      });
    }

    return this.notificationCounter;
  }

  public static getNotificationDuration(): TelemetryHistogram {
    if (!this.notificationDuration) {
      this.notificationDuration = Telemetry.getHistogram({
        name: "notification.send.duration",
        description: "Duration of notification dispatch calls.",
        unit: "ms",
      });
    }

    return this.notificationDuration;
  }

  // -- OTLP / telemetry ingestion ---------------------------------------

  private static ingestCounter: TelemetryCounter | null = null;
  private static ingestDuration: TelemetryHistogram | null = null;
  private static ingestPayloadBytes: TelemetryHistogram | null = null;

  public static getIngestCounter(): TelemetryCounter {
    if (!this.ingestCounter) {
      this.ingestCounter = Telemetry.getCounter({
        name: "telemetry.ingest.request.count",
        description:
          "Number of telemetry ingestion requests received, partitioned by signal and outcome.",
        unit: "1",
      });
    }

    return this.ingestCounter;
  }

  public static getIngestDuration(): TelemetryHistogram {
    if (!this.ingestDuration) {
      this.ingestDuration = Telemetry.getHistogram({
        name: "telemetry.ingest.request.duration",
        description: "Duration of telemetry ingestion request handling.",
        unit: "ms",
      });
    }

    return this.ingestDuration;
  }

  public static getIngestPayloadBytes(): TelemetryHistogram {
    if (!this.ingestPayloadBytes) {
      this.ingestPayloadBytes = Telemetry.getHistogram({
        name: "telemetry.ingest.request.payload.size",
        description:
          "Size of telemetry ingestion request payloads, after decompression.",
        unit: "By",
      });
    }

    return this.ingestPayloadBytes;
  }
}
