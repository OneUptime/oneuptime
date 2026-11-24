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
 * #10337: scheduled detection rules judge the security events that arrived
 * since their last run, whenever they happened, and idx_created_at - a set
 * index of each granule's SecurityEvent.createdAt seconds - keeps that read
 * to the granules that hold what arrived. Boot schema-sync adds the index DEFINITION; this
 * migration builds it for the parts the table already has, in the
 * background, so the runs of the day after an upgrade do not read a day of
 * rows each.
 *
 * What is pinned:
 *
 *   - the model declares the index on createdAt, and no other model does;
 *   - the two statements: ADD INDEX IF NOT EXISTS with the model's own
 *     definition, then MATERIALIZE INDEX - on the local storage table, ON
 *     CLUSTER, in that order, the MATERIALIZE queued without waiting for it
 *     (mutations_sync = 0);
 *   - a table that does not exist is skipped, a failure fails the migration
 *     naming the table, it is safe to run again, its rollback does nothing,
 *     it runs on the clustered schema instead of being baselined, and it is
 *     registered once, before the last slot.
 *
 * DetectionRuleArrivalsClickhouse.test.ts measures what the index saves on
 * a real ClickHouse server, and that MATERIALIZE INDEX builds it for parts
 * written before it existed.
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
import AnalyticsModels from "Common/Models/AnalyticsModels/Index";
import SecurityEvent, {
  SECURITY_EVENT_CREATED_AT_INDEX_NAME,
} from "Common/Models/AnalyticsModels/SecurityEvent";
import {
  ClickhouseExecuteOptions,
  MigrationExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import MetricService from "Common/Server/Services/MetricService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import logger from "Common/Server/Utils/Logger";
import AnalyticsTableColumn, {
  SkipIndexType,
} from "Common/Types/AnalyticsDatabase/TableColumn";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import DataMigrationBase from "../../../FeatureSet/Workers/DataMigrations/DataMigrationBase";
import { MaterializeInBackgroundOptions } from "../../../FeatureSet/Workers/DataMigrations/MaterializeAttributeValuesIndex";
import MaterializeSecurityEventCreatedAtIndex from "../../../FeatureSet/Workers/DataMigrations/MaterializeSecurityEventCreatedAtIndex";

type MockFunction = ReturnType<typeof jest.fn>;
type MockSpy = ReturnType<typeof jest.spyOn>;
type ModelType = { new (): AnalyticsBaseModel };

const metricService: { execute: MockFunction } = MetricService as unknown as {
  execute: MockFunction;
};

const migrationUtil: { tableExists: MockFunction } =
  ClickHouseMigrationUtil as unknown as { tableExists: MockFunction };

const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";

const MIGRATION_NAME: string = "MaterializeSecurityEventCreatedAtIndex";

const DEFINITION: string =
  "idx_created_at createdAt TYPE set(4096) GRANULARITY 1";

const EXPECTED_STATEMENTS: Array<string> = [
  `ALTER TABLE SecurityEventItemV1Local ON CLUSTER 'oneuptime' ADD INDEX IF NOT EXISTS ${DEFINITION}`,
  "ALTER TABLE SecurityEventItemV1Local ON CLUSTER 'oneuptime' MATERIALIZE INDEX idx_created_at",
];

const DESTRUCTIVE: RegExp = /DROP|DELETE|CLEAR|MODIFY|UPDATE|SETTINGS/;

let savedClusterName: string | undefined;
let tableExists: boolean;
let failing: string | null;
let infoSpy: MockSpy;
let warnSpy: MockSpy;
let errorSpy: MockSpy;

function executedStatements(): Array<string> {
  return metricService.execute.mock.calls.map((call: Array<unknown>) => {
    return call[0] as string;
  });
}

function executedOptions(): Array<ClickhouseExecuteOptions> {
  return metricService.execute.mock.calls.map((call: Array<unknown>) => {
    return call[1] as ClickhouseExecuteOptions;
  });
}

function loggedMessages(spy: MockSpy): Array<string> {
  return spy.mock.calls.map((call: Array<unknown>): string => {
    return typeof call[0] === "string" ? call[0] : String(call[0]);
  });
}

beforeEach(() => {
  savedClusterName = process.env[CLUSTER_ENV_KEY];
  delete process.env[CLUSTER_ENV_KEY];

  tableExists = true;
  failing = null;

  metricService.execute.mockReset();
  metricService.execute.mockImplementation(
    async (statement: unknown): Promise<void> => {
      if (failing && (statement as string).includes(failing)) {
        throw new Error(
          "Code: 159. Watching task is executing longer than ...",
        );
      }
    },
  );

  migrationUtil.tableExists.mockReset();
  migrationUtil.tableExists.mockImplementation(async (): Promise<boolean> => {
    return tableExists;
  });

  infoSpy = jest.spyOn(logger, "info").mockImplementation(() => {
    return undefined;
  });
  warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {
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
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("MaterializeSecurityEventCreatedAtIndex", () => {
  describe("what it is", () => {
    test("is a data migration recorded under its own name", () => {
      const migration: MaterializeSecurityEventCreatedAtIndex =
        new MaterializeSecurityEventCreatedAtIndex();

      expect(migration).toBeInstanceOf(DataMigrationBase);
      // The runner records it by this name: renaming it would run it again.
      expect(migration.name).toBe(MIGRATION_NAME);
    });

    test("runs on the clustered schema instead of being baselined", () => {
      expect(
        new MaterializeSecurityEventCreatedAtIndex().runsInClusterMode(),
      ).toBe(true);
    });

    test("the security events table declares a set index of when each row arrived", () => {
      const column: AnalyticsTableColumn | undefined =
        MaterializeSecurityEventCreatedAtIndex.getIndexedColumn(
          new SecurityEvent(),
        );

      expect(column?.key).toBe("createdAt");
      expect(column?.skipIndex).toEqual({
        name: SECURITY_EVENT_CREATED_AT_INDEX_NAME,
        type: SkipIndexType.Set,
        params: [4096],
        granularity: 1,
      });
      expect(StatementGenerator.toSkipIndexDefinition(column!)).toBe(
        DEFINITION,
      );
    });

    test("no other table declares it: only security events are read by when they arrived", () => {
      const declaring: Array<string> = AnalyticsModels.map(
        (modelType: ModelType): AnalyticsBaseModel => {
          return new modelType();
        },
      )
        .filter((model: AnalyticsBaseModel): boolean => {
          return Boolean(
            MaterializeSecurityEventCreatedAtIndex.getIndexedColumn(model),
          );
        })
        .map((model: AnalyticsBaseModel): string => {
          return model.tableName;
        });

      expect(declaring).toEqual(["SecurityEventItemV1"]);
    });
  });

  describe("the statements", () => {
    test("add the definition if it is missing, then queue its build, on the local storage table", async () => {
      await new MaterializeSecurityEventCreatedAtIndex().migrate();

      expect(executedStatements()).toEqual(EXPECTED_STATEMENTS);
      expect(migrationUtil.tableExists).toHaveBeenCalledWith(
        "SecurityEventItemV1Local",
      );

      for (const statement of executedStatements()) {
        expect(statement).not.toMatch(DESTRUCTIVE);
        // The whole table: a partition clause would leave the other days unindexed.
        expect(statement).not.toContain("IN PARTITION");
      }
    });

    test("name the cluster from CLICKHOUSE_CLUSTER_NAME", async () => {
      process.env[CLUSTER_ENV_KEY] = "ext_cluster";

      await new MaterializeSecurityEventCreatedAtIndex().migrate();

      for (const statement of executedStatements()) {
        expect(statement).toContain(" ON CLUSTER 'ext_cluster' ");
      }
    });

    test("add the definition through the migration connection, and queue the build without waiting for it", async () => {
      await new MaterializeSecurityEventCreatedAtIndex().migrate();

      const options: Array<ClickhouseExecuteOptions> = executedOptions();

      expect(options[0]).toBe(MigrationExecuteOptions);
      expect(options[1]).toBe(MaterializeInBackgroundOptions);
      expect(
        MaterializeInBackgroundOptions.clickhouseSettings?.mutations_sync,
      ).toBe("0");
    });
  });

  describe("when something is missing or fails", () => {
    test("a table that does not exist yet is skipped: it is created with the index", async () => {
      tableExists = false;

      await new MaterializeSecurityEventCreatedAtIndex().migrate();

      expect(executedStatements()).toEqual([]);
      expect(loggedMessages(infoSpy)).toContain(
        "MaterializeSecurityEventCreatedAtIndex: SecurityEventItemV1Local does not exist; nothing to build.",
      );
    });

    test("a definition that cannot be added is not built over, and the migration fails naming the table", async () => {
      failing = "ADD INDEX";

      await expect(
        new MaterializeSecurityEventCreatedAtIndex().migrate(),
      ).rejects.toThrow(
        "MaterializeSecurityEventCreatedAtIndex: could not build idx_created_at on SecurityEventItemV1Local: Code: 159.",
      );
      expect(executedStatements()).toEqual([EXPECTED_STATEMENTS[0]]);
      expect(loggedMessages(errorSpy)).toContain(
        "MaterializeSecurityEventCreatedAtIndex: failed on SecurityEventItemV1Local:",
      );
    });

    test("a build that cannot be queued fails the migration, so the runner tries again", async () => {
      failing = "MATERIALIZE";

      await expect(
        new MaterializeSecurityEventCreatedAtIndex().migrate(),
      ).rejects.toThrow("SecurityEventItemV1Local");
      expect(executedStatements()).toEqual(EXPECTED_STATEMENTS);
    });

    test("a model that no longer declares the index is skipped with a warning", async () => {
      const getIndexedColumn: MockSpy = jest
        .spyOn(MaterializeSecurityEventCreatedAtIndex, "getIndexedColumn")
        .mockReturnValue(undefined);

      await new MaterializeSecurityEventCreatedAtIndex().migrate();

      getIndexedColumn.mockRestore();

      expect(executedStatements()).toEqual([]);
      expect(loggedMessages(warnSpy)).toContain(
        "MaterializeSecurityEventCreatedAtIndex: SecurityEventItemV1 does not declare idx_created_at; skipping.",
      );
    });
  });

  describe("running it again, and rolling it back", () => {
    test("is safe to run again: the same statements, which add nothing and read nothing twice", async () => {
      await new MaterializeSecurityEventCreatedAtIndex().migrate();
      await new MaterializeSecurityEventCreatedAtIndex().migrate();

      expect(executedStatements()).toEqual([
        ...EXPECTED_STATEMENTS,
        ...EXPECTED_STATEMENTS,
      ]);
    });

    test("rollback drops nothing: the index is what keeps the rules' reads small", async () => {
      await expect(
        new MaterializeSecurityEventCreatedAtIndex().rollback(),
      ).resolves.toBeUndefined();

      expect(metricService.execute).not.toHaveBeenCalled();
    });

    test("is registered exactly once, before the MCP client columns that keep the last slot", () => {
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
});
