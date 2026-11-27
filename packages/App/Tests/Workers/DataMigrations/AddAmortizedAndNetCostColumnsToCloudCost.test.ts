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
 * Cloud costs gained two columns (#11007): each cost amortized
 * (CloudCostV1.amortizedCost, commitment fees spread over what they cover)
 * and net (CloudCostV1.netCost, less credits, refunds and discounts), so
 * Cloud > Costs shows the spend on the basis a person picks. The costs
 * lane writes both on every row, and an insert that names a column the
 * table does not have is refused - so until they exist, no cost at all
 * would be stored.
 *
 * This migration is the non-cluster path's way of getting them there.
 * What is pinned:
 *
 *   - it adds exactly the two columns, as the model declares them: a
 *     decimal whose DEFAULT is the row's billed cost, so every row written
 *     before reads its billed figure on every basis;
 *   - it is idempotent: a column already there is left alone, and a second
 *     run does nothing;
 *   - it never halts the migration chain over a table that does not exist
 *     yet or a column the model does not declare;
 *   - a real failure IS a failure, and names the column;
 *   - it is baselined on the clustered schema (boot schema-sync adds the
 *     columns there), its rollback drops nothing, and it sits before the
 *     last slot.
 */

jest.mock("Common/Server/Services/CloudCostService", () => {
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

/*
 * The real CloudCost model, with a switch to hide columns from it: the only
 * way to show what the migration does about a column the model does not
 * declare without editing the model.
 */
jest.mock("Common/Models/AnalyticsModels/CloudCost", () => {
  type ColumnLike = { key: string };
  type CloudCostLike = { tableColumns: Array<ColumnLike> };

  const actual: { default: new () => CloudCostLike } = jest.requireActual(
    "Common/Models/AnalyticsModels/CloudCost",
  ) as { default: new () => CloudCostLike };

  const hiddenColumnKeys: Array<string> = [];

  class CloudCostWithHiddenColumns extends actual.default {
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
    default: CloudCostWithHiddenColumns,
    hiddenColumnKeys,
  };
});

import CloudCostService from "Common/Server/Services/CloudCostService";
import ClickhouseDatabase from "Common/Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import logger from "Common/Server/Utils/Logger";
import CloudCost from "Common/Models/AnalyticsModels/CloudCost";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import ClickHouseMigrationUtil from "../../../FeatureSet/Workers/DataMigrations/ClickHouseMigrationUtil";
import DataMigrationBase from "../../../FeatureSet/Workers/DataMigrations/DataMigrationBase";
import AddAmortizedAndNetCostColumnsToCloudCost, {
  CLOUD_COST_BASIS_COLUMN_KEYS,
} from "../../../FeatureSet/Workers/DataMigrations/AddAmortizedAndNetCostColumnsToCloudCost";

type MockFunction = ReturnType<typeof jest.fn>;

interface CloudCostServiceMock {
  doesColumnExist: MockFunction;
  addColumnInDatabase: MockFunction;
  dropColumnInDatabase: MockFunction;
  execute: MockFunction;
}

const cloudCostService: CloudCostServiceMock =
  CloudCostService as unknown as CloudCostServiceMock;

const migrationUtil: { tableExists: MockFunction } =
  ClickHouseMigrationUtil as unknown as { tableExists: MockFunction };

const hiddenColumnKeys: Array<string> = (
  jest.requireMock("Common/Models/AnalyticsModels/CloudCost") as {
    hiddenColumnKeys: Array<string>;
  }
).hiddenColumnKeys;

const MIGRATION_NAME: string = "AddAmortizedAndNetCostColumnsToCloudCost";
const CLUSTER_ENV_KEY: string = "CLICKHOUSE_CLUSTER_NAME";

let savedClusterName: string | undefined;
let existingColumns: Set<string>;
let loggedWarnings: Array<string>;

type KeysFunction = () => Array<string>;

// The keys of the columns the migration asked to add, in order.
const addedKeys: KeysFunction = (): Array<string> => {
  return cloudCostService.addColumnInDatabase.mock.calls.map(
    (call: Array<unknown>): string => {
      return (call[0] as AnalyticsTableColumn).key;
    },
  );
};

const checkedKeys: KeysFunction = (): Array<string> => {
  return cloudCostService.doesColumnExist.mock.calls.map(
    (call: Array<unknown>): string => {
      return call[0] as string;
    },
  );
};

const columnOf: (key: string) => AnalyticsTableColumn = (
  key: string,
): AnalyticsTableColumn => {
  const column: AnalyticsTableColumn | undefined =
    new CloudCost().tableColumns.find((item: AnalyticsTableColumn): boolean => {
      return item.key === key;
    });

  expect(column).toBeDefined();

  return column!;
};

beforeEach(() => {
  savedClusterName = process.env[CLUSTER_ENV_KEY];
  delete process.env[CLUSTER_ENV_KEY];

  hiddenColumnKeys.length = 0;
  existingColumns = new Set<string>();
  loggedWarnings = [];

  cloudCostService.doesColumnExist.mockReset();
  cloudCostService.addColumnInDatabase.mockReset();
  cloudCostService.dropColumnInDatabase.mockReset();
  cloudCostService.execute.mockReset();
  migrationUtil.tableExists.mockReset();

  migrationUtil.tableExists.mockImplementation(() => {
    return Promise.resolve(true);
  });
  cloudCostService.doesColumnExist.mockImplementation(((key: string) => {
    return Promise.resolve(existingColumns.has(key));
  }) as never);
  // Adding a column makes it exist, as it does in the database.
  cloudCostService.addColumnInDatabase.mockImplementation(((
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

describe("AddAmortizedAndNetCostColumnsToCloudCost", () => {
  test("has a stable name: the runner records migrations by name, so renaming it would run it again", () => {
    const migration: AddAmortizedAndNetCostColumnsToCloudCost =
      new AddAmortizedAndNetCostColumnsToCloudCost();

    expect(migration).toBeInstanceOf(DataMigrationBase);
    expect(migration.name).toBe(MIGRATION_NAME);
  });

  test("is baselined on the clustered schema, where boot schema-sync adds the columns", () => {
    expect(
      new AddAmortizedAndNetCostColumnsToCloudCost().runsInClusterMode(),
    ).toBe(false);
  });

  test("the columns are the model's: decimals that read a row's billed cost for every row written before", () => {
    expect(CLOUD_COST_BASIS_COLUMN_KEYS).toEqual(["amortizedCost", "netCost"]);
    expect(new CloudCost().tableName).toBe("CloudCostV1");

    for (const key of CLOUD_COST_BASIS_COLUMN_KEYS) {
      const column: AnalyticsTableColumn = columnOf(key);

      expect(column.type).toBe(TableColumnType.Decimal);
      expect(column.type).toBe(columnOf("cost").type);
      expect(column.defaultExpression).toBe("cost");
      // No index to build: the add is metadata-only.
      expect(column.skipIndex).toBeUndefined();
      // Never changed once written: the table only appends.
      expect(column.accessControl?.update).toEqual([]);
    }
  });

  test("neither is part of the sort key: adding them rewrites nothing", () => {
    const model: CloudCost = new CloudCost();

    for (const key of CLOUD_COST_BASIS_COLUMN_KEYS) {
      expect(model.sortKeys).not.toContain(key);
      expect(model.primaryKeys).not.toContain(key);
    }
  });

  test("adds both columns to the storage table when they are not there", async () => {
    await new AddAmortizedAndNetCostColumnsToCloudCost().migrate();

    // The columns live on the local storage table, not the Distributed wrapper.
    expect(migrationUtil.tableExists).toHaveBeenCalledTimes(1);
    expect(migrationUtil.tableExists).toHaveBeenCalledWith("CloudCostV1Local");

    expect(checkedKeys()).toEqual(["amortizedCost", "netCost"]);
    expect(addedKeys()).toEqual(["amortizedCost", "netCost"]);
  });

  test("hands the service the model's own column definitions, not copies made here", async () => {
    await new AddAmortizedAndNetCostColumnsToCloudCost().migrate();

    const added: Array<AnalyticsTableColumn> =
      cloudCostService.addColumnInDatabase.mock.calls.map(
        (call: Array<unknown>): AnalyticsTableColumn => {
          return call[0] as AnalyticsTableColumn;
        },
      );

    for (const column of added) {
      expect(column).toBeInstanceOf(AnalyticsTableColumn);
      expect(column.type).toBe(columnOf(column.key).type);
      expect(column.defaultExpression).toBe(
        columnOf(column.key).defaultExpression,
      );
      expect(column.codec).toEqual(columnOf(column.key).codec);
    }
  });

  test("adds only the one not there yet (boot schema-sync got to the other)", async () => {
    existingColumns.add("amortizedCost");

    await new AddAmortizedAndNetCostColumnsToCloudCost().migrate();

    expect(checkedKeys()).toEqual(["amortizedCost", "netCost"]);
    expect(addedKeys()).toEqual(["netCost"]);
  });

  test("is idempotent: a second run adds nothing", async () => {
    const migration: AddAmortizedAndNetCostColumnsToCloudCost =
      new AddAmortizedAndNetCostColumnsToCloudCost();

    await migration.migrate();
    await expect(migration.migrate()).resolves.toBeUndefined();

    // Still the two adds of the first run.
    expect(cloudCostService.addColumnInDatabase).toHaveBeenCalledTimes(2);
  });

  test("does nothing, and does not fail, when the table does not exist yet", async () => {
    migrationUtil.tableExists.mockImplementation(() => {
      return Promise.resolve(false);
    });

    await expect(
      new AddAmortizedAndNetCostColumnsToCloudCost().migrate(),
    ).resolves.toBeUndefined();

    expect(cloudCostService.doesColumnExist).not.toHaveBeenCalled();
    expect(cloudCostService.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("skips a column, with a warning, when the model does not declare it - and still adds the other", async () => {
    hiddenColumnKeys.push("netCost");

    await expect(
      new AddAmortizedAndNetCostColumnsToCloudCost().migrate(),
    ).resolves.toBeUndefined();

    expect(checkedKeys()).toEqual(["amortizedCost"]);
    expect(addedKeys()).toEqual(["amortizedCost"]);
    expect(
      loggedWarnings.some((message: string): boolean => {
        return message.includes(MIGRATION_NAME) && message.includes("netCost");
      }),
    ).toBe(true);
  });

  test("a failed add fails the migration and names the column, so the runner retries it on the next run", async () => {
    cloudCostService.addColumnInDatabase.mockImplementation(() => {
      return Promise.reject(new Error("TIMEOUT_EXCEEDED"));
    });

    await expect(
      new AddAmortizedAndNetCostColumnsToCloudCost().migrate(),
    ).rejects.toThrow(
      "AddAmortizedAndNetCostColumnsToCloudCost: CloudCostV1.amortizedCost: TIMEOUT_EXCEEDED",
    );
  });

  test("a failed existence check fails the migration too, rather than adding blind", async () => {
    cloudCostService.doesColumnExist.mockImplementation(() => {
      return Promise.reject(new Error("NETWORK_ERROR"));
    });

    await expect(
      new AddAmortizedAndNetCostColumnsToCloudCost().migrate(),
    ).rejects.toThrow(
      "AddAmortizedAndNetCostColumnsToCloudCost: CloudCostV1.amortizedCost: NETWORK_ERROR",
    );

    expect(cloudCostService.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("rollback drops nothing: the columns hold the figures of every cost read since", async () => {
    await expect(
      new AddAmortizedAndNetCostColumnsToCloudCost().rollback(),
    ).resolves.toBeUndefined();

    expect(migrationUtil.tableExists).not.toHaveBeenCalled();
    expect(cloudCostService.addColumnInDatabase).not.toHaveBeenCalled();
    expect(cloudCostService.dropColumnInDatabase).not.toHaveBeenCalled();
    expect(cloudCostService.execute).not.toHaveBeenCalled();
  });

  test("is registered once, before the last slot AddAuditLogMcpClientColumns keeps", () => {
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
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

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
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 1,
    );
  });
});

describe("the statements the columns are added with", () => {
  /*
   * CloudCostService is a stub above, so the DDL itself is rendered here
   * with the real generator from the model's real column definitions: this
   * is the text addColumnInDatabase sends for each.
   */
  const generator: () => StatementGenerator<CloudCost> =
    (): StatementGenerator<CloudCost> => {
      return new StatementGenerator<CloudCost>({
        modelType: CloudCost,
        database: {
          getDatasourceOptions: (): { database: string } => {
            return { database: "oneuptime" };
          },
        } as unknown as ClickhouseDatabase,
      });
    };

  const WHITESPACE_RUN: RegExp = /\s+/g;

  beforeEach(() => {
    jest.spyOn(logger, "debug").mockImplementation(() => {
      return undefined;
    });
  });

  test("a decimal whose DEFAULT is the billed cost, IF NOT EXISTS, to the local table on every node", () => {
    for (const key of CLOUD_COST_BASIS_COLUMN_KEYS) {
      const statement: Statement = generator().toAddColumnStatement(
        columnOf(key),
      );
      const text: string = statement.query.replace(WHITESPACE_RUN, " ").trim();

      expect(text).toContain(
        `ALTER TABLE {p0:Identifier}.{p1:Identifier} ON CLUSTER 'oneuptime' ADD COLUMN IF NOT EXISTS ${key} `,
      );
      expect(text).toContain(" DEFAULT cost");
      // The database, then the LOCAL storage table - not the Distributed wrapper.
      expect(Object.values(statement.query_params)).toEqual([
        "oneuptime",
        "CloudCostV1Local",
      ]);
    }
  });

  test("no skip index is built: the add stays metadata-only", () => {
    for (const key of CLOUD_COST_BASIS_COLUMN_KEYS) {
      expect(generator().toAddSkipIndexStatement(columnOf(key))).toBeNull();
    }
  });
});
