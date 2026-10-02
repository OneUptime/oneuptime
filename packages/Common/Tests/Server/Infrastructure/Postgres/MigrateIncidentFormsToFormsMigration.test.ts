import { AddIncidentForms1796400000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1796400000000-AddIncidentForms";
import {
  LEGACY_PERMISSION_RENAMES,
  MigrateIncidentFormsToForms1797300000000,
  PERMISSION_TABLES,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1797300000000-MigrateIncidentFormsToForms";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import Form from "../../../../Models/DatabaseModels/Form";
import FormSubmission from "../../../../Models/DatabaseModels/FormSubmission";
import {
  FormField,
  FormFieldSource,
  validateFormFields,
} from "../../../../Types/Form/FormField";
import FormTargetType from "../../../../Types/Form/FormTargetType";
import Permission from "../../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DefaultNamingStrategy, QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * Incident forms become Forms (MigrateIncidentFormsToForms1797300000000).
 *
 * The schema half was generated against the models - and verified against
 * a real database: migrated with incident forms in it, checked with the
 * schema drift script, reverted - so its names are TypeORM's. What this
 * pins with a fake QueryRunner:
 *
 *   - its place: registered once, after every migration before it;
 *   - up(): the new tables first, with every column their models persist;
 *     then every incident form copied, with the same id, link key and
 *     version, its questions converted; the submissions copied with them;
 *     the permissions renamed for every team and API key; and only then the
 *     old tables dropped - and only those, the templates keep theirs;
 *   - down(): the reverse, the old tables back (empty), the permissions
 *     renamed back.
 */

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
  "1797300000000-MigrateIncidentFormsToForms.ts",
);

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const FORM_ID: string = "33333333-3333-4333-8333-333333333333";
const SECOND_FORM_ID: string = "44444444-4444-4444-8444-444444444444";
const SHARE_KEY: string = "55555555-5555-4555-8555-555555555555";
const SEVERITY_ID: string = "66666666-6666-4666-8666-666666666666";
const TEMPLATE_ID: string = "77777777-7777-4777-8777-777777777777";
const REGION_ID: string = "88888888-8888-4888-8888-888888888888";
const FOREIGN_FIELD_ID: string = "99999999-9999-4999-8999-999999999999";

interface Recorded {
  statement: string;
  parameters: Array<unknown> | undefined;
}

// The incident forms in the database, as the SELECT returns them.
const LEGACY_FORMS: Array<Record<string, unknown>> = [
  {
    _id: FORM_ID,
    createdAt: new Date("2026-09-01T10:00:00.000Z"),
    updatedAt: new Date("2026-09-02T10:00:00.000Z"),
    version: 4,
    projectId: PROJECT_ID,
    name: "Report a Problem",
    description: "Tell us what is broken.",
    isEnabled: true,
    shareKey: SHARE_KEY,
    incidentSeverityId: SEVERITY_ID,
    allowReporterToChooseSeverity: true,
    incidentTemplateId: TEMPLATE_ID,
    descriptionSetting: "Required",
    customFieldSettings: { region: "Optional", other: "Required" },
    isReporterDetailsRequired: false,
    successMessage: "Thanks",
    ipWhitelist: "10.0.0.0/8",
    createdByUserId: null,
  },
  {
    _id: SECOND_FORM_ID,
    createdAt: new Date("2026-09-03T10:00:00.000Z"),
    updatedAt: new Date("2026-09-03T10:00:00.000Z"),
    version: 1,
    projectId: OTHER_PROJECT_ID,
    name: "Security",
    description: null,
    isEnabled: false,
    shareKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    incidentSeverityId: null,
    allowReporterToChooseSeverity: false,
    incidentTemplateId: null,
    descriptionSetting: "Hidden",
    customFieldSettings: null,
    isReporterDetailsRequired: true,
    successMessage: null,
    ipWhitelist: null,
    createdByUserId: null,
  },
];

// The incident custom fields of those projects.
const LEGACY_FIELDS: Array<Record<string, unknown>> = [
  {
    _id: REGION_ID,
    projectId: PROJECT_ID,
    name: "Region",
    description: "Where it is",
    variableKey: "region",
    sortOrder: 1,
  },
  // Another project's field with the same key: never asked by the first form.
  {
    _id: FOREIGN_FIELD_ID,
    projectId: OTHER_PROJECT_ID,
    name: "Region",
    variableKey: "region",
    sortOrder: 1,
  },
];

async function recordQueries(
  direction: "up" | "down",
  data: {
    forms?: Array<Record<string, unknown>>;
    fields?: Array<Record<string, unknown>>;
  } = {},
): Promise<Array<Recorded>> {
  const statements: Array<Recorded> = [];

  const queryRunner: QueryRunner = {
    query: async (
      statement: string,
      parameters?: Array<unknown>,
    ): Promise<unknown> => {
      statements.push({ statement, parameters });

      if (statement.startsWith('SELECT "_id", "createdAt"')) {
        return data.forms || [];
      }

      if (statement.includes('FROM "IncidentCustomField"')) {
        const projectIds: Array<string> = (parameters?.[0] ||
          []) as Array<string>;

        return (data.fields || []).filter(
          (field: Record<string, unknown>): boolean => {
            return projectIds.includes(String(field["projectId"]));
          },
        );
      }

      return [];
    },
  } as unknown as QueryRunner;

  await new MigrateIncidentFormsToForms1797300000000()[direction](queryRunner);

  return statements;
}

function statementsOf(recorded: Array<Recorded>): Array<string> {
  return recorded.map((entry: Recorded): string => {
    return entry.statement;
  });
}

function indexOf(recorded: Array<Recorded>, prefix: string): number {
  return statementsOf(recorded).findIndex((statement: string): boolean => {
    return statement.startsWith(prefix);
  });
}

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

function formInserts(recorded: Array<Recorded>): Array<Recorded> {
  return recorded.filter((entry: Recorded): boolean => {
    return entry.statement.startsWith('INSERT INTO "Form" (');
  });
}

describe("MigrateIncidentFormsToForms migration - identity and registration", () => {
  const registeredNames: Array<string> = (
    SchemaMigrations as unknown as Array<{ name: string }>
  ).map((migration: { name: string }): string => {
    return migration.name;
  });

  test("lives at its round stamp, with a class and name that carry it", () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
    expect(new MigrateIncidentFormsToForms1797300000000().name).toBe(
      "MigrateIncidentFormsToForms1797300000000",
    );
  });

  test("is registered exactly once, after the migration that made incident forms", () => {
    const index: number = registeredNames.indexOf(
      "MigrateIncidentFormsToForms1797300000000",
    );

    expect(index).toBeGreaterThan(-1);
    expect(
      registeredNames.filter((name: string): boolean => {
        return name === "MigrateIncidentFormsToForms1797300000000";
      }),
    ).toHaveLength(1);
    expect(index).toBeGreaterThan(
      registeredNames.indexOf(new AddIncidentForms1796400000000().name),
    );
  });

  test("its timestamp is newer than every migration registered before it", () => {
    const index: number = registeredNames.indexOf(
      "MigrateIncidentFormsToForms1797300000000",
    );

    for (const name of registeredNames.slice(0, index)) {
      const match: RegExpMatchArray | null = name.match(/(\d{13})$/);

      if (match) {
        expect({ name, older: Number(match[1]) < 1797300000000 }).toEqual({
          name,
          older: true,
        });
      }
    }
  });
});

describe("MigrateIncidentFormsToForms migration - up(): the schema", () => {
  test("creates Form and FormSubmission with every column their models persist", async () => {
    const recorded: Array<Recorded> = await recordQueries("up");

    for (const [table, modelType] of [
      ["Form", Form],
      ["FormSubmission", FormSubmission],
    ] as Array<[string, unknown]>) {
      const create: string | undefined = statementsOf(recorded).find(
        (statement: string): boolean => {
          return statement.startsWith(`CREATE TABLE "${table}" (`);
        },
      );

      expect(create).toBeDefined();

      for (const column of persistedColumns(modelType)) {
        expect({ table, column, created: create!.includes(`"${column}"`) }).toEqual(
          { table, column, created: true },
        );
      }
    }
  });

  test("the link key is unique, what a form creates defaults to Incident, and the primary keys carry TypeORM's names", async () => {
    const create: string = statementsOf(await recordQueries("up")).find(
      (statement: string): boolean => {
        return statement.startsWith('CREATE TABLE "Form" (');
      },
    )!;

    const naming: DefaultNamingStrategy = new DefaultNamingStrategy();

    expect(create).toContain(
      `CONSTRAINT "${naming.uniqueConstraintName("Form", ["shareKey"])}" UNIQUE ("shareKey")`,
    );
    expect(create).toContain(
      `CONSTRAINT "${naming.primaryKeyName("Form", ["_id"])}" PRIMARY KEY ("_id")`,
    );
    expect(create).toContain(`"targetType" character varying(100) NOT NULL DEFAULT 'Incident'`);
    expect(create).toContain('"isEnabled" boolean NOT NULL DEFAULT true');
    expect(create).toContain('"fields" jsonb');
    expect(create).toContain('"targetSettings" jsonb');
  });

  test.each([
    ["Form", "projectId", "Project", "CASCADE"],
    ["Form", "createdByUserId", "User", "SET NULL"],
    ["Form", "deletedByUserId", "User", "SET NULL"],
    ["FormSubmission", "projectId", "Project", "CASCADE"],
    ["FormSubmission", "formId", "Form", "CASCADE"],
    ["FormSubmission", "incidentId", "Incident", "SET NULL"],
    ["FormSubmission", "scheduledMaintenanceId", "ScheduledMaintenance", "SET NULL"],
  ])(
    "%s.%s points at %s, %s on delete, under TypeORM's own name",
    async (table: string, column: string, referenced: string, onDelete: string) => {
      const name: string = new DefaultNamingStrategy().foreignKeyName(table, [
        column,
      ]);

      expect(statementsOf(await recordQueries("up"))).toContain(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${column}") REFERENCES "${referenced}"("_id") ON DELETE ${onDelete} ON UPDATE NO ACTION`,
      );
    },
  );

  test("drops the incident form tables last, after the copies - and nothing else", async () => {
    const recorded: Array<Recorded> = await recordQueries("up", {
      forms: LEGACY_FORMS,
      fields: LEGACY_FIELDS,
    });
    const statements: Array<string> = statementsOf(recorded);

    const drops: Array<string> = statements.filter((statement: string) => {
      return statement.startsWith("DROP TABLE");
    });

    expect(drops).toEqual([
      'DROP TABLE "IncidentFormSubmission"',
      'DROP TABLE "IncidentForm"',
    ]);

    const firstDrop: number = statements.findIndex((statement: string) => {
      return statement.startsWith('ALTER TABLE "IncidentFormSubmission" DROP');
    });

    expect(firstDrop).toBeGreaterThan(
      indexOf(recorded, 'INSERT INTO "FormSubmission"'),
    );
    expect(firstDrop).toBeGreaterThan(indexOf(recorded, "UPDATE"));

    // The templates keep their custom field settings.
    expect(
      statements.some((statement: string): boolean => {
        return statement.includes('"IncidentTemplate"');
      }),
    ).toBe(false);
  });
});

describe("MigrateIncidentFormsToForms migration - up(): the data", () => {
  test("with no incident forms, reads no custom fields and inserts no form", async () => {
    const recorded: Array<Recorded> = await recordQueries("up");

    expect(formInserts(recorded)).toEqual([]);
    expect(
      statementsOf(recorded).some((statement: string): boolean => {
        return statement.includes('FROM "IncidentCustomField"');
      }),
    ).toBe(false);
  });

  test("copies every form with its id, link key, dates, version and settings, as an incident form", async () => {
    const inserts: Array<Recorded> = formInserts(
      await recordQueries("up", { forms: LEGACY_FORMS, fields: LEGACY_FIELDS }),
    );

    expect(inserts).toHaveLength(2);

    const [first]: Array<Recorded> = inserts;
    const parameters: Array<unknown> = first!.parameters!;

    expect(first!.statement).toContain(
      '("_id", "createdAt", "updatedAt", "version", "projectId", "name", "description", "isEnabled", "shareKey", "targetType", "fields", "targetSettings", "successMessage", "ipWhitelist", "createdByUserId")',
    );
    expect(parameters.slice(0, 10)).toEqual([
      FORM_ID,
      LEGACY_FORMS[0]!["createdAt"],
      LEGACY_FORMS[0]!["updatedAt"],
      4,
      PROJECT_ID,
      "Report a Problem",
      "Tell us what is broken.",
      true,
      SHARE_KEY,
      FormTargetType.Incident,
    ]);
    expect(JSON.parse(parameters[11] as string)).toEqual({
      incidentSeverityId: SEVERITY_ID,
      incidentTemplateId: TEMPLATE_ID,
    });
    expect(parameters.slice(12)).toEqual(["Thanks", "10.0.0.0/8", null]);
  });

  test("converts the questions: required description, the severity, the project's own custom fields, optional submitter", async () => {
    const [first, second]: Array<Recorded> = formInserts(
      await recordQueries("up", { forms: LEGACY_FORMS, fields: LEGACY_FIELDS }),
    );

    const fields: Array<FormField> = JSON.parse(
      first!.parameters![10] as string,
    );

    expect(
      fields.map((field: FormField): string => {
        const what: string =
          field.targetField || field.submitterField || field.customFieldId || "";
        return `${field.source}:${what}:${field.isRequired}`;
      }),
    ).toEqual([
      "TargetField:title:true",
      "TargetField:description:true",
      "TargetField:incidentSeverityId:false",
      `TargetCustomField:${REGION_ID}:false`,
      "Submitter:Name:false",
      "Submitter:Email:false",
    ]);
    expect(
      validateFormFields({ value: fields, targetType: FormTargetType.Incident }),
    ).toBeNull();

    // The second form hid its description, and required who reported.
    const secondFields: Array<FormField> = JSON.parse(
      second!.parameters![10] as string,
    );

    expect(
      secondFields.map((field: FormField): string => {
        return `${field.targetField || field.submitterField}:${field.isRequired}`;
      }),
    ).toEqual(["title:true", "Name:true", "Email:true"]);
    expect(
      secondFields.some((field: FormField): boolean => {
        return field.source === FormFieldSource.TargetCustomField;
      }),
    ).toBe(false);
  });

  test("reads the custom fields of the forms' projects only, once", async () => {
    const recorded: Array<Recorded> = await recordQueries("up", {
      forms: LEGACY_FORMS,
      fields: LEGACY_FIELDS,
    });

    const reads: Array<Recorded> = recorded.filter((entry: Recorded) => {
      return entry.statement.includes('FROM "IncidentCustomField"');
    });

    expect(reads).toHaveLength(1);
    expect((reads[0]!.parameters![0] as Array<string>).sort()).toEqual(
      [OTHER_PROJECT_ID, PROJECT_ID].sort(),
    );
  });

  test("copies the submissions in one statement, with no answers, as incident submissions", async () => {
    const recorded: Array<Recorded> = await recordQueries("up", {
      forms: LEGACY_FORMS,
    });

    const copies: Array<Recorded> = recorded.filter((entry: Recorded) => {
      return entry.statement.startsWith('INSERT INTO "FormSubmission"');
    });

    expect(copies).toHaveLength(1);
    expect(copies[0]!.statement).toContain('FROM "IncidentFormSubmission"');
    expect(copies[0]!.statement).toContain('"incidentFormId"');
    expect(copies[0]!.statement).toContain('"reporterName"');
    expect(copies[0]!.statement).toContain('"reporterEmail"');
    expect(copies[0]!.statement).toContain("'[]'");
    expect(copies[0]!.parameters).toEqual([FormTargetType.Incident]);
  });

  test("renames every incident form permission to its form one, for teams and API keys", async () => {
    const recorded: Array<Recorded> = await recordQueries("up");

    const renames: Array<[string, unknown, unknown]> = recorded
      .filter((entry: Recorded): boolean => {
        return entry.statement.startsWith("UPDATE ");
      })
      .map((entry: Recorded): [string, unknown, unknown] => {
        return [
          entry.statement.match(/UPDATE "([^"]+)"/)![1]!,
          entry.parameters![0],
          entry.parameters![1],
        ];
      });

    const expected: Array<[string, unknown, unknown]> = [];

    for (const table of PERMISSION_TABLES) {
      for (const [from, to] of LEGACY_PERMISSION_RENAMES) {
        expected.push([table, from, to]);
      }
    }

    expect(renames).toEqual(expected);
    expect(PERMISSION_TABLES).toEqual(["TeamPermission", "ApiKeyPermission"]);
  });

  test("renames to permissions that exist, from ones that no longer do", () => {
    for (const [from, to] of LEGACY_PERMISSION_RENAMES) {
      expect((Permission as unknown as Record<string, unknown>)[from]).toBeUndefined();
      expect((Permission as unknown as Record<string, unknown>)[to]).toBe(to);
    }

    expect(LEGACY_PERMISSION_RENAMES).toHaveLength(6);
  });
});

describe("MigrateIncidentFormsToForms migration - the old migration's tables", () => {
  /*
   * up() reads incident forms and their submissions by column name. Those
   * tables were created by AddIncidentForms1796400000000, which every
   * install has run: every column read must be one it creates.
   */
  test("every incident form column the copy reads is one the old migration created", async () => {
    const created: Array<string> = [];

    await new AddIncidentForms1796400000000().up({
      query: async (statement: string): Promise<void> => {
        created.push(statement);
      },
    } as unknown as QueryRunner);

    const formTable: string = created.find((statement: string) => {
      return statement.startsWith('CREATE TABLE "IncidentForm" (');
    })!;
    const submissionTable: string = created.find((statement: string) => {
      return statement.startsWith('CREATE TABLE "IncidentFormSubmission" (');
    })!;

    const recorded: Array<Recorded> = await recordQueries("up", {
      forms: LEGACY_FORMS,
    });

    const formSelect: string = statementsOf(recorded).find(
      (statement: string): boolean => {
        return statement.startsWith('SELECT "_id", "createdAt"');
      },
    )!;

    for (const column of formSelect
      .slice(0, formSelect.indexOf(" FROM "))
      .match(/"([A-Za-z_]+)"/g)!) {
      expect({ column, created: formTable.includes(column) }).toEqual({
        column,
        created: true,
      });
    }

    const submissionCopy: string = statementsOf(recorded).find(
      (statement: string): boolean => {
        return statement.startsWith('INSERT INTO "FormSubmission"');
      },
    )!;

    const selected: string = submissionCopy.slice(
      submissionCopy.indexOf("SELECT"),
      submissionCopy.indexOf(" FROM "),
    );

    for (const column of selected.match(/"([A-Za-z_]+)"/g)!) {
      expect({ column, created: submissionTable.includes(column) }).toEqual({
        column,
        created: true,
      });
    }
  });
});

describe("MigrateIncidentFormsToForms migration - down()", () => {
  test("brings the incident form tables back before dropping the forms", async () => {
    const recorded: Array<Recorded> = await recordQueries("down");
    const statements: Array<string> = statementsOf(recorded);

    expect(indexOf(recorded, 'CREATE TABLE "IncidentForm" (')).toBeGreaterThan(-1);
    expect(
      indexOf(recorded, 'CREATE TABLE "IncidentFormSubmission" ('),
    ).toBeGreaterThan(-1);
    expect(
      statements.filter((statement: string): boolean => {
        return statement.startsWith("DROP TABLE");
      }),
    ).toEqual(['DROP TABLE "FormSubmission"', 'DROP TABLE "Form"']);
    expect(indexOf(recorded, 'CREATE TABLE "IncidentForm" (')).toBeLessThan(
      indexOf(recorded, 'DROP TABLE "Form"'),
    );
  });

  test("renames the permissions back", async () => {
    const renames: Array<[unknown, unknown]> = (await recordQueries("down"))
      .filter((entry: Recorded): boolean => {
        return entry.statement.startsWith("UPDATE ");
      })
      .map((entry: Recorded): [unknown, unknown] => {
        return [entry.parameters![0], entry.parameters![1]];
      });

    expect(renames).toHaveLength(
      LEGACY_PERMISSION_RENAMES.length * PERMISSION_TABLES.length,
    );
    expect(renames[0]).toEqual(LEGACY_PERMISSION_RENAMES[0]);
    expect(
      (await recordQueries("down"))
        .filter((entry: Recorded): boolean => {
          return entry.statement.startsWith("UPDATE ");
        })[0]!
        .statement,
    ).toBe('UPDATE "TeamPermission" SET "permission" = $1 WHERE "permission" = $2');
  });

  test("drops every constraint and index up() created", async () => {
    const up: Array<string> = statementsOf(await recordQueries("up"));
    const down: Array<string> = statementsOf(await recordQueries("down"));

    const createdConstraints: Array<string> = up
      .map((statement: string): string | null => {
        const match: RegExpMatchArray | null = statement.match(
          /^ALTER TABLE "(?:Form|FormSubmission)" ADD CONSTRAINT "([^"]+)"/,
        );
        return match ? match[1]! : null;
      })
      .filter((name: string | null): name is string => {
        return name !== null;
      });

    const createdIndexes: Array<string> = up
      .map((statement: string): string | null => {
        const match: RegExpMatchArray | null = statement.match(
          /^CREATE INDEX "([^"]+)" ON "(?:Form|FormSubmission)"/,
        );
        return match ? match[1]! : null;
      })
      .filter((name: string | null): name is string => {
        return name !== null;
      });

    expect(createdConstraints).toHaveLength(7);
    expect(createdIndexes).toHaveLength(5);

    for (const name of createdConstraints) {
      expect(down.some((statement: string): boolean => {
        return statement.includes(`DROP CONSTRAINT "${name}"`);
      })).toBe(true);
    }

    for (const name of createdIndexes) {
      expect(down).toContain(`DROP INDEX "public"."${name}"`);
    }
  });
});
