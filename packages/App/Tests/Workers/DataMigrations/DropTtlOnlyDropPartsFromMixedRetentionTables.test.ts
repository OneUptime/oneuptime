import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ttl_only_drop_parts drops a part only once EVERY row in it has expired, and
 * the partitions of the metric tables and of the log table hold rows with
 * different retentions side by side (telemetry next to monitor metrics,
 * severities with their own overrides). With the setting on, the longest-lived
 * row keeps the rest of its part on disk - on one install, until the disk
 * filled. The models no longer declare it; this migration clears it on the
 * tables that were created with it.
 *
 * What is pinned:
 *
 *   - which tables it clears, and that they are the models' own tables, none
 *     of which declares the setting any more;
 *   - the statement: the local storage table (where the setting lives), ON
 *     CLUSTER (a settings change is not replicated through Keeper - every
 *     replica has to apply it itself), the setting set to 0 and nothing else,
 *     through the migration connection;
 *   - a table that does not exist is skipped, every table is tried even
 *     after one fails, and then the migration fails naming the table - a
 *     migration that returns is recorded as done, and a table left with the
 *     setting keeps filling the disk;
 *   - it is safe to run again, its rollback does nothing, it runs on the
 *     clustered schema instead of being baselined, and it runs after the
 *     migration that used to set the setting.
 *
 * DropTtlOnlyDropPartsFromMixedRetentionTablesClickhouse.test.ts runs it
 * against a real ClickHouse server.
 */

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { execute: jest.fn() },
  };
});

jest.mock(
  "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil",
  () => {
    return {
      __esModule: true,
      default: { tableExists: jest.fn() },
    };
  },
);

import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "Common/Models/AnalyticsModels/Log";
import Metric from "Common/Models/AnalyticsModels/Metric";
import MetricItemAggMV1m from "Common/Models/AnalyticsModels/MetricItemAggMV1m";
import { MigrationExecuteOptions } from "Common/Server/Services/AnalyticsDatabaseService";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";
import {
  RETENTION_TTL_ROUNDED_UP_TO_DAY,
  RETENTION_TTL_ROUNDED_UP_TO_EVENT_DAY,
} from "Common/Types/AnalyticsDatabase/RetentionTtl";
import AddTtlOnlyDropPartsToTelemetryV3 from "../../../FeatureSet/Workers/DataMigrations/AddTtlOnlyDropPartsToTelemetryV3";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import DataMigrationBase from "../../../FeatureSet/Workers/DataMigrations/DataMigrationBase";
import DropTtlOnlyDropPartsFromMixedRetentionTables, {
  MIXED_RETENTION_TELEMETRY_TABLES,
} from "../../../FeatureSet/Workers/DataMigrations/DropTtlOnlyDropPartsFromMixedRetentionTables";

type MockFunction = ReturnType<typeof jest.fn>;
type MockSpy = ReturnType<typeof jest.spyOn>;

const metricService: { execute: MockFunction } = MetricService as unknown as {
  execute: MockFunction;
};

const migrationUtil: { tableExists: MockFunction } =
  ClickHouseMigrationUtil as unknown as { tableExists: MockFunction };

const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";

const MIGRATION_NAME: string = "DropTtlOnlyDropPartsFromMixedRetentionTables";

const EXPECTED_STATEMENTS: Array<string> = [
  "ALTER TABLE MetricItemV3Local ON CLUSTER 'oneuptime' MODIFY SETTING ttl_only_drop_parts = 0",
  "ALTER TABLE MetricItemAggMV1mLocal ON CLUSTER 'oneuptime' MODIFY SETTING ttl_only_drop_parts = 0",
  "ALTER TABLE LogItemV3Local ON CLUSTER 'oneuptime' MODIFY SETTING ttl_only_drop_parts = 0",
];

type ModelType = { new (): AnalyticsBaseModel };

const MODELS: Array<{ tableName: string; modelType: ModelType }> = [
  { tableName: "MetricItemV3", modelType: Metric },
  { tableName: "MetricItemAggMV1m", modelType: MetricItemAggMV1m },
  { tableName: "LogItemV3", modelType: Log },
];

let savedClusterName: string | undefined;
let missingTables: Set<string>;
let tablesWhoseExistenceCheckFails: Map<string, unknown>;
let tablesWhoseAlterFails: Map<string, unknown>;
let events: Array<string>;
let infoSpy: MockSpy;
let errorSpy: MockSpy;

// The statements the migration issued, in order.
function executedStatements(): Array<string> {
  return metricService.execute.mock.calls.map((call: Array<unknown>) => {
    return call[0] as string;
  });
}

// The local table an ALTER statement targets.
function tableOf(statement: string): string {
  return statement.split(" ")[2] || "";
}

function loggedMessages(spy: MockSpy): Array<string> {
  return spy.mock.calls.map((call: Array<unknown>): string => {
    return typeof call[0] === "string" ? call[0] : String(call[0]);
  });
}

async function migrationError(): Promise<Error> {
  try {
    await new DropTtlOnlyDropPartsFromMixedRetentionTables().migrate();
  } catch (err) {
    return err as Error;
  }

  throw new Error("expected the migration to fail");
}

beforeEach(() => {
  savedClusterName = process.env[CLUSTER_ENV_KEY];
  delete process.env[CLUSTER_ENV_KEY];

  missingTables = new Set<string>();
  tablesWhoseExistenceCheckFails = new Map<string, unknown>();
  tablesWhoseAlterFails = new Map<string, unknown>();
  events = [];

  metricService.execute.mockReset();
  metricService.execute.mockImplementation(
    async (statement: unknown): Promise<void> => {
      const table: string = tableOf(statement as string);
      events.push(`alter ${table}`);

      if (tablesWhoseAlterFails.has(table)) {
        throw tablesWhoseAlterFails.get(table);
      }
    },
  );

  migrationUtil.tableExists.mockReset();
  migrationUtil.tableExists.mockImplementation(
    async (table: unknown): Promise<boolean> => {
      events.push(`exists ${table as string}`);

      if (tablesWhoseExistenceCheckFails.has(table as string)) {
        throw tablesWhoseExistenceCheckFails.get(table as string);
      }

      return !missingTables.has(table as string);
    },
  );

  infoSpy = jest.spyOn(logger, "info").mockImplementation(() => {
    return undefined;
  });
  errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  if (savedClusterName === undefined) {
    delete process.env[CLUSTER_ENV_KEY];
  } else {
    process.env[CLUSTER_ENV_KEY] = savedClusterName;
  }

  infoSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("DropTtlOnlyDropPartsFromMixedRetentionTables", () => {
  describe("what it is", () => {
    test("is a data migration recorded under its own name", () => {
      const migration: DropTtlOnlyDropPartsFromMixedRetentionTables =
        new DropTtlOnlyDropPartsFromMixedRetentionTables();

      expect(migration).toBeInstanceOf(DataMigrationBase);

      // The runner records it by this name: renaming it would run it again.
      expect(migration.name).toBe(MIGRATION_NAME);
    });

    test("runs on the clustered schema instead of being baselined", () => {
      /*
       * The analytics schema is always a cluster, and the runner records a
       * migration that opts out as executed without running it - which
       * would leave every existing install exactly as broken as it is.
       */
      expect(
        new DropTtlOnlyDropPartsFromMixedRetentionTables().runsInClusterMode(),
      ).toBe(true);
    });

    test("clears exactly the metric tables and the log table", () => {
      expect(MIXED_RETENTION_TELEMETRY_TABLES).toEqual([
        "MetricItemV3",
        "MetricItemAggMV1m",
        "LogItemV3",
      ]);
    });

    test.each(MODELS)(
      "names $tableName as its model does",
      ({
        tableName,
        modelType,
      }: {
        tableName: string;
        modelType: ModelType;
      }) => {
        expect(new modelType().tableName).toBe(tableName);
        expect(MIXED_RETENTION_TELEMETRY_TABLES).toContain(tableName);
      },
    );

    test.each(MODELS)(
      "clears $tableName, whose model no longer declares the setting - so a repaired install ends up like a fresh one",
      ({ modelType }: { tableName: string; modelType: ModelType }) => {
        const model: AnalyticsBaseModel = new modelType();

        expect(model.tableSettings).not.toContain("ttl_only_drop_parts");

        /*
         * The rows still expire by retentionDate - one at a time now, not a
         * whole part at once, rounded up to the day since
         * RoundTtlToDayOnMixedRetentionTables.
         */
        expect([
          RETENTION_TTL_ROUNDED_UP_TO_DAY,
          RETENTION_TTL_ROUNDED_UP_TO_EVENT_DAY,
        ]).toContain(model.ttlExpression);
      },
    );
  });

  describe("the statements", () => {
    test("set ttl_only_drop_parts to 0 on each local storage table, ON CLUSTER", async () => {
      await new DropTtlOnlyDropPartsFromMixedRetentionTables().migrate();

      expect(executedStatements()).toEqual(EXPECTED_STATEMENTS);
    });

    test("are what getStatement renders for each table", async () => {
      await new DropTtlOnlyDropPartsFromMixedRetentionTables().migrate();

      expect(executedStatements()).toEqual(
        MIXED_RETENTION_TELEMETRY_TABLES.map((table: string): string => {
          return DropTtlOnlyDropPartsFromMixedRetentionTables.getStatement(
            table,
          );
        }),
      );
    });

    test("never alter the Distributed table the app writes through", async () => {
      await new DropTtlOnlyDropPartsFromMixedRetentionTables().migrate();

      for (const statement of executedStatements()) {
        expect(tableOf(statement)).toMatch(/Local$/);

        for (const table of MIXED_RETENTION_TELEMETRY_TABLES) {
          expect(statement).not.toContain(`ALTER TABLE ${table} `);
        }
      }
    });

    test("go through the migration connection, which waits out a slow cluster instead of failing", async () => {
      await new DropTtlOnlyDropPartsFromMixedRetentionTables().migrate();

      expect(metricService.execute).toHaveBeenCalledTimes(3);

      for (const call of metricService.execute.mock.calls) {
        expect(call[1]).toBe(MigrationExecuteOptions);
      }

      expect(MigrationExecuteOptions.useMigrationConnection).toBe(true);
      expect(
        MigrationExecuteOptions.clickhouseSettings?.[
          "distributed_ddl_output_mode"
        ],
      ).toBe("null_status_on_timeout");
    });

    test("follow CLICKHOUSE_CLUSTER_NAME", async () => {
      process.env[CLUSTER_ENV_KEY] = "telemetry_cluster";

      await new DropTtlOnlyDropPartsFromMixedRetentionTables().migrate();

      expect(executedStatements()).toEqual([
        "ALTER TABLE MetricItemV3Local ON CLUSTER 'telemetry_cluster' MODIFY SETTING ttl_only_drop_parts = 0",
        "ALTER TABLE MetricItemAggMV1mLocal ON CLUSTER 'telemetry_cluster' MODIFY SETTING ttl_only_drop_parts = 0",
        "ALTER TABLE LogItemV3Local ON CLUSTER 'telemetry_cluster' MODIFY SETTING ttl_only_drop_parts = 0",
      ]);
    });

    test("change that one setting and nothing else", async () => {
      await new DropTtlOnlyDropPartsFromMixedRetentionTables().migrate();

      for (const statement of executedStatements()) {
        expect(statement).toMatch(
          /^ALTER TABLE \w+ ON CLUSTER '[^']+' MODIFY SETTING ttl_only_drop_parts = 0$/,
        );
        expect(statement).not.toMatch(/RESET SETTING|DELETE|DROP|TTL /);
      }
    });

    test("log each table it cleared", async () => {
      await new DropTtlOnlyDropPartsFromMixedRetentionTables().migrate();

      expect(loggedMessages(infoSpy)).toEqual([
        `${MIGRATION_NAME}: cleared ttl_only_drop_parts on MetricItemV3Local`,
        `${MIGRATION_NAME}: cleared ttl_only_drop_parts on MetricItemAggMV1mLocal`,
        `${MIGRATION_NAME}: cleared ttl_only_drop_parts on LogItemV3Local`,
      ]);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe("which tables it touches", () => {
    test("checks that each local table exists right before altering it", async () => {
      await new DropTtlOnlyDropPartsFromMixedRetentionTables().migrate();

      expect(events).toEqual([
        "exists MetricItemV3Local",
        "alter MetricItemV3Local",
        "exists MetricItemAggMV1mLocal",
        "alter MetricItemAggMV1mLocal",
        "exists LogItemV3Local",
        "alter LogItemV3Local",
      ]);
    });

    test("skips a table that does not exist, and still clears the others", async () => {
      missingTables.add("MetricItemAggMV1mLocal");

      await new DropTtlOnlyDropPartsFromMixedRetentionTables().migrate();

      expect(executedStatements()).toEqual([
        EXPECTED_STATEMENTS[0],
        EXPECTED_STATEMENTS[2],
      ]);
      expect(loggedMessages(infoSpy)).toContain(
        `${MIGRATION_NAME}: MetricItemAggMV1mLocal does not exist; nothing to clear.`,
      );
      expect(errorSpy).not.toHaveBeenCalled();
    });

    test("does nothing, and succeeds, where none of them exist yet", async () => {
      for (const table of MIXED_RETENTION_TELEMETRY_TABLES) {
        missingTables.add(`${table}Local`);
      }

      await expect(
        new DropTtlOnlyDropPartsFromMixedRetentionTables().migrate(),
      ).resolves.toBeUndefined();

      expect(metricService.execute).not.toHaveBeenCalled();
      expect(migrationUtil.tableExists).toHaveBeenCalledTimes(3);
    });

    test("never asks about, or alters, the tables it leaves alone", async () => {
      await new DropTtlOnlyDropPartsFromMixedRetentionTables().migrate();

      const touched: Array<string> = [
        ...migrationUtil.tableExists.mock.calls.map(
          (call: Array<unknown>): string => {
            return call[0] as string;
          },
        ),
        ...executedStatements().map(tableOf),
      ];

      for (const table of [
        "SpanItemV3Local",
        "ExceptionItemV3Local",
        "ProfileItemV3Local",
        "ProfileSampleItemV3Local",
        "MetricBaselineHourlyLocal",
        "MetricItemAggMV1mByServiceLocal",
        "MetricItemAggMV1mByHostV2Local",
        "MetricItemAggMV1mByContainerLocal",
        "MetricItemAggMV1mByK8sClusterLocal",
      ]) {
        expect(touched).not.toContain(table);
      }
    });
  });

  describe("when a table cannot be cleared", () => {
    test("keeps going, then fails naming the table and why", async () => {
      tablesWhoseAlterFails.set(
        "MetricItemAggMV1mLocal",
        new Error("Code: 497. Not enough privileges"),
      );

      const error: Error = await migrationError();

      // The table after the failed one was still cleared.
      expect(executedStatements()).toEqual(EXPECTED_STATEMENTS);

      expect(error.message).toBe(
        `${MIGRATION_NAME}: could not clear ttl_only_drop_parts on MetricItemAggMV1mLocal: Code: 497. Not enough privileges`,
      );
    });

    test("names every table that failed", async () => {
      tablesWhoseAlterFails.set("MetricItemV3Local", new Error("first"));
      tablesWhoseAlterFails.set("LogItemV3Local", new Error("second"));

      const error: Error = await migrationError();

      expect(executedStatements()).toEqual(EXPECTED_STATEMENTS);
      expect(error.message).toBe(
        `${MIGRATION_NAME}: could not clear ttl_only_drop_parts on MetricItemV3Local: first; LogItemV3Local: second`,
      );
    });

    test("treats a failed existence check as a failure, not as a missing table", async () => {
      tablesWhoseExistenceCheckFails.set(
        "LogItemV3Local",
        new Error("Timeout error."),
      );

      const error: Error = await migrationError();

      expect(executedStatements()).toEqual([
        EXPECTED_STATEMENTS[0],
        EXPECTED_STATEMENTS[1],
      ]);
      expect(error.message).toBe(
        `${MIGRATION_NAME}: could not clear ttl_only_drop_parts on LogItemV3Local: Timeout error.`,
      );
    });

    test("reports a rejection that is not an Error", async () => {
      tablesWhoseAlterFails.set("MetricItemV3Local", "socket hang up");

      const error: Error = await migrationError();

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(
        `${MIGRATION_NAME}: could not clear ttl_only_drop_parts on MetricItemV3Local: socket hang up`,
      );
    });

    test("logs the failure, and does not claim to have cleared that table", async () => {
      const cause: Error = new Error("boom");
      tablesWhoseAlterFails.set("MetricItemV3Local", cause);

      await migrationError();

      expect(loggedMessages(errorSpy)).toContain(
        `${MIGRATION_NAME}: failed on MetricItemV3Local:`,
      );
      expect(errorSpy).toHaveBeenCalledWith(cause);
      expect(loggedMessages(infoSpy)).not.toContain(
        `${MIGRATION_NAME}: cleared ttl_only_drop_parts on MetricItemV3Local`,
      );
    });
  });

  describe("running again, and rolling back", () => {
    test("is idempotent: a second run issues the same statements again", async () => {
      await new DropTtlOnlyDropPartsFromMixedRetentionTables().migrate();
      await new DropTtlOnlyDropPartsFromMixedRetentionTables().migrate();

      expect(executedStatements()).toEqual([
        ...EXPECTED_STATEMENTS,
        ...EXPECTED_STATEMENTS,
      ]);
    });

    test("a run that failed succeeds when retried", async () => {
      tablesWhoseAlterFails.set("LogItemV3Local", new Error("Timeout error."));

      await migrationError();

      tablesWhoseAlterFails.clear();
      metricService.execute.mockClear();

      await expect(
        new DropTtlOnlyDropPartsFromMixedRetentionTables().migrate(),
      ).resolves.toBeUndefined();
      expect(executedStatements()).toEqual(EXPECTED_STATEMENTS);
    });

    test("rollback puts nothing back", async () => {
      await expect(
        new DropTtlOnlyDropPartsFromMixedRetentionTables().rollback(),
      ).resolves.toBeUndefined();

      expect(metricService.execute).not.toHaveBeenCalled();
      expect(migrationUtil.tableExists).not.toHaveBeenCalled();
    });
  });

  describe("its place in the migration chain", () => {
    const index: string = fs
      .readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "FeatureSet",
          "Workers",
          "DataMigrations",
          "Index.ts",
        ),
        "utf8",
      )
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

    const registered: Array<string> = Array.from(
      index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    test("is imported and registered exactly once", () => {
      expect(index).toContain(
        `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
      );
      expect(
        registered.filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
    });

    test("runs after AddTtlOnlyDropPartsToTelemetryV3, which used to set the setting", () => {
      expect(registered.indexOf("AddTtlOnlyDropPartsToTelemetryV3")).toBe(
        registered.lastIndexOf("AddTtlOnlyDropPartsToTelemetryV3"),
      );
      expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
        registered.indexOf("AddTtlOnlyDropPartsToTelemetryV3"),
      );
    });
  });
});

describe("AddTtlOnlyDropPartsToTelemetryV3, the migration that used to set it", () => {
  async function tablesItSetsTheSettingOn(): Promise<Array<string>> {
    await new AddTtlOnlyDropPartsToTelemetryV3().migrate();

    return executedStatements().map((statement: string): string => {
      expect(statement).toMatch(
        /^ALTER TABLE \w+ MODIFY SETTING ttl_only_drop_parts = 1$/,
      );
      return tableOf(statement);
    });
  }

  test("is still baselined on the clustered schema", () => {
    expect(new AddTtlOnlyDropPartsToTelemetryV3().runsInClusterMode()).toBe(
      false,
    );
  });

  test("no longer sets it on any table the new migration clears", async () => {
    const tables: Array<string> = await tablesItSetsTheSettingOn();

    for (const table of MIXED_RETENTION_TELEMETRY_TABLES) {
      expect(tables).not.toContain(table);
    }
  });

  test("still sets it on the tables it was left with", async () => {
    expect(await tablesItSetsTheSettingOn()).toEqual([
      "SpanItemV3",
      "ExceptionItemV3",
      "ProfileItemV3",
      "ProfileSampleItemV3",
      "MetricBaselineHourly",
    ]);
  });
});
