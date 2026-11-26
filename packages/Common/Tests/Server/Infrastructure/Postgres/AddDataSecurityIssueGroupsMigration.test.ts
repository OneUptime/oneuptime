import DataSecurityAiProposal from "../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataSecurityIssueGroup from "../../../../Models/DatabaseModels/DataSecurityIssueGroup";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddDataSecurityIssueGroups1809187470370 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187470370-AddDataSecurityIssueGroups";
import { AddDataSecurityIssueGroupIndexesAndKeys1809187470380 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187470380-AddDataSecurityIssueGroupIndexesAndKeys";
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
 * DATA SECURITY ISSUES ONE MISTAKE MADE (#10370).
 *
 * A new table, "DataSecurityIssueGroup", with its unique key on the
 * project and the fact its stores share, and a nullable column on each
 * table that names a group: an issue's, and the proposal that fixes a
 * group's cause. No row is rewritten: every issue starts in no group.
 *
 * The new columns' indexes and keys go on existing, busy tables, so they
 * are built online, in a migration of their own outside a transaction
 * (OnlineDdl). An issue keeps its record when its group goes (SET NULL); a
 * group's fix proposal goes with it (CASCADE). Names are TypeORM's own, so
 * the schema drift check finds nothing to change.
 *
 * Pure SQL-contract assertions against a fake QueryRunner; OnlineDdl's own
 * steps are recorded as "online: <statement>".
 */

const naming: DefaultNamingStrategy = new DefaultNamingStrategy();
const GROUP_COLUMN: string = "dataSecurityIssueGroupId";

function indexOf(table: string, columns: Array<string>): string {
  return naming.indexName(table, columns);
}

function foreignKeyOf(table: string, column: string, to: string): string {
  return naming.foreignKeyName(table, [column], to, ["_id"]);
}

const UPDATE_STATEMENT: RegExp = /^UPDATE/;

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

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AddDataSecurityIssueGroups1809187470370", () => {
  test("makes the table, its unique key and its keys, and the two columns that name a group", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddDataSecurityIssueGroups1809187470370().up(runner);
      },
    );

    expect(statements[0]).toContain(`CREATE TABLE "DataSecurityIssueGroup"`);
    expect(statements.slice(1)).toEqual([
      `CREATE UNIQUE INDEX "${indexOf("DataSecurityIssueGroup", ["projectId", "groupKey"])}" ON "DataSecurityIssueGroup" ("projectId", "groupKey") `,
      `ALTER TABLE "DataSecurityIssue" ADD "${GROUP_COLUMN}" uuid`,
      `ALTER TABLE "DataSecurityAiProposal" ADD "${GROUP_COLUMN}" uuid`,
      `ALTER TABLE "DataSecurityIssueGroup" ADD CONSTRAINT "${foreignKeyOf("DataSecurityIssueGroup", "projectId", "Project")}" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      `ALTER TABLE "DataSecurityIssueGroup" ADD CONSTRAINT "${foreignKeyOf("DataSecurityIssueGroup", "fixRequestedByUserId", "User")}" FOREIGN KEY ("fixRequestedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    ]);
  });

  test("the table holds every column of the model", async () => {
    const [create] = await statementsOf((runner: QueryRunner) => {
      return new AddDataSecurityIssueGroups1809187470370().up(runner);
    });
    const columns: Array<string> = getMetadataArgsStorage()
      .columns.filter((args: ColumnMetadataArgs) => {
        return args.target === DataSecurityIssueGroup;
      })
      .map((args: ColumnMetadataArgs): string => {
        return args.propertyName;
      });

    expect(columns.length).toBeGreaterThan(10);

    for (const column of columns) {
      expect({ column, made: create!.includes(`"${column}"`) }).toEqual({
        column,
        made: true,
      });
    }
  });

  test("never rewrites the busy tables: their new columns are nullable, with no default", async () => {
    const statements: Array<string> = (
      await statementsOf((runner: QueryRunner) => {
        return new AddDataSecurityIssueGroups1809187470370().up(runner);
      })
    ).filter((statement: string): boolean => {
      return (
        statement.startsWith(`ALTER TABLE "DataSecurityIssue" `) ||
        statement.startsWith(`ALTER TABLE "DataSecurityAiProposal" `)
      );
    });

    expect(statements).toHaveLength(2);

    for (const statement of statements) {
      expect(statement).not.toContain("DEFAULT");
      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toMatch(UPDATE_STATEMENT);
    }
  });

  test("down() takes back exactly what up() made", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddDataSecurityIssueGroups1809187470370().down(runner);
      }),
    ).toEqual([
      `ALTER TABLE "DataSecurityIssueGroup" DROP CONSTRAINT "${foreignKeyOf("DataSecurityIssueGroup", "fixRequestedByUserId", "User")}"`,
      `ALTER TABLE "DataSecurityIssueGroup" DROP CONSTRAINT "${foreignKeyOf("DataSecurityIssueGroup", "projectId", "Project")}"`,
      `ALTER TABLE "DataSecurityAiProposal" DROP COLUMN "${GROUP_COLUMN}"`,
      `ALTER TABLE "DataSecurityIssue" DROP COLUMN "${GROUP_COLUMN}"`,
      `DROP INDEX "public"."${indexOf("DataSecurityIssueGroup", ["projectId", "groupKey"])}"`,
      `DROP TABLE "DataSecurityIssueGroup"`,
    ]);
  });

  test("is registered after the migrations before it, and named for its class", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );
    const index: number = names.indexOf(
      "AddDataSecurityIssueGroups1809187470370",
    );

    expect(index).toBeGreaterThan(-1);
    expect(index).toBeGreaterThan(
      names.indexOf("AddDataSecurityIssueAiAnalysis1809187436369"),
    );
    expect(new AddDataSecurityIssueGroups1809187470370().name).toBe(
      "AddDataSecurityIssueGroups1809187470370",
    );
  });
});

describe("AddDataSecurityIssueGroupIndexesAndKeys1809187470380", () => {
  test("builds each index and key online, outside a transaction", async () => {
    const migration: AddDataSecurityIssueGroupIndexesAndKeys1809187470380 =
      new AddDataSecurityIssueGroupIndexesAndKeys1809187470380();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([
      `online: CREATE INDEX "${indexOf("DataSecurityIssue", [GROUP_COLUMN])}" ON "DataSecurityIssue" ("${GROUP_COLUMN}") `,
      `online: CREATE INDEX "${indexOf("DataSecurityAiProposal", [GROUP_COLUMN])}" ON "DataSecurityAiProposal" ("${GROUP_COLUMN}") `,
      `online: ALTER TABLE "DataSecurityIssue" ADD CONSTRAINT "${foreignKeyOf("DataSecurityIssue", GROUP_COLUMN, "DataSecurityIssueGroup")}" FOREIGN KEY ("${GROUP_COLUMN}") REFERENCES "DataSecurityIssueGroup"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
      `online: ALTER TABLE "DataSecurityAiProposal" ADD CONSTRAINT "${foreignKeyOf("DataSecurityAiProposal", GROUP_COLUMN, "DataSecurityIssueGroup")}" FOREIGN KEY ("${GROUP_COLUMN}") REFERENCES "DataSecurityIssueGroup"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    ]);
  });

  test("down() takes the keys, then the indexes, away", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddDataSecurityIssueGroupIndexesAndKeys1809187470380().down(
          runner,
        );
      }),
    ).toEqual([
      `ALTER TABLE "DataSecurityAiProposal" DROP CONSTRAINT "${foreignKeyOf("DataSecurityAiProposal", GROUP_COLUMN, "DataSecurityIssueGroup")}"`,
      `ALTER TABLE "DataSecurityIssue" DROP CONSTRAINT "${foreignKeyOf("DataSecurityIssue", GROUP_COLUMN, "DataSecurityIssueGroup")}"`,
      `online: DROP INDEX "public"."${indexOf("DataSecurityAiProposal", [GROUP_COLUMN])}"`,
      `online: DROP INDEX "public"."${indexOf("DataSecurityIssue", [GROUP_COLUMN])}"`,
    ]);
  });

  test("is registered right after the table's migration, once, named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const at: number = registered.indexOf(
      AddDataSecurityIssueGroups1809187470370,
    );

    expect(at).toBeGreaterThan(-1);
    expect(registered[at + 1]).toBe(
      AddDataSecurityIssueGroupIndexesAndKeys1809187470380,
    );
    expect(
      registered.filter((candidate: unknown): boolean => {
        return (
          candidate === AddDataSecurityIssueGroupIndexesAndKeys1809187470380
        );
      }),
    ).toHaveLength(1);
  });
});

describe("the models say the same", () => {
  test.each([
    {
      name: "DataSecurityIssue",
      model: DataSecurityIssue,
      onDelete: "SET NULL",
    },
    {
      name: "DataSecurityAiProposal",
      model: DataSecurityAiProposal,
      onDelete: "CASCADE",
    },
  ])(
    "$name: a nullable group id, indexed, $onDelete with its group",
    ({
      model,
      onDelete,
    }: {
      name: string;
      model: typeof DataSecurityIssue | typeof DataSecurityAiProposal;
      onDelete: string;
    }) => {
      const column: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
        .columns.filter((args: ColumnMetadataArgs) => {
          return args.target === model && args.propertyName === GROUP_COLUMN;
        })
        .pop();

      expect(column?.options.nullable).toBe(true);

      const indexed: Array<unknown> = getMetadataArgsStorage()
        .indices.filter((index: IndexMetadataArgs) => {
          return index.target === model;
        })
        .map((index: IndexMetadataArgs): unknown => {
          return index.columns;
        });

      expect(indexed).toContainEqual([GROUP_COLUMN]);

      const relation: RelationMetadataArgs | undefined =
        getMetadataArgsStorage()
          .relations.filter((args: RelationMetadataArgs) => {
            return (
              args.target === model &&
              args.propertyName === "dataSecurityIssueGroup"
            );
          })
          .pop();

      expect(relation?.relationType).toBe("many-to-one");
      expect(relation?.options.onDelete).toBe(onDelete);
      expect(relation?.options.nullable).toBe(true);
    },
  );

  test("a group is one per project and fact, and no client reads or writes it", () => {
    const unique: Array<unknown> = getMetadataArgsStorage()
      .indices.filter((index: IndexMetadataArgs) => {
        return index.target === DataSecurityIssueGroup && index.unique === true;
      })
      .map((index: IndexMetadataArgs): unknown => {
        return index.columns;
      });

    expect(unique).toEqual([["projectId", "groupKey"]]);

    const group: DataSecurityIssueGroup = new DataSecurityIssueGroup();

    expect(group.createRecordPermissions).toEqual([]);
    expect(group.readRecordPermissions).toEqual([]);
    expect(group.updateRecordPermissions).toEqual([]);
    expect(group.deleteRecordPermissions).toEqual([]);
  });

  test("an issue's and a proposal's group are written by OneUptime and read as their other server-written columns", () => {
    const issue: DataSecurityIssue = new DataSecurityIssue();
    const proposal: DataSecurityAiProposal = new DataSecurityAiProposal();

    expect(issue.getColumnAccessControlForAllColumns()[GROUP_COLUMN]).toEqual(
      issue.getColumnAccessControlForAllColumns()["securityCaseId"],
    );
    expect(
      proposal.getColumnAccessControlForAllColumns()[GROUP_COLUMN],
    ).toEqual(proposal.getColumnAccessControlForAllColumns()["dataStoreId"]);
  });
});
