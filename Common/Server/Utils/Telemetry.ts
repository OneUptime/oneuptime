import OpenTelemetryAPI, {
  /*
   * diag,
   * DiagConsoleLogger,
   * DiagLogLevel,
   */
  Meter,
  type AttributeValue,
  type Attributes,
  type ObservableCounter,
  type ObservableGauge,
  type ObservableResult,
  type ObservableUpDownCounter,
  type UpDownCounter,
} from "@opentelemetry/api";
import { Logger, logs } from "@opentelemetry/api-logs";
import {
  Counter,
  Histogram,
  MetricOptions,
} from "@opentelemetry/api/build/src/metrics/Metric";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { AWSXRayIdGenerator } from "@opentelemetry/id-generator-aws-xray";
import { CompressionAlgorithm } from "@opentelemetry/otlp-exporter-base";
import { Resource, resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  LogRecordProcessor,
  type LoggerProviderConfig,
} from "@opentelemetry/sdk-logs";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import type { PushMetricExporter } from "@opentelemetry/sdk-metrics/build/src/export/MetricExporter";
import * as opentelemetry from "@opentelemetry/sdk-node";
import {
  BatchSpanProcessor,
  SpanExporter,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import URL from "../../Types/API/URL";
import Dictionary from "../../Types/Dictionary";
import { AppVersion, Env, DisableTelemetry } from "../EnvironmentConfig";
import logger from "./Logger";
import GracefulShutdown, { ShutdownPriority } from "./GracefulShutdown";
import ContextSpanProcessor from "./Telemetry/ContextSpanProcessor";
import ErrorClassResolver from "./Telemetry/ErrorClassResolver";
import ErrorClass, {
  isNonActionableErrorClass,
  markErrorReported,
} from "../../Types/Telemetry/ErrorClass";
import { ERROR_CLASS_ATTRIBUTE_KEY } from "../../Types/Telemetry/UnitOfWork";
import RuntimeMetrics from "./Telemetry/RuntimeMetrics";

type ResourceWithRawAttributes = Resource & {
  getRawAttributes?: () => Array<[string, AttributeValue | undefined]>;
};

/*
 * Enable this line to see debug logs
 * diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
 */

export type Span = opentelemetry.api.Span;
export type SpanStatus = opentelemetry.api.SpanStatus;
export type SpanException = opentelemetry.api.Exception;
export type SpanOptions = opentelemetry.api.SpanOptions;
export type TelemetryLogger = Logger;
export type TelemetryAttributes = opentelemetry.api.Attributes;
export type TelemetryCounter = Counter<opentelemetry.api.Attributes>;
export type TelemetryHistogram = Histogram<opentelemetry.api.Attributes>;
export type TelemetryUpDownCounter =
  UpDownCounter<opentelemetry.api.Attributes>;
export type TelemetryObservableGauge = ObservableGauge<Attributes>;
export type TelemetryObservableCounter = ObservableCounter<Attributes>;
export type TelemetryObservableUpDownCounter =
  ObservableUpDownCounter<Attributes>;
export type TelemetryObservableCallback = (
  result: ObservableResult<Attributes>,
) => void | Promise<void>;

export enum SpanStatusCode {
  UNSET = 0,
  OK = 1,
  ERROR = 2,
}

/*
 * Tells a descriptive error `code` ("ECONNREFUSED") from one that is really a
 * status number in disguise (an HTTP status, a Postgres SQLSTATE). See
 * Telemetry.getExceptionTypeName.
 */
const NUMERIC_ONLY_REGEX: RegExp = /^\d+$/;

export default class Telemetry {
  public static sdk: opentelemetry.NodeSDK | null = null;

  public static logger: Logger | null = null;

  public static meter: Meter | null = null;

  public static meterProvider: MeterProvider | null = null;

  public static loggerProvider: LoggerProvider | null = null;

  public static metricReader: PeriodicExportingMetricReader | undefined;

  public static serviceName: string | null = null;

  /*
   * True only when init() installed a real OTLP span exporter. @CaptureSpan
   * consults this to skip span creation entirely on deployments that never
   * export traces — without an exporter the spans go nowhere, but the wrapper
   * would still pay attribute flattening, span allocation, and an
   * AsyncLocalStorage context switch on every decorated call, which includes
   * hot ingest paths that run millions of times per minute.
   */
  private static spanExportEnabled: boolean = false;

  public static isSpanExportEnabled(): boolean {
    return this.spanExportEnabled;
  }

  public static getHeaders(): Dictionary<string> {
    if (!process.env["OPENTELEMETRY_EXPORTER_OTLP_HEADERS"]) {
      return {};
    }

    const headersStrings: Array<string> =
      process.env["OPENTELEMETRY_EXPORTER_OTLP_HEADERS"].split(";");

    const headers: Dictionary<string> = {};

    for (const headerString of headersStrings) {
      const header: Array<string> = headerString.split("=");
      if (header.length === 2) {
        headers[header[0]!.toString()] = header[1]!.toString();
      }
    }

    return headers;
  }

  public static getOtlpEndpoint(): URL | null {
    if (!process.env["OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT"]) {
      return null;
    }

    return URL.fromString(
      process.env["OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT"] || "",
    );
  }

  public static getOltpLogsEndpoint(): URL | null {
    const oltpEndpoint: URL | null = this.getOtlpEndpoint();

    if (!oltpEndpoint) {
      return null;
    }

    return URL.fromString(oltpEndpoint.toString() + "/v1/logs");
  }

  public static getOltpMetricsEndpoint(): URL | null {
    const oltpEndpoint: URL | null = this.getOtlpEndpoint();

    if (!oltpEndpoint) {
      return null;
    }

    return URL.fromString(oltpEndpoint.toString() + "/v1/metrics");
  }

  public static getOltpTracesEndpoint(): URL | null {
    const oltpEndpoint: URL | null = this.getOtlpEndpoint();

    if (!oltpEndpoint) {
      return null;
    }

    return URL.fromString(oltpEndpoint.toString() + "/v1/traces");
  }

  public static getResource(data: { serviceName: string }): Resource {
    return resourceFromAttributes({
      [ATTR_SERVICE_NAME]: data.serviceName,
      [ATTR_SERVICE_VERSION]: AppVersion,
      ["deployment.environment"]: Env,
    });
  }

  public static init(data: {
    serviceName: string;
  }): opentelemetry.NodeSDK | null {
    this.serviceName = data.serviceName;

    if (DisableTelemetry) {
      return null;
    }

    if (!this.sdk) {
      const headers: Dictionary<string> = this.getHeaders();

      const hasHeaders: boolean = Object.keys(headers).length > 0;

      let traceExporter: SpanExporter | undefined = undefined;

      if (this.getOltpTracesEndpoint() && hasHeaders) {
        traceExporter = new OTLPTraceExporter({
          url: this.getOltpTracesEndpoint()!.toString(),
          headers: headers,
          compression: CompressionAlgorithm.GZIP,
        }) as unknown as SpanExporter;
        this.spanExportEnabled = true;
      }

      if (this.getOltpMetricsEndpoint() && hasHeaders) {
        const metricExporter: PushMetricExporter = new OTLPMetricExporter({
          url: this.getOltpMetricsEndpoint()!.toString(),
          headers: headers,
          compression: CompressionAlgorithm.GZIP,
        }) as unknown as PushMetricExporter;

        /*
         * No aggregation-selector shim is needed anymore: the OTLP metric
         * exporter and the sdk-metrics package now come from the same release
         * line, so the exporter's default selector already matches the SDK.
         */
        this.metricReader = new PeriodicExportingMetricReader({
          exporter: metricExporter,
        });
      }

      const resource: Resource = this.getResource({
        serviceName: data.serviceName,
      });

      const logRecordProcessors: Array<LogRecordProcessor> = [];

      const loggerProviderResource: ResourceWithRawAttributes =
        resource as unknown as ResourceWithRawAttributes;

      if (typeof loggerProviderResource.getRawAttributes !== "function") {
        loggerProviderResource.getRawAttributes = () => {
          return Object.entries(resource.attributes) as Array<
            [string, AttributeValue | undefined]
          >;
        };
      }

      if (this.getOltpLogsEndpoint() && hasHeaders) {
        const logExporter: OTLPLogExporter = new OTLPLogExporter({
          url: this.getOltpLogsEndpoint()!.toString(),
          headers: headers,
          compression: CompressionAlgorithm.GZIP,
        });

        logRecordProcessors.push(new BatchLogRecordProcessor(logExporter));
      }

      const loggerProviderConfig: LoggerProviderConfig = {
        resource: loggerProviderResource,
      };

      if (logRecordProcessors.length > 0) {
        (
          loggerProviderConfig as LoggerProviderConfig & {
            processors?: Array<LogRecordProcessor>;
          }
        ).processors = logRecordProcessors;
      }

      this.loggerProvider = new LoggerProvider(loggerProviderConfig);

      logs.setGlobalLoggerProvider(this.loggerProvider);

      const nodeSdkConfiguration: Partial<opentelemetry.NodeSDKConfiguration> =
        {
          idGenerator: new AWSXRayIdGenerator(),
          instrumentations: [],
          resource:
            loggerProviderResource as unknown as opentelemetry.NodeSDKConfiguration["resource"],
          autoDetectResources: true,
        };

      /*
       * Always run the ContextSpanProcessor so the ambient TelemetryContext
       * attributes (projectId, userId, monitorId, incidentId, requestId, ...)
       * are stamped onto every span at creation. The BatchSpanProcessor that
       * actually exports spans is added after it, and only when an exporter is
       * configured. (traceExporter is deprecated in favour of spanProcessors.)
       */
      const spanProcessors: Array<SpanProcessor> = [new ContextSpanProcessor()];

      if (traceExporter) {
        spanProcessors.push(new BatchSpanProcessor(traceExporter));
      }

      nodeSdkConfiguration.spanProcessors = spanProcessors;

      /*
       * We will skip this becasue we're attachng this metric reader to the meter provider later.
       * if (this.metricReader) {
       *   nodeSdkConfiguration.metricReader = this.metricReader;
       * }
       */

      if (logRecordProcessors.length > 0) {
        (
          nodeSdkConfiguration as opentelemetry.NodeSDKConfiguration & {
            logRecordProcessors?: Array<LogRecordProcessor>;
          }
        ).logRecordProcessors = logRecordProcessors;
      }

      const sdk: opentelemetry.NodeSDK = new opentelemetry.NodeSDK(
        nodeSdkConfiguration,
      );

      this.getMeterProvider();
      this.getMeter();

      /*
       * Flush traces / metrics / logs last (Telemetry tier) so spans and logs
       * emitted by the rest of the shutdown still get exported. GracefulShutdown
       * owns process.exit now — this handler must NOT call it itself, or it
       * would race the other tiers and abandon the datastore pools (the exact
       * bug this replaced).
       */
      GracefulShutdown.registerHandler(
        "Telemetry",
        ShutdownPriority.Telemetry,
        () => {
          return sdk.shutdown();
        },
      );

      sdk.start();

      this.sdk = sdk;

      try {
        RuntimeMetrics.init();
      } catch (err) {
        logger.error("Failed to initialize runtime metrics");
        logger.error(err);
      }
    }

    return this.sdk;
  }

  public static getLogger(): Logger | null {
    if (!this.loggerProvider) {
      return null;
    }

    return this.loggerProvider.getLogger("default");
  }

  public static getMeterProvider(): MeterProvider {
    if (!this.meterProvider) {
      this.meterProvider = new MeterProvider({
        resource: this.getResource({
          serviceName: this.serviceName || "default",
        }),
        readers: this.metricReader ? [this.metricReader] : [],
      });

      OpenTelemetryAPI.metrics.setGlobalMeterProvider(this.meterProvider);
    }

    return this.meterProvider;
  }

  public static getMeter(): Meter {
    if (!this.meter) {
      this.meter = OpenTelemetryAPI.metrics.getMeter("default");
    }

    return this.meter;
  }

  public static getCounter(data: {
    name: string;
    description: string;
    unit?: string;
  }): Counter {
    const { name, description } = data;

    const metricOptions: MetricOptions = {
      description: description,
    };

    if (data.unit) {
      metricOptions.unit = data.unit;
    }

    const counter: Counter<opentelemetry.api.Attributes> =
      this.getMeter().createCounter(name, metricOptions);

    return counter;
  }

  // guage

  public static getGauge(data: {
    name: string;
    description: string;
    unit?: string;
  }): opentelemetry.api.UpDownCounter<opentelemetry.api.Attributes> {
    const { name, description } = data;

    const metricOptions: MetricOptions = {
      description: description,
    };

    if (data.unit) {
      metricOptions.unit = data.unit;
    }

    const guage: opentelemetry.api.UpDownCounter<opentelemetry.api.Attributes> =
      this.getMeter().createUpDownCounter(name, metricOptions);

    return guage;
  }

  // histogram

  public static getHistogram(data: {
    name: string;
    description: string;
    unit?: string;
  }): Histogram {
    const { name, description } = data;

    const metricOptions: MetricOptions = {
      description: description,
    };

    if (data.unit) {
      metricOptions.unit = data.unit;
    }

    const histogram: Histogram<opentelemetry.api.Attributes> =
      this.getMeter().createHistogram(name, metricOptions);

    return histogram;
  }

  public static getObservableGauge(data: {
    name: string;
    description: string;
    unit?: string;
    callback: TelemetryObservableCallback;
  }): TelemetryObservableGauge {
    const metricOptions: MetricOptions = {
      description: data.description,
    };

    if (data.unit) {
      metricOptions.unit = data.unit;
    }

    const gauge: TelemetryObservableGauge =
      this.getMeter().createObservableGauge(data.name, metricOptions);

    gauge.addCallback(data.callback);

    return gauge;
  }

  public static getObservableCounter(data: {
    name: string;
    description: string;
    unit?: string;
    callback: TelemetryObservableCallback;
  }): TelemetryObservableCounter {
    const metricOptions: MetricOptions = {
      description: data.description,
    };

    if (data.unit) {
      metricOptions.unit = data.unit;
    }

    const counter: TelemetryObservableCounter =
      this.getMeter().createObservableCounter(data.name, metricOptions);

    counter.addCallback(data.callback);

    return counter;
  }

  public static getObservableUpDownCounter(data: {
    name: string;
    description: string;
    unit?: string;
    callback: TelemetryObservableCallback;
  }): TelemetryObservableUpDownCounter {
    const metricOptions: MetricOptions = {
      description: data.description,
    };

    if (data.unit) {
      metricOptions.unit = data.unit;
    }

    const counter: TelemetryObservableUpDownCounter =
      this.getMeter().createObservableUpDownCounter(data.name, metricOptions);

    counter.addCallback(data.callback);

    return counter;
  }

  public static isMetricsEnabled(): boolean {
    if (DisableTelemetry) {
      return false;
    }

    return Boolean(this.metricReader);
  }

  public static getTracer(): opentelemetry.api.Tracer {
    const tracer: opentelemetry.api.Tracer =
      OpenTelemetryAPI.trace.getTracer("default");
    return tracer;
  }

  public static startActiveSpan<T>(data: {
    name: string;
    options?: SpanOptions | undefined;
    fn: (span: Span) => T;
  }): T {
    const { name } = data;

    return this.getTracer().startActiveSpan(name, data.options || {}, data.fn);
  }

  /*
   * Span event names. The exception name is load-bearing: the ingest side
   * mints an ExceptionInstance row and a TelemetryException group for every
   * span event literally named "exception" (OtelTracesIngestService
   * getSpanEvents), with no severity, status or handled/unhandled filter. An
   * event under any OTHER name is still pushed to the span's `events` column
   * and still renders in the Traces UI — it simply never becomes an Issue.
   *
   * That is the entire mechanism by which a user error stops paging us, and
   * it needs no ingest change, no schema change and no migration.
   */
  private static readonly SPAN_EVENT_EXCEPTION: string = "exception";
  private static readonly SPAN_EVENT_FAULT: string = "fault";

  private static faultCounter: TelemetryCounter | null = null;

  /**
   * Record a thrown value on a span AND end the span.
   *
   * Kept as the name every @CaptureSpan frame calls, so the decorator's
   * contract is unchanged.
   */
  public static recordExceptionMarkSpanAsErrorAndEndSpan(data: {
    span: Span;
    exception: unknown;
  }): void {
    try {
      this.recordExceptionOnSpan(data);
    } finally {
      this.endSpan(data.span);
    }
  }

  /**
   * Record a thrown value on a span WITHOUT ending it, for callers that own
   * the span's lifetime (QueueWorker's root job span ends it in its own
   * `finally`).
   *
   * What this does, and why each part matters:
   *
   * 1. RESOLVES A FAULT DOMAIN. code-fault and infrastructure are real
   *    failures and behave exactly as before. user-error and expected-denial
   *    are the platform correctly refusing a request, so they get a `fault`
   *    event instead of an `exception` event and the span status is left
   *    alone.
   *
   * 2. REPORTS ONCE PER THROWN VALUE. One error crossing N decorated frames
   *    used to emit N exception events and N logger.error lines. The
   *    fingerprint hashes no spanId and no span name, so all N landed in the
   *    same group and occuranceCount jumped by the depth of the call stack
   *    (measured: 3 for a create with a missing field, 6 for a
   *    permission-denied get-list). Outer frames still set ERROR status and
   *    still carry the queryable exception.* attributes, so the trace shows
   *    the full error path — only the duplicate EVENT and the duplicate LOG
   *    are suppressed.
   *
   * 3. BUILDS THE EVENT ITSELF rather than calling span.recordException. The
   *    SDK reads `exception.code` BEFORE `exception.name` when deciding
   *    `exception.type` (sdk-trace-base Span.recordException), and every
   *    OneUptime ExceptionCode IS an HTTP status — so exceptions were being
   *    typed "401"/"400"/"500". Constructing the event here removes that trap
   *    structurally instead of relying on every caller to normalize first.
   *
   * 4. COUNTS EVERYTHING. `oneuptime.fault.count` is incremented for every
   *    class, suppressed or not, so suppression is never invisible. A metric
   *    also outlives trace retention, which a span event does not.
   *
   * Never throws: this is the universal catch path, and a throw here would
   * mask the original error.
   */
  public static recordExceptionOnSpan(data: {
    span: Span;
    exception: unknown;
  }): void {
    const { span, exception } = data;

    try {
      const exceptionAttributes: Attributes =
        this.getExceptionAttributes(exception);

      const errorClass: ErrorClass = ErrorClassResolver.resolve(exception);
      const alreadyReported: boolean = markErrorReported(exception);

      const exceptionType: string =
        (exceptionAttributes["exception.type"] as string) || "Error";
      const exceptionMessage: string =
        (exceptionAttributes["exception.message"] as string) || "";

      if (!alreadyReported) {
        // Logger applies the same classification and demotes to WARN severity.
        logger.error(exception);
      }

      /*
       * Span *events* are not reliably surfaced when the span is read back,
       * and setStatus on its own only records the error CODE, not the message.
       * So the exception details are also attached as queryable span
       * attributes — including DB driver fields like the failing constraint
       * and table — so the actual cause is visible in the trace UI instead of
       * an empty "Error" status. Done for every class, on every frame: it is
       * what makes `attributes.exception.type` usable as a drop-filter
       * predicate at any depth.
       */
      span.setAttributes({
        ...exceptionAttributes,
        [ERROR_CLASS_ATTRIBUTE_KEY]: errorClass,
      });

      if (!isNonActionableErrorClass(errorClass)) {
        if (!alreadyReported) {
          span.addEvent(this.SPAN_EVENT_EXCEPTION, {
            "exception.type": exceptionType,
            "exception.message": exceptionMessage,
            ...(exceptionAttributes["exception.stacktrace"]
              ? {
                  "exception.stacktrace": exceptionAttributes[
                    "exception.stacktrace"
                  ] as string,
                }
              : {}),
          });
        }

        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: exceptionMessage || "Error",
        });
      } else if (!alreadyReported) {
        /*
         * Deliberately NOT named "exception" and deliberately carrying no
         * `exception.*` keys: the first stops the trace ingest path from
         * building an Issue, the second stops LogExceptionExtractor Path A
         * from resurrecting one out of a log record. The event is still
         * stored and still rendered.
         *
         * No setStatus at all. OTel says a 4xx on a SERVER span must stay
         * Unset, and setStatus({code: UNSET}) is a documented no-op — so
         * "leave it unset" is implemented as "do not call it".
         */
        span.addEvent(this.SPAN_EVENT_FAULT, {
          [ERROR_CLASS_ATTRIBUTE_KEY]: errorClass,
          "error.type": exceptionType,
          "error.message": exceptionMessage,
          ...(exceptionAttributes["exception.code"]
            ? {
                "error.code": exceptionAttributes["exception.code"] as string,
              }
            : {}),
        });
      }

      this.incrementFaultCounter(errorClass, exceptionType);
    } catch {
      // Enrichment failed on some exotic thrown value — still flag the span.
      try {
        span.setStatus({ code: SpanStatusCode.ERROR });
      } catch {
        // span may already be ended; nothing more we can do.
      }
    }
  }

  /*
   * Built lazily and through Telemetry.getCounter directly rather than through
   * AppMetrics — AppMetrics imports Telemetry, so registering there would
   * close an import cycle on the error path.
   */
  private static incrementFaultCounter(
    errorClass: ErrorClass,
    exceptionType: string,
  ): void {
    try {
      if (!this.faultCounter) {
        this.faultCounter = this.getCounter({
          name: "oneuptime.fault.count",
          description:
            "Faults by fault domain and type, including the ones deliberately kept out of the Issues list.",
          unit: "1",
        });
      }

      this.faultCounter.add(1, {
        [ERROR_CLASS_ATTRIBUTE_KEY]: errorClass,
        "error.type": exceptionType,
      });
    } catch {
      // Metrics must never break the error path.
    }
  }

  /*
   * Pulls every useful field off an unknown thrown value into OpenTelemetry
   * span attributes. Error message/stack are non-enumerable, so they are read
   * explicitly. For database failures (TypeORM QueryFailedError / pg errors),
   * the Postgres fields (SQLSTATE code, detail, constraint, table, column) live
   * either on the error itself or on `driverError`; these are what tell us which
   * constraint failed during e.g. a cascade delete.
   *
   * The thrown value is `unknown`, so anything (a Proxy, an object with a
   * throwing getter or a throwing toString) could be passed — every field read
   * and string coercion is guarded so this can never throw on the error path.
   */
  private static getExceptionAttributes(exception: unknown): Attributes {
    const attributes: Attributes = {};

    try {
      if (exception === null || exception === undefined) {
        attributes["exception.message"] =
          "Unknown error: null or undefined was thrown";
        return attributes;
      }

      if (exception instanceof Error) {
        attributes["exception.type"] = this.getExceptionTypeName(exception);
        attributes["exception.message"] = this.truncate(
          exception.message || "",
          4000,
        );
        if (exception.stack) {
          attributes["exception.stacktrace"] = this.truncate(
            exception.stack,
            8000,
          );
        }
      } else if (typeof exception === "string") {
        attributes["exception.message"] = this.truncate(exception, 4000);
      } else {
        attributes["exception.message"] = this.truncate(
          this.safeStringify(exception),
          4000,
        );
      }

      type PotentialDatabaseError = {
        code?: unknown;
        detail?: unknown;
        constraint?: unknown;
        table?: unknown;
        column?: unknown;
        schema?: unknown;
        query?: unknown;
        driverError?: PotentialDatabaseError;
      };

      const error: PotentialDatabaseError = exception as PotentialDatabaseError;
      const databaseError: PotentialDatabaseError = error.driverError || error;

      const setStringAttribute: (key: string, value: unknown) => void = (
        key: string,
        value: unknown,
      ): void => {
        try {
          if (value !== undefined && value !== null && value !== "") {
            attributes[key] = this.truncate(String(value), 2000);
          }
        } catch {
          // A single unserializable field must not abort the whole enrichment.
        }
      };

      // SQLSTATE (e.g. "23503" = foreign key violation) or a Node error code.
      setStringAttribute("exception.code", error.code ?? databaseError.code);
      setStringAttribute("db.error.detail", databaseError.detail);
      setStringAttribute("db.error.constraint", databaseError.constraint);
      setStringAttribute("db.error.table", databaseError.table);
      setStringAttribute("db.error.column", databaseError.column);
      setStringAttribute("db.error.schema", databaseError.schema);

      if (typeof error.query === "string" && error.query.length > 0) {
        attributes["db.statement"] = this.truncate(error.query, 2000);
      }
    } catch {
      /*
       * Reading exotic thrown values (throwing getters, Proxies) must never
       * crash the error-reporting path. Keep whatever was collected so far.
       */
      if (!attributes["exception.message"]) {
        attributes["exception.message"] =
          "Error (exception details could not be extracted)";
      }
    }

    return attributes;
  }

  /*
   * The most specific type name available for a thrown Error, in the order a
   * human would want to read it in the Issues list.
   *
   * `name` is checked first but "Error" is rejected: an Error subclass that
   * never assigns `this.name` inherits the generic "Error" from
   * Error.prototype, and OneUptime's own Exception base does exactly that —
   * so `name` alone reports "Error" for NotAuthenticatedException,
   * BadDataException and every other one of them.
   *
   * A `code` is only used when it is a NON-NUMERIC string. That keeps the
   * genuinely descriptive Node system codes (ECONNREFUSED, ENOTFOUND) while
   * rejecting numeric ones — HTTP statuses on OneUptime's Exception and
   * Postgres SQLSTATEs ("23505"), for which the constructor name
   * (QueryFailedError) says far more. The numeric code is not lost — it keeps
   * its own `exception.code` attribute.
   *
   * Never throws: it runs on the universal error path and the thrown value
   * can be a Proxy or carry throwing getters.
   */
  private static getExceptionTypeName(exception: Error): string {
    try {
      const name: unknown = exception.name;
      if (typeof name === "string" && name.trim() !== "" && name !== "Error") {
        return name;
      }

      const code: unknown = (exception as { code?: unknown }).code;
      if (
        typeof code === "string" &&
        code.trim() !== "" &&
        !NUMERIC_ONLY_REGEX.test(code.trim())
      ) {
        return code.trim();
      }

      const constructorName: unknown = exception.constructor?.name;
      if (
        typeof constructorName === "string" &&
        constructorName.trim() !== "" &&
        constructorName !== "Object"
      ) {
        return constructorName;
      }
    } catch {
      // Fall through to the generic name below.
    }

    return "Error";
  }

  private static truncate(value: string, maxLength: number): string {
    return value.length > maxLength ? value.substring(0, maxLength) : value;
  }

  private static safeStringify(value: unknown): string {
    try {
      const serialized: string | undefined = JSON.stringify(value);
      if (serialized) {
        return serialized;
      }
    } catch {
      // fall through to String() below
    }

    try {
      return String(value);
    } catch {
      return "[unserializable error value]";
    }
  }

  /*
   * Ending a span twice makes the SDK log
   * "You can only call end() on a span once" via diag. That happened on EVERY
   * error path: the recorder's finally ended the span, and CaptureSpan then
   * ended it again in its own finally / .finally(). Guard here rather than at
   * the call sites so any future caller is safe too.
   */
  public static endSpan(span: Span): void {
    try {
      const endTime: unknown = (span as unknown as { endTime?: Array<number> })
        .endTime;

      /*
       * sdk-trace-base sets endTime to [0, 0] until the span ends. A span
       * implementation that does not expose it (a no-op span, a test double)
       * falls through and is ended normally.
       */
      if (
        Array.isArray(endTime) &&
        endTime.length === 2 &&
        !(endTime[0] === 0 && endTime[1] === 0)
      ) {
        return;
      }
    } catch {
      // Fall through and end it.
    }

    span.end();
  }
}
