import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsDatabaseService, {
  MigrationExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import logger from "Common/Server/Utils/Logger";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import MigrateMetricAggregatesToStrictSchema, {
  MetricAggregateTarget,
} from "../../../FeatureSet/Workers/DataMigrations/MigrateMetricAggregatesToStrictSchema";

/*
 * The migration's production defaults import six singleton services. Tests
 * inject a purpose-built service below, so loading those real singletons would
 * add a large, irrelevant database/service graph to this unit suite.
 */
jest.mock("Common/Server/Services/MetricItemAggMV1mService", () => {
  return {
    __esModule: true,
    default: { model: { tableName: "MetricItemAggMV1m" } },
  };
});
jest.mock("Common/Server/Services/MetricItemAggMV1mByHostV2Service", () => {
  return {
    __esModule: true,
    default: { model: { tableName: "MetricItemAggMV1mByHostV2" } },
  };
});
jest.mock("Common/Server/Services/MetricItemAggMV1mByServiceService", () => {
  return {
    __esModule: true,
    default: { model: { tableName: "MetricItemAggMV1mByService" } },
  };
});
jest.mock("Common/Server/Services/MetricItemAggMV1mByK8sClusterService", () => {
  return {
    __esModule: true,
    default: { model: { tableName: "MetricItemAggMV1mByK8sCluster" } },
  };
});
jest.mock("Common/Server/Services/MetricItemAggMV1mByContainerService", () => {
  return {
    __esModule: true,
    default: { model: { tableName: "MetricItemAggMV1mByContainer" } },
  };
});
jest.mock("Common/Server/Services/MetricBaselineService", () => {
  return {
    __esModule: true,
    default: { model: { tableName: "MetricBaselineHourly" } },
  };
});
jest.mock("Common/Server/Services/MetricService", () => {
  return { __esModule: true, default: {} };
});

const SIMPLE_RETENTION_TYPE: string = "SimpleAggregateFunction(max, DateTime)";
const COMPATIBILITY_SETTING: string = "allow_dimensions_outside_sorting_key";
const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";

type FailurePhase = "drop" | "alter" | "wrapper" | "view";

type HarnessOptions = {
  model?: AnalyticsBaseModel | undefined;
  hasRetentionDate?: boolean | undefined;
  tableExists?: boolean | undefined;
  legacyColumns?: ReadonlyArray<string> | undefined;
  retentionType?: string | undefined;
  hasCompatibilitySetting?: boolean | undefined;
  postLegacyColumns?: ReadonlyArray<string> | undefined;
  postRetentionType?: string | undefined;
  postHasCompatibilitySetting?: boolean | undefined;
  createQueryReadable?: boolean | undefined;
  postCreateQueryReadable?: boolean | undefined;
  failurePhase?: FailurePhase | undefined;
};

type HarnessState = {
  migrated: boolean;
  failurePhase?: FailurePhase | undefined;
};

type MockFunction = ReturnType<typeof jest.fn>;
type MockSpy = ReturnType<typeof jest.spyOn>;

type MigrationHarness = {
  migration: MigrateMetricAggregatesToStrictSchema;
  service: AnalyticsDatabaseService<AnalyticsBaseModel>;
  state: HarnessState;
  executeMock: MockFunction;
  doesColumnExistMock: MockFunction;
  getColumnDatabaseTypeMock: MockFunction;
  distributedStatementMock: MockFunction;
  tableExistsSpy: MockSpy;
  getCreateQuerySpy: MockSpy;
  wrapperStatement: Statement;
};

function statementText(statement: unknown): string {
  if (typeof statement === "string") {
    return statement;
  }

  const query: unknown = (statement as { query?: unknown }).query;
  return typeof query === "string" ? query : "";
}

function makeModel(
  tableName: string = "MetricItemAggMV1m",
): AnalyticsBaseModel {
  return {
    tableName,
    materializedViews: [
      {
        name: `${tableName}_mv`,
        query: `CREATE MATERIALIZED VIEW IF NOT EXISTS ${tableName}_mv
TO ${tableName}
AS
SELECT projectId
FROM MetricItemV3
GROUP BY projectId`,
      },
    ],
  } as unknown as AnalyticsBaseModel;
}

function makeHarness(options: HarnessOptions = {}): MigrationHarness {
  const model: AnalyticsBaseModel = options.model || makeModel();
  const hasRetentionDate: boolean = options.hasRetentionDate ?? true;
  const legacyColumns: Set<string> = new Set<string>(
    options.legacyColumns || [],
  );
  const postLegacyColumns: Set<string> = new Set<string>(
    options.postLegacyColumns || [],
  );
  const state: HarnessState = {
    migrated: false,
    failurePhase: options.failurePhase,
  };

  const wrapperStatement: Statement = new Statement();
  wrapperStatement.append("CREATE OR REPLACE TABLE distributed_wrapper");

  const executeMock: MockFunction = jest.fn(
    async (statement: unknown): Promise<void> => {
      const text: string = statementText(statement);

      if (text.startsWith("DROP VIEW") && state.failurePhase === "drop") {
        throw new Error("drop failed");
      }
      if (text.startsWith("ALTER TABLE") && state.failurePhase === "alter") {
        throw new Error("alter failed");
      }
      if (text === wrapperStatement.query && state.failurePhase === "wrapper") {
        throw new Error("wrapper failed");
      }
      if (
        text.startsWith("CREATE MATERIALIZED VIEW") &&
        state.failurePhase === "view"
      ) {
        throw new Error("view failed");
      }

      if (text.startsWith("ALTER TABLE")) {
        state.migrated = true;
      }
    },
  );

  const doesColumnExistMock: MockFunction = jest.fn(
    async (column: string): Promise<boolean> => {
      return state.migrated
        ? postLegacyColumns.has(column)
        : legacyColumns.has(column);
    },
  );
  const getColumnDatabaseTypeMock: MockFunction = jest.fn(
    async (): Promise<string> => {
      if (state.migrated) {
        return options.postRetentionType ?? SIMPLE_RETENTION_TYPE;
      }
      return options.retentionType ?? SIMPLE_RETENTION_TYPE;
    },
  );
  const distributedStatementMock: MockFunction = jest.fn((): Statement => {
    return wrapperStatement;
  });

  const service: AnalyticsDatabaseService<AnalyticsBaseModel> = {
    model,
    execute: executeMock,
    doesColumnExist: doesColumnExistMock,
    getColumnDatabaseType: getColumnDatabaseTypeMock,
    statementGenerator: {
      toDistributedTableCreateStatement: distributedStatementMock,
    },
  } as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>;

  const tableExistsSpy: MockSpy = jest
    .spyOn(ClickHouseMigrationUtil, "tableExists")
    .mockResolvedValue(options.tableExists ?? true);
  const getCreateQuerySpy: MockSpy = jest
    .spyOn(ClickHouseMigrationUtil, "getCreateQuery")
    .mockImplementation(async (): Promise<string | null> => {
      if (
        (!state.migrated && options.createQueryReadable === false) ||
        (state.migrated && options.postCreateQueryReadable === false)
      ) {
        return null;
      }

      const hasSetting: boolean = state.migrated
        ? options.postHasCompatibilitySetting ?? false
        : options.hasCompatibilitySetting ?? false;
      return `CREATE TABLE ${model.tableName} (${
        hasSetting
          ? `retentionDate DateTime) SETTINGS ${COMPATIBILITY_SETTING} = 1`
          : "retentionDate DateTime)"
      }`;
    });

  const target: MetricAggregateTarget = {
    service,
    hasRetentionDate,
  };

  return {
    migration: new MigrateMetricAggregatesToStrictSchema([target]),
    service,
    state,
    executeMock,
    doesColumnExistMock,
    getColumnDatabaseTypeMock,
    distributedStatementMock,
    tableExistsSpy,
    getCreateQuerySpy,
    wrapperStatement,
  };
}

describe("MigrateMetricAggregatesToStrictSchema", () => {
  const originalClusterName: string | undefined = process.env[CLUSTER_ENV_KEY];

  beforeEach(() => {
    process.env[CLUSTER_ENV_KEY] = "migration_test";
    jest.spyOn(logger, "info").mockImplementation((): void => {
      return;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalClusterName === undefined) {
      delete process.env[CLUSTER_ENV_KEY];
    } else {
      process.env[CLUSTER_ENV_KEY] = originalClusterName;
    }
  });

  test("skips a missing local table without inspecting or mutating it", async () => {
    const harness: MigrationHarness = makeHarness({ tableExists: false });

    await harness.migration.migrate();

    expect(harness.tableExistsSpy).toHaveBeenCalledWith(
      "MetricItemAggMV1mLocal",
    );
    expect(harness.getCreateQuerySpy).not.toHaveBeenCalled();
    expect(harness.doesColumnExistMock).not.toHaveBeenCalled();
    expect(harness.getColumnDatabaseTypeMock).not.toHaveBeenCalled();
    expect(harness.executeMock).not.toHaveBeenCalled();
  });

  test("the production default covers all six live metric aggregate targets", async () => {
    const tableExistsSpy: MockSpy = jest
      .spyOn(ClickHouseMigrationUtil, "tableExists")
      .mockResolvedValue(false);

    await new MigrateMetricAggregatesToStrictSchema().migrate();

    expect(
      tableExistsSpy.mock.calls.map((call: Array<unknown>): unknown => {
        return call[0];
      }),
    ).toEqual([
      "MetricItemAggMV1mLocal",
      "MetricItemAggMV1mByHostV2Local",
      "MetricItemAggMV1mByServiceLocal",
      "MetricItemAggMV1mByK8sClusterLocal",
      "MetricItemAggMV1mByContainerLocal",
      "MetricBaselineHourlyLocal",
    ]);
  });

  test("is a true no-op when the table is already strict", async () => {
    const harness: MigrationHarness = makeHarness();

    await harness.migration.migrate();

    expect(harness.doesColumnExistMock.mock.calls).toEqual([
      ["_id"],
      ["createdAt"],
      ["updatedAt"],
    ]);
    expect(harness.getCreateQuerySpy).toHaveBeenCalledTimes(1);
    expect(harness.getColumnDatabaseTypeMock).toHaveBeenCalledTimes(1);
    expect(harness.executeMock).not.toHaveBeenCalled();
    expect(harness.state.migrated).toBe(false);
  });

  test("normalizes harmless whitespace and casing in an already-strict retention type", async () => {
    const harness: MigrationHarness = makeHarness({
      retentionType: " simpleaggregatefunction( MAX, DateTime ) ",
    });

    await harness.migration.migrate();

    expect(harness.executeMock).not.toHaveBeenCalled();
    expect(harness.state.migrated).toBe(false);
  });

  test("performs the complete legacy transition in a deterministic order", async () => {
    const harness: MigrationHarness = makeHarness({
      legacyColumns: ["_id", "createdAt", "updatedAt"],
      retentionType: "DateTime",
      hasCompatibilitySetting: true,
    });

    await harness.migration.migrate();

    expect(harness.executeMock).toHaveBeenCalledTimes(4);
    expect(harness.executeMock).toHaveBeenNthCalledWith(
      1,
      "DROP VIEW IF EXISTS MetricItemAggMV1m_mv ON CLUSTER 'migration_test' SYNC",
      MigrationExecuteOptions,
    );
    expect(harness.executeMock).toHaveBeenNthCalledWith(
      2,
      "ALTER TABLE MetricItemAggMV1mLocal ON CLUSTER 'migration_test' DROP COLUMN IF EXISTS _id, DROP COLUMN IF EXISTS createdAt, DROP COLUMN IF EXISTS updatedAt, MODIFY COLUMN retentionDate SimpleAggregateFunction(max, DateTime), RESET SETTING allow_dimensions_outside_sorting_key",
      MigrationExecuteOptions,
    );
    expect(harness.executeMock).toHaveBeenNthCalledWith(
      3,
      harness.wrapperStatement,
      MigrationExecuteOptions,
    );
    expect(harness.executeMock.mock.calls[3]?.[0]).toContain(
      "CREATE MATERIALIZED VIEW IF NOT EXISTS MetricItemAggMV1m_mv ON CLUSTER 'migration_test'",
    );
    expect(harness.executeMock.mock.calls[3]?.[0]).toContain(
      "TO MetricItemAggMV1mLocal",
    );
    expect(harness.executeMock.mock.calls[3]?.[0]).toContain(
      "FROM MetricItemV3Local",
    );
    expect(harness.executeMock.mock.calls[3]?.[1]).toBe(
      MigrationExecuteOptions,
    );
    expect(harness.distributedStatementMock).toHaveBeenCalledTimes(1);
    expect(harness.doesColumnExistMock).toHaveBeenCalledTimes(6);
    expect(harness.getColumnDatabaseTypeMock).toHaveBeenCalledTimes(2);
    expect(harness.getCreateQuerySpy).toHaveBeenCalledTimes(2);
    expect(harness.state.migrated).toBe(true);
  });

  test("drops only legacy columns that actually exist", async () => {
    const harness: MigrationHarness = makeHarness({
      legacyColumns: ["_id"],
    });

    await harness.migration.migrate();

    const alter: string = harness.executeMock.mock.calls[1]?.[0] as string;
    expect(alter).toContain("DROP COLUMN IF EXISTS _id");
    expect(alter).not.toContain("DROP COLUMN IF EXISTS createdAt");
    expect(alter).not.toContain("DROP COLUMN IF EXISTS updatedAt");
    expect(alter).not.toContain("MODIFY COLUMN retentionDate");
    expect(alter).not.toContain("RESET SETTING");
  });

  test("can migrate retentionDate without legacy columns or a compatibility setting", async () => {
    const harness: MigrationHarness = makeHarness({
      retentionType: "DateTime",
    });

    await harness.migration.migrate();

    expect(harness.executeMock.mock.calls[1]?.[0]).toBe(
      "ALTER TABLE MetricItemAggMV1mLocal ON CLUSTER 'migration_test' MODIFY COLUMN retentionDate SimpleAggregateFunction(max, DateTime)",
    );
  });

  test("can remove only the compatibility setting from a baseline table", async () => {
    const harness: MigrationHarness = makeHarness({
      model: makeModel("MetricBaselineHourly"),
      hasRetentionDate: false,
      hasCompatibilitySetting: true,
    });

    await harness.migration.migrate();

    expect(harness.getColumnDatabaseTypeMock).not.toHaveBeenCalled();
    expect(harness.executeMock.mock.calls[1]?.[0]).toBe(
      "ALTER TABLE MetricBaselineHourlyLocal ON CLUSTER 'migration_test' RESET SETTING allow_dimensions_outside_sorting_key",
    );
  });

  test.each(["", "Nullable(DateTime)", "String"])(
    "rejects unexpected retentionDate type %p before detaching the view",
    async (retentionType: string) => {
      const harness: MigrationHarness = makeHarness({ retentionType });

      await expect(harness.migration.migrate()).rejects.toThrow(
        `retentionDate has unexpected type "${retentionType}"`,
      );
      expect(harness.executeMock).not.toHaveBeenCalled();
      expect(harness.state.migrated).toBe(false);
    },
  );

  test("fails closed when the table CREATE statement cannot be inspected", async () => {
    const harness: MigrationHarness = makeHarness({
      createQueryReadable: false,
      legacyColumns: ["_id"],
      retentionType: "DateTime",
    });

    await expect(harness.migration.migrate()).rejects.toThrow(
      "could not read the CREATE statement",
    );
    expect(harness.getColumnDatabaseTypeMock).not.toHaveBeenCalled();
    expect(harness.executeMock).not.toHaveBeenCalled();
  });

  test.each([
    ["drop", 1],
    ["alter", 2],
    ["wrapper", 3],
    ["view", 4],
  ] as Array<[FailurePhase, number]>)(
    "stops immediately when the %s phase fails",
    async (failurePhase: FailurePhase, expectedCalls: number) => {
      const harness: MigrationHarness = makeHarness({
        legacyColumns: ["_id"],
        retentionType: "DateTime",
        hasCompatibilitySetting: true,
        failurePhase,
      });

      await expect(harness.migration.migrate()).rejects.toThrow(
        `${failurePhase} failed`,
      );
      expect(harness.executeMock).toHaveBeenCalledTimes(expectedCalls);
      expect(harness.getCreateQuerySpy).toHaveBeenCalledTimes(1);
      expect(harness.getColumnDatabaseTypeMock).toHaveBeenCalledTimes(1);
    },
  );

  test("verification rejects a synthetic dimension that remains after ALTER", async () => {
    const harness: MigrationHarness = makeHarness({
      legacyColumns: ["_id"],
      postLegacyColumns: ["_id"],
    });

    await expect(harness.migration.migrate()).rejects.toThrow(
      "MetricItemAggMV1mLocal._id still exists",
    );
    expect(harness.executeMock).toHaveBeenCalledTimes(4);
  });

  test("verification rejects retentionDate that did not converge", async () => {
    const harness: MigrationHarness = makeHarness({
      retentionType: "DateTime",
      postRetentionType: "DateTime",
    });

    await expect(harness.migration.migrate()).rejects.toThrow(
      'retentionDate is "DateTime"',
    );
    expect(harness.executeMock).toHaveBeenCalledTimes(4);
  });

  test("verification rejects a compatibility setting that remains", async () => {
    const harness: MigrationHarness = makeHarness({
      hasCompatibilitySetting: true,
      postHasCompatibilitySetting: true,
    });

    await expect(harness.migration.migrate()).rejects.toThrow(
      `still uses ${COMPATIBILITY_SETTING}`,
    );
    expect(harness.executeMock).toHaveBeenCalledTimes(4);
  });

  test("verification fails closed when the post-ALTER CREATE statement cannot be read", async () => {
    const harness: MigrationHarness = makeHarness({
      legacyColumns: ["_id"],
      postCreateQueryReadable: false,
    });

    await expect(harness.migration.migrate()).rejects.toThrow(
      "verification failed; could not read the CREATE statement",
    );
    expect(harness.executeMock).toHaveBeenCalledTimes(4);
    expect(harness.getCreateQuerySpy).toHaveBeenCalledTimes(2);
  });
});
