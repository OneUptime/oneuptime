import ProjectService from "../../../Server/Services/ProjectService";
import BillingService from "../../../Server/Services/BillingService";
import FindBy from "../../../Server/Types/Database/FindBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import logger, { LogAttributes } from "../../../Server/Utils/Logger";
import MarketingEventUtil from "../../../Server/Utils/Marketing/MarketingEventUtil";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import Project from "../../../Models/DatabaseModels/Project";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import SubscriptionStatus from "../../../Types/Billing/SubscriptionStatus";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import {
  SlackWebhookMessage,
  SlackWebhookMessages,
  captureSlackWebhookMessages,
  flushBackgroundWork,
  shownLines,
} from "../TestingUtils/SlackWebhookMessages";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * When a project is created, the operator's Slack channel
 * (NOTIFICATION_SLACK_WEBHOOK_ON_CREATED_PROJECT) is told: its name, who
 * created it and, where OneUptime bills, the plan it is on and its
 * subscription's status (OperatorSlackNotice).
 *
 * - Every project is announced. The message used to go only when its
 *   creator had both a name and an email, so a project created by a user
 *   with no name - one made by an invitation or by SSO - was never told.
 * - Every value is text: a project, or a creator, named with a mention or a
 *   link neither notifies the channel nor links anywhere, and reads as typed.
 * - The create waits on no webhook and never fails with one.
 *
 * onCreateSuccess is reached directly, as in
 * ProjectServiceCreateSubscriptionStarted: nothing below the service
 * boundary runs - no database, no Stripe, no analytics, no Slack.
 */

type MockConfigGlobal = typeof globalThis & {
  __projectCreatedSlackTestWebhook: string;
  __projectCreatedSlackTestBillingEnabled: boolean;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockConfigGlobal = globalThis as MockConfigGlobal;
  mockGlobal.__projectCreatedSlackTestWebhook =
    "https://hooks.slack.com/services/T000/B000/new-projects";
  mockGlobal.__projectCreatedSlackTestBillingEnabled = true;

  /*
   * config.env may carry real incoming webhooks for the operator's channels.
   * Every one is blanked; the one under test is a fake address, and what is
   * posted to it is caught (captureSlackWebhookMessages).
   */
  mocked["NotificationSlackWebhookOnCreateUser"] = "";
  mocked["NotificationSlackWebhookOnDeleteProject"] = "";
  mocked["NotificationSlackWebhookOnSubscriptionUpdate"] = "";

  Object.defineProperty(mocked, "NotificationSlackWebhookOnCreateProject", {
    configurable: true,
    enumerable: true,
    get: (): string => {
      return mockGlobal.__projectCreatedSlackTestWebhook;
    },
  });

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__projectCreatedSlackTestBillingEnabled;
    },
  });

  return mocked;
});

const WEBHOOK_URL: string =
  "https://hooks.slack.com/services/T000/B000/new-projects";

function setWebhook(value: string): void {
  (globalThis as MockConfigGlobal).__projectCreatedSlackTestWebhook = value;
}

function setBillingEnabled(value: boolean): void {
  (globalThis as MockConfigGlobal).__projectCreatedSlackTestBillingEnabled =
    value;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const GROWTH_MONTHLY_PLAN_ID: string = "price_monthly_growth";

const GROWTH_PLAN: SubscriptionPlan = new SubscriptionPlan(
  GROWTH_MONTHLY_PLAN_ID,
  "price_yearly_growth",
  PlanType.Growth,
  49,
  45,
  2,
  14,
);

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

// The project as the create wrote it.
function createdProject(): Project {
  const project: Project = new Project();
  project.id = PROJECT_ID;
  project.name = "Kerberos Compliance Platform";
  project.paymentProviderPlanId = GROWTH_MONTHLY_PLAN_ID;
  project.planName = PlanType.Growth;
  project.createdOwnerName = new Name("Jane Doe");
  project.createdOwnerEmail = new Email("jane@acme.example");
  return project;
}

/*
 * The project as the message reads it again, once billing has subscribed
 * it: what the create wrote, and its subscription's status.
 */
function readAgain(values: Partial<Record<string, unknown>> = {}): Project {
  const project: Project = createdProject();
  project.paymentProviderSubscriptionStatus = SubscriptionStatus.Trialing;

  for (const [column, value] of Object.entries(values)) {
    (project as unknown as Record<string, unknown>)[column] = value;
  }

  return project;
}

// onCreateSuccess is protected - DatabaseService is what calls it.
function callOnCreateSuccess(): Promise<Project> {
  return (
    ProjectService as unknown as {
      onCreateSuccess: (
        onCreate: OnCreate<Project>,
        createdItem: Project,
      ) => Promise<Project>;
    }
  ).onCreateSuccess({} as OnCreate<Project>, createdProject());
}

// Whether a line was logged that names what failed, why, and for which project.
function wasLogged(
  errorLog: jest.SpyInstance,
  ...parts: Array<string>
): boolean {
  return errorLog.mock.calls.some((call: Array<unknown>) => {
    return (
      parts.every((part: string): boolean => {
        return String(call[0]).includes(part);
      }) &&
      (call[1] as LogAttributes | undefined)?.projectId ===
        PROJECT_ID.toString()
    );
  });
}

let slack: SlackWebhookMessages;
let findOneById: jest.SpyInstance;
let errorLog: jest.SpyInstance;

beforeEach(() => {
  setWebhook(WEBHOOK_URL);
  setBillingEnabled(true);

  // Billing subscribes the new project: Stripe is a fake.
  jest
    .spyOn(BillingService, "createCustomer")
    .mockResolvedValue("cus_created_123" as never);
  jest
    .spyOn(SubscriptionPlan, "getSubscriptionPlanById")
    .mockReturnValue(GROWTH_PLAN);
  jest.spyOn(BillingService, "subscribeToPlan").mockResolvedValue({
    subscriptionId: "sub_main_created",
    meteredSubscriptionId: "sub_metered_created",
    trialEndsAt: null,
  } as never);
  jest
    .spyOn(ProjectService, "updateOneById")
    .mockResolvedValue(undefined as never);

  /*
   * The default rows every new project is seeded with - severities, states,
   * teams, roles - are not what is under test: every seeder is stubbed,
   * whatever seeders there are.
   */
  for (const seeder of Object.getOwnPropertyNames(
    Object.getPrototypeOf(ProjectService),
  ).filter((name: string): boolean => {
    return name.startsWith("addDefault");
  })) {
    jest
      .spyOn(ProjectService as unknown as Record<string, () => unknown>, seeder)
      .mockResolvedValue(undefined as never);
  }

  jest.spyOn(ProductAnalytics, "capture").mockReturnValue(undefined);
  jest.spyOn(MarketingEventUtil, "emitInBackground").mockReturnValue(undefined);

  findOneById = jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue(readAgain() as never);

  slack = captureSlackWebhookMessages();

  errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  setWebhook(WEBHOOK_URL);
  setBillingEnabled(true);
});

describe("ProjectService.onCreateSuccess tells the operator's Slack channel", () => {
  test("that the project was created, by whom and on which plan, in the order it always had", async () => {
    await callOnCreateSuccess();
    await flushBackgroundWork();

    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0]?.url).toBe(WEBHOOK_URL);
    expect(linesOf(slack.messages[0])).toEqual([
      "*Project Created:*",
      "*Project Name:* Kerberos Compliance Platform",
      `*Project ID:* ${PROJECT_ID.toString()}`,
      "*Created By:* Jane Doe (jane@acme.example)",
      "*Plan:* Growth",
      "*Subscription Status:* trialing",
    ]);
  });

  test("a project whose creator has no name is announced too, by their email", async () => {
    findOneById.mockResolvedValue(
      readAgain({ createdOwnerName: undefined }) as never,
    );

    await callOnCreateSuccess();
    await flushBackgroundWork();

    expect(slack.messages).toHaveLength(1);
    expect(linesOf(slack.messages[0])).toEqual([
      "*Project Created:*",
      "*Project Name:* Kerberos Compliance Platform",
      `*Project ID:* ${PROJECT_ID.toString()}`,
      "*Created By:* jane@acme.example",
      "*Plan:* Growth",
      "*Subscription Status:* trialing",
    ]);
  });

  test("where OneUptime does not bill, the project is announced without a plan", async () => {
    setBillingEnabled(false);

    await callOnCreateSuccess();
    await flushBackgroundWork();

    expect(BillingService.subscribeToPlan).not.toHaveBeenCalled();
    expect(linesOf(slack.messages[0])).toEqual([
      "*Project Created:*",
      "*Project Name:* Kerberos Compliance Platform",
      `*Project ID:* ${PROJECT_ID.toString()}`,
      "*Created By:* Jane Doe (jane@acme.example)",
    ]);
  });

  test("a project's name and its creator's are text: they notify nobody, link nowhere and read as typed", async () => {
    findOneById.mockResolvedValue(
      readAgain({
        name: "<!channel> Acme & Co <https://evil.example/login|Reset your password>",
        createdOwnerName: new Name("<@U012AB3CD> <!here>"),
      }) as never,
    );

    await callOnCreateSuccess();
    await flushBackgroundWork();

    const text: string = slack.messages[0]?.text || "";

    // No "<" they typed reaches Slack: no mention, no link.
    expect(text).not.toContain("<!channel>");
    expect(text).not.toContain("<https://evil.example");
    expect(text).not.toContain("<@U012AB3CD>");
    expect(text).not.toContain("<!here>");

    // What they typed is shown as they typed it.
    expect(linesOf(slack.messages[0])).toContain(
      "*Project Name:* <!channel> Acme & Co <https://evil.example/login|Reset your password>",
    );
    expect(linesOf(slack.messages[0])).toContain(
      "*Created By:* <@U012AB3CD> <!here> (jane@acme.example)",
    );
  });

  test("reads the project again, as root, once billing has subscribed it", async () => {
    await callOnCreateSuccess();
    await flushBackgroundWork();

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(findOneById.mock.calls[0]?.[0] as FindBy<Project>).toEqual({
      id: PROJECT_ID,
      select: {
        name: true,
        _id: true,
        createdOwnerName: true,
        createdOwnerEmail: true,
        planName: true,
        createdByUserId: true,
        paymentProviderSubscriptionStatus: true,
      },
      props: { isRoot: true },
    });
    expect(findOneById.mock.invocationCallOrder[0]).toBeGreaterThan(
      (BillingService.subscribeToPlan as unknown as jest.Mock).mock
        .invocationCallOrder[0]!,
    );
  });

  test("without the webhook nothing is posted, and the project is not read again for it", async () => {
    setWebhook("");

    await callOnCreateSuccess();
    await flushBackgroundWork();

    expect(slack.messages).toHaveLength(0);
    expect(findOneById).not.toHaveBeenCalled();
  });

  test("Slack failing does not fail the create: it is logged with the project", async () => {
    slack.failWith(new Error("socket hang up"));

    await expect(callOnCreateSuccess()).resolves.toBeDefined();
    await flushBackgroundWork();

    expect(slack.messages).toHaveLength(1);
    expect(wasLogged(errorLog, "project creation", "socket hang up")).toBe(
      true,
    );
  });

  test("a webhook setting that is no address does not fail the create: it is logged", async () => {
    setWebhook("not a webhook");

    await expect(callOnCreateSuccess()).resolves.toBeDefined();
    await flushBackgroundWork();

    expect(slack.messages).toHaveLength(0);
    expect(wasLogged(errorLog, "project creation")).toBe(true);
  });

  test("Slack never answering does not hold the create", async () => {
    slack.holdAnswers(true);

    expect(await withinTwoSeconds(callOnCreateSuccess())).not.toBe("held");
    expect(slack.messages).toHaveLength(1);
  });
});
