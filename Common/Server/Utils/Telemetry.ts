import OpenTelemetryAPI, {
  /*
   * diag,
   * DiagConsoleLogger,
   * DiagLogLevel,
   */
  Meter,
  type AttributeValue,
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
import { Resource } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  LogRecordProcessor,
  type LoggerProviderConfig,
} from "@opentelemetry/sdk-logs";
import type { Resource as LogsResource } from "@opentelemetry/sdk-logs/node_modules/@opentelemetry/resources/build/src/Resource";
import {
  Aggregation,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import type { PushMetricExporter } from "@opentelemetry/sdk-metrics/build/src/export/MetricExporter";
import * as opentelemetry from "@opentelemetry/sdk-node";
import { SpanExporter } from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import URL from "../../Types/API/URL";
import Dictionary from "../../Types/Dictionary";
import { DisableTelemetry } from "../EnvironmentConfig";
import logger from "./Logger";

type ResourceWithRawAttributes = LogsResource & {
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
    return new Resource({
      [ATTR_SERVICE_NAME]: data.serviceName,
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

        // Force an SDK-side aggregation selector that matches the modern metrics API.
        if (
          typeof (metricExporter as { selectAggregation?: unknown })
            .selectAggregation === "function"
        ) {
          (
            metricExporter as unknown as {
              selectAggregation: (..._args: Array<unknown>) => Aggregation;
            }
          ).selectAggregation = () => {
            return Aggregation.Default();
          };
        }

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

      if (traceExporter) {
        nodeSdkConfiguration.traceExporter = traceExporter;
      }

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

      process.on("SIGTERM", () => {
        sdk.shutdown().finally(() => {
          return process.exit(0);
        });
      });

      sdk.start();

      this.sdk = sdk;
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

    // log the exception as well
    logger.error(exception);

    span.recordException(exception as SpanException);
    span.setStatus({
      code: SpanStatusCode.ERROR,
    });

    this.endSpan(span);
  }

  public static endSpan(span: Span): void {
    span.end();
  }
}
