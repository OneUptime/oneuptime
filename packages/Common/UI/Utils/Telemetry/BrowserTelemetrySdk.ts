import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  TracerConfig,
  WebTracerProvider,
} from "@opentelemetry/sdk-trace-web";
import type {
  SpanExporter,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

/*
 * The browser OpenTelemetry SDK, in a file of its own. Telemetry.init import()s
 * it only where browser telemetry is configured, so the installations that have
 * not configured it never download it (SignInFirstLoadBuild.test.ts).
 *
 * It reads no configuration: Telemetry.ts decides whether to load it and hands
 * it what to send and where.
 */

export interface BrowserTelemetrySdkOptions {
  serviceName: string;
  // Where spans are sent, and the headers sent with them.
  tracesUrl: string;
  headers: { [key: string]: string };
  /*
   * Stamped onto each span as it starts. The object itself, not a copy: the
   * page goes on changing it (Telemetry.setGlobalAttributes).
   */
  globalAttributes: Readonly<{ [key: string]: string }>;
}

interface MutableSpanLike {
  setAttribute(key: string, value: string): unknown;
}

/**
 * Stamps the global RUM attributes (userId, projectId, ...) onto each span at
 * creation, mirroring the server-side ContextSpanProcessor.
 */
class GlobalAttributeSpanProcessor {
  private globalAttributes: Readonly<{ [key: string]: string }>;

  public constructor(globalAttributes: Readonly<{ [key: string]: string }>) {
    this.globalAttributes = globalAttributes;
  }

  public onStart(span: MutableSpanLike): void {
    for (const key in this.globalAttributes) {
      const value: string | undefined = this.globalAttributes[key];

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

export default function startBrowserTelemetrySdk(
  options: BrowserTelemetrySdkOptions,
): void {
  const traceExporter: SpanExporter = new OTLPTraceExporter({
    url: options.tracesUrl,
    headers: options.headers,
  }) as unknown as SpanExporter;

  const providerConfig: TracerConfig = {
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: options.serviceName,
    }),
    // Stamp global RUM attributes (userId, projectId, ...) onto every span.
    spanProcessors: [
      new BatchSpanProcessor(traceExporter),
      new GlobalAttributeSpanProcessor(
        options.globalAttributes,
      ) as unknown as SpanProcessor,
    ],
  };

  const provider: WebTracerProvider = new WebTracerProvider(providerConfig);

  /*
   * No ZoneContextManager, and so no zone.js: with no context manager named,
   * register() uses the SDK's default, StackContextManager.
   *
   * This file arrives once the app is running, and zone.js is not safe to load
   * then. It replaces Promise and MutationObserver and patches timers and event
   * targets under code already using them. A promise made before it arrives is
   * no longer instanceof Promise, and abort() on an XMLHttpRequest sent before
   * it arrives does nothing, so that request runs to the end.
   *
   * Nothing here needs it either. The only spans are the fetch and XHR
   * instrumentations', and they need their span active only for the synchronous
   * moment they write its traceparent into the request's headers, which a stack
   * does. Zone would carry a span across async work, for code that makes one
   * active and awaits inside it. No code here does, and it could not follow a
   * native await anyway, which the build keeps (esbuild target es2017). Nor does
   * the exporter rely on it to keep its own POST out of the traces: it calls the
   * fetch the instrumentation wrapped.
   *
   * Compared in a browser with the same requests under each: the traces came
   * out alike, one per request, no parents, every traceparent matching its span.
   */
  provider.register();

  registerInstrumentations({
    instrumentations: [
      new FetchInstrumentation(),
      new XMLHttpRequestInstrumentation(),
    ],
  });
}
