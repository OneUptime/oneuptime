import { MutableSpanAttributeMap, isObiSpan } from "./ObiSpan";

/*
 * OBI (OpenTelemetry eBPF Instrumentation, the Kubernetes agent's tracer)
 * marks the spans it has already counted in its own span metrics with
 * `span.metrics.skip: true`, a note to a span-metrics pipeline further on
 * not to count them again. It says nothing about the request, so ingest
 * removes it from OBI's spans: from the span attributes, where OBI v0.13 and
 * v0.14 write it, and from the resource attributes, which the ingest
 * service flattens onto every span under a `resource.` prefix. Without this
 * a span showed it twice, as `span.metrics.skip` and as
 * `resource.span.metrics.skip`.
 *
 * Removed before the evaluation row is built, so no drop filter, scrub rule
 * or pipeline sees it, and no row stores it among its attribute keys. A
 * span an application's SDK sent keeps it, should it carry one.
 */
export const OBI_SPAN_METRICS_SKIP_ATTRIBUTES: ReadonlyArray<string> = [
  "span.metrics.skip",
  "resource.span.metrics.skip",
];

/**
 * Removes OBI's span.metrics.skip, in both spellings, from an OBI span's
 * attributes. Returns whether it removed any. A span that is not OBI's, or
 * has neither, is left as it is: no key is deleted that is not there.
 */
export function removeObiSpanMetricsSkip(
  attributes: MutableSpanAttributeMap | null | undefined,
): boolean {
  if (!attributes || !isObiSpan(attributes)) {
    return false;
  }

  let removed: boolean = false;
  for (const key of OBI_SPAN_METRICS_SKIP_ATTRIBUTES) {
    if (Object.prototype.hasOwnProperty.call(attributes, key)) {
      delete attributes[key];
      removed = true;
    }
  }
  return removed;
}
