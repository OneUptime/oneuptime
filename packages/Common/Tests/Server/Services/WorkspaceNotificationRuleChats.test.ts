import WorkspaceNotificationRuleService, {
  MessageBlocksByWorkspaceType,
  NotificationFor,
} from "../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceUtil from "../../../Server/Utils/Workspace/Workspace";
import {
  WorkspaceChannel,
  WorkspaceSendMessageResponse,
} from "../../../Server/Utils/Workspace/WorkspaceBase";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsChat,
  MicrosoftTeamsMiscData,
} from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import WorkspaceNotificationLog from "../../../Models/DatabaseModels/WorkspaceNotificationLog";
import BaseNotificationRule from "../../../Types/Workspace/NotificationRules/BaseNotificationRule";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import WorkspaceNotificationStatus from "../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceNotificationActionType from "../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceMessagePayload, {
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * Tests for the Microsoft Teams CHAT (group chat / personal 1:1 chat) support
 * in WorkspaceNotificationRuleService:
 *
 * - getExistingChatIdsFromNotificationRules: pure extractor for chat ids from
 *   notification rules (toggle + dedupe + empty-id filtering).
 * - getExistingChatIdsBasedOnEventType: Teams-only guard + rule matching.
 * - getConnectedMicrosoftTeamsChats: reads miscData.availableChats off the
 *   project auth token.
 * - sendWorkspaceMarkdownNotification: builds one payload per chat id with
 *   channelNames/channelIds empty and chatIds=[id] — Teams only.
 * - testRule: the chat block at the end (validation, payload, logging and
 *   error wrapping).
 */

type BaseRuleOverrides = Partial<BaseNotificationRule> & {
  shouldCreateNewChannel?: boolean;
};

function makeBaseRule(overrides: BaseRuleOverrides): BaseNotificationRule {
  return {
    _type: "NotificationRule",
    filterCondition: FilterCondition.Any,
    filters: [],
    shouldPostToExistingChannel: false,
    existingChannelNames: "",
    shouldCreateNewChannel: false,
    ...overrides,
  } as BaseNotificationRule;
}

function makeWorkspaceRule(data: {
  workspaceType: WorkspaceType;
  notificationRule: BaseNotificationRule;
  name?: string | undefined;
}): WorkspaceNotificationRule {
  const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  rule.id = ObjectID.generate();
  rule.projectId = ObjectID.generate();
  rule.workspaceType = data.workspaceType;
  rule.eventType = NotificationRuleEventType.Incident;
  rule.name = data.name || "Chat Rule";
  rule.notificationRule = data.notificationRule;
  return rule;
}

function makeChat(id: string): MicrosoftTeamsChat {
  return {
    id: id,
    name: `Chat ${id}`,
    chatType: "groupChat",
  };
}

function makeTeamsMiscData(
  availableChats: Record<string, MicrosoftTeamsChat> | undefined,
): MicrosoftTeamsMiscData {
  const miscData: MicrosoftTeamsMiscData = {
    tenantId: "tenant-1",
    teamId: "team-1",
    teamName: "Team One",
    botId: "bot-1",
  };

  if (availableChats) {
    miscData.availableChats = availableChats;
  }

  return miscData;
}

function makeChannel(data: {
  id: string;
  name: string;
  workspaceType: WorkspaceType;
  teamId?: string | undefined;
}): WorkspaceChannel {
  const channel: WorkspaceChannel = {
    id: data.id,
    name: data.name,
    workspaceType: data.workspaceType,
  };

  if (data.teamId) {
    channel.teamId = data.teamId;
  }

  return channel;
}

function makeSendResponse(data: {
  workspaceType: WorkspaceType;
  threads: Array<{ channelId: string; channelName: string; threadId: string }>;
  errors?:
    | Array<{ channelId: string; channelName: string; error: string }>
    | undefined;
}): WorkspaceSendMessageResponse {
  const response: WorkspaceSendMessageResponse = {
    workspaceType: data.workspaceType,
    threads: data.threads.map(
      (thread: {
        channelId: string;
        channelName: string;
        threadId: string;
      }) => {
        return {
          channel: makeChannel({
            id: thread.channelId,
            name: thread.channelName,
            workspaceType: data.workspaceType,
          }),
          threadId: thread.threadId,
        };
      },
    ),
  };

  if (data.errors) {
    response.errors = data.errors.map(
      (error: { channelId: string; channelName: string; error: string }) => {
        return {
          channel: makeChannel({
            id: error.channelId,
            name: error.channelName,
            workspaceType: data.workspaceType,
          }),
          error: error.error,
        };
      },
    );
  }

  return response;
}

function markdownBlock(text: string): WorkspacePayloadMarkdown {
  return {
    _type: "WorkspacePayloadMarkdown",
    text: text,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("WorkspaceNotificationRuleService.getExistingChatIdsFromNotificationRules", () => {
  test("collects chat ids from a rule with the chat toggle on", () => {
    const result: Array<string> =
      WorkspaceNotificationRuleService.getExistingChatIdsFromNotificationRules({
        notificationRules: [
          makeBaseRule({
            shouldPostToExistingChat: true,
            existingChatIds: ["chat-1", "chat-2"],
          }),
        ],
      });

    expect(result).toEqual(["chat-1", "chat-2"]);
  });

  test("skips rules where the chat toggle is explicitly false", () => {
    const result: Array<string> =
      WorkspaceNotificationRuleService.getExistingChatIdsFromNotificationRules({
        notificationRules: [
          makeBaseRule({
            shouldPostToExistingChat: false,
            existingChatIds: ["chat-1"],
          }),
        ],
      });

    expect(result).toEqual([]);
  });

  test("skips rules where the chat toggle is undefined (legacy rules)", () => {
    const result: Array<string> =
      WorkspaceNotificationRuleService.getExistingChatIdsFromNotificationRules({
        notificationRules: [
          makeBaseRule({
            existingChatIds: ["chat-1"],
          }),
        ],
      });

    expect(result).toEqual([]);
  });

  test("dedupes chat ids across multiple rules", () => {
    const result: Array<string> =
      WorkspaceNotificationRuleService.getExistingChatIdsFromNotificationRules({
        notificationRules: [
          makeBaseRule({
            shouldPostToExistingChat: true,
            existingChatIds: ["chat-1", "chat-2"],
          }),
          makeBaseRule({
            shouldPostToExistingChat: true,
            existingChatIds: ["chat-2", "chat-3"],
          }),
        ],
      });

    expect(result).toEqual(["chat-1", "chat-2", "chat-3"]);
  });

  test("dedupes chat ids repeated within a single rule", () => {
    const result: Array<string> =
      WorkspaceNotificationRuleService.getExistingChatIdsFromNotificationRules({
        notificationRules: [
          makeBaseRule({
            shouldPostToExistingChat: true,
            existingChatIds: ["chat-1", "chat-1", "chat-2"],
          }),
        ],
      });

    expect(result).toEqual(["chat-1", "chat-2"]);
  });

  test("skips empty-string chat ids", () => {
    const result: Array<string> =
      WorkspaceNotificationRuleService.getExistingChatIdsFromNotificationRules({
        notificationRules: [
          makeBaseRule({
            shouldPostToExistingChat: true,
            existingChatIds: ["", "chat-1", ""],
          }),
        ],
      });

    expect(result).toEqual(["chat-1"]);
  });

  test("handles a toggled-on rule with undefined existingChatIds", () => {
    const result: Array<string> =
      WorkspaceNotificationRuleService.getExistingChatIdsFromNotificationRules({
        notificationRules: [
          makeBaseRule({
            shouldPostToExistingChat: true,
          }),
        ],
      });

    expect(result).toEqual([]);
  });

  test("preserves first-seen order across rules", () => {
    const result: Array<string> =
      WorkspaceNotificationRuleService.getExistingChatIdsFromNotificationRules({
        notificationRules: [
          makeBaseRule({
            shouldPostToExistingChat: true,
            existingChatIds: ["z-chat", "a-chat"],
          }),
          makeBaseRule({
            shouldPostToExistingChat: true,
            existingChatIds: ["m-chat", "a-chat"],
          }),
        ],
      });

    expect(result).toEqual(["z-chat", "a-chat", "m-chat"]);
  });

  test("returns an empty array for an empty rules array", () => {
    const result: Array<string> =
      WorkspaceNotificationRuleService.getExistingChatIdsFromNotificationRules({
        notificationRules: [],
      });

    expect(result).toEqual([]);
  });
});

describe("WorkspaceNotificationRuleService.getExistingChatIdsBasedOnEventType", () => {
  test("returns [] for Slack and never evaluates rules (short-circuit)", async () => {
    const matchSpy: jest.SpyInstance = jest
      .spyOn(WorkspaceNotificationRuleService, "getMatchingNotificationRules")
      .mockResolvedValue([]);

    const notificationFor: NotificationFor = {
      incidentId: ObjectID.generate(),
    };

    const result: Array<string> =
      await WorkspaceNotificationRuleService.getExistingChatIdsBasedOnEventType(
        {
          projectId: ObjectID.generate(),
          workspaceType: WorkspaceType.Slack,
          notificationRuleEventType: NotificationRuleEventType.Incident,
          notificationFor: notificationFor,
        },
      );

    expect(result).toEqual([]);
    expect(matchSpy).not.toHaveBeenCalled();
  });

  test("for Microsoft Teams, calls getMatchingNotificationRules with the exact arguments", async () => {
    const matchSpy: jest.SpyInstance = jest
      .spyOn(WorkspaceNotificationRuleService, "getMatchingNotificationRules")
      .mockResolvedValue([]);

    const projectId: ObjectID = ObjectID.generate();
    const notificationFor: NotificationFor = {
      incidentId: ObjectID.generate(),
    };

    await WorkspaceNotificationRuleService.getExistingChatIdsBasedOnEventType({
      projectId: projectId,
      workspaceType: WorkspaceType.MicrosoftTeams,
      notificationRuleEventType: NotificationRuleEventType.Incident,
      notificationFor: notificationFor,
    });

    expect(matchSpy).toHaveBeenCalledTimes(1);
    expect(matchSpy).toHaveBeenCalledWith({
      projectId: projectId,
      workspaceType: WorkspaceType.MicrosoftTeams,
      notificationRuleEventType: NotificationRuleEventType.Incident,
      notificationFor: notificationFor,
    });
  });

  test("maps matching rules through the extractor and merges + dedupes chat ids", async () => {
    const ruleA: WorkspaceNotificationRule = makeWorkspaceRule({
      workspaceType: WorkspaceType.MicrosoftTeams,
      notificationRule: makeBaseRule({
        shouldPostToExistingChat: true,
        existingChatIds: ["chat-1", "chat-2"],
      }),
    });
    const ruleB: WorkspaceNotificationRule = makeWorkspaceRule({
      workspaceType: WorkspaceType.MicrosoftTeams,
      notificationRule: makeBaseRule({
        shouldPostToExistingChat: true,
        existingChatIds: ["chat-2", "chat-3"],
      }),
    });

    jest
      .spyOn(WorkspaceNotificationRuleService, "getMatchingNotificationRules")
      .mockResolvedValue([ruleA, ruleB]);

    const result: Array<string> =
      await WorkspaceNotificationRuleService.getExistingChatIdsBasedOnEventType(
        {
          projectId: ObjectID.generate(),
          workspaceType: WorkspaceType.MicrosoftTeams,
          notificationRuleEventType: NotificationRuleEventType.Incident,
          notificationFor: { incidentId: ObjectID.generate() },
        },
      );

    expect(result).toEqual(["chat-1", "chat-2", "chat-3"]);
  });

  test("matching rules with the chat toggle off contribute no chat ids", async () => {
    const ruleOn: WorkspaceNotificationRule = makeWorkspaceRule({
      workspaceType: WorkspaceType.MicrosoftTeams,
      notificationRule: makeBaseRule({
        shouldPostToExistingChat: true,
        existingChatIds: ["chat-1"],
      }),
    });
    const ruleOff: WorkspaceNotificationRule = makeWorkspaceRule({
      workspaceType: WorkspaceType.MicrosoftTeams,
      notificationRule: makeBaseRule({
        shouldPostToExistingChat: false,
        existingChatIds: ["chat-9"],
      }),
    });

    jest
      .spyOn(WorkspaceNotificationRuleService, "getMatchingNotificationRules")
      .mockResolvedValue([ruleOn, ruleOff]);

    const result: Array<string> =
      await WorkspaceNotificationRuleService.getExistingChatIdsBasedOnEventType(
        {
          projectId: ObjectID.generate(),
          workspaceType: WorkspaceType.MicrosoftTeams,
          notificationRuleEventType: NotificationRuleEventType.Incident,
          notificationFor: { incidentId: ObjectID.generate() },
        },
      );

    expect(result).toEqual(["chat-1"]);
  });

  test("returns [] for Microsoft Teams when no rules match", async () => {
    jest
      .spyOn(WorkspaceNotificationRuleService, "getMatchingNotificationRules")
      .mockResolvedValue([]);

    const result: Array<string> =
      await WorkspaceNotificationRuleService.getExistingChatIdsBasedOnEventType(
        {
          projectId: ObjectID.generate(),
          workspaceType: WorkspaceType.MicrosoftTeams,
          notificationRuleEventType: NotificationRuleEventType.Incident,
          notificationFor: { incidentId: ObjectID.generate() },
        },
      );

    expect(result).toEqual([]);
  });
});

describe("WorkspaceNotificationRuleService.getConnectedMicrosoftTeamsChats", () => {
  test("returns {} when no project auth token exists", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(null);

    const result: Record<string, MicrosoftTeamsChat> =
      await WorkspaceNotificationRuleService.getConnectedMicrosoftTeamsChats({
        projectId: ObjectID.generate(),
      });

    expect(result).toEqual({});
  });

  test("returns {} when the project auth token has no miscData", async () => {
    const projectAuth: WorkspaceProjectAuthToken =
      new WorkspaceProjectAuthToken();

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(projectAuth);

    const result: Record<string, MicrosoftTeamsChat> =
      await WorkspaceNotificationRuleService.getConnectedMicrosoftTeamsChats({
        projectId: ObjectID.generate(),
      });

    expect(result).toEqual({});
  });

  test("returns {} when miscData exists but has no availableChats", async () => {
    const projectAuth: WorkspaceProjectAuthToken =
      new WorkspaceProjectAuthToken();
    projectAuth.miscData = makeTeamsMiscData(undefined);

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(projectAuth);

    const result: Record<string, MicrosoftTeamsChat> =
      await WorkspaceNotificationRuleService.getConnectedMicrosoftTeamsChats({
        projectId: ObjectID.generate(),
      });

    expect(result).toEqual({});
  });

  test("returns the availableChats map and queries auth for Microsoft Teams", async () => {
    const availableChats: Record<string, MicrosoftTeamsChat> = {
      "chat-1": makeChat("chat-1"),
      "chat-2": {
        id: "chat-2",
        name: "Personal chat",
        chatType: "personal",
        serviceUrl: "https://smba.trafficmanager.net/amer/",
        addedAt: "2026-07-27T00:00:00.000Z",
      },
    };

    const projectAuth: WorkspaceProjectAuthToken =
      new WorkspaceProjectAuthToken();
    projectAuth.miscData = makeTeamsMiscData(availableChats);

    const getProjectAuthSpy: jest.SpyInstance = jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(projectAuth);

    const projectId: ObjectID = ObjectID.generate();

    const result: Record<string, MicrosoftTeamsChat> =
      await WorkspaceNotificationRuleService.getConnectedMicrosoftTeamsChats({
        projectId: projectId,
      });

    expect(result).toEqual(availableChats);
    expect(getProjectAuthSpy).toHaveBeenCalledWith({
      projectId: projectId,
      workspaceType: WorkspaceType.MicrosoftTeams,
    });
  });
});

describe("WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification (chat payloads)", () => {
  let projectId: ObjectID;
  let notificationFor: NotificationFor;

  interface MarkdownSendMocks {
    postSpy: jest.SpyInstance;
    createLogSpy: jest.SpyInstance;
    chatIdsSpy: jest.SpyInstance;
    existingChannelsSpy: jest.SpyInstance;
    monitorChannelsSpy: jest.SpyInstance;
  }

  beforeEach(() => {
    projectId = ObjectID.generate();
    notificationFor = { incidentId: ObjectID.generate() };
  });

  function mockMarkdownSendDeps(data: {
    blocks: Array<MessageBlocksByWorkspaceType>;
    existingChannelsByWorkspaceType: Partial<
      Record<WorkspaceType, Array<WorkspaceChannel>>
    >;
    monitorChannelsByWorkspaceType: Partial<
      Record<WorkspaceType, Array<WorkspaceChannel>>
    >;
    chatIdsByWorkspaceType: Partial<Record<WorkspaceType, Array<string>>>;
    responses: Array<WorkspaceSendMessageResponse>;
  }): MarkdownSendMocks {
    jest
      .spyOn(WorkspaceUtil, "getMessageBlocksByMarkdown")
      .mockResolvedValue(data.blocks);

    const existingChannelsSpy: jest.SpyInstance = jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "getExistingChannelNamesBasedOnEventType",
      )
      .mockImplementation(
        (args: {
          projectId: ObjectID;
          workspaceType: WorkspaceType;
          notificationRuleEventType: NotificationRuleEventType;
          notificationFor: NotificationFor;
        }): Promise<Array<WorkspaceChannel>> => {
          return Promise.resolve(
            data.existingChannelsByWorkspaceType[args.workspaceType] || [],
          );
        },
      );

    const monitorChannelsSpy: jest.SpyInstance = jest
      .spyOn(
        WorkspaceNotificationRuleService as any,
        "getWorkspaceChannelsByNotificationFor",
      )
      .mockImplementation(
        (...args: Array<unknown>): Promise<Array<WorkspaceChannel>> => {
          const callData: { workspaceType: WorkspaceType } = args[0] as {
            workspaceType: WorkspaceType;
          };
          return Promise.resolve(
            data.monitorChannelsByWorkspaceType[callData.workspaceType] || [],
          );
        },
      );

    const chatIdsSpy: jest.SpyInstance = jest
      .spyOn(
        WorkspaceNotificationRuleService,
        "getExistingChatIdsBasedOnEventType",
      )
      .mockImplementation(
        (args: {
          projectId: ObjectID;
          workspaceType: WorkspaceType;
          notificationRuleEventType: NotificationRuleEventType;
          notificationFor: NotificationFor;
        }): Promise<Array<string>> => {
          return Promise.resolve(
            data.chatIdsByWorkspaceType[args.workspaceType] || [],
          );
        },
      );

    const postSpy: jest.SpyInstance = jest
      .spyOn(WorkspaceUtil, "postMessageToAllWorkspaceChannelsAsBot")
      .mockResolvedValue(data.responses);

    const createLogSpy: jest.SpyInstance = jest
      .spyOn(WorkspaceNotificationLogService, "create")
      .mockResolvedValue(new WorkspaceNotificationLog());

    return {
      postSpy,
      createLogSpy,
      chatIdsSpy,
      existingChannelsSpy,
      monitorChannelsSpy,
    };
  }

  function getSentPayloads(
    postSpy: jest.SpyInstance,
  ): Array<WorkspaceMessagePayload> {
    expect(postSpy).toHaveBeenCalledTimes(1);
    const callArg: {
      projectId: ObjectID;
      messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
    } = postSpy.mock.calls[0]?.[0] as {
      projectId: ObjectID;
      messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
    };
    return callArg.messagePayloadsByWorkspace;
  }

  test("builds one chat payload per chat id with empty channelNames/channelIds", async () => {
    const teamsBlocks: MessageBlocksByWorkspaceType = {
      workspaceType: WorkspaceType.MicrosoftTeams,
      messageBlocks: [markdownBlock("Incident update")],
    };

    const mocks: MarkdownSendMocks = mockMarkdownSendDeps({
      blocks: [teamsBlocks],
      existingChannelsByWorkspaceType: {},
      monitorChannelsByWorkspaceType: {},
      chatIdsByWorkspaceType: {
        [WorkspaceType.MicrosoftTeams]: ["chat-a", "chat-b"],
      },
      responses: [],
    });

    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
      projectId: projectId,
      notificationFor: notificationFor,
      feedInfoInMarkdown: "Incident update",
      workspaceNotification: {
        sendWorkspaceNotification: true,
      },
    });

    const payloads: Array<WorkspaceMessagePayload> = getSentPayloads(
      mocks.postSpy,
    );

    expect(payloads).toHaveLength(2);

    expect(payloads[0]).toEqual({
      _type: "WorkspaceMessagePayload",
      workspaceType: WorkspaceType.MicrosoftTeams,
      messageBlocks: teamsBlocks.messageBlocks,
      channelNames: [],
      channelIds: [],
      chatIds: ["chat-a"],
    });

    expect(payloads[1]).toEqual({
      _type: "WorkspaceMessagePayload",
      workspaceType: WorkspaceType.MicrosoftTeams,
      messageBlocks: teamsBlocks.messageBlocks,
      channelNames: [],
      channelIds: [],
      chatIds: ["chat-b"],
    });
  });

  test("chat payloads coexist with unchanged channel payloads (persisted -> channelIds, named -> channelNames)", async () => {
    const teamsBlocks: MessageBlocksByWorkspaceType = {
      workspaceType: WorkspaceType.MicrosoftTeams,
      messageBlocks: [markdownBlock("Incident update")],
    };

    const persistedChannel: WorkspaceChannel = makeChannel({
      id: "chan-123",
      name: "persisted-channel",
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamId: "team-1",
    });

    const namedChannel: WorkspaceChannel = makeChannel({
      id: "",
      name: "named-channel",
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamId: "team-1",
    });

    const mocks: MarkdownSendMocks = mockMarkdownSendDeps({
      blocks: [teamsBlocks],
      existingChannelsByWorkspaceType: {
        [WorkspaceType.MicrosoftTeams]: [namedChannel],
      },
      monitorChannelsByWorkspaceType: {
        [WorkspaceType.MicrosoftTeams]: [persistedChannel],
      },
      chatIdsByWorkspaceType: {
        [WorkspaceType.MicrosoftTeams]: ["chat-a"],
      },
      responses: [],
    });

    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
      projectId: projectId,
      notificationFor: notificationFor,
      feedInfoInMarkdown: "Incident update",
      workspaceNotification: {
        sendWorkspaceNotification: true,
      },
    });

    const payloads: Array<WorkspaceMessagePayload> = getSentPayloads(
      mocks.postSpy,
    );

    expect(payloads).toHaveLength(3);

    // Persisted channel payload: by channel id, unchanged by the chat feature.
    expect(payloads[0]).toEqual({
      _type: "WorkspaceMessagePayload",
      workspaceType: WorkspaceType.MicrosoftTeams,
      messageBlocks: teamsBlocks.messageBlocks,
      channelNames: [],
      channelIds: ["chan-123"],
      teamId: "team-1",
    });

    // Named channel payload: by channel name, unchanged by the chat feature.
    expect(payloads[1]).toEqual({
      _type: "WorkspaceMessagePayload",
      workspaceType: WorkspaceType.MicrosoftTeams,
      messageBlocks: teamsBlocks.messageBlocks,
      channelNames: ["named-channel"],
      channelIds: [],
      teamId: "team-1",
    });

    // Chat payload comes last and carries no teamId.
    expect(payloads[2]).toEqual({
      _type: "WorkspaceMessagePayload",
      workspaceType: WorkspaceType.MicrosoftTeams,
      messageBlocks: teamsBlocks.messageBlocks,
      channelNames: [],
      channelIds: [],
      chatIds: ["chat-a"],
    });
    expect(payloads[2]).not.toHaveProperty("teamId");
  });

  test("with Slack + Teams blocks, chat payloads are built ONLY for Teams", async () => {
    const teamsBlocks: MessageBlocksByWorkspaceType = {
      workspaceType: WorkspaceType.MicrosoftTeams,
      messageBlocks: [markdownBlock("Teams text")],
    };
    const slackBlocks: MessageBlocksByWorkspaceType = {
      workspaceType: WorkspaceType.Slack,
      messageBlocks: [markdownBlock("Slack text")],
    };

    const slackChannel: WorkspaceChannel = makeChannel({
      id: "slack-chan-1",
      name: "slack-channel",
      workspaceType: WorkspaceType.Slack,
    });

    const mocks: MarkdownSendMocks = mockMarkdownSendDeps({
      blocks: [slackBlocks, teamsBlocks],
      existingChannelsByWorkspaceType: {},
      monitorChannelsByWorkspaceType: {
        [WorkspaceType.Slack]: [slackChannel],
      },
      chatIdsByWorkspaceType: {
        [WorkspaceType.MicrosoftTeams]: ["chat-a", "chat-b"],
        [WorkspaceType.Slack]: [],
      },
      responses: [],
    });

    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
      projectId: projectId,
      notificationFor: notificationFor,
      feedInfoInMarkdown: "Update",
      workspaceNotification: {
        sendWorkspaceNotification: true,
      },
    });

    const payloads: Array<WorkspaceMessagePayload> = getSentPayloads(
      mocks.postSpy,
    );

    const chatPayloads: Array<WorkspaceMessagePayload> = payloads.filter(
      (payload: WorkspaceMessagePayload) => {
        return payload.chatIds && payload.chatIds.length > 0;
      },
    );

    expect(chatPayloads).toHaveLength(2);
    for (const chatPayload of chatPayloads) {
      expect(chatPayload.workspaceType).toBe(WorkspaceType.MicrosoftTeams);
    }

    const slackPayloads: Array<WorkspaceMessagePayload> = payloads.filter(
      (payload: WorkspaceMessagePayload) => {
        return payload.workspaceType === WorkspaceType.Slack;
      },
    );

    expect(slackPayloads).toHaveLength(1);
    expect(slackPayloads[0]?.channelIds).toEqual(["slack-chan-1"]);
    expect(slackPayloads[0]?.chatIds).toBeUndefined();
  });

  test("queries chat ids with the correct event type and workspace type per block", async () => {
    const teamsBlocks: MessageBlocksByWorkspaceType = {
      workspaceType: WorkspaceType.MicrosoftTeams,
      messageBlocks: [markdownBlock("Teams text")],
    };
    const slackBlocks: MessageBlocksByWorkspaceType = {
      workspaceType: WorkspaceType.Slack,
      messageBlocks: [markdownBlock("Slack text")],
    };

    const mocks: MarkdownSendMocks = mockMarkdownSendDeps({
      blocks: [slackBlocks, teamsBlocks],
      existingChannelsByWorkspaceType: {},
      monitorChannelsByWorkspaceType: {},
      chatIdsByWorkspaceType: {},
      responses: [],
    });

    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
      projectId: projectId,
      notificationFor: notificationFor,
      feedInfoInMarkdown: "Update",
      workspaceNotification: {
        sendWorkspaceNotification: true,
      },
    });

    expect(mocks.chatIdsSpy).toHaveBeenCalledTimes(2);
    expect(mocks.chatIdsSpy).toHaveBeenCalledWith({
      projectId: projectId,
      notificationRuleEventType: NotificationRuleEventType.Incident,
      workspaceType: WorkspaceType.Slack,
      notificationFor: notificationFor,
    });
    expect(mocks.chatIdsSpy).toHaveBeenCalledWith({
      projectId: projectId,
      notificationRuleEventType: NotificationRuleEventType.Incident,
      workspaceType: WorkspaceType.MicrosoftTeams,
      notificationFor: notificationFor,
    });
  });

  test("posts once with all payloads and no chat payloads when no chats are configured", async () => {
    const teamsBlocks: MessageBlocksByWorkspaceType = {
      workspaceType: WorkspaceType.MicrosoftTeams,
      messageBlocks: [markdownBlock("Teams text")],
    };

    const mocks: MarkdownSendMocks = mockMarkdownSendDeps({
      blocks: [teamsBlocks],
      existingChannelsByWorkspaceType: {},
      monitorChannelsByWorkspaceType: {},
      chatIdsByWorkspaceType: {},
      responses: [],
    });

    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
      projectId: projectId,
      notificationFor: notificationFor,
      feedInfoInMarkdown: "Update",
      workspaceNotification: {
        sendWorkspaceNotification: true,
      },
    });

    const payloads: Array<WorkspaceMessagePayload> = getSentPayloads(
      mocks.postSpy,
    );

    expect(payloads).toEqual([]);
  });

  test("logs a Success notification with channelId = chat id when the response thread is a chat", async () => {
    const teamsBlocks: MessageBlocksByWorkspaceType = {
      workspaceType: WorkspaceType.MicrosoftTeams,
      messageBlocks: [markdownBlock("Incident update")],
    };

    const response: WorkspaceSendMessageResponse = makeSendResponse({
      workspaceType: WorkspaceType.MicrosoftTeams,
      threads: [
        {
          channelId: "chat-a",
          channelName: "Chat chat-a",
          threadId: "thread-1",
        },
      ],
    });

    const mocks: MarkdownSendMocks = mockMarkdownSendDeps({
      blocks: [teamsBlocks],
      existingChannelsByWorkspaceType: {},
      monitorChannelsByWorkspaceType: {},
      chatIdsByWorkspaceType: {
        [WorkspaceType.MicrosoftTeams]: ["chat-a"],
      },
      responses: [response],
    });

    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
      projectId: projectId,
      notificationFor: notificationFor,
      feedInfoInMarkdown: "Incident update",
      workspaceNotification: {
        sendWorkspaceNotification: true,
      },
    });

    expect(mocks.createLogSpy).toHaveBeenCalledTimes(1);

    const createdLog: WorkspaceNotificationLog = mocks.createLogSpy.mock
      .calls[0]?.[0]?.data as WorkspaceNotificationLog;

    expect(createdLog.channelId).toBe("chat-a");
    expect(createdLog.channelName).toBe("Chat chat-a");
    expect(createdLog.threadId).toBe("thread-1");
    expect(createdLog.status).toBe(WorkspaceNotificationStatus.Success);
    expect(createdLog.workspaceType).toBe(WorkspaceType.MicrosoftTeams);
    expect(createdLog.message).toBe("Incident update");
    expect(createdLog.incidentId).toBe(notificationFor.incidentId);
    expect(createdLog.actionType).toBe(
      WorkspaceNotificationActionType.SendMessage,
    );
  });

  test("creates no logs when the send response has zero threads", async () => {
    const teamsBlocks: MessageBlocksByWorkspaceType = {
      workspaceType: WorkspaceType.MicrosoftTeams,
      messageBlocks: [markdownBlock("Incident update")],
    };

    const response: WorkspaceSendMessageResponse = makeSendResponse({
      workspaceType: WorkspaceType.MicrosoftTeams,
      threads: [],
    });

    const mocks: MarkdownSendMocks = mockMarkdownSendDeps({
      blocks: [teamsBlocks],
      existingChannelsByWorkspaceType: {},
      monitorChannelsByWorkspaceType: {},
      chatIdsByWorkspaceType: {
        [WorkspaceType.MicrosoftTeams]: ["chat-a"],
      },
      responses: [response],
    });

    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
      projectId: projectId,
      notificationFor: notificationFor,
      feedInfoInMarkdown: "Incident update",
      workspaceNotification: {
        sendWorkspaceNotification: true,
      },
    });

    expect(mocks.createLogSpy).not.toHaveBeenCalled();
  });

  test("logs an Error notification for each per-destination failure in the send response", async () => {
    const teamsBlocks: MessageBlocksByWorkspaceType = {
      workspaceType: WorkspaceType.MicrosoftTeams,
      messageBlocks: [markdownBlock("Incident update")],
    };

    const response: WorkspaceSendMessageResponse = makeSendResponse({
      workspaceType: WorkspaceType.MicrosoftTeams,
      threads: [
        {
          channelId: "chat-a",
          channelName: "Chat chat-a",
          threadId: "thread-1",
        },
      ],
      errors: [
        {
          channelId: "chat-b",
          channelName: "Chat chat-b",
          error:
            "This chat is not connected to OneUptime. Please add the OneUptime app to the chat in Microsoft Teams and try again.",
        },
      ],
    });

    const mocks: MarkdownSendMocks = mockMarkdownSendDeps({
      blocks: [teamsBlocks],
      existingChannelsByWorkspaceType: {},
      monitorChannelsByWorkspaceType: {},
      chatIdsByWorkspaceType: {
        [WorkspaceType.MicrosoftTeams]: ["chat-a", "chat-b"],
      },
      responses: [response],
    });

    await WorkspaceNotificationRuleService.sendWorkspaceMarkdownNotification({
      projectId: projectId,
      notificationFor: notificationFor,
      feedInfoInMarkdown: "Incident update",
      workspaceNotification: {
        sendWorkspaceNotification: true,
      },
    });

    expect(mocks.createLogSpy).toHaveBeenCalledTimes(2);

    const successLog: WorkspaceNotificationLog = mocks.createLogSpy.mock
      .calls[0]?.[0]?.data as WorkspaceNotificationLog;
    expect(successLog.status).toBe(WorkspaceNotificationStatus.Success);
    expect(successLog.channelId).toBe("chat-a");

    const errorLog: WorkspaceNotificationLog = mocks.createLogSpy.mock
      .calls[1]?.[0]?.data as WorkspaceNotificationLog;
    expect(errorLog.status).toBe(WorkspaceNotificationStatus.Error);
    expect(errorLog.channelId).toBe("chat-b");
    expect(errorLog.channelName).toBe("Chat chat-b");
    expect(errorLog.statusMessage).toContain(
      "This chat is not connected to OneUptime",
    );
    expect(errorLog.incidentId).toBe(notificationFor.incidentId);
  });
});

describe("WorkspaceNotificationRuleService.testRule (Microsoft Teams chat path)", () => {
  const testByUserId: ObjectID = ObjectID.generate();

  interface TestRuleMocks {
    postSpy: jest.SpyInstance;
    createLogSpy: jest.SpyInstance;
    getProjectAuthSpy: jest.SpyInstance;
  }

  function mockTestRuleDeps(data: {
    rule: WorkspaceNotificationRule;
    userAuth?: WorkspaceUserAuthToken | null | undefined;
    projectAuth?: WorkspaceProjectAuthToken | null | undefined;
    availableChats?: Record<string, MicrosoftTeamsChat> | undefined;
    responses?: Array<WorkspaceSendMessageResponse> | undefined;
  }): TestRuleMocks {
    jest
      .spyOn(WorkspaceNotificationRuleService, "findOneById")
      .mockResolvedValue(data.rule);

    let userAuth: WorkspaceUserAuthToken | null;
    if (data.userAuth === undefined) {
      userAuth = new WorkspaceUserAuthToken();
      userAuth.workspaceUserId = "teams-user-1";
    } else {
      userAuth = data.userAuth;
    }

    jest
      .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
      .mockResolvedValue(userAuth);

    let projectAuth: WorkspaceProjectAuthToken | null;
    if (data.projectAuth === undefined) {
      projectAuth = new WorkspaceProjectAuthToken();
      projectAuth.authToken = "project-auth-token";
      projectAuth.workspaceType = data.rule.workspaceType!;
    } else {
      projectAuth = data.projectAuth;
    }

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
      .mockResolvedValue(projectAuth);

    const authWithChats: WorkspaceProjectAuthToken =
      new WorkspaceProjectAuthToken();
    authWithChats.miscData = makeTeamsMiscData(data.availableChats || {});

    const getProjectAuthSpy: jest.SpyInstance = jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(authWithChats);

    const postSpy: jest.SpyInstance = jest
      .spyOn(WorkspaceUtil, "postMessageToAllWorkspaceChannelsAsBot")
      .mockResolvedValue(data.responses || []);

    const createLogSpy: jest.SpyInstance = jest
      .spyOn(WorkspaceNotificationLogService, "create")
      .mockResolvedValue(new WorkspaceNotificationLog());

    return { postSpy, createLogSpy, getProjectAuthSpy };
  }

  function makeChatRule(
    overrides: BaseRuleOverrides,
  ): WorkspaceNotificationRule {
    return makeWorkspaceRule({
      workspaceType: WorkspaceType.MicrosoftTeams,
      notificationRule: makeBaseRule({
        shouldPostToExistingChat: true,
        existingChatIds: ["chat-1"],
        ...overrides,
      }),
      name: "Chat Rule",
    });
  }

  async function runTestRule(rule: WorkspaceNotificationRule): Promise<void> {
    await WorkspaceNotificationRuleService.testRule({
      ruleId: rule.id!,
      projectId: ObjectID.generate(), // testRule overwrites this with rule.projectId.
      testByUserId: testByUserId,
      props: { isRoot: true },
    });
  }

  test("happy path: posts a single payload with chatIds and logs a chat Success", async () => {
    const rule: WorkspaceNotificationRule = makeChatRule({});

    const response: WorkspaceSendMessageResponse = makeSendResponse({
      workspaceType: WorkspaceType.MicrosoftTeams,
      threads: [
        {
          channelId: "chat-1",
          channelName: "Chat chat-1",
          threadId: "thread-9",
        },
      ],
    });

    const mocks: TestRuleMocks = mockTestRuleDeps({
      rule: rule,
      availableChats: { "chat-1": makeChat("chat-1") },
      responses: [response],
    });

    await runTestRule(rule);

    expect(mocks.postSpy).toHaveBeenCalledTimes(1);

    const callArg: {
      projectId: ObjectID;
      messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
    } = mocks.postSpy.mock.calls[0]?.[0] as {
      projectId: ObjectID;
      messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
    };

    expect(callArg.projectId).toBe(rule.projectId);
    expect(callArg.messagePayloadsByWorkspace).toHaveLength(1);
    expect(callArg.messagePayloadsByWorkspace[0]).toEqual({
      _type: "WorkspaceMessagePayload",
      workspaceType: WorkspaceType.MicrosoftTeams,
      messageBlocks: [
        {
          _type: "WorkspacePayloadMarkdown",
          text: "This is a test message for rule **Chat Rule**",
        },
      ],
      channelNames: [],
      channelIds: [],
      chatIds: ["chat-1"],
    });

    expect(mocks.createLogSpy).toHaveBeenCalledTimes(1);
    const createdLog: WorkspaceNotificationLog = mocks.createLogSpy.mock
      .calls[0]?.[0]?.data as WorkspaceNotificationLog;

    expect(createdLog.channelId).toBe("chat-1");
    expect(createdLog.channelName).toBe("Chat chat-1");
    expect(createdLog.threadId).toBe("thread-9");
    expect(createdLog.status).toBe(WorkspaceNotificationStatus.Success);
    expect(createdLog.statusMessage).toBe(
      "Test message posted to workspace chat",
    );
    expect(createdLog.message).toBe(
      "This is a test message for rule **Chat Rule**",
    );
    expect(createdLog.userId).toBe(testByUserId);
    expect(createdLog.actionType).toBe(
      WorkspaceNotificationActionType.SendMessage,
    );
    expect(createdLog.projectId).toBe(rule.projectId);
  });

  test("posts a single payload containing ALL selected chat ids and logs each thread", async () => {
    const rule: WorkspaceNotificationRule = makeChatRule({
      existingChatIds: ["chat-1", "chat-2"],
    });

    const response: WorkspaceSendMessageResponse = makeSendResponse({
      workspaceType: WorkspaceType.MicrosoftTeams,
      threads: [
        {
          channelId: "chat-1",
          channelName: "Chat chat-1",
          threadId: "thread-1",
        },
        {
          channelId: "chat-2",
          channelName: "Chat chat-2",
          threadId: "thread-2",
        },
      ],
    });

    const mocks: TestRuleMocks = mockTestRuleDeps({
      rule: rule,
      availableChats: {
        "chat-1": makeChat("chat-1"),
        "chat-2": makeChat("chat-2"),
      },
      responses: [response],
    });

    await runTestRule(rule);

    expect(mocks.postSpy).toHaveBeenCalledTimes(1);

    const callArg: {
      messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
    } = mocks.postSpy.mock.calls[0]?.[0] as {
      messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
    };

    expect(callArg.messagePayloadsByWorkspace).toHaveLength(1);
    expect(callArg.messagePayloadsByWorkspace[0]?.chatIds).toEqual([
      "chat-1",
      "chat-2",
    ]);

    expect(mocks.createLogSpy).toHaveBeenCalledTimes(2);
    const firstLog: WorkspaceNotificationLog = mocks.createLogSpy.mock
      .calls[0]?.[0]?.data as WorkspaceNotificationLog;
    const secondLog: WorkspaceNotificationLog = mocks.createLogSpy.mock
      .calls[1]?.[0]?.data as WorkspaceNotificationLog;
    expect(firstLog.channelId).toBe("chat-1");
    expect(secondLog.channelId).toBe("chat-2");
  });

  test("throws when a selected chat is no longer connected", async () => {
    const rule: WorkspaceNotificationRule = makeChatRule({});

    const mocks: TestRuleMocks = mockTestRuleDeps({
      rule: rule,
      availableChats: { "some-other-chat": makeChat("some-other-chat") },
    });

    await expect(runTestRule(rule)).rejects.toThrow(/no longer connected/);
    expect(mocks.postSpy).not.toHaveBeenCalled();
    expect(mocks.createLogSpy).not.toHaveBeenCalled();
  });

  test("throws when the chat toggle is on but no chats are selected", async () => {
    const rule: WorkspaceNotificationRule = makeChatRule({
      existingChatIds: [],
    });

    const mocks: TestRuleMocks = mockTestRuleDeps({
      rule: rule,
      availableChats: { "chat-1": makeChat("chat-1") },
    });

    await expect(runTestRule(rule)).rejects.toThrow(/select at least one chat/);
    expect(mocks.getProjectAuthSpy).not.toHaveBeenCalled();
    expect(mocks.postSpy).not.toHaveBeenCalled();
  });

  test("throws 'Failed to send test message to some chats' when the send response has errors", async () => {
    const rule: WorkspaceNotificationRule = makeChatRule({});

    const response: WorkspaceSendMessageResponse = makeSendResponse({
      workspaceType: WorkspaceType.MicrosoftTeams,
      threads: [],
      errors: [
        {
          channelId: "chat-1",
          channelName: "Chat chat-1",
          error: "Bot was removed from the chat",
        },
      ],
    });

    const mocks: TestRuleMocks = mockTestRuleDeps({
      rule: rule,
      availableChats: { "chat-1": makeChat("chat-1") },
      responses: [response],
    });

    await expect(runTestRule(rule)).rejects.toThrow(
      /Failed to send test message to some chats/,
    );
    expect(mocks.createLogSpy).not.toHaveBeenCalled();
  });

  test("throws when the testing user is not connected to the workspace", async () => {
    const rule: WorkspaceNotificationRule = makeChatRule({});

    const mocks: TestRuleMocks = mockTestRuleDeps({
      rule: rule,
      userAuth: null,
      availableChats: { "chat-1": makeChat("chat-1") },
    });

    await expect(runTestRule(rule)).rejects.toThrow(
      /This account is not connected to MicrosoftTeams/,
    );
    expect(mocks.postSpy).not.toHaveBeenCalled();
  });

  test("throws when the project is not connected to the workspace", async () => {
    const rule: WorkspaceNotificationRule = makeChatRule({});

    const mocks: TestRuleMocks = mockTestRuleDeps({
      rule: rule,
      projectAuth: null,
      availableChats: { "chat-1": makeChat("chat-1") },
    });

    await expect(runTestRule(rule)).rejects.toThrow(
      /This project is not connected to MicrosoftTeams/,
    );
    expect(mocks.postSpy).not.toHaveBeenCalled();
  });

  test("sends nothing when chat, channel and create-channel toggles are all off", async () => {
    const rule: WorkspaceNotificationRule = makeChatRule({
      shouldPostToExistingChat: false,
      shouldPostToExistingChannel: false,
      shouldCreateNewChannel: false,
    });

    const mocks: TestRuleMocks = mockTestRuleDeps({
      rule: rule,
      availableChats: { "chat-1": makeChat("chat-1") },
    });

    await runTestRule(rule);

    expect(mocks.postSpy).not.toHaveBeenCalled();
    expect(mocks.createLogSpy).not.toHaveBeenCalled();
  });

  test("Slack rules never enter the chat block even with the chat toggle on", async () => {
    const rule: WorkspaceNotificationRule = makeWorkspaceRule({
      workspaceType: WorkspaceType.Slack,
      notificationRule: makeBaseRule({
        shouldPostToExistingChat: true,
        existingChatIds: ["chat-1"],
      }),
      name: "Slack Rule",
    });

    const mocks: TestRuleMocks = mockTestRuleDeps({
      rule: rule,
      availableChats: {},
    });

    await runTestRule(rule);

    expect(mocks.postSpy).not.toHaveBeenCalled();
    expect(mocks.getProjectAuthSpy).not.toHaveBeenCalled();
    expect(mocks.createLogSpy).not.toHaveBeenCalled();
  });
});
