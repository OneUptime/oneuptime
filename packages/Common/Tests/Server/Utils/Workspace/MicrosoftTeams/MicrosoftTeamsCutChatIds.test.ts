import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * MICROSOFT TEAMS CHAT IDS KEPT CUT TO 100 CHARACTERS, PUT BACK WHOLE WHEN A
 * CHAT IS LISTED AFTER THE UPGRADE (issue #9330, a follow-up of #9284).
 *
 * Until #9284, OneUptime kept the place of a page asked for in a Microsoft
 * Teams personal chat with the chat's id cut to 100 characters - an id of
 * no chat - so every update of the page failed there with "This chat is
 * not connected to OneUptime". The upgrade's data migration puts the whole
 * id back from the chats each connection lists then. A chat it did not
 * list then (the app removed from the chat and added again) could not be
 * told from its cut id, and its places stayed cut once the chat was
 * listed again.
 *
 * MicrosoftTeamsCutChatIds holds what both share: which cut id stands for
 * which chat, and the statements. When a connection newly lists a chat
 * (MicrosoftTeamsUtil.saveChatToProjectAuthTokens, from the bot's install
 * events and the first message in a chat), the messages the project keeps
 * up to date that hold the chat's id cut get it whole.
 *
 * Pinned here:
 *   1. which cut id stands for which chat: a chat longer than 100
 *      characters; a prefix two listed chats share stands for neither, nor
 *      does a chat no column keeps whole;
 *   2. one chat's restore: one statement, on the kept messages only (the
 *      Notification Logs have no index to find a chat's rows by), scoped to
 *      the project and to Microsoft Teams, matching the cut id exactly;
 *      none for a chat never cut, one too long to keep, or a prefix another
 *      listed chat shares; never throws;
 *   3. it runs only for a project whose connection did not list the chat
 *      before, after the chat is saved: never for a chat already listed (a
 *      re-capture or a staleness refresh, on the bot's activity path), a
 *      connection with no project, or another project of the tenant;
 *   4. through the bot's own activities: the app added to a personal chat
 *      (installationUpdate, conversationUpdate), and the first message in
 *      a chat no connection lists; a message in a chat already captured
 *      reads once and writes nothing.
 */

jest.mock("../../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
    MicrosoftTeamsAppClientSecret: "test-secret",
    MicrosoftTeamsAppTenantId: "test-tenant",
  };
});

/*
 * The repo-wide botbuilder manual mock does not expose TeamsInfo, which
 * chat capture reads the roster with.
 */
jest.mock("botbuilder", () => {
  return {
    CloudAdapter: class CloudAdapter {},
    ConfigurationBotFrameworkAuthentication: class ConfigurationBotFrameworkAuthentication {},
    TeamsActivityHandler: class TeamsActivityHandler {},
    TurnContext: class TurnContext {},
    ActivityHandler: class ActivityHandler {},
    MessageFactory: {
      text: jest.fn(),
      attachment: jest.fn((attachment: unknown) => {
        return { type: "message", attachments: [attachment] };
      }),
    },
    CardFactory: { heroCard: jest.fn() },
    TeamsInfo: {
      getMembers: jest.fn(),
      getPagedMembers: jest.fn(),
    },
  };
});

import WorkspaceProjectAuthToken, {
  MicrosoftTeamsChat,
  MicrosoftTeamsMiscData,
} from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceLiveMessageService from "../../../../../Server/Services/WorkspaceLiveMessageService";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import logger from "../../../../../Server/Utils/Logger";
import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsCutChatIds from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCutChatIds";
import { WORKSPACE_STORED_ID_MAX_LENGTH } from "../../../../../Server/Utils/Workspace/WorkspaceStoredValue";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import {
  TeamsInfo,
  type TeamsPagedMembersResult,
  type TurnContext,
} from "botbuilder";
import type { SpyInstance } from "jest-mock";

// Personal chats' ids as the Bot Framework gives them: 131 characters.
const JANE_CHAT: string =
  "a:1BfcDQQeKz2oG1CPSFyD5ZD1flTYm2IoCY23DqeeVgq6wyCCFf9P43FAqqDYNLI-pephf2ltim4CcrRj_ti04mQkhsHSJDCY_Wsu7XBF4qh8qmhl2nGt9cSEa704tfJxn";
const AMIT_CHAT: string =
  "a:1ko1Q0eJNq3zKYs_oT83Pn8aVFgonj5G1wK8itwnYL4qjtJVbPem6bQoOt9ky3GTE1cY_wt6HRBrS5bkp-bZ8XgAPV73h0dJjkkwvkko-LHWpnDd57IvAVFs1pJ2DULPc";

// Another chat whose id starts with the same 100 characters as Jane's.
const JANE_CHAT_TWIN: string = `${JANE_CHAT.substring(0, 100)}-another-chat-that-starts-the-same-way`;

// A group chat and a meeting chat: never cut.
const GROUP_CHAT: string = "19:9f2b1c0a7e5d4c3b@thread.v2";
const MEETING_CHAT: string =
  "19:meeting_NjM1ZTRhYjMtYTU5ZS00OGRiLWI0NjctMzQ2NTVjNDM5ZTRm@thread.v2";

const TENANT_ID: string = "6f1c2d3e-4b5a-4968-8778-a1b2c3d4e5f6";
const OTHER_TENANT_ID: string = "0a9b8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d";

const PROJECT_A: ObjectID = new ObjectID(
  "a0000000-0000-4000-8000-00000000000a",
);
const PROJECT_B: ObjectID = new ObjectID(
  "b0000000-0000-4000-8000-00000000000b",
);

const BOT_ID: string = "28:oneuptime-bot";
const SERVICE_URL: string = "https://smba.trafficmanager.net/teams/";
const JANE_AAD: string = "1d2c3b4a-0000-4000-8000-00000000jane";

const RESTORE_LIVE_MESSAGES: string =
  MicrosoftTeamsCutChatIds.getRestoreStatement("WorkspaceLiveMessage");

function cut(chatId: string): string {
  return chatId.substring(0, 100);
}

function chat(
  id: string,
  extra?: Partial<MicrosoftTeamsChat>,
): MicrosoftTeamsChat {
  return {
    id: id,
    name: `Chat ${id.length}`,
    chatType: id.startsWith("a:") ? "personal" : "groupChat",
    serviceUrl: SERVICE_URL,
    ...(extra || {}),
  };
}

function chats(...ids: Array<string>): Record<string, MicrosoftTeamsChat> {
  const listed: Record<string, MicrosoftTeamsChat> = {};

  for (const id of ids) {
    listed[id] = chat(id);
  }

  return listed;
}

interface RecordedQuery {
  statement: string;
  parameters: Array<unknown>;
}

/*
 * The Microsoft Teams connections of the tenants, as the
 * WorkspaceProjectAuthToken table holds them: what chat capture reads and
 * saves.
 */
interface Connection {
  id: ObjectID;
  projectId: ObjectID | undefined;
  tenantId: string;
  miscData: MicrosoftTeamsMiscData;
}

let connections: Array<Connection>;
let queries: Array<RecordedQuery>;
// What was written, in order: "save <project>" and "restore <project>".
let writes: Array<string>;
let failingProject: string | null;
let answer: unknown;

function connect(data: {
  projectId: ObjectID | undefined;
  tenantId?: string | undefined;
  availableChats?: Record<string, MicrosoftTeamsChat> | undefined;
}): Connection {
  const connection: Connection = {
    id: ObjectID.generate(),
    projectId: data.projectId,
    tenantId: data.tenantId || TENANT_ID,
    miscData: {
      tenantId: data.tenantId || TENANT_ID,
      teamId: "team-1",
      teamName: "Engineering",
      botId: BOT_ID,
      ...(data.availableChats ? { availableChats: data.availableChats } : {}),
    } as MicrosoftTeamsMiscData,
  };

  connections.push(connection);

  return connection;
}

// A row as a read hands it out: its own copy of what is stored.
function asRow(connection: Connection): WorkspaceProjectAuthToken {
  const row: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
  row.id = connection.id;

  if (connection.projectId) {
    row.projectId = connection.projectId;
  }

  row.workspaceType = WorkspaceType.MicrosoftTeams;
  row.workspaceProjectId = connection.tenantId;
  row.miscData = JSON.parse(JSON.stringify(connection.miscData));

  return row;
}

function listedBy(connection: Connection): Array<string> {
  return Object.keys(connection.miscData.availableChats || {}).sort();
}

function restoreQueries(): Array<RecordedQuery> {
  return queries.filter((query: RecordedQuery): boolean => {
    return query.statement === RESTORE_LIVE_MESSAGES;
  });
}

function turnContext(): TurnContext {
  return {
    activity: {
      recipient: { id: BOT_ID },
      serviceUrl: SERVICE_URL,
    },
  } as unknown as TurnContext;
}

function personalChatActivity(chatId: string, extra?: JSONObject): JSONObject {
  return {
    conversation: {
      conversationType: "personal",
      id: chatId,
      tenantId: TENANT_ID,
    },
    channelData: { tenant: { id: TENANT_ID } },
    serviceUrl: SERVICE_URL,
    recipient: { id: BOT_ID },
    from: { id: "29:jane", name: "Jane Doe", aadObjectId: JANE_AAD },
    ...(extra || {}),
  };
}

// What the message backfill runs for a message in a chat.
async function captureFromMessage(activity: JSONObject): Promise<void> {
  await (
    MicrosoftTeamsUtil as unknown as {
      captureChatFromBotActivity: (data: {
        activity: JSONObject;
        turnContext: TurnContext;
        onlyIfMissingOrStale?: boolean | undefined;
      }) => Promise<void>;
    }
  ).captureChatFromBotActivity({
    activity: activity,
    turnContext: turnContext(),
    onlyIfMissingOrStale: true,
  });
}

beforeEach(() => {
  connections = [];
  queries = [];
  writes = [];
  failingProject = null;
  // An UPDATE answers its rows and how many it changed.
  answer = [[], 1];

  jest.spyOn(WorkspaceLiveMessageService, "getRepository").mockReturnValue({
    manager: {
      query: async (
        statement: string,
        parameters: Array<unknown>,
      ): Promise<unknown> => {
        queries.push({ statement: statement, parameters: parameters });
        writes.push(`restore ${String(parameters[0])}`);

        if (failingProject && parameters[0] === failingProject) {
          throw new Error("canceling statement due to lock timeout");
        }

        return answer;
      },
    },
  } as never);

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "findBy")
    .mockImplementation((async (data: {
      query: { workspaceType?: WorkspaceType; workspaceProjectId?: string };
    }): Promise<Array<WorkspaceProjectAuthToken>> => {
      return connections
        .filter((connection: Connection): boolean => {
          return (
            data.query.workspaceType === WorkspaceType.MicrosoftTeams &&
            connection.tenantId === data.query.workspaceProjectId
          );
        })
        .map(asRow);
    }) as never);

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
    .mockImplementation((async (data: {
      id: ObjectID;
      data: { miscData: MicrosoftTeamsMiscData };
    }): Promise<void> => {
      const connection: Connection | undefined = connections.find(
        (candidate: Connection): boolean => {
          return candidate.id.toString() === data.id.toString();
        },
      );

      if (connection) {
        connection.miscData = JSON.parse(JSON.stringify(data.data.miscData));
        writes.push(`save ${connection.projectId?.toString()}`);
      }
    }) as never);

  // Jane's personal chat with the bot: Jane and the bot.
  (TeamsInfo.getPagedMembers as jest.Mock).mockReset();
  (TeamsInfo.getPagedMembers as jest.Mock).mockImplementation(async () => {
    return {
      members: [
        { id: BOT_ID, name: "OneUptime" },
        { id: "29:jane", name: "Jane Doe", aadObjectId: JANE_AAD },
      ],
      continuationToken: undefined,
    } as unknown as TeamsPagedMembersResult;
  });

  for (const level of ["debug", "info", "warn", "error"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {});
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Which cut id stands for which chat", () => {
  test("the fixtures are personal chat ids as long as the one in the report", () => {
    expect(JANE_CHAT).toHaveLength(131);
    expect(AMIT_CHAT).toHaveLength(131);
    expect(MicrosoftTeamsCutChatIds.CUT_LENGTH).toBe(100);
  });

  test("a chat's id as it was kept is its first 100 characters, cut as it was cut", () => {
    expect(MicrosoftTeamsCutChatIds.cut(JANE_CHAT)).toBe(
      JANE_CHAT.substring(0, 100),
    );
    expect(MicrosoftTeamsCutChatIds.cut(JANE_CHAT)).toHaveLength(100);
    expect(MicrosoftTeamsCutChatIds.cut(GROUP_CHAT)).toBe(GROUP_CHAT);
  });

  test("a personal chat's id stands for its first 100 characters", () => {
    expect(
      MicrosoftTeamsCutChatIds.getCutChatIds([JANE_CHAT, AMIT_CHAT]),
    ).toEqual(
      new Map([
        [cut(JANE_CHAT), JANE_CHAT],
        [cut(AMIT_CHAT), AMIT_CHAT],
      ]),
    );
  });

  test("a chat whose id was never cut - 100 characters or fewer - stands for nothing", () => {
    const exactly100: string = `a:1${"h".repeat(97)}`;

    expect(exactly100).toHaveLength(100);
    expect(
      MicrosoftTeamsCutChatIds.getCutChatIds([
        GROUP_CHAT,
        MEETING_CHAT,
        exactly100,
      ]).size,
    ).toBe(0);
  });

  test("a chat longer than a column keeps whole is not put back: it would not fit", () => {
    const tooLong: string = `a:1${"x".repeat(WORKSPACE_STORED_ID_MAX_LENGTH)}`;
    const longestKept: string = `a:1${"y".repeat(WORKSPACE_STORED_ID_MAX_LENGTH - 3)}`;

    expect(MicrosoftTeamsCutChatIds.getCutChatIds([tooLong]).size).toBe(0);
    expect(MicrosoftTeamsCutChatIds.getCutChatIds([longestKept])).toEqual(
      new Map([[cut(longestKept), longestKept]]),
    );
  });

  test("a cut id two chats share says neither, and is left as it is", () => {
    expect(
      MicrosoftTeamsCutChatIds.getCutChatIds([
        JANE_CHAT,
        JANE_CHAT_TWIN,
        AMIT_CHAT,
      ]),
    ).toEqual(new Map([[cut(AMIT_CHAT), AMIT_CHAT]]));
  });

  test("a chat no column keeps whole still makes the prefix it shares say neither", () => {
    const tooLongTwin: string = `${cut(JANE_CHAT)}${"x".repeat(WORKSPACE_STORED_ID_MAX_LENGTH)}`;

    expect(
      MicrosoftTeamsCutChatIds.getCutChatIds([JANE_CHAT, tooLongTwin]).size,
    ).toBe(0);
  });

  test("a connection's chats are read by their keys and by the id each holds", () => {
    expect(
      Array.from(
        MicrosoftTeamsCutChatIds.getChatIds({
          [JANE_CHAT]: chat(JANE_CHAT),
          "legacy-key": chat(AMIT_CHAT),
        }),
      ).sort(),
    ).toEqual([JANE_CHAT, AMIT_CHAT, "legacy-key"].sort());
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a list", [JANE_CHAT]],
    ["text", JANE_CHAT],
  ])(
    "a connection whose chats are %s lists none",
    (_label: string, value: unknown) => {
      expect(MicrosoftTeamsCutChatIds.getChatIds(value).size).toBe(0);
    },
  );

  test("a chat that is not an object is read by its key alone", () => {
    expect(
      Array.from(
        MicrosoftTeamsCutChatIds.getChatIds({
          [JANE_CHAT]: null,
          [AMIT_CHAT]: "Amit",
        }),
      ).sort(),
    ).toEqual([JANE_CHAT, AMIT_CHAT].sort());
  });

  test("each table's statement is scoped to its project and to Microsoft Teams, and matches a cut id exactly", () => {
    expect(MicrosoftTeamsCutChatIds.TABLES).toEqual([
      "WorkspaceLiveMessage",
      "WorkspaceNotificationLog",
    ]);

    for (const table of MicrosoftTeamsCutChatIds.TABLES) {
      expect(MicrosoftTeamsCutChatIds.getRestoreStatement(table)).toBe(
        `UPDATE "${table}" AS "row" SET "channelId" = "chat"."id" FROM unnest($2::text[], $3::text[]) AS "chat"("cutId", "id") WHERE "row"."projectId" = $1 AND "row"."workspaceType" = $4 AND "row"."channelId" = "chat"."cutId"`,
      );
    }
  });
});

describe("Putting back one chat in the messages a project keeps up to date", () => {
  test("REGRESSION #9330: one statement, on the kept messages, for the project and Microsoft Teams, from the cut id to the whole id", async () => {
    await MicrosoftTeamsCutChatIds.restoreKeptMessages({
      projectId: PROJECT_A,
      chatId: JANE_CHAT,
      availableChats: chats(JANE_CHAT, AMIT_CHAT, GROUP_CHAT),
    });

    expect(queries).toEqual([
      {
        statement: RESTORE_LIVE_MESSAGES,
        parameters: [
          PROJECT_A.toString(),
          [cut(JANE_CHAT)],
          [JANE_CHAT],
          WorkspaceType.MicrosoftTeams,
        ],
      },
    ]);
  });

  test("the Notification Logs are left as they were: no statement reads the project's logs", async () => {
    await MicrosoftTeamsCutChatIds.restoreKeptMessages({
      projectId: PROJECT_A,
      chatId: JANE_CHAT,
      availableChats: chats(JANE_CHAT),
    });

    expect(
      queries.filter((query: RecordedQuery): boolean => {
        return query.statement.indexOf("WorkspaceNotificationLog") !== -1;
      }),
    ).toEqual([]);
  });

  test.each([
    ["a group chat", GROUP_CHAT],
    ["a meeting chat", MEETING_CHAT],
    ["an id of exactly 100 characters", `a:1${"h".repeat(97)}`],
  ])("%s was never cut: nothing runs", async (_label: string, id: string) => {
    await MicrosoftTeamsCutChatIds.restoreKeptMessages({
      projectId: PROJECT_A,
      chatId: id,
      availableChats: chats(id),
    });

    expect(queries).toEqual([]);
  });

  test("a chat longer than a column keeps whole: nothing runs", async () => {
    const tooLong: string = `a:1${"x".repeat(WORKSPACE_STORED_ID_MAX_LENGTH)}`;

    await MicrosoftTeamsCutChatIds.restoreKeptMessages({
      projectId: PROJECT_A,
      chatId: tooLong,
      availableChats: chats(tooLong),
    });

    expect(queries).toEqual([]);
  });

  test("REGRESSION #9330: another listed chat with the same first 100 characters - a place kept cut could be either's: nothing runs", async () => {
    await MicrosoftTeamsCutChatIds.restoreKeptMessages({
      projectId: PROJECT_A,
      chatId: JANE_CHAT,
      availableChats: chats(JANE_CHAT, JANE_CHAT_TWIN),
    });

    expect(queries).toEqual([]);
  });

  test("the other chat counts when it is listed under a key that is not its id", async () => {
    await MicrosoftTeamsCutChatIds.restoreKeptMessages({
      projectId: PROJECT_A,
      chatId: JANE_CHAT,
      availableChats: {
        [JANE_CHAT]: chat(JANE_CHAT),
        "legacy-key": chat(JANE_CHAT_TWIN),
      },
    });

    expect(queries).toEqual([]);
  });

  test("a chat the list does not hold yet is read as one of it", async () => {
    await MicrosoftTeamsCutChatIds.restoreKeptMessages({
      projectId: PROJECT_A,
      chatId: JANE_CHAT,
      availableChats: undefined,
    });

    expect(restoreQueries()).toHaveLength(1);
  });

  test("says what it put back when it changed something, and nothing when it changed nothing", async () => {
    answer = [[], 2];

    await MicrosoftTeamsCutChatIds.restoreKeptMessages({
      projectId: PROJECT_A,
      chatId: JANE_CHAT,
      availableChats: chats(JANE_CHAT),
    });

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      `Put back the whole id of a Microsoft Teams chat newly listed in project ${PROJECT_A.toString()} in 2 message(s) OneUptime keeps up to date, kept cut to 100 characters before the upgrade.`,
    );

    answer = [[], 0];
    (logger.info as jest.Mock).mockClear();

    await MicrosoftTeamsCutChatIds.restoreKeptMessages({
      projectId: PROJECT_A,
      chatId: JANE_CHAT,
      availableChats: chats(JANE_CHAT),
    });

    expect(logger.info).not.toHaveBeenCalled();
  });

  test("a statement that fails is logged, and never thrown at the bot", async () => {
    failingProject = PROJECT_A.toString();

    await expect(
      MicrosoftTeamsCutChatIds.restoreKeptMessages({
        projectId: PROJECT_A,
        chatId: JANE_CHAT,
        availableChats: chats(JANE_CHAT),
      }),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      `Could not put back the whole id of a Microsoft Teams chat newly listed in project ${PROJECT_A.toString()} in the messages OneUptime keeps up to date: canceling statement due to lock timeout`,
    );
  });

  test("a database that cannot be reached is logged, and never thrown at the bot", async () => {
    jest
      .spyOn(WorkspaceLiveMessageService, "getRepository")
      .mockImplementation(() => {
        throw new Error("Database is not connected");
      });

    await expect(
      MicrosoftTeamsCutChatIds.restoreKeptMessages({
        projectId: PROJECT_A,
        chatId: JANE_CHAT,
        availableChats: chats(JANE_CHAT),
      }),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe("A chat newly listed by a project's connection", () => {
  test("REGRESSION #9330: the chat is saved, then its places kept cut are put back in that project", async () => {
    connect({ projectId: PROJECT_A, availableChats: chats(AMIT_CHAT) });

    await MicrosoftTeamsUtil.saveChatToProjectAuthTokens({
      tenantId: TENANT_ID,
      chat: chat(JANE_CHAT),
    });

    expect(listedBy(connections[0]!)).toEqual([AMIT_CHAT, JANE_CHAT].sort());
    expect(writes).toEqual([
      `save ${PROJECT_A.toString()}`,
      `restore ${PROJECT_A.toString()}`,
    ]);
    expect(restoreQueries()).toEqual([
      {
        statement: RESTORE_LIVE_MESSAGES,
        parameters: [
          PROJECT_A.toString(),
          [cut(JANE_CHAT)],
          [JANE_CHAT],
          WorkspaceType.MicrosoftTeams,
        ],
      },
    ]);
  });

  test("a connection with no chats listed yet lists it, and its places are put back", async () => {
    connect({ projectId: PROJECT_A });

    await MicrosoftTeamsUtil.saveChatToProjectAuthTokens({
      tenantId: TENANT_ID,
      chat: chat(JANE_CHAT),
    });

    expect(listedBy(connections[0]!)).toEqual([JANE_CHAT]);
    expect(restoreQueries()).toHaveLength(1);
  });

  test("REGRESSION #9330: a chat the connection already lists - a re-capture, a refresh - is saved, and nothing is put back", async () => {
    connect({ projectId: PROJECT_A, availableChats: chats(JANE_CHAT) });

    await MicrosoftTeamsUtil.saveChatToProjectAuthTokens({
      tenantId: TENANT_ID,
      chat: chat(JANE_CHAT, {
        name: "Jane Doe",
        memberAadObjectIds: [JANE_AAD],
      }),
    });

    expect(connections[0]!.miscData.availableChats?.[JANE_CHAT]?.name).toBe(
      "Jane Doe",
    );
    expect(writes).toEqual([`save ${PROJECT_A.toString()}`]);
    expect(queries).toEqual([]);
  });

  test("a tenant connected to two projects: only the project that did not list the chat has its places put back", async () => {
    connect({ projectId: PROJECT_A, availableChats: chats(JANE_CHAT) });
    connect({ projectId: PROJECT_B, availableChats: chats(AMIT_CHAT) });

    await MicrosoftTeamsUtil.saveChatToProjectAuthTokens({
      tenantId: TENANT_ID,
      chat: chat(JANE_CHAT),
    });

    expect(listedBy(connections[0]!)).toEqual([JANE_CHAT]);
    expect(listedBy(connections[1]!)).toEqual([AMIT_CHAT, JANE_CHAT].sort());
    expect(writes).toEqual([
      `save ${PROJECT_A.toString()}`,
      `save ${PROJECT_B.toString()}`,
      `restore ${PROJECT_B.toString()}`,
    ]);
    expect(restoreQueries()[0]!.parameters[0]).toBe(PROJECT_B.toString());
  });

  test("REGRESSION #9330: in a project whose connection lists another chat with the same first 100 characters, nothing is put back - in the other project it is", async () => {
    connect({ projectId: PROJECT_A, availableChats: chats(JANE_CHAT_TWIN) });
    connect({ projectId: PROJECT_B });

    await MicrosoftTeamsUtil.saveChatToProjectAuthTokens({
      tenantId: TENANT_ID,
      chat: chat(JANE_CHAT),
    });

    expect(listedBy(connections[0]!)).toEqual(
      [JANE_CHAT, JANE_CHAT_TWIN].sort(),
    );
    expect(
      restoreQueries().map((query: RecordedQuery): unknown => {
        return query.parameters[0];
      }),
    ).toEqual([PROJECT_B.toString()]);
  });

  test("another tenant's connection is neither saved to nor put back", async () => {
    connect({ projectId: PROJECT_A, tenantId: OTHER_TENANT_ID });

    await MicrosoftTeamsUtil.saveChatToProjectAuthTokens({
      tenantId: TENANT_ID,
      chat: chat(JANE_CHAT),
    });

    expect(listedBy(connections[0]!)).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("a connection with no project is saved to, and nothing is put back", async () => {
    connect({ projectId: undefined });

    await MicrosoftTeamsUtil.saveChatToProjectAuthTokens({
      tenantId: TENANT_ID,
      chat: chat(JANE_CHAT),
    });

    expect(listedBy(connections[0]!)).toEqual([JANE_CHAT]);
    expect(queries).toEqual([]);
  });

  test("a group chat newly listed was never cut: nothing is put back", async () => {
    connect({ projectId: PROJECT_A });

    await MicrosoftTeamsUtil.saveChatToProjectAuthTokens({
      tenantId: TENANT_ID,
      chat: chat(GROUP_CHAT),
    });

    expect(listedBy(connections[0]!)).toEqual([GROUP_CHAT]);
    expect(queries).toEqual([]);
  });

  test("a put back that fails costs the chat nothing, nor the tenant's other projects", async () => {
    connect({ projectId: PROJECT_A });
    connect({ projectId: PROJECT_B });
    failingProject = PROJECT_A.toString();

    await expect(
      MicrosoftTeamsUtil.saveChatToProjectAuthTokens({
        tenantId: TENANT_ID,
        chat: chat(JANE_CHAT),
      }),
    ).resolves.toBeUndefined();

    expect(listedBy(connections[0]!)).toEqual([JANE_CHAT]);
    expect(listedBy(connections[1]!)).toEqual([JANE_CHAT]);
    expect(writes).toEqual([
      `save ${PROJECT_A.toString()}`,
      `restore ${PROJECT_A.toString()}`,
      `save ${PROJECT_B.toString()}`,
      `restore ${PROJECT_B.toString()}`,
    ]);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe("Through the bot's activities", () => {
  test("REGRESSION #9330: the app added to Jane's personal chat again (installationUpdate) lists the chat and puts back its places", async () => {
    connect({ projectId: PROJECT_A, availableChats: chats(AMIT_CHAT) });

    await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
      activity: personalChatActivity(JANE_CHAT, { action: "add" }),
      turnContext: turnContext(),
    });

    const listed: MicrosoftTeamsChat | undefined =
      connections[0]!.miscData.availableChats?.[JANE_CHAT];

    expect(listed?.chatType).toBe("personal");
    expect(listed?.memberAadObjectIds).toEqual([JANE_AAD]);
    expect(restoreQueries()).toEqual([
      {
        statement: RESTORE_LIVE_MESSAGES,
        parameters: [
          PROJECT_A.toString(),
          [cut(JANE_CHAT)],
          [JANE_CHAT],
          WorkspaceType.MicrosoftTeams,
        ],
      },
    ]);
  });

  test("the bot added to the chat (conversationUpdate) does the same, and still welcomes", async () => {
    connect({ projectId: PROJECT_A });
    const welcome: SpyInstance<() => Promise<void>> = jest
      .spyOn(
        MicrosoftTeamsUtil as unknown as {
          sendWelcomeAdaptiveCard: () => Promise<void>;
        },
        "sendWelcomeAdaptiveCard",
      )
      .mockResolvedValue(undefined);

    await MicrosoftTeamsUtil.handleConversationUpdateActivity({
      activity: personalChatActivity(JANE_CHAT, {
        membersAdded: [{ id: BOT_ID }],
        membersRemoved: [],
      }),
      turnContext: turnContext(),
    });

    expect(listedBy(connections[0]!)).toEqual([JANE_CHAT]);
    expect(restoreQueries()).toHaveLength(1);
    expect(welcome).toHaveBeenCalledTimes(1);
  });

  test("the app removed from the chat and added again: the second add puts back what was kept meanwhile", async () => {
    connect({ projectId: PROJECT_A, availableChats: chats(JANE_CHAT) });

    await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
      activity: personalChatActivity(JANE_CHAT, { action: "remove" }),
      turnContext: turnContext(),
    });

    expect(listedBy(connections[0]!)).toEqual([]);
    expect(queries).toEqual([]);

    await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
      activity: personalChatActivity(JANE_CHAT, { action: "add" }),
      turnContext: turnContext(),
    });

    expect(listedBy(connections[0]!)).toEqual([JANE_CHAT]);
    expect(restoreQueries()).toHaveLength(1);
  });

  test("REGRESSION #9330: an install event for a chat already listed re-captures it, and puts nothing back", async () => {
    connect({
      projectId: PROJECT_A,
      availableChats: {
        [JANE_CHAT]: chat(JANE_CHAT, { memberAadObjectIds: [JANE_AAD] }),
      },
    });

    await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
      activity: personalChatActivity(JANE_CHAT, { action: "add" }),
      turnContext: turnContext(),
    });

    expect(writes).toEqual([`save ${PROJECT_A.toString()}`]);
    expect(queries).toEqual([]);
  });

  test("REGRESSION #9330: the first message in a chat no connection lists yet lists it and puts back its places", async () => {
    connect({ projectId: PROJECT_A });

    await captureFromMessage(
      personalChatActivity(JANE_CHAT, { type: "message", text: "help" }),
    );

    expect(listedBy(connections[0]!)).toEqual([JANE_CHAT]);
    expect(restoreQueries()).toHaveLength(1);
  });

  test("REGRESSION #9330: a message in a chat already captured, with a fresh service URL, reads once and writes nothing - not even the put back", async () => {
    connect({
      projectId: PROJECT_A,
      availableChats: {
        [JANE_CHAT]: chat(JANE_CHAT, { memberAadObjectIds: [JANE_AAD] }),
      },
    });

    await captureFromMessage(
      personalChatActivity(JANE_CHAT, { type: "message", text: "help" }),
    );

    expect(WorkspaceProjectAuthTokenService.findBy).toHaveBeenCalledTimes(1);
    expect(writes).toEqual([]);
    expect(TeamsInfo.getPagedMembers).not.toHaveBeenCalled();
  });

  test("a message that refreshes a listed chat (its service URL moved) saves it and puts nothing back", async () => {
    connect({
      projectId: PROJECT_A,
      availableChats: {
        [JANE_CHAT]: chat(JANE_CHAT, {
          memberAadObjectIds: [JANE_AAD],
          serviceUrl: "https://smba.trafficmanager.net/emea/",
        }),
      },
    });

    await captureFromMessage(
      personalChatActivity(JANE_CHAT, { type: "message", text: "help" }),
    );

    expect(
      connections[0]!.miscData.availableChats?.[JANE_CHAT]?.serviceUrl,
    ).toBe(SERVICE_URL);
    expect(writes).toEqual([`save ${PROJECT_A.toString()}`]);
    expect(queries).toEqual([]);
  });
});
