import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddNetbiosLookupToNetworkDeviceDiscoveryScan1793000000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1793000000000-AddNetbiosLookupToNetworkDeviceDiscoveryScan";

/*
 * The migration behind #3677: NetworkDeviceDiscoveryScan.isNetbiosLookupEnabled.
 *
 * The SQL itself is pinned here because nothing but the drift job would
 * otherwise notice a typo in a column type. Beyond the SQL, three things:
 *
 *   - THE DEFAULT CARRIES MEANING, and more of it than most. Turning the
 *     setting on makes the probe SEND a UDP 137 datagram to every unnamed host
 *     in the scan's range, and NBSTAT sweeps are what IDS rules on PCI and
 *     other regulated networks alert on. So the column must arrive NOT NULL
 *     DEFAULT false: Postgres fills the default into every existing row as part
 *     of the ADD COLUMN, and an existing recurring scan must never start
 *     sending that traffic because the server was upgraded. A `DEFAULT true`
 *     here would be a silent network-behaviour change on every installation.
 *   - DIRECTION. The statements are EXECUTED against a fake QueryRunner, not
 *     only read as text: a file read as one blob cannot tell up() from down(),
 *     and a migration whose up() dropped the column would satisfy every
 *     `toContain` written against the blob.
 *   - REGISTRATION. An import that never reaches the default-export array
 *     leaves the migration unregistered, and it silently never runs — the
 *     column is missing in production, the ingest claim select that names it
 *     fails, and every hand-migrated local database looks fine.
 */

const MIGRATION_TIMESTAMP: string = "1793000000000";

const MIGRATION_BASE_NAME: string =
  "AddNetbiosLookupToNetworkDeviceDiscoveryScan";

const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;

const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const ADD_NETBIOS_LOOKUP_SQL: string = `ALTER TABLE "NetworkDeviceDiscoveryScan" ADD "isNetbiosLookupEnabled" boolean NOT NULL DEFAULT false`;

const DROP_NETBIOS_LOOKUP_SQL: string = `ALTER TABLE "NetworkDeviceDiscoveryScan" DROP COLUMN "isNetbiosLookupEnabled"`;

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
  await new AddNetbiosLookupToNetworkDeviceDiscoveryScan1793000000000().up(
    runner,
  );
  return statements;
}

async function downStatements(): Promise<Array<string>> {
  const { runner, statements } = makeQueryRunner();
  await new AddNetbiosLookupToNetworkDeviceDiscoveryScan1793000000000().down(
    runner,
  );
  return statements;
}

describe("executing it", () => {
  /*
   * `toEqual` on the whole statement list rather than `toContain` on the one
   * statement, because "nothing else" is half the claim: no UPDATE pass that
   * turns the lookup on for existing scans, no second column quietly added on
   * the way past (the DiscoveredNetworkDevice.netbiosName field lives inside
   * the jsonb results and needs no DDL at all).
   */
  test("up() adds exactly the one column and does nothing else", async () => {
    expect(await upStatements()).toEqual([ADD_NETBIOS_LOOKUP_SQL]);
  });

  /*
   * Asserted through an actual call to down(), so a migration that added the
   * column in down() and dropped it in up() — dropping it out of every
   * deployed database on the next boot — fails here.
   */
  test("down() drops exactly that column and nothing else", async () => {
    expect(await downStatements()).toEqual([DROP_NETBIOS_LOOKUP_SQL]);
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
      "NetworkDeviceDiscoveryScan.isNetbiosLookupEnabled",
    ]);
    expect(dropped).toEqual([...added].reverse());
  });

  /*
   * See the header: an existing scan reads as "do not send UDP 137". NOT NULL
   * matters as much as the default — the probe reads the flag as `=== true`,
   * so a NULL would also mean off, but the model declares the column
   * non-nullable and the drift check would flag a nullable one.
   */
  test("the setting is NOT NULL and defaults to false, so existing scans never start sending NetBIOS queries", async () => {
    const [addNetbiosLookup] = await upStatements();

    expect(addNetbiosLookup).toContain("boolean");
    expect(addNetbiosLookup).toContain("NOT NULL");
    expect(addNetbiosLookup).toContain("DEFAULT false");
    expect(addNetbiosLookup).not.toContain("DEFAULT true");
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

    expect(statements).toHaveLength(2);

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
      new AddNetbiosLookupToNetworkDeviceDiscoveryScan1793000000000();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
    expect(
      Object.getOwnPropertyNames(
        AddNetbiosLookupToNetworkDeviceDiscoveryScan1793000000000.prototype,
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
      AddNetbiosLookupToNetworkDeviceDiscoveryScan1793000000000,
    );
    expect(
      SchemaMigrations.filter((migration: unknown): boolean => {
        return (
          migration ===
          AddNetbiosLookupToNetworkDeviceDiscoveryScan1793000000000
        );
      }),
    ).toHaveLength(1);
  });

  /*
   * TypeORM records applied migrations by the `name` property, not the file
   * name. A mismatch re-runs the migration on every boot — and this is an
   * ADD COLUMN with no IF NOT EXISTS, so a re-run fails the boot.
   */
  test("its declared name, its class name and its timestamp agree", () => {
    expect(
      new AddNetbiosLookupToNetworkDeviceDiscoveryScan1793000000000().name,
    ).toBe(MIGRATION_CLASS_NAME);
    expect(AddNetbiosLookupToNetworkDeviceDiscoveryScan1793000000000.name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(
      AddNetbiosLookupToNetworkDeviceDiscoveryScan1793000000000.name.match(
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
      AddNetbiosLookupToNetworkDeviceDiscoveryScan1793000000000,
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
   * Registered directly AFTER the migration it was numbered to follow, which
   * is the one it must follow on every installation:
   * AddNetworkDeviceDnsNameAndShortDeviceNames added the scan's other naming
   * column (useShortDeviceNames) and is the newest NetworkDeviceDiscoveryScan
   * migration this one was generated against.
   */
  test("it is registered after the migration its timestamp follows", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migrationClass: unknown): string => {
        return (migrationClass as { name: string }).name;
      },
    );

    expect(names.indexOf(MIGRATION_CLASS_NAME)).toBeGreaterThan(
      names.indexOf("AddNetworkDeviceDnsNameAndShortDeviceNames1792900000000"),
    );
    expect(
      names.indexOf("AddNetworkDeviceDnsNameAndShortDeviceNames1792900000000"),
    ).toBe(names.indexOf(MIGRATION_CLASS_NAME) - 1);
  });
});
