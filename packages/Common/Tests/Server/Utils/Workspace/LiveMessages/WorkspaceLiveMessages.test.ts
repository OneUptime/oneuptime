import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import WorkspaceLiveMessage from "../../../../../Models/DatabaseModels/WorkspaceLiveMessage";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../../Server/Infrastructure/Semaphore";
import WorkspaceLiveMessageService from "../../../../../Server/Services/WorkspaceLiveMessageService";
import WorkspaceNotificationRuleService from "../../../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceLiveMessages, {
  WorkspaceLiveMessageEdit,
} from "../../../../../Server/Utils/Workspace/LiveMessages/WorkspaceLiveMessages";
import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import SlackUtil from "../../../../../Server/Utils/Workspace/Slack/Slack";
import WorkspaceUtil from "../../../../../Server/Utils/Workspace/Workspace";
import { WorkspaceSendMessageResponse } from "../../../../../Server/Utils/Workspace/WorkspaceBase";
import BadRequestException from "../../../../../Types/Exception/BadRequestException";
import ObjectID from "../../../../../Types/ObjectID";
import { WorkspaceLiveMessageDestinationType } from "../../../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceMessagePayload, {
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import InMemoryLiveMessages from "./InMemoryLiveMessages";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * THE MESSAGES ONEUPTIME KEEPS UP TO DATE: POSTED ONCE, EDITED AFTER THAT.
 *
 * WorkspaceLiveMessages posts a message in each place it belongs, keeps a
 * row for it, and edits it in place when what it says changes - never when
 * it does not, and never twice at once.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const KEY: string = "OnCallPolicyRun:run-1";

function markdown(text: string): WorkspacePayloadMarkdown {
  return { _type: "WorkspacePayloadMarkdown", text: text };
}

function auth(workspaceType: WorkspaceType): WorkspaceProjectAuthToken {
  const token: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  token.projectId = PROJECT_ID;
  token.workspaceType = workspaceType;
  token.authToken = `${workspaceType}-token`;
  return token;
}

function slackPayload(
  data: Partial<WorkspaceMessagePayload> = {},
): WorkspaceMessagePayload {
  return {
    _type: "WorkspaceMessagePayload",
    workspaceType: WorkspaceType.Slack,
    messageBlocks: [markdown("first")],
    channelNames: [],
    channelIds: ["C0INC8"],
    ...data,
  };
}

let store: InMemoryLiveMessages;
let postSpy: SpyInstance<
  typeof WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot
>;
let logSpy: SpyInstance<
  typeof WorkspaceNotificationRuleService.logSendResponses
>;

function answerPost(
  threads: WorkspaceSendMessageResponse["threads"],
  workspaceType: WorkspaceType = WorkspaceType.Slack,
): void {
  postSpy.mockResolvedValueOnce([
    { workspaceType: workspaceType, threads: threads },
  ]);
}

beforeEach(() => {
  store = new InMemoryLiveMessages();
  store.install();

  postSpy = jest
    .spyOn(WorkspaceUtil, "postMessageToAllWorkspaceChannelsAsBot")
    .mockResolvedValue([]);
  logSpy = jest
    .spyOn(WorkspaceNotificationRuleService, "logSendResponses")
    .mockResolvedValue(undefined);

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockImplementation((async (data: {
      workspaceType: WorkspaceType;
    }): Promise<WorkspaceProjectAuthToken> => {
      return auth(data.workspaceType);
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("WorkspaceLiveMessages.withLock", () => {
  beforeEach(() => {
    jest
      .spyOn(Semaphore, "lock")
      .mockRejectedValue(new Error("Redis client is not connected"));
  });

  test("work on one key runs one at a time, in the order it came", async () => {
    const events: Array<string> = [];
    let releaseFirst: () => void = (): void => {};

    const first: Promise<void> = WorkspaceLiveMessages.withLock(
      "key",
      async (): Promise<void> => {
        events.push("first starts");
        await new Promise<void>((resolve: () => void) => {
          releaseFirst = resolve;
        });
        events.push("first ends");
      },
    );

    const second: Promise<void> = WorkspaceLiveMessages.withLock(
      "key",
      async (): Promise<void> => {
        events.push("second runs");
      },
    );

    // Let the first get going; the second must still be waiting.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 10);
    });
    expect(events).toEqual(["first starts"]);

    releaseFirst();
    await Promise.all([first, second]);

    expect(events).toEqual(["first starts", "first ends", "second runs"]);
  });

  test("work on different keys does not wait for each other", async () => {
    const events: Array<string> = [];
    let releaseA: () => void = (): void => {};

    const a: Promise<void> = WorkspaceLiveMessages.withLock(
      "a",
      async (): Promise<void> => {
        await new Promise<void>((resolve: () => void) => {
          releaseA = resolve;
        });
        events.push("a");
      },
    );

    await WorkspaceLiveMessages.withLock("b", async (): Promise<void> => {
      events.push("b");
    });

    expect(events).toEqual(["b"]);
    releaseA();
    await a;
    expect(events).toEqual(["b", "a"]);
  });

  test("work that fails gives the key back: the next one runs, and the failure reaches its caller", async () => {
    await expect(
      WorkspaceLiveMessages.withLock("key", async (): Promise<void> => {
        throw new Error("Slack is down");
      }),
    ).rejects.toThrow("Slack is down");

    await expect(
      WorkspaceLiveMessages.withLock("key", async (): Promise<string> => {
        return "ran";
      }),
    ).resolves.toBe("ran");
  });

  test("holds the shared lock across processes when Valkey has it, and gives it back", async () => {
    const mutex: SemaphoreMutex = {} as SemaphoreMutex;
    const lock: SpyInstance<typeof Semaphore.lock> = jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue(mutex);
    const release: SpyInstance<typeof Semaphore.release> = jest
      .spyOn(Semaphore, "release")
      .mockResolvedValue(undefined);

    await WorkspaceLiveMessages.withLock("run-7", async (): Promise<void> => {
      expect(release).not.toHaveBeenCalled();
    });

    expect(lock).toHaveBeenCalledTimes(1);
    expect(lock.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        key: "run-7",
        namespace: WorkspaceLiveMessages.LOCK_NAMESPACE,
        lockTimeout: WorkspaceLiveMessages.LOCK_TIMEOUT_IN_MS,
        acquireTimeout: WorkspaceLiveMessages.LOCK_TIMEOUT_IN_MS,
      }),
    );
    expect(release).toHaveBeenCalledWith(mutex);
  });

  test("without Valkey the work still runs", async () => {
    await expect(
      WorkspaceLiveMessages.withLock("key", async (): Promise<number> => {
        return 42;
      }),
    ).resolves.toBe(42);
  });
});

describe("WorkspaceLiveMessages.getContentHash", () => {
  test("is the same for the same blocks and differs when the text does", () => {
    const a: string = WorkspaceLiveMessages.getContentHash([markdown("one")]);

    expect(WorkspaceLiveMessages.getContentHash([markdown("one")])).toBe(a);
    expect(WorkspaceLiveMessages.getContentHash([markdown("two")])).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("WorkspaceLiveMessages.postAndKeep", () => {
  test("posts to the one place and keeps where it went, what it said and its id", async () => {
    answerPost([
      {
        channel: {
          id: "C0INC8",
          name: "inc-inc-8",
          workspaceType: WorkspaceType.Slack,
        },
        threadId: "1700000000.000100",
      },
    ]);

    const kept: WorkspaceLiveMessage | null =
      await WorkspaceLiveMessages.postAndKeep({
        projectId: PROJECT_ID,
        messageKey: KEY,
        destination: slackPayload(),
        messageData: { alarms: ["outcome"] },
        notificationFor: { incidentId: ObjectID.generate() },
      });

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0]![0].messagePayloadsByWorkspace).toEqual([
      slackPayload(),
    ]);

    expect(kept).not.toBeNull();
    expect(store.rows).toHaveLength(1);
    const row: WorkspaceLiveMessage = store.rows[0]!;
    expect(row.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(row.workspaceType).toBe(WorkspaceType.Slack);
    expect(row.messageKey).toBe(KEY);
    expect(row.destinationType).toBe(
      WorkspaceLiveMessageDestinationType.Channel,
    );
    expect(row.channelId).toBe("C0INC8");
    expect(row.channelName).toBe("inc-inc-8");
    expect(row.messageId).toBe("1700000000.000100");
    expect(row.contentHash).toBe(
      WorkspaceLiveMessages.getContentHash([markdown("first")]),
    );
    expect(row.messageData).toEqual({ alarms: ["outcome"] });

    // Logged in Notification Logs like any other message about the record.
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  test("a channel named by a rule is kept by the id Slack resolved it to", async () => {
    answerPost([
      {
        channel: {
          id: "C0INCIDENTS",
          name: "incidents",
          workspaceType: WorkspaceType.Slack,
        },
        threadId: "1700000000.000200",
      },
    ]);

    await WorkspaceLiveMessages.postAndKeep({
      projectId: PROJECT_ID,
      messageKey: KEY,
      destination: slackPayload({
        channelIds: [],
        channelNames: ["#incidents"],
      }),
    });

    expect(store.rows[0]!.channelId).toBe("C0INCIDENTS");
    // No record named: nothing to log it against.
    expect(logSpy).not.toHaveBeenCalled();
  });

  test("a Microsoft Teams chat is kept as a chat, a channel with its team", async () => {
    answerPost(
      [
        {
          channel: {
            id: "19:chat@thread.v2",
            name: "On-call chat",
            workspaceType: WorkspaceType.MicrosoftTeams,
          },
          threadId: "1700000000001",
        },
      ],
      WorkspaceType.MicrosoftTeams,
    );

    await WorkspaceLiveMessages.postAndKeep({
      projectId: PROJECT_ID,
      messageKey: KEY,
      destination: {
        _type: "WorkspaceMessagePayload",
        workspaceType: WorkspaceType.MicrosoftTeams,
        messageBlocks: [markdown("first")],
        channelNames: [],
        channelIds: [],
        chatIds: ["19:chat@thread.v2"],
      },
    });

    answerPost(
      [
        {
          channel: {
            id: "19:inc8@thread.tacv2",
            name: "inc-8",
            workspaceType: WorkspaceType.MicrosoftTeams,
          },
          threadId: "1700000000002",
        },
      ],
      WorkspaceType.MicrosoftTeams,
    );

    await WorkspaceLiveMessages.postAndKeep({
      projectId: PROJECT_ID,
      messageKey: KEY,
      destination: {
        _type: "WorkspaceMessagePayload",
        workspaceType: WorkspaceType.MicrosoftTeams,
        messageBlocks: [markdown("first")],
        channelNames: [],
        channelIds: ["19:inc8@thread.tacv2"],
        teamId: "graph-team-1",
      },
    });

    expect(store.rows[0]!.destinationType).toBe(
      WorkspaceLiveMessageDestinationType.Chat,
    );
    expect(store.rows[0]!.teamId).toBeUndefined();
    expect(store.rows[1]!.destinationType).toBe(
      WorkspaceLiveMessageDestinationType.Channel,
    );
    expect(store.rows[1]!.teamId).toBe("graph-team-1");
  });

  test("nothing posted, nothing kept", async () => {
    answerPost([]);

    await expect(
      WorkspaceLiveMessages.postAndKeep({
        projectId: PROJECT_ID,
        messageKey: KEY,
        destination: slackPayload(),
      }),
    ).resolves.toBeNull();

    expect(store.rows).toEqual([]);
  });

  test("posted without an id, it is still kept - so it is never posted a second time", async () => {
    answerPost([
      {
        channel: {
          id: "C0INC8",
          name: "inc-inc-8",
          workspaceType: WorkspaceType.Slack,
        },
        threadId: "",
      },
    ]);

    await WorkspaceLiveMessages.postAndKeep({
      projectId: PROJECT_ID,
      messageKey: KEY,
      destination: slackPayload(),
    });

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]!.messageId).toBe("");
  });

  test("a row that cannot be written loses the edit, never the post", async () => {
    answerPost([
      {
        channel: {
          id: "C0INC8",
          name: "inc-inc-8",
          workspaceType: WorkspaceType.Slack,
        },
        threadId: "1.2",
      },
    ]);
    jest
      .spyOn(WorkspaceLiveMessageService, "create")
      .mockRejectedValue(new Error("database is down"));

    await expect(
      WorkspaceLiveMessages.postAndKeep({
        projectId: PROJECT_ID,
        messageKey: KEY,
        destination: slackPayload(),
      }),
    ).resolves.toBeNull();
    expect(postSpy).toHaveBeenCalledTimes(1);
  });
});

describe("WorkspaceLiveMessages.postEverywhere", () => {
  test("posts in every place a message about the record goes, in every workspace the project is connected to", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
      .mockResolvedValue([
        auth(WorkspaceType.MicrosoftTeams),
        auth(WorkspaceType.Slack),
      ]);

    const destinationsSpy: SpyInstance<
      typeof WorkspaceNotificationRuleService.getMessageDestinations
    > = jest
      .spyOn(WorkspaceNotificationRuleService, "getMessageDestinations")
      .mockImplementation((async (data: {
        workspaceType: WorkspaceType;
      }): Promise<Array<WorkspaceMessagePayload>> => {
        if (data.workspaceType === WorkspaceType.Slack) {
          return [
            slackPayload({ messageBlocks: [] }),
            slackPayload({
              messageBlocks: [],
              channelIds: [],
              channelNames: ["incidents"],
            }),
          ];
        }

        return [
          {
            _type: "WorkspaceMessagePayload",
            workspaceType: WorkspaceType.MicrosoftTeams,
            messageBlocks: [],
            channelNames: [],
            channelIds: ["19:inc8@thread.tacv2"],
            teamId: "graph-team-1",
          },
        ];
      }) as never);

    postSpy.mockImplementation((async (data: {
      messagePayloadsByWorkspace: Array<WorkspaceMessagePayload>;
    }): Promise<Array<WorkspaceSendMessageResponse>> => {
      const payload: WorkspaceMessagePayload =
        data.messagePayloadsByWorkspace[0]!;
      const id: string =
        payload.channelIds[0] || payload.channelNames[0] || "unknown";

      return [
        {
          workspaceType: payload.workspaceType,
          threads: [
            {
              channel: {
                id: id,
                name: id,
                workspaceType: payload.workspaceType,
              },
              threadId: `ts-${id}`,
            },
          ],
        },
      ];
    }) as never);

    const kept: Array<WorkspaceLiveMessage> =
      await WorkspaceLiveMessages.postEverywhere({
        projectId: PROJECT_ID,
        messageKey: KEY,
        notificationFor: { incidentId: ObjectID.generate() },
        messageBlocks: [markdown("the run")],
        text: "PolicyX is paging for Incident INC-8",
        messageData: { alarms: [] },
      });

    // Slack first, then Microsoft Teams.
    expect(
      destinationsSpy.mock.calls.map(
        (call: Array<{ workspaceType: WorkspaceType }>): WorkspaceType => {
          return call[0]!.workspaceType;
        },
      ),
    ).toEqual([WorkspaceType.Slack, WorkspaceType.MicrosoftTeams]);

    expect(postSpy).toHaveBeenCalledTimes(3);

    for (const call of postSpy.mock.calls) {
      expect(call[0].messagePayloadsByWorkspace).toHaveLength(1);
      expect(call[0].messagePayloadsByWorkspace[0]!.messageBlocks).toEqual([
        markdown("the run"),
      ]);
      // Every place gets what its notification says of the new message.
      expect(call[0].messagePayloadsByWorkspace[0]!.text).toBe(
        "PolicyX is paging for Incident INC-8",
      );
    }

    expect(
      kept.map((row: WorkspaceLiveMessage): string => {
        return `${row.workspaceType}:${row.channelId}:${row.messageId}`;
      }),
    ).toEqual([
      "Slack:C0INC8:ts-C0INC8",
      "Slack:incidents:ts-incidents",
      "MicrosoftTeams:19:inc8@thread.tacv2:ts-19:inc8@thread.tacv2",
    ]);
  });

  test("a project connected to neither workspace posts nothing and reads no rules", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
      .mockResolvedValue([]);
    const destinationsSpy: SpyInstance<
      typeof WorkspaceNotificationRuleService.getMessageDestinations
    > = jest.spyOn(WorkspaceNotificationRuleService, "getMessageDestinations");

    await expect(
      WorkspaceLiveMessages.postEverywhere({
        projectId: PROJECT_ID,
        messageKey: KEY,
        notificationFor: { incidentId: ObjectID.generate() },
        messageBlocks: [markdown("the run")],
      }),
    ).resolves.toEqual([]);

    expect(destinationsSpy).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("a workspace whose rules cannot be read is left out; the others still get the message", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
      .mockResolvedValue([
        auth(WorkspaceType.Slack),
        auth(WorkspaceType.MicrosoftTeams),
      ]);
    jest
      .spyOn(WorkspaceNotificationRuleService, "getMessageDestinations")
      .mockImplementation((async (data: {
        workspaceType: WorkspaceType;
      }): Promise<Array<WorkspaceMessagePayload>> => {
        if (data.workspaceType === WorkspaceType.Slack) {
          throw new Error("rules could not be read");
        }

        return [
          {
            _type: "WorkspaceMessagePayload",
            workspaceType: WorkspaceType.MicrosoftTeams,
            messageBlocks: [],
            channelNames: [],
            channelIds: [],
            chatIds: ["19:chat@thread.v2"],
          },
        ];
      }) as never);

    answerPost(
      [
        {
          channel: {
            id: "19:chat@thread.v2",
            name: "chat",
            workspaceType: WorkspaceType.MicrosoftTeams,
          },
          threadId: "1",
        },
      ],
      WorkspaceType.MicrosoftTeams,
    );

    const kept: Array<WorkspaceLiveMessage> =
      await WorkspaceLiveMessages.postEverywhere({
        projectId: PROJECT_ID,
        messageKey: KEY,
        notificationFor: { incidentId: ObjectID.generate() },
        messageBlocks: [markdown("the run")],
      });

    expect(kept).toHaveLength(1);
    expect(kept[0]!.workspaceType).toBe(WorkspaceType.MicrosoftTeams);
  });
});

describe("WorkspaceLiveMessages.updateKept", () => {
  let kept: WorkspaceLiveMessage;
  let slackUpdate: SpyInstance<typeof SlackUtil.updateMessage>;

  beforeEach(async () => {
    answerPost([
      {
        channel: {
          id: "C0INC8",
          name: "inc-inc-8",
          workspaceType: WorkspaceType.Slack,
        },
        threadId: "1700000000.000100",
      },
    ]);

    kept = (await WorkspaceLiveMessages.postAndKeep({
      projectId: PROJECT_ID,
      messageKey: KEY,
      destination: slackPayload(),
      messageData: { alarms: [] },
    }))!;

    postSpy.mockClear();
    slackUpdate = jest
      .spyOn(SlackUtil, "updateMessage")
      .mockResolvedValue(undefined);
  });

  test("a message that already says this is not edited", async () => {
    await expect(
      WorkspaceLiveMessages.updateKept({
        keptMessage: kept,
        messageBlocks: [markdown("first")],
      }),
    ).resolves.toBe(WorkspaceLiveMessageEdit.Unchanged);

    expect(slackUpdate).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("the same text with something new to remember: remembered, not sent", async () => {
    await expect(
      WorkspaceLiveMessages.updateKept({
        keptMessage: kept,
        messageBlocks: [markdown("first")],
        messageData: { alarms: ["outcome"] },
      }),
    ).resolves.toBe(WorkspaceLiveMessageEdit.Unchanged);

    expect(slackUpdate).not.toHaveBeenCalled();
    expect(store.rows[0]!.messageData).toEqual({ alarms: ["outcome"] });
  });

  test("new text is an edit of the same message, in the same channel", async () => {
    await expect(
      WorkspaceLiveMessages.updateKept({
        keptMessage: kept,
        messageBlocks: [markdown("second")],
        text: "PolicyX is paging for Incident INC-8",
        messageData: { alarms: ["outcome"] },
      }),
    ).resolves.toBe(WorkspaceLiveMessageEdit.Updated);

    expect(slackUpdate).toHaveBeenCalledTimes(1);
    expect(slackUpdate.mock.calls[0]![0]).toEqual({
      authToken: "Slack-token",
      projectId: PROJECT_ID,
      location: {
        channelId: "C0INC8",
        teamId: undefined,
        isChat: false,
      },
      messageId: "1700000000.000100",
      messageBlocks: [markdown("second")],
      text: "PolicyX is paging for Incident INC-8",
    });
    expect(postSpy).not.toHaveBeenCalled();

    expect(store.rows[0]!.contentHash).toBe(
      WorkspaceLiveMessages.getContentHash([markdown("second")]),
    );
    expect(store.rows[0]!.messageData).toEqual({ alarms: ["outcome"] });
  });

  test("a message somebody deleted is posted again in the same place, and kept by its new id", async () => {
    slackUpdate.mockRejectedValue(
      new BadRequestException("Error from Slack message_not_found"),
    );
    answerPost([
      {
        channel: {
          id: "C0INC8",
          name: "inc-inc-8",
          workspaceType: WorkspaceType.Slack,
        },
        threadId: "1700000000.000999",
      },
    ]);

    await expect(
      WorkspaceLiveMessages.updateKept({
        keptMessage: kept,
        messageBlocks: [markdown("second")],
      }),
    ).resolves.toBe(WorkspaceLiveMessageEdit.Reposted);

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0]![0].messagePayloadsByWorkspace).toEqual([
      {
        _type: "WorkspaceMessagePayload",
        workspaceType: WorkspaceType.Slack,
        messageBlocks: [markdown("second")],
        channelNames: [],
        channelIds: ["C0INC8"],
        chatIds: [],
        teamId: undefined,
      },
    ]);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]!.messageId).toBe("1700000000.000999");
  });

  test("posted again, it is a new message: its notification says what the edit would have", async () => {
    slackUpdate.mockRejectedValue(
      new BadRequestException("Error from Slack message_not_found"),
    );
    answerPost([
      {
        channel: {
          id: "C0INC8",
          name: "inc-inc-8",
          workspaceType: WorkspaceType.Slack,
        },
        threadId: "1700000000.000999",
      },
    ]);

    await expect(
      WorkspaceLiveMessages.updateKept({
        keptMessage: kept,
        messageBlocks: [markdown("second")],
        text: "Nitin acknowledged Incident INC-8",
      }),
    ).resolves.toBe(WorkspaceLiveMessageEdit.Reposted);

    expect(postSpy.mock.calls[0]![0].messagePayloadsByWorkspace[0]!.text).toBe(
      "Nitin acknowledged Incident INC-8",
    );
  });

  test("any other refusal is left for the next change: nothing posted, nothing remembered", async () => {
    slackUpdate.mockRejectedValue(
      new BadRequestException("Error from Slack is_archived"),
    );

    await expect(
      WorkspaceLiveMessages.updateKept({
        keptMessage: kept,
        messageBlocks: [markdown("second")],
        messageData: { alarms: ["outcome"] },
      }),
    ).resolves.toBe(WorkspaceLiveMessageEdit.Failed);

    expect(postSpy).not.toHaveBeenCalled();
    expect(store.rows[0]!.contentHash).toBe(
      WorkspaceLiveMessages.getContentHash([markdown("first")]),
    );
    expect(store.rows[0]!.messageData).toEqual({ alarms: [] });
  });

  test("a workspace that was disconnected is not edited", async () => {
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockResolvedValue(null);

    await expect(
      WorkspaceLiveMessages.updateKept({
        keptMessage: kept,
        messageBlocks: [markdown("second")],
      }),
    ).resolves.toBe(WorkspaceLiveMessageEdit.Failed);

    expect(slackUpdate).not.toHaveBeenCalled();
  });

  test("a message kept without an id cannot be edited, and is not posted again", async () => {
    kept.messageId = "";

    await expect(
      WorkspaceLiveMessages.updateKept({
        keptMessage: kept,
        messageBlocks: [markdown("second")],
      }),
    ).resolves.toBe(WorkspaceLiveMessageEdit.Unchanged);

    expect(slackUpdate).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
  });

  test("a Microsoft Teams chat is edited as a chat, a deleted one posted again to the chat", async () => {
    const teamsUpdate: SpyInstance<typeof MicrosoftTeamsUtil.updateMessage> =
      jest
        .spyOn(MicrosoftTeamsUtil, "updateMessage")
        .mockRejectedValue({ statusCode: 404, code: "NotFound" });
    jest.spyOn(MicrosoftTeamsUtil, "isMessageGoneError").mockReturnValue(true);

    const chatMessage: WorkspaceLiveMessage = new WorkspaceLiveMessage();
    chatMessage.id = ObjectID.generate();
    chatMessage.projectId = PROJECT_ID;
    chatMessage.workspaceType = WorkspaceType.MicrosoftTeams;
    chatMessage.messageKey = KEY;
    chatMessage.destinationType = WorkspaceLiveMessageDestinationType.Chat;
    chatMessage.channelId = "19:chat@thread.v2";
    chatMessage.messageId = "1700000000001";
    chatMessage.contentHash = "old";
    store.rows.push(chatMessage);

    answerPost(
      [
        {
          channel: {
            id: "19:chat@thread.v2",
            name: "chat",
            workspaceType: WorkspaceType.MicrosoftTeams,
          },
          threadId: "1700000000002",
        },
      ],
      WorkspaceType.MicrosoftTeams,
    );

    await expect(
      WorkspaceLiveMessages.updateKept({
        keptMessage: chatMessage,
        messageBlocks: [markdown("second")],
      }),
    ).resolves.toBe(WorkspaceLiveMessageEdit.Reposted);

    expect(teamsUpdate.mock.calls[0]![0].location).toEqual({
      channelId: "19:chat@thread.v2",
      teamId: undefined,
      isChat: true,
    });
    expect(postSpy.mock.calls[0]![0].messagePayloadsByWorkspace[0]).toEqual(
      expect.objectContaining({
        channelIds: [],
        chatIds: ["19:chat@thread.v2"],
      }),
    );
  });
});

describe("WorkspaceLiveMessages.getConnectedWorkspaceTypes", () => {
  test("the workspaces with a token, Slack first", async () => {
    const teamsWithoutToken: WorkspaceProjectAuthToken = auth(
      WorkspaceType.MicrosoftTeams,
    );
    delete (teamsWithoutToken as { authToken?: string }).authToken;

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
      .mockResolvedValueOnce([
        auth(WorkspaceType.MicrosoftTeams),
        auth(WorkspaceType.Slack),
      ])
      .mockResolvedValueOnce([teamsWithoutToken]);

    await expect(
      WorkspaceLiveMessages.getConnectedWorkspaceTypes(PROJECT_ID),
    ).resolves.toEqual([WorkspaceType.Slack, WorkspaceType.MicrosoftTeams]);
    await expect(
      WorkspaceLiveMessages.getConnectedWorkspaceTypes(PROJECT_ID),
    ).resolves.toEqual([]);
  });
});
