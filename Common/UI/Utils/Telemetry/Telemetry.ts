import {
  DisableTelemetry,
  OpenTelemetryExporterOtlpEndpoint,
  OpenTelemetryExporterOtlpHeaders,
} from "../../Config";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";
import { Resource } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  TracerConfig,
  WebTracerProvider,
} from "@opentelemetry/sdk-trace-web";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";
import type { SpanExporter as WebSpanExporter } from "@opentelemetry/sdk-trace-web/node_modules/@opentelemetry/sdk-trace-base/build/src/export/SpanExporter";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import URL from "../../../Types/API/URL";

export default class Telemetry {
  public static init(data: { serviceName: string }): void {
    if (DisableTelemetry) {
      return;
    }

    const hasHeaders: boolean =
      Object.keys(OpenTelemetryExporterOtlpHeaders).length > 0;

    if (OpenTelemetryExporterOtlpEndpoint && hasHeaders) {
      const providerConfig: TracerConfig = {
        resource: new Resource({
          [ATTR_SERVICE_NAME]: data.serviceName,
        }),
      };

      const provider: WebTracerProvider = new WebTracerProvider(providerConfig);

      const traceExporter: SpanExporter = new OTLPTraceExporter({
        url: URL.fromString(
          OpenTelemetryExporterOtlpEndpoint?.toString() + "/v1/traces",
        ).toString(),
        headers: OpenTelemetryExporterOtlpHeaders,
      }) as unknown as SpanExporter;

      const webTraceExporter = traceExporter as unknown as WebSpanExporter;

      provider.addSpanProcessor(
        new BatchSpanProcessor(webTraceExporter),
      );

      provider.register({
        contextManager: new ZoneContextManager(),
      });

      registerInstrumentations({
        instrumentations: [
          new FetchInstrumentation(),
          new XMLHttpRequestInstrumentation(),
        ],
      });
    }
  }
}
