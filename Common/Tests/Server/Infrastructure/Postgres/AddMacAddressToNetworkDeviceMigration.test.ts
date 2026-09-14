import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import ColumnType from "../../../../Types/Database/ColumnType";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddMacAddressToNetworkDevice1791700000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1791700000000-AddMacAddressToNetworkDevice";

/*
 * The migration behind #3489: NetworkDevice.macAddress.
 *
 * Two things are worth pinning about it, and neither is the SQL — the
 * statement was generated rather than written, and the schema-drift job
 * already proves it matches the entity.
 *
 * The first is NULLABILITY, because it carries meaning here rather than
 * just permissiveness. NULL is not "unset pending a backfill": it means "no
 * MAC declared and none learned yet", which is the value every existing
 * device should hold. A DEFAULT would restate the whole fleet as having a
 * MAC it does not have — and, worse, would stop the ARP learner from ever
 * filling the column, because it only ever writes into an EMPTY value.
 *
 * The second is REGISTRATION: an import that never reaches the default
 * export array leaves the migration unregistered, and it silently never
 * runs — the column is missing in production while every local database
 * migrated by hand looks fine.
 *
 * The statements are also EXECUTED against a fake QueryRunner, not only
 * read as text. A file read as one blob cannot tell up() from down(): a
 * migration whose up() DROPPED the column and whose down() ADDED it
 * contains both statements and satisfies every `toContain` written against
 * the blob.
 */

const MIGRATION_TIMESTAMP: string = "1791700000000";

const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-AddMacAddressToNetworkDevice.ts`;

const MIGRATION_CLASS_NAME: string = `AddMacAddressToNetworkDevice${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const MIGRATION_PATH: string = path.join(
  MIGRATION_DIRECTORY,
  MIGRATION_FILE_NAME,
);

const SOURCE: string = fs.readFileSync(MIGRATION_PATH, "utf8");

const COLUMN: string = "macAddress";

const ADD_COLUMN_SQL: string = `ALTER TABLE "NetworkDevice" ADD "${COLUMN}" character varying(100)`;

const DROP_COLUMN_SQL: string = `ALTER TABLE "NetworkDevice" DROP COLUMN "${COLUMN}"`;
const FLAG_COLUMN: string = "isMacAddressLearned";
const ADD_FLAG_SQL: string = `ALTER TABLE "NetworkDevice" ADD "${FLAG_COLUMN}" boolean DEFAULT false`;
const DROP_FLAG_SQL: string = `ALTER TABLE "NetworkDevice" DROP COLUMN "${FLAG_COLUMN}"`;

/*
 * Hoisted so the literals are not the object of a member expression, which
 * wrap-regex and Prettier cannot agree on.
 */
const ADD_STATEMENTS: RegExp = /`(ALTER TABLE [^`]*ADD "[^"]+"[^`]*)`/g;
const ADDED_COLUMNS: RegExp = /ADD "(\w+)"/g;
const DROPPED_COLUMNS: RegExp = /DROP COLUMN "(\w+)"/g;
const TOUCHED_TABLES: RegExp = /ALTER TABLE "(\w+)"/g;
const EVERY_STATEMENT: RegExp =
  /`((?:ALTER TABLE|CREATE INDEX|DROP INDEX|UPDATE)[^`]+)`/g;
const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;

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

function typeOrmColumn(): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find((column: ColumnMetadataArgs) => {
    return column.target === NetworkDevice && column.propertyName === COLUMN;
  });
}

describe("the column it adds", () => {
  test("NetworkDevice gains macAddress as a varchar(100)", () => {
    expect(SOURCE).toContain(ADD_COLUMN_SQL);
  });

  /*
   * See the header: NULL is a meaningful value, so the column may not
   * arrive with a DEFAULT or a NOT NULL.
   */
  test("the column is given no default and is nullable", () => {
    const addStatements: Array<string> = [
      ...SOURCE.matchAll(ADD_STATEMENTS),
    ].map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(addStatements.length).toBe(2);
    for (const statement of addStatements) {
      expect(statement).not.toContain("NOT NULL");
    }
    /*
     * The MAC itself has no default: NULL means "not known", which is a
     * real state. The provenance flag beside it defaults to false, so
     * every existing row reads "typed" - a MAC nobody learned is nobody's
     * to correct.
     */
    expect(addStatements[0]).not.toContain("DEFAULT");
    expect(addStatements[1]).toContain("DEFAULT false");
  });

  test("it touches nothing beyond the device table", () => {
    const touchedTables: Set<string> = new Set<string>(
      [...SOURCE.matchAll(TOUCHED_TABLES)].map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
    );

    expect([...touchedTables]).toEqual(["NetworkDevice"]);
  });

  /*
   * No backfill, and deliberately: there is nothing to fill it FROM. The
   * MAC of a device that was never walked is not stored anywhere, and the
   * ARP learner fills the column on the next router walk for every device
   * it can — a pass here would only write nulls that are already there.
   */
  test("it does not backfill", () => {
    expect(SOURCE).not.toContain("UPDATE ");
  });
});

describe("up and down are symmetric", () => {
  test("down drops exactly what up adds, and nothing else", () => {
    const added: Array<string> = [...SOURCE.matchAll(ADDED_COLUMNS)].map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    );
    const dropped: Array<string> = [...SOURCE.matchAll(DROPPED_COLUMNS)].map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    );

    expect(added).toEqual([COLUMN, FLAG_COLUMN]);
    expect([...added].sort()).toEqual([...dropped].sort());
  });

  /*
   * A stray semicolon would split one queryRunner.query() into two, and a
   * newline inside a statement means the template literal wrapped.
   */
  test("every statement is a complete, single statement", () => {
    const statements: Array<RegExpMatchArray> = [
      ...SOURCE.matchAll(EVERY_STATEMENT),
    ];

    expect(statements.length).toBe(4);
    for (const statement of statements) {
      expect(statement[1]).not.toContain(";");
      expect(statement[1]).not.toContain("\n");
      expect(statement[1]!.trimStart()).toBe(statement[1]);
    }
  });
});

describe("executing it", () => {
  /*
   * `toEqual` on the whole statement list rather than `toContain` on any
   * one of them, because "nothing else" is half the claim: no UPDATE pass,
   * no second table quietly altered, no index built on the way past.
   */
  test("up() adds the column, and does nothing else", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddMacAddressToNetworkDevice1791700000000().up(runner);

    expect(statements).toEqual([ADD_COLUMN_SQL, ADD_FLAG_SQL]);
  });

  /*
   * The direction matters as much as the SQL. Asserted through an actual
   * call to down(), so a migration that added the column in down() and
   * dropped it in up() — which would drop the column out of every deployed
   * database on the next boot — fails here rather than passing a text
   * search that finds both statements somewhere in the file.
   */
  test("down() drops exactly the column up() added, and nothing else", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddMacAddressToNetworkDevice1791700000000().down(runner);

    expect(statements).toEqual([DROP_FLAG_SQL, DROP_COLUMN_SQL]);
  });

  /*
   * TypeORM calls `up` and `down` by name. A rename to anything else — a
   * refactor that made `up` an `upgrade`, a helper method left on the
   * class — leaves a migration the runner will not run, which is the same
   * outcome as not writing it.
   */
  test("is a MigrationInterface whose two steps are still named up and down", () => {
    const migration: MigrationInterface =
      new AddMacAddressToNetworkDevice1791700000000();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
    expect(
      Object.getOwnPropertyNames(
        AddMacAddressToNetworkDevice1791700000000.prototype,
      ).sort(),
    ).toEqual(["constructor", "down", "up"]);
  });

  /*
   * The migration and the model have to describe the same column. Two
   * files, one schema: the migration is what the deployed database gets,
   * the model is what every query assumes it got. Read off the SQL up()
   * actually ran, so the comparison is against the statement that reaches
   * Postgres.
   */
  test("the SQL it runs says the same thing about the column that the model does", async () => {
    const { runner, statements } = makeQueryRunner();

    await new AddMacAddressToNetworkDevice1791700000000().up(runner);

    const addColumn: string = statements[0] ?? "";

    expect(addColumn).toContain(
      `ADD "${COLUMN}" character varying(${ColumnLength.ShortText})`,
    );
    expect(typeOrmColumn()?.options.type).toBe(ColumnType.ShortText);
    expect(typeOrmColumn()?.options.length).toBe(ColumnLength.ShortText);

    expect(addColumn).not.toContain("NOT NULL");
    expect(typeOrmColumn()?.options.nullable).toBe(true);

    expect(addColumn).not.toContain("DEFAULT");
    expect(typeOrmColumn()?.options.default).toBeUndefined();
  });
});

describe("the migration runs", () => {
  test("it is registered", () => {
    const index: string = fs.readFileSync(
      path.join(MIGRATION_DIRECTORY, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `from "./${MIGRATION_TIMESTAMP}-AddMacAddressToNetworkDevice"`,
    );
    expect(index).toContain(`${MIGRATION_CLASS_NAME},`);
  });

  /*
   * ...and registered for real, not just mentioned in the file: an import
   * that never reaches the default-export array leaves the migration
   * unregistered, and it silently never runs.
   */
  test("it is in the exported migration list", () => {
    expect(SchemaMigrations).toContain(
      AddMacAddressToNetworkDevice1791700000000,
    );
  });

  /*
   * TypeORM records applied migrations by the `name` property, not the
   * file name. A mismatch re-runs the migration on every boot.
   */
  test("its declared name matches its class name", () => {
    expect(new AddMacAddressToNetworkDevice1791700000000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(AddMacAddressToNetworkDevice1791700000000.name).toBe(
      MIGRATION_CLASS_NAME,
    );
  });

  /*
   * ...and the timestamp in the class name is the one on disk. A class
   * renamed without renaming its file (or two migrations landing on the
   * same timestamp — this directory has had that happen twice) runs in an
   * order nobody declared.
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
   * "It is the newest" belongs to whichever migration is currently newest
   * and lives in SchemaMigrationsOrdering.test.ts.
   */
  test("its timestamp sorts after every migration registered before it", () => {
    const position: number = SchemaMigrations.indexOf(
      AddMacAddressToNetworkDevice1791700000000,
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
     * Math.max() of an empty list is -Infinity, which every timestamp
     * beats. Prove the list was actually enumerated before leaning on its
     * maximum. (InitialMigration carries no timestamp, hence "greater
     * than", not "equal to", the slice length.)
     */
    expect(earlierTimestamps.length).toBeGreaterThan(100);

    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(
      Math.max(...earlierTimestamps),
    );
  });
});
