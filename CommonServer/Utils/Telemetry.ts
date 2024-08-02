import OpenTelemetryAPI, { Meter } from "@opentelemetry/api";
import { Logger, logs } from "@opentelemetry/api-logs";
import {
  Counter,
  Histogram,
  MetricOptions,
} from "@opentelemetry/api/build/src/metrics/Metric";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { AWSXRayIdGenerator } from "@opentelemetry/id-generator-aws-xray";
import { CompressionAlgorithm } from "@opentelemetry/otlp-exporter-base";
import { Resource } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import * as opentelemetry from "@opentelemetry/sdk-node";
import { SpanExporter } from "@opentelemetry/sdk-trace-node";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";

// Enable this line to see debug logs
// diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);

const serviceName: string = process.env["SERVICE_NAME"] || "oneuptime";

export default class Telemetry {
  public static sdk: opentelemetry.NodeSDK | null = null;
  public static logger: Logger | null = null;
  public static meter: Meter | null = null;
  public static meterProvider: MeterProvider | null = null;

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
      [SemanticResourceAttributes.SERVICE_NAME]: data.serviceName,
    });
  }

  public static init(data: { serviceName: string }): opentelemetry.NodeSDK {
    if (!this.sdk) {
      const headers: Dictionary<string> = this.getHeaders();

      const hasHeaders: boolean = Object.keys(headers).length > 0;

      let traceExporter: SpanExporter | undefined = undefined;

      let metricReader: PeriodicExportingMetricReader | undefined = undefined;

      if (this.getOltpTracesEndpoint() && hasHeaders) {
        traceExporter = new OTLPTraceExporter({
          url: this.getOltpTracesEndpoint()!.toString(),
          headers: headers,
          compression: CompressionAlgorithm.GZIP,
        });
      }

      if (this.getOltpMetricsEndpoint() && hasHeaders) {
        metricReader = new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            url: this.getOltpMetricsEndpoint()!.toString(),
            headers: headers,
            compression: CompressionAlgorithm.GZIP,
          }),
        });
      }

      const loggerProvider: LoggerProvider = new LoggerProvider({
        resource: this.getResource({
          serviceName: data.serviceName,
        }),
      });

      if (this.getOltpLogsEndpoint() && hasHeaders) {
        const logExporter: OTLPLogExporter = new OTLPLogExporter({
          url: this.getOltpLogsEndpoint()!.toString(),
          headers: headers,
          compression: CompressionAlgorithm.GZIP,
        });

        loggerProvider.addLogRecordProcessor(
          new BatchLogRecordProcessor(logExporter),
        );
      }

      logs.setGlobalLoggerProvider(loggerProvider);

      this.logger = logs.getLogger("default");

      const nodeSdkConfiguration: Partial<opentelemetry.NodeSDKConfiguration> =
        {
          idGenerator: new AWSXRayIdGenerator(),
          instrumentations: hasHeaders ? [getNodeAutoInstrumentations()] : [],
          resource: this.getResource({
            serviceName: data.serviceName,
          }),
          logRecordProcessor: loggerProvider as any,
        };

      if (traceExporter) {
        nodeSdkConfiguration.traceExporter = traceExporter;
      }

      if (metricReader) {
        nodeSdkConfiguration.metricReader = metricReader as any;
      }

      const sdk: opentelemetry.NodeSDK = new opentelemetry.NodeSDK(
        nodeSdkConfiguration,
      );

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

  public static getLogger(): Logger {
    if (!this.logger) {
      throw new Error("Logger not initialized");
    }

    return this.logger!;
  }

  public static getMeterProvider(): MeterProvider {
    if (!this.meterProvider) {
      this.meterProvider = new MeterProvider();
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
}

Telemetry.init({
  serviceName: serviceName,
});
