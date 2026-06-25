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

export default class Telemetry {
  public static sdk: opentelemetry.NodeSDK | null = null;

  public static logger: Logger | null = null;

  public static meter: Meter | null = null;

  public static meterProvider: MeterProvider | null = null;

  public static loggerProvider: LoggerProvider | null = null;

  public static metricReader: PeriodicExportingMetricReader | undefined;

  public static serviceName: string | null = null;

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

  public static recordExceptionMarkSpanAsErrorAndEndSpan(data: {
    span: Span;
    exception: unknown;
  }): void {
    const { span, exception } = data;

    const exceptionAttributes: Attributes =
      this.getExceptionAttributes(exception);

    // log the exception as well
    logger.error(exception);

    /*
     * Span *events* (from recordException) are not reliably surfaced when the
     * span is read back, and setStatus on its own only records the error CODE,
     * not the message. So we also attach the exception details as queryable
     * span attributes — including DB driver fields like the failing constraint
     * and table — so the actual cause is visible in the trace UI instead of an
     * empty "Error" status.
     */
    span.setAttributes(exceptionAttributes);
    span.recordException(exception as SpanException);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message:
        (exceptionAttributes["exception.message"] as string | undefined) ||
        "Error",
    });

    this.endSpan(span);
  }

  /*
   * Pulls every useful field off an unknown thrown value into OpenTelemetry
   * span attributes. Error message/stack are non-enumerable, so they are read
   * explicitly. For database failures (TypeORM QueryFailedError / pg errors),
   * the Postgres fields (SQLSTATE code, detail, constraint, table, column) live
   * either on the error itself or on `driverError`; these are what tell us which
   * constraint failed during e.g. a cascade delete.
   */
  private static getExceptionAttributes(exception: unknown): Attributes {
    const attributes: Attributes = {};

    if (exception === null || exception === undefined) {
      attributes["exception.message"] =
        "Unknown error: null or undefined was thrown";
      return attributes;
    }

    if (exception instanceof Error) {
      attributes["exception.type"] =
        exception.name || exception.constructor?.name || "Error";
      attributes["exception.message"] = exception.message || "";
      if (exception.stack) {
        attributes["exception.stacktrace"] = exception.stack.substring(0, 8000);
      }
    } else if (typeof exception === "string") {
      attributes["exception.message"] = exception;
    } else {
      attributes["exception.message"] = this.safeStringify(exception);
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
      if (value !== undefined && value !== null && value !== "") {
        attributes[key] = String(value);
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
      attributes["db.statement"] = error.query.substring(0, 2000);
    }

    return attributes;
  }

  private static safeStringify(value: unknown): string {
    try {
      return JSON.stringify(value) || String(value);
    } catch {
      return String(value);
    }
  }

  public static endSpan(span: Span): void {
    span.end();
  }
}
