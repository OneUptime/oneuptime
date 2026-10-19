import { mockRouter } from "./Helpers";
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
 * A STATUS PAGE'S SIGN-UPS AND MANAGE LINKS ARE LIMITED PER VISITOR AND PER
 * CONTACT.
 *
 * Anyone who can see a status page can sign a contact up to it - an email
 * address, a phone number, a Slack or Microsoft Teams channel, a webhook -
 * and each sign-up sends that contact a message as it is created; and anyone
 * can ask for a subscription's manage link, which is sent to the
 * subscription. Nothing counted either, so one visitor could send a text to
 * as many phone numbers as it could name, each paid for by the project, and
 * ask for as many manage links for one subscriber as it liked.
 *
 * Both routes now ask PublicMessageRateLimit before they send, and this
 * suite drives them as the status page does: the real routes, the real
 * subscriber create (its hooks, its checks and its "you have subscribed"
 * messages), the real read check of the page, with the tables held in
 * memory, a counter store that counts the way Redis does, and the senders
 * recorded rather than called. It holds:
 *
 *  - a visitor's sign-ups (and its sign-ups by text, tighter) and its
 *    manage links, per address and per IPv6 /64;
 *  - each contact's sign-ups and manage links, from every visitor together;
 *  - that a refused request creates and sends nothing, and says when to
 *    come back;
 *  - that a refusal of a manage link says nothing about who is subscribed;
 *  - that the people of one office signing up together, a private page's
 *    readers and a subscriber changing their subscription go on as before.
 */

jest.mock("../../../Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
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

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEntityArrayResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import Redis from "../../../Server/Infrastructure/Redis";
import MailService from "../../../Server/Services/MailService";
import ProjectService from "../../../Server/Services/ProjectService";
import SmsService from "../../../Server/Services/SmsService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService from "../../../Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import { getIpv6NetworkRateLimit } from "../../../Server/Utils/ClientIp";
import PublicMessageRateLimit, {
  PUBLIC_MESSAGE_ONE_EMAIL_ADDRESS_MESSAGE,
  PublicMessageKind,
} from "../../../Server/Utils/RateLimit/PublicMessageRateLimit";
import SSRFProtection from "../../../Server/Utils/SSRFProtection";
import StatusPageSubscriberWebhookUtil from "../../../Server/Utils/StatusPageSubscriberWebhook";
import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import { JSONObject } from "../../../Types/JSON";
import FakeCounterRedis from "../TestingUtils/Redis/FakeCounterRedis";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { useInMemorySubscriberCreates } from "../TestingUtils/SubscriberCreatesInMemory";

type MockedFn = ReturnType<typeof jest.fn>;

const SUBSCRIBE_ROUTE: string = "/status-page/subscribe/:statusPageId";
const MANAGE_ROUTE: string = "/status-page/manage-subscription/:statusPageId";
const UPDATE_ROUTE: string =
  "/status-page/update-subscription/:statusPageId/:subscriberId/:token";

const PROJECT_ID: string = "52000000-0000-4000-8000-000000000001";
const PRIVATE_PAGE_ID: string = "52000000-0000-4000-8000-0000000000ff";

// Page `index` of the project's public status pages.
function pageIdOf(index: number): string {
  return `52000000-0000-4000-8000-${String(100 + index).padStart(12, "0")}`;
}

const PAGE_ID: string = pageIdOf(0);
const PAGE_COUNT: number = 15;

/*
 * What a value that is not one mailbox is refused with: by Email itself,
 * which takes one mailbox, or by the limiter's own one-address check -
 * either way before anything is created, sent or counted.
 */
function oneMailboxRefusals(value: string): Array<string> {
  return [
    PUBLIC_MESSAGE_ONE_EMAIL_ADDRESS_MESSAGE,
    `Email ${value} is not in valid format.`,
  ];
}

const VISITOR: string = "203.0.113.7";
const NETWORK_PREFIX: string = "2001:db8:5:6";

// Host `index` of the /64 2001:db8:5:6::/64.
function hostOf(index: number): string {
  return `${NETWORK_PREFIX}:${(index >> 16).toString(16)}:${(index & 0xffff).toString(16)}:a:b`;
}

function phoneOf(index: number): string {
  return `+1415555${String(index).padStart(4, "0")}`;
}

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;

let redis: FakeCounterRedis;
let subscribers: InMemoryTable;
let texts: MockedFn;
let emails: MockedFn;
let webhookCalls: MockedFn;
let slackPosts: MockedFn;
let teamsPosts: MockedFn;
let signedInSession: unknown;
let currentTime: number;
let testIndex: number = 0;

function pageRow(id: string, extra: StoredRow = {}): StoredRow {
  return {
    _id: id,
    projectId: PROJECT_ID,
    name: `Acme ${id.slice(-3)}`,
    pageTitle: "Acme Status",
    isPublicStatusPage: true,
    showSubscriberPageOnStatusPage: true,
    enableEmailSubscribers: true,
    enableSmsSubscribers: true,
    enableSlackSubscribers: true,
    enableMicrosoftTeamsSubscribers: true,
    enableWebhookSubscribers: true,
    allowSubscribersToChooseResources: false,
    allowSubscribersToChooseEventTypes: false,
    limitSubscribersToPrivateUsers: false,
    isArchived: false,
    version: 1,
    ...extra,
  };
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new StatusPageAPI();
});

beforeEach(() => {
  jest.clearAllMocks();
  stubProjectDirectory({});

  redis = new FakeCounterRedis();
  getClientMock.mockReturnValue(redis);
  isConnectedMock.mockReturnValue(true);

  /*
   * The start of an hour (both windows divide one), a day further on for
   * each test, so no window carries over.
   */
  testIndex++;
  currentTime = Date.UTC(2031, 0, 1) + testIndex * 24 * 60 * 60 * 1000;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return currentTime;
  });

  const pages: Array<StoredRow> = [];

  for (let index: number = 0; index < PAGE_COUNT; index++) {
    pages.push(pageRow(pageIdOf(index)));
  }

  pages.push(pageRow(PRIVATE_PAGE_ID, { isPublicStatusPage: false }));

  useInMemoryTable(StatusPageService, pages);
  subscribers = useInMemoryTable(StatusPageSubscriberService, []);
  // Each new subscriber's INSERT, under its page's lock, into the table.
  useInMemorySubscriberCreates(subscribers);

  /*
   * The statements a change of a subscription writes Unsubscribed At with
   * are SQL of their own: answered as Postgres answers an UPDATE that
   * touched nothing, which is what they do here.
   */
  (subscribers.repository as unknown as { manager: unknown }).manager = {
    query: jest.fn(async (): Promise<unknown> => {
      return [[], 0];
    }),
  };

  // The page the request names, as the subscriber service reads it.
  jest
    .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
    .mockImplementation(async (ids: Array<unknown>): Promise<any> => {
      return await StatusPageService.findBy({
        query: { _id: String(ids[0]) },
        select: {
          _id: true,
          projectId: true,
          name: true,
          pageTitle: true,
          isPublicStatusPage: true,
        },
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      });
    });

  // A private page's reader is signed in when the test says so.
  signedInSession = null;
  jest
    .spyOn(
      StatusPageService as unknown as {
        findSignedInSession: () => Promise<unknown>;
      },
      "findSignedInSession",
    )
    .mockImplementation(async (): Promise<unknown> => {
      return signedInSession;
    });

  jest
    .spyOn(StatusPageService, "getStatusPageURL")
    .mockResolvedValue("https://status.acme.com");
  // A paid plan with no limit on subscribers, when billing is on.
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
  jest
    .spyOn(
      StatusPageSubscriberNotificationTemplateService,
      "getTemplateForStatusPage",
    )
    .mockResolvedValue(null);
  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.example.com"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);

  texts = jest
    .spyOn(SmsService, "sendSms")
    .mockResolvedValue(undefined as never) as unknown as MockedFn;
  emails = jest
    .spyOn(MailService, "sendMail")
    .mockResolvedValue(undefined as never) as unknown as MockedFn;
  webhookCalls = jest
    .spyOn(StatusPageSubscriberWebhookUtil, "sendWebhookNotification")
    .mockResolvedValue(undefined as never) as unknown as MockedFn;
  slackPosts = jest
    .spyOn(SlackUtil, "sendMessageToChannelViaIncomingWebhook")
    .mockResolvedValue(undefined as never) as unknown as MockedFn;
  teamsPosts = jest
    .spyOn(MicrosoftTeamsUtil, "sendMessageToChannelViaIncomingWebhook")
    .mockResolvedValue(undefined as never) as unknown as MockedFn;
});

afterEach(() => {
  jest.restoreAllMocks();
});

interface Answer {
  error: Exception | undefined;
  retryAfter: string | undefined;
}

// A request as the status page sends it, through the bundled Nginx.
async function call(
  method: string,
  route: string,
  data: {
    from: string;
    params: Record<string, string>;
    body: JSONObject;
  },
): Promise<Answer> {
  const headers: Record<string, string> = {};
  const next: MockedFn = jest.fn();
  const req: ExpressRequest = {
    params: data.params,
    body: { data: data.body },
    query: {},
    cookies: {},
    headers: { "x-forwarded-for": data.from },
    socket: { remoteAddress: "10.0.0.2" },
    ips: [],
    get: (): undefined => {
      return undefined;
    },
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {
    setHeader: (name: string, value: string): void => {
      headers[name] = value;
    },
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
    json: jest.fn(),
  } as unknown as ExpressResponse;

  await mockRouter
    .match(method, route)
    .handlerFunction(req, res, next as unknown as NextFunction);

  // The manage links go out in the background; let them.
  for (let tick: number = 0; tick < 3; tick++) {
    await new Promise((resolve: (value: unknown) => void): void => {
      setTimeout(resolve, 0);
    });
  }

  return {
    error: next.mock.calls[0]?.[0] as Exception | undefined,
    retryAfter: headers["Retry-After"],
  };
}

async function signUp(
  from: string,
  body: JSONObject,
  pageId: string = PAGE_ID,
): Promise<Answer> {
  return await call("post", SUBSCRIBE_ROUTE, {
    from: from,
    params: { statusPageId: pageId },
    body: body,
  });
}

async function askForManageLink(
  from: string,
  body: JSONObject,
  pageId: string = PAGE_ID,
): Promise<Answer> {
  return await call("post", MANAGE_ROUTE, {
    from: from,
    params: { statusPageId: pageId },
    body: body,
  });
}

// Runs `count` requests one after another and tells how many went through.
async function acceptedOf(
  count: number,
  request: (index: number) => Promise<Answer>,
): Promise<{ accepted: number; refusals: Array<Answer> }> {
  let accepted: number = 0;
  const refusals: Array<Answer> = [];

  for (let index: number = 0; index < count; index++) {
    const answer: Answer = await request(index);

    if (answer.error) {
      refusals.push(answer);
    } else {
      accepted++;
    }
  }

  return { accepted: accepted, refusals: refusals };
}

function expectRefused(answer: Answer | undefined, message: string): void {
  expect(answer?.error?.code).toBe(ExceptionCode.TooManyRequestsException);
  expect(answer?.error?.message).toBe(message);
  expect(answer?.retryAfter).toMatch(/^[1-9][0-9]*$/);
}

function storedSubscriber(subscriberId: string, pageId: string): StoredRow {
  const row: StoredRow = {
    _id: subscriberId,
    projectId: PROJECT_ID,
    statusPageId: pageId,
    unsubscribeToken: "5c".repeat(32),
    isUnsubscribed: false,
    isSubscriptionConfirmed: true,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    version: 1,
  };

  subscribers.rows.push(row);

  return row;
}

const SIGN_UP_BY_TEXT_REFUSAL: string =
  "Too many sign-ups by text message from your network. Please wait a few minutes and try again.";
const SIGN_UP_REFUSAL: string =
  "Too many sign-ups from your network. Please wait a few minutes and try again.";

describe("signing up on a status page", () => {
  test("one visitor signing up phone after phone: ten are subscribed and texted, then every sign-up is refused, and nothing more is created or sent", async () => {
    const { accepted, refusals } = await acceptedOf(300, (index: number) => {
      return signUp(VISITOR, { subscriberPhone: phoneOf(index) });
    });

    // Before these limits: 300 subscribers, 300 texts on the project's bill.
    expect(accepted).toBe(10);
    expect(subscribers.rows).toHaveLength(10);
    expect(texts).toHaveBeenCalledTimes(10);
    expect(refusals).toHaveLength(290);
    expectRefused(refusals[0], SIGN_UP_BY_TEXT_REFUSAL);
    expectRefused(refusals[289], SIGN_UP_BY_TEXT_REFUSAL);
  });

  test("one visitor signing up email after email: sixty confirmations, then refused", async () => {
    const { accepted, refusals } = await acceptedOf(300, (index: number) => {
      return signUp(VISITOR, { subscriberEmail: `person${index}@example.com` });
    });

    expect(accepted).toBe(60);
    expect(subscribers.rows).toHaveLength(60);
    expect(emails).toHaveBeenCalledTimes(60);
    expectRefused(refusals[0], SIGN_UP_REFUSAL);
  });

  test("forty people of one office, behind one address, all sign up during an incident", async () => {
    const { accepted } = await acceptedOf(40, (index: number) => {
      return signUp(VISITOR, {
        subscriberEmail: `engineer${index}@customer.example`,
      });
    });

    expect(accepted).toBe(40);
    expect(emails).toHaveBeenCalledTimes(40);

    // Ten of them by text as well, on top of their emails.
    const byText: { accepted: number } = await acceptedOf(
      10,
      (index: number) => {
        return signUp(VISITOR, { subscriberPhone: phoneOf(index) });
      },
    );

    expect(byText.accepted).toBe(10);
  });

  test("the text-message allowance is spent by sign-ups by text only: emails go on after it", async () => {
    await acceptedOf(11, (index: number) => {
      return signUp(VISITOR, { subscriberPhone: phoneOf(index) });
    });

    expect(
      (await signUp(VISITOR, { subscriberEmail: "after@example.com" })).error,
    ).toBeUndefined();
  });

  test("one email address signed up on page after page, by visitor after visitor: ten in an hour, then refused", async () => {
    const { accepted, refusals } = await acceptedOf(
      PAGE_COUNT,
      (index: number) => {
        return signUp(
          `192.0.2.${index + 1}`,
          { subscriberEmail: "victim@example.com" },
          pageIdOf(index),
        );
      },
    );

    expect(accepted).toBe(10);
    expect(emails).toHaveBeenCalledTimes(10);
    expectRefused(
      refusals[0],
      "Too many sign-ups for this email address in the last hour. Please try again later.",
    );

    // An hour on, the address may be signed up again.
    currentTime += 60 * 60 * 1000;

    expect(
      (
        await signUp(
          "192.0.2.200",
          { subscriberEmail: "victim@example.com" },
          pageIdOf(PAGE_COUNT - 1),
        )
      ).error,
    ).toBeUndefined();
  });

  test("spelling the address another way does not buy it another ten", async () => {
    const spellings: Array<string> = [
      "victim@gmail.com",
      "Victim@gmail.com",
      "vic.tim@gmail.com",
      "victim+1@gmail.com",
      "victim+2@googlemail.com",
      "v.i.c.t.i.m@gmail.com",
      "VICTIM+status@gmail.com",
      "vi.ctim+x@gmail.com",
      "victim+3@gmail.com",
      "victim+4@gmail.com",
      "victim+5@gmail.com",
      "victim+6@gmail.com",
    ];

    const { accepted } = await acceptedOf(spellings.length, (index: number) => {
      return signUp(
        `192.0.2.${index + 1}`,
        { subscriberEmail: spellings[index]! },
        pageIdOf(index),
      );
    });

    expect(accepted).toBe(10);
  });

  test("one phone signed up on page after page, typed however: ten texts in an hour, then refused", async () => {
    const { accepted, refusals } = await acceptedOf(
      PAGE_COUNT,
      (index: number) => {
        return signUp(
          `192.0.2.${index + 1}`,
          { subscriberPhone: index % 2 ? "+14155550100" : "14155550100" },
          pageIdOf(index),
        );
      },
    );

    expect(accepted).toBe(10);
    expect(texts).toHaveBeenCalledTimes(10);
    expectRefused(
      refusals[0],
      "Too many sign-ups for this phone number in the last hour. Please try again later.",
    );
  });

  test("one webhook signed up again and again on one page: one subscription; the rest are told it is subscribed already, and cost it nothing", async () => {
    const { accepted, refusals } = await acceptedOf(100, (index: number) => {
      return signUp(`192.0.2.${(index % 50) + 1}`, {
        subscriberWebhook: "https://victim.example.net/hook",
      });
    });

    // Before: 100 subscriptions, each called on every update.
    expect(accepted).toBe(1);
    expect(subscribers.rows).toHaveLength(1);
    expect(webhookCalls).toHaveBeenCalledTimes(1);
    expect(refusals).toHaveLength(99);
    expect(refusals[0]!.error?.message).toBe(
      "You are already subscribed to this status page.",
    );
    expect(refusals[98]!.error?.message).toBe(
      "You are already subscribed to this status page.",
    );
  });

  test("one webhook signed up on page after page: ten subscriptions in an hour, then refused", async () => {
    const { accepted, refusals } = await acceptedOf(
      PAGE_COUNT,
      (index: number) => {
        return signUp(
          `192.0.2.${index + 1}`,
          { subscriberWebhook: "https://victim.example.net/hook" },
          pageIdOf(index),
        );
      },
    );

    expect(accepted).toBe(10);
    expect(subscribers.rows).toHaveLength(10);
    expect(webhookCalls).toHaveBeenCalledTimes(10);
    expectRefused(
      refusals[0],
      "Too many sign-ups for this webhook in the last hour. Please try again later.",
    );
  });

  test("one Slack channel and one Microsoft Teams channel, on page after page: ten each in an hour", async () => {
    const slack: { accepted: number; refusals: Array<Answer> } =
      await acceptedOf(12, (index: number) => {
        return signUp(
          `192.0.2.${index + 1}`,
          {
            slackIncomingWebhookUrl:
              "https://hooks.slack.com/services/T000/B000/victim",
            slackWorkspaceName: "Victim",
          },
          pageIdOf(index),
        );
      });

    expect(slack.accepted).toBe(10);
    expect(slackPosts).toHaveBeenCalledTimes(10);
    expectRefused(
      slack.refusals[0],
      "Too many sign-ups for this Slack channel in the last hour. Please try again later.",
    );

    const teams: { accepted: number; refusals: Array<Answer> } =
      await acceptedOf(12, (index: number) => {
        return signUp(
          `192.0.2.${index + 1}`,
          {
            microsoftTeamsIncomingWebhookUrl:
              "https://victim.webhook.office.com/webhookb2/victim",
            microsoftTeamsWorkspaceName: "Victim",
          },
          pageIdOf(index),
        );
      });

    expect(teams.accepted).toBe(10);
    expect(teamsPosts).toHaveBeenCalledTimes(10);
    expectRefused(
      teams.refusals[0],
      "Too many sign-ups for this Microsoft Teams channel in the last hour. Please try again later.",
    );
  });

  test("a list of email addresses is refused, and nothing is created or sent", async () => {
    for (const subscriberEmail of [
      "a@example.com,b@example.com",
      "a@example.com;b@example.com",
      "a@example.com b@example.com",
    ]) {
      const answer: Answer = await signUp(VISITOR, { subscriberEmail });

      expect(answer.error?.code).toBe(ExceptionCode.BadDataException);
      expect(oneMailboxRefusals(subscriberEmail)).toContain(
        answer.error?.message,
      );
    }

    expect(subscribers.rows).toHaveLength(0);
    expect(emails).not.toHaveBeenCalled();
  });

  test("an address written as a group, or with a trailing dot, is refused; one with an apostrophe signs up", async () => {
    for (const subscriberEmail of [
      "x:victim@example.com",
      "group:victim@example.com;",
      "victim@example.com.",
    ]) {
      const answer: Answer = await signUp(VISITOR, { subscriberEmail });

      expect({
        subscriberEmail,
        refused: oneMailboxRefusals(subscriberEmail).includes(
          answer.error?.message as string,
        ),
      }).toEqual({ subscriberEmail, refused: true });
    }

    expect(subscribers.rows).toHaveLength(0);
    expect(emails).not.toHaveBeenCalled();

    expect(
      (await signUp(VISITOR, { subscriberEmail: "o'brien@example.com" })).error,
    ).toBeUndefined();
    expect(subscribers.rows).toHaveLength(1);
    expect(emails).toHaveBeenCalledTimes(1);
  });

  test("the hosts of one IPv6 /64 sign up ten addresses' worth, then the /64 is refused", async () => {
    const networkLimit: number = getIpv6NetworkRateLimit(60);

    const { accepted, refusals } = await acceptedOf(
      networkLimit + 20,
      (index: number) => {
        return signUp(hostOf(index + 1), {
          subscriberEmail: `person${index}@example.com`,
        });
      },
    );

    expect(accepted).toBe(networkLimit);
    expectRefused(refusals[0], SIGN_UP_REFUSAL);

    // Another network signs up as ever.
    expect(
      (await signUp("198.51.100.4", { subscriberEmail: "other@example.com" }))
        .error,
    ).toBeUndefined();
  });

  test("a sign-up refused for anything else is not counted against anybody", async () => {
    await call("post", SUBSCRIBE_ROUTE, {
      from: VISITOR,
      params: { statusPageId: PAGE_ID },
      body: {},
    });

    expect(redis.keys()).toEqual([]);
  });

  test("a private page's signed-in reader signs up, counted like anyone", async () => {
    // Not signed in: refused by the page, before anything is counted.
    const anonymous: Answer = await signUp(
      VISITOR,
      { subscriberEmail: "reader@example.com" },
      PRIVATE_PAGE_ID,
    );

    expect(anonymous.error?.code).toBe(ExceptionCode.NotAuthenticatedException);
    expect(redis.keys()).toEqual([]);

    signedInSession = { _id: "52000000-0000-4000-8000-00000000aaaa" };

    expect(
      (
        await signUp(
          VISITOR,
          { subscriberEmail: "reader@example.com" },
          PRIVATE_PAGE_ID,
        )
      ).error,
    ).toBeUndefined();
    expect(subscribers.rows).toHaveLength(1);
    expect(redis.keysHolding(":c:")).toHaveLength(1);
  });

  test("a subscriber changing their subscription from its link is not counted, even from a visitor that is out of sign-ups", async () => {
    await acceptedOf(61, (index: number) => {
      return signUp(VISITOR, { subscriberEmail: `person${index}@example.com` });
    });

    const subscriber: StoredRow = subscribers.rows[0]!;
    const keysBefore: Array<string> = redis.keys();

    const answer: Answer = await call("put", UPDATE_ROUTE, {
      from: VISITOR,
      params: {
        statusPageId: PAGE_ID,
        subscriberId: String(subscriber["_id"]),
        token: String(subscriber["unsubscribeToken"]),
      },
      body: { isUnsubscribed: false, isSubscribedToAllResources: true },
    });

    expect(answer.error).toBeUndefined();
    expect(
      subscribers.updates.filter((update: { id: string }): boolean => {
        return update.id === String(subscriber["_id"]);
      }),
    ).not.toHaveLength(0);
    expect(redis.keys()).toEqual(keysBefore);
  });

  test("while the counter cannot be reached, a sign-up by email goes on and a sign-up by text is refused with nothing created", async () => {
    isConnectedMock.mockReturnValue(false);

    expect(
      (await signUp(VISITOR, { subscriberEmail: "person@example.com" })).error,
    ).toBeUndefined();

    const byText: Answer = await signUp(VISITOR, {
      subscriberPhone: phoneOf(1),
    });

    expect(byText.error?.code).toBe(ExceptionCode.ServiceUnavailableException);
    expect(byText.error?.message).toBe(
      "Sign-ups by text message cannot be accepted right now. Please try again in a few minutes.",
    );
    expect(subscribers.rows).toHaveLength(1);
    expect(texts).not.toHaveBeenCalled();
  });
});

/*
 * A contact's sign-ups count the sign-ups that sent it something. One refused
 * or failed before anything went out leaves the contact's allowance as it
 * was: otherwise anyone could use up a person's sign-ups with requests that
 * are refused anyway, and that person could not subscribe anywhere for the
 * rest of the hour. The caller's own count is spent all the same.
 */
describe("a contact's sign-ups count only the sign-ups that sent it something", () => {
  const VICTIM_EMAIL: string = "victim@example.com";
  const VICTIM_PHONE: string = "+14155550123";

  // The victim's own sign-ups, page after page: how many go through.
  async function victimSignUps(
    body: JSONObject,
    count: number = 11,
  ): Promise<{ accepted: number; refusals: Array<Answer> }> {
    return await acceptedOf(count, (index: number) => {
      return signUp(`198.51.100.${index + 1}`, body, pageIdOf(index + 1));
    });
  }

  test("signed up again where it is already subscribed: refused, and the address keeps its ten", async () => {
    storedSubscriber("52000000-0000-4000-8000-000000000020", PAGE_ID)[
      "subscriberEmail"
    ] = VICTIM_EMAIL;

    for (let index: number = 0; index < 20; index++) {
      const answer: Answer = await signUp(`192.0.2.${index + 1}`, {
        subscriberEmail: VICTIM_EMAIL,
      });

      expect(answer.error?.message).toBe(
        "You are already subscribed to this status page.",
      );
    }

    expect(emails).not.toHaveBeenCalled();

    const { accepted, refusals } = await victimSignUps({
      subscriberEmail: VICTIM_EMAIL,
    });

    expect(accepted).toBe(10);
    expect(emails).toHaveBeenCalledTimes(10);
    expectRefused(
      refusals[0],
      "Too many sign-ups for this email address in the last hour. Please try again later.",
    );
  });

  test("named beside a Slack address that is not one: refused, and the address keeps its ten", async () => {
    for (let index: number = 0; index < 20; index++) {
      const answer: Answer = await signUp(`192.0.2.${index + 1}`, {
        subscriberEmail: VICTIM_EMAIL,
        slackIncomingWebhookUrl: "https://example.net/not-a-slack-webhook",
      });

      expect(answer.error?.message).toBe("Invalid Slack Incoming Webhook URL.");
    }

    expect(subscribers.rows).toHaveLength(0);
    expect(
      (await victimSignUps({ subscriberEmail: VICTIM_EMAIL })).accepted,
    ).toBe(10);
  });

  test("named beside a webhook the page may not call: refused, and the address keeps its ten", async () => {
    jest
      .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
      .mockRejectedValue(
        new BadDataException("Webhook URL points at a private address."),
      );

    for (let index: number = 0; index < 20; index++) {
      const answer: Answer = await signUp(`192.0.2.${index + 1}`, {
        subscriberEmail: VICTIM_EMAIL,
        subscriberWebhook: "https://10.0.0.5/hook",
      });

      expect(answer.error?.message).toBe(
        "Webhook URL points at a private address.",
      );
    }

    jest
      .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
      .mockResolvedValue(undefined);

    expect(
      (await victimSignUps({ subscriberEmail: VICTIM_EMAIL })).accepted,
    ).toBe(10);
  });

  test("named with a value too long to keep: refused, and the address keeps its ten", async () => {
    for (let index: number = 0; index < 20; index++) {
      const answer: Answer = await signUp(`192.0.2.${index + 1}`, {
        subscriberEmail: VICTIM_EMAIL,
        slackWorkspaceName: "w".repeat(5000),
      });

      expect(answer.error?.message).toContain("slackWorkspaceName length");
    }

    expect(subscribers.rows).toHaveLength(0);
    expect(
      (await victimSignUps({ subscriberEmail: VICTIM_EMAIL })).accepted,
    ).toBe(10);
  });

  test("a phone signed up where the project sends no texts: refused, and the phone keeps its ten", async () => {
    jest
      .spyOn(ProjectService, "isSMSNotificationsEnabled")
      .mockResolvedValue(false);

    for (let index: number = 0; index < 20; index++) {
      const answer: Answer = await signUp(`192.0.2.${index + 1}`, {
        subscriberPhone: VICTIM_PHONE,
      });

      expect(answer.error?.message).toBe(
        "SMS subscribers not enabled for this status page.",
      );
    }

    jest
      .spyOn(ProjectService, "isSMSNotificationsEnabled")
      .mockResolvedValue(true);

    const { accepted } = await victimSignUps({ subscriberPhone: VICTIM_PHONE });

    expect(accepted).toBe(10);
    expect(texts).toHaveBeenCalledTimes(10);
  });

  test("named beside a phone that has had its ten: refused for the phone, and the address keeps its ten", async () => {
    await acceptedOf(10, (index: number) => {
      return signUp(
        `203.0.113.${index + 1}`,
        { subscriberPhone: VICTIM_PHONE },
        pageIdOf(index),
      );
    });

    for (let index: number = 0; index < 20; index++) {
      expectRefused(
        await signUp(`192.0.2.${index + 1}`, {
          subscriberEmail: VICTIM_EMAIL,
          subscriberPhone: VICTIM_PHONE,
        }),
        "Too many sign-ups for this phone number in the last hour. Please try again later.",
      );
    }

    expect(
      (await victimSignUps({ subscriberEmail: VICTIM_EMAIL })).accepted,
    ).toBe(10);
  });

  test("the visitor's own count is spent by its refused sign-ups all the same", async () => {
    storedSubscriber("52000000-0000-4000-8000-000000000021", PAGE_ID)[
      "subscriberEmail"
    ] = VICTIM_EMAIL;

    for (let index: number = 0; index < 60; index++) {
      await signUp(VISITOR, { subscriberEmail: VICTIM_EMAIL });
    }

    expectRefused(
      await signUp(VISITOR, { subscriberEmail: "someone-else@example.com" }),
      SIGN_UP_REFUSAL,
    );
  });

  test("a sign-up that fails once its subscriber is written - its text already sent - keeps its count", async () => {
    jest
      .spyOn(DatabaseConfig, "getHost")
      .mockRejectedValue(new Error("settings unavailable"));

    for (let index: number = 0; index < 10; index++) {
      const answer: Answer = await signUp(
        `192.0.2.${index + 1}`,
        {
          subscriberPhone: VICTIM_PHONE,
          subscriberEmail: `p${index}@x.example`,
        },
        pageIdOf(index),
      );

      expect(answer.error?.message).toBe("settings unavailable");
    }

    // Each was written and texted before its confirmation email failed.
    expect(subscribers.rows).toHaveLength(10);
    expect(texts).toHaveBeenCalledTimes(10);

    jest
      .spyOn(DatabaseConfig, "getHost")
      .mockResolvedValue(new Hostname("oneuptime.example.com"));

    expectRefused(
      await signUp(
        "192.0.2.200",
        { subscriberPhone: VICTIM_PHONE },
        pageIdOf(PAGE_COUNT - 1),
      ),
      "Too many sign-ups for this phone number in the last hour. Please try again later.",
    );
    expect(texts).toHaveBeenCalledTimes(10);
  });
});

const MANAGE_LINK_REFUSAL: string =
  "Too many links asked for from your network. Please wait a few minutes and try again.";

describe("asking for a subscription's manage link", () => {
  test("a subscribed phone's link asked for from address after address: five texts in the hour, then refused", async () => {
    storedSubscriber("52000000-0000-4000-8000-000000000010", PAGE_ID)[
      "subscriberPhone"
    ] = "+14155550100";

    const { accepted, refusals } = await acceptedOf(100, (index: number) => {
      return askForManageLink(`192.0.2.${(index % 200) + 1}`, {
        subscriberPhone: "+14155550100",
      });
    });

    // Before these limits: 100 texts to one subscriber, on the project's bill.
    expect(accepted).toBe(5);
    expect(texts).toHaveBeenCalledTimes(5);
    expectRefused(
      refusals[0],
      "Too many links asked for this phone number in the last hour. Please use the latest one, or try again later.",
    );
  });

  test("the answer is the same whether or not the contact is subscribed", async () => {
    storedSubscriber("52000000-0000-4000-8000-000000000011", PAGE_ID)[
      "subscriberEmail"
    ] = "subscribed@example.com";

    const answersFor: (email: string) => Promise<Array<string>> = async (
      email: string,
    ): Promise<Array<string>> => {
      const answers: Array<string> = [];

      for (let index: number = 0; index < 7; index++) {
        const answer: Answer = await askForManageLink(`192.0.2.${index + 1}`, {
          subscriberEmail: email,
        });

        answers.push(answer.error ? answer.error.message : "ok");
      }

      return answers;
    };

    const subscribed: Array<string> = await answersFor(
      "subscribed@example.com",
    );
    const notSubscribed: Array<string> = await answersFor("nobody@example.com");

    expect(notSubscribed).toEqual(subscribed);
    expect(subscribed.slice(0, 5)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(subscribed[5]).toBe(
      "Too many links asked for this email address in the last hour. Please use the latest one, or try again later.",
    );
    // Only the subscribed address was sent anything: five links.
    expect(emails).toHaveBeenCalledTimes(5);
  });

  test("one visitor asking for links for contact after contact: thirty, then refused", async () => {
    const { accepted, refusals } = await acceptedOf(50, (index: number) => {
      return askForManageLink(VISITOR, {
        subscriberEmail: `person${index}@example.com`,
      });
    });

    expect(accepted).toBe(30);
    expectRefused(refusals[0], MANAGE_LINK_REFUSAL);
  });

  test("links by text spend the visitor's text allowance with its sign-ups by text", async () => {
    await acceptedOf(7, (index: number) => {
      return signUp(VISITOR, { subscriberPhone: phoneOf(index) });
    });

    const { accepted, refusals } = await acceptedOf(10, (index: number) => {
      return askForManageLink(VISITOR, { subscriberPhone: phoneOf(index) });
    });

    expect(accepted).toBe(3);
    expectRefused(
      refusals[0],
      "Too many links asked for by text message from your network. Please wait a few minutes and try again.",
    );
  });

  test("a Slack workspace's links are counted on each status page", async () => {
    const { accepted } = await acceptedOf(7, (index: number) => {
      return askForManageLink(`192.0.2.${index + 1}`, {
        slackWorkspaceName: "Engineering",
      });
    });

    expect(accepted).toBe(5);

    // Another company's "Engineering", on another page, is somebody else.
    expect(
      (
        await askForManageLink(
          "192.0.2.100",
          { slackWorkspaceName: "Engineering" },
          pageIdOf(1),
        )
      ).error,
    ).toBeUndefined();
  });

  test("a list of email addresses is refused before anything is looked up", async () => {
    const answer: Answer = await askForManageLink(VISITOR, {
      subscriberEmail: "a@example.com,b@example.com",
    });

    expect(oneMailboxRefusals("a@example.com,b@example.com")).toContain(
      answer.error?.message,
    );
    expect(redis.keys()).toEqual([]);
  });

  test("while the counter cannot be reached, a link by email is sent and a link by text is refused, subscribed or not", async () => {
    storedSubscriber("52000000-0000-4000-8000-000000000012", PAGE_ID)[
      "subscriberEmail"
    ] = "subscribed@example.com";

    isConnectedMock.mockReturnValue(false);

    expect(
      (
        await askForManageLink(VISITOR, {
          subscriberEmail: "subscribed@example.com",
        })
      ).error,
    ).toBeUndefined();
    expect(emails).toHaveBeenCalledTimes(1);

    for (const phone of ["+14155550100", "+14155550199"]) {
      const answer: Answer = await askForManageLink(VISITOR, {
        subscriberPhone: phone,
      });

      expect(answer.error?.code).toBe(
        ExceptionCode.ServiceUnavailableException,
      );
    }

    expect(texts).not.toHaveBeenCalled();
  });
});

describe("the limits these routes are held to", () => {
  test("are PublicMessageRateLimit's for status page sign-ups and manage links", () => {
    expect(
      PublicMessageRateLimit.getConfig().kinds[
        PublicMessageKind.StatusPageSignUp
      ],
    ).toEqual({ perClientLimit: 60, perContactLimit: 10 });
    expect(
      PublicMessageRateLimit.getConfig().kinds[
        PublicMessageKind.StatusPageManageLink
      ],
    ).toEqual({ perClientLimit: 30, perContactLimit: 5 });
    expect(PublicMessageRateLimit.getConfig().perClientTextMessageLimit).toBe(
      10,
    );
  });
});
