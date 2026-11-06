import SecurityHunt from "../../../Models/DatabaseModels/SecurityHunt";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import SecurityHuntService from "../../../Server/Services/SecurityHuntService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService, {
  NotificationFor,
} from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUtil from "../../../Server/Utils/Workspace/Workspace";
import { WorkspaceSendMessageResponse } from "../../../Server/Utils/Workspace/WorkspaceBase";
import WorkspaceRecordChannels from "../../../Server/Utils/Workspace/WorkspaceRecordChannels";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import WorkspaceMessagePayload from "../../../Types/Workspace/WorkspaceMessagePayload";
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
 * WHAT HUNTS FIND, IN SLACK AND MICROSOFT TEAMS.
 *
 * A project's Security Hunt rules name the channels (and Teams chats) the
 * finds of its scheduled hunts are posted to, and the hunts they are for -
 * by the hunt's name, the one thing a rule asks of a hunt, read as the
 * hunt is now. They are the same workspace rules a security case is posted
 * by: matched by the same matcher, posted by the same sender, and, as for
 * a case, only to channels and chats that exist - a hunt never gets a
 * channel of its own.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const HUNT_ID: ObjectID = ObjectID.generate();

function rule(data: {
  channel?: string | undefined;
  chatIds?: Array<string> | undefined;
  conditions?:
    | Array<{
        checkOn: NotificationRuleConditionCheckOn;
        conditionType: ConditionType;
        value: string | Array<string>;
      }>
    | undefined;
  filterCondition?: FilterCondition | undefined;
  workspaceType?: WorkspaceType | undefined;
  eventType?: NotificationRuleEventType | undefined;
}): WorkspaceNotificationRule {
  const model: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  model.id = ObjectID.generate();
  model.workspaceType = data.workspaceType || WorkspaceType.Slack;
  model.eventType = data.eventType || NotificationRuleEventType.SecurityHunt;
  model.notificationRule = {
    _type:
      model.eventType === NotificationRuleEventType.SecurityHunt
        ? "SecurityHuntNotificationRule"
        : "SecurityCaseNotificationRule",
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

function byName(
  conditionType: ConditionType,
  value: string,
  channel: string,
): WorkspaceNotificationRule {
  return rule({
    channel,
    conditions: [
      {
        checkOn: NotificationRuleConditionCheckOn.SecurityHuntName,
        conditionType,
        value,
      },
    ],
  });
}

let rules: Array<WorkspaceNotificationRule>;
let readHunt: ReturnType<typeof jest.spyOn>;

function storedHunt(name: string): SecurityHunt {
  const hunt: SecurityHunt = new SecurityHunt();
  hunt.id = HUNT_ID;
  hunt.name = name;
  return hunt;
}

beforeEach(() => {
  rules = [];

  readHunt = jest
    .spyOn(SecurityHuntService, "findOneById")
    .mockResolvedValue(storedHunt("IR - Encoded PowerShell"));

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

describe("a hunt's workspace rules match", () => {
  async function matching(): Promise<Array<string>> {
    return (
      await WorkspaceNotificationRuleService.getMatchingNotificationRules({
        projectId: PROJECT_ID,
        workspaceType: WorkspaceType.Slack,
        notificationRuleEventType: NotificationRuleEventType.SecurityHunt,
        notificationFor: { securityHuntId: HUNT_ID },
      })
    ).map((model: WorkspaceNotificationRule): string => {
      return (
        model.notificationRule as unknown as { existingChannelNames: string }
      ).existingChannelNames;
    });
  }

  test("on the hunt's name: is, is not, contains, does not contain, starts or ends with", async () => {
    rules = [
      byName(ConditionType.EqualTo, "IR - Encoded PowerShell", "is"),
      byName(ConditionType.EqualTo, "Encoded PowerShell", "is-not-quite"),
      byName(ConditionType.NotEqualTo, "Admin sign-ins", "is-not"),
      byName(ConditionType.Contains, "PowerShell", "contains"),
      byName(ConditionType.Contains, "Ransomware", "contains-other"),
      byName(ConditionType.NotContains, "Ransomware", "does-not-contain"),
      byName(ConditionType.StartsWith, "IR - ", "starts-with"),
      byName(ConditionType.StartsWith, "SOC - ", "starts-with-other"),
      byName(ConditionType.EndsWith, "PowerShell", "ends-with"),
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

  test("a rule with no condition is for every hunt", async () => {
    rules = [rule({ channel: "every-hunt" })];

    expect(await matching()).toEqual(["every-hunt"]);
  });

  test("Any of its conditions, or All of them, as the rule says", async () => {
    const conditions: Array<{
      checkOn: NotificationRuleConditionCheckOn;
      conditionType: ConditionType;
      value: string;
    }> = [
      {
        checkOn: NotificationRuleConditionCheckOn.SecurityHuntName,
        conditionType: ConditionType.StartsWith,
        value: "IR - ",
      },
      {
        checkOn: NotificationRuleConditionCheckOn.SecurityHuntName,
        conditionType: ConditionType.Contains,
        value: "Ransomware",
      },
    ];

    rules = [
      rule({
        channel: "any",
        conditions,
        filterCondition: FilterCondition.Any,
      }),
      rule({
        channel: "all",
        conditions,
        filterCondition: FilterCondition.All,
      }),
    ];

    expect(await matching()).toEqual(["any"]);
  });

  test("only the project's hunt rules are asked: a security case rule never hears what a hunt found", async () => {
    rules = [
      rule({
        channel: "cases",
        eventType: NotificationRuleEventType.SecurityCase,
      }),
      rule({ channel: "hunts" }),
    ];

    expect(await matching()).toEqual(["hunts"]);
  });

  test("a condition a hunt cannot answer - a case's title - never matches it", async () => {
    rules = [
      rule({
        channel: "by-case-title",
        conditions: [
          {
            checkOn: NotificationRuleConditionCheckOn.SecurityCaseTitle,
            conditionType: ConditionType.Contains,
            value: "PowerShell",
          },
        ],
      }),
    ];

    expect(await matching()).toEqual([]);
  });

  test("the hunt is read as it is now: renamed, it is matched by its new name, and only its name is read", async () => {
    rules = [byName(ConditionType.StartsWith, "IR - ", "incident-response")];
    readHunt.mockResolvedValue(storedHunt("Encoded PowerShell"));

    expect(await matching()).toEqual([]);
    expect(readHunt).toHaveBeenCalledWith({
      id: HUNT_ID,
      select: { name: true },
      props: { isRoot: true },
    });
  });

  test("a hunt that no longer exists is refused, as for every other record", async () => {
    readHunt.mockResolvedValue(null);
    rules = [rule({ channel: "every-hunt" })];

    await expect(matching()).rejects.toThrow("Security Hunt ID not found");
  });

  test("a hunt is posted about, never given a channel: no kind of record that opens channels is a hunt", () => {
    const forHunt: NotificationFor = { securityHuntId: HUNT_ID };

    // What opens a record's channels later finds no record in a hunt's post.
    expect(WorkspaceRecordChannels.getEventType(forHunt)).toBeNull();
  });
});

describe("a hunt's find posted to its channels", () => {
  let payloads: Array<WorkspaceMessagePayload>;
  let logged: number;
  let readRecord: ReturnType<typeof jest.spyOn>;
  let readAuths: ReturnType<typeof jest.spyOn>;

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

  async function post(): Promise<void> {
    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
      projectId: PROJECT_ID,
      notificationFor: { securityHuntId: HUNT_ID },
      feedInfoInMarkdown: "🔎 **Hunt found 3 security events**",
      notificationText: "Hunt found 3 security events: IR - Encoded PowerShell",
      workspaceNotification: {
        sendWorkspaceNotification: true,
      },
    });
  }

  test("goes to the existing channels and chats of the rules it matches, in each workspace, and opens none", async () => {
    rules = [
      byName(ConditionType.StartsWith, "IR - ", "incident-response"),
      byName(ConditionType.Contains, "Ransomware", "ransomware"),
      rule({
        channel: "Security",
        workspaceType: WorkspaceType.MicrosoftTeams,
      }),
      rule({
        chatIds: ["19:soc-on-call@thread.v2"],
        workspaceType: WorkspaceType.MicrosoftTeams,
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
          text: payload.text,
        };
      }),
    ).toEqual([
      {
        workspaceType: WorkspaceType.Slack,
        channelNames: ["incident-response"],
        channelIds: [],
        chatIds: [],
        text: "Hunt found 3 security events: IR - Encoded PowerShell",
      },
      {
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelNames: ["Security"],
        channelIds: [],
        chatIds: [],
        text: "Hunt found 3 security events: IR - Encoded PowerShell",
      },
      {
        workspaceType: WorkspaceType.MicrosoftTeams,
        channelNames: [],
        channelIds: [],
        chatIds: ["19:soc-on-call@thread.v2"],
        text: "Hunt found 3 security events: IR - Encoded PowerShell",
      },
    ]);

    // A hunt has no channel of its own: none is read, and none opened.
    expect(readRecord).not.toHaveBeenCalled();
    expect(readAuths).not.toHaveBeenCalled();
    // Nothing was sent back, so there is nothing to log.
    expect(logged).toBe(0);
  });

  test("a hunt no rule matches is posted nowhere", async () => {
    rules = [byName(ConditionType.Contains, "Ransomware", "ransomware")];

    await post();

    expect(payloads).toEqual([]);
  });

  test("a project with no workspace connected is not asked about its hunt", async () => {
    jest
      .spyOn(WorkspaceNotificationRuleService, "hasConnectedWorkspace")
      .mockResolvedValue(false);
    rules = [rule({ channel: "every-hunt" })];

    await post();

    expect(payloads).toEqual([]);
    expect(readHunt).not.toHaveBeenCalled();
  });
});
