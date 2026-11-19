import Redis, { ClientType } from "../../Infrastructure/Redis";
import {
  AWS_DEFAULT_PERIOD_SECONDS,
  AwsKeyMetric,
  AwsStatistic,
  getAwsKeyMetricOfStoredName,
} from "../../../Types/Cloud/CloudKeyMetrics";
import {
  CloudMonitoredResource,
  buildCloudMonitoredResourceIdentifier,
} from "../../../Types/Cloud/CloudMonitoredResource";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { isCloudReadingKeyOfType } from "../../../Types/Cloud/CloudReadingKeys";
import {
  CloudResourceReading,
  getCloudReadingKey,
} from "../../../Types/Cloud/CloudResourceHealth";
import Crypto from "../../../Utils/Crypto";
import logger from "../Logger";
import { CollectedCloudReadings } from "./CloudResourceReadings";

/*
 * A STREAMING AWS ACCOUNT'S READINGS, FROM ITS STREAM (#9690).
 *
 * A resource's readings - the newest value of each metric its health rules,
 * its headlines and its recommended monitors read (CloudResourceReadings) -
 * were written by the connection's read alone, from what it read with
 * GetMetricData. So an account whose stream carries those metrics still
 * had them read from CloudWatch every read, billed per metric, while its
 * stream delivered them every minute. Now the stream's readings are kept:
 *
 *  - the ingest (AwsFirehoseIngestService) notes, for each datapoint of a
 *    key metric a resource's readings keep, the minute's summary: how many
 *    values, their sum, least and most (StreamedReadingMinute). Each is
 *    merged, once - a delivery sent again counts nothing twice - into its
 *    five-minute period, the read's own (AWS_DEFAULT_PERIOD_SECONDS), in
 *    Redis, kept CLOUD_STREAM_READINGS_TTL_SECONDS;
 *  - the read takes, for each resource and reading, the newest period the
 *    stream has had time to finish (CLOUD_STREAM_READINGS_SETTLE_MS after
 *    its end), as the read's statistic over its five minutes: a Sum the
 *    sum of the minutes' sums, an Average their values' sum over their
 *    count, a Maximum the most, a Minimum the least, a SampleCount the
 *    count. So a perPeriod headline and a count-based rule read what a
 *    read of the same CloudWatch data reads: five one-minute sums are one
 *    five-minute Sum;
 *  - the read leaves those metrics to the stream - it neither reads nor
 *    writes them - only for an account and Region whose streamed readings
 *    are fresh (getFreshStreamedReadingSources: a minute of any of its
 *    metrics noted in the last CLOUD_STREAM_READINGS_FRESH_MS, so a
 *    resource whose metric is quiet is quiet in either). A stream that
 *    goes quiet or falls behind, a cache that lost them, or a stack that
 *    does not carry a metric: the read reads it from CloudWatch, as
 *    before, and says so.
 *
 * An account that does not stream is read exactly as before: nothing of
 * this is asked.
 */

// The read's period: the readings a stream's minutes make.
export const CLOUD_STREAM_READINGS_PERIOD_MS: number =
  AWS_DEFAULT_PERIOD_SECONDS * 1000;

/*
 * How long after a period ends its minutes have all arrived: a metric
 * stream sends each minute within two or three, and Firehose holds a batch
 * a minute at most.
 */
export const CLOUD_STREAM_READINGS_SETTLE_MS: number = 5 * 60 * 1000;

/*
 * How recent the newest minute of an account and Region's metrics must be
 * for the read to leave its readings to the stream: a metric stream sends
 * a minute within two or three, Firehose holds a batch a minute at most -
 * so ten minutes is a stream that is not quiet, nor behind.
 */
export const CLOUD_STREAM_READINGS_FRESH_MS: number = 10 * 60 * 1000;

// How long a period's readings are kept: past the next read's, at a read's longest interval.
export const CLOUD_STREAM_READINGS_TTL_SECONDS: number = 40 * 60;

// The periods a read looks through, the newest first.
export const CLOUD_STREAM_READINGS_LOOKBACK_MS: number = 30 * 60 * 1000;

// Minutes of a period.
const MINUTES_PER_PERIOD: number = CLOUD_STREAM_READINGS_PERIOD_MS / 60_000;

/*
 * One minute of one series of a resource's reading, as a stream delivered
 * it: CloudWatch's own summary of the minute (Statistics definitions:
 * SampleCount, Sum, Minimum, Maximum), which every statistic is read from.
 */
export interface StreamedReadingMinute {
  // The resource, as CloudResource.resourceIdentifier (lower case).
  identifier: string;
  resourceType: string;
  // The reading's key (getCloudReadingKey): "aws/ec2/cpuutilization".
  key: string;
  // The series, of those the resource's metric is read from: its dimensions, told apart.
  series: string;
  accountId: string;
  region: string;
  // When the minute starts, in milliseconds.
  minuteMs: number;
  count: number;
  sum: number;
  min: number;
  max: number;
}

// What a period of one series holds, as it is kept: the minutes in it, and their summary.
export interface StreamedReadingPeriod {
  // One flag a minute of the period: a minute merged twice counts once.
  minutes: string;
  count: number;
  sum: number;
  min: number;
  max: number;
}

/*
 * One streamed minute of a key metric's series, as a minute of a reading -
 * or null when the resource's type keeps no reading of it
 * (isCloudReadingKeyOfType), or the minute holds no value.
 */
export function toStreamedReadingMinute(data: {
  resource: Pick<
    CloudMonitoredResource,
    "provider" | "identityKey" | "resourceType" | "accountId" | "region"
  >;
  // Its stored name: "amazonaws.com/AWS/EC2/CPUUtilization".
  metricName: string;
  // The series' dimensions, by name.
  dimensions: Readonly<Record<string, string>>;
  minuteMs: number;
  count: number;
  sum: number;
  min: number | null;
  max: number | null;
}): StreamedReadingMinute | null {
  const key: string | null = getCloudReadingKey(
    CloudProvider.AWS,
    data.metricName,
  );

  if (
    !key ||
    !isCloudReadingKeyOfType({
      provider: CloudProvider.AWS,
      resourceType: data.resource.resourceType,
      key,
    }) ||
    !(data.count > 0) ||
    !Number.isFinite(data.sum) ||
    !Number.isFinite(data.minuteMs)
  ) {
    return null;
  }

  // A minute without its least and most (or with one that is not a number): its average stands for both.
  const average: number = data.sum / data.count;

  return {
    identifier: buildCloudMonitoredResourceIdentifier(
      data.resource,
    ).toLowerCase(),
    resourceType: data.resource.resourceType,
    key,
    series: Object.keys(data.dimensions)
      .sort()
      .map((name: string): string => {
        return `${name.toLowerCase()}=${(data.dimensions[name] || "").toLowerCase()}`;
      })
      .join("\n"),
    accountId: data.resource.accountId,
    region: data.resource.region,
    minuteMs: data.minuteMs,
    count: data.count,
    sum: data.sum,
    min: isFiniteNumber(data.min) ? data.min : average,
    max: isFiniteNumber(data.max) ? data.max : average,
  };
}

function isFiniteNumber(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// The period a minute is of, by its start.
export function getStreamedReadingPeriodStart(minuteMs: number): number {
  return (
    Math.floor(minuteMs / CLOUD_STREAM_READINGS_PERIOD_MS) *
    CLOUD_STREAM_READINGS_PERIOD_MS
  );
}

// Where a series' period is kept in its period's hash.
export function getStreamedReadingField(
  minute: Pick<
    StreamedReadingMinute,
    "identifier" | "key" | "series" | "resourceType"
  >,
): string {
  return [
    minute.identifier,
    minute.key,
    // Told apart, never read back: twelve hex characters of its dimensions.
    Crypto.getSha256Hash(minute.series || "").slice(0, 12),
    minute.resourceType,
  ].join("|");
}

function readField(field: string): {
  identifier: string;
  key: string;
  resourceType: string;
} | null {
  const parts: Array<string> = field.split("|");

  return parts.length === 4 && parts[0] && parts[1]
    ? { identifier: parts[0], key: parts[1], resourceType: parts[3] || "" }
    : null;
}

export function writeStreamedReadingPeriod(
  period: StreamedReadingPeriod,
): string {
  return [
    period.minutes,
    period.count,
    period.sum,
    period.min,
    period.max,
  ].join(",");
}

// A kept period, read back; null for anything that is not one.
export function readStreamedReadingPeriod(
  value: string | null | undefined,
): StreamedReadingPeriod | null {
  const parts: Array<string> = (value || "").split(",");

  if (parts.length !== 5 || parts[0]!.length !== MINUTES_PER_PERIOD) {
    return null;
  }

  const [count, sum, min, max] = parts.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
  ];

  if (![count, sum, min, max].every(Number.isFinite) || count <= 0) {
    return null;
  }

  return { minutes: parts[0]!, count, sum, min, max };
}

/*
 * A minute merged into its series' period, as the store's script merges it
 * (CLOUD_STREAM_READINGS_MERGE_SCRIPT): a minute the period holds already
 * changes nothing.
 */
export function mergeStreamedReadingMinute(
  stored: StreamedReadingPeriod | null,
  minute: Pick<
    StreamedReadingMinute,
    "minuteMs" | "count" | "sum" | "min" | "max"
  >,
): StreamedReadingPeriod {
  const index: number = Math.floor(
    (minute.minuteMs - getStreamedReadingPeriodStart(minute.minuteMs)) / 60_000,
  );
  const period: StreamedReadingPeriod = stored || {
    minutes: "0".repeat(MINUTES_PER_PERIOD),
    count: 0,
    sum: 0,
    min: minute.min,
    max: minute.max,
  };

  if (period.minutes.charAt(index) === "1") {
    return period;
  }

  return {
    minutes: `${period.minutes.slice(0, index)}1${period.minutes.slice(index + 1)}`,
    count: period.count + minute.count,
    sum: period.sum + minute.sum,
    min: stored ? Math.min(period.min, minute.min) : minute.min,
    max: stored ? Math.max(period.max, minute.max) : minute.max,
  };
}

/*
 * The read's statistic of a period's summary, across the series of the
 * resource's reading: a Sum adds every series' (a count published per part
 * of the resource is the resource's sum), an Average weighs each value
 * alike, a Maximum is the most, a Minimum the least, a SampleCount the
 * values. Null for a reading no key metric is.
 */
export function readStreamedStatistic(
  statistic: AwsStatistic,
  periods: Array<StreamedReadingPeriod>,
): number | null {
  if (periods.length === 0) {
    return null;
  }

  let count: number = 0;
  let sum: number = 0;
  let min: number = Number.POSITIVE_INFINITY;
  let max: number = Number.NEGATIVE_INFINITY;

  for (const period of periods) {
    count += period.count;
    sum += period.sum;
    min = Math.min(min, period.min);
    max = Math.max(max, period.max);
  }

  switch (statistic) {
    case "Sum":
      return sum;
    case "SampleCount":
      return count;
    case "Average":
      return count > 0 ? sum / count : null;
    case "Maximum":
      return max;
    case "Minimum":
      return min;
  }

  return null;
}

// The statistic a reading's key metric is read with: its key is its stored name without amazonaws.com/.
function statisticOf(key: string): AwsStatistic | null {
  const metric: AwsKeyMetric | undefined = getAwsKeyMetricOfStoredName(
    `amazonaws.com/${key}`,
  )?.metric;

  return metric ? metric.statistic : null;
}

/*
 * The readings a stream's kept periods make, by resource: for each of its
 * readings, the newest period the stream has had time to finish
 * (CLOUD_STREAM_READINGS_SETTLE_MS after its end) - a period still filling
 * would read a part of its five minutes - stamped with its start, as the
 * read stamps a period's value.
 */
export function readStreamedReadings(data: {
  // Each period's hash, by the period's start.
  periods: ReadonlyMap<number, Readonly<Record<string, string>>>;
  now: Date;
}): Map<string, CollectedCloudReadings> {
  const settledBefore: number =
    data.now.getTime() - CLOUD_STREAM_READINGS_SETTLE_MS;
  // Per resource and reading: the newest settled period, and its series.
  const newest: Map<
    string,
    {
      identifier: string;
      key: string;
      resourceType: string;
      periodStart: number;
      series: Array<StreamedReadingPeriod>;
    }
  > = new Map();

  for (const [periodStart, fields] of data.periods) {
    if (periodStart + CLOUD_STREAM_READINGS_PERIOD_MS > settledBefore) {
      continue;
    }

    for (const [field, value] of Object.entries(fields)) {
      const where: {
        identifier: string;
        key: string;
        resourceType: string;
      } | null = readField(field);
      const period: StreamedReadingPeriod | null =
        readStreamedReadingPeriod(value);

      if (!where || !period) {
        continue;
      }

      const reading: string = `${where.identifier}\n${where.key}`;
      const known:
        | {
            identifier: string;
            key: string;
            resourceType: string;
            periodStart: number;
            series: Array<StreamedReadingPeriod>;
          }
        | undefined = newest.get(reading);

      if (!known || known.periodStart < periodStart) {
        newest.set(reading, { ...where, periodStart, series: [period] });
      } else if (known.periodStart === periodStart) {
        known.series.push(period);
      }
    }
  }

  const collected: Map<string, CollectedCloudReadings> = new Map();

  for (const entry of newest.values()) {
    const statistic: AwsStatistic | null = statisticOf(entry.key);
    const value: number | null = statistic
      ? readStreamedStatistic(statistic, entry.series)
      : null;

    if (value === null || !Number.isFinite(value)) {
      continue;
    }

    const readings: CollectedCloudReadings = collected.get(
      entry.identifier,
    ) || {
      provider: CloudProvider.AWS,
      resourceType: entry.resourceType,
      readings: {},
    };

    readings.readings[entry.key] = {
      value,
      time: new Date(entry.periodStart).toISOString(),
    };
    collected.set(entry.identifier, readings);
  }

  return collected;
}

/*
 * The accounts and Regions ("<account>|<region>", lower case) whose stream
 * noted a minute of any metric in the last CLOUD_STREAM_READINGS_FRESH_MS:
 * the read leaves their streamed readings to the stream, and reads every
 * other one.
 */
export function getFreshStreamedReadingSources(data: {
  // The newest minute noted of each, by "<account>|<region>".
  newestMinutes: Readonly<Record<string, string>>;
  now: Date;
}): Set<string> {
  const freshSince: number =
    data.now.getTime() - CLOUD_STREAM_READINGS_FRESH_MS;
  const fresh: Set<string> = new Set<string>();

  for (const [source, value] of Object.entries(data.newestMinutes)) {
    const minuteMs: number = Number(value);

    if (Number.isFinite(minuteMs) && minuteMs >= freshSince) {
      fresh.add(source.toLowerCase());
    }
  }

  return fresh;
}

export function getStreamedReadingSource(data: {
  accountId: string;
  region: string;
}): string {
  return `${data.accountId.trim()}|${data.region.trim()}`.toLowerCase();
}

/*
 * The store's merge, in Redis: each argument after the first two names a
 * field, its minute of the period (1 to 5) and the minute's count, sum,
 * least and most, merged as mergeStreamedReadingMinute merges them; the
 * hash then expires ARGV[1] seconds on.
 */
export const CLOUD_STREAM_READINGS_MERGE_SCRIPT: string = [
  "for i = 2, #ARGV, 6 do",
  "  local field = ARGV[i]",
  "  local minute = tonumber(ARGV[i + 1])",
  "  local count = tonumber(ARGV[i + 2])",
  "  local sum = tonumber(ARGV[i + 3])",
  "  local low = tonumber(ARGV[i + 4])",
  "  local high = tonumber(ARGV[i + 5])",
  "  local stored = redis.call('HGET', KEYS[1], field)",
  "  local minutes = '00000'",
  "  if stored then",
  "    local parts = {}",
  "    for part in string.gmatch(stored, '[^,]+') do table.insert(parts, part) end",
  "    minutes = parts[1]",
  "    count = count + tonumber(parts[2])",
  "    sum = sum + tonumber(parts[3])",
  "    low = math.min(low, tonumber(parts[4]))",
  "    high = math.max(high, tonumber(parts[5]))",
  "  end",
  "  if string.sub(minutes, minute, minute) ~= '1' then",
  "    minutes = string.sub(minutes, 1, minute - 1) .. '1' .. string.sub(minutes, minute + 1)",
  "    redis.call('HSET', KEYS[1], field, minutes .. ',' .. string.format('%.17g', count) .. ',' .. string.format('%.17g', sum) .. ',' .. string.format('%.17g', low) .. ',' .. string.format('%.17g', high))",
  "  end",
  "end",
  "redis.call('EXPIRE', KEYS[1], ARGV[1])",
  "return 1",
].join("\n");

/*
 * The newest minute noted of an account and Region, kept only when it is
 * newer than the one there: a delivery sent again, or late, never moves it
 * back.
 */
export const CLOUD_STREAM_READINGS_NEWEST_SCRIPT: string = [
  "for i = 2, #ARGV, 2 do",
  "  local stored = redis.call('HGET', KEYS[1], ARGV[i])",
  "  if not stored or tonumber(ARGV[i + 1]) > tonumber(stored) then",
  "    redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1])",
  "  end",
  "end",
  "redis.call('EXPIRE', KEYS[1], ARGV[1])",
  "return 1",
].join("\n");

// Where the store keeps things.
export interface CloudStreamReadingsStore {
  // Merges each field's minute into the hash, which expires ttlSeconds on.
  merge(
    key: string,
    entries: Array<{ field: string; minute: StreamedReadingMinute }>,
    ttlSeconds: number,
  ): Promise<void>;
  // Keeps each source's newest minute, when newer.
  noteNewest(
    key: string,
    newest: Record<string, number>,
    ttlSeconds: number,
  ): Promise<void>;
  // Each hash, as it is: {} for one that is not there.
  readHashes(keys: Array<string>): Promise<Array<Record<string, string>>>;
}

const NAMESPACE: string = "cloud-stream-readings";
// The most fields one merge sends: a delivery of many resources is several.
const MAX_FIELDS_PER_MERGE: number = 1000;

export function getStreamedReadingsPeriodKey(
  connectionId: string,
  periodStart: number,
): string {
  return `${NAMESPACE}-${connectionId}-${periodStart}`;
}

export function getStreamedReadingsSourcesKey(connectionId: string): string {
  return `${NAMESPACE}-sources-${connectionId}`;
}

export const REDIS_STREAM_READINGS_STORE: CloudStreamReadingsStore = {
  merge: async (
    key: string,
    entries: Array<{ field: string; minute: StreamedReadingMinute }>,
    ttlSeconds: number,
  ): Promise<void> => {
    const client: ClientType = connectedClient();

    for (
      let start: number = 0;
      start < entries.length;
      start += MAX_FIELDS_PER_MERGE
    ) {
      const args: Array<string> = [String(ttlSeconds)];

      for (const entry of entries.slice(start, start + MAX_FIELDS_PER_MERGE)) {
        args.push(
          entry.field,
          String(
            Math.floor(
              (entry.minute.minuteMs -
                getStreamedReadingPeriodStart(entry.minute.minuteMs)) /
                60_000,
            ) + 1,
          ),
          String(entry.minute.count),
          String(entry.minute.sum),
          String(entry.minute.min),
          String(entry.minute.max),
        );
      }

      await client.eval(CLOUD_STREAM_READINGS_MERGE_SCRIPT, 1, key, ...args);
    }
  },
  noteNewest: async (
    key: string,
    newest: Record<string, number>,
    ttlSeconds: number,
  ): Promise<void> => {
    const args: Array<string> = [String(ttlSeconds)];

    for (const [source, minuteMs] of Object.entries(newest)) {
      args.push(source, String(minuteMs));
    }

    await connectedClient().eval(
      CLOUD_STREAM_READINGS_NEWEST_SCRIPT,
      1,
      key,
      ...args,
    );
  },
  readHashes: async (
    keys: Array<string>,
  ): Promise<Array<Record<string, string>>> => {
    const client: ClientType = connectedClient();

    return await Promise.all(
      keys.map(async (key: string): Promise<Record<string, string>> => {
        return (await client.hgetall(key)) || {};
      }),
    );
  },
};

function connectedClient(): ClientType {
  const client: ClientType | null = Redis.getClient();

  if (!client || !Redis.isConnected()) {
    throw new Error("The cache is not connected.");
  }

  return client;
}

export default class CloudStreamReadings {
  // Where the readings are kept; replaced in tests.
  public static store: CloudStreamReadingsStore = REDIS_STREAM_READINGS_STORE;

  /*
   * What one delivery said of its resources' readings, kept: each minute
   * merged into its period, then each account and Region's newest minute -
   * so one is fresh only once its minutes are kept. Never throws: the
   * delivery is taken whatever happens here, and a read that finds nothing
   * fresh reads from CloudWatch.
   */
  public static async noteDelivery(data: {
    connectionId: string;
    minutes: Array<StreamedReadingMinute>;
    // Each account and Region its metrics came from, and the newest minute of any of them.
    sources?:
      | Array<{ accountId: string; region: string; newestMs: number | null }>
      | undefined;
  }): Promise<void> {
    const sources: Array<{
      accountId: string;
      region: string;
      newestMs: number | null;
    }> = data.sources || [];

    if (data.minutes.length === 0 && sources.length === 0) {
      return;
    }

    try {
      const byPeriod: Map<
        number,
        Array<{ field: string; minute: StreamedReadingMinute }>
      > = new Map();
      const newest: Record<string, number> = {};

      for (const minute of data.minutes) {
        const periodStart: number = getStreamedReadingPeriodStart(
          minute.minuteMs,
        );
        const entries: Array<{
          field: string;
          minute: StreamedReadingMinute;
        }> = byPeriod.get(periodStart) || [];

        entries.push({ field: getStreamedReadingField(minute), minute });
        byPeriod.set(periodStart, entries);

        const source: string = getStreamedReadingSource(minute);
        newest[source] = Math.max(newest[source] || 0, minute.minuteMs);
      }

      for (const delivered of sources) {
        if (delivered.newestMs === null || !(delivered.newestMs > 0)) {
          continue;
        }

        const source: string = getStreamedReadingSource(delivered);
        newest[source] = Math.max(newest[source] || 0, delivered.newestMs);
      }

      if (Object.keys(newest).length === 0) {
        return;
      }

      for (const [periodStart, entries] of byPeriod) {
        await CloudStreamReadings.store.merge(
          getStreamedReadingsPeriodKey(data.connectionId, periodStart),
          entries,
          CLOUD_STREAM_READINGS_TTL_SECONDS,
        );
      }

      await CloudStreamReadings.store.noteNewest(
        getStreamedReadingsSourcesKey(data.connectionId),
        newest,
        CLOUD_STREAM_READINGS_TTL_SECONDS,
      );
    } catch (error) {
      logger.warn(
        `Cloud stream ${data.connectionId}: its resources' readings could not be kept: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /*
   * What a read takes of a connection's streams: the readings of its
   * resources, and the accounts and Regions whose readings are fresh. None
   * of either when they cannot be read: the read reads from CloudWatch.
   */
  public static async load(data: { connectionId: string; now: Date }): Promise<{
    readings: Map<string, CollectedCloudReadings>;
    freshSources: Set<string>;
  }> {
    try {
      const newestPeriod: number = getStreamedReadingPeriodStart(
        data.now.getTime(),
      );
      const periodStarts: Array<number> = [];

      for (
        let start: number = newestPeriod;
        start >= data.now.getTime() - CLOUD_STREAM_READINGS_LOOKBACK_MS;
        start -= CLOUD_STREAM_READINGS_PERIOD_MS
      ) {
        periodStarts.push(start);
      }

      const hashes: Array<Record<string, string>> =
        await CloudStreamReadings.store.readHashes([
          getStreamedReadingsSourcesKey(data.connectionId),
          ...periodStarts.map((start: number): string => {
            return getStreamedReadingsPeriodKey(data.connectionId, start);
          }),
        ]);
      const periods: Map<number, Record<string, string>> = new Map();

      periodStarts.forEach((start: number, index: number): void => {
        periods.set(start, hashes[index + 1] || {});
      });

      return {
        readings: readStreamedReadings({ periods, now: data.now }),
        freshSources: getFreshStreamedReadingSources({
          newestMinutes: hashes[0] || {},
          now: data.now,
        }),
      };
    } catch (error) {
      logger.warn(
        `Cloud connection ${data.connectionId}: its streams' readings could not be read, so this read reads them from CloudWatch: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return { readings: new Map(), freshSources: new Set<string>() };
    }
  }
}

/*
 * Two collections of readings as one, by resource: of a reading both
 * have, the newer - a read's and a stream's of one resource stand side by
 * side.
 */
export function mergeCollectedReadings(
  first: ReadonlyMap<string, CollectedCloudReadings>,
  second: ReadonlyMap<string, CollectedCloudReadings>,
): Map<string, CollectedCloudReadings> {
  const merged: Map<string, CollectedCloudReadings> = new Map();

  for (const [identifier, entry] of first) {
    merged.set(identifier, {
      ...entry,
      readings: { ...entry.readings },
    });
  }

  for (const [identifier, entry] of second) {
    const existing: CollectedCloudReadings | undefined = merged.get(identifier);

    if (!existing) {
      merged.set(identifier, { ...entry, readings: { ...entry.readings } });
      continue;
    }

    for (const [key, reading] of Object.entries(entry.readings)) {
      const known: CloudResourceReading | undefined = existing.readings[key];

      if (!known || Date.parse(known.time) < Date.parse(reading.time)) {
        existing.readings[key] = reading;
      }
    }
  }

  return merged;
}
