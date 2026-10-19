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
 * A LINK TO CONFIRM A SUBSCRIPTION WORKS FOR A DAY, AND A CONTACT'S OWNER
 * CAN ALWAYS SUBSCRIBE.
 *
 * A visitor who signs up on a status page by email or by text message -
 * and an email address the team asks to confirm first - is sent a link that
 * confirms the subscription; nothing else is sent to the contact until it
 * is opened. That subscription used to wait for its confirmation for good,
 * and to hold its contact on the page all that time: signing the contact up
 * again was told it was subscribed already, and sent nothing. So whoever
 * signed an address or a number up first kept its owner from ever
 * subscribing to that page - its owner was told it was subscribed, and was
 * not - and a link stayed good for as long as the subscription waited.
 *
 * Now a link works for a day after it is sent
 * (StatusPageSubscriberConfirmationCode.VALID_FOR_HOURS):
 *
 *  - while it works, a sign-up of the same contact on the page is told the
 *    link was sent and when it runs out (429, with Retry-After), and sends
 *    nothing: the link went to the contact itself, so its owner has it, and
 *    the contact is sent one such link from a page a day, however often it
 *    is signed up;
 *  - once it has run out, it confirms nothing ("expired"), and the
 *    contact's next sign-up - or the team adding it - replaces the waiting
 *    subscription with a new one, and a new link;
 *  - a confirmed subscription holds its contact as before.
 *
 * And a code minted before codes were 32 characters - six digits - is given
 * up as soon as a wrong code is tried for its subscription, so it can never
 * be guessed at, while the link that carries it still confirms inside its
 * day.
 *
 * Driven through the real routes, as the status page and the dashboard
 * drive them (SubscriberWorld): the real subscriber service, its checks and
 * its messages, with the tables in memory and the clock moved by the test.
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
  CONFIRMATION_LINK_EXPIRED_MESSAGE,
  CONFIRMATION_LINK_SENT_MESSAGE,
  CONFIRMATION_LINK_SENT_TO_EMAIL_MESSAGE,
  CONFIRMATION_LINK_SENT_TO_PHONE_MESSAGE,
  CONTACT_ALREADY_SUBSCRIBED_MESSAGE,
  SubscriptionConfirmationOutcome,
} from "../../../Server/Services/StatusPageSubscriberService";
import PublicMessageRateLimit, {
  PublicMessageContact,
  PublicMessageKind,
} from "../../../Server/Utils/RateLimit/PublicMessageRateLimit";
import StatusPageSubscriberConfirmationCode from "../../../Server/Utils/StatusPage/StatusPageSubscriberConfirmationCode";
import Response from "../../../Server/Utils/Response";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { StoredRow } from "../TestingUtils/InMemoryRepository";
import {
  Answer,
  SubscriberWorld,
  WORLD_PAGE_ID,
  WORLD_PROJECT_ID,
  confirm,
  keepVersionsAsPostgresDoes,
  pageIdOf,
  registerSubscriberRoutes,
  rowsOf,
  setUpSubscriberWorld,
  signUp,
  teamAdd,
  teamUpdate,
  textsSent,
} from "./SubscriberWorld";

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const EMAIL: string = "owner@example.com";
const PHONE: string = "+14155550100";

// Whoever signs the contact up first, and the contact's owner.
const SOMEONE_ELSE: string = "198.51.100.66";
const THE_OWNER: string = "203.0.113.5";

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

interface Channel {
  label: string;
  body: JSONObject;
  contact: () => PublicMessageContact;
  alreadySent: string;
}

const CHANNELS: Array<[string, Channel]> = [
  [
    "an email address",
    {
      label: "email",
      body: { subscriberEmail: EMAIL },
      contact: (): PublicMessageContact => {
        return PublicMessageRateLimit.forEmail(EMAIL);
      },
      alreadySent: CONFIRMATION_LINK_SENT_TO_EMAIL_MESSAGE,
    },
  ],
  [
    "a phone number",
    {
      label: "sms",
      body: { subscriberPhone: PHONE },
      contact: (): PublicMessageContact => {
        return PublicMessageRateLimit.forPhone(PHONE);
      },
      alreadySent: CONFIRMATION_LINK_SENT_TO_PHONE_MESSAGE,
    },
  ],
];

interface Link {
  subscriberId: string;
  code: string;
}

// A link that confirms a subscription, read the way its reader opens it.
function readLink(url: string): Link {
  const parsed: URL = new URL(url);
  const segments: Array<string> = parsed.pathname.split("/");

  expect(segments[segments.length - 2]).toBe("confirm-subscription");

  return {
    subscriberId: segments[segments.length - 1]!,
    code: parsed.searchParams.get("verification-token") || "",
  };
}

// Every link to confirm a subscription that was sent, by email or by text, in order.
function linksSent(): Array<Link> {
  const links: Array<Link> = [];

  for (const call of world.emails.mock.calls) {
    const mail: {
      templateType: EmailTemplateType;
      vars: { confirmationUrl?: string };
    } = call[0] as {
      templateType: EmailTemplateType;
      vars: { confirmationUrl?: string };
    };

    if (mail.templateType === EmailTemplateType.ConfirmStatusPageSubscription) {
      links.push(readLink(String(mail.vars.confirmationUrl)));
    }
  }

  for (const text of textsSent(world)) {
    if (text.message.startsWith("Confirm your subscription")) {
      const words: Array<string> = text.message.split(" ");
      links.push(readLink(words[words.length - 1]!));
    }
  }

  return links;
}

// The welcomes a confirmation sends: the email, and the text.
function welcomesSent(): number {
  const emails: number = world.emails.mock.calls.filter(
    (call: Array<unknown>): boolean => {
      return (
        (call[0] as { templateType: EmailTemplateType }).templateType ===
        EmailTemplateType.SubscribedToStatusPage
      );
    },
  ).length;

  const texts: number = textsSent(world).filter(
    (text: { message: string }): boolean => {
      return text.message.startsWith("You have been subscribed");
    },
  ).length;

  return emails + texts;
}

// A link opened: what the route answered, the error it sent if any.
async function open(link: Link): Promise<Exception | undefined> {
  jest.mocked(Response.sendErrorResponse).mockClear();

  const answer: Answer = await confirm(link.subscriberId, link.code);

  expect(answer.error).toBeUndefined();

  return jest.mocked(Response.sendErrorResponse).mock.calls[0]?.[2] as
    | Exception
    | undefined;
}

function expectNotFound(error: Exception | undefined): void {
  expect(error).toBeInstanceOf(NotFoundException);
  expect(error!.message).toBe(
    "Subscriber not found or confirmation token is invalid",
  );
}

function expectExpired(error: Exception | undefined): void {
  expect(error).toBeInstanceOf(BadDataException);
  expect(error!.message).toBe(CONFIRMATION_LINK_EXPIRED_MESSAGE);
}

function onlyRow(pageId: string = WORLD_PAGE_ID): StoredRow {
  expect(rowsOf(world, pageId)).toHaveLength(1);
  return rowsOf(world, pageId)[0]!;
}

function isConfirmed(link: Link): boolean {
  return (
    world.subscribers.get(link.subscriberId)?.["isSubscriptionConfirmed"] ===
    true
  );
}

// A contact's sign-ups counted in this hour (PublicMessageRateLimit).
function signUpsCountedFor(contact: PublicMessageContact): number {
  return world.redis.count(
    PublicMessageRateLimit.getContactCounterKey({
      counterName: PublicMessageKind.StatusPageSignUp,
      contact: contact,
    }),
  );
}

// A subscription from before codes were 32 characters, still waiting.
function subscriptionFromBefore(data: {
  sentAgo: number;
  code?: string;
  isSubscriptionConfirmed?: boolean;
}): Link {
  const id: string = ObjectID.generate().toString();
  const code: string = data.code || "482913";

  world.subscribers.rows.push({
    _id: id,
    projectId: WORLD_PROJECT_ID,
    statusPageId: WORLD_PAGE_ID,
    subscriberEmail: "earlier@example.com",
    isSubscriptionConfirmed: data.isSubscriptionConfirmed === true,
    isUnsubscribed: false,
    subscriptionConfirmationToken: code,
    sendYouHaveSubscribedMessage: true,
    unsubscribeToken: "5d".repeat(32),
    isAddedByTeam: false,
    createdAt: new Date(Date.now() - data.sentAgo),
  });

  return { subscriberId: id, code: code };
}

describe("a link to confirm a subscription works for a day", () => {
  test.each(CHANNELS)(
    "%s: opened a minute before its day is over, it confirms the subscription, and the welcome is sent",
    async (_label: string, channel: Channel) => {
      expect((await signUp(THE_OWNER, channel.body)).error).toBeUndefined();

      const [link] = linksSent() as [Link];

      world.advance(DAY - MINUTE);

      expect(await open(link)).toBeUndefined();
      expect(isConfirmed(link)).toBe(true);
      expect(welcomesSent()).toBe(1);
    },
  );

  test.each(CHANNELS)(
    "%s: opened once its day is over, it confirms nothing and sends nothing, and says it has expired",
    async (_label: string, channel: Channel) => {
      await signUp(THE_OWNER, channel.body);

      const [link] = linksSent() as [Link];

      world.advance(DAY);

      expectExpired(await open(link));
      expect(isConfirmed(link)).toBe(false);
      expect(welcomesSent()).toBe(0);
    },
  );

  test("opened a year on, it has expired all the same, and the subscription stays unconfirmed", async () => {
    await signUp(SOMEONE_ELSE, { subscriberEmail: EMAIL });

    const [link] = linksSent() as [Link];

    world.advance(365 * DAY);

    expectExpired(await open(link));
    expectExpired(await open(link));
    expect(isConfirmed(link)).toBe(false);
    expect(welcomesSent()).toBe(0);
  });

  test("the expired answer is the subscription's own: a wrong code, or no subscription, is told the link is not valid", async () => {
    await signUp(THE_OWNER, { subscriberEmail: EMAIL });

    const [link] = linksSent() as [Link];

    world.advance(2 * DAY);

    expectNotFound(await open({ ...link, code: "f".repeat(32) }));
    expectNotFound(
      await open({
        subscriberId: ObjectID.generate().toString(),
        code: link.code,
      }),
    );
    expectNotFound(await open({ ...link, code: "" }));
    // Its own code learns it has expired, and writes nothing.
    expectExpired(await open(link));
    expect(world.subscribers.updates).toEqual([]);
  });

  test("a subscription confirmed in its day stays confirmed: its link opened a week on still says so, and sends nothing more", async () => {
    await signUp(THE_OWNER, { subscriberPhone: PHONE });

    const [link] = linksSent() as [Link];
    jest.mocked(Response.sendEmptySuccessResponse).mockClear();

    world.advance(HOUR);
    expect(await open(link)).toBeUndefined();

    world.advance(7 * DAY);
    expect(await open(link)).toBeUndefined();

    expect(isConfirmed(link)).toBe(true);
    expect(welcomesSent()).toBe(1);
    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(2);
  });

  test("the service says which: confirmed, confirmed already, expired, not found", async () => {
    await signUp(THE_OWNER, { subscriberEmail: EMAIL });
    await signUp(THE_OWNER, { subscriberEmail: "second@example.com" });

    const [first, second] = linksSent() as [Link, Link];

    const outcomeOf: (link: Link) => Promise<SubscriptionConfirmationOutcome> =
      async (link: Link): Promise<SubscriptionConfirmationOutcome> => {
        return await StatusPageSubscriberService.confirmSubscription({
          subscriberId: link.subscriberId,
          code: link.code,
        });
      };

    expect(await outcomeOf(first)).toBe(
      SubscriptionConfirmationOutcome.Confirmed,
    );
    expect(await outcomeOf(first)).toBe(
      SubscriptionConfirmationOutcome.AlreadyConfirmed,
    );

    world.advance(DAY);

    expect(await outcomeOf(first)).toBe(
      SubscriptionConfirmationOutcome.AlreadyConfirmed,
    );
    expect(await outcomeOf(second)).toBe(
      SubscriptionConfirmationOutcome.Expired,
    );
    expect(await outcomeOf({ ...second, code: first.code })).toBe(
      SubscriptionConfirmationOutcome.NotFound,
    );
  });
});

describe("signing a contact up again while its link works", () => {
  test.each(CHANNELS)(
    "%s: told the link was sent and when it runs out; nothing is sent or created, and the contact's count is given back",
    async (_label: string, channel: Channel) => {
      await signUp(SOMEONE_ELSE, channel.body);

      expect(linksSent()).toHaveLength(1);
      expect(signUpsCountedFor(channel.contact())).toBe(1);

      // Within the hour the contact's count is kept in.
      world.advance(30 * MINUTE);

      const answer: Answer = await signUp(THE_OWNER, channel.body);

      expect(answer.error?.message).toBe(channel.alreadySent);
      expect(answer.error?.code).toBe(429);
      // The 23 and a half hours the link has left, in seconds.
      expect(answer.retryAfter).toBe(String(23.5 * 60 * 60));

      expect(linksSent()).toHaveLength(1);
      expect(rowsOf(world)).toHaveLength(1);
      expect(signUpsCountedFor(channel.contact())).toBe(1);
    },
  );

  test("the time left counts down to the second, and is never less than one", async () => {
    await signUp(SOMEONE_ELSE, { subscriberEmail: EMAIL });

    world.advance(DAY - HOUR);
    expect((await signUp(THE_OWNER, { subscriberEmail: EMAIL })).retryAfter).toBe(
      String(60 * 60),
    );

    world.advance(HOUR - 1500);
    expect((await signUp(THE_OWNER, { subscriberEmail: EMAIL })).retryAfter).toBe(
      "2",
    );

    world.advance(1000);
    expect((await signUp(THE_OWNER, { subscriberEmail: EMAIL })).retryAfter).toBe(
      "1",
    );
  });

  test("the link the contact was sent still confirms afterwards", async () => {
    await signUp(SOMEONE_ELSE, { subscriberEmail: EMAIL });

    world.advance(2 * HOUR);
    await signUp(THE_OWNER, { subscriberEmail: EMAIL });

    const [link] = linksSent() as [Link];

    expect(await open(link)).toBeUndefined();
    expect(isConfirmed(link)).toBe(true);
  });

  test("however the contact is written, and from wherever", async () => {
    await signUp(SOMEONE_ELSE, { subscriberPhone: PHONE });
    await signUp(SOMEONE_ELSE, { subscriberEmail: EMAIL });

    for (const [index, body] of [
      { subscriberPhone: "14155550100" },
      { subscriberPhone: "0014155550100" },
      { subscriberPhone: "141.555.50100" },
      { subscriberPhone: "+(141)55550100" },
    ].entries()) {
      expect(
        (await signUp(`192.0.2.${index + 10}`, body)).error?.message,
      ).toBe(CONFIRMATION_LINK_SENT_TO_PHONE_MESSAGE);
    }

    for (const body of [
      { subscriberEmail: "Owner@Example.com" },
      { subscriberEmail: " OWNER@EXAMPLE.COM " },
    ]) {
      expect((await signUp(THE_OWNER, body)).error?.message).toBe(
        CONFIRMATION_LINK_SENT_TO_EMAIL_MESSAGE,
      );
    }

    expect(linksSent()).toHaveLength(2);
    expect(rowsOf(world)).toHaveLength(2);
  });

  test("a contact that confirmed is told it is subscribed already, with no time to come back", async () => {
    await signUp(THE_OWNER, { subscriberEmail: EMAIL });

    const [link] = linksSent() as [Link];

    await open(link);

    const answer: Answer = await signUp(SOMEONE_ELSE, {
      subscriberEmail: EMAIL,
    });

    expect(answer.error?.message).toBe(ALREADY_SUBSCRIBED_MESSAGE);
    expect(answer.error?.code).toBe(400);
    expect(answer.retryAfter).toBeUndefined();

    // A confirmed subscription holds its contact for good.
    world.advance(400 * DAY);

    expect(
      (await signUp(SOMEONE_ELSE, { subscriberEmail: EMAIL })).error?.message,
    ).toBe(ALREADY_SUBSCRIBED_MESSAGE);
    expect(linksSent()).toHaveLength(1);
  });

  test("a waiting subscription that names a webhook with its email address: a sign-up of the webhook is told in words that name no channel", async () => {
    // The team asks the address to confirm first; the webhook rides along.
    expect(
      (
        await teamAdd({
          subscriberEmail: EMAIL,
          subscriberWebhook: "https://hooks.example.net/status",
          isSubscriptionConfirmed: false,
        })
      ).error,
    ).toBeUndefined();

    const answer: Answer = await signUp(THE_OWNER, {
      subscriberWebhook: "https://hooks.example.net/status",
    });

    expect(answer.error?.message).toBe(CONFIRMATION_LINK_SENT_MESSAGE);
    expect(answer.error?.code).toBe(429);
  });
});

describe("signing a contact up again once its link has run out", () => {
  test.each(CHANNELS)(
    "%s: a new subscription and a new link replace the waiting one; the old link confirms nothing, the new one confirms",
    async (_label: string, channel: Channel) => {
      await signUp(SOMEONE_ELSE, channel.body);

      const [oldLink] = linksSent() as [Link];

      world.advance(DAY);

      const answer: Answer = await signUp(THE_OWNER, channel.body);

      expect(answer.error).toBeUndefined();

      const [, newLink] = linksSent() as [Link, Link];

      expect(newLink.subscriberId).not.toBe(oldLink.subscriberId);
      expect(newLink.code).not.toBe(oldLink.code);
      expect(StatusPageSubscriberConfirmationCode.isCurrent(newLink.code)).toBe(
        true,
      );

      // The waiting one is gone; the new one waits for its own link.
      const row: StoredRow = onlyRow();
      expect(String(row["_id"])).toBe(newLink.subscriberId);
      expect(row["isSubscriptionConfirmed"]).toBe(false);
      expect(world.subscribers.deletes).toEqual([oldLink.subscriberId]);

      expectNotFound(await open(oldLink));
      expect(await open(newLink)).toBeUndefined();
      expect(isConfirmed(newLink)).toBe(true);
      expect(welcomesSent()).toBe(1);
    },
  );

  test("regression: the owner of an address someone else signed up first subscribes a day later, with their own choices", async () => {
    // Someone else signs the owner's address up; the owner ignores the email.
    await signUp(SOMEONE_ELSE, {
      subscriberEmail: EMAIL,
      isSubscribedToAllResources: false,
    });

    // The owner, who wants the page's updates, is told to use that link.
    world.advance(5 * HOUR);
    expect(
      (await signUp(THE_OWNER, { subscriberEmail: EMAIL })).error?.message,
    ).toBe(CONFIRMATION_LINK_SENT_TO_EMAIL_MESSAGE);

    // Once it has run out, they sign up and are sent a link of their own.
    world.advance(DAY);

    const answer: Answer = await signUp(THE_OWNER, {
      subscriberEmail: EMAIL,
      isSubscribedToAllResources: true,
    });

    expect(answer.error).toBeUndefined();

    const links: Array<Link> = linksSent();
    expect(links).toHaveLength(2);

    expect(await open(links[1]!)).toBeUndefined();

    const row: StoredRow = onlyRow();
    expect(row["isSubscriptionConfirmed"]).toBe(true);
    // What the newest sign-up chose is what is confirmed.
    expect(row["isSubscribedToAllResources"]).toBe(true);
    expect(welcomesSent()).toBe(1);
  });

  test("regression: a number someone else signs up every hour for three days is texted one link a day, and its owner can still subscribe", async () => {
    for (let hour: number = 0; hour < 72; hour++) {
      await signUp(`198.51.100.${(hour % 200) + 1}`, {
        subscriberPhone: PHONE,
      });
      world.advance(HOUR);
    }

    // One link on each of the three days, each replacing the last.
    expect(linksSent()).toHaveLength(3);
    expect(rowsOf(world)).toHaveLength(1);

    // The newest link, sent to the number itself, confirms it.
    const newest: Link = linksSent()[2]!;
    expect(String(onlyRow()["_id"])).toBe(newest.subscriberId);
  });

  test("a subscription that waited from before this - a month old - holds nothing: its contact signs up at once", async () => {
    const earlier: Link = subscriptionFromBefore({ sentAgo: 30 * DAY });

    const answer: Answer = await signUp(THE_OWNER, {
      subscriberEmail: "earlier@example.com",
    });

    expect(answer.error).toBeUndefined();
    expect(world.subscribers.get(earlier.subscriberId)).toBeUndefined();
    expect(linksSent()).toHaveLength(1);
    expectNotFound(await open(earlier));
  });

  test("on another status page the contact is free all along", async () => {
    await signUp(SOMEONE_ELSE, { subscriberEmail: EMAIL });

    const answer: Answer = await signUp(
      THE_OWNER,
      { subscriberEmail: EMAIL },
      pageIdOf(1),
    );

    expect(answer.error).toBeUndefined();
    expect(rowsOf(world)).toHaveLength(1);
    expect(rowsOf(world, pageIdOf(1))).toHaveLength(1);
  });

  test("a cancelled subscription is replaced at once, as before", async () => {
    await signUp(THE_OWNER, { subscriberEmail: EMAIL });

    const [link] = linksSent() as [Link];
    await open(link);

    const row: StoredRow = onlyRow();
    row["isUnsubscribed"] = true;

    expect(
      (await signUp(THE_OWNER, { subscriberEmail: EMAIL })).error,
    ).toBeUndefined();
    expect(world.subscribers.get(link.subscriberId)).toBeUndefined();
    expect(linksSent()).toHaveLength(2);
  });

  test("a waiting subscription confirmed by the team in the meantime is kept: the new one is refused", async () => {
    await signUp(SOMEONE_ELSE, { subscriberEmail: EMAIL });

    const [link] = linksSent() as [Link];

    world.advance(2 * DAY);

    // The team marks it Subscribed: it vouches for the address.
    expect(
      (await teamUpdate(link.subscriberId, { isSubscriptionConfirmed: true }))
        .error,
    ).toBeUndefined();

    expect(
      (await signUp(THE_OWNER, { subscriberEmail: EMAIL })).error?.message,
    ).toBe(ALREADY_SUBSCRIBED_MESSAGE);
    expect(onlyRow()["isSubscriptionConfirmed"]).toBe(true);
  });
});

describe("the team adding a contact", () => {
  test("whose sign-up waits for its confirmation while its link works: refused, saying the rule", async () => {
    await signUp(SOMEONE_ELSE, { subscriberPhone: PHONE });

    world.advance(23 * HOUR);

    const answer: Answer = await teamAdd({
      subscriberPhone: PHONE,
      sendYouHaveSubscribedMessage: false,
    });

    expect(answer.error?.message).toBe(CONTACT_ALREADY_SUBSCRIBED_MESSAGE);
    expect(answer.retryAfter).toBeUndefined();
    expect(rowsOf(world)).toHaveLength(1);
  });

  test("whose sign-up's link has run out: added, and the waiting sign-up removed", async () => {
    await signUp(SOMEONE_ELSE, { subscriberPhone: PHONE });

    const [link] = linksSent() as [Link];

    world.advance(DAY);

    const answer: Answer = await teamAdd({
      subscriberPhone: PHONE,
      sendYouHaveSubscribedMessage: false,
    });

    expect(answer.error).toBeUndefined();

    const row: StoredRow = onlyRow();
    expect(row["isSubscriptionConfirmed"]).toBe(true);
    expect(row["isAddedByTeam"]).toBe(true);
    expect(world.subscribers.get(link.subscriberId)).toBeUndefined();
  });

  test("asked to confirm first: a visitor's sign-up of it while its link works is told the link was sent", async () => {
    await teamAdd({ subscriberEmail: EMAIL, isSubscriptionConfirmed: false });

    expect(linksSent()).toHaveLength(1);

    expect(
      (await signUp(THE_OWNER, { subscriberEmail: EMAIL })).error?.message,
    ).toBe(CONFIRMATION_LINK_SENT_TO_EMAIL_MESSAGE);
    expect(linksSent()).toHaveLength(1);
  });

  test("asked to confirm first, its link run out: the visitor's own sign-up replaces it, and the team adding it again sends a new link", async () => {
    await teamAdd({ subscriberEmail: EMAIL, isSubscriptionConfirmed: false });

    const [teamLink] = linksSent() as [Link];

    world.advance(DAY + HOUR);

    // The team adds it again: a new link replaces the one that ran out.
    expect(
      (await teamAdd({ subscriberEmail: EMAIL, isSubscriptionConfirmed: false }))
        .error,
    ).toBeUndefined();

    const [, secondTeamLink] = linksSent() as [Link, Link];
    expect(world.subscribers.get(teamLink.subscriberId)).toBeUndefined();
    expect(onlyRow()["isAddedByTeam"]).toBe(true);

    world.advance(DAY);

    // A day on, the visitor signs themselves up instead.
    expect(
      (await signUp(THE_OWNER, { subscriberEmail: EMAIL })).error,
    ).toBeUndefined();
    expect(world.subscribers.get(secondTeamLink.subscriberId)).toBeUndefined();
    expect(onlyRow()["isAddedByTeam"]).toBe(false);
    expect(linksSent()).toHaveLength(3);
  });
});

describe("a six-digit code from before codes were 32 characters", () => {
  test("inside its day, the link that carries it confirms, and the welcome is sent", async () => {
    const earlier: Link = subscriptionFromBefore({ sentAgo: 20 * HOUR });

    expect(await open(earlier)).toBeUndefined();
    expect(isConfirmed(earlier)).toBe(true);
    expect(welcomesSent()).toBe(1);
  });

  test("past its day, it has expired like any link", async () => {
    const earlier: Link = subscriptionFromBefore({ sentAgo: DAY });

    expectExpired(await open(earlier));
    expect(isConfirmed(earlier)).toBe(false);
  });

  test("regression: a wrong code gives it up - the right one then confirms nothing, and nothing is sent", async () => {
    const earlier: Link = subscriptionFromBefore({ sentAgo: HOUR });

    expectNotFound(await open({ ...earlier, code: "100000" }));

    const row: StoredRow = world.subscribers.get(earlier.subscriberId)!;
    expect(row["subscriptionConfirmationToken"]).toBeNull();
    expect(row["isSubscriptionConfirmed"]).toBe(false);

    expectNotFound(await open(earlier));
    expect(isConfirmed(earlier)).toBe(false);
    expect(welcomesSent()).toBe(0);
  });

  test("regression: two thousand guesses write once, are each told 'not found', and the right code after them confirms nothing", async () => {
    const earlier: Link = subscriptionFromBefore({ sentAgo: HOUR });

    let notFound: number = 0;

    for (let guess: number = 100000; guess < 102000; guess++) {
      const error: Exception | undefined = await open({
        ...earlier,
        code: String(guess),
      });

      if (error instanceof NotFoundException) {
        notFound++;
      }
    }

    expect(notFound).toBe(2000);
    expect(world.subscribers.updates).toEqual([
      {
        id: earlier.subscriberId,
        set: { subscriptionConfirmationToken: null },
      },
    ]);

    expectNotFound(await open(earlier));
    expect(isConfirmed(earlier)).toBe(false);
    expect(welcomesSent()).toBe(0);
  });

  test("a wrong code for a 32-character code writes nothing, and the right one still confirms after two thousand of them", async () => {
    await signUp(THE_OWNER, { subscriberEmail: EMAIL });

    const [link] = linksSent() as [Link];

    for (let guess: number = 0; guess < 2000; guess++) {
      expectNotFound(
        await open({ ...link, code: guess.toString(16).padStart(32, "0") }),
      );
    }

    expect(world.subscribers.updates).toEqual([]);
    expect(await open(link)).toBeUndefined();
    expect(isConfirmed(link)).toBe(true);
  });

  test("a wrong code for a subscription confirmed already writes nothing", async () => {
    const earlier: Link = subscriptionFromBefore({
      sentAgo: 400 * DAY,
      isSubscriptionConfirmed: true,
    });

    expectNotFound(await open({ ...earlier, code: "100000" }));
    expect(world.subscribers.updates).toEqual([]);
    expect(
      world.subscribers.get(earlier.subscriberId)![
        "subscriptionConfirmationToken"
      ],
    ).toBe("482913");
  });

  test("a code of any other short shape is given up the same way", async () => {
    const earlier: Link = subscriptionFromBefore({
      sentAgo: HOUR,
      code: "7f3a",
    });

    expectNotFound(await open({ ...earlier, code: "7f3b" }));
    expect(
      world.subscribers.get(earlier.subscriberId)![
        "subscriptionConfirmationToken"
      ],
    ).toBeNull();
  });

  test("the right code and wrong ones opened at the same moment: never both confirmed and given up, and at most one welcome", async () => {
    for (let round: number = 0; round < 20; round++) {
      world.subscribers.rows.length = 0;
      world.emails.mockClear();
      world.subscribers.updates.length = 0;

      const earlier: Link = subscriptionFromBefore({ sentAgo: HOUR });
      const row: StoredRow = world.subscribers.get(earlier.subscriberId)!;
      keepVersionsAsPostgresDoes(world, row);

      // The right code somewhere among nineteen wrong ones.
      const codes: Array<string> = Array.from(
        { length: 20 },
        (_unused: unknown, index: number): string => {
          return index === round ? earlier.code : String(200000 + index);
        },
      );

      await Promise.all(
        codes.map((code: string): Promise<Answer> => {
          return confirm(earlier.subscriberId, code);
        }),
      );

      const confirmedNow: boolean = row["isSubscriptionConfirmed"] === true;
      const givenUp: boolean = row["subscriptionConfirmationToken"] === null;

      // Exactly one write landed: the confirmation, or the giving up.
      expect([round, confirmedNow !== givenUp]).toEqual([round, true]);
      expect(world.subscribers.updates).toHaveLength(1);
      expect(welcomesSent()).toBe(confirmedNow ? 1 : 0);
    }
  });

  test("its subscription, the code given up, still waits: the team can mark it subscribed", async () => {
    const earlier: Link = subscriptionFromBefore({ sentAgo: HOUR });

    await open({ ...earlier, code: "100000" });

    expect(
      (await teamUpdate(earlier.subscriberId, { isSubscriptionConfirmed: true }))
        .error,
    ).toBeUndefined();
    expect(isConfirmed(earlier)).toBe(true);
  });
});
