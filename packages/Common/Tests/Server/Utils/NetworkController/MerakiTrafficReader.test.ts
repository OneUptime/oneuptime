import MerakiTrafficReader, {
  ANALYTICS_GAP_WARNING,
  ANALYTICS_WINDOW_MS,
  BACKFILL_MS,
  NO_APPLIANCE_WARNING,
  RATE_LIMITED_WARNING,
  STOPPED_ANSWERING_WARNING,
  getAnalyticsStart,
  isTrafficAnalysisOff,
  planUplinkWindows,
  readNetworks,
} from "../../../../Server/Utils/NetworkController/Meraki/MerakiTrafficReader";
import { MERAKI_REQUESTS_PER_SECOND } from "../../../../Server/Utils/NetworkController/Meraki/MerakiApiClient";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import {
  NetworkControllerPullState,
  NetworkControllerReadOptions,
  NetworkControllerReadResult,
  NetworkControllerSettings,
  NetworkTrafficUsageRecord,
  NetworkTrafficUsageWindowKey,
} from "../../../../Server/Utils/NetworkController/NetworkControllerTypes";
import {
  getRecordWindowKey,
  getWindowKey,
} from "../../../../Server/Utils/NetworkController/NetworkTrafficUsageRows";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import { MerakiRegion } from "../../../../Types/NetworkController/MerakiRegion";
import NetworkControllerProvider from "../../../../Types/NetworkController/NetworkControllerProvider";
import { NetworkTrafficUsageKind } from "../../../../Types/NetFlow/NetworkTrafficUsage";
import {
  FAKE_API_KEY,
  FakeMerakiApi,
  FakeMerakiOptions,
  FakeMerakiOrganization,
  FakeMerakiRequest,
  TestClock,
  buildBranchOrganization,
  createFakeMerakiApi,
  createTestClock,
  merakiError,
} from "./FakeMerakiApi";
import { describe, expect, test } from "@jest/globals";

/*
 * One read of one Meraki organization, against a faithful fake of the
 * dashboard API on a test clock: what it asks for (the organization's
 * uplinks in one call a window, each network's applications and clients
 * every two hours), what it keeps (records whose windows it says it
 * covered, so the runner never writes one twice), where it gets to (the
 * cursors the next read carries on from), and what it does when Meraki
 * will not answer - a network skipped, a read stopped with what it read
 * kept, or the read failed - always with a warning that says so.
 */

const START: Date = new Date("2026-10-24T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const UPLINKS: string =
  "/api/v1/organizations/549236/appliance/uplinks/usage/byNetwork";

interface Env {
  clock: TestClock;
  api: FakeMerakiApi;
  state: NetworkControllerPullState;
}

function environment(
  options: Partial<FakeMerakiOptions> = {},
  count: number = 5,
): Env {
  const clock: TestClock = createTestClock(START);
  const api: FakeMerakiApi = createFakeMerakiApi({
    organizations: [
      buildBranchOrganization({ id: "549236", name: "Acme Retail", count }),
    ],
    now: clock.now,
    ...options,
  });

  return { clock, api, state: {} };
}

function settingsFor(
  organizationId: string = "549236",
  region: MerakiRegion = MerakiRegion.Global,
): NetworkControllerSettings {
  return {
    provider: NetworkControllerProvider.Meraki,
    projectId: "5b1c3e0e-7b3a-4c56-9a8e-2f6f0c1d9e11",
    config: {
      region,
      organizationId,
      organizationName: "",
      readIntervalInMinutes: 5,
    },
    apiKey: FAKE_API_KEY,
  };
}

// One read; the state it ends with is the next read's.
async function readOnce(
  env: Env,
  overrides: Partial<NetworkControllerReadOptions> = {},
  settings: NetworkControllerSettings = settingsFor(),
): Promise<NetworkControllerReadResult> {
  const result: NetworkControllerReadResult = await MerakiTrafficReader.read(
    settings,
    {
      transport: env.api.transport,
      now: env.clock.now,
      sleep: env.clock.sleep,
      state: env.state,
      maxRequests: 900,
      maxDurationMs: 6 * MINUTE,
      ...overrides,
    },
  );

  env.state = result.nextState;
  return result;
}

function moveClockTo(clock: TestClock, time: Date): void {
  clock.advance(time.getTime() - clock.now().getTime());
}

function ofKind(
  records: Array<NetworkTrafficUsageRecord>,
  kind: NetworkTrafficUsageKind,
): Array<NetworkTrafficUsageRecord> {
  return records.filter((record: NetworkTrafficUsageRecord) => {
    return record.kind === kind;
  });
}

function trafficCalls(
  api: FakeMerakiApi,
  networkId: string,
): Array<FakeMerakiRequest> {
  return api.callsTo(`/api/v1/networks/${networkId}/traffic`);
}

// Every record belongs to a window the read says it covered.
function expectRecordsInWindows(result: NetworkControllerReadResult): void {
  const keys: Set<string> = new Set(
    result.windows.map((window: NetworkTrafficUsageWindowKey) => {
      return getWindowKey(window);
    }),
  );

  for (const record of result.records) {
    expect(keys.has(getRecordWindowKey(record))).toBe(true);
  }
}

function expectPaced(api: FakeMerakiApi): void {
  for (let index: number = 1; index < api.requests.length; index++) {
    expect(
      api.requests[index]!.atMs - api.requests[index - 1]!.atMs,
    ).toBeGreaterThanOrEqual(Math.floor(1000 / MERAKI_REQUESTS_PER_SECOND));
  }
}

describe("planning the uplink windows", () => {
  test("a first read goes a day back: hour windows, then five-minute ones up to five minutes ago", () => {
    const plan: ReturnType<typeof planUplinkWindows> = planUplinkWindows({
      cursor: undefined,
      now: START,
    });

    expect(plan.gapFrom).toBeNull();
    expect(plan.windows).toHaveLength(23 + 11);
    expect(plan.windows[0]!.start.toISOString()).toBe(
      "2026-10-23T12:00:00.000Z",
    );
    expect(plan.windows[0]!.end.toISOString()).toBe("2026-10-23T13:00:00.000Z");
    expect(plan.windows[23]!.start.toISOString()).toBe(
      "2026-10-24T11:00:00.000Z",
    );
    expect(plan.windows[23]!.end.toISOString()).toBe(
      "2026-10-24T11:05:00.000Z",
    );
    expect(plan.windows[33]!.end.toISOString()).toBe(
      "2026-10-24T11:55:00.000Z",
    );

    for (let index: number = 1; index < plan.windows.length; index++) {
      expect(plan.windows[index]!.start.getTime()).toBe(
        plan.windows[index - 1]!.end.getTime(),
      );
    }
  });

  test("an incremental read starts where the last window ended", () => {
    expect(
      planUplinkWindows({
        cursor: "2026-10-24T11:55:00.000Z",
        now: START,
      }).windows,
    ).toEqual([]);

    expect(
      planUplinkWindows({
        cursor: "2026-10-24T11:55:00.000Z",
        now: new Date("2026-10-24T12:07:30.000Z"),
      }).windows.map((window: { start: Date; end: Date }) => {
        return [window.start.toISOString(), window.end.toISOString()];
      }),
    ).toEqual([["2026-10-24T11:55:00.000Z", "2026-10-24T12:00:00.000Z"]]);
  });

  test("windows are aligned to their own length", () => {
    const plan: ReturnType<typeof planUplinkWindows> = planUplinkWindows({
      cursor: "2026-10-24T09:20:00.000Z",
      now: START,
    });

    // 09:20-10:00 in fives, 10:00-11:00 whole, 11:00-11:55 in fives.
    expect(plan.windows).toHaveLength(8 + 1 + 11);
    expect(plan.windows[8]!.start.toISOString()).toBe(
      "2026-10-24T10:00:00.000Z",
    );
    expect(plan.windows[8]!.end.toISOString()).toBe("2026-10-24T11:00:00.000Z");
  });

  test("after a long pause the read goes a day back and says where the gap starts", () => {
    const plan: ReturnType<typeof planUplinkWindows> = planUplinkWindows({
      cursor: "2026-10-21T08:00:00.000Z",
      now: START,
    });

    expect(plan.gapFrom?.toISOString()).toBe("2026-10-21T08:00:00.000Z");
    expect(plan.windows[0]!.start.toISOString()).toBe(
      "2026-10-23T12:00:00.000Z",
    );
  });

  test("a cursor that is not a time reads as a first read; one in the future reads nothing", () => {
    expect(
      planUplinkWindows({ cursor: "yesterday", now: START }).windows,
    ).toHaveLength(34);
    expect(
      planUplinkWindows({ cursor: "2026-10-25T00:00:00.000Z", now: START })
        .windows,
    ).toEqual([]);
  });
});

describe("when a network's applications and clients are due", () => {
  test("a first window reads the last day", () => {
    expect(getAnalyticsStart({ cursor: undefined, now: START })).toEqual({
      start: new Date(START.getTime() - BACKFILL_MS),
      isDue: true,
      hadGap: false,
    });
  });

  test("two hours after the last one ended, not before", () => {
    expect(
      getAnalyticsStart({
        cursor: new Date(
          START.getTime() - ANALYTICS_WINDOW_MS + 1,
        ).toISOString(),
        now: START,
      }).isDue,
    ).toBe(false);
    expect(
      getAnalyticsStart({
        cursor: new Date(START.getTime() - ANALYTICS_WINDOW_MS).toISOString(),
        now: START,
      }),
    ).toEqual({
      start: new Date(START.getTime() - ANALYTICS_WINDOW_MS),
      isDue: true,
      hadGap: false,
    });
  });

  test("more than a day behind: a day back, and a gap said", () => {
    expect(
      getAnalyticsStart({ cursor: "2026-10-20T00:00:00.000Z", now: START }),
    ).toEqual({
      start: new Date(START.getTime() - BACKFILL_MS),
      isDue: true,
      hadGap: true,
    });
  });
});

describe("reading Meraki's answers about networks", () => {
  test("networks with what they carry; cameras and sensors alone carry no traffic", () => {
    expect(
      readNetworks([
        { id: "L_1", name: "Branch 1", productTypes: ["appliance", "switch"] },
        { id: "L_2", name: "Cameras", productTypes: ["camera", "sensor"] },
        { id: "L_3", name: "Old" },
        { id: "L_1", name: "Repeat" },
        { name: "No ID" },
        "L_4",
      ]),
    ).toEqual([
      { id: "L_1", name: "Branch 1", hasTraffic: true },
      { id: "L_2", name: "Cameras", hasTraffic: false },
      { id: "L_3", name: "Old", hasTraffic: true },
    ]);
  });

  test("traffic analysis turned off is told apart from other failures", () => {
    const off: LlmProviderError = new LlmProviderError({
      message:
        'Meraki answered the traffic analytics of network "Branch 1" with HTTP 400: Traffic Analysis with Hostname Visibility must be enabled on the network',
      kind: LlmConnectionFailureKind.Other,
      statusCode: 400,
    });
    const forbidden: LlmProviderError = new LlmProviderError({
      message: "Meraki answered with HTTP 403",
      kind: LlmConnectionFailureKind.Permission,
      statusCode: 403,
      responseBody: "Traffic analysis is not available",
    });
    const down: LlmProviderError = new LlmProviderError({
      message: "traffic analysis: HTTP 503",
      kind: LlmConnectionFailureKind.Unavailable,
      statusCode: 503,
    });
    const other: LlmProviderError = new LlmProviderError({
      message: "Meraki answered with HTTP 400: Invalid t0",
      kind: LlmConnectionFailureKind.Other,
      statusCode: 400,
    });

    expect(isTrafficAnalysisOff(off)).toBe(true);
    expect(isTrafficAnalysisOff(forbidden)).toBe(true);
    expect(isTrafficAnalysisOff(down)).toBe(false);
    expect(isTrafficAnalysisOff(other)).toBe(false);
    expect(isTrafficAnalysisOff(new Error("traffic analysis"))).toBe(false);
  });
});

describe("a first read", () => {
  test("reads the organization's last day: uplinks in one call a window, each network's applications and clients once", async () => {
    const env: Env = environment();
    const result: NetworkControllerReadResult = await readOnce(env);

    expect(result.organizationName).toBe("Acme Retail");
    expect(result.networkCount).toBe(5);
    expect(result.appliances).toHaveLength(5);
    expect(result.complete).toBe(true);
    expect(result.warnings).toEqual([]);

    // 3 listings, 34 uplink windows, 2 calls for each of 5 networks.
    expect(result.requestCount).toBe(3 + 34 + 10);
    expect(env.api.requests).toHaveLength(result.requestCount);
    expect(env.api.callsTo(UPLINKS)).toHaveLength(34);
    expect(result.uplinkWindows).toBe(34);
    expect(result.newestUplinkAt?.toISOString()).toBe(
      "2026-10-24T11:55:00.000Z",
    );
    expect(result.analyticsNetworks).toBe(5);
    expect(result.analyticsNetworksWaiting).toBe(0);
    expect(result.wasRateLimited).toBe(false);

    // Five appliances on two uplinks each, every window.
    const uplinks: Array<NetworkTrafficUsageRecord> = ofKind(
      result.records,
      NetworkTrafficUsageKind.Uplink,
    );
    expect(uplinks).toHaveLength(34 * 5 * 2);

    const seconds: number = (23 * 60 + 55) * 60;
    expect(
      uplinks.reduce((total: number, record: NetworkTrafficUsageRecord) => {
        return total + record.sentOctets;
      }, 0),
    ).toBe(5 * (10000 + 100) * seconds);
    expect(
      uplinks.reduce((total: number, record: NetworkTrafficUsageRecord) => {
        return total + record.receivedOctets;
      }, 0),
    ).toBe(5 * (50000 + 200) * seconds);

    expect(uplinks[0]).toMatchObject({
      controllerNetworkId: "L_1000",
      controllerNetworkName: "Branch 1",
      deviceSerial: "Q2XX-AAAA-0000",
      deviceName: "MX 1",
      interfaceName: "wan1",
    });

    expect(
      ofKind(result.records, NetworkTrafficUsageKind.Application),
    ).toHaveLength(5);
    expect(ofKind(result.records, NetworkTrafficUsageKind.Client)).toHaveLength(
      5,
    );

    // The state: uplinks to five minutes ago, each network to when it was read.
    expect(result.nextState.uplinkCursor).toBe("2026-10-24T11:55:00.000Z");
    expect(Object.keys(result.nextState.analyticsCursors || {}).sort()).toEqual(
      ["L_1000", "L_1001", "L_1002", "L_1003", "L_1004"],
    );

    expectRecordsInWindows(result);
    expectPaced(env.api);
  });

  test("an application window holds what Meraki counted since it started, in bytes", async () => {
    const env: Env = environment();
    const result: NetworkControllerReadResult = await readOnce(env);

    const call: FakeMerakiRequest = trafficCalls(env.api, "L_1002")[0]!;
    expect(call.url.searchParams.get("t0")).toBe("2026-10-23T12:00:00.000Z");
    expect(call.url.searchParams.get("timespan")).toBeNull();

    const seconds: number =
      (call.atMs - new Date("2026-10-23T12:00:00.000Z").getTime()) / 1000;
    const teams: NetworkTrafficUsageRecord = ofKind(
      result.records,
      NetworkTrafficUsageKind.Application,
    ).find((record: NetworkTrafficUsageRecord) => {
      return record.controllerNetworkId === "L_1002";
    })!;

    expect(teams).toMatchObject({
      application: "Microsoft Teams",
      destination: "teams.microsoft.com",
      protocol: "UDP",
      port: 3478,
      clients: 12,
      windowStartAt: new Date("2026-10-23T12:00:00.000Z"),
    });
    expect(Math.abs(teams.sentOctets - 1000 * seconds)).toBeLessThanOrEqual(1);
    expect(Math.abs(teams.receivedOctets - 3000 * seconds)).toBeLessThanOrEqual(
      1,
    );
    expect(teams.windowEndAt.getTime()).toBeLessThanOrEqual(call.atMs);
    expect(env.state.analyticsCursors?.["L_1002"]).toBe(
      teams.windowEndAt.toISOString(),
    );
  });

  test("the key goes to the region's API host only", async () => {
    const env: Env = environment({ apiHost: "api.meraki.ca" });

    await readOnce(env, {}, settingsFor("549236", MerakiRegion.Canada));

    expect(
      new Set(
        env.api.requests.map((request: FakeMerakiRequest) => {
          return request.url.hostname;
        }),
      ),
    ).toEqual(new Set(["api.meraki.ca"]));
  });
});

describe("the reads after it", () => {
  test("five minutes later: one uplink window, no network is due", async () => {
    const env: Env = environment();
    await readOnce(env);
    const before: number = env.api.requests.length;

    moveClockTo(env.clock, new Date("2026-10-24T12:05:00.000Z"));
    const result: NetworkControllerReadResult = await readOnce(env);

    expect(env.api.requests.length - before).toBe(3 + 1);
    expect(result.uplinkWindows).toBe(1);
    expect(result.analyticsNetworks).toBe(0);
    expect(result.analyticsNetworksWaiting).toBe(0);
    expect(result.complete).toBe(true);
    expect(ofKind(result.records, NetworkTrafficUsageKind.Uplink)).toHaveLength(
      10,
    );
    expect(result.nextState.uplinkCursor).toBe("2026-10-24T12:00:00.000Z");
  });

  test("no uplink window is asked for twice, and none is skipped", async () => {
    const env: Env = environment();

    for (const time of [
      "2026-10-24T12:00:00.000Z",
      "2026-10-24T12:05:00.000Z",
      "2026-10-24T12:20:00.000Z",
      "2026-10-24T14:01:00.000Z",
    ]) {
      if (env.clock.now().getTime() < Date.parse(time)) {
        moveClockTo(env.clock, new Date(time));
      }
      await readOnce(env);
    }

    const windows: Array<[number, number]> = env.api
      .callsTo(UPLINKS)
      .map((request: FakeMerakiRequest): [number, number] => {
        return [
          Date.parse(request.url.searchParams.get("t0")!),
          Date.parse(request.url.searchParams.get("t1")!),
        ];
      });

    expect(windows[0]![0]).toBe(Date.parse("2026-10-23T12:00:00.000Z"));
    for (let index: number = 1; index < windows.length; index++) {
      expect(windows[index]![0]).toBe(windows[index - 1]![1]);
    }
    expect(windows[windows.length - 1]![1]).toBe(
      Date.parse("2026-10-24T13:55:00.000Z"),
    );
  });

  test("two hours on, each network's next window starts where its last one ended", async () => {
    const env: Env = environment();
    const first: NetworkControllerReadResult = await readOnce(env);

    moveClockTo(
      env.clock,
      new Date(START.getTime() + ANALYTICS_WINDOW_MS + MINUTE),
    );
    const second: NetworkControllerReadResult = await readOnce(env);

    expect(second.analyticsNetworks).toBe(5);

    for (const networkId of ["L_1000", "L_1004"]) {
      const calls: Array<FakeMerakiRequest> = trafficCalls(env.api, networkId);
      expect(calls).toHaveLength(2);
      expect(calls[1]!.url.searchParams.get("t0")).toBe(
        first.nextState.analyticsCursors?.[networkId],
      );
      expect(
        env.api
          .callsTo(`/api/v1/networks/${networkId}/clients`)[1]!
          .url.searchParams.get("t0"),
      ).toBe(first.nextState.analyticsCursors?.[networkId]);
    }

    expectRecordsInWindows(second);
  });
});

describe("traffic analysis turned off on a network", () => {
  function organizationWithAnalysisOff(): FakeMerakiOrganization {
    const organization: FakeMerakiOrganization = buildBranchOrganization({
      id: "549236",
      name: "Acme Retail",
      count: 3,
    });
    organization.networks[1]!.isTrafficAnalysisOff = true;
    return organization;
  }

  test("its clients are still read, it is said once, and it is not asked again for a day", async () => {
    const env: Env = environment({
      organizations: [organizationWithAnalysisOff()],
    });

    const first: NetworkControllerReadResult = await readOnce(env);

    expect(first.trafficAnalysisOffNetworks).toBe(1);
    expect(first.analyticsNetworks).toBe(3);
    expect(first.complete).toBe(true);
    expect(first.warnings).toEqual([
      "Traffic analysis is off on 1 network, so Meraki keeps no applications for it. Turn it on in the Meraki dashboard under Network-wide > General > Traffic analysis.",
    ]);
    expect(
      first.records
        .filter((record: NetworkTrafficUsageRecord) => {
          return (
            record.controllerNetworkId === "L_1001" &&
            record.kind !== NetworkTrafficUsageKind.Uplink
          );
        })
        .map((record: NetworkTrafficUsageRecord) => {
          return record.kind;
        }),
    ).toEqual([NetworkTrafficUsageKind.Client]);
    expect(first.nextState.trafficAnalysisOff?.["L_1001"]).toBe(
      START.toISOString(),
    );

    // Two hours on: its clients are read, its applications are not asked for.
    moveClockTo(env.clock, new Date(START.getTime() + 2 * HOUR + MINUTE));
    const second: NetworkControllerReadResult = await readOnce(env);
    expect(second.analyticsNetworks).toBe(3);
    expect(trafficCalls(env.api, "L_1001")).toHaveLength(1);
    expect(trafficCalls(env.api, "L_1000")).toHaveLength(2);
    expect(second.trafficAnalysisOffNetworks).toBe(1);

    // A day on, asked again: turned on since, it is forgotten.
    env.api.options.organizations[0]!.networks[1]!.isTrafficAnalysisOff = false;
    moveClockTo(env.clock, new Date(START.getTime() + 24 * HOUR + MINUTE));
    const third: NetworkControllerReadResult = await readOnce(env);
    expect(trafficCalls(env.api, "L_1001")).toHaveLength(2);
    expect(third.trafficAnalysisOffNetworks).toBe(0);
    expect(third.nextState.trafficAnalysisOff?.["L_1001"]).toBeUndefined();
    expect(
      ofKind(third.records, NetworkTrafficUsageKind.Application).some(
        (record: NetworkTrafficUsageRecord) => {
          return record.controllerNetworkId === "L_1001";
        },
      ),
    ).toBe(true);
  });
});

describe("when Meraki does not answer", () => {
  test("a network that fails is skipped with a warning, keeps nothing of the window, and is asked again", async () => {
    const env: Env = environment({
      scripted: {
        "/api/v1/networks/L_1001/clients": [merakiError(400, "Invalid t0")],
      },
    });

    const first: NetworkControllerReadResult = await readOnce(env);

    expect(first.analyticsNetworks).toBe(4);
    expect(first.analyticsNetworksWaiting).toBe(1);
    expect(first.complete).toBe(false);
    expect(first.warnings).toEqual([
      'Couldn\'t read the clients of network "Branch 2": Meraki answered the clients of network "Branch 2" with HTTP 400: Invalid t0',
    ]);
    // Its applications were read, but are not kept without its clients.
    expect(
      first.records.some((record: NetworkTrafficUsageRecord) => {
        return (
          record.controllerNetworkId === "L_1001" &&
          record.kind !== NetworkTrafficUsageKind.Uplink
        );
      }),
    ).toBe(false);
    expect(first.nextState.analyticsCursors?.["L_1001"]).toBeUndefined();
    expectRecordsInWindows(first);

    // The next read asks for it again - still its first window - and keeps it.
    const secondAt: Date = new Date(START.getTime() + MINUTE);
    moveClockTo(env.clock, secondAt);
    const second: NetworkControllerReadResult = await readOnce(env);
    expect(second.analyticsNetworks).toBe(1);
    expect(trafficCalls(env.api, "L_1001")[1]!.url.searchParams.get("t0")).toBe(
      new Date(secondAt.getTime() - BACKFILL_MS).toISOString(),
    );
    expect(second.complete).toBe(true);
    expect(second.nextState.analyticsCursors?.["L_1001"]).toBeDefined();
  });

  test("three networks in a row Meraki cannot serve stop the read there", async () => {
    const env: Env = environment({
      scripted: {
        "/api/v1/networks/L_1000/traffic": [
          merakiError(503, "down"),
          merakiError(503, "down"),
          merakiError(503, "down"),
        ],
        "/api/v1/networks/L_1001/traffic": [
          merakiError(503, "down"),
          merakiError(503, "down"),
          merakiError(503, "down"),
        ],
        "/api/v1/networks/L_1002/traffic": [
          merakiError(503, "down"),
          merakiError(503, "down"),
          merakiError(503, "down"),
        ],
      },
    });

    const result: NetworkControllerReadResult = await readOnce(env);

    expect(result.complete).toBe(false);
    expect(result.warnings).toContain(STOPPED_ANSWERING_WARNING);
    expect(result.analyticsNetworks).toBe(0);
    expect(result.analyticsNetworksWaiting).toBe(5);
    expect(trafficCalls(env.api, "L_1003")).toHaveLength(0);
    // The uplinks it read before are kept.
    expect(result.uplinkWindows).toBe(34);
  });

  test("a network Meraki cannot serve between two that it can does not stop the read", async () => {
    const env: Env = environment({
      scripted: {
        "/api/v1/networks/L_1001/traffic": [
          merakiError(503, "down"),
          merakiError(503, "down"),
          merakiError(503, "down"),
        ],
      },
    });

    const result: NetworkControllerReadResult = await readOnce(env);

    expect(result.analyticsNetworks).toBe(4);
    expect(result.warnings).not.toContain(STOPPED_ANSWERING_WARNING);
  });

  test("a rate limit that outlasts its retries stops the read where it is, keeping what it read", async () => {
    const env: Env = environment({
      scripted: {
        "/api/v1/networks/L_1002/traffic": Array.from({ length: 4 }, () => {
          return merakiError(429, "API rate limit exceeded", {
            "retry-after": "1",
          });
        }),
      },
    });

    const result: NetworkControllerReadResult = await readOnce(env);

    expect(result.complete).toBe(false);
    expect(result.wasRateLimited).toBe(true);
    expect(result.warnings).toEqual([RATE_LIMITED_WARNING]);
    expect(result.analyticsNetworks).toBe(2);
    expect(result.uplinkWindows).toBe(34);
    expect(trafficCalls(env.api, "L_1003")).toHaveLength(0);
    expect(Object.keys(result.nextState.analyticsCursors || {}).sort()).toEqual(
      ["L_1000", "L_1001"],
    );
    expectRecordsInWindows(result);
  });

  test("an uplink window that fails stops the uplinks, keeps the cursor before it, and the networks are still read", async () => {
    const env: Env = environment({
      scripted: { [UPLINKS]: [merakiError(400, "Bad window")] },
    });

    const result: NetworkControllerReadResult = await readOnce(env);

    expect(result.uplinkWindows).toBe(0);
    expect(result.nextState.uplinkCursor).toBeUndefined();
    expect(result.analyticsNetworks).toBe(5);
    expect(result.complete).toBe(false);
    expect(result.warnings).toEqual([
      "Couldn't read the uplink usage: Meraki answered the uplink usage with HTTP 400: Bad window",
    ]);
  });

  test("a refused key fails the read, whenever it is refused", async () => {
    const refused: Env = environment({
      apiKey: "another-key-0123456789abcdef0123",
    });

    await expect(readOnce(refused)).rejects.toMatchObject({
      kind: LlmConnectionFailureKind.Authentication,
    });

    const revoked: Env = environment({
      scripted: {
        "/api/v1/networks/L_1003/clients": [
          merakiError(401, "Invalid API key"),
        ],
      },
    });

    await expect(readOnce(revoked)).rejects.toMatchObject({
      kind: LlmConnectionFailureKind.Authentication,
    });
    // Nothing of that read moved the cursors.
    expect(revoked.state).toEqual({});
  });

  test("an organization the key cannot read fails the read, saying why", async () => {
    const env: Env = environment();

    const error: unknown = await readOnce(env, {}, settingsFor("999999")).catch(
      (caught: unknown) => {
        return caught;
      },
    );

    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as LlmProviderError).kind).toBe(
      LlmConnectionFailureKind.Settings,
    );
    expect((error as LlmProviderError).message).toBe(
      "Meraki answered the organization with HTTP 404: Organization not found",
    );
  });

  test("a connection without an organization asks nothing", async () => {
    const env: Env = environment();

    await expect(readOnce(env, {}, settingsFor(""))).rejects.toMatchObject({
      kind: LlmConnectionFailureKind.Settings,
    });
    expect(env.api.requests).toHaveLength(0);
  });
});

describe("a large organization", () => {
  test("1,200 networks are read over a few reads, each within its budget and pace, each network once", async () => {
    const env: Env = environment({}, 1200);

    const first: NetworkControllerReadResult = await readOnce(env);

    expect(first.networkCount).toBe(1200);
    expect(first.appliances).toHaveLength(1200);
    expect(first.requestCount).toBe(900);
    expect(first.complete).toBe(false);
    // 5 listings (two pages each of networks and devices) and 34 windows.
    expect(first.analyticsNetworks).toBe(Math.floor((900 - 5 - 34) / 2));
    expect(first.analyticsNetworksWaiting).toBe(1200 - first.analyticsNetworks);
    expect(first.uplinkWindows).toBe(34);
    expectRecordsInWindows(first);
    expectPaced(env.api);

    let read: number = first.analyticsNetworks;
    let reads: number = 1;

    while (read < 1200 && reads < 5) {
      env.clock.advance(MINUTE);
      const next: NetworkControllerReadResult = await readOnce(env);
      expect(next.requestCount).toBeLessThanOrEqual(900);
      expectRecordsInWindows(next);
      read += next.analyticsNetworks;
      reads++;
    }

    expect(read).toBe(1200);
    expect(reads).toBe(3);
    expect(Object.keys(env.state.analyticsCursors || {})).toHaveLength(1200);
    expectPaced(env.api);
  });

  test("the time limit stops a read too", async () => {
    const env: Env = environment({}, 50);

    const result: NetworkControllerReadResult = await readOnce(env, {
      maxDurationMs: 20 * 1000,
    });

    expect(result.complete).toBe(false);
    // Three a second for twenty seconds.
    expect(result.requestCount).toBeLessThanOrEqual(61);
    expect(result.requestCount).toBeGreaterThanOrEqual(55);
  });
});

describe("the organization's device list", () => {
  function withOtherDevices(count: number): FakeMerakiOrganization {
    const organization: FakeMerakiOrganization = buildBranchOrganization({
      id: "549236",
      name: "Acme Retail",
      count: 5,
    });

    organization.devices = Array.from(
      { length: count },
      (_: unknown, index: number) => {
        return {
          serial: `Q2HP-SWCH-${String(index).padStart(4, "0")}`,
          name: `Switch ${index + 1}`,
          model: "MS225-48LP",
          mac: `88:15:44:aa:00:${(index % 256).toString(16).padStart(2, "0")}`,
          networkId: `L_${1000 + (index % 5)}`,
          productType: index % 2 === 0 ? "switch" : "wireless",
          lanIp: `10.0.${index % 250}.2`,
        };
      },
    );

    return organization;
  }

  test("every device is listed, in the one call that listed the appliances", async () => {
    const env: Env = environment({ organizations: [withOtherDevices(2)] });
    const result: NetworkControllerReadResult = await readOnce(env);

    const deviceCalls: Array<FakeMerakiRequest> = env.api.callsTo(
      "/api/v1/organizations/549236/devices",
    );
    expect(deviceCalls).toHaveLength(1);
    expect(deviceCalls[0]!.url.searchParams.getAll("productTypes[]")).toEqual(
      [],
    );
    // Nothing more than the read cost before it listed every device.
    expect(result.requestCount).toBe(3 + 34 + 10);

    expect(result.devices).toHaveLength(7);
    expect(result.isDeviceListComplete).toBe(true);
    expect(result.devices[5]).toEqual({
      serial: "Q2HP-SWCH-0000",
      name: "Switch 1",
      model: "MS225-48LP",
      mac: "88:15:44:aa:00:00",
      lanIp: "10.0.0.2",
      firmware: "switch-16-7",
      productType: "switch",
      controllerNetworkId: "L_1000",
      networkName: "Branch 1",
      address: "",
    });

    // The uplinks are still the appliances', named as before.
    expect(result.appliances).toHaveLength(5);
    expect(
      result.appliances.map((appliance: { serial: string }): string => {
        return appliance.serial;
      }),
    ).toEqual([
      "Q2XX-AAAA-0000",
      "Q2XX-AAAA-0001",
      "Q2XX-AAAA-0002",
      "Q2XX-AAAA-0003",
      "Q2XX-AAAA-0004",
    ]);
    expect(
      ofKind(result.records, NetworkTrafficUsageKind.Uplink)[0],
    ).toMatchObject({ deviceSerial: "Q2XX-AAAA-0000", deviceName: "MX 1" });
  });

  test("a list cut short says so, and the appliances are listed on their own so no uplink loses its name", async () => {
    const env: Env = environment({
      organizations: [withOtherDevices(60)],
      maxPerPage: 1,
    });
    const result: NetworkControllerReadResult = await readOnce(env);

    expect(result.isDeviceListComplete).toBe(false);
    expect(result.devices).toHaveLength(50);
    expect(result.appliances).toHaveLength(5);

    const deviceCalls: Array<FakeMerakiRequest> = env.api.callsTo(
      "/api/v1/organizations/549236/devices",
    );
    // Fifty pages of every device, then the appliances alone.
    expect(
      deviceCalls.filter((call: FakeMerakiRequest): boolean => {
        return call.url.searchParams.getAll("productTypes[]").length === 0;
      }),
    ).toHaveLength(50);
    expect(
      deviceCalls.filter((call: FakeMerakiRequest): boolean => {
        return (
          call.url.searchParams.getAll("productTypes[]").join(",") ===
          "appliance"
        );
      }),
    ).toHaveLength(5);

    expect(result.warnings).toContain(
      "The organization has more than 50,000 devices: only the first 50,000 have their details read.",
    );
  });
});

describe("what else a read says", () => {
  test("after a long pause, the gap is said - never filled with a guess", async () => {
    const env: Env = environment();
    env.state = {
      uplinkCursor: "2026-10-20T00:00:00.000Z",
      analyticsCursors: { L_1000: "2026-10-20T00:00:00.000Z" },
    };

    const result: NetworkControllerReadResult = await readOnce(env);

    expect(result.warnings).toEqual([
      "Uplink usage from 2026-10-20T00:00:00.000Z to 2026-10-23T12:00:00.000Z was not read: OneUptime reads at most a day back after a pause.",
      ANALYTICS_GAP_WARNING,
    ]);
    expect(env.api.callsTo(UPLINKS)[0]!.url.searchParams.get("t0")).toBe(
      "2026-10-23T12:00:00.000Z",
    );
  });

  test("an organization without an appliance reads its networks, and says why there are no uplinks", async () => {
    const organization: FakeMerakiOrganization = buildBranchOrganization({
      id: "549236",
      name: "Wireless Only",
      count: 2,
    });
    organization.appliances = [];
    const env: Env = environment({ organizations: [organization] });

    const result: NetworkControllerReadResult = await readOnce(env);

    expect(env.api.callsTo(UPLINKS)).toHaveLength(0);
    expect(result.warnings).toEqual([NO_APPLIANCE_WARNING]);
    expect(result.analyticsNetworks).toBe(2);
    expect(result.complete).toBe(true);
    // Nothing to read again later either.
    expect(result.nextState.uplinkCursor).toBe("2026-10-24T11:55:00.000Z");
  });

  test("a network of cameras alone is not asked for traffic", async () => {
    const organization: FakeMerakiOrganization = buildBranchOrganization({
      id: "549236",
      name: "Acme Retail",
      count: 2,
    });
    organization.networks[1]!.productTypes = ["camera"];
    const env: Env = environment({ organizations: [organization] });

    const result: NetworkControllerReadResult = await readOnce(env);

    expect(trafficCalls(env.api, "L_1001")).toHaveLength(0);
    expect(env.api.callsTo("/api/v1/networks/L_1001/clients")).toHaveLength(0);
    expect(result.analyticsNetworks).toBe(1);
  });

  test("networks gone from the organization keep no state", async () => {
    const env: Env = environment();
    env.state = {
      uplinkCursor: "2026-10-24T11:55:00.000Z",
      analyticsCursors: {
        L_gone: "2026-10-24T11:00:00.000Z",
        L_1000: "2026-10-24T11:00:00.000Z",
      },
      trafficAnalysisOff: { L_gone: "2026-10-24T09:00:00.000Z" },
    };

    const result: NetworkControllerReadResult = await readOnce(env);

    expect(result.nextState.analyticsCursors?.["L_gone"]).toBeUndefined();
    expect(result.nextState.analyticsCursors?.["L_1000"]).toBe(
      "2026-10-24T11:00:00.000Z",
    );
    expect(result.nextState.trafficAnalysisOff).toEqual({});
    expect(result.trafficAnalysisOffNetworks).toBe(0);
  });

  test("a network with more clients than a read pages through says so", async () => {
    const organization: FakeMerakiOrganization = buildBranchOrganization({
      id: "549236",
      name: "Campus",
      count: 1,
    });
    organization.networks[0]!.clients = Array.from(
      { length: 9 },
      (_: unknown, index: number) => {
        return {
          id: `k${index}`,
          sentPerSecond: 10,
          receivedPerSecond: 10,
        };
      },
    );
    const env: Env = environment({
      organizations: [organization],
      maxPerPage: 2,
    });

    const result: NetworkControllerReadResult = await readOnce(env);

    expect(env.api.callsTo("/api/v1/networks/L_1000/clients")).toHaveLength(4);
    expect(ofKind(result.records, NetworkTrafficUsageKind.Client)).toHaveLength(
      8,
    );
    expect(result.warnings).toEqual([
      "A network had more than 20,000 clients in a window: the clients past them are left out of Top clients.",
    ]);
  });

  test("the state it was given is never changed in place", async () => {
    const env: Env = environment();
    const given: NetworkControllerPullState = {
      uplinkCursor: "2026-10-24T11:00:00.000Z",
      analyticsCursors: { L_1000: "2026-10-24T08:00:00.000Z" },
      trafficAnalysisOff: {},
    };
    env.state = given;
    const copy: string = JSON.stringify(given);

    await readOnce(env);

    expect(JSON.stringify(given)).toBe(copy);
  });
});
