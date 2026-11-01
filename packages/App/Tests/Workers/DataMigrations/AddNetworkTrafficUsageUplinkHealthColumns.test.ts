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
 * Meraki's traffic table gained two columns for what Meraki measures on an
 * appliance's uplinks: lossPercent and latencyMs on NetworkTrafficUsageV1. The
 * read writes them on every row, and an insert that names a column the table
 * does not have is refused - so until the columns exist, a read would store
 * no traffic at all.
 *
 * This migration is the non-cluster path's way of getting them there. What is
 * pinned:
 *
 *   - it adds exactly the two columns, as the model declares them (Nullable,
 *     so every row written before reads "nothing measured");
 *   - it is idempotent, and never halts the migration chain over a table that
 *     does not exist yet or a column the model does not declare;
 *   - a real failure IS a failure, and names the column;
 *   - it is baselined on the clustered schema (boot schema-sync adds the
 *     columns there), its rollback drops nothing, and it runs before the slot
 *     AddAuditLogMcpClientColumns keeps for itself.
 */

jest.mock("Common/Server/Services/NetworkTrafficUsageService", () => {
  return {
    __esModule: true,
    default: {
      doesColumnExist: jest.fn(),
      addColumnInDatabase: jest.fn(),
      dropColumnInDatabase: jest.fn(),
      execute: jest.fn(),
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

// The real model, with a switch to hide columns from it.
jest.mock("Common/Models/AnalyticsModels/NetworkTrafficUsage", () => {
  type ColumnLike = { key: string };
  type ModelLike = { tableColumns: Array<ColumnLike> };

  const actual: { default: new () => ModelLike } = jest.requireActual(
    "Common/Models/AnalyticsModels/NetworkTrafficUsage",
  ) as { default: new () => ModelLike };

  const hiddenColumnKeys: Array<string> = [];

  class ModelWithHiddenColumns extends actual.default {
    public constructor() {
      super();
      this.tableColumns = this.tableColumns.filter(
        (column: ColumnLike): boolean => {
          return !hiddenColumnKeys.includes(column.key);
        },
      );
    }
  }

  return {
    __esModule: true,
    default: ModelWithHiddenColumns,
    hiddenColumnKeys,
  };
});

import NetworkTrafficUsageService from "Common/Server/Services/NetworkTrafficUsageService";
import ClickhouseDatabase from "Common/Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import logger from "Common/Server/Utils/Logger";
import NetworkTrafficUsage from "Common/Models/AnalyticsModels/NetworkTrafficUsage";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import DataMigrationBase from "../../../FeatureSet/Workers/DataMigrations/DataMigrationBase";
import AddNetworkTrafficUsageUplinkHealthColumns, {
  NETWORK_TRAFFIC_USAGE_UPLINK_HEALTH_COLUMN_KEYS,
} from "../../../FeatureSet/Workers/DataMigrations/AddNetworkTrafficUsageUplinkHealthColumns";

type MockFunction = ReturnType<typeof jest.fn>;

interface ServiceMock {
  doesColumnExist: MockFunction;
  addColumnInDatabase: MockFunction;
  dropColumnInDatabase: MockFunction;
  execute: MockFunction;
}

const service: ServiceMock =
  NetworkTrafficUsageService as unknown as ServiceMock;

const migrationUtil: { tableExists: MockFunction } =
  ClickHouseMigrationUtil as unknown as { tableExists: MockFunction };

const hiddenColumnKeys: Array<string> = (
  jest.requireMock("Common/Models/AnalyticsModels/NetworkTrafficUsage") as {
    hiddenColumnKeys: Array<string>;
  }
).hiddenColumnKeys;

const LOSS_COLUMN: string = "lossPercent";
const LATENCY_COLUMN: string = "latencyMs";
const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";

let savedClusterName: string | undefined;
let existingColumns: Set<string>;
let loggedWarnings: Array<string>;

type AddedKeysFunction = () => Array<string>;

const addedKeys: AddedKeysFunction = (): Array<string> => {
  return service.addColumnInDatabase.mock.calls.map(
    (call: Array<unknown>): string => {
      return (call[0] as AnalyticsTableColumn).key;
    },
  );
};

type ColumnOfFunction = (key: string) => AnalyticsTableColumn;

const columnOf: ColumnOfFunction = (key: string): AnalyticsTableColumn => {
  const column: AnalyticsTableColumn | undefined =
    new NetworkTrafficUsage().tableColumns.find(
      (item: AnalyticsTableColumn): boolean => {
        return item.key === key;
      },
    );

  expect(column).toBeDefined();

  return column!;
};

beforeEach(() => {
  savedClusterName = process.env[CLUSTER_ENV_KEY];
  delete process.env[CLUSTER_ENV_KEY];

  hiddenColumnKeys.length = 0;
  existingColumns = new Set<string>();
  loggedWarnings = [];

  service.doesColumnExist.mockReset();
  service.addColumnInDatabase.mockReset();
  service.dropColumnInDatabase.mockReset();
  service.execute.mockReset();
  migrationUtil.tableExists.mockReset();

  migrationUtil.tableExists.mockImplementation(() => {
    return Promise.resolve(true);
  });
  service.doesColumnExist.mockImplementation(((key: string) => {
    return Promise.resolve(existingColumns.has(key));
  }) as never);
  // Adding a column makes it exist, as it does in the database.
  service.addColumnInDatabase.mockImplementation(((
    column: AnalyticsTableColumn,
  ) => {
    existingColumns.add(column.key);
    return Promise.resolve(undefined);
  }) as never);

  jest.spyOn(logger, "info").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation(((message: unknown) => {
    loggedWarnings.push(String(message));
    return undefined;
  }) as never);
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  if (savedClusterName === undefined) {
    delete process.env[CLUSTER_ENV_KEY];
  } else {
    process.env[CLUSTER_ENV_KEY] = savedClusterName;
  }

  hiddenColumnKeys.length = 0;
  jest.restoreAllMocks();
});

describe("AddNetworkTrafficUsageUplinkHealthColumns", () => {
  test("has a stable name: the runner records migrations by name, so renaming it would run it again", () => {
    const migration: AddNetworkTrafficUsageUplinkHealthColumns =
      new AddNetworkTrafficUsageUplinkHealthColumns();

    expect(migration).toBeInstanceOf(DataMigrationBase);
    expect(migration.name).toBe("AddNetworkTrafficUsageUplinkHealthColumns");
  });

  test("is baselined on the clustered schema, where boot schema-sync adds the columns", () => {
    expect(
      new AddNetworkTrafficUsageUplinkHealthColumns().runsInClusterMode(),
    ).toBe(false);
  });

  test("adds exactly the two columns, and the model declares both", () => {
    expect([...NETWORK_TRAFFIC_USAGE_UPLINK_HEALTH_COLUMN_KEYS]).toEqual([
      LOSS_COLUMN,
      LATENCY_COLUMN,
    ]);

    const declared: Array<string> = new NetworkTrafficUsage().tableColumns.map(
      (column: AnalyticsTableColumn): string => {
        return column.key;
      },
    );

    for (const key of NETWORK_TRAFFIC_USAGE_UPLINK_HEALTH_COLUMN_KEYS) {
      expect(declared).toContain(key);
    }

    expect(new NetworkTrafficUsage().tableName).toBe("NetworkTrafficUsageV1");
  });

  test("both columns are optional decimals, so rows written before read as 'nothing measured'", () => {
    for (const key of [LOSS_COLUMN, LATENCY_COLUMN]) {
      const column: AnalyticsTableColumn = columnOf(key);

      expect(column.required).toBe(false);
      expect(column.type).toBe(TableColumnType.Decimal);
      // No default to backfill and no index to build: the add is metadata-only.
      expect(column.defaultValue).toBeUndefined();
      expect(column.skipIndex).toBeUndefined();
    }
  });

  test("adds both columns to the storage table when neither exists", async () => {
    await new AddNetworkTrafficUsageUplinkHealthColumns().migrate();

    // The columns live on the local storage table, not the Distributed wrapper.
    expect(migrationUtil.tableExists).toHaveBeenCalledWith(
      "NetworkTrafficUsageV1Local",
    );
    expect(addedKeys()).toEqual([LOSS_COLUMN, LATENCY_COLUMN]);
  });

  test("leaves a column that is already there alone, and still adds the other", async () => {
    existingColumns.add(LOSS_COLUMN);

    await new AddNetworkTrafficUsageUplinkHealthColumns().migrate();

    expect(addedKeys()).toEqual([LATENCY_COLUMN]);
  });

  test("is idempotent: a second run adds nothing", async () => {
    const migration: AddNetworkTrafficUsageUplinkHealthColumns =
      new AddNetworkTrafficUsageUplinkHealthColumns();

    await migration.migrate();
    await expect(migration.migrate()).resolves.toBeUndefined();

    expect(service.addColumnInDatabase).toHaveBeenCalledTimes(2);
  });

  test("does nothing, and does not fail, when the table does not exist yet", async () => {
    migrationUtil.tableExists.mockImplementation(() => {
      return Promise.resolve(false);
    });

    await expect(
      new AddNetworkTrafficUsageUplinkHealthColumns().migrate(),
    ).resolves.toBeUndefined();

    expect(service.doesColumnExist).not.toHaveBeenCalled();
    expect(service.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("skips a column the model does not declare, with a warning, and still adds the one it does", async () => {
    hiddenColumnKeys.push(LATENCY_COLUMN);

    await expect(
      new AddNetworkTrafficUsageUplinkHealthColumns().migrate(),
    ).resolves.toBeUndefined();

    expect(addedKeys()).toEqual([LOSS_COLUMN]);
    expect(
      loggedWarnings.some((message: string): boolean => {
        return message.includes(LATENCY_COLUMN);
      }),
    ).toBe(true);
  });

  test("a failed add fails the migration and names the column, so the runner retries it on the next run", async () => {
    service.addColumnInDatabase.mockImplementation(() => {
      return Promise.reject(new Error("TIMEOUT_EXCEEDED"));
    });

    await expect(
      new AddNetworkTrafficUsageUplinkHealthColumns().migrate(),
    ).rejects.toThrow(
      "AddNetworkTrafficUsageUplinkHealthColumns: NetworkTrafficUsageV1.lossPercent: TIMEOUT_EXCEEDED",
    );

    // It stops at the first failure rather than pressing on to the next column.
    expect(service.addColumnInDatabase).toHaveBeenCalledTimes(1);
  });

  test("a failed existence check fails the migration too, rather than adding blind", async () => {
    service.doesColumnExist.mockImplementation(() => {
      return Promise.reject(new Error("NETWORK_ERROR"));
    });

    await expect(
      new AddNetworkTrafficUsageUplinkHealthColumns().migrate(),
    ).rejects.toThrow("NetworkTrafficUsageV1.lossPercent: NETWORK_ERROR");

    expect(service.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("rollback drops nothing: the columns hold every measurement since", async () => {
    await expect(
      new AddNetworkTrafficUsageUplinkHealthColumns().rollback(),
    ).resolves.toBeUndefined();

    expect(service.dropColumnInDatabase).not.toHaveBeenCalled();
    expect(service.execute).not.toHaveBeenCalled();
  });

  test("runs once, before the slot AddAuditLogMcpClientColumns keeps for itself", () => {
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
        return name === "AddNetworkTrafficUsageUplinkHealthColumns";
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 2]).toBe(
      "AddNetworkTrafficUsageUplinkHealthColumns",
    );
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
  });
});

describe("the statements the two columns are added with", () => {
  const WHITESPACE_RUN: RegExp = /\s+/g;

  test.each([LOSS_COLUMN, LATENCY_COLUMN])(
    "%s is added Nullable, IF NOT EXISTS, to the local table on every node",
    (key: string) => {
      jest.spyOn(logger, "debug").mockImplementation(() => {
        return undefined;
      });

      const generator: StatementGenerator<NetworkTrafficUsage> =
        new StatementGenerator<NetworkTrafficUsage>({
          modelType: NetworkTrafficUsage,
          database: {
            getDatasourceOptions: (): { database: string } => {
              return { database: "oneuptime" };
            },
          } as unknown as ClickhouseDatabase,
        });

      const statement: Statement = generator.toAddColumnStatement(
        columnOf(key),
      );

      expect(statement.query.replace(WHITESPACE_RUN, " ").trim()).toBe(
        `ALTER TABLE {p0:Identifier}.{p1:Identifier} ON CLUSTER 'oneuptime' ADD COLUMN IF NOT EXISTS ${key} Nullable(Double)`,
      );
      expect(Object.values(statement.query_params)).toEqual([
        "oneuptime",
        "NetworkTrafficUsageV1Local",
      ]);
    },
  );
});
