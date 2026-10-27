import { Span, context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

/*
 * SPANS AS AN EXPORTER RECEIVES THEM, FOR TESTS OF WHAT IS TRACED.
 *
 * startExportingSpans installs a tracer provider that hands every finished
 * span to an in-memory exporter, and an async context manager so that a
 * span started inside another is its child; stopExportingSpans removes
 * both. @CaptureSpan creates no span at all while span export is disabled,
 * so a test also mocks Telemetry.isSpanExportEnabled to return true.
 *
 * Kept in Common so that App's tests, which cannot import OpenTelemetry's
 * SDK themselves, can use it too.
 */

export { SpanStatusCode } from "@opentelemetry/api";

const exporter: InMemorySpanExporter = new InMemorySpanExporter();
const provider: BasicTracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const contextManager: AsyncLocalStorageContextManager =
  new AsyncLocalStorageContextManager();

export function startExportingSpans(): void {
  contextManager.enable();
  context.setGlobalContextManager(contextManager);
  trace.setGlobalTracerProvider(provider);
}

export function stopExportingSpans(): void {
  trace.disable();
  context.disable();
}

export function clearExportedSpans(): void {
  exporter.reset();
}

// The spans exported so far, in the order they ended.
export function getExportedSpans(): Array<ReadableSpan> {
  return exporter.getFinishedSpans();
}

export function getExportedSpanNames(): Array<string> {
  return getExportedSpans().map((span: ReadableSpan): string => {
    return span.name;
  });
}

/*
 * Run `work` inside a span named "request", as production runs ingest
 * inside a job's span: a span the work creates is exported as its child,
 * and work that creates none leaves "request" the only span.
 */
export async function inRequestSpan<T>(work: () => Promise<T>): Promise<T> {
  return await trace
    .getTracer("test")
    .startActiveSpan("request", async (span: Span): Promise<T> => {
      try {
        return await work();
      } finally {
        span.end();
      }
    });
}
