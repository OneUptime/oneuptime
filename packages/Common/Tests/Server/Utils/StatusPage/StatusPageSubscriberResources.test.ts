import Monitor from "../../../../Models/DatabaseModels/Monitor";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "../../../../Models/DatabaseModels/StatusPageSubscriber";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import { ProjectScopedReferenceException } from "../../../../Server/Utils/Database/ProjectScopedReferenceRefusal";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import StatusPageSubscriberResources from "../../../../Server/Utils/StatusPage/StatusPageSubscriberResources";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * THE RESOURCES A SUBSCRIPTION NAMES ARE ITS OWN STATUS PAGE'S.
 *
 * What the subscriber service asks about every resource a subscription
 * names, on every write of it: is it one of the page's (and, for a visitor
 * on the status page, one the page shows)? Anything else - another page's
 * resource, another project's, an id that matches nothing, a malformed id -
 * gets one answer, the refusal every reference check gives, so nothing tells
 * them apart.
 *
 * The page's resources are answered by a stand-in for the database below:
 * the hook-free lookup the check reads them through.
 */

const PAGE_ID: ObjectID = new ObjectID("5a000000-0000-4000-8000-000000000001");
const OTHER_PAGE_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000002",
);

// Two resources of the page: a monitor's and a monitor group's.
const MONITOR_RESOURCE: string = "5b000000-0000-4000-8000-000000000001";
const GROUP_RESOURCE: string = "5b000000-0000-4000-8000-000000000002";
// A resource of the page whose monitor is archived: hidden from visitors.
const ARCHIVED_MONITOR_RESOURCE: string =
  "5b000000-0000-4000-8000-000000000003";
// A resource of another page.
const OTHER_PAGE_RESOURCE: string = "5b000000-0000-4000-8000-000000000004";
// An id that matches nothing.
const MISSING_RESOURCE: string = "5b000000-0000-4000-8000-000000000005";

interface ResourceRow {
  id: string;
  statusPageId: ObjectID;
  monitorIsArchived: boolean | null;
}

const ROWS: Array<ResourceRow> = [
  { id: MONITOR_RESOURCE, statusPageId: PAGE_ID, monitorIsArchived: false },
  { id: GROUP_RESOURCE, statusPageId: PAGE_ID, monitorIsArchived: null },
  {
    id: ARCHIVED_MONITOR_RESOURCE,
    statusPageId: PAGE_ID,
    monitorIsArchived: true,
  },
  {
    id: OTHER_PAGE_RESOURCE,
    statusPageId: OTHER_PAGE_ID,
    monitorIsArchived: false,
  },
];

// The refusal the project check gives an id of this list that is not there.
function refusalFor(ids: Array<string>): string {
  return ProjectScopedReferenceValidator.getRefusalMessage({
    subject: "status page subscriber",
    described: ids.map((id: string): string => {
      return `Subscribed to Resources "${id}"`;
    }),
  });
}

interface LookupCall {
  query: JSONObject;
  select: JSONObject;
  limit: number;
}

let lookups: Array<LookupCall> = [];

function standInForTheDatabase(): void {
  const service: DatabaseService<StatusPageResource> =
    ProjectScopedReferenceValidator.getLookupService(StatusPageResource);

  jest
    .spyOn(service, "findBy")
    .mockImplementation(async (findBy: any): Promise<any> => {
      const query: JSONObject = findBy.query as JSONObject;
      const select: JSONObject = findBy.select as JSONObject;

      lookups.push({
        query: query,
        select: select,
        limit: findBy.limit as number,
      });

      // QueryHelper.any: a Raw operator carrying the ids as its parameters.
      const asked: Array<string> = (
        Object.values(
          (
            query["_id"] as unknown as {
              objectLiteralParameters: JSONObject;
            }
          ).objectLiteralParameters,
        ).flat() as Array<string>
      ).map((id: string): string => {
        return id.toLowerCase();
      });

      // One page as an ObjectID, several as a QueryHelper.any of their ids.
      const pageCondition: unknown = query["statusPageId"];
      const pagesAsked: Array<string> = (
        pageCondition instanceof ObjectID
          ? [pageCondition.toString()]
          : (Object.values(
              (
                pageCondition as unknown as {
                  objectLiteralParameters: JSONObject;
                }
              ).objectLiteralParameters,
            ).flat() as Array<string>)
      ).map((id: string): string => {
        return id.toLowerCase();
      });

      return ROWS.filter((row: ResourceRow): boolean => {
        return (
          asked.includes(row.id.toLowerCase()) &&
          pagesAsked.includes(row.statusPageId.toString().toLowerCase())
        );
      }).map((row: ResourceRow): StatusPageResource => {
        const resource: StatusPageResource = new StatusPageResource();
        resource._id = row.id;
        resource.statusPageId = row.statusPageId;

        if (select["monitor"] && row.monitorIsArchived !== null) {
          const monitor: Monitor = new Monitor();
          monitor.isArchived = row.monitorIsArchived;
          resource.monitor = monitor;
        }

        return resource;
      });
    });
}

beforeEach(() => {
  lookups = [];
  standInForTheDatabase();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("StatusPageSubscriberResources.getNamedIds", () => {
  it("reads every shape a resources list reaches a hook in, each id once", () => {
    const instance: StatusPageResource = new StatusPageResource();
    instance._id = MONITOR_RESOURCE;

    expect(
      StatusPageSubscriberResources.getNamedIds([
        instance,
        { _id: GROUP_RESOURCE },
        new ObjectID(ARCHIVED_MONITOR_RESOURCE),
        OTHER_PAGE_RESOURCE,
        // The same id again, in another case: named once.
        MONITOR_RESOURCE.toUpperCase(),
      ]),
    ).toEqual([
      MONITOR_RESOURCE,
      GROUP_RESOURCE,
      ARCHIVED_MONITOR_RESOURCE,
      OTHER_PAGE_RESOURCE,
    ]);
  });

  it("names nothing for an empty or missing list, or an entry with no id", () => {
    expect(StatusPageSubscriberResources.getNamedIds(undefined)).toEqual([]);
    expect(StatusPageSubscriberResources.getNamedIds(null)).toEqual([]);
    expect(StatusPageSubscriberResources.getNamedIds([])).toEqual([]);
    expect(StatusPageSubscriberResources.getNamedIds([{}, "", null])).toEqual(
      [],
    );
  });
});

describe("StatusPageSubscriberResources.findIdsOnPage", () => {
  it("finds the page's own resources, and no other page's", async () => {
    const onPage: Set<string> =
      await StatusPageSubscriberResources.findIdsOnPage({
        statusPageId: PAGE_ID,
        ids: [MONITOR_RESOURCE, GROUP_RESOURCE, OTHER_PAGE_RESOURCE],
        shownToVisitorsOnly: false,
      });

    expect([...onPage].sort()).toEqual(
      [GROUP_RESOURCE, MONITOR_RESOURCE].sort(),
    );
    expect(lookups).toHaveLength(1);
    expect((lookups[0]!.query["statusPageId"] as ObjectID).toString()).toBe(
      PAGE_ID.toString(),
    );
  });

  it("lets the team name a resource whose monitor is archived", async () => {
    const onPage: Set<string> =
      await StatusPageSubscriberResources.findIdsOnPage({
        statusPageId: PAGE_ID,
        ids: [ARCHIVED_MONITOR_RESOURCE],
        shownToVisitorsOnly: false,
      });

    expect([...onPage]).toEqual([ARCHIVED_MONITOR_RESOURCE]);
    expect(lookups[0]!.select["monitor"]).toBeUndefined();
  });

  it("finds for a visitor only what the page shows: no archived monitor, groups kept", async () => {
    const onPage: Set<string> =
      await StatusPageSubscriberResources.findIdsOnPage({
        statusPageId: PAGE_ID,
        ids: [MONITOR_RESOURCE, GROUP_RESOURCE, ARCHIVED_MONITOR_RESOURCE],
        shownToVisitorsOnly: true,
      });

    expect([...onPage].sort()).toEqual(
      [GROUP_RESOURCE, MONITOR_RESOURCE].sort(),
    );
    expect(lookups[0]!.select["monitor"]).toEqual({
      _id: true,
      isArchived: true,
    });
  });

  it("reads no more rows than the ids it asks about", async () => {
    await StatusPageSubscriberResources.findIdsOnPage({
      statusPageId: PAGE_ID,
      ids: [MONITOR_RESOURCE, "not-a-uuid", GROUP_RESOURCE],
      shownToVisitorsOnly: false,
    });

    expect(lookups).toHaveLength(1);
    expect(lookups[0]!.limit).toBe(2);
  });

  it("reads a list longer than one read returns in reads of at most LIMIT_MAX ids, and finds every resource in it", async () => {
    // LIMIT_MAX ids that name nothing, then two of the page's resources.
    const nothing: Array<string> = Array.from(
      { length: LIMIT_MAX },
      (_value: unknown, index: number): string => {
        return `5c000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
      },
    );

    const onPage: Set<string> =
      await StatusPageSubscriberResources.findIdsOnPage({
        statusPageId: PAGE_ID,
        ids: [...nothing, MONITOR_RESOURCE, GROUP_RESOURCE],
        shownToVisitorsOnly: false,
      });

    expect([...onPage].sort()).toEqual(
      [GROUP_RESOURCE, MONITOR_RESOURCE].sort(),
    );
    expect(
      lookups.map((lookup: LookupCall): number => {
        return lookup.limit;
      }),
    ).toEqual([LIMIT_MAX, 2]);
  });

  it("answers a malformed id without a query", async () => {
    const onPage: Set<string> =
      await StatusPageSubscriberResources.findIdsOnPage({
        statusPageId: PAGE_ID,
        ids: ["not-a-uuid", "' or 1=1 --"],
        shownToVisitorsOnly: false,
      });

    expect(onPage.size).toBe(0);
    expect(lookups).toHaveLength(0);
  });

  it("finds nothing on no page, without a query that would match every page", async () => {
    const onPage: Set<string> =
      await StatusPageSubscriberResources.findIdsOnPage({
        statusPageId: undefined,
        ids: [MONITOR_RESOURCE, OTHER_PAGE_RESOURCE],
        shownToVisitorsOnly: false,
      });

    expect(onPage.size).toBe(0);
    expect(lookups).toHaveLength(0);
  });
});

describe("StatusPageSubscriberResources.refuse", () => {
  it("refuses with the project check's own words, as a 400", () => {
    let thrown: unknown = null;

    try {
      StatusPageSubscriberResources.refuse([OTHER_PAGE_RESOURCE]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ProjectScopedReferenceException);
    expect(thrown).toBeInstanceOf(BadDataException);
    expect((thrown as Error).message).toBe(refusalFor([OTHER_PAGE_RESOURCE]));
  });

  it("names the list by its own title", () => {
    expect(
      new StatusPageSubscriber().getTableColumnMetadata(
        StatusPageSubscriberResources.RESOURCES_COLUMN,
      )?.title,
    ).toBe("Subscribed to Resources");
  });

  it("refuses nothing when there is nothing to refuse", () => {
    expect(() => {
      StatusPageSubscriberResources.refuse([]);
    }).not.toThrow();
  });
});

describe("StatusPageSubscriberResources.assertOnPage", () => {
  it("lets every resource of the page through", async () => {
    await expect(
      StatusPageSubscriberResources.assertOnPage({
        statusPageId: PAGE_ID,
        ids: [MONITOR_RESOURCE, GROUP_RESOURCE],
        shownToVisitorsOnly: true,
      }),
    ).resolves.toBeUndefined();
  });

  it("answers another page's resource exactly as one that does not exist", async () => {
    const answers: Array<string> = [];

    for (const id of [OTHER_PAGE_RESOURCE, MISSING_RESOURCE]) {
      try {
        await StatusPageSubscriberResources.assertOnPage({
          statusPageId: PAGE_ID,
          ids: [id],
          shownToVisitorsOnly: false,
        });
      } catch (error) {
        // The id itself is the only difference.
        answers.push((error as Error).message.split(id).join("<id>"));
      }
    }

    expect(answers).toHaveLength(2);
    expect(answers[0]).toBe(answers[1]);
  });

  it("answers a hidden resource, for a visitor, as one that does not exist", async () => {
    await expect(
      StatusPageSubscriberResources.assertOnPage({
        statusPageId: PAGE_ID,
        ids: [ARCHIVED_MONITOR_RESOURCE],
        shownToVisitorsOnly: true,
      }),
    ).rejects.toThrow(refusalFor([ARCHIVED_MONITOR_RESOURCE]));
  });

  it("names everything refused in one answer, in the order written", async () => {
    await expect(
      StatusPageSubscriberResources.assertOnPage({
        statusPageId: PAGE_ID,
        ids: [
          MISSING_RESOURCE,
          MONITOR_RESOURCE,
          OTHER_PAGE_RESOURCE,
          "not-a-uuid",
        ],
        shownToVisitorsOnly: false,
      }),
    ).rejects.toThrow(
      refusalFor([MISSING_RESOURCE, OTHER_PAGE_RESOURCE, "not-a-uuid"]),
    );
  });

  it("reads nothing when a write names no resource", async () => {
    await StatusPageSubscriberResources.assertOnPage({
      statusPageId: PAGE_ID,
      ids: [],
      shownToVisitorsOnly: true,
    });

    expect(lookups).toHaveLength(0);
  });
});

describe("StatusPageSubscriberResources.assertUpdateOnPages", () => {
  function subscriberOn(
    statusPageId: ObjectID,
    held: Array<string>,
  ): StatusPageSubscriber {
    const row: StatusPageSubscriber = new StatusPageSubscriber();
    row.statusPageId = statusPageId;
    row.statusPageResources = held.map((id: string): StatusPageResource => {
      const resource: StatusPageResource = new StatusPageResource();
      resource._id = id;
      return resource;
    });
    return row;
  }

  it("keeps what a subscription names already, without asking", async () => {
    await StatusPageSubscriberResources.assertUpdateOnPages({
      subscribers: [subscriberOn(PAGE_ID, [OTHER_PAGE_RESOURCE])],
      named: [OTHER_PAGE_RESOURCE],
      shownToVisitorsOnly: false,
    });

    expect(lookups).toHaveLength(0);
  });

  it("asks only about the resources a change adds", async () => {
    await StatusPageSubscriberResources.assertUpdateOnPages({
      subscribers: [subscriberOn(PAGE_ID, [ARCHIVED_MONITOR_RESOURCE])],
      named: [ARCHIVED_MONITOR_RESOURCE, MONITOR_RESOURCE],
      shownToVisitorsOnly: false,
    });

    expect(lookups).toHaveLength(1);
  });

  it("refuses a change that adds another page's resource", async () => {
    await expect(
      StatusPageSubscriberResources.assertUpdateOnPages({
        subscribers: [subscriberOn(PAGE_ID, [MONITOR_RESOURCE])],
        named: [MONITOR_RESOURCE, OTHER_PAGE_RESOURCE],
        shownToVisitorsOnly: false,
      }),
    ).rejects.toThrow(refusalFor([OTHER_PAGE_RESOURCE]));
  });

  it("holds each subscriber to its own page, reading every page in one lookup", async () => {
    /*
     * One update over subscribers of two pages: the resource is the second
     * page's, so the first page's subscriber may not name it.
     */
    await expect(
      StatusPageSubscriberResources.assertUpdateOnPages({
        subscribers: [
          subscriberOn(OTHER_PAGE_ID, []),
          subscriberOn(OTHER_PAGE_ID, []),
          subscriberOn(PAGE_ID, []),
        ],
        named: [OTHER_PAGE_RESOURCE],
        shownToVisitorsOnly: false,
      }),
    ).rejects.toThrow(refusalFor([OTHER_PAGE_RESOURCE]));

    expect(lookups).toHaveLength(1);

    // Both pages, in the one lookup.
    const pagesAsked: Array<string> = Object.values(
      (
        lookups[0]!.query["statusPageId"] as unknown as {
          objectLiteralParameters: JSONObject;
        }
      ).objectLiteralParameters,
    ).flat() as Array<string>;

    expect(pagesAsked.sort()).toEqual(
      [PAGE_ID.toString(), OTHER_PAGE_ID.toString()].sort(),
    );
  });

  it("asks nothing about a resource the subscriber names already", async () => {
    await expect(
      StatusPageSubscriberResources.assertUpdateOnPages({
        subscribers: [subscriberOn(OTHER_PAGE_ID, [OTHER_PAGE_RESOURCE])],
        named: [OTHER_PAGE_RESOURCE],
        shownToVisitorsOnly: false,
      }),
    ).resolves.toBeUndefined();

    // A resource a subscriber names already is not asked about.
    expect(lookups).toHaveLength(0);
  });

  it("lets a change through when every subscriber's page has what it adds", async () => {
    await expect(
      StatusPageSubscriberResources.assertUpdateOnPages({
        subscribers: [subscriberOn(OTHER_PAGE_ID, [])],
        named: [OTHER_PAGE_RESOURCE],
        shownToVisitorsOnly: false,
      }),
    ).resolves.toBeUndefined();
  });

  it("lets the team add a resource of the page whose monitor is archived", async () => {
    await expect(
      StatusPageSubscriberResources.assertUpdateOnPages({
        subscribers: [subscriberOn(PAGE_ID, [])],
        named: [ARCHIVED_MONITOR_RESOURCE, GROUP_RESOURCE],
        shownToVisitorsOnly: false,
      }),
    ).resolves.toBeUndefined();

    expect(lookups[0]!.select["monitor"]).toBeUndefined();
  });

  it("refuses a visitor's change that adds a resource the page hides, as one that does not exist", async () => {
    await expect(
      StatusPageSubscriberResources.assertUpdateOnPages({
        subscribers: [subscriberOn(PAGE_ID, [])],
        named: [GROUP_RESOURCE, ARCHIVED_MONITOR_RESOURCE],
        shownToVisitorsOnly: true,
      }),
    ).rejects.toThrow(refusalFor([ARCHIVED_MONITOR_RESOURCE]));

    // The page was read with each resource's monitor, to see what it shows.
    expect(lookups).toHaveLength(1);
    expect(lookups[0]!.select["monitor"]).toEqual({
      _id: true,
      isArchived: true,
    });
  });

  it("keeps, for a visitor, a resource the page hides that the subscription names already", async () => {
    await expect(
      StatusPageSubscriberResources.assertUpdateOnPages({
        subscribers: [subscriberOn(PAGE_ID, [ARCHIVED_MONITOR_RESOURCE])],
        named: [ARCHIVED_MONITOR_RESOURCE, MONITOR_RESOURCE],
        shownToVisitorsOnly: true,
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses another page's resource to a visitor in the same words as to the team", async () => {
    const answers: Array<string> = [];

    for (const shownToVisitorsOnly of [true, false]) {
      try {
        await StatusPageSubscriberResources.assertUpdateOnPages({
          subscribers: [subscriberOn(PAGE_ID, [])],
          named: [OTHER_PAGE_RESOURCE],
          shownToVisitorsOnly: shownToVisitorsOnly,
        });
      } catch (error) {
        answers.push((error as Error).message);
      }
    }

    expect(answers).toEqual([
      refusalFor([OTHER_PAGE_RESOURCE]),
      refusalFor([OTHER_PAGE_RESOURCE]),
    ]);
  });

  it("asks each subscriber only about what it does not name already, in a bulk change", async () => {
    // The first subscriber names the resource already; the second does not.
    await expect(
      StatusPageSubscriberResources.assertUpdateOnPages({
        subscribers: [
          subscriberOn(PAGE_ID, [OTHER_PAGE_RESOURCE]),
          subscriberOn(PAGE_ID, []),
        ],
        named: [OTHER_PAGE_RESOURCE],
        shownToVisitorsOnly: false,
      }),
    ).rejects.toThrow(refusalFor([OTHER_PAGE_RESOURCE]));
  });

  it("refuses what a change adds to a subscriber with no page, and keeps what it holds", async () => {
    const noPage: StatusPageSubscriber = subscriberOn(PAGE_ID, [
      OTHER_PAGE_RESOURCE,
    ]);
    delete noPage.statusPageId;

    await expect(
      StatusPageSubscriberResources.assertUpdateOnPages({
        subscribers: [noPage],
        named: [OTHER_PAGE_RESOURCE, MONITOR_RESOURCE],
        shownToVisitorsOnly: false,
      }),
    ).rejects.toThrow(refusalFor([MONITOR_RESOURCE]));

    await StatusPageSubscriberResources.assertUpdateOnPages({
      subscribers: [noPage],
      named: [OTHER_PAGE_RESOURCE],
      shownToVisitorsOnly: false,
    });

    expect(lookups).toHaveLength(0);
  });

  it("says nothing about an update that reaches no subscriber", async () => {
    await StatusPageSubscriberResources.assertUpdateOnPages({
      subscribers: [],
      named: [OTHER_PAGE_RESOURCE],
      shownToVisitorsOnly: false,
    });

    expect(lookups).toHaveLength(0);
  });
});

describe("StatusPageSubscriberResources.isOnPage", () => {
  it("is true for the page's own resource, false for another page's", () => {
    const own: StatusPageResource = new StatusPageResource();
    own.statusPageId = PAGE_ID;

    const other: StatusPageResource = new StatusPageResource();
    other.statusPageId = OTHER_PAGE_ID;

    expect(StatusPageSubscriberResources.isOnPage(own, PAGE_ID)).toBe(true);
    expect(
      StatusPageSubscriberResources.isOnPage(
        own,
        PAGE_ID.toString().toUpperCase(),
      ),
    ).toBe(true);
    expect(StatusPageSubscriberResources.isOnPage(other, PAGE_ID)).toBe(false);
  });

  it("does not count a resource read without its page: it is not known to be on it", () => {
    expect(
      StatusPageSubscriberResources.isOnPage(new StatusPageResource(), PAGE_ID),
    ).toBe(false);
  });

  it("does not count any resource when asked without a page", () => {
    const own: StatusPageResource = new StatusPageResource();
    own.statusPageId = PAGE_ID;

    for (const statusPageId of [undefined, null, ""]) {
      expect(
        StatusPageSubscriberResources.isOnPage(own, statusPageId as never),
      ).toBe(false);
    }
  });
});
