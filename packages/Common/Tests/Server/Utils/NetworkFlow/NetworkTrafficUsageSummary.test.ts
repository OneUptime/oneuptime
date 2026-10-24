import NetworkTrafficUsageSummaryUtil, {
  ParsedNetworkTrafficUsageRequest,
} from "../../../../Server/Utils/NetworkFlow/NetworkTrafficUsageSummary";
import NetworkTrafficUsageAggregationService, {
  NetworkTrafficUsageAggregates,
  NetworkTrafficUsageQuery,
} from "../../../../Server/Services/NetworkTrafficUsageAggregationService";
import NetworkControllerConnectionService from "../../../../Server/Services/NetworkControllerConnectionService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkSiteService from "../../../../Server/Services/NetworkSiteService";
import TelemetryReadAccess from "../../../../Server/Utils/Telemetry/TelemetryReadAccess";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
  TelemetryServiceFilter,
} from "../../../../Server/Utils/Telemetry/TelemetryReadScope";
import NetworkTrafficUsage from "../../../../Models/AnalyticsModels/NetworkTrafficUsage";
import NetworkControllerConnection from "../../../../Models/DatabaseModels/NetworkControllerConnection";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkSite from "../../../../Models/DatabaseModels/NetworkSite";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import QueryTimeoutException from "../../../../Types/Exception/QueryTimeoutException";
import {
  NetworkTrafficUsageConnection,
  NetworkTrafficUsageKind,
  NetworkTrafficUsageSummary,
} from "../../../../Types/NetFlow/NetworkTrafficUsage";
import { NetworkControllerConnectionStatus } from "../../../../Types/NetworkController/NetworkControllerConnectionHealth";
import NetworkControllerProvider from "../../../../Types/NetworkController/NetworkControllerProvider";
import ObjectID from "../../../../Types/ObjectID";
import { MockFunction } from "../../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The Meraki side of a Traffic page: whose traffic it is, decided before
 * any SQL exactly as for flows (a device's page needs the device, a site's
 * reads its devices, the network's page every device the caller reads -
 * and the project's bucket with them), whether the page has the source at
 * all, and the answer: the connections' status (never a key), the kind the
 * totals are of, and a timeout said as one.
 */

const PROJECT: ObjectID = ObjectID.generate();
const MX: ObjectID = ObjectID.generate();
const SWITCH: ObjectID = ObjectID.generate();
const SITE: ObjectID = ObjectID.generate();
const NOW: Date = new Date("2026-10-24T12:00:00.000Z");

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT,
  userId: ObjectID.generate(),
};

function emptyAggregates(
  primaryKind: NetworkTrafficUsageKind = NetworkTrafficUsageKind.Uplink,
): NetworkTrafficUsageAggregates {
  return {
    primaryKind,
    totals: { sentOctets: 10, receivedOctets: 20, flows: 0 },
    applicationTotals: { sentOctets: 0, receivedOctets: 0 },
    clientTotals: { sentOctets: 0, receivedOctets: 0 },
    series: [],
    topNetworks: [],
    topUplinks: [],
    topApplications: [],
    topDestinations: [],
    topClients: [],
  };
}

function connection(
  overrides: Partial<NetworkControllerConnection> = {},
): NetworkControllerConnection {
  const value: NetworkControllerConnection = new NetworkControllerConnection();
  value.id = ObjectID.generate();
  value.name = "Acme Retail";
  value.provider = NetworkControllerProvider.Meraki;
  value.config = {
    region: "global",
    organizationId: "549236",
    organizationName: "Acme Retail",
    readIntervalInMinutes: 5,
  };
  value.secrets = JSON.stringify({
    apiKey: "0123456789abcdef0123456789abcdef01234567",
  });
  value.isEnabled = true;
  value.createdAt = new Date("2026-10-20T00:00:00.000Z");
  value.lastPulledAt = new Date("2026-10-24T11:58:00.000Z");
  value.lastSuccessfulPullAt = new Date("2026-10-24T11:58:00.000Z");
  Object.assign(value, overrides);
  return value;
}

function request(
  overrides: Partial<ParsedNetworkTrafficUsageRequest> = {},
): ParsedNetworkTrafficUsageRequest {
  return {
    networkDeviceId: null,
    networkSiteId: null,
    startTime: new Date("2026-10-24T11:00:00.000Z"),
    endTime: NOW,
    filters: {},
    ...overrides,
  };
}

let connections: Array<NetworkControllerConnection>;
let freshness: { lastUplinkAt: string | null; lastAnalyticsAt: string | null };
let scope: TelemetryReadScope;
let getAggregates: MockFunction;
let getFreshness: MockFunction;

beforeEach(() => {
  connections = [connection()];
  freshness = {
    lastUplinkAt: "2026-10-24T11:55:00.000Z",
    lastAnalyticsAt: "2026-10-24T10:00:00.000Z",
  };
  scope = TelemetryReadScopeUtil.getUnrestrictedScope();

  jest
    .spyOn(NetworkControllerConnectionService, "findBy")
    .mockImplementation((async () => {
      return connections;
    }) as never);
  jest
    .spyOn(TelemetryReadAccess, "getScope")
    .mockImplementation(async (): Promise<TelemetryReadScope> => {
      return scope;
    });
  getFreshness = jest
    .spyOn(NetworkTrafficUsageAggregationService, "getFreshness")
    .mockImplementation((async () => {
      return freshness;
    }) as never) as unknown as MockFunction;
  getAggregates = jest
    .spyOn(NetworkTrafficUsageAggregationService, "getAggregates")
    .mockImplementation((async (data: {
      primaryKind: NetworkTrafficUsageKind;
    }) => {
      return emptyAggregates(data.primaryKind);
    }) as never) as unknown as MockFunction;
  jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function queryOf(): NetworkTrafficUsageQuery {
  return (
    getAggregates.mock.calls[0]![0] as { query: NetworkTrafficUsageQuery }
  ).query;
}

function idsOf(filter: TelemetryServiceFilter): Array<string> | undefined {
  return filter.serviceIds?.map((id: ObjectID): string => {
    return id.toString();
  });
}

async function build(
  overrides: Partial<ParsedNetworkTrafficUsageRequest> = {},
): Promise<NetworkTrafficUsageSummary> {
  return await NetworkTrafficUsageSummaryUtil.build({
    props: PROPS,
    request: request(overrides),
    now: NOW,
  });
}

describe("reading a request", () => {
  test("the past hour by default, for the whole network", () => {
    const parsed: ParsedNetworkTrafficUsageRequest =
      NetworkTrafficUsageSummaryUtil.parseRequest({}, NOW);

    expect(parsed).toEqual({
      networkDeviceId: null,
      networkSiteId: null,
      startTime: new Date("2026-10-24T11:00:00.000Z"),
      endTime: NOW,
      filters: {},
    });
  });

  test("a site's page, a range and the filters", () => {
    const parsed: ParsedNetworkTrafficUsageRequest =
      NetworkTrafficUsageSummaryUtil.parseRequest(
        {
          networkSiteId: SITE.toString(),
          startTime: "2026-10-23T12:00:00.000Z",
          endTime: "2026-10-24T12:00:00.000Z",
          filters: {
            controllerNetworkId: "L_1000",
            deviceSerial: "q2xx-aaaa-0001",
          },
        },
        NOW,
      );

    expect(parsed.networkSiteId?.toString()).toBe(SITE.toString());
    expect(parsed.filters).toEqual({
      controllerNetworkId: "L_1000",
      deviceSerial: "Q2XX-AAAA-0001",
    });
  });

  test.each([
    [
      "a device and a site at once",
      { networkDeviceId: MX.toString(), networkSiteId: SITE.toString() },
    ],
    ["a device ID that is not one", { networkDeviceId: "mx-1" }],
    [
      "an end before the start",
      { startTime: "2026-10-24T11:00:00Z", endTime: "2026-10-24T10:00:00Z" },
    ],
    [
      "a range longer than the retention",
      { startTime: "2026-08-01T00:00:00Z", endTime: "2026-10-24T00:00:00Z" },
    ],
    ["a date that is not one", { startTime: "last tuesday" }],
    ["a date that is not text", { endTime: 1792836000000 }],
    [
      "a network filter that is SQL",
      { filters: { controllerNetworkId: "L_1' --" } },
    ],
  ])("refuses %s", (_name: string, body: Record<string, unknown>) => {
    expect(() => {
      return NetworkTrafficUsageSummaryUtil.parseRequest(body, NOW);
    }).toThrow(BadDataException);
  });
});

describe("whether a page has the source at all", () => {
  test("a project without a connection: no, and nothing is summed", async () => {
    connections = [];

    const summary: NetworkTrafficUsageSummary = await build();

    expect(summary.isAvailable).toBe(false);
    expect(getFreshness).not.toHaveBeenCalled();
    expect(getAggregates).not.toHaveBeenCalled();
  });

  test("a caller who may not read connections: no", async () => {
    jest
      .spyOn(NetworkControllerConnectionService, "findBy")
      .mockRejectedValue(new NotAuthorizedException("no") as never);

    expect((await build()).isAvailable).toBe(false);
  });

  test("the whole network's page: yes as soon as there is a connection, read or not", async () => {
    freshness = { lastUplinkAt: null, lastAnalyticsAt: null };

    const summary: NetworkTrafficUsageSummary = await build();

    expect(summary.isAvailable).toBe(true);
    expect(summary.connections).toHaveLength(1);
  });

  test("a device's page: only when a connection read traffic of it", async () => {
    jest
      .spyOn(NetworkDeviceService, "findOneBy")
      .mockResolvedValue(new NetworkDevice(MX) as never);
    freshness = { lastUplinkAt: null, lastAnalyticsAt: null };

    expect((await build({ networkDeviceId: MX })).isAvailable).toBe(false);
    expect(getAggregates).not.toHaveBeenCalled();

    freshness = {
      lastUplinkAt: "2026-10-24T11:55:00.000Z",
      lastAnalyticsAt: null,
    };
    expect((await build({ networkDeviceId: MX })).isAvailable).toBe(true);
  });
});

describe("whose traffic a page reads", () => {
  test("a device's page reads that device only, looked up with the caller's own props", async () => {
    const findOne: MockFunction = jest
      .spyOn(NetworkDeviceService, "findOneBy")
      .mockResolvedValue(
        new NetworkDevice(MX) as never,
      ) as unknown as MockFunction;

    await build({ networkDeviceId: MX });

    expect(idsOf(queryOf().devices)).toEqual([MX.toString()]);
    expect(
      idsOf(
        (getFreshness.mock.calls[0]![0] as { devices: TelemetryServiceFilter })
          .devices,
      ),
    ).toEqual([MX.toString()]);
    const lookup: {
      query: { projectId: ObjectID };
      props: DatabaseCommonInteractionProps;
    } = findOne.mock.calls[0]![0] as never;
    expect(lookup.query.projectId).toBe(PROJECT);
    expect(lookup.props).toBe(PROPS);
  });

  test("a device the caller cannot read is not found", async () => {
    jest
      .spyOn(NetworkDeviceService, "findOneBy")
      .mockResolvedValue(null as never);

    await expect(build({ networkDeviceId: MX })).rejects.toThrow(
      NotFoundException,
    );
  });

  test("a site's page reads the site's devices", async () => {
    jest
      .spyOn(NetworkSiteService, "findOneBy")
      .mockResolvedValue(new NetworkSite(SITE) as never);
    jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([
        new NetworkDevice(MX),
        new NetworkDevice(SWITCH),
      ] as never);

    await build({ networkSiteId: SITE });

    expect(idsOf(queryOf().devices)).toEqual([
      MX.toString(),
      SWITCH.toString(),
    ]);
  });

  test("a site with no devices reads nothing - never the whole network", async () => {
    jest
      .spyOn(NetworkSiteService, "findOneBy")
      .mockResolvedValue(new NetworkSite(SITE) as never);

    await build({ networkSiteId: SITE });

    expect(idsOf(queryOf().devices)).toEqual([
      TelemetryReadScopeUtil.NO_RESOURCE_ID,
    ]);
  });

  test("the network's page for a project-wide reader: every device and the project's bucket", async () => {
    await build();

    expect(queryOf().devices).toEqual({
      serviceIds: undefined,
      excludedServiceIds: undefined,
    });
    expect(TelemetryReadAccess.getScope).toHaveBeenCalledWith(
      NetworkTrafficUsage,
      PROPS,
    );
  });

  test("a reader limited to some devices reads those, a block left out", async () => {
    scope = { readableIds: [SWITCH.toString()], blockedIds: [MX.toString()] };

    await build();

    expect(idsOf(queryOf().devices)).toEqual([SWITCH.toString()]);
    expect(
      queryOf().devices.excludedServiceIds?.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([MX.toString()]);
  });
});

describe("the answer", () => {
  test("the uplinks' totals when there are uplinks, else the applications'", async () => {
    expect((await build()).primaryKind).toBe(NetworkTrafficUsageKind.Uplink);

    freshness = {
      lastUplinkAt: null,
      lastAnalyticsAt: "2026-10-24T10:00:00.000Z",
    };
    expect((await build()).primaryKind).toBe(
      NetworkTrafficUsageKind.Application,
    );
  });

  test("the range, its buckets and how fresh it is", async () => {
    const summary: NetworkTrafficUsageSummary = await build();

    expect(summary.windowStartAt).toBe("2026-10-24T11:00:00.000Z");
    expect(summary.windowEndAt).toBe("2026-10-24T12:00:00.000Z");
    expect(summary.bucketSeconds).toBe(300);
    expect(summary.lastUplinkAt).toBe("2026-10-24T11:55:00.000Z");
    expect(summary.totals).toEqual({
      sentOctets: 10,
      receivedOctets: 20,
      flows: 0,
    });
  });

  test("each connection's status, its first warning when it read in part - never its key", async () => {
    connections = [
      connection({
        lastPullResult: {
          status: "partial",
          organizationName: "Acme Retail (EMEA)",
          warnings: ["Traffic analysis is off on 3 networks."],
        },
      }),
      connection({
        name: "Failing",
        lastError:
          "Meraki answered the organization with HTTP 401: Invalid API key",
        lastSuccessfulPullAt: new Date("2026-10-24T10:00:00.000Z"),
      }),
    ];

    const summary: NetworkTrafficUsageSummary = await build();
    const [partial, failing]: Array<NetworkTrafficUsageConnection> =
      summary.connections;

    expect(partial).toMatchObject({
      name: "Acme Retail",
      provider: "meraki",
      organizationName: "Acme Retail (EMEA)",
      status: NetworkControllerConnectionStatus.Partial,
      readIntervalInMinutes: 5,
      warning: "Traffic analysis is off on 3 networks.",
      lastPulledAt: "2026-10-24T11:58:00.000Z",
    });
    expect(failing!.status).toBe(NetworkControllerConnectionStatus.Failing);
    expect(failing!.lastError).toBe(
      "Meraki answered the organization with HTTP 401: Invalid API key",
    );
    expect(JSON.stringify(summary)).not.toContain(
      "0123456789abcdef0123456789abcdef01234567",
    );
    expect(JSON.stringify(summary.connections)).not.toContain("secrets");
  });

  test("a read that ran out of time says so, as a timeout", async () => {
    getAggregates.mockRejectedValue(
      Object.assign(new Error("Timeout exceeded: elapsed 45 seconds"), {
        code: "159",
      }) as never,
    );
    jest
      .spyOn(NetworkTrafficUsageAggregationService, "isTimeout")
      .mockReturnValue(true);

    await expect(build()).rejects.toThrow(QueryTimeoutException);
  });

  test("a request without a project is refused", async () => {
    await expect(
      NetworkTrafficUsageSummaryUtil.build({
        props: { userId: ObjectID.generate() },
        request: request(),
        now: NOW,
      }),
    ).rejects.toThrow(BadDataException);
  });
});
