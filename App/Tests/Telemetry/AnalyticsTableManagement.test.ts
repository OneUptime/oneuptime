import { beforeEach, describe, expect, jest, test } from "@jest/globals";



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
  execute: ReturnType<typeof jest.fn>;
  executeQuery: ReturnType<typeof jest.fn>;
};

const mockedAnalyticsServices: Array<MockAnalyticsService> = [];

jest.mock("Common/Server/Services/Index", () => {
  return {
    __esModule: true,
    AnalyticsServices: mockedAnalyticsServices,
  };
});

import AnalyticsTableManagement from "../../FeatureSet/Workers/Utils/AnalyticsDatabase/TableManegement";

type ServiceOptions = {
  storagePolicy?: string;
  createTableQueries?: Array<string | undefined>;
  distributedClusterName?: string;
};

const makeService = (options: ServiceOptions = {}): MockAnalyticsService => {
  const createTableQueries: Array<string | undefined> =
    options.createTableQueries || [];
  let queryIndex: number = 0;

  const modelBase: {
    tableName: string;
    ttlExpression: string;
    getSchemaTableName: () => string;
    isDistributedTableEnabled: () => boolean;
  } = {
    tableName: "MetricItemV3",
    ttlExpression:
      "time + INTERVAL 7 DAY TO VOLUME 's3_cold', retentionDate DELETE",
    getSchemaTableName: () => {
      return "MetricItemV3";
    },
    isDistributedTableEnabled: () => {
      return Boolean(options.distributedClusterName);
    },
  };

  const modelWithCluster: MockAnalyticsService["model"] =
    options.distributedClusterName
      ? {
          ...modelBase,
          distributedClusterName: options.distributedClusterName,
        }
      : modelBase;

  const model: MockAnalyticsService["model"] = options.storagePolicy
    ? {
        ...modelWithCluster,
        storagePolicy: options.storagePolicy,
      }
    : modelWithCluster;

  const execute: ReturnType<typeof jest.fn> = jest.fn();
  execute.mockResolvedValue(undefined);

  const executeQuery: ReturnType<typeof jest.fn> = jest.fn();
  executeQuery.mockImplementation(async () => {
    const createTableQuery: string | undefined =
      createTableQueries[Math.min(queryIndex, createTableQueries.length - 1)];
    queryIndex++;

    return {
      json: async () => {
        return {
          data: createTableQuery ? [{ create_table_query: createTableQuery }] : [],
        };
      },
    };
  });

  return {
    model,
    database: {
      getDatasourceOptions: () => {
        return {
          database: "oneuptime",
        };
      },
    },
    execute,
    executeQuery,
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
      createTableQueries: [
        "CREATE TABLE oneuptime.MetricItemV3 (time DateTime, retentionDate DateTime) ENGINE = MergeTree() ORDER BY time TTL retentionDate DELETE SETTINGS index_granularity = 8192",
      ],
    });

    mockedAnalyticsServices.push(service);

    await AnalyticsTableManagement.reconcileModelOwnedTableSettings();

    expect(service.execute).toHaveBeenCalledTimes(2);
    expect(service.executeQuery).toHaveBeenCalledWith(
      "SELECT create_table_query FROM system.tables WHERE database = 'oneuptime' AND name = 'MetricItemV3' AND engine != 'MaterializedView' LIMIT 1",
    );
    expect(service.execute).toHaveBeenNthCalledWith(
      1,
      "ALTER TABLE MetricItemV3 MODIFY SETTING storage_policy = 'tiered'",
    );
    expect(service.execute).toHaveBeenNthCalledWith(
      2,
      "ALTER TABLE MetricItemV3 MODIFY TTL time + INTERVAL 7 DAY TO VOLUME 's3_cold', retentionDate DELETE",
    );
  });

  test("applies only the missing storage policy when TTL already matches", async () => {
    const service: MockAnalyticsService = makeService({
      storagePolicy: "tiered",
      createTableQueries: [
        "CREATE TABLE oneuptime.MetricItemV3 (time DateTime, retentionDate DateTime) ENGINE = MergeTree() ORDER BY time TTL time + INTERVAL 7 DAY TO VOLUME 's3_cold', retentionDate DELETE SETTINGS index_granularity = 8192",
      ],
    });

    mockedAnalyticsServices.push(service);

    await AnalyticsTableManagement.reconcileModelOwnedTableSettings();

    expect(service.execute).toHaveBeenCalledTimes(1);
    expect(service.execute).toHaveBeenCalledWith(
      "ALTER TABLE MetricItemV3 MODIFY SETTING storage_policy = 'tiered'",
    );
  });

  test("applies only the missing TTL when storage policy already matches", async () => {
    const service: MockAnalyticsService = makeService({
      storagePolicy: "tiered",
      createTableQueries: [
        "CREATE TABLE oneuptime.MetricItemV3 (time DateTime, retentionDate DateTime) ENGINE = MergeTree() ORDER BY time TTL retentionDate DELETE SETTINGS storage_policy = 'tiered', index_granularity = 8192",
      ],
    });

    mockedAnalyticsServices.push(service);

    await AnalyticsTableManagement.reconcileModelOwnedTableSettings();

    expect(service.execute).toHaveBeenCalledTimes(1);
    expect(service.execute).toHaveBeenCalledWith(
      "ALTER TABLE MetricItemV3 MODIFY TTL time + INTERVAL 7 DAY TO VOLUME 's3_cold', retentionDate DELETE",
    );
  });

  test("is idempotent after the first successful reconcile", async () => {
    const service: MockAnalyticsService = makeService({
      storagePolicy: "tiered",
      createTableQueries: [
        "CREATE TABLE oneuptime.MetricItemV3 (time DateTime, retentionDate DateTime) ENGINE = MergeTree() ORDER BY time TTL retentionDate DELETE SETTINGS index_granularity = 8192",
        "CREATE TABLE oneuptime.MetricItemV3 (time DateTime, retentionDate DateTime) ENGINE = MergeTree() ORDER BY time TTL time + INTERVAL 7 DAY TO VOLUME 's3_cold', retentionDate DELETE SETTINGS storage_policy = 'tiered', index_granularity = 8192",
      ],
    });

    mockedAnalyticsServices.push(service);

    await AnalyticsTableManagement.reconcileModelOwnedTableSettings();
    expect(service.execute).toHaveBeenCalledTimes(2);

    service.execute.mockClear();

    await AnalyticsTableManagement.reconcileModelOwnedTableSettings();
    expect(service.execute).not.toHaveBeenCalled();
  });

  test("adds ON CLUSTER when reconciling distributed local tables", async () => {
    const service: MockAnalyticsService = makeService({
      storagePolicy: "tiered",
      distributedClusterName: "ou",
      createTableQueries: [
        "CREATE TABLE oneuptime.MetricItemV3 (time DateTime, retentionDate DateTime) ENGINE = MergeTree() ORDER BY time TTL retentionDate DELETE SETTINGS index_granularity = 8192",
      ],
    });

    mockedAnalyticsServices.push(service);

    await AnalyticsTableManagement.reconcileModelOwnedTableSettings();

    expect(service.executeQuery).toHaveBeenCalledWith(
      "SELECT create_table_query FROM system.tables WHERE database = 'oneuptime' AND name = 'MetricItemV3Local' AND engine != 'MaterializedView' LIMIT 1",
    );
    expect(service.execute).toHaveBeenNthCalledWith(
      1,
      "ALTER TABLE MetricItemV3Local ON CLUSTER ou MODIFY SETTING storage_policy = 'tiered'",
    );
    expect(service.execute).toHaveBeenNthCalledWith(
      2,
      "ALTER TABLE MetricItemV3Local ON CLUSTER ou MODIFY TTL time + INTERVAL 7 DAY TO VOLUME 's3_cold', retentionDate DELETE",
    );
  });

  test("skips ALTERs when the live table already matches the model", async () => {
    const service: MockAnalyticsService = makeService({
      storagePolicy: "tiered",
      createTableQueries: [
        "CREATE TABLE oneuptime.MetricItemV3 (time DateTime, retentionDate DateTime) ENGINE = MergeTree() ORDER BY time TTL time + INTERVAL 7 DAY TO VOLUME 's3_cold', retentionDate DELETE SETTINGS storage_policy = 'tiered', index_granularity = 8192",
      ],
    });

    mockedAnalyticsServices.push(service);

    await AnalyticsTableManagement.reconcileModelOwnedTableSettings();

    expect(service.execute).not.toHaveBeenCalled();
  });

  test("skips missing tables until ClickHouse creates them", async () => {
    const service: MockAnalyticsService = makeService({
      storagePolicy: "tiered",
      createTableQueries: [undefined],
    });

    mockedAnalyticsServices.push(service);

    await AnalyticsTableManagement.reconcileModelOwnedTableSettings();

    expect(service.executeQuery).toHaveBeenCalledTimes(1);
    expect(service.execute).not.toHaveBeenCalled();
  });

  test("ignores models that do not declare a cold-tier storage policy", async () => {
    const service: MockAnalyticsService = makeService({
      createTableQueries: [
        "CREATE TABLE oneuptime.MetricItemV3 (time DateTime, retentionDate DateTime) ENGINE = MergeTree() ORDER BY time TTL retentionDate DELETE SETTINGS index_granularity = 8192",
      ],
    });

    mockedAnalyticsServices.push(service);

    await AnalyticsTableManagement.reconcileModelOwnedTableSettings();

    expect(service.executeQuery).not.toHaveBeenCalled();
    expect(service.execute).not.toHaveBeenCalled();
  });
});
