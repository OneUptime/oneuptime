import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import OnlineDdl, {
  OnlineIndex,
} from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddAlertAndIncidentListIndexes1809169000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809169000000-AddAlertAndIncidentListIndexes";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE ALERTS AND INCIDENTS LISTS READ THEIR PAGE IN INDEX ORDER.
 *
 * Both lists read newest first - the order every read of them takes when
 * it asks for none (DatabaseService.getReadSort) - and both are live. With
 * no index in that order Postgres read every record of the project and
 * sorted them to keep ten. ("projectId", "createdAt") hands the page over
 * in order, and leads with "projectId" as the bare index it replaces did,
 * so that one went: one index write fewer on every insert and state change.
 *
 * Pure SQL-contract assertions against a fake QueryRunner; OnlineDdl's own
 * steps are recorded as "online: <statement>". The names are TypeORM's own,
 * so the drift check finds nothing to change.
 * AddAlertAndIncidentListIndexesPostgres.test.ts holds the plans on a real
 * Postgres.
 */

const namingStrategy: DefaultNamingStrategy = new DefaultNamingStrategy();

const ALERT_LIST_INDEX: string = namingStrategy.indexName("Alert", [
  "projectId",
  "createdAt",
]);
const INCIDENT_LIST_INDEX: string = namingStrategy.indexName("Incident", [
  "projectId",
  "createdAt",
]);
const ALERT_PROJECT_INDEX: string = namingStrategy.indexName("Alert", [
  "projectId",
]);
const INCIDENT_PROJECT_INDEX: string = namingStrategy.indexName("Incident", [
  "projectId",
]);

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
  options: { isTransactionActive: boolean },
): Promise<Array<string>> {
  const statements: Array<string> = [];

  for (const step of ["createIndex", "dropIndex"] as const) {
    jest.spyOn(OnlineDdl, step).mockImplementation((async (
      _runner: QueryRunner,
      statement: string,
    ) => {
      statements.push(`online: ${statement}`);
    }) as never);
  }

  await run({
    isTransactionActive: options.isTransactionActive,
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

describe("AddAlertAndIncidentListIndexes1809169000000", () => {
  test("the indexes are named as TypeORM names them", () => {
    expect(ALERT_LIST_INDEX).toBe("IDX_c8cf4648f795d5de4ac54adbcf");
    expect(INCIDENT_LIST_INDEX).toBe("IDX_fe5d23f2b3b026877c45c14027");
    // The bare indexes, as the migrations that made them named them.
    expect(ALERT_PROJECT_INDEX).toBe("IDX_3e36243cde1e1a428f6849b04a");
    expect(INCIDENT_PROJECT_INDEX).toBe("IDX_eccbc31fa1f58bd051b6f7e108");
  });

  test("builds both list indexes before dropping either bare one, all online, outside a transaction", async () => {
    const migration: AddAlertAndIncidentListIndexes1809169000000 =
      new AddAlertAndIncidentListIndexes1809169000000();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf(
        (runner: QueryRunner) => {
          return migration.up(runner);
        },
        { isTransactionActive: false },
      ),
    ).toEqual([
      `online: CREATE INDEX "${ALERT_LIST_INDEX}" ON "Alert" ("projectId", "createdAt") `,
      `online: CREATE INDEX "${INCIDENT_LIST_INDEX}" ON "Incident" ("projectId", "createdAt") `,
      `online: DROP INDEX "public"."${ALERT_PROJECT_INDEX}"`,
      `online: DROP INDEX "public"."${INCIDENT_PROJECT_INDEX}"`,
    ]);
  });

  test.each([
    ["Alert", ALERT_LIST_INDEX],
    ["Incident", INCIDENT_LIST_INDEX],
  ])(
    "OnlineDdl reads the %s build as one it can run concurrently",
    (table: string, name: string) => {
      const parsed: OnlineIndex = OnlineDdl.parseCreateIndex(
        `CREATE INDEX "${name}" ON "${table}" ("projectId", "createdAt") `,
      );

      expect(parsed.name).toBe(name);
      expect(parsed.quotedTable).toBe(`"${table}"`);
      expect(parsed.build).toBe(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${name}" ON "${table}" ("projectId", "createdAt")`,
      );
    },
  );

  test("down() puts the bare indexes back before the list indexes go", async () => {
    expect(
      await statementsOf(
        (runner: QueryRunner) => {
          return new AddAlertAndIncidentListIndexes1809169000000().down(
            runner,
          );
        },
        { isTransactionActive: true },
      ),
    ).toEqual([
      `CREATE INDEX "${INCIDENT_PROJECT_INDEX}" ON "Incident" ("projectId") `,
      `CREATE INDEX "${ALERT_PROJECT_INDEX}" ON "Alert" ("projectId") `,
      `online: DROP INDEX "public"."${INCIDENT_LIST_INDEX}"`,
      `online: DROP INDEX "public"."${ALERT_LIST_INDEX}"`,
    ]);
  });

  test("is registered once, after the migrations before it, and named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const names: Array<string> = registered.map((migration: unknown) => {
      return (migration as { name: string }).name;
    });

    expect(
      registered.filter((candidate: unknown): boolean => {
        return candidate === AddAlertAndIncidentListIndexes1809169000000;
      }),
    ).toHaveLength(1);
    expect(
      names.indexOf("AddAlertAndIncidentListIndexes1809169000000"),
    ).toBeGreaterThan(
      names.indexOf("AddTeamMemberUserProjectIndex1809168000000"),
    );
    expect(new AddAlertAndIncidentListIndexes1809169000000().name).toBe(
      "AddAlertAndIncidentListIndexes1809169000000",
    );
  });
});

describe.each([
  ["Alert", Alert],
  ["Incident", Incident],
])("the %s model says the same", (_name: string, model: unknown) => {
  function declared(): Array<IndexMetadataArgs> {
    return getMetadataArgsStorage().indices.filter(
      (index: IndexMetadataArgs): boolean => {
        return index.target === model;
      },
    );
  }

  function columnsOf(index: IndexMetadataArgs): Array<string> {
    if (!Array.isArray(index.columns)) {
      throw new Error("An index declares its columns as a function; list them.");
    }
    return index.columns as Array<string>;
  }

  test("the list has its index, newest first by project, over every row", () => {
    expect(
      declared().filter((index: IndexMetadataArgs): boolean => {
        return (
          columnsOf(index).join(",") === "projectId,createdAt" &&
          !index.where &&
          !index.unique
        );
      }),
    ).toHaveLength(1);
  });

  test("projectId has no bare index of its own", () => {
    expect(
      declared().filter((index: IndexMetadataArgs): boolean => {
        return columnsOf(index).join(",") === "projectId";
      }),
    ).toEqual([]);
  });

  test("no full index repeats the leading columns of another", () => {
    const full: Array<Array<string>> = declared()
      .filter((index: IndexMetadataArgs): boolean => {
        return !index.where && !index.unique;
      })
      .map(columnsOf);
    const redundant: Array<string> = [];

    for (const index of full) {
      for (const other of full) {
        if (
          index !== other &&
          index.length < other.length &&
          index.every((column: string, position: number): boolean => {
            return other[position] === column;
          })
        ) {
          redundant.push(`(${index.join(", ")}) of (${other.join(", ")})`);
        }
      }
    }

    expect(redundant).toEqual([]);
  });
});
