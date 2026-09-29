import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisodeMember from "../../../../Models/DatabaseModels/IncidentEpisodeMember";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import IncidentEpisodeMemberService from "../../../../Server/Services/IncidentEpisodeMemberService";
import IncidentService from "../../../../Server/Services/IncidentService";
import StatusPageResourceService from "../../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../../Server/Services/StatusPageSubscriberService";
import IncidentStatusPageScope, {
  INCIDENT_SCOPE_COLUMNS,
  INCIDENT_SCOPE_SELECT,
  ResolvedIncidentStatusPages,
  StatusPageExclusionReason,
  SUBSCRIBER_NOTIFICATION_RESOURCE_SELECT,
} from "../../../../Server/Utils/StatusPage/IncidentStatusPageScope";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * IncidentStatusPageScope decides which status pages an incident reaches:
 * which pages show it and whose subscribers hear about it. These tests stub
 * the database behind it - status page resources by monitor, the status
 * pages, the incidents' stored scope, and the display queries - and pin down:
 *
 *   - scope intersects with the pages the monitors reach, and never widens;
 *   - pages that only show scoped incidents never reach an unscoped one;
 *   - an episode reaches the union of its incidents, each through its own
 *     scope;
 *   - the display queries split on isScopedToStatusPages in SQL, then merge,
 *     sort and truncate the two halves as the database would have;
 *   - the counts are disjoint and include projectId and
 *     isVisibleOnStatusPage;
 *   - everything fails closed when a scope column was not loaded.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);

const INCIDENT_A: string = "a0000000-0000-4000-8000-00000000000a";
const INCIDENT_B: string = "a0000000-0000-4000-8000-00000000000b";

const SHARED_MONITOR: string = "c0000000-0000-4000-8000-000000000001";
const OTHER_MONITOR: string = "c0000000-0000-4000-8000-000000000002";

// Ten site pages that all list the shared monitor.
const SITE_PAGE_IDS: Array<string> = Array.from(
  { length: 10 },
  (_value: unknown, index: number): string => {
    return `b0000000-0000-4000-8000-0000000000${(index + 1).toString().padStart(2, "0")}`;
  },
);

function sitePageId(site: number): string {
  return SITE_PAGE_IDS[site - 1]!;
}

function siteName(site: number): string {
  return `Site ${site.toString().padStart(2, "0")}`;
}

interface PageFixture {
  id: string;
  name: string;
  onlyShowScopedIncidents?: boolean | undefined;
}

interface ResourceFixture {
  id: string;
  statusPageId: string;
  monitorId: string;
  displayName: string;
}

interface IncidentScopeFixture {
  id: string;
  isScopedToStatusPages?: boolean | undefined;
  statusPageIds?: Array<string> | undefined;
}

let pages: Array<PageFixture> = [];
let resources: Array<ResourceFixture> = [];
let storedScopes: Array<IncidentScopeFixture> = [];

let findByMonitors: MockFunction;
let getStatusPagesToSendNotification: MockFunction;
let incidentFindBy: MockFunction;
let incidentCountBy: MockFunction;
let episodeMemberFindBy: MockFunction;

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

function makePage(fixture: PageFixture): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = fixture.id;
  page.name = fixture.name;
  page.projectId = PROJECT_ID;

  if (fixture.onlyShowScopedIncidents !== undefined) {
    page.onlyShowScopedIncidents = fixture.onlyShowScopedIncidents;
  }

  return page;
}

function makeResource(fixture: ResourceFixture): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource();
  resource._id = fixture.id;
  resource.statusPageId = new ObjectID(fixture.statusPageId);
  resource.displayName = fixture.displayName;
  return resource;
}

function incidentOn(id: string, monitorIds: Array<string>): Incident {
  const incident: Incident = new Incident();
  incident._id = id;
  incident.monitors = monitorIds.map((monitorId: string): Monitor => {
    const monitor: Monitor = new Monitor();
    monitor._id = monitorId;
    return monitor;
  });
  return incident;
}

// Ten site pages listing the shared monitor, one resource each.
function useTenSitePages(onlyShowScopedIncidents: boolean = false): void {
  pages = SITE_PAGE_IDS.map((id: string, index: number): PageFixture => {
    return {
      id: id,
      name: siteName(index + 1),
      onlyShowScopedIncidents: onlyShowScopedIncidents,
    };
  });

  resources = SITE_PAGE_IDS.map(
    (id: string, index: number): ResourceFixture => {
      return {
        id: `d0000000-0000-4000-8000-0000000000${(index + 1).toString().padStart(2, "0")}`,
        statusPageId: id,
        monitorId: SHARED_MONITOR,
        displayName: `Checkout (${siteName(index + 1)})`,
      };
    },
  );
}

function reachedPageNames(
  resolved: ResolvedIncidentStatusPages,
): Array<string> {
  return resolved.statusPages.map((page: StatusPage): string => {
    return page.name!;
  });
}

function excludedPageNames(
  resolved: ResolvedIncidentStatusPages,
  reason: StatusPageExclusionReason,
): Array<string> {
  return resolved.excludedStatusPages
    .filter((excluded: { reason: StatusPageExclusionReason }): boolean => {
      return excluded.reason === reason;
    })
    .map((excluded: { statusPage: StatusPage }): string => {
      return excluded.statusPage.name!;
    });
}

beforeEach(() => {
  pages = [];
  resources = [];
  storedScopes = [];

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
          .map(makeResource),
      );
    },
  );
  jest
    .spyOn(StatusPageResourceService, "findByMonitors")
    .mockImplementation(findByMonitors as never);

  getStatusPagesToSendNotification = getJestMockFunction();
  getStatusPagesToSendNotification.mockImplementation(
    (ids: Array<ObjectID>): Promise<Array<StatusPage>> => {
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
    },
  );
  jest
    .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
    .mockImplementation(getStatusPagesToSendNotification as never);

  incidentFindBy = getJestMockFunction();
  incidentFindBy.mockImplementation(
    (findBy: { query: JSONObject }): Promise<Array<Incident>> => {
      const wanted: Array<string> = idsIn(findBy.query["_id"]);

      return Promise.resolve(
        storedScopes
          .filter((scope: IncidentScopeFixture): boolean => {
            return wanted.includes(scope.id);
          })
          .map((scope: IncidentScopeFixture): Incident => {
            const incident: Incident = new Incident();
            incident._id = scope.id;
            // Left unset when the fixture has no flag, as an unselected column reads.
            if (scope.isScopedToStatusPages !== undefined) {
              incident.isScopedToStatusPages = scope.isScopedToStatusPages;
            }
            incident.statusPages = (scope.statusPageIds || []).map(
              (id: string): StatusPage => {
                const page: StatusPage = new StatusPage();
                page._id = id;
                return page;
              },
            );
            return incident;
          }),
      );
    },
  );
  jest
    .spyOn(IncidentService, "findBy")
    .mockImplementation(incidentFindBy as never);

  incidentCountBy = getJestMockFunction();
  incidentCountBy.mockImplementation(
    (countBy: { query: JSONObject }): Promise<PositiveNumber> => {
      return Promise.resolve(
        new PositiveNumber(countBy.query["isScopedToStatusPages"] ? 2 : 5),
      );
    },
  );
  jest
    .spyOn(IncidentService, "countBy")
    .mockImplementation(incidentCountBy as never);

  episodeMemberFindBy = getJestMockFunction();
  episodeMemberFindBy.mockResolvedValue([] as never);
  jest
    .spyOn(IncidentEpisodeMemberService, "findBy")
    .mockImplementation(episodeMemberFindBy as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncidentStatusPageScope.resolvePagesForIncidents", () => {
  test("an unscoped incident on a monitor shared by ten pages reaches all ten, in name order", async () => {
    useTenSitePages();
    storedScopes = [{ id: INCIDENT_A, isScopedToStatusPages: false }];
    // Handed back out of order: the result is sorted by name.
    pages.reverse();

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [incidentOn(INCIDENT_A, [SHARED_MONITOR])],
      });

    expect(reachedPageNames(resolved)).toEqual(
      Array.from({ length: 10 }, (_v: unknown, i: number): string => {
        return siteName(i + 1);
      }),
    );
    expect(resolved.isScoped).toBe(false);
    expect(resolved.excludedStatusPages).toEqual([]);
  });

  test("a monitor shared by ten pages with the incident scoped to two reaches only those two", async () => {
    useTenSitePages();
    storedScopes = [
      {
        id: INCIDENT_A,
        isScopedToStatusPages: true,
        statusPageIds: [sitePageId(7), sitePageId(3)],
      },
    ];

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [incidentOn(INCIDENT_A, [SHARED_MONITOR])],
      });

    expect(reachedPageNames(resolved)).toEqual(["Site 03", "Site 07"]);
    expect(resolved.isScoped).toBe(true);
    expect(
      excludedPageNames(
        resolved,
        StatusPageExclusionReason.OutsideIncidentScope,
      ),
    ).toHaveLength(8);
  });

  test("each reached page keeps only its own resources", async () => {
    useTenSitePages();
    storedScopes = [
      {
        id: INCIDENT_A,
        isScopedToStatusPages: true,
        statusPageIds: [sitePageId(3), sitePageId(7)],
      },
    ];

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [incidentOn(INCIDENT_A, [SHARED_MONITOR])],
      });

    expect(Object.keys(resolved.statusPageToResources).sort()).toEqual(
      [sitePageId(3), sitePageId(7)].sort(),
    );
    expect(
      resolved.statusPageToResources[sitePageId(3)]!.map(
        (resource: StatusPageResource): string => {
          return resource.displayName!;
        },
      ),
    ).toEqual(["Checkout (Site 03)"]);
  });

  test("an unscoped incident reaches none of ten pages that only show scoped incidents", async () => {
    useTenSitePages(true);
    storedScopes = [{ id: INCIDENT_A, isScopedToStatusPages: false }];

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [incidentOn(INCIDENT_A, [SHARED_MONITOR])],
      });

    expect(resolved.statusPages).toEqual([]);
    expect(resolved.statusPageToResources).toEqual({});
    expect(
      excludedPageNames(
        resolved,
        StatusPageExclusionReason.OnlyShowsScopedIncidents,
      ),
    ).toHaveLength(10);
  });

  test("an unscoped incident still reaches the pages that do not only show scoped incidents", async () => {
    useTenSitePages();
    pages[0]!.onlyShowScopedIncidents = true;
    pages[1]!.onlyShowScopedIncidents = true;
    storedScopes = [{ id: INCIDENT_A, isScopedToStatusPages: false }];

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [incidentOn(INCIDENT_A, [SHARED_MONITOR])],
      });

    expect(reachedPageNames(resolved)).toHaveLength(8);
    expect(reachedPageNames(resolved)).not.toContain("Site 01");
    expect(reachedPageNames(resolved)).not.toContain("Site 02");
    expect(
      excludedPageNames(
        resolved,
        StatusPageExclusionReason.OnlyShowsScopedIncidents,
      ),
    ).toEqual(["Site 01", "Site 02"]);
  });

  test("a scoped incident reaches a page that only shows scoped incidents when it is scoped to it", async () => {
    useTenSitePages(true);
    storedScopes = [
      {
        id: INCIDENT_A,
        isScopedToStatusPages: true,
        statusPageIds: [sitePageId(5)],
      },
    ];

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [incidentOn(INCIDENT_A, [SHARED_MONITOR])],
      });

    expect(reachedPageNames(resolved)).toEqual(["Site 05"]);
  });

  /*
   * The customer's setup: every site page only shows scoped incidents, and
   * the incident is scoped to two of them. The other eight are left out
   * because the incident is limited to other pages - not because they only
   * show scoped incidents, which this one is.
   */
  test("pages that only show scoped incidents, left out of a scoped incident, are outside its scope", async () => {
    useTenSitePages(true);
    storedScopes = [
      {
        id: INCIDENT_A,
        isScopedToStatusPages: true,
        statusPageIds: [sitePageId(3), sitePageId(7)],
      },
    ];

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [incidentOn(INCIDENT_A, [SHARED_MONITOR])],
      });

    expect(reachedPageNames(resolved)).toEqual(["Site 03", "Site 07"]);
    expect(
      excludedPageNames(
        resolved,
        StatusPageExclusionReason.OutsideIncidentScope,
      ),
    ).toEqual([
      "Site 01",
      "Site 02",
      "Site 04",
      "Site 05",
      "Site 06",
      "Site 08",
      "Site 09",
      "Site 10",
    ]);
    expect(
      excludedPageNames(
        resolved,
        StatusPageExclusionReason.OnlyShowsScopedIncidents,
      ),
    ).toEqual([]);
  });

  test("a scope never adds a page that does not list the incident's monitors", async () => {
    useTenSitePages();
    const unrelatedPage: string = "b0000000-0000-4000-8000-0000000000ff";
    pages.push({ id: unrelatedPage, name: "Unrelated" });
    storedScopes = [
      {
        id: INCIDENT_A,
        isScopedToStatusPages: true,
        statusPageIds: [unrelatedPage, sitePageId(2)],
      },
    ];

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [incidentOn(INCIDENT_A, [SHARED_MONITOR])],
      });

    expect(reachedPageNames(resolved)).toEqual(["Site 02"]);
    // It is not even looked up: only pages the monitors reach are candidates.
    const requested: Array<string> = (
      getStatusPagesToSendNotification.mock.calls[0]![0] as Array<ObjectID>
    ).map((id: ObjectID): string => {
      return id.toString();
    });
    expect(requested).not.toContain(unrelatedPage);
  });

  test("an incident scoped to pages that were all deleted reaches nothing and looks nothing up", async () => {
    useTenSitePages();
    storedScopes = [
      { id: INCIDENT_A, isScopedToStatusPages: true, statusPageIds: [] },
    ];

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [incidentOn(INCIDENT_A, [SHARED_MONITOR])],
      });

    expect(resolved.statusPages).toEqual([]);
    expect(resolved.isScoped).toBe(true);
    expect(findByMonitors).not.toHaveBeenCalled();
    expect(getStatusPagesToSendNotification).not.toHaveBeenCalled();
  });

  test("an incident no longer found reaches nothing, rather than every page", async () => {
    useTenSitePages();
    storedScopes = [];

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [incidentOn(INCIDENT_A, [SHARED_MONITOR])],
      });

    expect(resolved.statusPages).toEqual([]);
    expect(findByMonitors).not.toHaveBeenCalled();
  });

  test("the scope is read from the database, never from the incident passed in", async () => {
    useTenSitePages();
    storedScopes = [
      {
        id: INCIDENT_A,
        isScopedToStatusPages: true,
        statusPageIds: [sitePageId(4)],
      },
    ];

    // A stale or hand-built object claiming to be unscoped.
    const passed: Incident = incidentOn(INCIDENT_A, [SHARED_MONITOR]);
    passed.isScopedToStatusPages = false;
    passed.statusPages = [];

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [passed],
      });

    expect(reachedPageNames(resolved)).toEqual(["Site 04"]);
    expect(incidentFindBy).toHaveBeenCalledTimes(1);
    expect(incidentFindBy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        select: {
          _id: true,
          isScopedToStatusPages: true,
          statusPages: { _id: true },
        },
        props: { isRoot: true },
      }),
    );
  });

  test("a stored scope with the flag missing is treated as scoped (fails closed)", async () => {
    useTenSitePages();
    storedScopes = [{ id: INCIDENT_A, statusPageIds: [sitePageId(1)] }];

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [incidentOn(INCIDENT_A, [SHARED_MONITOR])],
      });

    expect(reachedPageNames(resolved)).toEqual(["Site 01"]);
  });

  test("a page whose onlyShowScopedIncidents was not loaded never reaches an unscoped incident", async () => {
    useTenSitePages();
    pages[2]!.onlyShowScopedIncidents = undefined;
    storedScopes = [{ id: INCIDENT_A, isScopedToStatusPages: false }];

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [incidentOn(INCIDENT_A, [SHARED_MONITOR])],
      });

    expect(reachedPageNames(resolved)).not.toContain("Site 03");
    expect(reachedPageNames(resolved)).toHaveLength(9);
  });

  test("scope ids match whatever case they were stored in", async () => {
    useTenSitePages();
    storedScopes = [
      {
        id: INCIDENT_A,
        isScopedToStatusPages: true,
        statusPageIds: [sitePageId(6).toUpperCase()],
      },
    ];

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [incidentOn(INCIDENT_A.toUpperCase(), [SHARED_MONITOR])],
      });

    expect(reachedPageNames(resolved)).toEqual(["Site 06"]);
  });

  test("a status page deleted since its resource was read is dropped", async () => {
    useTenSitePages();
    pages = pages.filter((page: PageFixture): boolean => {
      return page.id !== sitePageId(9);
    });
    storedScopes = [{ id: INCIDENT_A, isScopedToStatusPages: false }];

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [incidentOn(INCIDENT_A, [SHARED_MONITOR])],
      });

    expect(reachedPageNames(resolved)).not.toContain("Site 09");
    expect(reachedPageNames(resolved)).toHaveLength(9);
  });

  test("an incident on no monitor reaches nothing", async () => {
    useTenSitePages();
    storedScopes = [{ id: INCIDENT_A, isScopedToStatusPages: false }];

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [incidentOn(INCIDENT_A, [])],
      });

    expect(resolved.statusPages).toEqual([]);
    expect(findByMonitors).not.toHaveBeenCalled();
  });

  test("an incident without an id is refused rather than guessed at", async () => {
    const incident: Incident = new Incident();
    incident.monitors = [];

    await expect(
      IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [incident],
      }),
    ).rejects.toBeInstanceOf(BadDataException);
  });

  test("resources are read with the subscriber jobs' select, plus what grouping needs", async () => {
    useTenSitePages();
    storedScopes = [{ id: INCIDENT_A, isScopedToStatusPages: false }];

    await IncidentStatusPageScope.resolvePagesForIncidents({
      incidents: [incidentOn(INCIDENT_A, [SHARED_MONITOR])],
    });

    expect(findByMonitors.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        select: {
          ...SUBSCRIBER_NOTIFICATION_RESOURCE_SELECT,
          _id: true,
          statusPageId: true,
        },
      }),
    );
  });

  test("pages sort by name, case-insensitively and with numbers in order", () => {
    const names: Array<string> = ["site 10", "Site 2", "Alpha", "site 1"];
    const sorted: Array<string> = names
      .map((name: string, index: number): StatusPage => {
        return makePage({ id: `id-${index}`, name: name });
      })
      .sort(IncidentStatusPageScope.compareStatusPagesByName)
      .map((page: StatusPage): string => {
        return page.name!;
      });

    expect(sorted).toEqual(["Alpha", "site 1", "Site 2", "site 10"]);
  });
});

describe("IncidentStatusPageScope.resolvePagesForIncidents, for an episode's incidents", () => {
  const PAGE_EAST: string = "b0000000-0000-4000-8000-0000000000e1";
  const PAGE_WEST: string = "b0000000-0000-4000-8000-0000000000e2";
  const PAGE_NORTH: string = "b0000000-0000-4000-8000-0000000000e3";

  beforeEach(() => {
    pages = [
      { id: PAGE_EAST, name: "East", onlyShowScopedIncidents: true },
      { id: PAGE_WEST, name: "West", onlyShowScopedIncidents: false },
      { id: PAGE_NORTH, name: "North", onlyShowScopedIncidents: false },
    ];
    resources = [
      {
        id: "d0000000-0000-4000-8000-0000000000e1",
        statusPageId: PAGE_EAST,
        monitorId: SHARED_MONITOR,
        displayName: "Checkout",
      },
      {
        id: "d0000000-0000-4000-8000-0000000000e2",
        statusPageId: PAGE_WEST,
        monitorId: SHARED_MONITOR,
        displayName: "Checkout",
      },
      {
        id: "d0000000-0000-4000-8000-0000000000e3",
        statusPageId: PAGE_WEST,
        monitorId: OTHER_MONITOR,
        displayName: "Payments",
      },
      {
        id: "d0000000-0000-4000-8000-0000000000e4",
        statusPageId: PAGE_NORTH,
        monitorId: OTHER_MONITOR,
        displayName: "Payments",
      },
    ];
  });

  test("reaches the union of what each incident reaches through its own scope", async () => {
    storedScopes = [
      // Scoped to East, which only shows scoped incidents.
      {
        id: INCIDENT_A,
        isScopedToStatusPages: true,
        statusPageIds: [PAGE_EAST],
      },
      // Unscoped: every page its monitor is on, except East.
      { id: INCIDENT_B, isScopedToStatusPages: false },
    ];

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [
          incidentOn(INCIDENT_A, [SHARED_MONITOR]),
          incidentOn(INCIDENT_B, [OTHER_MONITOR]),
        ],
      });

    expect(reachedPageNames(resolved)).toEqual(["East", "North", "West"]);
    // Dedupe applies when any incident of the episode is scoped.
    expect(resolved.isScoped).toBe(true);
  });

  test("a scoped-only page reached by the unscoped incident alone is left out because it only shows scoped incidents; one a scoped incident also skipped is outside its scope", async () => {
    storedScopes = [
      // Scoped to West, which does not only show scoped incidents.
      {
        id: INCIDENT_A,
        isScopedToStatusPages: true,
        statusPageIds: [PAGE_WEST],
      },
      // Unscoped, on the monitor East lists too: every page but East.
      { id: INCIDENT_B, isScopedToStatusPages: false },
    ];

    const onlyUnscoped: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [incidentOn(INCIDENT_B, [SHARED_MONITOR])],
      });

    expect(
      excludedPageNames(
        onlyUnscoped,
        StatusPageExclusionReason.OnlyShowsScopedIncidents,
      ),
    ).toEqual(["East"]);

    const both: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [
          incidentOn(INCIDENT_A, [SHARED_MONITOR]),
          incidentOn(INCIDENT_B, [SHARED_MONITOR]),
        ],
      });

    expect(
      excludedPageNames(both, StatusPageExclusionReason.OutsideIncidentScope),
    ).toEqual(["East"]);
    expect(
      excludedPageNames(
        both,
        StatusPageExclusionReason.OnlyShowsScopedIncidents,
      ),
    ).toEqual([]);
  });

  test("a page lists only the resources of the incidents that reach it", async () => {
    storedScopes = [
      {
        id: INCIDENT_A,
        isScopedToStatusPages: true,
        statusPageIds: [PAGE_EAST],
      },
      { id: INCIDENT_B, isScopedToStatusPages: false },
    ];

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [
          incidentOn(INCIDENT_A, [SHARED_MONITOR]),
          incidentOn(INCIDENT_B, [OTHER_MONITOR]),
        ],
      });

    // West lists the shared monitor too, but only B (other monitor) reaches it.
    expect(
      resolved.statusPageToResources[PAGE_WEST]!.map(
        (resource: StatusPageResource): string => {
          return resource.displayName!;
        },
      ),
    ).toEqual(["Payments"]);
  });

  test("unscoped incidents are looked up together, scoped ones on their own", async () => {
    storedScopes = [
      {
        id: INCIDENT_A,
        isScopedToStatusPages: true,
        statusPageIds: [PAGE_EAST],
      },
      { id: INCIDENT_B, isScopedToStatusPages: false },
      {
        id: "a0000000-0000-4000-8000-0000000000cc",
        isScopedToStatusPages: false,
      },
    ];

    await IncidentStatusPageScope.resolvePagesForIncidents({
      incidents: [
        incidentOn(INCIDENT_A, [SHARED_MONITOR]),
        incidentOn(INCIDENT_B, [OTHER_MONITOR]),
        incidentOn("a0000000-0000-4000-8000-0000000000cc", [
          OTHER_MONITOR,
          SHARED_MONITOR,
        ]),
      ],
    });

    // One lookup for both unscoped incidents, one for the scoped one.
    expect(findByMonitors).toHaveBeenCalledTimes(2);
    const unscopedLookup: Array<string> = (
      findByMonitors.mock.calls[0]![0] as { monitorIds: Array<ObjectID> }
    ).monitorIds.map((id: ObjectID): string => {
      return id.toString();
    });
    expect(unscopedLookup.sort()).toEqual(
      [OTHER_MONITOR, SHARED_MONITOR].sort(),
    );
    // Their scope is read in one query.
    expect(incidentFindBy).toHaveBeenCalledTimes(1);
  });

  test("a resource two incidents share is listed once", async () => {
    storedScopes = [
      {
        id: INCIDENT_A,
        isScopedToStatusPages: true,
        statusPageIds: [PAGE_WEST],
      },
      { id: INCIDENT_B, isScopedToStatusPages: false },
    ];

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [
          incidentOn(INCIDENT_A, [OTHER_MONITOR]),
          incidentOn(INCIDENT_B, [OTHER_MONITOR]),
        ],
      });

    expect(resolved.statusPageToResources[PAGE_WEST]).toHaveLength(1);
  });

  test("an episode of unscoped incidents is not deduplicated", async () => {
    storedScopes = [
      { id: INCIDENT_A, isScopedToStatusPages: false },
      { id: INCIDENT_B, isScopedToStatusPages: false },
    ];

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: [
          incidentOn(INCIDENT_A, [SHARED_MONITOR]),
          incidentOn(INCIDENT_B, [OTHER_MONITOR]),
        ],
      });

    expect(resolved.isScoped).toBe(false);
    expect(reachedPageNames(resolved)).toEqual(["North", "West"]);
  });
});

describe("IncidentStatusPageScope.getEpisodeMemberIncidents", () => {
  function member(data: {
    incidentId?: string;
    relationId?: string;
    monitorIds?: Array<string>;
    withIncident?: boolean;
  }): IncidentEpisodeMember {
    const row: IncidentEpisodeMember = new IncidentEpisodeMember();

    if (data.incidentId) {
      row.incidentId = new ObjectID(data.incidentId);
    }

    if (data.withIncident !== false) {
      const incident: Incident = incidentOn(
        data.relationId || "",
        data.monitorIds || [],
      );
      if (!data.relationId) {
        delete (incident as unknown as Dictionary<unknown>)["_id"];
      }
      row.incident = incident;
    }

    return row;
  }

  test("returns each member incident once, with its id and monitors", async () => {
    episodeMemberFindBy.mockResolvedValue([
      member({ relationId: INCIDENT_A, monitorIds: [SHARED_MONITOR] }),
      // Its relation came back without _id: the foreign key fills it in.
      member({ incidentId: INCIDENT_B, monitorIds: [OTHER_MONITOR] }),
      member({ relationId: INCIDENT_A, monitorIds: [SHARED_MONITOR] }),
      member({ incidentId: INCIDENT_B, withIncident: false }),
    ] as never);

    const incidents: Array<Incident> =
      await IncidentStatusPageScope.getEpisodeMemberIncidents(
        new ObjectID("e0000000-0000-4000-8000-000000000001"),
      );

    expect(
      incidents.map((incident: Incident): string => {
        return incident._id!;
      }),
    ).toEqual([INCIDENT_A, INCIDENT_B]);
    expect(incidents[1]!.monitors![0]!._id).toBe(OTHER_MONITOR);
  });

  test("asks for the incident id and monitors, as root", async () => {
    const episodeId: ObjectID = new ObjectID(
      "e0000000-0000-4000-8000-000000000001",
    );

    await IncidentStatusPageScope.getEpisodeMemberIncidents(episodeId);

    expect(episodeMemberFindBy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        query: { incidentEpisodeId: episodeId },
        select: {
          incidentId: true,
          incident: { _id: true, monitors: { _id: true } },
        },
        props: { isRoot: true },
      }),
    );
  });
});

describe("IncidentStatusPageScope.resolvePagesForDraftIncident", () => {
  test("with no pages picked, an unsaved incident reaches every page except scoped-only ones", async () => {
    useTenSitePages();
    pages[0]!.onlyShowScopedIncidents = true;

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForDraftIncident({
        monitorIds: [new ObjectID(SHARED_MONITOR)],
      });

    expect(reachedPageNames(resolved)).toHaveLength(9);
    expect(resolved.isScoped).toBe(false);
    // Nothing to read from the database: it is not saved.
    expect(incidentFindBy).not.toHaveBeenCalled();
  });

  test("with pages picked, it reaches only those among the monitors' pages", async () => {
    useTenSitePages(true);

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForDraftIncident({
        monitorIds: [new ObjectID(SHARED_MONITOR)],
        statusPageIds: [new ObjectID(sitePageId(2)), sitePageId(9)],
      });

    expect(reachedPageNames(resolved)).toEqual(["Site 02", "Site 09"]);
    expect(resolved.isScoped).toBe(true);
  });
});

describe("IncidentStatusPageScope.findIncidentsForStatusPage", () => {
  const STATUS_PAGE_ID: string = "b0000000-0000-4000-8000-0000000000aa";

  function page(onlyShowScopedIncidents: boolean | undefined): StatusPage {
    return makePage({
      id: STATUS_PAGE_ID,
      name: "Site",
      onlyShowScopedIncidents: onlyShowScopedIncidents,
    });
  }

  function incidentAt(
    id: string,
    declaredAt: Date | null,
    createdAt: Date = new Date("2026-01-01T00:00:00Z"),
  ): Incident {
    const incident: Incident = new Incident();
    incident._id = id;
    incident.declaredAt = declaredAt as Date;
    incident.createdAt = createdAt;
    incident.title = `Incident ${id}`;
    return incident;
  }

  let unscopedRows: Array<Incident> = [];
  let scopedRows: Array<Incident> = [];

  beforeEach(() => {
    unscopedRows = [];
    scopedRows = [];

    incidentFindBy.mockImplementation(
      (findBy: {
        query: JSONObject;
        limit: number;
      }): Promise<Array<Incident>> => {
        const rows: Array<Incident> = findBy.query["isScopedToStatusPages"]
          ? scopedRows
          : unscopedRows;

        // Fresh objects, as the database would return, cut at the limit.
        return Promise.resolve(
          rows.slice(0, findBy.limit).map((row: Incident): Incident => {
            const copy: Incident = new Incident();
            Object.assign(copy, row);
            return copy;
          }),
        );
      },
    );
  });

  function queries(): Array<JSONObject> {
    return incidentFindBy.mock.calls.map((call: Array<unknown>): JSONObject => {
      return (call[0] as { query: JSONObject }).query;
    });
  }

  test("runs the caller's query twice, split on isScopedToStatusPages", async () => {
    const monitors: Array<ObjectID> = [new ObjectID(SHARED_MONITOR)];

    await IncidentStatusPageScope.findIncidentsForStatusPage({
      statusPage: page(false),
      query: {
        monitors: monitors as never,
        projectId: PROJECT_ID,
        isVisibleOnStatusPage: true,
      },
      select: { _id: true, title: true },
      limit: 10,
      props: { isRoot: true },
    });

    expect(queries()).toEqual([
      {
        monitors: monitors,
        projectId: PROJECT_ID,
        isVisibleOnStatusPage: true,
        isScopedToStatusPages: false,
      },
      {
        monitors: monitors,
        projectId: PROJECT_ID,
        isVisibleOnStatusPage: true,
        isScopedToStatusPages: true,
        statusPages: [STATUS_PAGE_ID],
      },
    ]);
  });

  test("a page that only shows scoped incidents runs only the scoped half", async () => {
    await IncidentStatusPageScope.findIncidentsForStatusPage({
      statusPage: page(true),
      query: { projectId: PROJECT_ID },
      select: { _id: true },
      limit: 10,
      props: { isRoot: true },
    });

    expect(queries()).toEqual([
      {
        projectId: PROJECT_ID,
        isScopedToStatusPages: true,
        statusPages: [STATUS_PAGE_ID],
      },
    ]);
  });

  test("a page whose onlyShowScopedIncidents was not loaded runs only the scoped half", async () => {
    await IncidentStatusPageScope.findIncidentsForStatusPage({
      statusPage: page(undefined),
      query: { projectId: PROJECT_ID },
      select: { _id: true },
      limit: 10,
      props: { isRoot: true },
    });

    expect(queries()).toHaveLength(1);
    expect(queries()[0]!["isScopedToStatusPages"]).toBe(true);
  });

  test("a caller cannot widen the scoped half through its own query", async () => {
    await IncidentStatusPageScope.findIncidentsForStatusPage({
      statusPage: page(false),
      query: {
        projectId: PROJECT_ID,
        isScopedToStatusPages: true,
        statusPages: ["b0000000-0000-4000-8000-0000000000bb"] as never,
      },
      select: { _id: true },
      limit: 10,
      props: { isRoot: true },
    });

    expect(queries()[0]!["isScopedToStatusPages"]).toBe(false);
    expect(queries()[1]!["statusPages"]).toEqual([STATUS_PAGE_ID]);
  });

  test("merges both halves, sorted as the database would, and cut to the limit", async () => {
    // Each half is already sorted newest first and capped by the database.
    unscopedRows = [
      incidentAt("u1", new Date("2026-05-10T00:00:00Z")),
      incidentAt("u2", new Date("2026-05-07T00:00:00Z")),
      incidentAt("u3", new Date("2026-05-01T00:00:00Z")),
    ];
    scopedRows = [
      incidentAt("s1", new Date("2026-05-09T00:00:00Z")),
      incidentAt("s2", new Date("2026-05-08T00:00:00Z")),
      incidentAt("s3", new Date("2026-04-01T00:00:00Z")),
    ];

    const incidents: Array<Incident> =
      await IncidentStatusPageScope.findIncidentsForStatusPage({
        statusPage: page(false),
        query: { projectId: PROJECT_ID },
        select: { _id: true, title: true, declaredAt: true },
        sort: {
          declaredAt: SortOrder.Descending,
          createdAt: SortOrder.Descending,
        },
        limit: 4,
        props: { isRoot: true },
      });

    expect(
      incidents.map((incident: Incident): string => {
        return incident._id!;
      }),
    ).toEqual(["u1", "s1", "s2", "u2"]);

    // Each half was read up to the limit, so the cut sees every candidate.
    for (const call of incidentFindBy.mock.calls) {
      expect((call[0] as { limit: number; skip: number }).limit).toBe(4);
      expect((call[0] as { limit: number; skip: number }).skip).toBe(0);
    }
  });

  test("an in-scope incident is never lost to the unscoped half filling the limit", async () => {
    // The unscoped half alone fills the limit with older incidents.
    unscopedRows = Array.from({ length: 5 }, (_v: unknown, i: number) => {
      return incidentAt(`u${i}`, new Date(`2026-03-0${i + 1}T00:00:00Z`));
    }).reverse();
    scopedRows = [incidentAt("scoped", new Date("2026-06-01T00:00:00Z"))];

    const incidents: Array<Incident> =
      await IncidentStatusPageScope.findIncidentsForStatusPage({
        statusPage: page(false),
        query: { projectId: PROJECT_ID },
        select: { _id: true, declaredAt: true },
        sort: { declaredAt: SortOrder.Descending },
        limit: 5,
        props: { isRoot: true },
      });

    expect(incidents).toHaveLength(5);
    expect(incidents[0]!._id).toBe("scoped");
  });

  test("skip reads skip + limit from each half and pages through the merge", async () => {
    unscopedRows = [
      incidentAt("u1", new Date("2026-05-10T00:00:00Z")),
      incidentAt("u2", new Date("2026-05-07T00:00:00Z")),
    ];
    scopedRows = [
      incidentAt("s1", new Date("2026-05-09T00:00:00Z")),
      incidentAt("s2", new Date("2026-05-08T00:00:00Z")),
    ];

    const incidents: Array<Incident> =
      await IncidentStatusPageScope.findIncidentsForStatusPage({
        statusPage: page(false),
        query: { projectId: PROJECT_ID },
        select: { _id: true, declaredAt: true },
        sort: { declaredAt: SortOrder.Descending },
        limit: 2,
        skip: 2,
        props: { isRoot: true },
      });

    expect(
      incidents.map((incident: Incident): string => {
        return incident._id!;
      }),
    ).toEqual(["s2", "u2"]);
    expect((incidentFindBy.mock.calls[0]![0] as { limit: number }).limit).toBe(
      4,
    );
  });

  test("sorts missing values as Postgres does: first descending, last ascending", async () => {
    unscopedRows = [incidentAt("dated", new Date("2026-05-10T00:00:00Z"))];
    scopedRows = [incidentAt("undated", null)];

    const descending: Array<Incident> =
      await IncidentStatusPageScope.findIncidentsForStatusPage({
        statusPage: page(false),
        query: {},
        select: { _id: true, declaredAt: true },
        sort: { declaredAt: SortOrder.Descending },
        limit: 5,
        props: { isRoot: true },
      });

    const ascending: Array<Incident> =
      await IncidentStatusPageScope.findIncidentsForStatusPage({
        statusPage: page(false),
        query: {},
        select: { _id: true, declaredAt: true },
        sort: { declaredAt: SortOrder.Ascending },
        limit: 5,
        props: { isRoot: true },
      });

    expect(
      descending.map((incident: Incident): string => {
        return incident._id!;
      }),
    ).toEqual(["undated", "dated"]);
    expect(
      ascending.map((incident: Incident): string => {
        return incident._id!;
      }),
    ).toEqual(["dated", "undated"]);
  });

  test("breaks ties on the next sort key", async () => {
    const sameDay: Date = new Date("2026-05-10T00:00:00Z");
    unscopedRows = [
      incidentAt("older", sameDay, new Date("2026-05-10T01:00:00Z")),
    ];
    scopedRows = [
      incidentAt("newer", sameDay, new Date("2026-05-10T02:00:00Z")),
    ];

    const incidents: Array<Incident> =
      await IncidentStatusPageScope.findIncidentsForStatusPage({
        statusPage: page(false),
        query: {},
        select: { _id: true, declaredAt: true, createdAt: true },
        sort: {
          declaredAt: SortOrder.Descending,
          createdAt: SortOrder.Descending,
        },
        limit: 5,
        props: { isRoot: true },
      });

    expect(
      incidents.map((incident: Incident): string => {
        return incident._id!;
      }),
    ).toEqual(["newer", "older"]);
  });

  test("an incident returned by both halves is listed once", async () => {
    const shared: Incident = incidentAt("same", new Date());
    unscopedRows = [shared];
    scopedRows = [shared];

    const incidents: Array<Incident> =
      await IncidentStatusPageScope.findIncidentsForStatusPage({
        statusPage: page(false),
        query: {},
        select: { _id: true },
        limit: 5,
        props: { isRoot: true },
      });

    expect(incidents).toHaveLength(1);
  });

  test("reads unselected sort keys for the merge and removes them again", async () => {
    unscopedRows = [incidentAt("u1", new Date("2026-05-10T00:00:00Z"))];

    const incidents: Array<Incident> =
      await IncidentStatusPageScope.findIncidentsForStatusPage({
        statusPage: page(false),
        query: {},
        select: { title: true },
        sort: { declaredAt: SortOrder.Descending },
        limit: 5,
        props: { isRoot: true },
      });

    expect(
      (incidentFindBy.mock.calls[0]![0] as { select: JSONObject }).select,
    ).toEqual({ title: true, _id: true, declaredAt: true });
    expect(incidents[0]!.declaredAt).toBeUndefined();
    expect(incidents[0]!._id).toBe("u1");
    expect(incidents[0]!.title).toBe("Incident u1");
  });

  test("never selects the scope columns into what it returns", async () => {
    await IncidentStatusPageScope.findIncidentsForStatusPage({
      statusPage: page(false),
      query: {},
      select: { _id: true, title: true },
      sort: { declaredAt: SortOrder.Descending },
      limit: 5,
      props: { isRoot: true },
    });

    for (const call of incidentFindBy.mock.calls) {
      const select: JSONObject = (call[0] as { select: JSONObject }).select;

      for (const column of INCIDENT_SCOPE_COLUMNS) {
        expect(select[column]).toBeUndefined();
      }
    }
  });

  test("passes the caller's props through and does not change the caller's select", async () => {
    const select: JSONObject = { title: true };

    await IncidentStatusPageScope.findIncidentsForStatusPage({
      statusPage: page(false),
      query: {},
      select: select,
      sort: { declaredAt: SortOrder.Descending },
      limit: 5,
      props: { isRoot: true, ignoreHooks: true },
    });

    expect(select).toEqual({ title: true });
    expect(
      (incidentFindBy.mock.calls[0]![0] as { props: JSONObject }).props,
    ).toEqual({ isRoot: true, ignoreHooks: true });
  });

  test("a limit of 0 reads nothing", async () => {
    const incidents: Array<Incident> =
      await IncidentStatusPageScope.findIncidentsForStatusPage({
        statusPage: page(false),
        query: {},
        select: { _id: true },
        limit: 0,
        props: { isRoot: true },
      });

    expect(incidents).toEqual([]);
    expect(incidentFindBy).not.toHaveBeenCalled();
  });

  test("a status page without an id is refused", async () => {
    await expect(
      IncidentStatusPageScope.findIncidentsForStatusPage({
        statusPage: { onlyShowScopedIncidents: false },
        query: {},
        select: { _id: true },
        limit: 5,
        props: { isRoot: true },
      }),
    ).rejects.toBeInstanceOf(BadDataException);
  });

  test("findOneIncidentForStatusPage returns the first match or null", async () => {
    scopedRows = [incidentAt("only", new Date())];

    const found: Incident | null =
      await IncidentStatusPageScope.findOneIncidentForStatusPage({
        statusPage: page(true),
        query: { _id: "only" },
        select: { _id: true },
        props: { isRoot: true },
      });

    expect(found?._id).toBe("only");
    expect((incidentFindBy.mock.calls[0]![0] as { limit: number }).limit).toBe(
      1,
    );

    scopedRows = [];

    expect(
      await IncidentStatusPageScope.findOneIncidentForStatusPage({
        statusPage: page(true),
        query: { _id: "only" },
        select: { _id: true },
        props: { isRoot: true },
      }),
    ).toBeNull();
  });
});

describe("IncidentStatusPageScope.countIncidentsForStatusPage", () => {
  const STATUS_PAGE_ID: string = "b0000000-0000-4000-8000-0000000000aa";

  function countQueries(): Array<JSONObject> {
    return incidentCountBy.mock.calls.map(
      (call: Array<unknown>): JSONObject => {
        return (call[0] as { query: JSONObject }).query;
      },
    );
  }

  test("adds two disjoint counts, each on the project's visible incidents", async () => {
    const monitors: Array<ObjectID> = [new ObjectID(SHARED_MONITOR)];

    const count: number =
      await IncidentStatusPageScope.countIncidentsForStatusPage({
        statusPage: makePage({
          id: STATUS_PAGE_ID,
          name: "Site",
          onlyShowScopedIncidents: false,
        }),
        projectId: PROJECT_ID,
        query: { monitors: monitors as never },
      });

    // 5 unscoped + 2 scoped (see the countBy stub).
    expect(count).toBe(7);
    expect(countQueries()).toEqual([
      {
        monitors: monitors,
        projectId: PROJECT_ID,
        isVisibleOnStatusPage: true,
        isScopedToStatusPages: false,
      },
      {
        monitors: monitors,
        projectId: PROJECT_ID,
        isVisibleOnStatusPage: true,
        isScopedToStatusPages: true,
        statusPages: [STATUS_PAGE_ID],
      },
    ]);
  });

  test("a page that only shows scoped incidents counts only those", async () => {
    const count: number =
      await IncidentStatusPageScope.countIncidentsForStatusPage({
        statusPage: makePage({
          id: STATUS_PAGE_ID,
          name: "Site",
          onlyShowScopedIncidents: true,
        }),
        projectId: PROJECT_ID,
        query: {},
      });

    expect(count).toBe(2);
    expect(countQueries()).toHaveLength(1);
  });

  test("projectId and isVisibleOnStatusPage cannot be loosened by the caller's query", async () => {
    const otherProject: ObjectID = ObjectID.generate();

    await IncidentStatusPageScope.countIncidentsForStatusPage({
      statusPage: makePage({
        id: STATUS_PAGE_ID,
        name: "Site",
        onlyShowScopedIncidents: false,
      }),
      projectId: PROJECT_ID,
      query: { projectId: otherProject, isVisibleOnStatusPage: false },
    });

    for (const query of countQueries()) {
      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(query["isVisibleOnStatusPage"]).toBe(true);
    }
  });

  test("counts as root unless told otherwise", async () => {
    await IncidentStatusPageScope.countIncidentsForStatusPage({
      statusPage: makePage({
        id: STATUS_PAGE_ID,
        name: "Site",
        onlyShowScopedIncidents: true,
      }),
      projectId: PROJECT_ID,
      query: {},
    });

    expect(
      (incidentCountBy.mock.calls[0]![0] as { props: JSONObject }).props,
    ).toEqual({ isRoot: true });
  });
});

describe("IncidentStatusPageScope.isIncidentInScope", () => {
  const PAGE: string = "b0000000-0000-4000-8000-0000000000aa";
  const OTHER_PAGE: string = "b0000000-0000-4000-8000-0000000000bb";

  function scoped(ids: Array<unknown>): Incident {
    const incident: Incident = new Incident();
    incident.isScopedToStatusPages = true;
    incident.statusPages = ids as Array<StatusPage>;
    return incident;
  }

  function unscoped(): Incident {
    const incident: Incident = new Incident();
    incident.isScopedToStatusPages = false;
    incident.statusPages = [];
    return incident;
  }

  function target(onlyShowScopedIncidents: boolean | undefined): StatusPage {
    return makePage({
      id: PAGE,
      name: "Site",
      onlyShowScopedIncidents: onlyShowScopedIncidents,
    });
  }

  test("a scoped incident is in scope only on its own pages", () => {
    expect(
      IncidentStatusPageScope.isIncidentInScope(
        scoped([{ _id: PAGE }]),
        target(true),
      ),
    ).toBe(true);
    expect(
      IncidentStatusPageScope.isIncidentInScope(
        scoped([{ _id: OTHER_PAGE }]),
        target(false),
      ),
    ).toBe(false);
  });

  test("scope ids match in any shape and case", () => {
    expect(
      IncidentStatusPageScope.isIncidentInScope(
        scoped([new ObjectID(PAGE.toUpperCase())]),
        target(true),
      ),
    ).toBe(true);
    expect(
      IncidentStatusPageScope.isIncidentInScope(scoped([PAGE]), {
        id: new ObjectID(PAGE),
        onlyShowScopedIncidents: true,
      }),
    ).toBe(true);
  });

  test("a scoped incident whose pages were all deleted is in no page's scope", () => {
    expect(
      IncidentStatusPageScope.isIncidentInScope(scoped([]), target(false)),
    ).toBe(false);
  });

  test("an unscoped incident is in scope unless the page only shows scoped incidents", () => {
    expect(
      IncidentStatusPageScope.isIncidentInScope(unscoped(), target(false)),
    ).toBe(true);
    expect(
      IncidentStatusPageScope.isIncidentInScope(unscoped(), target(true)),
    ).toBe(false);
  });

  test("fails closed when a scope column was not loaded", () => {
    // The page's switch not loaded.
    expect(
      IncidentStatusPageScope.isIncidentInScope(unscoped(), target(undefined)),
    ).toBe(false);

    // The incident's flag not loaded.
    const notLoaded: Incident = new Incident();
    expect(
      IncidentStatusPageScope.isIncidentInScope(notLoaded, target(false)),
    ).toBe(false);
  });
});

describe("IncidentStatusPageScope.removeScopeColumns", () => {
  test("removes every scope column and leaves the rest", () => {
    const incident: Incident = new Incident();
    incident._id = INCIDENT_A;
    incident.title = "Checkout down";
    incident.isScopedToStatusPages = true;
    incident.statusPages = [makePage({ id: "x", name: "Secret site" })];
    incident.statusPagesNotifiedOnCreation = ["x"];

    const cleaned: Incident =
      IncidentStatusPageScope.removeScopeColumns(incident);

    expect(cleaned.title).toBe("Checkout down");
    expect(cleaned._id).toBe(INCIDENT_A);
    for (const column of INCIDENT_SCOPE_COLUMNS) {
      expect(Object.prototype.hasOwnProperty.call(cleaned, column)).toBe(false);
    }
    expect(JSON.stringify(cleaned)).not.toContain("Secret site");
  });

  test("removes them from an incident's JSON too", () => {
    const json: JSONObject = {
      _id: INCIDENT_A,
      title: "Checkout down",
      isScopedToStatusPages: true,
      statusPages: [{ _id: "x", name: "Secret site" }],
      statusPagesNotifiedOnCreation: ["x"],
    };

    expect(IncidentStatusPageScope.removeScopeColumns(json)).toEqual({
      _id: INCIDENT_A,
      title: "Checkout down",
    });
  });
});

describe("INCIDENT_SCOPE_SELECT", () => {
  test("selects what isIncidentInScope reads, all of it scope columns to remove again", () => {
    expect(Object.keys(INCIDENT_SCOPE_SELECT).sort()).toEqual([
      "isScopedToStatusPages",
      "statusPages",
    ]);

    for (const column of Object.keys(INCIDENT_SCOPE_SELECT)) {
      expect(INCIDENT_SCOPE_COLUMNS).toContain(column);
    }
  });

  test("an incident read with it can be placed in or out of a page's scope", () => {
    const incident: Incident = new Incident();
    incident.isScopedToStatusPages = true;
    incident.statusPages = [makePage({ id: sitePageId(1), name: siteName(1) })];

    expect(
      IncidentStatusPageScope.isIncidentInScope(incident, {
        _id: sitePageId(1),
        onlyShowScopedIncidents: true,
      }),
    ).toBe(true);
    expect(
      IncidentStatusPageScope.isIncidentInScope(incident, {
        _id: sitePageId(2),
        onlyShowScopedIncidents: false,
      }),
    ).toBe(false);
  });
});

describe("StatusPageSubscriberService.getStatusPagesToSendNotification", () => {
  test("loads onlyShowScopedIncidents, which the scope helper decides from", async () => {
    jest.restoreAllMocks();

    const statusPageFindBy: MockFunction = getJestMockFunction();
    statusPageFindBy.mockResolvedValue([] as never);
    jest
      .spyOn(StatusPageService, "findBy")
      .mockImplementation(statusPageFindBy as never);

    await StatusPageSubscriberService.getStatusPagesToSendNotification([
      new ObjectID(SITE_PAGE_IDS[0]!),
    ]);

    const select: JSONObject = (
      statusPageFindBy.mock.calls[0]![0] as { select: JSONObject }
    ).select;

    expect(select["onlyShowScopedIncidents"]).toBe(true);
    // And what the jobs need to name and order the pages.
    expect(select["name"]).toBe(true);
    expect(select["showIncidentsOnStatusPage"]).toBe(true);
    expect(select["showEpisodesOnStatusPage"]).toBe(true);
  });
});
