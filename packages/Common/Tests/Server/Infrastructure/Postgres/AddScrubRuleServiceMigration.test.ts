import LogScrubRule from "../../../../Models/DatabaseModels/LogScrubRule";
import TraceScrubRule from "../../../../Models/DatabaseModels/TraceScrubRule";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddScrubRuleService1809187433000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187433000-AddScrubRuleService";
import { AddScrubRuleServiceIndexesAndKeys1809187433010 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187433010-AddScrubRuleServiceIndexesAndKeys";
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
 * A SCRUB RULE CAN NAME THE SERVICE IT IS FOR (#10433).
 *
 * LogScrubRule.serviceId and TraceScrubRule.serviceId: Scrub It makes its
 * rule for the service a finding was seen in, so the rule hides data in
 * that service's records and no other's. One nullable column on each
 * table, an index and a foreign key, named as TypeORM names them, so the
 * schema drift check finds nothing to change. No row is rewritten, and
 * every rule saved before keeps scrubbing every service: its column is
 * null.
 *
 * The indexes and keys are built online, in a migration of their own
 * outside a transaction (OnlineDdl): ingest reads both tables for every
 * project, and the keys point at "Service". A rule goes with its service
 * (ON DELETE CASCADE), as a metric pipeline rule for a service does.
 *
 * Pure SQL-contract assertions against a fake QueryRunner; OnlineDdl's own
 * steps are recorded as "online: <statement>".
 */

const naming: DefaultNamingStrategy = new DefaultNamingStrategy();
const TABLES: Array<{
  table: string;
  model: typeof LogScrubRule | typeof TraceScrubRule;
}> = [
  { table: "LogScrubRule", model: LogScrubRule },
  { table: "TraceScrubRule", model: TraceScrubRule },
];

function indexOf(table: string): string {
  return naming.indexName(table, ["serviceId"]);
}

function foreignKeyOf(table: string): string {
  return naming.foreignKeyName(table, ["serviceId"], "Service", ["_id"]);
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

describe("AddScrubRuleService1809187433000", () => {
  test("adds each table's service column - and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddScrubRuleService1809187433000().up(runner);
      }),
    ).toEqual([
      `ALTER TABLE "LogScrubRule" ADD "serviceId" uuid`,
      `ALTER TABLE "TraceScrubRule" ADD "serviceId" uuid`,
    ]);
  });

  test("never rewrites a table: the column is nullable, with no default", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddScrubRuleService1809187433000().up(runner);
      },
    );

    for (const statement of statements) {
      expect(statement).not.toContain("DEFAULT");
      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toMatch(UPDATE_STATEMENT);
    }
  });

  test("down() takes back exactly what up() added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddScrubRuleService1809187433000().down(runner);
      }),
    ).toEqual([
      `ALTER TABLE "TraceScrubRule" DROP COLUMN "serviceId"`,
      `ALTER TABLE "LogScrubRule" DROP COLUMN "serviceId"`,
    ]);
  });

  test("is registered after the migrations before it, and named for its class", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );
    const index: number = names.indexOf("AddScrubRuleService1809187433000");

    expect(index).toBeGreaterThan(-1);
    expect(index).toBeGreaterThan(
      names.indexOf("AddRecordCreatedByAndLastModifiedColumns1809187400000"),
    );
    expect(new AddScrubRuleService1809187433000().name).toBe(
      "AddScrubRuleService1809187433000",
    );
  });
});

describe("AddScrubRuleServiceIndexesAndKeys1809187433010", () => {
  test("the indexes and keys are named as TypeORM names them: the drift check finds nothing", () => {
    expect(indexOf("LogScrubRule")).toBe("IDX_e21d8142d41e585ea419860bb5");
    expect(foreignKeyOf("LogScrubRule")).toBe(
      "FK_e21d8142d41e585ea419860bb56",
    );
    expect(indexOf("TraceScrubRule")).toBe("IDX_d8851036215e003ce8d6a5a7f1");
    expect(foreignKeyOf("TraceScrubRule")).toBe(
      "FK_d8851036215e003ce8d6a5a7f1f",
    );
  });

  test("builds each index and key online, outside a transaction; a rule goes with its service", async () => {
    const migration: AddScrubRuleServiceIndexesAndKeys1809187433010 =
      new AddScrubRuleServiceIndexesAndKeys1809187433010();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([
      `online: CREATE INDEX "${indexOf("LogScrubRule")}" ON "LogScrubRule" ("serviceId") `,
      `online: CREATE INDEX "${indexOf("TraceScrubRule")}" ON "TraceScrubRule" ("serviceId") `,
      `online: ALTER TABLE "LogScrubRule" ADD CONSTRAINT "${foreignKeyOf("LogScrubRule")}" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
      `online: ALTER TABLE "TraceScrubRule" ADD CONSTRAINT "${foreignKeyOf("TraceScrubRule")}" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    ]);
  });

  test("down() takes the keys, then the indexes, away", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddScrubRuleServiceIndexesAndKeys1809187433010().down(
          runner,
        );
      }),
    ).toEqual([
      `ALTER TABLE "TraceScrubRule" DROP CONSTRAINT "${foreignKeyOf("TraceScrubRule")}"`,
      `ALTER TABLE "LogScrubRule" DROP CONSTRAINT "${foreignKeyOf("LogScrubRule")}"`,
      `online: DROP INDEX "public"."${indexOf("TraceScrubRule")}"`,
      `online: DROP INDEX "public"."${indexOf("LogScrubRule")}"`,
    ]);
  });

  test("is registered right after the columns' migration, once, named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const at: number = registered.indexOf(AddScrubRuleService1809187433000);

    expect(at).toBeGreaterThan(-1);
    expect(registered[at + 1]).toBe(
      AddScrubRuleServiceIndexesAndKeys1809187433010,
    );
    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddScrubRuleServiceIndexesAndKeys1809187433010;
      }),
    ).toHaveLength(1);
  });
});

describe("the scrub rule models say the same", () => {
  test.each(TABLES)(
    "$table: a nullable service id, indexed, deleted with its service",
    ({ model }: { table: string; model: typeof LogScrubRule }) => {
      const column: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
        .columns.filter((args: ColumnMetadataArgs) => {
          return args.target === model && args.propertyName === "serviceId";
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

      expect(indexed).toContainEqual(["serviceId"]);

      const relation: RelationMetadataArgs | undefined =
        getMetadataArgsStorage()
          .relations.filter((args: RelationMetadataArgs) => {
            return args.target === model && args.propertyName === "service";
          })
          .pop();

      expect(relation?.relationType).toBe("many-to-one");
      expect(relation?.options.onDelete).toBe("CASCADE");
      expect(relation?.options.nullable).toBe(true);
    },
  );

  test.each(TABLES)(
    "$table: written and read as the rule's other columns are",
    ({ model }: { table: string; model: typeof LogScrubRule }) => {
      const rule: LogScrubRule = new model();

      for (const column of ["serviceId", "service"]) {
        expect(rule.getColumnAccessControlForAllColumns()[column]).toEqual(
          rule.getColumnAccessControlForAllColumns()["fieldsToScrub"],
        );
      }
    },
  );
});
