import RestoreCutMicrosoftTeamsChatIds, {
  ProjectChatsRow,
} from "../../../FeatureSet/Workers/DataMigrations/RestoreCutMicrosoftTeamsChatIds";
import WorkspaceLiveMessageService from "Common/Server/Services/WorkspaceLiveMessageService";
import logger from "Common/Server/Utils/Logger";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE MICROSOFT TEAMS CHAT IDS KEPT CUT TO 100 CHARACTERS, PUT BACK WHOLE
 * (issue #9284).
 *
 * Before the columns were widened, a page asked for in a Microsoft Teams
 * personal chat kept the chat cut to its first 100 characters - an id of no
 * chat - and every update of the page failed there with "This chat is not
 * connected to OneUptime". The logs of every message to such a chat kept
 * the cut id too. This data migration puts the whole id back, from the
 * chats each project's connection lists.
 *
 * Pinned here:
 *   1. it is registered once, before the slot AddAuditLogMcpClientColumns
 *      keeps last;
 *   2. a cut id is the first 100 characters of exactly one of the project's
 *      chats, and only one longer than 100 that a column now keeps whole; a
 *      prefix two chats share is left as it is;
 *   3. projects are kept apart - one project's chat never restores another
 *      project's rows - and a project's connections are read together;
 *   4. it reads the Microsoft Teams connections that list chats, and writes
 *      one statement per project and table, scoped to the project and to
 *      Microsoft Teams, matching the cut id exactly;
 *   5. a read that fails fails the migration (it is tried again); a write
 *      that fails is logged and costs the other projects nothing;
 *   6. rollback changes nothing.
 */

// Personal chats' ids as the Bot Framework gives them: 131 characters.
const AMIT_CHAT: string =
  "a:1BfcDQQeKz2oG1CPSFyD5ZD1flTYm2IoCY23DqeeVgq6wyCCFf9P43FAqqDYNLI-pephf2ltim4CcrRj_ti04mQkhsHSJDCY_Wsu7XBF4qh8qmhl2nGt9cSEa704tfJxn";
const JANE_CHAT: string =
  "a:1ko1Q0eJNq3zKYs_oT83Pn8aVFgonj5G1wK8itwnYL4qjtJVbPem6bQoOt9ky3GTE1cY_wt6HRBrS5bkp-bZ8XgAPV73h0dJjkkwvkko-LHWpnDd57IvAVFs1pJ2DULPc";

// A group chat and a meeting chat: never cut.
const GROUP_CHAT: string = "19:9f2b1c0a7e5d4c3b@thread.v2";
const MEETING_CHAT: string =
  "19:meeting_NjM1ZTRhYjMtYTU5ZS00OGRiLWI0NjctMzQ2NTVjNDM5ZTRm@thread.v2";

const PROJECT_A: string = "a0000000-0000-4000-8000-00000000000a";
const PROJECT_B: string = "b0000000-0000-4000-8000-00000000000b";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const NEW_MIGRATION_CALL: RegExp = /new ([A-Za-z0-9]+)\(\)/g;

function cut(chatId: string): string {
  return chatId.substring(0, 100);
}

function chat(id: string, name: string): Record<string, unknown> {
  return {
    id: id,
    name: name,
    chatType: id.startsWith("a:") ? "personal" : "groupChat",
    serviceUrl: "https://smba.trafficmanager.net/teams/",
  };
}

function chats(...ids: Array<string>): Record<string, unknown> {
  const listed: Record<string, unknown> = {};

  for (const id of ids) {
    listed[id] = chat(id, `Chat ${id.length}`);
  }

  return listed;
}

function registeredInOrder(): Array<string> {
  const source: string = fs.readFileSync(
    path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
    "utf8",
  );

  return Array.from(source.matchAll(NEW_MIGRATION_CALL)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

interface RecordedQuery {
  statement: string;
  parameters: Array<unknown>;
}

let queries: Array<RecordedQuery>;
let readAnswer: Array<ProjectChatsRow> | Error;
let failingTable: string | null;

beforeEach(() => {
  queries = [];
  readAnswer = [];
  failingTable = null;

  jest.spyOn(WorkspaceLiveMessageService, "getRepository").mockReturnValue({
    manager: {
      query: async (
        statement: string,
        parameters: Array<unknown>,
      ): Promise<unknown> => {
        queries.push({ statement: statement, parameters: parameters });

        if (statement.startsWith("SELECT")) {
          if (readAnswer instanceof Error) {
            throw readAnswer;
          }

          return readAnswer;
        }

        if (failingTable && statement.startsWith(`UPDATE "${failingTable}"`)) {
          throw new Error("canceling statement due to lock timeout");
        }

        return [];
      },
    },
  } as never);

  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("RestoreCutMicrosoftTeamsChatIds", () => {
  test("the fixtures are personal chat ids as long as the one in the report", () => {
    expect(AMIT_CHAT).toHaveLength(131);
    expect(JANE_CHAT).toHaveLength(131);
    expect(cut(AMIT_CHAT)).toHaveLength(100);
  });

  test("is registered once, before the last slot", () => {
    const registered: Array<string> = registeredInOrder();

    expect(
      registered.filter((name: string): boolean => {
        return name === "RestoreCutMicrosoftTeamsChatIds";
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered.indexOf("RestoreCutMicrosoftTeamsChatIds")).toBeLessThan(
      registered.length - 1,
    );
    expect(new RestoreCutMicrosoftTeamsChatIds().name).toBe(
      "RestoreCutMicrosoftTeamsChatIds",
    );
  });

  test("rollback changes nothing", async () => {
    await new RestoreCutMicrosoftTeamsChatIds().rollback();

    expect(queries).toEqual([]);
  });
});

describe("Which cut ids stand for which chat", () => {
  test("a personal chat's id stands for its first 100 characters", () => {
    expect(
      RestoreCutMicrosoftTeamsChatIds.getCutChatIds([AMIT_CHAT, JANE_CHAT]),
    ).toEqual(
      new Map([
        [cut(AMIT_CHAT), AMIT_CHAT],
        [cut(JANE_CHAT), JANE_CHAT],
      ]),
    );
  });

  test("a chat whose id was never cut - 100 characters or fewer - stands for nothing", () => {
    const exactly100: string = `a:1${"h".repeat(97)}`;

    expect(exactly100).toHaveLength(100);
    expect(
      RestoreCutMicrosoftTeamsChatIds.getCutChatIds([
        GROUP_CHAT,
        MEETING_CHAT,
        exactly100,
      ]).size,
    ).toBe(0);
  });

  test("a chat longer than a column keeps whole is not put back: it would not fit", () => {
    const tooLong: string = `a:1${"x".repeat(500)}`;

    expect(RestoreCutMicrosoftTeamsChatIds.getCutChatIds([tooLong]).size).toBe(
      0,
    );
  });

  test("a cut id two chats share says neither, and is left as it is", () => {
    const twin: string = `${cut(AMIT_CHAT)}-another-chat-that-starts-the-same-way`;

    expect(
      RestoreCutMicrosoftTeamsChatIds.getCutChatIds([
        AMIT_CHAT,
        twin,
        JANE_CHAT,
      ]),
    ).toEqual(new Map([[cut(JANE_CHAT), JANE_CHAT]]));
  });

  test("a connection's chats are read by their keys and by the id each holds", () => {
    expect(
      Array.from(
        RestoreCutMicrosoftTeamsChatIds.getChatIds({
          [AMIT_CHAT]: chat(AMIT_CHAT, "Amit"),
          "legacy-key": chat(JANE_CHAT, "Jane"),
        }),
      ).sort(),
    ).toEqual([AMIT_CHAT, JANE_CHAT, "legacy-key"].sort());
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a list", [AMIT_CHAT]],
    ["text", AMIT_CHAT],
  ])(
    "a connection whose chats are %s lists none",
    (_label: string, value: unknown) => {
      expect(RestoreCutMicrosoftTeamsChatIds.getChatIds(value).size).toBe(0);
    },
  );

  test("a chat that is not an object is read by its key alone", () => {
    expect(
      Array.from(
        RestoreCutMicrosoftTeamsChatIds.getChatIds({
          [AMIT_CHAT]: null,
          [JANE_CHAT]: "Jane",
        }),
      ).sort(),
    ).toEqual([AMIT_CHAT, JANE_CHAT].sort());
  });
});

describe("Project by project", () => {
  test("each project's cut ids come from its own chats only", () => {
    const byProject: Map<
      string,
      Map<string, string>
    > = RestoreCutMicrosoftTeamsChatIds.getCutChatIdsByProject([
      { projectId: PROJECT_A, availableChats: chats(AMIT_CHAT, GROUP_CHAT) },
      { projectId: PROJECT_B, availableChats: chats(JANE_CHAT) },
    ]);

    expect(byProject).toEqual(
      new Map([
        [PROJECT_A, new Map([[cut(AMIT_CHAT), AMIT_CHAT]])],
        [PROJECT_B, new Map([[cut(JANE_CHAT), JANE_CHAT]])],
      ]),
    );
  });

  test("a project's connections are read together: a prefix two of them share is left out", () => {
    const twin: string = `${cut(AMIT_CHAT)}-another-chat-that-starts-the-same-way`;

    const byProject: Map<
      string,
      Map<string, string>
    > = RestoreCutMicrosoftTeamsChatIds.getCutChatIdsByProject([
      { projectId: PROJECT_A, availableChats: chats(AMIT_CHAT) },
      { projectId: PROJECT_A, availableChats: chats(twin, JANE_CHAT) },
    ]);

    expect(byProject).toEqual(
      new Map([[PROJECT_A, new Map([[cut(JANE_CHAT), JANE_CHAT]])]]),
    );
  });

  test("the same chat listed by two connections of a project is one chat", () => {
    const byProject: Map<
      string,
      Map<string, string>
    > = RestoreCutMicrosoftTeamsChatIds.getCutChatIdsByProject([
      { projectId: PROJECT_A, availableChats: chats(AMIT_CHAT) },
      { projectId: PROJECT_A, availableChats: chats(AMIT_CHAT) },
    ]);

    expect(byProject.get(PROJECT_A)).toEqual(
      new Map([[cut(AMIT_CHAT), AMIT_CHAT]]),
    );
  });

  test("a project with nothing to put back, and a row with no project, are left out", () => {
    expect(
      RestoreCutMicrosoftTeamsChatIds.getCutChatIdsByProject([
        { projectId: PROJECT_A, availableChats: chats(GROUP_CHAT) },
        { projectId: null, availableChats: chats(AMIT_CHAT) },
        { projectId: "", availableChats: chats(JANE_CHAT) },
      ]).size,
    ).toBe(0);
  });
});

describe("What it reads and writes", () => {
  test("reads every Microsoft Teams connection that lists chats", async () => {
    await new RestoreCutMicrosoftTeamsChatIds().migrate();

    expect(queries).toEqual([
      {
        statement: RestoreCutMicrosoftTeamsChatIds.READ_CHATS,
        parameters: [WorkspaceType.MicrosoftTeams],
      },
    ]);
    expect(RestoreCutMicrosoftTeamsChatIds.READ_CHATS).toBe(
      `SELECT "projectId", "miscData"->'availableChats' AS "availableChats" FROM "WorkspaceProjectAuthToken" WHERE "workspaceType" = $1 AND jsonb_typeof("miscData"->'availableChats') = 'object'`,
    );
  });

  test("REGRESSION #9284: puts each project's chats back whole, in the kept messages and in the logs - one statement per project and table", async () => {
    readAnswer = [
      { projectId: PROJECT_A, availableChats: chats(AMIT_CHAT, GROUP_CHAT) },
      { projectId: PROJECT_B, availableChats: chats(JANE_CHAT) },
    ];

    await new RestoreCutMicrosoftTeamsChatIds().migrate();

    expect(queries.slice(1)).toEqual([
      {
        statement: RestoreCutMicrosoftTeamsChatIds.getRestoreStatement(
          "WorkspaceLiveMessage",
        ),
        parameters: [
          PROJECT_A,
          [cut(AMIT_CHAT)],
          [AMIT_CHAT],
          WorkspaceType.MicrosoftTeams,
        ],
      },
      {
        statement: RestoreCutMicrosoftTeamsChatIds.getRestoreStatement(
          "WorkspaceNotificationLog",
        ),
        parameters: [
          PROJECT_A,
          [cut(AMIT_CHAT)],
          [AMIT_CHAT],
          WorkspaceType.MicrosoftTeams,
        ],
      },
      {
        statement: RestoreCutMicrosoftTeamsChatIds.getRestoreStatement(
          "WorkspaceLiveMessage",
        ),
        parameters: [
          PROJECT_B,
          [cut(JANE_CHAT)],
          [JANE_CHAT],
          WorkspaceType.MicrosoftTeams,
        ],
      },
      {
        statement: RestoreCutMicrosoftTeamsChatIds.getRestoreStatement(
          "WorkspaceNotificationLog",
        ),
        parameters: [
          PROJECT_B,
          [cut(JANE_CHAT)],
          [JANE_CHAT],
          WorkspaceType.MicrosoftTeams,
        ],
      },
    ]);
  });

  test("each statement is scoped to its project and to Microsoft Teams, and matches a cut id exactly", () => {
    for (const table of RestoreCutMicrosoftTeamsChatIds.TABLES) {
      expect(RestoreCutMicrosoftTeamsChatIds.getRestoreStatement(table)).toBe(
        `UPDATE "${table}" AS "row" SET "channelId" = "chat"."id" FROM unnest($2::text[], $3::text[]) AS "chat"("cutId", "id") WHERE "row"."projectId" = $1 AND "row"."workspaceType" = $4 AND "row"."channelId" = "chat"."cutId"`,
      );
    }

    expect(RestoreCutMicrosoftTeamsChatIds.TABLES).toEqual([
      "WorkspaceLiveMessage",
      "WorkspaceNotificationLog",
    ]);
  });

  test("nothing to put back writes nothing", async () => {
    readAnswer = [
      { projectId: PROJECT_A, availableChats: chats(GROUP_CHAT, MEETING_CHAT) },
    ];

    await new RestoreCutMicrosoftTeamsChatIds().migrate();

    expect(queries).toHaveLength(1);
  });

  test("a read that fails fails the migration, so it is tried again", async () => {
    readAnswer = new Error("Connection terminated unexpectedly");

    await expect(
      new RestoreCutMicrosoftTeamsChatIds().migrate(),
    ).rejects.toThrow("Connection terminated unexpectedly");
  });

  test("a write that fails is logged, and costs the other table and the other projects nothing", async () => {
    readAnswer = [
      { projectId: PROJECT_A, availableChats: chats(AMIT_CHAT) },
      { projectId: PROJECT_B, availableChats: chats(JANE_CHAT) },
    ];
    failingTable = "WorkspaceNotificationLog";

    await expect(
      new RestoreCutMicrosoftTeamsChatIds().migrate(),
    ).resolves.toBeUndefined();

    expect(
      queries.slice(1).map((query: RecordedQuery): string => {
        return `${String(query.parameters[0])} ${query.statement.split(" ")[1]}`;
      }),
    ).toEqual([
      `${PROJECT_A} "WorkspaceLiveMessage"`,
      `${PROJECT_A} "WorkspaceNotificationLog"`,
      `${PROJECT_B} "WorkspaceLiveMessage"`,
      `${PROJECT_B} "WorkspaceNotificationLog"`,
    ]);
    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      `RestoreCutMicrosoftTeamsChatIds: could not put back the Microsoft Teams chat ids of project ${PROJECT_A} in WorkspaceNotificationLog: canceling statement due to lock timeout`,
    );
  });

  test("a second run, once every id is whole, finds the same chats and changes nothing more", async () => {
    readAnswer = [{ projectId: PROJECT_A, availableChats: chats(AMIT_CHAT) }];

    await new RestoreCutMicrosoftTeamsChatIds().migrate();
    const first: Array<RecordedQuery> = queries;

    queries = [];
    await new RestoreCutMicrosoftTeamsChatIds().migrate();

    // The same statements: each matches only an id still cut, so none twice.
    expect(queries).toEqual(first);
  });
});
