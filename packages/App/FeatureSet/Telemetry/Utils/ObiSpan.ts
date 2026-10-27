import type { SpanKind } from "Common/Models/AnalyticsModels/Span";

/*
 * What every ingest rule for OBI (OpenTelemetry eBPF Instrumentation, the
 * Kubernetes agent's tracer) shares: how a span is known to be OBI's, and the
 * span kinds those rules compare and set.
 *
 * OBI names itself in the resource of everything it exports
 * (`telemetry.distro.name`), and every rule reads that first, so a span an
 * application's own SDK sent is never rewritten, whatever it looks like.
 *
 * Pure and light on purpose: the rules run on every span, and the modules
 * built on this one (ObiClickHouseHttpSpan, ObiBullMqSpan,
 * ObiSpanMetricsSkip, ObiSpanSemantics) load nothing else of OneUptime's, so
 * they can be read, and tested, without the Span model and everything it
 * loads. SpanKind is therefore imported as a type only, and each kind below
 * is typed by the enum member it spells: a change to the enum fails to
 * compile here.
 */
export const OBI_TELEMETRY_DISTRO_NAME: string =
  "opentelemetry-ebpf-instrumentation";

// The key as the ingest service's per-span attribute map holds it.
export const OBI_DISTRO_ATTRIBUTE: string = "resource.telemetry.distro.name";

const CLIENT_SPAN_KIND_TEXT: `${SpanKind.Client}` = "SPAN_KIND_CLIENT";
const CONSUMER_SPAN_KIND_TEXT: `${SpanKind.Consumer}` = "SPAN_KIND_CONSUMER";

export const CLIENT_SPAN_KIND: SpanKind = CLIENT_SPAN_KIND_TEXT as SpanKind;
export const CONSUMER_SPAN_KIND: SpanKind = CONSUMER_SPAN_KIND_TEXT as SpanKind;

/*
 * A span's attributes as the ingest service builds them: span keys bare,
 * resource keys `resource.`-prefixed, scope keys `scope.`-prefixed.
 */
export type SpanAttributeMap = Readonly<Record<string, unknown>>;

// The same map, for the rules that rewrite it.
export type MutableSpanAttributeMap = Record<string, unknown>;

/**
 * Whether the span's resource is OBI's. One property read for a span that is
 * not.
 */
export function isObiSpan(
  attributes: SpanAttributeMap | null | undefined,
): boolean {
  return Boolean(
    attributes &&
      attributes[OBI_DISTRO_ATTRIBUTE] === OBI_TELEMETRY_DISTRO_NAME,
  );
}

/**
 * A string attribute with something in it, else null: what OBI writes is
 * never blank, so blank is the same as absent.
 */
export function readNonEmptyString(
  attributes: SpanAttributeMap,
  key: string,
): string | null {
  const value: unknown = attributes[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Whether any of the keys holds a value: present, not null and not ''. How
 * the rules ask "is this already a database / messaging span?".
 */
export function hasAnyValue(
  attributes: SpanAttributeMap,
  keys: ReadonlyArray<string>,
): boolean {
  for (const key of keys) {
    const value: unknown = attributes[key];
    if (value !== undefined && value !== null && value !== "") {
      return true;
    }
  }
  return false;
}
