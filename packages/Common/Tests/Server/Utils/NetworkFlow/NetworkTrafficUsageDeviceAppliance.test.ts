import NetworkTrafficUsageSummaryUtil, {
  DeviceApplianceIdentity,
  ParsedNetworkTrafficUsageListRequest,
  ParsedNetworkTrafficUsageRequest,
} from "../../../../Server/Utils/NetworkFlow/NetworkTrafficUsageSummary";
import NetworkTrafficUsageAggregationService, {
  NetworkTrafficUsageAggregates,
  NetworkTrafficUsageApplianceRow,
  NetworkTrafficUsageFreshness,
  NetworkTrafficUsageListQuery,
} from "../../../../Server/Services/NetworkTrafficUsageAggregationService";
import NetworkControllerConnectionService from "../../../../Server/Services/NetworkControllerConnectionService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import NetworkSiteService from "../../../../Server/Services/NetworkSiteService";
import TelemetryReadAccess from "../../../../Server/Utils/Telemetry/TelemetryReadAccess";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
  TelemetryServiceFilter,
} from "../../../../Server/Utils/Telemetry/TelemetryReadScope";
import NetworkControllerConnection from "../../../../Models/DatabaseModels/NetworkControllerConnection";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import NetworkSite from "../../../../Models/DatabaseModels/NetworkSite";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import QueryTimeoutException from "../../../../Types/Exception/QueryTimeoutException";
import {
  NetworkTrafficUsageApplianceLinkStatus,
  NetworkTrafficUsageDeviceAppliance,
  NetworkTrafficUsageKind,
  NetworkTrafficUsageListKind,
  NetworkTrafficUsageListResult,
  NetworkTrafficUsageListSort,
  NetworkTrafficUsageSummary,
  NetworkTrafficUsageUplinkRow,
} from "../../../../Types/NetFlow/NetworkTrafficUsage";
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
 * A device's Traffic page and the Meraki appliance it is (OneUptime issue
 * #5762): a router added by hand at its WAN address has nothing that ties
 * it to its appliance, and its page used to have no Meraki side and say
 * nothing. Now the summary says which appliance a device is - its traffic
 * filed under it, or about to be - or that it is none yet, so the page can
 * offer to link it. A device Meraki says is a switch gets no Meraki side.
 *
 * And the page's whole lists (usage-list): read under the summary's own
 * rules of whose traffic it is.
 */

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
const ROUTER: ObjectID = new ObjectID("40000000-0000-4000-8000-000000000002");
const SITE: ObjectID = new ObjectID("50000000-0000-4000-8000-000000000001");
const NOW: Date = new Date("2026-10-24T12:00:00.000Z");

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT,
  userId: new ObjectID("60000000-0000-4000-8000-000000000001"),
};

function identity(
  overrides: Partial<DeviceApplianceIdentity> = {},
): DeviceApplianceIdentity {
  return {
    serialNumber: "",
    controllerSerial: "",
    controllerName: "",
    controllerNetworkName: "",
    controllerProductType: "",
    ...overrides,
  };
}

function uplink(
  overrides: Partial<NetworkTrafficUsageUplinkRow> = {},
): NetworkTrafficUsageUplinkRow {
  return {
    deviceSerial: "Q2PN-LDS0-0012",
    deviceName: "LDS MX68",
    controllerNetworkId: "L_12",
    controllerNetworkName: "Branch 012",
    interfaceName: "wan1",
    sentOctets: 1,
    receivedOctets: 2,
    ...overrides,
  };
}

function applianceRow(
  overrides: Partial<NetworkTrafficUsageApplianceRow> = {},
): NetworkTrafficUsageApplianceRow {
  return {
    serial: "Q2PN-LDS0-0012",
    name: "LDS MX68",
    controllerNetworkId: "L_12",
    controllerNetworkName: "Branch 012",
    connectionId: "20000000-0000-4000-8000-000000000001",
    networkDeviceId: PROJECT.toString(),
    lastWindowEndAt: "2026-10-24T11:55:00.000Z",
    octets: 100,
    ...overrides,
  };
}

describe("which appliance a device is, from what is known of it", () => {
  test("traffic filed under it: the appliance of its busiest uplink, linked by the serial number on it", () => {
    expect(
      NetworkTrafficUsageSummaryUtil.getDeviceAppliance({
        identity: identity({ serialNumber: "Q2PN-LDS0-0012" }),
        hasFiledTraffic: true,
        uplinks: [uplink()],
        known: [],
      }),
    ).toEqual({
      status: NetworkTrafficUsageApplianceLinkStatus.Linked,
      serial: "Q2PN-LDS0-0012",
      name: "LDS MX68",
      controllerNetworkName: "Branch 012",
      isLinkedBySerialNumber: true,
    });
  });

  test("matched another way (its MAC, Meraki's record): linked, but nothing for Unlink to take off", () => {
    expect(
      NetworkTrafficUsageSummaryUtil.getDeviceAppliance({
        identity: identity({ controllerSerial: "Q2PN-LDS0-0012" }),
        hasFiledTraffic: true,
        uplinks: [uplink()],
        known: [],
      })?.isLinkedBySerialNumber,
    ).toBe(false);
  });

  test("traffic filed but no uplink in the range: what its serial number or Meraki's record says", () => {
    expect(
      NetworkTrafficUsageSummaryUtil.getDeviceAppliance({
        identity: identity({
          controllerSerial: "Q2PN-LDS0-0012",
          controllerName: "LDS MX68",
          controllerNetworkName: "Branch 012",
        }),
        hasFiledTraffic: true,
        uplinks: [],
        known: [],
      }),
    ).toEqual({
      status: NetworkTrafficUsageApplianceLinkStatus.Linked,
      serial: "Q2PN-LDS0-0012",
      name: "LDS MX68",
      controllerNetworkName: "Branch 012",
      isLinkedBySerialNumber: false,
    });
  });

  test("nothing filed yet, but its serial number is an appliance the connections report: linked, its traffic to come", () => {
    const appliance: NetworkTrafficUsageDeviceAppliance | undefined =
      NetworkTrafficUsageSummaryUtil.getDeviceAppliance({
        identity: identity({ serialNumber: "Q2PN-LDS0-0012" }),
        hasFiledTraffic: false,
        uplinks: [],
        known: [applianceRow({ serial: "q2pn-lds0-0012" })],
      });

    expect(appliance?.status).toBe(
      NetworkTrafficUsageApplianceLinkStatus.Linked,
    );
    expect(appliance?.serial).toBe("Q2PN-LDS0-0012");
    expect(appliance?.isLinkedBySerialNumber).toBe(true);
  });

  test("nothing filed, nothing known, no serial number: not linked - the page offers to link it", () => {
    expect(
      NetworkTrafficUsageSummaryUtil.getDeviceAppliance({
        identity: identity(),
        hasFiledTraffic: false,
        uplinks: [],
        known: [],
      }),
    ).toEqual({ status: NetworkTrafficUsageApplianceLinkStatus.Unlinked });
  });

  /*
   * The bug the UI review found: a switch of another make, its serial
   * number read from its walk, was offered "Link to a Meraki appliance" -
   * and every link was refused ("This device has the serial number ...
   * already"), with nothing on the page to unlink.
   */
  test("a serial number of its own that no connection reported: no Meraki side - a link would be refused", () => {
    expect(
      NetworkTrafficUsageSummaryUtil.getDeviceAppliance({
        identity: identity({ serialNumber: "FOC1932X0K1" }),
        hasFiledTraffic: false,
        uplinks: [],
        known: [],
      }),
    ).toBeUndefined();

    // Meraki's own record of it names an appliance it could be: still none.
    expect(
      NetworkTrafficUsageSummaryUtil.getDeviceAppliance({
        identity: identity({
          serialNumber: "FOC1932X0K1",
          controllerSerial: "Q2PN-LDS0-0012",
          controllerProductType: "appliance",
        }),
        hasFiledTraffic: false,
        uplinks: [],
        known: [],
      }),
    ).toBeUndefined();
  });

  test("Meraki's record alone, with no serial number on the device, is still offered to link", () => {
    expect(
      NetworkTrafficUsageSummaryUtil.getDeviceAppliance({
        identity: identity({
          controllerSerial: "Q2PN-LDS0-0012",
          controllerProductType: "appliance",
        }),
        hasFiledTraffic: false,
        uplinks: [],
        known: [],
      }),
    ).toEqual({ status: NetworkTrafficUsageApplianceLinkStatus.Unlinked });
  });

  test("traffic filed under it keeps a device linked, whatever serial number it has", () => {
    expect(
      NetworkTrafficUsageSummaryUtil.getDeviceAppliance({
        identity: identity({ serialNumber: "FOC1932X0K1" }),
        hasFiledTraffic: true,
        uplinks: [uplink()],
        known: [],
      })?.status,
    ).toBe(NetworkTrafficUsageApplianceLinkStatus.Linked);
  });

  test.each([["switch"], ["wireless"], ["camera"], ["sensor"]])(
    "a device Meraki says is a %s gets no Meraki side: its traffic is its network's appliance's",
    (productType: string) => {
      expect(
        NetworkTrafficUsageSummaryUtil.getDeviceAppliance({
          identity: identity({ controllerProductType: productType }),
          hasFiledTraffic: false,
          uplinks: [],
          known: [],
        }),
      ).toBeUndefined();
    },
  );

  test("an appliance Meraki knows, and a device Meraki knows nothing of, are offered alike", () => {
    expect(
      NetworkTrafficUsageSummaryUtil.isOtherKindOfDevice(
        identity({ controllerProductType: "appliance" }),
      ),
    ).toBe(false);
    expect(NetworkTrafficUsageSummaryUtil.isOtherKindOfDevice(identity())).toBe(
      false,
    );
  });
});

describe("what a device says about the appliance it may be", () => {
  test("the serial number on it and Meraki's record of it, serials in upper case", () => {
    const device: NetworkDevice = new NetworkDevice(ROUTER);
    device.serialNumber = " q2pn-lds0-0012 ";
    device.discoveredDetails = {
      controller: {
        provider: NetworkControllerProvider.Meraki,
        readBy: {
          type: "networkController",
          id: "20000000-0000-4000-8000-000000000001",
          name: "Acme Networks",
        },
        readAt: "2026-10-24T11:00:00.000Z",
        values: {
          serialNumber: "q2pn-lds0-0012",
          name: "LDS MX68",
          networkName: "Branch 012",
          productType: "appliance",
        },
      },
    };

    expect(NetworkTrafficUsageSummaryUtil.toDeviceIdentity(device)).toEqual({
      serialNumber: "Q2PN-LDS0-0012",
      controllerSerial: "Q2PN-LDS0-0012",
      controllerName: "LDS MX68",
      controllerNetworkName: "Branch 012",
      controllerProductType: "appliance",
    });
  });

  test("nothing, or garbage, says nothing", () => {
    const device: NetworkDevice = new NetworkDevice(ROUTER);
    device.discoveredDetails = { controller: "garbage" };

    expect(NetworkTrafficUsageSummaryUtil.toDeviceIdentity(device)).toEqual(
      identity(),
    );
    expect(NetworkTrafficUsageSummaryUtil.toDeviceIdentity(null)).toEqual(
      identity(),
    );
  });
});

function emptyAggregates(): NetworkTrafficUsageAggregates {
  return {
    primaryKind: NetworkTrafficUsageKind.Uplink,
    totals: { sentOctets: 10, receivedOctets: 20, flows: 0 },
    applicationTotals: { sentOctets: 0, receivedOctets: 0 },
    clientTotals: { sentOctets: 0, receivedOctets: 0 },
    series: [],
    topNetworks: [],
    topUplinks: [],
    topApplications: [],
    uplinkInterfaces: [],
    uplinkSeries: [],
    topDestinations: [],
    topClients: [],
    topConversations: [],
    networkCount: 1205,
    applicationCount: 347,
    clientCount: 8644,
  };
}

function connection(): NetworkControllerConnection {
  const value: NetworkControllerConnection = new NetworkControllerConnection();
  value.id = new ObjectID("20000000-0000-4000-8000-000000000001");
  value.name = "Acme Networks";
  value.provider = NetworkControllerProvider.Meraki;
  value.config = {
    region: "global",
    organizationId: "549236",
    organizationName: "Acme Networks",
    readIntervalInMinutes: 5,
  };
  value.isEnabled = true;
  value.createdAt = new Date("2026-10-20T00:00:00.000Z");
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

describe("a device's page in a project that reads Meraki", () => {
  let connections: Array<NetworkControllerConnection>;
  let freshness: NetworkTrafficUsageFreshness;
  let aggregates: NetworkTrafficUsageAggregates;
  let device: NetworkDevice;
  let deviceLookups: Array<{ select: unknown; props: unknown }>;
  let getAppliances: MockFunction;
  let known: Array<NetworkTrafficUsageApplianceRow>;

  beforeEach(() => {
    connections = [connection()];
    freshness = {
      lastUplinkAt: null,
      lastAnalyticsAt: null,
      uplinkEnds: new Map(),
    };
    aggregates = emptyAggregates();
    device = new NetworkDevice(ROUTER);
    deviceLookups = [];
    known = [];

    jest
      .spyOn(NetworkControllerConnectionService, "findBy")
      .mockImplementation((async () => {
        return connections;
      }) as never);
    jest
      .spyOn(TelemetryReadAccess, "getScope")
      .mockImplementation(async (): Promise<TelemetryReadScope> => {
        return TelemetryReadScopeUtil.getUnrestrictedScope();
      });
    jest
      .spyOn(NetworkDeviceService, "findOneBy")
      .mockImplementation((async (data: {
        select: unknown;
        props: unknown;
      }) => {
        deviceLookups.push({ select: data.select, props: data.props });
        return device;
      }) as never);
    jest
      .spyOn(NetworkTrafficUsageAggregationService, "getFreshness")
      .mockImplementation((async () => {
        return freshness;
      }) as never);
    jest
      .spyOn(NetworkTrafficUsageAggregationService, "getAggregates")
      .mockImplementation((async () => {
        return aggregates;
      }) as never);
    getAppliances = jest
      .spyOn(NetworkTrafficUsageAggregationService, "getAppliances")
      .mockImplementation((async () => {
        return known;
      }) as never) as unknown as MockFunction;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function build(
    overrides: Partial<ParsedNetworkTrafficUsageRequest> = {},
  ): Promise<NetworkTrafficUsageSummary> {
    return await NetworkTrafficUsageSummaryUtil.build({
      props: PROPS,
      request: request({ networkDeviceId: ROUTER, ...overrides }),
      now: NOW,
    });
  }

  test("a router added by hand, no traffic of it read: no traffic, and not linked - never silent", async () => {
    const summary: NetworkTrafficUsageSummary = await build();

    expect(summary.isAvailable).toBe(false);
    expect(summary.deviceAppliance).toEqual({
      status: NetworkTrafficUsageApplianceLinkStatus.Unlinked,
    });
    // No serial number to look for: the appliances are not asked.
    expect(getAppliances).not.toHaveBeenCalled();
  });

  test("the caller's own read finds the device first; what it is is read as the server", async () => {
    await build();

    expect(deviceLookups[0]!.props).toBe(PROPS);
    expect(deviceLookups[0]!.select).toEqual({ _id: true });
    expect(deviceLookups[1]!.props).toEqual({ isRoot: true });
    expect(deviceLookups[1]!.select).toEqual({
      _id: true,
      serialNumber: true,
      discoveredDetails: true,
    });
  });

  test("a device linked a moment ago: linked, its traffic to come - the appliances asked for its serial alone", async () => {
    device.serialNumber = "Q2PN-LDS0-0012";
    known = [applianceRow()];

    const summary: NetworkTrafficUsageSummary = await build();

    expect(summary.isAvailable).toBe(false);
    expect(summary.deviceAppliance).toEqual({
      status: NetworkTrafficUsageApplianceLinkStatus.Linked,
      serial: "Q2PN-LDS0-0012",
      name: "LDS MX68",
      controllerNetworkName: "Branch 012",
      isLinkedBySerialNumber: true,
    });

    const asked: {
      serials: Array<string>;
      since: Date;
      limit: number;
      devices: TelemetryServiceFilter;
    } = getAppliances.mock.calls[0]![0] as never;

    expect(asked.serials).toEqual(["Q2PN-LDS0-0012"]);
    expect(asked.limit).toBe(1);
    expect(asked.since.toISOString()).toBe("2026-10-17T12:00:00.000Z");
    // The caller's scope of the whole project: the bucket the appliance's rows are in.
    expect(asked.devices.serviceIds).toBeUndefined();
  });

  test("a device of another make, its serial number read from its walk: no Meraki side, after asking for that serial alone", async () => {
    device.serialNumber = "FOC1932X0K1";
    known = [];

    const summary: NetworkTrafficUsageSummary = await build();

    expect(summary.isAvailable).toBe(false);
    expect(summary.deviceAppliance).toBeUndefined();
    expect(getAppliances).toHaveBeenCalledTimes(1);
    expect(
      (getAppliances.mock.calls[0]![0] as { serials: Array<string> }).serials,
    ).toEqual(["FOC1932X0K1"]);
  });

  test("a device Meraki says is a switch: no Meraki side at all", async () => {
    device.discoveredDetails = {
      controller: {
        provider: NetworkControllerProvider.Meraki,
        readBy: {
          type: "networkController",
          id: "20000000-0000-4000-8000-000000000001",
          name: "Acme Networks",
        },
        readAt: "2026-10-24T11:00:00.000Z",
        values: { serialNumber: "Q2PN-SW00-0001", productType: "switch" },
      },
    };

    const summary: NetworkTrafficUsageSummary = await build();

    expect(summary.isAvailable).toBe(false);
    expect(summary.deviceAppliance).toBeUndefined();
    expect(getAppliances).not.toHaveBeenCalled();
  });

  test("a project that reads no Meraki: nothing about appliances", async () => {
    connections = [];

    const summary: NetworkTrafficUsageSummary = await build();

    expect(summary.isAvailable).toBe(false);
    expect(summary.deviceAppliance).toBeUndefined();
    expect(deviceLookups).toHaveLength(0);
  });

  test("a linked device with traffic: its traffic, and which appliance it is over it", async () => {
    device.serialNumber = "Q2PN-LDS0-0012";
    freshness = {
      lastUplinkAt: "2026-10-24T11:55:00.000Z",
      lastAnalyticsAt: null,
      uplinkEnds: new Map(),
    };
    aggregates = { ...emptyAggregates(), topUplinks: [uplink()] };

    const summary: NetworkTrafficUsageSummary = await build();

    expect(summary.isAvailable).toBe(true);
    expect(summary.deviceAppliance).toEqual({
      status: NetworkTrafficUsageApplianceLinkStatus.Linked,
      serial: "Q2PN-LDS0-0012",
      name: "LDS MX68",
      controllerNetworkName: "Branch 012",
      isLinkedBySerialNumber: true,
    });
  });

  test("the lists' counts come through as they were read", async () => {
    freshness = {
      lastUplinkAt: "2026-10-24T11:55:00.000Z",
      lastAnalyticsAt: null,
      uplinkEnds: new Map(),
    };

    const summary: NetworkTrafficUsageSummary =
      await NetworkTrafficUsageSummaryUtil.build({
        props: PROPS,
        request: request(),
        now: NOW,
      });

    expect(summary.networkCount).toBe(1205);
    expect(summary.applicationCount).toBe(347);
    expect(summary.clientCount).toBe(8644);
    // The network's page names no appliance.
    expect(summary.deviceAppliance).toBeUndefined();
  });

  test("a site's page names no appliance either", async () => {
    jest
      .spyOn(NetworkSiteService, "findOneBy")
      .mockResolvedValue(new NetworkSite(SITE) as never);
    jest
      .spyOn(NetworkDeviceService, "findBy")
      .mockResolvedValue([new NetworkDevice(ROUTER)] as never);

    const summary: NetworkTrafficUsageSummary =
      await NetworkTrafficUsageSummaryUtil.build({
        props: PROPS,
        request: request({ networkSiteId: SITE }),
        now: NOW,
      });

    expect(summary.isAvailable).toBe(false);
    expect(summary.deviceAppliance).toBeUndefined();
  });
});

describe("a page of a whole list", () => {
  test("the page's request with which list, the search, the sort and the page", () => {
    const parsed: ParsedNetworkTrafficUsageListRequest =
      NetworkTrafficUsageSummaryUtil.parseListRequest(
        {
          networkSiteId: SITE.toString(),
          startTime: "2026-10-24T10:00:00.000Z",
          endTime: "2026-10-24T12:00:00.000Z",
          filters: { interfaceName: "wan2" },
          list: "networks",
          primaryKind: "application",
          search: " Store ",
          sortBy: "out",
          skip: 25,
          limit: 50,
        },
        NOW,
      );

    expect(parsed.networkSiteId?.toString()).toBe(SITE.toString());
    expect(parsed.filters).toEqual({ interfaceName: "wan2" });
    expect(parsed.list).toBe(NetworkTrafficUsageListKind.Networks);
    expect(parsed.primaryKind).toBe(NetworkTrafficUsageKind.Application);
    expect(parsed.search).toBe("Store");
    expect(parsed.sortBy).toBe(NetworkTrafficUsageListSort.Out);
    expect(parsed.skip).toBe(25);
    expect(parsed.limit).toBe(50);
  });

  test.each([
    [{ list: "uplinks" }],
    [{ list: "networks", sortBy: "name" }],
    [{ list: "networks", limit: 1000 }],
    [{ list: "networks", networkDeviceId: "device-1" }],
    [{ list: "networks", filters: { controllerNetworkId: "L_1' --" } }],
  ])("%p is refused", (body: unknown) => {
    expect(() => {
      return NetworkTrafficUsageSummaryUtil.parseListRequest(body, NOW);
    }).toThrow(BadDataException);
  });

  describe("as read", () => {
    let getList: MockFunction;
    let connections: Array<NetworkControllerConnection>;

    beforeEach(() => {
      connections = [connection()];

      jest
        .spyOn(NetworkControllerConnectionService, "findBy")
        .mockImplementation((async () => {
          return connections;
        }) as never);
      jest
        .spyOn(TelemetryReadAccess, "getScope")
        .mockImplementation(async (): Promise<TelemetryReadScope> => {
          return TelemetryReadScopeUtil.getUnrestrictedScope();
        });
      getList = jest
        .spyOn(NetworkTrafficUsageAggregationService, "getList")
        .mockImplementation((async (data: NetworkTrafficUsageListQuery) => {
          return {
            list: data.list,
            count: 1,
            networks: [],
            applications: [],
            clients: [],
          };
        }) as never) as unknown as MockFunction;
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    function listRequest(
      overrides: Partial<ParsedNetworkTrafficUsageListRequest> = {},
    ): ParsedNetworkTrafficUsageListRequest {
      return {
        ...request(),
        list: NetworkTrafficUsageListKind.Clients,
        primaryKind: NetworkTrafficUsageKind.Uplink,
        search: "pos",
        sortBy: NetworkTrafficUsageListSort.In,
        skip: 25,
        limit: 25,
        ...overrides,
      };
    }

    test("a device's page lists that device's rows only, as the caller may read them", async () => {
      jest
        .spyOn(NetworkDeviceService, "findOneBy")
        .mockResolvedValue(new NetworkDevice(ROUTER) as never);

      await NetworkTrafficUsageSummaryUtil.list({
        props: PROPS,
        request: listRequest({ networkDeviceId: ROUTER }),
      });

      const asked: NetworkTrafficUsageListQuery = getList.mock
        .calls[0]![0] as NetworkTrafficUsageListQuery;

      expect(
        asked.query.devices.serviceIds?.map((id: ObjectID): string => {
          return id.toString();
        }),
      ).toEqual([ROUTER.toString()]);
      expect(asked.query.projectId).toBe(PROJECT);
      expect(asked.list).toBe(NetworkTrafficUsageListKind.Clients);
      expect(asked.search).toBe("pos");
      expect(asked.sortBy).toBe(NetworkTrafficUsageListSort.In);
      expect(asked.skip).toBe(25);
      expect(asked.limit).toBe(25);
    });

    test("a device the caller cannot read is not found", async () => {
      jest
        .spyOn(NetworkDeviceService, "findOneBy")
        .mockResolvedValue(null as never);

      await expect(
        NetworkTrafficUsageSummaryUtil.list({
          props: PROPS,
          request: listRequest({ networkDeviceId: ROUTER }),
        }),
      ).rejects.toThrow(NotFoundException);
    });

    test("no connection the caller may read: the list, empty, and nothing summed", async () => {
      connections = [];

      const result: NetworkTrafficUsageListResult =
        await NetworkTrafficUsageSummaryUtil.list({
          props: PROPS,
          request: listRequest(),
        });

      expect(result).toEqual({
        list: NetworkTrafficUsageListKind.Clients,
        count: 0,
        networks: [],
        applications: [],
        clients: [],
      });
      expect(getList).not.toHaveBeenCalled();
    });

    test("a list that ran out of time says so, as a timeout", async () => {
      getList.mockImplementation((async () => {
        throw new Error("Timeout exceeded: elapsed 45 seconds");
      }) as never);
      jest
        .spyOn(NetworkTrafficUsageAggregationService, "isTimeout")
        .mockReturnValue(true);

      await expect(
        NetworkTrafficUsageSummaryUtil.list({
          props: PROPS,
          request: listRequest(),
        }),
      ).rejects.toThrow(QueryTimeoutException);
    });

    test("a request without a project is refused", async () => {
      await expect(
        NetworkTrafficUsageSummaryUtil.list({
          props: { userId: PROPS.userId },
          request: listRequest(),
        }),
      ).rejects.toThrow(BadDataException);
    });
  });
});
