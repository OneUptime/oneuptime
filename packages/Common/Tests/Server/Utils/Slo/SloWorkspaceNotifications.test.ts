import WorkspaceNotificationRuleService from "../../../../Server/Services/WorkspaceNotificationRuleService";
import logger from "../../../../Server/Utils/Logger";
import SloWorkspaceNotifications, {
  SLO_STATUS_POSTS_CACHE_NAMESPACE,
  SLO_STATUS_POSTS_CACHE_SECONDS,
  readSloStatusPost,
} from "../../../../Server/Utils/Slo/SloWorkspaceNotifications";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SloErrorBudgetPolicyChange from "../../../../Types/ServiceLevelObjective/SloErrorBudgetPolicyChange";
import SloStatus from "../../../../Types/ServiceLevelObjective/SloStatus";
import SloStatusChange from "../../../../Types/ServiceLevelObjective/SloStatusChange";
import { SloStatusPostDecision } from "../../../../Utils/Slo/SloStatusPosts";
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
    .spyOn(
      WorkspaceNotificationRuleService,
      "sendWorkspaceMarkdownNotification",
    )
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

/*
 * An SLO's status in Slack, Microsoft Teams and Mattermost (#6596): posted
 * to the rules that pick status changes, at most once an interval and
 * always where the SLO is now, with what the channels last heard kept in
 * the cache. A cache that cannot be read or written, or a send that fails,
 * costs the evaluation nothing.
 */
describe("SloWorkspaceNotifications.postStatusChange", () => {
  const NOW: Date = new Date("2026-11-18T12:00:00.000Z");

  let cache: Map<string, JSONObject>;
  let buildMarkdown: jest.Mock;
  let readSpy: ReturnType<typeof jest.spyOn>;
  let writeSpy: ReturnType<typeof jest.spyOn>;

  function rememberHeard(status: SloStatus, minutesAgo: number): void {
    cache.set(`${SLO_STATUS_POSTS_CACHE_NAMESPACE}-${SLO_ID.toString()}`, {
      status: status,
      postedAt: OneUptimeDate.addRemoveMinutes(NOW, -minutesAgo).toISOString(),
    });
  }

  async function post(
    previousStatus: SloStatus | undefined,
    newStatus: SloStatus,
  ): Promise<SloStatusPostDecision | null> {
    return await SloWorkspaceNotifications.postStatusChange({
      projectId: PROJECT_ID,
      sloId: SLO_ID,
      previousStatus: previousStatus,
      newStatus: newStatus,
      now: NOW,
      buildMarkdown: buildMarkdown as unknown as (
        from: SloStatus | null,
      ) => Promise<MarkdownText | null>,
    });
  }

  beforeEach(() => {
    cache = new Map();
    buildMarkdown = jest.fn(async (from: unknown): Promise<MarkdownText> => {
      return FeedMarkdown.asMarkdown(`said against ${String(from)}`);
    });

    readSpy = jest
      .spyOn(GlobalCache, "getJSONObject")
      .mockImplementation((async (
        namespace: string,
        key: string,
      ): Promise<JSONObject | null> => {
        return cache.get(`${namespace}-${key}`) || null;
      }) as never);

    writeSpy = jest.spyOn(GlobalCache, "setJSON").mockImplementation((async (
      namespace: string,
      key: string,
      value: JSONObject,
    ): Promise<void> => {
      cache.set(`${namespace}-${key}`, value);
    }) as never);
  });

  test("posts a status change to the rules that pick status changes, in the words built for it, and remembers it", async () => {
    await expect(post(SloStatus.Healthy, SloStatus.AtRisk)).resolves.toEqual({
      change: SloStatusChange.BecameAtRisk,
      from: SloStatus.Healthy,
    });

    expect(buildMarkdown).toHaveBeenCalledWith(SloStatus.Healthy);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      notificationFor: {
        serviceLevelObjectiveId: SLO_ID,
        serviceLevelObjectiveStatusChange: SloStatusChange.BecameAtRisk,
      },
      feedInfoInMarkdown: "said against Healthy",
      workspaceNotification: {
        sendWorkspaceNotification: true,
      },
    });

    expect(writeSpy).toHaveBeenCalledWith(
      SLO_STATUS_POSTS_CACHE_NAMESPACE,
      SLO_ID.toString(),
      { status: SloStatus.AtRisk, postedAt: NOW.toISOString() },
      { expiresInSeconds: SLO_STATUS_POSTS_CACHE_SECONDS },
    );
  });

  test("an SLO that holds its status asks no rule and builds nothing", async () => {
    await expect(post(SloStatus.AtRisk, SloStatus.AtRisk)).resolves.toBeNull();

    expect(send).not.toHaveBeenCalled();
    expect(buildMarkdown).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
  });

  test("a flap within the interval is held back, then said once the interval is up, against what the channels heard", async () => {
    rememberHeard(SloStatus.AtRisk, 20);

    await expect(post(SloStatus.AtRisk, SloStatus.Healthy)).resolves.toBeNull();
    expect(send).not.toHaveBeenCalled();

    rememberHeard(SloStatus.AtRisk, 61);

    await expect(post(SloStatus.Healthy, SloStatus.Healthy)).resolves.toEqual({
      change: SloStatusChange.HealthyAgain,
      from: SloStatus.AtRisk,
    });
    expect(buildMarkdown).toHaveBeenCalledWith(SloStatus.AtRisk);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("an exhausted budget is posted at once, inside the interval", async () => {
    rememberHeard(SloStatus.AtRisk, 2);

    await expect(
      post(SloStatus.AtRisk, SloStatus.BudgetExhausted),
    ).resolves.toEqual({
      change: SloStatusChange.BudgetExhausted,
      from: SloStatus.AtRisk,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("a cache that cannot be read goes by the evaluation's own transition, logged", async () => {
    readSpy.mockRejectedValue(new Error("Cache is not connected") as never);

    await expect(post(SloStatus.AtRisk, SloStatus.Healthy)).resolves.toEqual({
      change: SloStatusChange.HealthyAgain,
      from: SloStatus.AtRisk,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("going by its last evaluation"),
      expect.anything(),
    );
  });

  test("a cache that cannot be written still posts, and is logged", async () => {
    writeSpy.mockRejectedValue(new Error("Cache is not connected") as never);

    await expect(post(SloStatus.Healthy, SloStatus.AtRisk)).resolves.toEqual({
      change: SloStatusChange.BecameAtRisk,
      from: SloStatus.Healthy,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("could not remember the status"),
      expect.anything(),
    );
  });

  test("a send that fails is logged with the SLO and its project, never thrown, and not remembered as heard", async () => {
    send.mockRejectedValue(new Error("Slack is down") as never);

    await expect(post(SloStatus.Healthy, SloStatus.AtRisk)).resolves.toBeNull();

    expect(writeSpy).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        `could not post the status change of SLO ${SLO_ID.toString()} to Slack, Microsoft Teams or Mattermost: Error: Slack is down`,
      ),
      {
        projectId: PROJECT_ID.toString(),
        sloId: SLO_ID.toString(),
      },
    );
  });

  test("words that could not be built post nothing", async () => {
    buildMarkdown.mockResolvedValue(null as never);

    await expect(post(SloStatus.Healthy, SloStatus.AtRisk)).resolves.toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  test("reads back only a status and a time it remembered", () => {
    expect(
      readSloStatusPost({
        status: "At Risk",
        postedAt: "2026-11-18T11:00:00.000Z",
      }),
    ).toEqual({
      status: SloStatus.AtRisk,
      postedAt: new Date("2026-11-18T11:00:00.000Z"),
    });
    expect(readSloStatusPost(null)).toBeNull();
    expect(readSloStatusPost({ status: "Degraded", postedAt: "x" })).toBeNull();
    expect(
      readSloStatusPost({ status: "At Risk", postedAt: "not a date" }),
    ).toBeNull();
    expect(readSloStatusPost({ status: "At Risk" })).toBeNull();
  });
});
