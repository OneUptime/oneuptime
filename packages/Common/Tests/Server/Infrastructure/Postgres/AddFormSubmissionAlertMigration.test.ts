import FormSubmission from "../../../../Models/DatabaseModels/FormSubmission";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddFormSubmissionAlert1809187540760 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187540760-AddFormSubmissionAlert";
import { AddFormSubmissionAlertIndexAndKey1809187540770 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187540770-AddFormSubmissionAlertIndexAndKey";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A form can create an alert (#10760), and its submission links the alert
 * it created in "FormSubmission"."alertId", as "incidentId" and
 * "scheduledMaintenanceId" link what the other targets create.
 *
 * Two migrations, generated against the models and checked with the schema
 * drift script: the first adds the nullable column, so no row is rewritten;
 * the second builds its index and its key to "Alert" online, outside a
 * transaction - "Alert" is written whenever a monitor opens, changes or
 * resolves an alert, and a key added in a transaction would hold it. The
 * names are TypeORM's, so the drift check finds nothing to change.
 */

const naming: DefaultNamingStrategy = new DefaultNamingStrategy();
const INDEX: string = naming.indexName("FormSubmission", ["alertId"]);
const FOREIGN_KEY: string = naming.foreignKeyName(
  "FormSubmission",
  ["alertId"],
  "Alert",
  ["_id"],
);

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];

  for (const step of ["createIndex", "addForeignKey", "dropIndex"] as const) {
    jest.spyOn(OnlineDdl, step).mockImplementation((async (
      _runner: QueryRunner,
      statement: string,
    ) => {
      statements.push(`online: ${statement}`);
    }) as never);
  }

  await run({
    isTransactionActive: false,
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
}

function migrationNames(): Array<string> {
  return SchemaMigrations.map((migration: unknown): string => {
    return (migration as { name: string }).name;
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AddFormSubmissionAlert1809187540760", () => {
  test("adds the alert's id - and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddFormSubmissionAlert1809187540760().up(runner);
      }),
    ).toEqual([`ALTER TABLE "FormSubmission" ADD "alertId" uuid`]);
  });

  test("never rewrites the table: the column is nullable, with no default", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddFormSubmissionAlert1809187540760().up(runner);
      },
    );

    for (const statement of statements) {
      expect(statement).not.toContain("DEFAULT");
      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toMatch(/^UPDATE/);
    }
  });

  test("down() takes back exactly what up() added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddFormSubmissionAlert1809187540760().down(runner);
      }),
    ).toEqual([`ALTER TABLE "FormSubmission" DROP COLUMN "alertId"`]);
  });

  test("the column is the model's: a nullable uuid", () => {
    const column: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
      .columns.filter((args: ColumnMetadataArgs) => {
        return (
          args.target === FormSubmission && args.propertyName === "alertId"
        );
      })
      .pop();

    expect(column?.options).toMatchObject({ type: "uuid", nullable: true });
  });
});

describe("AddFormSubmissionAlertIndexAndKey1809187540770", () => {
  test("builds the column's index and its key to Alert online, outside a transaction", async () => {
    const migration: AddFormSubmissionAlertIndexAndKey1809187540770 =
      new AddFormSubmissionAlertIndexAndKey1809187540770();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([
      `online: CREATE INDEX "${INDEX}" ON "FormSubmission" ("alertId") `,
      `online: ALTER TABLE "FormSubmission" ADD CONSTRAINT "${FOREIGN_KEY}" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    ]);
  });

  test("a deleted alert keeps its submission: the key sets the id to null", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddFormSubmissionAlertIndexAndKey1809187540770().up(runner);
      },
    );

    expect(statements[1]).toContain("ON DELETE SET NULL");
    expect(statements.join("\n")).not.toContain("CASCADE");
  });

  test("down() takes the key, then the index, away", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddFormSubmissionAlertIndexAndKey1809187540770().down(
          runner,
        );
      }),
    ).toEqual([
      `ALTER TABLE "FormSubmission" DROP CONSTRAINT "${FOREIGN_KEY}"`,
      `online: DROP INDEX "public"."${INDEX}"`,
    ]);
  });

  test("the index and the key are the model's", () => {
    const indexed: boolean = getMetadataArgsStorage().indices.some(
      (args: IndexMetadataArgs): boolean => {
        return (
          args.target === FormSubmission &&
          JSON.stringify(args.columns || []).includes("alertId")
        );
      },
    );
    const relation: RelationMetadataArgs | undefined = getMetadataArgsStorage()
      .relations.filter((args: RelationMetadataArgs) => {
        return args.target === FormSubmission && args.propertyName === "alert";
      })
      .pop();

    expect(indexed).toBe(true);
    expect(relation?.options).toMatchObject({
      onDelete: "SET NULL",
      nullable: true,
    });
  });
});

describe("both migrations", () => {
  test("are registered once each, the column's first, after every migration before them", () => {
    const names: Array<string> = migrationNames();
    const column: number = names.indexOf("AddFormSubmissionAlert1809187540760");
    const keys: number = names.indexOf(
      "AddFormSubmissionAlertIndexAndKey1809187540770",
    );

    expect(column).toBeGreaterThan(-1);
    // The key needs the column: it runs after it.
    expect(keys).toBeGreaterThan(column);
    expect(
      names.filter((name: string): boolean => {
        return name.startsWith("AddFormSubmissionAlert");
      }),
    ).toHaveLength(2);
    // After the migrations that made forms and their submissions.
    expect(column).toBeGreaterThan(
      names.indexOf("MigrateIncidentFormsToForms1797400000000"),
    );
    expect(new AddFormSubmissionAlert1809187540760().name).toBe(
      "AddFormSubmissionAlert1809187540760",
    );
    expect(new AddFormSubmissionAlertIndexAndKey1809187540770().name).toBe(
      "AddFormSubmissionAlertIndexAndKey1809187540770",
    );
  });
});
