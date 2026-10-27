import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * PUBLIC ROUTES THAT SEND A MESSAGE TO AN ADDRESS THEIR CALLER NAMES ARE
 * LIMITED PER CALLER AND PER CONTACT.
 *
 * PublicMessageRateLimit is asked by every such route right before it sends:
 * a status page sign-up, a status page manage link, a status page private
 * user's password reset, an account's password reset, and the emails an
 * account sign-up sends. This suite holds the limiter itself, against a
 * counter store that counts the way Redis does (FakeCounterRedis):
 *
 *  - the caller's counter of each kind, and its text messages of every kind
 *    together, per address and per IPv6 /64;
 *  - each contact's counter of each kind, from every caller together, spent
 *    only by a request the caller's own counters let through, and given
 *    back by a request that ends with nothing sent to it;
 *  - how a contact is told apart from another: one mailbox however it is
 *    spelled, one phone however it is typed, one webhook as its address;
 *  - a list of email addresses is refused, never counted as one;
 *  - what a refused caller is told, and when to come back;
 *  - what happens while the counter cannot be reached: a text message is
 *    refused, anything else goes out uncounted.
 *
 * The routes are driven end to end in StatusPageSubscriberMessageLimits.test.ts
 * (Common), and in App by PasswordResetAndSignUpEmailLimits.test.ts and
 * StatusPagePasswordResetLimits.test.ts (the identity routes).
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
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../Server/Utils/Express";
import { getIpv6NetworkRateLimit } from "../../../../Server/Utils/ClientIp";
import PublicMessageRateLimit, {
  PUBLIC_MESSAGE_ONE_EMAIL_ADDRESS_MESSAGE,
  PublicMessageChannel,
  PublicMessageContact,
  PublicMessageKind,
  PublicMessageRateLimitConfig,
  PublicMessageRateLimitDecision,
  PublicMessageRateLimitException,
  PublicMessageRateLimitOutcome,
  PublicMessageRateLimitScope,
  PublicMessageSendPermit,
} from "../../../../Server/Utils/RateLimit/PublicMessageRateLimit";
import FakeCounterRedis from "../../TestingUtils/Redis/FakeCounterRedis";
import URL from "../../../../Types/API/URL";
import Email from "../../../../Types/Email";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ExceptionCode from "../../../../Types/Exception/ExceptionCode";
import ServiceUnavailableException from "../../../../Types/Exception/ServiceUnavailableException";
import ObjectID from "../../../../Types/ObjectID";
import Phone from "../../../../Types/Phone";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;
const loggerWarnMock: MockedFn = logger.warn as unknown as MockedFn;
const loggerErrorMock: MockedFn = logger.error as unknown as MockedFn;

const ALL_KINDS: Array<PublicMessageKind> = [
  PublicMessageKind.StatusPageSignUp,
  PublicMessageKind.StatusPageManageLink,
  PublicMessageKind.StatusPagePasswordReset,
  PublicMessageKind.PasswordReset,
  PublicMessageKind.SignUpEmail,
];

const CLIENT: string = "203.0.113.7";
const OTHER_CLIENT: string = "198.51.100.23";
const NETWORK: string = "2001:db8:5:6::/64";

// Host `index` of the /64 2001:db8:5:6::/64.
function hostOf(index: number, prefix: string = "2001:db8:5:6"): string {
  return `${prefix}:${(index >> 16).toString(16)}:${(index & 0xffff).toString(16)}:a:b`;
}

// A request as it reaches the app through the bundled Nginx.
function requestFrom(address: string): ExpressRequest {
  return {
    headers: { "x-forwarded-for": address },
    socket: { remoteAddress: "10.0.0.2" },
    params: {},
    body: {},
  } as unknown as ExpressRequest;
}

function emailOf(index: number): PublicMessageContact {
  return PublicMessageRateLimit.forEmail(`person-${index}@example.com`);
}

function phoneOf(index: number): PublicMessageContact {
  return PublicMessageRateLimit.forPhone(
    `+1415555${String(index).padStart(4, "0")}`,
  );
}

// What assertMaySend hands a request it lets through.
const A_PERMIT: unknown = { giveBack: expect.any(Function) };

let redis: FakeCounterRedis;
let currentTime: number;
let testIndex: number = 0;

beforeEach(() => {
  jest.clearAllMocks();

  redis = new FakeCounterRedis();
  getClientMock.mockReturnValue(redis);
  isConnectedMock.mockReturnValue(true);

  /*
   * The start of an hour (both windows divide one), a day further on for
   * each test, so no window - and no log throttle - carries over.
   */
  testIndex++;
  currentTime = Date.UTC(2031, 0, 1) + testIndex * 24 * 60 * 60 * 1000;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return currentTime;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function consume(
  kind: PublicMessageKind,
  contacts: Array<PublicMessageContact>,
  clientIp: string = CLIENT,
): Promise<PublicMessageRateLimitDecision> {
  return await PublicMessageRateLimit.consume({
    clientIp: clientIp,
    kind: kind,
    contacts: contacts,
  });
}

// How many of `count` requests are let through, sent one after another.
async function allowedOf(
  count: number,
  request: (index: number) => Promise<PublicMessageRateLimitDecision>,
): Promise<{ allowed: number; last: PublicMessageRateLimitDecision }> {
  let allowed: number = 0;
  let last: PublicMessageRateLimitDecision = {
    outcome: PublicMessageRateLimitOutcome.Allowed,
  };

  for (let index: number = 0; index < count; index++) {
    last = await request(index);

    if (last.outcome === PublicMessageRateLimitOutcome.Allowed) {
      allowed++;
    }
  }

  return { allowed: allowed, last: last };
}

describe("the limits in force", () => {
  test("are the shipped defaults: sized for people, generously", () => {
    const config: PublicMessageRateLimitConfig =
      PublicMessageRateLimit.getConfig();

    expect(config.clientWindowSeconds).toBe(15 * 60);
    expect(config.contactWindowSeconds).toBe(60 * 60);
    expect(config.perClientTextMessageLimit).toBe(10);

    expect(config.kinds).toEqual({
      [PublicMessageKind.StatusPageSignUp]: {
        perClientLimit: 60,
        perContactLimit: 10,
      },
      [PublicMessageKind.StatusPageManageLink]: {
        perClientLimit: 30,
        perContactLimit: 5,
      },
      [PublicMessageKind.StatusPagePasswordReset]: {
        perClientLimit: 30,
        perContactLimit: 5,
      },
      [PublicMessageKind.PasswordReset]: {
        perClientLimit: 30,
        perContactLimit: 5,
      },
      [PublicMessageKind.SignUpEmail]: {
        perClientLimit: 60,
        perContactLimit: 5,
      },
    });
  });

  test("each is read from its own PUBLIC_MESSAGE_RATE_LIMIT_* variable, and a value that is not a number above zero keeps the default", () => {
    type Reading = (config: PublicMessageRateLimitConfig) => number;

    const variables: Record<string, Reading> = {
      WINDOW_SECONDS: (config: PublicMessageRateLimitConfig): number => {
        return config.clientWindowSeconds;
      },
      PER_CONTACT_WINDOW_SECONDS: (
        config: PublicMessageRateLimitConfig,
      ): number => {
        return config.contactWindowSeconds;
      },
      TEXT_MESSAGES_PER_IP: (config: PublicMessageRateLimitConfig): number => {
        return config.perClientTextMessageLimit;
      },
      STATUS_PAGE_SIGN_UPS_PER_IP: (
        config: PublicMessageRateLimitConfig,
      ): number => {
        return config.kinds[PublicMessageKind.StatusPageSignUp].perClientLimit;
      },
      STATUS_PAGE_SIGN_UPS_PER_CONTACT: (
        config: PublicMessageRateLimitConfig,
      ): number => {
        return config.kinds[PublicMessageKind.StatusPageSignUp].perContactLimit;
      },
      STATUS_PAGE_MANAGE_LINKS_PER_IP: (
        config: PublicMessageRateLimitConfig,
      ): number => {
        return config.kinds[PublicMessageKind.StatusPageManageLink]
          .perClientLimit;
      },
      STATUS_PAGE_MANAGE_LINKS_PER_CONTACT: (
        config: PublicMessageRateLimitConfig,
      ): number => {
        return config.kinds[PublicMessageKind.StatusPageManageLink]
          .perContactLimit;
      },
      STATUS_PAGE_PASSWORD_RESETS_PER_IP: (
        config: PublicMessageRateLimitConfig,
      ): number => {
        return config.kinds[PublicMessageKind.StatusPagePasswordReset]
          .perClientLimit;
      },
      STATUS_PAGE_PASSWORD_RESETS_PER_CONTACT: (
        config: PublicMessageRateLimitConfig,
      ): number => {
        return config.kinds[PublicMessageKind.StatusPagePasswordReset]
          .perContactLimit;
      },
      PASSWORD_RESETS_PER_IP: (
        config: PublicMessageRateLimitConfig,
      ): number => {
        return config.kinds[PublicMessageKind.PasswordReset].perClientLimit;
      },
      PASSWORD_RESETS_PER_CONTACT: (
        config: PublicMessageRateLimitConfig,
      ): number => {
        return config.kinds[PublicMessageKind.PasswordReset].perContactLimit;
      },
      SIGN_UP_EMAILS_PER_IP: (config: PublicMessageRateLimitConfig): number => {
        return config.kinds[PublicMessageKind.SignUpEmail].perClientLimit;
      },
      SIGN_UP_EMAILS_PER_CONTACT: (
        config: PublicMessageRateLimitConfig,
      ): number => {
        return config.kinds[PublicMessageKind.SignUpEmail].perContactLimit;
      },
    };

    // The limiter as a fresh load reads it, with the environment as it is now.
    const freshConfig: () => PublicMessageRateLimitConfig =
      (): PublicMessageRateLimitConfig => {
        let config: PublicMessageRateLimitConfig | undefined = undefined;

        jest.isolateModules(() => {
          config = (
            jest.requireActual(
              "../../../../Server/Utils/RateLimit/PublicMessageRateLimit",
            ) as { default: typeof PublicMessageRateLimit }
          ).default.getConfig();
        });

        return config as unknown as PublicMessageRateLimitConfig;
      };

    const defaults: PublicMessageRateLimitConfig =
      PublicMessageRateLimit.getConfig();

    for (const [name, read] of Object.entries(variables)) {
      const variable: string = `PUBLIC_MESSAGE_RATE_LIMIT_${name}`;

      try {
        process.env[variable] = "4321";
        expect([variable, read(freshConfig())]).toEqual([variable, 4321]);

        for (const ignored of ["0", "-5", "many"]) {
          process.env[variable] = ignored;
          expect([variable, ignored, read(freshConfig())]).toEqual([
            variable,
            ignored,
            read(defaults),
          ]);
        }
      } finally {
        delete process.env[variable];
      }
    }
  });

  test("are handed out as a copy, so nobody can change them in place", () => {
    const config: PublicMessageRateLimitConfig =
      PublicMessageRateLimit.getConfig();

    config.kinds[PublicMessageKind.PasswordReset].perContactLimit = 1000;
    config.perClientTextMessageLimit = 1000;

    expect(
      PublicMessageRateLimit.getConfig().kinds[PublicMessageKind.PasswordReset]
        .perContactLimit,
    ).toBe(5);
    expect(PublicMessageRateLimit.getConfig().perClientTextMessageLimit).toBe(
      10,
    );
  });

  test("every kind has its own words for each refusal, naming no number", () => {
    for (const kind of ALL_KINDS) {
      const client: string = PublicMessageRateLimit.getRefusalMessage({
        kind: kind,
        scope: PublicMessageRateLimitScope.Client,
      });
      const contact: string = PublicMessageRateLimit.getRefusalMessage({
        kind: kind,
        scope: PublicMessageRateLimitScope.Contact,
        contact: emailOf(1),
      });

      expect(client).toContain("from your network");
      expect(contact).toContain("this email address");
      expect(contact).toContain("in the last hour");
      expect([client, contact].join(" ")).not.toMatch(/[0-9]/);
    }
  });
});

describe("a contact is one mailbox, one phone, one channel", () => {
  test("an email address is counted however its case, its +tag or (for Gmail) its dots spell it", () => {
    const key: (value: string) => string = (value: string): string => {
      return PublicMessageRateLimit.getContactKey(
        PublicMessageRateLimit.forEmail(value),
      );
    };

    expect(key("Victim@Example.com")).toBe(key("victim@example.com"));
    expect(key("  victim@example.com ")).toBe(key("victim@example.com"));
    expect(key("victim+status@example.com")).toBe(key("victim@example.com"));
    expect(key("victim+a+b@example.com")).toBe(key("victim@example.com"));
    expect(key("v.i.c.t.i.m@gmail.com")).toBe(key("victim@gmail.com"));
    expect(key("Vic.Tim+x@googlemail.com")).toBe(key("victim@gmail.com"));

    // Dots are a different mailbox anywhere else, and so is another person.
    expect(key("v.ictim@example.com")).not.toBe(key("victim@example.com"));
    expect(key("someone@example.com")).not.toBe(key("victim@example.com"));
    expect(key("victim@example.org")).not.toBe(key("victim@example.com"));

    // A local part that is all tag is left as it is.
    expect(PublicMessageRateLimit.forEmail("+tag@example.com").canonical).toBe(
      "+tag@example.com",
    );
  });

  test("an Email is counted as its address", () => {
    expect(
      PublicMessageRateLimit.forEmail(new Email("Person@Example.com")),
    ).toEqual({
      channel: PublicMessageChannel.Email,
      canonical: "person@example.com",
    });
  });

  test("a list of addresses is refused, never counted as one contact", () => {
    for (const value of [
      "a@example.com,b@example.com",
      "a@example.com;b@example.com",
      "a@example.com b@example.com",
      "a@example.com\nb@example.com",
      "<a@example.com>",
      "Someone <a@example.com>",
      '"a@b"@example.com',
      "a@@example.com",
      "not an address",
      "",
    ]) {
      let refusal: unknown = null;

      try {
        PublicMessageRateLimit.forEmail(value);
      } catch (error) {
        refusal = error;
      }

      expect([value, refusal instanceof BadDataException]).toEqual([
        value,
        true,
      ]);
      expect((refusal as BadDataException).message).toBe(
        PUBLIC_MESSAGE_ONE_EMAIL_ADDRESS_MESSAGE,
      );
    }
  });

  test("no address is longer than a mailbox can be: 254 characters", () => {
    const longest: string = `${"a".repeat(64)}@${"b".repeat(185)}.com`;

    expect(longest).toHaveLength(254);
    expect(PublicMessageRateLimit.forEmail(longest).canonical).toBe(longest);
    expect(() => {
      return PublicMessageRateLimit.forEmail(`a${longest}`);
    }).toThrow(PUBLIC_MESSAGE_ONE_EMAIL_ADDRESS_MESSAGE);
  });

  test("a mailbox written with any of RFC 5322's characters is one mailbox, apostrophes included", () => {
    for (const value of [
      "o'brien@example.com",
      "d'angelo.smith@example.co.uk",
      "first.last@mail.example.com",
      "a!b#c$d%e&f'g*h/i=j?k^l_m`n{o|p}q~r-s@example.com",
      "user@123.example",
      "x@a-b.example.com",
    ]) {
      expect([value, PublicMessageRateLimit.forEmail(value).channel]).toEqual([
        value,
        PublicMessageChannel.Email,
      ]);
    }

    expect(
      PublicMessageRateLimit.forEmail("O'Brien@Example.com").canonical,
    ).toBe("o'brien@example.com");
  });

  test("a group, a comment, a quoted or dotted-out local part, an address literal or a trailing dot is refused", () => {
    for (const value of [
      "x:victim@example.com",
      "group:victim@example.com;",
      "a:b:victim@example.com",
      "victim@example.com:",
      "victim@example.com.",
      ".victim@example.com",
      "victim.@example.com",
      "vic..tim@example.com",
      "victim(comment)@example.com",
      "victim@example.com (comment)",
      '"victim"@example.com',
      "victim@[192.0.2.1]",
      "victim@-example.com",
      "victim@example-.com",
      "victim@exam_ple.com",
      "victim@example",
      "victim\\@example.com",
      "vïctim@example.com",
    ]) {
      let refusal: unknown = null;

      try {
        PublicMessageRateLimit.forEmail(value);
      } catch (error) {
        refusal = error;
      }

      expect([value, (refusal as BadDataException | null)?.message]).toEqual([
        value,
        PUBLIC_MESSAGE_ONE_EMAIL_ADDRESS_MESSAGE,
      ]);
    }
  });

  test("the one-mailbox check takes time in line with the text, however long", () => {
    const worstCases: Array<string> = [
      "a".repeat(400000),
      `${"a".repeat(200000)}@${"b".repeat(200000)}`,
      "@".repeat(400000),
      `${"a@".repeat(200000)}`,
      `${"a".repeat(399999)},`,
      // The longest addresses looked at any further, in two shapes.
      `${"a".repeat(126)}@${"b".repeat(127)}`,
      `${"a.".repeat(63)}a@${"b-".repeat(63)}b`,
    ];

    for (const value of worstCases) {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          try {
            PublicMessageRateLimit.forEmail(value);
          } catch {
            // Refused, as it should be.
          }
        },
        limitInMs: 2000,
      });

      expect(timed.inMs).toBeLessThan(2000);
    }
  });

  test("a phone number is counted as its digits, however it was typed", () => {
    const key: (value: string) => string = (value: string): string => {
      return PublicMessageRateLimit.getContactKey(
        PublicMessageRateLimit.forPhone(value),
      );
    };

    expect(PublicMessageRateLimit.forPhone("+1 415.555.0100")).toEqual({
      channel: PublicMessageChannel.TextMessage,
      canonical: "14155550100",
    });
    expect(key("+14155550100")).toBe(key("+1 (415) 555-0100"));
    expect(key("+14155550100")).toBe(key("14155550100"));
    expect(key("+14155550100")).not.toBe(key("+14155550101"));

    // Dialled out of the country with 00, as most of the world does.
    expect(key("+14155550100")).toBe(key("0014155550100"));
    expect(key("+14155550100")).toBe(key("00 1 415 555 0100"));
    expect(PublicMessageRateLimit.forPhone("0044 7911 123456").canonical).toBe(
      "447911123456",
    );
    // One leading 0 is a number of its own, as it is to a phone network.
    expect(key("+14155550100")).not.toBe(key("014155550100"));
    expect(
      PublicMessageRateLimit.forPhone(new Phone("+14155550100")).canonical,
    ).toBe("14155550100");
  });

  test("a webhook is counted as the address it is sent to, path and query included", () => {
    const key: (value: string) => string = (value: string): string => {
      return PublicMessageRateLimit.getContactKey(
        PublicMessageRateLimit.forWebhook(PublicMessageChannel.Webhook, value),
      );
    };

    expect(
      PublicMessageRateLimit.forWebhook(
        PublicMessageChannel.Webhook,
        "HTTPS://User:Secret@Hooks.Example.COM:443/In?x=1#fragment",
      ),
    ).toEqual({
      channel: PublicMessageChannel.Webhook,
      canonical: "https://hooks.example.com/In?x=1",
    });
    expect(key("https://hooks.example.com/in")).toBe(
      key("https://HOOKS.example.com:443/in#top"),
    );
    expect(key("https://hooks.example.com/in")).not.toBe(
      key("https://hooks.example.com/in?user=2"),
    );
    expect(key("https://hooks.example.com/in")).not.toBe(
      key("https://hooks.example.com/other"),
    );
    expect(
      PublicMessageRateLimit.forWebhook(
        PublicMessageChannel.Slack,
        URL.fromString("https://hooks.slack.com/services/T000/B000/XXXX"),
      ),
    ).toEqual({
      channel: PublicMessageChannel.Slack,
      canonical: "https://hooks.slack.com/services/T000/B000/XXXX",
    });
  });

  test("a webhook that does not parse is counted as written", () => {
    expect(
      PublicMessageRateLimit.forWebhook(
        PublicMessageChannel.Webhook,
        "  Not A URL ",
      ).canonical,
    ).toBe("not a url");
  });

  test("a workspace name is counted on its own status page, whatever its case", () => {
    const pageId: ObjectID = new ObjectID(
      "61000000-0000-4000-8000-000000000001",
    );
    const otherPageId: ObjectID = new ObjectID(
      "61000000-0000-4000-8000-000000000002",
    );

    const key: (page: ObjectID, name: string) => string = (
      page: ObjectID,
      name: string,
    ): string => {
      return PublicMessageRateLimit.getContactKey(
        PublicMessageRateLimit.forWorkspace(
          PublicMessageChannel.Slack,
          page,
          name,
        ),
      );
    };

    expect(key(pageId, " Engineering ")).toBe(key(pageId, "engineering"));
    expect(key(pageId, "Engineering")).not.toBe(
      key(otherPageId, "Engineering"),
    );
    expect(key(pageId, "Engineering")).not.toBe(
      PublicMessageRateLimit.getContactKey(
        PublicMessageRateLimit.forWorkspace(
          PublicMessageChannel.MicrosoftTeams,
          pageId,
          "Engineering",
        ),
      ),
    );
  });

  test("channels never share a contact's counter", () => {
    expect(
      PublicMessageRateLimit.getContactKey({
        channel: PublicMessageChannel.Slack,
        canonical: "https://hooks.example.com/x",
      }),
    ).not.toBe(
      PublicMessageRateLimit.getContactKey({
        channel: PublicMessageChannel.Webhook,
        canonical: "https://hooks.example.com/x",
      }),
    );
  });
});

describe("the caller's counter", () => {
  test.each(ALL_KINDS)(
    "%s: one address is let through its limit, then refused, whichever contacts it names",
    async (kind: PublicMessageKind) => {
      const limit: number =
        PublicMessageRateLimit.getConfig().kinds[kind].perClientLimit;

      const { allowed, last } = await allowedOf(
        limit + 5,
        (index: number): Promise<PublicMessageRateLimitDecision> => {
          return consume(kind, [emailOf(index)]);
        },
      );

      expect(allowed).toBe(limit);
      expect(last).toEqual({
        outcome: PublicMessageRateLimitOutcome.RateLimited,
        retryAfterSeconds: 15 * 60,
        scope: PublicMessageRateLimitScope.Client,
        ipv6Network64: undefined,
        isFirstRejectionInWindow: false,
      });
    },
  );

  test("the kinds do not share a caller's counter", async () => {
    await allowedOf(30, (index: number) => {
      return consume(PublicMessageKind.PasswordReset, [emailOf(index)]);
    });

    expect(
      (await consume(PublicMessageKind.PasswordReset, [emailOf(1000)])).outcome,
    ).toBe(PublicMessageRateLimitOutcome.RateLimited);

    for (const kind of ALL_KINDS) {
      if (kind === PublicMessageKind.PasswordReset) {
        continue;
      }

      expect([kind, (await consume(kind, [emailOf(2000)])).outcome]).toEqual([
        kind,
        PublicMessageRateLimitOutcome.Allowed,
      ]);
    }
  });

  test("another address keeps its own allowance", async () => {
    await allowedOf(61, (index: number) => {
      return consume(PublicMessageKind.StatusPageSignUp, [emailOf(index)]);
    });

    expect(
      (
        await consume(
          PublicMessageKind.StatusPageSignUp,
          [emailOf(5000)],
          OTHER_CLIENT,
        )
      ).outcome,
    ).toBe(PublicMessageRateLimitOutcome.Allowed);
  });

  test("a caller-supplied X-Forwarded-For entry buys no fresh allowance", async () => {
    let allowed: number = 0;

    for (let index: number = 0; index < 40; index++) {
      try {
        await PublicMessageRateLimit.assertMaySend({
          req: {
            headers: {
              "x-forwarded-for": `10.9.${index}.1, ${CLIENT}`,
            },
            socket: { remoteAddress: "10.0.0.2" },
          } as unknown as ExpressRequest,
          kind: PublicMessageKind.PasswordReset,
          contacts: [emailOf(index)],
        });
        allowed++;
      } catch {
        // Refused.
      }
    }

    expect(allowed).toBe(30);
  });

  test("a request with no address shares one counter with every other", async () => {
    let allowed: number = 0;

    for (let index: number = 0; index < 35; index++) {
      try {
        await PublicMessageRateLimit.assertMaySend({
          req: { headers: {} } as unknown as ExpressRequest,
          kind: PublicMessageKind.PasswordReset,
          contacts: [emailOf(index)],
        });
        allowed++;
      } catch {
        // Refused.
      }
    }

    expect(allowed).toBe(30);
    expect(redis.keysHolding(":c:unknown:")).toHaveLength(1);
  });

  test("a host that sends from address after address of one /64 is held to ten addresses' worth", async () => {
    const networkLimit: number = getIpv6NetworkRateLimit(30);

    const { allowed, last } = await allowedOf(
      networkLimit + 20,
      (index: number) => {
        return consume(
          PublicMessageKind.PasswordReset,
          [emailOf(index)],
          hostOf(index + 1),
        );
      },
    );

    expect(allowed).toBe(networkLimit);
    expect(last.scope).toBe(PublicMessageRateLimitScope.Client);
    expect(last.ipv6Network64).toBe(NETWORK);
  });

  test("a client's window ends after a quarter of an hour, and not before", async () => {
    await allowedOf(31, (index: number) => {
      return consume(PublicMessageKind.PasswordReset, [emailOf(index)]);
    });

    currentTime += 15 * 60 * 1000 - 1000;

    const late: PublicMessageRateLimitDecision = await consume(
      PublicMessageKind.PasswordReset,
      [emailOf(100)],
    );

    expect(late.outcome).toBe(PublicMessageRateLimitOutcome.RateLimited);
    expect(late.retryAfterSeconds).toBe(1);

    currentTime += 1000;

    expect(
      (await consume(PublicMessageKind.PasswordReset, [emailOf(101)])).outcome,
    ).toBe(PublicMessageRateLimitOutcome.Allowed);
  });
});

describe("the caller's text messages, of every kind together", () => {
  test("ten sign-ups by text from one address, then refused - while sign-ups by email go on", async () => {
    const { allowed, last } = await allowedOf(15, (index: number) => {
      return consume(PublicMessageKind.StatusPageSignUp, [phoneOf(index)]);
    });

    expect(allowed).toBe(10);
    expect(last.scope).toBe(PublicMessageRateLimitScope.ClientTextMessages);
    expect(
      PublicMessageRateLimit.getRefusalMessage({
        kind: PublicMessageKind.StatusPageSignUp,
        scope: last.scope,
      }),
    ).toBe(
      "Too many sign-ups by text message from your network. Please wait a few minutes and try again.",
    );

    expect(
      (await consume(PublicMessageKind.StatusPageSignUp, [emailOf(1)])).outcome,
    ).toBe(PublicMessageRateLimitOutcome.Allowed);
  });

  test("manage links by text spend the same allowance as sign-ups by text", async () => {
    await allowedOf(6, (index: number) => {
      return consume(PublicMessageKind.StatusPageSignUp, [phoneOf(index)]);
    });

    const { allowed, last } = await allowedOf(10, (index: number) => {
      return consume(PublicMessageKind.StatusPageManageLink, [
        phoneOf(100 + index),
      ]);
    });

    expect(allowed).toBe(4);
    expect(last.scope).toBe(PublicMessageRateLimitScope.ClientTextMessages);
  });

  test("a request that names a phone among other contacts is one text", async () => {
    const { allowed } = await allowedOf(12, (index: number) => {
      return consume(PublicMessageKind.StatusPageSignUp, [
        emailOf(index),
        phoneOf(index),
        PublicMessageRateLimit.forWebhook(
          PublicMessageChannel.Webhook,
          `https://hooks.example.com/${index}`,
        ),
      ]);
    });

    expect(allowed).toBe(10);
  });

  test("an IPv6 /64 sends ten addresses' worth of texts", async () => {
    const { allowed, last } = await allowedOf(
      getIpv6NetworkRateLimit(10) + 10,
      (index: number) => {
        return consume(
          PublicMessageKind.StatusPageSignUp,
          [phoneOf(index)],
          hostOf(index + 1),
        );
      },
    );

    expect(allowed).toBe(getIpv6NetworkRateLimit(10));
    expect(last.scope).toBe(PublicMessageRateLimitScope.ClientTextMessages);
    expect(last.ipv6Network64).toBe(NETWORK);
  });
});

describe("a contact's counter, from every caller together", () => {
  test.each(ALL_KINDS)(
    "%s: one contact is sent its limit from address after address, then refused",
    async (kind: PublicMessageKind) => {
      const limit: number =
        PublicMessageRateLimit.getConfig().kinds[kind].perContactLimit;
      const victim: PublicMessageContact =
        PublicMessageRateLimit.forEmail("victim@example.com");

      const { allowed, last } = await allowedOf(limit + 10, (index: number) => {
        return consume(kind, [victim], `192.0.2.${index + 1}`);
      });

      expect(allowed).toBe(limit);
      expect(last).toEqual({
        outcome: PublicMessageRateLimitOutcome.RateLimited,
        retryAfterSeconds: 60 * 60,
        scope: PublicMessageRateLimitScope.Contact,
        contact: victim,
        isFirstRejectionInWindow: false,
      });
    },
  );

  test("spelling the mailbox another way buys no fresh allowance", async () => {
    const spellings: Array<string> = [
      "victim@gmail.com",
      "Victim@Gmail.com",
      "v.ictim@gmail.com",
      "vic.tim@googlemail.com",
      "victim+1@gmail.com",
      "victim+2@gmail.com",
      "V.I.C.T.I.M+x@GoogleMail.com",
    ];

    const { allowed } = await allowedOf(spellings.length, (index: number) => {
      return consume(
        PublicMessageKind.PasswordReset,
        [PublicMessageRateLimit.forEmail(spellings[index]!)],
        `192.0.2.${index + 1}`,
      );
    });

    expect(allowed).toBe(5);
  });

  test("typing the phone another way buys no fresh allowance", async () => {
    const spellings: Array<string> = [
      "+14155550100",
      "+1 415 555 0100",
      "+1-415-555-0100",
      "+1.415.555.0100",
      "+1 (415) 555-0100",
      "14155550100",
      "+14155550100",
      "+1 415 555 0100",
      "+1-415-555-0100",
      "+1.415.555.0100",
      "+1 (415) 555-0100",
    ];

    const { allowed, last } = await allowedOf(
      spellings.length,
      (index: number) => {
        return consume(
          PublicMessageKind.StatusPageSignUp,
          [PublicMessageRateLimit.forPhone(spellings[index]!)],
          `192.0.2.${index + 1}`,
        );
      },
    );

    expect(allowed).toBe(10);
    expect(last.contact?.channel).toBe(PublicMessageChannel.TextMessage);
  });

  test("a caller its own counters refuse cannot spend a contact's allowance", async () => {
    const victim: PublicMessageContact =
      PublicMessageRateLimit.forEmail("victim@example.com");

    // Spend this address's own allowance on other people.
    await allowedOf(30, (index: number) => {
      return consume(PublicMessageKind.PasswordReset, [emailOf(index)]);
    });

    // Then knock on the victim's door as long as it likes.
    for (let index: number = 0; index < 50; index++) {
      expect(
        (await consume(PublicMessageKind.PasswordReset, [victim])).scope,
      ).toBe(PublicMessageRateLimitScope.Client);
    }

    // The victim's own reset is still sent, from anywhere else.
    expect(
      (await consume(PublicMessageKind.PasswordReset, [victim], OTHER_CLIENT))
        .outcome,
    ).toBe(PublicMessageRateLimitOutcome.Allowed);
    expect(
      redis.keysHolding(`:k:${PublicMessageRateLimit.getContactKey(victim)}:`),
    ).toHaveLength(1);
    expect(
      redis.count(
        redis.keysHolding(
          `:k:${PublicMessageRateLimit.getContactKey(victim)}:`,
        )[0]!,
      ),
    ).toBe(1);
  });

  test("the kinds do not share a contact's counter", async () => {
    const victim: PublicMessageContact =
      PublicMessageRateLimit.forEmail("victim@example.com");

    await allowedOf(6, (index: number) => {
      return consume(
        PublicMessageKind.StatusPageManageLink,
        [victim],
        `192.0.2.${index + 1}`,
      );
    });

    expect(
      (
        await consume(
          PublicMessageKind.StatusPageManageLink,
          [victim],
          OTHER_CLIENT,
        )
      ).scope,
    ).toBe(PublicMessageRateLimitScope.Contact);

    for (const kind of ALL_KINDS) {
      if (kind === PublicMessageKind.StatusPageManageLink) {
        continue;
      }

      expect([
        kind,
        (await consume(kind, [victim], OTHER_CLIENT)).outcome,
      ]).toEqual([kind, PublicMessageRateLimitOutcome.Allowed]);
    }
  });

  test("the refusal names the contact that had enough, among several", async () => {
    const webhook: PublicMessageContact = PublicMessageRateLimit.forWebhook(
      PublicMessageChannel.Webhook,
      "https://victim.example.net/hook",
    );

    await allowedOf(10, (index: number) => {
      return consume(
        PublicMessageKind.StatusPageSignUp,
        [webhook],
        `192.0.2.${index + 1}`,
      );
    });

    const decision: PublicMessageRateLimitDecision = await consume(
      PublicMessageKind.StatusPageSignUp,
      [emailOf(1), webhook],
      OTHER_CLIENT,
    );

    expect(decision.scope).toBe(PublicMessageRateLimitScope.Contact);
    expect(decision.contact).toEqual(webhook);
    expect(
      PublicMessageRateLimit.getRefusalMessage({
        kind: PublicMessageKind.StatusPageSignUp,
        scope: decision.scope,
        contact: decision.contact,
      }),
    ).toBe(
      "Too many sign-ups for this webhook in the last hour. Please try again later.",
    );
  });

  test("a contact named twice in one request is counted once", async () => {
    const victim: PublicMessageContact =
      PublicMessageRateLimit.forEmail("victim@example.com");

    await consume(PublicMessageKind.StatusPageSignUp, [
      victim,
      PublicMessageRateLimit.forEmail("Victim+x@Example.com"),
    ]);

    const keys: Array<string> = redis.keysHolding(
      `:k:${PublicMessageRateLimit.getContactKey(victim)}:`,
    );

    expect(keys).toHaveLength(1);
    expect(redis.count(keys[0]!)).toBe(1);
  });

  test("a contact's window is an hour, and ends on the hour", async () => {
    const victim: PublicMessageContact =
      PublicMessageRateLimit.forEmail("victim@example.com");

    await allowedOf(5, (index: number) => {
      return consume(
        PublicMessageKind.PasswordReset,
        [victim],
        `192.0.2.${index + 1}`,
      );
    });

    currentTime += 59 * 60 * 1000;

    const late: PublicMessageRateLimitDecision = await consume(
      PublicMessageKind.PasswordReset,
      [victim],
      OTHER_CLIENT,
    );

    expect(late.scope).toBe(PublicMessageRateLimitScope.Contact);
    expect(late.retryAfterSeconds).toBe(60);

    currentTime += 60 * 1000;

    expect(
      (await consume(PublicMessageKind.PasswordReset, [victim], "192.0.2.200"))
        .outcome,
    ).toBe(PublicMessageRateLimitOutcome.Allowed);
  });

  test("no email address or phone number is written to Redis, only a hash", async () => {
    await consume(PublicMessageKind.StatusPageSignUp, [
      PublicMessageRateLimit.forEmail("victim@example.com"),
      PublicMessageRateLimit.forPhone("+14155550100"),
      PublicMessageRateLimit.forWebhook(
        PublicMessageChannel.Webhook,
        "https://victim.example.net/hook",
      ),
    ]);

    const keys: string = redis.keys().join("\n");

    expect(keys).not.toContain("victim");
    expect(keys).not.toContain("example");
    expect(keys).not.toContain("4155550100");
    expect(redis.keysHolding(":k:")).toHaveLength(3);

    for (const key of redis.keysHolding(":k:")) {
      expect(key).toMatch(/^pubmsg:rl:status-page-sign-up:k:[0-9a-f]{32}:\d+$/);
    }
  });

  test("every key expires, once, two windows after it was made", async () => {
    await consume(PublicMessageKind.StatusPageSignUp, [emailOf(1), phoneOf(1)]);
    await consume(PublicMessageKind.StatusPageSignUp, [emailOf(1), phoneOf(1)]);

    for (const key of redis.keys()) {
      expect([key, redis.expiries.get(key)]).toEqual([
        key,
        [key.includes(":k:") ? 2 * 60 * 60 : 2 * 15 * 60],
      ]);
    }
  });
});

describe("a contact is counted for the messages it is sent", () => {
  // The count a contact's counter holds for a kind, in this window.
  function contactCount(
    kind: PublicMessageKind,
    contact: PublicMessageContact,
  ): number {
    const keys: Array<string> = redis
      .keysHolding(`:k:${PublicMessageRateLimit.getContactKey(contact)}:`)
      .filter((key: string): boolean => {
        return key.includes(`:${kind}:`);
      });

    return keys.reduce((total: number, key: string): number => {
      return total + redis.count(key);
    }, 0);
  }

  async function permitFor(
    kind: PublicMessageKind,
    contacts: Array<PublicMessageContact>,
    from: string = CLIENT,
  ): Promise<PublicMessageSendPermit> {
    return await PublicMessageRateLimit.assertMaySend({
      req: requestFrom(from),
      kind: kind,
      contacts: contacts,
    });
  }

  test("a request refused for one contact gives the other contacts it names their count back", async () => {
    const victim: PublicMessageContact =
      PublicMessageRateLimit.forEmail("victim@example.com");
    const spent: PublicMessageContact = phoneOf(1);

    // A phone that has had its ten sign-ups this hour.
    await allowedOf(10, (index: number) => {
      return consume(
        PublicMessageKind.StatusPageSignUp,
        [spent],
        `192.0.2.${index + 1}`,
      );
    });

    // Sign-ups naming the victim's address beside it, again and again.
    for (let index: number = 0; index < 20; index++) {
      const decision: PublicMessageRateLimitDecision = await consume(
        PublicMessageKind.StatusPageSignUp,
        [victim, spent],
        `198.51.100.${index + 1}`,
      );

      expect(decision.scope).toBe(PublicMessageRateLimitScope.Contact);
      expect(decision.contact).toEqual(spent);
    }

    // Nothing was sent to the victim, so nothing is counted against it.
    expect(contactCount(PublicMessageKind.StatusPageSignUp, victim)).toBe(0);

    /*
     * The phone that refused keeps every count, over its limit until its
     * window ends - so only its first refusal is the first of the window.
     */
    expect(contactCount(PublicMessageKind.StatusPageSignUp, spent)).toBe(30);
    expect(
      (
        await allowedOf(11, (index: number) => {
          return consume(
            PublicMessageKind.StatusPageSignUp,
            [victim],
            `192.0.2.${100 + index}`,
          );
        })
      ).allowed,
    ).toBe(10);
  });

  test("a permit gives its contacts their count back, once, and the caller's count stays spent", async () => {
    const permit: PublicMessageSendPermit = await permitFor(
      PublicMessageKind.StatusPageSignUp,
      [emailOf(1), phoneOf(1)],
    );

    expect(contactCount(PublicMessageKind.StatusPageSignUp, emailOf(1))).toBe(
      1,
    );
    expect(contactCount(PublicMessageKind.StatusPageSignUp, phoneOf(1))).toBe(
      1,
    );

    await permit.giveBack();
    await permit.giveBack();

    expect(contactCount(PublicMessageKind.StatusPageSignUp, emailOf(1))).toBe(
      0,
    );
    expect(contactCount(PublicMessageKind.StatusPageSignUp, phoneOf(1))).toBe(
      0,
    );
    expect(redis.commandsSent("decr")).toHaveLength(2);

    // The caller's sign-up and its text are still counted.
    const callerKeys: Array<string> = redis.keysHolding(`:c:${CLIENT}:`);

    expect(callerKeys).toHaveLength(2);

    for (const key of callerKeys) {
      expect([key, redis.count(key)]).toEqual([key, 1]);
    }
  });

  test("a contact whose every request ended with nothing sent keeps its whole allowance", async () => {
    const victim: PublicMessageContact =
      PublicMessageRateLimit.forEmail("victim@example.com");

    for (let index: number = 0; index < 25; index++) {
      const permit: PublicMessageSendPermit = await permitFor(
        PublicMessageKind.SignUpEmail,
        [victim],
        `192.0.2.${index + 1}`,
      );

      await permit.giveBack();
    }

    expect(
      (
        await allowedOf(6, (index: number) => {
          return consume(
            PublicMessageKind.SignUpEmail,
            [victim],
            `198.51.100.${index + 1}`,
          );
        })
      ).allowed,
    ).toBe(5);
  });

  test("a permit for a request let through uncounted gives nothing back", async () => {
    isConnectedMock.mockReturnValue(false);

    const permit: PublicMessageSendPermit = await permitFor(
      PublicMessageKind.PasswordReset,
      [emailOf(1)],
    );

    isConnectedMock.mockReturnValue(true);
    await permit.giveBack();

    expect(redis.sent).toEqual([]);
  });

  test("a give-back that fails is logged and swallowed, and never turns a refusal into a send", async () => {
    redis.failCommand = (command: { name: string }): Error | null => {
      return command.name === "decr" ? new Error("READONLY replica") : null;
    };

    const permit: PublicMessageSendPermit = await permitFor(
      PublicMessageKind.StatusPageSignUp,
      [emailOf(1)],
    );

    await expect(permit.giveBack()).resolves.toBeUndefined();
    expect(
      loggerWarnMock.mock.calls.filter((call: Array<unknown>): boolean => {
        return String(call[0]).includes("could not give");
      }),
    ).toHaveLength(1);

    // A refusal whose give-back fails is still a refusal.
    await allowedOf(10, (index: number) => {
      return consume(
        PublicMessageKind.StatusPageSignUp,
        [phoneOf(1)],
        `192.0.2.${index + 1}`,
      );
    });

    expect(
      (
        await consume(
          PublicMessageKind.StatusPageSignUp,
          [emailOf(2), phoneOf(1)],
          OTHER_CLIENT,
        )
      ).outcome,
    ).toBe(PublicMessageRateLimitOutcome.RateLimited);
  });

  test("a key Redis lost before the give-back is not left behind without an expiry", async () => {
    const permit: PublicMessageSendPermit = await permitFor(
      PublicMessageKind.PasswordReset,
      [emailOf(1)],
    );
    const key: string = redis.keysHolding(":k:")[0]!;

    redis.counters.delete(key);
    redis.expiries.delete(key);

    await permit.giveBack();

    expect(redis.count(key)).toBe(-1);
    expect(redis.expiries.get(key)).toEqual([2 * 60 * 60]);
  });
});

describe("assertMaySend: what the routes call", () => {
  test("lets a request through without a word", async () => {
    await expect(
      PublicMessageRateLimit.assertMaySend({
        req: requestFrom(CLIENT),
        kind: PublicMessageKind.PasswordReset,
        contacts: [emailOf(1)],
      }),
    ).resolves.toEqual(A_PERMIT);
  });

  test("refuses with 429, the kind's words and when to come back, and logs the first refusal once", async () => {
    const refusals: Array<PublicMessageRateLimitException> = [];

    for (let index: number = 0; index < 33; index++) {
      try {
        await PublicMessageRateLimit.assertMaySend({
          req: requestFrom(CLIENT),
          kind: PublicMessageKind.PasswordReset,
          contacts: [emailOf(index)],
        });
      } catch (error) {
        refusals.push(error as PublicMessageRateLimitException);
      }
    }

    expect(refusals).toHaveLength(3);

    for (const refusal of refusals) {
      expect(refusal).toBeInstanceOf(PublicMessageRateLimitException);
      expect(refusal.code).toBe(ExceptionCode.TooManyRequestsException);
      expect(refusal.message).toBe(
        "Too many password resets asked for from your network. Please wait a few minutes and try again.",
      );
      expect(refusal.retryAfterSeconds).toBe(15 * 60);
    }

    const refusedLines: Array<string> = loggerWarnMock.mock.calls
      .map((call: Array<unknown>): string => {
        return String(call[0]);
      })
      .filter((line: string): boolean => {
        return line.startsWith("PublicMessageRateLimit: refused");
      });

    expect(refusedLines).toEqual([
      `PublicMessageRateLimit: refused password-reset from ${CLIENT} (client limit)`,
    ]);
  });

  test("a contact's refusal names its channel in the log, never the contact", async () => {
    for (let index: number = 0; index < 7; index++) {
      try {
        await PublicMessageRateLimit.assertMaySend({
          req: requestFrom(`192.0.2.${index + 1}`),
          kind: PublicMessageKind.StatusPageManageLink,
          contacts: [PublicMessageRateLimit.forPhone("+14155550100")],
        });
      } catch {
        // Refused.
      }
    }

    const lines: string = loggerWarnMock.mock.calls
      .map((call: Array<unknown>): string => {
        return String(call[0]);
      })
      .join("\n");

    expect(lines).toContain(
      "PublicMessageRateLimit: refused status-page-manage-link from 192.0.2.6 (contact limit, text-message)",
    );
    expect(lines).not.toContain("4155550100");
  });

  test("setRetryAfterFor writes Retry-After for its own refusals, and nothing for anything else", () => {
    const headers: Record<string, string> = {};
    const res: ExpressResponse = {
      setHeader: (name: string, value: string): void => {
        headers[name] = value;
      },
    } as unknown as ExpressResponse;

    PublicMessageRateLimit.setRetryAfterFor(
      res,
      new BadDataException("Please enter one email address."),
    );
    expect(headers).toEqual({});

    PublicMessageRateLimit.setRetryAfterFor(
      res,
      new PublicMessageRateLimitException("Too many.", 321),
    );
    expect(headers).toEqual({ "Retry-After": "321" });

    // A response without setHeader is left alone.
    PublicMessageRateLimit.setRetryAfterFor(
      {} as ExpressResponse,
      new PublicMessageRateLimitException("Too many.", 5),
    );
  });
});

describe("while the counter cannot be reached", () => {
  test.each(ALL_KINDS)(
    "%s: an email goes out uncounted, with one warning a minute",
    async (kind: PublicMessageKind) => {
      isConnectedMock.mockReturnValue(false);

      for (let index: number = 0; index < 3; index++) {
        await expect(
          PublicMessageRateLimit.assertMaySend({
            req: requestFrom(CLIENT),
            kind: kind,
            contacts: [emailOf(index)],
          }),
        ).resolves.toEqual(A_PERMIT);
      }

      expect(redis.sent).toEqual([]);
      expect(
        loggerWarnMock.mock.calls.filter((call: Array<unknown>): boolean => {
          return String(call[0]).includes("sending");
        }),
      ).toHaveLength(1);
    },
  );

  test("a sign-up by text message is refused with 503, and nothing is counted", async () => {
    getClientMock.mockReturnValue(null);

    let refusal: unknown = null;

    try {
      await PublicMessageRateLimit.assertMaySend({
        req: requestFrom(CLIENT),
        kind: PublicMessageKind.StatusPageSignUp,
        contacts: [emailOf(1), phoneOf(1)],
      });
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(ServiceUnavailableException);
    expect((refusal as ServiceUnavailableException).code).toBe(
      ExceptionCode.ServiceUnavailableException,
    );
    expect((refusal as ServiceUnavailableException).message).toBe(
      "Sign-ups by text message cannot be accepted right now. Please try again in a few minutes.",
    );
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
  });

  test("a manage link asked for by phone is refused the same, subscribed or not", async () => {
    isConnectedMock.mockReturnValue(false);

    await expect(
      PublicMessageRateLimit.assertMaySend({
        req: requestFrom(CLIENT),
        kind: PublicMessageKind.StatusPageManageLink,
        contacts: [phoneOf(1)],
      }),
    ).rejects.toThrow(
      "Links cannot be sent by text message right now. Please try again in a few minutes.",
    );
  });

  test("a counter that fails mid-request is a counter that cannot be reached", async () => {
    redis.failNextExec = new Error("connection reset");

    await expect(
      PublicMessageRateLimit.assertMaySend({
        req: requestFrom(CLIENT),
        kind: PublicMessageKind.PasswordReset,
        contacts: [emailOf(1)],
      }),
    ).resolves.toEqual(A_PERMIT);

    redis.failNextExec = new Error("connection reset");

    await expect(
      PublicMessageRateLimit.assertMaySend({
        req: requestFrom(CLIENT),
        kind: PublicMessageKind.StatusPageSignUp,
        contacts: [phoneOf(1)],
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  test("a contact counter that fails after the caller's was counted is a counter that cannot be reached too", async () => {
    redis.failCommand = (command: {
      name: string;
      key: string;
    }): Error | null => {
      return command.key.includes(":k:") ? new Error("READONLY") : null;
    };

    const decision: PublicMessageRateLimitDecision = await consume(
      PublicMessageKind.StatusPageSignUp,
      [phoneOf(1)],
    );

    expect(decision.outcome).toBe(
      PublicMessageRateLimitOutcome.CounterUnavailable,
    );
    // The caller's counters were counted before the contact's failed.
    expect(redis.keysHolding(":c:")).toHaveLength(2);
  });
});
