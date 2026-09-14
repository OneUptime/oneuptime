import ObjectID from "../ObjectID";
import TelemetryIngestionKeyType from "./TelemetryIngestionKeyType";

/*
 * The resolved, ingest-time view of one TelemetryIngestionKey: everything the
 * guard needs to decide whether to accept a request, and nothing else.
 *
 * It is a plain type rather than the model itself so the hot path can cache it
 * (and so nothing downstream is tempted to reach for the model's other
 * columns, or to write through it). Note what is deliberately ABSENT: the
 * secret. Once a request has been authenticated the secret has done its job,
 * and a value that must never be logged is safest in a shape that never
 * carries it.
 *
 * Every field is non-optional - null is spelled out - because these are
 * decisions, and "the caller forgot to set it" must not be indistinguishable
 * from "there is deliberately no limit here".
 */
export default interface TelemetryIngestionKeyPolicy {
  ingestionKeyId: ObjectID;
  projectId: ObjectID;

  keyType: TelemetryIngestionKeyType;

  /*
   * Origins this key may be used from. REQUIRED and strictly enforced on a
   * Browser key (empty means the key cannot be used at all, since a public
   * key with no origin binding is just a key anyone may write with); IGNORED
   * on a Server key, which has no Origin header to check in the first place.
   *
   * Note this is the opposite polarity from
   * RumApplication.sessionReplayAllowedOrigins, where empty means "any
   * origin". That column is an optional hardening control on an existing
   * feature and could not be tightened without breaking live installations;
   * this one is on a key type that did not exist before, so it can start
   * closed.
   */
  allowedOrigins: Array<string>;

  /*
   * When set, every OTLP resource ingested with this key has its service.name
   * REPLACED with this value. Null means the payload's own service.name is
   * kept (the historical behaviour, and the only sane one for a server key
   * that legitimately reports for many services).
   */
  pinnedServiceName: string | null;

  /* Kill switch. False refuses everything, immediately, without deleting. */
  isEnabled: boolean;

  /* Null means never expires - the historical behaviour of every key. */
  expiresAt: Date | null;

  /*
   * Null means "no explicit limit configured", which resolves differently per
   * key type: a Browser key falls back to
   * DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE, a Server key is unlimited.
   */
  requestsPerMinuteLimit: number | null;
}

/*
 * Shipped ceiling for a Browser key that has not set its own limit.
 *
 * Sized to be irrelevant to honest traffic and material to an abuser: 6000
 * requests/minute is 100/second sustained, which a real page cannot approach
 * (browser SDKs batch and flush on an interval, so one visitor generates
 * single-digit requests per minute), while a scraped key driven from a script
 * hits it in seconds. The limit is per KEY, not per visitor, so it must clear
 * the whole legitimate fleet behind one key - hence a headroom this generous
 * rather than a tight per-client number.
 *
 * A customer who genuinely needs more sets requestsPerMinuteLimit explicitly.
 */
export const DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE: number = 6000;
