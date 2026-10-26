import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import CloudConnection from "../../../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import CloudConnectionService from "../../../../Server/Services/CloudConnectionService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import CloudChangeLookBack, {
  CloudChangeLookBackOutcome,
  LOOK_BACK_FENCE_SECONDS,
  LOOK_BACK_MAX_CONNECTIONS,
  LOOK_BACK_MAX_DURATION_MS,
  LOOK_BACK_MAX_REQUESTS,
  getLookBackPlaces,
} from "../../../../Server/Utils/CloudConnection/CloudChangeLookBack";
import CloudChangeRecorder from "../../../../Server/Utils/CloudConnection/CloudChangeRecorder";
import CloudConnectorRegistry from "../../../../Server/Utils/CloudConnection/CloudConnectorRegistry";
import {
  CloudChange,
  CloudChangesOptions,
  CloudChangesResult,
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudConnector,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import LlmConnectionPullRunner from "../../../../Server/Utils/LlmObservability/LlmConnectionPullRunner";
import logger from "../../../../Server/Utils/Logger";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * What changed in a resource's cloud, read the moment an investigation
 * starts: only the accounts and Regions the linked resources are in, from
 * the start of the window the investigation reads, with a copy of the
 * connection's state (no cursor moves), within a small budget, once per
 * subject in ten minutes - written like any change, each once - and never
 * failing the investigation.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const INCIDENT: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const SINCE: Date = new Date("2026-10-26T08:00:00.000Z");

function resourceId(index: number): string {
  return `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`;
}

function resourceRow(data: {
  index: number;
  connectionId?: ObjectID | undefined;
  accountId?: string;
  region?: string;
}): CloudResource {
  const row: CloudResource = new CloudResource();
  row.id = new ObjectID(resourceId(data.index));
  row.cloudProvider = CloudProvider.AWS;
  row.cloudAccountId = data.accountId ?? "123456789012";
  row.cloudRegion = data.region ?? "eu-west-1";

  if (data.connectionId) {
    row.cloudConnectionId = data.connectionId;
  }

  return row;
}

function change(eventId: string): CloudChange {
  return {
    kind: "change",
    provider: CloudProvider.AWS,
    accountId: "123456789012",
    region: "eu-west-1",
    time: new Date("2026-10-26T09:58:00.000Z"),
    eventId,
    operation: "ec2:AuthorizeSecurityGroupIngress",
    actor: "someone",
    resources: [{ id: "sg-0abc" }],
    failed: false,
  };
}

let resources: Array<CloudResource>;
let connections: Map<string, CloudConnection>;
let readOptions: Array<CloudChangesOptions>;
let readChanges: (options: CloudChangesOptions) => Promise<CloudChangesResult>;
let fence: Set<string>;
let findResources: SpyInstance<typeof CloudResourceService.findBy>;
let findConnection: SpyInstance<typeof CloudConnectionService.findOneBy>;
let record: SpyInstance<typeof CloudChangeRecorder.record>;
let allowed: SpyInstance<typeof LlmConnectionPullRunner.isTelemetryAllowed>;
let fenceSpy: SpyInstance<typeof GlobalCache.setStringIfNotExists>;

function connectionRow(
  id: ObjectID,
  overrides: Partial<CloudConnection> = {},
): CloudConnection {
  const row: CloudConnection = new CloudConnection();
  row.id = id;
  row.projectId = PROJECT;
  row.provider = CloudProvider.AWS;
  row.isEnabled = true;
  row.config = {};
  row.pullState = {
    accounts: ["123456789012"],
    changeCursors: { "123456789012|eu-west-1": "2026-10-26T09:50:00.000Z" },
  };
  Object.assign(row, overrides);
  return row;
}

beforeEach(() => {
  resources = [resourceRow({ index: 1, connectionId: CONNECTION })];
  connections = new Map([[CONNECTION.toString(), connectionRow(CONNECTION)]]);
  readOptions = [];
  readChanges = async (): Promise<CloudChangesResult> => {
    return { changes: [change("evt-1")], warnings: [], complete: true };
  };
  fence = new Set<string>();

  findResources = jest
    .spyOn(CloudResourceService, "findBy")
    .mockImplementation((async () => {
      return resources;
    }) as never);
  findConnection = jest
    .spyOn(CloudConnectionService, "findOneBy")
    .mockImplementation((async (data: { query: JSONObject }) => {
      return connections.get(String(data.query["_id"])) || null;
    }) as never);
  jest
    .spyOn(CloudConnectionService, "getConnectorSettings")
    .mockImplementation((async (
      connection: CloudConnection,
    ): Promise<CloudConnectionSettings> => {
      return {
        provider: connection.provider!,
        projectId: PROJECT.toString(),
        config: {},
        secrets: {},
      };
    }) as never);

  const connector: CloudConnector = {
    provider: CloudProvider.AWS,
    validateSettings: () => {},
    testConnection: async () => {
      throw new Error("not used");
    },
    read: async () => {
      throw new Error("not used");
    },
    readChanges: async (
      _settings: CloudConnectionSettings,
      options: CloudChangesOptions,
    ): Promise<CloudChangesResult> => {
      readOptions.push(options);
      return await readChanges(options);
    },
  };

  jest.spyOn(CloudConnectorRegistry, "getConnector").mockReturnValue(connector);
  record = jest
    .spyOn(CloudChangeRecorder, "record")
    .mockImplementation(async (data: { changes: Array<CloudChange> }) => {
      return {
        recorded: data.changes.length,
        alreadyRecorded: 0,
        unwritten: [],
      };
    });
  allowed = jest
    .spyOn(LlmConnectionPullRunner, "isTelemetryAllowed")
    .mockResolvedValue(true);
  fenceSpy = jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockImplementation((async (namespace: string, key: string) => {
      const full: string = `${namespace}-${key}`;

      if (fence.has(full)) {
        return false;
      }

      fence.add(full);
      return true;
    }) as never);
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function lookBack(
  cloudResourceIds: Array<string> = [resourceId(1)],
): Promise<CloudChangeLookBackOutcome> {
  return await CloudChangeLookBack.readForSubject({
    projectId: PROJECT,
    subjectId: INCIDENT,
    cloudResourceIds,
    since: SINCE,
  });
}

describe("a look back for an investigation", () => {
  test("reads only the accounts and Regions of the linked resources, from the window's start", async () => {
    resources = [
      resourceRow({ index: 1, connectionId: CONNECTION, region: "eu-west-1" }),
      resourceRow({ index: 2, connectionId: CONNECTION, region: "us-east-1" }),
    ];

    const outcome: CloudChangeLookBackOutcome = await lookBack([
      resourceId(1),
      resourceId(2),
    ]);

    expect(outcome).toEqual({ connections: 1, recorded: 1 });
    expect(readOptions).toHaveLength(1);
    expect(readOptions[0]!.since).toEqual(SINCE);
    expect(readOptions[0]!.only).toEqual([
      { accountId: "123456789012", regions: ["eu-west-1", "us-east-1"] },
    ]);
    expect(readOptions[0]!.connectionId).toBe(CONNECTION.toString());
  });

  test("within a small budget of its own", async () => {
    await lookBack();

    const budget: { requestsLeft: number; deadlineMs: number } = readOptions[0]!
      .budget as unknown as { requestsLeft: number; deadlineMs: number };
    expect(budget.requestsLeft).toBe(LOOK_BACK_MAX_REQUESTS);
    expect(budget.deadlineMs - Date.now()).toBeLessThanOrEqual(
      LOOK_BACK_MAX_DURATION_MS,
    );
    expect(LOOK_BACK_MAX_REQUESTS).toBeLessThanOrEqual(60);
  });

  test("with a copy of the connection's state: whatever the read moves, the regular reads' cursors stay", async () => {
    readChanges = async (
      options: CloudChangesOptions,
    ): Promise<CloudChangesResult> => {
      options.state.changeCursors = { moved: "2099-01-01T00:00:00.000Z" };
      options.state.recentChanges = { moved: { x: 1 } };
      return { changes: [], warnings: [], complete: true };
    };
    const stored: CloudConnectionPullState = connections.get(
      CONNECTION.toString(),
    )!.pullState as CloudConnectionPullState;
    const before: string = JSON.stringify(stored);

    await lookBack();

    expect(readOptions[0]!.state).not.toBe(stored);
    expect(JSON.stringify(stored)).toBe(before);
  });

  test("writes what it found like any change: through the recorder, which writes each change once", async () => {
    await lookBack();

    expect(record).toHaveBeenCalledWith({
      projectId: PROJECT,
      provider: CloudProvider.AWS,
      changes: [change("evt-1")],
    });
  });

  test("reads the resources and the connection pinned to the subject's project", async () => {
    await lookBack();

    const resourceQuery: JSONObject = (
      findResources.mock.calls[0]![0] as unknown as { query: JSONObject }
    ).query;
    expect(resourceQuery["projectId"]).toEqual(PROJECT);

    const connectionQuery: JSONObject = (
      findConnection.mock.calls[0]![0] as unknown as { query: JSONObject }
    ).query;
    expect(connectionQuery["projectId"]).toEqual(PROJECT);
    expect(connectionQuery["_id"]).toEqual(CONNECTION);
  });

  test("reads each connection the resources are read by, a few at most", async () => {
    resources = [];

    for (
      let index: number = 0;
      index < LOOK_BACK_MAX_CONNECTIONS + 2;
      index++
    ) {
      const id: ObjectID = new ObjectID(
        `66666666-6666-4666-8666-${String(index).padStart(12, "0")}`,
      );
      connections.set(id.toString(), connectionRow(id));
      resources.push(resourceRow({ index, connectionId: id }));
    }

    const outcome: CloudChangeLookBackOutcome = await lookBack(
      resources.map((resource: CloudResource): string => {
        return resource.id!.toString();
      }),
    );

    expect(outcome.connections).toBe(LOOK_BACK_MAX_CONNECTIONS);
    expect(readOptions).toHaveLength(LOOK_BACK_MAX_CONNECTIONS);
  });

  /*
   * Each connection may take its whole LOOK_BACK_MAX_DURATION_MS: read one
   * after another, five slow accounts would hold the investigation for five
   * times that.
   */
  test("reads its connections side by side: the investigation waits for the slowest, not for all in turn", async () => {
    resources = [];

    for (let index: number = 0; index < 3; index++) {
      const id: ObjectID = new ObjectID(
        `77777777-7777-4777-8777-${String(index).padStart(12, "0")}`,
      );
      connections.set(id.toString(), connectionRow(id));
      resources.push(resourceRow({ index, connectionId: id }));
    }

    const releases: Array<() => void> = [];

    readChanges = (): Promise<CloudChangesResult> => {
      return new Promise<CloudChangesResult>(
        (resolve: (result: CloudChangesResult) => void) => {
          releases.push(() => {
            resolve({
              changes: [change("evt-1")],
              warnings: [],
              complete: true,
            });
          });
        },
      );
    };

    const pending: Promise<CloudChangeLookBackOutcome> = lookBack(
      resources.map((resource: CloudResource): string => {
        return resource.id!.toString();
      }),
    );

    // Every connection is asked before any of them has answered.
    for (let turn: number = 0; turn < 50 && releases.length < 3; turn++) {
      await Promise.resolve();
    }

    expect(releases).toHaveLength(3);

    for (const release of releases) {
      release();
    }

    expect(await pending).toEqual({ connections: 3, recorded: 3 });
  });

  test("one connection that fails leaves the others' changes written", async () => {
    const other: ObjectID = new ObjectID(
      "88888888-8888-4888-8888-000000000001",
    );
    connections.set(other.toString(), connectionRow(other));
    resources = [
      resourceRow({ index: 1, connectionId: CONNECTION }),
      resourceRow({ index: 2, connectionId: other, accountId: "210987654321" }),
    ];
    readChanges = async (
      options: CloudChangesOptions,
    ): Promise<CloudChangesResult> => {
      if (options.connectionId === other.toString()) {
        throw new Error("CloudTrail is throttling this account");
      }

      return { changes: [change("evt-1")], warnings: [], complete: true };
    };

    expect(await lookBack([resourceId(1), resourceId(2)])).toEqual({
      connections: 1,
      recorded: 1,
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe("what a look back leaves alone", () => {
  test("a resource no connection reads (found from a collector's telemetry)", async () => {
    resources = [resourceRow({ index: 1 })];

    expect(await lookBack()).toEqual({
      connections: 0,
      recorded: 0,
      skipped: "no-connection",
    });
    expect(readOptions).toEqual([]);
  });

  test("ids that are not ids, or none at all", async () => {
    expect(await lookBack(["not-an-id", ""])).toEqual({
      connections: 0,
      recorded: 0,
      skipped: "no-cloud-resources",
    });
    expect(findResources).not.toHaveBeenCalled();
    expect(fenceSpy).not.toHaveBeenCalled();
  });

  test("a project whose plan has no telemetry", async () => {
    allowed.mockResolvedValue(false);

    expect((await lookBack()).skipped).toBe("not-allowed");
    expect(readOptions).toEqual([]);
  });

  test("a subject read back in the last ten minutes: an investigation and a remediation decision read once", async () => {
    await lookBack();
    const second: CloudChangeLookBackOutcome = await lookBack();

    expect(second.skipped).toBe("already-read");
    expect(readOptions).toHaveLength(1);
    expect(fenceSpy.mock.calls[0]![3]).toEqual({
      expiresInSeconds: LOOK_BACK_FENCE_SECONDS,
    });
    expect(LOOK_BACK_FENCE_SECONDS).toBe(600);
  });

  test("a cache that does not answer lets the look back through", async () => {
    fenceSpy.mockRejectedValue(new Error("Cache is not connected"));

    expect((await lookBack()).connections).toBe(1);
  });

  test("a connection that is off, gone, or of a cloud with no activity log reader", async () => {
    connections.set(
      CONNECTION.toString(),
      connectionRow(CONNECTION, { isEnabled: false }),
    );
    expect((await lookBack()).connections).toBe(0);

    connections.delete(CONNECTION.toString());
    fence.clear();
    expect((await lookBack()).connections).toBe(0);
    expect(readOptions).toEqual([]);
  });
});

describe("a look back that fails", () => {
  test("is logged, and the investigation goes on", async () => {
    readChanges = async (): Promise<CloudChangesResult> => {
      throw new Error("CloudTrail is down");
    };

    expect(await lookBack()).toEqual({ connections: 0, recorded: 0 });
    expect(logger.error).toHaveBeenCalled();
  });

  test("a database that does not answer is logged too, never thrown", async () => {
    findResources.mockRejectedValue(new Error("database is down"));

    expect(await lookBack()).toEqual({ connections: 0, recorded: 0 });
  });
});

describe("the places a look back reads", () => {
  test("each account once, with the Regions its resources are in", () => {
    expect(
      getLookBackPlaces([
        { accountId: "123456789012", region: "eu-west-1" },
        { accountId: "123456789012", region: "eu-west-1" },
        { accountId: "123456789012", region: "us-east-1" },
        { accountId: "210987654321", region: "ap-south-1" },
      ]),
    ).toEqual([
      { accountId: "123456789012", regions: ["eu-west-1", "us-east-1"] },
      { accountId: "210987654321", regions: ["ap-south-1"] },
    ]);
  });

  test("a resource with no Region, or a global one, adds none; one with no account is no place", () => {
    expect(
      getLookBackPlaces([
        { accountId: "acme-prod", region: "global" },
        { accountId: "acme-prod", region: "" },
        { accountId: " ", region: "eu-west-1" },
      ]),
    ).toEqual([{ accountId: "acme-prod", regions: [] }]);
  });
});
