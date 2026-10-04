import Monitor from "../../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import MonitorService from "../../../../Server/Services/MonitorService";
import StatusPageResourceService from "../../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import StatusPageReadAccess from "../../../../Server/Utils/StatusPage/StatusPageReadAccess";
import StatusPagesListingMonitorsBuilder, {
  StatusPagesListingMonitorsRequest,
} from "../../../../Server/Utils/StatusPage/StatusPagesListingMonitorsBuilder";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import StatusPageEventType from "../../../../Types/StatusPage/StatusPageEventType";
import StatusPagesListingMonitors, {
  StatusPagesListingMonitorsResult,
} from "../../../../Types/StatusPage/StatusPagesListingMonitors";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Which status pages list some monitors, for the suggestions under the
 * status page picker of a scheduled maintenance event or an announcement.
 *
 * The builder runs for real; only the rows it reads are stubbed - the
 * monitors and status pages, read with the caller's permissions or as root,
 * and the status page resources found from the monitors. What is pinned:
 *
 *   - what the caller learns is bounded by what they may read: monitors they
 *     cannot read are not looked up, and status pages they cannot read
 *     (status page access can be limited to pages with some labels) are
 *     neither named nor counted - through the same rule that decides which
 *     pages someone may pick for an incident;
 *   - the project: another project's monitors and pages never come back;
 *   - archived pages, and pages that do not show the kind of event asked
 *     about, are left out;
 *   - the request's shape, and the cap on how many monitors it names.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000002",
);

const API_MONITOR: string = "c0000000-0000-4000-8000-000000000001";
const DB_MONITOR: string = "c0000000-0000-4000-8000-000000000002";
const LONELY_MONITOR: string = "c0000000-0000-4000-8000-000000000003";
const SECRET_MONITOR: string = "c0000000-0000-4000-8000-000000000004";
const FOREIGN_MONITOR: string = "c0000000-0000-4000-8000-000000000005";

const PUBLIC_PAGE: string = "b0000000-0000-4000-8000-000000000001";
const EU_PAGE: string = "b0000000-0000-4000-8000-000000000002";
const INTERNAL_PAGE: string = "b0000000-0000-4000-8000-000000000003";
const ARCHIVED_PAGE: string = "b0000000-0000-4000-8000-000000000004";
const NO_MAINTENANCE_PAGE: string = "b0000000-0000-4000-8000-000000000005";
const NO_ANNOUNCEMENTS_PAGE: string = "b0000000-0000-4000-8000-000000000006";
const UNTITLED_PAGE: string = "b0000000-0000-4000-8000-000000000007";
const FOREIGN_PAGE: string = "b0000000-0000-4000-8000-000000000008";

interface PageFixture {
  id: string;
  name?: string | undefined;
  projectId?: ObjectID | undefined;
  isArchived?: boolean | undefined;
  showScheduledMaintenanceEventsOnStatusPage?: boolean | undefined;
  showAnnouncementsOnStatusPage?: boolean | undefined;
}

interface ResourceFixture {
  statusPageId: string;
  monitorId: string;
}

let pages: Array<PageFixture> = [];
let resources: Array<ResourceFixture> = [];
let monitorProjects: Dictionary<ObjectID> = {};
// The monitors and pages the caller may read; null reads every one.
let readableMonitorIds: Array<string> | null = null;
let readablePageIds: Array<string> | null = null;
// The caller has no monitor, or no status page, read access at all.
let monitorReadRefused: boolean = false;
let statusPageReadRefused: boolean = false;

let monitorFindBy: MockFunction;
let findByMonitors: MockFunction;
let statusPageFindBy: MockFunction;

const CALLER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("20000000-0000-4000-8000-000000000001"),
  tenantId: PROJECT_ID,
};

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

function makePage(fixture: PageFixture): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = fixture.id;
  if (fixture.name !== undefined) {
    page.name = fixture.name;
  }
  page.projectId = fixture.projectId || PROJECT_ID;
  page.isArchived = fixture.isArchived ?? false;
  page.showScheduledMaintenanceEventsOnStatusPage =
    fixture.showScheduledMaintenanceEventsOnStatusPage ?? true;
  page.showAnnouncementsOnStatusPage =
    fixture.showAnnouncementsOnStatusPage ?? true;
  return page;
}

function request(
  monitorIds: Array<string>,
  eventType?: StatusPageEventType | undefined,
): StatusPagesListingMonitorsRequest {
  return {
    projectId: PROJECT_ID,
    props: CALLER,
    monitorIds: monitorIds.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    ...(eventType ? { eventType: eventType } : {}),
  };
}

async function namesFor(
  monitorIds: Array<string>,
  eventType?: StatusPageEventType | undefined,
): Promise<Array<string>> {
  const result: StatusPagesListingMonitorsResult =
    await StatusPagesListingMonitorsBuilder.build(
      request(monitorIds, eventType),
    );

  return result.statusPages.map((page: { name: string }): string => {
    return page.name;
  });
}

function parse(body: unknown): StatusPagesListingMonitorsRequest {
  return StatusPagesListingMonitorsBuilder.parseRequest({
    body: body,
    projectId: PROJECT_ID,
    props: CALLER,
  });
}

function monitorIdsLookedUp(): Array<string> {
  return findByMonitors.mock.calls.flatMap((call: Array<unknown>) => {
    return (call[0] as { monitorIds: Array<ObjectID> }).monitorIds.map(
      (id: ObjectID): string => {
        return id.toString();
      },
    );
  });
}

beforeEach(() => {
  pages = [
    { id: PUBLIC_PAGE, name: "Acme Public" },
    { id: EU_PAGE, name: "EU Status" },
    { id: INTERNAL_PAGE, name: "Internal" },
    { id: ARCHIVED_PAGE, name: "Old Public", isArchived: true },
    {
      id: NO_MAINTENANCE_PAGE,
      name: "Incidents Only",
      showScheduledMaintenanceEventsOnStatusPage: false,
    },
    {
      id: NO_ANNOUNCEMENTS_PAGE,
      name: "No Announcements",
      showAnnouncementsOnStatusPage: false,
    },
    { id: UNTITLED_PAGE, name: "   " },
    { id: FOREIGN_PAGE, name: "Someone Else's", projectId: OTHER_PROJECT_ID },
  ];

  resources = [
    { statusPageId: EU_PAGE, monitorId: API_MONITOR },
    { statusPageId: PUBLIC_PAGE, monitorId: API_MONITOR },
    { statusPageId: PUBLIC_PAGE, monitorId: DB_MONITOR },
    { statusPageId: INTERNAL_PAGE, monitorId: SECRET_MONITOR },
  ];

  monitorProjects = {
    [API_MONITOR]: PROJECT_ID,
    [DB_MONITOR]: PROJECT_ID,
    [LONELY_MONITOR]: PROJECT_ID,
    [SECRET_MONITOR]: PROJECT_ID,
    [FOREIGN_MONITOR]: OTHER_PROJECT_ID,
  };

  readableMonitorIds = null;
  readablePageIds = null;
  monitorReadRefused = false;
  statusPageReadRefused = false;

  monitorFindBy = getJestMockFunction();
  monitorFindBy.mockImplementation(
    (findBy: {
      query: JSONObject;
      props: DatabaseCommonInteractionProps;
    }): Promise<Array<Monitor>> => {
      if (!findBy.props.isRoot && monitorReadRefused) {
        return Promise.reject(
          new NotAuthorizedException(
            "You do not have permissions to read Monitor.",
          ),
        );
      }

      return Promise.resolve(
        idsIn(findBy.query["_id"])
          .filter((id: string): boolean => {
            return (
              Boolean(monitorProjects[id]) &&
              sameId(monitorProjects[id], findBy.query["projectId"]) &&
              (findBy.props.isRoot ||
                readableMonitorIds === null ||
                readableMonitorIds.includes(id))
            );
          })
          .map((id: string): Monitor => {
            const monitor: Monitor = new Monitor();
            monitor._id = id;
            return monitor;
          }),
      );
    },
  );
  jest
    .spyOn(MonitorService, "findBy")
    .mockImplementation(monitorFindBy as never);

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

  /*
   * The caller's reads are scoped to their tenant and to the pages they may
   * read (labels); root reads check the project they are asked for.
   */
  statusPageFindBy = getJestMockFunction();
  statusPageFindBy.mockImplementation(
    (findBy: {
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
            if (!wanted.includes(page.id)) {
              return false;
            }

            if (findBy.props.isRoot) {
              return sameId(
                page.projectId || PROJECT_ID,
                findBy.query["projectId"],
              );
            }

            return (
              sameId(page.projectId || PROJECT_ID, findBy.props.tenantId) &&
              (readablePageIds === null || readablePageIds.includes(page.id))
            );
          })
          .map(makePage),
      );
    },
  );
  jest
    .spyOn(StatusPageService, "findBy")
    .mockImplementation(statusPageFindBy as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("StatusPagesListingMonitorsBuilder.build", () => {
  test("names the pages that list any of the monitors, in name order", async () => {
    const result: StatusPagesListingMonitorsResult =
      await StatusPagesListingMonitorsBuilder.build(
        request([API_MONITOR, DB_MONITOR]),
      );

    expect(result).toEqual({
      statusPages: [
        { statusPageId: PUBLIC_PAGE, name: "Acme Public" },
        { statusPageId: EU_PAGE, name: "EU Status" },
      ],
    });
  });

  test("a page listing two of the monitors is named once", async () => {
    expect(await namesFor([DB_MONITOR, API_MONITOR])).toEqual([
      "Acme Public",
      "EU Status",
    ]);
  });

  test("monitors on no status page suggest nothing, and no page is read", async () => {
    expect(await namesFor([LONELY_MONITOR])).toEqual([]);
    expect(statusPageFindBy).not.toHaveBeenCalled();
  });

  test("no monitors, nothing asked", async () => {
    expect(await namesFor([])).toEqual([]);
    expect(monitorFindBy).not.toHaveBeenCalled();
    expect(findByMonitors).not.toHaveBeenCalled();
    expect(statusPageFindBy).not.toHaveBeenCalled();
  });

  test("a page outside the labels the caller's status page access is limited to is neither named nor counted", async () => {
    // A Status Page Viewer limited to the label on Acme Public only.
    readablePageIds = [PUBLIC_PAGE];

    const result: StatusPagesListingMonitorsResult =
      await StatusPagesListingMonitorsBuilder.build(request([API_MONITOR]));

    expect(result).toEqual({
      statusPages: [{ statusPageId: PUBLIC_PAGE, name: "Acme Public" }],
    });
    // Nothing in the answer stands for the page left out.
    expect(Object.keys(StatusPagesListingMonitors.toJSON(result))).toEqual([
      "statusPages",
    ]);
    expect(JSON.stringify(result)).not.toContain(EU_PAGE);
    expect(JSON.stringify(result)).not.toContain("EU Status");
  });

  test("which pages the caller can read is StatusPageReadAccess's call, asked with the caller's own props", async () => {
    const getReadable: SpyInstance<
      typeof StatusPageReadAccess.getReadableStatusPageIds
    > = jest.spyOn(StatusPageReadAccess, "getReadableStatusPageIds");

    await namesFor([API_MONITOR]);

    expect(getReadable).toHaveBeenCalledTimes(1);
    expect(getReadable.mock.calls[0]![0].props).toBe(CALLER);
    expect([...getReadable.mock.calls[0]![0].statusPageIds].sort()).toEqual(
      [EU_PAGE, PUBLIC_PAGE].sort(),
    );

    // The caller's read is never root; only the names are read as root after it.
    const callerReads: Array<unknown> = statusPageFindBy.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return !(call[0] as { props: DatabaseCommonInteractionProps }).props
          .isRoot;
      },
    );
    expect(callerReads).toHaveLength(1);
    expect(
      (callerReads[0] as Array<{ props: DatabaseCommonInteractionProps }>)[0]!
        .props,
    ).toBe(CALLER);
  });

  test("the names are read only for the pages the caller can read, in the project", async () => {
    readablePageIds = [EU_PAGE];

    await namesFor([API_MONITOR]);

    const rootRead: { query: JSONObject } | undefined = (
      statusPageFindBy.mock.calls as Array<
        Array<{ query: JSONObject; props: DatabaseCommonInteractionProps }>
      >
    )
      .map(
        (
          call: Array<{
            query: JSONObject;
            props: DatabaseCommonInteractionProps;
          }>,
        ) => {
          return call[0]!;
        },
      )
      .find((findBy: { props: DatabaseCommonInteractionProps }): boolean => {
        return Boolean(findBy.props.isRoot);
      });

    expect(rootRead).toBeDefined();
    expect(idsIn(rootRead!.query["_id"])).toEqual([EU_PAGE]);
    expect(sameId(rootRead!.query["projectId"], PROJECT_ID)).toBe(true);
  });

  test("a caller with no status page read access at all gets nothing", async () => {
    statusPageReadRefused = true;

    expect(await namesFor([API_MONITOR, DB_MONITOR])).toEqual([]);
  });

  test("a monitor the caller cannot read is not looked up, so its pages are not named", async () => {
    // A Monitor Viewer limited to labels that the secret monitor lacks.
    readableMonitorIds = [API_MONITOR, DB_MONITOR, LONELY_MONITOR];

    expect(await namesFor([SECRET_MONITOR])).toEqual([]);
    expect(findByMonitors).not.toHaveBeenCalled();

    expect(await namesFor([SECRET_MONITOR, DB_MONITOR])).toEqual([
      "Acme Public",
    ]);
    expect(monitorIdsLookedUp()).toEqual([DB_MONITOR]);
  });

  test("the monitors are read with the caller's own props, in the caller's project", async () => {
    await namesFor([API_MONITOR]);

    expect(monitorFindBy).toHaveBeenCalledTimes(1);

    const findBy: { query: JSONObject; props: DatabaseCommonInteractionProps } =
      monitorFindBy.mock.calls[0]![0] as {
        query: JSONObject;
        props: DatabaseCommonInteractionProps;
      };

    expect(findBy.props).toBe(CALLER);
    expect(sameId(findBy.query["projectId"], PROJECT_ID)).toBe(true);
    expect(idsIn(findBy.query["_id"])).toEqual([API_MONITOR]);
  });

  test("another project's monitor is not looked up", async () => {
    // Even if a resource somewhere lists it.
    resources.push({ statusPageId: FOREIGN_PAGE, monitorId: FOREIGN_MONITOR });

    expect(await namesFor([FOREIGN_MONITOR])).toEqual([]);
    expect(findByMonitors).not.toHaveBeenCalled();
  });

  test("another project's page is never named, even if a resource points at it", async () => {
    resources.push({ statusPageId: FOREIGN_PAGE, monitorId: API_MONITOR });

    const result: StatusPagesListingMonitorsResult =
      await StatusPagesListingMonitorsBuilder.build(request([API_MONITOR]));

    expect(JSON.stringify(result)).not.toContain(FOREIGN_PAGE);
    expect(await namesFor([API_MONITOR])).toEqual(["Acme Public", "EU Status"]);
  });

  test("a caller who cannot read monitors at all gets nothing, and nothing is looked up", async () => {
    monitorReadRefused = true;

    expect(await namesFor([API_MONITOR, DB_MONITOR])).toEqual([]);
    expect(findByMonitors).not.toHaveBeenCalled();
    expect(statusPageFindBy).not.toHaveBeenCalled();
  });

  test("an archived page is not suggested: it is offline and tells its subscribers nothing", async () => {
    resources.push({ statusPageId: ARCHIVED_PAGE, monitorId: API_MONITOR });

    expect(await namesFor([API_MONITOR])).toEqual(["Acme Public", "EU Status"]);
    expect(
      await namesFor([API_MONITOR], StatusPageEventType.ScheduledEvent),
    ).toEqual(["Acme Public", "EU Status"]);
    expect(
      await namesFor([API_MONITOR], StatusPageEventType.Announcement),
    ).toEqual(["Acme Public", "EU Status"]);
  });

  test("for a maintenance event, a page that hides maintenance events is not suggested", async () => {
    resources.push(
      { statusPageId: NO_MAINTENANCE_PAGE, monitorId: API_MONITOR },
      { statusPageId: NO_ANNOUNCEMENTS_PAGE, monitorId: API_MONITOR },
    );

    expect(
      await namesFor([API_MONITOR], StatusPageEventType.ScheduledEvent),
    ).toEqual(["Acme Public", "EU Status", "No Announcements"]);
  });

  test("for an announcement, a page that hides announcements is not suggested", async () => {
    resources.push(
      { statusPageId: NO_MAINTENANCE_PAGE, monitorId: API_MONITOR },
      { statusPageId: NO_ANNOUNCEMENTS_PAGE, monitorId: API_MONITOR },
    );

    expect(
      await namesFor([API_MONITOR], StatusPageEventType.Announcement),
    ).toEqual(["Acme Public", "EU Status", "Incidents Only"]);
  });

  test("asked about no kind of event, every page that lists the monitors is named", async () => {
    resources.push(
      { statusPageId: NO_MAINTENANCE_PAGE, monitorId: API_MONITOR },
      { statusPageId: NO_ANNOUNCEMENTS_PAGE, monitorId: API_MONITOR },
    );

    expect(await namesFor([API_MONITOR])).toEqual([
      "Acme Public",
      "EU Status",
      "Incidents Only",
      "No Announcements",
    ]);
  });

  test("a page without a name is still suggested, under a name people can read", async () => {
    resources.push({ statusPageId: UNTITLED_PAGE, monitorId: API_MONITOR });

    expect(await namesFor([API_MONITOR])).toEqual([
      "Acme Public",
      "EU Status",
      "Untitled status page",
    ]);
  });

  test("the monitor lookup is the one the subscriber jobs use, so monitor groups count", async () => {
    await namesFor([API_MONITOR, DB_MONITOR]);

    expect(findByMonitors).toHaveBeenCalledTimes(1);
    expect(monitorIdsLookedUp()).toEqual([API_MONITOR, DB_MONITOR]);
  });

  test("a failure other than a refusal is not swallowed", async () => {
    findByMonitors.mockImplementation(() => {
      return Promise.reject(new Error("connection lost"));
    });

    await expect(namesFor([API_MONITOR])).rejects.toThrow("connection lost");

    findByMonitors.mockImplementation(() => {
      return Promise.resolve([]);
    });
    monitorFindBy.mockImplementation(() => {
      return Promise.reject(new Error("monitor read failed"));
    });

    await expect(namesFor([API_MONITOR])).rejects.toThrow(
      "monitor read failed",
    );
  });
});

describe("StatusPagesListingMonitorsBuilder.isShowing", () => {
  test("a flag that was not loaded counts as the column's default, on", () => {
    const page: StatusPage = new StatusPage();

    expect(StatusPagesListingMonitorsBuilder.isShowing(page, undefined)).toBe(
      true,
    );
    expect(
      StatusPagesListingMonitorsBuilder.isShowing(
        page,
        StatusPageEventType.ScheduledEvent,
      ),
    ).toBe(true);
    expect(
      StatusPagesListingMonitorsBuilder.isShowing(
        page,
        StatusPageEventType.Announcement,
      ),
    ).toBe(true);
  });

  test("an archived page shows nothing", () => {
    const page: StatusPage = new StatusPage();
    page.isArchived = true;

    for (const eventType of [
      undefined,
      StatusPageEventType.ScheduledEvent,
      StatusPageEventType.Announcement,
    ]) {
      expect(StatusPagesListingMonitorsBuilder.isShowing(page, eventType)).toBe(
        false,
      );
    }
  });
});

describe("StatusPagesListingMonitorsBuilder.parseRequest", () => {
  test("takes the monitors as a list of ids, and the kind of event", () => {
    const parsed: StatusPagesListingMonitorsRequest = parse({
      monitorIds: [API_MONITOR, ` ${DB_MONITOR} `],
      eventType: StatusPageEventType.ScheduledEvent,
    });

    expect(parsed.projectId).toBe(PROJECT_ID);
    expect(parsed.props).toBe(CALLER);
    expect(
      parsed.monitorIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([API_MONITOR, DB_MONITOR]);
    expect(parsed.eventType).toBe(StatusPageEventType.ScheduledEvent);
  });

  test("takes an id as JSON serializes an ObjectID", () => {
    const parsed: StatusPagesListingMonitorsRequest = parse({
      monitorIds: [{ _type: "ObjectID", value: API_MONITOR }],
      eventType: StatusPageEventType.Announcement,
    });

    expect(parsed.monitorIds[0]!.toString()).toBe(API_MONITOR);
    expect(parsed.eventType).toBe(StatusPageEventType.Announcement);
  });

  test("the kind of event may be left out", () => {
    for (const body of [
      { monitorIds: [API_MONITOR] },
      { monitorIds: [API_MONITOR], eventType: null },
    ]) {
      expect("eventType" in parse(body)).toBe(false);
    }
  });

  test("an empty list is a question with nothing to answer, not an error", () => {
    expect(parse({ monitorIds: [] }).monitorIds).toEqual([]);
  });

  test("refuses a body without a list of monitors", () => {
    for (const body of [
      undefined,
      null,
      "monitorIds",
      [API_MONITOR],
      {},
      { monitorIds: API_MONITOR },
      { monitorIds: { 0: API_MONITOR } },
    ]) {
      expect(() => {
        return parse(body);
      }).toThrow(new BadDataException("monitorIds must be a list of IDs."));
    }
  });

  test("refuses an id that is not one", () => {
    for (const id of ["", "not-an-id", 42, null, {}, ["x"]]) {
      expect(() => {
        return parse({ monitorIds: [API_MONITOR, id] });
      }).toThrow(
        new BadDataException("monitorIds must be a list of valid IDs."),
      );
    }
  });

  test("names at most 1000 monitors", () => {
    const ids: Array<string> = Array.from(
      { length: StatusPagesListingMonitors.maxIdsPerRequest },
      (_value: unknown, index: number): string => {
        return `c0000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
      },
    );

    expect(parse({ monitorIds: ids }).monitorIds).toHaveLength(1000);

    expect(() => {
      return parse({ monitorIds: [...ids, API_MONITOR] });
    }).toThrow(new BadDataException("monitorIds can list at most 1000 IDs."));
  });

  test("refuses a kind of event it does not suggest pages for", () => {
    for (const eventType of [
      StatusPageEventType.Incident,
      "Scheduled Maintenance",
      "announcement",
      1,
      true,
      {},
    ]) {
      expect(() => {
        return parse({ monitorIds: [API_MONITOR], eventType: eventType });
      }).toThrow(
        new BadDataException(
          "eventType must be one of: Scheduled Event, Announcement.",
        ),
      );
    }
  });
});
