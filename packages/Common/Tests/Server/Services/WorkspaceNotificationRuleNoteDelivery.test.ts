import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import WorkspaceNotificationLog from "../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import AlertService from "../../../Server/Services/AlertService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../Server/Services/IncidentService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceNotificationRuleService from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
} from "../../../Server/Utils/Workspace/WorkspaceBase";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import ObjectID from "../../../Types/ObjectID";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import NotificationRuleWorkspaceChannel from "../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceMessagePayload, {
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import API from "../../../Utils/API";

/*
 * "When you post a private note or a public note, it does not post it to an
 * incident channel or an alert channel" — the whole path, from the feed item a
 * note writes to the send into the channel OneUptime created for the incident.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();

const TEAMS_CHANNEL: NotificationRuleWorkspaceChannel = {
  id: "19:incident-42@thread.tacv2",
  name: "incident-42",
  workspaceType: WorkspaceType.MicrosoftTeams,
  teamId: "team-graph-id",
  notificationRuleId: "rule-1",
};

const SLACK_CHANNEL: NotificationRuleWorkspaceChannel = {
  id: "C0INCIDENT42",
  name: "incident-42",
  workspaceType: WorkspaceType.Slack,
  notificationRuleId: "rule-2",
};

const NOTE_MARKDOWN: string =
  "📄 posted **private note** for this [Incident #42](https://oneuptime.test/incidents/42):\n\nRestarted the primary database.";

function projectAuth(workspaceType: WorkspaceType): WorkspaceProjectAuthToken {
  const token: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  token.projectId = projectId;
  token.workspaceType = workspaceType;
  token.authToken =
    workspaceType === WorkspaceType.Slack ? "xoxb-token" : "teams-token";
  token.miscData = { botUserId: "B0BOT" } as never;
  return token;
}

let teamsSendSpy: SpyInstance<typeof MicrosoftTeamsUtil.sendMessage>;
let slackSendSpy: SpyInstance<typeof SlackUtil.sendMessage>;
let logCreateSpy: SpyInstance<typeof WorkspaceNotificationLogService.create>;

function sentPayload(
  spy: SpyInstance<
    (data: { workspaceMessagePayload: WorkspaceMessagePayload }) => unknown
  >,
  index: number = 0,
): WorkspaceMessagePayload {
  return spy.mock.calls[index]![0].workspaceMessagePayload;
}

function thread(channel: WorkspaceChannel): WorkspaceSendMessageResponse {
  return {
    workspaceType: channel.workspaceType,
    threads: [{ channel: channel, threadId: "thread-1" }],
  };
}

beforeEach((): void => {
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockImplementation(
      async (data: {
        workspaceType: WorkspaceType;
      }): Promise<WorkspaceProjectAuthToken | null> => {
        return projectAuth(data.workspaceType);
      },
    );

  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue("**Jane Doe**");

  // The incident's own channels, one per workspace.
  jest
    .spyOn(IncidentService, "getWorkspaceChannelForIncident")
    .mockImplementation(
      async (data: {
        workspaceType?: WorkspaceType | null;
      }): Promise<Array<NotificationRuleWorkspaceChannel>> => {
        return [TEAMS_CHANNEL, SLACK_CHANNEL].filter(
          (channel: NotificationRuleWorkspaceChannel) => {
            return channel.workspaceType === data.workspaceType;
          },
        );
      },
    );

  jest
    .spyOn(WorkspaceNotificationRuleService, "getMatchingNotificationRules")
    .mockResolvedValue([]);
  jest
    .spyOn(
      WorkspaceNotificationRuleService,
      "getExistingChatIdsBasedOnEventType",
    )
    .mockResolvedValue([]);

  teamsSendSpy = jest
    .spyOn(MicrosoftTeamsUtil, "sendMessage")
    .mockResolvedValue(thread(TEAMS_CHANNEL));
  slackSendSpy = jest
    .spyOn(SlackUtil, "sendMessage")
    .mockResolvedValue(thread(SLACK_CHANNEL));

  logCreateSpy = jest
    .spyOn(WorkspaceNotificationLogService, "create")
    .mockResolvedValue(new WorkspaceNotificationLog());
});

afterEach((): void => {
  jest.restoreAllMocks();
});

describe("WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification — notes", () => {
  test("REGRESSION: a note by a user who linked Teams reaches the incident's Teams and Slack channels", async () => {
    // Linked to Teams before the display name was stored, so Graph is asked.
    const teamsUserAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
    teamsUserAuth.workspaceUserId = "aad-object-id";
    teamsUserAuth.miscData = {} as never;
    jest
      .spyOn(WorkspaceUserAuthTokenService, "getUserAuth")
      .mockImplementation(
        async (data: {
          workspaceType: WorkspaceType;
        }): Promise<WorkspaceUserAuthToken | null> => {
          return data.workspaceType === WorkspaceType.MicrosoftTeams
            ? teamsUserAuth
            : null;
        },
      );
    jest
      .spyOn(MicrosoftTeamsUtil, "getValidAccessToken")
      .mockResolvedValue("app-token");
    // Graph refuses GET /users/{id}: the app has no User.Read.All.
    jest.spyOn(API, "get").mockImplementation((async () => {
      return new HTTPErrorResponse(
        403,
        { error: { code: "Authorization_RequestDenied" } },
        {},
      );
    }) as any);

    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
      projectId: projectId,
      notificationFor: { incidentId: incidentId },
      feedInfoInMarkdown: NOTE_MARKDOWN,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        notifyUserId: userId,
      },
    });

    expect(teamsSendSpy).toHaveBeenCalledTimes(1);
    const teamsPayload: WorkspaceMessagePayload = sentPayload(
      teamsSendSpy as never,
    );
    expect(teamsPayload.channelIds).toEqual([TEAMS_CHANNEL.id]);
    expect(teamsPayload.teamId).toBe(TEAMS_CHANNEL.teamId);
    expect(
      (teamsPayload.messageBlocks[0] as WorkspacePayloadMarkdown).text,
    ).toBe(`**Jane Doe** ${NOTE_MARKDOWN}`);

    expect(slackSendSpy).toHaveBeenCalledTimes(1);
    expect(sentPayload(slackSendSpy as never).channelIds).toEqual([
      SLACK_CHANNEL.id,
    ]);
  });

  test("a note by a user whose Teams display name is stored is attributed to them in Teams", async () => {
    const teamsUserAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
    teamsUserAuth.workspaceUserId = "aad-object-id";
    teamsUserAuth.miscData = { displayName: "Jane Teams" } as never;
    jest
      .spyOn(WorkspaceUserAuthTokenService, "getUserAuth")
      .mockImplementation(
        async (data: {
          workspaceType: WorkspaceType;
        }): Promise<WorkspaceUserAuthToken | null> => {
          return data.workspaceType === WorkspaceType.MicrosoftTeams
            ? teamsUserAuth
            : null;
        },
      );
    const graphSpy: SpyInstance<
      typeof MicrosoftTeamsUtil.getUsernameFromUserId
    > = jest.spyOn(MicrosoftTeamsUtil, "getUsernameFromUserId");

    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
      projectId: projectId,
      notificationFor: { incidentId: incidentId },
      feedInfoInMarkdown: NOTE_MARKDOWN,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        notifyUserId: userId,
      },
    });

    expect(graphSpy).not.toHaveBeenCalled();
    expect(
      (
        sentPayload(teamsSendSpy as never)
          .messageBlocks[0] as WorkspacePayloadMarkdown
      ).text,
    ).toBe(`@Jane Teams ${NOTE_MARKDOWN}`);
  });

  test("an alert note goes to the alert's channels", async () => {
    jest
      .spyOn(WorkspaceUserAuthTokenService, "getUserAuth")
      .mockResolvedValue(null);
    const alertId: ObjectID = ObjectID.generate();
    const alertChannelSpy: SpyInstance<
      typeof AlertService.getWorkspaceChannelForAlert
    > = jest
      .spyOn(AlertService, "getWorkspaceChannelForAlert")
      .mockImplementation(
        async (data: {
          workspaceType?: WorkspaceType | null;
        }): Promise<Array<NotificationRuleWorkspaceChannel>> => {
          return data.workspaceType === WorkspaceType.MicrosoftTeams
            ? [{ ...TEAMS_CHANNEL, id: "19:alert-7@thread.tacv2" }]
            : [];
        },
      );

    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
      projectId: projectId,
      notificationFor: { alertId: alertId },
      feedInfoInMarkdown: "📄 posted **private note** for this Alert #7",
      workspaceNotification: {
        sendWorkspaceNotification: true,
        notifyUserId: userId,
      },
    });

    expect(alertChannelSpy).toHaveBeenCalledWith({
      alertId: alertId,
      workspaceType: WorkspaceType.MicrosoftTeams,
    });
    expect(sentPayload(teamsSendSpy as never).channelIds).toEqual([
      "19:alert-7@thread.tacv2",
    ]);

    const logs: Array<WorkspaceNotificationLog> = logCreateSpy.mock.calls.map(
      (call: Parameters<typeof WorkspaceNotificationLogService.create>) => {
        return call[0].data as WorkspaceNotificationLog;
      },
    );
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) {
      expect(log.alertId?.toString()).toBe(alertId.toString());
    }
  });

  test("messages about an episode are logged against the episode", async () => {
    jest
      .spyOn(WorkspaceUserAuthTokenService, "getUserAuth")
      .mockResolvedValue(null);
    const episodeId: ObjectID = ObjectID.generate();
    jest
      .spyOn(IncidentEpisodeService, "getWorkspaceChannelForEpisode")
      .mockImplementation(
        async (data: {
          workspaceType?: WorkspaceType | null;
        }): Promise<Array<NotificationRuleWorkspaceChannel>> => {
          return data.workspaceType === WorkspaceType.Slack
            ? [SLACK_CHANNEL]
            : [];
        },
      );

    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
      projectId: projectId,
      notificationFor: { incidentEpisodeId: episodeId },
      feedInfoInMarkdown: "📄 posted **private note**",
      workspaceNotification: {
        sendWorkspaceNotification: true,
        notifyUserId: userId,
      },
    });

    const log: WorkspaceNotificationLog = logCreateSpy.mock.calls[0]![0]
      .data as WorkspaceNotificationLog;
    expect(log.incidentEpisodeId?.toString()).toBe(episodeId.toString());
    expect(log.threadId).toBe("thread-1");
    expect(log.channelId).toBe(SLACK_CHANNEL.id);
  });

  test("a send error in one workspace is logged and the other workspace still gets the note", async () => {
    jest
      .spyOn(WorkspaceUserAuthTokenService, "getUserAuth")
      .mockResolvedValue(null);
    teamsSendSpy.mockRejectedValue(new Error("Graph is down"));

    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
      projectId: projectId,
      notificationFor: { incidentId: incidentId },
      feedInfoInMarkdown: NOTE_MARKDOWN,
      workspaceNotification: {
        sendWorkspaceNotification: true,
        notifyUserId: userId,
      },
    });

    expect(slackSendSpy).toHaveBeenCalledTimes(1);

    const logs: Array<WorkspaceNotificationLog> = logCreateSpy.mock.calls.map(
      (call: Parameters<typeof WorkspaceNotificationLogService.create>) => {
        return call[0].data as WorkspaceNotificationLog;
      },
    );
    const errorLog: WorkspaceNotificationLog | undefined = logs.find(
      (log: WorkspaceNotificationLog) => {
        return log.workspaceType === WorkspaceType.MicrosoftTeams;
      },
    );
    expect(errorLog?.statusMessage).toBe("Graph is down");
    expect(errorLog?.channelId).toBe(TEAMS_CHANNEL.id);
  });
});

describe("WorkspaceNotificationRuleService.createChannelsAndInviteUsersToChannelsBasedOnRules", () => {
  test("REGRESSION: a workspace with no matching rule does not stop the next workspace from getting its channel", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
      .mockResolvedValue([
        projectAuth(WorkspaceType.Slack),
        projectAuth(WorkspaceType.MicrosoftTeams),
      ]);

    const teamsRule: WorkspaceNotificationRule =
      new WorkspaceNotificationRule();
    teamsRule.id = ObjectID.generate();
    teamsRule.workspaceType = WorkspaceType.MicrosoftTeams;
    teamsRule.notificationRule = {} as never;

    (
      WorkspaceNotificationRuleService.getMatchingNotificationRules as unknown as SpyInstance<
        typeof WorkspaceNotificationRuleService.getMatchingNotificationRules
      >
    ).mockImplementation(
      async (data: {
        workspaceType: WorkspaceType;
      }): Promise<Array<WorkspaceNotificationRule>> => {
        // Slack comes first and has no rule for this incident.
        return data.workspaceType === WorkspaceType.MicrosoftTeams
          ? [teamsRule]
          : [];
      },
    );

    const createChannelsSpy: SpyInstance<
      typeof WorkspaceNotificationRuleService.createChannelsBasedOnRules
    > = jest
      .spyOn(WorkspaceNotificationRuleService, "createChannelsBasedOnRules")
      .mockResolvedValue([TEAMS_CHANNEL]);
    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "inviteUsersAndTeamsToChannelsBasedOnRules",
      )
      .mockResolvedValue(undefined);
    jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "getExistingChannelNamesFromNotificationRules",
      )
      .mockReturnValue([]);

    const result: {
      channelsCreated: Array<NotificationRuleWorkspaceChannel>;
    } | null =
      await WorkspaceNotificationRuleService.createChannelsAndInviteUsersToChannelsBasedOnRules(
        {
          projectId: projectId,
          notificationRuleEventType: NotificationRuleEventType.Incident,
          notificationFor: { incidentId: incidentId },
          channelNameSiffix: "42",
        },
      );

    expect(createChannelsSpy).toHaveBeenCalledTimes(1);
    expect(createChannelsSpy.mock.calls[0]![0].workspaceType).toBe(
      WorkspaceType.MicrosoftTeams,
    );
    expect(result).toEqual({ channelsCreated: [TEAMS_CHANNEL] });
  });

  test("no rule in any workspace creates nothing", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
      .mockResolvedValue([
        projectAuth(WorkspaceType.Slack),
        projectAuth(WorkspaceType.MicrosoftTeams),
      ]);
    const createChannelsSpy: SpyInstance<
      typeof WorkspaceNotificationRuleService.createChannelsBasedOnRules
    > = jest.spyOn(
      WorkspaceNotificationRuleService,
      "createChannelsBasedOnRules",
    );

    const result: {
      channelsCreated: Array<NotificationRuleWorkspaceChannel>;
    } | null =
      await WorkspaceNotificationRuleService.createChannelsAndInviteUsersToChannelsBasedOnRules(
        {
          projectId: projectId,
          notificationRuleEventType: NotificationRuleEventType.Incident,
          notificationFor: { incidentId: incidentId },
          channelNameSiffix: "42",
        },
      );

    expect(createChannelsSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ channelsCreated: [] });
  });

  test("no connected workspace returns null", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
      .mockResolvedValue([]);

    await expect(
      WorkspaceNotificationRuleService.createChannelsAndInviteUsersToChannelsBasedOnRules(
        {
          projectId: projectId,
          notificationRuleEventType: NotificationRuleEventType.Incident,
          notificationFor: { incidentId: incidentId },
          channelNameSiffix: "42",
        },
      ),
    ).resolves.toBeNull();
  });
});
