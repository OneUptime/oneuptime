import {
  DatabaseEngineReadingAccumulators,
  accumulateDatabaseEngineReadings,
  finishDatabaseEngineReadings,
  getDatabaseEngineReadingsInstanceFromAttributes,
} from "../../../../Server/Utils/Telemetry/DatabaseEngineReadingsScan";
import {
  DatabaseHealthAssessment,
  assessDatabase,
} from "../../../../Types/DatabaseServer/DatabaseHealth";
import {
  DatabaseEngineReadings,
  mergeDatabaseEngineReadings,
} from "../../../../Types/DatabaseServer/DatabaseEngineReadings";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The ingest reads each alert template query from the batches a database's
 * receiver sends. These batches are shaped as the collector-contrib
 * receivers send them: PostgreSQL's per-database resources beside the
 * server's own, MySQL's thread kinds and buffer-pool page states, MongoDB's
 * server-wide counts repeated once per database, Elasticsearch's health as
 * one series per colour - and the numbers must come out as the template
 * queries fold them.
 */

const SCRAPE_NANO: string = `${Date.UTC(2026, 10, 3, 9, 59, 0)}000000`;
const NOW: Date = new Date("2026-11-03T10:00:00.000Z");

function stringAttribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

function intPoint(attributes: Record<string, string>, value: number): JSONObject {
  return {
    attributes: Object.keys(attributes).map((key: string): JSONObject => {
      return stringAttribute(key, attributes[key]!);
    }),
    timeUnixNano: SCRAPE_NANO,
    // OTLP JSON writes 64-bit integers as strings.
    asInt: String(value),
  };
}

function doublePoint(
  attributes: Record<string, string>,
  value: number,
): JSONObject {
  return {
    attributes: Object.keys(attributes).map((key: string): JSONObject => {
      return stringAttribute(key, attributes[key]!);
    }),
    timeUnixNano: SCRAPE_NANO,
    asDouble: value,
  };
}

function gauge(name: string, points: Array<JSONObject>): JSONObject {
  return { name: name, gauge: { dataPoints: points } };
}

function sum(name: string, points: Array<JSONObject>): JSONObject {
  return {
    name: name,
    sum: { dataPoints: points, aggregationTemporality: 2, isMonotonic: false },
  };
}

function scope(metrics: Array<JSONObject>): JSONArray {
  return [
    {
      scope: {
        name: "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/postgresqlreceiver",
      },
      metrics: metrics,
    },
  ];
}

function scan(scopes: Array<JSONArray>): Record<string, number> {
  const accumulators: DatabaseEngineReadingAccumulators = new Map();
  for (const scopeMetrics of scopes) {
    accumulateDatabaseEngineReadings({
      accumulators: accumulators,
      scopeMetrics: scopeMetrics,
    });
  }
  return finishDatabaseEngineReadings(accumulators);
}

describe("PostgreSQL: per-database resources beside the server's own", () => {
  const batch: Array<JSONArray> = [
    // Server-wide: the limit, replication.
    scope([
      sum("postgresql.connection.max", [intPoint({}, 200)]),
      gauge("postgresql.wal.delay", [
        doublePoint({ operation: "write", replication_client: "10.0.0.7" }, 50),
        doublePoint({ operation: "flush", replication_client: "10.0.0.7" }, 49),
        doublePoint({ operation: "replay", replication_client: "10.0.0.7" }, 41),
        doublePoint({ operation: "replay", replication_client: "10.0.0.8" }, 3),
      ]),
      gauge("postgresql.replication.data_delay", [
        intPoint({ replication_client: "10.0.0.7" }, 2_000_000),
        intPoint({ replication_client: "10.0.0.8" }, 10),
      ]),
    ]),
    // One resource per database.
    scope([
      sum("postgresql.backends", [intPoint({}, 120)]),
      sum("postgresql.db_size", [intPoint({}, 40_000_000_000)]),
      // A table metric no rule reads is never accumulated.
      sum("postgresql.table.size", [intPoint({}, 1)]),
    ]),
    scope([
      sum("postgresql.backends", [intPoint({}, 72)]),
      sum("postgresql.db_size", [intPoint({}, 9_000_000_000)]),
    ]),
  ];

  test("backends add up across databases; the worst replica and the largest database win", () => {
    expect(scan(batch)).toEqual({
      "Count|postgresql.connection.max|": 1,
      "Sum|postgresql.connection.max|": 200,
      "Sum|postgresql.backends|": 192,
      "Max|postgresql.wal.delay|operation=replay": 41,
      "Max|postgresql.replication.data_delay|": 2_000_000,
      "Max|postgresql.db_size|": 40_000_000_000,
    });
  });

  test("from batch to verdict: 96% of max_connections and a replica 41 s behind", () => {
    const readings: DatabaseEngineReadings = mergeDatabaseEngineReadings({
      existing: null,
      instance: "orders-db.internal:5432",
      values: scan(batch),
      now: NOW,
    });
    const assessment: DatabaseHealthAssessment = assessDatabase(
      {
        dbSystem: "postgresql",
        otelCollectorStatus: "connected",
        collectorLastSeenAt: NOW,
        engineReadings: readings,
        engineReadingsAt: NOW,
      },
      { now: NOW },
    );
    expect(assessment.state).toBe("unhealthy");
    expect(assessment.reasons).toEqual([
      {
        text: "Connections at {{percent}} of max_connections",
        values: { percent: "96%" },
      },
      { text: "A replica {{seconds}} s behind", values: { seconds: "41" } },
    ]);
  });
});

describe("MySQL: thread kinds and buffer-pool pages, each read by what it pins", () => {
  test("only the pinned kind and status count", () => {
    expect(
      scan([
        scope([
          sum("mysql.threads", [
            intPoint({ kind: "connected" }, 140),
            intPoint({ kind: "running" }, 9),
            intPoint({ kind: "cached" }, 30),
            intPoint({ kind: "created" }, 500),
          ]),
          sum("mysql.buffer_pool.data_pages", [
            intPoint({ status: "dirty" }, 6200),
            intPoint({ status: "clean" }, 1800),
          ]),
          sum("mysql.buffer_pool.pages", [
            intPoint({ kind: "data" }, 8000),
            intPoint({ kind: "free" }, 100),
            intPoint({ kind: "misc" }, 92),
            intPoint({ kind: "total" }, 8192),
          ]),
          sum("mysql.uptime", [intPoint({}, 86_400)]),
        ]),
      ]),
    ).toEqual({
      "Count|mysql.uptime|": 1,
      "Min|mysql.uptime|": 86_400,
      "Max|mysql.threads|kind=connected": 140,
      "Max|mysql.threads|kind=running": 9,
      "Sum|mysql.buffer_pool.data_pages|status=dirty": 6200,
      "Sum|mysql.buffer_pool.pages|kind=total": 8192,
    });
  });
});

describe("MongoDB: server-wide counts repeated once per database", () => {
  test("the repetition multiplies both sides of the ratio, as in the monitor", () => {
    const perDatabase: JSONArray = scope([
      sum("mongodb.connection.count", [
        intPoint({ type: "current" }, 900),
        intPoint({ type: "available" }, 100),
        intPoint({ type: "active" }, 400),
      ]),
      sum("mongodb.database.count", [intPoint({}, 3)]),
    ]);
    const values: Record<string, number> = scan([
      perDatabase,
      perDatabase,
      perDatabase,
    ]);
    expect(values["Sum|mongodb.connection.count|type=current"]).toBe(2700);
    expect(values["Sum|mongodb.connection.count|type=available"]).toBe(300);

    const assessment: DatabaseHealthAssessment = assessDatabase(
      {
        dbSystem: "mongodb",
        otelCollectorStatus: "connected",
        collectorLastSeenAt: NOW,
        engineReadings: mergeDatabaseEngineReadings({
          existing: null,
          instance: "-",
          values: values,
          now: NOW,
        }),
      },
      { now: NOW },
    );
    // 2700 / (2700 + 300) = 90%, whatever the number of databases.
    expect(assessment.reasons).toEqual([
      {
        text: "Connections at {{percent}} of what it accepts",
        values: { percent: "90%" },
      },
    ]);
  });
});

describe("Elasticsearch: health as one series per colour, heap per node", () => {
  test("red reads 1 only on the red series; the hottest node's heap wins", () => {
    const values: Record<string, number> = scan([
      scope([
        sum("elasticsearch.cluster.health", [
          intPoint({ status: "green" }, 0),
          intPoint({ status: "yellow" }, 0),
          intPoint({ status: "red" }, 1),
        ]),
        sum("elasticsearch.cluster.pending_tasks", [intPoint({}, 2)]),
      ]),
      scope([gauge("jvm.memory.heap.utilization", [doublePoint({}, 0.61)])]),
      scope([gauge("jvm.memory.heap.utilization", [doublePoint({}, 0.88)])]),
    ]);
    expect(values).toEqual({
      "Count|elasticsearch.cluster.health|": 3,
      "Max|elasticsearch.cluster.health|status=red": 1,
      "Max|elasticsearch.cluster.health|status=yellow": 0,
      "Max|elasticsearch.cluster.pending_tasks|": 2,
      "Max|jvm.memory.heap.utilization|": 0.88,
    });
  });
});

describe("Redis: one Sum and one Avg reading of the same metric", () => {
  test("both are kept, each folded its own way", () => {
    const values: Record<string, number> = scan([
      scope([
        sum("redis.memory.used", [intPoint({}, 300_000_000)]),
        sum("redis.maxmemory", [intPoint({}, 1_000_000_000)]),
        gauge("redis.memory.fragmentation_ratio", [doublePoint({}, 1.62)]),
        sum("redis.clients.connected", [intPoint({}, 12)]),
        sum("redis.uptime", [intPoint({}, 400)]),
      ]),
    ]);
    expect(values["Sum|redis.memory.used|"]).toBe(300_000_000);
    expect(values["Avg|redis.memory.used|"]).toBe(300_000_000);
    expect(values["Avg|redis.memory.fragmentation_ratio|"]).toBe(1.62);
    expect(values["Min|redis.uptime|"]).toBe(400);
  });
});

describe("what a scan never does", () => {
  test("it reads no metric a template does not read", () => {
    expect(
      scan([
        scope([
          sum("postgresql.commits", [intPoint({}, 5)]),
          gauge("system.cpu.utilization", [doublePoint({}, 0.5)]),
        ]),
      ]),
    ).toEqual({});
  });

  test("a datapoint that is not a finite number is skipped, the rest still read", () => {
    expect(
      scan([
        scope([
          sum("postgresql.backends", [
            { attributes: [], asInt: "not-a-number" },
            { attributes: [], asDouble: "Infinity" },
            { attributes: [] },
            intPoint({}, 7),
          ]),
        ]),
      ]),
    ).toEqual({ "Sum|postgresql.backends|": 7 });
  });

  test("malformed scopes and metrics are skipped", () => {
    expect(
      scan([
        [
          null as unknown as JSONObject,
          { metrics: "nope" },
          { metrics: [null, 4, { name: "postgresql.backends" }] },
        ] as JSONArray,
      ]),
    ).toEqual({});
  });

  test("an empty batch reads nothing", () => {
    expect(scan([])).toEqual({});
  });

  test("it counts the datapoints it read", () => {
    const accumulators: DatabaseEngineReadingAccumulators = new Map();
    expect(
      accumulateDatabaseEngineReadings({
        accumulators: accumulators,
        scopeMetrics: scope([
          sum("mysql.threads", [
            intPoint({ kind: "connected" }, 1),
            intPoint({ kind: "running" }, 1),
            intPoint({ kind: "cached" }, 1),
          ]),
        ]),
      }),
    ).toBe(2);
  });
});

describe("the reporting instance", () => {
  test("is the resource's server.address and port, as the Database Agent stamps them", () => {
    expect(
      getDatabaseEngineReadingsInstanceFromAttributes([
        stringAttribute("db.system.name", "postgresql"),
        stringAttribute("server.address", "Orders-DB.internal"),
        { key: "server.port", value: { intValue: "5432" } },
      ]),
    ).toBe("orders-db.internal:5432");
  });

  test("is '-' for a resource that names no address", () => {
    expect(getDatabaseEngineReadingsInstanceFromAttributes([])).toBe("-");
  });
});
