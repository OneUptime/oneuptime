import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddNetworkDeviceRoleTable1790800000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1790800000000-AddNetworkDeviceRoleTable";
import NetworkDeviceRole from "../../../../Models/DatabaseModels/NetworkDeviceRole";
import Columns from "../../../../Types/Database/Columns";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration that turns device roles from a fixed TypeScript union into a
 * per-project lookup table.
 *
 * The SQL itself is generated rather than hand-written, and the schema-drift
 * job already proves it matches the entities — so this file does not re-check
 * TypeORM's spelling. What it pins is the handful of decisions a regeneration
 * would silently reverse, each of which is a data-loss or behaviour change
 * that no functional test would notice:
 *
 *  1. THE FOREIGN KEY ON NetworkDevice IS "SET NULL", NOT "CASCADE". Every
 *     other network-device relation in this schema cascades, so CASCADE is
 *     the shape a hand adds by reflex — and here it would mean that deleting
 *     a role from the project's settings page deletes every device using it.
 *     Deleting "Printer" would delete the printers.
 *
 *  2. THE TWO BOOLEANS CARRY THEIR SEEDED ANSWERS AS DEFAULTS. A role created
 *     without them is not core and is worth walking with SNMP — the neutral
 *     answers that keep an operator-added role behaving like the built-in
 *     ones. NULL is not a value either flag has a meaning for.
 *
 *  3. THE DEPRECATED "deviceRole" STRING SURVIVES. The
 *     BackfillNetworkDeviceRoles data migration reads it to point every
 *     existing device at its new role row; dropping it in the same migration
 *     that creates the table would destroy the input before the backfill ran.
 *
 * The ordering-and-registration guard for the registry as a whole lives in
 * SchemaMigrationsOrdering.test.ts. What is asserted here is only this
 * migration's own registration and its file/class pairing.
 */

const MIGRATION_PATH: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1790800000000-AddNetworkDeviceRoleTable.ts",
);

const SOURCE: string = fs.readFileSync(MIGRATION_PATH, "utf8");

/*
 * The SQL is split into the two halves before anything is asserted about
 * ordering, because "created then dropped" only means something if the drop
 * really is in down() rather than a second statement in up().
 */
function bodyOf(method: "up" | "down"): string {
  const start: number = SOURCE.indexOf(`public async ${method}(`);

  expect(start).toBeGreaterThan(-1);

  const end: number =
    method === "up" ? SOURCE.indexOf("public async down(") : SOURCE.length;

  return SOURCE.slice(start, end);
}

const UP: string = bodyOf("up");
const DOWN: string = bodyOf("down");

function statementsIn(body: string): Array<string> {
  return [...body.matchAll(/`([^`]+)`/g)].map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

function createTableStatement(): string {
  const statement: string | undefined = statementsIn(UP).find(
    (candidate: string): boolean => {
      return candidate.startsWith(`CREATE TABLE "NetworkDeviceRole"`);
    },
  );

  expect(statement).toBeDefined();

  return statement as string;
}

const CREATE_TABLE_STATEMENT: string = createTableStatement();

/*
 * The column definitions out of the CREATE TABLE, keyed by column name and
 * with the definition kept verbatim so NOT NULL and DEFAULT can both be read
 * off it. The split is on a comma followed by a quoted name or by CONSTRAINT,
 * which is every separator in a generated CREATE TABLE and none of the commas
 * that could appear inside one definition.
 */
function columnDefinitions(): Map<string, string> {
  const body: string = CREATE_TABLE_STATEMENT.slice(
    CREATE_TABLE_STATEMENT.indexOf("(") + 1,
    CREATE_TABLE_STATEMENT.lastIndexOf(")"),
  );

  const definitions: Map<string, string> = new Map<string, string>();

  for (const part of body.split(/,\s(?=(?:"|CONSTRAINT\s))/)) {
    const match: RegExpMatchArray | null = part.match(/^"(\w+)"\s([\s\S]+)$/);

    if (match) {
      definitions.set(match[1] as string, match[2] as string);
    }
  }

  return definitions;
}

const COLUMNS: Map<string, string> = columnDefinitions();

function definitionOf(columnName: string): string {
  const definition: string | undefined = COLUMNS.get(columnName);

  expect(definition).toBeDefined();

  return definition as string;
}

describe("the NetworkDeviceRole table it creates", () => {
  /*
   * Written out as a literal rather than derived from the model, so that
   * adding a column to the entity without a migration for it fails here
   * rather than passing because both sides moved together.
   */
  test("it declares exactly the columns the role row is made of", () => {
    expect([...COLUMNS.keys()].sort()).toEqual([
      "_id",
      "createdAt",
      "createdByUserId",
      "deletedAt",
      "deletedByUserId",
      "description",
      "isCoreLayer",
      "isSnmpWalkable",
      "key",
      "name",
      "order",
      "projectId",
      "slug",
      "topologyShape",
      "updatedAt",
      "version",
    ]);
  });

  /*
   * ...and the other direction. A column the entity persists but the table
   * has no room for is a runtime error on the first insert, not a compile
   * error, so the model is the authority the SQL is held to. Entity columns
   * are the relation objects (project, createdByUser, deletedByUser); they
   * are addressed by their own "...Id" column and are not stored themselves.
   */
  test("every column the model persists exists in the table", () => {
    const model: NetworkDeviceRole = new NetworkDeviceRole();
    const declared: Columns = model.getTableColumns();

    const persisted: Array<string> = declared.columns.filter(
      (columnName: string): boolean => {
        const type: TableColumnType =
          model.getTableColumnMetadata(columnName).type;

        return (
          type !== TableColumnType.Entity &&
          type !== TableColumnType.EntityArray
        );
      },
    );

    expect(persisted.length).toBeGreaterThan(0);

    for (const columnName of persisted) {
      expect(COLUMNS.has(columnName)).toBe(true);
    }
  });

  /*
   * The identity of a role. `name` is the label an operator types, `slug` is
   * its URL form and `key` is what the SNMP classifier matches against — a
   * role missing any of the three is a row nothing can find, so none of them
   * may be nullable.
   */
  test("name, slug and key are all required", () => {
    for (const columnName of ["name", "slug", "key"]) {
      expect(definitionOf(columnName)).toContain("NOT NULL");
    }
  });

  /*
   * The presentation fields, by contrast, are genuinely optional: a role with
   * no description, no shape override and no explicit position is a complete
   * role, and the renderer and the pickers all fall back on their own.
   * Making any of these NOT NULL would break the settings page's create form,
   * which does not require them.
   */
  test("description, topologyShape and order are optional", () => {
    for (const columnName of ["description", "topologyShape", "order"]) {
      expect(definitionOf(columnName)).not.toContain("NOT NULL");
    }
  });

  test("projectId is required, because a role belongs to exactly one project", () => {
    expect(definitionOf("projectId")).toContain("NOT NULL");
  });

  /*
   * The neutral answers, and the reason they are DEFAULTs rather than
   * application-side fallbacks: a role added straight through the API without
   * either flag has to behave like the seeded ones, and NULL is not a value
   * "is this at the core of the network?" has an answer for. Flipping either
   * default silently re-tiers or re-monitors every role created afterwards.
   */
  test("isCoreLayer defaults to false: a new role is not core until it is said to be", () => {
    expect(definitionOf("isCoreLayer")).toBe("boolean NOT NULL DEFAULT false");
  });

  test("isSnmpWalkable defaults to true: a new role is assumed to speak SNMP", () => {
    expect(definitionOf("isSnmpWalkable")).toBe(
      "boolean NOT NULL DEFAULT true",
    );
  });

  test("roles are looked up by project, so projectId is indexed", () => {
    expect(UP).toContain(
      `CREATE INDEX "IDX_188009b80d1281f1d7ccecdf74" ON "NetworkDeviceRole" ("projectId")`,
    );
  });

  /*
   * A project's roles go with the project. Nothing else references them once
   * the project is gone, and leaving them would leave rows no tenant filter
   * can ever reach.
   */
  test("the project foreign key cascades", () => {
    expect(UP).toContain(
      `ALTER TABLE "NetworkDeviceRole" ADD CONSTRAINT "FK_188009b80d1281f1d7ccecdf74d" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE`,
    );
  });
});

describe("the link from NetworkDevice to its role", () => {
  test("NetworkDevice gains a nullable networkDeviceRoleId", () => {
    expect(UP).toContain(
      `ALTER TABLE "NetworkDevice" ADD "networkDeviceRoleId" uuid`,
    );

    /*
     * NULL is a meaningful value here and always will be: it means "no
     * operator override, let the SNMP classifier decide", which is what every
     * device already in the table holds. A NOT NULL or a DEFAULT would
     * restate every device in every project as something somebody chose.
     */
    const addStatement: string | undefined = statementsIn(UP).find(
      (statement: string): boolean => {
        return statement.includes(`ADD "networkDeviceRoleId"`);
      },
    );

    expect(addStatement).not.toContain("NOT NULL");
    expect(addStatement).not.toContain("DEFAULT");
  });

  /*
   * The topology map filters and groups devices by role, so the column is
   * read as a predicate on every map load rather than only when a device is
   * opened.
   */
  test("the role column is indexed", () => {
    expect(UP).toContain(
      `CREATE INDEX "IDX_41f59fed52c5ec4ff6a2725ad9" ON "NetworkDevice" ("networkDeviceRoleId")`,
    );
  });

  /*
   * THE ASSERTION THIS FILE EXISTS FOR.
   *
   * Roles are configuration, devices are inventory, and deleting a piece of
   * configuration must never delete inventory. Every other NetworkDevice
   * relation in this schema is ON DELETE CASCADE, so CASCADE is what a
   * regeneration or a copy-paste produces by default — and here it would mean
   * that removing "Printer" from Network > Settings > Device Roles deletes
   * every printer, with its interfaces, its links and its history. SET NULL
   * puts those devices back to being classified from their own SNMP identity,
   * which is exactly what a device with no role has always meant.
   */
  test("deleting a role nulls the devices' role rather than deleting the devices", () => {
    expect(UP).toContain(
      `ALTER TABLE "NetworkDevice" ADD CONSTRAINT "FK_41f59fed52c5ec4ff6a2725ad9a" FOREIGN KEY ("networkDeviceRoleId") REFERENCES "NetworkDeviceRole"("_id") ON DELETE SET NULL`,
    );

    const deviceForeignKey: string | undefined = statementsIn(UP).find(
      (statement: string): boolean => {
        return statement.includes(`FOREIGN KEY ("networkDeviceRoleId")`);
      },
    );

    expect(deviceForeignKey).not.toContain("ON DELETE CASCADE");
  });
});

describe("what the migration deliberately leaves alone", () => {
  /*
   * The deprecated inline string is the backfill's only input. Dropping it
   * here would delete every device's existing role before
   * BackfillNetworkDeviceRoles ever got to read it — and unlike a bad FK
   * action, that is unrecoverable. It is dropped in a follow-up, once the
   * backfill has run everywhere.
   */
  test("the deprecated deviceRole column is neither dropped nor touched", () => {
    /*
     * The SQL, not the whole file: the migration's header comment names the
     * column precisely to explain why it survives, and that prose is the
     * thing keeping the next person from removing it.
     */
    const statementsNamingDeviceRole: Array<string> = [
      ...statementsIn(UP),
      ...statementsIn(DOWN),
    ].filter((statement: string): boolean => {
      return statement.includes(`"deviceRole"`);
    });

    expect(statementsNamingDeviceRole).toEqual([]);
  });

  /*
   * up() drops nothing at all, and the only column down() takes away is the
   * one up() added. Anything else in this list would be a column this
   * migration destroyed on the way in or out.
   */
  test("the only column it ever drops is the one it added", () => {
    expect(UP).not.toContain("DROP COLUMN");

    const droppedColumns: Array<string> = [
      ...DOWN.matchAll(/DROP COLUMN "(\w+)"/g),
    ].map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(droppedColumns).toEqual(["networkDeviceRoleId"]);
  });

  test("only the role table and NetworkDevice are altered", () => {
    const touchedTables: Set<string> = new Set<string>(
      [...UP.matchAll(/(?:ALTER|CREATE) TABLE "(\w+)"/g)].map(
        (match: RegExpMatchArray): string => {
          return match[1] as string;
        },
      ),
    );

    expect([...touchedTables].sort()).toEqual([
      "NetworkDevice",
      "NetworkDeviceRole",
    ]);
  });
});

describe("up and down are symmetric", () => {
  /*
   * Names each object a statement brings into or takes out of existence, so
   * the two halves can be compared as lists rather than as SQL. An
   * unrecognised statement returns null and fails the count assertion below
   * rather than being quietly skipped.
   */
  function objectTouchedBy(statement: string): string | null {
    const patterns: Array<{ pattern: RegExp; kind: string }> = [
      { pattern: /^CREATE TABLE "(\w+)"/, kind: "table" },
      { pattern: /^DROP TABLE "(\w+)"/, kind: "table" },
      { pattern: /^CREATE INDEX "(\w+)"/, kind: "index" },
      { pattern: /^DROP INDEX "public"\."(\w+)"/, kind: "index" },
      { pattern: /ADD CONSTRAINT "(\w+)"/, kind: "constraint" },
      { pattern: /DROP CONSTRAINT "(\w+)"/, kind: "constraint" },
      { pattern: /^ALTER TABLE "\w+" ADD "(\w+)"/, kind: "column" },
      { pattern: /^ALTER TABLE "\w+" DROP COLUMN "(\w+)"/, kind: "column" },
    ];

    for (const { pattern, kind } of patterns) {
      const match: RegExpMatchArray | null = statement.match(pattern);

      if (match) {
        return `${kind}:${match[1]}`;
      }
    }

    return null;
  }

  const createdInUp: Array<string | null> =
    statementsIn(UP).map(objectTouchedBy);
  const droppedInDown: Array<string | null> =
    statementsIn(DOWN).map(objectTouchedBy);

  test("every statement in both halves is one this test understands", () => {
    expect(createdInUp).not.toContain(null);
    expect(droppedInDown).not.toContain(null);
    expect(createdInUp.length).toBe(8);
  });

  /*
   * Reverse order is not cosmetic: the foreign keys reference the table and
   * the column, so dropping the table first would fail outright. A down()
   * that cannot run is a migration that cannot be rolled back.
   */
  test("down drops exactly what up created, in reverse order", () => {
    expect(droppedInDown).toEqual([...createdInUp].reverse());
  });

  /*
   * A stray semicolon would split one queryRunner.query() into two, and a
   * newline inside a statement means the template literal wrapped. Trailing
   * whitespace is tolerated deliberately: TypeORM's generator ends a CREATE
   * INDEX with no WHERE clause in a single space, and normalising it here
   * would make the checked-in SQL differ from what regenerating produces.
   */
  test("every statement is a complete, single statement", () => {
    for (const statement of [...statementsIn(UP), ...statementsIn(DOWN)]) {
      expect(statement).not.toContain(";");
      expect(statement).not.toContain("\n");
      expect(statement.trimStart()).toBe(statement);
    }
  });
});

describe("the migration runs", () => {
  test("it is imported and listed in the registry file", () => {
    const index: string = fs.readFileSync(
      path.join(path.dirname(MIGRATION_PATH), "Index.ts"),
      "utf8",
    );

    expect(index).toContain('from "./1790800000000-AddNetworkDeviceRoleTable"');
    expect(index).toContain("AddNetworkDeviceRoleTable1790800000000,");
  });

  /*
   * ...and registered for real, not just imported: an import that never
   * reaches the default-export array leaves the migration unregistered, and
   * it silently never runs. The symptom is a query against a table that was
   * never created, on some installations and not others.
   */
  test("it is in the exported migration list", () => {
    expect(SchemaMigrations).toContain(AddNetworkDeviceRoleTable1790800000000);
  });

  /*
   * TypeORM records applied migrations by the `name` property, not the file
   * name. A mismatch re-runs the migration on every boot — and this one
   * CREATEs a table with no IF NOT EXISTS, so the re-run fails hard.
   */
  test("its declared name matches its class name", () => {
    expect(new AddNetworkDeviceRoleTable1790800000000().name).toBe(
      "AddNetworkDeviceRoleTable1790800000000",
    );
  });

  /*
   * ...and the timestamp in the class name is the one on disk. A class
   * renamed without renaming its file — or two migrations landing on the same
   * timestamp — runs in an order nobody declared.
   */
  test("exactly one file on disk carries its timestamp, and it is this one", () => {
    const directory: string = path.dirname(MIGRATION_PATH);
    const matching: Array<string> = fs
      .readdirSync(directory)
      .filter((file: string): boolean => {
        return file.startsWith("1790800000000-");
      });

    expect(matching).toEqual(["1790800000000-AddNetworkDeviceRoleTable.ts"]);
  });
});
