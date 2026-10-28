import DataSecurityDiscovery, {
  postureFromInventory,
} from "../../../../Server/Utils/DataSecurity/DataSecurityDiscovery";
import {
  CloudDataSecurityReadResult,
  CloudDataStoreRead,
} from "../../../../Server/Utils/DataSecurity/Cloud/DataSecurityCloudTypes";
import { DATA_SECURITY_EVALUATE_PROJECT_JOB } from "../../../../Server/Utils/DataSecurity/DataSecurityJobs";
import Queue from "../../../../Server/Infrastructure/Queue";
import CloudAccountService from "../../../../Server/Services/CloudAccountService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import DatabaseServerService from "../../../../Server/Services/DatabaseServerService";
import DataStoreAccessService from "../../../../Server/Services/DataStoreAccessService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import InventoryItemService from "../../../../Server/Services/InventoryItemService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import logger from "../../../../Server/Utils/Logger";
import CloudAccount from "../../../../Models/DatabaseModels/CloudAccount";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import DatabaseServer from "../../../../Models/DatabaseModels/DatabaseServer";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataStoreAccess from "../../../../Models/DatabaseModels/DataStoreAccess";
import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import Includes from "../../../../Types/BaseDatabase/Includes";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { getTableColumns } from "../../../../Types/Database/TableColumn";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import EntityType from "../../../../Types/Telemetry/EntityType";
import {
  DataStoreAccessEntry,
  DataStoreAccessLevel,
  DataStorePrincipalType,
  getDataStoreAccessKey,
} from "../../../../Types/DataSecurity/DataStoreAccess";
import DataStoreEnvironment from "../../../../Types/DataSecurity/DataStoreEnvironment";
import {
  DATA_STORE_KINDS,
  DataStoreFamily,
  DataStoreKind,
  DataStoreKindInfo,
  DataStoreProvider,
} from "../../../../Types/DataSecurity/DataStoreKind";
import {
  cloudDataStoreKey,
  databaseServerDataStoreKey,
  telemetryDataStoreKey,
  tracedDatabaseDataStoreKey,
} from "../../../../Types/DataSecurity/DataStoreKey";
import { DataStorePostureFacts } from "../../../../Types/DataSecurity/DataStorePosture";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Every store a project has, found without anyone adding one
 * (DataSecurityDiscovery): from cloud inventory, the Database product and
 * the service map, from the cloud data-security reads, and from telemetry.
 * Each source builds the same key for the same store, a store found again
 * is brought up to date rather than made twice, and a store whose source
 * is gone is archived. The DataStore and DataStoreAccess tables are
 * in-memory here; every source is a list of rows.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const INVENTORIED_AT: Date = new Date("2026-10-27T09:30:00.000Z");

let storeTable: Array<DataStore>;
let accessTable: Array<DataStoreAccess>;
let resources: Array<CloudResource>;
let accounts: Array<CloudAccount>;
let servers: Array<DatabaseServer>;
let nodes: Array<InventoryItem>;
let clock: Date;
let createSpy: jest.SpyInstance;
let updateSpy: jest.SpyInstance;
let resourcesSpy: jest.SpyInstance;
let nodesSpy: jest.SpyInstance;
let accessCreateSpy: jest.SpyInstance;
let accessUpdateSpy: jest.SpyInstance;
let accessDeleteSpy: jest.SpyInstance;
let queueSpy: jest.SpyInstance;
let errorSpy: jest.SpyInstance;

function sameId(left: ObjectID | undefined | null, right: ObjectID): boolean {
  return Boolean(left) && left!.toString() === right.toString();
}

beforeEach(() => {
  storeTable = [];
  accessTable = [];
  resources = [];
  accounts = [];
  servers = [];
  nodes = [];
  clock = NOW;

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(clock.getTime());
  });

  resourcesSpy = jest
    .spyOn(CloudResourceService, "findBy")
    .mockImplementation((async () => {
      return resources;
    }) as never);
  jest.spyOn(CloudAccountService, "findBy").mockImplementation((async () => {
    return accounts;
  }) as never);
  jest.spyOn(DatabaseServerService, "findBy").mockImplementation((async () => {
    return servers;
  }) as never);
  nodesSpy = jest
    .spyOn(InventoryItemService, "findBy")
    .mockImplementation((async () => {
      return nodes;
    }) as never);

  jest.spyOn(DataStoreService, "findBy").mockImplementation((async () => {
    return storeTable.map((row: DataStore): DataStore => {
      return row;
    });
  }) as never);
  jest.spyOn(DataStoreService, "findOneBy").mockImplementation((async (findBy: {
    query: JSONObject;
  }) => {
    return (
      storeTable.find((row: DataStore) => {
        return row.storeKey === findBy.query["storeKey"];
      }) || null
    );
  }) as never);
  createSpy = jest.spyOn(DataStoreService, "create").mockImplementation((async (
    createBy: CreateBy<DataStore>,
  ): Promise<DataStore> => {
    createBy.data.id = ObjectID.generate();
    storeTable.push(createBy.data);
    return createBy.data;
  }) as never);
  updateSpy = jest
    .spyOn(DataStoreService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
      const row: DataStore | undefined = storeTable.find((store: DataStore) => {
        return sameId(store.id, data.id);
      });

      for (const [column, value] of Object.entries(data.data)) {
        row?.setColumnValue(column, value);
      }
    }) as never);

  jest
    .spyOn(DataStoreAccessService, "findBy")
    .mockImplementation((async (findBy: { query: JSONObject }) => {
      return accessTable.filter((entry: DataStoreAccess) => {
        return sameId(
          entry.dataStoreId,
          findBy.query["dataStoreId"] as ObjectID,
        );
      });
    }) as never);
  accessCreateSpy = jest
    .spyOn(DataStoreAccessService, "create")
    .mockImplementation((async (
      createBy: CreateBy<DataStoreAccess>,
    ): Promise<DataStoreAccess> => {
      createBy.data.id = ObjectID.generate();
      accessTable.push(createBy.data);
      return createBy.data;
    }) as never);
  accessUpdateSpy = jest
    .spyOn(DataStoreAccessService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
      const row: DataStoreAccess | undefined = accessTable.find(
        (entry: DataStoreAccess) => {
          return sameId(entry.id, data.id);
        },
      );

      for (const [column, value] of Object.entries(data.data)) {
        row?.setColumnValue(column, value);
      }
    }) as never);
  accessDeleteSpy = jest
    .spyOn(DataStoreAccessService, "deleteOneById")
    .mockImplementation((async (data: { id: ObjectID }) => {
      accessTable = accessTable.filter((entry: DataStoreAccess) => {
        return !sameId(entry.id, data.id);
      });
    }) as never);

  queueSpy = jest.spyOn(Queue, "addJob").mockResolvedValue(undefined as never);
  errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function resourceOf(data: {
  name?: string | undefined;
  type: string;
  provider?: CloudProvider | undefined;
  providerResourceId?: string | undefined;
  resourceIdentifier?: string | undefined;
  accountId?: string | undefined;
  region?: string | undefined;
  tags?: Record<string, string> | undefined;
  properties?: JSONObject | undefined;
  inventoriedAt?: Date | undefined;
  connectionId?: ObjectID | undefined;
}): CloudResource {
  const resource: CloudResource = new CloudResource(ObjectID.generate());

  if (data.name !== undefined) {
    resource.name = data.name;
  }

  resource.cloudResourceType = data.type;
  resource.cloudProvider = data.provider || CloudProvider.AWS;

  if (data.providerResourceId !== undefined) {
    resource.providerResourceId = data.providerResourceId;
  }

  if (data.resourceIdentifier !== undefined) {
    resource.resourceIdentifier = data.resourceIdentifier;
  }

  resource.cloudAccountId = data.accountId || "123456789012";
  resource.cloudRegion = data.region || "us-east-1";

  if (data.tags) {
    resource.cloudTags = data.tags;
  }

  if (data.properties) {
    resource.cloudProperties = data.properties;
  }

  if (data.inventoriedAt) {
    resource.inventoriedAt = data.inventoriedAt;
  }

  if (data.connectionId) {
    resource.cloudConnectionId = data.connectionId;
  }

  return resource;
}

function bucket(name: string, tags?: Record<string, string>): CloudResource {
  return resourceOf({
    name,
    type: "AWS::S3::Bucket",
    providerResourceId: `arn:aws:s3:::${name}`,
    tags,
  });
}

function serverOf(data: {
  name?: string | undefined;
  dbSystem: string;
  serverAddress?: string | undefined;
}): DatabaseServer {
  const server: DatabaseServer = new DatabaseServer(ObjectID.generate());

  if (data.name !== undefined) {
    server.name = data.name;
  }

  server.dbSystem = data.dbSystem;

  if (data.serverAddress !== undefined) {
    server.serverAddress = data.serverAddress;
  }

  return server;
}

function nodeOf(attributes: JSONObject): InventoryItem {
  const node: InventoryItem = new InventoryItem();
  node.identifyingAttributes = attributes;
  return node;
}

function storeNamed(name: string): DataStore {
  const found: DataStore | undefined = storeTable.find((store: DataStore) => {
    return store.name === name;
  });

  if (!found) {
    throw new Error(`No store named ${name}.`);
  }

  return found;
}

function existingStore(data: {
  storeKey: string;
  name: string;
  discoveredFrom?: string | undefined;
  isArchived?: boolean | undefined;
  posture?: DataStorePostureFacts | undefined;
  environment?: DataStoreEnvironment | undefined;
}): DataStore {
  const store: DataStore = new DataStore(ObjectID.generate());
  store.projectId = PROJECT_ID;
  store.storeKey = data.storeKey;
  store.name = data.name;

  if (data.discoveredFrom !== undefined) {
    store.discoveredFrom = data.discoveredFrom;
  }

  store.isArchived = Boolean(data.isArchived);

  if (data.posture) {
    store.posture = data.posture;
  }

  if (data.environment) {
    store.environment = data.environment;
  }

  storeTable.push(store);
  return store;
}

function updatesOf(store: DataStore): Array<JSONObject> {
  return updateSpy.mock.calls
    .map((call: Array<unknown>): { id: ObjectID; data: JSONObject } => {
      return call[0] as { id: ObjectID; data: JSONObject };
    })
    .filter((write: { id: ObjectID }) => {
      return sameId(store.id, write.id);
    })
    .map((write: { data: JSONObject }): JSONObject => {
      return write.data;
    });
}

function discover(): Promise<number> {
  return DataSecurityDiscovery.discoverProject(PROJECT_ID);
}

const DATA_STORE_COLUMNS: Set<string> = new Set(
  Object.keys(getTableColumns(new DataStore())),
);

describe("postureFromInventory", () => {
  test("an RDS instance's encryption, exposure, deletion protection and backups, as inventory keeps them", () => {
    expect(
      postureFromInventory(
        DataStoreKind.AwsRdsInstance,
        {
          StorageEncrypted: true,
          PubliclyAccessible: "false",
          DeletionProtection: "true",
          BackupRetentionPeriod: 7,
        },
        INVENTORIED_AT,
      ),
    ).toEqual({
      readAt: INVENTORIED_AT.toISOString(),
      encryptedAtRest: true,
      publicNetworkAccess: false,
      deletionProtection: true,
      backupRetentionDays: 7,
      backupsEnabled: true,
    });
  });

  test("an Aurora cluster with no backup retention has its backups off; a value it cannot read is null", () => {
    expect(
      postureFromInventory(
        DataStoreKind.AwsRdsCluster,
        {
          StorageEncrypted: "yes",
          PubliclyAccessible: false,
          BackupRetentionPeriod: "0",
        },
        INVENTORIED_AT,
      ),
    ).toEqual({
      readAt: INVENTORIED_AT.toISOString(),
      encryptedAtRest: null,
      publicNetworkAccess: false,
      deletionProtection: undefined,
      backupRetentionDays: 0,
      backupsEnabled: false,
    });
  });

  test("a retention that is not a number says nothing about backups", () => {
    const posture: DataStorePostureFacts | null = postureFromInventory(
      DataStoreKind.AwsRdsInstance,
      { BackupRetentionPeriod: "seven" },
      INVENTORIED_AT,
    );

    expect(posture?.backupRetentionDays).toBeNull();
    expect(posture?.backupsEnabled).toBeNull();
  });

  test("a DynamoDB table is always encrypted, with its recovery and deletion protection read", () => {
    expect(
      postureFromInventory(
        DataStoreKind.AwsDynamoDbTable,
        {
          "PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled":
            "false",
          DeletionProtectionEnabled: true,
        },
        INVENTORIED_AT,
      ),
    ).toEqual({
      readAt: INVENTORIED_AT.toISOString(),
      encryptedAtRest: true,
      pointInTimeRecovery: false,
      deletionProtection: true,
    });
  });

  test("other kinds, and inventory without properties or a time, say nothing", () => {
    expect(
      postureFromInventory(
        DataStoreKind.AwsS3Bucket,
        { Encrypted: true },
        INVENTORIED_AT,
      ),
    ).toBeNull();
    expect(
      postureFromInventory(
        DataStoreKind.AwsRdsInstance,
        undefined,
        INVENTORIED_AT,
      ),
    ).toBeNull();
    expect(
      postureFromInventory(
        DataStoreKind.AwsRdsInstance,
        { StorageEncrypted: true },
        undefined,
      ),
    ).toBeNull();
  });
});

describe("discoverProject: cloud inventory", () => {
  test("asks inventory for every cloud type that holds data, and nothing archived", async () => {
    await discover();

    const findBy: { query: JSONObject; props: JSONObject } = resourcesSpy.mock
      .calls[0]![0] as { query: JSONObject; props: JSONObject };
    const types: Array<string> = DATA_STORE_KINDS.map(
      (info: DataStoreKindInfo) => {
        return info.cloudResourceType;
      },
    ).filter((type: string | undefined): type is string => {
      return Boolean(type);
    });

    expect(findBy.query["projectId"]).toEqual(PROJECT_ID);
    expect(findBy.query["isArchived"]).toBe(false);
    expect((findBy.query["cloudResourceType"] as Includes).values).toEqual(
      types,
    );
    expect(types).toEqual(
      expect.arrayContaining([
        "AWS::S3::Bucket",
        "AWS::RDS::DBInstance",
        "Microsoft.Storage/storageAccounts",
        "gcs_bucket",
        "bigquery_dataset",
      ]),
    );
    expect(findBy.props).toEqual({ isRoot: true });
  });

  test("a bucket in inventory becomes a store: its key, kind, provider, family and where it lives", async () => {
    const account: CloudAccount = new CloudAccount(ObjectID.generate());
    account.provider = CloudProvider.AWS;
    account.accountId = "123456789012";
    accounts = [account];
    resources = [
      resourceOf({
        name: "customer-exports",
        type: "AWS::S3::Bucket",
        providerResourceId: "arn:aws:s3:::customer-exports",
        accountId: "123456789012",
        region: "eu-west-1",
        tags: { team: "growth" },
        connectionId: CONNECTION_ID,
      }),
    ];

    const created: number = await discover();

    expect(created).toBe(1);
    expect(createSpy).toHaveBeenCalledTimes(1);

    const store: DataStore = storeNamed("customer-exports");

    expect(store.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(store.storeKey).toBe(
      "cloud:aws:AWS S3 Bucket:arn:aws:s3:::customer-exports",
    );
    expect(store.storeKey).toBe(
      cloudDataStoreKey({
        provider: "aws",
        kind: DataStoreKind.AwsS3Bucket,
        providerResourceId: "arn:aws:s3:::customer-exports",
      }),
    );
    expect(store.kind).toBe(DataStoreKind.AwsS3Bucket);
    expect(store.provider).toBe(DataStoreProvider.Aws);
    expect(store.family).toBe(DataStoreFamily.ObjectStorage);
    expect(store.discoveredFrom).toBe("Cloud inventory");
    expect(store.cloudResourceId?.toString()).toBe(
      resources[0]!.id!.toString(),
    );
    expect(store.providerResourceId).toBe("arn:aws:s3:::customer-exports");
    expect(store.cloudAccountNumber).toBe("123456789012");
    expect(store.cloudAccountId?.toString()).toBe(account.id!.toString());
    expect(store.cloudConnectionId?.toString()).toBe(CONNECTION_ID.toString());
    expect(store.region).toBe("eu-west-1");
    expect(store.cloudTags).toEqual({ team: "growth" });
    expect(store.environment).toBe(DataStoreEnvironment.Unknown);
    expect(store.posture).toBeUndefined();
    expect(store.firstSeenAt).toEqual(NOW);
    expect(store.lastSeenAt).toEqual(NOW);
    expect(store.nextContentScanAt).toEqual(NOW);
    expect((createSpy.mock.calls[0]![0] as CreateBy<DataStore>).props).toEqual({
      isRoot: true,
    });
  });

  test("an RDS instance arrives with the posture inventory already knows", async () => {
    resources = [
      resourceOf({
        name: "orders-db",
        type: "AWS::RDS::DBInstance",
        providerResourceId: "arn:aws:rds:us-east-1:123456789012:db:orders-db",
        properties: { StorageEncrypted: false, PubliclyAccessible: true },
        inventoriedAt: INVENTORIED_AT,
      }),
      resourceOf({
        name: "billing-db",
        type: "AWS::RDS::DBInstance",
        providerResourceId: "arn:aws:rds:us-east-1:123456789012:db:billing-db",
        properties: { StorageEncrypted: true },
      }),
    ];

    await discover();

    expect(storeNamed("orders-db").posture).toMatchObject({
      readAt: INVENTORIED_AT.toISOString(),
      encryptedAtRest: false,
      publicNetworkAccess: true,
    });
    expect(storeNamed("orders-db").family).toBe(DataStoreFamily.Database);
    // Inventoried at an unknown time: as of this sweep.
    expect(storeNamed("billing-db").posture?.readAt).toBe(NOW.toISOString());
  });

  test("the environment is read from the tags first, then from the name", async () => {
    resources = [
      bucket("orders-staging"),
      bucket("payments-archive", { Environment: "production" }),
      bucket("orders-dev-copy", { env: "prod" }),
      bucket("shared-assets"),
    ];

    await discover();

    expect(storeNamed("orders-staging").environment).toBe(
      DataStoreEnvironment.Staging,
    );
    expect(storeNamed("payments-archive").environment).toBe(
      DataStoreEnvironment.Production,
    );
    expect(storeNamed("orders-dev-copy").environment).toBe(
      DataStoreEnvironment.Production,
    );
    expect(storeNamed("shared-assets").environment).toBe(
      DataStoreEnvironment.Unknown,
    );
  });

  test("an Azure resource id is keyed without case; a nameless resource is named by its id", async () => {
    resources = [
      resourceOf({
        type: "Microsoft.Storage/storageAccounts",
        provider: CloudProvider.Azure,
        providerResourceId:
          "/subscriptions/SUB-1/resourceGroups/Data/providers/Microsoft.Storage/storageAccounts/CustomerFiles",
      }),
    ];

    await discover();

    const store: DataStore = storeTable[0]!;

    expect(store.storeKey).toBe(
      "cloud:azure:Azure Storage Account:/subscriptions/sub-1/resourcegroups/data/providers/microsoft.storage/storageaccounts/customerfiles",
    );
    expect(store.name).toBe(
      "/subscriptions/SUB-1/resourceGroups/Data/providers/Microsoft.Storage/storageAccounts/CustomerFiles",
    );
    expect(store.provider).toBe(DataStoreProvider.Azure);
  });

  test("a resource with no provider id falls back to its identifier; one with neither, no provider or an unknown type is skipped", async () => {
    const noProvider: CloudResource = bucket("no-provider");
    delete noProvider.cloudProvider;

    resources = [
      resourceOf({
        name: "by-identifier",
        type: "AWS::S3::Bucket",
        resourceIdentifier: "by-identifier",
      }),
      resourceOf({ name: "no-id-at-all", type: "AWS::S3::Bucket" }),
      noProvider,
      resourceOf({
        name: "a-queue",
        type: "AWS::SQS::Queue",
        providerResourceId: "arn:aws:sqs:us-east-1:123456789012:a-queue",
      }),
    ];

    const created: number = await discover();

    expect(created).toBe(1);
    expect(
      storeTable.map((store: DataStore) => {
        return store.name;
      }),
    ).toEqual(["by-identifier"]);
    expect(storeTable[0]!.providerResourceId).toBe("by-identifier");
  });

  test("long cloud values are cut to their columns", async () => {
    resources = [
      resourceOf({
        name: "n".repeat(600),
        type: "AWS::S3::Bucket",
        providerResourceId: `arn:aws:s3:::${"p".repeat(600)}`,
        accountId: "a".repeat(150),
        region: "r".repeat(150),
      }),
    ];

    await discover();

    const store: DataStore = storeTable[0]!;

    expect(store.name).toHaveLength(500);
    expect(store.providerResourceId).toHaveLength(500);
    expect(store.cloudAccountNumber).toHaveLength(100);
    expect(store.region).toHaveLength(100);
    expect(store.storeKey!.length).toBeLessThanOrEqual(500);
  });
});

describe("discoverProject: the Database product", () => {
  test("every monitored database server becomes a store, keyed by its row", async () => {
    servers = [
      serverOf({
        name: "billing-prod",
        dbSystem: "PostgreSQL",
        serverAddress: "10.0.0.5",
      }),
      serverOf({ dbSystem: "mariadb", serverAddress: "mysql.internal" }),
      serverOf({ dbSystem: "redis" }),
      serverOf({ name: "old-cluster", dbSystem: "cassandra" }),
    ];

    const created: number = await discover();

    expect(created).toBe(3);

    const billing: DataStore = storeNamed("billing-prod");

    expect(billing.storeKey).toBe(
      databaseServerDataStoreKey(servers[0]!.id!.toString()),
    );
    expect(billing.storeKey).toBe(`database:${servers[0]!.id!.toString()}`);
    expect(billing.kind).toBe(DataStoreKind.PostgreSql);
    expect(billing.provider).toBe(DataStoreProvider.SelfManaged);
    expect(billing.family).toBe(DataStoreFamily.Database);
    expect(billing.discoveredFrom).toBe("Database product");
    expect(billing.databaseServerId?.toString()).toBe(
      servers[0]!.id!.toString(),
    );
    expect(billing.environment).toBe(DataStoreEnvironment.Production);
    expect(storeNamed("mysql.internal").kind).toBe(DataStoreKind.MySql);
    expect(storeNamed(DataStoreKind.Redis).kind).toBe(DataStoreKind.Redis);
  });
});

describe("discoverProject: the service map", () => {
  test("a database services talk to that no source lists becomes a store of its own", async () => {
    nodes = [
      nodeOf({
        "db.system.name": "postgresql",
        "server.address": "db.internal",
        "db.namespace": "orders",
      }),
    ];

    const created: number = await discover();

    expect(created).toBe(1);

    const store: DataStore = storeNamed("orders on db.internal");

    expect(store.storeKey).toBe(
      tracedDatabaseDataStoreKey({
        system: "postgresql",
        address: "db.internal",
        namespace: "orders",
      }),
    );
    expect(store.storeKey).toBe("traced:postgresql:db.internal:orders");
    expect(store.kind).toBe(DataStoreKind.PostgreSql);
    expect(store.discoveredFrom).toBe("Service map");
    expect((nodesSpy.mock.calls[0]![0] as { query: JSONObject }).query).toEqual(
      {
        projectId: PROJECT_ID,
        entityType: EntityType.Database,
        isArchived: false,
      },
    );
  });

  test("a database without a name is named by its address; an engine nobody knows, or no address, is skipped", async () => {
    nodes = [
      nodeOf({ "db.system.name": "redis", "server.address": "cache.internal" }),
      nodeOf({
        "db.system.name": "couchbase",
        "server.address": "cb.internal",
      }),
      nodeOf({ "db.system.name": "mysql" }),
    ];

    await discover();

    expect(
      storeTable.map((store: DataStore) => {
        return store.name;
      }),
    ).toEqual(["cache.internal"]);
    expect(storeTable[0]!.storeKey).toBe("traced:redis:cache.internal:");
  });

  test("a database the map names twice is one store", async () => {
    nodes = [
      nodeOf({
        "db.system.name": "postgresql",
        "server.address": "DB.internal",
      }),
      nodeOf({
        "db.system.name": "PostgreSQL",
        "server.address": "db.internal",
      }),
    ];

    const created: number = await discover();

    expect(created).toBe(1);
    expect(storeTable).toHaveLength(1);
  });

  test("an address another source already names is that source's store", async () => {
    const server: DatabaseServer = serverOf({
      name: "PG.acme.internal",
      dbSystem: "postgresql",
    });
    const monitored: DataStore = existingStore({
      storeKey: databaseServerDataStoreKey(server.id!.toString()),
      name: "PG.acme.internal",
      discoveredFrom: "Database product",
    });
    servers = [server];
    nodes = [
      nodeOf({
        "db.system.name": "postgresql",
        "server.address": "pg.acme.internal",
        "db.namespace": "orders",
      }),
    ];

    const created: number = await discover();

    expect(created).toBe(0);
    expect(createSpy).not.toHaveBeenCalled();
    expect(storeTable).toEqual([monitored]);
    expect(monitored.isArchived).toBe(false);
  });

  test("a database the service map keeps seeing stays a store, sweep after sweep", async () => {
    nodes = [
      nodeOf({
        "db.system.name": "mongodb",
        "server.address": "mongo.internal",
      }),
      nodeOf({
        "db.system.name": "postgresql",
        "server.address": "db.internal",
        "db.namespace": "orders",
      }),
    ];

    expect(await discover()).toBe(2);

    clock = new Date(NOW.getTime() + 15 * 60 * 1000);

    expect(await discover()).toBe(0);
    clock = new Date(NOW.getTime() + 30 * 60 * 1000);
    expect(await discover()).toBe(0);

    expect(storeTable).toHaveLength(2);

    for (const store of storeTable) {
      expect({ name: store.name, isArchived: store.isArchived }).toEqual({
        name: store.name,
        isArchived: undefined,
      });
      expect(store.lastSeenAt).toEqual(clock);
    }
  });
});

describe("discoverProject: stores found before", () => {
  test("a store found again is brought up to date, not made again, and nothing is queued", async () => {
    const store: DataStore = existingStore({
      storeKey: "cloud:aws:AWS S3 Bucket:arn:aws:s3:::customer-exports",
      name: "customer-exports",
      discoveredFrom: "Cloud inventory",
    });
    resources = [bucket("customer-exports", { team: "growth" })];

    const created: number = await discover();

    expect(created).toBe(0);
    expect(createSpy).not.toHaveBeenCalled();
    expect(updatesOf(store)).toHaveLength(1);
    expect(updatesOf(store)[0]).toMatchObject({
      name: "customer-exports",
      providerResourceId: "arn:aws:s3:::customer-exports",
      cloudTags: { team: "growth" },
      lastSeenAt: NOW,
    });
    expect(updatesOf(store)[0]).not.toHaveProperty("isArchived");
    expect(queueSpy).not.toHaveBeenCalled();
  });

  test("a new store queues the project's evaluation", async () => {
    resources = [bucket("customer-exports")];

    await discover();

    expect(queueSpy).toHaveBeenCalledTimes(1);
    expect(queueSpy.mock.calls[0]![2]).toBe(DATA_SECURITY_EVALUATE_PROJECT_JOB);
    expect(queueSpy.mock.calls[0]![3]).toEqual({
      projectId: PROJECT_ID.toString(),
    });
  });

  test("inventory's posture never overwrites one a data-security read wrote, and fills one nobody has", async () => {
    const read: DataStore = existingStore({
      storeKey: cloudDataStoreKey({
        provider: "aws",
        kind: DataStoreKind.AwsRdsInstance,
        providerResourceId: "arn:aws:rds:us-east-1:123456789012:db:orders-db",
      }),
      name: "orders-db",
      discoveredFrom: "Cloud read",
      posture: { readAt: "2026-10-26T00:00:00.000Z", encryptedAtRest: true },
    });
    const unread: DataStore = existingStore({
      storeKey: cloudDataStoreKey({
        provider: "aws",
        kind: DataStoreKind.AwsRdsInstance,
        providerResourceId: "arn:aws:rds:us-east-1:123456789012:db:billing-db",
      }),
      name: "billing-db",
      discoveredFrom: "Cloud inventory",
    });
    resources = [
      resourceOf({
        name: "orders-db",
        type: "AWS::RDS::DBInstance",
        providerResourceId: "arn:aws:rds:us-east-1:123456789012:db:orders-db",
        properties: { StorageEncrypted: false },
        inventoriedAt: INVENTORIED_AT,
      }),
      resourceOf({
        name: "billing-db",
        type: "AWS::RDS::DBInstance",
        providerResourceId: "arn:aws:rds:us-east-1:123456789012:db:billing-db",
        properties: { StorageEncrypted: false },
        inventoriedAt: INVENTORIED_AT,
      }),
    ];

    await discover();

    expect(updatesOf(read)[0]).not.toHaveProperty("posture");
    expect(read.posture).toEqual({
      readAt: "2026-10-26T00:00:00.000Z",
      encryptedAtRest: true,
    });
    expect(updatesOf(unread)[0]!["posture"]).toMatchObject({
      encryptedAtRest: false,
    });
    expect(updatesOf(unread)[0]).not.toHaveProperty("postureIsFull");
  });

  test("an archived store found again comes back", async () => {
    const store: DataStore = existingStore({
      storeKey: "cloud:aws:AWS S3 Bucket:arn:aws:s3:::customer-exports",
      name: "customer-exports",
      discoveredFrom: "Cloud inventory",
      isArchived: true,
    });
    resources = [bucket("customer-exports")];

    await discover();

    expect(updatesOf(store)[0]!["isArchived"]).toBe(false);
    expect(store.isArchived).toBe(false);
  });

  test("an environment a person set is never overwritten; one nobody knows is filled in", async () => {
    const chosen: DataStore = existingStore({
      storeKey: "cloud:aws:AWS S3 Bucket:arn:aws:s3:::shared-assets",
      name: "shared-assets",
      discoveredFrom: "Cloud inventory",
      environment: DataStoreEnvironment.Production,
    });
    const unknown: DataStore = existingStore({
      storeKey: "cloud:aws:AWS S3 Bucket:arn:aws:s3:::legacy-exports",
      name: "legacy-exports",
      discoveredFrom: "Cloud inventory",
      environment: DataStoreEnvironment.Unknown,
    });
    resources = [
      bucket("shared-assets", { env: "dev" }),
      bucket("legacy-exports", { stage: "staging" }),
    ];

    await discover();

    expect(chosen.environment).toBe(DataStoreEnvironment.Production);
    expect(updatesOf(chosen)[0]).not.toHaveProperty("environment");
    expect(unknown.environment).toBe(DataStoreEnvironment.Staging);
  });

  test("stores whose sweep source is gone are archived, never deleted; stores from elsewhere stay", async () => {
    const goneBucket: DataStore = existingStore({
      storeKey: "cloud:aws:AWS S3 Bucket:arn:aws:s3:::deleted-bucket",
      name: "deleted-bucket",
      discoveredFrom: "Cloud inventory",
    });
    const goneServer: DataStore = existingStore({
      storeKey: "database:removed-server",
      name: "removed-server",
      discoveredFrom: "Database product",
    });
    const goneTraced: DataStore = existingStore({
      storeKey: "traced:mysql:old.internal:",
      name: "old.internal",
      discoveredFrom: "Service map",
    });
    const alreadyArchived: DataStore = existingStore({
      storeKey: "cloud:aws:AWS S3 Bucket:arn:aws:s3:::long-gone",
      name: "long-gone",
      discoveredFrom: "Cloud inventory",
      isArchived: true,
    });
    const cloudRead: DataStore = existingStore({
      storeKey: "cloud:aws:AWS S3 Bucket:arn:aws:s3:::read-only-bucket",
      name: "read-only-bucket",
      discoveredFrom: "Cloud read",
    });
    const telemetry: DataStore = existingStore({
      storeKey: "telemetry:service-1:Logs",
      name: "checkout · Logs",
      discoveredFrom: "Telemetry",
    });
    const added: DataStore = existingStore({
      storeKey: "manual:warehouse",
      name: "warehouse",
    });

    await discover();

    for (const store of [goneBucket, goneServer, goneTraced]) {
      expect(updatesOf(store)).toEqual([{ isArchived: true }]);
      expect(store.isArchived).toBe(true);
    }

    for (const store of [alreadyArchived, cloudRead, telemetry, added]) {
      expect(updatesOf(store)).toEqual([]);
    }

    expect(storeTable).toHaveLength(7);
  });

  test("a store that cannot be recorded is logged, and the others are recorded", async () => {
    resources = [bucket("first-bucket"), bucket("second-bucket")];
    createSpy.mockImplementation((async (
      createBy: CreateBy<DataStore>,
    ): Promise<DataStore> => {
      if (createBy.data.name === "first-bucket") {
        throw new Error("duplicate key value violates unique constraint");
      }

      createBy.data.id = ObjectID.generate();
      storeTable.push(createBy.data);
      return createBy.data;
    }) as never);

    const created: number = await discover();

    expect(created).toBe(1);
    expect(
      storeTable.map((store: DataStore) => {
        return store.name;
      }),
    ).toEqual(["second-bucket"]);
    expect(errorSpy).toHaveBeenCalledWith(
      "DataSecurity: could not record store cloud:aws:AWS S3 Bucket:arn:aws:s3:::first-bucket:",
    );
  });

  test("every column a sweep writes is a column of DataStore", async () => {
    existingStore({
      storeKey: "cloud:aws:AWS S3 Bucket:arn:aws:s3:::customer-exports",
      name: "customer-exports",
      discoveredFrom: "Cloud inventory",
      isArchived: true,
    });
    existingStore({
      storeKey: databaseServerDataStoreKey("gone"),
      name: "gone",
      discoveredFrom: "Database product",
    });
    resources = [
      bucket("customer-exports"),
      resourceOf({
        name: "orders-db",
        type: "AWS::RDS::DBInstance",
        providerResourceId: "arn:aws:rds:us-east-1:123456789012:db:orders-db",
        properties: { StorageEncrypted: true },
        inventoriedAt: INVENTORIED_AT,
        connectionId: CONNECTION_ID,
      }),
    ];

    await discover();

    expect(updateSpy).toHaveBeenCalled();

    for (const call of updateSpy.mock.calls) {
      for (const column of Object.keys(
        (call[0] as { data: JSONObject }).data,
      )) {
        expect({ column, isAColumn: DATA_STORE_COLUMNS.has(column) }).toEqual({
          column,
          isAColumn: true,
        });
      }
    }
  });
});

describe("recordCloudReads", () => {
  function accessEntry(
    overrides: Partial<DataStoreAccessEntry> = {},
  ): DataStoreAccessEntry {
    return {
      principal: "arn:aws:iam::123456789012:role/analytics",
      principalName: "analytics",
      principalType: DataStorePrincipalType.Role,
      accessLevel: DataStoreAccessLevel.Read,
      grantedVia: "Bucket policy",
      isExternal: false,
      isPublic: false,
      ...overrides,
    };
  }

  function readOf(
    name: string,
    overrides: Partial<CloudDataStoreRead> = {},
  ): CloudDataStoreRead {
    return {
      identity: {
        kind: DataStoreKind.AwsS3Bucket,
        name,
        providerResourceId: `arn:aws:s3:::${name}`,
        accountNumber: "123456789012",
        region: "us-east-1",
      },
      posture: {
        readAt: "2026-10-27T11:59:00.000Z",
        publicRead: false,
        encryptedAtRest: true,
      },
      access: [],
      ...overrides,
    };
  }

  function recordReads(stores: Array<CloudDataStoreRead>): Promise<number> {
    const result: CloudDataSecurityReadResult = {
      stores,
      warnings: [],
      complete: true,
    };

    return DataSecurityDiscovery.recordCloudReads({
      projectId: PROJECT_ID,
      cloudConnectionId: CONNECTION_ID,
      provider: DataStoreProvider.Aws,
      result,
    });
  }

  test("a store inventory never listed is made from the read, with all it says", async () => {
    const account: CloudAccount = new CloudAccount(ObjectID.generate());
    account.provider = CloudProvider.AWS;
    account.accountId = "123456789012";
    accounts = [account];
    const lastActivityAt: Date = new Date("2026-10-20T08:00:00.000Z");

    const recorded: number = await recordReads([
      readOf("payments-prod-exports", {
        tags: { owner: "payments" },
        sizeInBytes: 1048576,
        objectCount: 42,
        lastActivityAt,
      }),
    ]);

    expect(recorded).toBe(1);

    const store: DataStore = storeNamed("payments-prod-exports");

    expect(store.storeKey).toBe(
      "cloud:aws:AWS S3 Bucket:arn:aws:s3:::payments-prod-exports",
    );
    expect(store.discoveredFrom).toBe("Cloud read");
    expect(store.provider).toBe(DataStoreProvider.Aws);
    expect(store.providerResourceId).toBe("arn:aws:s3:::payments-prod-exports");
    expect(store.cloudAccountNumber).toBe("123456789012");
    expect(store.cloudAccountId?.toString()).toBe(account.id!.toString());
    expect(store.cloudConnectionId?.toString()).toBe(CONNECTION_ID.toString());
    expect(store.region).toBe("us-east-1");
    expect(store.cloudTags).toEqual({ owner: "payments" });
    expect(store.posture).toEqual({
      readAt: "2026-10-27T11:59:00.000Z",
      publicRead: false,
      encryptedAtRest: true,
    });
    expect(store.configurationReadAt).toEqual(NOW);
    expect(store.environment).toBe(DataStoreEnvironment.Production);
    expect(store.sizeInBytes).toBe(1048576);
    expect(store.objectCount).toBe(42);
    expect(store.lastActivityAt).toEqual(lastActivityAt);
    expect(queueSpy).toHaveBeenCalledTimes(1);
  });

  test("a read posture without a time is dated now, and replaces what inventory knew", async () => {
    const store: DataStore = existingStore({
      storeKey: "cloud:aws:AWS S3 Bucket:arn:aws:s3:::customer-exports",
      name: "customer-exports",
      discoveredFrom: "Cloud inventory",
      posture: { readAt: "2026-10-01T00:00:00.000Z", publicRead: true },
    });

    await recordReads([
      readOf("customer-exports", { posture: { publicRead: false } }),
    ]);

    expect(updatesOf(store)[0]!["posture"]).toEqual({
      publicRead: false,
      readAt: NOW.toISOString(),
    });
    expect(updatesOf(store)[0]).not.toHaveProperty("postureIsFull");
    expect(store.posture).toEqual({
      publicRead: false,
      readAt: NOW.toISOString(),
    });
    expect(store.discoveredFrom).toBe("Cloud inventory");
  });

  test("who can reach the store is written one entry per principal, level and grant", async () => {
    const grant: DataStoreAccessEntry = accessEntry({
      lastUsedAt: new Date("2026-10-25T10:00:00.000Z"),
    });
    const anyone: DataStoreAccessEntry = accessEntry({
      principal: "*",
      principalName: undefined,
      principalType: DataStorePrincipalType.Public,
      grantedVia: "ACL: AllUsers",
      isPublic: true,
    });

    await recordReads([
      readOf("customer-exports", { access: [grant, anyone] }),
    ]);

    const store: DataStore = storeNamed("customer-exports");

    expect(accessTable).toHaveLength(2);

    const row: DataStoreAccess = accessTable.find((entry: DataStoreAccess) => {
      return entry.accessKey === getDataStoreAccessKey(grant);
    })!;

    expect(row.accessKey).toBe(
      "arn:aws:iam::123456789012:role/analytics|Read|Bucket policy",
    );
    expect(row.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(row.dataStoreId?.toString()).toBe(store.id!.toString());
    expect(row.principal).toBe("arn:aws:iam::123456789012:role/analytics");
    expect(row.principalName).toBe("analytics");
    expect(row.principalType).toBe(DataStorePrincipalType.Role);
    expect(row.accessLevel).toBe(DataStoreAccessLevel.Read);
    expect(row.grantedVia).toBe("Bucket policy");
    expect(row.isExternal).toBe(false);
    expect(row.isPublic).toBe(false);
    expect(row.lastUsedAt).toEqual(new Date("2026-10-25T10:00:00.000Z"));
    expect(row.firstSeenAt).toEqual(NOW);
    expect(row.lastSeenAt).toEqual(NOW);

    const publicRow: DataStoreAccess = accessTable.find(
      (entry: DataStoreAccess) => {
        return entry.isPublic === true;
      },
    )!;

    expect(publicRow.principalName).toBeUndefined();
    expect(publicRow.lastUsedAt).toBeUndefined();
  });

  test("a grant seen again is updated; one the cloud no longer reports goes, unless traffic showed it", async () => {
    await recordReads([
      readOf("customer-exports", {
        access: [
          accessEntry(),
          accessEntry({ principal: "arn:aws:iam::123456789012:role/old-etl" }),
        ],
      }),
    ]);

    const store: DataStore = storeNamed("customer-exports");
    const traced: DataStoreAccess = new DataStoreAccess(ObjectID.generate());
    traced.dataStoreId = store.id!;
    traced.accessKey = "service:checkout|Read|Seen in traces";
    traced.isSeenInTraces = true;
    accessTable.push(traced);

    const keptId: string = accessTable
      .find((entry: DataStoreAccess) => {
        return entry.accessKey === getDataStoreAccessKey(accessEntry());
      })!
      .id!.toString();

    clock = new Date(NOW.getTime() + 60 * 60 * 1000);
    accessCreateSpy.mockClear();

    await recordReads([
      readOf("customer-exports", {
        access: [accessEntry({ accessLevel: DataStoreAccessLevel.Read })],
      }),
    ]);

    expect(accessCreateSpy).not.toHaveBeenCalled();
    expect(accessUpdateSpy).toHaveBeenCalledTimes(1);
    expect(
      (accessUpdateSpy.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(keptId);
    expect(accessDeleteSpy).toHaveBeenCalledTimes(1);
    expect(
      accessTable
        .map((entry: DataStoreAccess): string => {
          return entry.accessKey || "";
        })
        .sort(),
    ).toEqual([
      "arn:aws:iam::123456789012:role/analytics|Read|Bucket policy",
      "service:checkout|Read|Seen in traces",
    ]);
    expect(
      accessTable.find((entry: DataStoreAccess) => {
        return entry.id?.toString() === keptId;
      })?.lastSeenAt,
    ).toEqual(clock);
  });

  test("a read that cannot be recorded is logged; the others are, and the evaluation is queued anyway", async () => {
    createSpy.mockImplementation((async (
      createBy: CreateBy<DataStore>,
    ): Promise<DataStore> => {
      if (createBy.data.name === "broken") {
        throw new Error("Postgres went away");
      }

      createBy.data.id = ObjectID.generate();
      storeTable.push(createBy.data);
      return createBy.data;
    }) as never);

    const recorded: number = await recordReads([
      readOf("broken"),
      readOf("customer-exports"),
    ]);

    expect(recorded).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "DataSecurity: could not record the read of arn:aws:s3:::broken:",
    );
    expect(queueSpy).toHaveBeenCalledTimes(1);
  });

  test("an empty read still queues the evaluation", async () => {
    expect(await recordReads([])).toBe(0);
    expect(queueSpy).toHaveBeenCalledTimes(1);
  });

  test("every column a read writes is a column of its table", async () => {
    const accessColumns: Set<string> = new Set(
      Object.keys(getTableColumns(new DataStoreAccess())),
    );

    existingStore({
      storeKey: "cloud:aws:AWS S3 Bucket:arn:aws:s3:::customer-exports",
      name: "customer-exports",
      discoveredFrom: "Cloud inventory",
    });

    await recordReads([
      readOf("customer-exports", {
        access: [accessEntry({ lastUsedAt: NOW })],
        sizeInBytes: 1,
        objectCount: 1,
        lastActivityAt: NOW,
      }),
    ]);
    await recordReads([
      readOf("customer-exports", {
        access: [accessEntry({ lastUsedAt: NOW })],
      }),
    ]);

    for (const call of updateSpy.mock.calls) {
      for (const column of Object.keys(
        (call[0] as { data: JSONObject }).data,
      )) {
        expect({ column, isAColumn: DATA_STORE_COLUMNS.has(column) }).toEqual({
          column,
          isAColumn: true,
        });
      }
    }

    expect(accessUpdateSpy).toHaveBeenCalled();

    for (const call of accessUpdateSpy.mock.calls) {
      for (const column of Object.keys(
        (call[0] as { data: JSONObject }).data,
      )) {
        expect({ column, isAColumn: accessColumns.has(column) }).toEqual({
          column,
          isAColumn: true,
        });
      }
    }
  });
});

describe("ensureTelemetryStore", () => {
  const SERVICE_ID: ObjectID = new ObjectID(
    "55555555-5555-4555-8555-555555555555",
  );

  test("a service's telemetry of one signal becomes a store the first time it is scanned", async () => {
    const id: ObjectID | null =
      await DataSecurityDiscovery.ensureTelemetryStore({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceName: "checkout-staging",
        kind: DataStoreKind.TelemetryLogs,
      });

    const store: DataStore = storeTable[0]!;

    expect(id?.toString()).toBe(store.id!.toString());
    expect(store.storeKey).toBe(
      telemetryDataStoreKey({
        serviceId: SERVICE_ID.toString(),
        kind: DataStoreKind.TelemetryLogs,
      }),
    );
    expect(store.storeKey).toBe(`telemetry:${SERVICE_ID.toString()}:Logs`);
    expect(store.name).toBe("checkout-staging · Logs");
    expect(store.kind).toBe(DataStoreKind.TelemetryLogs);
    expect(store.provider).toBe(DataStoreProvider.OneUptime);
    expect(store.family).toBe(DataStoreFamily.Telemetry);
    expect(store.discoveredFrom).toBe("Telemetry");
    expect(store.serviceId?.toString()).toBe(SERVICE_ID.toString());
    expect(store.environment).toBe(DataStoreEnvironment.Staging);
    expect(store.firstSeenAt).toEqual(NOW);
    expect(store.lastSeenAt).toEqual(NOW);
  });

  test("a session replay store belongs to no service", async () => {
    await DataSecurityDiscovery.ensureTelemetryStore({
      projectId: PROJECT_ID,
      serviceId: SERVICE_ID,
      serviceName: "storefront",
      kind: DataStoreKind.TelemetrySessionReplays,
    });

    expect(storeTable[0]!.serviceId).toBeUndefined();
    expect(storeTable[0]!.name).toBe("storefront · Session Replays");
  });

  test("a store that exists is marked seen and brought back, never made again", async () => {
    const existing: DataStore = existingStore({
      storeKey: `telemetry:${SERVICE_ID.toString()}:Traces`,
      name: "checkout · Traces",
      discoveredFrom: "Telemetry",
      isArchived: true,
    });

    const id: ObjectID | null =
      await DataSecurityDiscovery.ensureTelemetryStore({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceName: "checkout",
        kind: DataStoreKind.TelemetryTraces,
      });

    expect(id?.toString()).toBe(existing.id!.toString());
    expect(createSpy).not.toHaveBeenCalled();
    expect(updatesOf(existing)).toEqual([
      { lastSeenAt: NOW, isArchived: false },
    ]);
  });

  test("when another scan made it first, its store is the one returned", async () => {
    createSpy.mockImplementation((async (
      createBy: CreateBy<DataStore>,
    ): Promise<DataStore> => {
      const raced: DataStore = new DataStore(ObjectID.generate());
      raced.storeKey = createBy.data.storeKey!;
      storeTable.push(raced);
      throw new Error("duplicate key value violates unique constraint");
    }) as never);

    const id: ObjectID | null =
      await DataSecurityDiscovery.ensureTelemetryStore({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceName: "checkout",
        kind: DataStoreKind.TelemetryExceptions,
      });

    expect(id?.toString()).toBe(storeTable[0]!.id!.toString());
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("a store that cannot be made at all is logged, and nothing is returned", async () => {
    createSpy.mockRejectedValue(new Error("Postgres went away"));

    const id: ObjectID | null =
      await DataSecurityDiscovery.ensureTelemetryStore({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceName: "checkout",
        kind: DataStoreKind.TelemetryAiConversations,
      });

    expect(id).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      `DataSecurity: could not record the AI Conversations store of ${SERVICE_ID.toString()}:`,
    );
  });
});
