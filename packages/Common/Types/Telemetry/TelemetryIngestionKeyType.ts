/*
 * What kind of credential a TelemetryIngestionKey is, and therefore what the
 * ingest side is willing to let it do.
 *
 * The distinction exists because these two are NOT the same secret class, even
 * though today they are the same column:
 *
 * - Server keys live in a backend process, an OTel collector config, or a CI
 *   secret. Nobody outside the customer's infrastructure ever sees them, so
 *   they get the full ingest surface with no origin binding. This is the
 *   historical behaviour and the DEFAULT, so every key that already exists
 *   keeps working exactly as before.
 * - Browser keys are pasted into a public web page - the session-replay
 *   snippet, a browser OTLP exporter - which means "secret" is a fiction:
 *   anyone who views source has it. They are therefore treated as PUBLIC
 *   write-only credentials and are constrained on every axis that can be
 *   enforced server-side: a required origin allowlist, a pinned service.name,
 *   a per-key rate limit, an expiry, a kill switch, and a reduced set of
 *   ingest surfaces (see BROWSER_ALLOWED_INGEST_SURFACES).
 *
 * The type of a key is immutable after creation - see the keyType column on
 * TelemetryIngestionKey for why.
 */
enum TelemetryIngestionKeyType {
  Server = "Server",
  Browser = "Browser",
}

export default TelemetryIngestionKeyType;
