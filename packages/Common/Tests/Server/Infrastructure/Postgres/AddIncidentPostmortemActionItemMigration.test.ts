import AutoRemediationSuggestion from "../../../../Models/DatabaseModels/AutoRemediationSuggestion";
import IncidentPostmortemActionItem from "../../../../Models/DatabaseModels/IncidentPostmortemActionItem";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddIncidentPostmortemActionItem1809173300000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809173300000-AddIncidentPostmortemActionItem";
import { AddSavedAsRunbookToAutoRemediationSuggestion1809173400000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809173400000-AddSavedAsRunbookToAutoRemediationSuggestion";
import { AddSavedAsRunbookToAutoRemediationSuggestionIndexAndKey1809173410000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809173410000-AddSavedAsRunbookToAutoRemediationSuggestionIndexAndKey";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import PostmortemActionItemStatus from "../../../../Types/Incident/PostmortemActionItemStatus";
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
 * LEARNING THAT PREVENTS (#6801): a postmortem's action items become records,
 * and a verified fix can be saved as a runbook.
 *
 *   - AddIncidentPostmortemActionItem1809173300000 creates the action items'
 *     table, its indexes and its keys. A new table is empty when they are
 *     built, so nothing waits on them.
 *   - AddSavedAsRunbookToAutoRemediationSuggestion1809173400000 adds the
 *     runbook a verified fix was saved as - a nullable column with no
 *     default, so no fix is rewritten - and the migration after it builds
 *     its index and key online, outside a transaction: fixes are written
 *     while incidents and alerts open.
 *
 * Every name is TypeORM's own, so the schema drift check finds nothing to
 * change (run against a real Postgres while this was written). Pure
 * SQL-contract assertions against a fake QueryRunner; OnlineDdl's own steps
 * are recorded as "online: <statement>".
 */

const naming: DefaultNamingStrategy = new DefaultNamingStrategy();
const TABLE: string = "IncidentPostmortemActionItem";

const SAVED_INDEX: string = naming.indexName("AutoRemediationSuggestion", [
  "savedAsRunbookId",
]);
const SAVED_FOREIGN_KEY: string = naming.foreignKeyName(
  "AutoRemediationSuggestion",
  ["savedAsRunbookId"],
  "Runbook",
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

afterEach(() => {
  jest.restoreAllMocks();
});

function registeredNames(): Array<string> {
  return SchemaMigrations.map((migration: unknown): string => {
    return (migration as { name: string }).name;
  });
}

function columnOf(
  target: unknown,
  property: string,
): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage()
    .columns.filter((args: ColumnMetadataArgs) => {
      return args.target === target && args.propertyName === property;
    })
    .pop();
}

function relationOf(
  target: unknown,
  property: string,
): RelationMetadataArgs | undefined {
  return getMetadataArgsStorage()
    .relations.filter((args: RelationMetadataArgs) => {
      return args.target === target && args.propertyName === property;
    })
    .pop();
}

describe("AddIncidentPostmortemActionItem1809173300000", () => {
  test("creates the table with every column the model has, its status open by default", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddIncidentPostmortemActionItem1809173300000().up(runner);
      },
    );

    const create: string | undefined = statements.find(
      (statement: string): boolean => {
        return statement.startsWith(`CREATE TABLE "${TABLE}"`);
      },
    );

    expect(create).toBeDefined();

    for (const column of [
      '"projectId" uuid NOT NULL',
      '"incidentId" uuid NOT NULL',
      '"title" character varying(500) NOT NULL',
      '"description" text',
      `"status" character varying(100) NOT NULL DEFAULT '${PostmortemActionItemStatus.Open}'`,
      '"ownerUserId" uuid',
      '"dueDate" TIMESTAMP WITH TIME ZONE',
      '"closedAt" TIMESTAMP WITH TIME ZONE',
      '"closedByUserId" uuid',
      '"codeTaskId" uuid',
      '"monitorId" uuid',
      '"createdByUserId" uuid',
      '"deletedByUserId" uuid',
    ]) {
      expect(create).toContain(column);
    }
  });

  test("indexes what the pages read by: an incident's items, the project's open ones by due date, an owner's, a task's and a monitor's", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddIncidentPostmortemActionItem1809173300000().up(runner);
      },
    );

    for (const columns of [
      ["projectId"],
      ["incidentId"],
      ["ownerUserId"],
      ["codeTaskId"],
      ["monitorId"],
      ["projectId", "status", "dueDate"],
      ["incidentId", "createdAt"],
    ]) {
      expect(statements).toContain(
        `CREATE INDEX "${naming.indexName(TABLE, columns)}" ON "${TABLE}" (${columns
          .map((column: string): string => {
            return `"${column}"`;
          })
          .join(", ")}) `,
      );
    }
  });

  test("its keys: the project and the incident take their items with them; a person or a monitor going leaves the item", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddIncidentPostmortemActionItem1809173300000().up(runner);
      },
    );

    const key: (column: string, table: string, onDelete: string) => string = (
      column: string,
      table: string,
      onDelete: string,
    ): string => {
      return `ALTER TABLE "${TABLE}" ADD CONSTRAINT "${naming.foreignKeyName(
        TABLE,
        [column],
        table,
        ["_id"],
      )}" FOREIGN KEY ("${column}") REFERENCES "${table}"("_id") ON DELETE ${onDelete} ON UPDATE NO ACTION`;
    };

    expect(statements).toContain(key("projectId", "Project", "CASCADE"));
    expect(statements).toContain(key("incidentId", "Incident", "CASCADE"));
    expect(statements).toContain(key("ownerUserId", "User", "SET NULL"));
    expect(statements).toContain(key("closedByUserId", "User", "SET NULL"));
    expect(statements).toContain(key("monitorId", "Monitor", "SET NULL"));
    expect(statements).toContain(key("createdByUserId", "User", "SET NULL"));
    expect(statements).toContain(key("deletedByUserId", "User", "SET NULL"));
  });

  test("touches no table but its own: nothing to build online", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddIncidentPostmortemActionItem1809173300000().up(runner);
      },
    );

    for (const statement of statements) {
      expect(statement).toMatch(
        new RegExp(
          `^(CREATE TABLE|CREATE INDEX "[^"]+" ON|ALTER TABLE) "?${TABLE}`,
        ),
      );
    }
  });

  test("down() drops the table", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddIncidentPostmortemActionItem1809173300000().down(runner);
      },
    );

    expect(statements[statements.length - 1]).toBe(`DROP TABLE "${TABLE}"`);
  });

  test("is registered after the migration before it, named for its class", () => {
    const names: Array<string> = registeredNames();
    const index: number = names.indexOf(
      "AddIncidentPostmortemActionItem1809173300000",
    );

    expect(index).toBeGreaterThan(-1);
    expect(index).toBeGreaterThan(
      names.indexOf("SetNetworkEndpointFillfactor1809173200000"),
    );
    expect(new AddIncidentPostmortemActionItem1809173300000().name).toBe(
      "AddIncidentPostmortemActionItem1809173300000",
    );
  });
});

describe("AddSavedAsRunbookToAutoRemediationSuggestion1809173400000", () => {
  test("adds the saved runbook's column - nullable, with no default - and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddSavedAsRunbookToAutoRemediationSuggestion1809173400000().up(
          runner,
        );
      }),
    ).toEqual([
      `ALTER TABLE "AutoRemediationSuggestion" ADD "savedAsRunbookId" uuid`,
    ]);
  });

  test("down() takes the column back", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddSavedAsRunbookToAutoRemediationSuggestion1809173400000().down(
          runner,
        );
      }),
    ).toEqual([
      `ALTER TABLE "AutoRemediationSuggestion" DROP COLUMN "savedAsRunbookId"`,
    ]);
  });
});

describe("AddSavedAsRunbookToAutoRemediationSuggestionIndexAndKey1809173410000", () => {
  test("the index and the key are named as TypeORM names them", () => {
    expect(SAVED_INDEX).toBe("IDX_7f6300814c9bba8834a9ce27f8");
    expect(SAVED_FOREIGN_KEY).toBe("FK_7f6300814c9bba8834a9ce27f84");
  });

  test("builds them online, outside a transaction: a runbook going clears the link", async () => {
    const migration: AddSavedAsRunbookToAutoRemediationSuggestionIndexAndKey1809173410000 =
      new AddSavedAsRunbookToAutoRemediationSuggestionIndexAndKey1809173410000();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([
      `online: CREATE INDEX "${SAVED_INDEX}" ON "AutoRemediationSuggestion" ("savedAsRunbookId") `,
      `online: ALTER TABLE "AutoRemediationSuggestion" ADD CONSTRAINT "${SAVED_FOREIGN_KEY}" FOREIGN KEY ("savedAsRunbookId") REFERENCES "Runbook"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    ]);
  });

  test("down() takes the key, then the index, away", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddSavedAsRunbookToAutoRemediationSuggestionIndexAndKey1809173410000().down(
          runner,
        );
      }),
    ).toEqual([
      `ALTER TABLE "AutoRemediationSuggestion" DROP CONSTRAINT "${SAVED_FOREIGN_KEY}"`,
      `online: DROP INDEX "public"."${SAVED_INDEX}"`,
    ]);
  });

  test("the three are registered in order, right after one another, once each", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const at: number = registered.indexOf(
      AddIncidentPostmortemActionItem1809173300000,
    );

    expect(at).toBeGreaterThan(-1);
    expect(registered[at + 1]).toBe(
      AddSavedAsRunbookToAutoRemediationSuggestion1809173400000,
    );
    expect(registered[at + 2]).toBe(
      AddSavedAsRunbookToAutoRemediationSuggestionIndexAndKey1809173410000,
    );

    for (const migration of [
      AddIncidentPostmortemActionItem1809173300000,
      AddSavedAsRunbookToAutoRemediationSuggestion1809173400000,
      AddSavedAsRunbookToAutoRemediationSuggestionIndexAndKey1809173410000,
    ]) {
      expect(
        registered.filter((candidate: unknown): boolean => {
          return candidate === migration;
        }),
      ).toHaveLength(1);
    }
  });
});

describe("the models say the same", () => {
  test("an action item's incident and project are required, everything else is not", () => {
    expect(
      columnOf(IncidentPostmortemActionItem, "incidentId")?.options.nullable,
    ).toBe(false);
    expect(
      columnOf(IncidentPostmortemActionItem, "projectId")?.options.nullable,
    ).toBe(false);

    for (const column of [
      "ownerUserId",
      "dueDate",
      "closedAt",
      "closedByUserId",
      "codeTaskId",
      "monitorId",
    ]) {
      expect(
        columnOf(IncidentPostmortemActionItem, column)?.options.nullable,
      ).toBe(true);
    }

    expect(
      relationOf(IncidentPostmortemActionItem, "incident")?.options.onDelete,
    ).toBe("CASCADE");
    expect(
      relationOf(IncidentPostmortemActionItem, "monitor")?.options.onDelete,
    ).toBe("SET NULL");
  });

  test("a fix's saved runbook: a nullable id, indexed, cleared when the runbook is deleted", () => {
    expect(
      columnOf(AutoRemediationSuggestion, "savedAsRunbookId")?.options.nullable,
    ).toBe(true);

    const indexed: Array<unknown> = getMetadataArgsStorage()
      .indices.filter((index: IndexMetadataArgs) => {
        return index.target === AutoRemediationSuggestion;
      })
      .map((index: IndexMetadataArgs): unknown => {
        return index.columns;
      });

    expect(indexed).toContainEqual(["savedAsRunbookId"]);

    const relation: RelationMetadataArgs | undefined = relationOf(
      AutoRemediationSuggestion,
      "savedAsRunbook",
    );

    expect(relation?.relationType).toBe("many-to-one");
    expect(relation?.options.onDelete).toBe("SET NULL");
  });

  test("a fix's saved runbook is OneUptime's to write: read as the fix's other columns, never written through the API", () => {
    const suggestion: AutoRemediationSuggestion =
      new AutoRemediationSuggestion();

    for (const column of ["savedAsRunbookId", "savedAsRunbook"]) {
      const access: {
        create: Array<unknown>;
        read: Array<unknown>;
        update: Array<unknown>;
      } = suggestion.getColumnAccessControlForAllColumns()[column] as {
        create: Array<unknown>;
        read: Array<unknown>;
        update: Array<unknown>;
      };

      expect(access.create).toEqual([]);
      expect(access.update).toEqual([]);
      expect(access.read).toEqual(
        suggestion.getColumnAccessControlForAllColumns()["runbookId"]?.read,
      );
    }
  });
});
