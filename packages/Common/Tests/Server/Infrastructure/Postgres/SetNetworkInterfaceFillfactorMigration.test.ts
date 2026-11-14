import { SetNetworkInterfaceFillfactor1809164000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809164000000-SetNetworkInterfaceFillfactor";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * ROOM ON EVERY PAGE OF "NetworkInterface" FOR THE NEXT UPDATE.
 *
 * A device walk writes an interface only when it changed, or every fifteen
 * minutes (NetworkInterfaceService.upsertWalkedInterfaces), and nothing a
 * walk writes is in an index on the table, so every one of those writes can
 * be HOT - when the row's page has room for the new version. A device's
 * interfaces are inserted together by one walk, packed full at the default
 * fillfactor of 100; the migration keeps a fifth of each page free
 * (fillfactor 80, as #8063 found best for NetworkDevice, which a poll also
 * writes several times a cycle). NetworkInterfaceWritesPostgres measures it.
 *
 * TypeORM does not model storage parameters, so the migration is written by
 * hand and the schema drift check cannot catch a change to it: these
 * assertions pin its statements (Docs/migrations/README.md, "Storage
 * parameters"). They also pin what keeps it harmless on a table every poll
 * writes: ALTER TABLE ... SET / RESET of fillfactor takes SHARE UPDATE
 * EXCLUSIVE - no read or write waits for it - and rewrites nothing. An
 * ALTER TABLE that does anything else here takes ACCESS EXCLUSIVE.
 */

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];

  await run({
    isTransactionActive: true,
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
}

const STORAGE_PARAMETER_ONLY: RegExp =
  /^ALTER TABLE "NetworkInterface" (SET \(fillfactor = \d+\)|RESET \(fillfactor\))$/;

describe("SetNetworkInterfaceFillfactor1809164000000", () => {
  test("keeps a fifth of every page free - and does nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new SetNetworkInterfaceFillfactor1809164000000().up(runner);
      }),
    ).toEqual([`ALTER TABLE "NetworkInterface" SET (fillfactor = 80)`]);
  });

  test("down() gives the table the default back", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new SetNetworkInterfaceFillfactor1809164000000().down(runner);
      }),
    ).toEqual([`ALTER TABLE "NetworkInterface" RESET (fillfactor)`]);
  });

  test("every statement only sets a storage parameter: SHARE UPDATE EXCLUSIVE, no rewrite", async () => {
    const migration: SetNetworkInterfaceFillfactor1809164000000 =
      new SetNetworkInterfaceFillfactor1809164000000();
    const statements: Array<string> = [
      ...(await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      })),
      ...(await statementsOf((runner: QueryRunner) => {
        return migration.down(runner);
      })),
    ];

    expect(statements).toHaveLength(2);
    expect(
      statements.filter((statement: string): boolean => {
        return !STORAGE_PARAMETER_ONLY.test(statement);
      }),
    ).toEqual([]);
  });

  test("runs in a transaction: nothing in it needs to run outside one", () => {
    expect(
      (
        new SetNetworkInterfaceFillfactor1809164000000() as {
          transaction?: boolean;
        }
      ).transaction,
    ).not.toBe(false);
  });

  test("is registered once, after the migrations before it, and named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const names: Array<string> = registered.map((migration: unknown) => {
      return (migration as { name: string }).name;
    });

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === SetNetworkInterfaceFillfactor1809164000000;
      }),
    ).toHaveLength(1);
    expect(
      names.indexOf("SetNetworkInterfaceFillfactor1809164000000"),
    ).toBeGreaterThan(
      names.indexOf("SetMonitorProbeAndNetworkDeviceFillfactor1809151200000"),
    );
    expect(
      names.indexOf("SetNetworkInterfaceFillfactor1809164000000"),
    ).toBeGreaterThan(
      names.indexOf("BackfillMonitorNetworkDevice1809163100000"),
    );
    expect(new SetNetworkInterfaceFillfactor1809164000000().name).toBe(
      "SetNetworkInterfaceFillfactor1809164000000",
    );
  });
});
