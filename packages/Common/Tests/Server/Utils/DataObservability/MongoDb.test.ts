import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Decimal128, Long, MongoClient, ObjectId } from "mongodb";
import {
  isMongoSystemDatabase,
  readMongoUri,
} from "../../../../Server/Utils/DataObservability/MongoUri";
import {
  buildMongoCheckStatement,
  checkMongoPipeline,
  readMongoCheckStatement,
} from "../../../../Server/Utils/DataObservability/MongoDbChecks";
import {
  collectTableHealth,
  readMongoCell,
  readMongoCollectionStats,
  readMongoFieldType,
  readMongoSampledFields,
  readMongoSchemaFields,
  readMongoTimeSeriesFields,
  readObjectIdTime,
  TableHealthSnapshot,
} from "../../../../Server/Utils/DataObservability/TableHealthCollector";
import { readConnectionTarget } from "../../../../Server/Utils/DataObservability/TableHealthTarget";
import { buildDataCheckStatement } from "../../../../Server/Utils/DataObservability/DataCheckSql";
import { validateDataCheck } from "../../../../Server/Utils/DataObservability/DataCheckValidation";
import { getCollectorEngineOfKind } from "../../../../Server/Utils/DataObservability/DataObservabilityEngines";
import { parseDatasetName } from "../../../../Server/Utils/DataObservability/OpenLineageEvent";
import {
  matchSpanTableUsage,
  SpanTableUsageRow,
  UsageAsset,
  UsageStore,
} from "../../../../Server/Utils/DataObservability/TableUsageMatching";
import { getConnectionSecrets } from "../../../../Server/Utils/DataSecurity/Content/DatabaseSampler";
import {
  DataAssetAccessKind,
  getAccessKindOfOperation,
} from "../../../../Types/DataObservability/DataAssetUsage";
import { DataCheckType } from "../../../../Types/DataObservability/DataCheckType";
import DataAssetKind from "../../../../Types/DataObservability/DataAssetKind";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../../Types/JSON";

/*
 * MongoDB has no SQL and no fixed columns. A collection's catalog comes
 * from $collStats and its newest documents, its fields from its validator
 * or from the names and types of those documents' fields, and a check is an
 * aggregation pipeline - only the number it ends in ever leaves the
 * database, and nothing that writes or runs code is ever sent.
 */

const URI: string =
  "mongodb://oneuptime_reader:s3cret%40pw@db1.internal:27017,db2.internal:27018/?replicaSet=rs0";

describe("a MongoDB connection string", () => {
  test("a replica set's hosts, an SRV name, an IPv6 address, the database its path names", () => {
    expect(readMongoUri(URI)).toEqual({
      hosts: [
        { host: "db1.internal", port: 27017 },
        { host: "db2.internal", port: 27018 },
      ],
      isSrv: false,
      database: null,
    });
    expect(
      readMongoUri(
        "mongodb+srv://r:p@Cluster0.example.mongodb.net/shop?retryWrites=true",
      ),
    ).toEqual({
      hosts: [{ host: "cluster0.example.mongodb.net", port: null }],
      isSrv: true,
      database: "shop",
    });
    expect(readMongoUri("mongodb://[::1]:27019/shop")!.hosts).toEqual([
      { host: "::1", port: 27019 },
    ]);
    expect(readMongoUri("postgres://x@y/z")).toBe(null);
  });

  test("a path naming MongoDB's own database (an auth database) names none", () => {
    expect(readMongoUri("mongodb://r:p@db:27017/admin")!.database).toBe(null);
    expect(isMongoSystemDatabase("config")).toBe(true);
    expect(isMongoSystemDatabase("shop")).toBe(false);
  });

  test("the target is the first host and the database, never the password; the password is a secret", () => {
    const target: unknown = readConnectionTarget({
      engine: "mongodb",
      connectionString:
        "mongodb://reader:s3cret@db1.internal:27017,db2.internal/shop",
    });

    expect(target).toEqual({
      databaseName: "shop",
      host: "db1.internal",
      port: 27017,
    });
    expect(JSON.stringify(target)).not.toContain("s3cret");
    // new URL cannot read a host list: the password is still found.
    expect(getConnectionSecrets(URI)).toEqual(
      expect.arrayContaining(["s3cret%40pw", "s3cret@pw"]),
    );
    expect(getCollectorEngineOfKind(DataStoreKind.MongoDb)).toBe("mongodb");
  });
});

describe("a check as an aggregation pipeline", () => {
  function pipelineOf(target: Parameters<typeof buildMongoCheckStatement>[0]): {
    statement: ReturnType<typeof readMongoCheckStatement>;
    isSegmented: boolean;
  } {
    const built: ReturnType<typeof buildMongoCheckStatement> =
      buildMongoCheckStatement(target);

    return {
      statement: readMongoCheckStatement(built.sql),
      isSegmented: built.isSegmented,
    };
  }

  test("a row count, 0 when there are no documents; the database and collection it runs on", () => {
    const { statement } = pipelineOf({
      type: DataCheckType.RowCount,
      schemaName: "shop",
      tableName: "orders",
    });

    expect(statement).toEqual({
      database: "shop",
      collection: "orders",
      isSegmented: false,
      emptyValue: 0,
      pipeline: [
        { $group: { _id: null, value: { $sum: 1 }, size: { $sum: 1 } } },
        { $project: { _id: 0, value: "$value" } },
      ],
    });
  });

  test("a null percent per segment: the largest segments first, capped", () => {
    const { statement, isSegmented } = pipelineOf({
      type: DataCheckType.NullPercent,
      schemaName: "shop",
      tableName: "orders",
      columnName: "email",
      segmentColumn: "region",
    });

    expect(isSegmented).toBe(true);
    expect(statement.emptyValue).toBe(null);
    expect(statement.pipeline[0]).toEqual({
      $group: {
        _id: "$region",
        size: { $sum: 1 },
        missing: {
          $sum: {
            $cond: [{ $eq: [{ $ifNull: ["$email", null] }, null] }, 1, 0],
          },
        },
      },
    });
    expect(statement.pipeline.slice(-3)).toEqual([
      { $sort: { size: -1 } },
      { $limit: 100 },
      { $project: { size: 0 } },
    ]);
  });

  test("a value of the wrong type converts to nothing rather than failing the check", () => {
    const average: string = JSON.stringify(
      pipelineOf({
        type: DataCheckType.Average,
        schemaName: "shop",
        tableName: "orders",
        columnName: "total",
      }).statement.pipeline,
    );
    const invalid: string = JSON.stringify(
      pipelineOf({
        type: DataCheckType.InvalidPercent,
        schemaName: "shop",
        tableName: "orders",
        columnName: "status",
        acceptedValues: ["paid", "refunded"],
      }).statement.pipeline,
    );

    expect(average).toContain(
      '{"$avg":{"$convert":{"input":"$total","to":"double","onError":null,"onNull":null}}}',
    );
    expect(invalid).toContain(
      '"$convert":{"input":"$status","to":"string","onError":null,"onNull":null}',
    );
    expect(invalid).not.toContain("$toString");
  });

  test("an orphan count looks each document up in the collection it refers to", () => {
    expect(
      pipelineOf({
        type: DataCheckType.OrphanCount,
        schemaName: "shop",
        tableName: "orders",
        columnName: "customerId",
        referenceTableName: "customers",
        referenceColumnName: "_id",
      }).statement.pipeline.slice(0, 3),
    ).toEqual([
      { $match: { customerId: { $ne: null } } },
      {
        $lookup: {
          from: "customers",
          localField: "customerId",
          foreignField: "_id",
          as: "oneuptime_referenced",
        },
      },
      { $match: { oneuptime_referenced: { $size: 0 } } },
    ]);
  });

  test("a custom check is the person's pipeline, capped; one that writes or runs code is refused", () => {
    expect(
      pipelineOf({
        type: DataCheckType.CustomSql,
        schemaName: "shop",
        tableName: "orders",
        customSql: '[{"$match": {"total": {"$lt": 0}}}, {"$count": "value"}]',
      }).statement.pipeline,
    ).toEqual([
      { $match: { total: { $lt: 0 } } },
      { $count: "value" },
      { $limit: 100 },
    ]);

    for (const pipeline of [
      '[{"$out": "copy"}]',
      '[{"$merge": {"into": "copy"}}]',
      '[{"$match": {"$where": "this.total < 0"}}]',
      '[{"$project": {"x": {"$function": {"body": "1", "args": [], "lang": "js"}}}}]',
    ]) {
      expect(() => {
        return checkMongoPipeline(pipeline);
      }).toThrow(/may only read/);
    }

    expect(() => {
      return checkMongoPipeline("SELECT COUNT(*) FROM orders");
    }).toThrow(/aggregation pipeline as JSON/);
    expect(() => {
      return checkMongoPipeline("[]");
    }).toThrow(/1 to 30 stages/);
  });

  test("a field is never an operator; buildDataCheckStatement hands MongoDB its pipelines", () => {
    expect(() => {
      return buildMongoCheckStatement({
        type: DataCheckType.Maximum,
        schemaName: "shop",
        tableName: "orders",
        columnName: "$where",
      });
    }).toThrow(/not a field/);
    expect(
      JSON.parse(
        buildDataCheckStatement("mongodb", {
          type: DataCheckType.RowCount,
          schemaName: "shop",
          tableName: "orders",
        }).sql,
      ),
    ).toMatchObject({ collection: "orders" });
  });

  test("a saved custom check on MongoDB is held to a pipeline's rules, not SQL's", () => {
    const table: Parameters<typeof validateDataCheck>[1] = {
      engine: "mongodb",
      columns: [],
      referenceColumns: () => {
        return null;
      },
    };

    expect(() => {
      return validateDataCheck(
        {
          checkType: DataCheckType.CustomSql,
          customSql: '[{"$count": "value"}]',
          intervalInMinutes: 60,
        },
        table,
      );
    }).not.toThrow();
    expect(() => {
      return validateDataCheck(
        {
          checkType: DataCheckType.CustomSql,
          customSql: "SELECT 1 AS value",
          intervalInMinutes: 60,
        },
        table,
      );
    }).toThrow(/aggregation pipeline as JSON/);
  });
});

describe("reading a collection's fields and numbers", () => {
  test("types as a column's: numbers are one type, null and missing none", () => {
    expect(readMongoFieldType(["int", "double", "null"])).toBe("number");
    expect(readMongoFieldType(["string", "date"])).toBe("date|string");
    expect(readMongoFieldType(["null"])).toBe("null");
  });

  test("a validator's JSON schema names the fields, required ones not nullable", () => {
    expect(
      readMongoSchemaFields({
        $jsonSchema: {
          required: ["email"],
          properties: {
            email: { bsonType: "string" },
            age: { bsonType: ["int", "null"] },
          },
        },
      }),
    ).toEqual([
      { name: "email", dataType: "string", isNullable: false, position: 1 },
      { name: "age", dataType: "number", isNullable: true, position: 2 },
    ]);
    expect(readMongoSchemaFields({ status: { $in: ["a"] } })).toBe(null);
  });

  test("the newest documents' fields: _id first, then by name, the same each time", () => {
    expect(
      readMongoSampledFields([
        { _id: "total", types: ["double", "int"] },
        { _id: "_id", types: ["objectId"] },
        { _id: "status", types: ["string", "null"] },
      ]),
    ).toEqual([
      { name: "_id", dataType: "objectid", isNullable: false, position: 1 },
      { name: "status", dataType: "string", isNullable: true, position: 2 },
      { name: "total", dataType: "number", isNullable: true, position: 3 },
    ]);
  });

  test("a time series names its time and metadata fields", () => {
    expect(
      readMongoTimeSeriesFields({
        timeseries: { timeField: "ts", metaField: "host" },
      }),
    ).toEqual([
      { name: "ts", dataType: "date", isNullable: false, position: 1 },
      { name: "host", dataType: "mixed", isNullable: true, position: 2 },
    ]);
    expect(readMongoTimeSeriesFields({})).toBe(null);
  });

  test("an ObjectId says when it was made; any other _id says nothing", () => {
    const madeAt: number = Math.floor(Date.UTC(2026, 10, 4, 11, 50) / 1000);

    expect(readObjectIdTime(ObjectId.createFromTime(madeAt))).toEqual(
      new Date(madeAt * 1000),
    );
    expect(readObjectIdTime("order-1")).toBe(null);
    expect(readObjectIdTime(42)).toBe(null);
  });

  test("$collStats summed over shards; the size with indexes where totalSize is not given", () => {
    expect(
      readMongoCollectionStats([
        {
          storageStats: { count: 700, totalSize: 8192 },
          latencyStats: { writes: { ops: 40 } },
        },
        {
          storageStats: { count: 500, storageSize: 4096, totalIndexSize: 1024 },
          latencyStats: { writes: { ops: 2 } },
        },
      ]),
    ).toEqual({ rows: 1200, size: 13312, writes: 42 });
    expect(readMongoCollectionStats([])).toEqual({
      rows: null,
      size: null,
      writes: null,
    });
  });

  test("BSON's numbers read as their text, an ObjectId as its hex", () => {
    expect(readMongoCell(Decimal128.fromString("12.50"))).toBe("12.50");
    expect(readMongoCell(Long.fromNumber(9))).toBe("9");
    expect(readMongoCell(new ObjectId("65f0c0ffee0000000000abcd"))).toBe(
      "65f0c0ffee0000000000abcd",
    );
    expect(readMongoCell(3)).toBe(3);
    expect(readMongoCell(undefined)).toBe(null);
  });
});

interface FakeCall {
  collection: string;
  pipeline: Array<JSONObject>;
  options: JSONObject;
}

describe("collecting a MongoDB deployment", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("collections, views and time series with their numbers, fields and lineage; checks as pipelines", async () => {
    const calls: Array<FakeCall> = [];
    const listedWith: Array<JSONObject> = [];
    let closed: boolean = false;
    const newest: ObjectId = ObjectId.createFromTime(
      Math.floor(Date.now() / 1000) - 600,
    );
    const collections: Record<string, Array<JSONObject>> = {
      shop: [
        { name: "orders", type: "collection", options: {} },
        {
          name: "customers",
          type: "collection",
          options: {
            validator: {
              $jsonSchema: {
                required: ["email"],
                properties: { email: { bsonType: "string" } },
              },
            },
          },
        },
        {
          name: "orders_by_day",
          type: "view",
          options: { viewOn: "orders", pipeline: [] },
        },
        {
          name: "metrics",
          type: "timeseries",
          options: { timeseries: { timeField: "ts", metaField: "host" } },
        },
        { name: "system.views", type: "collection", options: {} },
      ],
    };

    function aggregate(collection: string) {
      return (pipeline: Array<JSONObject>, options: JSONObject) => {
        calls.push({ collection, pipeline, options });

        return {
          toArray: async (): Promise<Array<Record<string, unknown>>> => {
            const first: JSONObject = pipeline[0] || {};

            if ("$collStats" in first) {
              if (collection === "customers") {
                throw new Error(
                  'not authorized on shop to execute command { aggregate: "customers" }',
                );
              }

              return collection === "metrics"
                ? [{ storageStats: { storageSize: 2048, totalIndexSize: 0 } }]
                : [
                    {
                      storageStats: { count: 700, totalSize: 8192 },
                      latencyStats: { writes: { ops: 40 } },
                    },
                    {
                      storageStats: { count: 500, totalSize: 4096 },
                      latencyStats: { writes: { ops: 2 } },
                    },
                  ];
            }

            if ("$sort" in first && "_id" in (first["$sort"] as JSONObject)) {
              return collection === "orders"
                ? [
                    {
                      newest: [{ _id: newest }],
                      fields: [
                        { _id: "_id", types: ["objectId"] },
                        { _id: "total", types: ["int", "double"] },
                      ],
                    },
                  ]
                : [
                    {
                      newest: [{ _id: "c-1" }],
                      fields: [{ _id: "_id", types: ["string"] }],
                    },
                  ];
            }

            // A check: a segmented one per region, an average on no documents.
            if (JSON.stringify(pipeline).includes("$region")) {
              return [
                { segment: "eu", value: 2.5 },
                { segment: null, value: 0 },
              ];
            }

            return JSON.stringify(pipeline).includes("$avg")
              ? []
              : [{ value: Long.fromNumber(1200) }];
          },
        };
      };
    }

    function fakeDb(name: string): unknown {
      return {
        databaseName: name,
        admin: () => {
          return {
            listDatabases: async (options: JSONObject) => {
              listedWith.push(options);

              return {
                databases: [
                  { name: "admin" },
                  { name: "staging" },
                  { name: "shop" },
                  { name: "local" },
                ],
              };
            },
          };
        },
        listCollections: () => {
          return {
            toArray: async () => {
              return collections[name] || [];
            },
          };
        },
        collection: (collection: string) => {
          return {
            aggregate: aggregate(collection),
            estimatedDocumentCount: async () => {
              return 42;
            },
          };
        },
      };
    }

    jest
      .spyOn(MongoClient.prototype, "connect")
      .mockImplementation(async function (this: MongoClient) {
        return this;
      });
    jest
      .spyOn(MongoClient.prototype, "close")
      .mockImplementation(async (): Promise<void> => {
        closed = true;
      });
    jest.spyOn(MongoClient.prototype, "db").mockImplementation(((
      name: string,
    ) => {
      return fakeDb(name);
    }) as never);

    const plan: (
      checkId: string,
      target: Parameters<typeof buildMongoCheckStatement>[0],
    ) => {
      checkId: string;
      type: DataCheckType;
      isSegmented: boolean;
      sql: string;
      params: Array<string>;
    } = (
      checkId: string,
      target: Parameters<typeof buildMongoCheckStatement>[0],
    ) => {
      return {
        checkId,
        type: target.type,
        ...buildMongoCheckStatement(target),
      };
    };

    const snapshot: TableHealthSnapshot = await collectTableHealth(
      { engine: "mongodb", connectionString: URI },
      {
        maxTables: 100,
        maxColumns: 1000,
        exclusions: ["staging"],
        checks: [
          plan("rows", {
            type: DataCheckType.RowCount,
            schemaName: "shop",
            tableName: "orders",
          }),
          plan("nulls", {
            type: DataCheckType.NullPercent,
            schemaName: "shop",
            tableName: "orders",
            columnName: "email",
            segmentColumn: "region",
          }),
          plan("average", {
            type: DataCheckType.Average,
            schemaName: "shop",
            tableName: "orders",
            columnName: "total",
          }),
        ],
      },
    );

    // Every database the login may read, but MongoDB's own and the excluded.
    expect(listedWith).toEqual([{ nameOnly: true, authorizedDatabases: true }]);
    expect(
      snapshot.tables.map(
        (table: { schema: string; name: string; kind: DataAssetKind }) => {
          return `${table.schema}.${table.name}:${table.kind}`;
        },
      ),
    ).toEqual([
      "shop.customers:Table",
      "shop.metrics:Table",
      "shop.orders:Table",
      "shop.orders_by_day:View",
    ]);

    const byName: Record<string, TableHealthSnapshot["tables"][number]> = {};

    for (const table of snapshot.tables) {
      byName[table.name] = table;
    }

    // Summed over two shards; the newest ObjectId says when it last took a document.
    expect(byName["orders"]).toMatchObject({
      estimatedRows: 1200,
      sizeInBytes: 12288,
      writeCount: 42,
      readCount: null,
    });
    expect(byName["orders"]!.secondsSinceChange).toBeGreaterThanOrEqual(599);
    expect(byName["orders"]!.secondsSinceChange).toBeLessThan(700);
    expect(byName["orders"]!.columns).toEqual([
      { name: "_id", dataType: "objectid", isNullable: false, position: 1 },
      { name: "total", dataType: "number", isNullable: true, position: 2 },
    ]);
    // No $collStats for this login: the count the server keeps; a validator names the fields.
    expect(byName["customers"]).toMatchObject({
      estimatedRows: 42,
      sizeInBytes: null,
      writeCount: null,
      secondsSinceChange: null,
    });
    expect(byName["customers"]!.columns).toEqual([
      { name: "email", dataType: "string", isNullable: false, position: 1 },
    ]);
    // A time series: its size, and the fields its options name; no _id walk.
    expect(byName["metrics"]).toMatchObject({
      sizeInBytes: 2048,
      writeCount: null,
      estimatedRows: null,
    });
    expect(
      byName["metrics"]!.columns!.map((column: { name: string }) => {
        return column.name;
      }),
    ).toEqual(["ts", "host"]);
    // A view's fields are unknown, never an empty list; its source is lineage.
    expect(byName["orders_by_day"]!.columns).toBe(null);
    expect(snapshot.lineage).toEqual([
      expect.objectContaining({
        upstreamSchema: "shop",
        upstreamTable: "orders",
        downstreamSchema: "shop",
        downstreamTable: "orders_by_day",
      }),
    ]);
    expect(snapshot.target).toEqual({
      databaseName: null,
      host: "db1.internal",
      port: 27017,
    });

    // Counters from the member taking the writes; documents from a secondary.
    const statsCalls: Array<FakeCall> = calls.filter((call: FakeCall) => {
      return "$collStats" in (call.pipeline[0] || {});
    });

    expect(statsCalls.length).toBe(3);
    expect(
      statsCalls.every((call: FakeCall) => {
        return call.options["readPreference"] === "primaryPreferred";
      }),
    ).toBe(true);
    expect(
      calls.some((call: FakeCall) => {
        return (
          call.collection === "metrics" && "$sort" in (call.pipeline[0] || {})
        );
      }),
    ).toBe(false);

    // Checks: capped, values read as numbers, an average of nothing is no value.
    const checkCalls: Array<FakeCall> = calls.filter((call: FakeCall) => {
      return (
        "$group" in (call.pipeline[0] || {}) ||
        "$match" in (call.pipeline[0] || {})
      );
    });

    expect(
      checkCalls.every((call: FakeCall) => {
        return (
          JSON.stringify(call.pipeline[call.pipeline.length - 1]) ===
            '{"$limit":100}' && call.options["maxTimeMS"] === 30_000
        );
      }),
    ).toBe(true);
    expect(snapshot.checkResults).toEqual([
      {
        checkId: "rows",
        values: [{ segment: null, value: 1200 }],
        error: null,
      },
      {
        checkId: "nulls",
        values: [
          { segment: "eu", value: 2.5 },
          { segment: "(empty)", value: 0 },
        ],
        error: null,
      },
      { checkId: "average", values: [], error: null },
    ]);
    expect(closed).toBe(true);
  });
});

describe("MongoDB elsewhere in OneUptime", () => {
  const store: UsageStore = {
    dataStoreId: "s1",
    kind: DataStoreKind.MongoDb,
    databaseName: null,
    serverAddress: "db1.internal",
  };
  const assets: Array<UsageAsset> = [
    {
      dataAssetId: "a1",
      dataStoreId: "s1",
      schemaName: "shop",
      name: "orders.archive",
    },
    {
      dataAssetId: "a2",
      dataStoreId: "s1",
      schemaName: "billing",
      name: "orders.archive",
    },
  ];

  function row(overrides: Partial<SpanTableUsageRow>): SpanTableUsageRow {
    return {
      serviceId: "svc",
      dbSystem: "mongodb",
      dbNamespace: "shop",
      serverAddress: "db1.internal",
      collection: "orders.archive",
      operation: "find",
      callCount: 10,
      errorCount: 0,
      lastSeenAt: new Date("2026-11-04T12:00:00.000Z"),
      ...overrides,
    };
  }

  test("a span's collection is one name, dots and all, in its namespace's database - a store naming none reads every one", () => {
    expect(
      matchSpanTableUsage({ row: row({}), stores: [store], assets }),
    ).toMatchObject({
      asset: { dataAssetId: "a1" },
      accessKind: DataAssetAccessKind.Read,
      operation: "FIND",
    });
    expect(
      matchSpanTableUsage({
        row: row({ dbNamespace: "billing", operation: "findOneAndUpdate" }),
        stores: [store],
        assets,
      }),
    ).toMatchObject({
      asset: { dataAssetId: "a2" },
      accessKind: DataAssetAccessKind.Write,
    });
    expect(
      matchSpanTableUsage({
        row: row({ dbNamespace: "inventory" }),
        stores: [store],
        assets,
      }),
    ).toBe(null);
  });

  test("its drivers' calls are reads and writes", () => {
    expect(getAccessKindOfOperation("aggregate")).toBe(
      DataAssetAccessKind.Read,
    );
    expect(getAccessKindOfOperation("countDocuments")).toBe(
      DataAssetAccessKind.Read,
    );
    expect(getAccessKindOfOperation("insertMany")).toBe(
      DataAssetAccessKind.Write,
    );
    expect(getAccessKindOfOperation("bulkWrite")).toBe(
      DataAssetAccessKind.Write,
    );
    expect(getAccessKindOfOperation("createIndexes")).toBe(null);
  });

  test("OpenLineage's database.collection is the database's collection", () => {
    expect(
      parseDatasetName({
        namespace: "mongodb://db1.internal:27017",
        name: "shop.orders",
      }),
    ).toMatchObject({
      kind: DataStoreKind.MongoDb,
      host: "db1.internal",
      schema: "shop",
      table: "orders",
    });
  });
});
