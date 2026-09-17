import TelemetryContext from "./TelemetryContext";
import type { Context } from "@opentelemetry/api";
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";

/**
 * Copies the ambient {@link TelemetryContext} attributes (projectId, userId,
 * monitorId, incidentId, requestId, ...) onto every span at creation time.
 *
 * Combined with `TelemetryContext` scopes seeded at each entry point (HTTP
 * request, worker job, probe check, cron run), this makes the full
 * tenant/business context queryable on all spans — including the ~1958
 * attribute-less `@CaptureSpan` spans — without touching any of those call
 * sites.
 */
export default class ContextSpanProcessor implements SpanProcessor {
  public onStart(span: Span, _parentContext: Context): void {
    try {
      const attributes: Record<string, string | number | boolean> =
        TelemetryContext.getAttributes();

      for (const key in attributes) {
        const value: string | number | boolean | undefined = attributes[key];

        if (value !== undefined && value !== null) {
          span.setAttribute(key, value);
        }
      }
    } catch {
      // Context enrichment must never break span creation.
    }
  }

  public onEnd(_span: ReadableSpan): void {
    // no-op: enrichment happens entirely in onStart.
  }

  public shutdown(): Promise<void> {
    return Promise.resolve();
  }

  public forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}
