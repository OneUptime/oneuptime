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

  // -- Telemetry discarded by project drop filters -----------------------

  private static ingestDroppedCounter: TelemetryCounter | null = null;

  /*
   * Records telemetry a project's own drop filters discarded at ingest.
   *
   * Before this existed, a drop filter deleted records with no trace
   * anywhere — no log line, no metric, no counter — so "my logs are
   * missing" tickets could not be distinguished from a broken pipeline
   * without reading the customer's filter rows by hand.
   *
   * Attributes carry `oneuptime.project.id` and `oneuptime.drop_filter.id`
   * on purpose: without them the counter says only "something dropped
   * telemetry", which is exactly the unanswerable state this replaces.
   * Cardinality stays bounded — projects times a handful of filters each,
   * and only projects that configured a filter ever emit a point.
   */
  public static getIngestDroppedCounter(): TelemetryCounter {
    if (!this.ingestDroppedCounter) {
      this.ingestDroppedCounter = Telemetry.getCounter({
        name: "oneuptime.telemetry.ingest.dropped.count",
        description:
          "Number of telemetry records discarded by a project's drop filters, partitioned by signal, action, project and filter.",
        unit: "1",
      });
    }

    return this.ingestDroppedCounter;
  }

  // -- On-call calendar feeds -------------------------------------------

  /*
   * The one bounded attribute these carry: which kind of feed was rendered.
   * "user" (personal), "schedule" (one schedule, shared link) or "project"
   * (every schedule in a project). Never the token, the user or the project
   * id -- those are unbounded and belong on traces and logs.
   */
  public static readonly ON_CALL_CALENDAR_FEED_KIND_ATTRIBUTE: string =
    "oneuptime.oncall_calendar.feed_kind";

  private static onCallCalendarRenderDuration: TelemetryHistogram | null = null;
  private static onCallCalendarRenderEvents: TelemetryHistogram | null = null;

  /*
   * Wall-clock time to materialise the shifts and serialise a feed body, on a
   * cache miss. Rendering expands every layer of every candidate schedule
   * across a window of up to 180 days, so this is the number that says whether
   * the render cap and the schedule-level cache are doing their job.
   */
  public static getOnCallCalendarRenderDuration(): TelemetryHistogram {
    if (!this.onCallCalendarRenderDuration) {
      this.onCallCalendarRenderDuration = Telemetry.getHistogram({
        name: "oncall_calendar_render_duration_ms",
        description:
          "Time taken to render an on-call calendar feed body on a cache miss, partitioned by feed kind.",
        unit: "ms",
      });
    }

    return this.onCallCalendarRenderDuration;
  }

  /*
   * How many VEVENTs a rendered feed carried. Distribution matters more than
   * the total: a fat tail near MAX_EVENTS means windows are being shrunk to
   * fit and subscribers are losing the far end of their calendar.
   */
  public static getOnCallCalendarRenderEvents(): TelemetryHistogram {
    if (!this.onCallCalendarRenderEvents) {
      this.onCallCalendarRenderEvents = Telemetry.getHistogram({
        name: "oncall_calendar_render_events",
        description:
          "Number of calendar events in a rendered on-call calendar feed, partitioned by feed kind.",
        unit: "1",
      });
    }

    return this.onCallCalendarRenderEvents;
  }
}
