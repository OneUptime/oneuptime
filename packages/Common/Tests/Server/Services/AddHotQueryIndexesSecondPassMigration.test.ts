import DashboardDomain from "../../../Models/DatabaseModels/DashboardDomain";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import WorkspaceNotificationSummary from "../../../Models/DatabaseModels/WorkspaceNotificationSummary";
import { AddHotQueryIndexesSecondPass1785148065137 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1785148065137-AddHotQueryIndexesSecondPass";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { createHash } from "node:crypto";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { describe, expect, test } from "@jest/globals";

/*
 * The 8 columns below are the filter columns of hot recurring lookups that were
 * full-table seq scans before AddHotQueryIndexesSecondPass1785148065137:
 *   - StatusPageDomain.fullDomain / DashboardDomain.fullDomain: resolved on
 *     EVERY public request to a custom-domain status page or dashboard (the
 *     Host header is looked up by fullDomain to find the page to serve),
 *   - StatusPage.sendNextReportBy: the EVERY_MINUTE status-page report cron
 *     sweeps for pages whose next report is due,
 *   - OnCallDutyPolicySchedule.rosterHandoffAt / rosterNextStartAt: the
 *     EVERY_MINUTE on-call roster crons sweep for schedules due a handoff or
 *     a roster start,
 *   - WorkspaceNotificationSummary.nextSendAt: the workspace notification
 *     digest cron sweeps for summaries due to send,
 *   - ScheduledMaintenanceTemplate.scheduleNextEventAt: the recurring
 *     scheduled-maintenance cron sweeps for templates due to spawn an event,
 *   - NetworkSite.lastRollupAt: the network-site rollup cron sweeps for sites
 *     due a metrics rollup.
 *
 * These tests pin the pieces that must all hold for the scans to stay gone —
 * a regression in ANY one silently reintroduces them:
 *   1. the @Index() decorator on each entity property (keeps future
 *      schema:generate runs from emitting a DROP INDEX as "drift"),
 *   2. the migration's SQL contract: up() creates exactly these 8 indexes
 *      and nothing else (no ALTER TABLE drift statements from a regenerated
 *      migration), down() drops exactly the indexes up() created,
 *   3. each index NAME equals TypeORM's deterministic derivation
 *      "IDX_" + sha1(tableName + "_" + columnName) truncated to 26 hex chars,
 *      so the hand-written migration creates the SAME index a schema:generate
 *      run would derive from the decorators (a name mismatch would make a
 *      future generated migration drop and recreate the index as drift),
 *   4. the migration's registration in SchemaMigrations/Index.ts (an
 *      unregistered migration is dead code and never runs on boot).
 *
 * Pure metadata/mocks — no Postgres connection anywhere.
 */

type ModelClass = { new (): unknown };

// [entity class, table name (=== class name for all of these), indexed column]
const HOT_INDEX_PAIRS: Array<[ModelClass, string, string]> = [
  [StatusPageDomain, "StatusPageDomain", "fullDomain"],
  [DashboardDomain, "DashboardDomain", "fullDomain"],
  [StatusPage, "StatusPage", "sendNextReportBy"],
  [OnCallDutyPolicySchedule, "OnCallDutyPolicySchedule", "rosterHandoffAt"],
  [OnCallDutyPolicySchedule, "OnCallDutyPolicySchedule", "rosterNextStartAt"],
  [WorkspaceNotificationSummary, "WorkspaceNotificationSummary", "nextSendAt"],
  [
    ScheduledMaintenanceTemplate,
    "ScheduledMaintenanceTemplate",
    "scheduleNextEventAt",
  ],
  [NetworkSite, "NetworkSite", "lastRollupAt"],
];

/*
 * IndexMetadataArgs.columns is either an array of property names (property-
 * level @Index()) or a function over the entity's properties map (class-level
 * @Index((o) => [o.a, o.b])). Resolve both to plain property-name arrays; the
 * function form is fed a proxy whose every property reads as its own name,
 * which is exactly how TypeORM's propertiesMap behaves for flat columns.
 */
function resolveIndexColumns(
  columns: IndexMetadataArgs["columns"],
): Array<string> {
  if (!columns) {
    return [];
  }
  if (Array.isArray(columns)) {
    return columns.map(String);
  }
  const propertiesMap: Record<string, string> = new Proxy(
    {} as Record<string, string>,
    {
      get: (_target: Record<string, string>, property: string | symbol) => {
        return String(property);
      },
    },
  );
  const resolved: Array<unknown> | { [key: string]: number } =
    columns(propertiesMap);
  if (Array.isArray(resolved)) {
    return resolved.map(String);
  }
  return Object.keys(resolved);
}

/*
 * TypeORM's DefaultNamingStrategy.indexName: "IDX_" + the first 26 hex chars
 * of sha1(`${tableName}_${columnName}`) for a single-column index.
 */
function typeormIndexName(tableName: string, columnName: string): string {
  const hash: string = createHash("sha1")
    .update(`${tableName}_${columnName}`)
    .digest("hex");
  return `IDX_${hash.substring(0, 26)}`;
}

interface CreateIndexStatement {
  indexName: string;
  tableName: string;
  columnName: string;
}

const CREATE_INDEX_REGEX: RegExp =
  /^CREATE INDEX "([^"]+)" ON "([^"]+)" \("([^"]+)"\)\s*$/;
const DROP_INDEX_REGEX: RegExp = /^DROP INDEX "public"\."([^"]+)"$/;

function makeQueryRunner(): { runner: QueryRunner; query: jest.Mock } {
  const query: jest.Mock = jest.fn().mockResolvedValue(undefined);
  return { runner: { query } as unknown as QueryRunner, query };
}

function executedSql(query: jest.Mock): Array<string> {
  return query.mock.calls.map((call: Array<unknown>) => {
    return String(call[0]);
  });
}

describe("AddHotQueryIndexesSecondPass: entity @Index() decorators", () => {
  test.each(
    HOT_INDEX_PAIRS.map(
      ([model, table, column]: [ModelClass, string, string]) => {
        return [table, column, model] as [string, string, ModelClass];
      },
    ),
  )(
    "%s.%s has a single-column index decorator",
    (_table: string, column: string, model: ModelClass) => {
      const singleColumnIndexes: Array<string> = getMetadataArgsStorage()
        .indices.filter((index: IndexMetadataArgs) => {
          return index.target === model;
        })
        .map((index: IndexMetadataArgs) => {
          return resolveIndexColumns(index.columns);
        })
        .filter((columns: Array<string>) => {
          return columns.length === 1;
        })
        .map((columns: Array<string>) => {
          return columns[0] as string;
        });

      expect(singleColumnIndexes).toContain(column);
    },
  );
});

describe("AddHotQueryIndexesSecondPass1785148065137 migration SQL contract", () => {
  const migration: AddHotQueryIndexesSecondPass1785148065137 =
    new AddHotQueryIndexesSecondPass1785148065137();

  test("up() issues exactly 8 CREATE INDEX statements covering exactly the 8 hot columns — and nothing else", async () => {
    const { runner, query } = makeQueryRunner();
    await migration.up(runner);

    const statements: Array<string> = executedSql(query);
    expect(statements).toHaveLength(8);

    /*
     * A regenerated migration on a drifted schema would interleave ALTER
     * TABLE / DROP statements with the index creates; none may sneak in.
     */
    for (const sql of statements) {
      expect(sql).not.toContain("ALTER TABLE");
      expect(sql).not.toContain("DROP");
      expect(sql).toMatch(CREATE_INDEX_REGEX);
    }

    const created: Array<CreateIndexStatement> = statements.map(
      (sql: string) => {
        const match: RegExpMatchArray = sql.match(
          CREATE_INDEX_REGEX,
        ) as RegExpMatchArray;
        return {
          indexName: match[1] as string,
          tableName: match[2] as string,
          columnName: match[3] as string,
        };
      },
    );

    const createdPairs: Array<string> = created
      .map((statement: CreateIndexStatement) => {
        return `"${statement.tableName}"."${statement.columnName}"`;
      })
      .sort();
    const expectedPairs: Array<string> = HOT_INDEX_PAIRS.map(
      ([, table, column]: [ModelClass, string, string]) => {
        return `"${table}"."${column}"`;
      },
    ).sort();

    expect(createdPairs).toEqual(expectedPairs);
  });

  test("every index name matches TypeORM's deterministic sha1 derivation from (table, column)", async () => {
    const { runner, query } = makeQueryRunner();
    await migration.up(runner);

    const statements: Array<string> = executedSql(query);
    for (const sql of statements) {
      const match: RegExpMatchArray = sql.match(
        CREATE_INDEX_REGEX,
      ) as RegExpMatchArray;
      const indexName: string = match[1] as string;
      const tableName: string = match[2] as string;
      const columnName: string = match[3] as string;

      expect(indexName).toBe(typeormIndexName(tableName, columnName));
    }
  });

  test("down() drops exactly the 8 indexes up() created", async () => {
    const upRunner: { runner: QueryRunner; query: jest.Mock } =
      makeQueryRunner();
    await migration.up(upRunner.runner);
    const createdNames: Array<string> = executedSql(upRunner.query).map(
      (sql: string) => {
        return (sql.match(CREATE_INDEX_REGEX) as RegExpMatchArray)[1] as string;
      },
    );

    const downRunner: { runner: QueryRunner; query: jest.Mock } =
      makeQueryRunner();
    await migration.down(downRunner.runner);
    const statements: Array<string> = executedSql(downRunner.query);
    expect(statements).toHaveLength(8);

    const droppedNames: Array<string> = statements.map((sql: string) => {
      expect(sql).toMatch(DROP_INDEX_REGEX);
      return (sql.match(DROP_INDEX_REGEX) as RegExpMatchArray)[1] as string;
    });

    expect([...droppedNames].sort()).toEqual([...createdNames].sort());
  });
});

describe("AddHotQueryIndexesSecondPass1785148065137 registration", () => {
  test("is registered in SchemaMigrations/Index.ts so it actually runs on boot", () => {
    expect(SchemaMigrations).toContain(
      AddHotQueryIndexesSecondPass1785148065137,
    );
  });
});
