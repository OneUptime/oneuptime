import AggregationType from "../BaseDatabase/AggregationType";
import {
  DatabaseAlertQuery,
  DatabaseAlertTemplate,
  getAllDatabaseAlertTemplates,
} from "../Monitor/DatabaseAlertTemplates";

/*
 * ------------------------------------------------------------------
 * WHAT A DATABASE'S ENGINE LAST REPORTED, AS ITS ALERT TEMPLATES READ IT
 * ------------------------------------------------------------------
 *
 * A database's health is judged by its engine's alert templates
 * (DatabaseAlertTemplates): PostgreSQL's connections against
 * max_connections, a replica's replay lag, Redis's memory against
 * maxmemory. Each template reads a few queries - a metric, the datapoint
 * attributes it pins, how a bucket's samples fold into one number - and
 * the metrics ingest works out every one of those queries from each batch
 * a database's collector sends (DatabaseEngineReadingsScan), so the
 * Databases list, a database's Overview and its Needs attention read
 * Postgres instead of asking ClickHouse once per row.
 *
 * A reading is keyed by its query (getDatabaseEngineReadingKey): two
 * templates that read the same query share one reading, and a query a
 * template changes gets a new key, never an old number under a new line.
 *
 * Several agents can report one database - one per replica-set member,
 * each stamping the same DATABASE_SERVER_ID - so the readings are kept per
 * reporting instance (its server.address and server.port) and folded at
 * judgement time the way the template's query folds the series of a bucket
 * across every member: Sum adds them, Max keeps the worst, Min the lowest,
 * Avg averages them. An instance that has not reported for fifteen minutes
 * no longer counts (DATABASE_ENGINE_READINGS_STALE_MS), and one silent for
 * an hour is dropped at the next write.
 *
 * Pure and isomorphic: the server writes it, the Dashboard and the App
 * tests read it. The values come from the database's collector, so every
 * number is checked to be finite and every key is bounded.
 */

export interface DatabaseEngineReadingsInstance {
  // When OneUptime received the batch the readings came from (ISO 8601).
  at: string;
  // Each template query's value in that batch, by reading key.
  values: Record<string, number>;
}

export interface DatabaseEngineReadings {
  // By reporting instance: "db.prod.internal:5432", or "-" when unnamed.
  instances: Record<string, DatabaseEngineReadingsInstance>;
}

// A reading older than this is not judged: the engine stopped sending it.
export const DATABASE_ENGINE_READINGS_STALE_MS: number = 15 * 60 * 1000;

// An instance silent for this long is dropped from the record at the next write.
export const DATABASE_ENGINE_READINGS_FORGET_MS: number = 60 * 60 * 1000;

// The most reporting instances one database keeps readings for.
export const DATABASE_ENGINE_READINGS_MAX_INSTANCES: number = 8;

// The instance of a batch that names no server.address.
export const DATABASE_ENGINE_READINGS_UNNAMED_INSTANCE: string = "-";

// An instance's name, as long as its column can hold it.
export const DATABASE_ENGINE_READINGS_INSTANCE_MAX_LENGTH: number = 200;

/*
 * One template query as the ingest computes it: its key, the metric, the
 * datapoint attributes it pins and how its datapoints fold.
 */
export interface DatabaseEngineReadingQuery {
  key: string;
  metricName: string;
  aggregationType: AggregationType;
  attributes: Readonly<Record<string, string>>;
}

/*
 * "Max|mysql.threads|kind=running": the aggregation, the metric and the
 * pinned attributes in key order. Readable in a stored row, and unique per
 * query whatever order a template wrote its attributes in.
 */
export function getDatabaseEngineReadingKey(
  query: Pick<DatabaseAlertQuery, "metricName" | "aggregationType"> & {
    attributes?: Readonly<Record<string, string>> | undefined;
  },
): string {
  const attributes: Readonly<Record<string, string>> = query.attributes || {};
  const pinned: string = Object.keys(attributes)
    .sort()
    .map((key: string): string => {
      return `${key}=${attributes[key]}`;
    })
    .join(",");

  return `${query.aggregationType}|${query.metricName}|${pinned}`;
}

let readingQueriesMemo: Array<DatabaseEngineReadingQuery> | null = null;

/*
 * Every query any database alert template reads, once each, in template
 * order - what the ingest works out from a batch. The Engine Metrics
 * Stopped templates' heartbeat counts are among them: they are read on
 * every successful scrape, so a database whose engine reports keeps fresh
 * readings even while no threshold of its own arrived in a batch.
 */
export function getDatabaseEngineReadingQueries(): ReadonlyArray<DatabaseEngineReadingQuery> {
  if (readingQueriesMemo) {
    return readingQueriesMemo;
  }

  const queries: Array<DatabaseEngineReadingQuery> = [];
  const seen: Set<string> = new Set<string>();

  for (const template of getAllDatabaseAlertTemplates()) {
    for (const query of template.queries) {
      const key: string = getDatabaseEngineReadingKey(query);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      queries.push({
        key: key,
        metricName: query.metricName,
        aggregationType: query.aggregationType,
        attributes: { ...(query.attributes || {}) },
      });
    }
  }

  readingQueriesMemo = queries;
  return queries;
}

// The metric names the ingest reads for a database, and nothing else.
export function getDatabaseEngineReadingMetricNames(): ReadonlySet<string> {
  return new Set<string>(
    getDatabaseEngineReadingQueries().map(
      (query: DatabaseEngineReadingQuery): string => {
        return query.metricName;
      },
    ),
  );
}

// The reading keys a template's queries are stored under, by query alias.
export function getDatabaseAlertTemplateReadingKeys(
  template: Pick<DatabaseAlertTemplate, "queries">,
): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const query of template.queries) {
    keys[query.alias] = getDatabaseEngineReadingKey(query);
  }
  return keys;
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const date: Date =
    value instanceof Date ? value : new Date(String(value as string));
  return Number.isNaN(date.getTime()) ? null : date;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/*
 * The readings a row holds, checked: an instance with no valid time, and a
 * value that is not a finite number, are left out, so a row written by an
 * older or a foreign writer can never make a page throw. Null when nothing
 * valid is left.
 */
export function parseDatabaseEngineReadings(
  value: unknown,
): DatabaseEngineReadings | null {
  if (!isPlainObject(value) || !isPlainObject(value["instances"])) {
    return null;
  }

  const instances: Record<string, DatabaseEngineReadingsInstance> = {};
  const raw: Record<string, unknown> = value["instances"] as Record<
    string,
    unknown
  >;

  for (const name of Object.keys(raw)) {
    const instance: unknown = raw[name];
    if (!isPlainObject(instance)) {
      continue;
    }
    const at: Date | null = toDate(instance["at"]);
    if (!at || !isPlainObject(instance["values"])) {
      continue;
    }
    const values: Record<string, number> = {};
    const rawValues: Record<string, unknown> = instance["values"] as Record<
      string,
      unknown
    >;
    for (const key of Object.keys(rawValues)) {
      const reading: unknown = rawValues[key];
      if (typeof reading === "number" && Number.isFinite(reading)) {
        values[key] = reading;
      }
    }
    instances[name] = { at: at.toISOString(), values: values };
  }

  return Object.keys(instances).length > 0 ? { instances: instances } : null;
}

// "db.prod.internal:5432" from what a batch's resource names, or "-".
export function getDatabaseEngineReadingsInstanceName(data: {
  serverAddress?: string | null | undefined;
  serverPort?: string | number | null | undefined;
}): string {
  const address: string = String(data.serverAddress || "")
    .trim()
    .toLowerCase();
  const port: string = String(
    data.serverPort === null || data.serverPort === undefined
      ? ""
      : data.serverPort,
  ).trim();

  if (!address) {
    return DATABASE_ENGINE_READINGS_UNNAMED_INSTANCE;
  }

  const name: string = port ? `${address}:${port}` : address;
  return name.length > DATABASE_ENGINE_READINGS_INSTANCE_MAX_LENGTH
    ? name.substring(0, DATABASE_ENGINE_READINGS_INSTANCE_MAX_LENGTH)
    : name;
}

/*
 * The record after one instance's batch: its readings replace what that
 * instance sent before (a reading it no longer sends - a replica promoted to
 * primary stops reporting lag - goes with them), every other instance keeps
 * its own, an instance silent for an hour is dropped, and at most
 * DATABASE_ENGINE_READINGS_MAX_INSTANCES are kept, the most recent.
 */
export function mergeDatabaseEngineReadings(data: {
  existing: unknown;
  instance: string;
  values: Record<string, number>;
  now: Date;
}): DatabaseEngineReadings {
  const existing: DatabaseEngineReadings | null = parseDatabaseEngineReadings(
    data.existing,
  );
  const values: Record<string, number> = {};
  for (const key of Object.keys(data.values)) {
    const value: number | undefined = data.values[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      values[key] = value;
    }
  }

  const entries: Array<[string, DatabaseEngineReadingsInstance]> = [];
  for (const name of Object.keys(existing?.instances || {})) {
    if (name === data.instance) {
      continue;
    }
    const instance: DatabaseEngineReadingsInstance =
      existing!.instances[name]!;
    const at: Date | null = toDate(instance.at);
    if (
      !at ||
      data.now.getTime() - at.getTime() > DATABASE_ENGINE_READINGS_FORGET_MS
    ) {
      continue;
    }
    entries.push([name, instance]);
  }

  entries.push([
    data.instance,
    { at: data.now.toISOString(), values: values },
  ]);

  entries.sort(
    (
      a: [string, DatabaseEngineReadingsInstance],
      b: [string, DatabaseEngineReadingsInstance],
    ): number => {
      return (
        (toDate(b[1].at)?.getTime() || 0) - (toDate(a[1].at)?.getTime() || 0)
      );
    },
  );

  const instances: Record<string, DatabaseEngineReadingsInstance> = {};
  for (const [name, instance] of entries.slice(
    0,
    DATABASE_ENGINE_READINGS_MAX_INSTANCES,
  )) {
    instances[name] = instance;
  }

  return { instances: instances };
}

// The instances that reported within the last fifteen minutes.
export function getFreshDatabaseEngineInstances(
  readings: DatabaseEngineReadings | null,
  now: Date,
): Array<DatabaseEngineReadingsInstance> {
  if (!readings) {
    return [];
  }
  return Object.keys(readings.instances)
    .map((name: string): DatabaseEngineReadingsInstance => {
      return readings.instances[name]!;
    })
    .filter((instance: DatabaseEngineReadingsInstance): boolean => {
      const at: Date | null = toDate(instance.at);
      return Boolean(
        at &&
          now.getTime() - at.getTime() <= DATABASE_ENGINE_READINGS_STALE_MS &&
          // A reading from the future is a clock fault, not a fresh one.
          at.getTime() - now.getTime() <= DATABASE_ENGINE_READINGS_STALE_MS,
      );
    });
}

// When the most recent instance reported, or null.
export function getDatabaseEngineReadingsLatestAt(
  readings: DatabaseEngineReadings | null,
): Date | null {
  let latest: Date | null = null;
  for (const name of Object.keys(readings?.instances || {})) {
    const at: Date | null = toDate(readings!.instances[name]!.at);
    if (at && (!latest || at.getTime() > latest.getTime())) {
      latest = at;
    }
  }
  return latest;
}

/*
 * One query's value across the instances that reported it, folded as the
 * query folds the series of a bucket: added up, the worst, the lowest or
 * their average. Null when no fresh instance reported it.
 */
export function foldDatabaseEngineReading(data: {
  instances: Array<DatabaseEngineReadingsInstance>;
  key: string;
  aggregationType: AggregationType;
}): number | null {
  const values: Array<number> = [];
  for (const instance of data.instances) {
    const value: number | undefined = instance.values[data.key];
    if (typeof value === "number" && Number.isFinite(value)) {
      values.push(value);
    }
  }

  if (values.length === 0) {
    return null;
  }

  switch (data.aggregationType) {
    case AggregationType.Sum:
    case AggregationType.Count:
      return values.reduce((total: number, value: number): number => {
        return total + value;
      }, 0);
    case AggregationType.Max:
      return Math.max(...values);
    case AggregationType.Min:
      return Math.min(...values);
    case AggregationType.Avg:
      return (
        values.reduce((total: number, value: number): number => {
          return total + value;
        }, 0) / values.length
      );
    default:
      // No template reads a percentile; one that did would not be guessed.
      return null;
  }
}
