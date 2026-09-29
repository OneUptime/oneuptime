import Host from "../../../Models/DatabaseModels/Host";
import { AddHostIpAddresses1778013317872 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1778013317872-AddHostIpAddresses";
import { IncreaseHostIpAddressesLength1785915638551 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1785915638551-IncreaseHostIpAddressesLength";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import ColumnType from "../../../Types/Database/ColumnType";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { getMaxLengthFromTableColumnType } from "../../../Types/Database/ColumnLength";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #3006: Host.hostIpAddresses was character varying(500). The OTel
 * `host.ip` resource attribute is an ARRAY of every address on every
 * interface, and a Docker host with IPv6 enabled reported 55 of them
 * (~1450 characters). The overflow aborted the whole Host metadata UPDATE
 * — which also carries lastSeenAt and otelCollectorStatus — so a host with
 * healthy, still-arriving telemetry was displayed as "Disconnected".
 *
 * Three things have to line up for the fix to hold, and a regression in any
 * one of them silently reintroduces the bug:
 *   1. the entity declares a `text` column (no max length),
 *   2. the migration actually widens the existing column in Postgres, and
 *      its down() can narrow back without exploding on rows written since,
 *   3. the migration is registered in SchemaMigrations/Index.ts — an
 *      unregistered migration is dead code that never runs on boot.
 *
 * Pure metadata/mocks — no Postgres connection anywhere.
 */

function hostIpColumnArgs(): ColumnMetadataArgs {
  const args: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .columns.filter((column: ColumnMetadataArgs) => {
      return column.target === Host;
    })
    .find((column: ColumnMetadataArgs) => {
      return column.propertyName === "hostIpAddresses";
    });

  if (!args) {
    throw new Error("Host.hostIpAddresses has no TypeORM @Column metadata");
  }

  return args;
}

function makeQueryRunner(): { runner: QueryRunner; query: jest.Mock } {
  const query: jest.Mock = jest.fn().mockResolvedValue(undefined);
  return { runner: { query } as unknown as QueryRunner, query };
}

function executedSql(query: jest.Mock): Array<string> {
  return query.mock.calls.map((call: Array<unknown>) => {
    return String(call[0]);
  });
}

describe("Host.hostIpAddresses entity declaration", () => {
  test("is a text column, not a bounded varchar", () => {
    expect(hostIpColumnArgs().options.type).toBe(ColumnType.VeryLongText);
    expect(ColumnType.VeryLongText).toBe("text");
  });

  test("declares no length — a length on a text column is what regenerates drift", () => {
    expect(hostIpColumnArgs().options.length).toBeUndefined();
  });

  test("is still nullable, so hosts that report no host.ip are unaffected", () => {
    expect(hostIpColumnArgs().options.nullable).toBe(true);
  });

  test("its TableColumn type is VeryLongText", () => {
    const metadata: TableColumnMetadata = new Host().getTableColumnMetadata(
      "hostIpAddresses",
    );
    expect(metadata.type).toBe(TableColumnType.VeryLongText);
  });

  test("has no max length, so DatabaseService length validation cannot reject a long IP list", () => {
    const metadata: TableColumnMetadata = new Host().getTableColumnMetadata(
      "hostIpAddresses",
    );
    expect(getMaxLengthFromTableColumnType(metadata.type)).toBeUndefined();
  });

  test("would have been rejected under the old LongText declaration", () => {
    /*
     * Guards the premise of the fix: 500 really was the bound that the
     * reported ~1450-character payload blew through.
     */
    expect(getMaxLengthFromTableColumnType(TableColumnType.LongText)).toBe(500);
  });

  test("is still readable on relation queries and optional", () => {
    const metadata: TableColumnMetadata = new Host().getTableColumnMetadata(
      "hostIpAddresses",
    );
    expect(metadata.canReadOnRelationQuery).toBe(true);
    expect(metadata.required).toBeFalsy();
  });
});

describe("IncreaseHostIpAddressesLength1785915638551 SQL contract", () => {
  const migration: IncreaseHostIpAddressesLength1785915638551 =
    new IncreaseHostIpAddressesLength1785915638551();

  test("up() widens the column to text in a single statement", async () => {
    const { runner, query } = makeQueryRunner();
    await migration.up(runner);

    expect(executedSql(query)).toEqual([
      `ALTER TABLE "Host" ALTER COLUMN "hostIpAddresses" TYPE text`,
    ]);
  });

  test("up() touches no other table or column", async () => {
    const { runner, query } = makeQueryRunner();
    await migration.up(runner);

    for (const sql of executedSql(query)) {
      expect(sql).toContain(`"Host"`);
      expect(sql).toContain(`"hostIpAddresses"`);
      expect(sql).not.toContain("DROP");
    }
  });

  test("down() clips oversized rows BEFORE narrowing, so the revert cannot fail", async () => {
    const { runner, query } = makeQueryRunner();
    await migration.down(runner);

    const statements: Array<string> = executedSql(query);
    expect(statements).toHaveLength(2);

    const [clip, narrow] = statements as [string, string];
    expect(clip).toContain("UPDATE");
    expect(clip).toContain("LEFT");
    expect(clip).toContain("500");
    expect(narrow).toBe(
      `ALTER TABLE "Host" ALTER COLUMN "hostIpAddresses" TYPE character varying(500)`,
    );
  });

  test("down() restores exactly the width the original migration created", async () => {
    const addColumn: AddHostIpAddresses1778013317872 =
      new AddHostIpAddresses1778013317872();
    const { runner: addRunner, query: addQuery } = makeQueryRunner();
    await addColumn.up(addRunner);

    const { runner: downRunner, query: downQuery } = makeQueryRunner();
    await migration.down(downRunner);

    // The ADD used "character varying(500)"; the revert must land on the same.
    expect(executedSql(addQuery).join("\n")).toContain(
      "character varying(500)",
    );
    expect(executedSql(downQuery).join("\n")).toContain(
      "character varying(500)",
    );
  });

  test("the class name carries its own timestamp, matching the file name", () => {
    expect(migration.name).toBe("IncreaseHostIpAddressesLength1785915638551");
  });
});

describe("IncreaseHostIpAddressesLength1785915638551 registration", () => {
  test("is registered in SchemaMigrations/Index.ts", () => {
    expect(SchemaMigrations).toContain(
      IncreaseHostIpAddressesLength1785915638551,
    );
  });

  test("is registered exactly once", () => {
    const occurrences: number = SchemaMigrations.filter(
      (migration: unknown) => {
        return migration === IncreaseHostIpAddressesLength1785915638551;
      },
    ).length;
    expect(occurrences).toBe(1);
  });

  test("runs after the migration that created the column", () => {
    /*
     * TypeORM executes registered migrations in array order. Widening a
     * column that does not exist yet fails, so the ADD must come first.
     */
    const addIndex: number = SchemaMigrations.indexOf(
      AddHostIpAddresses1778013317872,
    );
    const widenIndex: number = SchemaMigrations.indexOf(
      IncreaseHostIpAddressesLength1785915638551,
    );

    expect(addIndex).toBeGreaterThanOrEqual(0);
    expect(widenIndex).toBeGreaterThan(addIndex);
  });
});
