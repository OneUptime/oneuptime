import MonitorNetworkDevice from "../../../../Models/DatabaseModels/MonitorNetworkDevice";
import {
  AddMonitorNetworkDevice1809163000000,
  CREATE_INSERT_TRIGGER,
  CREATE_MONITOR_NETWORK_DEVICE_IDS_FUNCTION,
  CREATE_SYNC_FUNCTION,
  CREATE_UPDATE_TRIGGER,
  INSERT_TRIGGER,
  MONITOR_NETWORK_DEVICE_IDS_FUNCTION,
  NETWORK_DEVICE_MONITOR_TYPE,
  SYNC_FUNCTION,
  UPDATE_TRIGGER,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809163000000-AddMonitorNetworkDevice";
import {
  BACKFILL_MONITOR_NETWORK_DEVICE_PAGE,
  BACKFILL_PAGE_SIZE,
  BackfillMonitorNetworkDevice1809163100000,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809163100000-BackfillMonitorNetworkDevice";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import { describe, expect, test } from "@jest/globals";

/*
 * THE TABLE A DEVICE'S POLL FINDS ITS MONITORS THROUGH, AND THE TRIGGERS
 * THAT KEEP IT.
 *
 * Every poll of every network device and every SNMP trap used to read the
 * steps of every hand-made Network Device monitor in the project to find the
 * few that name the device. MonitorNetworkDevice holds one row per (monitor,
 * device its steps name), kept by triggers on "Monitor" so every write keeps
 * it - including the writes of a server still on the previous release while
 * this one rolls out. MonitorNetworkDevicePostgres runs the triggers on a
 * real Postgres; this pins the migrations' statements against the model and
 * their place in Index.ts, with a fake QueryRunner.
 */

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];

  await run({
    isTransactionActive: true,
    query: (sql: string): Promise<undefined> => {
      statements.push(sql.replace(/\s+/g, " ").trim());
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
}

function flat(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

describe("AddMonitorNetworkDevice1809163000000", () => {
  test("runs in a transaction: every statement is quick, the table is new", () => {
    expect(
      (new AddMonitorNetworkDevice1809163000000() as { transaction?: boolean })
        .transaction,
    ).not.toBe(false);
  });

  test("creates the table, its indexes and keys as the generator writes them, then the functions and triggers", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddMonitorNetworkDevice1809163000000().up(runner);
      },
    );

    expect(statements[0]).toMatch(/^CREATE TABLE "MonitorNetworkDevice" \(/);
    expect(statements[0]).toContain(`"projectId" uuid NOT NULL`);
    expect(statements[0]).toContain(`"monitorId" uuid NOT NULL`);
    expect(statements[0]).toContain(`"networkDeviceId" uuid NOT NULL`);
    expect(statements[0]).toContain(`"version" integer NOT NULL`);

    const unique: string = namingStrategy.indexName("MonitorNetworkDevice", [
      "monitorId",
      "networkDeviceId",
    ]);
    const byDevice: string = namingStrategy.indexName("MonitorNetworkDevice", [
      "networkDeviceId",
    ]);
    const byProject: string = namingStrategy.indexName("MonitorNetworkDevice", [
      "projectId",
    ]);

    expect(statements).toContain(
      `CREATE UNIQUE INDEX "${unique}" ON "MonitorNetworkDevice" ("monitorId", "networkDeviceId")`,
    );
    expect(statements).toContain(
      `CREATE INDEX "${byDevice}" ON "MonitorNetworkDevice" ("networkDeviceId")`,
    );
    expect(statements).toContain(
      `CREATE INDEX "${byProject}" ON "MonitorNetworkDevice" ("projectId")`,
    );

    const foreignKeys: Array<string> = statements.filter((sql: string) => {
      return sql.includes("FOREIGN KEY");
    });

    expect(foreignKeys).toHaveLength(2);
    expect(
      foreignKeys.some((sql: string) => {
        return sql.includes(
          `FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE`,
        );
      }),
    ).toBe(true);
    expect(
      foreignKeys.some((sql: string) => {
        return sql.includes(
          `FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE`,
        );
      }),
    ).toBe(true);
    // No key to the device: a step may name one that was deleted.
    expect(
      foreignKeys.some((sql: string) => {
        return sql.includes(`("networkDeviceId")`);
      }),
    ).toBe(false);

    expect(statements.slice(-4)).toEqual([
      flat(CREATE_MONITOR_NETWORK_DEVICE_IDS_FUNCTION),
      flat(CREATE_SYNC_FUNCTION),
      flat(CREATE_INSERT_TRIGGER),
      flat(CREATE_UPDATE_TRIGGER),
    ]);
  });

  test("the triggers run for Network Device monitors only, and only when the steps, type, project or deletion change", () => {
    expect(NETWORK_DEVICE_MONITOR_TYPE).toBe(MonitorType.NetworkDevice);

    const insert: string = flat(CREATE_INSERT_TRIGGER);
    expect(insert).toContain(`AFTER INSERT ON "Monitor" FOR EACH ROW`);
    expect(insert).toContain(
      `WHEN (NEW."monitorType" = '${MonitorType.NetworkDevice}')`,
    );

    const update: string = flat(CREATE_UPDATE_TRIGGER);
    expect(update).toContain(
      `AFTER UPDATE OF "monitorSteps", "monitorType", "projectId", "deletedAt" ON "Monitor" FOR EACH ROW`,
    );

    for (const column of [
      "monitorSteps",
      "monitorType",
      "projectId",
      "deletedAt",
    ]) {
      expect(update).toContain(
        `OLD."${column}" IS DISTINCT FROM NEW."${column}"`,
      );
    }

    // Never the columns every status, heartbeat and probe result writes.
    for (const busy of [
      "currentMonitorStatusId",
      "updatedAt",
      "version",
      "incomingEmailMonitorHeartbeatCheckedAt",
      "serverMonitorRequestReceivedAt",
    ]) {
      expect(update).not.toContain(`"${busy}"`);
    }
  });

  test("a step's device id is never cast before it is known to be a UUID", () => {
    const ids: string = flat(CREATE_MONITOR_NETWORK_DEVICE_IDS_FUNCTION);

    expect(ids).toContain(
      `'lax $.value.monitorStepsInstanceArray[*].value.networkDeviceMonitor.networkDeviceId'`,
    );
    expect(ids).toContain(`jsonb_typeof(device_id) = 'string'`);
    expect(ids).toMatch(/~\* '\^\[0-9a-f\]\{8\}-/);
    expect(ids).toContain("IMMUTABLE");
  });

  test("the sync replaces a monitor's rows, and writes none for one deleted or of another type", () => {
    const sync: string = flat(CREATE_SYNC_FUNCTION);

    expect(sync).toContain(
      `DELETE FROM "MonitorNetworkDevice" WHERE "monitorId" = OLD."_id"`,
    );
    expect(sync).toContain(
      `NEW."monitorType" = '${MonitorType.NetworkDevice}' AND NEW."deletedAt" IS NULL`,
    );
    expect(sync).toContain(
      `FROM "${MONITOR_NETWORK_DEVICE_IDS_FUNCTION}"(NEW."monitorSteps")`,
    );
    expect(sync).toContain(
      `ON CONFLICT ("monitorId", "networkDeviceId") DO NOTHING`,
    );
  });

  test("down() removes the triggers and functions, then the table", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddMonitorNetworkDevice1809163000000().down(runner);
      },
    );

    expect(statements.slice(0, 4)).toEqual([
      `DROP TRIGGER "${UPDATE_TRIGGER}" ON "Monitor"`,
      `DROP TRIGGER "${INSERT_TRIGGER}" ON "Monitor"`,
      `DROP FUNCTION "${SYNC_FUNCTION}"()`,
      `DROP FUNCTION "${MONITOR_NETWORK_DEVICE_IDS_FUNCTION}"(jsonb)`,
    ]);
    expect(statements[statements.length - 1]).toBe(
      `DROP TABLE "MonitorNetworkDevice"`,
    );
  });
});

describe("BackfillMonitorNetworkDevice1809163100000", () => {
  type Page = Array<{ lastId: string | null; monitors: string | number }>;

  async function pagesAsked(pages: Array<Page>): Promise<Array<unknown>> {
    const asked: Array<unknown> = [];

    await new BackfillMonitorNetworkDevice1809163100000().up({
      query: (sql: string, parameters: Array<unknown>): Promise<Page> => {
        expect(sql).toBe(BACKFILL_MONITOR_NETWORK_DEVICE_PAGE);
        asked.push(parameters[0]);
        return Promise.resolve(
          pages.shift() || [{ lastId: null, monitors: 0 }],
        );
      },
    } as unknown as QueryRunner);

    return asked;
  }

  test("writes the rows a page at a time, each page after the last one's id, until a short page", async () => {
    expect(
      await pagesAsked([
        [{ lastId: "id-1", monitors: String(BACKFILL_PAGE_SIZE) }],
        [{ lastId: "id-2", monitors: BACKFILL_PAGE_SIZE }],
        [{ lastId: "id-3", monitors: "12" }],
      ]),
    ).toEqual([null, "id-1", "id-2"]);
  });

  test("an install with no Network Device monitors reads one page", async () => {
    expect(await pagesAsked([[{ lastId: null, monitors: "0" }]])).toEqual([
      null,
    ]);
  });

  test("a full last page asks once more, and stops on the empty one", async () => {
    expect(
      await pagesAsked([
        [{ lastId: "id-1", monitors: BACKFILL_PAGE_SIZE }],
        [{ lastId: null, monitors: 0 }],
      ]),
    ).toEqual([null, "id-1"]);
  });

  test("a page reads Network Device monitors that are not deleted, by id, and adds only the rows that are missing", () => {
    const page: string = flat(BACKFILL_MONITOR_NETWORK_DEVICE_PAGE);

    expect(page).toContain(
      `"Monitor"."monitorType" = '${MonitorType.NetworkDevice}'`,
    );
    expect(page).toContain(`"Monitor"."deletedAt" IS NULL`);
    expect(page).toContain(
      `($1::uuid IS NULL OR "Monitor"."_id" > $1::uuid) ORDER BY "Monitor"."_id" LIMIT ${BACKFILL_PAGE_SIZE}`,
    );
    expect(page).toContain(
      `INSERT INTO "MonitorNetworkDevice" ("projectId", "monitorId", "networkDeviceId", "version")`,
    );
    expect(page).toContain(
      `ON CONFLICT ("monitorId", "networkDeviceId") DO NOTHING`,
    );
    // Small enough for each statement to finish well inside the app's timeouts.
    expect(BACKFILL_PAGE_SIZE).toBeLessThanOrEqual(1000);
  });

  test("down() has nothing to undo", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new BackfillMonitorNetworkDevice1809163100000().down(runner);
      }),
    ).toEqual([]);
  });
});

describe("registration", () => {
  test("both are registered once, the backfill right after the table, both after the migration before them", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const names: Array<string> = registered.map((migration: unknown) => {
      return (migration as { name: string }).name;
    });

    const add: number = names.indexOf("AddMonitorNetworkDevice1809163000000");
    const backfill: number = names.indexOf(
      "BackfillMonitorNetworkDevice1809163100000",
    );

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddMonitorNetworkDevice1809163000000;
      }),
    ).toHaveLength(1);
    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === BackfillMonitorNetworkDevice1809163100000;
      }),
    ).toHaveLength(1);
    expect(backfill).toBe(add + 1);
    expect(add).toBeGreaterThan(
      names.indexOf("SetMonitorProbeAndNetworkDeviceFillfactor1809151200000"),
    );
    expect(new AddMonitorNetworkDevice1809163000000().name).toBe(
      "AddMonitorNetworkDevice1809163000000",
    );
    expect(new BackfillMonitorNetworkDevice1809163100000().name).toBe(
      "BackfillMonitorNetworkDevice1809163100000",
    );
  });
});

describe("the MonitorNetworkDevice model says the same", () => {
  test("its indexes: the unique (monitor, device), the device, the project", () => {
    const indexes: Array<{ columns: Array<string>; unique: boolean }> =
      getMetadataArgsStorage()
        .indices.filter((index: IndexMetadataArgs): boolean => {
          return index.target === MonitorNetworkDevice;
        })
        .map((index: IndexMetadataArgs) => {
          return {
            columns: Array.isArray(index.columns)
              ? (index.columns as Array<string>)
              : [String(index.columns)],
            unique: Boolean(index.unique),
          };
        });

    expect(indexes).toEqual(
      expect.arrayContaining([
        { columns: ["monitorId", "networkDeviceId"], unique: true },
      ]),
    );
  });

  test("relations to the monitor and the project, cascading; none to the device", () => {
    const relations: Array<RelationMetadataArgs> =
      getMetadataArgsStorage().relations.filter(
        (relation: RelationMetadataArgs): boolean => {
          return relation.target === MonitorNetworkDevice;
        },
      );

    expect(
      relations
        .map((relation: RelationMetadataArgs) => {
          return relation.propertyName;
        })
        .sort(),
    ).toEqual(["monitor", "project"]);

    for (const relation of relations) {
      expect(relation.options.onDelete).toBe("CASCADE");
    }
  });
});
