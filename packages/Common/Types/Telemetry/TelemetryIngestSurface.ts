/*
 * Every distinct endpoint family that accepts a TelemetryIngestionKey.
 *
 * This enum exists so the "may this key write here?" decision is made in ONE
 * place against a closed vocabulary, rather than each route inventing its own
 * ad-hoc check. Each ingest route names the surface it is, the shared guard
 * answers yes or no, and adding a new route becomes a conscious decision about
 * whether a public browser key may reach it (the Record below will not compile
 * until the new member is given a readable name).
 *
 * The string values are the wire/log form and are deliberately stable: they
 * appear in refusal messages and in ingest logs, so renaming one changes what
 * an operator greps for.
 */
enum TelemetryIngestSurface {
  OtelTraces = "otel-traces",
  OtelLogs = "otel-logs",
  OtelMetrics = "otel-metrics",
  OtelProfiles = "otel-profiles",
  SessionReplay = "session-replay",
  SourceMap = "source-map",
  Syslog = "syslog",
  Fluent = "fluent",
  Pyroscope = "pyroscope",
  KubernetesCost = "kubernetes-cost",
  ChangeEvents = "change-events",
  SecurityEvents = "security-events",
  Grpc = "grpc",
  Mqtt = "mqtt",
}

/*
 * The only surfaces a Browser key may write to. This is an ALLOWLIST, not a
 * denylist, on purpose: a surface added later is refused to browser keys until
 * someone deliberately adds it here, so the failure mode of forgetting is
 * "browser keys cannot reach a new endpoint" rather than "a key scraped off a
 * public page can reach it".
 *
 * The four members are exactly what a real browser agent emits: OTLP traces,
 * logs and metrics from the web SDKs, plus session replay chunks. Everything
 * else is a server-side or infrastructure pipe that no page has any business
 * calling - profiles, syslog, Fluent, Pyroscope, Kubernetes cost, gRPC, MQTT -
 * or is a build-time artifact upload (source maps) that belongs in CI with a
 * server key, not in the browser bundle, which would otherwise be able to
 * overwrite the maps used to de-obfuscate everyone else's stack traces.
 */
export const BROWSER_ALLOWED_INGEST_SURFACES: ReadonlySet<TelemetryIngestSurface> =
  new Set<TelemetryIngestSurface>([
    TelemetryIngestSurface.OtelTraces,
    TelemetryIngestSurface.OtelLogs,
    TelemetryIngestSurface.OtelMetrics,
    TelemetryIngestSurface.SessionReplay,
  ]);

/*
 * Typed as a total Record rather than a partial lookup so that adding a member
 * to the enum without naming it is a compile error, not a surface that
 * silently reports itself by its raw slug in a customer-facing error.
 */
const INGEST_SURFACE_READABLE_NAMES: Record<TelemetryIngestSurface, string> = {
  [TelemetryIngestSurface.OtelTraces]: "OTLP trace ingest",
  [TelemetryIngestSurface.OtelLogs]: "OTLP log ingest",
  [TelemetryIngestSurface.OtelMetrics]: "OTLP metric ingest",
  [TelemetryIngestSurface.OtelProfiles]: "OTLP profile ingest",
  [TelemetryIngestSurface.SessionReplay]: "session replay ingest",
  [TelemetryIngestSurface.SourceMap]: "source map upload",
  [TelemetryIngestSurface.Syslog]: "syslog ingest",
  [TelemetryIngestSurface.Fluent]: "Fluentd / Fluent Bit ingest",
  [TelemetryIngestSurface.Pyroscope]: "Pyroscope profile ingest",
  [TelemetryIngestSurface.KubernetesCost]: "Kubernetes cost ingest",
  [TelemetryIngestSurface.ChangeEvents]: "change event ingest",
  [TelemetryIngestSurface.SecurityEvents]: "security event ingest",
  [TelemetryIngestSurface.Grpc]: "gRPC ingest",
  [TelemetryIngestSurface.Mqtt]: "MQTT ingest",
};

type GetIngestSurfaceReadableNameFunction = (
  surface: TelemetryIngestSurface,
) => string;

export const getIngestSurfaceReadableName: GetIngestSurfaceReadableNameFunction =
  (surface: TelemetryIngestSurface): string => {
    /*
     * The fallback guards the one case the type system cannot: a surface
     * string that came off the wire, or out of an older row, and was cast
     * into the enum. Echoing the raw slug beats rendering "undefined" in a
     * refusal message.
     */
    const readableName: string | undefined =
      INGEST_SURFACE_READABLE_NAMES[surface];

    return readableName || String(surface);
  };

export default TelemetryIngestSurface;
