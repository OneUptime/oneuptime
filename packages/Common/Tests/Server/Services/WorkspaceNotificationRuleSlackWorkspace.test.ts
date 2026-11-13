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
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import SlackOrganization, {
  SlackOrganizationConnection,
  SlackWorkspaceNotAddedException,
} from "../../../Server/Utils/Workspace/Slack/SlackOrganization";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import BadRequestException from "../../../Types/Exception/BadRequestException";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceNotificationActionType from "../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceNotificationStatus from "../../../Types/Workspace/WorkspaceNotificationStatus";
import { WorkspaceChannelNameParts } from "../../../Utils/Workspace/WorkspaceChannelName";
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

// What a rule picking Acme East is told once OneUptime is removed from it.
const NOT_ADDED_TO_EAST: string =
  "OneUptime is no longer added to the Acme East workspace of Acme Corp. Add it again in Slack's organization settings, or pick another workspace on the rule.";

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

// Tests a rule that creates its channel in Acme East, refused with `error`.
async function testRuleCreatingIn(error: Error): Promise<void> {
  const rule: WorkspaceNotificationRule = slackRule({
    shouldCreateNewChannel: true,
    teamToCreateChannelIn: EAST,
    newChannelTemplateName: "oneuptime-incident-",
  });

  install(rule);

  jest
    .mocked(WorkspaceNotificationRuleService.createChannelsBasedOnRules)
    .mockRejectedValue(error as never);

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

  test("a workspace OneUptime was removed from: the test says so plainly - not that the channel does not exist - and nothing is posted", async () => {
    // Slack's channel lookup, refusing the workspace (getWorkspaceChannelByName).
    channelExists = (): boolean => {
      throw new SlackWorkspaceNotAddedException({
        message: NOT_ADDED_TO_EAST,
        teamId: EAST,
      });
    };

    const testing: Promise<void> = testRule(
      slackRule({
        shouldPostToExistingChannel: true,
        existingChannelNames: "incidents",
        existingTeam: EAST,
      }),
    );

    await expect(testing).rejects.toBeInstanceOf(BadDataException);
    await expect(testing).rejects.toThrow(NOT_ADDED_TO_EAST);
    await expect(testing).rejects.not.toThrow("does not exist");
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("a channel to create in a workspace OneUptime was removed from: the test says so plainly, as its Notification Logs do", async () => {
    let refusal: unknown = null;

    try {
      await testRuleCreatingIn(
        new SlackWorkspaceNotAddedException({
          message: NOT_ADDED_TO_EAST,
          teamId: EAST,
        }),
      );
    } catch (err) {
      refusal = err;
    }

    expect(refusal).toBeInstanceOf(BadDataException);
    expect((refusal as Error).message).toBe(NOT_ADDED_TO_EAST);
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("any other channel the workspace does not create: 'Cannot create a new channel.' and what it answered, as before", async () => {
    let refusal: unknown = null;

    try {
      await testRuleCreatingIn(
        new BadRequestException("Error from Slack restricted_action"),
      );
    } catch (err) {
      refusal = err;
    }

    expect((refusal as Error).message).toBe(
      "Cannot create a new channel. Error from Slack restricted_action",
    );
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
      // In the words its Notification Logs give the channel when the rule posts (#7115).
      "The Slack channel #incidents was not found. If it is a private channel, invite OneUptime's bot to it in Slack.",
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

/*
 * CREATING RULES' CHANNELS FOR AN ORGANIZATION'S INSTALLATION
 * (createChannelsBasedOnRules): the project's organization is read once for
 * every channel created for a record, and handed to each (#6749) - and a
 * channel in a workspace OneUptime was removed from is logged as not
 * created, saying so plainly.
 */
describe("creating rules' channels for an organization's installation", () => {
  const PROJECT_ID: ObjectID = new ObjectID(
    "c8000000-0000-4000-8000-000000000003",
  );

  const NAME_PARTS: WorkspaceChannelNameParts = {
    afterPrefix: "12",
    ownName: "incident-12",
  };

  let rows: Array<WorkspaceNotificationLog>;

  function connection(
    miscData: Partial<SlackMiscData> = {},
  ): WorkspaceProjectAuthToken {
    const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
    auth.projectId = PROJECT_ID;
    auth.workspaceType = WorkspaceType.Slack;
    auth.authToken = "xoxb-acme-organization";
    auth.workspaceProjectId = "E0ACME";
    auth.miscData = {
      teamId: "E0ACME",
      teamName: "Acme Corp",
      botUserId: "U0BOT",
      isEnterpriseInstall: true,
      enterpriseId: "E0ACME",
      enterpriseName: "Acme Corp",
      workspaces: [
        { id: EAST, name: "Acme East" },
        { id: WEST, name: "Acme West" },
      ],
      // Listed just now: Slack is not asked for them again.
      workspacesReadAt: OneUptimeDate.toString(OneUptimeDate.getCurrentDate()),
      defaultWorkspaceId: WEST,
      ...miscData,
    } as SlackMiscData;
    return auth;
  }

  function creatingRule(
    template: string,
    teamId?: string | undefined,
  ): WorkspaceNotificationRule {
    return slackRule({
      shouldCreateNewChannel: true,
      newChannelTemplateName: template,
      ...(teamId ? { teamToCreateChannelIn: teamId } : {}),
    });
  }

  async function createChannels(
    rules: Array<WorkspaceNotificationRule>,
  ): Promise<Array<NotificationRuleWorkspaceChannel>> {
    return await WorkspaceNotificationRuleService.createChannelsBasedOnRules({
      projectId: PROJECT_ID,
      projectOrUserAuthTokenForWorkspace: "xoxb-acme-organization",
      workspaceType: WorkspaceType.Slack,
      notificationRules: rules,
      channelNameParts: NAME_PARTS,
      notificationEventType: NotificationRuleEventType.Incident,
    });
  }

  beforeEach(() => {
    rows = [];

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(connection());

    jest
      .spyOn(WorkspaceNotificationLogService, "create")
      .mockImplementation((async (data: {
        data: WorkspaceNotificationLog;
      }): Promise<WorkspaceNotificationLog> => {
        rows.push(data.data);
        return data.data;
      }) as never);
  });

  test("the organization is read once, and each channel is created with it - in the workspace its rule picks, else the default", async () => {
    const reads: SpyInstance<typeof SlackOrganization.getOfConnection> =
      jest.spyOn(SlackOrganization, "getOfConnection");

    const create: SpyInstance<typeof SlackUtil.createChannel> = jest
      .spyOn(SlackUtil, "createChannel")
      .mockImplementation((async (data: {
        channelName: string;
        teamId?: string | undefined;
      }): Promise<WorkspaceChannel> => {
        return {
          id: `C0${data.channelName.toUpperCase()}`,
          name: data.channelName,
          workspaceType: WorkspaceType.Slack,
          ...(data.teamId ? { teamId: data.teamId } : {}),
        };
      }) as never);

    const channels: Array<NotificationRuleWorkspaceChannel> =
      await createChannels([
        creatingRule("east-", EAST),
        creatingRule("default-"),
        creatingRule("west-", WEST),
      ]);

    expect(channels).toHaveLength(3);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(3);

    const given: Array<SlackOrganizationConnection | null | undefined> =
      create.mock.calls.map(
        (call: Array<unknown>): SlackOrganizationConnection | null => {
          return (
            call[0] as { organization: SlackOrganizationConnection | null }
          ).organization;
        },
      );

    expect(given[0]).toMatchObject({
      enterpriseId: "E0ACME",
      defaultWorkspaceId: WEST,
    });
    expect(given[1]).toBe(given[0]);
    expect(given[2]).toBe(given[0]);
    expect(
      create.mock.calls.map((call: Array<unknown>): unknown => {
        return (call[0] as { teamId?: string }).teamId;
      }),
    ).toEqual([EAST, WEST, WEST]);
  });

  test("a rule's workspace OneUptime was removed from: no channel - not in another workspace either - and its Notification Logs row says so plainly", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(
        connection({
          workspaces: [{ id: WEST, name: "Acme West" }],
          removedWorkspaces: [{ id: EAST, name: "Acme East" }],
        }),
      );

    // Slack itself is never asked: refused before it would be.
    const slack: SpyInstance<typeof SlackUtil.createChannel> = jest.spyOn(
      SlackUtil,
      "createChannel",
    );

    const channels: Array<NotificationRuleWorkspaceChannel> =
      await createChannels([creatingRule("east-", EAST)]);

    expect(channels).toEqual([]);
    expect(slack).toHaveBeenCalledTimes(1);

    const notCreated: Array<WorkspaceNotificationLog> = rows.filter(
      (row: WorkspaceNotificationLog): boolean => {
        return row.actionType === WorkspaceNotificationActionType.CreateChannel;
      },
    );

    expect(notCreated).toHaveLength(1);
    expect(notCreated[0]!.status).toBe(WorkspaceNotificationStatus.Error);
    expect(notCreated[0]!.statusMessage).toBe(NOT_ADDED_TO_EAST);
  });
});
