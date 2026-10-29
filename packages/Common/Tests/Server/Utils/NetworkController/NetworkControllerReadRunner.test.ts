import NetworkControllerReadRunner, {
  INVENTORY_NOT_RECORDED_WARNING,
  NETWORK_CONTROLLER_READ_MAX_REQUESTS,
  NetworkControllerReadDependencies,
  NetworkControllerReadOutcome,
  STORED_WINDOW_END_LOOKBACK_MS,
  StoredWindowEndFinder,
  StoredWindowFinder,
  reconcilePullState,
} from "../../../../Server/Utils/NetworkController/NetworkControllerReadRunner";
import {
  ControllerInventoryCandidate,
  ControllerInventoryLookup,
} from "../../../../Server/Utils/NetworkController/NetworkControllerInventory";
import { DiscoveredDetailsMerge } from "../../../../Server/Services/NetworkDeviceService";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import NetworkControllerConnection from "../../../../Models/DatabaseModels/NetworkControllerConnection";
import NetworkControllerConnectionService from "../../../../Server/Services/NetworkControllerConnectionService";
import NetworkTrafficUsageAggregationService from "../../../../Server/Services/NetworkTrafficUsageAggregationService";
import { NetworkTrafficUsageWindowKey } from "../../../../Server/Utils/NetworkController/NetworkControllerTypes";
import { getWindowKey } from "../../../../Server/Utils/NetworkController/NetworkTrafficUsageRows";
import { JSONObject } from "../../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import { NetworkControllerReadSummary } from "../../../../Types/NetworkController/NetworkControllerReadSummary";
import NetworkControllerProvider from "../../../../Types/NetworkController/NetworkControllerProvider";
import { NetworkTrafficUsageKind } from "../../../../Types/NetFlow/NetworkTrafficUsage";
import ObjectID from "../../../../Types/ObjectID";
import {
  FAKE_API_KEY,
  FakeMerakiApi,
  FakeMerakiOptions,
  TestClock,
  buildBranchOrganization,
  createFakeMerakiApi,
  createTestClock,
  merakiError,
} from "./FakeMerakiApi";

/*
 * One read of one Meraki connection, end to end against the fake
 * dashboard API, with ClickHouse played by an array: the plan gate, the
 * read, the device each row belongs to, the rows written - each window
 * once, whatever failed in between - and the outcome recorded on the
 * connection: when it read, what it found, the error without the key,
 * where the next read starts and when it comes.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CONNECTION: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MX_DEVICE: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const START: Date = new Date("2026-10-24T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

let connection: NetworkControllerConnection;
let recorded: Array<JSONObject>;
let table: Array<JSONObject>;
let clock: TestClock;
let api: FakeMerakiApi;
let failInsertAfterRows: number | null;
let failBookkeeping: boolean;
// The project's devices the device list is matched against, and what was merged.
let candidates: Array<ControllerInventoryCandidate>;
let lookups: Array<ControllerInventoryLookup>;
let merged: Array<DiscoveredDetailsMerge>;
// The Inventory items copied after a reading answered a refresh.
let mirrored: Array<string>;

function rowTime(value: unknown): Date {
  return new Date(Date.parse(`${String(value).replace(" ", "T")}Z`));
}

// ClickHouse, as the runner asks it: which windows are stored, and where they end.
const findStoredWindows: StoredWindowFinder = async (data: {
  projectId: ObjectID;
  connectionId: ObjectID;
  windows: Array<NetworkTrafficUsageWindowKey>;
}): Promise<Set<string>> => {
  const keys: Set<string> = new Set();

  for (const row of table) {
    if (row["connectionId"] === data.connectionId.toString()) {
      keys.add(
        getWindowKey({
          kind: row["kind"] as NetworkTrafficUsageKind,
          controllerNetworkId: row["controllerNetworkId"] as string,
          windowStartAt: rowTime(row["windowStartAt"]),
        }),
      );
    }
  }

  return keys;
};

const findStoredWindowEnds: StoredWindowEndFinder = async (data: {
  projectId: ObjectID;
  connectionId: ObjectID;
  since: Date;
}) => {
  return NetworkTrafficUsageAggregationService.readStoredWindowEnds(
    table
      .filter((row: JSONObject) => {
        return (
          row["connectionId"] === data.connectionId.toString() &&
          rowTime(row["windowEndAt"]).getTime() > data.since.getTime()
        );
      })
      .map((row: JSONObject) => {
        return {
          usageKind: row["kind"],
          networkKey:
            row["kind"] === NetworkTrafficUsageKind.Uplink
              ? ""
              : row["controllerNetworkId"],
          lastWindowEndMs: String(rowTime(row["windowEndAt"]).getTime()),
        };
      }),
  );
};

function dependencies(
  overrides: Partial<NetworkControllerReadDependencies> = {},
): NetworkControllerReadDependencies {
  return {
    transport: api.transport,
    now: clock.now,
    sleep: clock.sleep,
    isTelemetryAllowed: async () => {
      return true;
    },
    findDevices: async () => {
      return [
        { id: MX_DEVICE, serialNumber: "Q2XX-AAAA-0000", macAddress: "" },
      ];
    },
    findStoredWindows,
    findStoredWindowEnds,
    insertRows: async (rows: Array<JSONObject>) => {
      if (failInsertAfterRows !== null && table.length >= failInsertAfterRows) {
        throw new Error("ClickHouse is not answering");
      }

      table.push(...rows);
    },
    // Postgres, as the device list's details ask it: the project's devices.
    findControllerCandidates: async (data: {
      lookup: ControllerInventoryLookup;
    }): Promise<Array<ControllerInventoryCandidate>> => {
      lookups.push(data.lookup);
      return candidates;
    },
    mergeControllerReadings: async (data: {
      patches: Array<DiscoveredDetailsMerge>;
    }): Promise<number> => {
      merged.push(...data.patches);
      return data.patches.length;
    },
    mirrorRefreshedDevice: async (deviceId: ObjectID): Promise<void> => {
      mirrored.push(deviceId.toString());
    },
    ...overrides,
  };
}

function setApi(options: Partial<FakeMerakiOptions> = {}): void {
  api = createFakeMerakiApi({
    organizations: [
      buildBranchOrganization({ id: "549236", name: "Acme Retail", count: 5 }),
    ],
    now: clock.now,
    ...options,
  });
}

async function run(
  overrides: Partial<NetworkControllerReadDependencies> = {},
): Promise<NetworkControllerReadOutcome> {
  return await NetworkControllerReadRunner.run(
    CONNECTION,
    dependencies(overrides),
  );
}

function lastRecord(): JSONObject {
  expect(recorded.length).toBeGreaterThan(0);
  return recorded[recorded.length - 1]!;
}

function bytesOf(kind: NetworkTrafficUsageKind): number {
  return table
    .filter((row: JSONObject) => {
      return row["kind"] === kind;
    })
    .reduce((total: number, row: JSONObject) => {
      return total + (row["sentOctets"] as number);
    }, 0);
}

beforeEach(() => {
  recorded = [];
  table = [];
  failInsertAfterRows = null;
  failBookkeeping = false;
  candidates = [];
  lookups = [];
  merged = [];
  mirrored = [];
  clock = createTestClock(START);
  setApi();

  connection = new NetworkControllerConnection();
  connection.id = CONNECTION;
  connection.projectId = PROJECT;
  connection.name = "Acme Retail";
  connection.provider = NetworkControllerProvider.Meraki;
  connection.config = {
    region: "global",
    organizationId: "549236",
    organizationName: "",
    readIntervalInMinutes: 5,
  };
  connection.secrets = JSON.stringify({ apiKey: FAKE_API_KEY });
  connection.isEnabled = true;
  connection.pullState = {};

  jest
    .spyOn(NetworkControllerConnectionService, "findOneById")
    .mockImplementation((async () => {
      return connection;
    }) as never);
  jest
    .spyOn(NetworkControllerConnectionService, "updateOneById")
    .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
      if (failBookkeeping) {
        throw new Error("Postgres is not answering");
      }

      recorded.push(data.data);

      // Stored, as Postgres would: the next run reads it back.
      for (const key of ["pullState", "lastPullResult", "config"]) {
        if (data.data[key] !== undefined) {
          (connection as unknown as JSONObject)[key] = JSON.parse(
            JSON.stringify(data.data[key]),
          );
        }
      }
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what is not read", () => {
  test("a connection that is off, or gone, is skipped without a trace", async () => {
    connection.isEnabled = false;
    expect((await run()).status).toBe("skipped");

    jest
      .spyOn(NetworkControllerConnectionService, "findOneById")
      .mockResolvedValue(null);
    expect((await run()).status).toBe("skipped");

    expect(recorded).toEqual([]);
    expect(api.requests).toEqual([]);
  });

  test("a project whose plan has no telemetry is not read, says so, and is asked again tomorrow", async () => {
    const outcome: NetworkControllerReadOutcome = await run({
      isTelemetryAllowed: async () => {
        return false;
      },
    });

    expect(outcome.status).toBe("skipped");
    expect(api.requests).toEqual([]);
    expect(lastRecord()).toEqual({
      lastPulledAt: START,
      lastError:
        "Network traffic from Meraki is not part of this project's plan, or telemetry ingestion is turned off.",
      nextPullAt: new Date(START.getTime() + 24 * 60 * MINUTE),
    });
  });
});

describe("a read that works", () => {
  test("stores the organization's last day, each row given its device, and records what it found", async () => {
    const outcome: NetworkControllerReadOutcome = await run();

    expect(outcome.status).toBe("success");
    expect(table).toHaveLength(34 * 5 * 2 + 5 + 5);

    // The MX that is a device in OneUptime: its uplinks and its network's rows.
    const ofMx: Array<JSONObject> = table.filter((row: JSONObject) => {
      return row["controllerNetworkId"] === "L_1000";
    });
    expect(
      ofMx.every((row: JSONObject) => {
        return row["networkDeviceId"] === MX_DEVICE.toString();
      }),
    ).toBe(true);
    // The rest: the project's bucket.
    expect(
      table
        .filter((row: JSONObject) => {
          return row["controllerNetworkId"] !== "L_1000";
        })
        .every((row: JSONObject) => {
          return row["networkDeviceId"] === PROJECT.toString();
        }),
    ).toBe(true);

    const record: JSONObject = lastRecord();
    expect(record["lastPulledAt"]).toEqual(START);
    expect(record["lastSuccessfulPullAt"]).toEqual(START);
    expect(record["lastError"]).toBeNull();
    expect(record["nextPullAt"]).toEqual(
      new Date(START.getTime() + 5 * MINUTE),
    );
    expect((record["pullState"] as JSONObject)["uplinkCursor"]).toBe(
      "2026-10-24T11:55:00.000Z",
    );
    // The organization's name, kept for the connection's row.
    expect((record["config"] as JSONObject)["organizationName"]).toBe(
      "Acme Retail",
    );

    const summary: NetworkControllerReadSummary = record[
      "lastPullResult"
    ] as unknown as NetworkControllerReadSummary;
    expect(summary).toMatchObject({
      status: "success",
      organizationName: "Acme Retail",
      networkCount: 5,
      applianceCount: 5,
      matchedDeviceCount: 1,
      uplinkWindows: 34,
      newestUplinkAt: "2026-10-24T11:55:00.000Z",
      analyticsNetworks: 5,
      analyticsNetworksWaiting: 0,
      trafficAnalysisOffNetworks: 0,
      rowsWritten: table.length,
      requestCount: 3 + 34 + 10,
      wasRateLimited: false,
      warnings: [],
    });
    expect(outcome.summary).toEqual(summary);
  });

  test("reads one after another add only what is new", async () => {
    await run();
    const afterFirst: number = table.length;

    clock.advance(5 * MINUTE);
    const second: NetworkControllerReadOutcome = await run();

    expect(second.status).toBe("success");
    expect(table.length - afterFirst).toBe(5 * 2);
    expect(second.summary?.rowsWritten).toBe(10);
    expect(second.summary?.requestCount).toBe(3 + 1);
  });

  test("a read cut short by its budget is partial, and the next one comes within a minute", async () => {
    setApi({
      organizations: [
        buildBranchOrganization({
          id: "549236",
          name: "Acme Retail",
          count: 600,
        }),
      ],
    });

    const outcome: NetworkControllerReadOutcome = await run();

    expect(outcome.status).toBe("partial");
    expect(outcome.summary?.requestCount).toBe(
      NETWORK_CONTROLLER_READ_MAX_REQUESTS,
    );
    expect(outcome.summary?.analyticsNetworksWaiting).toBeGreaterThan(0);
    const record: JSONObject = lastRecord();
    expect(record["lastError"]).toBeNull();
    expect((record["nextPullAt"] as Date).getTime() - START.getTime()).toBe(
      MINUTE,
    );
  });

  test("a read slowed by a rate limit carries on no sooner than five minutes", async () => {
    setApi({
      scripted: {
        "/api/v1/networks/L_1002/traffic": Array.from({ length: 4 }, () => {
          return merakiError(429, "API rate limit exceeded", {
            "retry-after": "1",
          });
        }),
      },
    });

    const outcome: NetworkControllerReadOutcome = await run();

    expect(outcome.status).toBe("partial");
    expect(outcome.summary?.wasRateLimited).toBe(true);
    expect(
      (lastRecord()["nextPullAt"] as Date).getTime() - START.getTime(),
    ).toBe(5 * MINUTE);
  });
});

describe("a read that fails", () => {
  test("a refused key: the reason recorded, the cursors kept, asked again in an hour", async () => {
    connection.pullState = { uplinkCursor: "2026-10-24T11:00:00.000Z" };
    connection.lastPullResult = {
      status: "success",
      organizationName: "Acme Retail",
      networkCount: 5,
      applianceCount: 5,
      newestUplinkAt: "2026-10-24T11:00:00.000Z",
    };
    setApi({ apiKey: "the-key-meraki-has-now-0123456789abcdef" });

    const outcome: NetworkControllerReadOutcome = await run();

    expect(outcome.status).toBe("failed");
    const record: JSONObject = lastRecord();
    expect(record["lastError"]).toBe(
      "Meraki answered the organization with HTTP 401: Invalid API key",
    );
    expect(record["pullState"]).toBeUndefined();
    expect(record["lastSuccessfulPullAt"]).toBeUndefined();
    expect((record["nextPullAt"] as Date).getTime() - START.getTime()).toBe(
      60 * MINUTE,
    );
    expect(record["lastPullResult"]).toMatchObject({
      status: "failed",
      failureKind: LlmConnectionFailureKind.Authentication,
      organizationName: "Acme Retail",
      networkCount: 5,
      newestUplinkAt: "2026-10-24T11:00:00.000Z",
      rowsWritten: 0,
    });
    expect(table).toEqual([]);
  });

  test("Meraki down: retried on the connection's schedule, at least a quarter of an hour on", async () => {
    setApi({
      scripted: {
        "/api/v1/organizations/549236": [
          merakiError(503, "down"),
          merakiError(503, "down"),
          merakiError(503, "down"),
        ],
      },
    });

    const outcome: NetworkControllerReadOutcome = await run();

    expect(outcome.status).toBe("failed");
    expect(lastRecord()["lastPullResult"]).toMatchObject({
      failureKind: LlmConnectionFailureKind.Unavailable,
    });
    expect(
      (lastRecord()["nextPullAt"] as Date).getTime() - START.getTime(),
    ).toBe(15 * MINUTE);
  });

  test("the error recorded never holds the key, whatever Meraki echoed", async () => {
    setApi({
      scripted: {
        "/api/v1/organizations/549236": [
          merakiError(400, `Bad key ${FAKE_API_KEY}`),
        ],
      },
    });

    await run();

    expect(JSON.stringify(recorded)).not.toContain(FAKE_API_KEY);
    expect(lastRecord()["lastError"]).toContain("[REDACTED]");
  });

  test("a recording that fails never escapes the run", async () => {
    failBookkeeping = true;

    await expect(run()).resolves.toMatchObject({ status: "success" });
  });
});

describe("no window written twice", () => {
  test("rows stored but the cursor not recorded: the next read reads on from the stored rows", async () => {
    failBookkeeping = true;
    await run();
    const stored: number = table.length;
    const uplinkBytes: number = bytesOf(NetworkTrafficUsageKind.Uplink);
    const applicationBytes: number = bytesOf(
      NetworkTrafficUsageKind.Application,
    );
    expect(connection.pullState).toEqual({});

    failBookkeeping = false;
    clock.advance(5 * MINUTE);
    const outcome: NetworkControllerReadOutcome = await run();

    expect(outcome.status).toBe("success");
    // One new uplink window, and nothing of the day before again.
    expect(table.length - stored).toBe(5 * 2);
    expect(bytesOf(NetworkTrafficUsageKind.Application)).toBe(applicationBytes);
    expect(bytesOf(NetworkTrafficUsageKind.Uplink) - uplinkBytes).toBe(
      5 * 10100 * 300,
    );
  });

  test("an insert that fails part way: the next read writes exactly what is missing", async () => {
    // 300 MXs on two uplinks: 600 rows a window, eight windows an insert.
    setApi({
      organizations: [
        buildBranchOrganization({
          id: "549236",
          name: "Acme Retail",
          count: 300,
        }),
      ],
    });
    failInsertAfterRows = 1;
    const failed: NetworkControllerReadOutcome = await run();

    expect(failed.status).toBe("failed");
    expect(lastRecord()["lastError"]).toBe(
      "Meraki read did not complete: ClickHouse is not answering",
    );
    expect(table).toHaveLength(8 * 600);

    failInsertAfterRows = null;
    clock.advance(MINUTE);
    const outcome: NetworkControllerReadOutcome = await run();

    expect(outcome.status).toBe("success");
    expect(outcome.summary?.uplinkWindows).toBe(34 - 8);

    // Every uplink window of the day once: 34 windows of 300 MXs on two uplinks.
    const uplinkRows: Map<string, number> = new Map();
    for (const row of table) {
      if (row["kind"] === NetworkTrafficUsageKind.Uplink) {
        const key: string = `${String(row["windowStartAt"])}|${String(row["deviceSerial"])}|${String(row["interfaceName"])}`;
        uplinkRows.set(key, (uplinkRows.get(key) || 0) + 1);
      }
    }
    expect(uplinkRows.size).toBe(34 * 300 * 2);
    expect(
      Array.from(uplinkRows.values()).every((count: number) => {
        return count === 1;
      }),
    ).toBe(true);
    expect(bytesOf(NetworkTrafficUsageKind.Uplink)).toBe(
      300 * 10100 * (23 * 60 + 55) * 60,
    );

    // Each network's applications and clients once.
    for (const kind of [
      NetworkTrafficUsageKind.Application,
      NetworkTrafficUsageKind.Client,
    ]) {
      const networks: Array<unknown> = table
        .filter((row: JSONObject) => {
          return row["kind"] === kind;
        })
        .map((row: JSONObject) => {
          return row["controllerNetworkId"];
        });
      expect(networks).toHaveLength(300);
      expect(new Set(networks).size).toBe(300);
    }
  });
});

describe("moving the cursors up to the stored windows", () => {
  test("a stored window past a cursor moves it; a cursor already past is kept", () => {
    expect(
      reconcilePullState(
        {
          uplinkCursor: "2026-10-24T11:00:00.000Z",
          analyticsCursors: {
            L_1: "2026-10-24T10:00:00.000Z",
            L_2: "2026-10-24T11:30:00.000Z",
          },
          trafficAnalysisOff: { L_3: "2026-10-24T09:00:00.000Z" },
        },
        {
          uplinkEnd: new Date("2026-10-24T11:55:00.000Z"),
          analyticsEnds: new Map([
            ["L_1", new Date("2026-10-24T11:00:00.000Z")],
            ["L_2", new Date("2026-10-24T11:00:00.000Z")],
            ["L_4", new Date("2026-10-24T08:00:00.000Z")],
          ]),
        },
      ),
    ).toEqual({
      uplinkCursor: "2026-10-24T11:55:00.000Z",
      analyticsCursors: {
        L_1: "2026-10-24T11:00:00.000Z",
        L_2: "2026-10-24T11:30:00.000Z",
        L_4: "2026-10-24T08:00:00.000Z",
      },
      trafficAnalysisOff: { L_3: "2026-10-24T09:00:00.000Z" },
    });
  });

  test("nothing stored: the state as it was", () => {
    expect(
      reconcilePullState(
        { uplinkCursor: "2026-10-24T11:00:00.000Z" },
        { uplinkEnd: null, analyticsEnds: new Map() },
      ),
    ).toEqual({
      uplinkCursor: "2026-10-24T11:00:00.000Z",
      analyticsCursors: {},
    });
  });

  test("a cursor that is not a time gives way to the stored end", () => {
    expect(
      reconcilePullState(
        { uplinkCursor: "soon" },
        {
          uplinkEnd: new Date("2026-10-24T11:55:00.000Z"),
          analyticsEnds: new Map(),
        },
      ).uplinkCursor,
    ).toBe("2026-10-24T11:55:00.000Z");
  });

  test("the stored ends are looked for over the day a read can go back, and an hour more", async () => {
    let since: Date | undefined;

    await run({
      findStoredWindowEnds: async (data: { since: Date }) => {
        since = data.since;
        return { uplinkEnd: null, analyticsEnds: new Map() };
      },
    });

    expect(since?.getTime()).toBe(
      START.getTime() - STORED_WINDOW_END_LOOKBACK_MS,
    );
    expect(STORED_WINDOW_END_LOOKBACK_MS).toBe(25 * 60 * MINUTE);
  });
});

describe("the devices' details the device list fills in", () => {
  const SWITCH_DEVICE: string = "44444444-4444-4444-8444-444444444444";

  function withSwitchesAndAccessPoints(): void {
    const organization: ReturnType<typeof buildBranchOrganization> =
      buildBranchOrganization({ id: "549236", name: "Acme Retail", count: 5 });

    organization.devices = [
      {
        serial: "Q2HP-SWCH-0001",
        name: "Branch 1 core",
        model: "MS225-48LP",
        mac: "88:15:44:aa:00:01",
        networkId: "L_1000",
        productType: "switch",
        lanIp: "10.0.0.2",
        firmware: "switch-16-7",
        address: "1 Main Street, Springfield",
      },
      {
        serial: "Q2KD-WLAN-0001",
        name: "Branch 1 lobby AP",
        model: "MR46",
        mac: "e0:55:3d:aa:00:01",
        networkId: "L_1000",
        productType: "wireless",
        lanIp: "10.0.0.20",
        firmware: "wireless-29-7",
      },
    ];

    setApi({ organizations: [organization] });
  }

  test("a read records what Meraki says about the project's devices that are Meraki devices, and counts them", async () => {
    withSwitchesAndAccessPoints();
    candidates = [
      // The MX: its serial number is the appliance's.
      {
        id: MX_DEVICE.toString(),
        name: "branch-1-mx",
        hostname: "10.0.0.1",
        serialNumber: "q2xx-aaaa-0000",
      },
      // The switch, pinged at its management address and called the same.
      {
        id: SWITCH_DEVICE,
        name: "Branch 1 core",
        hostname: "10.0.0.2",
      },
    ];

    const outcome: NetworkControllerReadOutcome = await run();

    expect(outcome.status).toBe("success");
    // Every device's serial number, MAC and management address is looked up.
    expect(lookups).toHaveLength(1);
    expect(lookups[0]!.serials).toEqual(
      expect.arrayContaining([
        "Q2XX-AAAA-0000",
        "Q2HP-SWCH-0001",
        "Q2KD-WLAN-0001",
      ]),
    );
    expect(lookups[0]!.addresses).toEqual(["10.0.0.2", "10.0.0.20"]);

    expect(
      merged.map((patch: DiscoveredDetailsMerge): string => {
        return patch.deviceId.toString();
      }),
    ).toEqual([MX_DEVICE.toString(), SWITCH_DEVICE]);

    const switchReading: JSONObject = (merged[1]!.set as JSONObject)[
      "controller"
    ] as JSONObject;
    expect(switchReading).toEqual({
      provider: "meraki",
      readBy: {
        type: "networkController",
        id: CONNECTION.toString(),
        name: "Acme Retail",
      },
      readAt: START.toISOString(),
      values: {
        name: "Branch 1 core",
        model: "MS225-48LP",
        serialNumber: "Q2HP-SWCH-0001",
        macAddress: "88:15:44:aa:00:01",
        ipAddress: "10.0.0.2",
        firmwareVersion: "switch-16-7",
        productType: "switch",
        networkName: "Branch 1",
        address: "1 Main Street, Springfield",
      },
    });

    expect(outcome.summary).toMatchObject({
      deviceCount: 7,
      describedDeviceCount: 2,
      // The traffic side is what it was: five appliances, one a device here.
      applianceCount: 5,
      matchedDeviceCount: 1,
      warnings: [],
    });
    // The device list is the read's third call, as the appliance list was.
    expect(outcome.summary?.requestCount).toBe(3 + 34 + 10);
  });

  test("a device list that cannot be recorded is a warning on a read that otherwise worked", async () => {
    withSwitchesAndAccessPoints();

    const outcome: NetworkControllerReadOutcome = await run({
      findControllerCandidates: async () => {
        throw new Error("Postgres is not answering");
      },
    });

    expect(outcome.status).toBe("success");
    expect(table.length).toBeGreaterThan(0);
    expect(outcome.summary?.warnings).toEqual([INVENTORY_NOT_RECORDED_WARNING]);
    // Nothing to count it by: no counts rather than made-up ones.
    expect(outcome.summary?.deviceCount).toBeUndefined();
  });

  test("an unchanged reading is written again only after an hour, or when someone asks for the device to be read again", async () => {
    withSwitchesAndAccessPoints();
    candidates = [
      { id: SWITCH_DEVICE, name: "Branch 1 core", hostname: "10.0.0.2" },
    ];

    await run();
    expect(merged).toHaveLength(1);

    // Stored, as Postgres would.
    candidates = [
      {
        ...candidates[0]!,
        discoveredDetails: merged[0]!.set,
      },
    ];
    merged = [];

    clock.advance(5 * MINUTE);
    await run();
    expect(merged).toEqual([]);

    // Nobody asked: no item is copied out of turn.
    expect(mirrored).toEqual([]);

    // Someone asks for it to be read again: written at once.
    candidates[0]!.refreshRequestedAt = new Date(
      clock.now().getTime() - MINUTE,
    );
    clock.advance(MINUTE);
    await run();
    expect(merged).toHaveLength(1);
    // And its Inventory item copied with it, as its probe's poll copies it.
    expect(mirrored).toEqual([SWITCH_DEVICE]);

    // And an hour on, whatever happens, so its time stays true.
    candidates = [
      {
        id: SWITCH_DEVICE,
        name: "Branch 1 core",
        hostname: "10.0.0.2",
        discoveredDetails: merged[0]!.set,
      },
    ];
    merged = [];
    clock.advance(30 * MINUTE);
    await run();
    expect(merged).toEqual([]);
    clock.advance(31 * MINUTE);
    await run();
    expect(merged).toHaveLength(1);
  });

  test("a failed read keeps the last counts", async () => {
    connection.lastPullResult = {
      status: "success",
      organizationName: "Acme Retail",
      networkCount: 5,
      applianceCount: 5,
      deviceCount: 7,
      describedDeviceCount: 2,
    };
    setApi({ apiKey: "the-key-meraki-has-now-0123456789abcdef" });

    const outcome: NetworkControllerReadOutcome = await run();

    expect(outcome.status).toBe("failed");
    expect(outcome.summary).toMatchObject({
      deviceCount: 7,
      describedDeviceCount: 2,
    });
    expect(lookups).toEqual([]);
  });
});

describe("when the next read comes", () => {
  test.each([
    ["success", undefined, false, 5],
    ["partial", undefined, false, 1],
    ["partial", undefined, true, 5],
    ["failed", LlmConnectionFailureKind.Unavailable, false, 15],
    ["failed", LlmConnectionFailureKind.Authentication, false, 60],
    ["failed", LlmConnectionFailureKind.Permission, false, 60],
  ])(
    "%s (%s, rate limited: %s): in %i minutes",
    (
      outcome: string,
      failureKind: LlmConnectionFailureKind | undefined,
      wasRateLimited: boolean,
      minutes: number,
    ) => {
      expect(
        NetworkControllerReadRunner.nextPullAt({
          now: START,
          intervalInMinutes: 5,
          outcome: outcome as "success" | "partial" | "failed",
          failureKind,
          wasRateLimited,
        }).getTime() - START.getTime(),
      ).toBe(minutes * MINUTE);
    },
  );

  test("an hourly connection that fails waits its hour", () => {
    expect(
      NetworkControllerReadRunner.nextPullAt({
        now: START,
        intervalInMinutes: 60,
        outcome: "failed",
        failureKind: LlmConnectionFailureKind.Unavailable,
      }).getTime() - START.getTime(),
    ).toBe(60 * MINUTE);
  });
});
