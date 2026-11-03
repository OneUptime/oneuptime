/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at
 * import time via the services' queue imports; nothing queue-related is
 * under test here, so the module is replaced - same idiom as
 * HostReadingsIngest.test.ts in this directory.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class
 * of every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import fs from "fs";
import path from "path";
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import DatabaseServerService from "Common/Server/Services/DatabaseServerService";
import ObjectID from "Common/Types/ObjectID";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A database's engine readings reach its record through the metrics
 * ingest: every resource of a batch that was attributed to a
 * DatabaseServer is read for the queries its alert templates read, per
 * reporting agent (bufferDatabaseEngineReadings), and once the batch's rows
 * have landed each database's readings are handed to
 * DatabaseServerService.recordEngineReadings (flushDatabaseEngineReadings).
 * These send resources shaped as the Database Agent sends them and check
 * what reaches the service; the scan's own suite pins the arithmetic.
 */

const DATABASE_ID: ObjectID = ObjectID.generate();
const OTHER_DATABASE_ID: ObjectID = ObjectID.generate();

/* eslint-disable @typescript-eslint/no-explicit-any */
const metricsService: Record<string, any> =
  OtelMetricsIngestService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

type Buffer = Map<string, Map<string, unknown>>;

type RecordCall = {
  databaseServerId: ObjectID;
  instance: string;
  values: Record<string, number>;
};

function stringAttribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

function intPoint(attributes: Record<string, string>, value: number): JSONObject {
  return {
    attributes: Object.keys(attributes).map((key: string): JSONObject => {
      return stringAttribute(key, attributes[key]!);
    }),
    asInt: String(value),
  };
}

function sum(name: string, points: Array<JSONObject>): JSONArray {
  return [{ metrics: [{ name: name, sum: { dataPoints: points } }] }];
}

function agent(address: string, port: number): JSONArray {
  return [
    stringAttribute("db.system.name", "postgresql"),
    stringAttribute("server.address", address),
    { key: "server.port", value: { intValue: String(port) } },
    stringAttribute("oneuptime.database.agent", "true"),
  ];
}

function bufferResource(
  buffer: Buffer,
  databaseServerId: ObjectID,
  resourceAttributes: JSONArray,
  scopeMetrics: JSONArray,
): void {
  metricsService["bufferDatabaseEngineReadings"]({
    buffer: buffer,
    databaseServerId: databaseServerId,
    resourceAttributes: resourceAttributes,
    scopeMetrics: scopeMetrics,
  });
}

let calls: Array<RecordCall> = [];

beforeEach(() => {
  calls = [];
  jest
    .spyOn(DatabaseServerService, "recordEngineReadings")
    .mockImplementation(async (data: RecordCall): Promise<boolean> => {
      calls.push(data);
      return true;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a batch's database resources become one write per database and agent", () => {
  test("PostgreSQL's per-database resources and the server's own add up", async () => {
    const buffer: Buffer = new Map();
    bufferResource(
      buffer,
      DATABASE_ID,
      agent("orders-db.internal", 5432),
      sum("postgresql.connection.max", [intPoint({}, 100)]),
    );
    bufferResource(
      buffer,
      DATABASE_ID,
      agent("orders-db.internal", 5432),
      sum("postgresql.backends", [intPoint({}, 60)]),
    );
    bufferResource(
      buffer,
      DATABASE_ID,
      agent("orders-db.internal", 5432),
      sum("postgresql.backends", [intPoint({}, 36)]),
    );

    await metricsService["flushDatabaseEngineReadings"]({ buffer: buffer });

    expect(calls.length).toBe(1);
    expect(calls[0]!.databaseServerId.toString()).toBe(DATABASE_ID.toString());
    expect(calls[0]!.instance).toBe("orders-db.internal:5432");
    expect(calls[0]!.values).toEqual({
      "Count|postgresql.connection.max|": 1,
      "Sum|postgresql.connection.max|": 100,
      "Sum|postgresql.backends|": 96,
    });
  });

  test("two members sharing one database id are written apart", async () => {
    const buffer: Buffer = new Map();
    bufferResource(
      buffer,
      DATABASE_ID,
      agent("pg-0.internal", 5432),
      sum("postgresql.backends", [intPoint({}, 10)]),
    );
    bufferResource(
      buffer,
      DATABASE_ID,
      agent("pg-1.internal", 5432),
      sum("postgresql.backends", [intPoint({}, 20)]),
    );

    await metricsService["flushDatabaseEngineReadings"]({ buffer: buffer });

    expect(
      calls
        .map((call: RecordCall): string => {
          return `${call.instance}=${call.values["Sum|postgresql.backends|"]}`;
        })
        .sort(),
    ).toEqual(["pg-0.internal:5432=10", "pg-1.internal:5432=20"]);
  });

  test("two databases in one batch are each written", async () => {
    const buffer: Buffer = new Map();
    bufferResource(
      buffer,
      DATABASE_ID,
      agent("a.internal", 5432),
      sum("postgresql.backends", [intPoint({}, 1)]),
    );
    bufferResource(
      buffer,
      OTHER_DATABASE_ID,
      agent("b.internal", 5432),
      sum("postgresql.backends", [intPoint({}, 2)]),
    );
    await metricsService["flushDatabaseEngineReadings"]({ buffer: buffer });
    expect(
      calls
        .map((call: RecordCall): string => {
          return call.databaseServerId.toString();
        })
        .sort(),
    ).toEqual([DATABASE_ID.toString(), OTHER_DATABASE_ID.toString()].sort());
  });

  test("a resource with none of the templates' metrics adds nothing and writes nothing", async () => {
    const buffer: Buffer = new Map();
    bufferResource(
      buffer,
      DATABASE_ID,
      agent("orders-db.internal", 5432),
      sum("postgresql.commits", [intPoint({}, 5)]),
    );
    expect(buffer.size).toBe(0);
    await metricsService["flushDatabaseEngineReadings"]({ buffer: buffer });
    expect(calls).toEqual([]);
  });

  test("one database's failed write never stops the next", async () => {
    jest.restoreAllMocks();
    let attempt: number = 0;
    jest
      .spyOn(DatabaseServerService, "recordEngineReadings")
      .mockImplementation(async (data: RecordCall): Promise<boolean> => {
        attempt++;
        if (attempt === 1) {
          throw new Error("connection terminated");
        }
        calls.push(data);
        return true;
      });

    const buffer: Buffer = new Map();
    bufferResource(
      buffer,
      DATABASE_ID,
      agent("a.internal", 5432),
      sum("postgresql.backends", [intPoint({}, 1)]),
    );
    bufferResource(
      buffer,
      OTHER_DATABASE_ID,
      agent("b.internal", 5432),
      sum("postgresql.backends", [intPoint({}, 2)]),
    );

    await expect(
      metricsService["flushDatabaseEngineReadings"]({ buffer: buffer }),
    ).resolves.toBeUndefined();
    expect(calls.length).toBe(1);
  });
});

describe("where the ingest reads and writes them", () => {
  const source: string = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "FeatureSet",
      "Telemetry",
      "Services",
      "OtelMetricsIngestService.ts",
    ),
    "utf8",
  );

  test("every resource attributed to a database is read", () => {
    expect(source).toContain("if (databaseServerId) {");
    expect(source).toContain("this.bufferDatabaseEngineReadings({");
  });

  test("the readings are written after the batch's rows have landed", () => {
    const acks: number = source.indexOf("await Promise.all(pendingAcks);");
    const flush: number = source.indexOf(
      "await this.flushDatabaseEngineReadings({",
    );
    expect(acks).toBeGreaterThan(-1);
    expect(flush).toBeGreaterThan(acks);
  });
});
