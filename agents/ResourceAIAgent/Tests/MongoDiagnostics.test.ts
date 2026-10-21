import "./Helpers/TestSupport";
import assert from "assert";
import { describe, test } from "node:test";
import {
  DatabaseHarness,
  databaseHarness,
  runRead,
  runWrite,
  stdoutOf,
} from "./Helpers/DatabaseHarness";
import {
  FakeDrivers,
  FakeMongoConnection,
  driverError,
} from "./Helpers/FakeDatabase";
import {
  MONGO_TABLE_SIZES_MAX_COLLECTIONS,
  buildSessionMatch,
  describeMongoError,
  readMongoDate,
} from "../Executors/Database/MongoDiagnostics";
import { DATABASE_AI_AGENT_APPLICATION_NAME } from "../Executors/Database/DiagnosticTypes";
import {
  ExecResult,
  ResourcePostureProbe,
} from "../Executors/ResourceExecutor";

/*
 * The db catalog on MongoDB: the exact command documents (admin commands,
 * the $currentOp aggregation, maxTimeMS on each), the agent's own
 * operations left out, commands printed as shapes, and killOp with every
 * check before it.
 */

type Responder = (
  database: string,
  command: Record<string, unknown>,
) => Record<string, unknown> | Error;

function cursor(
  batch: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    cursor: { firstBatch: batch, id: 0, ns: "admin.$cmd.aggregate" },
    ok: 1,
  };
}

function operation(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    opid: 5150,
    type: "op",
    active: true,
    secs_running: 42,
    op: "query",
    ns: "shop.orders",
    desc: "conn17",
    client: "10.0.0.8:50000",
    appName: "checkout",
    connectionId: 17,
    effectiveUsers: [{ user: "app", db: "admin" }],
    waitingForLock: false,
    command: {
      find: "orders",
      filter: { email: "jane@example.com", total: { $gt: 100 } },
      $db: "shop",
    },
    ...overrides,
  };
}

function harness(
  responder: Responder,
  env: Record<string, string> = {},
): DatabaseHarness {
  return databaseHarness({
    engine: "mongodb",
    env,
    drivers: new FakeDrivers(
      undefined,
      undefined,
      new FakeMongoConnection(responder),
    ),
  });
}

// The pipeline of the n-th command (an aggregate).
function pipelineOf(
  h: DatabaseHarness,
  index: number,
): Array<Record<string, unknown>> {
  return h.drivers.mongo.commands[index]!.command["pipeline"] as Array<
    Record<string, unknown>
  >;
}

const WRITES_ON: Record<string, string> = { ONEUPTIME_AI_ALLOW_WRITES: "true" };

describe("each read", () => {
  test("ping and version (hello, or isMaster on an older server)", async () => {
    const h: DatabaseHarness = harness(
      (
        _database: string,
        command: Record<string, unknown>,
      ): Record<string, unknown> | Error => {
        if ("buildInfo" in command) {
          return {
            version: "4.2.25",
            gitVersion: "abc",
            modules: [],
            allocator: "tcmalloc",
            bits: 64,
            ok: 1,
          };
        }

        if ("hello" in command) {
          return driverError("no such command: 'hello'", { code: 59 });
        }

        if ("isMaster" in command) {
          return { ismaster: true, setName: "rs0", ok: 1 };
        }

        return { ok: 1 };
      },
    );

    assert.strictEqual(
      stdoutOf(await runRead(h, "db ping")),
      "status: ok (MongoDB answered ping)",
    );
    const version: string = stdoutOf(await runRead(h, "db version"));

    assert.match(version, /^version:\s+4\.2\.25$/m);
    assert.match(version, /^setName:\s+rs0$/m);
    assert.match(version, /^isWritablePrimary:\s+true$/m);
    assert.deepStrictEqual(h.drivers.mongo.names(), [
      "ping",
      "buildInfo",
      "hello",
      "isMaster",
    ]);
    assert.ok(
      h.drivers.mongo.commands.every((entry: { database: string }): boolean => {
        return entry.database === "admin";
      }),
    );
  });

  test("sessions: $currentOp for every user, the agent's own left out, limit + 1, maxTimeMS, command shapes", async () => {
    const h: DatabaseHarness = harness((): Record<string, unknown> => {
      return cursor([operation()]);
    });
    const result: ExecResult = await runRead(h, "db sessions --limit 10", {
      timeoutInMs: 20_000,
    });
    const command: Record<string, unknown> =
      h.drivers.mongo.commands[0]!.command;

    assert.strictEqual(command["aggregate"], 1);
    assert.deepStrictEqual(command["cursor"], { batchSize: 11 });
    assert.ok(
      Number(command["maxTimeMS"]) > 18_000 &&
        Number(command["maxTimeMS"]) <= 19_000,
    );
    assert.deepStrictEqual(pipelineOf(h, 0).slice(0, 4), [
      { $currentOp: { allUsers: true, idleConnections: false } },
      { $match: { appName: { $ne: DATABASE_AI_AGENT_APPLICATION_NAME } } },
      { $sort: { active: -1, secs_running: -1, opid: 1 } },
      { $limit: 11 },
    ]);

    const out: string = stdoutOf(result);
    assert.ok(!out.includes("jane@example.com"), out);
    assert.strictEqual(
      out,
      [
        "OPID   ACTIVE   SECS   OP      NS            CLIENT           APP        USER        WAITING_FOR_LOCK   DESC     COMMAND",
        '5150   true     42     query   shop.orders   10.0.0.8:50000   checkout   app@admin   false              conn17   {"find":"orders","filter":{"email":"?","total":{"$gt":"?"}},"$db":"shop"}',
      ].join("\n"),
    );
  });

  test("sessions: --state idle asks for idle connections; the database is compared as a literal, never a field path", async () => {
    const h: DatabaseHarness = harness((): Record<string, unknown> => {
      return cursor([]);
    });
    const out: string = stdoutOf(
      await runRead(
        h,
        "db sessions --state idle-in-transaction --user app --database $where",
      ),
    );

    assert.deepStrictEqual(pipelineOf(h, 0)[0], {
      $currentOp: { allUsers: true, idleConnections: true },
    });
    assert.deepStrictEqual(pipelineOf(h, 0)[1], {
      $match: {
        active: false,
        transaction: { $exists: true },
        "effectiveUsers.user": "app",
        $expr: {
          $eq: [
            { $arrayElemAt: [{ $split: [{ $ifNull: ["$ns", ""] }, "."] }, 0] },
            { $literal: "$where" },
          ],
        },
        appName: { $ne: DATABASE_AI_AGENT_APPLICATION_NAME },
      },
    });
    assert.strictEqual(
      out,
      "No operations match (the agent's own are not listed).",
    );
  });

  test("buildSessionMatch for each state", () => {
    assert.deepStrictEqual(
      buildSessionMatch({ state: null, user: null, database: null }),
      {},
    );
    assert.deepStrictEqual(
      buildSessionMatch({ state: "active", user: null, database: null }),
      {
        active: true,
      },
    );
    assert.deepStrictEqual(
      buildSessionMatch({ state: "idle", user: null, database: null }),
      {
        active: false,
      },
    );
  });

  test("long-queries, blocking and locks: the $match each uses", async () => {
    const h: DatabaseHarness = harness((): Record<string, unknown> => {
      return cursor([
        operation({
          waitingForLock: true,
          locks: { Global: "w", Database: "w", Collection: "W" },
        }),
      ]);
    });

    await runRead(h, "db long-queries --min-seconds 30");
    const blocking: string = stdoutOf(await runRead(h, "db blocking"));
    const locks: string = stdoutOf(await runRead(h, "db locks --limit 2"));

    assert.deepStrictEqual(pipelineOf(h, 0)[1], {
      $match: {
        active: true,
        secs_running: { $gte: 30 },
        appName: { $ne: DATABASE_AI_AGENT_APPLICATION_NAME },
      },
    });
    assert.deepStrictEqual(pipelineOf(h, 1)[1], {
      $match: {
        waitingForLock: true,
        appName: { $ne: DATABASE_AI_AGENT_APPLICATION_NAME },
      },
    });
    assert.deepStrictEqual(pipelineOf(h, 2)[1], {
      $match: {
        locks: { $exists: true, $ne: {} },
        appName: { $ne: DATABASE_AI_AGENT_APPLICATION_NAME },
      },
    });
    assert.deepStrictEqual(pipelineOf(h, 2)[3], { $limit: 3 });
    assert.match(
      blocking,
      /^ {2}locks:\s+\{"Global":"w","Database":"w","Collection":"W"\}$/m,
    );
    assert.match(locks, /\{"Global":"w","Database":"w","Collection":"W"\}$/m);
  });

  test("replication: members with lag behind the primary; a server with no replica set says so", async () => {
    const h: DatabaseHarness = harness((): Record<string, unknown> => {
      return {
        set: "rs0",
        myState: 1,
        term: 3,
        date: { $date: "2026-09-29T10:00:00.000Z" },
        members: [
          {
            name: "m0:27017",
            stateStr: "PRIMARY",
            health: 1,
            uptime: 1000,
            optimeDate: { $date: "2026-09-29T10:00:00.000Z" },
          },
          {
            name: "m1:27017",
            stateStr: "SECONDARY",
            health: 1,
            uptime: 900,
            optimeDate: { $date: "2026-09-29T09:59:30.000Z" },
            syncSourceHost: "m0:27017",
            pingMs: 1,
            lastHeartbeatMessage: "",
          },
        ],
        ok: 1,
      };
    });
    const out: string = stdoutOf(await runRead(h, "db replication"));

    assert.deepStrictEqual(Object.keys(h.drivers.mongo.commands[0]!.command), [
      "replSetGetStatus",
      "maxTimeMS",
    ]);
    assert.match(out, /^set:\s+rs0$/m);
    assert.match(
      out,
      /^m1:27017 {3}SECONDARY {3}1\s+900\s+2026-09-29T09:59:30\.000Z {3}30\s+m0:27017/m,
    );

    for (const code of [76, 94, 59]) {
      const single: DatabaseHarness = harness((): Error => {
        return driverError("not running with --replSet", { code });
      });
      const result: ExecResult = await runRead(single, "db replication");

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(
        stdoutOf(result),
        "This server is not a replica set member with replication running (not running with --replSet).",
      );
    }
  });

  test("connections: serverStatus's counters and connections grouped by application and user", async () => {
    const h: DatabaseHarness = harness(
      (
        _database: string,
        command: Record<string, unknown>,
      ): Record<string, unknown> => {
        return "serverStatus" in command
          ? {
              connections: {
                current: 120,
                available: 838740,
                totalCreated: 5000,
              },
              ok: 1,
            }
          : cursor([
              { app: "checkout", user: "app", connections: 100, active: 3 },
            ]);
      },
    );
    const out: string = stdoutOf(await runRead(h, "db connections"));

    assert.match(out, /^current:\s+120$/m);
    assert.match(out, /^checkout {3}app {4}100 {11}3$/m);
    assert.deepStrictEqual(pipelineOf(h, 1)[0], {
      $currentOp: { allUsers: true, idleConnections: true },
    });
  });

  test("database-sizes: listDatabases, largest first", async () => {
    const h: DatabaseHarness = harness((): Record<string, unknown> => {
      return {
        databases: [
          { name: "admin", sizeOnDisk: 40960, empty: false },
          { name: "shop", sizeOnDisk: 1073741824, empty: false },
        ],
        totalSize: 1073782784,
        ok: 1,
      };
    });

    assert.strictEqual(
      stdoutOf(await runRead(h, "db database-sizes")),
      [
        "DATABASE   SIZE       SIZE_BYTES   EMPTY",
        "shop       1.0 GiB    1073741824   false",
        "admin      40.0 KiB   40960        false",
        "",
        "Total size on disk: 1.0 GiB.",
      ].join("\n"),
    );
  });

  test("table-sizes: the collections this login may see, $collStats for each, largest first", async () => {
    const h: DatabaseHarness = harness(
      (
        database: string,
        command: Record<string, unknown>,
      ): Record<string, unknown> | Error => {
        assert.strictEqual(database, "shop");

        if ("listCollections" in command) {
          return {
            cursor: {
              firstBatch: [
                { name: "orders" },
                { name: "system.views" },
                { name: "gone" },
                { name: "users" },
              ],
              id: 0,
            },
            ok: 1,
          };
        }

        if (command["aggregate"] === "gone") {
          return driverError("ns does not exist", { code: 26 });
        }

        return cursor([
          {
            storageStats:
              command["aggregate"] === "orders"
                ? {
                    size: 3000,
                    storageSize: 2048,
                    totalIndexSize: 1024,
                    count: 10,
                  }
                : {
                    size: 100,
                    storageSize: 4096,
                    totalIndexSize: 4096,
                    count: 2,
                  },
          },
        ]);
      },
    );
    const out: string = stdoutOf(
      await runRead(h, "db table-sizes --database shop"),
    );

    assert.deepStrictEqual(h.drivers.mongo.commands[0]!.command, {
      listCollections: 1,
      nameOnly: true,
      authorizedCollections: true,
      filter: { type: "collection" },
      cursor: { batchSize: MONGO_TABLE_SIZES_MAX_COLLECTIONS + 1 },
      maxTimeMS: h.drivers.mongo.commands[0]!.command["maxTimeMS"],
    });
    assert.deepStrictEqual(
      h.drivers.mongo.commands
        .slice(1)
        .map((entry: { command: Record<string, unknown> }): unknown => {
          return entry.command["aggregate"];
        }),
      ["gone", "orders", "users"],
    );
    assert.deepStrictEqual(h.drivers.mongo.commands[2]!.command["pipeline"], [
      { $collStats: { storageStats: {} } },
    ]);
    assert.strictEqual(
      out,
      [
        "Largest collections in shop:",
        "COLLECTION   TOTAL     STORAGE   INDEXES   DATA      DOCUMENTS",
        "users        8.0 KiB   4.0 KiB   4.0 KiB   100 B     2",
        "orders       3.0 KiB   2.0 KiB   1.0 KiB   2.9 KiB   10",
      ].join("\n"),
    );
  });

  test("settings: getParameter by name or *, never a credential or a command option", async () => {
    const h: DatabaseHarness = harness(
      (
        _database: string,
        command: Record<string, unknown>,
      ): Record<string, unknown> | Error => {
        if (command["getParameter"] === "*") {
          return {
            ldapQueryPassword: "hunter2",
            notablescan: false,
            wiredTigerConcurrentReadTransactions: { value: 128 },
            ok: 1,
            $clusterTime: { clusterTime: 1 },
          };
        }

        if ("nope" in command) {
          return driverError("no option found to get", { code: 72 });
        }

        return { notablescan: false, ok: 1 };
      },
    );

    assert.strictEqual(
      stdoutOf(await runRead(h, "db settings notablescan")),
      "name:  notablescan\nvalue: false",
    );
    assert.deepStrictEqual(h.drivers.mongo.commands[0]!.command, {
      getParameter: 1,
      notablescan: 1,
    });

    const all: ExecResult = await runRead(h, "db settings");
    assert.ok(!all.output.includes("hunter2"));
    assert.strictEqual(
      stdoutOf(all),
      [
        "NAME                                   VALUE",
        "notablescan                            false",
        'wiredTigerConcurrentReadTransactions   {"value":128}',
        "",
        "1 credential parameter(s) are not shown.",
      ].join("\n"),
    );

    const unknown: ExecResult = await runRead(h, "db settings nope");
    assert.strictEqual(unknown.exitCode, 1);
    assert.match(
      String(unknown.errorMessage),
      /^MongoDB has no parameter named "nope"/,
    );

    const option: DatabaseHarness = harness((): Record<string, unknown> => {
      return { ok: 1 };
    });
    const refused: ExecResult = await runRead(option, "db settings maxTimeMS");
    assert.strictEqual(refused.exitCode, 1);
    assert.strictEqual(
      refused.errorMessage,
      '"maxTimeMS" is an option of every MongoDB command, not a server parameter.',
    );
    assert.deepStrictEqual(option.drivers.mongo.commands, []);
  });

  test("info: an overview without the big sections, or one section; memory's figures", async () => {
    const status: Record<string, unknown> = {
      host: "m0",
      version: "8.0.3",
      uptime: 1000,
      connections: { current: 5 },
      wiredTiger: {
        cache: {
          "bytes currently in the cache": 1024,
          "maximum bytes configured": 4096,
          filler: "x".repeat(5000),
        },
      },
      mem: { resident: 120, virtual: 1500 },
      tcmalloc: { generic: { current_allocated_bytes: 100, heap_size: 200 } },
      ok: 1,
      $clusterTime: {},
    };
    const h: DatabaseHarness = harness((): Record<string, unknown> => {
      return status;
    });

    const overview: string = stdoutOf(await runRead(h, "db info"));
    assert.match(
      overview,
      /^serverStatus \(overview\):\n\{\n {2}"host": "m0",/,
    );
    assert.ok(!overview.includes('"wiredTiger"'));
    assert.ok(!overview.includes("$clusterTime"));
    assert.match(
      overview,
      /Left out of the overview for size: wiredTiger\. db info SECTION prints one of them\.$/,
    );

    assert.strictEqual(
      stdoutOf(await runRead(h, "db info mem")),
      'mem:\n{\n  "resident": 120,\n  "virtual": 1500\n}',
    );

    const missing: ExecResult = await runRead(h, "db info repl");
    assert.strictEqual(missing.exitCode, 1);
    assert.match(
      String(missing.errorMessage),
      /^serverStatus on this server has no section "repl"/,
    );

    const memory: string = stdoutOf(await runRead(h, "db memory"));
    assert.match(
      memory,
      /^Process memory \(MiB\):\nresident: 120\nvirtual: {2}1500$/m,
    );
    assert.match(memory, /^bytes currently in the cache:\s+1024$/m);
    assert.match(memory, /^heap_size:\s+200$/m);
  });
});

describe("cancel-query (killOp)", () => {
  function killHarness(
    target: Record<string, unknown> | null,
    data: {
      ownConnectionId?: number;
      after?: Record<string, unknown> | null;
    } = {},
  ): DatabaseHarness {
    let lookups: number = 0;

    return harness(
      (
        _database: string,
        command: Record<string, unknown>,
      ): Record<string, unknown> => {
        if ("hello" in command) {
          return { connectionId: data.ownConnectionId ?? 99, ok: 1 };
        }

        if ("killOp" in command) {
          return { info: "attempting to kill op", ok: 1 };
        }

        lookups++;
        const found: Record<string, unknown> | null =
          lookups === 1 ? target : data.after === undefined ? null : data.after;

        return cursor(found ? [found] : []);
      },
      WRITES_ON,
    );
  }

  test("its own connection, the target by opid, killOp with the opid as a number, a second look", async () => {
    const h: DatabaseHarness = killHarness(operation(), {
      after: { opid: 5150, active: true, killPending: true },
    });
    const result: ExecResult = await runWrite(h, "db cancel-query 5150");

    assert.deepStrictEqual(h.drivers.mongo.names(), [
      "hello",
      "aggregate",
      "killOp",
      "aggregate",
    ]);
    assert.deepStrictEqual(pipelineOf(h, 1).slice(0, 2), [
      { $currentOp: { allUsers: true, idleConnections: true } },
      { $match: { opid: 5150 } },
    ]);
    assert.deepStrictEqual(h.drivers.mongo.commands[2]!.command, {
      killOp: 1,
      op: 5150,
    });
    assert.deepStrictEqual(h.sleeps, [250]);
    assert.strictEqual(
      stdoutOf(result),
      [
        "Asked MongoDB to kill operation 5150 (killOp). Its connection stays open; the client sees the operation fail.",
        "",
        "The operation, before:",
        "opid:         5150",
        "op:           query",
        "ns:           shop.orders",
        "secs_running: 42",
        "client:       10.0.0.8:50000",
        "appName:      checkout",
        "user:         app@admin",
        'command:      {"find":"orders","filter":{"email":"?","total":{"$gt":"?"}},"$db":"shop"}',
        "",
        "Operation 5150 is still listed (kill pending): it stops at its next interrupt check.",
      ].join("\n"),
    );
  });

  test("never the agent's own operations, an internal one, an idle one, or one that is not there", async () => {
    const cases: Array<
      [Record<string, unknown> | null, number | undefined, string]
    > = [
      [
        operation({ connectionId: 99 }),
        99,
        "Refused by the Database AI agent: operation 5150 belongs to the Database AI agent's own connection (session:5150); it never kills its own operations.",
      ],
      [
        operation({ appName: DATABASE_AI_AGENT_APPLICATION_NAME }),
        undefined,
        "Refused by the Database AI agent: operation 5150 belongs to the Database AI agent's own connection (session:5150); it never kills its own operations.",
      ],
      [
        operation({ desc: "ReplBatcher", client: undefined }),
        undefined,
        "Refused by the Database AI agent: operation 5150 is an internal MongoDB operation (ReplBatcher), not a client's: db cancel-query only kills client operations.",
      ],
      [
        operation({ active: false }),
        undefined,
        "Operation 5150 is not running (its connection is idle): there is nothing to cancel, so nothing was changed.",
      ],
      [
        null,
        undefined,
        "MongoDB has no operation 5150 (it may have finished already). Run db sessions to see the current ones; nothing was changed.",
      ],
    ];

    for (const [target, own, message] of cases) {
      const h: DatabaseHarness = killHarness(
        target,
        own === undefined ? {} : { ownConnectionId: own },
      );
      const result: ExecResult = await runWrite(h, "db cancel-query 5150");

      assert.deepStrictEqual(result, {
        success: false,
        output: "",
        errorMessage: message,
      });
      assert.ok(!h.drivers.mongo.names().includes("killOp"), message);
    }
  });

  test("a killed operation that is gone says so", async () => {
    const result: ExecResult = await runWrite(
      killHarness(operation()),
      "db cancel-query 5150",
    );

    assert.match(stdoutOf(result), /\n\nOperation 5150 is gone\.$/);
  });
});

describe("the posture and errors", () => {
  test("the probe: ping, buildInfo, hello", async () => {
    const h: DatabaseHarness = harness(
      (
        _database: string,
        command: Record<string, unknown>,
      ): Record<string, unknown> => {
        if ("buildInfo" in command) {
          return { version: "7.0.14", ok: 1 };
        }

        return "hello" in command
          ? { isWritablePrimary: false, ok: 1 }
          : { ok: 1 };
      },
    );
    const probe: ResourcePostureProbe = await h.executor.probePosture();

    assert.strictEqual(probe.toolVersion, "MongoDB 7.0.14");
    assert.strictEqual(probe.details?.["replicaSet"], null);
    assert.strictEqual(probe.details?.["writablePrimary"], false);
    assert.deepStrictEqual(h.drivers.mongo.names(), [
      "ping",
      "buildInfo",
      "hello",
    ]);
  });

  test("describeMongoError reads MongoDB's codes", () => {
    const data: { username: string; credentialSource: string } = {
      username: "m",
      credentialSource: "DATABASE_USERNAME/DATABASE_PASSWORD",
    };
    const cases: Array<[number, RegExp]> = [
      [
        18,
        /^MongoDB refused the login "m" .* ONEUPTIME_AI_DATABASE_NAME if the user is defined in a database other than admin\.$/,
      ],
      [
        13,
        /Grant it the clusterMonitor role for reads, and a role with the killop action/,
      ],
      [50, /ran longer than the command's time budget/],
      [59, /does not have that command/],
      [91, /shutting down/],
    ];

    for (const [code, pattern] of cases) {
      assert.match(
        String(describeMongoError(driverError("x", { code }), data)),
        pattern,
        String(code),
      );
    }

    assert.strictEqual(
      describeMongoError(driverError("x", { code: 1 }), data),
      null,
    );
  });

  test("readMongoDate reads every EJSON date form", () => {
    assert.strictEqual(
      readMongoDate({ $date: "2026-01-01T00:00:00Z" })?.toISOString(),
      "2026-01-01T00:00:00.000Z",
    );
    assert.strictEqual(
      readMongoDate({ $date: { $numberLong: "0" } })?.toISOString(),
      "1970-01-01T00:00:00.000Z",
    );
    assert.strictEqual(
      readMongoDate(1000)?.toISOString(),
      "1970-01-01T00:00:01.000Z",
    );
    assert.strictEqual(readMongoDate("nonsense"), null);
    assert.strictEqual(readMongoDate({}), null);
  });
});
