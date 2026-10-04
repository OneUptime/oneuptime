import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "../../../../Models/DatabaseModels/StatusPageSubscriber";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import StatusPageResourceService from "../../../../Server/Services/StatusPageResourceService";
import StatusPageSubscriberService from "../../../../Server/Services/StatusPageSubscriberService";
import AffectedStatusPageResources from "../../../../Server/Utils/StatusPage/AffectedStatusPageResources";
import Dictionary from "../../../../Types/Dictionary";
import ObjectID from "../../../../Types/ObjectID";
import StatusPageEventType from "../../../../Types/StatusPage/StatusPageEventType";
import {
  AskedQueries,
  MonitorGroupMembershipRow,
  StatusPageResourceRow,
  useMonitorGroupStatusPageRows,
} from "../../../Helpers/MonitorGroupStatusPageRows";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * Which of a status page's resources an event on some monitors affects, and
 * so which of the page's subscribers hear about it.
 *
 * A subscriber on a page that lets subscribers choose resources picks some
 * of its resources, and a resource is one monitor or one monitor group. The
 * status page shows an event on a monitor under the group it is in, so a
 * subscriber who picked the group must hear about it - for an announcement,
 * a scheduled maintenance event and an incident alike. The announcement and
 * the scheduled maintenance note jobs used to look resources up by monitorId
 * alone, and missed the groups.
 *
 * These run the real lookup (StatusPageResourceService.findByMonitors)
 * against fake rows that answer the queries it builds, and the real
 * decision (StatusPageSubscriberService.shouldSendNotification).
 */

// Status pages.
const PUBLIC_PAGE: string = "b0000000-0000-4000-8000-000000000001";
const EU_PAGE: string = "b0000000-0000-4000-8000-000000000002";
const INTERNAL_PAGE: string = "b0000000-0000-4000-8000-000000000003";

// Monitors.
const API_MONITOR: string = "c0000000-0000-4000-8000-000000000001";
const DB_MONITOR: string = "c0000000-0000-4000-8000-000000000002";
const CACHE_MONITOR: string = "c0000000-0000-4000-8000-000000000003";
const CDN_MONITOR: string = "c0000000-0000-4000-8000-000000000004";
const INVOICES_MONITOR: string = "c0000000-0000-4000-8000-000000000005";
// On no status page, directly or through a group.
const UNLISTED_MONITOR: string = "c0000000-0000-4000-8000-000000000006";

// Monitor groups. The cache is in both the backend and the edge group.
const BACKEND_GROUP: string = "90000000-0000-4000-8000-000000000001";
const EDGE_GROUP: string = "90000000-0000-4000-8000-000000000002";
const BILLING_GROUP: string = "90000000-0000-4000-8000-000000000003";

// The status page group (a heading on the page) the public page lists under.
const CORE_HEADING: string = "a0000000-0000-4000-8000-0000000000c0";

const MEMBERSHIPS: Array<MonitorGroupMembershipRow> = [
  {
    _id: "f0000000-0000-4000-8000-000000000001",
    monitorGroupId: BACKEND_GROUP,
    monitorId: DB_MONITOR,
  },
  {
    _id: "f0000000-0000-4000-8000-000000000002",
    monitorGroupId: BACKEND_GROUP,
    monitorId: CACHE_MONITOR,
  },
  {
    _id: "f0000000-0000-4000-8000-000000000003",
    monitorGroupId: EDGE_GROUP,
    monitorId: CACHE_MONITOR,
  },
  {
    _id: "f0000000-0000-4000-8000-000000000004",
    monitorGroupId: EDGE_GROUP,
    monitorId: CDN_MONITOR,
  },
  {
    _id: "f0000000-0000-4000-8000-000000000005",
    monitorGroupId: BILLING_GROUP,
    monitorId: INVOICES_MONITOR,
  },
];

// The public page: the API directly, and three monitor groups.
const PUBLIC_API: StatusPageResourceRow = {
  _id: "e0000000-0000-4000-8000-000000000001",
  statusPageId: PUBLIC_PAGE,
  displayName: "API",
  monitorId: API_MONITOR,
  statusPageGroupId: CORE_HEADING,
  statusPageGroupName: "Core",
};
const PUBLIC_BACKEND: StatusPageResourceRow = {
  _id: "e0000000-0000-4000-8000-000000000002",
  statusPageId: PUBLIC_PAGE,
  displayName: "Backend",
  monitorGroupId: BACKEND_GROUP,
  statusPageGroupId: CORE_HEADING,
  statusPageGroupName: "Core",
};
const PUBLIC_EDGE: StatusPageResourceRow = {
  _id: "e0000000-0000-4000-8000-000000000003",
  statusPageId: PUBLIC_PAGE,
  displayName: "Edge network",
  monitorGroupId: EDGE_GROUP,
};
const PUBLIC_BILLING: StatusPageResourceRow = {
  _id: "e0000000-0000-4000-8000-000000000004",
  statusPageId: PUBLIC_PAGE,
  displayName: "Billing",
  monitorGroupId: BILLING_GROUP,
};
// The EU page lists the database directly and through the backend group.
const EU_DB: StatusPageResourceRow = {
  _id: "e0000000-0000-4000-8000-000000000005",
  statusPageId: EU_PAGE,
  displayName: "Database",
  monitorId: DB_MONITOR,
};
const EU_BACKEND: StatusPageResourceRow = {
  _id: "e0000000-0000-4000-8000-000000000006",
  statusPageId: EU_PAGE,
  displayName: "Backend",
  monitorGroupId: BACKEND_GROUP,
};
// The internal page lists only the invoices monitor.
const INTERNAL_INVOICES: StatusPageResourceRow = {
  _id: "e0000000-0000-4000-8000-000000000007",
  statusPageId: INTERNAL_PAGE,
  displayName: "Invoices",
  monitorId: INVOICES_MONITOR,
};

const RESOURCES: Array<StatusPageResourceRow> = [
  PUBLIC_API,
  PUBLIC_BACKEND,
  PUBLIC_EDGE,
  PUBLIC_BILLING,
  EU_DB,
  EU_BACKEND,
  INTERNAL_INVOICES,
];

const SELECT: {
  _id: true;
  displayName: true;
  statusPageId: true;
  statusPageGroupId: true;
  statusPageGroup: { name: true };
} = {
  _id: true,
  displayName: true,
  statusPageId: true,
  statusPageGroupId: true,
  statusPageGroup: {
    name: true,
  },
};

function useScenarioRows(): AskedQueries {
  return useMonitorGroupStatusPageRows({
    resources: RESOURCES,
    memberships: MEMBERSHIPS,
  });
}

const ALL_PAGES: Array<string> = [PUBLIC_PAGE, EU_PAGE, INTERNAL_PAGE];

// The status pages an event is on, as the senders read them.
function pages(ids: Array<string>): Array<StatusPage> {
  return ids.map((id: string): StatusPage => {
    const statusPage: StatusPage = new StatusPage();
    statusPage._id = id;
    return statusPage;
  });
}

async function affectedBy(
  monitorIds: Array<string>,
  statusPageIds: Array<string> = ALL_PAGES,
): Promise<Dictionary<Array<StatusPageResource>>> {
  return await AffectedStatusPageResources.findForMonitors({
    monitorIds: monitorIds.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    statusPages: pages(statusPageIds),
    select: SELECT,
  });
}

// Each page's affected resources, by display name, in the order given.
function namesByPage(
  affected: Dictionary<Array<StatusPageResource>>,
): Dictionary<Array<string>> {
  const names: Dictionary<Array<string>> = {};

  for (const [statusPageId, resources] of Object.entries(affected)) {
    names[statusPageId] = resources.map(
      (resource: StatusPageResource): string => {
        return resource.displayName || "";
      },
    );
  }

  return names;
}

// The ids a Raw IN condition lists.
function inListIds(condition: unknown): Array<string> {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  return Object.values(operator.objectLiteralParameters || {})
    .flat()
    .map((id: unknown): string => {
      return String(id);
    });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AffectedStatusPageResources.findForMonitors, through the real monitor lookup", () => {
  test("a page that lists the monitor only through a monitor group gets the group's resource", async () => {
    useScenarioRows();

    const affected: Dictionary<Array<StatusPageResource>> = await affectedBy([
      DB_MONITOR,
    ]);

    expect(namesByPage(affected)[PUBLIC_PAGE]).toEqual(["Backend"]);
  });

  test("a page that lists the monitor directly and through a group gets both resources, once each", async () => {
    useScenarioRows();

    const affected: Dictionary<Array<StatusPageResource>> = await affectedBy([
      DB_MONITOR,
    ]);

    expect(namesByPage(affected)[EU_PAGE]).toEqual(["Database", "Backend"]);
  });

  test("a monitor in two groups on one page affects both groups", async () => {
    useScenarioRows();

    const affected: Dictionary<Array<StatusPageResource>> = await affectedBy([
      CACHE_MONITOR,
    ]);

    expect(namesByPage(affected)).toEqual({
      [PUBLIC_PAGE]: ["Backend", "Edge network"],
      [EU_PAGE]: ["Backend"],
    });
  });

  test("two monitors of one group affect the group once", async () => {
    useScenarioRows();

    const affected: Dictionary<Array<StatusPageResource>> = await affectedBy([
      DB_MONITOR,
      CACHE_MONITOR,
    ]);

    expect(namesByPage(affected)).toEqual({
      [PUBLIC_PAGE]: ["Backend", "Edge network"],
      [EU_PAGE]: ["Database", "Backend"],
    });
  });

  test("a group that does not hold any of the monitors is not affected", async () => {
    useScenarioRows();

    const affected: Dictionary<Array<StatusPageResource>> = await affectedBy([
      API_MONITOR,
    ]);

    expect(namesByPage(affected)).toEqual({ [PUBLIC_PAGE]: ["API"] });
  });

  test("a page that lists none of the monitors has no entry", async () => {
    useScenarioRows();

    expect(await affectedBy([UNLISTED_MONITOR])).toEqual({});
    expect(Object.keys(await affectedBy([API_MONITOR]))).toEqual([PUBLIC_PAGE]);
  });

  test("keys each page by its id, as the senders look a page up (statusPage._id)", async () => {
    useScenarioRows();

    const affected: Dictionary<Array<StatusPageResource>> = await affectedBy([
      INVOICES_MONITOR,
    ]);

    const page: StatusPage = new StatusPage();
    page._id = INTERNAL_PAGE;

    expect(namesByPage(affected)[page._id!]).toEqual(["Invoices"]);
    expect(namesByPage(affected)[PUBLIC_PAGE]).toEqual(["Billing"]);
  });

  test("keeps each resource's status page group for {{resourcesAffected}}", async () => {
    useScenarioRows();

    const affected: Dictionary<Array<StatusPageResource>> = await affectedBy([
      DB_MONITOR,
    ]);

    const backend: StatusPageResource = affected[PUBLIC_PAGE]![0]!;
    expect(backend.statusPageGroup?.name).toBe("Core");
    expect(backend.statusPageGroupId?.toString()).toBe(CORE_HEADING);
  });

  test("an event that names no monitor affects nothing, and nothing is looked up", async () => {
    const asked: AskedQueries = useScenarioRows();
    const findByMonitors: ReturnType<typeof jest.spyOn> = jest.spyOn(
      StatusPageResourceService,
      "findByMonitors",
    );

    expect(
      await AffectedStatusPageResources.findForMonitors({
        monitors: [],
        statusPages: pages(ALL_PAGES),
        select: SELECT,
      }),
    ).toEqual({});

    // A monitor that was never saved has no id to look up.
    expect(
      await AffectedStatusPageResources.findForMonitors({
        monitors: [new Monitor()],
        statusPages: pages(ALL_PAGES),
        select: SELECT,
      }),
    ).toEqual({});

    expect(
      await AffectedStatusPageResources.findForMonitors({
        statusPages: pages(ALL_PAGES),
        select: SELECT,
      }),
    ).toEqual({});

    expect(findByMonitors).not.toHaveBeenCalled();
    expect(asked.statusPageResources).toEqual([]);
    expect(asked.monitorGroupMemberships).toEqual([]);
  });

  test("takes the monitors as models or ids, and asks for each once", async () => {
    const asked: AskedQueries = useScenarioRows();

    const db: Monitor = new Monitor();
    db._id = DB_MONITOR;
    const dbAgain: Monitor = new Monitor();
    dbAgain._id = DB_MONITOR.toUpperCase();

    const affected: Dictionary<Array<StatusPageResource>> =
      await AffectedStatusPageResources.findForMonitors({
        monitors: [db, dbAgain, new Monitor()],
        monitorIds: [new ObjectID(DB_MONITOR)],
        statusPages: pages(ALL_PAGES),
        select: SELECT,
      });

    expect(namesByPage(affected)[PUBLIC_PAGE]).toEqual(["Backend"]);

    // The monitors' own resources, then their groups' memberships.
    expect(inListIds(asked.statusPageResources[0]!["monitorId"])).toEqual([
      DB_MONITOR,
    ]);
    expect(inListIds(asked.monitorGroupMemberships[0]!["monitorId"])).toEqual([
      DB_MONITOR,
    ]);
  });

  test("looks the groups' resources up by the groups that hold the monitors, each group once", async () => {
    const asked: AskedQueries = useScenarioRows();

    await affectedBy([DB_MONITOR, CACHE_MONITOR]);

    expect(asked.statusPageResources).toHaveLength(2);
    expect(Object.keys(asked.statusPageResources[1]!)).toEqual([
      "monitorGroupId",
      "statusPageId",
    ]);
    expect(inListIds(asked.statusPageResources[1]!["monitorGroupId"])).toEqual([
      BACKEND_GROUP,
      EDGE_GROUP,
    ]);
  });

  test("reads only the resources of the status pages the event is on", async () => {
    const asked: AskedQueries = useScenarioRows();

    const affected: Dictionary<Array<StatusPageResource>> = await affectedBy(
      [DB_MONITOR],
      [EU_PAGE],
    );

    /*
     * The public page shows the database through its backend group, but the
     * event is not on it.
     */
    expect(namesByPage(affected)).toEqual({
      [EU_PAGE]: ["Database", "Backend"],
    });

    // Both resource reads - the monitors' own, and their groups' - ask for it.
    expect(asked.statusPageResources).toHaveLength(2);

    for (const query of asked.statusPageResources) {
      expect(inListIds(query["statusPageId"])).toEqual([EU_PAGE]);
    }
  });

  test("an event that is on no status page affects nothing, and nothing is looked up", async () => {
    const asked: AskedQueries = useScenarioRows();

    expect(await affectedBy([DB_MONITOR], [])).toEqual({});
    // A page that was never saved has no id to look on.
    expect(
      await AffectedStatusPageResources.findForMonitors({
        monitorIds: [new ObjectID(DB_MONITOR)],
        statusPages: [new StatusPage()],
        select: SELECT,
      }),
    ).toEqual({});

    expect(asked.statusPageResources).toEqual([]);
    expect(asked.monitorGroupMemberships).toEqual([]);
  });

  test("reads the caller's columns, plus the id and the page every resource is grouped by", async () => {
    useScenarioRows();
    const findByMonitors: ReturnType<typeof jest.spyOn> = jest.spyOn(
      StatusPageResourceService,
      "findByMonitors",
    );

    await AffectedStatusPageResources.findForMonitors({
      monitorIds: [new ObjectID(DB_MONITOR)],
      statusPages: pages([PUBLIC_PAGE, PUBLIC_PAGE, EU_PAGE]),
      select: { displayName: true },
    });

    expect(findByMonitors).toHaveBeenCalledTimes(1);

    const lookup: { select: unknown; statusPageIds: Array<ObjectID> } =
      findByMonitors.mock.calls[0]![0] as {
        select: unknown;
        statusPageIds: Array<ObjectID>;
      };

    expect(lookup.select).toEqual({
      displayName: true,
      _id: true,
      statusPageId: true,
    });
    // Each page once.
    expect(
      lookup.statusPageIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([PUBLIC_PAGE, EU_PAGE]);
  });

  test("reads every resource, past the 10,000 rows of one query", async () => {
    const PAGE_COUNT: number = 10_001;
    const resources: Array<StatusPageResourceRow> = [];
    const statusPageIds: Array<string> = [];

    for (let index: number = 0; index < PAGE_COUNT; index++) {
      const suffix: string = index.toString(16).padStart(12, "0");
      const statusPageId: string = `b1000000-0000-4000-8000-${suffix}`;

      statusPageIds.push(statusPageId);
      resources.push({
        _id: `d0000000-0000-4000-8000-${suffix}`,
        statusPageId: statusPageId,
        displayName: `API ${index}`,
        monitorId: API_MONITOR,
      });
    }

    const asked: AskedQueries = useMonitorGroupStatusPageRows({
      resources: resources,
      memberships: MEMBERSHIPS,
    });

    const affected: Dictionary<Array<StatusPageResource>> = await affectedBy(
      [API_MONITOR],
      statusPageIds,
    );

    expect(Object.keys(affected)).toHaveLength(PAGE_COUNT);
    // Two reads of the monitor's own resources: 10,000 rows, then the last.
    expect(asked.statusPageResources).toHaveLength(2);
  });
});

describe("AffectedStatusPageResources.groupByStatusPage", () => {
  function resource(data: {
    id?: string;
    statusPageId?: string;
    name: string;
  }): StatusPageResource {
    const row: StatusPageResource = new StatusPageResource();

    if (data.id) {
      row._id = data.id;
    }

    if (data.statusPageId) {
      row.statusPageId = new ObjectID(data.statusPageId);
    }

    row.displayName = data.name;
    return row;
  }

  test("keeps each page's resources in the order given, each once, and leaves out a resource without a page", () => {
    const grouped: Dictionary<Array<StatusPageResource>> =
      AffectedStatusPageResources.groupByStatusPage([
        resource({
          id: PUBLIC_API._id,
          statusPageId: PUBLIC_PAGE,
          name: "API",
        }),
        resource({ id: EU_DB._id, statusPageId: EU_PAGE, name: "Database" }),
        resource({
          id: PUBLIC_BACKEND._id,
          statusPageId: PUBLIC_PAGE,
          name: "Backend",
        }),
        // The same resource read twice.
        resource({
          id: PUBLIC_API._id,
          statusPageId: PUBLIC_PAGE,
          name: "API",
        }),
        resource({ id: INTERNAL_INVOICES._id, name: "Invoices" }),
      ]);

    expect(namesByPage(grouped)).toEqual({
      [PUBLIC_PAGE]: ["API", "Backend"],
      [EU_PAGE]: ["Database"],
    });
  });

  test("nothing in, nothing out", () => {
    expect(AffectedStatusPageResources.groupByStatusPage([])).toEqual({});
  });
});

/*
 * Who hears about it: the affected resources go into the real
 * shouldSendNotification, as every subscriber job passes them, for a page
 * that lets subscribers choose resources.
 */
describe("who hears about an event on a monitor in a monitor group", () => {
  type Fan =
    | "everything"
    | "backend"
    | "edge"
    | "api"
    | "billing"
    | "apiAndBackend"
    | "nothingPicked"
    | "unsubscribedFromBackend";

  const FANS: Array<Fan> = [
    "everything",
    "backend",
    "edge",
    "api",
    "billing",
    "apiAndBackend",
    "nothingPicked",
    "unsubscribedFromBackend",
  ];

  function pageResource(row: StatusPageResourceRow): StatusPageResource {
    const resource: StatusPageResource = new StatusPageResource();
    resource._id = row._id;
    return resource;
  }

  function fan(name: Fan): StatusPageSubscriber {
    const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
    subscriber._id = `5${FANS.indexOf(name)}000000-0000-4000-8000-000000000000`;
    subscriber.isUnsubscribed = name === "unsubscribedFromBackend";
    subscriber.isSubscribedToAllResources = name === "everything";
    subscriber.isSubscribedToAllEventTypes = true;

    const picks: Record<Fan, Array<StatusPageResourceRow>> = {
      everything: [],
      backend: [PUBLIC_BACKEND],
      edge: [PUBLIC_EDGE],
      api: [PUBLIC_API],
      billing: [PUBLIC_BILLING],
      apiAndBackend: [PUBLIC_API, PUBLIC_BACKEND],
      nothingPicked: [],
      unsubscribedFromBackend: [PUBLIC_BACKEND],
    };

    subscriber.statusPageResources = picks[name].map(pageResource);
    return subscriber;
  }

  function publicPage(): StatusPage {
    const page: StatusPage = new StatusPage();
    page._id = PUBLIC_PAGE;
    page.allowSubscribersToChooseResources = true;
    page.allowSubscribersToChooseEventTypes = false;
    return page;
  }

  async function toldAbout(data: {
    monitorIds: Array<string>;
    eventType: StatusPageEventType;
  }): Promise<Array<Fan>> {
    useScenarioRows();

    const affected: Dictionary<Array<StatusPageResource>> = await affectedBy(
      data.monitorIds,
    );

    return FANS.filter((name: Fan): boolean => {
      return StatusPageSubscriberService.shouldSendNotification({
        subscriber: fan(name),
        statusPageResources: affected[PUBLIC_PAGE] || [],
        statusPage: publicPage(),
        eventType: data.eventType,
      });
    });
  }

  const EVENT_TYPES: Array<StatusPageEventType> = [
    StatusPageEventType.Announcement,
    StatusPageEventType.ScheduledEvent,
    StatusPageEventType.Incident,
  ];

  test.each(EVENT_TYPES)(
    "%s on a monitor the page shows only through a group: the group's subscribers, not other resources'",
    async (eventType: StatusPageEventType) => {
      expect(
        await toldAbout({ monitorIds: [DB_MONITOR], eventType: eventType }),
      ).toEqual(["everything", "backend", "apiAndBackend"]);
    },
  );

  test.each(EVENT_TYPES)(
    "%s on a monitor in two groups: the subscribers of either group, each once",
    async (eventType: StatusPageEventType) => {
      expect(
        await toldAbout({ monitorIds: [CACHE_MONITOR], eventType: eventType }),
      ).toEqual(["everything", "backend", "edge", "apiAndBackend"]);
    },
  );

  test.each(EVENT_TYPES)(
    "%s on a monitor listed directly: its subscribers, and no group's",
    async (eventType: StatusPageEventType) => {
      expect(
        await toldAbout({ monitorIds: [API_MONITOR], eventType: eventType }),
      ).toEqual(["everything", "api", "apiAndBackend"]);
    },
  );

  test("an announcement on monitors the page does not show at all is for everyone on that page (unchanged)", async () => {
    expect(
      await toldAbout({
        monitorIds: [UNLISTED_MONITOR],
        eventType: StatusPageEventType.Announcement,
      }),
    ).toEqual([
      "everything",
      "backend",
      "edge",
      "api",
      "billing",
      "apiAndBackend",
      "nothingPicked",
    ]);
  });

  test("a scheduled event on monitors the page does not show reaches only those subscribed to everything (unchanged)", async () => {
    expect(
      await toldAbout({
        monitorIds: [UNLISTED_MONITOR],
        eventType: StatusPageEventType.ScheduledEvent,
      }),
    ).toEqual(["everything"]);
  });
});
