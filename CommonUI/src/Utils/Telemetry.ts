import {
  OpenTelemetryExporterOtlpEndpoint,
  OpenTelemetryExporterOtlpHeaders,
} from "../Config";
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
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import URL from "Common/Types/API/URL";

export default class Telemetry {
  public static init(data: { serviceName: string }): void {
    const hasHeaders: boolean =
      Object.keys(OpenTelemetryExporterOtlpHeaders).length > 0;

    if (OpenTelemetryExporterOtlpEndpoint && hasHeaders) {
      const providerConfig: TracerConfig = {
        resource: new Resource({
          [SemanticResourceAttributes.SERVICE_NAME]: data.serviceName,
        }),
      };

      const provider: WebTracerProvider = new WebTracerProvider(providerConfig);

      provider.addSpanProcessor(
        new BatchSpanProcessor(
          new OTLPTraceExporter({
            url: URL.fromString(
              OpenTelemetryExporterOtlpEndpoint?.toString() + "/v1/traces",
            ).toString(),
            headers: OpenTelemetryExporterOtlpHeaders,
          }),
        ),
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
