import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import WorkspaceNotificationLog from "../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken, {
  SlackMiscData,
} from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import WorkspaceUtil from "../../../Server/Utils/Workspace/Workspace";
import { WorkspaceChannel } from "../../../Server/Utils/Workspace/WorkspaceBase";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import BaseNotificationRule from "../../../Types/Workspace/NotificationRules/BaseNotificationRule";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleWorkspaceChannel from "../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceMessagePayload from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

/*
 * A SLACK RULE THAT NAMES A WORKSPACE OF AN ENTERPRISE ORGANIZATION.
 *
 * A project connected to a whole Slack Enterprise organization posts to
 * channels of any workspace OneUptime was added to; a rule names the
 * workspace its existing channels are in (existingTeam), as a Microsoft
 * Teams rule names its team. Test Rule asks whether each channel exists in
 * that workspace, and posts the test message there - the workspace goes
 * with the channel's name (WorkspaceMessagePayload.teamId), which Slack
 * resolves in that workspace only. A channel the test created is posted to
 * by its id, which needs no workspace. A rule that names none is looked
 * for as before: the default workspace first.
 */

const EAST: string = "T0EAST";
const WEST: string = "T0WEST";

const TEST_BY_USER_ID: ObjectID = new ObjectID(
  "c8000000-0000-4000-8000-000000000001",
);

interface RuleOverrides extends Partial<BaseNotificationRule> {
  shouldCreateNewChannel?: boolean;
  teamToCreateChannelIn?: string;
  newChannelTemplateName?: string;
}

let doesChannelExist: Mock<(data: unknown) => Promise<boolean>>;
let postSpy: SpyInstance<
  typeof WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot
>;
let channelExists: (channelName: string, teamId: string | undefined) => boolean;
let createdChannels: Array<NotificationRuleWorkspaceChannel>;

function slackRule(overrides: RuleOverrides): WorkspaceNotificationRule {
  const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  rule.id = ObjectID.generate();
  rule.projectId = new ObjectID("c8000000-0000-4000-8000-000000000002");
  rule.workspaceType = WorkspaceType.Slack;
  rule.eventType = NotificationRuleEventType.Incident;
  rule.name = "East incidents";
  rule.notificationRule = {
    _type: "NotificationRule",
    filterCondition: FilterCondition.Any,
    filters: [],
    shouldPostToExistingChannel: false,
    existingChannelNames: "",
    shouldCreateNewChannel: false,
    ...overrides,
  } as BaseNotificationRule;
  return rule;
}

function install(rule: WorkspaceNotificationRule): void {
  jest
    .spyOn(WorkspaceNotificationRuleService, "findOneById")
    .mockResolvedValue(rule);

  const userAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
  userAuth.workspaceUserId = "U0TESTER";
  jest
    .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
    .mockResolvedValue(userAuth);

  const projectAuth: WorkspaceProjectAuthToken =
    new WorkspaceProjectAuthToken();
  projectAuth.authToken = "xoxb-acme-organization";
  projectAuth.workspaceType = WorkspaceType.Slack;
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
    .mockResolvedValue(projectAuth);

  const connection: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  connection.authToken = "xoxb-acme-organization";
  connection.workspaceProjectId = "E0ACME";
  connection.miscData = {
    teamId: "E0ACME",
    teamName: "Acme Corp",
    botUserId: "U0BOT",
    isEnterpriseInstall: true,
    enterpriseId: "E0ACME",
    workspaces: [
      { id: EAST, name: "Acme East" },
      { id: WEST, name: "Acme West" },
    ],
    defaultWorkspaceId: WEST,
  } as SlackMiscData;
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockResolvedValue(connection);

  jest
    .spyOn(WorkspaceNotificationRuleService, "createChannelsBasedOnRules")
    .mockImplementation((async () => {
      return createdChannels;
    }) as never);

  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "inviteUsersBasedOnRulesAndWorkspaceChannels",
    )
    .mockResolvedValue(undefined as never);

  doesChannelExist = jest.fn(async (data: unknown): Promise<boolean> => {
    const asked: { channelName: string; teamId?: string } = data as {
      channelName: string;
      teamId?: string;
    };
    return channelExists(asked.channelName, asked.teamId);
  });

  jest.spyOn(WorkspaceUtil, "getWorkspaceTypeUtil").mockReturnValue({
    doesChannelExist: doesChannelExist,
  } as never);

  postSpy = jest
    .spyOn(WorkspaceUtil, "postMessageToAllWorkspaceChannelsAsBot")
    .mockResolvedValue([
      { workspaceType: WorkspaceType.Slack, threads: [], errors: [] },
    ]);

  jest
    .spyOn(WorkspaceNotificationLogService, "create")
    .mockResolvedValue(new WorkspaceNotificationLog());
}

async function testRule(rule: WorkspaceNotificationRule): Promise<void> {
  install(rule);

  await WorkspaceNotificationRuleService.testRule({
    ruleId: rule.id!,
    projectId: ObjectID.generate(),
    testByUserId: TEST_BY_USER_ID,
    props: { isRoot: true },
  });
}

// What each post was addressed to.
function posted(): Array<WorkspaceMessagePayload> {
  return postSpy.mock.calls.map(
    (call: Array<unknown>): WorkspaceMessagePayload => {
      return (
        call[0] as {
          messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
        }
      ).messagePayloadsByWorkspace[0]!;
    },
  );
}

function asked(): Array<{ channelName: string; teamId?: string }> {
  return doesChannelExist.mock.calls.map(
    (call: Array<unknown>): { channelName: string; teamId?: string } => {
      const data: { channelName: string; teamId?: string } = call[0] as {
        channelName: string;
        teamId?: string;
      };
      return {
        channelName: data.channelName,
        ...(data.teamId !== undefined ? { teamId: data.teamId } : {}),
      };
    },
  );
}

beforeEach(() => {
  createdChannels = [];
  channelExists = (): boolean => {
    return true;
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Test Rule for a Slack rule naming a workspace", () => {
  test("whether each channel exists is asked of that workspace", async () => {
    await testRule(
      slackRule({
        shouldPostToExistingChannel: true,
        existingChannelNames: "general,incidents",
        existingTeam: EAST,
      }),
    );

    expect(asked()).toEqual([
      { channelName: "general", teamId: EAST },
      { channelName: "incidents", teamId: EAST },
    ]);
  });

  test("the test message to each channel goes out naming the workspace", async () => {
    await testRule(
      slackRule({
        shouldPostToExistingChannel: true,
        existingChannelNames: "general,incidents",
        existingTeam: EAST,
      }),
    );

    expect(posted()).toEqual([
      expect.objectContaining({
        workspaceType: WorkspaceType.Slack,
        channelNames: ["general"],
        channelIds: [],
        teamId: EAST,
      }),
      expect.objectContaining({
        channelNames: ["incidents"],
        channelIds: [],
        teamId: EAST,
      }),
    ]);
  });

  test("a channel the workspace does not have: the test says so, and nothing is posted", async () => {
    channelExists = (channelName: string, teamId: string | undefined) => {
      return !(channelName === "incidents" && teamId === EAST);
    };

    await expect(
      testRule(
        slackRule({
          shouldPostToExistingChannel: true,
          existingChannelNames: "incidents",
          existingTeam: EAST,
        }),
      ),
    ).rejects.toThrow(
      "Channel incidents does not exist. If this channel is private, you need to invite OneUptime bot to the channel and try again.",
    );
    expect(postSpy).not.toHaveBeenCalled();
  });
});

describe("Test Rule for a Slack rule naming no workspace (as before)", () => {
  test("no workspace is asked of, and none goes with the message", async () => {
    await testRule(
      slackRule({
        shouldPostToExistingChannel: true,
        existingChannelNames: "general",
      }),
    );

    expect(asked()).toEqual([{ channelName: "general" }]);
    expect(posted()).toHaveLength(1);
    expect(posted()[0]!.channelNames).toEqual(["general"]);
    expect("teamId" in posted()[0]!).toBe(false);
  });
});

describe("Test Rule for a channel the test created", () => {
  test("it is posted to by its id - an id needs no workspace", async () => {
    createdChannels = [
      {
        id: "C0NEWEAST",
        name: "oneuptime-incident-12",
        workspaceType: WorkspaceType.Slack,
        teamId: EAST,
        notificationRuleId: ObjectID.generate().toString(),
      },
    ];

    await testRule(
      slackRule({
        shouldCreateNewChannel: true,
        teamToCreateChannelIn: EAST,
        newChannelTemplateName: "oneuptime-incident-",
      }),
    );

    expect(posted()).toHaveLength(1);
    expect(posted()[0]!.channelIds).toEqual(["C0NEWEAST"]);
    expect(posted()[0]!.channelNames).toEqual([]);
    expect(posted()[0]!.teamId).toBeUndefined();
  });

  test("a rule that creates a channel and posts to existing ones: each post is addressed its own way", async () => {
    createdChannels = [
      {
        id: "C0NEWWEST",
        name: "oneuptime-incident-12",
        workspaceType: WorkspaceType.Slack,
        teamId: WEST,
        notificationRuleId: ObjectID.generate().toString(),
      },
    ];

    await testRule(
      slackRule({
        shouldCreateNewChannel: true,
        teamToCreateChannelIn: WEST,
        newChannelTemplateName: "oneuptime-incident-",
        shouldPostToExistingChannel: true,
        existingChannelNames: "general",
        existingTeam: EAST,
      }),
    );

    expect(
      posted().map((payload: WorkspaceMessagePayload) => {
        return {
          channelIds: payload.channelIds,
          channelNames: payload.channelNames,
          teamId: payload.teamId,
        };
      }),
    ).toEqual([
      { channelIds: ["C0NEWWEST"], channelNames: [], teamId: undefined },
      { channelIds: [], channelNames: ["general"], teamId: EAST },
    ]);
  });
});

describe("getExistingChannelNamesFromNotificationRules", () => {
  test("a Slack rule's workspace is each of its channels' teamId; a rule naming none gives none", () => {
    const channels: Array<WorkspaceChannel> =
      WorkspaceNotificationRuleService.getExistingChannelNamesFromNotificationRules(
        {
          workspaceType: WorkspaceType.Slack,
          notificationRules: [
            slackRule({
              shouldPostToExistingChannel: true,
              existingChannelNames: "general,incidents",
              existingTeam: EAST,
            }).notificationRule as BaseNotificationRule,
            slackRule({
              shouldPostToExistingChannel: true,
              existingChannelNames: "ops",
            }).notificationRule as BaseNotificationRule,
          ],
        },
      );

    expect(channels).toEqual([
      {
        id: "general",
        name: "general",
        workspaceType: WorkspaceType.Slack,
        teamId: EAST,
      },
      {
        id: "incidents",
        name: "incidents",
        workspaceType: WorkspaceType.Slack,
        teamId: EAST,
      },
      { id: "ops", name: "ops", workspaceType: WorkspaceType.Slack },
    ]);
  });
});
