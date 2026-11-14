import Monitor from "../../../../Models/DatabaseModels/Monitor";
import OnlineDdl, {
  OnlineIndex,
} from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { MatchMonitorIndexesToTheirReads1809152000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809152000000-MatchMonitorIndexesToTheirReads";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * MONITOR'S INDEXES, MATCHED TO WHAT READS THEM.
 *
 * Heartbeats, telemetry sweeps, server reports and status changes rewrite
 * "Monitor" rows all the time. An update that changes a column an index names - in its
 * key or a partial index's WHERE - cannot be HOT: it writes an entry into
 * every index on the table and leaves a dead row version for vacuum. On main
 * the busiest writes all moved an indexed timestamp, so none of them was
 * HOT, into 25 indexes each, while the reads that run most - every device
 * poll's fan-out, the Monitors menu's counts, the heartbeat sweeps - had no
 * index that fit them and read whole projects or the whole table.
 *
 * MatchMonitorIndexesToTheirReads1809152000000 builds the indexes those
 * reads need and drops the ones no read uses, online.
 *
 * Pure SQL-contract and metadata assertions; OnlineDdl's own steps are
 * recorded as "online: <statement>". The names are TypeORM's own, so the
 * drift check finds nothing to change.
 */

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

function indexName(columns: Array<string>, where?: string): string {
  return namingStrategy.indexName("Monitor", columns, where);
}

const DISABLED_WHERE: string =
  '"disableActiveMonitoring" = true AND "isArchived" = false AND "deletedAt" IS NULL';
const NO_PROBE_ENABLED_WHERE: string =
  '"isNoProbeEnabledOnThisMonitor" = true AND "isArchived" = false AND "deletedAt" IS NULL';
const PROBES_DISCONNECTED_WHERE: string =
  '"isAllProbesDisconnectedFromThisMonitor" = true AND "isArchived" = false AND "deletedAt" IS NULL';
const HAND_MADE_DEVICE_MONITORS_WHERE: string = `"monitorType" = '${MonitorType.NetworkDevice}' AND "autoProvisionedNetworkDeviceId" IS NULL AND "deletedAt" IS NULL`;
const MADE_FOR_A_DEVICE_WHERE: string =
  '"autoProvisionedNetworkDeviceId" IS NOT NULL';

// Built, in the order up() builds them.
const BUILT: ReadonlyArray<{ name: string; statement: string }> = [
  {
    name: indexName(["projectId"], DISABLED_WHERE),
    statement: `CREATE INDEX "${indexName(["projectId"], DISABLED_WHERE)}" ON "Monitor" ("projectId") WHERE ${DISABLED_WHERE}`,
  },
  {
    name: indexName(["projectId"], NO_PROBE_ENABLED_WHERE),
    statement: `CREATE INDEX "${indexName(["projectId"], NO_PROBE_ENABLED_WHERE)}" ON "Monitor" ("projectId") WHERE ${NO_PROBE_ENABLED_WHERE}`,
  },
  {
    name: indexName(["projectId"], PROBES_DISCONNECTED_WHERE),
    statement: `CREATE INDEX "${indexName(["projectId"], PROBES_DISCONNECTED_WHERE)}" ON "Monitor" ("projectId") WHERE ${PROBES_DISCONNECTED_WHERE}`,
  },
  {
    name: indexName(["monitorType", "_id"]),
    statement: `CREATE INDEX "${indexName(["monitorType", "_id"])}" ON "Monitor" ("monitorType", "_id") `,
  },
  {
    name: indexName(["projectId", "_id"], HAND_MADE_DEVICE_MONITORS_WHERE),
    statement: `CREATE INDEX "${indexName(["projectId", "_id"], HAND_MADE_DEVICE_MONITORS_WHERE)}" ON "Monitor" ("projectId", "_id") WHERE ${HAND_MADE_DEVICE_MONITORS_WHERE}`,
  },
  {
    name: indexName(
      ["autoProvisionedNetworkDeviceId"],
      MADE_FOR_A_DEVICE_WHERE,
    ),
    statement: `CREATE INDEX "${indexName(["autoProvisionedNetworkDeviceId"], MADE_FOR_A_DEVICE_WHERE)}" ON "Monitor" ("autoProvisionedNetworkDeviceId") WHERE ${MADE_FOR_A_DEVICE_WHERE}`,
  },
  {
    name: indexName(["projectId", "isArchived", "createdAt"]),
    statement: `CREATE INDEX "${indexName(["projectId", "isArchived", "createdAt"])}" ON "Monitor" ("projectId", "isArchived", "createdAt") `,
  },
];

// Dropped, in the order up() drops them: each a full index, as main had it.
const DROPPED: ReadonlyArray<{ columns: Array<string> }> = [
  { columns: ["projectId"] },
  { columns: ["slug"] },
  { columns: ["monitoringInterval"] },
  { columns: ["disableActiveMonitoring"] },
  { columns: ["disableActiveMonitoringBecauseOfScheduledMaintenanceEvent"] },
  { columns: ["disableActiveMonitoringBecauseOfManualIncident"] },
  { columns: ["serverMonitorRequestReceivedAt"] },
  { columns: ["telemetryMonitorNextMonitorAt"] },
  { columns: ["telemetryMonitorLastMonitorAt"] },
  { columns: ["incomingRequestMonitorHeartbeatCheckedAt"] },
  { columns: ["incomingEmailMonitorLastEmailReceivedAt"] },
  { columns: ["incomingEmailMonitorHeartbeatCheckedAt"] },
  { columns: ["monitorType"] },
  { columns: ["projectId", "isArchived"] },
];

function createOf(columns: Array<string>): string {
  return `CREATE INDEX "${indexName(columns)}" ON "Monitor" (${columns
    .map((column: string): string => {
      return `"${column}"`;
    })
    .join(", ")}) `;
}

function dropOf(name: string): string {
  return `DROP INDEX "public"."${name}"`;
}

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
  options: { isTransactionActive: boolean },
): Promise<Array<string>> {
  const statements: Array<string> = [];

  for (const step of ["createIndex", "dropIndex"] as const) {
    jest.spyOn(OnlineDdl, step).mockImplementation((async (
      _runner: QueryRunner,
      statement: string,
    ) => {
      statements.push(`online: ${statement}`);
    }) as never);
  }

  await run({
    isTransactionActive: options.isTransactionActive,
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MatchMonitorIndexesToTheirReads1809152000000", () => {
  test("the indexes are named as TypeORM names them, the old ones as main has them", () => {
    expect(
      BUILT.map((index: { name: string }): string => {
        return index.name;
      }),
    ).toEqual([
      "IDX_1c537aa7885967f19fb1f76d1c",
      "IDX_32415a529149e372d15b03aeeb",
      "IDX_7211446751a8adf91b8dec60c7",
      "IDX_5856097e6093bb00fe11ee6d18",
      "IDX_dca0d8b77fc3e95e295bbcc604",
      "IDX_26979816e9ae6fcec4920a9f89",
      "IDX_d624869a64f9b590b387f71985",
    ]);

    // What a database migrated to main calls them (pg_index), in up()'s order.
    expect(
      DROPPED.map((index: { columns: Array<string> }): string => {
        return indexName(index.columns);
      }),
    ).toEqual([
      "IDX_996acfb590bda327843f78b7ad",
      "IDX_42ecc6e0ac9984cd24d5f9ddd8",
      "IDX_db5cc02633b36957c9be4d70c6",
      "IDX_1e0f03c5e067eeb505b2b87aa8",
      "IDX_ea5170227069c85269b3a6db93",
      "IDX_9c8f4b9103fa6b62ff5a121f36",
      "IDX_28d1e0cdf3fcf1ac30249f5d3a",
      "IDX_540a4857bf04eabc59775ca210",
      "IDX_02bae6cdc6d5b3092ac393fbb3",
      "IDX_62cf90e5fbcd9f3742ed35a2bb",
      "IDX_185f36c4cebf452333df869187",
      "IDX_33a77f31ba5b28905464433756",
      "IDX_ff92577021975c63c570943872",
      "IDX_cdc971b41d78e4bed90a1d611b",
    ]);
  });

  test("builds every new index before it drops any old one, all online, outside a transaction", async () => {
    const migration: MatchMonitorIndexesToTheirReads1809152000000 =
      new MatchMonitorIndexesToTheirReads1809152000000();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf(
        (runner: QueryRunner) => {
          return migration.up(runner);
        },
        { isTransactionActive: false },
      ),
    ).toEqual([
      ...BUILT.map((index: { statement: string }): string => {
        return `online: ${index.statement}`;
      }),
      ...DROPPED.map((index: { columns: Array<string> }): string => {
        return `online: ${dropOf(indexName(index.columns))}`;
      }),
    ]);
  });

  test("OnlineDdl reads every build as one it can run concurrently, its predicate kept", () => {
    for (const index of BUILT) {
      const parsed: OnlineIndex = OnlineDdl.parseCreateIndex(index.statement);

      expect(parsed.name).toBe(index.name);
      expect(parsed.quotedTable).toBe(`"Monitor"`);
      expect(parsed.build).toBe(
        index.statement
          .replace("CREATE INDEX ", "CREATE INDEX CONCURRENTLY IF NOT EXISTS ")
          .trim(),
      );
    }
  });

  /*
   * A revert runs inside a transaction: the old indexes come back as the
   * generator wrote them (one of them has two columns, which the generator
   * writes in the table's column order: here the index's own), and only
   * then do the new ones go.
   */
  test("down() puts the old indexes back as they were, then drops the new ones", async () => {
    expect(
      await statementsOf(
        (runner: QueryRunner) => {
          return new MatchMonitorIndexesToTheirReads1809152000000().down(
            runner,
          );
        },
        { isTransactionActive: true },
      ),
    ).toEqual([
      ...[...DROPPED].reverse().map((index: { columns: Array<string> }) => {
        return createOf(index.columns);
      }),
      ...[...BUILT].reverse().map((index: { name: string }): string => {
        return `online: ${dropOf(index.name)}`;
      }),
    ]);
  });

  test("is registered once, after the migration before it, and named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const names: Array<string> = registered.map((migration: unknown) => {
      return (migration as { name: string }).name;
    });

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === MatchMonitorIndexesToTheirReads1809152000000;
      }),
    ).toHaveLength(1);
    expect(
      names.indexOf("MatchMonitorIndexesToTheirReads1809152000000"),
    ).toBeGreaterThan(
      names.indexOf("AddProbeCollectionClaimIndexes1809150400000"),
    );
    expect(new MatchMonitorIndexesToTheirReads1809152000000().name).toBe(
      "MatchMonitorIndexesToTheirReads1809152000000",
    );
  });
});

describe("the Monitor model says the same", () => {
  function declared(): Array<IndexMetadataArgs> {
    return getMetadataArgsStorage().indices.filter(
      (index: IndexMetadataArgs): boolean => {
        return index.target === Monitor;
      },
    );
  }

  function columnsOf(index: IndexMetadataArgs): Array<string> {
    if (!Array.isArray(index.columns)) {
      throw new Error(
        "A Monitor index declares its columns as a function; list them.",
      );
    }
    return index.columns as Array<string>;
  }

  function nameOf(index: IndexMetadataArgs): string {
    return index.name || indexName(columnsOf(index), index.where);
  }

  test("declares exactly the indexes main kept and this migration built", () => {
    const kept: Array<string> = [
      // The columns' own @Index(), as main has them.
      indexName(["name"]),
      indexName(["monitorTemplateId"]),
      indexName(["networkAlertPolicyId"]),
      indexName(["currentMonitorStatusId"]),
      indexName(["isOwnerNotifiedOfResourceCreation"]),
      indexName(["serverMonitorSecretKey"]),
      indexName(["incomingRequestSecretKey"]),
      indexName(["incomingEmailSecretKey"]),
      "IDX_monitor_auto_provisioned_device_template_unique",
    ];

    expect(declared().map(nameOf).sort()).toEqual(
      [
        ...kept,
        ...BUILT.map((index: { name: string }): string => {
          return index.name;
        }),
      ].sort(),
    );
  });

  test("declares none of the indexes this migration dropped", () => {
    const names: Array<string> = declared().map(nameOf);

    for (const index of DROPPED) {
      expect(names).not.toContain(indexName(index.columns));
    }
  });

  test("the new indexes are declared with the columns, in the order, and the WHERE the migration builds", () => {
    for (const index of BUILT) {
      const declaration: IndexMetadataArgs | undefined = declared().find(
        (candidate: IndexMetadataArgs): boolean => {
          return nameOf(candidate) === index.name;
        },
      );

      expect(declaration).toBeDefined();
      expect(declaration?.unique).not.toBe(true);

      const columns: string = columnsOf(declaration!)
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ");
      const where: string = declaration?.where
        ? `WHERE ${declaration.where}`
        : "";

      expect(index.statement.replace(/\s+$/, "")).toBe(
        `CREATE INDEX "${index.name}" ON "Monitor" (${columns}) ${where}`.replace(
          /\s+$/,
          "",
        ),
      );
    }
  });

  /*
   * The columns the busiest writes move, row after row: the telemetry sweep
   * (every minute), the incoming request and email heartbeats (every 30
   * seconds), each server report, request and email, and the hook-free
   * write's own "updatedAt". An index naming any of them - as a column or in
   * a partial index's WHERE - makes every such write a non-HOT update into
   * every index on the table.
   */
  const MOVED_BY_THE_BUSIEST_WRITES: ReadonlyArray<string> = [
    "telemetryMonitorLastMonitorAt",
    "telemetryMonitorNextMonitorAt",
    "incomingRequestMonitorHeartbeatCheckedAt",
    "incomingEmailMonitorHeartbeatCheckedAt",
    "incomingEmailMonitorLastEmailReceivedAt",
    "incomingEmailMonitorRequest",
    "incomingMonitorRequest",
    "incomingMonitorRequestAsReceived",
    "serverMonitorRequestReceivedAt",
    "serverMonitorResponse",
    "updatedAt",
    "version",
  ];

  test("no index names a column the busiest writes move", () => {
    const offending: Array<string> = [];

    for (const index of declared()) {
      for (const column of MOVED_BY_THE_BUSIEST_WRITES) {
        if (
          columnsOf(index).includes(column) ||
          (index.where || "").includes(`"${column}"`)
        ) {
          offending.push(`${nameOf(index)} names ${column}`);
        }
      }
    }

    expect(offending).toEqual([]);
  });

  test("no full index repeats the leading columns of another", () => {
    const full: Array<Array<string>> = declared()
      .filter((index: IndexMetadataArgs): boolean => {
        return !index.where && !index.unique;
      })
      .map(columnsOf);
    const redundant: Array<string> = [];

    for (const index of full) {
      for (const other of full) {
        if (
          index !== other &&
          index.length <= other.length &&
          index.every((column: string, position: number): boolean => {
            return other[position] === column;
          })
        ) {
          redundant.push(`(${index.join(", ")}) of (${other.join(", ")})`);
        }
      }
    }

    expect(redundant).toEqual([]);
  });

  test("the slug has one index: its unique constraint", () => {
    expect(
      declared().filter((index: IndexMetadataArgs): boolean => {
        return columnsOf(index).includes("slug");
      }),
    ).toEqual([]);
  });

  /*
   * A partial index serves a read only when the read's WHERE implies the
   * index's. The reads put every condition in it themselves, but for one:
   * "deletedAt" IS NULL, which TypeORM adds to every read of a soft-deleted
   * model. The device index leaves it out on purpose: the device delete's
   * foreign key check (ON DELETE RESTRICT) reads the column by itself.
   */
  test("the device index can serve the device delete's foreign key check, which reads the column alone", () => {
    const deviceIndex: IndexMetadataArgs | undefined = declared().find(
      (index: IndexMetadataArgs): boolean => {
        return (
          columnsOf(index).join(",") === "autoProvisionedNetworkDeviceId" &&
          !index.unique
        );
      },
    );

    expect(deviceIndex?.where).toBe(
      '"autoProvisionedNetworkDeviceId" IS NOT NULL',
    );
  });
});

/*
 * The Monitors menu's three counts each ask for a partial index's rows. The
 * index serves a count only while the count's WHERE implies the index's:
 * the project, not archived, the flag set ("deletedAt" IS NULL is TypeORM's).
 * A count that stopped saying `isArchived: false` would read the whole
 * project again, on every change to a monitor.
 */
describe("the Monitors menu's counts ask for what their indexes hold", () => {
  const SIDE_MENU: string = path.resolve(
    __dirname,
    "../../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/SideMenu.tsx",
  );

  function countQueryOf(title: string): string {
    const source: string = fs.readFileSync(SIDE_MENU, "utf8");
    const at: number = source.indexOf(`title: "${title}"`);

    expect(at).toBeGreaterThan(-1);

    const start: number = source.indexOf("countQuery: {", at);
    const end: number = source.indexOf("}", start);

    expect(start).toBeGreaterThan(at);

    return source
      .slice(start + "countQuery: {".length, end)
      .replace(/\s+/g, " ")
      .trim();
  }

  test.each([
    ["Probe Disconnected", "isAllProbesDisconnectedFromThisMonitor"],
    ["Probe Disabled", "isNoProbeEnabledOnThisMonitor"],
    ["Disabled", "disableActiveMonitoring"],
  ])(
    "%s counts the project's unarchived monitors with %s set",
    (title: string, flag: string) => {
      expect(countQueryOf(title)).toBe(
        `projectId: props.project?._id, isArchived: false, ${flag}: true,`,
      );
    },
  );
});
