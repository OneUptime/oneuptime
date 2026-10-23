import StatusPageSummaryBuilder from "../../../Utils/StatusPage/StatusPageSummaryBuilder";
import {
  STATUS_PAGE_SUMMARY_DEFAULT_STATUS_NAME,
  StatusPageSummary,
  StatusPageSummaryResource,
} from "../../../Types/StatusPage/StatusPageSummary";
import { JSONObject } from "../../../Types/JSON";
import {
  FAKE_STATUSES,
  FakeStatusPage,
  buildFakeOverview,
} from "../../Helpers/FakeStatusPageOverview";
import { describe, expect, test } from "@jest/globals";

/*
 * A status page's summary is its overview cut down: what the page shows of
 * each resource - its name, its group, its current status unless the page
 * hides it, and whether a scheduled maintenance event in progress affects
 * it - with the active incidents and the maintenance in progress and to
 * come. Built from the overview JSON the server keeps
 * (FakeStatusPageOverview builds it as buildOverviewResponse does), never
 * from more, so the summary cannot hold what the page does not show.
 */

const NOW: Date = new Date("2026-10-23T12:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;

const id: (suffix: string) => string = (suffix: string): string => {
  return `5e000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
};

// Monitors.
const M_API: string = id("a01");
const M_WEB: string = id("a02");
const M_DB_PRIMARY: string = id("a03");
const M_DB_REPLICA: string = id("a04");
const M_QUEUE: string = id("a05");
const M_OFF_PAGE: string = id("a06");

// Monitor groups.
const G_DATABASES: string = id("b01");

// The page's groups.
const PG_CORE: string = id("c01");
const PG_DATA: string = id("c02");

// The page's resources.
const R_API: string = id("d01");
const R_WEB: string = id("d02");
const R_DATABASES: string = id("d03");
const R_QUEUE: string = id("d04");

function summarize(page: FakeStatusPage): StatusPageSummary {
  // Through the wire and back, as the cache holds it after a JSON response.
  return StatusPageSummaryBuilder.fromOverview(
    JSON.parse(JSON.stringify(buildFakeOverview(page))) as JSONObject,
  );
}

function resource(
  summary: StatusPageSummary,
  resourceId: string,
): StatusPageSummaryResource {
  const found: StatusPageSummaryResource | undefined = summary.resources.find(
    (candidate: StatusPageSummaryResource): boolean => {
      return candidate.id === resourceId;
    },
  );

  expect({ resourceId, found: Boolean(found) }).toEqual({
    resourceId,
    found: true,
  });

  return found!;
}

// A department's page: two groups, one nested, a monitor group among the resources.
function departmentPage(
  overrides: Partial<FakeStatusPage> = {},
): FakeStatusPage {
  return {
    groups: [
      { id: PG_CORE, name: "Core" },
      { id: PG_DATA, name: "Data", parentId: PG_CORE },
    ],
    resources: [
      {
        id: R_API,
        name: "Checkout API",
        groupId: PG_CORE,
        monitorId: M_API,
        statusId: FAKE_STATUSES.operational.id,
      },
      {
        id: R_WEB,
        name: "Storefront",
        monitorId: M_WEB,
        statusId: FAKE_STATUSES.degraded.id,
      },
      {
        id: R_DATABASES,
        name: "Databases",
        groupId: PG_DATA,
        monitorGroupId: G_DATABASES,
      },
      {
        id: R_QUEUE,
        name: "Order queue",
        groupId: PG_CORE,
        monitorId: M_QUEUE,
        statusId: FAKE_STATUSES.operational.id,
      },
    ],
    monitorGroups: [
      {
        id: G_DATABASES,
        monitorIds: [M_DB_PRIMARY, M_DB_REPLICA],
        statusId: FAKE_STATUSES.offline.id,
      },
    ],
    ...overrides,
  };
}

describe("StatusPageSummaryBuilder.fromOverview: resources", () => {
  test("lists each resource the page draws, in the page's order, by the name the page gives it", () => {
    const summary: StatusPageSummary = summarize(departmentPage());

    expect(
      summary.resources.map((item: StatusPageSummaryResource) => {
        return [item.id, item.name];
      }),
    ).toEqual([
      [R_API, "Checkout API"],
      [R_WEB, "Storefront"],
      [R_DATABASES, "Databases"],
      [R_QUEUE, "Order queue"],
    ]);
  });

  test("names each resource's group with the groups above it", () => {
    const summary: StatusPageSummary = summarize(departmentPage());

    expect(resource(summary, R_API).groupName).toBe("Core");
    expect(resource(summary, R_DATABASES).groupName).toBe("Core / Data");
    expect(resource(summary, R_WEB).groupName).toBeNull();
  });

  test("gives a monitor its current status, with the status's color and whether it is operational", () => {
    const summary: StatusPageSummary = summarize(departmentPage());

    expect(resource(summary, R_API).currentStatus).toEqual({
      name: "Operational",
      color: "#2ab57d",
      isOperational: true,
    });
    expect(resource(summary, R_WEB).currentStatus).toEqual({
      name: "Degraded",
      color: "#f59e0b",
      isOperational: false,
    });
  });

  test("gives a monitor group its group's current status", () => {
    const summary: StatusPageSummary = summarize(departmentPage());

    expect(resource(summary, R_DATABASES).currentStatus).toEqual({
      name: "Offline",
      color: "#ef4444",
      isOperational: false,
    });
  });

  test("draws a resource with no status as Operational in green, as the page does", () => {
    const summary: StatusPageSummary = summarize(
      departmentPage({
        resources: [
          { id: R_API, name: "Checkout API", monitorId: M_API, statusId: null },
          { id: R_DATABASES, name: "Databases", monitorGroupId: G_DATABASES },
        ],
        monitorGroups: [{ id: G_DATABASES, monitorIds: [M_DB_PRIMARY] }],
      }),
    );

    for (const resourceId of [R_API, R_DATABASES]) {
      expect(resource(summary, resourceId).currentStatus).toEqual({
        name: STATUS_PAGE_SUMMARY_DEFAULT_STATUS_NAME,
        color: "#2ab57d",
        isOperational: true,
      });
    }
  });

  test("reads a status the project no longer has as the page draws it: Operational", () => {
    const summary: StatusPageSummary = summarize(
      departmentPage({
        resources: [
          {
            id: R_API,
            name: "Checkout API",
            monitorId: M_API,
            statusId: id("eee"),
          },
        ],
      }),
    );

    expect(resource(summary, R_API).currentStatus?.name).toBe("Operational");
  });

  test("shows no status for a resource whose page hides it, however bad it is", () => {
    const summary: StatusPageSummary = summarize(
      departmentPage({
        resources: [
          {
            id: R_WEB,
            name: "Storefront",
            monitorId: M_WEB,
            statusId: FAKE_STATUSES.offline.id,
            showCurrentStatus: false,
          },
          {
            id: R_DATABASES,
            name: "Databases",
            monitorGroupId: G_DATABASES,
            showCurrentStatus: false,
          },
        ],
      }),
    );

    expect(resource(summary, R_WEB).currentStatus).toBeNull();
    expect(resource(summary, R_DATABASES).currentStatus).toBeNull();

    // No resource's status reaches the summary...
    expect(JSON.stringify(summary.resources)).not.toContain("Offline");

    /*
     * ...but the page's banner counts every resource, as it does on the
     * page itself ("Some resources are Offline").
     */
    expect(summary.overallStatus?.name).toBe("Offline");
  });

  test("leaves out a resource that is neither a monitor nor a monitor group, as the page does", () => {
    const summary: StatusPageSummary = summarize(
      departmentPage({
        resources: [
          { id: R_API, name: "Checkout API", monitorId: M_API },
          { id: R_WEB, name: "Nothing behind it" },
        ],
      }),
    );

    expect(
      summary.resources.map((item: StatusPageSummaryResource) => {
        return item.id;
      }),
    ).toEqual([R_API]);
  });

  test("an empty page has an empty summary", () => {
    const summary: StatusPageSummary = summarize({ resources: [] });

    expect(summary).toEqual({
      overallStatus: {
        name: "Operational",
        color: "#2ab57d",
        isOperational: true,
      },
      resources: [],
      activeIncidents: [],
      ongoingScheduledMaintenance: [],
      upcomingScheduledMaintenance: [],
    });
  });

  test("an overview with nothing in it is no error", () => {
    expect(StatusPageSummaryBuilder.fromOverview({})).toEqual({
      overallStatus: null,
      resources: [],
      activeIncidents: [],
      ongoingScheduledMaintenance: [],
      upcomingScheduledMaintenance: [],
    });
  });

  test("the overall status is the page's banner: the worst status a resource is in", () => {
    expect(summarize(departmentPage()).overallStatus).toEqual({
      name: "Offline",
      color: "#ef4444",
      isOperational: false,
    });
  });
});

describe("StatusPageSummaryBuilder.fromOverview: scheduled maintenance", () => {
  test("a resource is under maintenance while an event in progress names its monitor", () => {
    const summary: StatusPageSummary = summarize(
      departmentPage({
        maintenance: [
          {
            id: id("e01"),
            title: "API deploy",
            state: "ongoing",
            startsAt: new Date(NOW.getTime() - HOUR),
            endsAt: new Date(NOW.getTime() + HOUR),
            monitorIds: [M_API],
          },
        ],
      }),
    );

    expect(resource(summary, R_API).isUnderMaintenance).toBe(true);
    expect(resource(summary, R_WEB).isUnderMaintenance).toBe(false);
    expect(resource(summary, R_DATABASES).isUnderMaintenance).toBe(false);
    expect(summary.ongoingScheduledMaintenance).toEqual([
      {
        id: id("e01"),
        title: "API deploy",
        startsAt: new Date(NOW.getTime() - HOUR).toISOString(),
        endsAt: new Date(NOW.getTime() + HOUR).toISOString(),
        state: "Ongoing",
        affectedResourceIds: [R_API],
      },
    ]);
  });

  test("a monitor group is under maintenance while an event names any of its monitors", () => {
    const summary: StatusPageSummary = summarize(
      departmentPage({
        maintenance: [
          {
            id: id("e02"),
            title: "Replica resync",
            state: "ongoing",
            startsAt: new Date(NOW.getTime() - HOUR),
            monitorIds: [M_DB_REPLICA],
          },
        ],
      }),
    );

    expect(resource(summary, R_DATABASES).isUnderMaintenance).toBe(true);
    expect(resource(summary, R_API).isUnderMaintenance).toBe(false);
    expect(summary.ongoingScheduledMaintenance[0]!.affectedResourceIds).toEqual(
      [R_DATABASES],
    );
  });

  test("under maintenance whatever status the event left its monitors in", () => {
    // The event changed nothing: the group still reads Offline from before.
    const summary: StatusPageSummary = summarize(
      departmentPage({
        maintenance: [
          {
            id: id("e03"),
            title: "Database upgrade",
            state: "ongoing",
            startsAt: new Date(NOW.getTime() - HOUR),
            monitorIds: [M_DB_PRIMARY, M_DB_REPLICA],
          },
        ],
      }),
    );

    expect(resource(summary, R_DATABASES)).toEqual({
      id: R_DATABASES,
      name: "Databases",
      groupName: "Core / Data",
      currentStatus: {
        name: "Offline",
        color: "#ef4444",
        isOperational: false,
      },
      isUnderMaintenance: true,
    });
  });

  test("an event in a state of the project's own between Ongoing and Ended is still in progress", () => {
    const summary: StatusPageSummary = summarize(
      departmentPage({
        maintenance: [
          {
            id: id("e04"),
            title: "Verifying the upgrade",
            state: "verifying",
            startsAt: new Date(NOW.getTime() - 2 * HOUR),
            monitorIds: [M_QUEUE],
          },
        ],
      }),
    );

    expect(resource(summary, R_QUEUE).isUnderMaintenance).toBe(true);
    expect(summary.ongoingScheduledMaintenance[0]!.state).toBe("Verifying");
  });

  test.each(["scheduled", "confirmed"] as const)(
    "an event still to come (%s) is listed as upcoming and puts nothing under maintenance",
    (state: "scheduled" | "confirmed") => {
      const summary: StatusPageSummary = summarize(
        departmentPage({
          maintenance: [
            {
              id: id("e05"),
              title: "Network work",
              state: state,
              startsAt: new Date(NOW.getTime() + 24 * HOUR),
              endsAt: new Date(NOW.getTime() + 26 * HOUR),
              monitorIds: [M_API, M_DB_PRIMARY],
            },
          ],
        }),
      );

      expect(
        summary.resources.some((item: StatusPageSummaryResource) => {
          return item.isUnderMaintenance;
        }),
      ).toBe(false);
      expect(summary.ongoingScheduledMaintenance).toEqual([]);
      expect(summary.upcomingScheduledMaintenance).toEqual([
        {
          id: id("e05"),
          title: "Network work",
          startsAt: new Date(NOW.getTime() + 24 * HOUR).toISOString(),
          endsAt: new Date(NOW.getTime() + 26 * HOUR).toISOString(),
          state: state === "scheduled" ? "Scheduled" : "Confirmed",
          affectedResourceIds: [R_API, R_DATABASES],
        },
      ]);
    },
  );

  test.each(["ended", "reviewing", "completed", "archived"] as const)(
    "an event that is over (%s) is not on the page, and puts nothing under maintenance",
    (state: "ended" | "reviewing" | "completed" | "archived") => {
      const summary: StatusPageSummary = summarize(
        departmentPage({
          maintenance: [
            {
              id: id("e06"),
              title: "Last week's work",
              state: state,
              startsAt: new Date(NOW.getTime() - 7 * 24 * HOUR),
              monitorIds: [M_API],
            },
          ],
        }),
      );

      expect(resource(summary, R_API).isUnderMaintenance).toBe(false);
      expect(summary.ongoingScheduledMaintenance).toEqual([]);
      expect(summary.upcomingScheduledMaintenance).toEqual([]);
    },
  );

  test("an event that is over and still in the overview's list is not counted either", () => {
    const overview: JSONObject = buildFakeOverview(
      departmentPage({
        maintenance: [
          {
            id: id("e07"),
            title: "Ongoing work",
            state: "ongoing",
            startsAt: new Date(NOW.getTime() - HOUR),
            monitorIds: [M_WEB],
          },
        ],
      }),
    );

    // A list the server did not filter: the event moved on to Ended.
    const events: Array<JSONObject> = JSON.parse(
      JSON.stringify(overview["scheduledMaintenanceEvents"]),
    ) as Array<JSONObject>;
    const ended: JSONObject = (
      overview["scheduledMaintenanceStates"] as Array<JSONObject>
    ).find((state: JSONObject): boolean => {
      return state["name"] === "Ended";
    })!;
    events[0]!["currentScheduledMaintenanceState"] = ended;

    const summary: StatusPageSummary = StatusPageSummaryBuilder.fromOverview({
      ...overview,
      scheduledMaintenanceEvents: events,
    });

    expect(resource(summary, R_WEB).isUnderMaintenance).toBe(false);
    expect(summary.ongoingScheduledMaintenance).toEqual([]);
  });

  test("an event that names no monitor on the page puts nothing under maintenance, and is listed", () => {
    const summary: StatusPageSummary = summarize(
      departmentPage({
        maintenance: [
          {
            id: id("e08"),
            title: "Page-wide notice",
            state: "ongoing",
            startsAt: new Date(NOW.getTime() - HOUR),
            monitorIds: [],
          },
          {
            id: id("e09"),
            title: "Another team's monitor",
            state: "ongoing",
            startsAt: new Date(NOW.getTime() - HOUR),
            monitorIds: [M_OFF_PAGE],
          },
        ],
      }),
    );

    expect(
      summary.resources.some((item: StatusPageSummaryResource) => {
        return item.isUnderMaintenance;
      }),
    ).toBe(false);
    expect(
      summary.ongoingScheduledMaintenance.map(
        (event: { title: string; affectedResourceIds: Array<string> }) => {
          return [event.title, event.affectedResourceIds];
        },
      ),
    ).toEqual([
      ["Page-wide notice", []],
      ["Another team's monitor", []],
    ]);
  });

  test("a page that does not show scheduled maintenance puts nothing under maintenance", () => {
    const summary: StatusPageSummary = summarize(
      departmentPage({
        showsMaintenance: false,
        maintenance: [
          {
            id: id("e10"),
            title: "Hidden from this page",
            state: "ongoing",
            startsAt: new Date(NOW.getTime() - HOUR),
            monitorIds: [M_API],
          },
        ],
      }),
    );

    expect(resource(summary, R_API).isUnderMaintenance).toBe(false);
    expect(summary.ongoingScheduledMaintenance).toEqual([]);
    expect(JSON.stringify(summary)).not.toContain("Hidden from this page");
  });

  test("a resource two events affect is under maintenance once, and both events name it", () => {
    const summary: StatusPageSummary = summarize(
      departmentPage({
        maintenance: [
          {
            id: id("e11"),
            title: "First",
            state: "ongoing",
            startsAt: new Date(NOW.getTime() - HOUR),
            monitorIds: [M_API],
          },
          {
            id: id("e12"),
            title: "Second",
            state: "verifying",
            startsAt: new Date(NOW.getTime() - HOUR),
            monitorIds: [M_API, M_API],
          },
        ],
      }),
    );

    expect(resource(summary, R_API).isUnderMaintenance).toBe(true);
    expect(
      summary.ongoingScheduledMaintenance.map(
        (event: { affectedResourceIds: Array<string> }) => {
          return event.affectedResourceIds;
        },
      ),
    ).toEqual([[R_API], [R_API]]);
  });
});

describe("StatusPageSummaryBuilder.fromOverview: incidents", () => {
  test("lists the active incidents with what they affect, as the page names it", () => {
    const declaredAt: Date = new Date(NOW.getTime() - 30 * 60 * 1000);
    const summary: StatusPageSummary = summarize(
      departmentPage({
        incidents: [
          {
            id: id("f01"),
            title: "Slow checkouts",
            declaredAt: declaredAt,
            state: "Investigating",
            severity: "SEV-2",
            monitorIds: [M_API, M_DB_PRIMARY, M_OFF_PAGE],
          },
        ],
      }),
    );

    expect(summary.activeIncidents).toEqual([
      {
        id: id("f01"),
        title: "Slow checkouts",
        declaredAt: declaredAt.toISOString(),
        state: "Investigating",
        severity: "SEV-2",
        // The monitor itself, then the monitor group that holds the other.
        affectedResourceIds: [R_API, R_DATABASES],
      },
    ]);
  });

  test("a page that does not show incidents lists none", () => {
    const summary: StatusPageSummary = summarize(
      departmentPage({
        showsIncidents: false,
        incidents: [
          {
            id: id("f02"),
            title: "Not on this page",
            declaredAt: NOW,
            state: "Investigating",
            severity: "SEV-1",
            monitorIds: [M_API],
          },
        ],
      }),
    );

    expect(summary.activeIncidents).toEqual([]);
  });
});

describe("StatusPageSummaryBuilder.fromOverview: what never reaches the summary", () => {
  test("no monitor or monitor group id, and no monitor's own name", () => {
    const summary: StatusPageSummary = summarize(
      departmentPage({
        maintenance: [
          {
            id: id("e13"),
            title: "Upgrade",
            state: "ongoing",
            startsAt: new Date(NOW.getTime() - HOUR),
            monitorIds: [M_API, M_DB_PRIMARY],
          },
        ],
        incidents: [
          {
            id: id("f03"),
            title: "Down",
            declaredAt: NOW,
            state: "Identified",
            severity: "SEV-1",
            monitorIds: [M_WEB],
          },
        ],
      }),
    );

    const wire: string = JSON.stringify(summary);

    for (const internalId of [
      M_API,
      M_WEB,
      M_DB_PRIMARY,
      M_DB_REPLICA,
      M_QUEUE,
      G_DATABASES,
      PG_CORE,
      PG_DATA,
    ]) {
      expect({ internalId, leaked: wire.includes(internalId) }).toEqual({
        internalId,
        leaked: false,
      });
    }
  });

  test("getGroupPaths stops at a group that names itself or loops", () => {
    const paths: Map<string, string> = StatusPageSummaryBuilder.getGroupPaths(
      [
        { _id: PG_CORE, name: "Core", parentStatusPageGroupId: PG_DATA },
        { _id: PG_DATA, name: "Data", parentStatusPageGroupId: PG_CORE },
      ].map(
        (spec: {
          _id: string;
          name: string;
          parentStatusPageGroupId: string;
        }) => {
          return {
            ...spec,
            parentStatusPageGroupId: {
              toString: (): string => {
                return spec.parentStatusPageGroupId;
              },
            },
          } as never;
        },
      ),
    );

    expect(paths.get(PG_CORE)).toBe("Data / Core");
    expect(paths.get(PG_DATA)).toBe("Core / Data");
  });
});
