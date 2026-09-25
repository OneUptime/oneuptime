import { AddIncidentAlert1794900000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1794900000000-AddIncidentAlert";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import IncidentAlert from "../../../../Models/DatabaseModels/IncidentAlert";
import { describe, expect, test } from "@jest/globals";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * The schema half of linking alerts to incidents.
 *
 * The migration was generated against the models, so its names are TypeORM's
 * by construction. What this pins is that it STAYS the migration for them:
 * the link table is created with every column the model persists, a pair is
 * unique at the database level (the service's @UniqueColumnsTogether check is
 * not race free on its own), a link goes with its project, incident or alert,
 * outlives the user who made it, every constraint and index carries
 * TypeORM's own name - a hand edit that renamed one would pass review and
 * then fail the Schema Drift job - the two project switches are off for every
 * existing project, and down() undoes up() in reverse.
 *
 * Fake QueryRunner only; IncidentAlertPostgres.test.ts runs the same
 * guarantees against a migrated database.
 */

const TABLE: string = "IncidentAlert";
const UNIQUE_COLUMNS: Array<string> = ["incidentId", "alertId", "projectId"];
const PROJECT_SWITCHES: Array<string> = [
  "acknowledgeLinkedAlertsWhenIncidentAcknowledged",
  "resolveLinkedAlertsWhenIncidentResolved",
];

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

type RecordQueriesFunction = (
  direction: "up" | "down",
) => Promise<Array<string>>;

const recordQueries: RecordQueriesFunction = async (
  direction: "up" | "down",
): Promise<Array<string>> => {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  await new AddIncidentAlert1794900000000()[direction](queryRunner);

  return statements;
};

// Columns a model persists, inherited ones (_id, version, ...) included.
function persistedColumns(modelType: unknown): Array<string> {
  const names: Array<string> = [];
  let current: unknown = modelType;

  while (typeof current === "function" && current !== Function.prototype) {
    for (const column of getMetadataArgsStorage().columns) {
      if (column.target === current) {
        const args: ColumnMetadataArgs = column;
        names.push(args.options.name || args.propertyName);
      }
    }

    current = Object.getPrototypeOf(current);
  }

  return names;
}

function createTableStatement(statements: Array<string>): string {
  const matches: Array<string> = statements.filter(
    (statement: string): boolean => {
      return statement.startsWith(`CREATE TABLE "${TABLE}" (`);
    },
  );

  expect(matches).toHaveLength(1);

  return matches[0]!;
}

function foreignKeyStatement(
  statements: Array<string>,
  columnName: string,
): string {
  const name: string = namingStrategy.foreignKeyName(TABLE, [columnName]);
  const matches: Array<string> = statements.filter(
    (statement: string): boolean => {
      return statement.startsWith(
        `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${columnName}")`,
      );
    },
  );

  expect({ columnName, found: matches.length }).toEqual({
    columnName,
    found: 1,
  });

  return matches[0]!;
}

function captured(statements: Array<string>, pattern: RegExp): Array<string> {
  return statements
    .map((statement: string): string | null => {
      const match: RegExpMatchArray | null = statement.match(pattern);
      return match ? match[1]! : null;
    })
    .filter((value: string | null): value is string => {
      return value !== null;
    });
}

describe("AddIncidentAlert1794900000000", () => {
  test("is registered under the name its class carries", () => {
    const migration: AddIncidentAlert1794900000000 =
      new AddIncidentAlert1794900000000();

    expect(migration.name).toBe("AddIncidentAlert1794900000000");
    expect(SchemaMigrations).toContain(AddIncidentAlert1794900000000);
  });

  test("its timestamp keeps it behind every migration registered before it", () => {
    const names: Array<string> = (
      SchemaMigrations as unknown as Array<{ name: string }>
    ).map((registered: { name: string }): string => {
      return registered.name;
    });

    const ownIndex: number = names.indexOf("AddIncidentAlert1794900000000");

    expect(ownIndex).toBeGreaterThan(0);

    const notBehind: Array<string> = names
      .slice(0, ownIndex)
      .filter((className: string): boolean => {
        const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
        return match !== null && Number(match[1]) >= 1794900000000;
      });

    expect(notBehind).toEqual([]);
  });

  /*
   * It was registered last. Pinned as "nothing registered after it is older"
   * rather than "it is last", which the next migration would falsify without
   * going anywhere near this table.
   */
  test("nothing registered after it is older than it", () => {
    const names: Array<string> = (
      SchemaMigrations as unknown as Array<{ name: string }>
    ).map((registered: { name: string }): string => {
      return registered.name;
    });

    const ownIndex: number = names.indexOf("AddIncidentAlert1794900000000");

    expect(ownIndex).toBeGreaterThan(0);

    const olderAfter: Array<string> = names
      .slice(ownIndex + 1)
      .filter((className: string): boolean => {
        const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
        return match === null || Number(match[1]) <= 1794900000000;
      });

    expect(olderAfter).toEqual([]);
  });

  test("touches only the IncidentAlert table and the Project switches", async () => {
    const statements: Array<string> = await recordQueries("up");

    for (const statement of statements) {
      const table: RegExpMatchArray | null = statement.match(
        /^(?:CREATE TABLE|ALTER TABLE|CREATE (?:UNIQUE )?INDEX "[^"]+" ON) "([^"]+)"/,
      );

      expect({ statement, table: table?.[1] }).toEqual({
        statement,
        table: expect.stringMatching(/^(IncidentAlert|Project)$/),
      });
    }

    const projectStatements: Array<string> = statements.filter(
      (statement: string): boolean => {
        return statement.startsWith('ALTER TABLE "Project"');
      },
    );

    // Only the two switches are added to Project - nothing dropped, nothing retyped.
    expect(projectStatements).toHaveLength(PROJECT_SWITCHES.length);
  });

  test("creates IncidentAlert with every column the model persists", async () => {
    const statement: string = createTableStatement(await recordQueries("up"));
    const columns: Array<string> = persistedColumns(IncidentAlert);

    expect(columns).toEqual(
      expect.arrayContaining([
        "_id",
        "projectId",
        "incidentId",
        "alertId",
        "createdByUserId",
        "deletedByUserId",
      ]),
    );

    for (const column of columns) {
      expect({ column, created: statement.includes(`"${column}"`) }).toEqual({
        column,
        created: true,
      });
    }

    expect(statement).toContain('"projectId" uuid NOT NULL');
    expect(statement).toContain('"incidentId" uuid NOT NULL');
    expect(statement).toContain('"alertId" uuid NOT NULL');
    expect(statement).toContain('"createdByUserId" uuid,');
    expect(statement).toContain('"deletedByUserId" uuid,');
    expect(statement).toContain(
      `CONSTRAINT "${namingStrategy.primaryKeyName(TABLE, ["_id"])}" PRIMARY KEY ("_id")`,
    );
  });

  test("a pair can only be linked once: a unique index on (incident, alert, project)", async () => {
    const statements: Array<string> = await recordQueries("up");
    const name: string = namingStrategy.indexName(TABLE, UNIQUE_COLUMNS);

    expect(statements).toContain(
      `CREATE UNIQUE INDEX "${name}" ON "${TABLE}" (${UNIQUE_COLUMNS.map(
        (column: string): string => {
          return `"${column}"`;
        },
      ).join(", ")}) `,
    );
  });

  test.each(["projectId", "incidentId", "alertId"])(
    "indexes %s, which the link lists filter on",
    async (column: string) => {
      const statements: Array<string> = await recordQueries("up");
      const name: string = namingStrategy.indexName(TABLE, [column]);

      expect(statements).toContain(
        `CREATE INDEX "${name}" ON "${TABLE}" ("${column}") `,
      );
    },
  );

  test.each([
    ["projectId", "Project", "CASCADE"],
    ["incidentId", "Incident", "CASCADE"],
    ["alertId", "Alert", "CASCADE"],
    ["createdByUserId", "User", "SET NULL"],
    ["deletedByUserId", "User", "SET NULL"],
  ])(
    "%s references %s and is %s when it is deleted",
    async (column: string, referenced: string, onDelete: string) => {
      expect(foreignKeyStatement(await recordQueries("up"), column)).toContain(
        `REFERENCES "${referenced}"("_id") ON DELETE ${onDelete} ON UPDATE NO ACTION`,
      );
    },
  );

  test.each(PROJECT_SWITCHES)(
    "adds Project.%s, off for every existing project",
    async (column: string) => {
      expect(await recordQueries("up")).toContain(
        `ALTER TABLE "Project" ADD "${column}" boolean NOT NULL DEFAULT false`,
      );
    },
  );

  test("down() removes every constraint up() added, in reverse", async () => {
    const up: Array<string> = await recordQueries("up");
    const down: Array<string> = await recordQueries("down");

    const added: Array<string> = captured(up, /ADD CONSTRAINT "([^"]+)"/);
    const dropped: Array<string> = captured(down, /DROP CONSTRAINT "([^"]+)"/);

    expect(added).toHaveLength(5);
    expect(dropped).toEqual([...added].reverse());
  });

  test("down() drops every index up() created", async () => {
    const up: Array<string> = await recordQueries("up");
    const down: Array<string> = await recordQueries("down");

    const created: Array<string> = captured(
      up,
      /^CREATE (?:UNIQUE )?INDEX "([^"]+)"/,
    );
    const dropped: Array<string> = captured(
      down,
      /^DROP INDEX "public"\."([^"]+)"$/,
    );

    expect(created).toHaveLength(4);
    expect([...dropped].sort()).toEqual([...created].sort());
  });

  test("down() drops the Project switches and then the table, last", async () => {
    const down: Array<string> = await recordQueries("down");

    for (const column of PROJECT_SWITCHES) {
      expect(down).toContain(`ALTER TABLE "Project" DROP COLUMN "${column}"`);
    }

    expect(down[down.length - 1]).toBe(`DROP TABLE "${TABLE}"`);
    expect(
      down.filter((statement: string): boolean => {
        return statement.startsWith("DROP TABLE");
      }),
    ).toEqual([`DROP TABLE "${TABLE}"`]);
  });

  test("down() mirrors up(): every statement kind up() ran has its undo", async () => {
    const up: Array<string> = await recordQueries("up");
    const down: Array<string> = await recordQueries("down");

    const addedColumns: Array<string> = captured(
      up,
      /^ALTER TABLE "Project" ADD "([^"]+)"/,
    );
    const droppedColumns: Array<string> = captured(
      down,
      /^ALTER TABLE "Project" DROP COLUMN "([^"]+)"$/,
    );

    expect(droppedColumns).toEqual([...addedColumns].reverse());
    expect(down).toHaveLength(up.length);
  });
});
