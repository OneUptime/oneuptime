import NetworkTrafficSummaryUtil, {
  ParsedNetworkTrafficRequest,
} from "../../../../Server/Utils/NetworkFlow/NetworkTrafficSummary";
import NetworkTrafficAggregationService, {
  NetworkTrafficAggregates,
  NetworkTrafficQuery,
} from "../../../../Server/Services/NetworkTrafficAggregationService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkInterfaceService from "../../../../Server/Services/NetworkInterfaceService";
import NetworkSiteService from "../../../../Server/Services/NetworkSiteService";
import TelemetryReadAccess from "../../../../Server/Utils/Telemetry/TelemetryReadAccess";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
  TelemetryServiceFilter,
} from "../../../../Server/Utils/Telemetry/TelemetryReadScope";
import NetworkFlow from "../../../../Models/AnalyticsModels/NetworkFlow";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkInterface from "../../../../Models/DatabaseModels/NetworkInterface";
import NetworkSite from "../../../../Models/DatabaseModels/NetworkSite";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import TimeoutException from "../../../../Types/Exception/TimeoutException";
import { NetworkTrafficSummary } from "../../../../Types/NetFlow/NetworkTraffic";
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
 * Whose flows a Traffic page reads, decided before any SQL: a device's page
 * needs a device the caller can read, a site's page reads the site's
 * devices (and nothing for a site with none - never "everything"), the
 * network's page reads every device the caller can read; and the caller's
 * read scope applies on top in every case. Then the answer: device names,
 * interface names, the unknown exporters stripped of the project ID that
 * stands in for a device.
 */

const PROJECT: ObjectID = ObjectID.generate();
const ROUTER: ObjectID = ObjectID.generate();
const SWITCH: ObjectID = ObjectID.generate();
const SITE: ObjectID = ObjectID.generate();
const NOW: Date = new Date("2026-09-01T12:00:00.000Z");

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT,
  userId: ObjectID.generate(),
};

function emptyAggregates(): NetworkTrafficAggregates {
  return {
    totals: { octets: 0, packets: 0, flows: 0 },
    maxSamplingRate: 1,
    bucketSeconds: 60,
    series: [],
    topSources: [],
    topDestinations: [],
    topConversations: [],
    topApplications: [],
    topInterfaces: [],
    topDevices: [],
  };
}

function request(
  overrides: Partial<ParsedNetworkTrafficRequest> = {},
): ParsedNetworkTrafficRequest {
  return {
    networkDeviceId: null,
    networkSiteId: null,
    startTime: new Date("2026-09-01T11:00:00.000Z"),
    endTime: NOW,
    filters: {},
    ...overrides,
  };
}

let getAggregates: MockFunction;
let getSources: MockFunction;
let getLastFlowAt: MockFunction;
let scope: TelemetryReadScope;

beforeEach(() => {
  scope = TelemetryReadScopeUtil.getUnrestrictedScope();

  jest
    .spyOn(TelemetryReadAccess, "getScope")
    .mockImplementation(async (): Promise<TelemetryReadScope> => {
      return scope;
    });

  getAggregates = jest
    .spyOn(NetworkTrafficAggregationService, "getAggregates")
    .mockResolvedValue(emptyAggregates() as never) as unknown as MockFunction;
  getSources = jest
    .spyOn(NetworkTrafficAggregationService, "getSources")
    .mockResolvedValue([] as never) as unknown as MockFunction;
  getLastFlowAt = jest
    .spyOn(NetworkTrafficAggregationService, "getLastFlowAt")
    .mockResolvedValue(null as never) as unknown as MockFunction;

  jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(NetworkInterfaceService, "findBy")
    .mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function queryOf(mock: MockFunction): NetworkTrafficQuery {
  return (
    mock.mock.calls[0]![0] as { query: NetworkTrafficQuery }
  ).query;
}

function deviceFilterOf(mock: MockFunction): TelemetryServiceFilter {
  return queryOf(mock).devices;
}

function idsOf(filter: TelemetryServiceFilter): Array<string> | undefined {
  return filter.serviceIds?.map((id: ObjectID): string => {
    return id.toString();
  });
}

describe("NetworkTrafficSummaryUtil.parseRequest", () => {
  test("defaults to the past hour, ending now", () => {
    const parsed: ParsedNetworkTrafficRequest =
      NetworkTrafficSummaryUtil.parseRequest({}, NOW);

    expect(parsed.endTime).toEqual(NOW);
    expect(parsed.startTime).toEqual(new Date("2026-09-01T11:00:00.000Z"));
    expect(parsed.networkDeviceId).toBeNull();
    expect(parsed.networkSiteId).toBeNull();
    expect(parsed.filters).toEqual({});
  });

  test("reads a device's page and its filters", () => {
    const parsed: ParsedNetworkTrafficRequest =
      NetworkTrafficSummaryUtil.parseRequest(
        {
          networkDeviceId: ROUTER.toString(),
          startTime: "2026-09-01T10:00:00.000Z",
          endTime: "2026-09-01T10:30:00.000Z",
          filters: { hostIp: "10.0.0.5", port: 443, protocolNumber: 6 },
        },
        NOW,
      );

    expect(parsed.networkDeviceId?.toString()).toBe(ROUTER.toString());
    expect(parsed.filters).toEqual({
      hostIp: "10.0.0.5",
      port: 443,
      protocolNumber: 6,
    });
  });

  test.each([
    ["a device and a site at once", { networkDeviceId: ROUTER.toString(), networkSiteId: SITE.toString() }],
    ["a device ID that is not one", { networkDeviceId: "router-1" }],
    ["a site ID that is not one", { networkSiteId: 42 }],
    ["an end before the start", { startTime: "2026-09-01T11:00:00Z", endTime: "2026-09-01T10:00:00Z" }],
    ["a window longer than the retention", { startTime: "2026-07-01T00:00:00Z", endTime: "2026-09-01T00:00:00Z" }],
    ["a date that is not one", { startTime: "last tuesday" }],
    ["a date that is not text", { endTime: 1767225600000 }],
    ["a filter that is not well formed", { filters: { sourceIp: "router-1" } }],
  ])("refuses %s", (_name: string, body: Record<string, unknown>) => {
    expect(() => {
      return NetworkTrafficSummaryUtil.parseRequest(body, NOW);
    }).toThrow(BadDataException);
  });
});

describe("NetworkTrafficSummaryUtil.build: whose flows", () => {
  test("a device's page reads that device only, its interfaces, and when it last sent", async () => {
    const router: NetworkDevice = new NetworkDevice(ROUTER);
    jest
      .spyOn(NetworkDeviceService, "findOneBy")
      .mockResolvedValue(router as never);

    await NetworkTrafficSummaryUtil.build({
      props: PROPS,
      request: request({ networkDeviceId: ROUTER }),
      now: NOW,
    });

    expect(idsOf(deviceFilterOf(getAggregates))).toEqual([ROUTER.toString()]);
    expect(
      (getAggregates.mock.calls[0]![0] as { includeInterfaces: boolean })
        .includeInterfaces,
    ).toBe(true);
    expect(
      (getAggregates.mock.calls[0]![0] as { includeDevices: boolean })
        .includeDevices,
    ).toBe(false);
    expect(getLastFlowAt).toHaveBeenCalledTimes(1);
  });

  test("a device the caller cannot read, or of another project, is not found", async () => {
    const findOne: MockFunction = jest
      .spyOn(NetworkDeviceService, "findOneBy")
      .mockResolvedValue(null as never) as unknown as MockFunction;

    await expect(
      NetworkTrafficSummaryUtil.build({
        props: PROPS,
        request: request({ networkDeviceId: ROUTER }),
        now: NOW,
      }),
    ).rejects.toThrow(NotFoundException);

    // Looked up in the caller's project, with the caller's own props.
    const lookup: {
      query: { projectId: ObjectID };
      props: DatabaseCommonInteractionProps;
    } = findOne.mock.calls[0]![0] as {
      query: { projectId: ObjectID };
      props: DatabaseCommonInteractionProps;
    };
    expect(lookup.query.projectId).toBe(PROJECT);
    expect(lookup.props).toBe(PROPS);
    expect(getAggregates).not.toHaveBeenCalled();
  });

  test("a site's page reads the site's devices, through the caller's props", async () => {
    jest
      .spyOn(NetworkSiteService, "findOneBy")
      .mockResolvedValue(new NetworkSite(SITE) as never);
    const findBy: MockFunction = jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([
        new NetworkDevice(ROUTER),
        new NetworkDevice(SWITCH),
      ] as never) as unknown as MockFunction;

    await NetworkTrafficSummaryUtil.build({
      props: PROPS,
      request: request({ networkSiteId: SITE }),
      now: NOW,
    });

    expect(idsOf(deviceFilterOf(getAggregates))).toEqual([
      ROUTER.toString(),
      SWITCH.toString(),
    ]);

    const siteDevices: {
      query: { siteId: ObjectID; projectId: ObjectID };
      props: DatabaseCommonInteractionProps;
    } = findBy.mock.calls[0]![0] as {
      query: { siteId: ObjectID; projectId: ObjectID };
      props: DatabaseCommonInteractionProps;
    };
    expect(siteDevices.query.siteId).toBe(SITE);
    expect(siteDevices.query.projectId).toBe(PROJECT);
    expect(siteDevices.props).toBe(PROPS);
  });

  test("a site with no devices reads nothing - never the whole network", async () => {
    jest
      .spyOn(NetworkSiteService, "findOneBy")
      .mockResolvedValue(new NetworkSite(SITE) as never);

    await NetworkTrafficSummaryUtil.build({
      props: PROPS,
      request: request({ networkSiteId: SITE }),
      now: NOW,
    });

    expect(idsOf(deviceFilterOf(getAggregates))).toEqual([
      TelemetryReadScopeUtil.NO_RESOURCE_ID,
    ]);
    // The list of who is sending is held to the same (empty) set.
    expect(
      idsOf(
        (getSources.mock.calls[0]![0] as { devices: TelemetryServiceFilter })
          .devices,
      ),
    ).toEqual([TelemetryReadScopeUtil.NO_RESOURCE_ID]);
  });

  test("a site the caller cannot read is not found", async () => {
    jest.spyOn(NetworkSiteService, "findOneBy").mockResolvedValue(null as never);

    await expect(
      NetworkTrafficSummaryUtil.build({
        props: PROPS,
        request: request({ networkSiteId: SITE }),
        now: NOW,
      }),
    ).rejects.toThrow(NotFoundException);
  });

  test("the network's page for a project-wide reader reads every device, with no list", async () => {
    await NetworkTrafficSummaryUtil.build({
      props: PROPS,
      request: request(),
      now: NOW,
    });

    expect(deviceFilterOf(getAggregates)).toEqual({
      serviceIds: undefined,
      excludedServiceIds: undefined,
    });
    expect(TelemetryReadAccess.getScope).toHaveBeenCalledWith(
      NetworkFlow,
      PROPS,
    );
  });

  test("a reader limited to some devices reads those, and a block is left out", async () => {
    scope = { readableIds: [SWITCH.toString()], blockedIds: [ROUTER.toString()] };

    await NetworkTrafficSummaryUtil.build({
      props: PROPS,
      request: request(),
      now: NOW,
    });

    const filter: TelemetryServiceFilter = deviceFilterOf(getAggregates);
    expect(idsOf(filter)).toEqual([SWITCH.toString()]);
    expect(
      filter.excludedServiceIds?.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([ROUTER.toString()]);
  });

  test("on a device's page, a device outside the caller's scope reads nothing", async () => {
    scope = { readableIds: [SWITCH.toString()], blockedIds: [] };
    jest
      .spyOn(NetworkDeviceService, "findOneBy")
      .mockResolvedValue(new NetworkDevice(ROUTER) as never);

    await NetworkTrafficSummaryUtil.build({
      props: PROPS,
      request: request({ networkDeviceId: ROUTER }),
      now: NOW,
    });

    expect(idsOf(deviceFilterOf(getAggregates))).toEqual([
      TelemetryReadScopeUtil.NO_RESOURCE_ID,
    ]);
  });

  test("without a project there is nothing to read", async () => {
    await expect(
      NetworkTrafficSummaryUtil.build({
        props: { userId: ObjectID.generate() },
        request: request(),
        now: NOW,
      }),
    ).rejects.toThrow(BadDataException);
  });
});

describe("NetworkTrafficSummaryUtil.build: the answer", () => {
  test("names devices, and gives an exporter that is no device no ID at all", async () => {
    getAggregates.mockResolvedValue({
      ...emptyAggregates(),
      topDevices: [
        { networkDeviceId: ROUTER.toString(), exporterIp: "10.0.0.1", octets: 9, packets: 1 },
        { networkDeviceId: PROJECT.toString(), exporterIp: "10.9.9.9", octets: 1, packets: 1 },
      ],
    } as never);
    getSources.mockResolvedValue([
      {
        networkDeviceId: PROJECT.toString(),
        exporterIp: "10.9.9.9",
        flowFormat: "sFlow",
        samplingRate: 1000,
        lastFlowAt: "2026-09-01 11:59:00.000000000",
        flows: 4,
        octets: 1,
      },
    ] as never);
    const router: NetworkDevice = new NetworkDevice(ROUTER);
    router.name = "Core router";
    jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([router] as never);

    const summary: NetworkTrafficSummary =
      await NetworkTrafficSummaryUtil.build({
        props: PROPS,
        request: request(),
        now: NOW,
      });

    expect(summary.topDevices).toEqual([
      {
        networkDeviceId: ROUTER.toString(),
        name: "Core router",
        exporterIp: "10.0.0.1",
        octets: 9,
        packets: 1,
      },
      { exporterIp: "10.9.9.9", octets: 1, packets: 1 },
    ]);
    expect(summary.sources[0]!.networkDeviceId).toBeUndefined();
    expect(summary.sources[0]!.exporterIp).toBe("10.9.9.9");
    expect(summary.lastFlowAt).toBeNull();
  });

  test("names a device's interfaces from its last walk, and keeps a bare index otherwise", async () => {
    jest
      .spyOn(NetworkDeviceService, "findOneBy")
      .mockResolvedValue(new NetworkDevice(ROUTER) as never);
    getAggregates.mockResolvedValue({
      ...emptyAggregates(),
      topInterfaces: [
        { interfaceIndex: 1, inOctets: 10, outOctets: 20 },
        { interfaceIndex: 9, inOctets: 1, outOctets: 2 },
      ],
    } as never);

    const walked: NetworkInterface = new NetworkInterface();
    walked.interfaceIndex = 1;
    walked.name = "GigabitEthernet0/1";
    walked.alias = "Uplink to ISP";
    walked.speedInMbps = 1000;
    const interfaceLookup: MockFunction = jest
      .spyOn(NetworkInterfaceService, "findBy")
      .mockResolvedValue([walked] as never) as unknown as MockFunction;

    const summary: NetworkTrafficSummary =
      await NetworkTrafficSummaryUtil.build({
        props: PROPS,
        request: request({ networkDeviceId: ROUTER }),
        now: NOW,
      });

    expect(summary.topInterfaces).toEqual([
      {
        interfaceIndex: 1,
        name: "GigabitEthernet0/1",
        alias: "Uplink to ISP",
        speedInMbps: 1000,
        inOctets: 10,
        outOctets: 20,
      },
      { interfaceIndex: 9, inOctets: 1, outOctets: 2 },
    ]);
    expect(
      (interfaceLookup.mock.calls[0]![0] as {
        props: DatabaseCommonInteractionProps;
      }).props,
    ).toBe(PROPS);
  });

  test("a read that ran out of time says to pick a shorter range", async () => {
    getAggregates.mockRejectedValue({ code: "159", type: "TIMEOUT_EXCEEDED" } as never);

    await expect(
      NetworkTrafficSummaryUtil.build({
        props: PROPS,
        request: request(),
        now: NOW,
      }),
    ).rejects.toThrow(TimeoutException);
  });

  test("any other failure is passed on as it is", async () => {
    getAggregates.mockRejectedValue(new Error("connection refused") as never);

    await expect(
      NetworkTrafficSummaryUtil.build({
        props: PROPS,
        request: request(),
        now: NOW,
      }),
    ).rejects.toThrow("connection refused");
  });

  test("the window and its buckets travel with the answer", async () => {
    const summary: NetworkTrafficSummary =
      await NetworkTrafficSummaryUtil.build({
        props: PROPS,
        request: request(),
        now: NOW,
      });

    expect(summary.windowStartAt).toBe("2026-09-01T11:00:00.000Z");
    expect(summary.windowEndAt).toBe("2026-09-01T12:00:00.000Z");
    expect(
      (getAggregates.mock.calls[0]![0] as { bucketSeconds: number })
        .bucketSeconds,
    ).toBe(60);
  });
});
