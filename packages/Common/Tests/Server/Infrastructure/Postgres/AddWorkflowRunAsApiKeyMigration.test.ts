import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddWorkflowRunAsKeys1809185100100 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809185100100-AddWorkflowRunAsKeys";
import { AddWorkflowRunAsApiKey1809185400000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809185400000-AddWorkflowRunAsApiKey";
import { AddWorkflowRunAsApiKeyKey1809185400100 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809185400100-AddWorkflowRunAsApiKeyKey";
import ApiKey from "../../../../Models/DatabaseModels/ApiKey";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import WorkflowLog from "../../../../Models/DatabaseModels/WorkflowLog";

/*
 * The migrations behind an API key giving a workflow its Run As (OneUptime
 * issue #9765):
 *
 *   - AddWorkflowRunAsApiKey adds Workflow.runAsGivenByApiKeyId, and the key
 *     and its name each run ran with (WorkflowLog) - nullable, so every
 *     workflow and run before names no key - and reads no row doing it.
 *   - AddWorkflowRunAsApiKeyKey adds the workflow's key to ApiKey, SET NULL
 *     on delete, online and outside a transaction: a key deleted (revoked)
 *     leaves its workflows naming nobody, so they run nothing raised.
 *
 * The statements run against a fake QueryRunner, OnlineDdl's own steps
 * stubbed, so what each migration hands it is told apart from what it runs
 * itself.
 */

const MIGRATION_TIMESTAMP: RegExp = /(\d{13})$/;

const KEY_STATEMENT: string = `ALTER TABLE "Workflow" ADD CONSTRAINT "FK_656f7b719b389da279b104f681d" FOREIGN KEY ("runAsGivenByApiKeyId") REFERENCES "ApiKey"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`;

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];

  jest.spyOn(OnlineDdl, "addForeignKey").mockImplementation((async (
    _runner: QueryRunner,
    statement: string,
  ) => {
    statements.push(`online: ${statement}`);
  }) as never);

  await run({
    isTransactionActive: false,
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
}

function timestampOf(migration: unknown): number {
  return Number(
    MIGRATION_TIMESTAMP.exec((migration as { name: string }).name)?.[1] || 0,
  );
}

function relationOf(
  target: unknown,
  propertyName: string,
): RelationMetadataArgs | undefined {
  return getMetadataArgsStorage().relations.find(
    (candidate: RelationMetadataArgs): boolean => {
      return (
        candidate.target === target && candidate.propertyName === propertyName
      );
    },
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AddWorkflowRunAsApiKey1809185400000: the columns", () => {
  test("adds the key columns to Workflow and WorkflowLog, nullable, and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddWorkflowRunAsApiKey1809185400000().up(runner);
      }),
    ).toEqual([
      `ALTER TABLE "Workflow" ADD "runAsGivenByApiKeyId" uuid`,
      `ALTER TABLE "WorkflowLog" ADD "runAsGivenByApiKeyId" uuid`,
      `ALTER TABLE "WorkflowLog" ADD "runAsGivenByApiKeyName" character varying(100)`,
    ]);
  });

  test("builds no index, adds no key and rewrites no row", async () => {
    for (const statement of await statementsOf((runner: QueryRunner) => {
      return new AddWorkflowRunAsApiKey1809185400000().up(runner);
    })) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|UPDATE |NOT NULL/i,
      );
    }
  });

  test("down drops what up added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddWorkflowRunAsApiKey1809185400000().down(runner);
      }),
    ).toEqual([
      `ALTER TABLE "WorkflowLog" DROP COLUMN "runAsGivenByApiKeyName"`,
      `ALTER TABLE "WorkflowLog" DROP COLUMN "runAsGivenByApiKeyId"`,
      `ALTER TABLE "Workflow" DROP COLUMN "runAsGivenByApiKeyId"`,
    ]);
  });
});

describe("AddWorkflowRunAsApiKeyKey1809185400100: the key", () => {
  test("adds the workflow's key to ApiKey online, outside a transaction", async () => {
    const migration: AddWorkflowRunAsApiKeyKey1809185400100 =
      new AddWorkflowRunAsApiKeyKey1809185400100();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([`online: ${KEY_STATEMENT}`]);
  });

  test("OnlineDdl adds it NOT VALID, then validates it on its own", () => {
    const parsed: ReturnType<typeof OnlineDdl.parseAddForeignKey> =
      OnlineDdl.parseAddForeignKey(KEY_STATEMENT);

    expect(parsed.addNotValid).toBe(`${KEY_STATEMENT} NOT VALID`);
    expect(parsed.validate).toMatch(/VALIDATE CONSTRAINT "FK_[0-9a-f]+"$/);
  });

  test("the model's relation is the key's: SET NULL, to ApiKey; a run's key is kept as history, with no key", () => {
    const relation: RelationMetadataArgs | undefined = relationOf(
      Workflow,
      "runAsGivenByApiKey",
    );

    expect(relation?.options?.onDelete).toBe("SET NULL");
    expect((relation?.type as () => unknown)()).toBe(ApiKey);
    expect(relationOf(WorkflowLog, "runAsGivenByApiKey")).toBeUndefined();
  });

  test("down() drops the key", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddWorkflowRunAsApiKeyKey1809185400100().down(runner);
      }),
    ).toEqual([
      `ALTER TABLE "Workflow" DROP CONSTRAINT "FK_656f7b719b389da279b104f681d"`,
    ]);
  });
});

describe("both are registered", () => {
  test("once each, after the Run As migrations, the columns before their key, each numbered after every migration before it", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    for (const migration of [
      AddWorkflowRunAsApiKey1809185400000,
      AddWorkflowRunAsApiKeyKey1809185400100,
    ]) {
      expect(
        registered.filter((candidate: unknown): boolean => {
          return candidate === migration;
        }),
      ).toHaveLength(1);

      const position: number = registered.indexOf(migration);
      const timestamps: Array<number> = registered
        .slice(0, position)
        .map(timestampOf);

      expect(Math.max(...timestamps)).toBeLessThan(timestampOf(migration));
    }

    expect(registered.indexOf(AddWorkflowRunAsKeys1809185100100)).toBeLessThan(
      registered.indexOf(AddWorkflowRunAsApiKey1809185400000),
    );
    expect(
      registered.indexOf(AddWorkflowRunAsApiKey1809185400000),
    ).toBeLessThan(registered.indexOf(AddWorkflowRunAsApiKeyKey1809185400100));
  });
});

describe("the model's columns", () => {
  test("which key gave a workflow its permissions is OneUptime's to write, and its readers read it", () => {
    for (const column of ["runAsGivenByApiKeyId", "runAsGivenByApiKey"]) {
      const access: {
        create?: Array<unknown>;
        update?: Array<unknown>;
        read?: Array<unknown>;
      } =
        (new Workflow().getColumnAccessControlFor(column) as unknown as {
          create?: Array<unknown>;
          update?: Array<unknown>;
          read?: Array<unknown>;
        }) || {};

      expect({ column, create: access.create, update: access.update }).toEqual({
        column,
        create: [],
        update: [],
      });
      expect(access.read).toEqual(
        new Workflow().getColumnAccessControlFor("runAsGivenByUserId")?.read,
      );
    }
  });

  test("which key a run ran with, and its name then, is OneUptime's to write", () => {
    for (const column of ["runAsGivenByApiKeyId", "runAsGivenByApiKeyName"]) {
      const access: { create?: Array<unknown>; update?: Array<unknown> } =
        (new WorkflowLog().getColumnAccessControlFor(column) as unknown as {
          create?: Array<unknown>;
          update?: Array<unknown>;
        }) || {};

      expect({ column, create: access.create, update: access.update }).toEqual({
        column,
        create: [],
        update: [],
      });
    }
  });
});
