import { mockRouter } from "Common/Tests/Server/API/Helpers";
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
 * WHAT THIS FILE DEFENDS
 *
 * The SMS log keeps the text of every SMS a project sends, and project
 * members who may not touch status page subscribers can read it: a Viewer,
 * or anyone given Read SMS Log. A status page subscriber's texts carry links
 * that change the subscription - its unsubscribe link, and the link to its
 * manage page - so what the log keeps must open neither of them.
 *
 * It did not. The log redacted the unsubscribe link's token, but a public
 * status page's texts carried the manage link instead, keyed by the
 * subscriber id alone, and the manage page's routes took the id alone: a
 * member with Read SMS Log read the id out of the log and read the
 * subscriber's contact and choices, or cancelled the subscription, through
 * the status page.
 *
 * Here the whole way runs as it does in production: real senders build the
 * texts (the "you have subscribed" SMS and the "manage your subscription"
 * SMS), the notification service sends and logs them, a member holding
 * only Read SMS Log reads the log through the API with the server's own
 * permission checks, and then tries everything the log gave them on the
 * status page's routes. Only the tables are held in memory and Twilio is a
 * fake that keeps what it was given - the message the subscriber's phone
 * gets, whose link does work.
 */

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

jest.mock("twilio", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

import SmsService from "../../FeatureSet/Notification/Services/SmsService";
import BaseAPI from "Common/Server/API/BaseAPI";
import CommonAPI from "Common/Server/API/CommonAPI";
import StatusPageAPI from "Common/Server/API/StatusPageAPI";
import DatabaseService from "Common/Server/Services/DatabaseService";
import ProjectService from "Common/Server/Services/ProjectService";
import CommonSmsService from "Common/Server/Services/SmsService";
import SmsLogService from "Common/Server/Services/SmsLogService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import { OnCreate } from "Common/Server/Types/Database/Hooks";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import PublicMessageRateLimit from "Common/Server/Utils/RateLimit/PublicMessageRateLimit";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import Phone from "Common/Types/Phone";
import SMS from "Common/Types/SMS/SMS";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import StatusPageSubscriberUnsubscribe, {
  MANAGE_SUBSCRIPTION_LINK_NOT_VALID_MESSAGE,
  StatusPageSubscriberUnsubscribeCredential,
  StatusPageSubscriberUnsubscribeState,
} from "Common/Types/StatusPage/StatusPageSubscriberUnsubscribe";
import { customDomainCaller } from "Common/Tests/Server/API/CustomDomainCallers";
import {
  InMemoryTable,
  useInMemoryTable,
} from "Common/Tests/Server/TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "Common/Tests/Server/TestingUtils/RequestPlan";
import { stubProjectDirectory } from "Common/Tests/Server/TestingUtils/ProjectDirectory";
import Twilio from "twilio";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "1a000000-0000-4000-8000-000000000001",
);
const STATUS_PAGE_ID: string = "1a000000-0000-4000-8000-000000000002";
const SUBSCRIBER_ID: string = "1a000000-0000-4000-8000-000000000003";
const TOKEN: string = "0123456789abcdef".repeat(4);
const STATUS_PAGE_URL: string = "https://status.acme.com";
const SUBSCRIBER_PHONE: string = "+15555550123";

const TWILIO_CONFIG: TwilioConfig = {
  accountSid: "AC-account",
  authToken: "auth-token",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

/*
 * A link to one of a subscription's pages, anywhere in a text, and what its
 * last segment carries. Linear: literal route segments, then a run that
 * stops at the first whitespace.
 */
const SUBSCRIPTION_LINK: RegExp =
  /\/(unsubscribe|update-subscription)\/([^\s]+)/g;

interface LoggedLink {
  page: string;
  // The last segment as the log shows it.
  segment: string;
}

let props: DatabaseCommonInteractionProps;
let smsLogs: InMemoryTable;
let subscribers: InMemoryTable;
// The bodies Twilio was given: what the subscriber's phone gets.
let delivered: Array<string>;
// The senders hand an SMS over without waiting for it; the tests wait.
let pendingSends: Array<Promise<void>>;

async function callRoute(
  method: string,
  route: string,
  data: {
    body?: JSONObject;
    params?: Record<string, string>;
    query?: Record<string, string>;
  } = {},
): Promise<Error | undefined> {
  const req: ExpressRequest = {
    params: data.params || {},
    query: data.query || {},
    headers: {},
    cookies: {},
    socket: {},
    ips: [],
    body: data.body || {},
  } as unknown as ExpressRequest;
  const next: MockedFn = jest.fn();

  await mockRouter
    .match(method, route)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return next.mock.calls[0]?.[0] as Error | undefined;
}

function publicStatusPage(): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID;
  page.projectId = PROJECT_ID;
  page.name = "Acme Status";
  page.pageTitle = "Acme Status";
  page.isPublicStatusPage = true;
  return page;
}

// The "you have subscribed" SMS a new SMS subscriber of the page is sent.
async function sendYouHaveSubscribedSms(): Promise<void> {
  const created: StatusPageSubscriber = new StatusPageSubscriber();
  created._id = SUBSCRIBER_ID;
  created.projectId = PROJECT_ID;
  created.statusPageId = new ObjectID(STATUS_PAGE_ID);
  created.subscriberPhone = new Phone(SUBSCRIBER_PHONE);
  created.sendYouHaveSubscribedMessage = true;
  created.unsubscribeToken = TOKEN;

  await (
    StatusPageSubscriberService as unknown as {
      onCreateSuccess: (
        onCreate: OnCreate<StatusPageSubscriber>,
        createdItem: StatusPageSubscriber,
      ) => Promise<StatusPageSubscriber>;
    }
  ).onCreateSuccess(
    {
      createBy: { data: created, props: { isRoot: true } },
      carryForward: {
        statusPage: publicStatusPage(),
        replacedSubscriberIds: [],
      },
    },
    created,
  );

  await Promise.all(pendingSends);
}

// "Send Management Link" on the page's Subscribe page, for the phone.
async function sendManageSubscriptionSms(): Promise<void> {
  const error: Error | undefined = await callRoute(
    "POST",
    "/status-page/manage-subscription/:statusPageId",
    {
      params: { statusPageId: STATUS_PAGE_ID },
      body: { data: { subscriberPhone: SUBSCRIBER_PHONE } },
    },
  );

  expect(error).toBeUndefined();

  // The link is sent in the background; wait for it.
  await Promise.all(
    (
      StatusPageAPI.prototype.sendManageSubscriptionLinks as unknown as MockedFn
    ).mock.results.map((result: { value: unknown }): unknown => {
      return result.value;
    }),
  );
  await Promise.all(pendingSends);
}

// The SMS log, as a member holding only Read SMS Log reads it through the API.
async function smsLogAsReader(): Promise<Array<string>> {
  props = {
    ...customDomainCaller({
      permissions: [Permission.ReadSmsLog],
      projectId: PROJECT_ID,
    }),
    ...ON_HIGHEST_PLAN,
  };

  (Response.sendEntityArrayResponse as unknown as MockedFn).mockClear();

  const error: Error | undefined = await callRoute(
    "POST",
    "/sms-log/get-list",
    {
      body: {
        query: {},
        select: { smsText: true, toNumber: true, createdAt: true },
      },
      query: { skip: "0", limit: "10" },
    },
  );

  expect(error).toBeUndefined();

  return (
    (Response.sendEntityArrayResponse as unknown as MockedFn).mock
      .calls[0]![2] as Array<BaseModel>
  ).map((row: BaseModel): string => {
    return (row as SmsLog).smsText || "";
  });
}

function linksIn(texts: Array<string>): Array<LoggedLink> {
  const links: Array<LoggedLink> = [];

  for (const text of texts) {
    for (const match of text.matchAll(SUBSCRIPTION_LINK)) {
      links.push({ page: match[1]!, segment: match[2]! });
    }
  }

  return links;
}

/*
 * What a reader of the log can try with a link it shows: the subscriber id
 * the log keeps, and whatever stands where the token was.
 */
function attemptsFrom(link: LoggedLink): Array<{ id: string; token: string }> {
  const id: string = link.segment.slice(0, 36);
  const rest: string = link.segment.slice(37);

  return [
    { id: id, token: rest },
    { id: id, token: "" },
    { id: id, token: id },
  ];
}

function isCancelled(): boolean {
  return subscribers.get(SUBSCRIBER_ID)!["isUnsubscribed"] === true;
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new BaseAPI<SmsLog, DatabaseService<SmsLog>>(SmsLog, SmsLogService);
  new BaseAPI<StatusPageSubscriber, DatabaseService<StatusPageSubscriber>>(
    StatusPageSubscriber,
    StatusPageSubscriberService,
  );
  new StatusPageAPI();
});

beforeEach(() => {
  jest.clearAllMocks();
  stubProjectDirectory({});

  /*
   * Every request here is within the limits on what a public route may
   * send its contacts (PublicMessageRateLimit), which
   * Common/Tests/Server/API/StatusPageSubscriberMessageLimits.test.ts holds.
   */
  jest
    .spyOn(PublicMessageRateLimit, "assertMaySend")
    .mockResolvedValue({ giveBack: async (): Promise<void> => {} });
  delivered = [];
  pendingSends = [];

  (Twilio as unknown as MockedFn).mockImplementation(() => {
    return {
      messages: {
        create: jest.fn(async (message: { body: string }) => {
          delivered.push(message.body);
          return { status: "queued", sid: `SM-${delivered.length}` };
        }),
      },
    };
  });

  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  project.enableSmsNotifications = true;
  project.smsOrCallCurrentBalanceInUSDCents = 10000;
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue(project as never);
  jest.spyOn(ProjectService, "updateOneById").mockResolvedValue(1 as never);

  smsLogs = useInMemoryTable(SmsLogService, []);
  jest
    .spyOn(SmsLogService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
      Object.assign(smsLogs.get(data.id)!, data.data);
    }) as never);

  useInMemoryTable(StatusPageService, [
    {
      _id: STATUS_PAGE_ID,
      projectId: PROJECT_ID.toString(),
      name: "Acme Status",
      pageTitle: "Acme Status",
      isPublicStatusPage: true,
      showSubscriberPageOnStatusPage: true,
      enableSmsSubscribers: true,
      allowSubscribersToChooseResources: false,
      allowSubscribersToChooseEventTypes: false,
      isArchived: false,
    },
  ]);

  subscribers = useInMemoryTable(StatusPageSubscriberService, [
    {
      _id: SUBSCRIBER_ID,
      projectId: PROJECT_ID.toString(),
      statusPageId: STATUS_PAGE_ID,
      subscriberPhone: SUBSCRIBER_PHONE,
      unsubscribeToken: TOKEN,
      isUnsubscribed: false,
      isSubscribedToAllResources: true,
      isSubscribedToAllEventTypes: true,
    },
  ]);

  jest
    .spyOn(StatusPageService, "getStatusPageURL")
    .mockResolvedValue(STATUS_PAGE_URL);
  jest
    .spyOn(StatusPageService, "findOneBy")
    .mockImplementation((async (findBy: { select?: JSONObject }) => {
      // The sender's read of the page's Twilio account: none of its own.
      if (findBy.select && "callSmsConfig" in findBy.select) {
        return publicStatusPage();
      }

      const page: StatusPage = publicStatusPage();
      page.showSubscriberPageOnStatusPage = true;
      page.enableSmsSubscribers = true;
      page.allowSubscribersToChooseResources = false;
      page.allowSubscribersToChooseEventTypes = false;
      return page;
    }) as never);
  jest
    .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
    .mockResolvedValue([publicStatusPage()] as never);
  jest
    .spyOn(
      StatusPageSubscriberNotificationTemplateService,
      "getTemplateForStatusPage",
    )
    .mockResolvedValue(null as never);
  jest.spyOn(StatusPageAPI.prototype, "sendManageSubscriptionLinks");

  /*
   * The worker hands an SMS to the notification service over HTTP; here it
   * goes straight to the service that sends and logs it.
   */
  jest.spyOn(CommonSmsService, "sendSms").mockImplementation(((
    sms: SMS,
    options: { projectId?: ObjectID; statusPageId?: ObjectID },
  ): Promise<void> => {
    const sending: Promise<void> = SmsService.sendSms(sms.to, sms.message, {
      projectId: options.projectId,
      statusPageId: options.statusPageId,
      customTwilioConfig: TWILIO_CONFIG,
    });

    pendingSends.push(sending);
    return sending;
  }) as never);

  // The cancellation's own SQL is run by its Postgres suites.
  jest
    .spyOn(StatusPageSubscriberService, "unsubscribe")
    .mockImplementation((async (data: { subscriberId: ObjectID }) => {
      subscribers.get(data.subscriberId)!["isUnsubscribed"] = true;
      return true;
    }) as never);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a status page subscriber's texts in the SMS log", () => {
  test("the subscriber's phone gets working links; the log keeps them with the token redacted", async () => {
    await sendYouHaveSubscribedSms();
    await sendManageSubscriptionSms();

    // Both texts went out, each with its link whole.
    expect(delivered).toHaveLength(2);
    expect(delivered[0]).toContain(
      `${STATUS_PAGE_URL}/unsubscribe/${SUBSCRIBER_ID}-${TOKEN}`,
    );
    expect(delivered[1]).toContain(
      `${STATUS_PAGE_URL}/update-subscription/${SUBSCRIBER_ID}-${TOKEN}`,
    );

    const logged: Array<string> = await smsLogAsReader();

    expect(logged).toHaveLength(2);
    expect(logged.join("\n")).not.toContain(TOKEN);
    expect(logged).toContain(
      `You have been subscribed to Acme Status. To unsubscribe, click on the link: ${STATUS_PAGE_URL}/unsubscribe/${SUBSCRIBER_ID}-[redacted]`,
    );
    expect(logged).toContain(
      `You have selected to manage your subscription for the status page: Acme Status. You can manage your subscription here: ${STATUS_PAGE_URL}/update-subscription/${SUBSCRIBER_ID}-[redacted]`,
    );

    // Every link the log shows names its subscription, and carries no token.
    const links: Array<LoggedLink> = linksIn(logged);
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.segment).toBe(`${SUBSCRIBER_ID}-[redacted]`);
    }
  });

  test("a member with Read SMS Log may not read the subscribers themselves", async () => {
    props = {
      ...customDomainCaller({
        permissions: [Permission.ReadSmsLog],
        projectId: PROJECT_ID,
      }),
      ...ON_HIGHEST_PLAN,
    };

    const error: Error | undefined = await callRoute(
      "POST",
      "/status-page-subscriber/get-list",
      {
        body: { query: {}, select: { _id: true, subscriberPhone: true } },
        query: { skip: "0", limit: "10" },
      },
    );

    expect(error).toBeInstanceOf(NotAuthorizedException);
  });

  test("regression: nothing the log shows reads, changes or cancels the subscription", async () => {
    await sendYouHaveSubscribedSms();
    await sendManageSubscriptionSms();

    const links: Array<LoggedLink> = linksIn(await smsLogAsReader());
    expect(links.length).toBeGreaterThan(0);

    for (const link of links) {
      for (const attempt of attemptsFrom(link)) {
        const params: Record<string, string> = {
          statusPageId: STATUS_PAGE_ID,
          subscriberId: attempt.id,
          token: attempt.token,
        };

        // The manage page's read: the subscriber's contact and choices.
        (Response.sendEntityResponse as unknown as MockedFn).mockClear();
        const read: Error | undefined = await callRoute(
          "POST",
          "/status-page/get-subscription/:statusPageId/:subscriberId/:token",
          { params: params, body: { select: {} } },
        );
        expect(read?.message).toBe(MANAGE_SUBSCRIPTION_LINK_NOT_VALID_MESSAGE);
        expect(Response.sendEntityResponse).not.toHaveBeenCalled();

        // The manage page's change: cancel.
        const cancel: Error | undefined = await callRoute(
          "PUT",
          "/status-page/update-subscription/:statusPageId/:subscriberId/:token",
          { params: params, body: { data: { isUnsubscribed: true } } },
        );
        expect(cancel?.message).toBe(
          MANAGE_SUBSCRIPTION_LINK_NOT_VALID_MESSAGE,
        );

        // The unsubscribe page's confirmation.
        (Response.sendJsonObjectResponse as unknown as MockedFn).mockClear();
        await callRoute(
          "POST",
          "/status-page/unsubscribe/:statusPageId/:subscriberId/:token",
          { params: params },
        );
        expect(
          (
            (Response.sendJsonObjectResponse as unknown as MockedFn).mock
              .calls[0]![2] as JSONObject
          )["state"],
        ).toBe(StatusPageSubscriberUnsubscribeState.Invalid);
      }
    }

    expect(isCancelled()).toBe(false);
    expect(StatusPageSubscriberService.unsubscribe).not.toHaveBeenCalled();
  });

  test("the link the subscriber's phone got does what it says", async () => {
    await sendManageSubscriptionSms();

    const manageLink: string = delivered[0]!.split(" ").pop()!;
    const credential: StatusPageSubscriberUnsubscribeCredential | null =
      StatusPageSubscriberUnsubscribe.parseCredential(
        manageLink.split("/").pop(),
      );

    expect(credential).toEqual({ subscriberId: SUBSCRIBER_ID, token: TOKEN });

    const params: Record<string, string> = {
      statusPageId: STATUS_PAGE_ID,
      subscriberId: credential!.subscriberId,
      token: credential!.token!,
    };

    (Response.sendEntityResponse as unknown as MockedFn).mockClear();
    expect(
      await callRoute(
        "POST",
        "/status-page/get-subscription/:statusPageId/:subscriberId/:token",
        { params: params, body: { select: {} } },
      ),
    ).toBeUndefined();
    const shown: StatusPageSubscriber = (
      Response.sendEntityResponse as unknown as MockedFn
    ).mock.calls[0]![2] as StatusPageSubscriber;
    expect(shown.subscriberPhone?.toString()).toBe(SUBSCRIBER_PHONE);
    expect(shown.unsubscribeToken).toBeUndefined();

    expect(
      await callRoute(
        "PUT",
        "/status-page/update-subscription/:statusPageId/:subscriberId/:token",
        { params: params, body: { data: { isUnsubscribed: true } } },
      ),
    ).toBeUndefined();
    expect(isCancelled()).toBe(true);
  });

  test("a page's own SMS template with both links: the phone gets both whole, the log neither token", async () => {
    // A page with its own Twilio account, which is what lets it use its own templates.
    const callSmsConfig: ProjectCallSMSConfig = new ProjectCallSMSConfig();
    callSmsConfig._id = "1a000000-0000-4000-8000-000000000009";
    callSmsConfig.twilioAccountSID = "AC-own-account";
    callSmsConfig.twilioAuthToken = "own-auth-token";
    callSmsConfig.twilioPrimaryPhoneNumber = new Phone("+14155550199");

    const page: StatusPage = publicStatusPage();
    page.callSmsConfig = callSmsConfig;

    jest
      .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
      .mockResolvedValue([page] as never);

    const template: StatusPageSubscriberNotificationTemplate =
      new StatusPageSubscriberNotificationTemplate();
    template.templateBody =
      "{{statusPageName}}: manage {{manageSubscriptionUrl}} or stop {{unsubscribeUrl}}";

    jest
      .spyOn(
        StatusPageSubscriberNotificationTemplateService,
        "getTemplateForStatusPage",
      )
      .mockImplementation((async (data: {
        notificationMethod: StatusPageSubscriberNotificationMethod;
      }) => {
        return data.notificationMethod ===
          StatusPageSubscriberNotificationMethod.SMS
          ? template
          : null;
      }) as never);

    await sendManageSubscriptionSms();

    expect(delivered).toEqual([
      `Acme Status: manage ${STATUS_PAGE_URL}/update-subscription/${SUBSCRIBER_ID}-${TOKEN} or stop ${STATUS_PAGE_URL}/unsubscribe/${SUBSCRIBER_ID}-${TOKEN}`,
    ]);

    const logged: Array<string> = await smsLogAsReader();

    expect(logged).toEqual([
      `Acme Status: manage ${STATUS_PAGE_URL}/update-subscription/${SUBSCRIBER_ID}-${StatusPageSubscriberUnsubscribe.REDACTED_TOKEN} or stop ${STATUS_PAGE_URL}/unsubscribe/${SUBSCRIBER_ID}-${StatusPageSubscriberUnsubscribe.REDACTED_TOKEN}`,
    ]);
    expect(JSON.stringify(logged)).not.toContain(TOKEN);
  });
});
