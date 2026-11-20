/*
 * What kind of credential a TelemetryIngestionKey is, and therefore what the
 * ingest side is willing to let it do.
 *
 * The distinction exists because these are NOT the same secret class, even
 * though they are the same column:
 *
 * - Server keys live in a backend process, an OTel collector config, or a CI
 *   secret. Nobody outside the customer's infrastructure ever sees them, so
 *   they get the full ingest surface with no origin binding. This is the
 *   historical behaviour and the DEFAULT, so every key that already exists
 *   keeps working exactly as before.
 * - Browser keys are pasted into a public web page - the session-replay
 *   snippet, a browser OTLP exporter, a Sentry browser SDK's DSN - which
 *   means "secret" is a fiction: anyone who views source has it. They are
 *   therefore treated as PUBLIC write-only credentials and are constrained
 *   on every axis that can be enforced server-side: a required origin
 *   allowlist, a pinned service.name, a per-key rate limit, an expiry, a
 *   kill switch, and a reduced set of ingest surfaces (see
 *   BROWSER_ALLOWED_INGEST_SURFACES).
 * - Mobile keys are compiled into an iOS, Android or React Native app
 *   (issue #6457), so they are public too: anyone who has the app can pull
 *   the key out of it. A Browser key cannot serve there - it is checked
 *   against the Origin header, which a mobile SDK does not send - and a
 *   Server key must never ship in an app: it writes every kind of telemetry
 *   from anywhere. A Mobile key is pinned to ONE app (its service.name is
 *   required and replaces the one on everything it writes), writes only
 *   that app's OTLP traces, logs and metrics over HTTP
 *   (MOBILE_ALLOWED_INGEST_SURFACES), is refused from a web page, files what
 *   it writes as that app's mobile RUM, and has the Browser key's default
 *   rate limit, expiry and kill switch. What it cannot stop: someone with
 *   the app can still send made-up RUM telemetry for that one app, as much
 *   as the key's limit lets them, until the key is turned off.
 *
 * The type of a key is immutable after creation - see the keyType column on
 * TelemetryIngestionKey for why.
 */
enum TelemetryIngestionKeyType {
  Server = "Server",
  Browser = "Browser",
  Mobile = "Mobile",
}

/*
 * The key types published with the app or page that uses them, so assumed
 * copied: held to a surface allowlist and a default rate limit, never
 * trusted like a server's secret.
 */
export const PUBLIC_INGESTION_KEY_TYPES: ReadonlySet<TelemetryIngestionKeyType> =
  new Set<TelemetryIngestionKeyType>([
    TelemetryIngestionKeyType.Browser,
    TelemetryIngestionKeyType.Mobile,
  ]);

/*
 * A stored key type as the ingest side reads it: exactly "Browser" or
 * "Mobile", and anything else as Server - NULL on every key written before
 * the column existed, which keeps the historical behaviour in full. The
 * write path (TelemetryIngestionKeyService) refuses any other value, so
 * only a hand-edited row ever reaches the fallback.
 */
export function readTelemetryIngestionKeyType(
  value: unknown,
): TelemetryIngestionKeyType {
  if (value === TelemetryIngestionKeyType.Browser) {
    return TelemetryIngestionKeyType.Browser;
  }

  if (value === TelemetryIngestionKeyType.Mobile) {
    return TelemetryIngestionKeyType.Mobile;
  }

  return TelemetryIngestionKeyType.Server;
}

export default TelemetryIngestionKeyType;
