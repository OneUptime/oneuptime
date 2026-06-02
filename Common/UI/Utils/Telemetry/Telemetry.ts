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

/*
 * Mutable, module-level bag of attributes stamped onto every browser span.
 * Populated by `Telemetry.setGlobalAttributes` once the signed-in user and
 * the project being viewed are known (RUM context).
 */
const globalSpanAttributes: { [key: string]: string } = {};

interface MutableSpanLike {
  setAttribute(key: string, value: string): unknown;
}

/**
 * Stamps the global RUM attributes (userId, projectId, ...) onto each span at
 * creation, mirroring the server-side ContextSpanProcessor.
 */
class GlobalAttributeSpanProcessor {
  public onStart(span: MutableSpanLike): void {
    for (const key in globalSpanAttributes) {
      const value: string | undefined = globalSpanAttributes[key];

      if (value) {
        span.setAttribute(key, value);
      }
    }
  }

  public onEnd(): void {
    // no-op
  }

  public forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  public shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

export default class Telemetry {
  /**
   * Set RUM attributes that should be attached to every browser span from now
   * on (e.g. userId, projectId). Safe to call before or after `init`; empty
   * values are ignored.
   */
  public static setGlobalAttributes(attributes: {
    userId?: string | undefined;
    projectId?: string | undefined;
    [key: string]: string | undefined;
  }): void {
    for (const key in attributes) {
      const value: string | undefined = attributes[key];

      if (value) {
        globalSpanAttributes[key] = value;
      }
    }
  }

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

      const webTraceExporter: WebSpanExporter =
        traceExporter as unknown as WebSpanExporter;

      provider.addSpanProcessor(new BatchSpanProcessor(webTraceExporter));

      // Stamp global RUM attributes (userId, projectId, ...) onto every span.
      provider.addSpanProcessor(
        new GlobalAttributeSpanProcessor() as unknown as Parameters<
          WebTracerProvider["addSpanProcessor"]
        >[0],
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
