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
 * The metric tables and the log table expire rows one at a time. With
 * `TTL retentionDate DELETE` a daily partition is rewritten six or seven
 * times per retention while its rows expire; rounded up to the day, the rows
 * of one retention expire together - one merge, or a part drop. The models
 * declare the rounded TTL; this migration gives it to the tables an existing
 * install already has, because boot schema-sync never changes a TTL.
 *
 * What is pinned:
 *
 *   - which tables it changes, and that the TTL each gets is the one its
 *     model declares (the raw tables lined up with their partition's day,
 *     the rollup rounded on retentionDate alone);
 *   - the statement: the local storage table, ON CLUSTER, MODIFY TTL and
 *     nothing else, through the migration connection - with
 *     materialize_ttl_after_modify = 0, so no part is rewritten when it runs
 *     (the default would rewrite both tables whole), without touching the
 *     options every other migration shares;
 *   - a table that does not exist is skipped, every table is tried even
 *     after one fails, and then the migration fails naming the table;
 *   - it is safe to run again, its rollback does nothing, it runs on the
 *     clustered schema instead of being baselined, and it runs after the
 *     migration that made these tables expire rows one at a time.
 *
 * RoundTtlToDayOnMixedRetentionTablesClickhouse.test.ts runs it against a
 * real ClickHouse server.
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
import {
  ClickhouseExecuteOptions,
  MigrationExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";
import {
  RETENTION_TTL_ROUNDED_UP_TO_DAY,
  RETENTION_TTL_ROUNDED_UP_TO_EVENT_DAY,
} from "Common/Types/AnalyticsDatabase/RetentionTtl";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import DataMigrationBase from "../../../FeatureSet/Workers/DataMigrations/DataMigrationBase";
import RoundTtlToDayOnMixedRetentionTables, {
  DAY_ROUNDED_TTL_MODELS,
  ModifyTtlWithoutRewriteOptions,
} from "../../../FeatureSet/Workers/DataMigrations/RoundTtlToDayOnMixedRetentionTables";

type MockFunction = ReturnType<typeof jest.fn>;
type MockSpy = ReturnType<typeof jest.spyOn>;

const metricService: { execute: MockFunction } = MetricService as unknown as {
  execute: MockFunction;
};

const migrationUtil: { tableExists: MockFunction } =
  ClickHouseMigrationUtil as unknown as { tableExists: MockFunction };

const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";

const MIGRATION_NAME: string = "RoundTtlToDayOnMixedRetentionTables";

const RAW_TTL: string =
  "toStartOfDay(retentionDate + toIntervalSecond(least(greatest(dateDiff('second', createdAt, time), 0), 86400))) + INTERVAL 1 DAY DELETE";

const ROLLUP_TTL: string =
  "toStartOfDay(retentionDate) + INTERVAL 1 DAY DELETE";

const EXPECTED_STATEMENTS: Array<string> = [
  `ALTER TABLE MetricItemV3Local ON CLUSTER 'oneuptime' MODIFY TTL ${RAW_TTL}`,
  `ALTER TABLE MetricItemAggMV1mLocal ON CLUSTER 'oneuptime' MODIFY TTL ${ROLLUP_TTL}`,
  `ALTER TABLE LogItemV3Local ON CLUSTER 'oneuptime' MODIFY TTL ${RAW_TTL}`,
];

type ModelType = { new (): AnalyticsBaseModel };

const MODELS: Array<{
  tableName: string;
  modelType: ModelType;
  ttl: string;
}> = [
  { tableName: "MetricItemV3", modelType: Metric, ttl: RAW_TTL },
  {
    tableName: "MetricItemAggMV1m",
    modelType: MetricItemAggMV1m,
    ttl: ROLLUP_TTL,
  },
  { tableName: "LogItemV3", modelType: Log, ttl: RAW_TTL },
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
    await new RoundTtlToDayOnMixedRetentionTables().migrate();
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

describe("RoundTtlToDayOnMixedRetentionTables", () => {
  describe("what it is", () => {
    test("is a data migration recorded under its own name", () => {
      const migration: RoundTtlToDayOnMixedRetentionTables =
        new RoundTtlToDayOnMixedRetentionTables();

      expect(migration).toBeInstanceOf(DataMigrationBase);

      // The runner records it by this name: renaming it would run it again.
      expect(migration.name).toBe(MIGRATION_NAME);
    });

    test("runs on the clustered schema instead of being baselined", () => {
      /*
       * The analytics schema is always a cluster, and the runner records a
       * migration that opts out as executed without running it - which
       * would leave every existing install on the old TTL for good.
       */
      expect(
        new RoundTtlToDayOnMixedRetentionTables().runsInClusterMode(),
      ).toBe(true);
    });

    test("changes exactly the metric tables and the log table", () => {
      expect(
        DAY_ROUNDED_TTL_MODELS.map((modelType: ModelType): string => {
          return new modelType().tableName;
        }),
      ).toEqual(["MetricItemV3", "MetricItemAggMV1m", "LogItemV3"]);
    });

    test.each(MODELS)(
      "gives $tableName the TTL its model declares - so a repaired install ends up like a fresh one",
      ({
        tableName,
        modelType,
        ttl,
      }: {
        tableName: string;
        modelType: ModelType;
        ttl: string;
      }) => {
        const model: AnalyticsBaseModel = new modelType();

        expect(model.tableName).toBe(tableName);
        expect(model.ttlExpression).toBe(ttl);
        expect(DAY_ROUNDED_TTL_MODELS).toContain(modelType);
      },
    );

    test("lines the raw tables up with their partition's day, and rounds the rollup on retentionDate alone", () => {
      expect(new Metric().ttlExpression).toBe(
        RETENTION_TTL_ROUNDED_UP_TO_EVENT_DAY,
      );
      expect(new Log().ttlExpression).toBe(
        RETENTION_TTL_ROUNDED_UP_TO_EVENT_DAY,
      );

      // The rollup has neither createdAt nor time to line a bucket up with.
      const rollupColumns: Array<string> =
        new MetricItemAggMV1m().tableColumns.map(
          (column: { key: string }): string => {
            return column.key;
          },
        );
      expect(rollupColumns).not.toContain("createdAt");
      expect(rollupColumns).not.toContain("time");
      expect(new MetricItemAggMV1m().ttlExpression).toBe(
        RETENTION_TTL_ROUNDED_UP_TO_DAY,
      );
    });
  });

  describe("the statements", () => {
    test("modify the TTL of each local storage table, ON CLUSTER", async () => {
      await new RoundTtlToDayOnMixedRetentionTables().migrate();

      expect(executedStatements()).toEqual(EXPECTED_STATEMENTS);
    });

    test("are what getStatement renders for each model", async () => {
      await new RoundTtlToDayOnMixedRetentionTables().migrate();

      expect(executedStatements()).toEqual(
        DAY_ROUNDED_TTL_MODELS.map((modelType: ModelType): string => {
          return RoundTtlToDayOnMixedRetentionTables.getStatement(
            new modelType(),
          );
        }),
      );
    });

    test("never alter the Distributed table the app writes through", async () => {
      await new RoundTtlToDayOnMixedRetentionTables().migrate();

      for (const statement of executedStatements()) {
        expect(tableOf(statement)).toMatch(/Local$/);

        for (const { tableName } of MODELS) {
          expect(statement).not.toContain(`ALTER TABLE ${tableName} `);
        }
      }
    });

    test("change the TTL and nothing else: no MATERIALIZE, no DELETE, no settings", async () => {
      await new RoundTtlToDayOnMixedRetentionTables().migrate();

      for (const statement of executedStatements()) {
        expect(statement).toMatch(
          /^ALTER TABLE \w+ ON CLUSTER '[^']+' MODIFY TTL [^;]+ DELETE$/,
        );
        expect(statement).not.toMatch(
          /MATERIALIZE|REMOVE TTL|MODIFY SETTING|SETTINGS|DROP|DELETE WHERE/,
        );
      }
    });

    test("go through the migration connection, which waits out a slow cluster instead of failing", async () => {
      await new RoundTtlToDayOnMixedRetentionTables().migrate();

      expect(metricService.execute).toHaveBeenCalledTimes(3);

      for (const call of metricService.execute.mock.calls) {
        expect(call[1]).toBe(ModifyTtlWithoutRewriteOptions);
      }

      expect(ModifyTtlWithoutRewriteOptions.useMigrationConnection).toBe(true);
      expect(
        ModifyTtlWithoutRewriteOptions.clickhouseSettings?.[
          "distributed_ddl_output_mode"
        ],
      ).toBe("null_status_on_timeout");
    });

    test("do not materialize the new TTL, which would rewrite every part of both tables", () => {
      expect(
        ModifyTtlWithoutRewriteOptions.clickhouseSettings?.[
          "materialize_ttl_after_modify"
        ],
      ).toBe(0);
    });

    test("keep every other setting the migration connection sends", () => {
      const { materialize_ttl_after_modify, ...rest } =
        ModifyTtlWithoutRewriteOptions.clickhouseSettings || {};

      expect(materialize_ttl_after_modify).toBe(0);
      expect(rest).toEqual(MigrationExecuteOptions.clickhouseSettings);
      expect({
        ...ModifyTtlWithoutRewriteOptions,
        clickhouseSettings: undefined,
      }).toEqual({ ...MigrationExecuteOptions, clickhouseSettings: undefined });
    });

    test("leave the options every other migration shares as they were", () => {
      const shared: ClickhouseExecuteOptions = MigrationExecuteOptions;

      expect(shared).not.toBe(ModifyTtlWithoutRewriteOptions);
      expect(shared.clickhouseSettings).not.toBe(
        ModifyTtlWithoutRewriteOptions.clickhouseSettings,
      );
      expect(shared.clickhouseSettings).not.toHaveProperty(
        "materialize_ttl_after_modify",
      );
    });

    test("follow CLICKHOUSE_CLUSTER_NAME", async () => {
      process.env[CLUSTER_ENV_KEY] = "telemetry_cluster";

      await new RoundTtlToDayOnMixedRetentionTables().migrate();

      expect(executedStatements()).toEqual(
        EXPECTED_STATEMENTS.map((statement: string): string => {
          return statement.replace("'oneuptime'", "'telemetry_cluster'");
        }),
      );
    });

    test("log each table it changed", async () => {
      await new RoundTtlToDayOnMixedRetentionTables().migrate();

      expect(loggedMessages(infoSpy)).toEqual([
        `${MIGRATION_NAME}: rounded the TTL of MetricItemV3Local up to the day`,
        `${MIGRATION_NAME}: rounded the TTL of MetricItemAggMV1mLocal up to the day`,
        `${MIGRATION_NAME}: rounded the TTL of LogItemV3Local up to the day`,
      ]);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe("which tables it touches", () => {
    test("checks that each local table exists right before altering it", async () => {
      await new RoundTtlToDayOnMixedRetentionTables().migrate();

      expect(events).toEqual([
        "exists MetricItemV3Local",
        "alter MetricItemV3Local",
        "exists MetricItemAggMV1mLocal",
        "alter MetricItemAggMV1mLocal",
        "exists LogItemV3Local",
        "alter LogItemV3Local",
      ]);
    });

    test("skips a table that does not exist, and still changes the others", async () => {
      missingTables.add("MetricItemAggMV1mLocal");

      await new RoundTtlToDayOnMixedRetentionTables().migrate();

      expect(executedStatements()).toEqual([
        EXPECTED_STATEMENTS[0],
        EXPECTED_STATEMENTS[2],
      ]);
      expect(loggedMessages(infoSpy)).toContain(
        `${MIGRATION_NAME}: MetricItemAggMV1mLocal does not exist; nothing to change.`,
      );
      expect(errorSpy).not.toHaveBeenCalled();
    });

    test("does nothing, and succeeds, where none of them exist yet", async () => {
      for (const { tableName } of MODELS) {
        missingTables.add(`${tableName}Local`);
      }

      await expect(
        new RoundTtlToDayOnMixedRetentionTables().migrate(),
      ).resolves.toBeUndefined();

      expect(metricService.execute).not.toHaveBeenCalled();
      expect(migrationUtil.tableExists).toHaveBeenCalledTimes(3);
    });

    test("never asks about, or alters, the tables it leaves alone", async () => {
      await new RoundTtlToDayOnMixedRetentionTables().migrate();

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

  describe("when a table cannot be changed", () => {
    test("keeps going, then fails naming the table and why", async () => {
      tablesWhoseAlterFails.set(
        "MetricItemAggMV1mLocal",
        new Error("Code: 497. Not enough privileges"),
      );

      const error: Error = await migrationError();

      // The table after the failed one was still changed.
      expect(executedStatements()).toEqual(EXPECTED_STATEMENTS);

      expect(error.message).toBe(
        `${MIGRATION_NAME}: could not round the TTL of MetricItemAggMV1mLocal: Code: 497. Not enough privileges`,
      );
    });

    test("names every table that failed", async () => {
      tablesWhoseAlterFails.set("MetricItemV3Local", new Error("first"));
      tablesWhoseAlterFails.set("LogItemV3Local", new Error("second"));

      const error: Error = await migrationError();

      expect(executedStatements()).toEqual(EXPECTED_STATEMENTS);
      expect(error.message).toBe(
        `${MIGRATION_NAME}: could not round the TTL of MetricItemV3Local: first; LogItemV3Local: second`,
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
        `${MIGRATION_NAME}: could not round the TTL of LogItemV3Local: Timeout error.`,
      );
    });

    test("reports a rejection that is not an Error", async () => {
      tablesWhoseAlterFails.set("MetricItemV3Local", "socket hang up");

      const error: Error = await migrationError();

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(
        `${MIGRATION_NAME}: could not round the TTL of MetricItemV3Local: socket hang up`,
      );
    });

    test("logs the failure, and does not claim to have changed that table", async () => {
      const cause: Error = new Error("boom");
      tablesWhoseAlterFails.set("MetricItemV3Local", cause);

      await migrationError();

      expect(loggedMessages(errorSpy)).toContain(
        `${MIGRATION_NAME}: failed on MetricItemV3Local:`,
      );
      expect(errorSpy).toHaveBeenCalledWith(cause);
      expect(loggedMessages(infoSpy)).not.toContain(
        `${MIGRATION_NAME}: rounded the TTL of MetricItemV3Local up to the day`,
      );
    });
  });

  describe("running again, and rolling back", () => {
    test("is idempotent: a second run issues the same statements again", async () => {
      await new RoundTtlToDayOnMixedRetentionTables().migrate();
      await new RoundTtlToDayOnMixedRetentionTables().migrate();

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
        new RoundTtlToDayOnMixedRetentionTables().migrate(),
      ).resolves.toBeUndefined();
      expect(executedStatements()).toEqual(EXPECTED_STATEMENTS);
    });

    test("rollback puts nothing back", async () => {
      await expect(
        new RoundTtlToDayOnMixedRetentionTables().rollback(),
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

    test("runs after DropTtlOnlyDropPartsFromMixedRetentionTables, which made these tables expire rows one at a time", () => {
      expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
        registered.indexOf("DropTtlOnlyDropPartsFromMixedRetentionTables"),
      );
      expect(
        registered.indexOf("DropTtlOnlyDropPartsFromMixedRetentionTables"),
      ).toBeGreaterThan(-1);
    });
  });
});
