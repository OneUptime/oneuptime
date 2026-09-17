import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { MakeOwnerRowsUnique1793500000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1793500000000-MakeOwnerRowsUnique";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { UniqueColumnsTogetherMetadata } from "../../../Types/Database/UniqueColumnsTogether";
import TableColumnType from "../../../Types/Database/TableColumnType";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { describe, expect, jest, test } from "@jest/globals";

/*
 * Issue #3394: owner rows were de-duplicated only by the dashboard picker.
 *
 * The REST API, workflow components, monitor criteria (IncidentService /
 * AlertService.addOwners) and the other internal paths inserted a
 * <Resource>OwnerTeam / <Resource>OwnerUser row unconditionally. Each row runs
 * its service's onCreateSuccess, so a second row for the same team was a
 * second feed item and a second owner notification - and the team was listed
 * twice on the Owners tab.
 *
 * Two guarantees now hold for EVERY owner model, and this suite sweeps the
 * registry rather than a hand-kept list so that a model added later is held to
 * them too:
 *
 *   1. the database: a UNIQUE index on (resource, owner, project), so no
 *      writer - including two racing ones - can store a second row;
 *   2. the service: @UniqueColumnsTogether on the same columns, so
 *      DatabaseService.create refuses the duplicate with a readable message
 *      before it is written, and before onCreateSuccess can notify anyone.
 *
 * The migration that repairs existing duplicates and builds those indexes is
 * checked against the same sweep: a table the entities make unique but the
 * migration does not repair would fail the deploy on a database that holds a
 * duplicate.
 *
 * Pure metadata and a mocked QueryRunner - no Postgres here.
 */

type ModelType = { new (): BaseModel };

interface OwnerModel {
  className: string;
  modelType: ModelType;
  tableName: string;
  ownerColumn: "teamId" | "userId";
  resourceColumn: string;
  uniqueColumns: Array<string>;
  constraints: Array<UniqueColumnsTogetherMetadata>;
  hasIsOwnerNotified: boolean;
}

const NON_RESOURCE_ID_COLUMNS: Array<string> = [
  "_id",
  "projectId",
  "teamId",
  "userId",
  "createdByUserId",
  "deletedByUserId",
];

const OWNER_MODELS: Array<OwnerModel> = (AllModelTypes as Array<ModelType>)
  .filter((modelType: ModelType): boolean => {
    const ownerModelPattern: RegExp = /Owner(Team|User)$/;
    return ownerModelPattern.test(modelType.name);
  })
  .map((modelType: ModelType): OwnerModel => {
    const model: BaseModel = new modelType();
    const ownerColumn: "teamId" | "userId" = modelType.name.endsWith(
      "OwnerTeam",
    )
      ? "teamId"
      : "userId";

    const resourceColumns: Array<string> = model
      .getTableColumns()
      .columns.filter((column: string): boolean => {
        return (
          !NON_RESOURCE_ID_COLUMNS.includes(column) &&
          model.getTableColumnMetadata(column).type === TableColumnType.ObjectID
        );
      });

    if (resourceColumns.length !== 1) {
      throw new Error(
        `${modelType.name} should have exactly one resource id column, found: ${resourceColumns.join(", ")}`,
      );
    }

    const resourceColumn: string = resourceColumns[0]!;

    return {
      className: modelType.name,
      modelType: modelType,
      tableName: model.tableName!,
      ownerColumn: ownerColumn,
      resourceColumn: resourceColumn,
      uniqueColumns: [resourceColumn, ownerColumn, "projectId"],
      constraints: model.getUniqueColumnsTogether(),
      hasIsOwnerNotified: model.hasColumn("isOwnerNotified"),
    };
  });

const OWNER_MODEL_CASES: Array<[string, OwnerModel]> = OWNER_MODELS.map(
  (ownerModel: OwnerModel): [string, OwnerModel] => {
    return [ownerModel.className, ownerModel];
  },
);

function classIndexes(modelType: ModelType): Array<IndexMetadataArgs> {
  return getMetadataArgsStorage().indices.filter(
    (index: IndexMetadataArgs): boolean => {
      return index.target === modelType && Array.isArray(index.columns);
    },
  );
}

function sameColumns(a: Array<string>, b: Array<string>): boolean {
  return (
    a.length === b.length &&
    a.every((column: string, i: number) => {
      return column === b[i];
    })
  );
}

function mockQueryRunner(): { runner: QueryRunner; sql: Array<string> } {
  const sql: Array<string> = [];

  const runner: QueryRunner = {
    query: jest.fn(async (statement: string): Promise<void> => {
      sql.push(statement);
    }),
  } as unknown as QueryRunner;

  return { runner, sql };
}

function normalize(statement: string): string {
  return statement.replace(/\s+/g, " ").trim();
}

describe("owner model registry sweep", () => {
  test("finds every owner model, team and user alike", () => {
    // A filter that silently matched nothing would make every case vacuous.
    expect(OWNER_MODELS.length).toBeGreaterThanOrEqual(68);

    const teams: number = OWNER_MODELS.filter((m: OwnerModel) => {
      return m.ownerColumn === "teamId";
    }).length;

    expect(teams * 2).toBe(OWNER_MODELS.length);
  });

  test("includes the models the issue names", () => {
    const names: Array<string> = OWNER_MODELS.map((m: OwnerModel) => {
      return m.className;
    });

    for (const name of [
      "IncidentOwnerTeam",
      "IncidentOwnerUser",
      "AlertOwnerTeam",
      "MonitorOwnerTeam",
      "ScheduledMaintenanceOwnerTeam",
    ]) {
      expect(names).toContain(name);
    }
  });
});

describe.each(OWNER_MODEL_CASES)(
  "%s declares one owner per resource",
  (_name: string, ownerModel: OwnerModel) => {
    test("the database index on (resource, owner, project) is UNIQUE", () => {
      const matching: Array<IndexMetadataArgs> = classIndexes(
        ownerModel.modelType,
      ).filter((index: IndexMetadataArgs): boolean => {
        return sameColumns(
          index.columns as Array<string>,
          ownerModel.uniqueColumns,
        );
      });

      // One declaration: a second, non-unique copy would be a separate index.
      expect(matching).toHaveLength(1);
      expect(matching[0]!.unique).toBe(true);
      expect(matching[0]!.where).toBeUndefined();
      // TypeORM owns it - a synchronize:false index would be left to a migration.
      expect(matching[0]!.synchronize).not.toBe(false);
    });

    test("no class-level index on those columns is left non-unique", () => {
      const nonUnique: Array<IndexMetadataArgs> = classIndexes(
        ownerModel.modelType,
      ).filter((index: IndexMetadataArgs): boolean => {
        return (
          !index.unique &&
          [...(index.columns as Array<string>)].sort().join() ===
            [...ownerModel.uniqueColumns].sort().join()
        );
      });

      expect(nonUnique).toEqual([]);
    });

    test("the service refuses a duplicate on the same columns", () => {
      expect(ownerModel.constraints).toHaveLength(1);
      expect(ownerModel.constraints[0]!.columnNames).toEqual(
        ownerModel.uniqueColumns,
      );
    });

    test("the refusal says which kind of owner is already there", () => {
      const message: string = ownerModel.constraints[0]!.errorMessage;
      const kind: string =
        ownerModel.ownerColumn === "teamId" ? "team" : "user";

      expect(message).toMatch(
        new RegExp(`^This ${kind} is already an owner of this .+\\.$`),
      );
      // A pasted message naming the wrong kind of owner is the likely slip.
      expect(message).not.toContain(kind === "team" ? "user" : "team");
    });

    test("every key column is a non-null id column the check can compare", () => {
      const model: BaseModel = new ownerModel.modelType();

      for (const column of ownerModel.uniqueColumns) {
        expect(model.getTableColumnMetadata(column).type).toBe(
          TableColumnType.ObjectID,
        );
        expect(model.getTableColumnMetadata(column).required).toBe(true);

        const columnArgs: { options: { nullable?: boolean } } | undefined =
          getMetadataArgsStorage().columns.find(
            (args: { target: unknown; propertyName: string }) => {
              return (
                args.target === ownerModel.modelType &&
                args.propertyName === column
              );
            },
          ) as { options: { nullable?: boolean } } | undefined;

        /*
         * NULLs never collide in a unique index, so a nullable key column
         * would let duplicates straight through the database guarantee.
         */
        expect(columnArgs?.options.nullable).toBe(false);
      }
    });
  },
);

describe("MakeOwnerRowsUnique1793500000000", () => {
  const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

  function expectedIndexName(ownerModel: OwnerModel): string {
    return namingStrategy.indexName(
      ownerModel.tableName,
      ownerModel.uniqueColumns,
    );
  }

  async function runUp(): Promise<Array<string>> {
    const { runner, sql } = mockQueryRunner();
    await new MakeOwnerRowsUnique1793500000000().up(runner);
    return sql.map(normalize);
  }

  async function runDown(): Promise<Array<string>> {
    const { runner, sql } = mockQueryRunner();
    await new MakeOwnerRowsUnique1793500000000().down(runner);
    return sql.map(normalize);
  }

  function dedupeStatementFor(
    statements: Array<string>,
    tableName: string,
  ): Array<string> {
    return statements.filter((statement: string): boolean => {
      return statement.includes(`DELETE FROM "${tableName}" t`);
    });
  }

  test("is registered, so it actually runs", () => {
    expect(SchemaMigrations).toContain(MakeOwnerRowsUnique1793500000000);
  });

  test("has a name that matches its class, as TypeORM records it", () => {
    expect(new MakeOwnerRowsUnique1793500000000().name).toBe(
      "MakeOwnerRowsUnique1793500000000",
    );
  });

  test("creates exactly one unique index per owner model", async () => {
    const statements: Array<string> = await runUp();
    const creates: Array<string> = statements.filter((s: string) => {
      return s.startsWith("CREATE UNIQUE INDEX");
    });

    expect(creates).toHaveLength(OWNER_MODELS.length);

    for (const ownerModel of OWNER_MODELS) {
      const columns: string = ownerModel.uniqueColumns
        .map((column: string): string => {
          return `"${column}"`;
        })
        .join(", ");

      /*
       * Built under TypeORM's own name for the entity's index. Any other name
       * and the next generated migration would drop it and build it again.
       */
      expect(creates).toContain(
        `CREATE UNIQUE INDEX "${expectedIndexName(ownerModel)}" ON "${ownerModel.tableName}" (${columns})`,
      );
    }
  });

  test("repairs every owner table, and only owner tables", async () => {
    const statements: Array<string> = await runUp();
    const deletes: Array<string> = statements.filter((s: string) => {
      return s.includes("DELETE FROM");
    });

    expect(deletes).toHaveLength(OWNER_MODELS.length);

    for (const ownerModel of OWNER_MODELS) {
      expect(dedupeStatementFor(statements, ownerModel.tableName)).toHaveLength(
        1,
      );
    }
  });

  test("repairs every table before building any unique index", async () => {
    const statements: Array<string> = await runUp();

    const lastDelete: number = statements
      .map((s: string, i: number): number => {
        return s.includes("DELETE FROM") ? i : -1;
      })
      .reduce((a: number, b: number) => {
        return Math.max(a, b);
      }, -1);
    const firstCreate: number = statements.findIndex((s: string) => {
      return s.startsWith("CREATE UNIQUE INDEX");
    });

    expect(lastDelete).toBeGreaterThanOrEqual(0);
    expect(firstCreate).toBeGreaterThan(lastDelete);
  });

  test("drops each old non-unique index before building its unique replacement", async () => {
    const statements: Array<string> = await runUp();

    const drops: Array<string> = statements.filter((s: string) => {
      return s.startsWith("DROP INDEX");
    });

    // The 30 tables that already had the composite index, and only those.
    expect(drops).toHaveLength(30);

    for (const drop of drops) {
      const name: string = drop.match(/"public"\."(IDX_\w+)"/)![1]!;
      const dropAt: number = statements.indexOf(drop);
      const createAt: number = statements.findIndex((s: string) => {
        return s.startsWith(`CREATE UNIQUE INDEX "${name}"`);
      });

      // Same name: TypeORM re-creates an index in place when only `unique` changes.
      expect(createAt).toBeGreaterThan(dropAt);
    }
  });

  describe.each(OWNER_MODEL_CASES)(
    "repair of %s",
    (_name: string, ownerModel: OwnerModel) => {
      async function repairSql(): Promise<string> {
        return dedupeStatementFor(await runUp(), ownerModel.tableName)[0]!;
      }

      test("groups rows by exactly the unique key", async () => {
        const sql: string = await repairSql();
        const key: string = ownerModel.uniqueColumns
          .map((column: string): string => {
            return `"${column}"`;
          })
          .join(", ");

        expect(sql).toContain(`GROUP BY ${key} HAVING COUNT(*) > 1`);
        expect(sql).toContain(
          `PARTITION BY ${ownerModel.uniqueColumns
            .map((column: string): string => {
              return `t."${column}"`;
            })
            .join(", ")}`,
        );
      });

      test("keeps one row per group and deletes the rest", async () => {
        const sql: string = await repairSql();

        expect(sql).toContain("WHERE t._id = r._id AND r.rn > 1");
        expect(sql).not.toContain("rn >= 1");
      });

      test("keeps a live row over a soft-deleted one, then the oldest", async () => {
        const sql: string = await repairSql();
        const order: string = sql.match(/ORDER BY (.*?) \) AS rn/)![1]!;

        expect(order.startsWith(`(t."deletedAt" IS NOT NULL) ASC`)).toBe(true);
        expect(order.endsWith(`t."createdAt" ASC, t._id ASC`)).toBe(true);
      });

      if (ownerModel.hasIsOwnerNotified) {
        test("keeps an already-notified row, so nobody is told twice", async () => {
          const sql: string = await repairSql();
          const order: string = sql.match(/ORDER BY (.*?) \) AS rn/)![1]!;

          expect(order).toBe(
            `(t."deletedAt" IS NOT NULL) ASC, t."isOwnerNotified" DESC, t."createdAt" ASC, t._id ASC`,
          );
        });
      } else {
        test("does not read an isOwnerNotified column the table does not have", async () => {
          expect(await repairSql()).not.toContain("isOwnerNotified");
        });
      }
    },
  );

  test("down() drops every unique index", async () => {
    const statements: Array<string> = await runDown();

    for (const ownerModel of OWNER_MODELS) {
      expect(statements).toContain(
        `DROP INDEX "public"."${expectedIndexName(ownerModel)}"`,
      );
    }
  });

  test("down() restores the 30 previous indexes, non-unique and in their original column order", async () => {
    const upStatements: Array<string> = await runUp();
    const statements: Array<string> = await runDown();

    const restored: Array<string> = statements.filter((s: string) => {
      return s.startsWith("CREATE INDEX");
    });

    expect(restored).toHaveLength(30);
    expect(
      statements.some((s: string) => {
        return s.startsWith("CREATE UNIQUE INDEX");
      }),
    ).toBe(false);

    const droppedInUp: Array<string> = upStatements
      .filter((s: string) => {
        return s.startsWith("DROP INDEX");
      })
      .map((s: string): string => {
        return s.match(/"public"\."(IDX_\w+)"/)![1]!;
      })
      .sort();

    const restoredNames: Array<string> = restored
      .map((s: string): string => {
        return s.match(/^CREATE INDEX "(IDX_\w+)"/)![1]!;
      })
      .sort();

    expect(restoredNames).toEqual(droppedInUp);

    for (const statement of restored) {
      const table: string = statement.match(/ON "(\w+)"/)![1]!;
      const ownerModel: OwnerModel = OWNER_MODELS.find((m: OwnerModel) => {
        return m.tableName === table;
      })!;

      expect(statement).toBe(
        `CREATE INDEX "${expectedIndexName(ownerModel)}" ON "${table}" (${ownerModel.uniqueColumns
          .map((column: string): string => {
            return `"${column}"`;
          })
          .join(", ")})`,
      );
    }
  });

  test("down() deletes nothing", async () => {
    const statements: Array<string> = await runDown();

    expect(
      statements.some((s: string) => {
        const mutationPattern: RegExp = /\b(DELETE|UPDATE|INSERT)\b/;
        return mutationPattern.test(s);
      }),
    ).toBe(false);
  });
});
