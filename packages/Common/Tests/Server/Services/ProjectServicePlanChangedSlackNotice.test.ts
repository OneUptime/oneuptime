import ProjectService from "../../../Server/Services/ProjectService";
import BillingService from "../../../Server/Services/BillingService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import FindBy from "../../../Server/Types/Database/FindBy";
import PlanDowngradeOwnerNotice from "../../../Server/Utils/Billing/PlanDowngradeOwnerNotice";
import logger, { LogAttributes } from "../../../Server/Utils/Logger";
import MarketingEventUtil from "../../../Server/Utils/Marketing/MarketingEventUtil";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import Project from "../../../Models/DatabaseModels/Project";
import SubscriptionPlan, {
  PlanType,
} from "../../../Types/Billing/SubscriptionPlan";
import SubscriptionStatus from "../../../Types/Billing/SubscriptionStatus";
import OneUptimeDate from "../../../Types/Date";
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
 * When a project's plan changes - or its subscription is reactivated, which
 * goes through the same change - the operator's Slack channel
 * (NOTIFICATION_SLACK_WEBHOOK_ON_SUBSCRIPTION_UPDATE) is told which project,
 * who created it, the plan it is on now and its subscription's status; and,
 * when the change replaced subscriptions it could not cancel, which ones are
 * still open at the payment provider (OperatorSlackNotice).
 *
 * - Every value is text: a project, or a creator, named with a mention or a
 *   link neither notifies the channel nor links anywhere, and reads as typed.
 * - The plan change waits on no webhook and never fails with one.
 *
 * Everything below the service boundary is a fake: no database, no Stripe,
 * no Slack.
 */

type MockConfigGlobal = typeof globalThis & {
  __planChangedSlackTestWebhook: string;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockConfigGlobal = globalThis as MockConfigGlobal;
  mockGlobal.__planChangedSlackTestWebhook =
    "https://hooks.slack.com/services/T000/B000/subscription-updates";

  // A plan changes only where OneUptime bills.
  mocked["IsBillingEnabled"] = true;

  /*
   * config.env may carry real incoming webhooks for the operator's channels.
   * Every one is blanked; the one under test is a fake address, and what is
   * posted to it is caught (captureSlackWebhookMessages).
   */
  mocked["NotificationSlackWebhookOnCreateUser"] = "";
  mocked["NotificationSlackWebhookOnCreateProject"] = "";
  mocked["NotificationSlackWebhookOnDeleteProject"] = "";

  Object.defineProperty(
    mocked,
    "NotificationSlackWebhookOnSubscriptionUpdate",
    {
      configurable: true,
      enumerable: true,
      get: (): string => {
        return mockGlobal.__planChangedSlackTestWebhook;
      },
    },
  );

  return mocked;
});

const WEBHOOK_URL: string =
  "https://hooks.slack.com/services/T000/B000/subscription-updates";

function setWebhook(value: string): void {
  (globalThis as MockConfigGlobal).__planChangedSlackTestWebhook = value;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const SUBSCRIPTION_ID: string = "sub_main_123";
const METERED_SUBSCRIPTION_ID: string = "sub_metered_456";
const NEW_SUBSCRIPTION_ID: string = "sub_main_new_789";
const NEW_METERED_SUBSCRIPTION_ID: string = "sub_metered_new_012";
const SCALE_MONTHLY_PLAN_ID: string = "price_monthly_scale";

const SCALE_PLAN: SubscriptionPlan = new SubscriptionPlan(
  SCALE_MONTHLY_PLAN_ID,
  "price_yearly_scale",
  PlanType.Scale,
  99,
  84,
  3,
  0,
);

const PENDING_CANCELLATION_TITLE: string =
  "*Subscriptions could not be cancelled after a plan change:*";
const PLAN_CHANGED_TITLE: string = "*Project Plan Changed:*";

// A message's lines as Slack shows them (TestingUtils/SlackWebhookMessages).
function linesOf(message: SlackWebhookMessage | undefined): Array<string> {
  return shownLines(message?.text);
}

// The message whose first line is the title given.
function messageTitled(title: string): SlackWebhookMessage | undefined {
  return slack.messages.find((message: SlackWebhookMessage): boolean => {
    return linesOf(message)[0] === title;
  });
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

// What changePlan and reactiveSubscription read to make the change.
function billedProject(): Project {
  return {
    id: PROJECT_ID,
    _id: PROJECT_ID.toString(),
    trialEndsAt: OneUptimeDate.getSomeDaysAfter(9),
    paymentProviderCustomerId: "cus_789",
    paymentProviderSubscriptionId: SUBSCRIPTION_ID,
    paymentProviderMeteredSubscriptionId: METERED_SUBSCRIPTION_ID,
    paymentProviderSubscriptionSeats: 4,
    paymentProviderPlanId: "price_monthly_growth",
  } as unknown as Project;
}

// The project as the message reads it again, once the change is written.
function readAgain(values: Partial<Record<string, unknown>> = {}): Project {
  const project: Project = new Project();
  project.id = PROJECT_ID;
  project.name = "Kerberos Compliance Platform";
  project.createdOwnerName = new Name("Jane Doe");
  project.createdOwnerEmail = new Email("jane@acme.example");
  project.planName = PlanType.Scale;
  project.paymentProviderSubscriptionStatus = SubscriptionStatus.Active;

  for (const [column, value] of Object.entries(values)) {
    (project as unknown as Record<string, unknown>)[column] = value;
  }

  return project;
}

// The read the message makes: it alone selects who created the project.
function isMessageRead(findBy: FindBy<Project>): boolean {
  return Boolean(
    (findBy.select as Record<string, unknown>)?.["createdOwnerName"],
  );
}

// Whether a line was logged that names what failed, why, and for which project.
function wasLogged(...parts: Array<string>): boolean {
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
let projectReadAgain: Project;
let findOneById: jest.SpyInstance;
let changePlan: jest.SpyInstance;
let updateOneById: jest.SpyInstance;
let errorLog: jest.SpyInstance;

// The subscriptions the next change replaces but cannot cancel.
function leaveOpen(subscriptionIds: Array<string>): void {
  changePlan.mockResolvedValue({
    subscriptionId: NEW_SUBSCRIPTION_ID,
    meteredSubscriptionId: NEW_METERED_SUBSCRIPTION_ID,
    trialEndsAt: undefined,
    subscriptionIdsPendingCancellation: subscriptionIds,
  } as never);
}

beforeEach(() => {
  setWebhook(WEBHOOK_URL);
  projectReadAgain = readAgain();

  findOneById = jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation((async (findBy: FindBy<Project>) => {
      return isMessageRead(findBy) ? projectReadAgain : billedProject();
    }) as never);

  jest
    .spyOn(SubscriptionPlan, "getSubscriptionPlanById")
    .mockReturnValue(SCALE_PLAN);
  jest
    .spyOn(BillingService, "hasPaymentMethods")
    .mockResolvedValue(true as never);

  changePlan = jest.spyOn(BillingService, "changePlan");
  leaveOpen([]);

  jest
    .spyOn(BillingService, "getSubscriptionStatus")
    .mockResolvedValue(SubscriptionStatus.Active as never);
  updateOneById = jest
    .spyOn(ProjectService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(TeamMemberService, "getUniqueTeamMemberCountInProject")
    .mockResolvedValue(4 as never);
  jest
    .spyOn(PlanDowngradeOwnerNotice, "notifyIfStopped")
    .mockResolvedValue(undefined as never);
  jest.spyOn(ProductAnalytics, "capture").mockReturnValue(undefined);
  jest.spyOn(MarketingEventUtil, "emitInBackground").mockReturnValue(undefined);

  slack = captureSlackWebhookMessages();

  jest.spyOn(logger, "debug").mockImplementation((): void => {});
  errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  setWebhook(WEBHOOK_URL);
});

function changeToScale(): Promise<void> {
  return ProjectService.changePlan({
    projectId: PROJECT_ID,
    paymentProviderPlanId: SCALE_MONTHLY_PLAN_ID,
  });
}

describe("ProjectService.changePlan tells the operator's Slack channel", () => {
  test("which project changed plan, who created it, and the plan and status it has now", async () => {
    await changeToScale();
    await flushBackgroundWork();

    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0]?.url).toBe(WEBHOOK_URL);
    expect(linesOf(slack.messages[0])).toEqual([
      PLAN_CHANGED_TITLE,
      "*Project Name:* Kerberos Compliance Platform",
      `*Project ID:* ${PROJECT_ID.toString()}`,
      "*Project Created By:* Jane Doe (jane@acme.example)",
      "*Plan:* Scale",
      "*Subscription Status:* active",
    ]);
  });

  test("reads the project again, as root, once the change is written", async () => {
    await changeToScale();
    await flushBackgroundWork();

    const messageReadIndex: number = findOneById.mock.calls.findIndex(
      (call: Array<unknown>): boolean => {
        return isMessageRead(call[0] as FindBy<Project>);
      },
    );

    expect(findOneById.mock.calls[messageReadIndex]?.[0]).toEqual({
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
    expect(
      findOneById.mock.invocationCallOrder[messageReadIndex],
    ).toBeGreaterThan(updateOneById.mock.invocationCallOrder[0]!);
  });

  test("a creator known only by their email is named by it", async () => {
    projectReadAgain = readAgain({ createdOwnerName: undefined });

    await changeToScale();
    await flushBackgroundWork();

    expect(linesOf(slack.messages[0])).toContain(
      "*Project Created By:* jane@acme.example",
    );
  });

  test("a project's name and its creator's are text: they notify nobody, link nowhere and read as typed", async () => {
    projectReadAgain = readAgain({
      name: "<!channel> <https://evil.example/pay|Upgrade now> & Co",
      createdOwnerName: new Name("<@U012AB3CD>"),
    });

    await changeToScale();
    await flushBackgroundWork();

    const text: string = slack.messages[0]?.text || "";

    // No "<" they typed reaches Slack: no mention, no link.
    expect(text).not.toContain("<!channel>");
    expect(text).not.toContain("<https://evil.example");
    expect(text).not.toContain("<@U012AB3CD>");

    // What they typed is shown as they typed it.
    expect(linesOf(slack.messages[0])).toContain(
      "*Project Name:* <!channel> <https://evil.example/pay|Upgrade now> & Co",
    );
    expect(linesOf(slack.messages[0])).toContain(
      "*Project Created By:* <@U012AB3CD> (jane@acme.example)",
    );
  });

  test("the subscriptions it replaced but could not cancel are told too, before the change", async () => {
    leaveOpen([SUBSCRIPTION_ID, METERED_SUBSCRIPTION_ID]);

    await changeToScale();
    await flushBackgroundWork();

    expect(slack.messages).toHaveLength(2);
    expect(linesOf(slack.messages[0])).toEqual([
      PENDING_CANCELLATION_TITLE,
      `*Project ID:* ${PROJECT_ID.toString()}`,
      `*Subscriptions still open at the payment provider:* ${SUBSCRIPTION_ID}, ${METERED_SUBSCRIPTION_ID}`,
      "These are no longer recorded against the project and have to be cancelled by hand.",
    ]);
    expect(linesOf(slack.messages[1])[0]).toBe(PLAN_CHANGED_TITLE);

    for (const message of slack.messages) {
      expect(message.url).toBe(WEBHOOK_URL);
    }
  });

  test("when every replaced subscription was cancelled, only the change is told", async () => {
    leaveOpen([]);

    await changeToScale();
    await flushBackgroundWork();

    expect(slack.messages).toHaveLength(1);
    expect(messageTitled(PENDING_CANCELLATION_TITLE)).toBeUndefined();
  });

  test("without the webhook nothing is posted, and the project is not read again for it", async () => {
    setWebhook("");
    leaveOpen([SUBSCRIPTION_ID]);

    await changeToScale();
    await flushBackgroundWork();

    expect(slack.messages).toHaveLength(0);
    expect(
      findOneById.mock.calls.some((call: Array<unknown>): boolean => {
        return isMessageRead(call[0] as FindBy<Project>);
      }),
    ).toBe(false);

    // The subscriptions left open still reach the error log.
    expect(wasLogged(SUBSCRIPTION_ID)).toBe(true);
  });

  test("Slack failing does not fail the plan change: each message is logged with the project", async () => {
    slack.failWith(new Error("socket hang up"));
    leaveOpen([SUBSCRIPTION_ID]);

    await expect(changeToScale()).resolves.toBeUndefined();
    await flushBackgroundWork();

    expect(updateOneById).toHaveBeenCalledTimes(1);
    expect(wasLogged("plan change", "socket hang up")).toBe(true);
    expect(
      wasLogged(
        "subscriptions a plan change could not cancel",
        "socket hang up",
      ),
    ).toBe(true);
  });

  test("a webhook setting that is no address does not fail the plan change: it is logged", async () => {
    setWebhook("not a webhook");
    leaveOpen([SUBSCRIPTION_ID]);

    await expect(changeToScale()).resolves.toBeUndefined();
    await flushBackgroundWork();

    expect(slack.messages).toHaveLength(0);
    expect(wasLogged("plan change")).toBe(true);
    expect(wasLogged("subscriptions a plan change could not cancel")).toBe(
      true,
    );
  });

  test("Slack never answering does not hold the plan change", async () => {
    slack.holdAnswers(true);
    leaveOpen([SUBSCRIPTION_ID]);

    expect(await withinTwoSeconds(changeToScale())).not.toBe("held");
    expect(slack.messages).toHaveLength(2);
  });
});

describe("ProjectService.reactiveSubscription tells the operator's Slack channel", () => {
  test("a reactivated subscription as a plan change, with the subscriptions left open", async () => {
    leaveOpen([METERED_SUBSCRIPTION_ID]);

    await ProjectService.reactiveSubscription(PROJECT_ID);
    await flushBackgroundWork();

    expect(slack.messages).toHaveLength(2);
    expect(linesOf(messageTitled(PENDING_CANCELLATION_TITLE))).toContain(
      `*Subscriptions still open at the payment provider:* ${METERED_SUBSCRIPTION_ID}`,
    );
    expect(linesOf(messageTitled(PLAN_CHANGED_TITLE))).toEqual([
      PLAN_CHANGED_TITLE,
      "*Project Name:* Kerberos Compliance Platform",
      `*Project ID:* ${PROJECT_ID.toString()}`,
      "*Project Created By:* Jane Doe (jane@acme.example)",
      "*Plan:* Scale",
      "*Subscription Status:* active",
    ]);
  });

  test("a project named to notify the channel notifies nobody", async () => {
    projectReadAgain = readAgain({ name: "<!channel> reactivated" });

    await ProjectService.reactiveSubscription(PROJECT_ID);
    await flushBackgroundWork();

    expect(slack.messages[0]?.text).not.toContain("<!channel>");
    expect(linesOf(slack.messages[0])).toContain(
      "*Project Name:* <!channel> reactivated",
    );
  });
});
