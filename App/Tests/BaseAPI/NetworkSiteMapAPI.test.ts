import { mockRouter } from "Common/Tests/Server/API/Helpers";
import CommonAPI from "Common/Server/API/CommonAPI";
import Response from "Common/Server/Utils/Response";
import NetworkSiteService from "Common/Server/Services/NetworkSiteService";
import NetworkSiteLinkService from "Common/Server/Services/NetworkSiteLinkService";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorStatusService from "Common/Server/Services/MonitorStatusService";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteType from "Common/Models/DatabaseModels/NetworkSiteType";
import NetworkSiteLink from "Common/Models/DatabaseModels/NetworkSiteLink";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import Color from "Common/Types/Color";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

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

jest.mock("Common/Server/Services/NetworkDeviceService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
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
