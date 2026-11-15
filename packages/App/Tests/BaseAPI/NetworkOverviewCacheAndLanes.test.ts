import { mockRouter } from "Common/Tests/Server/API/Helpers";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import NetworkSiteService from "Common/Server/Services/NetworkSiteService";
import NetworkEndpointService from "Common/Server/Services/NetworkEndpointService";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import CommonAPI from "Common/Server/API/CommonAPI";
import Response from "Common/Server/Utils/Response";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkEndpoint from "Common/Models/DatabaseModels/NetworkEndpoint";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSummaryCache, {
  PROJECT_WIDE_SCOPE,
} from "Common/Server/Utils/NetworkDevice/NetworkSummaryCache";
import {
  DeviceFleetScan,
  DeviceHealthGroup,
} from "Common/Server/Utils/NetworkDevice/DeviceHealthAggregation";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import PositiveNumber from "Common/Types/PositiveNumber";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
    },
  };
});

jest.mock("Common/Server/API/CommonAPI", () => {
  return {
    __esModule: true,
    default: {
      getDatabaseCommonInteractionProps: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      countBy: jest.fn(),
      getFleetScan: jest.fn(),
      getFleetSummary: jest.fn(),
      getHealthGroups: jest.fn(),
      getVendorBreakdown: jest.fn(),
      getDeviceCountsBySite: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/NetworkSiteService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), getStatusCounts: jest.fn() },
  };
});

jest.mock("Common/Server/Services/NetworkEndpointService", () => {
  return { __esModule: true, default: { countBy: jest.fn() } };
});

jest.mock("Common/Server/Services/MonitorStatusService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

import NetworkSummaryAPI, {
  VIEW_READ_LANES,
} from "../../FeatureSet/BaseAPI/API/NetworkSummary";

/*
 * THE NETWORK OVERVIEW AND THE SUMMARY STRIPS: KEPT, SHARED, TWO READS AT A
 * TIME.
 *
 * The Overview, the Devices strip and the Sites strip are each kept for
 * half a minute per project and viewer scope (NetworkSummaryCache), built
 * once for requests that arrive together, and all three read the fleet
 * from one kept scan (NetworkDeviceService.getFleetScan). A view runs at
 * most VIEW_READ_LANES (two) of its reads at once, where the Overview used
 * to start ten. Driven here through the routes, every service observable.
 */

new NetworkSummaryAPI().getRouter();

const projectId: ObjectID = ObjectID.generate();
const otherProjectId: ObjectID = ObjectID.generate();

const commonAPI: { getDatabaseCommonInteractionProps: jest.Mock } =
  CommonAPI as unknown as { getDatabaseCommonInteractionProps: jest.Mock };
const deviceService: {
  findBy: jest.Mock;
  countBy: jest.Mock;
  getFleetScan: jest.Mock;
  getFleetSummary: jest.Mock;
  getHealthGroups: jest.Mock;
  getVendorBreakdown: jest.Mock;
} = NetworkDeviceService as unknown as {
  findBy: jest.Mock;
  countBy: jest.Mock;
  getFleetScan: jest.Mock;
  getFleetSummary: jest.Mock;
  getHealthGroups: jest.Mock;
  getVendorBreakdown: jest.Mock;
};
const siteService: { findBy: jest.Mock; getStatusCounts: jest.Mock } =
  NetworkSiteService as unknown as {
    findBy: jest.Mock;
    getStatusCounts: jest.Mock;
  };
const endpointService: { countBy: jest.Mock } =
  NetworkEndpointService as unknown as { countBy: jest.Mock };
const monitorStatusService: { findBy: jest.Mock } =
  MonitorStatusService as unknown as { findBy: jest.Mock };
const responseUtil: { sendJsonObjectResponse: jest.Mock } =
  Response as unknown as { sendJsonObjectResponse: jest.Mock };

const OFFLINE_STATUS: MonitorStatus = new MonitorStatus(ObjectID.generate());
OFFLINE_STATUS.name = "Offline";
OFFLINE_STATUS.isOperationalState = false;
OFFLINE_STATUS.isOfflineState = true;

const OPERATIONAL_STATUS: MonitorStatus = new MonitorStatus(
  ObjectID.generate(),
);
OPERATIONAL_STATUS.name = "Operational";
OPERATIONAL_STATUS.isOperationalState = true;
OPERATIONAL_STATUS.isOfflineState = false;

function bucket(overrides: Partial<DeviceHealthGroup>): DeviceHealthGroup {
  return {
    siteId: null,
    monitorStatusId: null,
    monitoringMethod: "Probe",
    isReachable: true,
    hasBeenPolled: true,
    hasBeenSeen: true,
    isStale: false,
    hasDownInterfaces: false,
    deviceCount: 1,
    interfacesDownTotal: 0,
    ...overrides,
  };
}

function fleetScan(overrides?: Partial<DeviceFleetScan>): DeviceFleetScan {
  return {
    summary: {
      devicesUp: 7,
      devicesDown: 2,
      devicesPending: 1,
      interfacesDown: 5,
      totalDevices: 10,
      devicesWithoutSite: 4,
    },
    healthGroups: [
      bucket({ isReachable: true, deviceCount: 7 }),
      bucket({
        isReachable: false,
        deviceCount: 2,
        hasDownInterfaces: true,
        interfacesDownTotal: 5,
      }),
      bucket({
        isReachable: null,
        hasBeenPolled: false,
        hasBeenSeen: false,
        deviceCount: 1,
      }),
    ],
    vendors: [
      { vendor: "Cisco", count: 4 },
      { vendor: "", count: 3 },
      { vendor: "Juniper", count: 1 },
      { vendor: "Arista", count: 1 },
      { vendor: "MikroTik", count: 1 },
      { vendor: "Zyxel", count: 1 },
      { vendor: "Fortinet", count: 1 },
    ],
    snmpFailing: 2,
    ...overrides,
  };
}

const mockResponse: ExpressResponse = {} as ExpressResponse;

async function call(path: string): Promise<NextFunction> {
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  const req: ExpressRequest = { body: {} } as unknown as ExpressRequest;
  await mockRouter.match("post", path).handlerFunction(req, mockResponse, next);
  return next;
}

function bodyOf(callIndex: number): JSONObject {
  return responseUtil.sendJsonObjectResponse.mock.calls[
    callIndex
  ]![2] as JSONObject;
}

function readsMade(): number {
  return (
    deviceService.findBy.mock.calls.length +
    deviceService.getFleetScan.mock.calls.length +
    siteService.findBy.mock.calls.length +
    siteService.getStatusCounts.mock.calls.length +
    endpointService.countBy.mock.calls.length +
    monitorStatusService.findBy.mock.calls.length
  );
}

let viewerScope: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  NetworkSummaryCache.clear();
  commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue({
    tenantId: projectId,
  } as never);
  monitorStatusService.findBy.mockResolvedValue([
    OFFLINE_STATUS,
    OPERATIONAL_STATUS,
  ] as never);
  siteService.getStatusCounts.mockResolvedValue([
    { monitorStatusId: OFFLINE_STATUS.id!.toString(), siteCount: 3 },
    { monitorStatusId: OPERATIONAL_STATUS.id!.toString(), siteCount: 5 },
    { monitorStatusId: null, siteCount: 2 },
  ] as never);
  siteService.findBy.mockResolvedValue([] as never);
  deviceService.findBy.mockResolvedValue([] as never);
  deviceService.getFleetScan.mockResolvedValue(fleetScan() as never);
  endpointService.countBy.mockResolvedValue(new PositiveNumber(1234) as never);
  viewerScope = jest
    .spyOn(NetworkSummaryCache, "getViewerScope")
    .mockResolvedValue(PROJECT_WIDE_SCOPE as never) as unknown as jest.Mock;
});

afterEach(() => {
  jest.restoreAllMocks();
  NetworkSummaryCache.clear();
});

describe("the Overview, built from the fleet scan", () => {
  test("tallies the fleet from the scan's buckets, and prints its numbers", async () => {
    const next: NextFunction = await call("/network-device/overview");

    expect(next).not.toHaveBeenCalled();
    expect(bodyOf(0)["fleet"]).toEqual({
      total: 10,
      up: 7,
      down: 2,
      pending: 1,
      interfacesDown: 5,
      snmpFailing: 2,
    });
    expect(bodyOf(0)["endpointCount"]).toBe(1234);
    expect(bodyOf(0)["siteCount"]).toBe(10);
    expect(bodyOf(0)["unhealthySiteCount"]).toBe(3);
  });

  test("lists the six biggest vendors, the unnamed ones as Unknown", async () => {
    await call("/network-device/overview");

    expect(bodyOf(0)["vendors"]).toEqual([
      { vendor: "Cisco", count: 4 },
      { vendor: "Unknown", count: 3 },
      { vendor: "Arista", count: 1 },
      { vendor: "Juniper", count: 1 },
      { vendor: "MikroTik", count: 1 },
      { vendor: "Zyxel", count: 1 },
    ]);
  });

  test("reads the fleet once: no health grouping, vendor breakdown or count of its own", async () => {
    await call("/network-device/overview");

    expect(deviceService.getFleetScan).toHaveBeenCalledTimes(1);
    expect(deviceService.getHealthGroups).not.toHaveBeenCalled();
    expect(deviceService.getVendorBreakdown).not.toHaveBeenCalled();
    expect(deviceService.getFleetSummary).not.toHaveBeenCalled();
    expect(deviceService.countBy).not.toHaveBeenCalled();

    const scanCall: JSONObject = deviceService.getFleetScan.mock
      .calls[0]![0] as JSONObject;

    expect(scanCall["projectId"]).toEqual(projectId);
    expect(scanCall["props"]).toEqual({ tenantId: projectId });
    expect(scanCall["now"]).toBeInstanceOf(Date);
  });
});

describe("a view's reads, at most two at a time", () => {
  /*
   * Every read the Overview makes answers a few turns later and counts how
   * many were out at once.
   */
  function countConcurrency(): { most: () => number } {
    let running: number = 0;
    let most: number = 0;

    const slow: (answer: unknown) => () => Promise<unknown> = (
      answer: unknown,
    ): (() => Promise<unknown>) => {
      return async (): Promise<unknown> => {
        running++;
        most = Math.max(most, running);

        for (let turn: number = 0; turn < 5; turn++) {
          await new Promise<void>((resolve: () => void) => {
            setImmediate(resolve);
          });
        }

        running--;
        return answer;
      };
    };

    monitorStatusService.findBy.mockImplementation(
      slow([OFFLINE_STATUS, OPERATIONAL_STATUS]) as never,
    );
    siteService.getStatusCounts.mockImplementation(slow([]) as never);
    siteService.findBy.mockImplementation(slow([]) as never);
    deviceService.findBy.mockImplementation(slow([]) as never);
    deviceService.getFleetScan.mockImplementation(slow(fleetScan()) as never);
    endpointService.countBy.mockImplementation(
      slow(new PositiveNumber(0)) as never,
    );

    return {
      most: (): number => {
        return most;
      },
    };
  }

  test("the Overview's ten reads never hold more than two connections at once", async () => {
    expect(VIEW_READ_LANES).toBe(2);

    const concurrency: { most: () => number } = countConcurrency();

    const next: NextFunction = await call("/network-device/overview");

    expect(next).not.toHaveBeenCalled();
    /*
     * The status ladder, the scan, site and endpoint counts, five device
     * reads and the sites read.
     */
    expect(readsMade()).toBe(10);
    expect(concurrency.most()).toBe(2);
  });

  test("the Sites strip's three reads, two at a time too", async () => {
    const concurrency: { most: () => number } = countConcurrency();

    await call("/network-site/summary");

    expect(concurrency.most()).toBeLessThanOrEqual(2);
    expect(readsMade()).toBe(3);
  });

  test("a read that fails fails the view, and the reads still waiting are not made", async () => {
    deviceService.getFleetScan.mockRejectedValue(new Error("timeout") as never);
    // The fleet scan and the site counts take the two lanes first.
    siteService.getStatusCounts.mockImplementation((async () => {
      await new Promise<void>((resolve: () => void) => {
        setImmediate(resolve);
      });
      return [];
    }) as never);

    const next: NextFunction = await call("/network-device/overview");

    expect(next).toHaveBeenCalledTimes(1);
    expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
    // The device reads queued behind them never ran.
    expect(deviceService.findBy.mock.calls.length).toBeLessThan(5);
  });
});

describe("kept for half a minute, per project and viewer scope", () => {
  test("a second request is answered from what the first built: no read at all", async () => {
    await call("/network-device/overview");
    const reads: number = readsMade();

    await call("/network-device/overview");

    expect(readsMade()).toBe(reads);
    expect(bodyOf(1)).toBe(bodyOf(0));
  });

  test("requests that arrive together share one build", async () => {
    await Promise.all([
      call("/network-device/overview"),
      call("/network-device/overview"),
      call("/network-device/overview"),
    ]);

    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(3);
    expect(deviceService.getFleetScan).toHaveBeenCalledTimes(1);
    expect(monitorStatusService.findBy).toHaveBeenCalledTimes(1);
    expect(endpointService.countBy).toHaveBeenCalledTimes(1);
  });

  test("is built again once the half minute has passed", async () => {
    let now: number = Date.UTC(2026, 10, 14, 12, 0, 0);
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return now;
    });

    await call("/network-device/overview");
    expect(endpointService.countBy).toHaveBeenCalledTimes(1);

    now += 29_000;
    await call("/network-device/overview");
    expect(endpointService.countBy).toHaveBeenCalledTimes(1);

    now += 2_000;
    await call("/network-device/overview");
    expect(endpointService.countBy).toHaveBeenCalledTimes(2);
  });

  test("each project is kept apart", async () => {
    await call("/network-device/overview");

    commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue({
      tenantId: otherProjectId,
    } as never);
    await call("/network-device/overview");

    expect(endpointService.countBy).toHaveBeenCalledTimes(2);
    expect(
      (endpointService.countBy.mock.calls[1]![0] as JSONObject)["query"],
    ).toEqual({ projectId: otherProjectId });
  });

  test("callers whose reads are narrowed differently are kept apart; a caller with no scope is never kept", async () => {
    viewerScope.mockImplementation((async (data: {
      props: DatabaseCommonInteractionProps;
    }) => {
      return (data.props as JSONObject)["scopeForTest"] as string | null;
    }) as never);

    for (const scope of [
      "viewer:a:1",
      "viewer:b:1",
      "viewer:a:1",
      null,
      null,
    ]) {
      commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue({
        tenantId: projectId,
        scopeForTest: scope,
      } as never);
      await call("/network-device/overview");
    }

    // a, b, and each of the two with no scope.
    expect(endpointService.countBy).toHaveBeenCalledTimes(4);
  });

  test("a failed build is never kept: the next request builds again", async () => {
    endpointService.countBy.mockRejectedValueOnce(
      new Error("timeout") as never,
    );

    const failed: NextFunction = await call("/network-device/overview");
    expect(failed).toHaveBeenCalledTimes(1);

    const next: NextFunction = await call("/network-device/overview");
    expect(next).not.toHaveBeenCalled();
    expect(endpointService.countBy).toHaveBeenCalledTimes(2);
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  });

  test("who may read is asked on every request, kept or not, with the records each view counts", async () => {
    await call("/network-device/overview");
    await call("/network-device/overview");

    const overviewScopes: Array<Array<unknown>> = viewerScope.mock.calls.filter(
      (args: Array<unknown>) => {
        return (
          ((args[0] as JSONObject)["modelTypes"] as Array<unknown>).length === 4
        );
      },
    );

    expect(overviewScopes).toHaveLength(2);
    expect((overviewScopes[0]![0] as JSONObject)["modelTypes"]).toEqual([
      NetworkDevice,
      NetworkSite,
      NetworkEndpoint,
      MonitorStatus,
    ]);
    expect((overviewScopes[0]![0] as JSONObject)["projectId"]).toEqual(
      projectId,
    );
  });

  test("a caller the permission pipeline refuses is refused, even with an answer kept", async () => {
    await call("/network-device/overview");

    viewerScope.mockRejectedValueOnce(new Error("not authorized") as never);
    const next: NextFunction = await call("/network-device/overview");

    expect(next).toHaveBeenCalledTimes(1);
    expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  });
});

describe("the strips and the Overview share one fleet scan", () => {
  test("the Devices strip prints the scan's numbers", async () => {
    await call("/network-device/summary");

    expect(bodyOf(0)).toEqual({
      devicesUp: 7,
      devicesDown: 2,
      devicesPending: 1,
      interfacesDown: 5,
      totalDevices: 10,
      devicesWithoutSite: 4,
    });
    expect(deviceService.getFleetSummary).not.toHaveBeenCalled();
  });

  test("the Sites strip counts its sites, and the devices with no site from the scan", async () => {
    await call("/network-site/summary");

    expect(bodyOf(0)).toEqual({
      totalSites: 10,
      unhealthySites: 3,
      sitesWithNoData: 2,
      devicesWithoutSite: 4,
      unhealthyStatusIds: [OFFLINE_STATUS.id!.toString()],
    });
  });

  test("the Devices strip, the Sites strip and the Overview read the fleet once between them", async () => {
    await call("/network-device/summary");
    await call("/network-site/summary");
    await call("/network-device/overview");

    expect(deviceService.getFleetScan).toHaveBeenCalledTimes(1);

    // The scan's scope is the device read's alone.
    const scanScopes: Array<Array<unknown>> = viewerScope.mock.calls.filter(
      (args: Array<unknown>) => {
        const models: Array<unknown> = (args[0] as JSONObject)[
          "modelTypes"
        ] as Array<unknown>;
        return models.length === 1;
      },
    );

    expect(scanScopes.length).toBeGreaterThanOrEqual(1);
    expect((scanScopes[0]![0] as JSONObject)["modelTypes"]).toEqual([
      NetworkDevice,
    ]);
  });

  test("the Sites strip is kept too", async () => {
    await call("/network-site/summary");
    await call("/network-site/summary");

    expect(siteService.getStatusCounts).toHaveBeenCalledTimes(1);
    expect(bodyOf(1)).toBe(bodyOf(0));
  });
});
