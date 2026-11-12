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
  MattermostMiscData,
} from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import MattermostUtil, {
  MattermostRequestError,
} from "../../../Server/Utils/Workspace/Mattermost/Mattermost";
import MattermostConnection from "../../../Server/Utils/Workspace/Mattermost/MattermostConnection";
import WorkspaceUtil from "../../../Server/Utils/Workspace/Workspace";
import { WorkspaceChannel } from "../../../Server/Utils/Workspace/WorkspaceBase";
import OneUptimeDate from "../../../Types/Date";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import BaseNotificationRule from "../../../Types/Workspace/NotificationRules/BaseNotificationRule";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleWorkspaceChannel from "../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import IncidentNotificationRule from "../../../Types/Workspace/NotificationRules/NotificationRuleTypes/IncidentNotificationRule";
import WorkspaceMessagePayload from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import WorkspaceChannelName, {
  WorkspaceChannelNameParts,
} from "../../../Utils/Workspace/WorkspaceChannelName";

jest.mock("../../../Server/Utils/Logger");

/*
 * A MATTERMOST RULE THAT NAMES A TEAM OF THE PROJECT'S SERVER.
 *
 * A project connected to a Mattermost server works in every team its bot
 * is a member of (MattermostTeams). A rule names the team its existing
 * channels are in (existingTeam) and the team it creates its channels in
 * (teamToCreateChannelIn), as a Microsoft Teams rule names its team; a rule
 * that names none works in the default team - the one the project was
 * connected to, until a member makes another one the default. One name in
 * two teams is two channels: town-square of Engineering is not Support's.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "d8000000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "d8000000-0000-4000-8000-000000000002",
);
const TEST_BY_USER_ID: ObjectID = new ObjectID(
  "d8000000-0000-4000-8000-000000000003",
);

const FIRST_RULE_ID: ObjectID = new ObjectID(
  "d8000000-0000-4000-8000-000000000011",
);
const SECOND_RULE_ID: ObjectID = new ObjectID(
  "d8000000-0000-4000-8000-000000000012",
);
const THIRD_RULE_ID: ObjectID = new ObjectID(
  "d8000000-0000-4000-8000-000000000013",
);
// A rule whose channel the record has, opened before the rules below.
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "d8000000-0000-4000-8000-000000000014",
);

// The team the project was connected to, and the default until changed.
const ENGINEERING: string = "e".repeat(26);
const SUPPORT: string = "s".repeat(26);
const BOT_ID: string = "b".repeat(26);

// What INC-9's channels are named from.
const INCIDENT_CHANNEL_NAME_PARTS: WorkspaceChannelNameParts =
  WorkspaceChannelName.forNumberedRecord({
    eventType: NotificationRuleEventType.Incident,
    number: 9,
    numberWithPrefix: "INC-9",
  });

// The channel a rule with the template "incidents-" asks for INC-9.
const CHANNEL_NAME: string = WorkspaceChannelName.getChannelName({
  workspaceType: WorkspaceType.Mattermost,
  prefix: "incidents-",
  parts: INCIDENT_CHANNEL_NAME_PARTS,
});

// The project's connection; Engineering is the default unless `defaultTeam` says.
function mattermostAuth(
  defaultTeam: string = ENGINEERING,
): WorkspaceProjectAuthToken {
  const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  auth.projectId = PROJECT_ID;
  auth.workspaceType = WorkspaceType.Mattermost;
  auth.workspaceProjectId = ENGINEERING;
  auth.authToken = MattermostConnection.toAuthToken({
    serverUrl: "https://chat.example.com",
    accessToken: "abcdefghijklmnopqrstuvwxyz",
    teamId: defaultTeam,
    botUserId: BOT_ID,
  });

  const isEngineering: boolean = defaultTeam === ENGINEERING;

  auth.miscData = {
    serverUrl: "https://chat.example.com",
    teamId: defaultTeam,
    teamName: isEngineering ? "engineering" : "support",
    teamDisplayName: isEngineering ? "Engineering" : "Support",
    botUserId: BOT_ID,
    botUsername: "oneuptime",
    teams: [
      { id: ENGINEERING, name: "engineering", displayName: "Engineering" },
      { id: SUPPORT, name: "support", displayName: "Support" },
    ],
    // Listed just now: the server is not asked for them again.
    teamsReadAt: OneUptimeDate.toString(OneUptimeDate.getCurrentDate()),
  } as MattermostMiscData;

  return auth;
}

interface RuleSwitches {
  shouldPostToExistingChannel?: boolean;
  existingChannelNames?: string;
  existingTeam?: string;
  shouldCreateNewChannel?: boolean;
  teamToCreateChannelIn?: string;
}

function incidentRule(
  id: ObjectID,
  switches: RuleSwitches = {},
): WorkspaceNotificationRule {
  const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  rule.id = id;
  rule.projectId = PROJECT_ID;
  rule.workspaceType = WorkspaceType.Mattermost;
  rule.eventType = NotificationRuleEventType.Incident;
  rule.name = "Support incidents";

  const notificationRule: IncidentNotificationRule = {
    _type: "IncidentNotificationRule",
    filterCondition: FilterCondition.Any,
    filters: [],
    shouldPostToExistingChannel: switches.shouldPostToExistingChannel ?? false,
    existingChannelNames: switches.existingChannelNames ?? "",
    shouldCreateNewChannel: switches.shouldCreateNewChannel ?? true,
    newChannelTemplateName: "incidents-",
    inviteUsersToNewChannel: [],
    inviteTeamsToNewChannel: [],
    shouldInviteOwnersToNewChannel: false,
    archiveChannelAutomatically: true,
    shouldAutomaticallyInviteOnCallUsersToNewChannel: false,
  };

  if (switches.existingTeam) {
    notificationRule.existingTeam = switches.existingTeam;
  }

  if (switches.teamToCreateChannelIn) {
    notificationRule.teamToCreateChannelIn = switches.teamToCreateChannelIn;
  }

  rule.notificationRule = notificationRule as never;
  return rule;
}

// A rule that posts to existing channels, in the team it names.
function postingRule(
  channelNames: string,
  team?: string,
): BaseNotificationRule {
  return incidentRule(FIRST_RULE_ID, {
    shouldCreateNewChannel: false,
    shouldPostToExistingChannel: true,
    existingChannelNames: channelNames,
    ...(team ? { existingTeam: team } : {}),
  }).notificationRule as BaseNotificationRule;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Test Rule for a Mattermost rule naming a team", () => {
  let doesChannelExist: Mock<(data: unknown) => Promise<boolean>>;
  let postSpy: SpyInstance<
    typeof WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot
  >;
  let channelExists: (channelName: string, teamId?: string) => boolean;

  beforeEach(() => {
    channelExists = (): boolean => {
      return true;
    };
  });

  // `workspaceUtil`: what is asked whether each channel exists - the mock below by default.
  async function testRule(
    rule: WorkspaceNotificationRule,
    workspaceUtil?: unknown,
  ): Promise<void> {
    jest
      .spyOn(WorkspaceNotificationRuleService, "findOneById")
      .mockResolvedValue(rule);

    const userAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
    userAuth.workspaceUserId = "u".repeat(26);
    jest
      .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
      .mockResolvedValue(userAuth);

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
      .mockResolvedValue(mattermostAuth());

    jest
      .spyOn(WorkspaceNotificationRuleService, "createChannelsBasedOnRules")
      .mockResolvedValue([]);

    doesChannelExist = jest.fn(async (data: unknown): Promise<boolean> => {
      const asked: { channelName: string; teamId?: string } = data as {
        channelName: string;
        teamId?: string;
      };
      return channelExists(asked.channelName, asked.teamId);
    });

    jest
      .spyOn(WorkspaceUtil, "getWorkspaceTypeUtil")
      .mockReturnValue(
        (workspaceUtil || { doesChannelExist: doesChannelExist }) as never,
      );

    postSpy = jest
      .spyOn(WorkspaceUtil, "postMessageToAllWorkspaceChannelsAsBot")
      .mockResolvedValue([
        { workspaceType: WorkspaceType.Mattermost, threads: [], errors: [] },
      ]);

    jest
      .spyOn(WorkspaceNotificationLogService, "create")
      .mockResolvedValue(new WorkspaceNotificationLog());

    await WorkspaceNotificationRuleService.testRule({
      ruleId: rule.id!,
      projectId: PROJECT_ID,
      testByUserId: TEST_BY_USER_ID,
      props: { isRoot: true },
    });
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

  test("whether each channel exists is asked of that team", async () => {
    await testRule(
      incidentRule(FIRST_RULE_ID, {
        shouldCreateNewChannel: false,
        shouldPostToExistingChannel: true,
        existingChannelNames: "town-square,incidents",
        existingTeam: SUPPORT,
      }),
    );

    expect(asked()).toEqual([
      { channelName: "town-square", teamId: SUPPORT },
      { channelName: "incidents", teamId: SUPPORT },
    ]);
  });

  test("the test message to each channel goes out naming the team", async () => {
    await testRule(
      incidentRule(FIRST_RULE_ID, {
        shouldCreateNewChannel: false,
        shouldPostToExistingChannel: true,
        existingChannelNames: "incidents",
        existingTeam: SUPPORT,
      }),
    );

    expect(posted()).toEqual([
      expect.objectContaining({
        workspaceType: WorkspaceType.Mattermost,
        channelNames: ["incidents"],
        channelIds: [],
        teamId: SUPPORT,
      }),
    ]);
  });

  test("a channel the team does not have: the test says so, and nothing is posted", async () => {
    channelExists = (channelName: string, teamId?: string): boolean => {
      return !(channelName === "incidents" && teamId === SUPPORT);
    };

    await expect(
      testRule(
        incidentRule(FIRST_RULE_ID, {
          shouldCreateNewChannel: false,
          shouldPostToExistingChannel: true,
          existingChannelNames: "incidents",
          existingTeam: SUPPORT,
        }),
      ),
    ).rejects.toThrow(
      // In the words its Notification Logs give the channel when the rule posts.
      "The Mattermost channel incidents was not found. If it is a private channel, add OneUptime's bot to it in Mattermost.",
    );
    expect(postSpy).not.toHaveBeenCalled();
  });

  /*
   * #6775: the bot was taken out of the team the rule names. The server
   * refuses it that team's channels; the test says so in plain words, as
   * the rule's Notification Logs do (MattermostUtil.findChannelByName),
   * rather than passing Mattermost's refusal on - and posts nothing.
   */
  test("a team the bot was taken out of: the test says so, rather than Mattermost's refusal, and nothing is posted", async () => {
    const paths: Array<string> = [];

    jest.spyOn(MattermostUtil, "callServer").mockImplementation((async (call: {
      path: string;
    }) => {
      paths.push(call.path);

      // The bot is in Engineering alone now.
      if (call.path === "/api/v4/users/me/teams") {
        return [
          { id: ENGINEERING, name: "engineering", display_name: "Engineering" },
        ];
      }

      throw new MattermostRequestError({
        message:
          "Error from Mattermost: You do not have the appropriate permissions.",
        statusCode: 403,
        errorId: "api.context.permissions.app_error",
      });
    }) as never);

    await expect(
      testRule(
        incidentRule(FIRST_RULE_ID, {
          shouldCreateNewChannel: false,
          shouldPostToExistingChannel: true,
          existingChannelNames: "incidents",
          existingTeam: SUPPORT,
        }),
        MattermostUtil,
      ),
    ).rejects.toThrow(
      "OneUptime's bot is not a member of the Mattermost team chosen for the channel incidents, so it cannot look for the channel there. Add the bot to that team in Mattermost, or choose another team, then try again.",
    );
    expect(postSpy).not.toHaveBeenCalled();
    // Looked for in Support alone.
    expect(
      paths.filter((path: string): boolean => {
        return path.includes(ENGINEERING);
      }),
    ).toEqual([]);
  });

  test("a rule naming no team: none is asked of, and none goes with the message", async () => {
    await testRule(
      incidentRule(FIRST_RULE_ID, {
        shouldCreateNewChannel: false,
        shouldPostToExistingChannel: true,
        existingChannelNames: "incidents",
      }),
    );

    expect(asked()).toEqual([{ channelName: "incidents" }]);
    expect(posted()).toHaveLength(1);
    expect("teamId" in posted()[0]!).toBe(false);
  });
});

describe("a record's channels, created in the team each rule names", () => {
  let createdIn: Array<{ channelName: string; teamId: string | undefined }>;

  beforeEach(() => {
    createdIn = [];

    jest
      .spyOn(MattermostUtil, "createChannel")
      .mockImplementation((async (data: {
        channelName: string;
        teamId?: string;
      }): Promise<WorkspaceChannel> => {
        createdIn.push({ channelName: data.channelName, teamId: data.teamId });

        return {
          id: String(createdIn.length).padStart(26, "c"),
          name: data.channelName,
          workspaceType: WorkspaceType.Mattermost,
          ...(data.teamId !== undefined ? { teamId: data.teamId } : {}),
        };
      }) as never);

    jest
      .spyOn(WorkspaceNotificationLogService, "logCreateChannel")
      .mockResolvedValue(undefined as never);
  });

  async function createChannels(data: {
    rules: Array<WorkspaceNotificationRule>;
    defaultTeam?: string;
  }): Promise<Array<NotificationRuleWorkspaceChannel>> {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(mattermostAuth(data.defaultTeam));

    return await WorkspaceNotificationRuleService.createChannelsBasedOnRules({
      projectId: PROJECT_ID,
      projectOrUserAuthTokenForWorkspace: mattermostAuth().authToken!,
      workspaceType: WorkspaceType.Mattermost,
      notificationRules: data.rules,
      channelNameParts: INCIDENT_CHANNEL_NAME_PARTS,
      notificationEventType: NotificationRuleEventType.Incident,
      notificationFor: { incidentId: INCIDENT_ID },
    });
  }

  function teamsAndRulesOf(
    channels: Array<NotificationRuleWorkspaceChannel>,
  ): Array<Array<unknown>> {
    return channels.map(
      (channel: NotificationRuleWorkspaceChannel): Array<unknown> => {
        return [channel.teamId, channel.notificationRuleIds];
      },
    );
  }

  test("REGRESSION: rules asking for one name in two teams get a channel in each, each with its own rule", async () => {
    const channels: Array<NotificationRuleWorkspaceChannel> =
      await createChannels({
        rules: [
          incidentRule(FIRST_RULE_ID, { teamToCreateChannelIn: ENGINEERING }),
          incidentRule(SECOND_RULE_ID, { teamToCreateChannelIn: SUPPORT }),
        ],
      });

    expect(createdIn).toEqual([
      { channelName: CHANNEL_NAME, teamId: ENGINEERING },
      { channelName: CHANNEL_NAME, teamId: SUPPORT },
    ]);
    expect(teamsAndRulesOf(channels)).toEqual([
      [ENGINEERING, [FIRST_RULE_ID.toString()]],
      [SUPPORT, [SECOND_RULE_ID.toString()]],
    ]);
  });

  test("a rule naming no team and one naming the default share the default team's channel", async () => {
    const channels: Array<NotificationRuleWorkspaceChannel> =
      await createChannels({
        rules: [
          incidentRule(FIRST_RULE_ID),
          incidentRule(SECOND_RULE_ID, { teamToCreateChannelIn: ENGINEERING }),
        ],
      });

    // Asked for once: the second would be refused as taken, and made name-2.
    expect(createdIn).toEqual([
      { channelName: CHANNEL_NAME, teamId: ENGINEERING },
    ]);
    expect(teamsAndRulesOf(channels)).toEqual([
      [ENGINEERING, [FIRST_RULE_ID.toString(), SECOND_RULE_ID.toString()]],
    ]);
  });

  test("a rule naming no team and one naming another: a channel each, in the default and in the other", async () => {
    await createChannels({
      rules: [
        incidentRule(FIRST_RULE_ID),
        incidentRule(SECOND_RULE_ID, { teamToCreateChannelIn: SUPPORT }),
      ],
    });

    expect(createdIn).toEqual([
      { channelName: CHANNEL_NAME, teamId: ENGINEERING },
      { channelName: CHANNEL_NAME, teamId: SUPPORT },
    ]);
  });

  test("a rule whose team is not a Mattermost id, written through the API before rules named one, creates its channel in the default team, as it did", async () => {
    const channels: Array<NotificationRuleWorkspaceChannel> =
      await createChannels({
        rules: [
          incidentRule(FIRST_RULE_ID, { teamToCreateChannelIn: "engineering" }),
          incidentRule(SECOND_RULE_ID),
        ],
      });

    expect(createdIn).toEqual([
      { channelName: CHANNEL_NAME, teamId: ENGINEERING },
    ]);
    expect(teamsAndRulesOf(channels)).toEqual([
      [ENGINEERING, [FIRST_RULE_ID.toString(), SECOND_RULE_ID.toString()]],
    ]);
  });

  test("once another team is the default, a rule naming no team creates its channel there", async () => {
    await createChannels({
      rules: [
        incidentRule(FIRST_RULE_ID),
        incidentRule(SECOND_RULE_ID, { teamToCreateChannelIn: SUPPORT }),
        incidentRule(THIRD_RULE_ID, { teamToCreateChannelIn: ENGINEERING }),
      ],
      defaultTeam: SUPPORT,
    });

    expect(createdIn).toEqual([
      { channelName: CHANNEL_NAME, teamId: SUPPORT },
      { channelName: CHANNEL_NAME, teamId: ENGINEERING },
    ]);
  });
});

describe("a record's channel of a rule, by its name, in the rule's Mattermost team", () => {
  type RulesWithoutTheirChannel = (data: {
    rules: Array<WorkspaceNotificationRule>;
    record: { channels: Array<NotificationRuleWorkspaceChannel> };
    projectAuth: WorkspaceProjectAuthToken;
    workspaceType: WorkspaceType;
  }) => Array<WorkspaceNotificationRule>;

  // Which of the rules INC-9 has no channel for.
  function rulesWithoutTheirChannel(data: {
    rules: Array<WorkspaceNotificationRule>;
    channels: Array<NotificationRuleWorkspaceChannel>;
    projectAuth: WorkspaceProjectAuthToken;
  }): Array<string> {
    const service: { getRulesWithoutTheirChannel: RulesWithoutTheirChannel } =
      WorkspaceNotificationRuleService as unknown as {
        getRulesWithoutTheirChannel: RulesWithoutTheirChannel;
      };

    return service
      .getRulesWithoutTheirChannel({
        rules: data.rules,
        record: {
          channels: data.channels,
          channelNameParts: INCIDENT_CHANNEL_NAME_PARTS,
        } as never,
        projectAuth: data.projectAuth,
        workspaceType: WorkspaceType.Mattermost,
      })
      .map((rule: WorkspaceNotificationRule): string => {
        return rule.id!.toString();
      });
  }

  // A channel INC-9 has, opened by a rule that is not among these.
  function channelOfAnotherRule(
    teamId?: string,
  ): NotificationRuleWorkspaceChannel {
    return {
      id: "h".repeat(26),
      name: CHANNEL_NAME,
      workspaceType: WorkspaceType.Mattermost,
      notificationRuleId: OTHER_RULE_ID.toString(),
      ...(teamId ? { teamId: teamId } : {}),
    };
  }

  test("a channel created before teams were told apart is in the team the project was connected to", () => {
    expect(
      rulesWithoutTheirChannel({
        rules: [
          incidentRule(FIRST_RULE_ID),
          incidentRule(SECOND_RULE_ID, { teamToCreateChannelIn: ENGINEERING }),
          incidentRule(THIRD_RULE_ID, { teamToCreateChannelIn: SUPPORT }),
        ],
        channels: [channelOfAnotherRule()],
        projectAuth: mattermostAuth(),
      }),
    ).toEqual([THIRD_RULE_ID.toString()]);
  });

  test("a channel of the name in another team is not the rule's", () => {
    expect(
      rulesWithoutTheirChannel({
        rules: [
          incidentRule(FIRST_RULE_ID),
          incidentRule(SECOND_RULE_ID, { teamToCreateChannelIn: SUPPORT }),
        ],
        channels: [channelOfAnotherRule(SUPPORT)],
        projectAuth: mattermostAuth(),
      }),
    ).toEqual([FIRST_RULE_ID.toString()]);
  });

  test("once another team is the default, a channel that names no team is still the connected team's", () => {
    expect(
      rulesWithoutTheirChannel({
        rules: [
          incidentRule(FIRST_RULE_ID),
          incidentRule(SECOND_RULE_ID, { teamToCreateChannelIn: ENGINEERING }),
        ],
        channels: [channelOfAnotherRule()],
        projectAuth: mattermostAuth(SUPPORT),
      }),
    ).toEqual([FIRST_RULE_ID.toString()]);
  });
});

describe("the existing Mattermost channels rules post to, each once", () => {
  function existingChannels(data: {
    rules: Array<BaseNotificationRule>;
    projectAuth?: WorkspaceProjectAuthToken | null;
  }): Array<Array<string | undefined>> {
    return WorkspaceNotificationRuleService.getExistingChannelNamesFromNotificationRules(
      {
        notificationRules: data.rules,
        workspaceType: WorkspaceType.Mattermost,
        projectAuth: data.projectAuth,
      },
    ).map((channel: WorkspaceChannel): Array<string | undefined> => {
      return [channel.name, channel.teamId];
    });
  }

  test("REGRESSION: one name in two teams is two channels", () => {
    expect(
      existingChannels({
        rules: [
          postingRule("town-square", ENGINEERING),
          postingRule("town-square", SUPPORT),
        ],
        projectAuth: mattermostAuth(),
      }),
    ).toEqual([
      ["town-square", ENGINEERING],
      ["town-square", SUPPORT],
    ]);
  });

  test("a rule naming no team and one naming the default post once, as the first rule asked", () => {
    expect(
      existingChannels({
        rules: [
          postingRule("incidents"),
          postingRule("incidents", ENGINEERING),
        ],
        projectAuth: mattermostAuth(),
      }),
    ).toEqual([["incidents", undefined]]);
  });

  test("a rule naming no team and one naming another: two channels", () => {
    expect(
      existingChannels({
        rules: [postingRule("incidents"), postingRule("incidents", SUPPORT)],
        projectAuth: mattermostAuth(),
      }),
    ).toEqual([
      ["incidents", undefined],
      ["incidents", SUPPORT],
    ]);
  });

  test("a rule naming a team by something that is not a Mattermost id posts once with one naming none", () => {
    expect(
      existingChannels({
        rules: [
          postingRule("incidents"),
          postingRule("incidents", "engineering"),
        ],
        projectAuth: mattermostAuth(),
      }),
    ).toEqual([["incidents", undefined]]);
  });

  test("once another team is the default, naming none is naming it", () => {
    expect(
      existingChannels({
        rules: [
          postingRule("incidents"),
          postingRule("incidents", SUPPORT),
          postingRule("incidents", ENGINEERING),
        ],
        projectAuth: mattermostAuth(SUPPORT),
      }),
    ).toEqual([
      ["incidents", undefined],
      ["incidents", ENGINEERING],
    ]);
  });

  test("the project's connection is read only when a rule names a team", async () => {
    const getProjectAuth: SpyInstance<
      typeof WorkspaceProjectAuthTokenService.getProjectAuth
    > = jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(mattermostAuth());

    let matching: Array<WorkspaceNotificationRule> = [];

    jest
      .spyOn(
        WorkspaceNotificationRuleService as unknown as {
          getMatchingNotificationRules: () => Promise<
            Array<WorkspaceNotificationRule>
          >;
        },
        "getMatchingNotificationRules",
      )
      .mockImplementation(async () => {
        return matching;
      });

    const read: (
      rules: Array<BaseNotificationRule>,
    ) => Promise<Array<Array<string | undefined>>> = async (
      rules: Array<BaseNotificationRule>,
    ): Promise<Array<Array<string | undefined>>> => {
      matching = rules.map(
        (rule: BaseNotificationRule): WorkspaceNotificationRule => {
          const stored: WorkspaceNotificationRule = incidentRule(FIRST_RULE_ID);
          stored.notificationRule = rule as never;
          return stored;
        },
      );

      return (
        await WorkspaceNotificationRuleService.getExistingChannelNamesBasedOnEventType(
          {
            projectId: PROJECT_ID,
            workspaceType: WorkspaceType.Mattermost,
            notificationRuleEventType: NotificationRuleEventType.Incident,
            notificationFor: { incidentId: INCIDENT_ID },
          },
        )
      ).map((channel: WorkspaceChannel): Array<string | undefined> => {
        return [channel.name, channel.teamId];
      });
    };

    // No rule names a team: one name is one channel, the connection unread.
    expect(
      await read([postingRule("incidents"), postingRule("incidents")]),
    ).toEqual([["incidents", undefined]]);
    expect(getProjectAuth).not.toHaveBeenCalled();

    // A rule names the default team: read, and still one channel.
    expect(
      await read([
        postingRule("incidents"),
        postingRule("incidents", ENGINEERING),
        postingRule("incidents", SUPPORT),
      ]),
    ).toEqual([
      ["incidents", undefined],
      ["incidents", SUPPORT],
    ]);
    expect(getProjectAuth).toHaveBeenCalledTimes(1);
    expect(getProjectAuth.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.Mattermost,
    });
  });
});

describe("one name asked for in two teams, before any is created", () => {
  test("is asked for in each; names Mattermost creates as one in a team share it", () => {
    const channels: Array<Array<unknown>> =
      WorkspaceNotificationRuleService.getnotificationChannelssFromNotificationRules(
        {
          notificationEventType: NotificationRuleEventType.Incident,
          notificationRules: [
            incidentRule(FIRST_RULE_ID, { teamToCreateChannelIn: ENGINEERING }),
            incidentRule(SECOND_RULE_ID, { teamToCreateChannelIn: SUPPORT }),
            incidentRule(THIRD_RULE_ID, { teamToCreateChannelIn: ENGINEERING }),
          ],
          channelNameParts: INCIDENT_CHANNEL_NAME_PARTS,
          workspaceType: WorkspaceType.Mattermost,
        },
      ).map(
        (channel: { teamId?: string; notificationRuleIds: Array<string> }) => {
          return [channel.teamId, channel.notificationRuleIds];
        },
      );

    expect(channels).toEqual([
      [ENGINEERING, [FIRST_RULE_ID.toString(), THIRD_RULE_ID.toString()]],
      [SUPPORT, [SECOND_RULE_ID.toString()]],
    ]);
  });
});
