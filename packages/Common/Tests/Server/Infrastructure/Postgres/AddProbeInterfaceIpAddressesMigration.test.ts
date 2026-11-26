import { describe, expect, test } from "@jest/globals";
import { QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddProbeInterfaceIpAddresses1809187429000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187429000-AddProbeInterfaceIpAddresses";
import Probe from "../../../../Models/DatabaseModels/Probe";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Permission from "../../../../Types/Permission";

/*
 * AddProbeInterfaceIpAddresses (OneUptime issue #10429):
 * Probe.interfaceIpAddresses, the addresses on a probe's own network
 * interfaces as it lists them when it checks in. Nullable text with no
 * default: Postgres adds it to "Probe" without rewriting a row, and every
 * probe fills it in at its next check-in - nothing is backfilled.
 */

const MIGRATION_TIMESTAMP: RegExp = /(\d{13})$/;

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];

  await run({
    isTransactionActive: false,
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
}

function timestampOf(migration: unknown): number {
  return Number(
    MIGRATION_TIMESTAMP.exec((migration as { name: string }).name)?.[1] || 0,
  );
}

describe("AddProbeInterfaceIpAddresses1809187429000", () => {
  test("adds the one column to Probe, and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddProbeInterfaceIpAddresses1809187429000().up(runner);
      }),
    ).toEqual([`ALTER TABLE "Probe" ADD "interfaceIpAddresses" text`]);
  });

  test("nullable, no default, no index, no row rewritten", async () => {
    for (const statement of await statementsOf((runner: QueryRunner) => {
      return new AddProbeInterfaceIpAddresses1809187429000().up(runner);
    })) {
      expect(statement).not.toMatch(
        /NOT NULL|DEFAULT|CREATE (UNIQUE )?INDEX|FOREIGN KEY|UPDATE /i,
      );
    }
  });

  test("the column is the model's: very long text, not required, set by OneUptime alone", () => {
    const probe: Probe = new Probe();

    expect(probe.getTableColumnMetadata("interfaceIpAddresses")).toBeDefined();
    expect(probe.getTableColumnMetadata("interfaceIpAddresses").required).toBe(
      false,
    );
    expect(probe.getTableColumnMetadata("interfaceIpAddresses").type).toBe(
      TableColumnType.VeryLongText,
    );
    expect(probe.getTableColumnMetadata("interfaceIpAddresses").computed).toBe(
      true,
    );
  });

  test("nobody writes it, and only who reads the address a probe checks in from reads it", () => {
    const probe: Probe = new Probe();
    const access: {
      create: Array<Permission>;
      read: Array<Permission>;
      update: Array<Permission>;
    } = probe.getColumnAccessControlFor("interfaceIpAddresses")! as never;
    const egress: { read: Array<Permission> } = probe.getColumnAccessControlFor(
      "egressIpAddress",
    )! as never;

    expect(access.create).toEqual([]);
    expect(access.update).toEqual([]);
    expect([...access.read].sort()).toEqual([...egress.read].sort());
  });

  test("down drops what up added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddProbeInterfaceIpAddresses1809187429000().down(runner);
      }),
    ).toEqual([`ALTER TABLE "Probe" DROP COLUMN "interfaceIpAddresses"`]);
  });

  test("registered once, numbered after every migration before it", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddProbeInterfaceIpAddresses1809187429000;
      }),
    ).toHaveLength(1);

    const position: number = registered.indexOf(
      AddProbeInterfaceIpAddresses1809187429000,
    );

    expect(
      Math.max(...registered.slice(0, position).map(timestampOf)),
    ).toBeLessThan(timestampOf(AddProbeInterfaceIpAddresses1809187429000));
    expect(new AddProbeInterfaceIpAddresses1809187429000().name).toBe(
      "AddProbeInterfaceIpAddresses1809187429000",
    );
  });
});
