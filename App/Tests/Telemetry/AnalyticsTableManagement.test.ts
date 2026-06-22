import { beforeEach, describe, expect, test } from "@jest/globals";

const mockedAnalyticsServices: Array<any> = [];

jest.mock("Common/Server/Services/Index", () => {
  return {
    __esModule: true,
    AnalyticsServices: mockedAnalyticsServices,
  };
});

import AnalyticsTableManagement from "../../FeatureSet/Workers/Utils/AnalyticsDatabase/TableManegement";

type MockAnalyticsService = {
  model: {
    tableName: string;
    storagePolicy?: string;
    ttlExpression: string;
    distributedClusterName?: string;
    getSchemaTableName: () => string;
    isDistributedTableEnabled: () => boolean;
  };
  database: {
    getDatasourceOptions: () => {
      database: string;
    };
  };
  execute: jest.Mock<Promise<void>, [string]>;
  executeQuery: jest.Mock<
    Promise<{ json: () => Promise<{ data?: Array<{ create_table_query?: string }> }> }>,
    [string]
  >;
};

const makeService = (options?: {
  storagePolicy?: string;
  createTableQuery?: string;
}): MockAnalyticsService => {
  return {
    model: {
      tableName: "MetricItemV3",
      ...(options?.storagePolicy
        ? { storagePolicy: options.storagePolicy }
        : {}),
      ttlExpression:
        "time + INTERVAL 7 DAY TO VOLUME 's3_cold', retentionDate DELETE",
      getSchemaTableName: () => {
        return "MetricItemV3";
      },
      isDistributedTableEnabled: () => {
        return false;
      },
    },
    database: {
      getDatasourceOptions: () => {
        return {
          database: "oneuptime",
        };
      },
    },
    execute: jest.fn().mockResolvedValue(undefined),
    executeQuery: jest.fn().mockResolvedValue({
      json: async () => {
        return {
          data: options?.createTableQuery
            ? [{ create_table_query: options.createTableQuery }]
            : [],
        };
      },
    }),
  };
};

describe("AnalyticsTableManagement.reconcileModelOwnedTableSettings", () => {
  beforeEach(() => {
    mockedAnalyticsServices.splice(0, mockedAnalyticsServices.length);
    jest.clearAllMocks();
  });

  test("applies storage policy and TTL when the live table is still delete-only", async () => {
    const service: MockAnalyticsService = makeService({
      storagePolicy: "tiered",
      createTableQuery:
        "CREATE TABLE oneuptime.MetricItemV3 (time DateTime, retentionDate DateTime) ENGINE = MergeTree() ORDER BY time TTL retentionDate DELETE SETTINGS index_granularity = 8192",
    });

    mockedAnalyticsServices.push(service);

    await AnalyticsTableManagement.reconcileModelOwnedTableSettings();

    expect(service.execute).toHaveBeenCalledTimes(2);
    expect(service.execute).toHaveBeenNthCalledWith(
      1,
      "ALTER TABLE MetricItemV3 MODIFY SETTING storage_policy = 'tiered'",
    );
    expect(service.execute).toHaveBeenNthCalledWith(
      2,
      "ALTER TABLE MetricItemV3 MODIFY TTL time + INTERVAL 7 DAY TO VOLUME 's3_cold', retentionDate DELETE",
    );
  });

  test("skips ALTERs when the live table already matches the model", async () => {
    const service: MockAnalyticsService = makeService({
      storagePolicy: "tiered",
      createTableQuery:
        "CREATE TABLE oneuptime.MetricItemV3 (time DateTime, retentionDate DateTime) ENGINE = MergeTree() ORDER BY time TTL time + INTERVAL 7 DAY TO VOLUME 's3_cold', retentionDate DELETE SETTINGS storage_policy = 'tiered', index_granularity = 8192",
    });

    mockedAnalyticsServices.push(service);

    await AnalyticsTableManagement.reconcileModelOwnedTableSettings();

    expect(service.execute).not.toHaveBeenCalled();
  });

  test("ignores models that do not declare a cold-tier storage policy", async () => {
    const service: MockAnalyticsService = makeService({
      createTableQuery:
        "CREATE TABLE oneuptime.MetricItemV3 (time DateTime, retentionDate DateTime) ENGINE = MergeTree() ORDER BY time TTL retentionDate DELETE SETTINGS index_granularity = 8192",
    });

    mockedAnalyticsServices.push(service);

    await AnalyticsTableManagement.reconcileModelOwnedTableSettings();

    expect(service.executeQuery).not.toHaveBeenCalled();
    expect(service.execute).not.toHaveBeenCalled();
  });
});
