import CloudConnectionPullRunner, {
  CLOUD_READ_MAX_DURATION_MS,
  CLOUD_READ_MAX_REQUESTS,
  CloudConnectionPullOutcome,
  CloudMetricsImporter,
} from "../../../../Server/Utils/CloudConnection/CloudConnectionPullRunner";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import CloudConnection from "../../../../Models/DatabaseModels/CloudConnection";
import CloudConnectionService from "../../../../Server/Services/CloudConnectionService";
import CloudConnectionResourceSync, {
  CloudConnectionSyncResult,
} from "../../../../Server/Utils/CloudConnection/CloudConnectionResourceSync";
import CloudConnectionLanes from "../../../../Server/Utils/CloudConnection/CloudConnectionLanes";
import CloudConnectorRegistry from "../../../../Server/Utils/CloudConnection/CloudConnectorRegistry";
import {
  CloudConnectionSettings,
  CloudConnector,
  CloudReadOptions,
  CloudReadResult,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import LlmConnectionPullRunner from "../../../../Server/Utils/LlmObservability/LlmConnectionPullRunner";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudMonitoredResource } from "../../../../Types/Cloud/CloudMonitoredResource";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * One read of one cloud connection: the plan gate, what it hands the
 * connector (its state, its service, the resources it holds, the read's
 * bounds), that the resources are kept before their metrics are imported,
 * and what it records - when it read, what it found, the error without the
 * secret, where the next read resumes and when it comes.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const SERVICE: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const NOW: Date = new Date("2026-10-21T12:07:00Z");
const SECRET: string = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const MINUTE: number = 60 * 1000;

const EC2: CloudMonitoredResource = {
  provider: CloudProvider.AWS,
  source: "aws_cloudwatch" as CloudMonitoredResource["source"],
  resourceType: "AWS::EC2::Instance",
  name: "i-0aaa",
  providerResourceId: "arn:aws:ec2:us-east-1:123456789012:instance/i-0aaa",
  accountId: "123456789012",
  region: "us-east-1",
  resourceGroup: "",
  identityKey:
    "aws|123456789012|us-east-1|aws::ec2::instance|instanceid=i-0aaa",
  telemetryAttributes: {},
};

let connection: CloudConnection;
let recorded: Array<JSONObject>;
let order: Array<string>;
let imported: Array<{ projectId: ObjectID; payload: JSONObject }>;
let readCalls: Array<CloudReadOptions>;
let readResult: () => Promise<CloudReadResult>;
let syncCalls: Array<JSONObject>;

const importMetrics: CloudMetricsImporter = async (data: {
  projectId: ObjectID;
  payload: JSONObject;
}): Promise<void> => {
  order.push("import");
  imported.push(data);
};

function result(overrides: Partial<CloudReadResult> = {}): CloudReadResult {
  return {
    accounts: ["123456789012"],
    resources: [{ resource: EC2, displayName: "web-1" }],
    completelyListedAccounts: [],
    payloads: [{ resourceMetrics: [] }, { resourceMetrics: [] }],
    pointsWritten: 24,
    requestCount: 9,
    warnings: [],
    complete: true,
    nextState: { cursors: { "300": "2026-10-21T11:55:00.000Z" } },
    ...overrides,
  };
}

const SYNCED: CloudConnectionSyncResult = {
  resourceCount: 12,
  resourceTypes: [{ type: "AWS::EC2::Instance", count: 12 }],
  regions: [{ region: "us-east-1", count: 12 }],
  newResources: 1,
  archivedResources: 0,
  hasMore: false,
};

function lastRecord(): JSONObject {
  expect(recorded.length).toBeGreaterThan(0);
  return recorded[recorded.length - 1]!;
}

async function run(): Promise<CloudConnectionPullOutcome> {
  return await CloudConnectionPullRunner.run(CONNECTION, {
    importMetrics,
    now: () => {
      return NOW;
    },
  });
}

beforeEach(() => {
  recorded = [];
  order = [];
  imported = [];
  readCalls = [];
  syncCalls = [];
  readResult = async () => {
    return result();
  };

  connection = new CloudConnection();
  connection.id = CONNECTION;
  connection.projectId = PROJECT;
  connection.name = "Production AWS";
  connection.provider = CloudProvider.AWS;
  connection.isEnabled = true;
  connection.config = { readIntervalInMinutes: "10" };
  connection.pullState = { activePairs: ["us-east-1|AWS/EC2"] };

  jest
    .spyOn(CloudConnectionService, "findOneById")
    .mockImplementation((async () => {
      return connection;
    }) as never);
  jest
    .spyOn(CloudConnectionService, "updateOneById")
    .mockImplementation((async (data: { data: JSONObject }) => {
      recorded.push(data.data);
    }) as never);
  jest
    .spyOn(CloudConnectionService, "ensureTelemetryService")
    .mockResolvedValue({ serviceId: SERVICE, serviceName: "Production AWS" });
  jest
    .spyOn(CloudConnectionService, "getConnectorSettings")
    .mockImplementation((async (): Promise<CloudConnectionSettings> => {
      return {
        provider: CloudProvider.AWS,
        projectId: PROJECT.toString(),
        config: {},
        secrets: { secretAccessKey: SECRET },
      };
    }) as never);
  jest
    .spyOn(LlmConnectionPullRunner, "isTelemetryAllowed")
    .mockResolvedValue(true);
  jest.spyOn(CloudConnectionResourceSync, "loadLinked").mockResolvedValue([
    {
      id: new ObjectID("44444444-4444-4444-8444-444444444444"),
      resourceIdentifier: "aws:abc",
      providerResourceId: EC2.providerResourceId,
      cloudResourceType: EC2.resourceType,
      name: "web-1",
      cloudRegion: "us-east-1",
      cloudAccountId: "123456789012",
      cloudResourceGroup: "",
      isArchived: false,
      cloudTags: {},
      cloudInventoryFingerprint: "",
    },
  ]);
  jest.spyOn(CloudConnectionResourceSync, "sync").mockImplementation((async (
    data: JSONObject,
  ) => {
    order.push("sync");
    syncCalls.push(data);
    return SYNCED;
  }) as never);

  const connector: CloudConnector = {
    provider: CloudProvider.AWS,
    validateSettings: () => {},
    testConnection: async () => {
      throw new Error("not used");
    },
    read: async (
      _settings: CloudConnectionSettings,
      options: CloudReadOptions,
    ): Promise<CloudReadResult> => {
      readCalls.push(options);
      return await readResult();
    },
  };

  jest.spyOn(CloudConnectorRegistry, "getConnector").mockReturnValue(connector);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a read that works", () => {
  test("hands the connector its state, its service, what it holds and the read's bounds", async () => {
    await run();

    const options: CloudReadOptions = readCalls[0]!;

    expect(options.state).toEqual({ activePairs: ["us-east-1|AWS/EC2"] });
    expect(options.serviceName).toBe("Production AWS");
    expect(options.connectionId).toBe(CONNECTION.toString());
    expect(options.maxRequests).toBe(CLOUD_READ_MAX_REQUESTS);
    expect(options.maxDurationMs).toBe(CLOUD_READ_MAX_DURATION_MS);
    expect(options.now!()).toEqual(NOW);
    expect(options.knownResources).toEqual([
      {
        providerResourceId: EC2.providerResourceId,
        resourceType: EC2.resourceType,
        name: "web-1",
        region: "us-east-1",
        accountId: "123456789012",
        resourceGroup: "",
      },
    ]);
  });

  test("keeps the resources before it imports their metrics, every payload", async () => {
    await run();

    expect(order).toEqual(["sync", "import", "import"]);
    expect(
      imported.map((entry: { projectId: ObjectID }) => {
        return entry.projectId.toString();
      }),
    ).toEqual([PROJECT.toString(), PROJECT.toString()]);
    expect(syncCalls[0]).toEqual(
      expect.objectContaining({
        projectId: PROJECT,
        connectionId: CONNECTION,
        discovered: [{ resource: EC2, displayName: "web-1" }],
        completelyListedAccounts: [],
      }),
    );
  });

  test("records what it found, where it got to, and reads again after the connection's interval", async () => {
    const outcome: CloudConnectionPullOutcome = await run();

    expect(outcome.status).toBe("success");
    expect(lastRecord()).toEqual(
      expect.objectContaining({
        lastPulledAt: NOW,
        lastSuccessfulPullAt: NOW,
        lastError: null,
        pullState: { cursors: { "300": "2026-10-21T11:55:00.000Z" } },
        nextPullAt: new Date(NOW.getTime() + 10 * MINUTE),
      }),
    );
    expect(lastRecord()["lastPullResult"]).toEqual(
      expect.objectContaining({
        status: "success",
        accounts: ["123456789012"],
        resourceCount: 12,
        resourceTypes: [{ type: "AWS::EC2::Instance", count: 12 }],
        regions: [{ region: "us-east-1", count: 12 }],
        newResources: 1,
        archivedResources: 0,
        pointsWritten: 24,
        requestCount: 9,
        warnings: [],
      }),
    );
  });

  test("a read a bound stopped is partial, and carries on within a minute", async () => {
    readResult = async () => {
      return result({ complete: false, warnings: ["stopped at its limit"] });
    };

    const outcome: CloudConnectionPullOutcome = await run();

    expect(outcome.status).toBe("partial");
    expect(lastRecord()["nextPullAt"]).toEqual(
      new Date(NOW.getTime() + MINUTE),
    );
  });

  test("more new resources than one read adds is partial, and said", async () => {
    jest
      .spyOn(CloudConnectionResourceSync, "sync")
      .mockResolvedValue({ ...SYNCED, hasMore: true });

    const outcome: CloudConnectionPullOutcome = await run();

    expect(outcome.status).toBe("partial");
    expect(
      (lastRecord()["lastPullResult"] as JSONObject)["warnings"],
    ).toContain(
      "More resources were found than one read adds: the next read adds the rest.",
    );
  });
});

describe("the read's clock", () => {
  test("every request is signed with the time it is sent: the connector and the lanes get the clock, the read keeps its start", async () => {
    let minutes: number = 0;
    const clock: () => Date = (): Date => {
      return new Date(NOW.getTime() + minutes * MINUTE);
    };
    const inventory: jest.SpyInstance = jest
      .spyOn(CloudConnectionLanes, "runInventory")
      .mockResolvedValue({
        ran: false,
        warnings: [],
        accounts: [],
        listedInFull: [],
      });
    const changes: jest.SpyInstance = jest
      .spyOn(CloudConnectionLanes, "runChanges")
      .mockResolvedValue({ ran: false, warnings: [], recorded: 0 });

    await CloudConnectionPullRunner.run(CONNECTION, {
      importMetrics,
      now: clock,
    });

    // The connector's clock moves: a request seven minutes on is signed seven minutes on.
    minutes = 7;
    expect(readCalls[0]!.now!()).toEqual(new Date(NOW.getTime() + 7 * MINUTE));

    for (const lane of [inventory, changes]) {
      const given: { now: Date; clock: () => Date } = lane.mock
        .calls[0]![0] as { now: Date; clock: () => Date };

      // Its windows and cursors keep the read's start...
      expect(given.now).toEqual(NOW);
      // ...and its requests the time they are sent.
      expect(given.clock()).toEqual(new Date(NOW.getTime() + 7 * MINUTE));
    }

    // What the read records is its start.
    expect(lastRecord()["lastPulledAt"]).toEqual(NOW);
  });
});

describe("the inventory's part of a read", () => {
  test("a listing with resources left to add makes the read partial: the next read, a minute later, adds the rest", async () => {
    jest.spyOn(CloudConnectionLanes, "runInventory").mockResolvedValue({
      ran: true,
      warnings: [
        "The accounts have more resources than one read adds: the next read adds the rest.",
      ],
      accounts: [],
      listedInFull: [],
      synced: { ...SYNCED, hasMore: true },
    });
    jest
      .spyOn(CloudConnectionLanes, "runChanges")
      .mockResolvedValue({ ran: false, warnings: [], recorded: 0 });

    const outcome: CloudConnectionPullOutcome = await run();

    expect(outcome.status).toBe("partial");
    expect(lastRecord()["nextPullAt"]).toEqual(
      new Date(NOW.getTime() + MINUTE),
    );
  });

  test("the accounts are marked listed in full as the inventory says, at the read's time", async () => {
    jest.spyOn(CloudConnectionLanes, "runInventory").mockResolvedValue({
      ran: true,
      warnings: [],
      accounts: [{ accountId: "123456789012", name: "production" }],
      listedInFull: ["123456789012"],
      synced: SYNCED,
    });
    jest
      .spyOn(CloudConnectionLanes, "runChanges")
      .mockResolvedValue({ ran: true, warnings: [], recorded: 4 });
    const keep: jest.SpyInstance = jest
      .spyOn(CloudConnectionLanes, "keepAccounts")
      .mockResolvedValue(undefined);

    await run();

    expect(keep).toHaveBeenCalledWith(
      expect.objectContaining({
        accountIds: ["123456789012"],
        named: [{ accountId: "123456789012", name: "production" }],
        listedInFull: ["123456789012"],
        listedAt: NOW,
        recount: true,
      }),
    );
    expect(
      (lastRecord()["lastPullResult"] as JSONObject)["changesRecorded"],
    ).toBe(4);
  });
});

describe("a read that cannot happen", () => {
  test("a connection that is off, or gone, is skipped untouched", async () => {
    connection.isEnabled = false;
    expect((await run()).status).toBe("skipped");

    jest
      .spyOn(CloudConnectionService, "findOneById")
      .mockResolvedValue(null as never);
    expect((await run()).status).toBe("skipped");
    expect(recorded).toEqual([]);
    expect(readCalls).toEqual([]);
  });

  test("a plan without telemetry reads nothing and asks again a day later", async () => {
    jest
      .spyOn(LlmConnectionPullRunner, "isTelemetryAllowed")
      .mockResolvedValue(false);

    const outcome: CloudConnectionPullOutcome = await run();

    expect(outcome.status).toBe("skipped");
    expect(readCalls).toEqual([]);
    expect(lastRecord()).toEqual({
      lastPulledAt: NOW,
      lastError:
        "Cloud connections are not part of this project's plan, or telemetry ingestion is turned off.",
      nextPullAt: new Date(NOW.getTime() + 24 * 60 * MINUTE),
    });
  });
});

describe("a read that fails", () => {
  test("a refused credential waits an hour, records why without the secret, and keeps what the connection held", async () => {
    connection.lastPullResult = {
      status: "success",
      accounts: ["123456789012"],
      resourceCount: 40,
      resourceTypes: [{ type: "AWS::EC2::Instance", count: 40 }],
      regions: [{ region: "us-east-1", count: 40 }],
    };
    readResult = async () => {
      throw new LlmProviderError({
        message: `AWS sign-in check failed with HTTP 403: InvalidClientTokenId ${SECRET}`,
        kind: CloudConnectionFailureKind.Authentication,
        statusCode: 403,
      });
    };

    const outcome: CloudConnectionPullOutcome = await run();

    expect(outcome.status).toBe("failed");
    expect(outcome.error).not.toContain(SECRET);
    expect(lastRecord()["lastError"]).not.toContain(SECRET);
    expect(lastRecord()["nextPullAt"]).toEqual(
      new Date(NOW.getTime() + 60 * MINUTE),
    );
    expect(lastRecord()["lastPullResult"]).toEqual(
      expect.objectContaining({
        status: "failed",
        failureKind: CloudConnectionFailureKind.Authentication,
        resourceCount: 40,
        accounts: ["123456789012"],
      }),
    );
    // Where it got to is not moved on by a read that failed.
    expect(lastRecord()["pullState"]).toBeUndefined();
    expect(imported).toEqual([]);
  });

  test("any other failure waits the longer of the interval and fifteen minutes", async () => {
    readResult = async () => {
      throw new Error("socket hang up");
    };

    await run();

    expect(lastRecord()["nextPullAt"]).toEqual(
      new Date(NOW.getTime() + 15 * MINUTE),
    );

    connection.config = { readIntervalInMinutes: "60" };
    await run();

    expect(lastRecord()["nextPullAt"]).toEqual(
      new Date(NOW.getTime() + 60 * MINUTE),
    );
  });

  test("an import that fails keeps where the read got to, so it is read again", async () => {
    await CloudConnectionPullRunner.run(CONNECTION, {
      importMetrics: async () => {
        throw new Error("ClickHouse is down");
      },
      now: () => {
        return NOW;
      },
    });

    expect(lastRecord()["lastError"]).toContain("ClickHouse is down");
    expect(lastRecord()["pullState"]).toBeUndefined();
  });

  test("a failure to record is logged, never thrown", async () => {
    jest
      .spyOn(CloudConnectionService, "updateOneById")
      .mockRejectedValue(new Error("Postgres said no") as never);

    await expect(run()).resolves.toEqual(
      expect.objectContaining({ status: "success" }),
    );
  });
});

describe("when the next read comes", () => {
  test("by outcome and failure", () => {
    expect(
      CloudConnectionPullRunner.nextPullAt({
        now: NOW,
        intervalInMinutes: 5,
        outcome: "success",
      }),
    ).toEqual(new Date(NOW.getTime() + 5 * MINUTE));
    expect(
      CloudConnectionPullRunner.nextPullAt({
        now: NOW,
        intervalInMinutes: 5,
        outcome: "failed",
        failureKind: CloudConnectionFailureKind.Permission,
      }),
    ).toEqual(new Date(NOW.getTime() + 60 * MINUTE));
    expect(
      CloudConnectionPullRunner.nextPullAt({
        now: NOW,
        intervalInMinutes: 5,
        outcome: "failed",
        failureKind: CloudConnectionFailureKind.RateLimited,
      }),
    ).toEqual(new Date(NOW.getTime() + 15 * MINUTE));
  });

  test("a stored state that is not an object is an empty one", () => {
    expect(CloudConnectionPullRunner.readPullState(null)).toEqual({});
    expect(CloudConnectionPullRunner.readPullState([1])).toEqual({});
    expect(
      CloudConnectionPullRunner.readPullState({ accounts: ["a"] }),
    ).toEqual({
      accounts: ["a"],
    });
  });
});
