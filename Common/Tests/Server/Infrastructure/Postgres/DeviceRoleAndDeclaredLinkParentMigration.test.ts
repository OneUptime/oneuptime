import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddDeviceRoleAndDeclaredLinkParent1787400000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1787400000000-AddDeviceRoleAndDeclaredLinkParent";

/*
 * The migration behind #3192: NetworkDevice.deviceRole and
 * NetworkDeviceLink.parentDeviceId.
 *
 * Two things are worth pinning about it, and neither is the SQL — the
 * statements were generated rather than written, and the schema-drift job
 * already proves they match the entities.
 *
 * The first is NULLABILITY, because it carries meaning here rather than
 * just permissiveness. NULL is not "unset pending a backfill": on
 * deviceRole it means "no override, let the classifier decide", and on
 * parentDeviceId it means "peers, infer the direction". They are the
 * values every existing row should hold, and a DEFAULT or a NOT NULL on
 * either would silently restate every device and every link in every
 * project as something an operator had chosen.
 *
 * The second is REGISTRATION: an import that never reaches the default
 * export array leaves the migration unregistered, and it silently never
 * runs.
 *
 * The ordering guard this file used to carry — "this is the newest
 * migration, so its timestamp must sort above every other" — has moved on
 * to AddNetworkDeviceReachabilityColumnsMigration.test.ts, which is now the
 * newest. Whoever adds the next migration should move it again.
 */

const MIGRATION_PATH: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1787400000000-AddDeviceRoleAndDeclaredLinkParent.ts",
);

const SOURCE: string = fs.readFileSync(MIGRATION_PATH, "utf8");

describe("the columns it adds", () => {
  test("NetworkDevice gains deviceRole", () => {
    expect(SOURCE).toContain(
      `ALTER TABLE "NetworkDevice" ADD "deviceRole" character varying(100)`,
    );
  });

  test("NetworkDeviceLink gains parentDeviceId", () => {
    expect(SOURCE).toContain(
      `ALTER TABLE "NetworkDeviceLink" ADD "parentDeviceId" uuid`,
    );
  });

  /*
   * See the header: NULL is a meaningful value on both, so neither may
   * arrive with a DEFAULT or a NOT NULL.
   */
  test("neither column is given a default", () => {
    const addStatements: Array<string> = [
      ...SOURCE.matchAll(/`(ALTER TABLE [^`]*ADD "[^"]+"[^`]*)`/g),
    ].map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(addStatements.length).toBe(2);
    for (const statement of addStatements) {
      expect(statement).not.toContain("DEFAULT");
      expect(statement).not.toContain("NOT NULL");
    }
  });

  test("the parent is indexed and cascades with the device it names", () => {
    expect(SOURCE).toContain(
      `CREATE INDEX "IDX_01752cd47b773df38b4a54ae53" ON "NetworkDeviceLink" ("parentDeviceId")`,
    );
    expect(SOURCE).toContain(
      `FOREIGN KEY ("parentDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE CASCADE`,
    );
  });

  /*
   * The parent is always one of the link's own two ends, and both of those
   * already cascade — so this cascade only ever fires alongside one of
   * them. Anything weaker would leave a link pointing at a deleted device.
   */
  test("it touches nothing beyond those two tables", () => {
    const touchedTables: Set<string> = new Set<string>(
      [...SOURCE.matchAll(/ALTER TABLE "(\w+)"/g)].map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
    );

    expect([...touchedTables].sort()).toEqual([
      "NetworkDevice",
      "NetworkDeviceLink",
    ]);
  });
});

describe("up and down are symmetric", () => {
  test("down drops everything up adds, and nothing else", () => {
    const added: Array<string> = [...SOURCE.matchAll(/ADD "(\w+)"/g)].map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    );
    const dropped: Array<string> = [
      ...SOURCE.matchAll(/DROP COLUMN "(\w+)"/g),
    ].map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(added.sort()).toEqual(dropped.sort());
  });

  test("the index and the constraint are dropped too", () => {
    expect(SOURCE).toContain(
      `DROP INDEX "public"."IDX_01752cd47b773df38b4a54ae53"`,
    );
    expect(SOURCE).toContain(
      `DROP CONSTRAINT "FK_01752cd47b773df38b4a54ae539"`,
    );
  });

  /*
   * A stray semicolon would split one queryRunner.query() into two.
   *
   * Trailing whitespace is tolerated on purpose: TypeORM's generator ends
   * a CREATE INDEX with no WHERE clause in a single space, and this file
   * is generated. Normalising it here would mean the checked-in SQL no
   * longer matched what `npm run generate-postgres-migration` produces,
   * and the next person to regenerate would see a spurious diff. Newlines
   * are a different matter — one inside a statement means the template
   * literal wrapped, and that is worth catching.
   */
  test("every statement is a complete, single statement", () => {
    for (const statement of [
      ...SOURCE.matchAll(/`((?:ALTER TABLE|CREATE INDEX|DROP INDEX)[^`]+)`/g),
    ]) {
      expect(statement[1]).not.toContain(";");
      expect(statement[1]).not.toContain("\n");
      expect(statement[1]!.trimStart()).toBe(statement[1]);
    }
  });
});

describe("the migration runs", () => {
  test("it is registered", () => {
    const index: string = fs.readFileSync(
      path.join(path.dirname(MIGRATION_PATH), "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      'from "./1787400000000-AddDeviceRoleAndDeclaredLinkParent"',
    );
    expect(index).toContain("AddDeviceRoleAndDeclaredLinkParent1787400000000,");
  });

  /*
   * ...and registered for real, not just mentioned in the file: an import
   * that never reaches the default-export array leaves the migration
   * unregistered, and it silently never runs.
   */
  test("it is in the exported migration list", () => {
    expect(SchemaMigrations).toContain(
      AddDeviceRoleAndDeclaredLinkParent1787400000000,
    );
  });

  /*
   * TypeORM records applied migrations by the `name` property, not the file
   * name. A mismatch re-runs the migration on every boot.
   */
  test("its declared name matches its class name", () => {
    expect(new AddDeviceRoleAndDeclaredLinkParent1787400000000().name).toBe(
      "AddDeviceRoleAndDeclaredLinkParent1787400000000",
    );
  });

  /*
   * ...and the timestamp in the class name is the one on disk. A class
   * renamed without renaming its file (or two migrations landing on the
   * same timestamp) runs in an order nobody declared.
   */
  test("exactly one file on disk carries its timestamp, and it is this one", () => {
    const directory: string = path.dirname(MIGRATION_PATH);
    const matching: Array<string> = fs
      .readdirSync(directory)
      .filter((file: string): boolean => {
        return file.startsWith("1787400000000-");
      });

    expect(matching).toEqual([
      "1787400000000-AddDeviceRoleAndDeclaredLinkParent.ts",
    ]);
  });
});
