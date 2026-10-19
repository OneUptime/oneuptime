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
  getConfirmSubscriptionTextMessage,
  getYouHaveSubscribedTextMessage,
} from "../../../Server/Services/StatusPageSubscriberService";
import Response from "../../../Server/Utils/Response";
import logger from "../../../Server/Utils/Logger";
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

  test("signing up by email and by text at once asks both to confirm, and either link confirms it", async () => {
    await signUp("192.0.2.1", {
      subscriberPhone: PHONE,
      subscriberEmail: "reader@example.com",
    });

    const row: StoredRow = onlyRow();

    expect(row["isSubscriptionConfirmed"]).toBe(false);
    expect(world.texts).toHaveBeenCalledTimes(1);
    expect(textsSent(world)[0]!.message).toContain(confirmationUrlOf(row));
    expect(world.emails).toHaveBeenCalledTimes(1);
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
    await confirm(
      String(row["_id"]),
      String(row["subscriptionConfirmationToken"]),
    );

    expect(world.texts).toHaveBeenCalledTimes(2);
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
