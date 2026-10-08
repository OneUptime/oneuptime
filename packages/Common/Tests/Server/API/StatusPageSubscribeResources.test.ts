import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import DatabaseService from "../../../Server/Services/DatabaseService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import { ProjectScopedReferenceException } from "../../../Server/Utils/Database/ProjectScopedReferenceRefusal";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

jest.mock("../../../Server/Utils/Logger");

/*
 * A VISITOR SUBSCRIBES TO THE RESOURCES THE STATUS PAGE SHOWS THEM - AND TO
 * NO OTHER.
 *
 * The status page's subscribe and manage-subscription routes write a
 * subscription as OneUptime, for whoever is looking at the page. The
 * resources a visitor names must be resources of that page that the page
 * shows them (its resources route): not another page's - of this project or
 * another - and not one whose monitor is archived, which every public read
 * of the page leaves out. Anything else gets the answer an id that matches
 * nothing gets, every kind of subscriber alike, and nothing is written.
 *
 * A change from the manage subscription page asks only about the resources
 * it adds: what the subscription names already is kept, so a subscriber
 * whose resource's monitor was archived since can still save.
 */

const SUBSCRIBE_ROUTE: string = "/status-page/subscribe/:statusPageId";
const UPDATE_SUBSCRIPTION_ROUTE: string =
  "/status-page/update-subscription/:statusPageId/:subscriberId";

const PROJECT_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-000000000001",
);
const PAGE_ID: ObjectID = new ObjectID("7a000000-0000-4000-8000-000000000002");
const OTHER_PAGE_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-000000000003",
);
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "7a000000-0000-4000-8000-000000000004",
);

// The page's resources: a monitor's, a monitor group's, an archived monitor's.
const SHOWN_MONITOR_RESOURCE: string = "7b000000-0000-4000-8000-000000000001";
const SHOWN_GROUP_RESOURCE: string = "7b000000-0000-4000-8000-000000000002";
const ARCHIVED_MONITOR_RESOURCE: string =
  "7b000000-0000-4000-8000-000000000003";
// Another page's resource, and an id that matches nothing.
const OTHER_PAGE_RESOURCE: string = "7b000000-0000-4000-8000-000000000004";
const MISSING_RESOURCE: string = "7b000000-0000-4000-8000-000000000005";

interface ResourceRow {
  id: string;
  page: ObjectID;
  // null: a monitor group's resource, which has no monitor.
  archived: boolean | null;
}

const RESOURCE_ROWS: Array<ResourceRow> = [
  { id: SHOWN_MONITOR_RESOURCE, page: PAGE_ID, archived: false },
  { id: SHOWN_GROUP_RESOURCE, page: PAGE_ID, archived: null },
  { id: ARCHIVED_MONITOR_RESOURCE, page: PAGE_ID, archived: true },
  { id: OTHER_PAGE_RESOURCE, page: OTHER_PAGE_ID, archived: false },
];

// Every kind of subscriber a visitor can sign up as, as the page sends it.
const KINDS: Array<{ kind: string; contact: JSONObject }> = [
  { kind: "email", contact: { subscriberEmail: "visitor@example.com" } },
  { kind: "SMS", contact: { subscriberPhone: "+15555550100" } },
  {
    kind: "Slack",
    contact: {
      slackIncomingWebhookUrl:
        "https://hooks.slack.com/services/T000/B000/XXXX",
      slackWorkspaceName: "Example",
    },
  },
  {
    kind: "Microsoft Teams",
    contact: {
      microsoftTeamsIncomingWebhookUrl:
        "https://example.webhook.office.com/webhookb2/abc",
      microsoftTeamsWorkspaceName: "Example",
    },
  },
  {
    kind: "webhook",
    contact: { subscriberWebhook: "https://hooks.example.com/in" },
  },
];

function refusalFor(ids: Array<string>): string {
  return ProjectScopedReferenceValidator.getRefusalMessage({
    subject: "status page subscriber",
    described: ids.map((id: string): string => {
      return `Subscribed to Resources "${id}"`;
    }),
  });
}

describe("StatusPageAPI - the resources a visitor subscribes to", () => {
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;
  let resourceLookups: Array<string>;
  // What the subscription names now, for the manage page's changes.
  let heldResourceIds: Array<string>;
  let allowSubscribersToChooseResources: boolean;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    resourceLookups = [];
    heldResourceIds = [];
    allowSubscribersToChooseResources = true;

    jest
      .spyOn(StatusPageService, "hasReadAccess")
      .mockResolvedValue({ hasReadAccess: true });

    jest
      .spyOn(StatusPageService, "findOneBy")
      .mockImplementation((findBy: any): Promise<StatusPage | null> => {
        const statusPage: StatusPage = new StatusPage();
        statusPage.id = new ObjectID(findBy.query["_id"].toString());
        statusPage.projectId = PROJECT_ID;
        statusPage.showSubscriberPageOnStatusPage = true;
        statusPage.enableEmailSubscribers = true;
        statusPage.enableSmsSubscribers = true;
        statusPage.enableSlackSubscribers = true;
        statusPage.enableMicrosoftTeamsSubscribers = true;
        statusPage.enableWebhookSubscribers = true;
        statusPage.allowSubscribersToChooseResources =
          allowSubscribersToChooseResources;
        statusPage.allowSubscribersToChooseEventTypes = true;
        return Promise.resolve(statusPage);
      });

    // The page's resources, as the database has them.
    const resourceLookup: DatabaseService<StatusPageResource> =
      ProjectScopedReferenceValidator.getLookupService(StatusPageResource);

    jest
      .spyOn(resourceLookup, "findBy")
      .mockImplementation(async (findBy: any): Promise<any> => {
        const query: JSONObject = findBy.query as JSONObject;
        const pageId: string = (query["statusPageId"] as ObjectID).toString();
        const asked: Array<string> = Object.values(
          (query["_id"] as unknown as { objectLiteralParameters: JSONObject })
            .objectLiteralParameters,
        ).flat() as Array<string>;

        resourceLookups.push(pageId);

        return RESOURCE_ROWS.filter((row: ResourceRow): boolean => {
          return asked.includes(row.id) && row.page.toString() === pageId;
        }).map((row: ResourceRow): StatusPageResource => {
          const resource: StatusPageResource = new StatusPageResource();
          resource._id = row.id;

          if (row.archived !== null) {
            const monitor: Monitor = new Monitor();
            monitor.isArchived = row.archived;
            resource.monitor = monitor;
          }

          return resource;
        });
      });

    // What the subscription names now, read hook-free.
    const subscriberLookup: DatabaseService<StatusPageSubscriber> =
      ProjectScopedReferenceValidator.getLookupService(StatusPageSubscriber);

    jest
      .spyOn(subscriberLookup, "findOneById")
      .mockImplementation(async (): Promise<StatusPageSubscriber> => {
        const row: StatusPageSubscriber = new StatusPageSubscriber();
        row._id = SUBSCRIBER_ID.toString();
        row.statusPageResources = heldResourceIds.map(
          (id: string): StatusPageResource => {
            const resource: StatusPageResource = new StatusPageResource();
            resource._id = id;
            return resource;
          },
        );
        return row;
      });

    // The subscriber the manage page changes, found on its own page only.
    jest
      .spyOn(StatusPageSubscriberService, "findOneBy")
      .mockImplementation((findBy: any): Promise<any> => {
        if (
          findBy.query["_id"]?.toString() !== SUBSCRIBER_ID.toString() ||
          findBy.query["statusPageId"]?.toString() !== PAGE_ID.toString()
        ) {
          return Promise.resolve(null);
        }

        const row: StatusPageSubscriber = new StatusPageSubscriber();
        row.id = SUBSCRIBER_ID;
        row.statusPageId = PAGE_ID;
        row.projectId = PROJECT_ID;
        return Promise.resolve(row);
      });

    jest
      .spyOn(StatusPageSubscriberService, "updateOneById")
      .mockResolvedValue(1 as never);

    jest
      .spyOn(StatusPageSubscriberService, "createFromStatusPageSignUp")
      .mockImplementation((data: any): Promise<any> => {
        return Promise.resolve(data);
      });

    mockResponse = {
      cookie: jest.fn(),
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;
    nextFunction = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const request: (data: {
    statusPageId?: ObjectID;
    subscriberId?: ObjectID;
    body: JSONObject;
  }) => ExpressRequest = (data: {
    statusPageId?: ObjectID;
    subscriberId?: ObjectID;
    body: JSONObject;
  }): ExpressRequest => {
    return {
      params: {
        statusPageId: (data.statusPageId || PAGE_ID).toString(),
        ...(data.subscriberId
          ? { subscriberId: data.subscriberId.toString() }
          : {}),
      },
      body: { data: data.body },
      query: {},
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;
  };

  async function subscribe(body: JSONObject): Promise<void> {
    await mockRouter
      .match("post", SUBSCRIBE_ROUTE)
      .handlerFunction(request({ body: body }), mockResponse, nextFunction);
  }

  async function changeSubscription(body: JSONObject): Promise<void> {
    await mockRouter
      .match("put", UPDATE_SUBSCRIPTION_ROUTE)
      .handlerFunction(
        request({ subscriberId: SUBSCRIBER_ID, body: body }),
        mockResponse,
        nextFunction,
      );
  }

  function thrown(): unknown {
    const calls: Array<Array<unknown>> = (nextFunction as unknown as jest.Mock)
      .mock.calls as Array<Array<unknown>>;

    expect(calls).toHaveLength(1);
    return calls[0]![0];
  }

  function pickResources(ids: Array<string>): JSONObject {
    return {
      isSubscribedToAllResources: false,
      statusPageResources: ids.map((id: string): JSONObject => {
        return { _id: id };
      }),
    };
  }

  describe("subscribe", () => {
    it.each(KINDS)(
      "a $kind subscription to resources the page shows is created",
      async (kind: { contact: JSONObject }) => {
        await subscribe({
          ...kind.contact,
          ...pickResources([SHOWN_MONITOR_RESOURCE, SHOWN_GROUP_RESOURCE]),
        });

        expect(nextFunction).not.toHaveBeenCalled();
        expect(
          StatusPageSubscriberService.createFromStatusPageSignUp,
        ).toHaveBeenCalledTimes(1);

        const created: StatusPageSubscriber = (
          StatusPageSubscriberService.createFromStatusPageSignUp as unknown as jest.Mock
        ).mock.calls[0]![0] as StatusPageSubscriber;

        expect(
          (created.statusPageResources || []).map(
            (resource: StatusPageResource | JSONObject): string => {
              return String((resource as JSONObject)["_id"]);
            },
          ),
        ).toEqual([SHOWN_MONITOR_RESOURCE, SHOWN_GROUP_RESOURCE]);
        expect(resourceLookups).toEqual([PAGE_ID.toString()]);
      },
    );

    it.each(KINDS)(
      "a $kind subscription naming another page's resource is refused, and nothing is written",
      async (kind: { contact: JSONObject }) => {
        await subscribe({
          ...kind.contact,
          ...pickResources([SHOWN_MONITOR_RESOURCE, OTHER_PAGE_RESOURCE]),
        });

        const error: unknown = thrown();
        expect(error).toBeInstanceOf(ProjectScopedReferenceException);
        expect(error).toBeInstanceOf(BadDataException);
        expect((error as Error).message).toBe(
          refusalFor([OTHER_PAGE_RESOURCE]),
        );
        expect(
          StatusPageSubscriberService.createFromStatusPageSignUp,
        ).not.toHaveBeenCalled();
      },
    );

    it.each(KINDS)(
      "a $kind subscription naming a resource the page hides is refused",
      async (kind: { contact: JSONObject }) => {
        await subscribe({
          ...kind.contact,
          ...pickResources([ARCHIVED_MONITOR_RESOURCE]),
        });

        expect((thrown() as Error).message).toBe(
          refusalFor([ARCHIVED_MONITOR_RESOURCE]),
        );
        expect(
          StatusPageSubscriberService.createFromStatusPageSignUp,
        ).not.toHaveBeenCalled();
      },
    );

    it("answers another page's resource, a hidden one and a missing one alike", async () => {
      const answers: Array<string> = [];

      for (const id of [
        OTHER_PAGE_RESOURCE,
        ARCHIVED_MONITOR_RESOURCE,
        MISSING_RESOURCE,
      ]) {
        nextFunction = jest.fn();

        await subscribe({
          subscriberEmail: "visitor@example.com",
          ...pickResources([id]),
        });

        answers.push((thrown() as Error).message.split(id).join("<id>"));
      }

      expect(new Set<string>(answers).size).toBe(1);
    });

    it("answers a malformed id like a missing one, without reading anything", async () => {
      await subscribe({
        subscriberEmail: "visitor@example.com",
        ...pickResources(["not-a-uuid"]),
      });

      expect((thrown() as Error).message).toBe(refusalFor(["not-a-uuid"]));
      expect(resourceLookups).toEqual([]);
    });

    it("names everything refused in one answer", async () => {
      await subscribe({
        subscriberEmail: "visitor@example.com",
        ...pickResources([
          MISSING_RESOURCE,
          SHOWN_MONITOR_RESOURCE,
          OTHER_PAGE_RESOURCE,
        ]),
      });

      expect((thrown() as Error).message).toBe(
        refusalFor([MISSING_RESOURCE, OTHER_PAGE_RESOURCE]),
      );
    });

    it("reads nothing for a subscription to every resource", async () => {
      await subscribe({
        subscriberEmail: "visitor@example.com",
        isSubscribedToAllResources: true,
      });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(resourceLookups).toEqual([]);
      expect(
        StatusPageSubscriberService.createFromStatusPageSignUp,
      ).toHaveBeenCalledTimes(1);
    });

    it("still says first that the page lets nobody choose resources", async () => {
      allowSubscribersToChooseResources = false;

      await subscribe({
        subscriberEmail: "visitor@example.com",
        ...pickResources([OTHER_PAGE_RESOURCE]),
      });

      expect((thrown() as Error).message).toBe(
        "Subscribers are not allowed to choose resources for this status page.",
      );
      expect(resourceLookups).toEqual([]);
    });
  });

  describe("manage subscription", () => {
    it("adds a resource the page shows", async () => {
      heldResourceIds = [SHOWN_MONITOR_RESOURCE];

      await changeSubscription(
        pickResources([SHOWN_MONITOR_RESOURCE, SHOWN_GROUP_RESOURCE]),
      );

      expect(nextFunction).not.toHaveBeenCalled();
      expect(StatusPageSubscriberService.updateOneById).toHaveBeenCalledTimes(
        1,
      );
    });

    it("refuses to add another page's resource, and writes nothing", async () => {
      heldResourceIds = [SHOWN_MONITOR_RESOURCE];

      await changeSubscription(
        pickResources([SHOWN_MONITOR_RESOURCE, OTHER_PAGE_RESOURCE]),
      );

      expect((thrown() as Error).message).toBe(
        refusalFor([OTHER_PAGE_RESOURCE]),
      );
      expect(StatusPageSubscriberService.updateOneById).not.toHaveBeenCalled();
    });

    it("refuses to add a resource the page hides", async () => {
      await changeSubscription(pickResources([ARCHIVED_MONITOR_RESOURCE]));

      expect((thrown() as Error).message).toBe(
        refusalFor([ARCHIVED_MONITOR_RESOURCE]),
      );
      expect(StatusPageSubscriberService.updateOneById).not.toHaveBeenCalled();
    });

    it("keeps a resource the subscription named before its monitor was archived", async () => {
      heldResourceIds = [ARCHIVED_MONITOR_RESOURCE, SHOWN_MONITOR_RESOURCE];

      await changeSubscription(
        pickResources([ARCHIVED_MONITOR_RESOURCE, SHOWN_MONITOR_RESOURCE]),
      );

      expect(nextFunction).not.toHaveBeenCalled();
      expect(StatusPageSubscriberService.updateOneById).toHaveBeenCalledTimes(
        1,
      );
      // Nothing was added, so nothing was looked up.
      expect(resourceLookups).toEqual([]);
    });

    it("keeps what a subscription saved before this check names, and saves the change", async () => {
      heldResourceIds = [OTHER_PAGE_RESOURCE];

      await changeSubscription({
        ...pickResources([OTHER_PAGE_RESOURCE]),
        isUnsubscribed: false,
      });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(StatusPageSubscriberService.updateOneById).toHaveBeenCalledTimes(
        1,
      );
    });

    it("finds no subscriber of another page before asking about resources", async () => {
      await mockRouter
        .match("put", UPDATE_SUBSCRIPTION_ROUTE)
        .handlerFunction(
          request({
            statusPageId: OTHER_PAGE_ID,
            subscriberId: SUBSCRIBER_ID,
            body: pickResources([OTHER_PAGE_RESOURCE]),
          }),
          mockResponse,
          nextFunction,
        );

      expect((thrown() as Error).message).toBe("Subscriber not found");
      expect(resourceLookups).toEqual([]);
      expect(StatusPageSubscriberService.updateOneById).not.toHaveBeenCalled();
    });

    it("unsubscribing without naming resources reads none", async () => {
      jest
        .spyOn(StatusPageSubscriberService, "unsubscribe")
        .mockResolvedValue(true);

      await changeSubscription({
        isSubscribedToAllResources: true,
        isUnsubscribed: true,
      });

      expect(nextFunction).not.toHaveBeenCalled();
      expect(resourceLookups).toEqual([]);
    });
  });
});
