import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT THE TEAM SENDS TO A CONTACT IT NAMES IS COUNTED PER CONTACT
 * (PublicMessageRateLimit.assertTeamMaySend).
 *
 * A project's team names contacts too - the subscribers it adds to a status
 * page, and the people it invites, to its project or to a private status
 * page - and each is sent this installation's messages. assertTeamMaySend
 * counts each contact a send names, and nothing about the team: no caller's
 * address, no project, so a team adding its own subscribers in bulk is never
 * held back by how many it adds. A subscriber the team adds is counted on
 * the same counter as the sign-ups of that contact (one count of every
 * subscription message a contact is sent, whoever subscribed it), an
 * invitation on a counter of its own. This suite holds the limiter itself,
 * against a counter store that counts the way Redis does; the services that
 * ask it are driven in TeamSubscriberMessageLimits.test.ts and
 * InvitationMessageLimits.test.ts.
 */

jest.mock("../../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import Redis from "../../../../Server/Infrastructure/Redis";
import logger from "../../../../Server/Utils/Logger";
import { ExpressRequest } from "../../../../Server/Utils/Express";
import PublicMessageRateLimit, {
  PublicMessageChannel,
  PublicMessageContact,
  PublicMessageKind,
  PublicMessageRateLimitException,
  PublicMessageSendPermit,
  TeamMessageKind,
} from "../../../../Server/Utils/RateLimit/PublicMessageRateLimit";
import FakeCounterRedis from "../../TestingUtils/Redis/FakeCounterRedis";
import ExceptionCode from "../../../../Types/Exception/ExceptionCode";

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;
const loggerWarnMock: MockedFn = logger.warn as unknown as MockedFn;

const EMAIL: PublicMessageContact = PublicMessageRateLimit.forEmail(
  "someone@example.com",
);
const PHONE: PublicMessageContact =
  PublicMessageRateLimit.forPhone("+14155550100");
const WEBHOOK: PublicMessageContact = PublicMessageRateLimit.forWebhook(
  PublicMessageChannel.Webhook,
  "https://hooks.example.net/in",
);
const SLACK: PublicMessageContact = PublicMessageRateLimit.forWebhook(
  PublicMessageChannel.Slack,
  "https://hooks.slack.com/services/T/B/x",
);
const TEAMS: PublicMessageContact = PublicMessageRateLimit.forWebhook(
  PublicMessageChannel.MicrosoftTeams,
  "https://acme.webhook.office.com/webhookb2/x",
);

let redis: FakeCounterRedis;
let currentTime: number;
let testIndex: number = 0;

beforeEach(() => {
  jest.clearAllMocks();
  redis = new FakeCounterRedis();
  getClientMock.mockReturnValue(redis);
  isConnectedMock.mockReturnValue(true);

  testIndex++;
  currentTime = Date.UTC(2034, 0, 1) + testIndex * 24 * 60 * 60 * 1000;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return currentTime;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function outcomeOf(
  kind: TeamMessageKind,
  contacts: Array<PublicMessageContact>,
): Promise<"sent" | Error> {
  try {
    await PublicMessageRateLimit.assertTeamMaySend({
      kind: kind,
      contacts: contacts,
    });
    return "sent";
  } catch (err) {
    return err as Error;
  }
}

async function sendsBeforeRefusal(
  kind: TeamMessageKind,
  contacts: Array<PublicMessageContact>,
  attempts: number = 30,
): Promise<number> {
  let sent: number = 0;

  for (let attempt: number = 0; attempt < attempts; attempt++) {
    if ((await outcomeOf(kind, contacts)) === "sent") {
      sent++;
    }
  }

  return sent;
}

function counterKey(
  counterName: string,
  contact: PublicMessageContact,
): string {
  return PublicMessageRateLimit.getContactCounterKey({
    counterName: counterName,
    contact: contact,
  });
}

describe("the limits", () => {
  test("a subscriber the team adds is held to the sign-ups' ten a contact an hour; an invitation to ten of its own", () => {
    const config: ReturnType<typeof PublicMessageRateLimit.getConfig> =
      PublicMessageRateLimit.getConfig();

    expect(config.teamKinds[TeamMessageKind.SubscriberAdded]).toEqual({
      perContactLimit:
        config.kinds[PublicMessageKind.StatusPageSignUp].perContactLimit,
    });
    expect(
      config.teamKinds[TeamMessageKind.SubscriberAdded].perContactLimit,
    ).toBe(10);
    expect(config.teamKinds[TeamMessageKind.Invitation]).toEqual({
      perContactLimit: 10,
    });
    expect(config.contactWindowSeconds).toBe(60 * 60);
  });

  test("a copy: changing what getConfig hands back changes nothing", () => {
    const config: ReturnType<typeof PublicMessageRateLimit.getConfig> =
      PublicMessageRateLimit.getConfig();
    config.teamKinds[TeamMessageKind.Invitation].perContactLimit = 1;

    expect(
      PublicMessageRateLimit.getConfig().teamKinds[TeamMessageKind.Invitation]
        .perContactLimit,
    ).toBe(10);
  });

  test("the operator sets them through the environment of the app, and nonsense leaves the defaults", () => {
    // The limiter as a fresh load reads it, with the environment as it is now.
    const freshConfig: () => ReturnType<
      typeof PublicMessageRateLimit.getConfig
    > = (): ReturnType<typeof PublicMessageRateLimit.getConfig> => {
      let config: unknown = undefined;

      jest.isolateModules(() => {
        config = (
          jest.requireActual(
            "../../../../Server/Utils/RateLimit/PublicMessageRateLimit",
          ) as { default: typeof PublicMessageRateLimit }
        ).default.getConfig();
      });

      return config as ReturnType<typeof PublicMessageRateLimit.getConfig>;
    };

    const invitations: string =
      "PUBLIC_MESSAGE_RATE_LIMIT_INVITATIONS_PER_CONTACT";
    const signUps: string =
      "PUBLIC_MESSAGE_RATE_LIMIT_STATUS_PAGE_SIGN_UPS_PER_CONTACT";

    try {
      process.env[invitations] = "3";
      process.env[signUps] = "4";

      const config: ReturnType<typeof PublicMessageRateLimit.getConfig> =
        freshConfig();

      expect(config.teamKinds[TeamMessageKind.Invitation].perContactLimit).toBe(
        3,
      );
      // A subscriber the team adds follows the sign-ups' number.
      expect(
        config.teamKinds[TeamMessageKind.SubscriberAdded].perContactLimit,
      ).toBe(4);
      expect(
        config.kinds[PublicMessageKind.StatusPageSignUp].perContactLimit,
      ).toBe(4);

      for (const ignored of ["0", "-5", "many"]) {
        process.env[invitations] = ignored;

        expect([
          ignored,
          freshConfig().teamKinds[TeamMessageKind.Invitation].perContactLimit,
        ]).toEqual([ignored, 10]);
      }
    } finally {
      delete process.env[invitations];
      delete process.env[signUps];
    }
  });
});

describe("counted per contact, never per team", () => {
  test.each([
    ["an email address", EMAIL, "this email address"],
    ["a phone number", PHONE, "this phone number"],
    ["a webhook", WEBHOOK, "this webhook"],
    ["a Slack channel", SLACK, "this Slack channel"],
    ["a Microsoft Teams channel", TEAMS, "this Microsoft Teams channel"],
  ])(
    "%s added as a subscriber: ten in an hour, then refused with 429, naming it and what to do",
    async (
      _label: string,
      contact: PublicMessageContact,
      contactName: string,
    ) => {
      expect(
        await sendsBeforeRefusal(TeamMessageKind.SubscriberAdded, [contact]),
      ).toBe(10);

      const refusal: "sent" | Error = await outcomeOf(
        TeamMessageKind.SubscriberAdded,
        [contact],
      );

      expect(refusal).toBeInstanceOf(PublicMessageRateLimitException);
      expect((refusal as PublicMessageRateLimitException).code).toBe(
        ExceptionCode.TooManyRequestsException,
      );
      expect((refusal as Error).message).toBe(
        `Too many subscription messages were sent to ${contactName} in the last hour. Please try again later, or add it without a message.`,
      );
      expect(
        (refusal as PublicMessageRateLimitException).retryAfterSeconds,
      ).toBe(60 * 60);
    },
  );

  test("an invitation: ten in an hour, then refused", async () => {
    expect(await sendsBeforeRefusal(TeamMessageKind.Invitation, [EMAIL])).toBe(
      10,
    );
    expect(
      ((await outcomeOf(TeamMessageKind.Invitation, [EMAIL])) as Error).message,
    ).toBe(
      "Too many invitations were sent to this email address in the last hour. Please try again later.",
    );
  });

  test("a thousand different contacts are never refused: nothing counts the team", async () => {
    for (let index: number = 0; index < 1000; index++) {
      expect(
        await outcomeOf(TeamMessageKind.SubscriberAdded, [
          PublicMessageRateLimit.forEmail(`person${index}@example.com`),
        ]),
      ).toBe("sent");
    }

    // One counter per contact, and none for a caller, a network or a project.
    expect(redis.keys()).toHaveLength(1000);
    expect(redis.keysHolding(":c:")).toEqual([]);
  });

  test("only a hash of a contact is written", async () => {
    await outcomeOf(TeamMessageKind.Invitation, [EMAIL]);
    await outcomeOf(TeamMessageKind.SubscriberAdded, [PHONE]);

    for (const key of redis.keys()) {
      expect(key).not.toContain("someone");
      expect(key).not.toContain("4155550100");
      expect(key).toMatch(/^pubmsg:rl:[a-z-]+:k:[0-9a-f]{32}:\d+$/);
    }
  });

  test("an hour on, it starts again", async () => {
    await sendsBeforeRefusal(TeamMessageKind.Invitation, [EMAIL]);

    currentTime += 60 * 60 * 1000;

    expect(await outcomeOf(TeamMessageKind.Invitation, [EMAIL])).toBe("sent");
  });
});

describe("which counter each kind counts on", () => {
  test("a subscriber the team adds shares its contact's counter with the visitors' sign-ups", async () => {
    // Ten sign-ups of the number by visitors this hour.
    for (let index: number = 0; index < 10; index++) {
      await PublicMessageRateLimit.assertMaySend({
        req: {
          headers: { "x-forwarded-for": `192.0.2.${index + 1}` },
          socket: { remoteAddress: "10.0.0.2" },
        } as unknown as ExpressRequest,
        kind: PublicMessageKind.StatusPageSignUp,
        contacts: [PHONE],
      });
    }

    expect(
      await outcomeOf(TeamMessageKind.SubscriberAdded, [PHONE]),
    ).toBeInstanceOf(PublicMessageRateLimitException);
    expect(
      redis.count(counterKey(PublicMessageKind.StatusPageSignUp, PHONE)),
    ).toBe(11);
  });

  test("an invitation's counter is its own: the address's subscriptions do not use it up", async () => {
    await sendsBeforeRefusal(TeamMessageKind.SubscriberAdded, [EMAIL]);

    expect(await outcomeOf(TeamMessageKind.Invitation, [EMAIL])).toBe("sent");
    expect(redis.count(counterKey(TeamMessageKind.Invitation, EMAIL))).toBe(1);
  });

  test("the same contact spelled two ways is one counter", async () => {
    const spellings: Array<PublicMessageContact> = [
      PublicMessageRateLimit.forPhone("+14155550100"),
      PublicMessageRateLimit.forPhone("0014155550100"),
      PublicMessageRateLimit.forPhone("141 555 50100"),
    ];

    let sent: number = 0;

    for (let attempt: number = 0; attempt < 12; attempt++) {
      if (
        (await outcomeOf(TeamMessageKind.SubscriberAdded, [
          spellings[attempt % spellings.length]!,
        ])) === "sent"
      ) {
        sent++;
      }
    }

    expect(sent).toBe(10);
  });

  test("a contact named twice in one send is counted once", async () => {
    await outcomeOf(TeamMessageKind.SubscriberAdded, [EMAIL, EMAIL, EMAIL]);

    expect(
      redis.count(counterKey(PublicMessageKind.StatusPageSignUp, EMAIL)),
    ).toBe(1);
  });
});

describe("a send that names more than one contact", () => {
  test("refused for one, the others get their count back", async () => {
    await sendsBeforeRefusal(TeamMessageKind.SubscriberAdded, [PHONE]);

    const refusal: "sent" | Error = await outcomeOf(
      TeamMessageKind.SubscriberAdded,
      [EMAIL, PHONE],
    );

    expect((refusal as Error).message).toContain("this phone number");
    expect(
      redis.count(counterKey(PublicMessageKind.StatusPageSignUp, EMAIL)),
    ).toBe(0);
  });
});

describe("the permit", () => {
  test("gives each contact its count back, once", async () => {
    const permit: PublicMessageSendPermit =
      await PublicMessageRateLimit.assertTeamMaySend({
        kind: TeamMessageKind.SubscriberAdded,
        contacts: [EMAIL, PHONE],
      });

    expect(
      redis.count(counterKey(PublicMessageKind.StatusPageSignUp, EMAIL)),
    ).toBe(1);

    await permit.giveBack();
    await permit.giveBack();

    expect(
      redis.count(counterKey(PublicMessageKind.StatusPageSignUp, EMAIL)),
    ).toBe(0);
    expect(
      redis.count(counterKey(PublicMessageKind.StatusPageSignUp, PHONE)),
    ).toBe(0);
  });

  test("a send that names no contact counts nothing, and its permit gives nothing back", async () => {
    const permit: PublicMessageSendPermit =
      await PublicMessageRateLimit.assertTeamMaySend({
        kind: TeamMessageKind.Invitation,
        contacts: [],
      });

    await permit.giveBack();

    expect(redis.keys()).toEqual([]);
    expect(redis.commandsSent()).toEqual([]);
  });
});

describe("while the counter cannot be reached", () => {
  test("Redis away: every send goes out uncounted, a text message too, with one warning a minute", async () => {
    isConnectedMock.mockReturnValue(false);

    for (let attempt: number = 0; attempt < 30; attempt++) {
      expect(await outcomeOf(TeamMessageKind.SubscriberAdded, [PHONE])).toBe(
        "sent",
      );
    }

    expect(redis.keys()).toEqual([]);
    expect(
      loggerWarnMock.mock.calls.filter((call: Array<unknown>): boolean => {
        return String(call[0]).includes("sending subscriber-added uncounted");
      }).length,
    ).toBeLessThanOrEqual(1);
  });

  test("no client at all: the same", async () => {
    getClientMock.mockReturnValue(null);

    expect(await outcomeOf(TeamMessageKind.Invitation, [EMAIL])).toBe("sent");
  });

  test("the counter failing part-way lets the send go, and its permit gives nothing back", async () => {
    redis.failNextExec = new Error("connection reset");

    const permit: PublicMessageSendPermit =
      await PublicMessageRateLimit.assertTeamMaySend({
        kind: TeamMessageKind.Invitation,
        contacts: [EMAIL],
      });

    await permit.giveBack();

    expect(redis.commandsSent("decr")).toEqual([]);
  });
});
