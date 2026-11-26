import { AddSanSwitchFibreChannelColumns1809187720000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187720000-AddSanSwitchFibreChannelColumns";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkInterface from "../../../Models/DatabaseModels/NetworkInterface";
import {
  TableColumnMetadata,
  getTableColumn,
} from "../../../Types/Database/TableColumn";
import { MigrationInterface, QueryRunner } from "typeorm";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

/*
 * The SAN switch packs' three columns (#11014, #11015): the SNMPv3 context a
 * device is polled in (NetworkDevice.snmpV3ContextName, "VF:128"), and a
 * Fibre Channel port's type and why it is down (NetworkInterface
 * .fibreChannelPortType and .downReason). Each is a nullable varchar added
 * on its own - no default, no backfill, no rewrite of either table - so the
 * migration holds no lock longer than a catalog change.
 */

type MakeQueryRunnerResult = {
  runner: QueryRunner;
  statements: Array<string>;
};

function makeQueryRunner(): MakeQueryRunnerResult {
  const statements: Array<string> = [];

  return {
    runner: {
      query: (...args: Array<unknown>): Promise<undefined> => {
        statements.push(String(args[0]));
        return Promise.resolve(undefined);
      },
    } as unknown as QueryRunner,
    statements,
  };
}

describe("AddSanSwitchFibreChannelColumns1809187720000", () => {
  test("up() adds the three nullable columns, and nothing else", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddSanSwitchFibreChannelColumns1809187720000().up(runner);

    expect(statements).toEqual([
      `ALTER TABLE "NetworkDevice" ADD "snmpV3ContextName" character varying(100)`,
      `ALTER TABLE "NetworkInterface" ADD "fibreChannelPortType" character varying(100)`,
      `ALTER TABLE "NetworkInterface" ADD "downReason" character varying(100)`,
    ]);

    for (const statement of statements) {
      expect(statement).not.toMatch(/NOT NULL|DEFAULT|UPDATE/i);
    }
  });

  test("down() drops them again, in reverse order", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddSanSwitchFibreChannelColumns1809187720000().down(runner);

    expect(statements).toEqual([
      `ALTER TABLE "NetworkInterface" DROP COLUMN "downReason"`,
      `ALTER TABLE "NetworkInterface" DROP COLUMN "fibreChannelPortType"`,
      `ALTER TABLE "NetworkDevice" DROP COLUMN "snmpV3ContextName"`,
    ]);
  });

  /*
   * An unregistered migration never runs on boot, and TypeORM records an
   * applied one by its name: a name that differs from the class re-runs it
   * on every boot.
   */
  test("is registered exactly once, under its own name, after every migration older than it", () => {
    const names: Array<string> = (
      SchemaMigrations as Array<new () => MigrationInterface>
    ).map((migration: new () => MigrationInterface): string => {
      return migration.name;
    });

    const position: number = names.indexOf(
      "AddSanSwitchFibreChannelColumns1809187720000",
    );

    expect(position).toBeGreaterThan(-1);
    expect(
      names.lastIndexOf("AddSanSwitchFibreChannelColumns1809187720000"),
    ).toBe(position);
    expect(names.indexOf("AddProbeSnmpTrapReceiver1809187715110")).toBeLessThan(
      position,
    );
    expect(new AddSanSwitchFibreChannelColumns1809187720000().name).toBe(
      "AddSanSwitchFibreChannelColumns1809187720000",
    );
  });

  test("no other migration file shares its timestamp", () => {
    const sharing: Array<string> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .filter((file: string): boolean => {
        return file.startsWith("1809187720000-");
      });

    expect(sharing).toEqual([
      "1809187720000-AddSanSwitchFibreChannelColumns.ts",
    ]);
  });

  test.each([
    [NetworkDevice, "snmpV3ContextName"],
    [NetworkInterface, "fibreChannelPortType"],
    [NetworkInterface, "downReason"],
  ])(
    "%p.%s is the short, nullable text the migration adds",
    (model: unknown, column: string) => {
      const metadata: TableColumnMetadata | undefined = getTableColumn(
        new (model as new () => NetworkDevice)(),
        column,
      );

      expect(metadata).toBeTruthy();
      expect(metadata!.required).not.toBe(true);
    },
  );
});
