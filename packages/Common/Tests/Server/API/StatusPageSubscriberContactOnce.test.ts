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
 * A STATUS PAGE TAKES EACH CONTACT ONCE, HOWEVER IT IS WRITTEN.
 *
 * A phone number is stored as it was typed, and so is a webhook. A page
 * refused a second subscription of a contact only when it was typed the same
 * way, so one number typed with spaces, dashes, brackets, tabs, a "+" or a
 * "00" was a subscriber of one page once for every spelling - and every
 * notification of the page texted that number once for each. A webhook
 * written with its host in capitals, its port, a fragment or its path
 * percent-encoded was called once for each the same way.
 *
 * Now a page takes a phone by its line and a webhook by the address it is
 * sent to (SubscriberContactKey): a visitor's sign-up, the team's create and
 * a change of a subscriber's contact are refused for a contact the page
 * already has, and the check is made again with the INSERT, under the
 * page's lock, so two creates of one contact sent together leave one. Driven
 * through the real routes (SubscriberWorld).
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

import StatusPageSubscriberService, {
  ALREADY_SUBSCRIBED_MESSAGE,
  CONTACT_ALREADY_SUBSCRIBED_MESSAGE,
  SUBSCRIBER_CONTACT_LIMIT_NAME,
} from "../../../Server/Services/StatusPageSubscriberService";
import ProjectLimitLock from "../../../Server/Utils/Database/ProjectLimitLock";
import PublicMessageRateLimit, {
  PublicMessageKind,
} from "../../../Server/Utils/RateLimit/PublicMessageRateLimit";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { StoredRow } from "../TestingUtils/InMemoryRepository";
import {
  Answer,
  SubscriberWorld,
  WORLD_PAGE_ID,
  WORLD_PROJECT_ID,
  callRoute,
  pageIdOf,
  registerSubscriberRoutes,
  rowsOf,
  setUpSubscriberWorld,
  signUp,
  teamAdd,
  teamCaller,
  teamUpdate,
} from "./SubscriberWorld";

/*
 * One number - +1 (415) 555-0100 - typed the ways the phone field takes
 * it: with or without "+", in brackets, with dashes, dots, spaces or tabs
 * between its groups, and after "00", how most of the world dials out.
 */
const ONE_NUMBER_TYPED_EVERY_WAY: Array<string> = [
  "+14155550100",
  "14155550100",
  "+(141)55550100",
  "(141)55550100",
  "+141-555-50100",
  "141-555-50100",
  "+141.555.50100",
  "141.555.50100",
  "+141 555 50100",
  "141 555 50100",
  "0014155550100",
  "(001)4155550100",
  "+(141)555-50100",
  "+(141) 555 50100",
  "(141)-555.50100",
  "141\t555\t50100",
  "+141\t555\t50100",
  "141 555-50100",
  "141-555 50100",
  "+141.555 50100",
];

// One webhook, written the ways its address can be written.
const ONE_WEBHOOK_WRITTEN_EVERY_WAY: Array<string> = [
  "https://subscriber.example.net/hook",
  "https://SUBSCRIBER.example.net/hook",
  "https://subscriber.EXAMPLE.net/hook",
  "https://subscriber.example.NET/hook",
  "https://subscriber.example.net:443/hook",
  "https://subscriber.example.net/hook#a",
  "https://subscriber.example.net/hook#b",
  "HTTPS://subscriber.example.net/hook",
  "https://subscriber.example.net/%68ook",
  "https://subscriber.example.net/h%6Fok",
  "https://subscriber.example.net/%68%6f%6f%6b",
];

const SLACK_CHANNEL: string =
  "https://hooks.slack.com/services/T0000/B0000/AbCdEf";
const TEAMS_CHANNEL: string =
  "https://acme.webhook.office.com/webhookb2/abc@def/IncomingWebhook/123/456";

let world: SubscriberWorld;

beforeAll(() => {
  registerSubscriberRoutes();
});

beforeEach(() => {
  world = setUpSubscriberWorld();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The answers of `count` sign-ups, each from an address of its own.
async function signUps(
  bodies: Array<Record<string, unknown>>,
  pageId: string = WORLD_PAGE_ID,
): Promise<Array<Answer>> {
  const answers: Array<Answer> = [];

  for (let index: number = 0; index < bodies.length; index++) {
    answers.push(
      await signUp(
        `192.0.2.${index + 1}`,
        bodies[index] as Record<string, never>,
        pageId,
      ),
    );
  }

  return answers;
}

function refusedWith(answers: Array<Answer>): Array<string | undefined> {
  return answers.map((answer: Answer): string | undefined => {
    return answer.error?.message;
  });
}

// A contact's sign-ups counted in this hour (PublicMessageRateLimit).
function signUpsCountedFor(
  contact: ReturnType<typeof PublicMessageRateLimit.forPhone>,
): number {
  return world.redis.count(
    PublicMessageRateLimit.getContactCounterKey({
      counterName: PublicMessageKind.StatusPageSignUp,
      contact: contact,
    }),
  );
}

describe("a visitor signing up a phone number", () => {
  test("one number typed every way on one page: one subscriber, and every other spelling is told it is subscribed already", async () => {
    const answers: Array<Answer> = await signUps(
      ONE_NUMBER_TYPED_EVERY_WAY.map(
        (subscriberPhone: string): Record<string, unknown> => {
          return { subscriberPhone };
        },
      ),
    );

    expect(answers[0]!.error).toBeUndefined();
    expect(refusedWith(answers.slice(1))).toEqual(
      ONE_NUMBER_TYPED_EVERY_WAY.slice(1).map((): string => {
        return ALREADY_SUBSCRIBED_MESSAGE;
      }),
    );

    // Before: twenty subscribers, each texted on every notification.
    expect(rowsOf(world)).toHaveLength(1);
    expect(String(rowsOf(world)[0]!["subscriberPhone"])).toBe("+14155550100");
    expect(world.texts).toHaveBeenCalledTimes(1);

    /*
     * The refused sign-ups sent nothing, so they cost the number nothing:
     * its count is the one text it was sent.
     */
    expect(
      signUpsCountedFor(PublicMessageRateLimit.forPhone("+14155550100")),
    ).toBe(1);
  });

  test("every spelling is refused hour after hour, so no number piles up on a page", async () => {
    for (const subscriberPhone of ONE_NUMBER_TYPED_EVERY_WAY) {
      await signUp("198.51.100.1", { subscriberPhone });
      world.advance(60 * 60 * 1000);
    }

    expect(rowsOf(world)).toHaveLength(1);
    expect(world.texts).toHaveBeenCalledTimes(1);
  });

  test("the number on another page is a subscriber of that page too", async () => {
    await signUp("192.0.2.1", { subscriberPhone: "+14155550100" }, pageIdOf(0));
    const other: Answer = await signUp(
      "192.0.2.2",
      { subscriberPhone: "141 555 50100" },
      pageIdOf(1),
    );

    expect(other.error).toBeUndefined();
    expect(rowsOf(world, pageIdOf(0))).toHaveLength(1);
    expect(rowsOf(world, pageIdOf(1))).toHaveLength(1);
  });

  test("other numbers are other subscribers: one digit apart, and a number written without its country code", async () => {
    const answers: Array<Answer> = await signUps([
      { subscriberPhone: "+14155550100" },
      { subscriberPhone: "+14155550101" },
      { subscriberPhone: "4155550100" },
      { subscriberPhone: "+441415550100" },
    ]);

    expect(refusedWith(answers)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(rowsOf(world)).toHaveLength(4);
  });

  test("a number that cancelled signs up again under another spelling: one new subscription, the cancelled one removed once it exists", async () => {
    const cancelledId: string = ObjectID.generate().toString();

    world.subscribers.rows.push({
      _id: cancelledId,
      projectId: WORLD_PROJECT_ID,
      statusPageId: WORLD_PAGE_ID,
      subscriberPhone: "14155550100",
      isUnsubscribed: true,
      isSubscriptionConfirmed: true,
      unsubscribeToken: "5c".repeat(32),
      version: 1,
    });

    const answer: Answer = await signUp("192.0.2.1", {
      subscriberPhone: "+141 555 50100",
    });

    expect(answer.error).toBeUndefined();
    expect(world.subscribers.deletes).toEqual([cancelledId]);
    expect(rowsOf(world)).toHaveLength(1);
    expect(rowsOf(world)[0]!["_id"]).not.toBe(cancelledId);
  });
});

describe("a visitor signing up a webhook, a Slack channel or a Microsoft Teams channel", () => {
  test("one webhook written every way on one page: one subscriber, called once", async () => {
    const answers: Array<Answer> = await signUps(
      ONE_WEBHOOK_WRITTEN_EVERY_WAY.map(
        (subscriberWebhook: string): Record<string, unknown> => {
          return { subscriberWebhook };
        },
      ),
    );

    expect(answers[0]!.error).toBeUndefined();
    expect(refusedWith(answers.slice(1))).toEqual(
      ONE_WEBHOOK_WRITTEN_EVERY_WAY.slice(1).map((): string => {
        return ALREADY_SUBSCRIBED_MESSAGE;
      }),
    );
    expect(rowsOf(world)).toHaveLength(1);
    expect(world.webhookCalls).toHaveBeenCalledTimes(1);
  });

  test("webhooks at other paths or with other queries are other subscribers", async () => {
    const answers: Array<Answer> = await signUps([
      { subscriberWebhook: "https://subscriber.example.net/hook" },
      { subscriberWebhook: "https://subscriber.example.net/hook/" },
      { subscriberWebhook: "https://subscriber.example.net/Hook" },
      { subscriberWebhook: "https://subscriber.example.net/hook?team=a" },
      { subscriberWebhook: "https://subscriber.example.net/hook?team=b" },
      { subscriberWebhook: "http://subscriber.example.net/hook" },
    ]);

    expect(refusedWith(answers)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(rowsOf(world)).toHaveLength(6);
  });

  test("one Slack channel and one Microsoft Teams channel, each written two ways: one subscriber each", async () => {
    const answers: Array<Answer> = await signUps([
      {
        slackIncomingWebhookUrl: SLACK_CHANNEL,
        slackWorkspaceName: "Acme",
      },
      {
        slackIncomingWebhookUrl: SLACK_CHANNEL.replace(
          "hooks.slack.com",
          "HOOKS.Slack.com:443",
        ),
        slackWorkspaceName: "Acme",
      },
      {
        microsoftTeamsIncomingWebhookUrl: TEAMS_CHANNEL,
        microsoftTeamsWorkspaceName: "Acme",
      },
      {
        microsoftTeamsIncomingWebhookUrl: `${TEAMS_CHANNEL}#again`,
        microsoftTeamsWorkspaceName: "Acme",
      },
    ]);

    expect(refusedWith(answers)).toEqual([
      undefined,
      ALREADY_SUBSCRIBED_MESSAGE,
      undefined,
      ALREADY_SUBSCRIBED_MESSAGE,
    ]);
    expect(world.slackPosts).toHaveBeenCalledTimes(1);
    expect(world.teamsPosts).toHaveBeenCalledTimes(1);
  });

  test("two channels of one Slack workspace are two subscribers", async () => {
    const answers: Array<Answer> = await signUps([
      {
        slackIncomingWebhookUrl: SLACK_CHANNEL,
        slackWorkspaceName: "Acme",
      },
      {
        slackIncomingWebhookUrl: `${SLACK_CHANNEL}Other`,
        slackWorkspaceName: "Acme",
      },
    ]);

    expect(refusedWith(answers)).toEqual([undefined, undefined]);
    expect(world.slackPosts).toHaveBeenCalledTimes(2);
  });
});

describe("an email address", () => {
  test("is one subscriber of a page, in capitals or not", async () => {
    const answers: Array<Answer> = await signUps([
      { subscriberEmail: "Subscriber@Example.com" },
      { subscriberEmail: "subscriber@example.com" },
      { subscriberEmail: " SUBSCRIBER@EXAMPLE.COM " },
    ]);

    expect(refusedWith(answers)).toEqual([
      undefined,
      ALREADY_SUBSCRIBED_MESSAGE,
      ALREADY_SUBSCRIBED_MESSAGE,
    ]);
    expect(rowsOf(world)).toHaveLength(1);
    expect(world.emails).toHaveBeenCalledTimes(1);
  });
});

describe("the team adding and changing subscribers", () => {
  test("a number the page has, written another way, is refused, saying the rule", async () => {
    expect((await teamAdd({ subscriberPhone: "+14155550100" })).error).toBe(
      undefined,
    );

    for (const subscriberPhone of ONE_NUMBER_TYPED_EVERY_WAY) {
      const answer: Answer = await teamAdd({ subscriberPhone });

      expect([subscriberPhone, answer.error?.message]).toEqual([
        subscriberPhone,
        CONTACT_ALREADY_SUBSCRIBED_MESSAGE,
      ]);
      expect(answer.error?.code).toBe(ExceptionCode.BadDataException);
    }

    expect(rowsOf(world)).toHaveLength(1);
  });

  test("a webhook the page has, written another way, is refused", async () => {
    expect(
      (await teamAdd({ subscriberWebhook: ONE_WEBHOOK_WRITTEN_EVERY_WAY[0]! }))
        .error,
    ).toBe(undefined);

    for (const subscriberWebhook of ONE_WEBHOOK_WRITTEN_EVERY_WAY.slice(1)) {
      expect([
        subscriberWebhook,
        (await teamAdd({ subscriberWebhook })).error?.message,
      ]).toEqual([subscriberWebhook, CONTACT_ALREADY_SUBSCRIBED_MESSAGE]);
    }

    expect(rowsOf(world)).toHaveLength(1);
  });

  test("a number a visitor signed up is one the team cannot add again, however it is typed", async () => {
    await signUp("192.0.2.1", { subscriberPhone: "0014155550100" });

    expect(
      (await teamAdd({ subscriberPhone: "+141-555-50100" })).error?.message,
    ).toBe(CONTACT_ALREADY_SUBSCRIBED_MESSAGE);
    expect(rowsOf(world)).toHaveLength(1);
  });

  test("an API key is held to it as a teammate is", async () => {
    world.teamProps = teamCaller(undefined, { isApiKey: true });

    expect((await teamAdd({ subscriberPhone: "+14155550100" })).error).toBe(
      undefined,
    );
    expect(
      (await teamAdd({ subscriberPhone: "14155550100" })).error?.message,
    ).toBe(CONTACT_ALREADY_SUBSCRIBED_MESSAGE);
  });

  test("a hundred different numbers added one after another are all added", async () => {
    for (let index: number = 0; index < 100; index++) {
      const answer: Answer = await teamAdd({
        subscriberPhone: `+1415555${String(index).padStart(4, "0")}`,
        sendYouHaveSubscribedMessage: false,
      });

      expect([index, answer.error?.message]).toEqual([index, undefined]);
    }

    expect(rowsOf(world)).toHaveLength(100);
  });

  test("a cancelled subscriber does not hold its number: the team adds it again, and the cancelled one goes", async () => {
    const cancelledId: string = ObjectID.generate().toString();

    world.subscribers.rows.push({
      _id: cancelledId,
      projectId: WORLD_PROJECT_ID,
      statusPageId: WORLD_PAGE_ID,
      subscriberPhone: "141 555 50100",
      isUnsubscribed: true,
      isSubscriptionConfirmed: true,
      unsubscribeToken: "5c".repeat(32),
      version: 1,
    });

    expect((await teamAdd({ subscriberPhone: "+14155550100" })).error).toBe(
      undefined,
    );
    expect(world.subscribers.deletes).toEqual([cancelledId]);
  });

  test("changing a subscriber's number to another subscriber's, however written, is refused; to a new number, saved", async () => {
    await teamAdd({ subscriberPhone: "+14155550100" });
    await teamAdd({ subscriberPhone: "+14155550199" });

    const second: StoredRow = rowsOf(world).find((row: StoredRow): boolean => {
      return String(row["subscriberPhone"]) === "+14155550199";
    })!;

    expect(
      (
        await teamUpdate(String(second["_id"]), {
          subscriberPhone: "(141)555-50100",
        })
      ).error?.message,
    ).toBe(CONTACT_ALREADY_SUBSCRIBED_MESSAGE);
    expect(String(second["subscriberPhone"])).toBe("+14155550199");

    expect(
      (
        await teamUpdate(String(second["_id"]), {
          subscriberPhone: "+14155550177",
        })
      ).error,
    ).toBe(undefined);
    expect(String(second["subscriberPhone"])).toBe("+14155550177");
  });

  test("a subscriber's own number, written another way, is no clash with itself", async () => {
    await teamAdd({ subscriberPhone: "+14155550100" });

    const row: StoredRow = rowsOf(world)[0]!;

    expect(
      (await teamUpdate(String(row["_id"]), { subscriberPhone: "14155550100" }))
        .error,
    ).toBe(undefined);
  });

  test("changing a webhook to another subscriber's, written another way, is refused", async () => {
    await teamAdd({ subscriberWebhook: "https://hooks.example.net/a" });
    await teamAdd({ subscriberWebhook: "https://hooks.example.net/b" });

    const second: StoredRow = rowsOf(world).find((row: StoredRow): boolean => {
      return String(row["subscriberWebhook"]).endsWith("/b");
    })!;

    expect(
      (
        await teamUpdate(String(second["_id"]), {
          subscriberWebhook: "https://HOOKS.example.net:443/a",
        })
      ).error?.message,
    ).toBe(CONTACT_ALREADY_SUBSCRIBED_MESSAGE);
  });

  test("one change giving one number to two subscribers of a page is refused", async () => {
    await teamAdd({ subscriberPhone: "+14155550101" });
    await teamAdd({ subscriberPhone: "+14155550102" });

    await expect(
      StatusPageSubscriberService.updateBy({
        query: { statusPageId: WORLD_PAGE_ID },
        data: { subscriberPhone: "+14155550177" } as never,
        limit: 10,
        skip: 0,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(CONTACT_ALREADY_SUBSCRIBED_MESSAGE);
  });

  test("a change that leaves the contact alone is not asked about it", async () => {
    await teamAdd({ subscriberPhone: "+14155550100" });

    const row: StoredRow = rowsOf(world)[0]!;

    expect(
      (await teamUpdate(String(row["_id"]), { internalNote: "VIP" })).error,
    ).toBe(undefined);
  });
});

describe("decided with the INSERT, under the page's lock", () => {
  test("every create that names a contact is written in a transaction that takes the page's lock and asks the page again", async () => {
    await signUp("192.0.2.1", { subscriberPhone: "+14155550100" });

    expect(world.transactions.opened).toBe(1);
    expect(world.transactions.events[0]).toBe("lock");
    expect(world.transactions.events).toContain("find StatusPageSubscriber");
    expect(
      world.transactions.events[world.transactions.events.length - 1],
    ).toBe("save StatusPageSubscriber");
    expect(
      ProjectLimitLock.getLockKey({
        limitName: `${SUBSCRIBER_CONTACT_LIMIT_NAME}:${WORLD_PAGE_ID}`,
        projectId: new ObjectID(WORLD_PROJECT_ID),
      }),
    ).toContain(WORLD_PAGE_ID);
  });

  /*
   * Another create of the number, written another way, lands after this
   * one's early check and before its INSERT - as when two are sent at the
   * same moment. The check under the lock finds it.
   */
  function anotherCreateLandsInBetween(spelling: string): void {
    const original: (
      onCreate: OnCreate<StatusPageSubscriber>,
    ) => Promise<void> = (
      StatusPageSubscriberService as unknown as {
        onCreatePermitted: (
          onCreate: OnCreate<StatusPageSubscriber>,
        ) => Promise<void>;
      }
    ).onCreatePermitted.bind(StatusPageSubscriberService);

    jest
      .spyOn(
        StatusPageSubscriberService as unknown as {
          onCreatePermitted: (
            onCreate: OnCreate<StatusPageSubscriber>,
          ) => Promise<void>;
        },
        "onCreatePermitted",
      )
      .mockImplementationOnce(
        async (onCreate: OnCreate<StatusPageSubscriber>): Promise<void> => {
          world.subscribers.rows.push({
            _id: ObjectID.generate().toString(),
            projectId: WORLD_PROJECT_ID,
            statusPageId: WORLD_PAGE_ID,
            subscriberPhone: spelling,
            isUnsubscribed: false,
            isSubscriptionConfirmed: false,
            unsubscribeToken: "5c".repeat(32),
            version: 1,
          });

          await original(onCreate);
        },
      );
  }

  test("a visitor's sign-up of a number another create wrote in the meantime is refused, sends nothing and costs the number nothing", async () => {
    anotherCreateLandsInBetween("141.555.50100");

    const answer: Answer = await signUp("192.0.2.1", {
      subscriberPhone: "+14155550100",
    });

    expect(answer.error?.message).toBe(ALREADY_SUBSCRIBED_MESSAGE);
    expect(rowsOf(world)).toHaveLength(1);
    expect(world.texts).not.toHaveBeenCalled();
    expect(
      signUpsCountedFor(PublicMessageRateLimit.forPhone("+14155550100")),
    ).toBe(0);
  });

  test("the team's create of a number another create wrote in the meantime is refused, and its count given back", async () => {
    anotherCreateLandsInBetween("141.555.50100");

    const answer: Answer = await teamAdd({
      subscriberPhone: "+14155550100",
      sendYouHaveSubscribedMessage: true,
    });

    expect(answer.error?.message).toBe(CONTACT_ALREADY_SUBSCRIBED_MESSAGE);
    expect(rowsOf(world)).toHaveLength(1);
    expect(world.texts).not.toHaveBeenCalled();
    expect(
      signUpsCountedFor(PublicMessageRateLimit.forPhone("+14155550100")),
    ).toBe(0);
  });
});

/*
 * A cancelled subscription keeps its contact, and a page may meanwhile have
 * taken that contact again - the team changing another subscriber to it, or
 * a number subscribed under another spelling before the page took each
 * contact once. Turning the cancelled one back on - the team's Status, the
 * API, a workflow, the visitor's own manage page - would leave the page two
 * active subscriptions of one contact, each sent every notification. So it
 * is refused, as a create of the contact is.
 */
describe("turning a cancelled subscription back on", () => {
  const MANAGE_UPDATE_ROUTE: string =
    "/status-page/update-subscription/:statusPageId/:subscriberId/:token";

  // A subscriber of the page, stored as a row of its own.
  function stored(row: StoredRow): StoredRow {
    const subscriber: StoredRow = {
      _id: ObjectID.generate().toString(),
      projectId: WORLD_PROJECT_ID,
      statusPageId: WORLD_PAGE_ID,
      isUnsubscribed: false,
      isSubscriptionConfirmed: true,
      unsubscribeToken: `${"5c".repeat(28)}${String(world.subscribers.rows.length).padStart(8, "0")}`,
      version: 1,
      ...row,
    };

    world.subscribers.rows.push(subscriber);

    return subscriber;
  }

  // The visitor's own manage page, saving a change.
  async function manageAndSave(
    subscriber: StoredRow,
    data: JSONObject,
  ): Promise<Answer> {
    return await callRoute("put", MANAGE_UPDATE_ROUTE, {
      params: {
        statusPageId: WORLD_PAGE_ID,
        subscriberId: String(subscriber["_id"]),
        token: String(subscriber["unsubscribeToken"]),
      },
      body: { data: data },
    });
  }

  test("by the team, where another subscriber of the page has its number under another spelling: refused, saying the rule, and it stays cancelled", async () => {
    const cancelled: StoredRow = stored({
      subscriberPhone: "+14155550100",
      isUnsubscribed: true,
    });
    stored({ subscriberPhone: "141 555 50100" });

    const answer: Answer = await teamUpdate(String(cancelled["_id"]), {
      isUnsubscribed: false,
    });

    expect(answer.error?.message).toBe(CONTACT_ALREADY_SUBSCRIBED_MESSAGE);
    expect(cancelled["isUnsubscribed"]).toBe(true);
  });

  test("by an API key, held to it as a teammate is", async () => {
    world.teamProps = teamCaller([Permission.ProjectMember], {
      isApiKey: true,
    });

    const cancelled: StoredRow = stored({
      subscriberPhone: "+14155550100",
      isUnsubscribed: true,
    });
    stored({ subscriberPhone: "0014155550100" });

    expect(
      (await teamUpdate(String(cancelled["_id"]), { isUnsubscribed: false }))
        .error?.message,
    ).toBe(CONTACT_ALREADY_SUBSCRIBED_MESSAGE);
    expect(cancelled["isUnsubscribed"]).toBe(true);
  });

  test("by the visitor from its own manage link: told they are subscribed already, and nothing changes", async () => {
    const cancelled: StoredRow = stored({
      subscriberPhone: "+14155550100",
      isUnsubscribed: true,
    });
    stored({ subscriberPhone: "(141)555-50100" });

    const answer: Answer = await manageAndSave(cancelled, {
      isSubscribedToAllResources: true,
    });

    expect(answer.error?.message).toBe(ALREADY_SUBSCRIBED_MESSAGE);
    expect(cancelled["isUnsubscribed"]).toBe(true);
    expect(world.texts).not.toHaveBeenCalled();
  });

  test("a webhook the page has under another spelling: refused", async () => {
    const cancelled: StoredRow = stored({
      subscriberWebhook: "https://hooks.example.net/status",
      isUnsubscribed: true,
    });
    stored({ subscriberWebhook: "https://HOOKS.example.net:443/status#x" });

    expect(
      (await teamUpdate(String(cancelled["_id"]), { isUnsubscribed: false }))
        .error?.message,
    ).toBe(CONTACT_ALREADY_SUBSCRIBED_MESSAGE);
    expect(cancelled["isUnsubscribed"]).toBe(true);
  });

  test("an email address the page has: refused", async () => {
    const cancelled: StoredRow = stored({
      subscriberEmail: "reader@example.com",
      isUnsubscribed: true,
    });
    stored({ subscriberEmail: "reader@example.com" });

    expect(
      (await teamUpdate(String(cancelled["_id"]), { isUnsubscribed: false }))
        .error?.message,
    ).toBe(CONTACT_ALREADY_SUBSCRIBED_MESSAGE);
    expect(cancelled["isUnsubscribed"]).toBe(true);
  });

  test("one update turning on two cancelled subscriptions of one number: refused, and both stay cancelled", async () => {
    const first: StoredRow = stored({
      subscriberPhone: "+14155550100",
      isUnsubscribed: true,
    });
    const second: StoredRow = stored({
      subscriberPhone: "14155550100",
      isUnsubscribed: true,
    });

    await expect(
      StatusPageSubscriberService.updateBy({
        query: { statusPageId: WORLD_PAGE_ID },
        data: { isUnsubscribed: false } as never,
        limit: 10,
        skip: 0,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(CONTACT_ALREADY_SUBSCRIBED_MESSAGE);

    expect(first["isUnsubscribed"]).toBe(true);
    expect(second["isUnsubscribed"]).toBe(true);
  });

  test("whose number nobody else on the page has: turned on, by the team and by the visitor alike", async () => {
    const byTeam: StoredRow = stored({
      subscriberPhone: "+14155550100",
      isUnsubscribed: true,
    });
    const byVisitor: StoredRow = stored({
      subscriberPhone: "+14155550199",
      isUnsubscribed: true,
    });
    // The number on another page is that page's own.
    stored({
      subscriberPhone: "14155550100",
      statusPageId: pageIdOf(1),
    });

    expect(
      (await teamUpdate(String(byTeam["_id"]), { isUnsubscribed: false }))
        .error,
    ).toBeUndefined();
    expect(byTeam["isUnsubscribed"]).toBe(false);

    expect(
      (await manageAndSave(byVisitor, { isSubscribedToAllResources: true }))
        .error,
    ).toBeUndefined();
    expect(byVisitor["isUnsubscribed"]).toBe(false);
  });

  test("whose number only another cancelled subscription of the page has: turned on", async () => {
    const cancelled: StoredRow = stored({
      subscriberPhone: "+14155550100",
      isUnsubscribed: true,
    });
    stored({ subscriberPhone: "14155550100", isUnsubscribed: true });

    expect(
      (await teamUpdate(String(cancelled["_id"]), { isUnsubscribed: false }))
        .error,
    ).toBeUndefined();
    expect(cancelled["isUnsubscribed"]).toBe(false);
  });

  test("with a new number nobody has, in the same change: turned on with it", async () => {
    const cancelled: StoredRow = stored({
      subscriberPhone: "+14155550100",
      isUnsubscribed: true,
    });
    stored({ subscriberPhone: "14155550100" });

    expect(
      (
        await teamUpdate(String(cancelled["_id"]), {
          isUnsubscribed: false,
          subscriberPhone: "+14155550177",
        })
      ).error,
    ).toBeUndefined();
    expect(cancelled["isUnsubscribed"]).toBe(false);
    expect(String(cancelled["subscriberPhone"])).toBe("+14155550177");
  });

  test("a subscription that is on already is never asked: two subscribed under two spellings from before still save their choices", async () => {
    const first: StoredRow = stored({ subscriberPhone: "+14155550100" });
    const second: StoredRow = stored({ subscriberPhone: "14155550100" });

    // The manage page sends Unsubscribed off with every change it saves.
    expect(
      (await manageAndSave(first, { isSubscribedToAllResources: true })).error,
    ).toBeUndefined();
    expect(
      (await teamUpdate(String(second["_id"]), { isUnsubscribed: false }))
        .error,
    ).toBeUndefined();
    expect(
      (await teamUpdate(String(second["_id"]), { internalNote: "VIP" })).error,
    ).toBeUndefined();
  });

  test("cancelling is never asked about the contact", async () => {
    const first: StoredRow = stored({ subscriberPhone: "+14155550100" });
    stored({ subscriberPhone: "14155550100" });

    expect(
      (await teamUpdate(String(first["_id"]), { isUnsubscribed: true })).error,
    ).toBeUndefined();
    expect(first["isUnsubscribed"]).toBe(true);
  });
});
