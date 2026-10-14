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
 * Attribute-filtered log searches over more than a few hours read the whole
 * `attributes` column and hit max_execution_time. Log.attributes now declares
 * a bloom filter over the attribute values; boot schema-sync adds its
 * definition, and this migration builds it for the parts written before that.
 *
 * What is pinned: it materializes the index the Log model declares, on the
 * local storage table ON CLUSTER, as a background mutation; it re-adds the
 * index first in case schema-sync's ADD failed; and, because the index only
 * changes speed, never results, it never halts the migration chain.
 */

jest.mock("Common/Server/Services/LogService", () => {
  return {
    __esModule: true,
    default: {
      execute: jest.fn(),
      statementGenerator: {
        toAddSkipIndexStatement: jest.fn(),
      },
    },
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

import LogService from "Common/Server/Services/LogService";
import { MigrationExecuteOptions } from "Common/Server/Services/AnalyticsDatabaseService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import logger from "Common/Server/Utils/Logger";
import Log from "Common/Models/AnalyticsModels/Log";
import AnalyticsTableColumn, {
  SkipIndexType,
} from "Common/Types/AnalyticsDatabase/TableColumn";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import MaterializeAttributeValuesIndexOnLogTable, {
  ATTRIBUTE_VALUES_INDEX_NAME,
} from "../../../FeatureSet/Workers/DataMigrations/MaterializeAttributeValuesIndexOnLogTable";

type MockFunction = ReturnType<typeof jest.fn>;

const logService: {
  execute: MockFunction;
  statementGenerator: { toAddSkipIndexStatement: MockFunction };
} = LogService as unknown as {
  execute: MockFunction;
  statementGenerator: { toAddSkipIndexStatement: MockFunction };
};

const migrationUtil: { tableExists: MockFunction } =
  ClickHouseMigrationUtil as unknown as { tableExists: MockFunction };

const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";

const EXPECTED_STATEMENT: string =
  "ALTER TABLE LogItemV3Local ON CLUSTER 'oneuptime' MATERIALIZE INDEX idx_attribute_values SETTINGS mutations_sync = 0";

const ADD_INDEX_STATEMENT: Statement = new Statement().append(
  "ALTER TABLE oneuptime.LogItemV3Local ON CLUSTER 'oneuptime' ADD INDEX IF NOT EXISTS idx_attribute_values mapValues(attributes) TYPE bloom_filter(0.01) GRANULARITY 1",
);

let savedClusterName: string | undefined;
let errorSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  savedClusterName = process.env[CLUSTER_ENV_KEY];
  delete process.env[CLUSTER_ENV_KEY];

  logService.execute.mockReset();
  logService.statementGenerator.toAddSkipIndexStatement.mockReset();
  migrationUtil.tableExists.mockReset();

  migrationUtil.tableExists.mockImplementation(() => {
    return Promise.resolve(true);
  });
  logService.statementGenerator.toAddSkipIndexStatement.mockImplementation(
    () => {
      return ADD_INDEX_STATEMENT;
    },
  );
  logService.execute.mockImplementation(() => {
    return Promise.resolve(undefined);
  });

  jest.spyOn(logger, "info").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation(() => {
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

  jest.restoreAllMocks();
});

describe("MaterializeAttributeValuesIndexOnLogTable", () => {
  test("has a stable name and runs on the clustered schema", () => {
    const migration: MaterializeAttributeValuesIndexOnLogTable =
      new MaterializeAttributeValuesIndexOnLogTable();

    // The runner records migrations by name; renaming it would re-run it.
    expect(migration.name).toBe("MaterializeAttributeValuesIndexOnLogTable");
    expect(migration.runsInClusterMode()).toBe(true);
  });

  test("materializes the index in the background on the local table ON CLUSTER", () => {
    expect(
      MaterializeAttributeValuesIndexOnLogTable.getMaterializeStatement(
        "LogItemV3",
      ),
    ).toBe(EXPECTED_STATEMENT);
    expect(new Log().tableName).toBe("LogItemV3");
  });

  test("targets the configured cluster", () => {
    process.env[CLUSTER_ENV_KEY] = "analytics";

    expect(
      MaterializeAttributeValuesIndexOnLogTable.getMaterializeStatement(
        "LogItemV3",
      ),
    ).toContain(
      "ALTER TABLE LogItemV3Local ON CLUSTER 'analytics' MATERIALIZE",
    );
  });

  test("materializes the value index the Log model declares", () => {
    const attributes: AnalyticsTableColumn = new Log().getTableColumn(
      "attributes",
    )!;

    expect(attributes.skipIndex?.name).toBe(ATTRIBUTE_VALUES_INDEX_NAME);
    expect(attributes.skipIndex?.type).toBe(SkipIndexType.BloomFilter);
    expect(attributes.skipIndex?.expression).toBe("mapValues(attributes)");
  });

  test("re-adds the index, then queues the materialization", async () => {
    await new MaterializeAttributeValuesIndexOnLogTable().migrate();

    expect(migrationUtil.tableExists).toHaveBeenCalledWith("LogItemV3Local");

    expect(
      logService.statementGenerator.toAddSkipIndexStatement,
    ).toHaveBeenCalledTimes(1);
    const column: AnalyticsTableColumn = logService.statementGenerator
      .toAddSkipIndexStatement.mock.calls[0]![0] as AnalyticsTableColumn;
    expect(column.key).toBe("attributes");
    expect(column.skipIndex?.name).toBe(ATTRIBUTE_VALUES_INDEX_NAME);

    expect(logService.execute).toHaveBeenCalledTimes(2);
    expect(logService.execute).toHaveBeenNthCalledWith(
      1,
      ADD_INDEX_STATEMENT,
      MigrationExecuteOptions,
    );
    expect(logService.execute).toHaveBeenNthCalledWith(
      2,
      EXPECTED_STATEMENT,
      MigrationExecuteOptions,
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("does nothing, and does not fail, when the table does not exist yet", async () => {
    migrationUtil.tableExists.mockImplementation(() => {
      return Promise.resolve(false);
    });

    await expect(
      new MaterializeAttributeValuesIndexOnLogTable().migrate(),
    ).resolves.toBeUndefined();

    expect(logService.execute).not.toHaveBeenCalled();
  });

  test("a failed materialization is logged with the statement to run by hand, and never halts the chain", async () => {
    logService.execute.mockImplementation(((statement: Statement | string) => {
      return typeof statement === "string"
        ? Promise.reject(new Error("TIMEOUT_EXCEEDED"))
        : Promise.resolve(undefined);
    }) as never);

    await expect(
      new MaterializeAttributeValuesIndexOnLogTable().migrate(),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(EXPECTED_STATEMENT),
    );
  });

  test("a failed index add or table lookup never halts the chain either", async () => {
    logService.execute.mockImplementation(() => {
      return Promise.reject(new Error("UNKNOWN_TABLE"));
    });

    await expect(
      new MaterializeAttributeValuesIndexOnLogTable().migrate(),
    ).resolves.toBeUndefined();
    // The materialization is not attempted after the add failed.
    expect(logService.execute).toHaveBeenCalledTimes(1);

    logService.execute.mockClear();
    migrationUtil.tableExists.mockImplementation(() => {
      return Promise.reject(new Error("connection refused"));
    });

    await expect(
      new MaterializeAttributeValuesIndexOnLogTable().migrate(),
    ).resolves.toBeUndefined();
    expect(logService.execute).not.toHaveBeenCalled();
  });

  test("rollback leaves the index in place", async () => {
    await expect(
      new MaterializeAttributeValuesIndexOnLogTable().rollback(),
    ).resolves.toBeUndefined();
    expect(logService.execute).not.toHaveBeenCalled();
  });

  test("is registered once, after every migration that existed before it", () => {
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

    expect(index).toContain(
      'import MaterializeAttributeValuesIndexOnLogTable from "./MaterializeAttributeValuesIndexOnLogTable";',
    );

    const registered: Array<string> = Array.from(
      index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
    ).map((match: RegExpMatchArray) => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string) => {
        return name === "MaterializeAttributeValuesIndexOnLogTable";
      }),
    ).toHaveLength(1);
    expect(
      registered.indexOf("MaterializeAttributeValuesIndexOnLogTable"),
    ).toBeGreaterThan(
      registered.indexOf("BackfillIncidentCustomFieldVariableKeys"),
    );
  });
});
