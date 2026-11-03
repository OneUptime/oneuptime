import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import {
  DATABASE_ENGINE_READINGS_FORGET_MS,
  DATABASE_ENGINE_READINGS_INSTANCE_MAX_LENGTH,
  DATABASE_ENGINE_READINGS_MAX_INSTANCES,
  DATABASE_ENGINE_READINGS_STALE_MS,
  DATABASE_ENGINE_READINGS_UNNAMED_INSTANCE,
  DatabaseEngineReadingQuery,
  DatabaseEngineReadings,
  DatabaseEngineReadingsInstance,
  foldDatabaseEngineReading,
  getDatabaseAlertTemplateReadingKeys,
  getDatabaseEngineReadingKey,
  getDatabaseEngineReadingMetricNames,
  getDatabaseEngineReadingQueries,
  getDatabaseEngineReadingsInstanceName,
  getDatabaseEngineReadingsLatestAt,
  getFreshDatabaseEngineInstances,
  mergeDatabaseEngineReadings,
  parseDatabaseEngineReadings,
} from "../../../Types/DatabaseServer/DatabaseEngineReadings";
import {
  DatabaseAlertQuery,
  DatabaseAlertTemplate,
  getAllDatabaseAlertTemplates,
  getDatabaseAlertTemplateById,
} from "../../../Types/Monitor/DatabaseAlertTemplates";
import { describe, expect, test } from "@jest/globals";

/*
 * The readings a database's record keeps are the alert templates' queries
 * worked out from its engine's last batch, per reporting instance. These
 * pin what a reading is keyed by, which queries the ingest computes, how an
 * instance's batch replaces its own readings and leaves the others', and
 * how the instances fold into the one number a template compares.
 */

const NOW: Date = new Date("2026-11-03T10:00:00.000Z");

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();
}

describe("a reading's key", () => {
  test("names the aggregation, the metric and the pinned attributes", () => {
    expect(
      getDatabaseEngineReadingKey({
        metricName: "mysql.threads",
        aggregationType: AggregationType.Max,
        attributes: { kind: "running" },
      }),
    ).toBe("Max|mysql.threads|kind=running");

    expect(
      getDatabaseEngineReadingKey({
        metricName: "postgresql.backends",
        aggregationType: AggregationType.Sum,
      }),
    ).toBe("Sum|postgresql.backends|");
  });

  test("is the same whatever order the attributes were written in", () => {
    expect(
      getDatabaseEngineReadingKey({
        metricName: "m",
        aggregationType: AggregationType.Sum,
        attributes: { b: "2", a: "1" },
      }),
    ).toBe(
      getDatabaseEngineReadingKey({
        metricName: "m",
        aggregationType: AggregationType.Sum,
        attributes: { a: "1", b: "2" },
      }),
    );
  });

  test("differs by aggregation, so a Sum and an Avg of one metric are two readings", () => {
    const sum: string = getDatabaseEngineReadingKey({
      metricName: "redis.memory.used",
      aggregationType: AggregationType.Sum,
    });
    const avg: string = getDatabaseEngineReadingKey({
      metricName: "redis.memory.used",
      aggregationType: AggregationType.Avg,
    });
    expect(sum).not.toBe(avg);
  });
});

describe("the queries the ingest works out", () => {
  const queries: ReadonlyArray<DatabaseEngineReadingQuery> =
    getDatabaseEngineReadingQueries();

  test("hold every query of every template, once each", () => {
    const keys: Array<string> = queries.map(
      (query: DatabaseEngineReadingQuery): string => {
        return query.key;
      },
    );
    expect(new Set(keys).size).toBe(keys.length);

    for (const template of getAllDatabaseAlertTemplates()) {
      for (const query of template.queries) {
        expect(keys).toContain(getDatabaseEngineReadingKey(query));
      }
    }
  });

  test("hold nothing no template reads", () => {
    const templateKeys: Set<string> = new Set<string>();
    for (const template of getAllDatabaseAlertTemplates()) {
      for (const query of template.queries) {
        templateKeys.add(getDatabaseEngineReadingKey(query));
      }
    }
    for (const query of queries) {
      expect(templateKeys.has(query.key)).toBe(true);
    }
  });

  test("include the Engine Metrics Stopped heartbeats, read on every scrape", () => {
    const heartbeats: Array<DatabaseAlertTemplate> =
      getAllDatabaseAlertTemplates().filter(
        (template: DatabaseAlertTemplate): boolean => {
          return Boolean(template.criteria.triggerOnNoData);
        },
      );
    expect(heartbeats.length).toBe(9);
    for (const heartbeat of heartbeats) {
      expect(
        queries.some((query: DatabaseEngineReadingQuery): boolean => {
          return query.key === getDatabaseEngineReadingKey(heartbeat.queries[0]!);
        }),
      ).toBe(true);
    }
  });

  test("name only the metrics the templates read", () => {
    const names: ReadonlySet<string> = getDatabaseEngineReadingMetricNames();
    const templateNames: Set<string> = new Set<string>();
    for (const template of getAllDatabaseAlertTemplates()) {
      for (const name of template.metricNames) {
        templateNames.add(name);
      }
    }
    expect(Array.from(names).sort()).toEqual(Array.from(templateNames).sort());
    // A table-size metric the Metrics tab charts is no reading.
    expect(names.has("postgresql.table.size")).toBe(false);
  });

  test("a template's reading keys follow its query aliases", () => {
    const template: DatabaseAlertTemplate = getDatabaseAlertTemplateById(
      "database-postgresql-connections-exhausted",
    )!;
    expect(getDatabaseAlertTemplateReadingKeys(template)).toEqual({
      pg_backends: "Sum|postgresql.backends|",
      pg_max_connections: "Sum|postgresql.connection.max|",
    });
  });
});

describe("a reporting instance's name", () => {
  test("is its server.address and port, in lower case", () => {
    expect(
      getDatabaseEngineReadingsInstanceName({
        serverAddress: "DB-0.Payments.internal",
        serverPort: 5432,
      }),
    ).toBe("db-0.payments.internal:5432");
    expect(
      getDatabaseEngineReadingsInstanceName({
        serverAddress: "cache.internal",
        serverPort: "6379",
      }),
    ).toBe("cache.internal:6379");
    expect(
      getDatabaseEngineReadingsInstanceName({ serverAddress: "es.internal" }),
    ).toBe("es.internal");
  });

  test("is '-' for a batch that names no address", () => {
    expect(getDatabaseEngineReadingsInstanceName({})).toBe(
      DATABASE_ENGINE_READINGS_UNNAMED_INSTANCE,
    );
    expect(
      getDatabaseEngineReadingsInstanceName({
        serverAddress: "  ",
        serverPort: 5432,
      }),
    ).toBe(DATABASE_ENGINE_READINGS_UNNAMED_INSTANCE);
  });

  test("is cut to what its record holds", () => {
    const name: string = getDatabaseEngineReadingsInstanceName({
      serverAddress: "a".repeat(500),
      serverPort: 1,
    });
    expect(name.length).toBe(DATABASE_ENGINE_READINGS_INSTANCE_MAX_LENGTH);
  });
});

describe("parsing a record's readings", () => {
  test("keeps valid instances and values", () => {
    const parsed: DatabaseEngineReadings | null = parseDatabaseEngineReadings({
      instances: {
        "db:5432": {
          at: minutesAgo(1),
          values: { "Sum|postgresql.backends|": 12 },
        },
      },
    });
    expect(parsed).toEqual({
      instances: {
        "db:5432": {
          at: minutesAgo(1),
          values: { "Sum|postgresql.backends|": 12 },
        },
      },
    });
  });

  test("drops what is not a number, an instance without a time, and junk", () => {
    const parsed: DatabaseEngineReadings | null = parseDatabaseEngineReadings({
      instances: {
        good: {
          at: minutesAgo(1),
          values: {
            a: 1,
            b: "2",
            c: Number.NaN,
            d: Number.POSITIVE_INFINITY,
            e: null,
          },
        },
        noTime: { values: { a: 1 } },
        badTime: { at: "yesterday-ish", values: { a: 1 } },
        noValues: { at: minutesAgo(1) },
        notAnObject: 4,
      },
    });
    expect(parsed).toEqual({
      instances: { good: { at: minutesAgo(1), values: { a: 1 } } },
    });
  });

  test("is null for a record with nothing valid", () => {
    expect(parseDatabaseEngineReadings(null)).toBeNull();
    expect(parseDatabaseEngineReadings(undefined)).toBeNull();
    expect(parseDatabaseEngineReadings("{}")).toBeNull();
    expect(parseDatabaseEngineReadings([])).toBeNull();
    expect(parseDatabaseEngineReadings({ instances: [] })).toBeNull();
    expect(parseDatabaseEngineReadings({ instances: {} })).toBeNull();
  });
});

describe("merging one instance's batch into the record", () => {
  test("starts a record from nothing", () => {
    expect(
      mergeDatabaseEngineReadings({
        existing: null,
        instance: "db:5432",
        values: { k: 1 },
        now: NOW,
      }),
    ).toEqual({
      instances: { "db:5432": { at: NOW.toISOString(), values: { k: 1 } } },
    });
  });

  test("replaces that instance's readings and keeps every other instance's", () => {
    const merged: DatabaseEngineReadings = mergeDatabaseEngineReadings({
      existing: {
        instances: {
          "primary:5432": {
            at: minutesAgo(2),
            values: { lag: 45, backends: 10 },
          },
          "replica:5432": { at: minutesAgo(1), values: { backends: 4 } },
        },
      },
      instance: "primary:5432",
      values: { backends: 12 },
      now: NOW,
    });

    // A reading the instance no longer sends goes with its old batch.
    expect(merged.instances["primary:5432"]).toEqual({
      at: NOW.toISOString(),
      values: { backends: 12 },
    });
    expect(merged.instances["replica:5432"]).toEqual({
      at: minutesAgo(1),
      values: { backends: 4 },
    });
  });

  test("drops an instance silent for an hour", () => {
    const merged: DatabaseEngineReadings = mergeDatabaseEngineReadings({
      existing: {
        instances: {
          gone: {
            at: new Date(
              NOW.getTime() - DATABASE_ENGINE_READINGS_FORGET_MS - 1000,
            ).toISOString(),
            values: { k: 1 },
          },
          quiet: {
            at: new Date(
              NOW.getTime() - DATABASE_ENGINE_READINGS_FORGET_MS + 1000,
            ).toISOString(),
            values: { k: 2 },
          },
        },
      },
      instance: "live",
      values: { k: 3 },
      now: NOW,
    });
    expect(Object.keys(merged.instances).sort()).toEqual(["live", "quiet"]);
  });

  test("keeps at most the most recent instances", () => {
    const instances: Record<string, DatabaseEngineReadingsInstance> = {};
    for (let index: number = 0; index < 12; index++) {
      instances[`member-${index}`] = {
        at: minutesAgo(index + 1),
        values: { k: index },
      };
    }
    const merged: DatabaseEngineReadings = mergeDatabaseEngineReadings({
      existing: { instances: instances },
      instance: "member-new",
      values: { k: 99 },
      now: NOW,
    });
    const names: Array<string> = Object.keys(merged.instances);
    expect(names.length).toBe(DATABASE_ENGINE_READINGS_MAX_INSTANCES);
    expect(names).toContain("member-new");
    expect(names).toContain("member-0");
    // The oldest are the ones left out.
    expect(names).not.toContain("member-11");
  });

  test("never stores a value that is not a finite number", () => {
    const merged: DatabaseEngineReadings = mergeDatabaseEngineReadings({
      existing: null,
      instance: "db",
      values: { good: 2, bad: Number.NaN, worse: Number.NEGATIVE_INFINITY },
      now: NOW,
    });
    expect(merged.instances["db"]!.values).toEqual({ good: 2 });
  });

  test("rebuilds a record a foreign writer left malformed", () => {
    const merged: DatabaseEngineReadings = mergeDatabaseEngineReadings({
      existing: { instances: "nope" },
      instance: "db",
      values: { k: 1 },
      now: NOW,
    });
    expect(Object.keys(merged.instances)).toEqual(["db"]);
  });
});

describe("which instances count", () => {
  test("only those that reported in the last fifteen minutes", () => {
    const readings: DatabaseEngineReadings = {
      instances: {
        fresh: { at: minutesAgo(1), values: {} },
        edge: {
          at: new Date(
            NOW.getTime() - DATABASE_ENGINE_READINGS_STALE_MS,
          ).toISOString(),
          values: {},
        },
        stale: {
          at: new Date(
            NOW.getTime() - DATABASE_ENGINE_READINGS_STALE_MS - 1,
          ).toISOString(),
          values: {},
        },
      },
    };
    expect(getFreshDatabaseEngineInstances(readings, NOW).length).toBe(2);
    expect(getFreshDatabaseEngineInstances(null, NOW)).toEqual([]);
  });

  test("a reading stamped far in the future is a clock fault, not fresh", () => {
    const readings: DatabaseEngineReadings = {
      instances: {
        future: {
          at: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
          values: {},
        },
      },
    };
    expect(getFreshDatabaseEngineInstances(readings, NOW)).toEqual([]);
  });

  test("the latest report is the most recent instance's", () => {
    expect(
      getDatabaseEngineReadingsLatestAt({
        instances: {
          a: { at: minutesAgo(9), values: {} },
          b: { at: minutesAgo(2), values: {} },
        },
      })!.toISOString(),
    ).toBe(minutesAgo(2));
    expect(getDatabaseEngineReadingsLatestAt(null)).toBeNull();
  });
});

describe("folding the instances into one number, as the template folds series", () => {
  const instances: Array<DatabaseEngineReadingsInstance> = [
    { at: minutesAgo(1), values: { k: 30, only: 7 } },
    { at: minutesAgo(1), values: { k: 10 } },
  ];

  test.each([
    [AggregationType.Sum, 40],
    [AggregationType.Count, 40],
    [AggregationType.Max, 30],
    [AggregationType.Min, 10],
    [AggregationType.Avg, 20],
  ])("%s", (aggregationType: AggregationType, expected: number) => {
    expect(
      foldDatabaseEngineReading({
        instances: instances,
        key: "k",
        aggregationType: aggregationType,
      }),
    ).toBe(expected);
  });

  test("an instance that does not report the query is left out, not read as 0", () => {
    expect(
      foldDatabaseEngineReading({
        instances: instances,
        key: "only",
        aggregationType: AggregationType.Min,
      }),
    ).toBe(7);
  });

  test("is null when no instance reported the query", () => {
    expect(
      foldDatabaseEngineReading({
        instances: instances,
        key: "missing",
        aggregationType: AggregationType.Sum,
      }),
    ).toBeNull();
  });

  test("never guesses a percentile", () => {
    expect(
      foldDatabaseEngineReading({
        instances: instances,
        key: "k",
        aggregationType: AggregationType.P95,
      }),
    ).toBeNull();
  });

  test("every template query's aggregation folds", () => {
    for (const template of getAllDatabaseAlertTemplates()) {
      for (const query of template.queries as ReadonlyArray<DatabaseAlertQuery>) {
        expect(
          foldDatabaseEngineReading({
            instances: [{ at: minutesAgo(1), values: { k: 1 } }],
            key: "k",
            aggregationType: query.aggregationType,
          }),
        ).toBe(1);
      }
    }
  });
});
