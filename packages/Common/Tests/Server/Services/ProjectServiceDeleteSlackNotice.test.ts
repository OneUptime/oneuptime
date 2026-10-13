import ProjectService from "../../../Server/Services/ProjectService";
import BillingService from "../../../Server/Services/BillingService";
import DeletedProjectService from "../../../Server/Services/DeletedProjectService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import logger from "../../../Server/Utils/Logger";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import DeletedProject from "../../../Models/DatabaseModels/DeletedProject";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
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
 * When a project is deleted, the operator's Slack channel
 * (NOTIFICATION_SLACK_WEBHOOK_ON_DELETED_PROJECT) is told - and now with the
 * feedback its owner gave when the dashboard asked "Why are you deleting
 * this project?" (ProjectAPI's delete-project route carries it to the delete
 * hooks as deleteBy.deletionReason).
 *
 * - The feedback is quoted, every line of it, as text: whatever a customer
 *   types neither notifies the channel nor links anywhere.
 * - Only a project that was really deleted is announced, as only one is
 *   recorded (ProjectServiceDeleteAudit).
 * - The project is gone already, so the message can neither fail the delete
 *   nor keep its subscriptions from being cancelled: a payment provider that
 *   does not answer leaves the status the project last had, and Slack is
 *   posted to in the background. The status is read before the
 *   subscriptions are cancelled, so it says what the customer was paying
 *   for.
 *
 * onDeleteSuccess is reached directly, as in ProjectServiceDeleteAudit:
 * nothing below the service boundary runs - no database, no Stripe, no Slack.
 */

type MockConfigGlobal = typeof globalThis & {
  __projectDeleteSlackTestWebhook: string;
  __projectDeleteSlackTestBillingEnabled: boolean;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockConfigGlobal = globalThis as MockConfigGlobal;
  mockGlobal.__projectDeleteSlackTestWebhook =
    "https://hooks.slack.com/services/T000/B000/deleted-projects";
  mockGlobal.__projectDeleteSlackTestBillingEnabled = true;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__projectDeleteSlackTestBillingEnabled;
    },
  });

  Object.defineProperty(mocked, "NotificationSlackWebhookOnDeleteProject", {
    configurable: true,
    enumerable: true,
    get: (): string => {
      return mockGlobal.__projectDeleteSlackTestWebhook;
    },
  });

  return mocked;
});

const WEBHOOK_URL: string =
  "https://hooks.slack.com/services/T000/B000/deleted-projects";

function setWebhook(value: string): void {
  (globalThis as MockConfigGlobal).__projectDeleteSlackTestWebhook = value;
}

function setBillingEnabled(value: boolean): void {
  (globalThis as MockConfigGlobal).__projectDeleteSlackTestBillingEnabled =
    value;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

// A message's lines as Slack shows them (TestingUtils/SlackWebhookMessages).
function linesOf(message: SlackWebhookMessage | undefined): Array<string> {
  return shownLines(message?.text);
}

// What the message quotes of the feedback: the lines after its title.
function feedbackOf(message: SlackWebhookMessage | undefined): Array<string> {
  const lines: Array<string> = linesOf(message);

  return lines.slice(lines.indexOf("*Deletion Feedback:*") + 1);
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

// The snapshot ProjectService.onBeforeDelete reads before the delete.
function makeProject(id: ObjectID = PROJECT_ID, name?: string): Project {
  const project: Project = new Project();
  project._id = id.toString();
  project.name = name || "Kerberos Compliance Platform";
  project.createdAt = new Date("2026-01-15T10:30:00.000Z");
  project.planName = PlanType.Growth;
  project.paymentProviderSubscriptionId = `sub_${id.toString().slice(0, 4)}`;
  project.paymentProviderMeteredSubscriptionId = `sub_metered_${id
    .toString()
    .slice(0, 4)}`;
  project.paymentProviderSubscriptionStatus = SubscriptionStatus.Trialing;

  const creator: User = new User();
  creator.name = new Name("Jane Doe");
  creator.email = new Email("jane@acme.example");
  project.createdByUser = creator;

  return project;
}

function makeDeleteBy(deletionReason?: string): DeleteBy<Project> {
  return {
    query: { _id: PROJECT_ID.toString() },
    limit: 1,
    skip: 0,
    deletionReason: deletionReason,
    props: { isRoot: false, userId: USER_ID },
  } as DeleteBy<Project>;
}

// onDeleteSuccess is protected - DatabaseService is what calls it.
function callOnDeleteSuccess(
  onDelete: OnDelete<Project>,
  deletedIds: Array<ObjectID>,
): Promise<OnDelete<Project>> {
  return (
    ProjectService as unknown as {
      onDeleteSuccess: (
        d: OnDelete<Project>,
        ids: Array<ObjectID>,
      ) => Promise<OnDelete<Project>>;
    }
  ).onDeleteSuccess(onDelete, deletedIds);
}

let slack: SlackWebhookMessages;
let getSubscriptionStatus: jest.SpyInstance;
let cancelSubscription: jest.SpyInstance;
let errorLog: jest.SpyInstance;

beforeEach(() => {
  setWebhook(WEBHOOK_URL);
  setBillingEnabled(true);

  jest
    .spyOn(DeletedProjectService, "logProjectDeletion")
    .mockResolvedValue(new DeletedProject() as never);

  getSubscriptionStatus = jest
    .spyOn(BillingService, "getSubscriptionStatus")
    .mockResolvedValue(SubscriptionStatus.Active as never);

  cancelSubscription = jest
    .spyOn(BillingService, "cancelSubscription")
    .mockResolvedValue(undefined as never);

  slack = captureSlackWebhookMessages();

  errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  setWebhook(WEBHOOK_URL);
  setBillingEnabled(true);
});

describe("ProjectService.onDeleteSuccess tells the operator's Slack channel", () => {
  test("that the project was deleted, with the feedback its owner gave quoted last", async () => {
    await callOnDeleteSuccess(
      {
        deleteBy: makeDeleteBy("Switching to a different tool"),
        carryForward: [makeProject()],
      },
      [PROJECT_ID],
    );
    await flushBackgroundWork();

    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0]?.url).toBe(WEBHOOK_URL);
    expect(linesOf(slack.messages[0])).toEqual([
      "*Project Deleted:*",
      "*Project Name:* Kerberos Compliance Platform",
      `*Project ID:* ${PROJECT_ID.toString()}`,
      "*Project Created Date:* Thu, 15 Jan 2026 10:30:00 GMT",
      "*Project Plan Name:* Growth",
      "*Project Subscription Status:* active",
      "*Created By:* Jane Doe (jane@acme.example)",
      "*Deletion Feedback:*",
      "> Switching to a different tool",
    ]);
  });

  test("feedback over several lines, every line of it", async () => {
    await callOnDeleteSuccess(
      {
        deleteBy: makeDeleteBy(
          "Too expensive for a team of three.\n\nWhat we missed:\n- Terraform\n- SAML",
        ),
        carryForward: [makeProject()],
      },
      [PROJECT_ID],
    );
    await flushBackgroundWork();

    expect(feedbackOf(slack.messages[0])).toEqual([
      "> Too expensive for a team of three.",
      ">",
      "> What we missed:",
      "> - Terraform",
      "> - SAML",
    ]);
  });

  test("a deletion without feedback says none was given", async () => {
    await callOnDeleteSuccess(
      { deleteBy: makeDeleteBy(), carryForward: [makeProject()] },
      [PROJECT_ID],
    );
    await flushBackgroundWork();

    const lines: Array<string> = linesOf(slack.messages[0]);

    expect(lines[lines.length - 1]).toBe("*Deletion Feedback:* _None given_");
  });

  test("feedback can neither notify the channel nor link anywhere", async () => {
    await callOnDeleteSuccess(
      {
        deleteBy: makeDeleteBy(
          "<!channel> you lost us\n<@U012AB3CD> call me: <https://evil.example|our site>",
        ),
        carryForward: [makeProject()],
      },
      [PROJECT_ID],
    );
    await flushBackgroundWork();

    const text: string = slack.messages[0]?.text || "";

    // No "<" the customer typed reaches Slack: no mention, no link.
    expect(text).not.toContain("<!channel>");
    expect(text).not.toContain("<@U012AB3CD>");
    expect(text).not.toContain("<https://evil.example");

    // What they wrote is shown as they wrote it.
    expect(feedbackOf(slack.messages[0])).toEqual([
      "> <!channel> you lost us",
      "> <@U012AB3CD> call me: <https://evil.example|our site>",
    ]);
  });

  test("only a project that was really deleted is announced", async () => {
    await callOnDeleteSuccess(
      {
        deleteBy: makeDeleteBy("Done with it"),
        carryForward: [
          makeProject(PROJECT_ID, "Deleted"),
          makeProject(OTHER_PROJECT_ID, "Still here"),
        ],
      },
      [PROJECT_ID],
    );
    await flushBackgroundWork();

    expect(slack.messages).toHaveLength(1);
    expect(linesOf(slack.messages[0])).toContain("*Project Name:* Deleted");
    expect(getSubscriptionStatus).toHaveBeenCalledTimes(1);
  });

  test("every project deleted at once is announced, each with the feedback", async () => {
    await callOnDeleteSuccess(
      {
        deleteBy: makeDeleteBy("Consolidating into one project"),
        carryForward: [
          makeProject(PROJECT_ID, "First"),
          makeProject(OTHER_PROJECT_ID, "Second"),
        ],
      },
      [PROJECT_ID, OTHER_PROJECT_ID],
    );
    await flushBackgroundWork();

    expect(slack.messages).toHaveLength(2);

    for (const message of slack.messages) {
      expect(feedbackOf(message)).toEqual(["> Consolidating into one project"]);
    }
  });

  test("the subscription status is read before the subscriptions are cancelled", async () => {
    await callOnDeleteSuccess(
      { deleteBy: makeDeleteBy("x"), carryForward: [makeProject()] },
      [PROJECT_ID],
    );

    expect(getSubscriptionStatus).toHaveBeenCalledWith(
      makeProject().paymentProviderSubscriptionId,
    );
    expect(getSubscriptionStatus.mock.invocationCallOrder[0]).toBeLessThan(
      cancelSubscription.mock.invocationCallOrder[0]!,
    );
  });

  test("a payment provider that fails to answer neither fails the delete nor keeps the subscriptions open", async () => {
    getSubscriptionStatus.mockRejectedValue(new Error("stripe is down"));

    await expect(
      callOnDeleteSuccess(
        { deleteBy: makeDeleteBy("Too slow"), carryForward: [makeProject()] },
        [PROJECT_ID],
      ),
    ).resolves.toBeDefined();
    await flushBackgroundWork();

    const project: Project = makeProject();

    expect(cancelSubscription).toHaveBeenCalledWith(
      project.paymentProviderSubscriptionId,
    );
    expect(cancelSubscription).toHaveBeenCalledWith(
      project.paymentProviderMeteredSubscriptionId,
    );

    // The message still goes, with the status the project last had.
    expect(slack.messages).toHaveLength(1);
    expect(linesOf(slack.messages[0])).toContain(
      "*Project Subscription Status:* trialing",
    );
    expect(feedbackOf(slack.messages[0])).toEqual(["> Too slow"]);
    expect(errorLog).toHaveBeenCalled();
  });

  test("a project with no subscription is not asked about at the payment provider", async () => {
    const project: Project = makeProject();
    delete project.paymentProviderSubscriptionId;
    delete project.paymentProviderSubscriptionStatus;

    await callOnDeleteSuccess(
      { deleteBy: makeDeleteBy("x"), carryForward: [project] },
      [PROJECT_ID],
    );
    await flushBackgroundWork();

    expect(getSubscriptionStatus).not.toHaveBeenCalled();
    expect(slack.messages).toHaveLength(1);
    expect(slack.messages[0]?.text).not.toContain("Subscription Status");
  });

  test("where OneUptime does not bill, the payment provider is not asked, and the feedback still goes", async () => {
    setBillingEnabled(false);

    await callOnDeleteSuccess(
      {
        deleteBy: makeDeleteBy("Moving to the cloud"),
        carryForward: [makeProject()],
      },
      [PROJECT_ID],
    );
    await flushBackgroundWork();

    expect(getSubscriptionStatus).not.toHaveBeenCalled();
    expect(feedbackOf(slack.messages[0])).toEqual(["> Moving to the cloud"]);
  });

  test("without the webhook nothing is posted, and the payment provider is not asked for the message", async () => {
    setWebhook("");

    await callOnDeleteSuccess(
      { deleteBy: makeDeleteBy("x"), carryForward: [makeProject()] },
      [PROJECT_ID],
    );
    await flushBackgroundWork();

    expect(slack.messages).toHaveLength(0);
    expect(getSubscriptionStatus).not.toHaveBeenCalled();
    expect(cancelSubscription).toHaveBeenCalled();
  });

  test("Slack failing neither fails the delete nor keeps the subscriptions open", async () => {
    slack.failWith(new Error("socket hang up"));

    await expect(
      callOnDeleteSuccess(
        { deleteBy: makeDeleteBy("x"), carryForward: [makeProject()] },
        [PROJECT_ID],
      ),
    ).resolves.toBeDefined();
    await flushBackgroundWork();

    expect(cancelSubscription).toHaveBeenCalledTimes(2);
    expect(
      errorLog.mock.calls.some((call: Array<unknown>) => {
        return (
          String(call[0]).includes("project deletion") &&
          String(call[0]).includes("socket hang up")
        );
      }),
    ).toBe(true);
  });

  test("Slack never answering does not hold the delete", async () => {
    slack.holdAnswers(true);

    expect(
      await withinTwoSeconds(
        callOnDeleteSuccess(
          { deleteBy: makeDeleteBy("x"), carryForward: [makeProject()] },
          [PROJECT_ID],
        ),
      ),
    ).not.toBe("held");
    expect(cancelSubscription).toHaveBeenCalledTimes(2);
  });

  test("the deletion is still recorded with its reason, before the channel is told", async () => {
    const logProjectDeletion: jest.SpyInstance = jest.spyOn(
      DeletedProjectService,
      "logProjectDeletion",
    );

    await callOnDeleteSuccess(
      {
        deleteBy: makeDeleteBy("Switching to a different tool"),
        carryForward: [makeProject()],
      },
      [PROJECT_ID],
    );
    await flushBackgroundWork();

    expect(logProjectDeletion).toHaveBeenCalledWith(
      expect.objectContaining({
        deletionReason: "Switching to a different tool",
      }),
    );

    const post: jest.Mock =
      SlackUtil.sendMessageToChannelViaIncomingWebhook as unknown as jest.Mock;

    expect(logProjectDeletion.mock.invocationCallOrder[0]).toBeLessThan(
      post.mock.invocationCallOrder[0]!,
    );
  });
});
