import { mockRouter } from "Common/Tests/Server/API/Helpers";
import CommonAPI from "Common/Server/API/CommonAPI";
import Response from "Common/Server/Utils/Response";
import NetworkSiteService from "Common/Server/Services/NetworkSiteService";
import NetworkSiteLinkService from "Common/Server/Services/NetworkSiteLinkService";
import NetworkSiteStatusTimelineService from "Common/Server/Services/NetworkSiteStatusTimelineService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteType from "Common/Models/DatabaseModels/NetworkSiteType";
import NetworkSiteLink from "Common/Models/DatabaseModels/NetworkSiteLink";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import { DeviceHealthGroup } from "Common/Server/Utils/NetworkDevice/DeviceHealthAggregation";
import Color from "Common/Types/Color";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The /network-site/map endpoint's LINK half.
 *
 * The map used to answer with markers only, so a customer's site links —
 * the WAN links, the fibre pairs, the thing that makes a set of locations a
 * network — existed on that page as a strip of chips and nowhere on the map
 * itself. These pin the endpoint that fixed it, and above all the negative
 * rule: a link is returned WHETHER OR NOT a monitor is attached to it. The
 * monitor decides the line's color, never whether the line exists.
 *
 * The marker maths is covered by NetworkSiteMapUtil.test.ts; what is pinned
 * here is the wiring — which links survive, which monitors get queried, and
 * what the client is handed for each.
 *
 * Below the map tests sit two things the mocks at the top of this file drag
 * in with them: the /network-site/children wiring, because the stubs those
 * calls land on are declared here and nowhere else, and a guard that reads
 * the route and checks those stubs still describe it.
 */

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

jest.mock("Common/Server/Services/NetworkSiteService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), findOneBy: jest.fn() },
  };
});

jest.mock("Common/Server/Services/NetworkSiteLinkService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/NetworkSiteStatusTimelineService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

/*
 * The rollup asks NetworkDeviceService for per-site health BUCKETS and for
 * the two project-wide device counts. It does NOT read device rows — the
 * `findBy` this stub used to carry was left behind by the change that
 * replaced the paging loop with a grouped aggregate, and stood here
 * claiming a call site that no longer exists.
 */
jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {
      getHealthGroupsForSites: jest.fn(),
      getHealthGroups: jest.fn(),
      countBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MonitorService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/MonitorStatusService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

/*
 * Importing the API module registers its routes on the mocked router so the
 * handler can be invoked directly, with every service call observable.
 */
import NetworkSiteHierarchyAPI from "../../FeatureSet/BaseAPI/API/NetworkSiteHierarchy";

new NetworkSiteHierarchyAPI().getRouter();

const projectId: ObjectID = ObjectID.generate();

const commonAPI: { getDatabaseCommonInteractionProps: jest.Mock } =
  CommonAPI as unknown as { getDatabaseCommonInteractionProps: jest.Mock };
const siteService: { findBy: jest.Mock; findOneBy: jest.Mock } =
  NetworkSiteService as unknown as { findBy: jest.Mock; findOneBy: jest.Mock };
const linkService: { findBy: jest.Mock } =
  NetworkSiteLinkService as unknown as { findBy: jest.Mock };
const timelineService: { findBy: jest.Mock } =
  NetworkSiteStatusTimelineService as unknown as { findBy: jest.Mock };
type MockedDeviceService = {
  getHealthGroupsForSites: jest.Mock;
  getHealthGroups: jest.Mock;
  countBy: jest.Mock;
};
const deviceService: MockedDeviceService =
  NetworkDeviceService as unknown as MockedDeviceService;
const monitorService: { findBy: jest.Mock } = MonitorService as unknown as {
  findBy: jest.Mock;
};
const monitorStatusService: { findBy: jest.Mock } =
  MonitorStatusService as unknown as { findBy: jest.Mock };
const responseUtil: { sendJsonObjectResponse: jest.Mock } =
  Response as unknown as { sendJsonObjectResponse: jest.Mock };

const mockResponse: ExpressResponse = {} as ExpressResponse;

type CallMapFunction = (body: JSONObject) => Promise<NextFunction>;

const callMap: CallMapFunction = async (
  body: JSONObject,
): Promise<NextFunction> => {
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  const req: ExpressRequest = { body: body } as unknown as ExpressRequest;
  await mockRouter
    .match("post", "/network-site/map")
    .handlerFunction(req, mockResponse, next);
  return next;
};

type CallChildrenFunction = (body: JSONObject) => Promise<NextFunction>;

const callChildren: CallChildrenFunction = async (
  body: JSONObject,
): Promise<NextFunction> => {
  const next: NextFunction = jest.fn() as unknown as NextFunction;
  const req: ExpressRequest = { body: body } as unknown as ExpressRequest;
  await mockRouter
    .match("post", "/network-site/children")
    .handlerFunction(req, mockResponse, next);
  return next;
};

/*
 * The endpoint asks NetworkSiteService for the level's children first and
 * its whole subtree second, in that order — mirror it.
 */
function mockSiteQueries(
  children: Array<NetworkSite>,
  subtree: Array<NetworkSite>,
): void {
  siteService.findBy
    .mockResolvedValueOnce(children as never)
    .mockResolvedValueOnce(subtree as never);
}

function makeSite(options: {
  name: string;
  latitude?: number | undefined;
  longitude?: number | undefined;
  isUnitLevel?: boolean | undefined;
  parentSiteId?: ObjectID | undefined;
  materializedPath?: string | undefined;
}): NetworkSite {
  const site: NetworkSite = new NetworkSite(ObjectID.generate());
  site.name = options.name;
  const siteType: NetworkSiteType = new NetworkSiteType(ObjectID.generate());
  // Never "Unit": a type name a customer may rename must not drive logic.
  siteType.name = options.isUnitLevel ? "Store" : "Region";
  siteType.isUnitLevel = Boolean(options.isUnitLevel);
  site.networkSiteType = siteType;
  if (options.latitude !== undefined) {
    site.latitude = options.latitude;
  }
  if (options.longitude !== undefined) {
    site.longitude = options.longitude;
  }
  if (options.parentSiteId) {
    site.parentSiteId = options.parentSiteId;
  }
  if (options.materializedPath) {
    site.materializedPath = options.materializedPath;
  }
  return site;
}

function makeLink(options: {
  name: string;
  from: NetworkSite | ObjectID;
  to: NetworkSite | ObjectID;
  monitorId?: ObjectID | undefined;
}): NetworkSiteLink {
  const link: NetworkSiteLink = new NetworkSiteLink(ObjectID.generate());
  link.name = options.name;
  link.fromSiteId =
    options.from instanceof ObjectID ? options.from : options.from.id!;
  link.toSiteId = options.to instanceof ObjectID ? options.to : options.to.id!;
  if (options.monitorId) {
    link.monitorId = options.monitorId;
  }
  return link;
}

function makeMonitor(statusId: ObjectID): Monitor {
  const monitor: Monitor = new Monitor(ObjectID.generate());
  monitor.currentMonitorStatusId = statusId;
  return monitor;
}

function makeStatus(options: {
  name: string;
  color: string;
  priority: number;
  isOperationalState: boolean;
}): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus(ObjectID.generate());
  status.name = options.name;
  status.color = new Color(options.color);
  status.priority = options.priority;
  status.isOperationalState = options.isOperationalState;
  return status;
}

/*
 * One health BUCKET, as the grouped aggregate hands it back: a set of
 * devices the classifier cannot tell apart, plus how many of them there are.
 * The facts are set so the shared classifier reaches the stated verdict —
 * reachable is healthy, unreachable is down, never-polled is unknown — which
 * is what makes an assertion on the resulting counts mean anything.
 */
function makeDeviceGroup(options: {
  siteId: ObjectID | null;
  deviceCount: number;
  isReachable?: boolean | null | undefined;
  hasDownInterfaces?: boolean | undefined;
}): DeviceHealthGroup {
  const isReachable: boolean | null =
    options.isReachable === undefined ? true : options.isReachable;
  return {
    siteId: options.siteId ? options.siteId.toString() : null,
    monitorStatusId: null,
    monitoringMethod: null,
    isReachable: isReachable,
    // Never polled and never seen is the only honest "unknown".
    hasBeenPolled: isReachable !== null,
    hasBeenSeen: isReachable === true,
    isStale: false,
    hasDownInterfaces: Boolean(options.hasDownInterfaces),
    deviceCount: options.deviceCount,
    interfacesDownTotal: options.hasDownInterfaces ? options.deviceCount : 0,
  };
}

function lastResponseBody(): JSONObject {
  expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  return responseUtil.sendJsonObjectResponse.mock.calls[0]![2] as JSONObject;
}

function responseLinks(): Array<JSONObject> {
  return lastResponseBody()["links"] as Array<JSONObject>;
}

/*
 * QueryHelper.any() compiles to a TypeORM Raw operator whose object-literal
 * parameters carry the id list; this digs the list back out.
 */
function idsInAnyOperator(operator: unknown): Array<string> {
  const parameters: JSONObject = (operator as JSONObject)[
    "objectLiteralParameters"
  ] as JSONObject;
  return Object.values(parameters)[0] as Array<string>;
}

/*
 * QueryHelper.isNull()/notNull() compile to a TypeORM Raw operator carrying
 * its SQL as a function of the column alias; rendering it is how a test says
 * WHICH of the two a query used. They are otherwise indistinguishable.
 */
function rawSqlFor(operator: unknown, column: string): string {
  return (operator as { getSql: (alias: string) => string }).getSql(column);
}

describe("POST /network-site/map — link lines", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue({
      tenantId: projectId,
    } as never);
    siteService.findBy.mockResolvedValue([] as never);
    siteService.findOneBy.mockResolvedValue(null as never);
    linkService.findBy.mockResolvedValue([] as never);
    monitorService.findBy.mockResolvedValue([] as never);
    monitorStatusService.findBy.mockResolvedValue([] as never);
  });

  test("a monitored link between two markers comes back colored by its status", async () => {
    const east: NetworkSite = makeSite({
      name: "Region East",
      latitude: 40.7,
      longitude: -74,
    });
    const west: NetworkSite = makeSite({
      name: "Region West",
      latitude: 37.77,
      longitude: -122.42,
    });
    const status: MonitorStatus = makeStatus({
      name: "Degraded",
      color: "#f59e0b",
      priority: 3,
      isOperationalState: false,
    });
    const monitor: Monitor = makeMonitor(status.id!);
    const link: NetworkSiteLink = makeLink({
      name: "East to West WAN",
      from: east,
      to: west,
      monitorId: monitor.id!,
    });

    mockSiteQueries([east, west], [east, west]);
    linkService.findBy.mockResolvedValue([link] as never);
    monitorService.findBy.mockResolvedValue([monitor] as never);
    monitorStatusService.findBy.mockResolvedValue([status] as never);

    const next: NextFunction = await callMap({});
    expect(next).not.toHaveBeenCalled();

    expect(responseLinks()).toEqual([
      {
        id: link.id!.toString(),
        name: "East to West WAN",
        fromSiteId: east.id!.toString(),
        toSiteId: west.id!.toString(),
        monitorStatus: {
          name: "Degraded",
          color: "#f59e0b",
          priority: 3,
        },
      },
    ]);
  });

  /*
   * The requirement, at the endpoint: an unmonitored link is a line. Most
   * links in a freshly modelled network have no monitor on them yet, and a
   * map that showed only the monitored ones would be describing a different
   * network from the one the customer built.
   */
  test("a link with no monitor is returned, with no status on it", async () => {
    const east: NetworkSite = makeSite({
      name: "Region East",
      latitude: 40.7,
      longitude: -74,
    });
    const west: NetworkSite = makeSite({
      name: "Region West",
      latitude: 37.77,
      longitude: -122.42,
    });
    const link: NetworkSiteLink = makeLink({
      name: "Dark fibre",
      from: east,
      to: west,
    });

    mockSiteQueries([east, west], [east, west]);
    linkService.findBy.mockResolvedValue([link] as never);

    await callMap({});

    const links: Array<JSONObject> = responseLinks();
    expect(links).toHaveLength(1);
    expect(links[0]!["name"]).toBe("Dark fibre");
    expect(links[0]!["monitorStatus"]).toBeUndefined();
    // Nothing to look up — the monitor query is skipped entirely.
    expect(monitorService.findBy).not.toHaveBeenCalled();
  });

  test("the link query is scoped to the project", async () => {
    await callMap({});

    expect(linkService.findBy).toHaveBeenCalledTimes(1);
    const query: JSONObject = (
      linkService.findBy.mock.calls[0]![0] as JSONObject
    )["query"] as JSONObject;
    expect((query["projectId"] as ObjectID).toString()).toBe(
      projectId.toString(),
    );
  });

  /*
   * A child with no coordinates on it or anywhere beneath it is reported in
   * unplacedSites rather than drawn — so its links have nothing to attach
   * to and must not be returned as drawable.
   */
  test("a link to a child that could not be placed is dropped", async () => {
    const placed: NetworkSite = makeSite({
      name: "Region East",
      latitude: 40.7,
      longitude: -74,
    });
    const unplaced: NetworkSite = makeSite({ name: "Region 2100" });
    const link: NetworkSiteLink = makeLink({
      name: "To nowhere",
      from: placed,
      to: unplaced,
    });

    mockSiteQueries([placed, unplaced], [placed, unplaced]);
    linkService.findBy.mockResolvedValue([link] as never);

    await callMap({});

    const body: JSONObject = lastResponseBody();
    expect((body["unplacedSites"] as Array<JSONObject>).length).toBe(1);
    expect(body["links"]).toEqual([]);
  });

  test("a link whose far end is on another level is dropped", async () => {
    const east: NetworkSite = makeSite({
      name: "Region East",
      latitude: 40.7,
      longitude: -74,
    });
    const west: NetworkSite = makeSite({
      name: "Region West",
      latitude: 37.77,
      longitude: -122.42,
    });
    const somewhereElse: ObjectID = ObjectID.generate();

    mockSiteQueries([east, west], [east, west]);
    linkService.findBy.mockResolvedValue([
      makeLink({ name: "Off-level", from: east, to: somewhereElse }),
      makeLink({ name: "On-level", from: east, to: west }),
    ] as never);

    await callMap({});

    const links: Array<JSONObject> = responseLinks();
    expect(links).toHaveLength(1);
    expect(links[0]!["name"]).toBe("On-level");
  });

  test("a link from a site to itself is dropped", async () => {
    const east: NetworkSite = makeSite({
      name: "Region East",
      latitude: 40.7,
      longitude: -74,
    });

    mockSiteQueries([east], [east]);
    linkService.findBy.mockResolvedValue([
      makeLink({ name: "Loop", from: east, to: east }),
    ] as never);

    await callMap({});

    expect(responseLinks()).toEqual([]);
  });

  /*
   * "All" mode draws one marker per LOCATED site in the subtree, so the
   * drawable set is a different one — links between individual stores
   * become lines, and a link to a store with no coordinates does not.
   */
  test("all mode links the individual located sites, not the level's children", async () => {
    const region: NetworkSite = makeSite({
      name: "Region East",
      latitude: 40.7,
      longitude: -74,
    });
    const storeA: NetworkSite = makeSite({
      name: "Store A",
      latitude: 41.1,
      longitude: -74.2,
      isUnitLevel: true,
      parentSiteId: region.id!,
      materializedPath: `/${region.id!.toString()}/`,
    });
    const storeB: NetworkSite = makeSite({
      name: "Store B",
      latitude: 41.2,
      longitude: -74.3,
      isUnitLevel: true,
      parentSiteId: region.id!,
      materializedPath: `/${region.id!.toString()}/`,
    });
    const storeNowhere: NetworkSite = makeSite({
      name: "Store Unlocated",
      isUnitLevel: true,
      parentSiteId: region.id!,
      materializedPath: `/${region.id!.toString()}/`,
    });

    mockSiteQueries([region], [region, storeA, storeB, storeNowhere]);
    linkService.findBy.mockResolvedValue([
      makeLink({ name: "Store ring", from: storeA, to: storeB }),
      makeLink({ name: "To unlocated", from: storeA, to: storeNowhere }),
    ] as never);

    await callMap({ mode: "all" });

    const links: Array<JSONObject> = responseLinks();
    expect(links).toHaveLength(1);
    expect(links[0]!["name"]).toBe("Store ring");
    expect(links[0]!["fromSiteId"]).toBe(storeA.id!.toString());
    expect(links[0]!["toSiteId"]).toBe(storeB.id!.toString());
  });

  /*
   * Grouped mode is the level's children, so a link between two stores
   * INSIDE one region is not a line on the region map — there is one marker
   * for both ends. It reappears when the reader drills in, which is where
   * it means something.
   */
  test("grouped mode does not draw links between sites below the level", async () => {
    const region: NetworkSite = makeSite({
      name: "Region East",
      latitude: 40.7,
      longitude: -74,
    });
    const storeA: NetworkSite = makeSite({
      name: "Store A",
      latitude: 41.1,
      longitude: -74.2,
      isUnitLevel: true,
      parentSiteId: region.id!,
      materializedPath: `/${region.id!.toString()}/`,
    });
    const storeB: NetworkSite = makeSite({
      name: "Store B",
      latitude: 41.2,
      longitude: -74.3,
      isUnitLevel: true,
      parentSiteId: region.id!,
      materializedPath: `/${region.id!.toString()}/`,
    });

    mockSiteQueries([region], [region, storeA, storeB]);
    linkService.findBy.mockResolvedValue([
      makeLink({ name: "Store ring", from: storeA, to: storeB }),
    ] as never);

    await callMap({});

    expect(responseLinks()).toEqual([]);
  });

  /*
   * One round trip for the monitors, scoped to the links that are actually
   * drawable — a project-wide monitor query to color a handful of lines
   * would be paid on every poll of every map.
   */
  test("only the monitors on drawable links are looked up, once each", async () => {
    const east: NetworkSite = makeSite({
      name: "Region East",
      latitude: 40.7,
      longitude: -74,
    });
    const west: NetworkSite = makeSite({
      name: "Region West",
      latitude: 37.77,
      longitude: -122.42,
    });
    const drawnMonitorId: ObjectID = ObjectID.generate();
    const offLevelMonitorId: ObjectID = ObjectID.generate();

    mockSiteQueries([east, west], [east, west]);
    linkService.findBy.mockResolvedValue([
      makeLink({
        name: "Primary",
        from: east,
        to: west,
        monitorId: drawnMonitorId,
      }),
      makeLink({
        name: "Backup",
        from: west,
        to: east,
        monitorId: drawnMonitorId,
      }),
      makeLink({
        name: "Off-level",
        from: east,
        to: ObjectID.generate(),
        monitorId: offLevelMonitorId,
      }),
    ] as never);

    await callMap({});

    expect(monitorService.findBy).toHaveBeenCalledTimes(1);
    const query: JSONObject = (
      monitorService.findBy.mock.calls[0]![0] as JSONObject
    )["query"] as JSONObject;
    expect((query["projectId"] as ObjectID).toString()).toBe(
      projectId.toString(),
    );
    expect(idsInAnyOperator(query["_id"])).toEqual([drawnMonitorId.toString()]);
  });

  test("the status query covers the link monitors as well as the sites", async () => {
    const east: NetworkSite = makeSite({
      name: "Region East",
      latitude: 40.7,
      longitude: -74,
    });
    const west: NetworkSite = makeSite({
      name: "Region West",
      latitude: 37.77,
      longitude: -122.42,
    });
    const status: MonitorStatus = makeStatus({
      name: "Operational",
      color: "#10b981",
      priority: 1,
      isOperationalState: true,
    });
    const monitor: Monitor = makeMonitor(status.id!);

    mockSiteQueries([east, west], [east, west]);
    linkService.findBy.mockResolvedValue([
      makeLink({
        name: "Primary",
        from: east,
        to: west,
        monitorId: monitor.id!,
      }),
    ] as never);
    monitorService.findBy.mockResolvedValue([monitor] as never);
    monitorStatusService.findBy.mockResolvedValue([status] as never);

    await callMap({});

    expect(monitorStatusService.findBy).toHaveBeenCalledTimes(1);
    const query: JSONObject = (
      monitorStatusService.findBy.mock.calls[0]![0] as JSONObject
    )["query"] as JSONObject;
    expect(idsInAnyOperator(query["_id"])).toContain(status.id!.toString());
    expect((responseLinks()[0]!["monitorStatus"] as JSONObject)["name"]).toBe(
      "Operational",
    );
  });

  /*
   * A monitor pointing at a status row that has since been deleted has no
   * color to offer. The line still gets drawn — neutral — rather than
   * disappearing because of a stale foreign key.
   */
  test("a link whose status row has gone keeps its line, without a status", async () => {
    const east: NetworkSite = makeSite({
      name: "Region East",
      latitude: 40.7,
      longitude: -74,
    });
    const west: NetworkSite = makeSite({
      name: "Region West",
      latitude: 37.77,
      longitude: -122.42,
    });
    const monitor: Monitor = makeMonitor(ObjectID.generate());

    mockSiteQueries([east, west], [east, west]);
    linkService.findBy.mockResolvedValue([
      makeLink({
        name: "Primary",
        from: east,
        to: west,
        monitorId: monitor.id!,
      }),
    ] as never);
    monitorService.findBy.mockResolvedValue([monitor] as never);
    monitorStatusService.findBy.mockResolvedValue([] as never);

    await callMap({});

    const links: Array<JSONObject> = responseLinks();
    expect(links).toHaveLength(1);
    expect(links[0]!["monitorStatus"]).toBeUndefined();
  });

  test("a monitor with no current status yet leaves the line uncolored", async () => {
    const east: NetworkSite = makeSite({
      name: "Region East",
      latitude: 40.7,
      longitude: -74,
    });
    const west: NetworkSite = makeSite({
      name: "Region West",
      latitude: 37.77,
      longitude: -122.42,
    });
    const monitor: Monitor = new Monitor(ObjectID.generate());

    mockSiteQueries([east, west], [east, west]);
    linkService.findBy.mockResolvedValue([
      makeLink({
        name: "Primary",
        from: east,
        to: west,
        monitorId: monitor.id!,
      }),
    ] as never);
    monitorService.findBy.mockResolvedValue([monitor] as never);

    await callMap({});

    const links: Array<JSONObject> = responseLinks();
    expect(links).toHaveLength(1);
    expect(links[0]!["monitorStatus"]).toBeUndefined();
  });

  test("a project with no links answers with an empty list, not a missing key", async () => {
    const east: NetworkSite = makeSite({
      name: "Region East",
      latitude: 40.7,
      longitude: -74,
    });
    mockSiteQueries([east], [east]);

    await callMap({});

    const body: JSONObject = lastResponseBody();
    expect(body["links"]).toEqual([]);
  });

  /*
   * The response order is the drawing order, and parallel links between one
   * pair of markers are bowed apart in the order they arrive — so the map
   * must not reshuffle between two polls of the same data.
   */
  test("links come back in the order the query returned them", async () => {
    const east: NetworkSite = makeSite({
      name: "Region East",
      latitude: 40.7,
      longitude: -74,
    });
    const west: NetworkSite = makeSite({
      name: "Region West",
      latitude: 37.77,
      longitude: -122.42,
    });

    mockSiteQueries([east, west], [east, west]);
    linkService.findBy.mockResolvedValue([
      makeLink({ name: "Primary", from: east, to: west }),
      makeLink({ name: "Backup", from: east, to: west }),
      makeLink({ name: "Tertiary", from: west, to: east }),
    ] as never);

    await callMap({});

    expect(
      responseLinks().map((link: JSONObject): unknown => {
        return link["name"];
      }),
    ).toEqual(["Primary", "Backup", "Tertiary"]);
  });
});

/*
 * The OTHER route on this module.
 *
 * /network-site/children is the drill-down the map sits next to, and it is
 * the only caller of three NetworkDeviceService methods. It is covered here
 * rather than in a file of its own because a jest.mock factory is
 * file-scoped: the stubs those calls land on are the ones declared at the
 * top of THIS file, so this is the only place that can prove they are the
 * right shape. What is pinned is the wiring — which aggregate the level
 * asks for, where a bucket's devices are counted, and what the two device
 * counts are allowed to cost — not the rollup arithmetic, which
 * NetworkSiteHierarchyUtil.test.ts covers over the pure aggregator.
 */
describe("POST /network-site/children — the device rollup's service calls", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    commonAPI.getDatabaseCommonInteractionProps.mockResolvedValue({
      tenantId: projectId,
    } as never);
    siteService.findBy.mockResolvedValue([] as never);
    siteService.findOneBy.mockResolvedValue(null as never);
    linkService.findBy.mockResolvedValue([] as never);
    timelineService.findBy.mockResolvedValue([] as never);
    monitorService.findBy.mockResolvedValue([] as never);
    monitorStatusService.findBy.mockResolvedValue([] as never);
    deviceService.getHealthGroups.mockResolvedValue([] as never);
    deviceService.getHealthGroupsForSites.mockResolvedValue([] as never);
    deviceService.countBy.mockResolvedValue(new PositiveNumber(0) as never);
  });

  /*
   * Listing roots has no subtree to scope to — the answer really is the
   * project — so it takes the whole-project aggregate rather than building
   * an id list of every site there is.
   */
  test("the root level takes the whole-project aggregate", async () => {
    const next: NextFunction = await callChildren({});
    expect(next).not.toHaveBeenCalled();

    expect(deviceService.getHealthGroupsForSites).not.toHaveBeenCalled();
    expect(deviceService.getHealthGroups).toHaveBeenCalledTimes(1);
    const call: JSONObject = deviceService.getHealthGroups.mock
      .calls[0]![0] as JSONObject;
    expect((call["projectId"] as ObjectID).toString()).toBe(
      projectId.toString(),
    );
    expect(call["onlyAttachedToSite"]).toBe(true);
    expect(call["groupBySite"]).toBe(true);
  });

  /*
   * Drilling into one region must not read every other region's devices.
   * The drilled site is in the id list alongside its subtree: its OWN
   * devices belong to no child and would otherwise be scoped out of the
   * very response that has to report them.
   */
  test("drilling into a site scopes the aggregate to it and its subtree", async () => {
    const region: NetworkSite = makeSite({ name: "Region East" });
    const market: NetworkSite = makeSite({
      name: "Market North",
      parentSiteId: region.id!,
      materializedPath: `/${region.id!.toString()}/`,
    });
    const store: NetworkSite = makeSite({
      name: "Store 1",
      isUnitLevel: true,
      parentSiteId: market.id!,
      materializedPath: `/${region.id!.toString()}/${market.id!.toString()}/`,
    });

    siteService.findOneBy.mockResolvedValue(region as never);
    mockSiteQueries([market], [market, store]);

    const next: NextFunction = await callChildren({
      siteId: region.id!.toString(),
    });
    expect(next).not.toHaveBeenCalled();

    expect(deviceService.getHealthGroups).not.toHaveBeenCalled();
    expect(deviceService.getHealthGroupsForSites).toHaveBeenCalledTimes(1);
    const call: JSONObject = deviceService.getHealthGroupsForSites.mock
      .calls[0]![0] as JSONObject;
    expect(
      (call["siteIds"] as Array<ObjectID>).map((siteId: ObjectID): string => {
        return siteId.toString();
      }),
    ).toEqual([
      region.id!.toString(),
      market.id!.toString(),
      store.id!.toString(),
    ]);
    expect(call["groupBySite"]).toBe(true);
  });

  /*
   * A bucket is counted against the CHILD whose subtree holds the site it
   * hangs off, not against that site — the drill-down has one card per
   * child, and a store's devices are what make its market's card worth
   * clicking.
   */
  test("a bucket's devices roll up onto the child whose subtree holds them", async () => {
    const region: NetworkSite = makeSite({ name: "Region East" });
    const market: NetworkSite = makeSite({
      name: "Market North",
      parentSiteId: region.id!,
      materializedPath: `/${region.id!.toString()}/`,
    });
    const store: NetworkSite = makeSite({
      name: "Store 1",
      isUnitLevel: true,
      parentSiteId: market.id!,
      materializedPath: `/${region.id!.toString()}/${market.id!.toString()}/`,
    });

    siteService.findOneBy.mockResolvedValue(region as never);
    mockSiteQueries([market], [market, store]);
    deviceService.getHealthGroupsForSites.mockResolvedValue([
      makeDeviceGroup({ siteId: store.id!, deviceCount: 3 }),
      makeDeviceGroup({
        siteId: store.id!,
        deviceCount: 2,
        isReachable: false,
      }),
      makeDeviceGroup({ siteId: store.id!, deviceCount: 1, isReachable: null }),
    ] as never);

    await callChildren({ siteId: region.id!.toString() });

    const children: Array<JSONObject> = lastResponseBody()[
      "children"
    ] as Array<JSONObject>;
    expect(children).toHaveLength(1);
    expect(children[0]!["name"]).toBe("Market North");
    expect(children[0]!["deviceCount"]).toBe(6);
    expect(children[0]!["deviceStats"]).toEqual({
      total: 6,
      down: 2,
      degraded: 0,
      healthy: 3,
      unknown: 1,
    });
  });

  /*
   * Devices on the level the reader is STANDING on belong to no child's
   * subtree — a distribution centre's own core switches above a dozen
   * stores. They are reported separately; folding them into a child would
   * attribute them to a site that does not hold them, and dropping them
   * puts them nowhere at all, which is where they used to be.
   */
  test("the level's own devices are reported apart from its children's", async () => {
    const region: NetworkSite = makeSite({ name: "Region East" });
    const market: NetworkSite = makeSite({
      name: "Market North",
      parentSiteId: region.id!,
      materializedPath: `/${region.id!.toString()}/`,
    });

    siteService.findOneBy.mockResolvedValue(region as never);
    mockSiteQueries([market], [market]);
    deviceService.getHealthGroupsForSites.mockResolvedValue([
      makeDeviceGroup({ siteId: region.id!, deviceCount: 4 }),
      makeDeviceGroup({ siteId: market.id!, deviceCount: 2 }),
    ] as never);

    await callChildren({ siteId: region.id!.toString() });

    const body: JSONObject = lastResponseBody();
    expect(body["ownDeviceStats"]).toEqual({
      total: 4,
      down: 0,
      degraded: 0,
      healthy: 4,
      unknown: 0,
    });
    const children: Array<JSONObject> = body["children"] as Array<JSONObject>;
    expect(children[0]!["deviceCount"]).toBe(2);
  });

  /*
   * The two numbers the topology explorer decides its whole opening view
   * on: whether ANY device in the project is attached to a site, and how
   * many the hierarchy is therefore not showing.
   *
   * Two counted queries, and deliberately no `limit` on either — countBy
   * applies limit as a take() over the counted set, so a limit here would
   * cap the ANSWER. A project with fifty thousand unattached devices would
   * be told ten thousand of them are missing, and nothing on screen would
   * look wrong.
   */
  test("the device scope is two uncapped counts, attached and unattached", async () => {
    deviceService.countBy
      .mockResolvedValueOnce(new PositiveNumber(7) as never)
      .mockResolvedValueOnce(new PositiveNumber(4) as never);

    await callChildren({});

    expect(deviceService.countBy).toHaveBeenCalledTimes(2);
    const attached: JSONObject = deviceService.countBy.mock
      .calls[0]![0] as JSONObject;
    const unattached: JSONObject = deviceService.countBy.mock
      .calls[1]![0] as JSONObject;

    for (const call of [attached, unattached]) {
      const query: JSONObject = call["query"] as JSONObject;
      expect((query["projectId"] as ObjectID).toString()).toBe(
        projectId.toString(),
      );
      // Decommissioned devices keep their siteId and must not be counted.
      expect(query["isArchived"]).toBe(false);
      expect(call["limit"]).toBeUndefined();
    }

    expect(
      rawSqlFor((attached["query"] as JSONObject)["siteId"], "siteId"),
    ).toBe("(siteId IS NOT NULL)");
    expect(
      rawSqlFor((unattached["query"] as JSONObject)["siteId"], "siteId"),
    ).toBe("(siteId IS NULL)");

    expect(lastResponseBody()["deviceScope"]).toEqual({
      attachedDeviceCount: 7,
      unattachedDeviceCount: 4,
    });
  });
});

/*
 * The stubs above stand in for real service modules, and a jest.mock factory
 * is an object literal TypeScript never checks against the module it
 * replaces. So the two ways a stub goes wrong are both silent:
 *
 * - It omits a method the route calls. Nothing fails until somebody writes
 *   the first test that reaches that line, and then it fails as "x is not a
 *   function" in a test that has nothing to do with the omission.
 * - It keeps a method the route stopped calling. Nothing fails ever. The
 *   stub reads as a claim about the route that is no longer true, and the
 *   next reader trusts it — which is how `findBy` outlived the paging loop
 *   it was written for.
 *
 * Reading the route settles both here, against the source rather than
 * against whichever handlers this file happens to invoke.
 */
const ROUTE_SOURCE_PATH: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "BaseAPI",
  "API",
  "NetworkSiteHierarchy.ts",
);

/*
 * Comments stripped first. That module explains itself at length and names
 * its own service methods in prose; a mention in a comment must not read as
 * a call site, or a deleted call would keep the stub that served it alive.
 */
const ROUTE_SOURCE: string = fs
  .readFileSync(ROUTE_SOURCE_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\/\/.*$/gm, " ");

function membersUsedOn(serviceName: string): Set<string> {
  const pattern: RegExp = new RegExp(
    `\\b${serviceName}\\.([A-Za-z0-9_]+)`,
    "g",
  );
  const members: Set<string> = new Set<string>();
  let match: RegExpExecArray | null = pattern.exec(ROUTE_SOURCE);
  while (match) {
    members.add(match[1] as string);
    match = pattern.exec(ROUTE_SOURCE);
  }
  return members;
}

const MOCKED_MODULES: Array<{
  name: string;
  stub: Record<string, unknown>;
}> = [
  { name: "NetworkSiteService", stub: siteService as Record<string, unknown> },
  {
    name: "NetworkSiteLinkService",
    stub: linkService as Record<string, unknown>,
  },
  {
    name: "NetworkSiteStatusTimelineService",
    stub: timelineService as Record<string, unknown>,
  },
  {
    name: "NetworkDeviceService",
    stub: deviceService as Record<string, unknown>,
  },
  { name: "MonitorService", stub: monitorService as Record<string, unknown> },
  {
    name: "MonitorStatusService",
    stub: monitorStatusService as Record<string, unknown>,
  },
  { name: "CommonAPI", stub: commonAPI as Record<string, unknown> },
  { name: "Response", stub: responseUtil as Record<string, unknown> },
];

describe("the service stubs in this file track the route they stand in for", () => {
  for (const mocked of MOCKED_MODULES) {
    /*
     * Every one of these is expected to be used, so an empty set means the
     * route stopped importing it under this name and the two assertions
     * below have quietly become vacuous — which is worse than either drift
     * they exist to catch.
     */
    test(`${mocked.name} is still called by the route under that name`, () => {
      expect(Array.from(membersUsedOn(mocked.name)).sort()).not.toEqual([]);
    });

    test(`${mocked.name}'s stub provides every method the route calls`, () => {
      const missing: Array<string> = Array.from(
        membersUsedOn(mocked.name),
      ).filter((member: string): boolean => {
        return !(member in mocked.stub);
      });
      expect(missing).toEqual([]);
    });

    test(`${mocked.name}'s stub provides nothing the route stopped calling`, () => {
      const used: Set<string> = membersUsedOn(mocked.name);
      const dead: Array<string> = Object.keys(mocked.stub).filter(
        (member: string): boolean => {
          return !used.has(member);
        },
      );
      expect(dead).toEqual([]);
    });
  }
});
