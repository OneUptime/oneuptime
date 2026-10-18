import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPagePrivateUserService from "../../../Server/Services/StatusPagePrivateUserService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import SSRFProtection from "../../../Server/Utils/SSRFProtection";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { SubscriberRestrictionMessages } from "../../../Types/StatusPage/SubscriberRestrictions";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
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
 * A SIGN-UP ON A STATUS PAGE THAT TAKES ONLY ITS PRIVATE USERS IS THE
 * SIGNED-IN READER'S OWN EMAIL ADDRESS (Types/StatusPage/
 * SubscriberRestrictions).
 *
 * The status page's subscribe route asks who is signed in to the page -
 * from their session and their private user's own row
 * (StatusPageService.getSignedInPrivateUserEmail), never from anything the
 * request says - and takes a sign-up only by email, with that address.
 * Then the subscriber service holds the sign-up to the page's rules as it
 * holds every new subscriber (StatusPageSubscriberRestrictions.test.ts):
 * here its create hook runs for real, and only the database is stood in
 * for.
 */

const SUBSCRIBE_ROUTE: string = "/status-page/subscribe/:statusPageId";
const UPDATE_SUBSCRIPTION_ROUTE: string =
  "/status-page/update-subscription/:statusPageId/:subscriberId/:token";

const PROJECT_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000001",
);
const PAGE_ID: ObjectID = new ObjectID("6a000000-0000-4000-8000-000000000002");
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000003",
);
// The subscription's own token, which its manage link carries.
const TOKEN: string = "6c".repeat(32);

type BeforeCreate = (
  createBy: CreateBy<StatusPageSubscriber>,
) => Promise<OnCreate<StatusPageSubscriber>>;

const hooks: { onBeforeCreate: BeforeCreate } =
  StatusPageSubscriberService as unknown as { onBeforeCreate: BeforeCreate };

// The contacts a visitor can sign up with that are not an email address.
const OTHER_CONTACTS: Array<{ kind: string; contact: JSONObject }> = [
  { kind: "SMS", contact: { subscriberPhone: "+14155550100" } },
  {
    kind: "Slack",
    contact: {
      slackIncomingWebhookUrl: "https://hooks.slack.com/services/T/B/x",
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

describe("StatusPageAPI - who may sign up on a status page that takes only its private users", () => {
  let mockResponse: ExpressResponse;
  let nextFunction: NextFunction;
  let created: Array<StatusPageSubscriber>;
  let signedInEmail: string | null;
  let signedInLookup: jest.SpyInstance;
  let privateUsers: Array<string>;
  let limitSubscribersToPrivateUsers: boolean;
  let allowedSubscriberEmailDomains: string | undefined;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    created = [];
    signedInEmail = null;
    privateUsers = ["reader@acme.com"];
    limitSubscribersToPrivateUsers = true;
    allowedSubscriberEmailDomains = undefined;

    stubProjectDirectory({});

    jest
      .spyOn(StatusPageService, "hasReadAccess")
      .mockResolvedValue({ hasReadAccess: true });

    const statusPage: () => StatusPage = (): StatusPage => {
      const page: StatusPage = new StatusPage();
      page.id = PAGE_ID;
      page.projectId = PROJECT_ID;
      page.showSubscriberPageOnStatusPage = true;
      page.enableEmailSubscribers = true;
      page.enableSmsSubscribers = true;
      page.enableSlackSubscribers = true;
      page.enableMicrosoftTeamsSubscribers = true;
      page.enableWebhookSubscribers = true;
      page.allowSubscribersToChooseResources = true;
      page.allowSubscribersToChooseEventTypes = true;
      page.limitSubscribersToPrivateUsers = limitSubscribersToPrivateUsers;
      if (allowedSubscriberEmailDomains !== undefined) {
        page.allowedSubscriberEmailDomains = allowedSubscriberEmailDomains;
      }
      return page;
    };

    jest
      .spyOn(StatusPageService, "findOneBy")
      .mockImplementation((): Promise<StatusPage | null> => {
        return Promise.resolve(statusPage());
      });

    jest
      .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
      .mockImplementation(async (): Promise<Array<StatusPage>> => {
        return [statusPage()];
      });

    signedInLookup = jest
      .spyOn(StatusPageService, "getSignedInPrivateUserEmail")
      .mockImplementation(async (): Promise<string | null> => {
        return signedInEmail;
      });

    jest
      .spyOn(StatusPagePrivateUserService, "isPrivateUserEmail")
      .mockImplementation(async (data: { email: string }): Promise<boolean> => {
        return privateUsers.includes(data.email.trim().toLowerCase());
      });

    // No earlier subscription of the same contact.
    jest.spyOn(StatusPageSubscriberService, "findBy").mockResolvedValue([]);

    jest
      .spyOn(StatusPageSubscriberService, "findOneBy")
      .mockImplementation((): Promise<any> => {
        const row: StatusPageSubscriber = new StatusPageSubscriber();
        row.id = SUBSCRIBER_ID;
        row.statusPageId = PAGE_ID;
        row.projectId = PROJECT_ID;
        row.unsubscribeToken = TOKEN;
        return Promise.resolve(row);
      });

    jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: null,
      isSubscriptionUnpaid: false,
    } as never);
    jest
      .spyOn(ProjectService, "isSMSNotificationsEnabled")
      .mockResolvedValue(true);
    jest
      .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
      .mockResolvedValue(undefined);
    jest.spyOn(ProjectReferenceCheck, "validateUpdate").mockResolvedValue();

    jest
      .spyOn(StatusPageSubscriberService, "create")
      .mockImplementation(async (createBy: any): Promise<any> => {
        await hooks.onBeforeCreate(createBy);
        created.push(createBy.data);
        return createBy.data;
      });

    jest
      .spyOn(StatusPageSubscriberService, "updateBy")
      .mockResolvedValue(1 as never);

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
    subscriberId?: ObjectID;
    body: JSONObject;
  }) => ExpressRequest = (data: {
    subscriberId?: ObjectID;
    body: JSONObject;
  }): ExpressRequest => {
    return {
      params: {
        statusPageId: PAGE_ID.toString(),
        ...(data.subscriberId
          ? { subscriberId: data.subscriberId.toString(), token: TOKEN }
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

  // What the route answered: null when it went through.
  function refusal(): string | null {
    const calls: Array<Array<unknown>> = (nextFunction as unknown as jest.Mock)
      .mock.calls as Array<Array<unknown>>;

    if (calls.length === 0) {
      return null;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBeInstanceOf(BadDataException);
    return (calls[0]![0] as Error).message;
  }

  it("the signed-in reader subscribes the address they sign in with", async () => {
    signedInEmail = "reader@acme.com";

    await subscribe({ subscriberEmail: "reader@acme.com" });

    expect(refusal()).toBeNull();
    expect(created).toHaveLength(1);
    expect(created[0]!.subscriberEmail?.toString()).toBe("reader@acme.com");
    // As a sign-up: the team did not add it.
    expect(created[0]!.isAddedByTeam).toBe(false);
  });

  it("the address is compared trimmed and lower-cased", async () => {
    signedInEmail = "reader@acme.com";

    await subscribe({ subscriberEmail: "  Reader@ACME.com " });

    expect(refusal()).toBeNull();
    expect(created).toHaveLength(1);
  });

  it("who is signed in is asked of their session, for this page and this request", async () => {
    signedInEmail = "reader@acme.com";

    await subscribe({ subscriberEmail: "reader@acme.com" });

    expect(signedInLookup).toHaveBeenCalledTimes(1);
    const asked: { statusPageId: ObjectID; req: ExpressRequest } =
      signedInLookup.mock.calls[0]![0] as {
        statusPageId: ObjectID;
        req: ExpressRequest;
      };
    expect(asked.statusPageId.toString()).toBe(PAGE_ID.toString());
    expect(asked.req.params["statusPageId"]).toBe(PAGE_ID.toString());
  });

  it("someone signed in may not subscribe another address", async () => {
    signedInEmail = "reader@acme.com";

    await subscribe({ subscriberEmail: "someone-else@acme.com" });

    expect(refusal()).toBe(SubscriberRestrictionMessages.notOwnEmail);
    expect(created).toHaveLength(0);
  });

  it("no one signed in - a public page, a session that ended - is told to sign in", async () => {
    signedInEmail = null;

    await subscribe({ subscriberEmail: "reader@acme.com" });

    expect(refusal()).toBe(SubscriberRestrictionMessages.notSignedIn);
    expect(created).toHaveLength(0);
  });

  it.each(OTHER_CONTACTS)(
    "a $kind sign-up is refused - the page takes only email - before asking who is signed in",
    async (other: { contact: JSONObject }) => {
      signedInEmail = "reader@acme.com";

      await subscribe(other.contact);

      expect(refusal()).toBe(SubscriberRestrictionMessages.emailOnly);
      expect(signedInLookup).not.toHaveBeenCalled();
      expect(created).toHaveLength(0);
    },
  );

  it("an email with a phone number besides is refused too", async () => {
    signedInEmail = "reader@acme.com";

    await subscribe({
      subscriberEmail: "reader@acme.com",
      subscriberPhone: "+14155550100",
    });

    expect(refusal()).toBe(SubscriberRestrictionMessages.emailOnly);
    expect(created).toHaveLength(0);
  });

  it("an address that is not text is no address", async () => {
    signedInEmail = "reader@acme.com";

    await subscribe({ subscriberEmail: 42 as unknown as string });

    expect(refusal()).toBe(SubscriberRestrictionMessages.emailOnly);
    expect(created).toHaveLength(0);
  });

  it("a reader whose private user was removed since they signed in is not one", async () => {
    // Their session names an address the page no longer has.
    signedInEmail = "gone@acme.com";

    await subscribe({ subscriberEmail: "gone@acme.com" });

    expect(refusal()).toBe(SubscriberRestrictionMessages.notPrivateUser);
    expect(created).toHaveLength(0);
  });

  it("the page's Allowed Email Domains still apply to a private user", async () => {
    allowedSubscriberEmailDomains = "acme.de";
    signedInEmail = "reader@acme.com";

    await subscribe({ subscriberEmail: "reader@acme.com" });

    expect(refusal()).toBe(
      "Only email addresses at acme.de can subscribe to this status page.",
    );
    expect(created).toHaveLength(0);
  });

  it("a page that takes anyone asks no one who is signed in", async () => {
    limitSubscribersToPrivateUsers = false;

    await subscribe({ subscriberPhone: "+14155550100" });

    expect(refusal()).toBeNull();
    expect(signedInLookup).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
  });

  it("a page with Allowed Email Domains refuses a sign-up at another domain, without anyone signed in", async () => {
    limitSubscribersToPrivateUsers = false;
    allowedSubscriberEmailDomains = "acme.com";

    await subscribe({ subscriberEmail: "visitor@x.org" });

    expect(refusal()).toBe(
      "Only email addresses at acme.com can subscribe to this status page.",
    );
    expect(signedInLookup).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it("changing a subscription from its manage page is not a sign-up, and asks no one who is signed in", async () => {
    await mockRouter.match("put", UPDATE_SUBSCRIPTION_ROUTE).handlerFunction(
      request({
        subscriberId: SUBSCRIBER_ID,
        body: { isSubscribedToAllResources: true },
      }),
      mockResponse,
      nextFunction,
    );

    expect(refusal()).toBeNull();
    expect(signedInLookup).not.toHaveBeenCalled();
  });
});
