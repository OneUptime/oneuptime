import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddNetworkDeviceDnsNameAndShortDeviceNames1792900000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1792900000000-AddNetworkDeviceDnsNameAndShortDeviceNames";

/*
 * The migration behind #3678: NetworkDevice.dnsName and
 * NetworkDeviceDiscoveryScan.useShortDeviceNames.
 *
 * Hand-written rather than generated (a generated file would pick up
 * unrelated schema drift from whatever database it was generated against), so
 * the SQL itself IS worth pinning here — nothing but the drift job would
 * otherwise notice a typo in a column type. Beyond the SQL, three things:
 *
 *   - THE DEFAULTS CARRY MEANING. `dnsName` is nullable with no default:
 *     NULL is "no DNS name recorded", the truth for every existing device,
 *     and the bulk action only fills an EMPTY value. `useShortDeviceNames` is
 *     NOT NULL DEFAULT false: every existing scan must keep importing under
 *     full names until someone turns the setting on, and Postgres fills the
 *     default in for existing rows as part of the ADD COLUMN, so there is no
 *     UPDATE pass (and no table rewrite to plan around).
 *   - DIRECTION. The statements are EXECUTED against a fake QueryRunner, not
 *     only read as text: a file read as one blob cannot tell up() from down(),
 *     and a migration whose up() dropped the columns would satisfy every
 *     `toContain` written against the blob.
 *   - REGISTRATION. An import that never reaches the default-export array
 *     leaves the migration unregistered, and it silently never runs — the
 *     columns are missing in production while every hand-migrated local
 *     database looks fine.
 */

const MIGRATION_TIMESTAMP: string = "1792900000000";

const MIGRATION_BASE_NAME: string =
  "AddNetworkDeviceDnsNameAndShortDeviceNames";

const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;

const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const ADD_DNS_NAME_SQL: string = `ALTER TABLE "NetworkDevice" ADD "dnsName" character varying(500)`;

const ADD_SHORT_NAMES_SQL: string = `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD "useShortDeviceNames" boolean NOT NULL DEFAULT false`;

const DROP_SHORT_NAMES_SQL: string = `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP COLUMN "useShortDeviceNames"`;

const DROP_DNS_NAME_SQL: string = `ALTER TABLE "NetworkDevice" DROP COLUMN "dnsName"`;

/*
 * Hoisted so the literals are not the object of a member expression, which
 * wrap-regex and Prettier cannot agree on.
 */
const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;
const ADDED_COLUMN: RegExp = /^ALTER TABLE "(\w+)" ADD "(\w+)"/;
const DROPPED_COLUMN: RegExp = /^ALTER TABLE "(\w+)" DROP COLUMN "(\w+)"$/;

type MakeQueryRunnerResult = {
  runner: QueryRunner;
  statements: Array<string>;
};

type MakeQueryRunnerFunction = () => MakeQueryRunnerResult;

const makeQueryRunner: MakeQueryRunnerFunction = (): MakeQueryRunnerResult => {
  const statements: Array<string> = [];

  const query: (...args: Array<unknown>) => Promise<undefined> = (
    ...args: Array<unknown>
  ): Promise<undefined> => {
    statements.push(String(args[0]));
    return Promise.resolve(undefined);
  };

  return {
    runner: { query } as unknown as QueryRunner,
    statements,
  };
};

async function upStatements(): Promise<Array<string>> {
  const { runner, statements } = makeQueryRunner();
  await new AddNetworkDeviceDnsNameAndShortDeviceNames1792900000000().up(
    runner,
  );
  return statements;
}

async function downStatements(): Promise<Array<string>> {
  const { runner, statements } = makeQueryRunner();
  await new AddNetworkDeviceDnsNameAndShortDeviceNames1792900000000().down(
    runner,
  );
  return statements;
}

describe("executing it", () => {
  /*
   * `toEqual` on the whole statement list rather than `toContain` on any
   * one of them, because "nothing else" is half the claim: no UPDATE pass,
   * no third table quietly altered, no index built on the way past.
   */
  test("up() adds exactly the two columns, in order, and does nothing else", async () => {
    expect(await upStatements()).toEqual([
      ADD_DNS_NAME_SQL,
      ADD_SHORT_NAMES_SQL,
    ]);
  });

  /*
   * The reverse, in reverse order. Asserted through an actual call to
   * down(), so a migration that added a column in down() and dropped it in
   * up() — dropping it out of every deployed database on the next boot —
   * fails here.
   */
  test("down() drops exactly those two columns, in reverse order, and nothing else", async () => {
    expect(await downStatements()).toEqual([
      DROP_SHORT_NAMES_SQL,
      DROP_DNS_NAME_SQL,
    ]);
  });

  test("down() undoes exactly what up() did, table for table and column for column", async () => {
    const added: Array<string> = (await upStatements()).map(
      (statement: string): string => {
        const match: RegExpMatchArray | null = statement.match(ADDED_COLUMN);
        expect(match).not.toBeNull();
        return `${match![1]}.${match![2]}`;
      },
    );

    const dropped: Array<string> = (await downStatements()).map(
      (statement: string): string => {
        const match: RegExpMatchArray | null = statement.match(DROPPED_COLUMN);
        expect(match).not.toBeNull();
        return `${match![1]}.${match![2]}`;
      },
    );

    expect(added).toEqual([
      "NetworkDevice.dnsName",
      "NetworkDeviceDiscoveryScan.useShortDeviceNames",
    ]);
    expect(dropped).toEqual([...added].reverse());
  });

  /*
   * See the header: NULL is the meaning of "no DNS name", so that column may
   * not arrive with a DEFAULT or a NOT NULL; and the scan setting must arrive
   * as NOT NULL DEFAULT false, so existing scans read as "full names".
   */
  test("the DNS name is nullable with no default, and the scan setting defaults to false", async () => {
    const [addDnsName, addShortNames] = await upStatements();

    expect(addDnsName).not.toContain("NOT NULL");
    expect(addDnsName).not.toContain("DEFAULT");

    expect(addShortNames).toContain("NOT NULL");
    expect(addShortNames).toContain("DEFAULT false");
    expect(addShortNames).not.toContain("DEFAULT true");
  });

  test("it does not backfill or build indexes", async () => {
    for (const statement of [
      ...(await upStatements()),
      ...(await downStatements()),
    ]) {
      expect(statement).not.toContain("UPDATE");
      expect(statement).not.toContain("INDEX");
    }
  });

  /*
   * A stray semicolon would split one queryRunner.query() into two, and a
   * newline inside a statement means the template literal wrapped.
   */
  test("every statement is a complete, single statement", async () => {
    const statements: Array<string> = [
      ...(await upStatements()),
      ...(await downStatements()),
    ];

    expect(statements).toHaveLength(4);

    for (const statement of statements) {
      expect(statement).not.toContain(";");
      expect(statement).not.toContain("\n");
      expect(statement.trim()).toBe(statement);
    }
  });

  /*
   * TypeORM calls `up` and `down` by name. A rename to anything else leaves
   * a migration the runner will not run, which is the same outcome as not
   * writing it.
   */
  test("is a MigrationInterface whose two steps are still named up and down", () => {
    const migration: MigrationInterface =
      new AddNetworkDeviceDnsNameAndShortDeviceNames1792900000000();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
    expect(
      Object.getOwnPropertyNames(
        AddNetworkDeviceDnsNameAndShortDeviceNames1792900000000.prototype,
      ).sort(),
    ).toEqual(["constructor", "down", "up"]);
  });
});

describe("the migration runs", () => {
  test("it is imported and listed in Index.ts", () => {
    const index: string = fs.readFileSync(
      path.join(MIGRATION_DIRECTORY, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import { ${MIGRATION_CLASS_NAME} } from "./${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}";`,
    );
    expect(index).toContain(`  ${MIGRATION_CLASS_NAME},\n`);
  });

  /*
   * ...and registered for real, not just mentioned in the file: an import
   * that never reaches the default-export array leaves the migration
   * unregistered, and it silently never runs.
   */
  test("it is in the exported migration list, exactly once", () => {
    expect(SchemaMigrations).toContain(
      AddNetworkDeviceDnsNameAndShortDeviceNames1792900000000,
    );
    expect(
      SchemaMigrations.filter((migration: unknown): boolean => {
        return (
          migration === AddNetworkDeviceDnsNameAndShortDeviceNames1792900000000
        );
      }),
    ).toHaveLength(1);
  });

  /*
   * TypeORM records applied migrations by the `name` property, not the file
   * name. A mismatch re-runs the migration on every boot — and these are
   * ADD COLUMNs with no IF NOT EXISTS, so a re-run fails the boot.
   */
  test("its declared name, its class name and its timestamp agree", () => {
    expect(
      new AddNetworkDeviceDnsNameAndShortDeviceNames1792900000000().name,
    ).toBe(MIGRATION_CLASS_NAME);
    expect(AddNetworkDeviceDnsNameAndShortDeviceNames1792900000000.name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(
      AddNetworkDeviceDnsNameAndShortDeviceNames1792900000000.name.match(
        CLASS_TIMESTAMP,
      )?.[1],
    ).toBe(MIGRATION_TIMESTAMP);
  });

  /*
   * ...and the timestamp in the class name is the one on disk. A class
   * renamed without renaming its file (or two migrations landing on the same
   * timestamp — this directory has had that happen twice) runs in an order
   * nobody declared.
   */
  test("exactly one file on disk carries its timestamp, and it is this one", () => {
    const matching: Array<string> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .filter((file: string): boolean => {
        return file.startsWith(`${MIGRATION_TIMESTAMP}-`);
      });

    expect(matching).toEqual([MIGRATION_FILE_NAME]);
  });

  /*
   * Migrations run in array order, and one landing BELOW a migration that
   * has already run applies out of order. Only the durable half is asserted
   * here — nothing registered BEFORE this one carries a later timestamp.
   * "It is the newest" belongs to whichever migration is currently newest and
   * lives in SchemaMigrationsOrdering.test.ts, so that appending the next
   * migration does not require editing this file.
   */
  test("its timestamp sorts after every migration registered before it", () => {
    const position: number = SchemaMigrations.indexOf(
      AddNetworkDeviceDnsNameAndShortDeviceNames1792900000000,
    );

    expect(position).toBeGreaterThan(-1);

    const earlierTimestamps: Array<number> = [];

    for (const migrationClass of SchemaMigrations.slice(0, position)) {
      const match: RegExpMatchArray | null = (
        migrationClass as { name: string }
      ).name.match(CLASS_TIMESTAMP);

      if (match) {
        earlierTimestamps.push(Number(match[1]));
      }
    }

    /*
     * Math.max() of an empty list is -Infinity, which every timestamp beats.
     * Prove the list was actually enumerated before leaning on its maximum.
     */
    expect(earlierTimestamps.length).toBeGreaterThan(100);

    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(
      Math.max(...earlierTimestamps),
    );
  });

  /*
   * Registered AFTER the migration it was numbered to follow, which is the
   * one it must follow on every installation: AddNetworkDeviceDiagnostic
   * is the newest NetworkDevice migration this one was written against.
   */
  test("it is registered after the migration its timestamp follows", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migrationClass: unknown): string => {
        return (migrationClass as { name: string }).name;
      },
    );

    expect(names.indexOf(MIGRATION_CLASS_NAME)).toBeGreaterThan(
      names.indexOf("AddNetworkDeviceDiagnostic1792800000000"),
    );
    expect(names.indexOf("AddNetworkDeviceDiagnostic1792800000000")).toBe(
      names.indexOf(MIGRATION_CLASS_NAME) - 1,
    );
  });
});
