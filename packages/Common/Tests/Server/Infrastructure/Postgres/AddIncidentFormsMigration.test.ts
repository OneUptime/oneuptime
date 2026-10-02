import { AddIncidentForms1796400000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1796400000000-AddIncidentForms";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DefaultNamingStrategy, QueryRunner } from "typeorm";

/*
 * The schema half of incident forms and per-template custom field settings.
 *
 * The migration was generated against the models, so its names are TypeORM's
 * by construction. What this pins is that it STAYS the migration for them:
 * both tables are created with every column their model persists, a form's
 * link key is unique across projects and never null, a form outlives the
 * severity and template it points at (their deletion clears the column),
 * submissions go with their form and outlive their incident, every
 * constraint and index carries TypeORM's own name - a hand edit that renamed
 * one would pass review and then fail the Schema Drift job - existing
 * templates get a nullable settings column with no default, so none of them
 * changes, and down() undoes up() in reverse.
 *
 * Fake QueryRunner only; generating the migration against a fully migrated
 * database, applying it, reverting it and generating again to "No changes"
 * is how the schema half was verified.
 */

const OWN_CLASS_NAME: string = "AddIncidentForms1796400000000";
const OWN_TIMESTAMP: number = 1796400000000;

const FORM: string = "IncidentForm";
const SUBMISSION: string = "IncidentFormSubmission";
const TEMPLATE: string = "IncidentTemplate";

const MIGRATION_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
  "1796400000000-AddIncidentForms.ts",
);

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

const registeredNames: Array<string> = (
  SchemaMigrations as unknown as Array<{ name: string }>
).map((migration: { name: string }): string => {
  return migration.name;
});

function timestampOfClassName(className: string): number | null {
  const match: RegExpMatchArray | null = className.match(/(\d{13})$/);
  return match ? Number(match[1]) : null;
}

async function recordQueries(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<void> => {
      statements.push(statement);
    },
  } as unknown as QueryRunner;

  await new AddIncidentForms1796400000000()[direction](queryRunner);

  return statements;
}

/*
 * The columns the incident forms models persisted, inherited ones included.
 * The models are gone - incident forms became Form and FormSubmission, and
 * MigrateIncidentFormsToForms1797300000000 copies these tables over and
 * drops them - so they are written out: this migration must keep creating
 * every column that one reads.
 */
const INCIDENT_FORM_COLUMNS: Array<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "version",
  "projectId",
  "name",
  "description",
  "isEnabled",
  "shareKey",
  "incidentSeverityId",
  "allowReporterToChooseSeverity",
  "incidentTemplateId",
  "descriptionSetting",
  "customFieldSettings",
  "isReporterDetailsRequired",
  "successMessage",
  "ipWhitelist",
  "createdByUserId",
  "deletedByUserId",
];

const INCIDENT_FORM_SUBMISSION_COLUMNS: Array<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "version",
  "projectId",
  "incidentFormId",
  "incidentId",
  "reporterName",
  "reporterEmail",
];

function createTableStatement(
  statements: Array<string>,
  table: string,
): string {
  const matches: Array<string> = statements.filter(
    (statement: string): boolean => {
      return statement.startsWith(`CREATE TABLE "${table}" (`);
    },
  );

  expect(matches).toHaveLength(1);

  return matches[0]!;
}

function foreignKeyStatement(
  statements: Array<string>,
  table: string,
  columnName: string,
): string {
  const name: string = namingStrategy.foreignKeyName(table, [columnName]);
  const matches: Array<string> = statements.filter(
    (statement: string): boolean => {
      return statement.startsWith(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${columnName}")`,
      );
    },
  );

  expect({ table, columnName, found: matches.length }).toEqual({
    table,
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

describe("AddIncidentForms migration - identity and registration", () => {
  test("lives at its round stamp, with a class and name that carry it", () => {
    const source: string = fs.readFileSync(MIGRATION_PATH, "utf8");

    expect(source).toContain(`export class ${OWN_CLASS_NAME}`);
    expect(source).toContain(`public name: string = "${OWN_CLASS_NAME}";`);
    expect(new AddIncidentForms1796400000000().name).toBe(OWN_CLASS_NAME);
    expect(timestampOfClassName(OWN_CLASS_NAME)).toBe(OWN_TIMESTAMP);
  });

  test("is registered exactly once", () => {
    expect(SchemaMigrations).toContain(AddIncidentForms1796400000000);
    expect(
      registeredNames.filter((name: string): boolean => {
        return name === OWN_CLASS_NAME;
      }),
    ).toHaveLength(1);
  });

  test("its timestamp keeps it behind every migration registered before it", () => {
    const ownIndex: number = registeredNames.indexOf(OWN_CLASS_NAME);

    expect(ownIndex).toBeGreaterThan(0);

    const notBehind: Array<string> = registeredNames
      .slice(0, ownIndex)
      .filter((className: string): boolean => {
        const timestamp: number | null = timestampOfClassName(className);
        return timestamp !== null && timestamp >= OWN_TIMESTAMP;
      });

    expect(notBehind).toEqual([]);
  });

  /*
   * It was registered last. Pinned as "nothing registered after it is older"
   * rather than "it is last", which the next migration would falsify without
   * going anywhere near these tables.
   */
  test("nothing registered after it is older than it", () => {
    const ownIndex: number = registeredNames.indexOf(OWN_CLASS_NAME);

    const olderAfter: Array<string> = registeredNames
      .slice(ownIndex + 1)
      .filter((className: string): boolean => {
        const timestamp: number | null = timestampOfClassName(className);
        return timestamp === null || timestamp <= OWN_TIMESTAMP;
      });

    expect(olderAfter).toEqual([]);
  });
});

describe("AddIncidentForms migration - up()", () => {
  test("touches only the two new tables and adds one column to IncidentTemplate", async () => {
    const statements: Array<string> = await recordQueries("up");

    for (const statement of statements) {
      const table: RegExpMatchArray | null = statement.match(
        /^(?:CREATE TABLE|ALTER TABLE|CREATE (?:UNIQUE )?INDEX "[^"]+" ON) "([^"]+)"/,
      );

      expect({ statement, table: table?.[1] }).toEqual({
        statement,
        table: expect.stringMatching(
          /^(IncidentForm|IncidentFormSubmission|IncidentTemplate)$/,
        ),
      });
    }

    expect(
      statements.filter((statement: string): boolean => {
        return statement.startsWith(`ALTER TABLE "${TEMPLATE}"`);
      }),
    ).toEqual([`ALTER TABLE "${TEMPLATE}" ADD "customFieldSettings" jsonb`]);
  });

  test("writes no data: no row changes, existing templates keep asking what they asked", async () => {
    for (const statement of await recordQueries("up")) {
      expect(statement).not.toMatch(/^\s*(UPDATE|INSERT|DELETE)\b/i);
    }
  });

  test("creates IncidentForm with every column incident forms persisted", async () => {
    const statement: string = createTableStatement(
      await recordQueries("up"),
      FORM,
    );

    for (const column of INCIDENT_FORM_COLUMNS) {
      expect({ column, created: statement.includes(`"${column}"`) }).toEqual({
        column,
        created: true,
      });
    }
  });

  test.each([
    ['"projectId" uuid NOT NULL'],
    ['"name" character varying(100) NOT NULL'],
    ['"description" text,'],
    ['"isEnabled" boolean NOT NULL DEFAULT true'],
    ['"shareKey" uuid NOT NULL'],
    // Required by the app, nullable here: deleting the severity clears it.
    ['"incidentSeverityId" uuid,'],
    ['"allowReporterToChooseSeverity" boolean NOT NULL DEFAULT false'],
    ['"incidentTemplateId" uuid,'],
    [
      `"descriptionSetting" character varying(100) NOT NULL DEFAULT 'Optional'`,
    ],
    ['"customFieldSettings" jsonb,'],
    ['"isReporterDetailsRequired" boolean NOT NULL DEFAULT true'],
    ['"successMessage" text,'],
    ['"ipWhitelist" text,'],
    ['"createdByUserId" uuid,'],
    ['"deletedByUserId" uuid,'],
  ])("IncidentForm declares %s", async (fragment: string) => {
    expect(createTableStatement(await recordQueries("up"), FORM)).toContain(
      fragment,
    );
  });

  test("a form's link key is unique across every project, under TypeORM's own constraint name", async () => {
    const statement: string = createTableStatement(
      await recordQueries("up"),
      FORM,
    );

    expect(statement).toContain(
      `CONSTRAINT "${namingStrategy.uniqueConstraintName(FORM, [
        "shareKey",
      ])}" UNIQUE ("shareKey")`,
    );
    expect(statement).toContain(
      `CONSTRAINT "${namingStrategy.primaryKeyName(FORM, ["_id"])}" PRIMARY KEY ("_id")`,
    );
  });

  test("the unique constraint is the key's only index: nothing else indexes it", async () => {
    for (const statement of await recordQueries("up")) {
      if (statement.startsWith("CREATE")) {
        expect(statement).not.toMatch(/INDEX .*\("shareKey"\)/);
      }
    }
  });

  test("creates IncidentFormSubmission with every column incident forms persisted", async () => {
    const statement: string = createTableStatement(
      await recordQueries("up"),
      SUBMISSION,
    );

    for (const column of INCIDENT_FORM_SUBMISSION_COLUMNS) {
      expect({ column, created: statement.includes(`"${column}"`) }).toEqual({
        column,
        created: true,
      });
    }

    expect(statement).toContain('"projectId" uuid NOT NULL');
    expect(statement).toContain('"incidentFormId" uuid NOT NULL');
    expect(statement).toContain('"incidentId" uuid,');
    expect(statement).toContain('"reporterName" character varying(100),');
    expect(statement).toContain('"reporterEmail" character varying(100),');
    expect(statement).not.toContain("createdByUserId");
    expect(statement).not.toContain("deletedByUserId");
    expect(statement).toContain(
      `CONSTRAINT "${namingStrategy.primaryKeyName(SUBMISSION, ["_id"])}" PRIMARY KEY ("_id")`,
    );
  });

  test.each([
    [FORM, "projectId"],
    [FORM, "incidentSeverityId"],
    [FORM, "incidentTemplateId"],
    [SUBMISSION, "projectId"],
    [SUBMISSION, "incidentFormId"],
    [SUBMISSION, "incidentId"],
  ])("indexes %s.%s", async (table: string, column: string) => {
    expect(await recordQueries("up")).toContain(
      `CREATE INDEX "${namingStrategy.indexName(table, [
        column,
      ])}" ON "${table}" ("${column}") `,
    );
  });

  test.each([
    [FORM, "projectId", "Project", "CASCADE"],
    [FORM, "incidentSeverityId", "IncidentSeverity", "SET NULL"],
    [FORM, "incidentTemplateId", "IncidentTemplate", "SET NULL"],
    [FORM, "createdByUserId", "User", "SET NULL"],
    [FORM, "deletedByUserId", "User", "SET NULL"],
    [SUBMISSION, "projectId", "Project", "CASCADE"],
    [SUBMISSION, "incidentFormId", "IncidentForm", "CASCADE"],
    [SUBMISSION, "incidentId", "Incident", "SET NULL"],
  ])(
    "%s.%s references %s and is %s when it is deleted",
    async (
      table: string,
      column: string,
      referenced: string,
      onDelete: string,
    ) => {
      expect(
        foreignKeyStatement(await recordQueries("up"), table, column),
      ).toContain(
        `REFERENCES "${referenced}"("_id") ON DELETE ${onDelete} ON UPDATE NO ACTION`,
      );
    },
  );

  test("adds nothing else: eight foreign keys, six indexes, two tables, one column", async () => {
    const up: Array<string> = await recordQueries("up");

    expect(captured(up, /ADD CONSTRAINT "([^"]+)"/)).toHaveLength(8);
    expect(captured(up, /^CREATE (?:UNIQUE )?INDEX "([^"]+)"/)).toHaveLength(6);
    expect(captured(up, /^CREATE TABLE "([^"]+)"/)).toEqual([FORM, SUBMISSION]);
    expect(captured(up, /^ALTER TABLE "[^"]+" ADD "([^"]+)"/)).toEqual([
      "customFieldSettings",
    ]);
  });
});

describe("AddIncidentForms migration - down()", () => {
  test("removes every constraint up() added, in reverse", async () => {
    const added: Array<string> = captured(
      await recordQueries("up"),
      /ADD CONSTRAINT "([^"]+)"/,
    );
    const dropped: Array<string> = captured(
      await recordQueries("down"),
      /DROP CONSTRAINT "([^"]+)"/,
    );

    expect(dropped).toEqual([...added].reverse());
  });

  test("drops every index up() created", async () => {
    const created: Array<string> = captured(
      await recordQueries("up"),
      /^CREATE (?:UNIQUE )?INDEX "([^"]+)"/,
    );
    const dropped: Array<string> = captured(
      await recordQueries("down"),
      /^DROP INDEX "public"\."([^"]+)"$/,
    );

    expect([...dropped].sort()).toEqual([...created].sort());
  });

  test("drops the template column, then the submissions, then the forms they point at", async () => {
    const down: Array<string> = await recordQueries("down");

    expect(down).toContain(
      `ALTER TABLE "${TEMPLATE}" DROP COLUMN "customFieldSettings"`,
    );
    expect(
      down.filter((statement: string): boolean => {
        return statement.startsWith("DROP TABLE");
      }),
    ).toEqual([`DROP TABLE "${SUBMISSION}"`, `DROP TABLE "${FORM}"`]);
    expect(down[down.length - 1]).toBe(`DROP TABLE "${FORM}"`);
  });

  test("mirrors up() one statement for one", async () => {
    const up: Array<string> = await recordQueries("up");
    const down: Array<string> = await recordQueries("down");

    expect(down).toHaveLength(up.length);
  });
});
