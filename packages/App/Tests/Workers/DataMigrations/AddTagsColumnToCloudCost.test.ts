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
 * Cloud costs gained one column: each cost's tags (CloudCostV1.tags, a
 * Map(String, String)) - a Google Cloud billing export's labels, else the
 * tags of the resource the cost is billed to - so Cloud > Costs breaks the
 * spend down by a tag. The costs lane writes it on every row, and an insert
 * that names a column the table does not have is refused - so until the
 * column exists, no cost at all would be stored.
 *
 * This migration is the non-cluster path's way of getting it there. What is
 * pinned:
 *
 *   - it adds exactly the one column, as the model declares it (a map with
 *     an empty default, so every row written before reads "no tags");
 *   - it is idempotent: a column already there is left alone, and a second
 *     run does nothing;
 *   - it never halts the migration chain over a table that does not exist
 *     yet or a column the model does not declare;
 *   - a real failure IS a failure, and names the column;
 *   - it is baselined on the clustered schema (boot schema-sync adds the
 *     column there), its rollback drops nothing, and it sits before the last
 *     slot.
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
import AddTagsColumnToCloudCost, {
  CLOUD_COST_TAGS_COLUMN_KEY,
} from "../../../FeatureSet/Workers/DataMigrations/AddTagsColumnToCloudCost";

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

const MIGRATION_NAME: string = "AddTagsColumnToCloudCost";
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

const tagsColumn: () => AnalyticsTableColumn = (): AnalyticsTableColumn => {
  const column: AnalyticsTableColumn | undefined =
    new CloudCost().tableColumns.find((item: AnalyticsTableColumn): boolean => {
      return item.key === CLOUD_COST_TAGS_COLUMN_KEY;
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

describe("AddTagsColumnToCloudCost", () => {
  test("has a stable name: the runner records migrations by name, so renaming it would run it again", () => {
    const migration: AddTagsColumnToCloudCost = new AddTagsColumnToCloudCost();

    expect(migration).toBeInstanceOf(DataMigrationBase);
    expect(migration.name).toBe(MIGRATION_NAME);
  });

  test("is baselined on the clustered schema, where boot schema-sync adds the column", () => {
    expect(new AddTagsColumnToCloudCost().runsInClusterMode()).toBe(false);
  });

  test("the column is the model's: each cost's tags, a map that reads empty for every row written before", () => {
    expect(CLOUD_COST_TAGS_COLUMN_KEY).toBe("tags");
    expect(new CloudCost().tableName).toBe("CloudCostV1");

    const column: AnalyticsTableColumn = tagsColumn();

    expect(column.type).toBe(TableColumnType.MapStringString);
    expect(column.required).toBe(true);
    expect(column.defaultValue).toEqual({});
    // No index to build: the add is metadata-only.
    expect(column.skipIndex).toBeUndefined();
    // Never changed once written: a cost keeps the tags it was read with.
    expect(column.accessControl?.update).toEqual([]);
  });

  test("the tags are no part of the sort key: adding them rewrites nothing", () => {
    const model: CloudCost = new CloudCost();

    expect(model.sortKeys).not.toContain(CLOUD_COST_TAGS_COLUMN_KEY);
    expect(model.primaryKeys).not.toContain(CLOUD_COST_TAGS_COLUMN_KEY);
  });

  test("adds the column to the storage table when it is not there", async () => {
    await new AddTagsColumnToCloudCost().migrate();

    // The column lives on the local storage table, not the Distributed wrapper.
    expect(migrationUtil.tableExists).toHaveBeenCalledTimes(1);
    expect(migrationUtil.tableExists).toHaveBeenCalledWith("CloudCostV1Local");

    expect(checkedKeys()).toEqual(["tags"]);
    expect(addedKeys()).toEqual(["tags"]);
  });

  test("hands the service the model's own column definition, not a copy made here", async () => {
    await new AddTagsColumnToCloudCost().migrate();

    const added: AnalyticsTableColumn = cloudCostService.addColumnInDatabase
      .mock.calls[0]![0] as AnalyticsTableColumn;

    expect(added).toBeInstanceOf(AnalyticsTableColumn);
    expect(added.type).toBe(tagsColumn().type);
    expect(added.required).toBe(tagsColumn().required);
    expect(added.title).toBe(tagsColumn().title);
    expect(added.codec).toEqual(tagsColumn().codec);
  });

  test("does nothing when the column is already there (boot schema-sync got there first)", async () => {
    existingColumns.add("tags");

    await expect(
      new AddTagsColumnToCloudCost().migrate(),
    ).resolves.toBeUndefined();

    expect(checkedKeys()).toEqual(["tags"]);
    expect(cloudCostService.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("is idempotent: a second run adds nothing", async () => {
    const migration: AddTagsColumnToCloudCost = new AddTagsColumnToCloudCost();

    await migration.migrate();
    await expect(migration.migrate()).resolves.toBeUndefined();

    // Still the one add of the first run.
    expect(cloudCostService.addColumnInDatabase).toHaveBeenCalledTimes(1);
  });

  test("does nothing, and does not fail, when the table does not exist yet", async () => {
    migrationUtil.tableExists.mockImplementation(() => {
      return Promise.resolve(false);
    });

    await expect(
      new AddTagsColumnToCloudCost().migrate(),
    ).resolves.toBeUndefined();

    expect(migrationUtil.tableExists).toHaveBeenCalledWith("CloudCostV1Local");
    expect(cloudCostService.doesColumnExist).not.toHaveBeenCalled();
    expect(cloudCostService.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("skips the column, with a warning, when the model does not declare it", async () => {
    hiddenColumnKeys.push("tags");

    await expect(
      new AddTagsColumnToCloudCost().migrate(),
    ).resolves.toBeUndefined();

    // Never asked about, never added: there is no definition to add it from.
    expect(cloudCostService.doesColumnExist).not.toHaveBeenCalled();
    expect(cloudCostService.addColumnInDatabase).not.toHaveBeenCalled();
    expect(
      loggedWarnings.some((message: string): boolean => {
        return message.includes(MIGRATION_NAME) && message.includes("tags");
      }),
    ).toBe(true);
  });

  test("a failed add fails the migration and names the column, so the runner retries it on the next run", async () => {
    cloudCostService.addColumnInDatabase.mockImplementation(() => {
      return Promise.reject(new Error("TIMEOUT_EXCEEDED"));
    });

    await expect(new AddTagsColumnToCloudCost().migrate()).rejects.toThrow(
      "AddTagsColumnToCloudCost: CloudCostV1.tags: TIMEOUT_EXCEEDED",
    );
  });

  test("a failed existence check fails the migration too, rather than adding blind", async () => {
    cloudCostService.doesColumnExist.mockImplementation(() => {
      return Promise.reject(new Error("NETWORK_ERROR"));
    });

    await expect(new AddTagsColumnToCloudCost().migrate()).rejects.toThrow(
      "AddTagsColumnToCloudCost: CloudCostV1.tags: NETWORK_ERROR",
    );

    expect(cloudCostService.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("a failed table check fails the migration", async () => {
    migrationUtil.tableExists.mockImplementation(() => {
      return Promise.reject(new Error("CONNECTION_REFUSED"));
    });

    await expect(new AddTagsColumnToCloudCost().migrate()).rejects.toThrow(
      "CONNECTION_REFUSED",
    );

    expect(cloudCostService.doesColumnExist).not.toHaveBeenCalled();
    expect(cloudCostService.addColumnInDatabase).not.toHaveBeenCalled();
  });

  test("rollback drops nothing: the column holds the tags of every cost read since", async () => {
    await expect(
      new AddTagsColumnToCloudCost().rollback(),
    ).resolves.toBeUndefined();

    expect(migrationUtil.tableExists).not.toHaveBeenCalled();
    expect(cloudCostService.doesColumnExist).not.toHaveBeenCalled();
    expect(cloudCostService.addColumnInDatabase).not.toHaveBeenCalled();
    expect(cloudCostService.dropColumnInDatabase).not.toHaveBeenCalled();
    expect(cloudCostService.execute).not.toHaveBeenCalled();
  });

  test("the migration only adds: it issues no statement of its own", async () => {
    await new AddTagsColumnToCloudCost().migrate();

    expect(cloudCostService.execute).not.toHaveBeenCalled();
    expect(cloudCostService.dropColumnInDatabase).not.toHaveBeenCalled();
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

describe("the statement the column is added with", () => {
  /*
   * CloudCostService is a stub above, so the DDL itself is rendered here
   * with the real generator from the model's real column definition: this
   * is the text addColumnInDatabase sends for it.
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

  test("a compressed Map(String, String), IF NOT EXISTS, to the local table on every node", () => {
    const statement: Statement = generator().toAddColumnStatement(tagsColumn());

    /*
     * No DEFAULT clause: a map's own default is the empty map, which is
     * what every row stored before reads.
     */
    expect(statement.query.replace(WHITESPACE_RUN, " ").trim()).toBe(
      "ALTER TABLE {p0:Identifier}.{p1:Identifier} ON CLUSTER 'oneuptime' ADD COLUMN IF NOT EXISTS tags Map(String, String) CODEC(ZSTD(3))",
    );
    // The database, then the LOCAL storage table - not the Distributed wrapper.
    expect(Object.values(statement.query_params)).toEqual([
      "oneuptime",
      "CloudCostV1Local",
    ]);
  });

  test("the statement follows the configured cluster", () => {
    process.env[CLUSTER_ENV_KEY] = "analytics";

    expect(
      generator()
        .toAddColumnStatement(tagsColumn())
        .query.replace(WHITESPACE_RUN, " "),
    ).toContain("ON CLUSTER 'analytics' ADD COLUMN IF NOT EXISTS tags");
  });

  test("no skip index is built: the add stays metadata-only", () => {
    expect(generator().toAddSkipIndexStatement(tagsColumn())).toBeNull();
  });
});
