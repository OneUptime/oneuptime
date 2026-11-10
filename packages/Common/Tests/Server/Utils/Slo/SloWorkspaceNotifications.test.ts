import WorkspaceNotificationRuleService from "../../../../Server/Services/WorkspaceNotificationRuleService";
import logger from "../../../../Server/Utils/Logger";
import SloWorkspaceNotifications from "../../../../Server/Utils/Slo/SloWorkspaceNotifications";
import ObjectID from "../../../../Types/ObjectID";
import SloErrorBudgetPolicyChange from "../../../../Types/ServiceLevelObjective/SloErrorBudgetPolicyChange";
import FeedMarkdown, {
  MarkdownText,
} from "../../../../Utils/Markdown/FeedMarkdown";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * The one place an SLO's committed error budget policy change goes to
 * Slack, Microsoft Teams and Mattermost: the project's Service Level
 * Objective rules, by the SLO and what moved, as one message posted by the
 * sender every record's is. Nothing to say asks no rule; a send that fails
 * is logged and goes no further.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SLO_ID: ObjectID = ObjectID.generate();

const MESSAGE: MarkdownText = FeedMarkdown.asMarkdown(
  "📉 [SLO Checkout](https://oneuptime.com/dashboard/slo) entered the **Caution** tier of its error budget policy.",
);

let send: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  send = jest
    .spyOn(WorkspaceNotificationRuleService, "sendWorkspaceMarkdownNotification")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SloWorkspaceNotifications.postPolicyChange", () => {
  test("posts the change once, to the SLO's rules, saying what moved", async () => {
    const changes: Array<SloErrorBudgetPolicyChange> = [
      SloErrorBudgetPolicyChange.EnteredMoreSevereTier,
      SloErrorBudgetPolicyChange.DeploymentsFrozen,
    ];

    await expect(
      SloWorkspaceNotifications.postPolicyChange({
        projectId: PROJECT_ID,
        sloId: SLO_ID,
        changes: changes,
        markdown: MESSAGE,
      }),
    ).resolves.toBe(true);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      notificationFor: {
        serviceLevelObjectiveId: SLO_ID,
        serviceLevelObjectivePolicyChanges: [
          SloErrorBudgetPolicyChange.EnteredMoreSevereTier,
          SloErrorBudgetPolicyChange.DeploymentsFrozen,
        ],
      },
      feedInfoInMarkdown: MESSAGE.toString(),
      workspaceNotification: {
        sendWorkspaceNotification: true,
      },
    });
  });

  test("names nobody as its author: the evaluation decided it, as the feed item says", async () => {
    await SloWorkspaceNotifications.postPolicyChange({
      projectId: PROJECT_ID,
      sloId: SLO_ID,
      changes: [SloErrorBudgetPolicyChange.DeploymentsAllowed],
      markdown: MESSAGE,
    });

    const args: {
      workspaceNotification: Record<string, unknown>;
    } = send.mock.calls[0]![0] as {
      workspaceNotification: Record<string, unknown>;
    };

    expect(args.workspaceNotification["authorUserId"]).toBeUndefined();
    expect(args.workspaceNotification["authorApiKeyName"]).toBeUndefined();
  });

  test("keeps the changes it was handed: changing the list afterwards changes nothing posted", async () => {
    const changes: Array<SloErrorBudgetPolicyChange> = [
      SloErrorBudgetPolicyChange.LeftEveryTier,
    ];

    await SloWorkspaceNotifications.postPolicyChange({
      projectId: PROJECT_ID,
      sloId: SLO_ID,
      changes: changes,
      markdown: MESSAGE,
    });

    changes.push(SloErrorBudgetPolicyChange.DeploymentsAllowed);

    const args: {
      notificationFor: {
        serviceLevelObjectivePolicyChanges: Array<SloErrorBudgetPolicyChange>;
      };
    } = send.mock.calls[0]![0] as {
      notificationFor: {
        serviceLevelObjectivePolicyChanges: Array<SloErrorBudgetPolicyChange>;
      };
    };

    expect(args.notificationFor.serviceLevelObjectivePolicyChanges).toEqual([
      SloErrorBudgetPolicyChange.LeftEveryTier,
    ]);
  });

  test("nothing moved: nothing is posted, and no rule is asked", async () => {
    await expect(
      SloWorkspaceNotifications.postPolicyChange({
        projectId: PROJECT_ID,
        sloId: SLO_ID,
        changes: [],
        markdown: MESSAGE,
      }),
    ).resolves.toBe(false);

    expect(send).not.toHaveBeenCalled();
  });

  test("a send that fails is logged with the SLO and its project, and never thrown", async () => {
    send.mockRejectedValue(new Error("Slack is down") as never);

    await expect(
      SloWorkspaceNotifications.postPolicyChange({
        projectId: PROJECT_ID,
        sloId: SLO_ID,
        changes: [SloErrorBudgetPolicyChange.EnteredMoreSevereTier],
        markdown: MESSAGE,
      }),
    ).resolves.toBe(false);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        `could not post the error budget policy change of SLO ${SLO_ID.toString()} to Slack, Microsoft Teams or Mattermost: Error: Slack is down`,
      ),
      {
        projectId: PROJECT_ID.toString(),
        sloId: SLO_ID.toString(),
      },
    );
  });
});
