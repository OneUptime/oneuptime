/*
 * The requests are built from the dashboard's APP_API_URL, which reads the
 * browser's window; the node environment has none, so it is given here.
 * The network itself is never reached: API.post is a mock.
 */
jest.mock("Common/UI/Config", () => {
  const { default: URLType } = jest.requireActual("Common/Types/API/URL") as {
    default: { fromString: (url: string) => unknown };
  };

  return {
    __esModule: true,
    APP_API_URL: URLType.fromString("https://oneuptime.example.com/api"),
  };
});

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(),
      getFriendlyMessage: (error: { message?: string }): string => {
        return error.message || "Request failed";
      },
    },
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "10000000-0000-4000-8000-000000000001" };
      },
    },
  };
});

import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  NETWORK_CONTROLLER_CONNECTION_PATH,
  NETWORK_TRAFFIC_USAGE_SUMMARY_PATH,
  fetchNetworkTrafficUsage,
  parseNetworkTrafficUsageSummary,
  readNetworkControllerConnectionNow,
  readNetworkControllerTestResult,
  runNetworkControllerTest,
} from "../../FeatureSet/Dashboard/src/Components/NetworkTraffic/NetworkTrafficUsageApi";
import {
  FILTER_APPLIANCE_LABEL,
  FILTER_NETWORK_LABEL,
  MERAKI_CONNECTIONS_ANCHOR,
  MERAKI_URL_PARAMS,
  TrafficSide,
  getMerakiFilterChips,
  pickTrafficSide,
  readNetworkTrafficUsageFilters,
  readTrafficSide,
  toMerakiUrlParams,
  withoutMerakiFilter,
} from "../../FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/MerakiUrlState";
import {
  getClientDetails,
  getClientLabel,
  getNewestBeforeRange,
  getUplinkDetails,
  hasMerakiTraffic,
  isNetworkAddressText,
  isOfOneNetwork,
  shouldListNetworks,
  toFlowSeries,
  toFlowSummary,
} from "../../FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/MerakiTrafficRows";
import {
  ANALYSIS_OFF_NOTE,
  ANALYTICS_WAITING_NOTE,
  API_CALL_COUNT,
  APPLIANCE_COUNT,
  KEY_REFUSED_BY_DASHBOARD,
  MERAKI_CONNECTION_NAME,
  MERAKI_REGION_NAMES,
  MERAKI_STATUS_WORDS,
  MERAKI_TONE_DOT,
  MERAKI_TONE_PILL,
  MERAKI_VIEW_HELP,
  MerakiConnectionAction,
  MerakiTestWords,
  NETWORK_COUNT,
  NEWEST_TRAFFIC_BEFORE_RANGE,
  RATE_LIMITED_NOTE,
  TEST_COULD_NOT_RUN,
  getMerakiConnectionAction,
  getMerakiConnectionRowFacts,
  getMerakiConnectionSentence,
  getMerakiIntervalOptions,
  getMerakiIntervalWords,
  getMerakiReadTime,
  getMerakiTestActions,
  getMerakiTestWords,
} from "../../FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/MerakiWords";
import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import NetworkControllerConnection from "Common/Models/DatabaseModels/NetworkControllerConnection";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import { LlmConnectionFailureKind } from "Common/Types/LlmObservability/LlmConnectionTest";
import {
  NetworkTrafficUsageConnection,
  NetworkTrafficUsageKind,
  NetworkTrafficUsageSummary,
  getUnavailableNetworkTrafficUsageSummary,
} from "Common/Types/NetFlow/NetworkTrafficUsage";
import { NetworkControllerConnectionStatus } from "Common/Types/NetworkController/NetworkControllerConnectionHealth";
import { NetworkControllerTestResult } from "Common/Types/NetworkController/NetworkControllerConnectionTest";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";

/*
 * The Meraki side of a Traffic page, as plain logic (App's node tests
 * cannot render React; the rendered page is in Common/Tests/App/Dashboard):
 * which side a page opens on, what its URL keeps, how the answers are read
 * without trusting their shape, and what the page says - every word of it a
 * key of the English locale, so nothing is drawn untranslated.
 */

const postMock: jest.Mock = API.post as unknown as jest.Mock;
const DEVICE_ID: string = "7c0e4a52-9a8d-4b1e-8f39-2f1a7d1c0b11";

function reader(query: string): (name: string) => string | null {
  const params: URLSearchParams = new URLSearchParams(query);

  return (name: string): string | null => {
    return params.get(name);
  };
}

function connection(
  overrides: Partial<NetworkTrafficUsageConnection> = {},
): NetworkTrafficUsageConnection {
  return {
    id: "c1",
    name: "Acme Retail",
    provider: "meraki",
    organizationName: "Acme Retail",
    status: NetworkControllerConnectionStatus.Healthy,
    readIntervalInMinutes: 5,
    lastPulledAt: "2026-10-24T11:58:00.000Z",
    lastSuccessfulPullAt: "2026-10-24T11:58:00.000Z",
    ...overrides,
  };
}

function usage(
  overrides: Partial<NetworkTrafficUsageSummary> = {},
): NetworkTrafficUsageSummary {
  return {
    ...getUnavailableNetworkTrafficUsageSummary({
      startTime: new Date("2026-10-24T11:00:00.000Z"),
      endTime: new Date("2026-10-24T12:00:00.000Z"),
    }),
    isAvailable: true,
    ...overrides,
  };
}

describe("which side a page opens on", () => {
  test.each([
    // [picked, Meraki available, has flows, shown]
    [null, false, true, TrafficSide.Flows],
    [null, false, false, TrafficSide.Flows],
    [TrafficSide.Meraki, false, true, TrafficSide.Flows],
    [null, true, true, TrafficSide.Flows],
    [null, true, false, TrafficSide.Meraki],
    [TrafficSide.Meraki, true, true, TrafficSide.Meraki],
    [TrafficSide.Flows, true, false, TrafficSide.Flows],
  ])(
    "picked %p, Meraki %p, flows %p: %p",
    (
      picked: TrafficSide | null,
      isMerakiAvailable: boolean,
      hasFlows: boolean,
      shown: TrafficSide,
    ) => {
      expect(pickTrafficSide({ picked, isMerakiAvailable, hasFlows })).toBe(
        shown,
      );
    },
  );
});

describe("what the URL keeps", () => {
  test("the side, when one was picked; anything else lets the page pick", () => {
    expect(readTrafficSide(reader("source=meraki"))).toBe(TrafficSide.Meraki);
    expect(readTrafficSide(reader("source=flows"))).toBe(TrafficSide.Flows);
    expect(readTrafficSide(reader("source=MERAKI"))).toBeNull();
    expect(readTrafficSide(reader(""))).toBeNull();
  });

  test("the filters, as the server takes them; anything it would refuse is left out", () => {
    expect(
      readNetworkTrafficUsageFilters(reader("mnet=L_1000&mdev=q2xx-aaaa-0001")),
    ).toEqual({
      controllerNetworkId: "L_1000",
      deviceSerial: "Q2XX-AAAA-0001",
    });
    expect(
      readNetworkTrafficUsageFilters(
        reader(`mnet=${encodeURIComponent("L_1' OR 1=1 --")}&mdev=ok-1`),
      ),
    ).toEqual({ deviceSerial: "OK-1" });
    expect(readNetworkTrafficUsageFilters(reader("mnet="))).toEqual({});
  });

  test("written back: a default leaves the URL", () => {
    expect(
      toMerakiUrlParams({
        source: TrafficSide.Meraki,
        filters: { controllerNetworkId: "L_1000" },
      }),
    ).toEqual({ source: "meraki", mnet: "L_1000", mdev: null });
    expect(toMerakiUrlParams({ source: null, filters: {} })).toEqual({
      source: null,
      mnet: null,
      mdev: null,
    });
    expect(MERAKI_URL_PARAMS).toEqual(["source", "mnet", "mdev"]);
  });

  test("a chip a filter, named; an appliance's x keeps its network, a network's takes both", () => {
    const filters: { controllerNetworkId: string; deviceSerial: string } = {
      controllerNetworkId: "L_1000",
      deviceSerial: "Q2XX-AAAA-0001",
    };

    expect(getMerakiFilterChips(filters, { networkName: "Branch 1" })).toEqual([
      {
        kind: "network",
        template: FILTER_NETWORK_LABEL,
        values: { network: "Branch 1" },
      },
      {
        kind: "appliance",
        template: FILTER_APPLIANCE_LABEL,
        values: { appliance: "Q2XX-AAAA-0001" },
      },
    ]);
    expect(withoutMerakiFilter(filters, "appliance")).toEqual({
      controllerNetworkId: "L_1000",
    });
    expect(withoutMerakiFilter(filters, "network")).toEqual({});
  });
});

describe("the Meraki numbers through the flow side's tiles and chart", () => {
  test("an uplink's download is in, its upload out", () => {
    expect(
      toFlowSeries([
        {
          time: "2026-10-24T11:00:00.000Z",
          sentOctets: 10,
          receivedOctets: 90,
        },
      ]),
    ).toEqual([
      {
        time: "2026-10-24T11:00:00.000Z",
        octets: 100,
        inOctets: 90,
        outOctets: 10,
      },
    ]);
  });

  test("a summary nothing sampled, of no packets and no flow lists", () => {
    const summary: ReturnType<typeof toFlowSummary> = toFlowSummary(
      usage({
        totals: { sentOctets: 5, receivedOctets: 7, flows: 3 },
      }),
    );

    expect(summary.totals).toEqual({ octets: 12, packets: 0, flows: 3 });
    expect(summary.maxSamplingRate).toBe(1);
    expect(summary.topSources).toEqual([]);
    expect(summary.lastFlowAt).toBeNull();
    expect(summary.bucketSeconds).toBe(300);
  });

  test("whether there is traffic: uplinks, applications, clients or flows", () => {
    expect(hasMerakiTraffic(usage())).toBe(false);
    expect(
      hasMerakiTraffic(
        usage({ clientTotals: { sentOctets: 1, receivedOctets: 0 } }),
      ),
    ).toBe(true);
    expect(
      hasMerakiTraffic(
        usage({ totals: { sentOctets: 0, receivedOctets: 0, flows: 2 } }),
      ),
    ).toBe(true);
  });

  test("Top networks for traffic of more than one network, its uplinks for one", () => {
    const network: NetworkTrafficUsageSummary["topNetworks"][number] = {
      controllerNetworkId: "L_1",
      name: "Branch 1",
      sentOctets: 1,
      receivedOctets: 1,
    };

    expect(shouldListNetworks(usage({ topNetworks: [network] }))).toBe(false);
    expect(
      shouldListNetworks(
        usage({
          topNetworks: [network, { ...network, controllerNetworkId: "L_2" }],
        }),
      ),
    ).toBe(true);
  });

  test("a client by its name, else its address, else its MAC; the rest beside it", () => {
    const client: {
      name: string;
      ip: string;
      mac: string;
      clientKey: string;
      manufacturer: string;
      controllerNetworkName: string;
    } = {
      name: "",
      ip: "10.0.0.25",
      mac: "22:33:44:55:66:77",
      clientKey: "k74272e",
      manufacturer: "Apple",
      controllerNetworkName: "Branch 1",
    };

    expect(getClientLabel(client)).toBe("10.0.0.25");
    // Unnamed, by its address: its MAC is the other way to find it.
    expect(getClientDetails(client, { withNetwork: true })).toEqual([
      "22:33:44:55:66:77",
      "Apple",
      "Branch 1",
    ]);
    expect(getClientLabel({ ...client, name: "Kiosk 3" })).toBe("Kiosk 3");
    expect(getClientLabel({ ...client, ip: "", mac: "" })).toBe("k74272e");
  });

  test("a client's line is short: one other way to find it, its maker, its network on a page of several", () => {
    const named: {
      name: string;
      ip: string;
      mac: string;
      manufacturer: string;
      controllerNetworkName: string;
    } = {
      name: "Kiosk 3",
      ip: "10.0.0.25",
      mac: "22:33:44:55:66:77",
      manufacturer: "Apple",
      controllerNetworkName: "Branch 1",
    };

    // Named: its address - never its MAC as well.
    expect(getClientDetails(named, { withNetwork: true })).toEqual([
      "10.0.0.25",
      "Apple",
      "Branch 1",
    ]);
    // A page of one network never says which.
    expect(getClientDetails(named, { withNetwork: false })).toEqual([
      "10.0.0.25",
      "Apple",
    ]);
    // Named, without an address: its MAC.
    expect(getClientDetails({ ...named, ip: "" }, { withNetwork: false })).toEqual(
      ["22:33:44:55:66:77", "Apple"],
    );
    // Known by its MAC alone: nothing more to find it by.
    expect(
      getClientDetails(
        { ...named, name: "", ip: "", manufacturer: "" },
        { withNetwork: false },
      ),
    ).toEqual([]);
  });

  test("an uplink names its appliance unless the page is the appliance's, and its network on a page of several", () => {
    const uplink: {
      deviceName: string;
      deviceSerial: string;
      controllerNetworkName: string;
    } = {
      deviceName: "BRS MX68",
      deviceSerial: "Q2PN-BRS0-0047",
      controllerNetworkName: "Branch 047 · Bristol",
    };

    expect(
      getUplinkDetails(uplink, { withAppliance: true, withNetwork: true }),
    ).toEqual(["BRS MX68", "Branch 047 · Bristol"]);
    expect(
      getUplinkDetails(uplink, { withAppliance: true, withNetwork: false }),
    ).toEqual(["BRS MX68"]);
    expect(
      getUplinkDetails(uplink, { withAppliance: false, withNetwork: false }),
    ).toEqual([]);
    // No name in Meraki: its serial.
    expect(
      getUplinkDetails(
        { ...uplink, deviceName: "" },
        { withAppliance: true, withNetwork: false },
      ),
    ).toEqual(["Q2PN-BRS0-0047"]);
  });

  test("a page is of one network when it is narrowed to one, or its traffic is one network's", () => {
    expect(isOfOneNetwork({ filters: {}, networkCount: 4 })).toBe(false);
    expect(
      isOfOneNetwork({ filters: { controllerNetworkId: "L_1" }, networkCount: 4 }),
    ).toBe(true);
    expect(isOfOneNetwork({ filters: {}, networkCount: 1 })).toBe(true);
    expect(isOfOneNetwork({ filters: {}, networkCount: 0 })).toBe(true);
  });

  test.each([
    ["10.0.0.25", true],
    ["192.168.100.254", true],
    ["2001:db8::1", true],
    ["::ffff:10.0.0.1", true],
    ["fe80::1ff:fe23:4567:890a", true],
    ["teams.microsoft.com", false],
    ["outlook.office365.com", false],
    ["cafe.example", false],
    ["dead.beef.cafe.face", false],
    ["1.2.3", false],
    ["Microsoft Teams", false],
    ["", false],
  ])(
    "a destination %s is an address (drawn in the addresses' font): %s",
    (text: string, isAddress: boolean) => {
      expect(isNetworkAddressText(text)).toBe(isAddress);
    },
  );

  test("an address is told apart in time that grows with its length, whatever Meraki sends", () => {
    const long: string = "1".repeat(400_000);
    const startedAt: number = Date.now();

    expect(isNetworkAddressText(long)).toBe(false);
    expect(isNetworkAddressText(`${":".repeat(400_000)}x`)).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  test("an empty range after the reads stopped: when the newest traffic is - and nothing for a page still reading", () => {
    const window: {
      windowStartAt: string;
    } = { windowStartAt: "2026-10-24T11:00:00.000Z" };

    expect(
      getNewestBeforeRange({
        ...window,
        lastUplinkAt: "2026-10-24T09:00:00.000Z",
        lastAnalyticsAt: "2026-10-24T08:00:00.000Z",
      }),
    ).toBe("2026-10-24T09:00:00.000Z");
    // Analytics newer than the uplinks (an organization of no appliances).
    expect(
      getNewestBeforeRange({
        ...window,
        lastUplinkAt: null,
        lastAnalyticsAt: "2026-10-24T10:00:00.000Z",
      }),
    ).toBe("2026-10-24T10:00:00.000Z");
    // Read into the range: the range is quiet, not cut off.
    expect(
      getNewestBeforeRange({
        ...window,
        lastUplinkAt: "2026-10-24T11:55:00.000Z",
        lastAnalyticsAt: "2026-10-24T08:00:00.000Z",
      }),
    ).toBeNull();
    // Nothing read at all, or not a time: nothing to say.
    expect(
      getNewestBeforeRange({
        ...window,
        lastUplinkAt: null,
        lastAnalyticsAt: null,
      }),
    ).toBeNull();
    expect(
      getNewestBeforeRange({
        ...window,
        lastUplinkAt: "yesterday",
        lastAnalyticsAt: null,
      }),
    ).toBeNull();
  });
});

describe("reading the answers", () => {
  test("a page's summary, read without trusting its shape", () => {
    const summary: NetworkTrafficUsageSummary = parseNetworkTrafficUsageSummary(
      {
        isAvailable: true,
        windowStartAt: "2026-10-24T11:00:00.000Z",
        windowEndAt: "2026-10-24T12:00:00.000Z",
        bucketSeconds: "300",
        totals: { sentOctets: "1200", receivedOctets: -5, flows: "x" },
        primaryKind: "application",
        series: [{ time: "t", sentOctets: 1, receivedOctets: 2 }, null, 5],
        topUplinks: [
          {
            deviceSerial: "Q2XX-AAAA-0001",
            interfaceName: "wan1",
            sentOctets: 1,
            receivedOctets: 2,
            networkDeviceId: DEVICE_ID,
          },
          { deviceSerial: "Q2XX-AAAA-0002", networkDeviceId: "../../admin" },
        ],
        topClients: "nope",
        connections: [
          {
            id: "c1",
            name: "Acme",
            status: "gremlins",
            readIntervalInMinutes: "x",
          },
        ],
      } as unknown as JSONObject,
    );

    expect(summary.isAvailable).toBe(true);
    expect(summary.totals).toEqual({
      sentOctets: 1200,
      receivedOctets: 0,
      flows: 0,
    });
    expect(summary.primaryKind).toBe(NetworkTrafficUsageKind.Application);
    expect(summary.series).toHaveLength(1);
    expect(summary.topUplinks[0]!.networkDeviceId).toBe(DEVICE_ID);
    expect(summary.topUplinks[1]!.networkDeviceId).toBeUndefined();
    expect(summary.topClients).toEqual([]);
    expect(summary.connections[0]!.status).toBe(
      NetworkControllerConnectionStatus.Waiting,
    );
    expect(summary.connections[0]!.readIntervalInMinutes).toBe(5);
  });

  test("an empty answer is a page without the source", () => {
    const summary: NetworkTrafficUsageSummary =
      parseNetworkTrafficUsageSummary(undefined);

    expect(summary.isAvailable).toBe(false);
    expect(summary.primaryKind).toBe(NetworkTrafficUsageKind.Uplink);
    expect(summary.bucketSeconds).toBe(300);
  });

  test("a test's answer that is not one reads as a failure", () => {
    expect(readNetworkControllerTestResult(undefined).status).toBe("fail");
    expect(readNetworkControllerTestResult({ status: "maybe" }).message).toBe(
      "OneUptime could not read the answer to the test.",
    );

    const result: NetworkControllerTestResult = readNetworkControllerTestResult(
      {
        provider: "meraki",
        status: "pass",
        message: "Reads 3 networks.",
        organizations: [
          { id: "1", name: "One" },
          { id: "", name: "No ID" },
          "x",
        ],
        networkCount: 3,
        applianceCount: "2",
        durationMs: 40,
      } as unknown as JSONObject,
    );

    expect(result.organizations).toEqual([{ id: "1", name: "One" }]);
    expect(result.networkCount).toBe(3);
    expect(result.applianceCount).toBeUndefined();
  });
});

describe("the calls", () => {
  test("a page's summary is asked of its own path, with the project's headers", async () => {
    postMock.mockResolvedValueOnce({ data: { isAvailable: false } });

    await fetchNetworkTrafficUsage({
      startTime: "2026-10-24T11:00:00.000Z",
      endTime: "2026-10-24T12:00:00.000Z",
      networkDeviceId: DEVICE_ID,
    });

    const request: {
      url: { toString: () => string };
      data: JSONObject;
      headers: JSONObject;
    } = postMock.mock.calls[postMock.mock.calls.length - 1]![0];
    expect(request.url.toString()).toBe(
      `https://oneuptime.example.com/api${NETWORK_TRAFFIC_USAGE_SUMMARY_PATH}`,
    );
    expect(request.data["networkDeviceId"]).toBe(DEVICE_ID);
    expect(request.headers["tenantid"]).toBe(
      "10000000-0000-4000-8000-000000000001",
    );
  });

  test("a failed summary request is thrown for the page to say", async () => {
    postMock.mockResolvedValueOnce(
      new HTTPErrorResponse(504, { message: "Too slow" }, {}),
    );

    await expect(
      fetchNetworkTrafficUsage({
        startTime: "2026-10-24T11:00:00.000Z",
        endTime: "2026-10-24T12:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });

  test("a test whose request failed is a failure to show, not a throw", async () => {
    postMock.mockResolvedValueOnce(
      new HTTPErrorResponse(403, { message: "Not allowed" }, {}),
    );

    const result: NetworkControllerTestResult = await runNetworkControllerTest(
      {},
    );

    expect(result.status).toBe("fail");
    expect(
      postMock.mock.calls[postMock.mock.calls.length - 1]![0].url.toString(),
    ).toBe(
      `https://oneuptime.example.com/api${NETWORK_CONTROLLER_CONNECTION_PATH}/test`,
    );
  });

  test("Read now posts to the connection's own path", async () => {
    postMock.mockResolvedValueOnce({ data: { queued: true } });
    const id: ObjectID = new ObjectID(DEVICE_ID);

    await readNetworkControllerConnectionNow(id);

    expect(
      postMock.mock.calls[postMock.mock.calls.length - 1]![0].url.toString(),
    ).toBe(
      `https://oneuptime.example.com/api${NETWORK_CONTROLLER_CONNECTION_PATH}/${DEVICE_ID}/read-now`,
    );
  });
});

describe("what the page says", () => {
  test("every status has its words and a tone", () => {
    for (const status of Object.values(NetworkControllerConnectionStatus)) {
      expect(MERAKI_STATUS_WORDS[status].label).toBeTruthy();
      expect(["green", "amber", "red", "gray"]).toContain(
        MERAKI_STATUS_WORDS[status].tone,
      );
    }
  });

  test("a status pill says what Cloud Connect's list says, in its colours", () => {
    const labels: Record<string, string> = {};

    for (const status of Object.values(NetworkControllerConnectionStatus)) {
      labels[status] = MERAKI_STATUS_WORDS[status].label;
    }

    expect(labels).toEqual({
      [NetworkControllerConnectionStatus.Healthy]: "Working",
      [NetworkControllerConnectionStatus.Partial]: "Read in part",
      [NetworkControllerConnectionStatus.Failing]: "Not working",
      [NetworkControllerConnectionStatus.Stale]: "Not read lately",
      [NetworkControllerConnectionStatus.Waiting]: "Waiting for the first read",
      [NetworkControllerConnectionStatus.Off]: "Off",
    });
    expect(MERAKI_TONE_PILL).toEqual({
      green: Green,
      amber: Yellow,
      red: Red,
      gray: Gray500,
    });
    // A quiet dot's grey is one the dark theme remaps (NetworkTrafficDarkMode).
    expect(MERAKI_TONE_DOT.gray).toBe("bg-gray-300");
  });

  test("a connection's one button is the next thing to do with it", () => {
    const facts: (
      status: NetworkControllerConnectionStatus,
      failureKind?: LlmConnectionFailureKind,
    ) => Parameters<typeof getMerakiConnectionAction>[0] = (
      status: NetworkControllerConnectionStatus,
      failureKind?: LlmConnectionFailureKind,
    ): Parameters<typeof getMerakiConnectionAction>[0] => {
      return {
        connection: connection({ status }),
        summary: failureKind
          ? ({
              status: "failed",
              failureKind,
            } as Parameters<typeof getMerakiConnectionAction>[0]["summary"])
          : undefined,
      };
    };

    expect(
      getMerakiConnectionAction(facts(NetworkControllerConnectionStatus.Off)),
    ).toBe(MerakiConnectionAction.TurnOn);
    expect(
      getMerakiConnectionAction(
        facts(
          NetworkControllerConnectionStatus.Failing,
          LlmConnectionFailureKind.Authentication,
        ),
      ),
    ).toBe(MerakiConnectionAction.UpdateKey);

    for (const [status, failureKind] of [
      [NetworkControllerConnectionStatus.Healthy, undefined],
      [NetworkControllerConnectionStatus.Partial, undefined],
      [NetworkControllerConnectionStatus.Stale, undefined],
      [NetworkControllerConnectionStatus.Waiting, undefined],
      // Unreachable, slowed down, no API access: reading again may work.
      [
        NetworkControllerConnectionStatus.Failing,
        LlmConnectionFailureKind.Unavailable,
      ],
      [
        NetworkControllerConnectionStatus.Failing,
        LlmConnectionFailureKind.RateLimited,
      ],
      [
        NetworkControllerConnectionStatus.Failing,
        LlmConnectionFailureKind.Permission,
      ],
      [NetworkControllerConnectionStatus.Failing, undefined],
    ] as Array<
      [NetworkControllerConnectionStatus, LlmConnectionFailureKind | undefined]
    >) {
      expect(getMerakiConnectionAction(facts(status, failureKind))).toBe(
        MerakiConnectionAction.ReadNow,
      );
    }
  });

  test("one sentence per status, with when it read", () => {
    expect(getMerakiConnectionSentence(connection()).template).toBe(
      "Read {{time}}.",
    );
    expect(
      getMerakiConnectionSentence(
        connection({ status: NetworkControllerConnectionStatus.Failing }),
      ).template,
    ).toBe("Couldn't read Meraki {{time}}.");
    expect(
      getMerakiConnectionSentence(
        connection({
          status: NetworkControllerConnectionStatus.Stale,
          lastSuccessfulPullAt: undefined,
        }),
      ).template,
    ).toBe("Not read yet. Check that OneUptime's Workers are running.");
  });

  test("a connection that stopped reading says when it last read", () => {
    const now: Date = new Date("2026-10-24T12:00:00.000Z");

    expect(
      getMerakiConnectionSentence(
        connection({ status: NetworkControllerConnectionStatus.Stale }),
        { now },
      ),
    ).toEqual({
      template: "Last read {{time}}: the traffic below stops there.",
      values: { time: "2 minutes ago" },
    });
  });

  test("when it read is in the reader's language", () => {
    const now: Date = new Date("2026-10-24T12:00:00.000Z");

    expect(getMerakiReadTime("2026-10-24T11:58:00.000Z", { now })).toBe(
      "2 minutes ago",
    );
    expect(
      getMerakiReadTime("2026-10-24T11:58:00.000Z", { now, language: "de" }),
    ).toBe("vor 2 Minuten");
    expect(
      getMerakiReadTime("2026-10-24T09:00:00.000Z", { now, language: "fr" }),
    ).toBe("il y a 3 heures");
    expect(
      getMerakiConnectionSentence(connection(), { now, language: "de" }),
    ).toEqual({
      template: "Read {{time}}.",
      values: { time: "vor 2 Minuten" },
    });
    expect(
      getMerakiConnectionSentence(
        connection({ status: NetworkControllerConnectionStatus.Failing }),
        { now, language: "ja" },
      ).values,
    ).toEqual({ time: "2 分前" });
  });

  test("a read under a minute ago gives its seconds - never now, which reads as the Read now button", () => {
    const now: Date = new Date("2026-10-24T12:00:00.000Z");

    expect(getMerakiReadTime("2026-10-24T11:59:48.000Z", { now })).toBe(
      "12 seconds ago",
    );
    expect(
      getMerakiReadTime("2026-10-24T11:59:48.000Z", { now, language: "de" }),
    ).toBe("vor 12 Sekunden");
    expect(getMerakiReadTime("2026-10-24T12:00:00.000Z", { now })).toBe(
      "1 second ago",
    );
  });

  test("a server clock ahead of the browser's never says a read is to come", () => {
    const now: Date = new Date("2026-10-24T12:00:00.000Z");

    expect(getMerakiReadTime("2026-10-24T12:03:00.000Z", { now })).toBe(
      "1 second ago",
    );
  });

  test("no time, or not a time, reads as nothing; a language it does not know reads English", () => {
    const now: Date = new Date("2026-10-24T12:00:00.000Z");

    expect(getMerakiReadTime(undefined, { now })).toBe("");
    expect(getMerakiReadTime("", { now })).toBe("");
    expect(getMerakiReadTime("not a time", { now })).toBe("");
    expect(
      getMerakiReadTime("2026-10-24T11:58:00.000Z", {
        now,
        language: "not a language!",
      }),
    ).toBe("2 minutes ago");
    expect(
      getMerakiReadTime("2026-10-24T11:59:48.000Z", {
        now,
        language: "not a language!",
      }),
    ).toBe("12 seconds ago");
  });

  test("how often it reads", () => {
    expect(getMerakiIntervalWords(60)).toEqual({
      template: "Every hour",
      values: {},
    });
    expect(getMerakiIntervalWords(15)).toEqual({
      template: "Every {{minutes}} minutes",
      values: { minutes: 15 },
    });
    expect(
      getMerakiIntervalOptions().map((option: { value: number }) => {
        return option.value;
      }),
    ).toEqual([5, 10, 15, 30, 60]);
  });

  test.each([
    [
      LlmConnectionFailureKind.Authentication,
      "Meraki did not accept this API key.",
    ],
    [
      LlmConnectionFailureKind.Permission,
      "This key cannot read the organization.",
    ],
    [
      LlmConnectionFailureKind.RateLimited,
      "Meraki asked OneUptime to slow down.",
    ],
    [
      LlmConnectionFailureKind.Unavailable,
      "The Meraki dashboard API could not be reached.",
    ],
    [LlmConnectionFailureKind.Settings, "A setting is not right."],
    [LlmConnectionFailureKind.Other, "Meraki refused the request."],
  ])(
    "a test that failed (%s): its own headline, and Meraki's answer below it",
    (kind: LlmConnectionFailureKind, headline: string) => {
      const words: MerakiTestWords = getMerakiTestWords({
        result: {
          provider: "meraki",
          status: "fail",
          message:
            "Meraki answered the organization with HTTP 401: Invalid API key",
          failureKind: kind,
          organizations: [],
          durationMs: 1,
        },
        organizationName: "",
      });

      expect(words.tone).toBe("fail");
      expect(words.headline.template).toBe(headline);
      expect(words.details).toBe(
        "Meraki answered the organization with HTTP 401: Invalid API key",
      );
    },
  );

  test("a refused key names the dashboard that refused it, and Meraki's answer, which says no more, is left out", () => {
    const words: MerakiTestWords = getMerakiTestWords({
      result: {
        provider: "meraki",
        status: "fail",
        message:
          "The Meraki dashboard (dashboard.meraki.ca) did not accept this API key.",
        failureKind: LlmConnectionFailureKind.Authentication,
        organizations: [],
        durationMs: 1,
      },
      organizationName: "",
      dashboardHost: "dashboard.meraki.ca",
    });

    expect(words.headline).toEqual({
      template: KEY_REFUSED_BY_DASHBOARD,
      values: { host: "dashboard.meraki.ca" },
    });
    expect(words.advice).toBe(
      "Copy the key again from the Meraki dashboard (Organization > API & Webhooks), and check the region is the dashboard you sign in to.",
    );
    expect(words.details).toBeUndefined();
  });

  test("a test that never reached Meraki - OneUptime's own request failed - never blames Meraki", () => {
    const words: MerakiTestWords = getMerakiTestWords({
      result: {
        provider: "",
        status: "fail",
        message: "Bad gateway",
        organizations: [],
        durationMs: 0,
      },
      organizationName: "",
      dashboardHost: "dashboard.meraki.com",
    });

    expect(words.headline.template).toBe(TEST_COULD_NOT_RUN);
    expect(words.details).toBe("Bad gateway");
    expect(words.advice).toBeUndefined();
  });

  test.each([
    [LlmConnectionFailureKind.Authentication, false, true],
    [LlmConnectionFailureKind.Settings, false, true],
    [LlmConnectionFailureKind.Permission, true, true],
    [LlmConnectionFailureKind.RateLimited, true, false],
    [LlmConnectionFailureKind.Unavailable, true, false],
    [LlmConnectionFailureKind.Other, true, false],
  ])(
    "a test that failed (%s) offers Try again: %s, Change API key: %s",
    (
      kind: LlmConnectionFailureKind,
      tryAgain: boolean,
      changeKey: boolean,
    ) => {
      expect(
        getMerakiTestActions({
          provider: "meraki",
          status: "fail",
          message: "",
          failureKind: kind,
          organizations: [],
          durationMs: 0,
        }),
      ).toEqual({ tryAgain, changeKey });
    },
  );

  test("a test that passed, or warned, offers nothing to do again", () => {
    for (const status of ["pass", "warn"] as Array<"pass" | "warn">) {
      expect(
        getMerakiTestActions({
          provider: "meraki",
          status,
          message: "",
          organizations: [],
          durationMs: 0,
        }),
      ).toEqual({ tryAgain: false, changeKey: false });
    }
  });

  test("a failure of a kind it does not know reads as a refusal", () => {
    expect(
      getMerakiTestWords({
        result: {
          provider: "meraki",
          status: "fail",
          message: "?",
          failureKind: "gremlins" as LlmConnectionFailureKind,
          organizations: [],
          durationMs: 1,
        },
        organizationName: "",
      }).headline.template,
    ).toBe("Meraki refused the request.");
  });

  test("a pass says what a read will cover, as counts drawn apart from the sentence", () => {
    const pass: NetworkControllerTestResult = {
      provider: "meraki",
      status: "pass",
      message: "",
      organizations: [{ id: "549236", name: "Acme Retail" }],
      organizationId: "549236",
      networkCount: 312,
      applianceCount: 287,
      durationMs: 1,
    };

    expect(
      getMerakiTestWords({ result: pass, organizationName: "Acme Retail" }),
    ).toEqual({
      tone: "pass",
      headline: {
        template: "Ready to read {{organization}}.",
        values: { organization: "Acme Retail" },
      },
      counts: { networks: 312, appliances: 287 },
    });
    expect(
      getMerakiTestWords({
        result: { ...pass, applianceCount: 0 },
        organizationName: "Acme Retail",
      }).tone,
    ).toBe("warn");
    expect(
      getMerakiTestWords({
        result: { ...pass, networkCount: undefined },
        organizationName: "",
      }).headline.template,
    ).toBe("This key reads several organizations. Pick the one to read.");
  });

  test("a saved connection's row: the shared health rule, its region, its last read", () => {
    const model: NetworkControllerConnection =
      new NetworkControllerConnection();
    model.id = new ObjectID(DEVICE_ID);
    model.name = "Stores";
    model.provider = "meraki" as never;
    model.isEnabled = true;
    model.config = {
      region: "canada",
      organizationId: "549236",
      organizationName: "Acme Retail",
      readIntervalInMinutes: 15,
    };
    model.createdAt = new Date("2026-10-20T00:00:00.000Z");
    model.lastPulledAt = new Date("2026-10-24T11:50:00.000Z");
    model.lastSuccessfulPullAt = new Date("2026-10-24T11:50:00.000Z");
    model.lastPullResult = {
      status: "partial",
      organizationName: "Acme Retail Canada",
      networkCount: 312,
    };

    const facts: ReturnType<typeof getMerakiConnectionRowFacts> =
      getMerakiConnectionRowFacts(model, new Date("2026-10-24T12:00:00.000Z"));

    expect(facts.connection.status).toBe(
      NetworkControllerConnectionStatus.Partial,
    );
    expect(facts.connection.organizationName).toBe("Acme Retail Canada");
    expect(facts.connection.readIntervalInMinutes).toBe(15);
    expect(facts.regionName).toBe("Canada");
    expect(facts.regionHost).toBe("dashboard.meraki.ca");
    expect(facts.summary?.networkCount).toBe(312);
    expect(JSON.stringify(facts)).not.toContain("secrets");
  });
});

describe("every word is a key of the English locale", () => {
  const english: Record<string, string> = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../../FeatureSet/Dashboard/src/Locales/en.json"),
      "utf8",
    ),
  );

  function expectKey(key: string): void {
    expect(Object.prototype.hasOwnProperty.call(english, key)).toBe(true);
  }

  test("the statuses, the help texts, the notes and the region names", () => {
    for (const words of Object.values(MERAKI_STATUS_WORDS)) {
      expectKey(words.label);
    }

    for (const text of Object.values(MERAKI_VIEW_HELP)) {
      expectKey(text);
    }

    for (const name of MERAKI_REGION_NAMES) {
      expectKey(name);
    }

    expectKey(RATE_LIMITED_NOTE);
    expectKey(FILTER_NETWORK_LABEL);
    expectKey(FILTER_APPLIANCE_LABEL);
    // The UI review's words: a refused key, a test that could not run, an
    // empty range after the reads stopped, and the connection's own name.
    expectKey(KEY_REFUSED_BY_DASHBOARD);
    expectKey(TEST_COULD_NOT_RUN);
    expectKey(NEWEST_TRAFFIC_BEFORE_RANGE);
    expectKey(MERAKI_CONNECTION_NAME);
    expect(MERAKI_CONNECTIONS_ANCHOR).toBe("traffic-meraki-connections");
  });

  // A plural is keyed by its "other" form, its "one" form under `<other>_one`.
  test("the plurals, in both their forms", () => {
    for (const plural of [
      NETWORK_COUNT,
      APPLIANCE_COUNT,
      API_CALL_COUNT,
      ANALYSIS_OFF_NOTE,
      ANALYTICS_WAITING_NOTE,
    ]) {
      expectKey(plural.other);
      expectKey(`${plural.other}_one`);
      expect(english[`${plural.other}_one`]).toBe(plural.one);
    }
  });

  test("the sentences and the test's words", () => {
    for (const status of Object.values(NetworkControllerConnectionStatus)) {
      expectKey(getMerakiConnectionSentence(connection({ status })).template);
    }

    for (const kind of Object.values(LlmConnectionFailureKind)) {
      const words: MerakiTestWords = getMerakiTestWords({
        result: {
          provider: "meraki",
          status: "fail",
          message: "",
          failureKind: kind,
          organizations: [],
          durationMs: 0,
        },
        organizationName: "",
      });
      expectKey(words.headline.template);
      expectKey(words.advice!);
    }
  });
});
