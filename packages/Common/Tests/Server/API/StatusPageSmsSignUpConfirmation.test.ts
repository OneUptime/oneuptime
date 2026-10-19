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
 * A NUMBER SIGNED UP ON A STATUS PAGE IS CONFIRMED FROM ITS PHONE.
 *
 * A sign-up by text used to be subscribed at once: the number was texted
 * that it was subscribed, and then every incident, maintenance event and
 * announcement of the page, without its owner having confirmed it.
 *
 * Now a sign-up by text is created unconfirmed, as a sign-up by email is,
 * and the number is texted one message: the link that confirms the
 * subscription. Nothing else is sent to it until that link is opened, and
 * opening it sends the "you have been subscribed" text, with the
 * subscription's unsubscribe link. A number the team adds is confirmed at
 * once - the team vouches for it - and so is every subscriber from before.
 * Driven through the real routes (SubscriberWorld).
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
  ONE_CONTACT_PER_SIGN_UP_MESSAGE,
  SubscriptionConfirmationOutcome,
  getConfirmSubscriptionTextMessage,
  getYouHaveSubscribedTextMessage,
} from "../../../Server/Services/StatusPageSubscriberService";
import Response from "../../../Server/Utils/Response";
import logger from "../../../Server/Utils/Logger";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import StatusPageService from "../../../Server/Services/StatusPageService";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Phone from "../../../Types/Phone";
import StatusPageSubscriberUnsubscribe from "../../../Types/StatusPage/StatusPageSubscriberUnsubscribe";
import ObjectID from "../../../Types/ObjectID";
import { StoredRow } from "../TestingUtils/InMemoryRepository";
import {
  Answer,
  SubscriberWorld,
  WORLD_PAGE_ID,
  WORLD_PROJECT_ID,
  confirm,
  registerSubscriberRoutes,
  rowsOf,
  setUpSubscriberWorld,
  signUp,
  teamAdd,
  textsSent,
} from "./SubscriberWorld";

const PHONE: string = "+14155550100";
const STATUS_PAGE_URL: string = "https://status.acme.com";

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

function onlyRow(): StoredRow {
  expect(rowsOf(world)).toHaveLength(1);
  return rowsOf(world)[0]!;
}

function confirmationUrlOf(row: StoredRow): string {
  return `${STATUS_PAGE_URL}/confirm-subscription/${String(row["_id"])}?verification-token=${String(row["subscriptionConfirmationToken"])}`;
}

function unsubscribeUrlOf(row: StoredRow): string {
  return StatusPageSubscriberUnsubscribe.buildLink({
    statusPageUrl: STATUS_PAGE_URL,
    subscriberId: String(row["_id"]),
    unsubscribeToken: String(row["unsubscribeToken"]),
  }).toString();
}

type RowUpdate = (
  where: unknown,
  set: StoredRow,
) => Promise<{ affected: number }>;

/*
 * The subscriber table keeping `row`'s version as Postgres does: an UPDATE
 * that names a version writes the row only while it still holds that
 * version, and moves it on in the same step, under the row's lock
 * (DatabaseService's compare-and-set). The in-memory table keeps no
 * version of its own.
 */
function writeVersionsAsPostgresDoes(row: StoredRow): void {
  row["version"] = 1;

  const update: RowUpdate =
    world.subscribers.repository.update.getMockImplementation() as RowUpdate;

  world.subscribers.repository.update.mockImplementation(
    async (where: unknown, set: StoredRow): Promise<{ affected: number }> => {
      const { version, ...rowOf } = where as StoredRow;
      const target: StoredRow | undefined = world.subscribers.get(
        String(rowOf["_id"]),
      );

      if (target && version !== undefined) {
        // Decided and moved on at once, as one UPDATE statement does.
        if (target["version"] !== version) {
          return { affected: 0 };
        }

        target["version"] = Number(version) + 1;
      }

      return await update(rowOf, set);
    },
  );
}

describe("a visitor signing up by text", () => {
  test("is created unconfirmed, and texted one message: the link that confirms it", async () => {
    const answer: Answer = await signUp("192.0.2.1", {
      subscriberPhone: PHONE,
    });

    expect(answer.error).toBeUndefined();

    const row: StoredRow = onlyRow();

    expect(row["isSubscriptionConfirmed"]).toBe(false);
    expect(row["isAddedByTeam"]).toBe(false);
    // A code nobody can guess: 32 hex characters (StatusPageSubscriberConfirmationCode).
    expect(String(row["subscriptionConfirmationToken"])).toMatch(
      /^[0-9a-f]{32}$/,
    );

    expect(textsSent(world)).toEqual([
      {
        to: PHONE,
        message: getConfirmSubscriptionTextMessage({
          statusPageName: "Acme Status",
          confirmationUrl: confirmationUrlOf(row),
        }),
      },
    ]);
  });

  test("the text names the page, says what to do when it was not them, and ends with the link", async () => {
    await signUp("192.0.2.1", { subscriberPhone: PHONE });

    const row: StoredRow = onlyRow();
    const message: string = textsSent(world)[0]!.message;

    expect(message).toBe(
      `Confirm your subscription to Acme Status by text message. Not you? Ignore this message and nothing more will be sent. ${confirmationUrlOf(row)}`,
    );
    expect(message.endsWith(confirmationUrlOf(row))).toBe(true);
    // Not the welcome: nothing says it is subscribed yet.
    expect(message).not.toContain("You have been subscribed");
    expect(message).not.toContain("/unsubscribe/");
  });

  test("is told to check the phone, and nothing about the subscription goes out by any other channel", async () => {
    await signUp("192.0.2.1", { subscriberPhone: PHONE });

    expect(world.emails).not.toHaveBeenCalled();
    expect(world.webhookCalls).not.toHaveBeenCalled();
    expect(world.slackPosts).not.toHaveBeenCalled();
    expect(world.teamsPosts).not.toHaveBeenCalled();
  });

  test("signing the number up again while it waits sends nothing more: the visitor is told it is subscribed already", async () => {
    await signUp("192.0.2.1", { subscriberPhone: PHONE });

    for (const spelling of [PHONE, "14155550100", "0014155550100"]) {
      const answer: Answer = await signUp("192.0.2.9", {
        subscriberPhone: spelling,
      });

      expect([spelling, answer.error?.message]).toEqual([
        spelling,
        ALREADY_SUBSCRIBED_MESSAGE,
      ]);
    }

    expect(world.texts).toHaveBeenCalledTimes(1);
  });
});

/*
 * A subscription is confirmed by the contact that signed up: the code in its
 * link is the subscription's own, so a sign-up naming a phone number beside
 * an inbox, a chat channel or a webhook its visitor reads would let them
 * confirm the number from there - and the number would be texted every
 * notification without its owner having said yes. So a visitor signs up one
 * contact at a time, as each of the Subscribe page's forms sends it.
 */
describe("a sign-up names one contact", () => {
  const CONTACTS: Record<string, JSONObject> = {
    "an email address": { subscriberEmail: "reader@example.com" },
    "a phone number": { subscriberPhone: PHONE },
    "a webhook": { subscriberWebhook: "https://hooks.example.net/status" },
    "a Slack channel": {
      slackIncomingWebhookUrl:
        "https://hooks.slack.com/services/T0000/B0000/AbCdEf",
      slackWorkspaceName: "Acme",
    },
    "a Microsoft Teams channel": {
      microsoftTeamsIncomingWebhookUrl:
        "https://acme.webhook.office.com/webhookb2/abc@def/IncomingWebhook/123/456",
      microsoftTeamsWorkspaceName: "Acme",
    },
  };

  const PAIRS: Array<[string, string]> = [];
  const names: Array<string> = Object.keys(CONTACTS);

  for (let first: number = 0; first < names.length; first++) {
    for (let second: number = first + 1; second < names.length; second++) {
      PAIRS.push([names[first]!, names[second]!]);
    }
  }

  test.each(PAIRS)(
    "%s with %s: refused before anything is counted, written or sent",
    async (first: string, second: string) => {
      const answer: Answer = await signUp("192.0.2.1", {
        ...CONTACTS[first],
        ...CONTACTS[second],
      });

      expect(answer.error?.message).toBe(ONE_CONTACT_PER_SIGN_UP_MESSAGE);
      expect(rowsOf(world)).toHaveLength(0);
      expect(world.texts).not.toHaveBeenCalled();
      expect(world.emails).not.toHaveBeenCalled();
      expect(world.webhookCalls).not.toHaveBeenCalled();
      expect(world.slackPosts).not.toHaveBeenCalled();
      expect(world.teamsPosts).not.toHaveBeenCalled();
      // Not the visitor, not either contact: nothing was asked of the counter.
      expect(world.redis.keys()).toEqual([]);
    },
  );

  test("all five at once: refused", async () => {
    const answer: Answer = await signUp(
      "192.0.2.1",
      Object.assign({}, ...Object.values(CONTACTS)) as JSONObject,
    );

    expect(answer.error?.message).toBe(ONE_CONTACT_PER_SIGN_UP_MESSAGE);
    expect(rowsOf(world)).toHaveLength(0);
  });

  test.each(names)(
    "%s alone is signed up, as the Subscribe page sends it",
    async (name: string) => {
      const answer: Answer = await signUp("192.0.2.1", {
        ...CONTACTS[name],
      });

      expect(answer.error).toBeUndefined();
      expect(rowsOf(world)).toHaveLength(1);
    },
  );

  test("a workspace name beside its channel is no second contact", async () => {
    const answer: Answer = await signUp("192.0.2.1", {
      ...CONTACTS["a Slack channel"],
    });

    expect(answer.error).toBeUndefined();
    expect(onlyRow()["slackWorkspaceName"]).toBe("Acme");
  });

  test("a sign-up made through the service, not the route, is held to it too, and gives its counts back", async () => {
    const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
    subscriber.statusPageId = new ObjectID(WORLD_PAGE_ID);
    subscriber.projectId = new ObjectID(WORLD_PROJECT_ID);
    subscriber.subscriberEmail = new Email("reader@example.com");
    subscriber.subscriberPhone = new Phone(PHONE);
    subscriber.sendYouHaveSubscribedMessage = true;

    const onNothingSent: ReturnType<typeof jest.fn> = jest.fn(
      async (): Promise<void> => {
        return undefined;
      },
    );

    await expect(
      StatusPageSubscriberService.createFromStatusPageSignUp(subscriber, {
        onNothingSent: onNothingSent as unknown as () => Promise<void>,
      }),
    ).rejects.toThrow(ONE_CONTACT_PER_SIGN_UP_MESSAGE);

    expect(onNothingSent).toHaveBeenCalledTimes(1);
    expect(rowsOf(world)).toHaveLength(0);
    expect(world.texts).not.toHaveBeenCalled();
    expect(world.emails).not.toHaveBeenCalled();
  });

  test("the team may still add one subscriber with an email address and a phone number: it vouches for both", async () => {
    const answer: Answer = await teamAdd({
      subscriberEmail: "reader@example.com",
      subscriberPhone: PHONE,
      isSubscriptionConfirmed: true,
      sendYouHaveSubscribedMessage: false,
    });

    expect(answer.error).toBeUndefined();
    expect(onlyRow()["isSubscriptionConfirmed"]).toBe(true);
  });
});

describe("until it is confirmed", () => {
  test("the page's notifications read only confirmed subscribers, so the number is sent nothing", async () => {
    const findBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      StatusPageSubscriberService,
      "findBy",
    );

    jest
      .spyOn(StatusPageSubscriberService, "getSubscriberRestrictionQuery")
      .mockReturnValue({} as never);

    await signUp("192.0.2.1", { subscriberPhone: PHONE });
    findBy.mockClear();

    const sentTo: Array<unknown> =
      await StatusPageSubscriberService.getSubscribersByStatusPage(
        new ObjectID(WORLD_PAGE_ID),
        { isRoot: true, ignoreHooks: true },
      );

    expect(sentTo).toEqual([]);
    expect(
      (findBy.mock.calls[0]![0] as { query: Record<string, unknown> }).query[
        "isSubscriptionConfirmed"
      ],
    ).toBe(true);
  });
});

describe("opening the link", () => {
  test("confirms the subscription, and texts the welcome with its unsubscribe link", async () => {
    await signUp("192.0.2.1", { subscriberPhone: PHONE });

    const row: StoredRow = onlyRow();
    const answer: Answer = await confirm(
      String(row["_id"]),
      String(row["subscriptionConfirmationToken"]),
    );

    expect(answer.error).toBeUndefined();
    expect(Response.sendEmptySuccessResponse).toHaveBeenCalled();
    expect(row["isSubscriptionConfirmed"]).toBe(true);

    expect(textsSent(world)).toHaveLength(2);
    expect(textsSent(world)[1]).toEqual({
      to: PHONE,
      message: getYouHaveSubscribedTextMessage({
        statusPageName: "Acme Status",
        unsubscribeUrl: unsubscribeUrlOf(row),
      }),
    });
  });

  test("again changes nothing, and sends nothing more", async () => {
    await signUp("192.0.2.1", { subscriberPhone: PHONE });

    const row: StoredRow = onlyRow();

    await confirm(
      String(row["_id"]),
      String(row["subscriptionConfirmationToken"]),
    );

    const updateOneBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      StatusPageSubscriberService,
      "updateOneBy",
    );

    await confirm(
      String(row["_id"]),
      String(row["subscriptionConfirmationToken"]),
    );

    expect(world.texts).toHaveBeenCalledTimes(2);
    // Read as confirmed already, it is not written again.
    expect(updateOneBy).not.toHaveBeenCalled();
  });

  test("eight times at the same moment: confirmed once, and the number texted its welcome once", async () => {
    await signUp("192.0.2.1", { subscriberPhone: PHONE });

    const row: StoredRow = onlyRow();
    writeVersionsAsPostgresDoes(row);
    jest.mocked(Response.sendEmptySuccessResponse).mockClear();

    const answers: Array<Answer> = await Promise.all(
      Array.from({ length: 8 }, (): Promise<Answer> => {
        return confirm(
          String(row["_id"]),
          String(row["subscriptionConfirmationToken"]),
        );
      }),
    );

    for (const answer of answers) {
      expect(answer.error).toBeUndefined();
    }

    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(8);
    expect(row["isSubscriptionConfirmed"]).toBe(true);
    expect(
      textsSent(world).filter((text: { message: string }): boolean => {
        return text.message.startsWith("You have been subscribed");
      }),
    ).toHaveLength(1);
    expect(world.texts).toHaveBeenCalledTimes(2);
  });

  test("an email subscription opened eight times at once: one welcome email", async () => {
    await signUp("192.0.2.1", { subscriberEmail: "reader@example.com" });

    const row: StoredRow = onlyRow();
    writeVersionsAsPostgresDoes(row);
    world.emails.mockClear();

    await Promise.all(
      Array.from({ length: 8 }, (): Promise<Answer> => {
        return confirm(
          String(row["_id"]),
          String(row["subscriptionConfirmationToken"]),
        );
      }),
    );

    expect(row["isSubscriptionConfirmed"]).toBe(true);
    expect(world.emails).toHaveBeenCalledTimes(1);
  });

  test("asks the update to write the subscription only as it was read: not confirmed, at the version read", async () => {
    await signUp("192.0.2.1", { subscriberPhone: PHONE });

    const row: StoredRow = onlyRow();
    row["version"] = 7;

    const updateOneBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      StatusPageSubscriberService,
      "updateOneBy",
    );

    await confirm(
      String(row["_id"]),
      String(row["subscriptionConfirmationToken"]),
    );

    expect(updateOneBy).toHaveBeenCalledTimes(1);
    expect(
      (updateOneBy.mock.calls[0]![0] as { query: Record<string, unknown> })
        .query,
    ).toEqual({
      _id: String(row["_id"]),
      isSubscriptionConfirmed: false,
      version: 7,
    });
  });

  test("a request whose update another one beat to it sends nothing", async () => {
    await signUp("192.0.2.1", { subscriberPhone: PHONE });

    const row: StoredRow = onlyRow();

    jest
      .spyOn(StatusPageSubscriberService, "updateOneBy")
      .mockResolvedValue(0 as never);

    const outcome: SubscriptionConfirmationOutcome =
      await StatusPageSubscriberService.confirmSubscription({
        subscriberId: String(row["_id"]),
        code: String(row["subscriptionConfirmationToken"]),
      });

    expect(outcome).toBe(SubscriptionConfirmationOutcome.AlreadyConfirmed);
    expect(world.texts).toHaveBeenCalledTimes(1);
    expect(world.emails).not.toHaveBeenCalled();
  });

  test.each([
    ["no code", undefined],
    ["a code that is not text", ["0".repeat(32)]],
    ["an id that is not one", "not-an-id"],
  ])("with %s names no subscription", async (label: string, value: unknown) => {
    await signUp("192.0.2.1", { subscriberPhone: PHONE });

    const row: StoredRow = onlyRow();

    const outcome: SubscriptionConfirmationOutcome =
      await StatusPageSubscriberService.confirmSubscription(
        label === "an id that is not one"
          ? {
              subscriberId: value,
              code: String(row["subscriptionConfirmationToken"]),
            }
          : { subscriberId: String(row["_id"]), code: value },
      );

    expect(outcome).toBe(SubscriptionConfirmationOutcome.NotFound);
    expect(row["isSubscriptionConfirmed"]).toBe(false);
    expect(world.texts).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["a wrong code", "000000"],
    ["an empty code", ""],
  ])(
    "with %s confirms nothing and sends nothing",
    async (_label: string, code: string) => {
      await signUp("192.0.2.1", { subscriberPhone: PHONE });

      const row: StoredRow = onlyRow();
      const answer: Answer = await confirm(String(row["_id"]), code);

      expect(row["isSubscriptionConfirmed"]).toBe(false);
      expect(answer.error).toBeUndefined();
      expect(Response.sendErrorResponse).toHaveBeenCalled();
      expect(world.texts).toHaveBeenCalledTimes(1);
    },
  );

  test("of another subscription, with its code, confirms only that one", async () => {
    await signUp("192.0.2.1", { subscriberPhone: PHONE });
    await signUp("192.0.2.2", { subscriberPhone: "+14155550199" });

    const [first, second] = rowsOf(world) as [StoredRow, StoredRow];

    // Two codes known to differ, as two random ones almost always do.
    first["subscriptionConfirmationToken"] = "111111";
    second["subscriptionConfirmationToken"] = "222222";

    await confirm(String(first["_id"]), "222222");
    await confirm(String(second["_id"]), "111111");

    expect(first["isSubscriptionConfirmed"]).toBe(false);
    expect(second["isSubscriptionConfirmed"]).toBe(false);
    expect(world.texts).toHaveBeenCalledTimes(2);

    await confirm(String(second["_id"]), "222222");

    expect(first["isSubscriptionConfirmed"]).toBe(false);
    expect(second["isSubscriptionConfirmed"]).toBe(true);
  });

  test("welcomes the number only when the subscription was made to be told", async () => {
    const id: string = ObjectID.generate().toString();

    world.subscribers.rows.push({
      _id: id,
      projectId: WORLD_PROJECT_ID,
      statusPageId: WORLD_PAGE_ID,
      subscriberPhone: PHONE,
      isSubscriptionConfirmed: false,
      subscriptionConfirmationToken: "123456",
      sendYouHaveSubscribedMessage: false,
      unsubscribeToken: "5c".repeat(32),
      version: 1,
    });

    await confirm(id, "123456");

    expect(world.subscribers.get(id)!["isSubscriptionConfirmed"]).toBe(true);
    expect(world.texts).not.toHaveBeenCalled();
  });

  test("of a page that sends nothing now - archived, or of a blocked project - confirms, and texts no welcome", async () => {
    await signUp("192.0.2.1", { subscriberPhone: PHONE });

    const row: StoredRow = onlyRow();

    jest
      .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
      .mockResolvedValue([]);

    await confirm(
      String(row["_id"]),
      String(row["subscriptionConfirmationToken"]),
    );

    expect(row["isSubscriptionConfirmed"]).toBe(true);
    expect(world.texts).toHaveBeenCalledTimes(1);
  });
});

describe("the code in the link", () => {
  test("is 32 hex characters, new for every sign-up, by text and by email alike", async () => {
    await signUp("192.0.2.1", { subscriberPhone: PHONE });
    await signUp("192.0.2.2", { subscriberEmail: "reader@example.com" });

    const codes: Array<string> = rowsOf(world).map((row: StoredRow): string => {
      return String(row["subscriptionConfirmationToken"]);
    });

    expect(codes).toHaveLength(2);

    for (const code of codes) {
      expect(code).toMatch(/^[0-9a-f]{32}$/);
    }

    expect(codes[0]).not.toBe(codes[1]);
  });

  test("is minted by the server, whatever code the create carried", async () => {
    // The team asking an address to confirm first, through the API.
    const answer: Answer = await teamAdd({
      subscriberEmail: "reader@example.com",
      isSubscriptionConfirmed: false,
      subscriptionConfirmationToken: "123456",
    });

    expect(answer.error).toBeUndefined();

    const row: StoredRow = onlyRow();

    expect(row["subscriptionConfirmationToken"]).not.toBe("123456");
    expect(String(row["subscriptionConfirmationToken"])).toMatch(
      /^[0-9a-f]{32}$/,
    );
  });

  test.each([
    [
      "a six-digit number",
      (_code: string): string => {
        return "482913";
      },
    ],
    [
      "the code's first half",
      (code: string): string => {
        return code.slice(0, 16);
      },
    ],
    [
      "the code with its last character changed",
      (code: string): string => {
        return `${code.slice(0, -1)}${code.endsWith("0") ? "1" : "0"}`;
      },
    ],
    [
      "the code with more after it",
      (code: string): string => {
        return `${code}0`;
      },
    ],
  ])(
    "%s confirms nothing, and sends nothing",
    async (_label: string, guess: (code: string) => string) => {
      await signUp("192.0.2.1", { subscriberPhone: PHONE });

      const row: StoredRow = onlyRow();

      await confirm(
        String(row["_id"]),
        guess(String(row["subscriptionConfirmationToken"])),
      );

      expect(row["isSubscriptionConfirmed"]).toBe(false);
      expect(Response.sendErrorResponse).toHaveBeenCalled();
      expect(world.texts).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    ["by text", { subscriberPhone: PHONE }],
    ["by email", { subscriberEmail: "reader@example.com" }],
  ])(
    "of a sign-up %s is never written to the log",
    async (_label: string, body: Record<string, string>) => {
      await signUp("192.0.2.1", body);

      const code: string = String(onlyRow()["subscriptionConfirmationToken"]);
      const logged: string = JSON.stringify([
        ...jest.mocked(logger.debug).mock.calls,
        ...jest.mocked(logger.info).mock.calls,
        ...jest.mocked(logger.warn).mock.calls,
        ...jest.mocked(logger.error).mock.calls,
      ]);

      expect(code).toMatch(/^[0-9a-f]{32}$/);
      expect(logged).not.toContain(code);
    },
  );

  test("of six digits, as a link sent before carries, still confirms its own subscription", async () => {
    const id: string = ObjectID.generate().toString();

    world.subscribers.rows.push({
      _id: id,
      projectId: WORLD_PROJECT_ID,
      statusPageId: WORLD_PAGE_ID,
      subscriberEmail: "earlier@example.com",
      isSubscriptionConfirmed: false,
      subscriptionConfirmationToken: "482913",
      sendYouHaveSubscribedMessage: false,
      unsubscribeToken: "5d".repeat(32),
      version: 1,
    });

    await confirm(id, "482913");

    expect(world.subscribers.get(id)!["isSubscriptionConfirmed"]).toBe(true);
  });
});

describe("a number the team adds", () => {
  test("is confirmed at once, and texted the welcome when the team asks", async () => {
    const answer: Answer = await teamAdd({
      subscriberPhone: PHONE,
      sendYouHaveSubscribedMessage: true,
    });

    expect(answer.error).toBeUndefined();

    const row: StoredRow = onlyRow();

    expect(row["isSubscriptionConfirmed"]).toBe(true);
    expect(row["isAddedByTeam"]).toBe(true);
    expect(textsSent(world)).toEqual([
      {
        to: PHONE,
        message: getYouHaveSubscribedTextMessage({
          statusPageName: "Acme Status",
          unsubscribeUrl: unsubscribeUrlOf(row),
        }),
      },
    ]);
  });

  test("is sent nothing when the team says not to tell them", async () => {
    await teamAdd({
      subscriberPhone: PHONE,
      sendYouHaveSubscribedMessage: false,
    });

    expect(onlyRow()["isSubscriptionConfirmed"]).toBe(true);
    expect(world.texts).not.toHaveBeenCalled();
  });

  test("is told, as the column's default says, when the create leaves it out (the API, Terraform)", async () => {
    await teamAdd({ subscriberPhone: PHONE });

    const row: StoredRow = onlyRow();

    expect(row["sendYouHaveSubscribedMessage"]).toBe(true);
    expect(textsSent(world)[0]!.message).toContain("You have been subscribed");
  });

  test("is confirmed even when the create asks for it not to be: the team vouches for the numbers it adds", async () => {
    await teamAdd({
      subscriberPhone: PHONE,
      isSubscriptionConfirmed: false,
      sendYouHaveSubscribedMessage: false,
    });

    expect(onlyRow()["isSubscriptionConfirmed"]).toBe(true);
  });
});

describe("the SMS log", () => {
  test("keeps the confirmation text with its code redacted: only the phone gets the link that works", async () => {
    await signUp("192.0.2.1", { subscriberPhone: PHONE });

    const row: StoredRow = onlyRow();
    const message: string = textsSent(world)[0]!.message;
    const logged: string =
      StatusPageSubscriberUnsubscribe.redactCredentials(message);

    expect(logged).not.toContain(String(row["subscriptionConfirmationToken"]));
    expect(logged).toContain(
      `/confirm-subscription/${String(row["_id"])}?verification-token=[redacted]`,
    );
  });
});

describe("the server's own log", () => {
  test("never holds the credentials of the SMS account a page texts through", async () => {
    const AUTH_TOKEN: string = "page-own-twilio-auth-token-5f1d";

    // The page reads with its own Twilio account wherever it is asked for.
    const findPage: typeof StatusPageService.findOneBy =
      StatusPageService.findOneBy.bind(StatusPageService);

    jest
      .spyOn(StatusPageService, "findOneBy")
      .mockImplementation(
        async (
          args: Parameters<typeof StatusPageService.findOneBy>[0],
        ): Promise<StatusPage | null> => {
          const page: StatusPage | null = await findPage(args);

          if (
            page &&
            (args.select as Record<string, unknown>)?.["callSmsConfig"]
          ) {
            const account: ProjectCallSMSConfig = new ProjectCallSMSConfig();
            account._id = ObjectID.generate().toString();
            account.twilioAccountSID = "AC0000000000000000000000000000beef";
            account.twilioAuthToken = AUTH_TOKEN;
            account.twilioPrimaryPhoneNumber = new Phone("+14155550111");
            page.callSmsConfig = account;
          }

          return page;
        },
      );

    await signUp("192.0.2.1", { subscriberPhone: PHONE });
    await teamAdd({
      subscriberPhone: "+14155550199",
      sendYouHaveSubscribedMessage: true,
    });

    // Both texts went out, through the page's own account.
    expect(world.texts).toHaveBeenCalledTimes(2);

    const logged: string = JSON.stringify([
      ...jest.mocked(logger.debug).mock.calls,
      ...jest.mocked(logger.info).mock.calls,
      ...jest.mocked(logger.warn).mock.calls,
      ...jest.mocked(logger.error).mock.calls,
    ]);

    expect(logged).not.toContain(AUTH_TOKEN);
  });
});
