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
 * WHAT THE TEAM SENDS TO A SUBSCRIBER IT ADDS IS COUNTED PER CONTACT.
 *
 * A subscriber the team adds - Add Subscriber, Add in Bulk, an API key, a
 * workflow - is sent a message as it is created: the email that asks it to
 * confirm, or the "you have been subscribed" message on its channel, from
 * this installation's mail server or SMS sender. Nothing counted them, so on
 * a shared installation any project anyone may sign up for - a free one
 * included - could add and remove one address over and over and send it
 * this installation's messages as often as it liked.
 *
 * Now each contact the create messages is counted, on the same counter as
 * the sign-ups of that contact on every status page: ten in an hour, then
 * the create is refused with 429 and what to do instead - before anything is
 * written or sent. Only what is sent counts: a subscriber added without a
 * message never does, and a create that ends with nothing sent gives its
 * count back. The team itself is never counted, so adding many subscribers
 * at once goes on. Driven through the real routes (SubscriberWorld).
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

import Redis from "../../../Server/Infrastructure/Redis";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import PublicMessageRateLimit, {
  PublicMessageChannel,
  PublicMessageContact,
  PublicMessageKind,
} from "../../../Server/Utils/RateLimit/PublicMessageRateLimit";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import Email from "../../../Types/Email";
import Phone from "../../../Types/Phone";
import URL from "../../../Types/API/URL";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { StoredRow } from "../TestingUtils/InMemoryRepository";
import {
  Answer,
  SubscriberWorld,
  WORLD_PAGE_COUNT,
  WORLD_PAGE_ID,
  WORLD_PROJECT_ID,
  pageIdOf,
  registerSubscriberRoutes,
  rowsOf,
  setUpSubscriberWorld,
  signUp,
  teamAdd,
  teamCaller,
  teamDelete,
  teamUpdate,
} from "./SubscriberWorld";

type MockedFn = ReturnType<typeof jest.fn>;

const ADDRESS: string = "someone@example.com";
const PHONE: string = "+14155550100";
const WEBHOOK: string = "https://hooks.example.net/in";
const SLACK: string = "https://hooks.slack.com/services/T0000/B0000/AbCdEf";
const TEAMS: string =
  "https://acme.webhook.office.com/webhookb2/abc@def/IncomingWebhook/1/2";

// "Ask them to confirm first": the confirmation email.
const ASK_TO_CONFIRM: JSONObject = {
  isSubscriptionConfirmed: false,
  sendYouHaveSubscribedMessage: false,
};

// "Subscribe them now": confirmed, and sent nothing.
const SUBSCRIBE_NOW: JSONObject = {
  isSubscriptionConfirmed: true,
  sendYouHaveSubscribedMessage: false,
};

// Tell them: the "you have been subscribed" message on the channel.
const TELL_THEM: JSONObject = {
  isSubscriptionConfirmed: true,
  sendYouHaveSubscribedMessage: true,
};

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

function refusalFor(contactName: string): string {
  return `Too many subscription messages were sent to ${contactName} in the last hour. Please try again later, or add it without a message.`;
}

function expectTooMany(answer: Answer, contactName: string): void {
  expect(answer.error?.code).toBe(ExceptionCode.TooManyRequestsException);
  expect(answer.error?.message).toBe(refusalFor(contactName));
}

// The subscription messages counted for a contact in this hour.
function countedFor(contact: PublicMessageContact): number {
  return world.redis.count(
    PublicMessageRateLimit.getContactCounterKey({
      counterName: PublicMessageKind.StatusPageSignUp,
      contact: contact,
    }),
  );
}

/*
 * The team adds `data`, then removes what it added: `rounds` times over.
 * The answer of each add, in order.
 */
async function addAndRemove(
  rounds: number,
  data: JSONObject,
): Promise<Array<Answer>> {
  const answers: Array<Answer> = [];

  for (let round: number = 0; round < rounds; round++) {
    const answer: Answer = await teamAdd(data);
    answers.push(answer);

    for (const row of [...rowsOf(world)]) {
      await teamDelete(String(row["_id"]));
    }
  }

  return answers;
}

function accepted(answers: Array<Answer>): number {
  return answers.filter((answer: Answer): boolean => {
    return !answer.error;
  }).length;
}

describe("the team adding one contact over and over", () => {
  test("an address asked to confirm, added and removed fifty times: ten confirmation emails, then refused", async () => {
    const answers: Array<Answer> = await addAndRemove(50, {
      subscriberEmail: ADDRESS,
      ...ASK_TO_CONFIRM,
    });

    // Before: fifty confirmation emails to someone who never asked.
    expect(accepted(answers)).toBe(10);
    expect(world.emails).toHaveBeenCalledTimes(10);
    expectTooMany(answers[10]!, "this email address");
    expectTooMany(answers[49]!, "this email address");
    /*
     * The refused adds count too, as a visitor's refused sign-ups do: the
     * address stays over its limit until the hour is out.
     */
    expect(countedFor(PublicMessageRateLimit.forEmail(ADDRESS))).toBe(50);
  });

  test("an address told it is subscribed: ten emails, then refused", async () => {
    const answers: Array<Answer> = await addAndRemove(15, {
      subscriberEmail: ADDRESS,
      ...TELL_THEM,
    });

    expect(accepted(answers)).toBe(10);
    expect(world.emails).toHaveBeenCalledTimes(10);
    expectTooMany(answers[10]!, "this email address");
  });

  test.each([
    {
      name: "a phone number",
      contact: { subscriberPhone: PHONE },
      contactName: "this phone number",
      sent: (): MockedFn => {
        return world.texts;
      },
    },
    {
      name: "a webhook",
      contact: { subscriberWebhook: WEBHOOK },
      contactName: "this webhook",
      sent: (): MockedFn => {
        return world.webhookCalls;
      },
    },
    {
      name: "a Slack channel",
      contact: { slackIncomingWebhookUrl: SLACK, slackWorkspaceName: "Acme" },
      contactName: "this Slack channel",
      sent: (): MockedFn => {
        return world.slackPosts;
      },
    },
    {
      name: "a Microsoft Teams channel",
      contact: {
        microsoftTeamsIncomingWebhookUrl: TEAMS,
        microsoftTeamsWorkspaceName: "Acme",
      },
      contactName: "this Microsoft Teams channel",
      sent: (): MockedFn => {
        return world.teamsPosts;
      },
    },
  ])(
    "$name told it is subscribed: ten messages, then refused, naming it",
    async ({
      contact,
      contactName,
      sent,
    }: {
      contact: JSONObject;
      contactName: string;
      sent: () => MockedFn;
    }) => {
      const answers: Array<Answer> = await addAndRemove(13, {
        ...contact,
        ...TELL_THEM,
      });

      expect(accepted(answers)).toBe(10);
      expect(sent()).toHaveBeenCalledTimes(10);
      expectTooMany(answers[10]!, contactName);
    },
  );

  test("a refused add writes nothing and sends nothing", async () => {
    await addAndRemove(10, { subscriberEmail: ADDRESS, ...ASK_TO_CONFIRM });

    const insertsBefore: number = world.subscribers.inserts.length;
    const answer: Answer = await teamAdd({
      subscriberEmail: ADDRESS,
      ...ASK_TO_CONFIRM,
    });

    expectTooMany(answer, "this email address");
    expect(world.subscribers.inserts).toHaveLength(insertsBefore);
    expect(rowsOf(world)).toHaveLength(0);
    expect(world.emails).toHaveBeenCalledTimes(10);
    // Not opened: the refusal comes before the INSERT's transaction.
    expect(world.transactions.opened).toBe(10);
  });

  test("an hour on, the contact may be messaged again", async () => {
    await addAndRemove(11, { subscriberEmail: ADDRESS, ...ASK_TO_CONFIRM });

    world.advance(60 * 60 * 1000);

    expect(
      (await teamAdd({ subscriberEmail: ADDRESS, ...ASK_TO_CONFIRM })).error,
    ).toBeUndefined();
  });

  test("spelling the contact another way does not buy it another ten", async () => {
    const spellings: Array<string> = [
      "+14155550100",
      "14155550100",
      "0014155550100",
      "+141 555 50100",
    ];

    const answers: Array<Answer> = [];

    for (let round: number = 0; round < 12; round++) {
      answers.push(
        (
          await addAndRemove(1, {
            subscriberPhone: spellings[round % spellings.length]!,
            ...TELL_THEM,
          })
        )[0]!,
      );
    }

    expect(accepted(answers)).toBe(10);
    expect(world.texts).toHaveBeenCalledTimes(10);
  });
});

describe("what is never counted", () => {
  test("a subscriber added without a message, past the contact's limit too", async () => {
    await addAndRemove(10, { subscriberEmail: ADDRESS, ...ASK_TO_CONFIRM });

    const answer: Answer = await teamAdd({
      subscriberEmail: ADDRESS,
      ...SUBSCRIBE_NOW,
    });

    expect(answer.error).toBeUndefined();
    expect(rowsOf(world)).toHaveLength(1);
    expect(world.emails).toHaveBeenCalledTimes(10);
    expect(countedFor(PublicMessageRateLimit.forEmail(ADDRESS))).toBe(10);
  });

  test("the team itself: two hundred different addresses added one after another are all added and asked to confirm", async () => {
    for (let index: number = 0; index < 200; index++) {
      const answer: Answer = await teamAdd({
        subscriberEmail: `customer${index}@example.com`,
        ...ASK_TO_CONFIRM,
      });

      expect([index, answer.error?.message]).toEqual([index, undefined]);
    }

    expect(rowsOf(world)).toHaveLength(200);
    expect(world.emails).toHaveBeenCalledTimes(200);
  });

  test("a change to a subscriber: it sends nothing", async () => {
    await teamAdd({ subscriberEmail: ADDRESS, ...TELL_THEM });

    const row: StoredRow = rowsOf(world)[0]!;

    for (let round: number = 0; round < 20; round++) {
      expect(
        (await teamUpdate(String(row["_id"]), { internalNote: `${round}` }))
          .error,
      ).toBeUndefined();
    }

    expect(countedFor(PublicMessageRateLimit.forEmail(ADDRESS))).toBe(1);
  });

  test("only a hash of the contact is written to the counter", async () => {
    await teamAdd({ subscriberEmail: ADDRESS, ...ASK_TO_CONFIRM });
    await teamAdd({ subscriberPhone: PHONE, ...TELL_THEM });

    for (const key of world.redis.keys()) {
      expect(key).not.toContain("someone");
      expect(key).not.toContain("example");
      expect(key).not.toContain("4155550100");
    }

    // And nothing keyed on the team: no address of a caller, no project.
    expect(world.redis.keysHolding(":c:")).toEqual([]);
    expect(world.redis.keysHolding(WORLD_PROJECT_ID)).toEqual([]);
  });
});

describe("one count with the visitors' sign-ups of the contact", () => {
  test("an address signed up on ten pages by visitors this hour is not one the team can message", async () => {
    for (let index: number = 0; index < 10; index++) {
      expect(
        (
          await signUp(
            `192.0.2.${index + 1}`,
            { subscriberEmail: ADDRESS },
            pageIdOf(index + 1),
          )
        ).error,
      ).toBeUndefined();
    }

    expectTooMany(
      await teamAdd({ subscriberEmail: ADDRESS, ...ASK_TO_CONFIRM }),
      "this email address",
    );

    // Without a message, the team still adds it.
    expect(
      (await teamAdd({ subscriberEmail: ADDRESS, ...SUBSCRIBE_NOW })).error,
    ).toBeUndefined();
  });

  test("a number the team messaged ten times this hour is not one a visitor can sign up", async () => {
    await addAndRemove(10, { subscriberPhone: PHONE, ...TELL_THEM });

    const answer: Answer = await signUp(
      "192.0.2.77",
      { subscriberPhone: PHONE },
      pageIdOf(WORLD_PAGE_COUNT - 1),
    );

    expect(answer.error?.code).toBe(ExceptionCode.TooManyRequestsException);
    expect(answer.error?.message).toBe(
      "Too many sign-ups for this phone number in the last hour. Please try again later.",
    );
  });
});

describe("a create that ends with nothing sent gives the count back", () => {
  test("one whose INSERT fails", async () => {
    (world.subscribers.repository.save as MockedFn).mockRejectedValueOnce(
      new Error("connection lost"),
    );

    const answer: Answer = await teamAdd({
      subscriberEmail: ADDRESS,
      ...ASK_TO_CONFIRM,
    });

    expect(answer.error).toBeDefined();
    expect(world.emails).not.toHaveBeenCalled();
    expect(countedFor(PublicMessageRateLimit.forEmail(ADDRESS))).toBe(0);
  });

  test("one refused under the page's lock: the contact is there already", async () => {
    await teamAdd({ subscriberEmail: ADDRESS, ...SUBSCRIBE_NOW });

    // Another spelling's subscription is hidden from the early check only.
    const findBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      StatusPageSubscriberService,
      "findBy",
    );
    findBy.mockResolvedValueOnce([] as never);

    const answer: Answer = await teamAdd({
      subscriberEmail: ADDRESS,
      ...ASK_TO_CONFIRM,
    });

    expect(answer.error?.code).toBe(ExceptionCode.BadDataException);
    expect(world.emails).not.toHaveBeenCalled();
    expect(countedFor(PublicMessageRateLimit.forEmail(ADDRESS))).toBe(0);
  });

  test("one whose messages went out keeps its count, even when it fails afterwards", async () => {
    type CreateSuccess = (...args: Array<unknown>) => Promise<unknown>;

    const hooks: { onCreateSuccess: CreateSuccess } =
      StatusPageSubscriberService as unknown as {
        onCreateSuccess: CreateSuccess;
      };
    const original: CreateSuccess = hooks.onCreateSuccess.bind(
      StatusPageSubscriberService,
    );

    jest
      .spyOn(hooks, "onCreateSuccess")
      .mockImplementationOnce(
        async (...args: Array<unknown>): Promise<unknown> => {
          await original(...args);
          throw new Error("failed after sending");
        },
      );

    const answer: Answer = await teamAdd({
      subscriberEmail: ADDRESS,
      ...ASK_TO_CONFIRM,
    });

    expect(answer.error).toBeDefined();
    expect(world.emails).toHaveBeenCalledTimes(1);
    expect(countedFor(PublicMessageRateLimit.forEmail(ADDRESS))).toBe(1);
  });
});

describe("every way the team adds a subscriber is held to it", () => {
  test("an API key", async () => {
    world.teamProps = teamCaller([Permission.ProjectMember], {
      isApiKey: true,
    });

    const answers: Array<Answer> = await addAndRemove(11, {
      subscriberEmail: ADDRESS,
      ...ASK_TO_CONFIRM,
    });

    expect(answers[0]!.error?.message).toBeUndefined();
    expect(accepted(answers)).toBe(10);
    expectTooMany(answers[10]!, "this email address");
  });

  test("a status page admin", async () => {
    world.teamProps = teamCaller([Permission.StatusPageAdmin]);

    const answers: Array<Answer> = await addAndRemove(11, {
      subscriberEmail: ADDRESS,
      ...ASK_TO_CONFIRM,
    });

    expect(accepted(answers)).toBe(10);
  });

  test("a create through the service - a workflow, an import - that sends", async () => {
    for (let round: number = 0; round < 11; round++) {
      const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
      subscriber.statusPageId = new ObjectID(WORLD_PAGE_ID);
      subscriber.projectId = new ObjectID(WORLD_PROJECT_ID);
      subscriber.subscriberEmail = new Email(ADDRESS);
      subscriber.isSubscriptionConfirmed = false;

      const created: Promise<StatusPageSubscriber> =
        StatusPageSubscriberService.create({
          data: subscriber,
          props: { isRoot: true },
        });

      if (round < 10) {
        await created;
        world.subscribers.rows = [];
      } else {
        await expect(created).rejects.toThrow(refusalFor("this email address"));
      }
    }
  });
});

/*
 * Which contacts a create is counted for: the ones it sends a message to,
 * read from the subscriber as onBeforeCreate leaves it. A flag that is not
 * set is the column's default - told - so a create that leaves it out is
 * counted for the message it will be sent.
 */
describe("the contacts a create is counted for", () => {
  const email: Email = new Email(ADDRESS);
  const phone: Phone = new Phone(PHONE);

  const contactOf: Record<string, PublicMessageContact> = {
    email: PublicMessageRateLimit.forEmail(email),
    phone: PublicMessageRateLimit.forPhone(phone),
    slack: PublicMessageRateLimit.forWebhook(
      PublicMessageChannel.Slack,
      URL.fromString(SLACK),
    ),
    teams: PublicMessageRateLimit.forWebhook(
      PublicMessageChannel.MicrosoftTeams,
      URL.fromString(TEAMS),
    ),
    webhook: PublicMessageRateLimit.forWebhook(
      PublicMessageChannel.Webhook,
      URL.fromString(WEBHOOK),
    ),
  };

  test.each([
    [
      "an address subscribed now and told nothing: none",
      {
        subscriberEmail: email,
        isSubscriptionConfirmed: true,
        sendYouHaveSubscribedMessage: false,
      },
      [],
    ],
    [
      "an address subscribed now, the flag left out: it is told",
      { subscriberEmail: email, isSubscriptionConfirmed: true },
      ["email"],
    ],
    [
      "an address asked to confirm: its confirmation",
      {
        subscriberEmail: email,
        isSubscriptionConfirmed: false,
        sendYouHaveSubscribedMessage: false,
      },
      ["email"],
    ],
    [
      "a number added and told nothing: none",
      {
        subscriberPhone: phone,
        isSubscriptionConfirmed: true,
        sendYouHaveSubscribedMessage: false,
      },
      [],
    ],
    [
      "a number added, the flag left out: it is told",
      { subscriberPhone: phone, isSubscriptionConfirmed: true },
      ["phone"],
    ],
    [
      "a number to confirm: its confirmation",
      {
        subscriberPhone: phone,
        isSubscriptionConfirmed: false,
        sendYouHaveSubscribedMessage: false,
      },
      ["phone"],
    ],
    [
      "a Slack channel, the flag left out: it is told",
      {
        slackIncomingWebhookUrl: URL.fromString(SLACK),
        isSubscriptionConfirmed: true,
      },
      ["slack"],
    ],
    [
      "a Slack channel told nothing: none",
      {
        slackIncomingWebhookUrl: URL.fromString(SLACK),
        isSubscriptionConfirmed: true,
        sendYouHaveSubscribedMessage: false,
      },
      [],
    ],
    [
      "a Microsoft Teams channel told",
      {
        microsoftTeamsIncomingWebhookUrl: URL.fromString(TEAMS),
        isSubscriptionConfirmed: true,
        sendYouHaveSubscribedMessage: true,
      },
      ["teams"],
    ],
    [
      "a webhook, the flag left out: it is told",
      {
        subscriberWebhook: URL.fromString(WEBHOOK),
        isSubscriptionConfirmed: true,
      },
      ["webhook"],
    ],
    [
      "every channel, subscribed now and told nothing: none",
      {
        subscriberEmail: email,
        subscriberPhone: phone,
        slackIncomingWebhookUrl: URL.fromString(SLACK),
        microsoftTeamsIncomingWebhookUrl: URL.fromString(TEAMS),
        subscriberWebhook: URL.fromString(WEBHOOK),
        isSubscriptionConfirmed: true,
        sendYouHaveSubscribedMessage: false,
      },
      [],
    ],
  ] as Array<[string, Partial<StatusPageSubscriber>, Array<string>]>)(
    "%s",
    (
      _label: string,
      subscriber: Partial<StatusPageSubscriber>,
      counted: Array<string>,
    ) => {
      expect(
        StatusPageSubscriberService.getContactsMessagedOnCreate(subscriber),
      ).toEqual(
        counted.map((channel: string): PublicMessageContact => {
          return contactOf[channel] as PublicMessageContact;
        }),
      );
    },
  );
});

describe("while the counter cannot be reached", () => {
  test("the team's adds go on, texts too: the team is signed in, and pays for what it sends", async () => {
    (Redis.isConnected as unknown as MockedFn).mockReturnValue(false);

    const answers: Array<Answer> = await addAndRemove(15, {
      subscriberPhone: PHONE,
      ...TELL_THEM,
    });

    expect(accepted(answers)).toBe(15);
    expect(world.texts).toHaveBeenCalledTimes(15);
  });
});
