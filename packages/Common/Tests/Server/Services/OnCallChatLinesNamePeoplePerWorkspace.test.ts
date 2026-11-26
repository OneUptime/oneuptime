import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyUserOverride from "../../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import User from "../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyFeedService from "../../../Server/Services/OnCallDutyPolicyFeedService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyTimeLogService from "../../../Server/Services/OnCallDutyPolicyTimeLogService";
import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import OnDutyPoliciesCache from "../../../Server/Utils/OnCall/OnDutyPoliciesCache";
import MattermostUtil from "../../../Server/Utils/Workspace/Mattermost/Mattermost";
import WorkspaceUtil from "../../../Server/Utils/Workspace/Workspace";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { MarkdownText, mdText } from "../../../Utils/Markdown/FeedMarkdown";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * ON-CALL CHAT LINES NAME PEOPLE AS THE HAND-OFF LINES DO (#7967).
 *
 * A hand-off's line names the person on call as each connected workspace
 * knows them - "@ana.lee" in Slack once Ana connected her Slack account -
 * but the other on-call lines named everybody but their author by their
 * OneUptime name, so one channel read "@ana.lee" in one line and "Ana Lee"
 * in the next. Each of them now has a line for each workspace:
 *
 *   ❌ @dana removed an override on Payments: @ana.lee is paged on their turns again.
 *   👨🏻‍💻 @dana added **@ana.lee** to on-call policy Payments.
 *   👨🏻‍💻 @dana removed **@ana.lee** from on-call policy Payments.
 *
 * Where she did not connect - Microsoft Teams here - she keeps her
 * OneUptime name. The policy's feed keeps OneUptime's names. Mattermost
 * breaks the "@", so nobody is pinged. (Added and changed overrides are
 * driven through the real create and update in OnCallDutyPolicyUserOverride
 * Skip and Edit.)
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "79670000-0000-4000-8000-0000000000f1",
);
const POLICY_ID: ObjectID = new ObjectID(
  "79670000-0000-4000-8000-0000000000f2",
);
const RULE_ID: ObjectID = new ObjectID("79670000-0000-4000-8000-0000000000f3");
const ANA: ObjectID = new ObjectID("79670000-0000-4000-8000-0000000000a1");
const DANA: ObjectID = new ObjectID("79670000-0000-4000-8000-0000000000d1");

const POLICY_LINK: string = "https://oneuptime.test/policies/payments";
const ANA_LINK: string = "https://oneuptime.test/users/ana";

type FeedItem = Parameters<
  typeof OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem
>[0];

let items: Array<FeedItem>;

function connect(workspaceTypes: Array<WorkspaceType>): void {
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
    .mockResolvedValue(
      workspaceTypes.map(
        (workspaceType: WorkspaceType): WorkspaceProjectAuthToken => {
          const auth: WorkspaceProjectAuthToken =
            new WorkspaceProjectAuthToken();
          auth.workspaceType = workspaceType;
          auth.authToken = "token";
          return auth;
        },
      ),
    );
}

beforeEach(() => {
  items = [];

  connect([
    WorkspaceType.Slack,
    WorkspaceType.MicrosoftTeams,
    WorkspaceType.Mattermost,
  ]);

  // Ana connected Slack and Mattermost; not Microsoft Teams.
  jest
    .spyOn(WorkspaceUtil, "getUserStringForWorkspace")
    .mockImplementation((async (data: {
      workspaceType: WorkspaceType;
    }): Promise<string> => {
      return data.workspaceType === WorkspaceType.MicrosoftTeams
        ? `[Ana Lee](${ANA_LINK}) `
        : "@ana.lee ";
    }) as never);
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue(mdText`[Ana Lee](${ANA_LINK})` as never);
  jest.spyOn(UserService, "getTimezoneForUser").mockResolvedValue(null);

  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyName")
    .mockResolvedValue("Payments");
  jest
    .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
    .mockResolvedValue(URL.fromString(POLICY_LINK));

  jest
    .spyOn(OnCallDutyPolicyFeedService, "createOnCallDutyPolicyFeedItem")
    .mockImplementation((async (item: FeedItem): Promise<void> => {
      items.push(item);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an override taken back", () => {
  async function removeOverride(): Promise<void> {
    const override: OnCallDutyPolicyUserOverride =
      new OnCallDutyPolicyUserOverride();
    override.onCallDutyPolicyId = POLICY_ID;
    override.projectId = PROJECT_ID;
    override.overrideUserId = ANA;
    override.startsAt = new Date("2026-11-16T14:00:00.000Z");
    override.endsAt = new Date("2026-11-20T22:00:00.000Z");

    jest
      .spyOn(OnCallDutyPolicyUserOverrideService, "findRowsAndHoldDeleteToThem")
      .mockResolvedValue([override] as never);

    await (
      OnCallDutyPolicyUserOverrideService as unknown as {
        onBeforeDelete: (deleteBy: unknown) => Promise<unknown>;
      }
    ).onBeforeDelete({
      query: { _id: ObjectID.generate() },
      props: { userId: DANA },
    });
  }

  test("REGRESSION: each workspace's line names the person as it knows them", async () => {
    await removeOverride();

    expect(items).toHaveLength(1);
    expect(items[0]!.chatInfoByWorkspaceType).toEqual({
      [WorkspaceType.Slack]: `❌ Removed an override on [Payments](${POLICY_LINK}): @ana.lee is paged on their turns again.`,
      [WorkspaceType.MicrosoftTeams]: `❌ Removed an override on [Payments](${POLICY_LINK}): [Ana Lee](${ANA_LINK}) is paged on their turns again.`,
      [WorkspaceType.Mattermost]: `❌ Removed an override on [Payments](${POLICY_LINK}): @ana.lee is paged on their turns again.`,
    });
  });

  test("the feed, and the line for a workspace with none of its own, keep her OneUptime name; whoever removed it leads", async () => {
    await removeOverride();

    expect(items[0]!.feedInfoInMarkdown).toContain(
      `for user **[Ana Lee](${ANA_LINK})** for the [On-Call Policy Payments]`,
    );
    expect(items[0]!.chatInfoInMarkdown).toBe(
      `❌ Removed an override on [Payments](${POLICY_LINK}): [Ana Lee](${ANA_LINK}) is paged on their turns again.`,
    );
    expect(items[0]!.userId?.toString()).toBe(DANA.toString());
    expect(items[0]!.workspaceNotification).toMatchObject({
      sendWorkspaceNotification: true,
      leadWithAuthor: true,
    });
  });

  test("Mattermost keeps its word joiner after the @: nobody is pinged", async () => {
    await removeOverride();

    const posted: string = MattermostUtil.getMessageText(
      items[0]!.chatInfoByWorkspaceType![WorkspaceType.Mattermost]!,
    );

    expect(posted).toContain("@⁠ana.lee is paged");
  });
});

describe("a person added to an escalation rule, or taken out", () => {
  function ruleUser(): OnCallDutyPolicyEscalationRuleUser {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy._id = POLICY_ID.toString();
    policy.name = "Payments";

    const rule: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();
    rule._id = RULE_ID.toString();
    rule.name = "First line";
    rule.order = 1;

    const user: User = new User();
    user._id = ANA.toString();

    const row: OnCallDutyPolicyEscalationRuleUser =
      new OnCallDutyPolicyEscalationRuleUser();
    row._id = ObjectID.generate().toString();
    row.projectId = PROJECT_ID;
    row.onCallDutyPolicy = policy;
    row.onCallDutyPolicyEscalationRule = rule;
    row.user = user;
    row.createdByUserId = DANA;

    return row;
  }

  beforeEach(() => {
    jest
      .spyOn(OnDutyPoliciesCache, "forgetProjects")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(UserNotificationSettingService, "sendUserNotification")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OnCallDutyPolicyTimeLogService, "startTimeLogForUser")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(OnCallDutyPolicyTimeLogService, "endTimeLogForUser")
      .mockResolvedValue(undefined as never);
  });

  test("REGRESSION: added - each workspace's line names them as it knows them; the feed keeps the rule and her OneUptime name", async () => {
    const row: OnCallDutyPolicyEscalationRuleUser = ruleUser();

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findOneById")
      .mockResolvedValue(row as never);

    await (
      OnCallDutyPolicyEscalationRuleUserService as unknown as {
        onCreateSuccess: (
          onCreate: unknown,
          createdItem: OnCallDutyPolicyEscalationRuleUser,
        ) => Promise<unknown>;
      }
    ).onCreateSuccess({}, row);

    expect(items).toHaveLength(1);
    expect(items[0]!.chatInfoByWorkspaceType).toEqual({
      [WorkspaceType.Slack]: `👨🏻‍💻 Added **@ana.lee** to on-call policy [Payments](${POLICY_LINK}).`,
      [WorkspaceType.MicrosoftTeams]: `👨🏻‍💻 Added **[Ana Lee](${ANA_LINK})** to on-call policy [Payments](${POLICY_LINK}).`,
      [WorkspaceType.Mattermost]: `👨🏻‍💻 Added **@ana.lee** to on-call policy [Payments](${POLICY_LINK}).`,
    });
    expect(items[0]!.feedInfoInMarkdown).toBe(
      `👨🏻‍💻 Added **[Ana Lee](${ANA_LINK})** to the [On-Call Policy Payments](${POLICY_LINK}) escalation rule **First line** with order **1**.`,
    );
    expect(items[0]!.chatInfoInMarkdown).toBe(
      `👨🏻‍💻 Added **[Ana Lee](${ANA_LINK})** to on-call policy [Payments](${POLICY_LINK}).`,
    );
    expect(items[0]!.userId?.toString()).toBe(DANA.toString());
  });

  test("REGRESSION: taken out - each workspace's line names them as it knows them, not by the bare name it used", async () => {
    const row: OnCallDutyPolicyEscalationRuleUser = ruleUser();

    jest
      .spyOn(
        OnCallDutyPolicyEscalationRuleUserService,
        "findRowsAndHoldDeleteToThem",
      )
      .mockResolvedValue([row] as never);

    await (
      OnCallDutyPolicyEscalationRuleUserService as unknown as {
        onBeforeDelete: (deleteBy: unknown) => Promise<unknown>;
      }
    ).onBeforeDelete({
      query: { _id: ObjectID.generate() },
      props: { userId: DANA },
    });

    expect(items).toHaveLength(1);
    expect(items[0]!.chatInfoByWorkspaceType).toEqual({
      [WorkspaceType.Slack]: `👨🏻‍💻 Removed **@ana.lee** from on-call policy [Payments](${POLICY_LINK}).`,
      [WorkspaceType.MicrosoftTeams]: `👨🏻‍💻 Removed **[Ana Lee](${ANA_LINK})** from on-call policy [Payments](${POLICY_LINK}).`,
      [WorkspaceType.Mattermost]: `👨🏻‍💻 Removed **@ana.lee** from on-call policy [Payments](${POLICY_LINK}).`,
    });
    /*
     * The feed names her as the add does, a link to her page, with the
     * rule - no longer with her address after her name, which for someone
     * only invited was the address they were invited at (#10616).
     */
    expect(items[0]!.feedInfoInMarkdown).toBe(
      `👨🏻‍💻 Removed **[Ana Lee](${ANA_LINK})** from the [On-Call Policy Payments](${POLICY_LINK}) for escalation rule First line with order 1.`,
    );
  });

  test("a project with no workspace connected: no line of its own anywhere, and nobody's workspace name asked", async () => {
    connect([]);

    const row: OnCallDutyPolicyEscalationRuleUser = ruleUser();

    jest
      .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findOneById")
      .mockResolvedValue(row as never);

    await (
      OnCallDutyPolicyEscalationRuleUserService as unknown as {
        onCreateSuccess: (
          onCreate: unknown,
          createdItem: OnCallDutyPolicyEscalationRuleUser,
        ) => Promise<unknown>;
      }
    ).onCreateSuccess({}, row);

    expect(items[0]!.chatInfoByWorkspaceType).toEqual({});
    expect(WorkspaceUtil.getUserStringForWorkspace).not.toHaveBeenCalled();
  });
});

describe("the feed entry hands each workspace its own line (OnCallDutyPolicyFeedService)", () => {
  type Send = Parameters<
    typeof OnCallDutyPolicyFeedService.sendWorkspaceNotification
  >[0];

  let sends: Array<Send>;

  beforeEach(() => {
    sends = [];

    // The feed service itself, this time: only its database write is stubbed.
    (
      OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem as unknown as jest.Mock
    ).mockRestore();
    jest
      .spyOn(OnCallDutyPolicyFeedService, "create")
      .mockImplementation((async (data: { data: unknown }) => {
        return data.data;
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyFeedService, "sendWorkspaceNotification")
      .mockImplementation((async (data: Send): Promise<void> => {
        sends.push(data);
      }) as never);
  });

  async function postEntry(
    chatInfoByWorkspaceType?: Partial<Record<WorkspaceType, string>>,
  ): Promise<void> {
    const line: MarkdownText = mdText`❌ Removed an override on Payments: [Ana Lee](${ANA_LINK}) is paged on their turns again.`;

    await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
      onCallDutyPolicyId: POLICY_ID,
      projectId: PROJECT_ID,
      onCallDutyPolicyFeedEventType: "UserOverrideRemoved" as never,
      feedInfoInMarkdown: "❌ Removed a User Override Rule for user Ana Lee.",
      chatInfoInMarkdown: line.toString(),
      ...(chatInfoByWorkspaceType ? { chatInfoByWorkspaceType } : {}),
      workspaceNotification: { sendWorkspaceNotification: true },
    });
  }

  test("each workspace's line goes as its own; the shared line stays for the rest", async () => {
    await postEntry({
      [WorkspaceType.Slack]:
        "❌ Removed an override on Payments: @ana.lee is paged on their turns again.",
    });

    expect(sends).toHaveLength(1);
    expect(sends[0]!.markdownByWorkspaceType).toEqual({
      [WorkspaceType.Slack]:
        "❌ Removed an override on Payments: @ana.lee is paged on their turns again.",
    });
    expect(sends[0]!.feedInfoInMarkdown).toContain(
      `[Ana Lee](${ANA_LINK}) is paged`,
    );
  });

  test("no line of a workspace's own - none given, or none written - hands on none", async () => {
    await postEntry();
    await postEntry({});

    expect(sends).toHaveLength(2);

    for (const send of sends) {
      expect(send.markdownByWorkspaceType).toBeUndefined();
    }
  });
});
