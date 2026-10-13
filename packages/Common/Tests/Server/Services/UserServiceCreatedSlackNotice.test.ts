import UserService from "../../../Server/Services/UserService";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import logger, { LogAttributes } from "../../../Server/Utils/Logger";
import MarketingEventUtil from "../../../Server/Utils/Marketing/MarketingEventUtil";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import User from "../../../Models/DatabaseModels/User";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import {
  SlackWebhookMessage,
  SlackWebhookMessages,
  captureSlackWebhookMessages,
  flushBackgroundWork,
  shownLines,
} from "../TestingUtils/SlackWebhookMessages";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * When a user is created - signing up, or invited to a project by email -
 * the operator's Slack channel (NOTIFICATION_SLACK_WEBHOOK_ON_CREATED_USER)
 * is told who: their email, and the name, phone number and company they
 * gave (OperatorSlackNotice).
 *
 * - Every value is text: a name or a company with a mention or a link in it
 *   neither notifies the channel nor links anywhere, and reads as typed.
 * - The signup waits on no webhook and never fails with one: the message is
 *   posted in the background, and a post that fails - or a webhook setting
 *   that is no address - is logged with the user.
 *
 * onCreateSuccess is reached directly: nothing below the service boundary
 * runs - no database, no analytics, no Slack.
 */

type MockConfigGlobal = typeof globalThis & {
  __userCreatedSlackTestWebhook: string;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockConfigGlobal = globalThis as MockConfigGlobal;
  mockGlobal.__userCreatedSlackTestWebhook =
    "https://hooks.slack.com/services/T000/B000/new-users";

  /*
   * config.env may carry real incoming webhooks for the operator's channels.
   * Every one is blanked; the one under test is a fake address, and what is
   * posted to it is caught (captureSlackWebhookMessages).
   */
  mocked["NotificationSlackWebhookOnCreateProject"] = "";
  mocked["NotificationSlackWebhookOnDeleteProject"] = "";
  mocked["NotificationSlackWebhookOnSubscriptionUpdate"] = "";

  Object.defineProperty(mocked, "NotificationSlackWebhookOnCreateUser", {
    configurable: true,
    enumerable: true,
    get: (): string => {
      return mockGlobal.__userCreatedSlackTestWebhook;
    },
  });

  return mocked;
});

const WEBHOOK_URL: string =
  "https://hooks.slack.com/services/T000/B000/new-users";

function setWebhook(value: string): void {
  (globalThis as MockConfigGlobal).__userCreatedSlackTestWebhook = value;
}

const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

// A message's lines as Slack shows them (TestingUtils/SlackWebhookMessages).
function linesOf(message: SlackWebhookMessage | undefined): Array<string> {
  return shownLines(message?.text);
}

async function withinTwoSeconds<T>(promise: Promise<T>): Promise<T | "held"> {
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<"held">((resolve: (value: "held") => void) => {
        timer = setTimeout(() => {
          resolve("held");
        }, 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// A user as created: signed up with every detail the form asks for.
function makeUser(values: Partial<Record<string, unknown>> = {}): User {
  const user: User = new User();
  user.id = USER_ID;
  user.email = new Email("jane@acme.example");
  user.name = new Name("Jane Doe");
  user.companyPhoneNumber = new Phone("+15551234567");
  user.companyName = "Acme Compliance Ltd";

  for (const [column, value] of Object.entries(values)) {
    (user as unknown as Record<string, unknown>)[column] = value;
  }

  return user;
}

// onCreateSuccess is protected - DatabaseService is what calls it.
function callOnCreateSuccess(createdItem: User): Promise<User> {
  return (
    UserService as unknown as {
      onCreateSuccess: (
        onCreate: OnCreate<User>,
        createdItem: User,
      ) => Promise<User>;
    }
  ).onCreateSuccess(
    {
      createBy: { data: createdItem, props: { isRoot: true } },
      carryForward: null,
    } as unknown as OnCreate<User>,
    createdItem,
  );
}

// Whether a line was logged that names what failed, why, and for which user.
function wasLogged(
  errorLog: jest.SpyInstance,
  ...parts: Array<string>
): boolean {
  return errorLog.mock.calls.some((call: Array<unknown>) => {
    return (
      parts.every((part: string): boolean => {
        return String(call[0]).includes(part);
      }) &&
      (call[1] as LogAttributes | undefined)?.userId === USER_ID.toString()
    );
  });
}

let slack: SlackWebhookMessages;
let capture: jest.SpyInstance;
let errorLog: jest.SpyInstance;

beforeEach(() => {
  setWebhook(WEBHOOK_URL);

  slack = captureSlackWebhookMessages();

  capture = jest.spyOn(ProductAnalytics, "capture").mockReturnValue(undefined);
  jest.spyOn(MarketingEventUtil, "emitInBackground").mockReturnValue(undefined);

  errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  setWebhook(WEBHOOK_URL);
});

describe("UserService.onCreateSuccess tells the operator's Slack channel", () => {
  test("who signed up: email, name, phone and company, in the order they always had", async () => {
    await callOnCreateSuccess(makeUser());
    await flushBackgroundWork();

    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0]?.url).toBe(WEBHOOK_URL);
    expect(linesOf(slack.messages[0])).toEqual([
      "*New OneUptime User:*",
      "*Email:* jane@acme.example",
      "*Name:* Jane Doe",
      "*Phone:* +15551234567",
      "*Company:* Acme Compliance Ltd",
    ]);
  });

  test("a user invited by email reads N/A for what they have not given yet", async () => {
    const invited: User = new User();
    invited.id = USER_ID;
    invited.email = new Email("new.member@acme.example");

    await callOnCreateSuccess(invited);
    await flushBackgroundWork();

    expect(linesOf(slack.messages[0])).toEqual([
      "*New OneUptime User:*",
      "*Email:* new.member@acme.example",
      "*Name:* N/A",
      "*Phone:* N/A",
      "*Company:* N/A",
    ]);
  });

  test("a name or a company with a mention or a link in it notifies nobody, links nowhere and reads as typed", async () => {
    await callOnCreateSuccess(
      makeUser({
        name: new Name("<!channel> Jane <@U012AB3CD>"),
        companyName:
          "<https://evil.example/login|Acme> <!here> <!everyone> <#C024BE91L> & Co",
      }),
    );
    await flushBackgroundWork();

    const text: string = slack.messages[0]?.text || "";

    // No "<" they typed reaches Slack: no mention, no link.
    for (const control of [
      "<!channel>",
      "<@U012AB3CD>",
      "<https://evil.example",
      "<!here>",
      "<!everyone>",
      "<#C024BE91L>",
    ]) {
      expect(text).not.toContain(control);
    }

    // What they typed is shown as they typed it.
    expect(linesOf(slack.messages[0])).toEqual([
      "*New OneUptime User:*",
      "*Email:* jane@acme.example",
      "*Name:* <!channel> Jane <@U012AB3CD>",
      "*Phone:* +15551234567",
      "*Company:* <https://evil.example/login|Acme> <!here> <!everyone> <#C024BE91L> & Co",
    ]);
  });

  test("a line break in a company name cannot add a line of its own", async () => {
    await callOnCreateSuccess(
      makeUser({ companyName: "Acme\n*Name:* Somebody Else" }),
    );
    await flushBackgroundWork();

    expect(linesOf(slack.messages[0])).toEqual([
      "*New OneUptime User:*",
      "*Email:* jane@acme.example",
      "*Name:* Jane Doe",
      "*Phone:* +15551234567",
      "*Company:* Acme *Name:* Somebody Else",
    ]);
  });

  test("the rest of the hook still runs: the signup is still counted", async () => {
    await callOnCreateSuccess(makeUser());

    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "server/user_created",
        distinctId: "jane@acme.example",
      }),
    );
  });

  test("without the webhook nothing is posted", async () => {
    setWebhook("");

    await callOnCreateSuccess(makeUser());
    await flushBackgroundWork();

    expect(slack.messages).toHaveLength(0);
    expect(errorLog).not.toHaveBeenCalled();
  });

  test("Slack failing does not fail the signup: it is logged with the user", async () => {
    slack.failWith(new Error("socket hang up"));

    await expect(callOnCreateSuccess(makeUser())).resolves.toBeDefined();
    await flushBackgroundWork();

    expect(slack.messages).toHaveLength(1);
    expect(wasLogged(errorLog, "user creation", "socket hang up")).toBe(true);
  });

  test("a webhook setting that is no address does not fail the signup: it is logged with the user", async () => {
    setWebhook("not a webhook");

    await expect(callOnCreateSuccess(makeUser())).resolves.toBeDefined();
    await flushBackgroundWork();

    expect(slack.messages).toHaveLength(0);
    expect(wasLogged(errorLog, "user creation")).toBe(true);
  });

  test("Slack never answering does not hold the signup", async () => {
    slack.holdAnswers(true);

    expect(await withinTwoSeconds(callOnCreateSuccess(makeUser()))).not.toBe(
      "held",
    );
    expect(slack.messages).toHaveLength(1);
  });
});
