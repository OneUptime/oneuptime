import { JSONObject, JSONValue } from "../../../Types/JSON";
import { isSensitiveLogKey, REDACTED } from "../LogRedaction";

/*
 * Credential stripping for monitor ingest payloads.
 *
 * https://github.com/OneUptime/oneuptime/issues/3360
 *
 * The infrastructure agent authenticates by putting the monitor's
 * `serverMonitorSecretKey` in BOTH the ingest URL and the JSON body
 * (`ServerMonitorReport.SecretKey`, `json:"secretKey"`). The URL copy is
 * transient. The body copy is not: the deserialized body becomes
 * `dataToProcess`, and `dataToProcess` is written verbatim to three places
 * that a read-only principal can select from:
 *
 *   - `MonitorLog.logBody` (ClickHouse, `Permission.Viewer` readable),
 *   - `Monitor.serverMonitorResponse` (Postgres jsonb, `Viewer` readable),
 *   - `MonitorProbe.lastMonitoringLog`.
 *
 * So the shared secret that authenticates every agent in the project sat at
 * rest, in plaintext, behind the lowest privilege OneUptime grants. Rotating
 * did not help: the replacement re-entered the payload on the very next beat.
 *
 * Two entry points, because the two sinks want different things:
 *
 *   - `stripAgentCredentials` DELETES the key. It runs at the ingest boundary,
 *     before `dataToProcess` exists, so the secret never reaches any sink and
 *     never enters the process's monitor-evaluation state at all. Deleting
 *     rather than masking keeps `Monitor.serverMonitorResponse` faithful to
 *     the `ServerMonitorResponse` interface, which declares no `secretKey`.
 *
 *   - `redactForPersistence` MASKS the value with `[REDACTED]`. It runs on the
 *     copy `MonitorLogUtil` writes to `logBody`. Masking is the better choice
 *     there because `logBody` is a diagnostic record: an operator debugging an
 *     API monitor wants to see THAT an `Authorization` header was sent without
 *     seeing what it was. It is also the net underneath the boundary strip —
 *     it applies to every monitor type and every future payload field, so a
 *     credential added to some other ingest path does not silently start
 *     accumulating in ClickHouse.
 *
 * What counts as a credential is delegated to `isSensitiveLogKey`, the same
 * deny-by-default classifier the logger uses, so there is one list to keep
 * current rather than two. It is structural only (decided by key name): the
 * textual sweeps in `redactLogString` are right for log lines but would mangle
 * a captured HTTP response body, which is legitimate monitor evidence.
 */

// Deep enough for any real ingest payload, shallow enough to bound the walk.
const MAX_DEPTH: number = 12;

type WalkFunction = (
  value: JSONValue,
  drop: boolean,
  depth: number,
) => JSONValue;

/*
 * One walker, two behaviours. `drop` picks whether a sensitive key is removed
 * from its parent object or kept with its value replaced.
 *
 * Always returns a new object/array rather than mutating in place. The ingest
 * caller hands us an object it is about to keep using, and `MonitorLogUtil`
 * hands us a payload that is still being read by the criteria evaluator — so
 * mutating the input would change what the monitor evaluates, not just what
 * gets stored.
 */
const walk: WalkFunction = (
  value: JSONValue,
  drop: boolean,
  depth: number,
): JSONValue => {
  /*
   * Past the depth ceiling we cannot keep vouching for what is nested below,
   * and a payload that deep is not something a monitor legitimately reports.
   * Drop the subtree instead of passing it through unredacted.
   */
  if (depth > MAX_DEPTH) {
    return null;
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item: JSONValue) => {
      return walk(item, drop, depth + 1);
    });
  }

  /*
   * Dates and ObjectIDs survive the JSON round-trip as strings, but callers
   * may hand us live instances (the ingest boundary runs before
   * `JSON.stringify`). Anything that is not a plain object is a leaf.
   */
  if (
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return value;
  }

  const source: JSONObject = value as JSONObject;
  const result: JSONObject = {};

  for (const key of Object.keys(source)) {
    const child: JSONValue = source[key] as JSONValue;

    if (isSensitiveLogKey(key, child)) {
      if (drop) {
        continue;
      }

      result[key] = REDACTED;
      continue;
    }

    result[key] = walk(child, drop, depth + 1);
  }

  return result;
};

export type StripAgentCredentialsFunction = <T>(payload: T) => T;

/*
 * Ingest boundary. Removes agent-supplied credentials from a freshly
 * deserialized payload so the secret never becomes part of `dataToProcess`.
 *
 * Generic over the payload type because the caller immediately treats the
 * result as its declared interface (`ServerMonitorResponse` and friends) —
 * none of which declare a credential field, so removing one cannot invalidate
 * the type.
 */
export const stripAgentCredentials: StripAgentCredentialsFunction = <T>(
  payload: T,
): T => {
  if (payload === null || payload === undefined) {
    return payload;
  }

  return walk(payload as JSONValue, true, 0) as T;
};

export type RedactForPersistenceFunction = (payload: JSONValue) => JSONValue;

/*
 * Storage boundary. Masks credentials in the copy that is about to be written
 * to `MonitorLog.logBody`.
 */
export const redactForPersistence: RedactForPersistenceFunction = (
  payload: JSONValue,
): JSONValue => {
  if (payload === null || payload === undefined) {
    return payload;
  }

  return walk(payload, false, 0);
};

export type RedactMonitorSecretFunction = <T>(
  payload: T,
  secret: string | null | undefined,
) => T;

/*
 * Value boundary. Masks every textual occurrence of ONE monitor's own secret
 * key inside an ingest payload.
 *
 * The two walkers above are structural: they decide by key name, which is the
 * right test when a credential arrives as its own field (`secretKey`). The
 * incoming-email path has the other shape. There the secret is not a field at
 * all -- it is baked into a value that is otherwise legitimate evidence.
 * `MonitorService` mints `incomingEmailSecretKey`, and
 * `SendGridInboundProvider.generateMonitorEmailAddress` turns it into the
 * monitor's ingest address, `monitor-{secretKey}@{inboundDomain}`. The address
 * IS the credential -- `extractSecretKeyFromEmail` parses the key straight back
 * out of it -- so everything that quotes the recipient quotes the key:
 * `emailTo`, the `To:` header, and the `Received:` / `Delivered-To:` headers a
 * relay adds on the way in.
 *
 * No key name marks any of those as sensitive, and none of them can simply be
 * dropped. `IncomingEmailCriteria` evaluates `emailTo` for the "Email to"
 * check, and mail that reaches the monitor through an alias or a forwarding
 * rule carries a genuinely different -- and genuinely interesting -- recipient.
 * So this masks the secret substring and leaves the rest of the value intact:
 * domain, alias and relay chain all survive, and a filter written against them
 * keeps matching.
 *
 * Matching is case-insensitive because the key is a UUID that reaches us
 * through address normalisation (`extractEmailAddress` lowercases) and through
 * relay headers that preserve whatever case the sender happened to use.
 */

/*
 * A secret shorter than this is not a key we minted -- `ObjectID.generate()`
 * returns a 36-character UUID. Sweeping for a short string would mask ordinary
 * text that merely contains it, destroying the evidence this is trying to keep
 * readable, so treat it as nothing to do rather than over-redact.
 */
const MIN_SWEEPABLE_SECRET_LENGTH: number = 8;

type ReplaceAllInsensitiveFunction = (
  haystack: string,
  needle: string,
) => string;

/*
 * Case-insensitive replace-all done by scan rather than by `RegExp`, so a
 * secret that happens to contain regex metacharacters needs no escaping and
 * cannot alter the pattern. Compares on lowercased copies but slices from the
 * original, so the surrounding text keeps its own casing.
 */
const replaceAllInsensitive: ReplaceAllInsensitiveFunction = (
  haystack: string,
  needle: string,
): string => {
  const lowerHaystack: string = haystack.toLowerCase();
  const lowerNeedle: string = needle.toLowerCase();

  let result: string = "";
  let cursor: number = 0;
  let index: number = lowerHaystack.indexOf(lowerNeedle, cursor);

  while (index !== -1) {
    result += haystack.slice(cursor, index) + REDACTED;
    cursor = index + lowerNeedle.length;
    index = lowerHaystack.indexOf(lowerNeedle, cursor);
  }

  return result + haystack.slice(cursor);
};

type SweepFunction = (
  value: JSONValue,
  secret: string,
  depth: number,
) => JSONValue;

const sweep: SweepFunction = (
  value: JSONValue,
  secret: string,
  depth: number,
): JSONValue => {
  // Same reasoning as `walk`: below the ceiling we cannot vouch for the value.
  if (depth > MAX_DEPTH) {
    return null;
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return replaceAllInsensitive(value, secret);
  }

  if (Array.isArray(value)) {
    return value.map((item: JSONValue) => {
      return sweep(item, secret, depth + 1);
    });
  }

  /*
   * Leaf. Dates and ObjectIDs land here as live instances on the ingest side;
   * neither can carry the secret as text, so they pass through untouched.
   */
  if (
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return value;
  }

  const source: JSONObject = value as JSONObject;
  const result: JSONObject = {};

  /*
   * Keys are swept too. `emailHeaders` is a `Dictionary<string>` built from
   * whatever header names the relay sent, so a key is no more trustworthy than
   * a value -- and a redacted key still serialises into the stored jsonb.
   */
  for (const key of Object.keys(source)) {
    result[replaceAllInsensitive(key, secret)] = sweep(
      source[key] as JSONValue,
      secret,
      depth + 1,
    );
  }

  return result;
};

/*
 * Generic over the payload type for the same reason as `stripAgentCredentials`:
 * the caller goes on treating the result as its declared interface. Masking
 * only ever rewrites strings in place, so every field keeps its declared type.
 */
export const redactMonitorSecret: RedactMonitorSecretFunction = <T>(
  payload: T,
  secret: string | null | undefined,
): T => {
  if (payload === null || payload === undefined) {
    return payload;
  }

  if (
    typeof secret !== "string" ||
    secret.length < MIN_SWEEPABLE_SECRET_LENGTH
  ) {
    return payload;
  }

  return sweep(payload as JSONValue, secret, 0) as T;
};

export default {
  stripAgentCredentials,
  redactForPersistence,
  redactMonitorSecret,
};
