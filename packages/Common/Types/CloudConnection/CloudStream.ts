import { JSONObject, JSONValue } from "../JSON";
import ObjectID from "../ObjectID";

/*
 * STREAMING AN AWS ACCOUNT'S METRICS AND LOGS INTO ONEUPTIME.
 *
 * An AWS connection reads CloudWatch on a schedule: a few key metrics of
 * each resource, every ten minutes, ten to twenty minutes behind. A stream
 * adds what a schedule cannot - every metric a minute or two after
 * CloudWatch has it, and CloudWatch Logs - without anything to run: in
 * each Region, a CloudWatch metric stream and CloudWatch Logs subscription
 * filters deliver into Amazon Data Firehose streams whose destination is
 * OneUptime's own HTTP endpoint (CloudStreamTemplate makes all of it in one
 * CloudFormation stack).
 *
 *   POST <OneUptime>/telemetry/aws-firehose/v1/metrics
 *   POST <OneUptime>/telemetry/aws-firehose/v1/logs
 *
 * Firehose sends a connection's stream key in X-Amz-Firehose-Access-Key.
 * The key names its connection, which names the project: nothing a record
 * says decides where it is written. Only the key's SHA-256 is stored
 * (CloudConnection.streamKeyHashes); a new key replaces it, and the key it
 * replaced keeps working for CLOUD_STREAM_PREVIOUS_KEY_GRACE_MS so the
 * stacks can be updated without losing a delivery.
 *
 * What arrived is kept on the connection (CloudConnection.streamSummary,
 * CloudStreamSummary below): when the last delivery came, which accounts,
 * Regions and namespaces sent metrics, which log groups sent logs, and the
 * last delivery OneUptime refused and why. The connection's own reads use
 * it too: a namespace a stream delivers is no longer written from the
 * schedule (getStreamedMetricKeys), so no datapoint is counted twice.
 *
 * Shared by the server (the ingest endpoint, the reads, the key routes),
 * the dashboard (the streaming dialog and the connections list) and the
 * docs tests. React-free and Node-free.
 */

// The two endpoints, under the prefix every OneUptime's ingress sends to the App.
export const CLOUD_STREAM_URL_PREFIX: string = "/telemetry";
export const CLOUD_STREAM_METRICS_PATH: string = "/aws-firehose/v1/metrics";
export const CLOUD_STREAM_LOGS_PATH: string = "/aws-firehose/v1/logs";

/*
 * The headers Firehose sends, as Node reads them (lower case). Firehose
 * copies the access key it was configured with into its header verbatim.
 */
export const FIREHOSE_ACCESS_KEY_HEADER: string = "x-amz-firehose-access-key";
export const FIREHOSE_REQUEST_ID_HEADER: string = "x-amz-firehose-request-id";
export const FIREHOSE_SOURCE_ARN_HEADER: string = "x-amz-firehose-source-arn";
export const FIREHOSE_PROTOCOL_VERSION_HEADER: string =
  "x-amz-firehose-protocol-version";

/*
 * Firehose's own bounds on a request: at most 10,000 records, each at most
 * 1,024,000 bytes before base64 - 1,365,336 characters after.
 */
export const FIREHOSE_MAX_RECORDS: number = 10_000;
export const FIREHOSE_MAX_RECORD_DATA_LENGTH: number = 1_365_336;

/*
 * OneUptime's bounds on a request. As sent: the 4 MiB the ingress lets
 * through on /telemetry - a stream buffering 1 MiB, compressed with GZIP as
 * the template sets it, sends a few hundred kilobytes. Decompressed: 32 MiB,
 * and every record's own gzip at most 8 MiB, all of them together at most
 * CLOUD_STREAM_MAX_DECODED_BYTES too.
 */
export const CLOUD_STREAM_MAX_REQUEST_BYTES: number = 4 * 1024 * 1024;
export const CLOUD_STREAM_MAX_DECODED_BYTES: number = 32 * 1024 * 1024;
export const CLOUD_STREAM_MAX_RECORD_DECODED_BYTES: number = 8 * 1024 * 1024;

/*
 * Deliveries one connection's streams may make a minute, all Regions
 * together: a stream buffering 1 MiB for 60 seconds sends about one a
 * minute, a busy one a few. Past it Firehose is answered 429 and sends the
 * batch again later.
 */
export const CLOUD_STREAM_REQUESTS_PER_MINUTE: number = 600;

/*
 * Which connections hold a stream key, as each server knows them
 * (CloudStreamKeyedConnections): read all at once, again at most once a
 * minute - and at most every 10 seconds when a delivery names one it does
 * not know, so a key made on another server is known within seconds. A
 * delivery naming any other connection is refused without a read. Past the
 * most kept, each delivery's connection is read instead.
 */
export const CLOUD_STREAM_KEYED_CONNECTIONS_REFRESH_MS: number = 60 * 1000;
export const CLOUD_STREAM_KEYED_CONNECTIONS_MISS_REFRESH_MS: number = 10 * 1000;
export const CLOUD_STREAM_MAX_KEYED_CONNECTIONS: number = 50_000;

// What the template sets each Firehose stream to.
export const CLOUD_STREAM_BUFFER_SIZE_MIB: number = 1;
export const CLOUD_STREAM_BUFFER_INTERVAL_SECONDS: number = 60;
export const CLOUD_STREAM_RETRY_DURATION_SECONDS: number = 3600;
// How long the template's bucket keeps a batch Firehose could not deliver.
export const CLOUD_STREAM_FAILED_DELIVERY_DAYS: number = 30;

// How long the key a new key replaced keeps working.
export const CLOUD_STREAM_PREVIOUS_KEY_GRACE_MS: number = 24 * 60 * 60 * 1000;

/*
 * How recently a namespace must have streamed for the connection's own
 * reads to leave it to the stream. A stream that goes quiet longer than
 * this is read on the schedule again.
 */
export const CLOUD_STREAM_ACTIVE_WINDOW_MS: number = 15 * 60 * 1000;

// What the summary keeps: sources seen in the last week, and at most these many.
export const CLOUD_STREAM_SOURCE_RETENTION_MS: number = 7 * 24 * 60 * 60 * 1000;
export const CLOUD_STREAM_MAX_SOURCES: number = 200;
export const CLOUD_STREAM_MAX_NAMESPACES_PER_SOURCE: number = 150;
export const CLOUD_STREAM_MAX_LOG_GROUPS_PER_SOURCE: number = 100;
// The longest name a summary keeps: a log group's name is at most 512.
export const CLOUD_STREAM_MAX_NAME_LENGTH: number = 512;

/*
 * A stream key: the connection it belongs to and 32 random bytes, hex.
 * "oucs_<connection id>_<64 hex>". Letters, digits, "-" and "_" only, so it
 * pastes into a shell and a CloudFormation parameter as it is.
 */
export const CLOUD_STREAM_KEY_PREFIX: string = "oucs";
export const CLOUD_STREAM_KEY_SECRET_LENGTH: number = 64;
// Firehose takes an access key of at most 4,096 bytes; one longer is no key.
export const CLOUD_STREAM_MAX_KEY_LENGTH: number = 4096;

export function buildCloudStreamKey(data: {
  connectionId: string;
  secret: string;
}): string {
  return `${CLOUD_STREAM_KEY_PREFIX}_${data.connectionId.toLowerCase()}_${data.secret.toLowerCase()}`;
}

function isLowerHex(value: string): boolean {
  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);
    const isDigit: boolean = code >= 48 && code <= 57;
    const isLetter: boolean = code >= 97 && code <= 102;

    if (!isDigit && !isLetter) {
      return false;
    }
  }

  return value.length > 0;
}

/*
 * The connection a key names and its secret - or null for anything that is
 * not a stream key. Never throws; reads at most CLOUD_STREAM_MAX_KEY_LENGTH
 * characters of what it is given.
 */
export function parseCloudStreamKey(
  value: unknown,
): { connectionId: string; secret: string } | null {
  if (typeof value !== "string") {
    return null;
  }

  const key: string = value.trim();

  if (key.length === 0 || key.length > CLOUD_STREAM_MAX_KEY_LENGTH) {
    return null;
  }

  const parts: Array<string> = key.split("_");

  if (parts.length !== 3 || parts[0] !== CLOUD_STREAM_KEY_PREFIX) {
    return null;
  }

  const connectionId: string = parts[1]!;
  const secret: string = parts[2]!;

  if (
    !ObjectID.isValidUUID(connectionId) ||
    connectionId !== connectionId.toLowerCase() ||
    secret.length !== CLOUD_STREAM_KEY_SECRET_LENGTH ||
    !isLowerHex(secret)
  ) {
    return null;
  }

  return { connectionId, secret };
}

/*
 * The two URLs a connection's Firehose streams deliver to, for this
 * OneUptime's address (https://oneuptime.com, a self-hosted install's own).
 */
export function getCloudStreamEndpoints(oneuptimeUrl: string): {
  metricsUrl: string;
  logsUrl: string;
} {
  let base: string = oneuptimeUrl.trim();

  while (base.endsWith("/")) {
    base = base.slice(0, -1);
  }

  return {
    metricsUrl: `${base}${CLOUD_STREAM_URL_PREFIX}${CLOUD_STREAM_METRICS_PATH}`,
    logsUrl: `${base}${CLOUD_STREAM_URL_PREFIX}${CLOUD_STREAM_LOGS_PATH}`,
  };
}

// Firehose delivers to https:// addresses only, on port 443.
export function canFirehoseDeliverTo(url: string): boolean {
  return url.trim().toLowerCase().startsWith("https://");
}

/*
 * Why OneUptime refused a delivery, kept on the connection so the person
 * setting a stream up sees it. A refusal is answered in Firehose's own
 * contract; Firehose sends every refused batch again until its retry time
 * is up, then keeps it in the stack's bucket - but a batch too large, which
 * it drops.
 */
export enum CloudStreamRefusalReason {
  // The key is a stream key of this connection, but not its current or previous one.
  WrongKey = "wrong-key",
  // The connection is turned off.
  TurnedOff = "turned-off",
  // The project's plan does not include telemetry, or the project is blocked.
  NotAllowed = "not-allowed",
  // Larger than OneUptime takes: the stream's buffer is too large.
  TooLarge = "too-large",
  // Not a Firehose request body.
  Malformed = "malformed",
  // More deliveries a minute than a connection may make.
  Throttled = "throttled",
}

export const CLOUD_STREAM_REFUSAL_REASONS: ReadonlyArray<CloudStreamRefusalReason> =
  Object.values(CloudStreamRefusalReason);

export interface CloudStreamMetricSource {
  accountId: string;
  region: string;
  // The CloudWatch namespaces delivered from this account and Region.
  namespaces: Array<string>;
  // ISO time of the newest delivery.
  lastAt: string;
}

export interface CloudStreamLogSource {
  accountId: string;
  region: string;
  // The log groups delivered, the most recently seen first.
  logGroups: Array<string>;
  lastAt: string;
}

export interface CloudStreamRefusal {
  at: string;
  reason: CloudStreamRefusalReason;
}

/*
 * What a connection's streams delivered (CloudConnection.streamSummary).
 * Written by the ingest endpoint, at most once a minute for each server it
 * runs on; read by the dashboard and the connection's reads.
 */
export interface CloudStreamSummary {
  // When any delivery last arrived - a CloudWatch Logs test message too.
  lastDeliveryAt?: string | undefined;
  metricSources: Array<CloudStreamMetricSource>;
  logSources: Array<CloudStreamLogSource>;
  lastRefusal?: CloudStreamRefusal | undefined;
}

function readTime(value: JSONValue | undefined): string | undefined {
  if (typeof value !== "string" || !value) {
    return undefined;
  }

  const time: number = Date.parse(value);

  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function readName(value: unknown): string {
  return typeof value === "string"
    ? value.trim().slice(0, CLOUD_STREAM_MAX_NAME_LENGTH)
    : "";
}

function readNames(value: JSONValue | undefined, limit: number): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  const names: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const item of value) {
    const name: string = readName(item);

    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }

    if (names.length >= limit) {
      break;
    }
  }

  return names;
}

function readObjects(value: JSONValue | undefined): Array<JSONObject> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item: JSONValue): item is JSONObject => {
    return Boolean(item) && typeof item === "object" && !Array.isArray(item);
  }) as Array<JSONObject>;
}

/*
 * A stored summary as the summary it is - every field of the right type,
 * every list bounded - or an empty one. Never throws.
 */
export function readCloudStreamSummary(value: unknown): CloudStreamSummary {
  const summary: CloudStreamSummary = { metricSources: [], logSources: [] };

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return summary;
  }

  const stored: JSONObject = value as JSONObject;

  summary.lastDeliveryAt = readTime(stored["lastDeliveryAt"]);

  for (const item of readObjects(stored["metricSources"])) {
    const lastAt: string | undefined = readTime(item["lastAt"]);
    const accountId: string = readName(item["accountId"]);

    if (!lastAt || !accountId) {
      continue;
    }

    summary.metricSources.push({
      accountId,
      region: readName(item["region"]),
      namespaces: readNames(
        item["namespaces"],
        CLOUD_STREAM_MAX_NAMESPACES_PER_SOURCE,
      ),
      lastAt,
    });

    if (summary.metricSources.length >= CLOUD_STREAM_MAX_SOURCES) {
      break;
    }
  }

  for (const item of readObjects(stored["logSources"])) {
    const lastAt: string | undefined = readTime(item["lastAt"]);
    const accountId: string = readName(item["accountId"]);

    if (!lastAt || !accountId) {
      continue;
    }

    summary.logSources.push({
      accountId,
      region: readName(item["region"]),
      logGroups: readNames(
        item["logGroups"],
        CLOUD_STREAM_MAX_LOG_GROUPS_PER_SOURCE,
      ),
      lastAt,
    });

    if (summary.logSources.length >= CLOUD_STREAM_MAX_SOURCES) {
      break;
    }
  }

  const refusal: JSONValue | undefined = stored["lastRefusal"];

  if (refusal && typeof refusal === "object" && !Array.isArray(refusal)) {
    const at: string | undefined = readTime((refusal as JSONObject)["at"]);
    const reason: JSONValue | undefined = (refusal as JSONObject)["reason"];

    if (
      at &&
      typeof reason === "string" &&
      (CLOUD_STREAM_REFUSAL_REASONS as ReadonlyArray<string>).includes(reason)
    ) {
      summary.lastRefusal = {
        at,
        reason: reason as CloudStreamRefusalReason,
      };
    }
  }

  return summary;
}

function sourceKey(source: { accountId: string; region: string }): string {
  return `${source.accountId.toLowerCase()}|${source.region.toLowerCase()}`;
}

function newer(a: string | undefined, b: string | undefined): string {
  if (!a) {
    return b || "";
  }

  if (!b) {
    return a;
  }

  return Date.parse(a) >= Date.parse(b) ? a : b;
}

// Names of the newer list first, then the older one's, each once, at most `limit`.
function mergeNames(
  first: Array<string>,
  second: Array<string>,
  limit: number,
): Array<string> {
  const names: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const name of [...first, ...second]) {
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }

    if (names.length >= limit) {
      break;
    }
  }

  return names;
}

function mergeSources<
  T extends { accountId: string; region: string; lastAt: string },
>(data: {
  stored: Array<T>;
  seen: Array<T>;
  merge: (stored: T, seen: T) => T;
  now: Date;
}): Array<T> {
  const merged: Map<string, T> = new Map<string, T>();

  for (const source of data.stored) {
    merged.set(sourceKey(source), source);
  }

  for (const source of data.seen) {
    const key: string = sourceKey(source);
    const existing: T | undefined = merged.get(key);

    merged.set(key, existing ? data.merge(existing, source) : source);
  }

  const oldest: number = data.now.getTime() - CLOUD_STREAM_SOURCE_RETENTION_MS;

  return Array.from(merged.values())
    .filter((source: T): boolean => {
      return Date.parse(source.lastAt) >= oldest;
    })
    .sort((a: T, b: T): number => {
      return Date.parse(b.lastAt) - Date.parse(a.lastAt);
    })
    .slice(0, CLOUD_STREAM_MAX_SOURCES);
}

/*
 * The summary after what one server saw (`seen`) is added to what is
 * stored: each account and Region once, at its newest time, with every
 * namespace and log group either saw - the newest first - and the newer of
 * the two refusals. Sources not seen for a week are dropped. Merging the
 * same sighting twice changes nothing, so a server that writes what it saw
 * again a minute later never counts anything twice.
 */
export function mergeCloudStreamSummary(data: {
  stored: CloudStreamSummary;
  seen: CloudStreamSummary;
  now: Date;
}): CloudStreamSummary {
  const lastDeliveryAt: string = newer(
    data.stored.lastDeliveryAt,
    data.seen.lastDeliveryAt,
  );

  const refusals: Array<CloudStreamRefusal> = [
    data.stored.lastRefusal,
    data.seen.lastRefusal,
  ].filter((refusal: CloudStreamRefusal | undefined): boolean => {
    return Boolean(refusal);
  }) as Array<CloudStreamRefusal>;

  const lastRefusal: CloudStreamRefusal | undefined = refusals.sort(
    (a: CloudStreamRefusal, b: CloudStreamRefusal): number => {
      return Date.parse(b.at) - Date.parse(a.at);
    },
  )[0];

  return {
    ...(lastDeliveryAt ? { lastDeliveryAt } : {}),
    metricSources: mergeSources<CloudStreamMetricSource>({
      stored: data.stored.metricSources,
      seen: data.seen.metricSources,
      now: data.now,
      merge: (
        stored: CloudStreamMetricSource,
        seen: CloudStreamMetricSource,
      ): CloudStreamMetricSource => {
        const seenIsNewer: boolean =
          Date.parse(seen.lastAt) >= Date.parse(stored.lastAt);

        return {
          accountId: stored.accountId,
          region: stored.region,
          namespaces: seenIsNewer
            ? mergeNames(
                seen.namespaces,
                stored.namespaces,
                CLOUD_STREAM_MAX_NAMESPACES_PER_SOURCE,
              )
            : mergeNames(
                stored.namespaces,
                seen.namespaces,
                CLOUD_STREAM_MAX_NAMESPACES_PER_SOURCE,
              ),
          lastAt: newer(stored.lastAt, seen.lastAt),
        };
      },
    }),
    logSources: mergeSources<CloudStreamLogSource>({
      stored: data.stored.logSources,
      seen: data.seen.logSources,
      now: data.now,
      merge: (
        stored: CloudStreamLogSource,
        seen: CloudStreamLogSource,
      ): CloudStreamLogSource => {
        const seenIsNewer: boolean =
          Date.parse(seen.lastAt) >= Date.parse(stored.lastAt);

        return {
          accountId: stored.accountId,
          region: stored.region,
          logGroups: seenIsNewer
            ? mergeNames(
                seen.logGroups,
                stored.logGroups,
                CLOUD_STREAM_MAX_LOG_GROUPS_PER_SOURCE,
              )
            : mergeNames(
                stored.logGroups,
                seen.logGroups,
                CLOUD_STREAM_MAX_LOG_GROUPS_PER_SOURCE,
              ),
          lastAt: newer(stored.lastAt, seen.lastAt),
        };
      },
    }),
    ...(lastRefusal ? { lastRefusal } : {}),
  };
}

// "<account>|<region>|<namespace>", lower case: one streamed namespace.
export function getStreamedMetricKey(data: {
  accountId: string;
  region: string;
  namespace: string;
}): string {
  return `${data.accountId.trim().toLowerCase()}|${data.region
    .trim()
    .toLowerCase()}|${data.namespace.trim().toLowerCase()}`;
}

/*
 * The namespaces a stream delivered in the last
 * CLOUD_STREAM_ACTIVE_WINDOW_MS, by account and Region
 * (getStreamedMetricKey): what the connection's own reads no longer write.
 */
export function getStreamedMetricKeys(data: {
  summary: CloudStreamSummary;
  now: Date;
}): Set<string> {
  const keys: Set<string> = new Set<string>();
  const since: number = data.now.getTime() - CLOUD_STREAM_ACTIVE_WINDOW_MS;

  for (const source of data.summary.metricSources) {
    if (Date.parse(source.lastAt) < since) {
      continue;
    }

    for (const namespace of source.namespaces) {
      keys.add(
        getStreamedMetricKey({
          accountId: source.accountId,
          region: source.region,
          namespace,
        }),
      );
    }
  }

  return keys;
}

/*
 * How a connection's streaming is doing, as the connections list and the
 * streaming dialog say it:
 *
 *   off        no stream key: the connection is read on its schedule only;
 *   waiting    a key, and nothing delivered with any key yet;
 *   refused    the newest delivery was refused (why: lastRefusal);
 *   receiving  a delivery in the last CLOUD_STREAM_ACTIVE_WINDOW_MS;
 *   quiet      deliveries came, but none lately.
 */
export type CloudStreamState =
  | "off"
  | "waiting"
  | "refused"
  | "receiving"
  | "quiet";

export function getCloudStreamState(data: {
  hasKey: boolean;
  summary: CloudStreamSummary;
  now: Date;
}): CloudStreamState {
  if (!data.hasKey) {
    return "off";
  }

  const lastDelivery: number = data.summary.lastDeliveryAt
    ? Date.parse(data.summary.lastDeliveryAt)
    : NaN;
  const lastRefusal: number = data.summary.lastRefusal
    ? Date.parse(data.summary.lastRefusal.at)
    : NaN;

  if (
    Number.isFinite(lastRefusal) &&
    (!Number.isFinite(lastDelivery) || lastRefusal > lastDelivery) &&
    data.now.getTime() - lastRefusal <= CLOUD_STREAM_ACTIVE_WINDOW_MS
  ) {
    return "refused";
  }

  if (!Number.isFinite(lastDelivery)) {
    return "waiting";
  }

  return data.now.getTime() - lastDelivery <= CLOUD_STREAM_ACTIVE_WINDOW_MS
    ? "receiving"
    : "quiet";
}

/*
 * The connection's stream key hashes (CloudConnection.streamKeyHashes):
 * server only, never readable. The current key's SHA-256, and the keys it
 * replaced that still work, the newest first.
 */
export interface CloudStreamPreviousKeyHash {
  hash: string;
  expiresAt: string;
}

export interface CloudStreamKeyHashes {
  current?: { hash: string; createdAt: string } | undefined;
  previous?: Array<CloudStreamPreviousKeyHash> | undefined;
}

/*
 * How many replaced keys work at once. More than one: a key made twice
 * before the command ran - the dialog closed, then opened again - must not
 * stop the key the streams deliver with.
 */
export const CLOUD_STREAM_MAX_PREVIOUS_KEYS: number = 3;

/*
 * How many times a new key is written when other keys of the connection are
 * written at the same moment: each try reads the hashes again and rotates
 * the newer ones, so two admins making a key at once both keep theirs.
 */
export const CLOUD_STREAM_KEY_WRITE_ATTEMPTS: number = 5;

function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && value.length === 64 && isLowerHex(value);
}

export function readCloudStreamKeyHashes(value: unknown): CloudStreamKeyHashes {
  const hashes: CloudStreamKeyHashes = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return hashes;
  }

  const stored: JSONObject = value as JSONObject;
  const current: JSONValue | undefined = stored["current"];
  const previous: JSONValue | undefined = stored["previous"];

  if (current && typeof current === "object" && !Array.isArray(current)) {
    const hash: JSONValue | undefined = (current as JSONObject)["hash"];
    const createdAt: string | undefined = readTime(
      (current as JSONObject)["createdAt"],
    );

    if (isSha256Hex(hash) && createdAt) {
      hashes.current = { hash, createdAt };
    }
  }

  if (Array.isArray(previous)) {
    const read: Array<CloudStreamPreviousKeyHash> = [];

    for (const item of previous.slice(0, CLOUD_STREAM_MAX_PREVIOUS_KEYS)) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }

      const hash: JSONValue | undefined = (item as JSONObject)["hash"];
      const expiresAt: string | undefined = readTime(
        (item as JSONObject)["expiresAt"],
      );

      if (isSha256Hex(hash) && expiresAt) {
        read.push({ hash, expiresAt });
      }
    }

    if (read.length > 0) {
      hashes.previous = read;
    }
  }

  return hashes;
}

function isStillWorking(
  previous: CloudStreamPreviousKeyHash,
  now: Date,
): boolean {
  return Date.parse(previous.expiresAt) > now.getTime();
}

/*
 * The hashes a key may match now: the current one, and each replaced one
 * until it expires.
 */
export function getLiveCloudStreamKeyHashes(data: {
  hashes: CloudStreamKeyHashes;
  now: Date;
}): Array<string> {
  const live: Array<string> = [];

  if (data.hashes.current) {
    live.push(data.hashes.current.hash);
  }

  for (const previous of data.hashes.previous || []) {
    if (isStillWorking(previous, data.now)) {
      live.push(previous.hash);
    }
  }

  return live;
}

/*
 * The hashes after a new key is made: the new one is current, and the key
 * it replaces works for CLOUD_STREAM_PREVIOUS_KEY_GRACE_MS more. Keys
 * replaced before it keep their own time - a new key never extends one -
 * and at most CLOUD_STREAM_MAX_PREVIOUS_KEYS work at once, the oldest
 * stopping first.
 */
export function rotateCloudStreamKeyHashes(data: {
  hashes: CloudStreamKeyHashes;
  newHash: string;
  now: Date;
}): CloudStreamKeyHashes {
  const previous: Array<CloudStreamPreviousKeyHash> = [
    ...(data.hashes.current
      ? [
          {
            hash: data.hashes.current.hash,
            expiresAt: new Date(
              data.now.getTime() + CLOUD_STREAM_PREVIOUS_KEY_GRACE_MS,
            ).toISOString(),
          },
        ]
      : []),
    ...(data.hashes.previous || []).filter(
      (item: CloudStreamPreviousKeyHash): boolean => {
        return isStillWorking(item, data.now);
      },
    ),
  ].slice(0, CLOUD_STREAM_MAX_PREVIOUS_KEYS);

  return {
    current: { hash: data.newHash, createdAt: data.now.toISOString() },
    ...(previous.length > 0 ? { previous } : {}),
  };
}
