import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddWorkflowRunAs1809185100000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809185100000-AddWorkflowRunAs";
import { AddWorkflowRunAsKeys1809185100100 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809185100100-AddWorkflowRunAsKeys";
import CustomRole from "../../../../Models/DatabaseModels/CustomRole";
import User from "../../../../Models/DatabaseModels/User";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import WorkflowLog from "../../../../Models/DatabaseModels/WorkflowLog";
import Permission from "../../../../Types/Permission";
import { WorkflowRunAs } from "../../../../Types/Workflow/WorkflowRunAs";

/*
 * The migrations behind what a workflow runs as (OneUptime issue #9695):
 *
 *   - AddWorkflowRunAs adds Workflow.runAs (NOT NULL, default 'Default', so
 *     every existing workflow runs exactly as it did), the custom role it
 *     names, the person who gave it its permissions and when, and what each
 *     run acted as - and reads no row doing it.
 *   - AddWorkflowRunAsKeys adds the three keys, each SET NULL on delete,
 *     online and outside a transaction: "WorkflowLog" is written by every run.
 *
 * The statements run against a fake QueryRunner, OnlineDdl's own steps
 * stubbed, so what each migration hands it is told apart from what it runs
 * itself.
 */

const MIGRATION_TIMESTAMP: RegExp = /(\d{13})$/;

const KEY_STATEMENTS: Array<string> = [
  `ALTER TABLE "Workflow" ADD CONSTRAINT "FK_b820857aa10fda7eb16f788f221" FOREIGN KEY ("runAsCustomRoleId") REFERENCES "CustomRole"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
  `ALTER TABLE "Workflow" ADD CONSTRAINT "FK_8f14f215221edcbbf0f4504ab21" FOREIGN KEY ("runAsGivenByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
  `ALTER TABLE "WorkflowLog" ADD CONSTRAINT "FK_536db0d5c3930fb89a4499d92b9" FOREIGN KEY ("runAsGivenByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
];

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

describe("AddWorkflowRunAs1809185100000: the columns", () => {
  test("adds the run-as columns to Workflow and WorkflowLog, and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddWorkflowRunAs1809185100000().up(runner);
      }),
    ).toEqual([
      `ALTER TABLE "Workflow" ADD "runAs" character varying(100) NOT NULL DEFAULT 'Default'`,
      `ALTER TABLE "Workflow" ADD "runAsCustomRoleId" uuid`,
      `ALTER TABLE "Workflow" ADD "runAsGivenByUserId" uuid`,
      `ALTER TABLE "Workflow" ADD "runAsGivenAt" TIMESTAMP WITH TIME ZONE`,
      `ALTER TABLE "WorkflowLog" ADD "runAs" character varying(100)`,
      `ALTER TABLE "WorkflowLog" ADD "runAsCustomRoleName" character varying(100)`,
      `ALTER TABLE "WorkflowLog" ADD "runAsGivenByUserId" uuid`,
    ]);
  });

  test("every existing workflow runs as Default: the column's default is the model's", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddWorkflowRunAs1809185100000().up(runner);
      },
    );

    expect(statements[0]).toContain(`DEFAULT '${WorkflowRunAs.Default}'`);
    expect(new Workflow().getTableColumnMetadata("runAs").defaultValue).toBe(
      WorkflowRunAs.Default,
    );
  });

  test("builds no index, adds no key and rewrites no row", async () => {
    for (const statement of await statementsOf((runner: QueryRunner) => {
      return new AddWorkflowRunAs1809185100000().up(runner);
    })) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|UPDATE /i,
      );
    }
  });

  test("down drops what up added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddWorkflowRunAs1809185100000().down(runner);
      }),
    ).toEqual([
      `ALTER TABLE "WorkflowLog" DROP COLUMN "runAsGivenByUserId"`,
      `ALTER TABLE "WorkflowLog" DROP COLUMN "runAsCustomRoleName"`,
      `ALTER TABLE "WorkflowLog" DROP COLUMN "runAs"`,
      `ALTER TABLE "Workflow" DROP COLUMN "runAsGivenAt"`,
      `ALTER TABLE "Workflow" DROP COLUMN "runAsGivenByUserId"`,
      `ALTER TABLE "Workflow" DROP COLUMN "runAsCustomRoleId"`,
      `ALTER TABLE "Workflow" DROP COLUMN "runAs"`,
    ]);
  });
});

describe("AddWorkflowRunAsKeys1809185100100: the keys", () => {
  test("adds the three keys online, outside a transaction", async () => {
    const migration: AddWorkflowRunAsKeys1809185100100 =
      new AddWorkflowRunAsKeys1809185100100();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual(
      KEY_STATEMENTS.map((statement: string): string => {
        return `online: ${statement}`;
      }),
    );
  });

  test("OnlineDdl adds each key NOT VALID, then validates it on its own", () => {
    for (const statement of KEY_STATEMENTS) {
      const parsed: ReturnType<typeof OnlineDdl.parseAddForeignKey> =
        OnlineDdl.parseAddForeignKey(statement);

      expect(parsed.addNotValid).toBe(`${statement} NOT VALID`);
      expect(parsed.validate).toMatch(/VALIDATE CONSTRAINT "FK_[0-9a-f]+"$/);
    }
  });

  test("the model's relations are the keys': SET NULL, to CustomRole and User", () => {
    const expected: Array<{
      target: unknown;
      property: string;
      type: unknown;
    }> = [
      { target: Workflow, property: "runAsCustomRole", type: CustomRole },
      { target: Workflow, property: "runAsGivenByUser", type: User },
      { target: WorkflowLog, property: "runAsGivenByUser", type: User },
    ];

    for (const relation of expected) {
      const found: RelationMetadataArgs | undefined = relationOf(
        relation.target,
        relation.property,
      );

      expect(found?.options?.onDelete).toBe("SET NULL");
      expect((found?.type as () => unknown)()).toBe(relation.type);
    }
  });

  test("down() drops the keys", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddWorkflowRunAsKeys1809185100100().down(runner);
      }),
    ).toEqual([
      `ALTER TABLE "WorkflowLog" DROP CONSTRAINT "FK_536db0d5c3930fb89a4499d92b9"`,
      `ALTER TABLE "Workflow" DROP CONSTRAINT "FK_8f14f215221edcbbf0f4504ab21"`,
      `ALTER TABLE "Workflow" DROP CONSTRAINT "FK_b820857aa10fda7eb16f788f221"`,
    ]);
  });
});

describe("both are registered", () => {
  test("once each, the columns before their keys, each numbered after every migration before it", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;

    for (const migration of [
      AddWorkflowRunAs1809185100000,
      AddWorkflowRunAsKeys1809185100100,
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

    expect(registered.indexOf(AddWorkflowRunAs1809185100000)).toBeLessThan(
      registered.indexOf(AddWorkflowRunAsKeys1809185100100),
    );
  });
});

describe("the model's columns", () => {
  test("whoever may create or edit a workflow may send its Run As; its readers read it", () => {
    const access: {
      create?: Array<Permission>;
      read?: Array<Permission>;
      update?: Array<Permission>;
    } =
      (new Workflow().getColumnAccessControlFor("runAs") as unknown as {
        create?: Array<Permission>;
        read?: Array<Permission>;
        update?: Array<Permission>;
      }) || {};

    // The server decides who may choose what (WorkflowRunAsAuthority).
    expect(access.create).toEqual(
      expect.arrayContaining([
        Permission.ProjectMember,
        Permission.CreateWorkflow,
      ]),
    );
    expect(access.update).toEqual(
      expect.arrayContaining([
        Permission.EditWorkflow,
        Permission.WorkflowAdmin,
      ]),
    );
    expect(access.read).toEqual(
      expect.arrayContaining([Permission.WorkflowViewer, Permission.Viewer]),
    );
  });

  test("who gave a workflow its permissions, and when, is OneUptime's to write", () => {
    for (const column of [
      "runAsGivenByUserId",
      "runAsGivenByUser",
      "runAsGivenAt",
    ]) {
      const access: { create?: Array<unknown>; update?: Array<unknown> } =
        (new Workflow().getColumnAccessControlFor(column) as unknown as {
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

  test("what a run acted as is OneUptime's to write", () => {
    for (const column of [
      "runAs",
      "runAsCustomRoleName",
      "runAsGivenByUserId",
      "runAsGivenByUser",
    ]) {
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

  test("Run As offers its values, so the API, MCP and Terraform list them", () => {
    expect(
      new Workflow().getTableColumnMetadata("runAs").allowedValues,
    ).toEqual(Object.values(WorkflowRunAs));
    expect(
      new WorkflowLog().getTableColumnMetadata("runAs").allowedValues,
    ).toEqual(Object.values(WorkflowRunAs));
  });
});
