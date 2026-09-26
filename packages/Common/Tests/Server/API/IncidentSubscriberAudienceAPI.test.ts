import { mockRouter } from "./Helpers";
import CommonAPI from "../../../Server/API/CommonAPI";
import IncidentAPI from "../../../Server/API/IncidentAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import IncidentService from "../../../Server/Services/IncidentService";
import MonitorService from "../../../Server/Services/MonitorService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import IncidentSubscriberAudience, {
  IncidentSubscriberAudienceCounts,
  IncidentSubscriberAudienceExclusionReason,
  IncidentSubscriberAudienceResult,
} from "../../../Types/StatusPage/IncidentSubscriberAudience";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * POST /incident/subscriber-audience: who an incident's status page
 * notifications would reach, shown before an incident is declared or a public
 * note is posted.
 *
 * The route runs for real down to the services: the scope helper
 * (IncidentStatusPageScope) and the audience builder are not stubbed, only
 * the rows they read - status page resources by monitor, the status pages,
 * the incident, and the subscriber counts. What is pinned down:
 *
 *   - the counts: one entry per notified page, per channel, in name order;
 *     scope, scoped-only pages and pages that hide incidents are applied as
 *     the jobs apply them;
 *   - no address ever leaves: subscribers are counted with one aggregate and
 *     never read, and nothing address-shaped is in the answer;
 *   - a status page the caller cannot read is never named nor counted - the
 *     notified ones collapse into hiddenStatusPageCount;
 *   - the project is enforced: another project's incident is not found, and
 *     another project's monitors or status pages are refused before anything
 *     is resolved;
 *   - the permission check, and the request's shape.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

const ROUTE: string = "/incident/subscriber-audience";

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000001");

const INCIDENT_ID: string = "a0000000-0000-4000-8000-00000000000a";

const SHARED_MONITOR: string = "c0000000-0000-4000-8000-000000000001";
const LONELY_MONITOR: string = "c0000000-0000-4000-8000-000000000002";

// Five site pages; each lists the shared monitor.
const SITE_PAGE_IDS: Array<string> = [1, 2, 3, 4, 5].map(
  (site: number): string => {
    return `b0000000-0000-4000-8000-0000000000${site.toString().padStart(2, "0")}`;
  },
);

// A page that lists only the lonely monitor.
const LONELY_PAGE_ID: string = "b0000000-0000-4000-8000-000000000099";

function sitePageId(site: number): string {
  return SITE_PAGE_IDS[site - 1]!;
}

function siteName(site: number): string {
  return `Site ${site.toString().padStart(2, "0")}`;
}

interface PageFixture {
  id: string;
  name: string;
  projectId?: ObjectID | undefined;
  onlyShowScopedIncidents?: boolean | undefined;
  showIncidentsOnStatusPage?: boolean | undefined;
}

interface ResourceFixture {
  statusPageId: string;
  monitorId: string;
}

interface IncidentFixture {
  id: string;
  projectId: ObjectID;
  monitorIds: Array<string>;
  isVisibleOnStatusPage: boolean;
  isPrivate: boolean;
  scopedStatusPageIds: Array<string> | null;
}

let pages: Array<PageFixture> = [];
let resources: Array<ResourceFixture> = [];
let incidents: Array<IncidentFixture> = [];
let monitorProjects: Dictionary<ObjectID> = {};
// The pages the caller may read; null reads all of them.
let readablePageIds: Array<string> | null = null;
// The caller has no status page read access at all.
let statusPageReadRefused: boolean = false;
let subscriberCounts: Dictionary<IncidentSubscriberAudienceCounts> = {};

let findByMonitors: MockFunction;
let countActiveSubscribersByChannel: MockFunction;
let subscriberFindBy: MockFunction;
let getSubscribersByStatusPage: MockFunction;
let incidentFindOneBy: MockFunction;

let callerProps: DatabaseCommonInteractionProps;

// The ids QueryHelper.any was given (it builds a Raw IN operator).
function idsIn(operator: unknown): Array<string> {
  const raw: { objectLiteralParameters?: Dictionary<unknown> } = operator as {
    objectLiteralParameters?: Dictionary<unknown>;
  };

  return (
    Object.values(raw.objectLiteralParameters || {}) as Array<
      Array<string | ObjectID>
    >
  )
    .flat()
    .map((id: string | ObjectID): string => {
      return id.toString().toLowerCase();
    });
}

function sameId(a: unknown, b: unknown): boolean {
  return (
    String(a?.toString() || "").toLowerCase() ===
    String(b?.toString() || "").toLowerCase()
  );
}

function permissionProps(
  grants: Array<Permission>,
  options: { blocked?: Array<Permission> } = {},
): DatabaseCommonInteractionProps {
  const permissions: Array<UserPermission> = [
    ...grants.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      } as UserPermission;
    }),
    ...(options.blocked || []).map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: true,
      } as UserPermission;
    }),
  ];

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions,
  } as UserTenantAccessPermission;

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[PROJECT_ID.toString()] = tenantPermission;

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: permissionMap,
  };
}

function makePage(fixture: PageFixture): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = fixture.id;
  page.name = fixture.name;
  page.projectId = fixture.projectId || PROJECT_ID;
  page.onlyShowScopedIncidents = fixture.onlyShowScopedIncidents ?? false;
  page.showIncidentsOnStatusPage = fixture.showIncidentsOnStatusPage ?? true;
  return page;
}

function counts(
  partial: Partial<IncidentSubscriberAudienceCounts>,
): IncidentSubscriberAudienceCounts {
  return {
    ...IncidentSubscriberAudience.getEmptyCounts(),
    ...partial,
  };
}

// Five site pages on the shared monitor, and one on the lonely monitor.
function useSitePages(
  options: { onlyShowScopedIncidents?: boolean } = {},
): void {
  pages = [
    ...SITE_PAGE_IDS.map((id: string, index: number): PageFixture => {
      return {
        id: id,
        name: siteName(index + 1),
        onlyShowScopedIncidents: options.onlyShowScopedIncidents ?? false,
      };
    }),
    {
      id: LONELY_PAGE_ID,
      name: "Lonely",
    },
  ];

  resources = [
    ...SITE_PAGE_IDS.map((id: string): ResourceFixture => {
      return { statusPageId: id, monitorId: SHARED_MONITOR };
    }),
    { statusPageId: LONELY_PAGE_ID, monitorId: LONELY_MONITOR },
  ];

  monitorProjects = {
    [SHARED_MONITOR]: PROJECT_ID,
    [LONELY_MONITOR]: PROJECT_ID,
  };

  subscriberCounts = {
    [sitePageId(1)]: counts({ email: 41, sms: 3 }),
    [sitePageId(2)]: counts({ email: 18 }),
    [sitePageId(3)]: counts({ email: 7, slack: 1, webhook: 2 }),
    [sitePageId(4)]: counts({ microsoftTeams: 4 }),
    [LONELY_PAGE_ID]: counts({ email: 99 }),
    // Site 05 has no active subscribers: no row.
  };
}

interface RouteCall {
  thrown: unknown;
  sent: JSONObject | undefined;
}

async function post(body: unknown): Promise<RouteCall> {
  const req: ExpressRequest = {
    params: {},
    query: {},
    body: body,
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {} as ExpressResponse;
  const next: MockFunction = getJestMockFunction();

  await mockRouter
    .match("post", ROUTE)
    .handlerFunction(req, res, next as unknown as NextFunction);

  const send: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  return {
    thrown: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    sent: send.mock.calls[0]
      ? (send.mock.calls[0][2] as JSONObject)
      : undefined,
  };
}

async function audienceFor(
  body: unknown,
): Promise<IncidentSubscriberAudienceResult> {
  const call: RouteCall = await post(body);

  if (call.thrown) {
    throw call.thrown;
  }

  expect(call.sent).toBeDefined();

  return IncidentSubscriberAudience.fromJSON(call.sent!);
}

function draft(
  monitorIds: Array<string>,
  statusPageIds: Array<string> = [],
): JSONObject {
  return {
    monitorIds: monitorIds,
    statusPageIds: statusPageIds,
  };
}

function names(list: Array<{ name: string }>): Array<string> {
  return list.map((item: { name: string }): string => {
    return item.name;
  });
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new IncidentAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  pages = [];
  resources = [];
  incidents = [];
  monitorProjects = {};
  readablePageIds = null;
  statusPageReadRefused = false;
  subscriberCounts = {};

  callerProps = permissionProps([Permission.ProjectMember]);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation((() => {
      return Promise.resolve(callerProps);
    }) as never);

  findByMonitors = getJestMockFunction();
  findByMonitors.mockImplementation(
    (data: {
      monitorIds: Array<ObjectID>;
    }): Promise<Array<StatusPageResource>> => {
      const monitorIds: Array<string> = data.monitorIds.map(
        (id: ObjectID): string => {
          return id.toString().toLowerCase();
        },
      );

      return Promise.resolve(
        resources
          .filter((resource: ResourceFixture): boolean => {
            return monitorIds.includes(resource.monitorId);
          })
          .map((resource: ResourceFixture, index: number) => {
            const model: StatusPageResource = new StatusPageResource();
            model._id = `e0000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
            model.statusPageId = new ObjectID(resource.statusPageId);
            return model;
          }),
      );
    },
  );
  jest
    .spyOn(StatusPageResourceService, "findByMonitors")
    .mockImplementation(findByMonitors as never);

  jest
    .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
    .mockImplementation(((ids: Array<ObjectID>): Promise<Array<StatusPage>> => {
      const wanted: Array<string> = ids.map((id: ObjectID): string => {
        return id.toString().toLowerCase();
      });

      return Promise.resolve(
        pages
          .filter((page: PageFixture): boolean => {
            return wanted.includes(page.id);
          })
          .map(makePage),
      );
    }) as never);

  // Root reads check the project; the caller's reads apply what they may read.
  jest.spyOn(StatusPageService, "findBy").mockImplementation(((findBy: {
    query: JSONObject;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<StatusPage>> => {
    const wanted: Array<string> = idsIn(findBy.query["_id"]);

    if (!findBy.props.isRoot && statusPageReadRefused) {
      return Promise.reject(
        new NotAuthorizedException(
          "You do not have permissions to read Status Page.",
        ),
      );
    }

    return Promise.resolve(
      pages
        .filter((page: PageFixture): boolean => {
          return (
            wanted.includes(page.id) &&
            sameId(page.projectId || PROJECT_ID, findBy.query["projectId"]) &&
            (findBy.props.isRoot ||
              readablePageIds === null ||
              readablePageIds.includes(page.id))
          );
        })
        .map(makePage),
    );
  }) as never);

  jest.spyOn(MonitorService, "findBy").mockImplementation(((findBy: {
    query: JSONObject;
  }): Promise<Array<Monitor>> => {
    return Promise.resolve(
      idsIn(findBy.query["_id"])
        .filter((id: string): boolean => {
          return (
            Boolean(monitorProjects[id]) &&
            sameId(monitorProjects[id], findBy.query["projectId"])
          );
        })
        .map((id: string): Monitor => {
          const monitor: Monitor = new Monitor();
          monitor._id = id;
          return monitor;
        }),
    );
  }) as never);

  // The stored scope, as IncidentStatusPageScope reads it.
  jest.spyOn(IncidentService, "findBy").mockImplementation(((findBy: {
    query: JSONObject;
  }): Promise<Array<Incident>> => {
    const wanted: Array<string> = idsIn(findBy.query["_id"]);

    return Promise.resolve(
      incidents
        .filter((fixture: IncidentFixture): boolean => {
          return wanted.includes(fixture.id);
        })
        .map((fixture: IncidentFixture): Incident => {
          const incident: Incident = new Incident();
          incident._id = fixture.id;
          incident.isScopedToStatusPages = fixture.scopedStatusPageIds !== null;
          incident.statusPages = (fixture.scopedStatusPageIds || []).map(
            (id: string): StatusPage => {
              const page: StatusPage = new StatusPage();
              page._id = id;
              return page;
            },
          );
          return incident;
        }),
    );
  }) as never);

  incidentFindOneBy = getJestMockFunction();
  incidentFindOneBy.mockImplementation(
    (findOneBy: { query: JSONObject }): Promise<Incident | null> => {
      const fixture: IncidentFixture | undefined = incidents.find(
        (candidate: IncidentFixture): boolean => {
          return (
            sameId(candidate.id, findOneBy.query["_id"]) &&
            sameId(candidate.projectId, findOneBy.query["projectId"])
          );
        },
      );

      if (!fixture) {
        return Promise.resolve(null);
      }

      const incident: Incident = new Incident();
      incident._id = fixture.id;
      incident.isVisibleOnStatusPage = fixture.isVisibleOnStatusPage;
      incident.isPrivate = fixture.isPrivate;
      incident.isScopedToStatusPages = fixture.scopedStatusPageIds !== null;
      incident.statusPages = (fixture.scopedStatusPageIds || []).map(
        (id: string): StatusPage => {
          const page: StatusPage = new StatusPage();
          page._id = id;
          return page;
        },
      );
      incident.monitors = fixture.monitorIds.map((id: string): Monitor => {
        const monitor: Monitor = new Monitor();
        monitor._id = id;
        return monitor;
      });
      return Promise.resolve(incident);
    },
  );
  jest
    .spyOn(IncidentService, "findOneBy")
    .mockImplementation(incidentFindOneBy as never);

  countActiveSubscribersByChannel = getJestMockFunction();
  countActiveSubscribersByChannel.mockImplementation(
    (data: {
      projectId: ObjectID;
      statusPageIds: Array<ObjectID>;
    }): Promise<Dictionary<IncidentSubscriberAudienceCounts>> => {
      const result: Dictionary<IncidentSubscriberAudienceCounts> = {};

      for (const id of data.statusPageIds) {
        const key: string = id.toString().toLowerCase();

        if (subscriberCounts[key] && sameId(data.projectId, PROJECT_ID)) {
          result[key] = subscriberCounts[key]!;
        }
      }

      return Promise.resolve(result);
    },
  );
  jest
    .spyOn(StatusPageSubscriberService, "countActiveSubscribersByChannel")
    .mockImplementation(countActiveSubscribersByChannel as never);

  // Neither may ever be reached: they read subscribers out, addresses and all.
  subscriberFindBy = getJestMockFunction();
  jest
    .spyOn(StatusPageSubscriberService, "findBy")
    .mockImplementation(subscriberFindBy as never);
  getSubscribersByStatusPage = getJestMockFunction();
  jest
    .spyOn(StatusPageSubscriberService, "getSubscribersByStatusPage")
    .mockImplementation(getSubscribersByStatusPage as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the route", () => {
  test("is registered once, behind the session and the expired-session guard", () => {
    const registrations: Array<ReturnType<typeof mockRouter.match>> =
      mockRouter.routes.filter(
        (route: ReturnType<typeof mockRouter.match>): boolean => {
          return route.method === "POST" && route.uri === ROUTE;
        },
      );

    expect(registrations).toHaveLength(1);
    expect(registrations[0]!.middlewares[0]).toBe(
      UserMiddleware.getUserMiddleware,
    );
    expect(registrations[0]!.middlewares[1]).toBe(
      UserMiddleware.requireUserAuthentication,
    );
  });

  test("the path is the one the dashboard calls", () => {
    expect(IncidentSubscriberAudience.apiPath).toBe(ROUTE);
  });

  test("answers with no-cache headers", async () => {
    useSitePages();

    await audienceFor(draft([SHARED_MONITOR]));

    expect(Response.setNoCacheHeaders).toHaveBeenCalledTimes(1);
  });
});

describe("counts for an incident being declared", () => {
  test("an unscoped incident on a shared monitor: every site page, per channel, in name order", async () => {
    useSitePages();

    const audience: IncidentSubscriberAudienceResult = await audienceFor(
      draft([SHARED_MONITOR]),
    );

    expect(audience.hasMonitors).toBe(true);
    expect(audience.isScoped).toBe(false);
    expect(audience.isHiddenFromStatusPages).toBe(false);
    expect(audience.hiddenStatusPageCount).toBe(0);
    expect(audience.excludedStatusPages).toEqual([]);
    expect(audience.selectedStatusPagesNotListingMonitors).toEqual([]);
    expect(audience.statusPages).toEqual([
      {
        statusPageId: sitePageId(1),
        name: "Site 01",
        subscriberCounts: counts({ email: 41, sms: 3 }),
      },
      {
        statusPageId: sitePageId(2),
        name: "Site 02",
        subscriberCounts: counts({ email: 18 }),
      },
      {
        statusPageId: sitePageId(3),
        name: "Site 03",
        subscriberCounts: counts({ email: 7, slack: 1, webhook: 2 }),
      },
      {
        statusPageId: sitePageId(4),
        name: "Site 04",
        subscriberCounts: counts({ microsoftTeams: 4 }),
      },
      // No active subscribers: listed, with zero on every channel.
      {
        statusPageId: sitePageId(5),
        name: "Site 05",
        subscriberCounts: counts({}),
      },
    ]);
  });

  test("scoped to two of the site pages: only those two, and the rest listed as outside the scope", async () => {
    useSitePages();

    const audience: IncidentSubscriberAudienceResult = await audienceFor(
      draft([SHARED_MONITOR], [sitePageId(3), sitePageId(1)]),
    );

    expect(audience.isScoped).toBe(true);
    expect(names(audience.statusPages)).toEqual(["Site 01", "Site 03"]);
    expect(audience.statusPages[0]!.subscriberCounts).toEqual(
      counts({ email: 41, sms: 3 }),
    );
    expect(audience.excludedStatusPages).toEqual([
      {
        statusPageId: sitePageId(2),
        name: "Site 02",
        reason: IncidentSubscriberAudienceExclusionReason.OutsideIncidentScope,
      },
      {
        statusPageId: sitePageId(4),
        name: "Site 04",
        reason: IncidentSubscriberAudienceExclusionReason.OutsideIncidentScope,
      },
      {
        statusPageId: sitePageId(5),
        name: "Site 05",
        reason: IncidentSubscriberAudienceExclusionReason.OutsideIncidentScope,
      },
    ]);

    // Subscribers are counted for the notified pages only.
    expect(countActiveSubscribersByChannel).toHaveBeenCalledTimes(1);
    expect(
      (
        countActiveSubscribersByChannel.mock.calls[0]![0] as {
          statusPageIds: Array<ObjectID>;
        }
      ).statusPageIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([sitePageId(1), sitePageId(3)]);
  });

  test("an unscoped incident reaches none of the pages that only show scoped incidents", async () => {
    useSitePages({ onlyShowScopedIncidents: true });

    const audience: IncidentSubscriberAudienceResult = await audienceFor(
      draft([SHARED_MONITOR]),
    );

    expect(audience.statusPages).toEqual([]);
    expect(IncidentSubscriberAudience.reachesAnyone(audience)).toBe(false);
    expect(names(audience.excludedStatusPages)).toEqual([
      "Site 01",
      "Site 02",
      "Site 03",
      "Site 04",
      "Site 05",
    ]);

    for (const excluded of audience.excludedStatusPages) {
      expect(excluded.reason).toBe(
        IncidentSubscriberAudienceExclusionReason.OnlyShowsScopedIncidents,
      );
    }

    expect(countActiveSubscribersByChannel).not.toHaveBeenCalled();
  });

  test("scoping to a page that only shows scoped incidents reaches it", async () => {
    useSitePages({ onlyShowScopedIncidents: true });

    const audience: IncidentSubscriberAudienceResult = await audienceFor(
      draft([SHARED_MONITOR], [sitePageId(2)]),
    );

    expect(names(audience.statusPages)).toEqual(["Site 02"]);
    expect(audience.statusPages[0]!.subscriberCounts).toEqual(
      counts({ email: 18 }),
    );
  });

  test("a page that does not show incidents is left out, as the jobs skip it", async () => {
    useSitePages();
    pages = pages.map((page: PageFixture): PageFixture => {
      return page.id === sitePageId(2)
        ? { ...page, showIncidentsOnStatusPage: false }
        : page;
    });

    const audience: IncidentSubscriberAudienceResult = await audienceFor(
      draft([SHARED_MONITOR], [sitePageId(1), sitePageId(2)]),
    );

    expect(names(audience.statusPages)).toEqual(["Site 01"]);
    expect(
      audience.excludedStatusPages.find(
        (excluded: { statusPageId: string }): boolean => {
          return excluded.statusPageId === sitePageId(2);
        },
      ),
    ).toEqual({
      statusPageId: sitePageId(2),
      name: "Site 02",
      reason: IncidentSubscriberAudienceExclusionReason.HidesIncidents,
    });
  });

  test("a selected page that lists none of the monitors is reported, and not notified", async () => {
    useSitePages();

    const audience: IncidentSubscriberAudienceResult = await audienceFor(
      draft([SHARED_MONITOR], [sitePageId(1), LONELY_PAGE_ID]),
    );

    expect(names(audience.statusPages)).toEqual(["Site 01"]);
    expect(audience.selectedStatusPagesNotListingMonitors).toEqual([
      { statusPageId: LONELY_PAGE_ID, name: "Lonely" },
    ]);
  });

  test("no monitors: nobody, and no page is reported as not listing them", async () => {
    useSitePages();

    const audience: IncidentSubscriberAudienceResult = await audienceFor(
      draft([], [sitePageId(1)]),
    );

    expect(audience.hasMonitors).toBe(false);
    expect(audience.statusPages).toEqual([]);
    expect(audience.selectedStatusPagesNotListingMonitors).toEqual([]);
    expect(IncidentSubscriberAudience.reachesAnyone(audience)).toBe(false);
    expect(findByMonitors).not.toHaveBeenCalled();
  });

  test("ids are compared without regard to case or duplicates", async () => {
    useSitePages();

    const audience: IncidentSubscriberAudienceResult = await audienceFor(
      draft(
        [SHARED_MONITOR.toUpperCase(), SHARED_MONITOR],
        [sitePageId(1).toUpperCase(), sitePageId(1)],
      ),
    );

    expect(names(audience.statusPages)).toEqual(["Site 01"]);
    expect(audience.selectedStatusPagesNotListingMonitors).toEqual([]);
  });
});

describe("no address ever leaves the server", () => {
  test("subscribers are counted with the aggregate and never read", async () => {
    useSitePages();

    await audienceFor(draft([SHARED_MONITOR]));

    expect(countActiveSubscribersByChannel).toHaveBeenCalledTimes(1);
    expect(subscriberFindBy).not.toHaveBeenCalled();
    expect(getSubscribersByStatusPage).not.toHaveBeenCalled();
  });

  test("the answer holds only page names, ids and numbers", async () => {
    useSitePages();

    const call: RouteCall = await post(draft([SHARED_MONITOR]));
    const text: string = JSON.stringify(call.sent);

    expect(call.thrown).toBeUndefined();
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/https?:/i);
    expect(text).not.toMatch(
      /subscriberEmail|subscriberPhone|subscriberWebhook|IncomingWebhookUrl/,
    );

    // Every key in the answer is one the audience type declares.
    expect(Object.keys(call.sent!).sort()).toEqual(
      [
        "excludedStatusPages",
        "hasMonitors",
        "hiddenStatusPageCount",
        "isHiddenFromStatusPages",
        "isScoped",
        "selectedStatusPagesNotListingMonitors",
        "statusPages",
      ].sort(),
    );

    for (const statusPage of call.sent!["statusPages"] as Array<JSONObject>) {
      expect(Object.keys(statusPage).sort()).toEqual(
        ["name", "statusPageId", "subscriberCounts"].sort(),
      );

      for (const value of Object.values(
        statusPage["subscriberCounts"] as JSONObject,
      )) {
        expect(typeof value).toBe("number");
      }
    }
  });
});

describe("status pages the caller cannot read", () => {
  test("notified pages the caller cannot read collapse into a count, and are not counted", async () => {
    useSitePages();
    readablePageIds = [sitePageId(1), sitePageId(3)];

    const audience: IncidentSubscriberAudienceResult = await audienceFor(
      draft([SHARED_MONITOR]),
    );

    expect(names(audience.statusPages)).toEqual(["Site 01", "Site 03"]);
    expect(audience.hiddenStatusPageCount).toBe(3);
    expect(IncidentSubscriberAudience.reachesAnyone(audience)).toBe(true);

    const countedIds: Array<string> = (
      countActiveSubscribersByChannel.mock.calls[0]![0] as {
        statusPageIds: Array<ObjectID>;
      }
    ).statusPageIds.map((id: ObjectID): string => {
      return id.toString();
    });

    expect(countedIds).toEqual([sitePageId(1), sitePageId(3)]);

    const text: string = JSON.stringify(
      IncidentSubscriberAudience.toJSON(audience),
    );

    for (const hidden of [2, 4, 5]) {
      expect(text).not.toContain(siteName(hidden));
      expect(text).not.toContain(sitePageId(hidden));
    }
  });

  test("the pages are read with the caller's own permissions", async () => {
    useSitePages();

    await audienceFor(draft([SHARED_MONITOR]));

    const callerReads: Array<{ props: DatabaseCommonInteractionProps }> = (
      StatusPageService.findBy as unknown as jest.Mock
    ).mock.calls
      .map((call: Array<unknown>) => {
        return call[0] as { props: DatabaseCommonInteractionProps };
      })
      .filter((findBy: { props: DatabaseCommonInteractionProps }): boolean => {
        return !findBy.props.isRoot;
      });

    expect(callerReads.length).toBeGreaterThan(0);
    expect(callerReads[0]!.props).toBe(callerProps);
  });

  test("excluded and not-listing pages the caller cannot read are left out, never named", async () => {
    useSitePages();
    readablePageIds = [sitePageId(1)];

    const audience: IncidentSubscriberAudienceResult = await audienceFor(
      draft([SHARED_MONITOR], [sitePageId(1), LONELY_PAGE_ID]),
    );

    expect(names(audience.statusPages)).toEqual(["Site 01"]);
    expect(audience.hiddenStatusPageCount).toBe(0);
    expect(audience.excludedStatusPages).toEqual([]);
    expect(audience.selectedStatusPagesNotListingMonitors).toEqual([]);
  });

  test("a caller with no status page read access sees only a count", async () => {
    useSitePages();
    statusPageReadRefused = true;

    const audience: IncidentSubscriberAudienceResult = await audienceFor(
      draft([SHARED_MONITOR]),
    );

    expect(audience.statusPages).toEqual([]);
    expect(audience.excludedStatusPages).toEqual([]);
    expect(audience.hiddenStatusPageCount).toBe(5);
    expect(countActiveSubscribersByChannel).not.toHaveBeenCalled();
  });
});

describe("the project is enforced", () => {
  test("another project's incident is not found", async () => {
    useSitePages();
    incidents = [
      {
        id: INCIDENT_ID,
        projectId: OTHER_PROJECT_ID,
        monitorIds: [SHARED_MONITOR],
        isVisibleOnStatusPage: true,
        isPrivate: false,
        scopedStatusPageIds: null,
      },
    ];

    const call: RouteCall = await post({ incidentId: INCIDENT_ID });

    expect(call.thrown).toBeInstanceOf(NotFoundException);
    expect(call.sent).toBeUndefined();
    expect(findByMonitors).not.toHaveBeenCalled();
    expect(countActiveSubscribersByChannel).not.toHaveBeenCalled();

    // Looked up in the caller's project, with the caller's permissions.
    const lookup: { query: JSONObject; props: DatabaseCommonInteractionProps } =
      incidentFindOneBy.mock.calls[0]![0] as {
        query: JSONObject;
        props: DatabaseCommonInteractionProps;
      };
    expect(sameId(lookup.query["projectId"], PROJECT_ID)).toBe(true);
    expect(lookup.props).toBe(callerProps);
  });

  test("another project's monitor is refused before anything is resolved", async () => {
    useSitePages();
    monitorProjects[LONELY_MONITOR] = OTHER_PROJECT_ID;

    const call: RouteCall = await post(draft([SHARED_MONITOR, LONELY_MONITOR]));

    expect(call.thrown).toBeInstanceOf(BadDataException);
    expect((call.thrown as BadDataException).message).toBe(
      "One or more of these monitors were not found in this project.",
    );
    expect(findByMonitors).not.toHaveBeenCalled();
    expect(call.sent).toBeUndefined();
  });

  test("another project's status page is refused before anything is resolved", async () => {
    useSitePages();
    pages.push({
      id: "b0000000-0000-4000-8000-000000000077",
      name: "Their page",
      projectId: OTHER_PROJECT_ID,
    });

    const call: RouteCall = await post(
      draft([SHARED_MONITOR], ["b0000000-0000-4000-8000-000000000077"]),
    );

    expect(call.thrown).toBeInstanceOf(BadDataException);
    expect((call.thrown as BadDataException).message).toBe(
      "One or more of these status pages were not found in this project.",
    );
    expect(findByMonitors).not.toHaveBeenCalled();
  });

  test("a status page that does not exist is refused the same way", async () => {
    useSitePages();

    const call: RouteCall = await post(
      draft([SHARED_MONITOR], ["b0000000-0000-4000-8000-000000000066"]),
    );

    expect(call.thrown).toBeInstanceOf(BadDataException);
  });

  test("another project's page reached through a resource is never reported", async () => {
    useSitePages();
    pages = pages.map((page: PageFixture): PageFixture => {
      return page.id === sitePageId(5)
        ? { ...page, projectId: OTHER_PROJECT_ID }
        : page;
    });

    const audience: IncidentSubscriberAudienceResult = await audienceFor(
      draft([SHARED_MONITOR]),
    );

    expect(names(audience.statusPages)).toEqual([
      "Site 01",
      "Site 02",
      "Site 03",
      "Site 04",
    ]);
    expect(audience.hiddenStatusPageCount).toBe(0);
  });

  test("subscribers are counted in the caller's project", async () => {
    useSitePages();

    await audienceFor(draft([SHARED_MONITOR]));

    expect(
      sameId(
        (
          countActiveSubscribersByChannel.mock.calls[0]![0] as {
            projectId: ObjectID;
          }
        ).projectId,
        PROJECT_ID,
      ),
    ).toBe(true);
  });
});

describe("an incident that exists", () => {
  function useIncident(overrides: Partial<IncidentFixture> = {}): void {
    incidents = [
      {
        id: INCIDENT_ID,
        projectId: PROJECT_ID,
        monitorIds: [SHARED_MONITOR],
        isVisibleOnStatusPage: true,
        isPrivate: false,
        scopedStatusPageIds: null,
        ...overrides,
      },
    ];
  }

  test("reaches the pages its stored scope allows", async () => {
    useSitePages();
    useIncident({ scopedStatusPageIds: [sitePageId(2), sitePageId(4)] });

    const audience: IncidentSubscriberAudienceResult = await audienceFor({
      incidentId: INCIDENT_ID,
    });

    expect(audience.isScoped).toBe(true);
    expect(audience.isHiddenFromStatusPages).toBe(false);
    expect(names(audience.statusPages)).toEqual(["Site 02", "Site 04"]);
    expect(audience.statusPages[1]!.subscriberCounts).toEqual(
      counts({ microsoftTeams: 4 }),
    );
  });

  test("an unscoped incident reaches every page its monitors reach", async () => {
    useSitePages();
    useIncident();

    const audience: IncidentSubscriberAudienceResult = await audienceFor({
      incidentId: INCIDENT_ID,
    });

    expect(audience.isScoped).toBe(false);
    expect(audience.statusPages).toHaveLength(5);
  });

  test("a scope whose pages were all deleted reaches nothing", async () => {
    useSitePages();
    useIncident({ scopedStatusPageIds: [] });

    const audience: IncidentSubscriberAudienceResult = await audienceFor({
      incidentId: INCIDENT_ID,
    });

    expect(audience.isScoped).toBe(true);
    expect(audience.statusPages).toEqual([]);
    expect(IncidentSubscriberAudience.reachesAnyone(audience)).toBe(false);
  });

  test("a hidden incident is reported as hidden: nothing will be sent", async () => {
    useSitePages();
    useIncident({ isVisibleOnStatusPage: false });

    const audience: IncidentSubscriberAudienceResult = await audienceFor({
      incidentId: INCIDENT_ID,
    });

    expect(audience.isHiddenFromStatusPages).toBe(true);
    expect(IncidentSubscriberAudience.reachesAnyone(audience)).toBe(false);
  });

  test("a private incident is reported as hidden", async () => {
    useSitePages();
    useIncident({ isPrivate: true });

    const audience: IncidentSubscriberAudienceResult = await audienceFor({
      incidentId: INCIDENT_ID,
    });

    expect(audience.isHiddenFromStatusPages).toBe(true);
  });

  test("a scoped page that lists none of its monitors is reported", async () => {
    useSitePages();
    useIncident({ scopedStatusPageIds: [sitePageId(1), LONELY_PAGE_ID] });

    const audience: IncidentSubscriberAudienceResult = await audienceFor({
      incidentId: INCIDENT_ID,
    });

    expect(names(audience.statusPages)).toEqual(["Site 01"]);
    expect(audience.selectedStatusPagesNotListingMonitors).toEqual([
      { statusPageId: LONELY_PAGE_ID, name: "Lonely" },
    ]);
  });

  test("an incident the caller cannot read is not found", async () => {
    useSitePages();
    useIncident();
    incidentFindOneBy.mockImplementation((() => {
      return Promise.resolve(null);
    }) as never);

    const call: RouteCall = await post({ incidentId: INCIDENT_ID });

    expect(call.thrown).toBeInstanceOf(NotFoundException);
  });

  test("an incident on no monitor reaches nobody", async () => {
    useSitePages();
    useIncident({ monitorIds: [] });

    const audience: IncidentSubscriberAudienceResult = await audienceFor({
      incidentId: INCIDENT_ID,
    });

    expect(audience.hasMonitors).toBe(false);
    expect(audience.statusPages).toEqual([]);
  });
});

describe("permissions", () => {
  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.IncidentAdmin,
    Permission.IncidentMember,
    Permission.CreateProjectIncident,
    Permission.EditProjectIncident,
    Permission.CreateIncidentPublicNote,
  ])("%s may ask", async (permission: Permission) => {
    useSitePages();
    callerProps = permissionProps([permission]);

    const call: RouteCall = await post(draft([SHARED_MONITOR]));

    expect(call.thrown).toBeUndefined();
    expect(call.sent).toBeDefined();
  });

  test.each([
    Permission.IncidentViewer,
    Permission.ReadProjectIncident,
    Permission.StatusPageViewer,
    Permission.Viewer,
  ])("%s alone may not", async (permission: Permission) => {
    useSitePages();
    callerProps = permissionProps([permission]);

    const call: RouteCall = await post(draft([SHARED_MONITOR]));

    expect(call.thrown).toBeInstanceOf(NotAuthorizedException);
    expect(findByMonitors).not.toHaveBeenCalled();
    expect(countActiveSubscribersByChannel).not.toHaveBeenCalled();
  });

  test("a blocked permission is not a grant", async () => {
    useSitePages();
    callerProps = permissionProps([Permission.IncidentViewer], {
      blocked: [Permission.IncidentMember],
    });

    const call: RouteCall = await post(draft([SHARED_MONITOR]));

    expect(call.thrown).toBeInstanceOf(NotAuthorizedException);
  });

  test("a master admin may ask", async () => {
    useSitePages();
    callerProps = {
      ...permissionProps([]),
      isMasterAdmin: true,
    };

    const call: RouteCall = await post(draft([SHARED_MONITOR]));

    expect(call.thrown).toBeUndefined();
  });

  test("a request without a project is refused", async () => {
    callerProps = {
      userId: USER_ID,
    };

    const call: RouteCall = await post(draft([SHARED_MONITOR]));

    expect(call.thrown).toBeInstanceOf(BadDataException);
    expect(findByMonitors).not.toHaveBeenCalled();
  });
});

describe("the request", () => {
  test.each([
    [
      "both an incident and a draft",
      { incidentId: INCIDENT_ID, monitorIds: [SHARED_MONITOR] },
      "Send either incidentId, or monitorIds and statusPageIds - not both.",
    ],
    ["neither", {}, "Send incidentId, or monitorIds and statusPageIds."],
    [
      "an invalid incident id",
      { incidentId: "not-an-id" },
      "incidentId must be a valid ID.",
    ],
    [
      "an invalid monitor id",
      { monitorIds: [SHARED_MONITOR, "nope"] },
      "monitorIds must be a valid ID.",
    ],
    [
      "monitor ids that are not a list",
      { monitorIds: SHARED_MONITOR },
      "monitorIds must be a list of IDs.",
    ],
    [
      "status page ids that are not a list",
      { monitorIds: [SHARED_MONITOR], statusPageIds: "x" },
      "statusPageIds must be a list of IDs.",
    ],
  ])("refuses %s", async (_name: string, body: JSONObject, message: string) => {
    const call: RouteCall = await post(body);

    expect(call.thrown).toBeInstanceOf(BadDataException);
    expect((call.thrown as BadDataException).message).toBe(message);
  });

  test("refuses more ids than one request may name", async () => {
    const tooMany: Array<string> = Array.from(
      { length: IncidentSubscriberAudience.maxIdsPerRequest + 1 },
      (): string => {
        return ObjectID.generate().toString();
      },
    );

    const call: RouteCall = await post({ monitorIds: tooMany });

    expect(call.thrown).toBeInstanceOf(BadDataException);
    expect(findByMonitors).not.toHaveBeenCalled();
  });

  test("accepts serialized ObjectIDs", async () => {
    useSitePages();

    const audience: IncidentSubscriberAudienceResult = await audienceFor({
      monitorIds: [new ObjectID(SHARED_MONITOR).toJSON()],
      statusPageIds: [new ObjectID(sitePageId(1)).toJSON()],
    });

    expect(names(audience.statusPages)).toEqual(["Site 01"]);
  });

  test("status page ids alone are a draft on no monitor", async () => {
    useSitePages();

    const audience: IncidentSubscriberAudienceResult = await audienceFor({
      statusPageIds: [sitePageId(1)],
    });

    expect(audience.hasMonitors).toBe(false);
  });
});
