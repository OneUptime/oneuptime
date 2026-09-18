import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodePublicNote from "../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import { AddHotQueryIndexes1785140242697 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1785140242697-AddHotQueryIndexes";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { describe, expect, test } from "@jest/globals";

/*
 * The 13 columns below are the filter columns of ~13 EVERY_MINUTE worker
 * queries (the on-call executor crons scan OnCallDutyPolicyExecutionLog.status,
 * the every-30s heartbeat crons branch on Monitor.monitorType, and the 11
 * subscriberNotificationStatus* columns map 1:1 to the EVERY_MINUTE
 * SendNotificationToSubscribers jobs that poll ever-growing tables for
 * usually-zero Pending rows). Before AddHotQueryIndexes1785140242697 every one
 * of those queries was a full-table seq scan.
 *
 * These tests pin the three pieces that must all hold for the scans to stay
 * gone — a regression in ANY one silently reintroduces them:
 *   1. the @Index() decorator on each entity property (keeps future
 *      schema:generate runs from emitting a DROP INDEX as "drift"),
 *   2. the migration's SQL contract: up() creates exactly these 13 indexes
 *      and nothing else (no ALTER TABLE drift statements from a regenerated
 *      migration), down() drops exactly the indexes up() created,
 *   3. the migration's registration in SchemaMigrations/Index.ts (an
 *      unregistered migration is dead code and never runs on boot).
 *
 * Pure metadata/mocks — no Postgres connection anywhere.
 */

type ModelClass = { new (): unknown };

// [entity class, table name (=== class name for all of these), indexed column]
const HOT_INDEX_PAIRS: Array<[ModelClass, string, string]> = [
  [Monitor, "Monitor", "monitorType"],
  [OnCallDutyPolicyExecutionLog, "OnCallDutyPolicyExecutionLog", "status"],
  [
    IncidentStateTimeline,
    "IncidentStateTimeline",
    "subscriberNotificationStatus",
  ],
  [Incident, "Incident", "subscriberNotificationStatusOnIncidentCreated"],
  [Incident, "Incident", "subscriberNotificationStatusOnPostmortemPublished"],
  [
    IncidentPublicNote,
    "IncidentPublicNote",
    "subscriberNotificationStatusOnNoteCreated",
  ],
  [
    IncidentEpisode,
    "IncidentEpisode",
    "subscriberNotificationStatusOnEpisodeCreated",
  ],
  [
    IncidentEpisodeStateTimeline,
    "IncidentEpisodeStateTimeline",
    "subscriberNotificationStatus",
  ],
  [
    IncidentEpisodePublicNote,
    "IncidentEpisodePublicNote",
    "subscriberNotificationStatusOnNoteCreated",
  ],
  [
    ScheduledMaintenance,
    "ScheduledMaintenance",
    "subscriberNotificationStatusOnEventScheduled",
  ],
  [
    ScheduledMaintenanceStateTimeline,
    "ScheduledMaintenanceStateTimeline",
    "subscriberNotificationStatus",
  ],
  [
    ScheduledMaintenancePublicNote,
    "ScheduledMaintenancePublicNote",
    "subscriberNotificationStatusOnNoteCreated",
  ],
  [
    StatusPageAnnouncement,
    "StatusPageAnnouncement",
    "subscriberNotificationStatus",
  ],
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
    {},
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

describe("AddHotQueryIndexes: entity @Index() decorators", () => {
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

describe("AddHotQueryIndexes1785140242697 migration SQL contract", () => {
  const migration: AddHotQueryIndexes1785140242697 =
    new AddHotQueryIndexes1785140242697();

  test("up() issues exactly 13 CREATE INDEX statements covering exactly the 13 hot columns — and nothing else", async () => {
    const { runner, query } = makeQueryRunner();
    await migration.up(runner);

    const statements: Array<string> = executedSql(query);
    expect(statements).toHaveLength(13);

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

  test("down() drops exactly the 13 indexes up() created", async () => {
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
    expect(statements).toHaveLength(13);

    const droppedNames: Array<string> = statements.map((sql: string) => {
      expect(sql).toMatch(DROP_INDEX_REGEX);
      return (sql.match(DROP_INDEX_REGEX) as RegExpMatchArray)[1] as string;
    });

    expect([...droppedNames].sort()).toEqual([...createdNames].sort());
  });
});

describe("AddHotQueryIndexes1785140242697 registration", () => {
  test("is registered in SchemaMigrations/Index.ts so it actually runs on boot", () => {
    expect(SchemaMigrations).toContain(AddHotQueryIndexes1785140242697);
  });
});
