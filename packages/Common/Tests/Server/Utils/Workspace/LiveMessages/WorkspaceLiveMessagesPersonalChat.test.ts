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
import WorkspaceLiveMessageService from "../../../../../Server/Services/WorkspaceLiveMessageService";
import WorkspaceNotificationRuleService from "../../../../../Server/Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import logger from "../../../../../Server/Utils/Logger";
import WorkspaceLiveMessages, {
  WorkspaceLiveMessageEdit,
} from "../../../../../Server/Utils/Workspace/LiveMessages/WorkspaceLiveMessages";
import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import WorkspaceUtil from "../../../../../Server/Utils/Workspace/Workspace";
import { WorkspaceSendMessageResponse } from "../../../../../Server/Utils/Workspace/WorkspaceBase";
import ColumnLength from "../../../../../Types/Database/ColumnLength";
import ObjectID from "../../../../../Types/ObjectID";
import { WorkspaceLiveMessageDestinationType } from "../../../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceMessagePayload, {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import InMemoryLiveMessages from "./InMemoryLiveMessages";

jest.mock("../../../../../Server/Utils/Logger");

/*
 * A MESSAGE KEPT UP TO DATE IN A MICROSOFT TEAMS PERSONAL CHAT (issue #9284).
 *
 * A personal chat's id ("a:1...") is 130 characters and more. OneUptime cut
 * the place of every message it keeps up to date to 100 characters, which
 * made it the id of no chat: every edit of the message, and every post of
 * it again, failed with "This chat is not connected to OneUptime". The
 * place is kept whole now - or, longer than a column keeps, not at all.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const KEY: string = "OnCallPolicyRun:run-1";

// A personal chat's id as the Bot Framework gives it: 131 characters.
const PERSONAL_CHAT_ID: string =
  "a:1BfcDQQeKz2oG1CPSFyD5ZD1flTYm2IoCY23DqeeVgq6wyCCFf9P43FAqqDYNLI-pephf2ltim4CcrRj_ti04mQkhsHSJDCY_Wsu7XBF4qh8qmhl2nGt9cSEa704tfJxn";

// What the chat used to be kept as.
const CUT_PERSONAL_CHAT_ID: string = PERSONAL_CHAT_ID.substring(0, 100);

// An activity id as Teams answers a post in a personal chat.
const ACTIVITY_ID: string = "1:1Q4ARiJ0KxfMzYm9CwhUKHtTo8OHT1cD82gUb4vg6ccE";

// Longer than any column keeps whole.
const TOO_LONG_ID: string = `a:1${"x".repeat(ColumnLength.LongText)}`;

function markdown(text: string): WorkspacePayloadMarkdown {
  return { _type: "WorkspacePayloadMarkdown", text: text };
}

function chatPayload(
  chatId: string = PERSONAL_CHAT_ID,
  blocks: Array<WorkspaceMessageBlock> = [markdown("first")],
): WorkspaceMessagePayload {
  return {
    _type: "WorkspaceMessagePayload",
    workspaceType: WorkspaceType.MicrosoftTeams,
    messageBlocks: blocks,
    channelNames: [],
    channelIds: [],
    chatIds: [chatId],
  };
}

function chatThread(
  data: {
    chatId?: string;
    name?: string;
    threadId?: string;
    teamId?: string;
  } = {},
): WorkspaceSendMessageResponse["threads"][number] {
  return {
    channel: {
      id: data.chatId ?? PERSONAL_CHAT_ID,
      name: data.name ?? "Amit Rajput",
      workspaceType: WorkspaceType.MicrosoftTeams,
      ...(data.teamId ? { teamId: data.teamId } : {}),
    },
    threadId: data.threadId ?? ACTIVITY_ID,
  };
}

let store: InMemoryLiveMessages;
let postSpy: SpyInstance<
  typeof WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot
>;

function answerPost(threads: WorkspaceSendMessageResponse["threads"]): void {
  postSpy.mockResolvedValueOnce([
    { workspaceType: WorkspaceType.MicrosoftTeams, threads: threads },
  ]);
}

beforeEach(() => {
  store = new InMemoryLiveMessages();
  store.install();

  postSpy = jest
    .spyOn(WorkspaceUtil, "postMessageToAllWorkspaceChannelsAsBot")
    .mockResolvedValue([]);
  jest
    .spyOn(WorkspaceNotificationRuleService, "logSendResponses")
    .mockResolvedValue(undefined);

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockImplementation((async (): Promise<WorkspaceProjectAuthToken> => {
      const token: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
      token.projectId = PROJECT_ID;
      token.workspaceType = WorkspaceType.MicrosoftTeams;
      token.authToken = "teams-token";
      return token;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("A message posted in a Microsoft Teams personal chat", () => {
  test("the fixture is a personal chat id as long as the one in the report", () => {
    expect(PERSONAL_CHAT_ID).toHaveLength(131);
    expect(PERSONAL_CHAT_ID.startsWith("a:1")).toBe(true);
    expect(CUT_PERSONAL_CHAT_ID).toHaveLength(100);
  });

  test("REGRESSION #9284: is kept by the chat's whole id, as a chat, with its activity id", async () => {
    answerPost([chatThread()]);

    const kept: WorkspaceLiveMessage | null =
      await WorkspaceLiveMessages.postAndKeep({
        projectId: PROJECT_ID,
        messageKey: KEY,
        destination: chatPayload(),
      });

    expect(kept).not.toBeNull();
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]!.channelId).toBe(PERSONAL_CHAT_ID);
    expect(store.rows[0]!.channelId).not.toBe(CUT_PERSONAL_CHAT_ID);
    expect(store.rows[0]!.destinationType).toBe(
      WorkspaceLiveMessageDestinationType.Chat,
    );
    expect(store.rows[0]!.channelName).toBe("Amit Rajput");
    expect(store.rows[0]!.messageId).toBe(ACTIVITY_ID);
    expect(store.rows[0]!.teamId).toBeUndefined();
  });

  test("REGRESSION #9284: the row it is kept in passes the table's own length check", async () => {
    answerPost([chatThread()]);

    await WorkspaceLiveMessages.postAndKeep({
      projectId: PROJECT_ID,
      messageKey: KEY,
      destination: chatPayload(),
    });

    // The in-memory store skips it; DatabaseService runs it on every create.
    expect(() => {
      return WorkspaceLiveMessageService["checkMaxLengthOfFields"](
        store.rows[0]!,
      );
    }).not.toThrow();
  });

  test("REGRESSION #9284: is edited in the chat it is in - the whole id, as a chat", async () => {
    answerPost([chatThread()]);

    const kept: WorkspaceLiveMessage = (await WorkspaceLiveMessages.postAndKeep(
      {
        projectId: PROJECT_ID,
        messageKey: KEY,
        destination: chatPayload(),
      },
    ))!;

    const teamsUpdate: SpyInstance<typeof MicrosoftTeamsUtil.updateMessage> =
      jest
        .spyOn(MicrosoftTeamsUtil, "updateMessage")
        .mockResolvedValue(undefined);

    await expect(
      WorkspaceLiveMessages.updateKept({
        keptMessage: kept,
        messageBlocks: [markdown("Nitin acknowledged")],
      }),
    ).resolves.toBe(WorkspaceLiveMessageEdit.Updated);

    expect(teamsUpdate).toHaveBeenCalledTimes(1);
    expect(teamsUpdate.mock.calls[0]![0].location).toEqual({
      channelId: PERSONAL_CHAT_ID,
      teamId: undefined,
      isChat: true,
    });
    expect(teamsUpdate.mock.calls[0]![0].messageId).toBe(ACTIVITY_ID);
  });

  test("REGRESSION #9284: deleted from the chat, it is posted again to the chat by its whole id, and kept by its new id", async () => {
    answerPost([chatThread()]);

    const kept: WorkspaceLiveMessage = (await WorkspaceLiveMessages.postAndKeep(
      {
        projectId: PROJECT_ID,
        messageKey: KEY,
        destination: chatPayload(),
      },
    ))!;

    jest
      .spyOn(MicrosoftTeamsUtil, "updateMessage")
      .mockRejectedValue({ statusCode: 404, code: "NotFound" });
    jest.spyOn(MicrosoftTeamsUtil, "isMessageGoneError").mockReturnValue(true);

    const newActivityId: string =
      "1:1zR8YEuJhSnFMTzBHamPq12NvuDcDkDmdzNsnAZ3E_VH";
    answerPost([chatThread({ threadId: newActivityId })]);

    await expect(
      WorkspaceLiveMessages.updateKept({
        keptMessage: kept,
        messageBlocks: [markdown("Nitin acknowledged")],
      }),
    ).resolves.toBe(WorkspaceLiveMessageEdit.Reposted);

    expect(postSpy.mock.calls[1]![0].messagePayloadsByWorkspace[0]).toEqual(
      expect.objectContaining({
        channelIds: [],
        chatIds: [PERSONAL_CHAT_ID],
      }),
    );
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]!.channelId).toBe(PERSONAL_CHAT_ID);
    expect(store.rows[0]!.messageId).toBe(newActivityId);
  });

  test("a chat's name longer than its column is cut to fit; the chat's id never is", async () => {
    const longName: string = "Amit, Jane, Nitin and the on-call ".repeat(20);
    answerPost([chatThread({ name: longName })]);

    await WorkspaceLiveMessages.postAndKeep({
      projectId: PROJECT_ID,
      messageKey: KEY,
      destination: chatPayload(),
    });

    expect(longName.length).toBeGreaterThan(ColumnLength.LongText);
    expect(store.rows[0]!.channelName).toBe(
      longName.substring(0, ColumnLength.LongText),
    );
    expect(store.rows[0]!.channelId).toBe(PERSONAL_CHAT_ID);
  });
});

describe("A place too long to keep whole", () => {
  test("a chat id longer than any column keeps: the message is posted, but not kept under a part of its id - and the log says why", async () => {
    answerPost([chatThread({ chatId: TOO_LONG_ID })]);

    await expect(
      WorkspaceLiveMessages.postAndKeep({
        projectId: PROJECT_ID,
        messageKey: KEY,
        destination: chatPayload(TOO_LONG_ID),
      }),
    ).resolves.toBeNull();

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(store.rows).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("longer than OneUptime can keep whole"),
      { projectId: PROJECT_ID.toString() },
    );
  });

  test("a team id longer than any column keeps: not kept either", async () => {
    answerPost([
      {
        channel: {
          id: "19:inc8@thread.tacv2",
          name: "inc-8",
          workspaceType: WorkspaceType.MicrosoftTeams,
        },
        threadId: "1700000000002",
      },
    ]);

    await expect(
      WorkspaceLiveMessages.postAndKeep({
        projectId: PROJECT_ID,
        messageKey: KEY,
        destination: {
          _type: "WorkspaceMessagePayload",
          workspaceType: WorkspaceType.MicrosoftTeams,
          messageBlocks: [markdown("first")],
          channelNames: [],
          channelIds: ["19:inc8@thread.tacv2"],
          teamId: TOO_LONG_ID,
        },
      }),
    ).resolves.toBeNull();

    expect(store.rows).toEqual([]);
  });

  test("an activity id longer than any column keeps: kept without one, as a post Teams answered without an id is - never edited, never posted again", async () => {
    answerPost([chatThread({ threadId: TOO_LONG_ID })]);

    await WorkspaceLiveMessages.postAndKeep({
      projectId: PROJECT_ID,
      messageKey: KEY,
      destination: chatPayload(),
    });

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]!.channelId).toBe(PERSONAL_CHAT_ID);
    expect(store.rows[0]!.messageId).toBe("");
  });

  test("the table itself refuses an id longer than its column, rather than keep a part of it", () => {
    const row: WorkspaceLiveMessage = new WorkspaceLiveMessage();
    row.channelId = TOO_LONG_ID;

    expect(() => {
      return WorkspaceLiveMessageService["checkMaxLengthOfFields"](row);
    }).toThrow(
      `channelId length cannot be more than ${ColumnLength.LongText} characters`,
    );
  });
});

describe("Posts a send already made, kept in a personal chat (keepPosts)", () => {
  const leadBlocks: Array<WorkspaceMessageBlock> = [markdown("the fix")];

  test("REGRESSION #9284: kept as a chat, by the chat's whole id", async () => {
    const payload: WorkspaceMessagePayload = chatPayload(PERSONAL_CHAT_ID, [
      ...leadBlocks,
      markdown("buttons"),
    ]);

    const kept: Array<WorkspaceLiveMessage> =
      await WorkspaceLiveMessages.keepPosts({
        projectId: PROJECT_ID,
        messageKey: KEY,
        payloads: [payload],
        responses: [
          {
            workspaceType: WorkspaceType.MicrosoftTeams,
            threads: [chatThread()],
          },
        ],
        leadBlocksByWorkspaceType: new Map([
          [WorkspaceType.MicrosoftTeams, leadBlocks],
        ]),
      });

    expect(kept).toHaveLength(1);
    expect(store.rows[0]!.channelId).toBe(PERSONAL_CHAT_ID);
    // Told a chat by the whole id the send was addressed to.
    expect(store.rows[0]!.destinationType).toBe(
      WorkspaceLiveMessageDestinationType.Chat,
    );
    expect(store.rows[0]!.messageId).toBe(ACTIVITY_ID);
  });

  test("a post whose chat or activity id is longer than any column keeps is not kept, and the others still are", async () => {
    const kept: Array<WorkspaceLiveMessage> =
      await WorkspaceLiveMessages.keepPosts({
        projectId: PROJECT_ID,
        messageKey: KEY,
        payloads: [
          chatPayload(TOO_LONG_ID),
          chatPayload(PERSONAL_CHAT_ID),
          chatPayload(PERSONAL_CHAT_ID),
        ],
        responses: [
          {
            workspaceType: WorkspaceType.MicrosoftTeams,
            threads: [chatThread({ chatId: TOO_LONG_ID })],
          },
          {
            workspaceType: WorkspaceType.MicrosoftTeams,
            threads: [chatThread({ threadId: TOO_LONG_ID })],
          },
          {
            workspaceType: WorkspaceType.MicrosoftTeams,
            threads: [chatThread()],
          },
        ],
        leadBlocksByWorkspaceType: new Map(),
      });

    expect(kept).toHaveLength(1);
    expect(
      store.rows.map((row: WorkspaceLiveMessage) => {
        return [row.channelId, row.messageId];
      }),
    ).toEqual([[PERSONAL_CHAT_ID, ACTIVITY_ID]]);
  });
});
