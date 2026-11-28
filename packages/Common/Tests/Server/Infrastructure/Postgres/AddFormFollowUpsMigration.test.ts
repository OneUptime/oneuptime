import Form from "../../../../Models/DatabaseModels/Form";
import FormSubmission from "../../../../Models/DatabaseModels/FormSubmission";
import FormSubmissionFollower from "../../../../Models/DatabaseModels/FormSubmissionFollower";
import FormSubmissionMessage from "../../../../Models/DatabaseModels/FormSubmissionMessage";
import { AddFormFollowUps1809188000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809188000000-AddFormFollowUps";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { DefaultNamingStrategy, QueryRunner } from "typeorm";
import { describe, expect, test } from "@jest/globals";

/*
 * A form's follow-ups (Types/Form/FormFollowUp): two new tables - the
 * people following a submission, and its conversation - a switch on the
 * form and the title a submission's record was created with.
 *
 * Generated against the models and checked with the schema drift script.
 * The new tables are empty, so their indexes and keys are built as
 * generated. The switch is the one hand-made change: added as false, so a
 * form made before follow-ups existed tells its submitters nothing, as it
 * always did, and only then given its default of true for every form made
 * after - which leaves the column as the model declares it.
 */

const naming: DefaultNamingStrategy = new DefaultNamingStrategy();

const statementsOf: (
  run: (runner: QueryRunner) => Promise<void>,
) => Promise<Array<string>> = async (
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> => {
  const statements: Array<string> = [];

  await run({
    isTransactionActive: true,
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
};

const migrationNames: () => Array<string> = (): Array<string> => {
  return SchemaMigrations.map((migration: unknown): string => {
    return (migration as { name: string }).name;
  });
};

describe("AddFormFollowUps1809188000000", () => {
  test("is registered, after every migration before it", () => {
    const names: Array<string> = migrationNames();

    expect(names).toContain("AddFormFollowUps1809188000000");
    expect(new AddFormFollowUps1809188000000().name).toBe(
      "AddFormFollowUps1809188000000",
    );

    const index: number = names.indexOf("AddFormFollowUps1809188000000");

    for (const name of names.slice(0, index)) {
      const stamp: string = name.match(/(\d+)$/)?.[1] || "0";

      expect(Number(stamp)).toBeLessThan(1809188000000);
    }
  });

  test("creates the two tables the models declare", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddFormFollowUps1809188000000().up(runner);
      },
    );

    expect(new FormSubmissionFollower().tableName).toBe(
      "FormSubmissionFollower",
    );
    expect(new FormSubmissionMessage().tableName).toBe("FormSubmissionMessage");

    const created: Array<string> = statements.filter((sql: string) => {
      return sql.startsWith("CREATE TABLE");
    });

    expect(created).toHaveLength(2);
    expect(created[0]).toContain('CREATE TABLE "FormSubmissionFollower"');
    expect(created[0]).toContain('"email" character varying(100) NOT NULL');
    expect(created[0]).toContain(
      '"isSubmitter" boolean NOT NULL DEFAULT false',
    );
    // The link's secret is kept encrypted, as text.
    expect(created[0]).toContain('"accessToken" text');
    expect(created[1]).toContain('CREATE TABLE "FormSubmissionMessage"');
    expect(created[1]).toContain('"author" character varying(100) NOT NULL');
    expect(created[1]).toContain('"files" jsonb');
  });

  test("keeps one row per submission and address", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddFormFollowUps1809188000000().up(runner);
      },
    );

    expect(statements).toContain(
      `CREATE UNIQUE INDEX "${naming.indexName("FormSubmissionFollower", [
        "formSubmissionId",
        "email",
      ])}" ON "FormSubmissionFollower" ("formSubmissionId", "email") `,
    );
  });

  test("leaves every form made before follow-ups with them off, and every new one with them on", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddFormFollowUps1809188000000().up(runner);
      },
    );

    const add: number = statements.indexOf(
      'ALTER TABLE "Form" ADD "enableFollowUps" boolean NOT NULL DEFAULT false',
    );
    const setDefault: number = statements.indexOf(
      'ALTER TABLE "Form" ALTER COLUMN "enableFollowUps" SET DEFAULT true',
    );

    expect(add).toBeGreaterThan(-1);
    expect(setDefault).toBeGreaterThan(add);
    expect(
      statements.filter((sql: string) => {
        return sql.includes("DEFAULT true") && sql.includes(" ADD ");
      }),
    ).toEqual([]);

    // The model's default, which the drift check holds the column to.
    expect(
      new Form().getTableColumnMetadata("enableFollowUps").defaultValue,
    ).toBe(true);
  });

  test("adds the submission's title, nullable, rewriting nothing", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddFormFollowUps1809188000000().up(runner);
      },
    );

    expect(statements).toContain(
      'ALTER TABLE "FormSubmission" ADD "title" character varying(500)',
    );
    expect(new FormSubmission().tableName).toBe("FormSubmission");
  });

  test("keeps a message whose author stops following, and removes everything of a deleted submission", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddFormFollowUps1809188000000().up(runner);
      },
    );

    expect(statements).toContain(
      `ALTER TABLE "FormSubmissionMessage" ADD CONSTRAINT "${naming.foreignKeyName(
        "FormSubmissionMessage",
        ["formSubmissionFollowerId"],
        "FormSubmissionFollower",
        ["_id"],
      )}" FOREIGN KEY ("formSubmissionFollowerId") REFERENCES "FormSubmissionFollower"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    for (const table of ["FormSubmissionFollower", "FormSubmissionMessage"]) {
      expect(statements).toContain(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${naming.foreignKeyName(
          table,
          ["formSubmissionId"],
          "FormSubmission",
          ["_id"],
        )}" FOREIGN KEY ("formSubmissionId") REFERENCES "FormSubmission"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      );
    }
  });

  test("down() takes everything away again, the tables last", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddFormFollowUps1809188000000().down(runner);
      },
    );

    expect(statements).toContain(
      'ALTER TABLE "Form" DROP COLUMN "enableFollowUps"',
    );
    expect(statements).toContain(
      'ALTER TABLE "FormSubmission" DROP COLUMN "title"',
    );
    expect(statements.slice(-1)).toEqual([
      'DROP TABLE "FormSubmissionFollower"',
    ]);
    expect(statements).toContain('DROP TABLE "FormSubmissionMessage"');
  });
});
