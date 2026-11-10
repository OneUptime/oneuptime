import Label from "../../../Models/DatabaseModels/Label";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService, {
  NotificationFor,
  isPostOnlyNotificationRuleEventType,
} from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUtil from "../../../Server/Utils/Workspace/Workspace";
import { WorkspaceSendMessageResponse } from "../../../Server/Utils/Workspace/WorkspaceBase";
import WorkspaceRecordChannels from "../../../Server/Utils/Workspace/WorkspaceRecordChannels";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import SloErrorBudgetPolicyChange from "../../../Types/ServiceLevelObjective/SloErrorBudgetPolicyChange";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import WorkspaceMessagePayload, {
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
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
 * AN SLO'S ERROR BUDGET POLICY, IN SLACK, MICROSOFT TEAMS AND MATTERMOST.
 *
 * A project's Service Level Objective rules name the channels (and Teams
 * chats) the changes of its SLOs' error budget policies are posted to, the
 * SLOs they are for - by name, by the SLO itself, by its labels, read as the
 * SLO is now - and which changes: what the evaluation that committed the
 * change says moved. They are the workspace rules every record is posted
 * by - matched by the same matcher, posted by the same sender - and, as for
 * a hunt, only to channels and chats that exist: an SLO never gets a
 * channel of its own.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SLO_ID: ObjectID = ObjectID.generate();
const OTHER_SLO_ID: ObjectID = ObjectID.generate();
const TIER_1_LABEL: ObjectID = ObjectID.generate();
const OTHER_LABEL: ObjectID = ObjectID.generate();

interface Condition {
  checkOn: NotificationRuleConditionCheckOn;
  conditionType: ConditionType;
  value: string | Array<string>;
}

function rule(data: {
  channel?: string | undefined;
  chatIds?: Array<string> | undefined;
  conditions?: Array<Condition> | undefined;
  filterCondition?: FilterCondition | undefined;
  workspaceType?: WorkspaceType | undefined;
  eventType?: NotificationRuleEventType | undefined;
}): WorkspaceNotificationRule {
  const model: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  model.id = ObjectID.generate();
  model.workspaceType = data.workspaceType || WorkspaceType.Slack;
  model.eventType =
    data.eventType || NotificationRuleEventType.ServiceLevelObjective;
  model.notificationRule = {
    _type: "ServiceLevelObjectiveNotificationRule",
    filterCondition: data.filterCondition || FilterCondition.All,
    filters: data.conditions || [],
    shouldPostToExistingChannel: Boolean(data.channel),
    existingChannelNames: data.channel || "",
    ...(data.chatIds
      ? { shouldPostToExistingChat: true, existingChatIds: data.chatIds }
      : {}),
  } as never;
  return model;
}

function when(
  checkOn: NotificationRuleConditionCheckOn,
  conditionType: ConditionType,
  value: string | Array<string>,
  channel: string,
): WorkspaceNotificationRule {
  return rule({ channel, conditions: [{ checkOn, conditionType, value }] });
}

function storedSlo(data: {
  name?: string;
  labelIds?: Array<ObjectID>;
}): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo.id = SLO_ID;
  slo.name = data.name ?? "Checkout availability";
  slo.labels = (data.labelIds ?? [TIER_1_LABEL]).map(
    (id: ObjectID): Label => {
      const label: Label = new Label();
      label._id = id.toString();
      return label;
    },
  );
  return slo;
}

function forChange(
  ...changes: Array<SloErrorBudgetPolicyChange>
): NotificationFor {
  return {
    serviceLevelObjectiveId: SLO_ID,
    serviceLevelObjectivePolicyChanges: changes,
  };
}

let rules: Array<WorkspaceNotificationRule>;
let readSlo: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  rules = [];

  readSlo = jest
    .spyOn(ServiceLevelObjectiveService, "findOneById")
    .mockResolvedValue(storedSlo({}) as never);

  jest
    .spyOn(WorkspaceNotificationRuleService, "findBy")
    .mockImplementation((async (args: {
      query: {
        projectId: ObjectID;
        workspaceType: WorkspaceType;
        eventType: string;
      };
    }): Promise<Array<WorkspaceNotificationRule>> => {
      expect(args.query.projectId).toEqual(PROJECT_ID);

      return rules.filter((model: WorkspaceNotificationRule): boolean => {
        return (
          model.workspaceType === args.query.workspaceType &&
          model.eventType === args.query.eventType
        );
      });
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an SLO's workspace rules match", () => {
  async function matching(
    notificationFor: NotificationFor = forChange(
      SloErrorBudgetPolicyChange.EnteredMoreSevereTier,
    ),
  ): Promise<Array<string>> {
    return (
      await WorkspaceNotificationRuleService.getMatchingNotificationRules({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Slack,
        notificationRuleEventType:
          NotificationRuleEventType.ServiceLevelObjective,
        notificationFor,
      })
    ).map((model: WorkspaceNotificationRule): string => {
      return (
        model.notificationRule as unknown as { existingChannelNames: string }
      ).existingChannelNames;
    });
  }

  test("on the SLO's name: is, is not, contains, starts or ends with", async () => {
    const byName: (
      conditionType: ConditionType,
      value: string,
      channel: string,
    ) => WorkspaceNotificationRule = (
      conditionType: ConditionType,
      value: string,
      channel: string,
    ): WorkspaceNotificationRule => {
      return when(
        NotificationRuleConditionCheckOn.SloName,
        conditionType,
        value,
        channel,
      );
    };

    rules = [
      byName(ConditionType.EqualTo, "Checkout availability", "is"),
      byName(ConditionType.EqualTo, "Checkout", "is-not-quite"),
      byName(ConditionType.NotEqualTo, "Search latency", "is-not"),
      byName(ConditionType.Contains, "Checkout", "contains"),
      byName(ConditionType.Contains, "Search", "contains-other"),
      byName(ConditionType.NotContains, "Search", "does-not-contain"),
      byName(ConditionType.StartsWith, "Checkout", "starts-with"),
      byName(ConditionType.EndsWith, "availability", "ends-with"),
      byName(ConditionType.EndsWith, "latency", "ends-with-other"),
    ];

    expect(await matching()).toEqual([
      "is",
      "is-not",
      "contains",
      "does-not-contain",
      "starts-with",
      "ends-with",
    ]);
  });

  test("on the SLO itself, by its id: the rule that picks it, not the one that picks another", async () => {
    rules = [
      when(
        NotificationRuleConditionCheckOn.Slos,
        ConditionType.ContainsAny,
        [OTHER_SLO_ID.toString(), SLO_ID.toString()],
        "picks-it",
      ),
      when(
        NotificationRuleConditionCheckOn.Slos,
        ConditionType.ContainsAny,
        [OTHER_SLO_ID.toString()],
        "picks-another",
      ),
      when(
        NotificationRuleConditionCheckOn.Slos,
        ConditionType.NotContains,
        [OTHER_SLO_ID.toString()],
        "leaves-another-out",
      ),
    ];

    expect(await matching()).toEqual(["picks-it", "leaves-another-out"]);
  });

  test("on the SLO's labels, by their ids", async () => {
    rules = [
      when(
        NotificationRuleConditionCheckOn.SloLabels,
        ConditionType.ContainsAny,
        [TIER_1_LABEL.toString()],
        "tier-1",
      ),
      when(
        NotificationRuleConditionCheckOn.SloLabels,
        ConditionType.ContainsAny,
        [OTHER_LABEL.toString()],
        "other-label",
      ),
      when(
        NotificationRuleConditionCheckOn.SloLabels,
        ConditionType.NotContains,
        [TIER_1_LABEL.toString()],
        "not-tier-1",
      ),
    ];

    expect(await matching()).toEqual(["tier-1"]);
  });

  test("on what moved, as the evaluation says it: a freeze reaches the release channel, an escalation the SRE channel", async () => {
    rules = [
      when(
        NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange,
        ConditionType.ContainsAny,
        [
          SloErrorBudgetPolicyChange.DeploymentsFrozen,
          SloErrorBudgetPolicyChange.DeploymentsAllowed,
        ],
        "releases",
      ),
      when(
        NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange,
        ConditionType.ContainsAny,
        [SloErrorBudgetPolicyChange.EnteredMoreSevereTier],
        "sre",
      ),
    ];

    // A tier change that froze deployments is both.
    expect(
      await matching(
        forChange(
          SloErrorBudgetPolicyChange.EnteredMoreSevereTier,
          SloErrorBudgetPolicyChange.DeploymentsFrozen,
        ),
      ),
    ).toEqual(["releases", "sre"]);

    // Freeze Deployments switched off for the tier the SLO is in.
    expect(
      await matching(forChange(SloErrorBudgetPolicyChange.DeploymentsAllowed)),
    ).toEqual(["releases"]);

    // A recovery that left the gate as it was.
    expect(
      await matching(
        forChange(SloErrorBudgetPolicyChange.RecoveredToLessSevereTier),
      ),
    ).toEqual([]);
  });

  test("a post that says nothing moved matches no change condition", async () => {
    rules = [
      when(
        NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange,
        ConditionType.ContainsAny,
        [SloErrorBudgetPolicyChange.EnteredMoreSevereTier],
        "sre",
      ),
    ];

    expect(await matching({ serviceLevelObjectiveId: SLO_ID })).toEqual([]);
  });

  test("Any of its conditions, or All of them, as the rule says", async () => {
    const conditions: Array<Condition> = [
      {
        checkOn: NotificationRuleConditionCheckOn.SloLabels,
        conditionType: ConditionType.ContainsAny,
        value: [TIER_1_LABEL.toString()],
      },
      {
        checkOn: NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange,
        conditionType: ConditionType.ContainsAny,
        value: [SloErrorBudgetPolicyChange.DeploymentsFrozen],
      },
    ];

    rules = [
      rule({ channel: "any", conditions, filterCondition: FilterCondition.Any }),
      rule({ channel: "all", conditions, filterCondition: FilterCondition.All }),
    ];

    expect(await matching()).toEqual(["any"]);
  });

  test("a rule with no condition is for every change of every SLO", async () => {
    rules = [rule({ channel: "every-slo" })];

    expect(await matching()).toEqual(["every-slo"]);
    expect(
      await matching(forChange(SloErrorBudgetPolicyChange.LeftEveryTier)),
    ).toEqual(["every-slo"]);
  });

  test("only the project's SLO rules are asked: a monitor or hunt rule never hears an SLO's policy", async () => {
    rules = [
      rule({ channel: "monitors", eventType: NotificationRuleEventType.Monitor }),
      rule({
        channel: "hunts",
        eventType: NotificationRuleEventType.SecurityHunt,
      }),
      rule({ channel: "slos" }),
    ];

    expect(await matching()).toEqual(["slos"]);
  });

  test("a condition an SLO cannot answer - a monitor's name - never matches it", async () => {
    rules = [
      when(
        NotificationRuleConditionCheckOn.MonitorName,
        ConditionType.Contains,
        "Checkout",
        "by-monitor-name",
      ),
    ];

    expect(await matching()).toEqual([]);
  });

  test("the SLO is read as it is now - renamed, it is matched by its new name - and only what the rules ask of it is read", async () => {
    rules = [
      when(
        NotificationRuleConditionCheckOn.SloName,
        ConditionType.StartsWith,
        "Checkout",
        "checkout",
      ),
    ];
    readSlo.mockResolvedValue(storedSlo({ name: "Payments availability" }));

    expect(await matching()).toEqual([]);
    expect(readSlo).toHaveBeenCalledWith({
      id: SLO_ID,
      select: { name: true, labels: { _id: true } },
      props: { isRoot: true },
    });
  });

  test("an SLO that no longer exists is refused, as every other record is", async () => {
    readSlo.mockResolvedValue(null);
    rules = [rule({ channel: "every-slo" })];

    await expect(matching()).rejects.toThrow(
      "Service Level Objective ID not found",
    );
  });

  test("an SLO is posted about, never given a channel: no kind of record that opens channels is an SLO", () => {
    const forSlo: NotificationFor = forChange(
      SloErrorBudgetPolicyChange.EnteredMoreSevereTier,
    );

    expect(WorkspaceRecordChannels.getEventType(forSlo)).toBeNull();
    expect(
      isPostOnlyNotificationRuleEventType(
        NotificationRuleEventType.ServiceLevelObjective,
      ),
    ).toBe(true);
  });
});

describe("an SLO's policy change posted to its channels", () => {
  let payloads: Array<WorkspaceMessagePayload>;
  let logged: number;
  let readRecord: ReturnType<typeof jest.spyOn>;
  let readAuths: ReturnType<typeof jest.spyOn>;

  const MESSAGE: string =
    "📉 [SLO Checkout availability](https://oneuptime.com/dashboard/slo) entered the **Budget exhausted** tier of its error budget policy (was **Caution**). Deployments are frozen.\n\n**What we do**:\n\nFreeze non-critical releases.";

  beforeEach(() => {
    payloads = [];
    logged = 0;

    readAuths = jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
      .mockResolvedValue([] as never);

    jest
      .spyOn(WorkspaceNotificationRuleService, "hasConnectedWorkspace")
      .mockResolvedValue(true);

    readRecord = jest.spyOn(WorkspaceRecordChannels, "read");

    jest
      .spyOn(WorkspaceUtil, "postMessageToAllWorkspaceChannelsAsBot")
      .mockImplementation((async (data: {
        messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
      }): Promise<Array<WorkspaceSendMessageResponse>> => {
        payloads.push(...data.messagePayloadsByWorkspace);
        return [];
      }) as never);

    jest
      .spyOn(WorkspaceNotificationLogService, "create")
      .mockImplementation((async () => {
        logged++;
      }) as never);
  });

  async function post(
    notificationFor: NotificationFor = forChange(
      SloErrorBudgetPolicyChange.EnteredMoreSevereTier,
      SloErrorBudgetPolicyChange.DeploymentsFrozen,
    ),
  ): Promise<void> {
    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
      projectId: PROJECT_ID,
      notificationFor,
      feedInfoInMarkdown: MESSAGE,
      workspaceNotification: {
        sendWorkspaceNotification: true,
      },
    });
  }

  test("goes to the existing channels and chats of the rules it matches, in each workspace, and opens none", async () => {
    rules = [
      when(
        NotificationRuleConditionCheckOn.SloLabels,
        ConditionType.ContainsAny,
        [TIER_1_LABEL.toString()],
        "sre",
      ),
      when(
        NotificationRuleConditionCheckOn.SloLabels,
        ConditionType.ContainsAny,
        [OTHER_LABEL.toString()],
        "other-team",
      ),
      rule({
        channel: "Releases",
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
      rule({
        chatIds: ["19:release-managers@thread.v2"],
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
      rule({
        channel: "town-square",
        workspaceType: WorkspaceType.Mattermost,
      }),
    ];

    await post();

    expect(
      payloads.map((payload: WorkspaceMessagePayload) => {
        return {
          workspaceType: payload.workspaceType,
          channelNames: payload.channelNames,
          channelIds: payload.channelIds,
          chatIds: payload.chatIds || [],
        };
      }),
    ).toEqual([
      {
        workspaceType: WorkspaceType.Slack,
        channelNames: ["sre"],
        channelIds: [],
        chatIds: [],
      },
      {
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelNames: ["Releases"],
        channelIds: [],
        chatIds: [],
      },
      {
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelNames: [],
        channelIds: [],
        chatIds: ["19:release-managers@thread.v2"],
      },
      {
        workspaceType: WorkspaceType.Mattermost,
        channelNames: ["town-square"],
        channelIds: [],
        chatIds: [],
      },
    ]);

    // An SLO has no channel of its own: none is read, and none opened.
    expect(readRecord).not.toHaveBeenCalled();
    expect(readAuths).not.toHaveBeenCalled();
    // Nothing was sent back, so there is nothing to log.
    expect(logged).toBe(0);
  });

  test("posts the message as it was written, and its notification says its first line as text", async () => {
    rules = [rule({ channel: "sre" })];

    await post();

    expect(payloads).toHaveLength(1);

    const block: WorkspacePayloadMarkdown = payloads[0]!
      .messageBlocks[0] as WorkspacePayloadMarkdown;

    expect(block._type).toBe("WorkspacePayloadMarkdown");
    expect(block.text).toBe(MESSAGE);
    expect(payloads[0]!.text).toBe(
      "📉 SLO Checkout availability entered the Budget exhausted tier of its error budget policy (was Caution). Deployments are frozen.",
    );
  });

  test("a change no rule matches is posted nowhere", async () => {
    rules = [
      when(
        NotificationRuleConditionCheckOn.SloErrorBudgetPolicyChange,
        ConditionType.ContainsAny,
        [SloErrorBudgetPolicyChange.LeftEveryTier],
        "recoveries",
      ),
    ];

    await post();

    expect(payloads).toEqual([]);
  });

  test("a project with no workspace connected is not asked about its SLO", async () => {
    jest
      .spyOn(WorkspaceNotificationRuleService, "hasConnectedWorkspace")
      .mockResolvedValue(false);
    rules = [rule({ channel: "every-slo" })];

    await post();

    expect(payloads).toEqual([]);
    expect(readSlo).not.toHaveBeenCalled();
  });
});
