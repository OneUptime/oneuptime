import DataSecurityResponse from "../../../../Server/Utils/DataSecurity/DataSecurityResponse";
import * as AwsResponse from "../../../../Server/Utils/DataSecurity/Cloud/Aws/AwsDataSecurityResponse";
import * as AzureResponse from "../../../../Server/Utils/DataSecurity/Cloud/Azure/AzureDataSecurityResponse";
import * as GcpResponse from "../../../../Server/Utils/DataSecurity/Cloud/Gcp/GcpDataSecurityResponse";
import * as DataSecurityJobs from "../../../../Server/Utils/DataSecurity/DataSecurityJobs";
import DataSecurityRunner from "../../../../Server/Utils/DataSecurity/DataSecurityRunner";
import { CloudConnectionSettings } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import CloudConnectionService from "../../../../Server/Services/CloudConnectionService";
import DataSecurityIssueFeedService from "../../../../Server/Services/DataSecurityIssueFeedService";
import DataStoreFeedService from "../../../../Server/Services/DataStoreFeedService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import CloudConnection from "../../../../Models/DatabaseModels/CloudConnection";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import { DataStoreFeedEventType } from "../../../../Models/DatabaseModels/DataStoreFeed";
import { DataSecurityIssueFeedEventType } from "../../../../Models/DatabaseModels/DataSecurityIssueFeed";
import { Gray500, Green500 } from "../../../../Types/BrandColors";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { DATA_SECURITY_RESPONSE_FIELD_KEY } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import {
  DataSecurityResponseAvailability,
  DataSecurityResponseUnavailableReason,
} from "../../../../Types/DataSecurity/DataSecurityApiTypes";
import { DataSecurityResponseAction } from "../../../../Types/DataSecurity/DataSecurityResponseAction";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * CLOSING A STORE'S EXPOSURE (DataSecurityResponse), with the clouds stood
 * in for: each cloud's own helper is run against fake APIs in Cloud/*
 * DataSecurityResponse.test.ts. This holds the part around them - which
 * store, which connection, whether its "Data security response" is on,
 * what the store's feed and the issue's timeline say, and the read that
 * follows a change - and what a store's page is told before anybody
 * presses anything.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STORE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CONNECTION_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ISSUE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const SETTINGS: CloudConnectionSettings = {
  provider: CloudProvider.AWS,
  projectId: PROJECT_ID.toString(),
  config: {},
  secrets: {},
};

let store: DataStore | null;
let connection: CloudConnection | null;
let storeFeedSpy: jest.SpyInstance;
let issueFeedSpy: jest.SpyInstance;
let readSpy: jest.SpyInstance;
let connectionFindSpy: jest.SpyInstance;
let s3Spy: jest.SpyInstance;
let azureSpy: jest.SpyInstance;
let gcsSpy: jest.SpyInstance;
let rdsSpy: jest.SpyInstance;

function storeOf(data: {
  kind: DataStoreKind;
  name?: string;
  connected?: boolean;
  isPublicByDesign?: boolean;
  providerResourceId?: string;
  sharedSnapshotIds?: Array<string>;
}): DataStore {
  const row: DataStore = new DataStore(STORE_ID);
  row.projectId = PROJECT_ID;
  row.kind = data.kind;
  row.name = data.name || "customer-exports";
  row.region = "eu-west-1";
  row.cloudAccountNumber = "123456789012";
  row.isPublicByDesign = Boolean(data.isPublicByDesign);

  if (data.connected !== false) {
    row.cloudConnectionId = CONNECTION_ID;
  }

  if (data.providerResourceId) {
    row.providerResourceId = data.providerResourceId;
  }

  if (data.sharedSnapshotIds) {
    row.posture = { sharedSnapshotIds: data.sharedSnapshotIds } as never;
  }

  return row;
}

function connectionOf(data: {
  response?: string;
  isEnabled?: boolean;
}): CloudConnection {
  const row: CloudConnection = new CloudConnection(CONNECTION_ID);
  row.projectId = PROJECT_ID;
  row.isEnabled = data.isEnabled !== false;
  row.config = (
    data.response ? { [DATA_SECURITY_RESPONSE_FIELD_KEY]: data.response } : {}
  ) as JSONObject;
  return row;
}

beforeEach(() => {
  store = storeOf({ kind: DataStoreKind.AwsS3Bucket });
  connection = connectionOf({ response: "block" });

  jest.spyOn(DataStoreService, "findOneBy").mockImplementation((async () => {
    return store;
  }) as never);
  connectionFindSpy = jest
    .spyOn(CloudConnectionService, "findOneBy")
    .mockImplementation((async () => {
      return connection;
    }) as never);
  jest
    .spyOn(CloudConnectionService, "getConnectorSettings")
    .mockResolvedValue(SETTINGS);
  storeFeedSpy = jest
    .spyOn(DataStoreFeedService, "createDataStoreFeedItem")
    .mockResolvedValue(undefined);
  issueFeedSpy = jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined);
  readSpy = jest
    .spyOn(DataSecurityJobs, "queueDataSecurityConnectionRead")
    .mockResolvedValue(undefined);
  jest
    .spyOn(DataSecurityRunner, "connectedAccounts")
    .mockResolvedValue(["123456789012", "210987654321"]);
  s3Spy = jest
    .spyOn(AwsResponse, "blockS3BucketPublicAccess")
    .mockResolvedValue({
      changed: true,
      summary:
        "Turned on all four Block Public Access settings of customer-exports.",
    });
  azureSpy = jest
    .spyOn(AzureResponse, "blockAzureStoragePublicAccess")
    .mockResolvedValue({
      changed: true,
      summary: "Turned off anonymous blob access on acmepublic.",
    } as never);
  gcsSpy = jest
    .spyOn(GcpResponse, "blockGcsBucketPublicAccess")
    .mockResolvedValue({
      changed: false,
      summary: "Public access prevention was already enforced on acme-public.",
    } as never);
  rdsSpy = jest
    .spyOn(AwsResponse, "revokeRdsSnapshotSharing")
    .mockImplementation((async (
      _settings: CloudConnectionSettings,
      options: { snapshotIdentifier: string },
    ) => {
      return {
        changed: true,
        summary: `Stopped sharing ${options.snapshotIdentifier}.`,
      };
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what a store can take now", () => {
  async function availability(): Promise<DataSecurityResponseAvailability> {
    return await DataSecurityResponse.getAvailability({
      projectId: PROJECT_ID,
      dataStoreId: STORE_ID,
    });
  }

  test("a bucket whose connection has the response on can be blocked", async () => {
    expect(await availability()).toEqual({
      actions: [
        {
          action: DataSecurityResponseAction.BlockPublicAccess,
          isAvailable: true,
        },
      ],
    });
    // The connection is read in the store's project only, as OneUptime.
    expect(connectionFindSpy).toHaveBeenCalledWith({
      query: { _id: CONNECTION_ID, projectId: PROJECT_ID },
      select: { _id: true, config: true, isEnabled: true },
      props: { isRoot: true },
    });
  });

  test("with the response off it says so, and which connection to turn it on for", async () => {
    connection = connectionOf({ response: "off" });

    expect(await availability()).toEqual({
      actions: [
        {
          action: DataSecurityResponseAction.BlockPublicAccess,
          isAvailable: false,
          unavailableReason: DataSecurityResponseUnavailableReason.ResponseOff,
        },
      ],
      cloudConnectionId: CONNECTION_ID.toString(),
    });
  });

  test("a connection with no setting at all - every connection until someone opts in - is off", async () => {
    connection = connectionOf({});

    expect((await availability()).actions[0]?.unavailableReason).toBe(
      DataSecurityResponseUnavailableReason.ResponseOff,
    );
  });

  test.each([
    ["gone", null],
    ["turned off", "disabled"],
  ])(
    "a connection that is %s cannot act",
    async (_what: string, state: string | null) => {
      connection =
        state === null
          ? null
          : connectionOf({ response: "block", isEnabled: false });

      const read: DataSecurityResponseAvailability = await availability();

      expect(read.actions[0]?.unavailableReason).toBe(
        DataSecurityResponseUnavailableReason.ConnectionGone,
      );
      expect(read.cloudConnectionId).toBeUndefined();
    },
  );

  test("a store no cloud connection found cannot act, and no connection is read", async () => {
    store = storeOf({ kind: DataStoreKind.AwsS3Bucket, connected: false });

    expect((await availability()).actions[0]?.unavailableReason).toBe(
      DataSecurityResponseUnavailableReason.NotThroughACloud,
    );
    expect(connectionFindSpy).not.toHaveBeenCalled();
  });

  test("a bucket marked public by design is never blocked, whatever its connection allows", async () => {
    store = storeOf({
      kind: DataStoreKind.AwsS3Bucket,
      isPublicByDesign: true,
    });

    expect((await availability()).actions).toEqual([
      {
        action: DataSecurityResponseAction.BlockPublicAccess,
        isAvailable: false,
        unavailableReason: DataSecurityResponseUnavailableReason.PublicByDesign,
      },
    ]);
  });

  test("a database's snapshots can have their sharing revoked; public by design does not hold that back", async () => {
    store = storeOf({
      kind: DataStoreKind.AwsRdsInstance,
      isPublicByDesign: true,
    });

    expect((await availability()).actions).toEqual([
      {
        action: DataSecurityResponseAction.RevokeSharing,
        isAvailable: true,
      },
    ]);
  });

  test.each([
    DataStoreKind.PostgreSql,
    DataStoreKind.TelemetryLogs,
    DataStoreKind.AwsDynamoDbTable,
  ])(
    "a %s takes no action, and nothing else is read",
    async (kind: DataStoreKind) => {
      store = storeOf({ kind });

      expect(await availability()).toEqual({ actions: [] });
      expect(connectionFindSpy).not.toHaveBeenCalled();
    },
  );

  test("a store of another project is not found", async () => {
    store = null;

    await expect(availability()).rejects.toThrow("Data store not found.");
  });
});

describe("running one", () => {
  test("Block public access on an S3 bucket: the bucket, its Region and account go to the cloud; the feed says what was done; the connection is read again", async () => {
    const outcome: { changed: boolean; summary: string } =
      await DataSecurityResponse.run({
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
        action: DataSecurityResponseAction.BlockPublicAccess,
        userId: USER_ID,
      });

    expect(outcome.changed).toBe(true);
    expect(s3Spy).toHaveBeenCalledWith(SETTINGS, {
      connectionId: CONNECTION_ID,
      bucket: "customer-exports",
      region: "eu-west-1",
      accountNumber: "123456789012",
    });
    expect(storeFeedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
        dataStoreFeedEventType: DataStoreFeedEventType.ResponseActionTaken,
        feedInfoInMarkdown:
          "**Block public access**, through the store's cloud connection: Turned on all four Block Public Access settings of customer-exports. The store is being checked again.",
        // Green: the store's configuration changed.
        displayColor: Green500,
        userId: USER_ID,
      }),
    );
    expect(readSpy).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      cloudConnectionId: CONNECTION_ID,
    });
    // Run from no issue: no issue's timeline is written.
    expect(issueFeedSpy).not.toHaveBeenCalled();
  });

  test("run from an issue, the issue's timeline says what was done and that the store is checked again", async () => {
    await DataSecurityResponse.run({
      projectId: PROJECT_ID,
      dataStoreId: STORE_ID,
      action: DataSecurityResponseAction.BlockPublicAccess,
      userId: USER_ID,
      dataSecurityIssueId: ISSUE_ID,
    });

    expect(issueFeedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        dataSecurityIssueId: ISSUE_ID,
        eventType: DataSecurityIssueFeedEventType.ResponseActionTaken,
        feedInfoInMarkdown:
          "**Block public access** on the store, through its cloud connection: Turned on all four Block Public Access settings of customer-exports. The store is being checked again.",
        displayColor: Green500,
        userId: USER_ID,
      }),
    );
  });

  test("nothing to change: the timeline says so, and the connection is not read again for it", async () => {
    store = storeOf({
      kind: DataStoreKind.GcpStorageBucket,
      name: "acme-public",
    });

    const outcome: { changed: boolean; summary: string } =
      await DataSecurityResponse.run({
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
        action: DataSecurityResponseAction.BlockPublicAccess,
        dataSecurityIssueId: ISSUE_ID,
      });

    expect(outcome.changed).toBe(false);
    expect(gcsSpy).toHaveBeenCalledWith(SETTINGS, {
      connectionId: CONNECTION_ID.toString(),
      bucket: "acme-public",
    });
    expect(issueFeedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        feedInfoInMarkdown:
          "**Block public access** on the store changed nothing: Public access prevention was already enforced on acme-public.",
        // Grey: nothing changed.
        displayColor: Gray500,
      }),
    );
    expect(storeFeedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        feedInfoInMarkdown:
          "**Block public access** changed nothing: Public access prevention was already enforced on acme-public.",
        displayColor: Gray500,
      }),
    );
    expect(readSpy).not.toHaveBeenCalled();
  });

  test("an Azure storage account is changed by its resource id", async () => {
    const accountId: string =
      "/subscriptions/d0cfe6b2-9ac0-4464-9919-dccaee2e48c0/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/acmepublic";
    store = storeOf({
      kind: DataStoreKind.AzureStorageAccount,
      name: "acmepublic",
      providerResourceId: accountId,
    });

    await DataSecurityResponse.run({
      projectId: PROJECT_ID,
      dataStoreId: STORE_ID,
      action: DataSecurityResponseAction.BlockPublicAccess,
    });

    expect(azureSpy).toHaveBeenCalledWith(SETTINGS, {
      connectionId: CONNECTION_ID.toString(),
      resourceId: accountId,
    });
    expect(s3Spy).not.toHaveBeenCalled();
  });

  test("a bucket marked public by design is refused before any cloud is asked", async () => {
    store = storeOf({
      kind: DataStoreKind.AwsS3Bucket,
      isPublicByDesign: true,
    });

    await expect(
      DataSecurityResponse.run({
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
        action: DataSecurityResponseAction.BlockPublicAccess,
      }),
    ).rejects.toThrow("This store is marked public by design");
    expect(s3Spy).not.toHaveBeenCalled();
    expect(storeFeedSpy).not.toHaveBeenCalled();
  });

  test("with the response off, it says how to turn it on, and asks no cloud", async () => {
    connection = connectionOf({ response: "off" });

    await expect(
      DataSecurityResponse.run({
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
        action: DataSecurityResponseAction.BlockPublicAccess,
      }),
    ).rejects.toThrow('Turn on "Data security response"');
    expect(s3Spy).not.toHaveBeenCalled();
  });

  test("an action the store's kind does not take is refused", async () => {
    await expect(
      DataSecurityResponse.run({
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
        action: DataSecurityResponseAction.RevokeSharing,
      }),
    ).rejects.toThrow(BadDataException);
    expect(rdsSpy).not.toHaveBeenCalled();
  });

  test("Revoke sharing on a snapshot: that snapshot, as a cluster snapshot when its ARN says so, keeping the connected accounts' shares", async () => {
    store = storeOf({
      kind: DataStoreKind.AwsRdsSnapshot,
      name: "orders-2026-10-01",
      providerResourceId:
        "arn:aws:rds:eu-west-1:123456789012:cluster-snapshot:orders-2026-10-01",
    });

    await DataSecurityResponse.run({
      projectId: PROJECT_ID,
      dataStoreId: STORE_ID,
      action: DataSecurityResponseAction.RevokeSharing,
    });

    expect(rdsSpy).toHaveBeenCalledWith(SETTINGS, {
      connectionId: CONNECTION_ID,
      region: "eu-west-1",
      snapshotIdentifier: "orders-2026-10-01",
      isClusterSnapshot: true,
      connectedAccountIds: ["123456789012", "210987654321"],
      accountNumber: "123456789012",
    });
  });

  test("Revoke sharing on a cluster: every manual snapshot of it that was shared, each a cluster snapshot", async () => {
    store = storeOf({
      kind: DataStoreKind.AwsRdsCluster,
      name: "orders",
      sharedSnapshotIds: ["orders-a", "orders-b"],
    });

    const outcome: { changed: boolean; summary: string } =
      await DataSecurityResponse.run({
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
        action: DataSecurityResponseAction.RevokeSharing,
      });

    expect(
      rdsSpy.mock.calls.map((call: Array<unknown>): unknown => {
        return [
          (call[1] as JSONObject)["snapshotIdentifier"],
          (call[1] as JSONObject)["isClusterSnapshot"],
        ];
      }),
    ).toEqual([
      ["orders-a", true],
      ["orders-b", true],
    ]);
    expect(outcome).toEqual({
      changed: true,
      summary: "Stopped sharing orders-a. Stopped sharing orders-b.",
    });
  });

  test("a database none of whose snapshots was shared changes nothing, and asks no cloud", async () => {
    store = storeOf({ kind: DataStoreKind.AwsRdsInstance, name: "billing" });

    const outcome: { changed: boolean; summary: string } =
      await DataSecurityResponse.run({
        projectId: PROJECT_ID,
        dataStoreId: STORE_ID,
        action: DataSecurityResponseAction.RevokeSharing,
      });

    expect(outcome.changed).toBe(false);
    expect(outcome.summary).toContain(
      "No manual snapshot of billing was shared",
    );
    expect(rdsSpy).not.toHaveBeenCalled();
  });
});
