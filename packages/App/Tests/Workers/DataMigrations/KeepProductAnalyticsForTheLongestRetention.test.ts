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
 * Issue #6626: each RUM application chooses how long product analytics
 * keeps it, and the three tables keep the longest choice, 25 months, by
 * whole monthly parts. The models declare the new TTL; this migration gives
 * it to the tables an existing install already has, because boot
 * schema-sync never changes a TTL.
 *
 * What is pinned:
 *
 *   - which tables it changes, and that the TTL each gets is the one its
 *     model declares: 25 months from the month each row belongs to;
 *   - per table, two statements on the local storage table, ON CLUSTER:
 *     MODIFY SETTING materialize_ttl_recalculate_only = 1 through the
 *     migration connection, then MODIFY TTL queued in the background - a
 *     part keeps the expiry it was written with until it is recalculated,
 *     and a raised TTL that was not would still drop the parts written
 *     before the upgrade at 13 months;
 *   - a table that does not exist is skipped, every table is tried even
 *     after one fails, and then the migration fails naming the table;
 *   - it is safe to run again, its rollback does nothing, it runs on the
 *     clustered schema instead of being baselined, and it is registered
 *     once, before the last slot.
 *
 * KeepProductAnalyticsForTheLongestRetentionClickhouse.test.ts runs it
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
import RumProductAnalyticsEvent from "Common/Models/AnalyticsModels/RumProductAnalyticsEvent";
import RumProductAnalyticsSession from "Common/Models/AnalyticsModels/RumProductAnalyticsSession";
import RumProductAnalyticsUser from "Common/Models/AnalyticsModels/RumProductAnalyticsUser";
import {
  ClickhouseExecuteOptions,
  MigrationExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import DataMigrationBase from "../../../FeatureSet/Workers/DataMigrations/DataMigrationBase";
import KeepProductAnalyticsForTheLongestRetention, {
  PRODUCT_ANALYTICS_RETENTION_MODELS,
} from "../../../FeatureSet/Workers/DataMigrations/KeepProductAnalyticsForTheLongestRetention";
import { MaterializeInBackgroundOptions } from "../../../FeatureSet/Workers/DataMigrations/MaterializeAttributeValuesIndex";

type MockFunction = ReturnType<typeof jest.fn>;
type MockSpy = ReturnType<typeof jest.spyOn>;

const metricService: { execute: MockFunction } = MetricService as unknown as {
  execute: MockFunction;
};

const migrationUtil: { tableExists: MockFunction } =
  ClickHouseMigrationUtil as unknown as { tableExists: MockFunction };

const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";
const MIGRATION_NAME: string = "KeepProductAnalyticsForTheLongestRetention";

let savedClusterName: string | undefined;
let missingTables: Set<string>;
let failingTables: Set<string>;
let infoSpy: MockSpy;
let errorSpy: MockSpy;

function executed(): Array<{ statement: string; options: unknown }> {
  return metricService.execute.mock.calls.map((call: Array<unknown>) => {
    return { statement: call[0] as string, options: call[1] };
  });
}

beforeEach(() => {
  savedClusterName = process.env[CLUSTER_ENV_KEY];
  delete process.env[CLUSTER_ENV_KEY];

  missingTables = new Set<string>();
  failingTables = new Set<string>();

  metricService.execute.mockReset();
  metricService.execute.mockImplementation(
    async (statement: unknown): Promise<void> => {
      for (const table of failingTables) {
        if (String(statement).includes(` ${table} `)) {
          throw new Error(`ALTER of ${table} failed`);
        }
      }
    },
  );

  migrationUtil.tableExists.mockReset();
  migrationUtil.tableExists.mockImplementation(
    async (table: unknown): Promise<boolean> => {
      return !missingTables.has(String(table));
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

describe("KeepProductAnalyticsForTheLongestRetention", () => {
  describe("what it is", () => {
    test("is a data migration recorded under its own name, run on the clustered schema", () => {
      const migration: KeepProductAnalyticsForTheLongestRetention =
        new KeepProductAnalyticsForTheLongestRetention();

      expect(migration).toBeInstanceOf(DataMigrationBase);
      expect(migration.name).toBe(MIGRATION_NAME);
      expect(migration.runsInClusterMode()).toBe(true);
    });

    test("changes the three product analytics tables, and only them", () => {
      expect(
        PRODUCT_ANALYTICS_RETENTION_MODELS.map(
          (modelType: { new (): AnalyticsBaseModel }): string => {
            return new modelType().tableName;
          },
        ),
      ).toEqual([
        "RumProductAnalyticsSessionV1",
        "RumProductAnalyticsUserV1",
        "RumProductAnalyticsEventV1",
      ]);
    });

    test("is registered once, before the last slot", () => {
      const index: string = fs
        .readFileSync(
          path.resolve(
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

      expect(
        registered.filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
      expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
        registered.indexOf("AddAuditLogMcpClientColumns"),
      );
      expect(registered[registered.length - 1]).toBe(
        "AddAuditLogMcpClientColumns",
      );
    });
  });

  describe("the statements", () => {
    test("give each table the TTL its model declares, 25 months from its rows' month", () => {
      expect(new RumProductAnalyticsSession().ttlExpression).toBe(
        "toStartOfMonth(startTime) + INTERVAL 25 MONTH DELETE",
      );
      expect(new RumProductAnalyticsUser().ttlExpression).toBe(
        "month + INTERVAL 25 MONTH DELETE",
      );
      expect(new RumProductAnalyticsEvent().ttlExpression).toBe(
        "toStartOfMonth(time) + INTERVAL 25 MONTH DELETE",
      );

      for (const modelType of PRODUCT_ANALYTICS_RETENTION_MODELS) {
        const model: AnalyticsBaseModel = new modelType();

        expect(
          KeepProductAnalyticsForTheLongestRetention.getStatements(model),
        ).toEqual({
          setting: `ALTER TABLE ${model.tableName}Local ON CLUSTER 'oneuptime' MODIFY SETTING materialize_ttl_recalculate_only = 1`,
          ttl: `ALTER TABLE ${model.tableName}Local ON CLUSTER 'oneuptime' MODIFY TTL ${model.ttlExpression}`,
        });
      }
    });

    test("the models declare the setting too, so a new install has it from the start", () => {
      for (const modelType of PRODUCT_ANALYTICS_RETENTION_MODELS) {
        expect(new modelType().tableSettings).toContain(
          "materialize_ttl_recalculate_only = 1",
        );
      }
    });

    test("name the cluster they are given", () => {
      process.env[CLUSTER_ENV_KEY] = "analytics";

      expect(
        KeepProductAnalyticsForTheLongestRetention.getStatements(
          new RumProductAnalyticsEvent(),
        ).ttl,
      ).toContain("ON CLUSTER 'analytics' MODIFY TTL");
    });
  });

  describe("running it", () => {
    test("sets the setting, then the TTL, on every table, the TTL's recalculation queued in the background", async () => {
      await new KeepProductAnalyticsForTheLongestRetention().migrate();

      const calls: Array<{ statement: string; options: unknown }> = executed();

      expect(calls).toHaveLength(6);

      PRODUCT_ANALYTICS_RETENTION_MODELS.forEach(
        (modelType: { new (): AnalyticsBaseModel }, index: number): void => {
          const statements: { setting: string; ttl: string } =
            KeepProductAnalyticsForTheLongestRetention.getStatements(
              new modelType(),
            );

          expect(calls[index * 2]!.statement).toBe(statements.setting);
          expect(calls[index * 2]!.options).toBe(
            MigrationExecuteOptions as ClickhouseExecuteOptions,
          );
          expect(calls[index * 2 + 1]!.statement).toBe(statements.ttl);
          expect(calls[index * 2 + 1]!.options).toBe(
            MaterializeInBackgroundOptions,
          );
        },
      );

      /* Queued, never waited for: the upgrade is not held while it reads parts. */
      expect(
        (
          MaterializeInBackgroundOptions.clickhouseSettings as Record<
            string,
            unknown
          >
        )["mutations_sync"],
      ).toBe("0");
    });

    test("leaves a table that does not exist, and changes the others", async () => {
      missingTables.add("RumProductAnalyticsUserV1Local");

      await new KeepProductAnalyticsForTheLongestRetention().migrate();

      const statements: Array<string> = executed().map(
        (call: { statement: string }): string => {
          return call.statement;
        },
      );

      expect(statements).toHaveLength(4);
      expect(statements.join("\n")).not.toContain(
        "RumProductAnalyticsUserV1Local",
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining("does not exist"),
      );
    });

    test("tries every table when one fails, then fails naming it", async () => {
      failingTables.add("RumProductAnalyticsSessionV1Local");

      await expect(
        new KeepProductAnalyticsForTheLongestRetention().migrate(),
      ).rejects.toThrow("RumProductAnalyticsSessionV1Local");

      const statements: Array<string> = executed().map(
        (call: { statement: string }): string => {
          return call.statement;
        },
      );

      expect(statements.join("\n")).toContain("RumProductAnalyticsUserV1Local");
      expect(statements.join("\n")).toContain(
        "RumProductAnalyticsEventV1Local",
      );
    });

    test("writes the same statements when run again", async () => {
      await new KeepProductAnalyticsForTheLongestRetention().migrate();
      const first: Array<string> = executed().map(
        (call: { statement: string }): string => {
          return call.statement;
        },
      );

      metricService.execute.mockClear();

      await new KeepProductAnalyticsForTheLongestRetention().migrate();

      expect(
        executed().map((call: { statement: string }): string => {
          return call.statement;
        }),
      ).toEqual(first);
    });

    test("has nothing to roll back", async () => {
      await new KeepProductAnalyticsForTheLongestRetention().rollback();

      expect(metricService.execute).not.toHaveBeenCalled();
    });
  });
});
