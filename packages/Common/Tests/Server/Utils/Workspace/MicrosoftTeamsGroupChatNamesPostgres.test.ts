jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
    MicrosoftTeamsAppClientSecret: "test-secret",
    MicrosoftTeamsAppTenantId: "test-tenant",
  };
});

jest.mock(
  "../../../../Server/Infrastructure/Postgres/DataSourceOptions",
  () => {
    return {};
  },
);

/*
 * The repo-wide botbuilder manual mock does not expose TeamsInfo or
 * MessageFactory.attachment, which chat capture and the welcome card use.
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

import Entities from "../../../../Models/DatabaseModels/Index";
import {
  MicrosoftTeamsChat,
  MicrosoftTeamsMiscData,
} from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import MicrosoftTeamsUtil, {
  MicrosoftTeamsChatNameRefreshResult,
  MicrosoftTeamsChatNameUpdate,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import API, { APIRequestOptions } from "../../../../Utils/API";
import {
  TeamsInfo,
  type TeamsChannelAccount,
  type TeamsPagedMembersResult,
  type TurnContext,
} from "botbuilder";
import { DataSource, Logger } from "typeorm";

/*
 * Issue #4106 - Microsoft Teams group chats listed by their members instead
 * of their Teams name - against a migrated Postgres.
 *
 * MicrosoftTeamsGroupChatNames.test.ts pins the logic with every
 * WorkspaceProjectAuthToken read and write faked. What only a database can
 * show is what is actually stored in the miscData jsonb column:
 *
 * - that capture stores the chat's Teams name (topic), only the first three
 *   member names and the member count - on EVERY connected project of the
 *   tenant and on no other tenant;
 * - that a re-capture builds on the stored record: the connection date and a
 *   Teams name Graph will not (or cannot) read again are kept, and a roster
 *   that could not be read leaves the stored one - or the missing member
 *   count that makes the next message try again - as it was;
 * - that a Refresh Chats rename writes the name and Teams name alone, onto
 *   the record as it is now (a chat removed meanwhile is not resurrected, one
 *   re-captured meanwhile keeps its new record), with one write per row and
 *   one Graph token for every lookup;
 * - that a long Teams name cut where an emoji sits is stored at all: the cut
 *   used to leave half of the emoji, a lone UTF-16 surrogate, and Postgres
 *   refuses the whole jsonb write that carries one;
 * - that non-ASCII names round-trip character for character, and that the
 *   message backfill's staleness check reads what capture wrote.
 *
 * Opt in with RUN_POSTGRES_MICROSOFT_TEAMS_CHAT_TESTS=true against a Postgres
 * migrated to the current head - the Postgres Schema Drift workflow's
 * database right after its drift check, e.g. from packages/Common:
 *
 *   RUN_POSTGRES_MICROSOFT_TEAMS_CHAT_TESTS=true \
 *   MICROSOFT_TEAMS_CHAT_TEST_DATABASE_HOST=127.0.0.1 \
 *   MICROSOFT_TEAMS_CHAT_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/Utils/Workspace/MicrosoftTeamsGroupChatNamesPostgres.test.ts --forceExit
 *
 * Without the flag the suite is skipped, so the Common test job - whose
 * Postgres is not migrated - never runs it.
 *
 * The WorkspaceProjectAuthToken table's STRUCTURE is cloned (LIKE ...
 * INCLUDING ALL) into a uniquely named schema (search_path holds that schema
 * first) that is dropped afterwards; every row is synthetic.
 *
 * The production MicrosoftTeamsUtil and WorkspaceProjectAuthTokenService run
 * unchanged - getValidAccessToken included, which hands out the Graph app
 * token stored on the row. Only Microsoft is faked: Graph (API.get, and
 * API.post so a token refresh would be loud) and the Bot Framework
 * (TeamsInfo and the TurnContext). Every statement Postgres rejects is
 * recorded through the DataSource's logger and fails the test, even when a
 * caller catches it - chat capture swallows its own errors, so a refused
 * write would otherwise pass as "nothing stored".
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_MICROSOFT_TEAMS_CHAT_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLE: string = "WorkspaceProjectAuthToken";

const TENANT_ID: string = "6f1c2d3e-4b5a-4968-8778-a1b2c3d4e5f6";
const OTHER_TENANT_ID: string = "0a9b8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d";

const BOT_RECIPIENT_ID: string = "28:bot-recipient-id";
const SERVICE_URL: string = "https://smba.trafficmanager.net/amer/";
const MOVED_SERVICE_URL: string = "https://smba.trafficmanager.net/emea/";

// Captured before rosters (and names from Graph) were stored.
const LEGACY_GROUP_CHAT_ID: string =
  "19:1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6@thread.v2";
/*
 * Captured by the first release of the #4106 fix, which stored the whole
 * roster's names and no member count.
 */
const FIRST_RELEASE_GROUP_CHAT_ID: string =
  "19:7c6b5a4938271605f4e3d2c1b0a99887@thread.v2";
// Captured with its roster; listed by its members.
const ROSTER_GROUP_CHAT_ID: string =
  "19:9f8e7d6c5b4a43928170f1e2d3c4b5a6@thread.v2";
// Captured under its Teams name.
const NAMED_GROUP_CHAT_ID: string =
  "19:2b3c4d5e6f708192a3b4c5d6e7f80912@thread.v2";
// Also named; Graph keeps answering with the name already stored.
const QUIET_GROUP_CHAT_ID: string =
  "19:4d5e6f708192a3b4c5d6e7f809123a4b@thread.v2";
// A group chat in which Microsoft refuses to share the name.
const DENIED_GROUP_CHAT_ID: string =
  "19:0f1e2d3c4b5a49687f6e5d4c3b2a1908@thread.v2";
const PERSONAL_CHAT_ID: string = "a:1XyZpersonalChatIdOnlyTheBotFrameworkKnows";
// A chat the bot is added to during a test.
const NEW_GROUP_CHAT_ID: string =
  "19:5e4d3c2b1a0948f7e6d5c4b3a2918070@thread.v2";

// Six group chats, so Refresh Chats (five lookups at a time) runs two batches.
const SEEDED_GROUP_CHAT_IDS: Array<string> = [
  LEGACY_GROUP_CHAT_ID,
  FIRST_RELEASE_GROUP_CHAT_ID,
  ROSTER_GROUP_CHAT_ID,
  NAMED_GROUP_CHAT_ID,
  QUIET_GROUP_CHAT_ID,
  DENIED_GROUP_CHAT_ID,
];

// A UTF-16 surrogate half without its partner - what Postgres jsonb refuses.
const LONE_SURROGATE: RegExp =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

interface SeededRow {
  id: ObjectID;
  projectId: ObjectID;
  tenantId: string;
  authToken: string;
  miscData: MicrosoftTeamsMiscData;
}

type SqlRow = Record<string, unknown>;

type GraphAnswer = HTTPResponse<JSONObject> | HTTPErrorResponse;

type GraphAnswerFactory = () => Promise<GraphAnswer>;

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

/*
 * Records every statement Postgres rejected. PostgresQueryRunner hands each
 * failure to the logger before it throws, whatever the caller then does with
 * the error.
 */
class FailedQueryRecorder implements Logger {
  public failures: Array<string> = [];

  public logQuery(): void {
    return;
  }

  public logQueryError(error: string | Error, query: string): void {
    this.failures.push(
      `${error instanceof Error ? error.message : error} in: ${query}`,
    );
  }

  public logQuerySlow(): void {
    return;
  }

  public logSchemaBuild(): void {
    return;
  }

  public logMigration(): void {
    return;
  }

  public log(): void {
    return;
  }
}

function legacyGroupChat(): MicrosoftTeamsChat {
  return {
    id: LEGACY_GROUP_CHAT_ID,
    name: "Alice Example, Bob Example",
    chatType: "groupChat",
    serviceUrl: SERVICE_URL,
    addedAt: "2026-03-01T09:00:00.000Z",
  };
}

function firstReleaseGroupChat(): MicrosoftTeamsChat {
  return {
    id: FIRST_RELEASE_GROUP_CHAT_ID,
    name: "Uma Example, Victor Example, Wendy Example + 1 more",
    chatType: "groupChat",
    serviceUrl: SERVICE_URL,
    addedAt: "2026-08-15T09:00:00.000Z",
    memberAadObjectIds: ["aad-uma", "aad-victor", "aad-wendy", "aad-xavier"],
    memberNames: [
      "Uma Example",
      "Victor Example",
      "Wendy Example",
      "Xavier Example",
    ],
  };
}

function rosterGroupChat(
  overrides?: Partial<MicrosoftTeamsChat>,
): MicrosoftTeamsChat {
  return {
    id: ROSTER_GROUP_CHAT_ID,
    name: "Carol Example, Dan Example, Erin Example + 2 more",
    chatType: "groupChat",
    serviceUrl: SERVICE_URL,
    addedAt: "2026-09-01T09:00:00.000Z",
    memberAadObjectIds: [
      "aad-carol",
      "aad-dan",
      "aad-erin",
      "aad-ferdinand",
      "aad-gina",
    ],
    memberNames: ["Carol Example", "Dan Example", "Erin Example"],
    memberCount: 5,
    ...(overrides || {}),
  };
}

function namedGroupChat(): MicrosoftTeamsChat {
  return {
    id: NAMED_GROUP_CHAT_ID,
    name: "Release Train",
    topic: "Release Train",
    chatType: "groupChat",
    serviceUrl: SERVICE_URL,
    addedAt: "2026-09-04T09:00:00.000Z",
    memberAadObjectIds: ["aad-kim", "aad-lee"],
    memberNames: ["Kim Example", "Lee Example"],
    memberCount: 2,
  };
}

function quietGroupChat(): MicrosoftTeamsChat {
  return {
    id: QUIET_GROUP_CHAT_ID,
    name: "Status Updates",
    topic: "Status Updates",
    chatType: "groupChat",
    serviceUrl: SERVICE_URL,
    addedAt: "2026-09-05T09:00:00.000Z",
    memberAadObjectIds: ["aad-nina", "aad-omar"],
    memberNames: ["Nina Example", "Omar Example"],
    memberCount: 2,
  };
}

function deniedGroupChat(): MicrosoftTeamsChat {
  return {
    id: DENIED_GROUP_CHAT_ID,
    name: "Frank Example, Grace Example",
    chatType: "groupChat",
    serviceUrl: SERVICE_URL,
    addedAt: "2026-09-02T09:00:00.000Z",
    memberAadObjectIds: ["aad-frank", "aad-grace"],
    memberNames: ["Frank Example", "Grace Example"],
    memberCount: 2,
  };
}

function personalChat(): MicrosoftTeamsChat {
  return {
    id: PERSONAL_CHAT_ID,
    name: "Erin Example",
    chatType: "personal",
    serviceUrl: SERVICE_URL,
    addedAt: "2026-09-03T09:00:00.000Z",
    memberAadObjectIds: ["aad-erin"],
  };
}

function seedChats(): Record<string, MicrosoftTeamsChat> {
  return {
    [LEGACY_GROUP_CHAT_ID]: legacyGroupChat(),
    [FIRST_RELEASE_GROUP_CHAT_ID]: firstReleaseGroupChat(),
    [ROSTER_GROUP_CHAT_ID]: rosterGroupChat(),
    [NAMED_GROUP_CHAT_ID]: namedGroupChat(),
    [QUIET_GROUP_CHAT_ID]: quietGroupChat(),
    [DENIED_GROUP_CHAT_ID]: deniedGroupChat(),
    [PERSONAL_CHAT_ID]: personalChat(),
  };
}

// Everything in miscData besides the chats, which no chat write may touch.
function seedMiscData(data: {
  tenantId: string;
  teamName: string;
  availableChats: Record<string, MicrosoftTeamsChat>;
}): MicrosoftTeamsMiscData {
  return {
    tenantId: data.tenantId,
    teamId: "team-1",
    teamName: data.teamName,
    botId: "bot-1",
    adminConsentGranted: true,
    adminConsentGrantedAt: "2026-02-01T00:00:00.000Z",
    availableTeams: {
      "a1b2c3d4-0000-4000-8000-000000000001": {
        id: "a1b2c3d4-0000-4000-8000-000000000001",
        name: "Engineering",
      },
    },
    installedTeams: {
      "a1b2c3d4-0000-4000-8000-000000000001": {
        id: "a1b2c3d4-0000-4000-8000-000000000001",
        graphTeamId: "a1b2c3d4-0000-4000-8000-000000000001",
        teamsThreadId: "19:engineering@thread.tacv2",
        name: "Engineering",
        serviceUrl: SERVICE_URL,
      },
    },
    availableChats: data.availableChats,
  };
}

function withoutChats(miscData: MicrosoftTeamsMiscData): JSONObject {
  const rest: JSONObject = { ...(miscData as unknown as JSONObject) };
  delete rest["availableChats"];
  return rest;
}

function graphOk(data: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, data, {});
}

function graphError(statusCode: number, body: JSONObject): HTTPErrorResponse {
  return new HTTPErrorResponse(statusCode, body, {});
}

// Graph answers with the chat's name in Teams (null: the chat has none).
function namedInTeams(topic: string | null): GraphAnswerFactory {
  return async (): Promise<GraphAnswer> => {
    return graphOk({ topic: topic, chatType: "group" });
  };
}

// The chat has not granted OneUptime ChatSettings.Read.Chat.
function refused(): GraphAnswerFactory {
  return async (): Promise<GraphAnswer> => {
    return graphError(403, {
      error: {
        code: "Forbidden",
        message: "Missing role permissions on the request.",
      },
    });
  };
}

// Graph is having a bad moment.
function failing(): GraphAnswerFactory {
  return async (): Promise<GraphAnswer> => {
    return graphError(500, {
      error: { code: "InternalServerError", message: "Service down" },
    });
  };
}

function everySeededGroupChat(
  answer: GraphAnswerFactory,
): Record<string, GraphAnswerFactory> {
  const answers: Record<string, GraphAnswerFactory> = {};
  for (const chatId of SEEDED_GROUP_CHAT_IDS) {
    answers[chatId] = answer;
  }
  return answers;
}

/*
 * What Teams says about each seeded group chat in the refresh tests: two
 * chats have a name OneUptime does not show yet, one has no name (and is
 * already listed by its members), one's name cannot be read right now, one
 * is already up to date, and one refuses.
 */
function refreshAnswers(): Record<string, GraphAnswerFactory> {
  return {
    [LEGACY_GROUP_CHAT_ID]: namedInTeams("Payments War Room"),
    [FIRST_RELEASE_GROUP_CHAT_ID]: namedInTeams(null),
    [ROSTER_GROUP_CHAT_ID]: namedInTeams("  Platform On-Call  "),
    [NAMED_GROUP_CHAT_ID]: failing(),
    [QUIET_GROUP_CHAT_ID]: namedInTeams("Status Updates"),
    [DENIED_GROUP_CHAT_ID]: refused(),
  };
}

// The Graph request OneUptime makes for a chat: no $select, which would 400.
function graphChatUrl(chatId: string): string {
  return `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(chatId)}`;
}

function deferred(): Deferred {
  let resolve: () => void = () => {
    return;
  };
  const promise: Promise<void> = new Promise<void>((done: () => void) => {
    resolve = done;
  });
  return { promise: promise, resolve: resolve };
}

interface FakeTurnContext {
  turnContext: TurnContext;
  sendActivity: jest.Mock;
}

function buildTurnContext(): FakeTurnContext {
  const sendActivity: jest.Mock = jest.fn(async () => {
    return { id: "welcome-card" };
  });

  return {
    turnContext: {
      activity: {
        recipient: { id: BOT_RECIPIENT_ID },
        serviceUrl: SERVICE_URL,
        conversation: { id: "ctx-conversation-id" },
      },
      turnState: new Map<string, unknown>(),
      sendActivity: sendActivity,
    } as unknown as TurnContext,
    sendActivity: sendActivity,
  };
}

function member(
  id: string,
  name: string,
  aadObjectId?: string,
): Partial<TeamsChannelAccount> {
  return aadObjectId
    ? { id: id, name: name, aadObjectId: aadObjectId }
    : { id: id, name: name };
}

function mockRoster(members: Array<Partial<TeamsChannelAccount>>): void {
  (TeamsInfo.getPagedMembers as jest.Mock).mockResolvedValue({
    members: [
      member(BOT_RECIPIENT_ID, "OneUptime"),
      ...members,
    ] as Array<TeamsChannelAccount>,
    continuationToken: undefined,
  } as unknown as TeamsPagedMembersResult);
}

function mockRosterUnavailable(): void {
  (TeamsInfo.getPagedMembers as jest.Mock).mockRejectedValue(
    new Error("The bot is not part of the conversation roster."),
  );
}

function groupChatActivity(data: {
  chatId: string;
  tenantId: string;
  name?: string | undefined;
  botAdded?: boolean | undefined;
  action?: string | undefined;
  serviceUrl?: string | undefined;
}): JSONObject {
  const conversation: JSONObject = {
    conversationType: "groupChat",
    id: data.chatId,
    tenantId: data.tenantId,
  };

  if (data.name !== undefined) {
    conversation["name"] = data.name;
  }

  return {
    ...(data.botAdded ? { membersAdded: [{ id: BOT_RECIPIENT_ID }] } : {}),
    ...(data.action ? { action: data.action } : {}),
    conversation: conversation,
    channelData: { tenant: { id: data.tenantId } },
    serviceUrl: data.serviceUrl || SERVICE_URL,
  };
}

describePostgres(
  "Microsoft Teams group chat names (#4106) against a migrated Postgres",
  () => {
    const schema: string = `teams_chat_names_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const failedQueries: FailedQueryRecorder = new FailedQueryRecorder();

    let database: DataSource;

    // Two projects connected to the same tenant, and one to another tenant.
    let projectA: SeededRow;
    let projectB: SeededRow;
    let otherTenantProject: SeededRow;

    // Graph's answer per chat id; a chat left out is an unexpected call.
    let graphAnswers: Record<string, GraphAnswerFactory> = {};
    let graphRequests: Array<APIRequestOptions> = [];
    let tokenSpy: jest.SpyInstance;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["MICROSOFT_TEAMS_CHAT_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["MICROSOFT_TEAMS_CHAT_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["MICROSOFT_TEAMS_CHAT_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        logging: ["error"],
        logger: failedQueries,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();

      await database.query(`CREATE SCHEMA "${schema}"`);
      await database.query(
        `CREATE TABLE "${schema}"."${TABLE}" (LIKE public."${TABLE}" INCLUDING ALL)`,
      );

      const currentSchema: Array<{ current_schema: string }> =
        await database.query("SELECT current_schema()");
      expect(currentSchema[0]?.current_schema).toBe(schema);
    });

    beforeEach(async () => {
      failedQueries.failures = [];
      graphRequests = [];
      graphAnswers = {};

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      (TeamsInfo.getPagedMembers as jest.Mock).mockReset();
      (TeamsInfo.getMembers as jest.Mock).mockReset();

      jest
        .spyOn(API, "get")
        .mockImplementation(
          async (options: APIRequestOptions): Promise<GraphAnswer> => {
            graphRequests.push(options);
            const url: string = options.url.toString();
            for (const [chatId, answer] of Object.entries(graphAnswers)) {
              if (url === graphChatUrl(chatId)) {
                return answer();
              }
            }
            throw new Error(`Unexpected Graph call in test: ${url}`);
          },
        );

      // The stored app tokens are fresh; minting a new one would be a bug here.
      jest.spyOn(API, "post").mockImplementation(async () => {
        throw new Error("Unexpected token request in test");
      });

      // Counted, not faked: the real one reads the token off the row.
      tokenSpy = jest.spyOn(MicrosoftTeamsUtil, "getValidAccessToken");

      await database.query(`DELETE FROM "${schema}"."${TABLE}"`);

      projectA = await seedRow({
        tenantId: TENANT_ID,
        teamName: "Engineering (project A)",
        availableChats: seedChats(),
      });
      projectB = await seedRow({
        tenantId: TENANT_ID,
        teamName: "Engineering (project B)",
        availableChats: seedChats(),
      });
      // Holds chats under the SAME ids, so a tenant filter left off shows.
      otherTenantProject = await seedRow({
        tenantId: OTHER_TENANT_ID,
        teamName: "Someone else's tenant",
        availableChats: {
          [ROSTER_GROUP_CHAT_ID]: rosterGroupChat({
            name: "Another tenant's chat",
          }),
          [LEGACY_GROUP_CHAT_ID]: legacyGroupChat(),
          [NAMED_GROUP_CHAT_ID]: namedGroupChat(),
        },
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();

      // A failed statement fails the test, even if a caller swallowed it.
      expect(failedQueries.failures).toEqual([]);
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    async function seedRow(data: {
      tenantId: string;
      teamName: string;
      availableChats: Record<string, MicrosoftTeamsChat>;
    }): Promise<SeededRow> {
      const row: SeededRow = {
        id: ObjectID.generate(),
        projectId: ObjectID.generate(),
        tenantId: data.tenantId,
        authToken: `graph.${ObjectID.generate().toString()}.token`,
        miscData: seedMiscData(data),
      };

      await database.query(
        `INSERT INTO "${schema}"."${TABLE}"
           ("_id", "projectId", "authToken", "authTokenExpiresAt", "workspaceType",
            "workspaceProjectId", "miscData", "version")
         VALUES ($1, $2, $3, now() + interval '1 day', $4, $5, $6, 1)`,
        [
          row.id.toString(),
          row.projectId.toString(),
          row.authToken,
          WorkspaceType.MicrosoftTeams,
          row.tenantId,
          JSON.stringify(row.miscData),
        ],
      );

      return row;
    }

    // The row as Postgres holds it, not as any service returns it.
    async function storedRow(row: SeededRow): Promise<SqlRow> {
      const rows: Array<SqlRow> = await database.query(
        `SELECT "miscData", "version", "updatedAt" FROM "${schema}"."${TABLE}" WHERE "_id" = $1`,
        [row.id.toString()],
      );
      expect(rows).toHaveLength(1);
      return rows[0]!;
    }

    async function storedRows(): Promise<Array<SqlRow>> {
      return [await storedRow(projectA), await storedRow(projectB)];
    }

    async function storedMiscData(
      row: SeededRow,
    ): Promise<MicrosoftTeamsMiscData> {
      return (await storedRow(row))["miscData"] as MicrosoftTeamsMiscData;
    }

    async function storedChats(
      row: SeededRow,
    ): Promise<Record<string, MicrosoftTeamsChat>> {
      return (await storedMiscData(row)).availableChats || {};
    }

    async function storedChat(
      row: SeededRow,
      chatId: string,
    ): Promise<MicrosoftTeamsChat | undefined> {
      return (await storedChats(row))[chatId];
    }

    // Each tenant row's optimistic-lock version: one write bumps it by one.
    async function tenantRowVersions(): Promise<Array<number>> {
      return (await storedRows()).map((row: SqlRow) => {
        return Number(row["version"]);
      });
    }

    // Whether the stored chat record has the key at all, as jsonb sees it.
    async function storedChatHasKey(
      row: SeededRow,
      chatId: string,
      key: string,
    ): Promise<boolean> {
      const rows: Array<{ present: boolean }> = await database.query(
        `SELECT jsonb_exists("miscData"->'availableChats'->($1::text), $2::text) AS "present"
           FROM "${schema}"."${TABLE}" WHERE "_id" = $3`,
        [chatId, key, row.id.toString()],
      );
      return rows[0]!.present;
    }

    function isChatCapturedForTenant(data: {
      tenantId: string;
      chatId: string;
      serviceUrl?: string | undefined;
    }): Promise<boolean> {
      return (MicrosoftTeamsUtil as any).isChatCapturedForTenant(data);
    }

    function captureFromMessage(activity: JSONObject): Promise<void> {
      // What handleBotMessageActivity runs for every chat message.
      return (MicrosoftTeamsUtil as any).captureChatFromBotActivity({
        activity: activity,
        turnContext: buildTurnContext().turnContext,
        onlyIfMissingOrStale: true,
      });
    }

    function botAddedToChat(data: {
      chatId: string;
      name?: string | undefined;
    }): Promise<void> {
      return MicrosoftTeamsUtil.handleConversationUpdateActivity({
        activity: groupChatActivity({
          chatId: data.chatId,
          tenantId: TENANT_ID,
          name: data.name,
          botAdded: true,
        }),
        turnContext: buildTurnContext().turnContext,
      });
    }

    function graphRequestUrls(): Array<string> {
      return graphRequests
        .map((request: APIRequestOptions) => {
          return request.url.toString();
        })
        .sort();
    }

    async function expectOtherTenantUntouched(): Promise<void> {
      const row: SqlRow = await storedRow(otherTenantProject);
      expect(row["miscData"]).toEqual(otherTenantProject.miscData);
      expect(Number(row["version"])).toBe(1);
    }

    async function expectRestOfMiscDataKept(row: SeededRow): Promise<void> {
      expect(withoutChats(await storedMiscData(row))).toEqual(
        withoutChats(row.miscData),
      );
    }

    describe("capture (bot added / message backfill)", () => {
      test("bot added to a named group chat: every project of the tenant stores the Teams name, the first three member names and the member count", async () => {
        mockRoster([
          member("29:heidi", "Heidi Example", "aad-heidi"),
          member("29:ivan", "Ivan Example", "aad-ivan"),
          member("29:judy", "Judy Example", "aad-judy"),
          // A member Teams sent without a display name is not counted.
          member("29:blank", "  ", "aad-blank"),
          member("29:karl", "Karl Example", "aad-karl"),
        ]);
        graphAnswers = {
          [NEW_GROUP_CHAT_ID]: namedInTeams("  Incident Bridge  "),
        };

        const { turnContext, sendActivity }: FakeTurnContext =
          buildTurnContext();

        await MicrosoftTeamsUtil.handleConversationUpdateActivity({
          activity: groupChatActivity({
            chatId: NEW_GROUP_CHAT_ID,
            tenantId: TENANT_ID,
            botAdded: true,
          }),
          turnContext: turnContext,
        });

        // One Graph read, with the tenant's app token from one of its rows.
        expect(graphRequestUrls()).toEqual([graphChatUrl(NEW_GROUP_CHAT_ID)]);
        expect([
          `Bearer ${projectA.authToken}`,
          `Bearer ${projectB.authToken}`,
        ]).toContain(graphRequests[0]?.headers?.["Authorization"]);
        expect(tokenSpy).toHaveBeenCalledTimes(1);

        const storedA: MicrosoftTeamsChat | undefined = await storedChat(
          projectA,
          NEW_GROUP_CHAT_ID,
        );

        expect(storedA).toEqual({
          id: NEW_GROUP_CHAT_ID,
          name: "Incident Bridge",
          topic: "Incident Bridge",
          chatType: "groupChat",
          serviceUrl: SERVICE_URL,
          addedAt: expect.any(String),
          memberAadObjectIds: [
            "aad-heidi",
            "aad-ivan",
            "aad-judy",
            "aad-blank",
            "aad-karl",
          ],
          // Only what a chat named after its members shows; not the roster.
          memberNames: ["Heidi Example", "Ivan Example", "Judy Example"],
          memberCount: 4,
        });
        expect(Number.isNaN(Date.parse(storedA!.addedAt!))).toBe(false);

        for (const row of [projectA, projectB]) {
          expect(await storedChats(row)).toEqual({
            ...seedChats(),
            [NEW_GROUP_CHAT_ID]: storedA,
          });
          await expectRestOfMiscDataKept(row);
        }

        // As Postgres sees them: a three-name array and a numeric count.
        const shapes: Array<SqlRow> = await database.query(
          `SELECT jsonb_array_length("miscData"->'availableChats'->($1::text)->'memberNames') AS "names",
                  jsonb_typeof("miscData"->'availableChats'->($1::text)->'memberCount') AS "countType",
                  ("miscData"->'availableChats'->($1::text)->>'memberCount')::int AS "count"
             FROM "${schema}"."${TABLE}" WHERE "workspaceProjectId" = $2`,
          [NEW_GROUP_CHAT_ID, TENANT_ID],
        );
        expect(shapes).toEqual([
          { names: 3, countType: "number", count: 4 },
          { names: 3, countType: "number", count: 4 },
        ]);

        await expectOtherTenantUntouched();

        // The welcome card still goes out.
        expect(sendActivity).toHaveBeenCalledTimes(1);

        // Captured with its member count, so the backfill leaves it alone now.
        await expect(
          isChatCapturedForTenant({
            tenantId: TENANT_ID,
            chatId: NEW_GROUP_CHAT_ID,
            serviceUrl: SERVICE_URL,
          }),
        ).resolves.toBe(true);
      });

      test("a name on the activity is used as is, without asking Graph", async () => {
        mockRoster([member("29:heidi", "Heidi Example", "aad-heidi")]);

        await botAddedToChat({
          chatId: NEW_GROUP_CHAT_ID,
          name: "  Release Train  ",
        });

        expect(graphRequests).toEqual([]);
        expect(tokenSpy).not.toHaveBeenCalled();
        for (const row of [projectA, projectB]) {
          expect(await storedChat(row, NEW_GROUP_CHAT_ID)).toMatchObject({
            name: "Release Train",
            topic: "Release Train",
            memberNames: ["Heidi Example"],
            memberCount: 1,
          });
        }
      });

      test("bot added where Graph refuses the name: the chat is stored under its members, with no Teams name", async () => {
        mockRoster([
          member("29:heidi", "Heidi Example", "aad-heidi"),
          member("29:ivan", "Ivan Example", "aad-ivan"),
          member("29:judy", "Judy Example", "aad-judy"),
          member("29:karl", "Karl Example", "aad-karl"),
          member("29:lena", "Lena Example", "aad-lena"),
        ]);
        graphAnswers = { [NEW_GROUP_CHAT_ID]: refused() };

        await botAddedToChat({ chatId: NEW_GROUP_CHAT_ID });

        for (const row of [projectA, projectB]) {
          const chat: MicrosoftTeamsChat | undefined = await storedChat(
            row,
            NEW_GROUP_CHAT_ID,
          );
          expect(chat?.name).toBe(
            "Heidi Example, Ivan Example, Judy Example + 2 more",
          );
          expect(chat?.memberNames).toEqual([
            "Heidi Example",
            "Ivan Example",
            "Judy Example",
          ]);
          expect(chat?.memberCount).toBe(5);
          expect(await storedChatHasKey(row, NEW_GROUP_CHAT_ID, "topic")).toBe(
            false,
          );
        }
        await expectOtherTenantUntouched();
      });

      test("a re-capture keeps the connection date and the stored Teams name when Graph refuses (403) or fails (500)", async () => {
        // The bot is removed and added back; Graph now refuses the name.
        mockRoster([
          member("29:kim", "Kim Example", "aad-kim"),
          member("29:lee", "Lee Example", "aad-lee"),
          member("29:mia", "Mia Example", "aad-mia"),
        ]);
        graphAnswers = { [NAMED_GROUP_CHAT_ID]: refused() };

        await botAddedToChat({ chatId: NAMED_GROUP_CHAT_ID });

        const afterRefusal: MicrosoftTeamsChat = {
          ...namedGroupChat(),
          // The roster is new...
          memberAadObjectIds: ["aad-kim", "aad-lee", "aad-mia"],
          memberNames: ["Kim Example", "Lee Example", "Mia Example"],
          memberCount: 3,
          // ...the Teams name and the date it was first connected are not.
          name: "Release Train",
          topic: "Release Train",
          addedAt: "2026-09-04T09:00:00.000Z",
        };

        for (const row of [projectA, projectB]) {
          expect(await storedChat(row, NAMED_GROUP_CHAT_ID)).toEqual(
            afterRefusal,
          );
        }

        /*
         * An app upgrade in the chat from another region, while neither the
         * roster nor Graph can be read: only the service URL is news.
         */
        mockRosterUnavailable();
        graphAnswers = { [NAMED_GROUP_CHAT_ID]: failing() };

        await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
          activity: groupChatActivity({
            chatId: NAMED_GROUP_CHAT_ID,
            tenantId: TENANT_ID,
            action: "add-upgrade",
            serviceUrl: MOVED_SERVICE_URL,
          }),
          turnContext: buildTurnContext().turnContext,
        });

        expect(graphRequests).toHaveLength(2);
        for (const row of [projectA, projectB]) {
          expect(await storedChat(row, NAMED_GROUP_CHAT_ID)).toEqual({
            ...afterRefusal,
            serviceUrl: MOVED_SERVICE_URL,
          });
          await expectRestOfMiscDataKept(row);
        }
        await expectOtherTenantUntouched();
      });

      test("a legacy group chat whose roster cannot be read and whose name Graph refuses keeps its name, and stays due for re-capture", async () => {
        mockRosterUnavailable();
        graphAnswers = { [LEGACY_GROUP_CHAT_ID]: refused() };

        const activity: JSONObject = groupChatActivity({
          chatId: LEGACY_GROUP_CHAT_ID,
          tenantId: TENANT_ID,
        });

        await captureFromMessage(activity);

        expect(TeamsInfo.getPagedMembers).toHaveBeenCalledTimes(1);
        expect(graphRequests).toHaveLength(1);

        for (const row of [projectA, projectB]) {
          // Not "Group chat": nothing better was learned, so nothing is lost.
          expect(await storedChat(row, LEGACY_GROUP_CHAT_ID)).toEqual({
            ...legacyGroupChat(),
            memberAadObjectIds: [],
          });
          for (const key of ["memberCount", "memberNames", "topic"]) {
            expect(await storedChatHasKey(row, LEGACY_GROUP_CHAT_ID, key)).toBe(
              false,
            );
          }
        }
        await expectOtherTenantUntouched();

        // Still no member count, so the next message tries the roster again.
        await expect(
          isChatCapturedForTenant({
            tenantId: TENANT_ID,
            chatId: LEGACY_GROUP_CHAT_ID,
            serviceUrl: SERVICE_URL,
          }),
        ).resolves.toBe(false);

        await captureFromMessage(activity);

        expect(TeamsInfo.getPagedMembers).toHaveBeenCalledTimes(2);
      });

      test("the message backfill re-captures a legacy group chat once, under its Teams name", async () => {
        mockRoster([
          member("29:alice", "Alice Example", "aad-alice"),
          member("29:bob", "Bob Example", "aad-bob"),
        ]);
        graphAnswers = { [LEGACY_GROUP_CHAT_ID]: namedInTeams("Payments") };

        const activity: JSONObject = groupChatActivity({
          chatId: LEGACY_GROUP_CHAT_ID,
          tenantId: TENANT_ID,
        });

        await captureFromMessage(activity);

        for (const row of [projectA, projectB]) {
          expect(await storedChat(row, LEGACY_GROUP_CHAT_ID)).toEqual({
            id: LEGACY_GROUP_CHAT_ID,
            name: "Payments",
            topic: "Payments",
            chatType: "groupChat",
            serviceUrl: SERVICE_URL,
            // Hearing from the chat again is not when it was connected.
            addedAt: "2026-03-01T09:00:00.000Z",
            memberAadObjectIds: ["aad-alice", "aad-bob"],
            memberNames: ["Alice Example", "Bob Example"],
            memberCount: 2,
          });
          await expectRestOfMiscDataKept(row);
        }
        await expectOtherTenantUntouched();
        expect(TeamsInfo.getPagedMembers).toHaveBeenCalledTimes(1);
        expect(graphRequests).toHaveLength(1);

        // The next message finds it captured: no roster call, no Graph call.
        const before: Array<SqlRow> = await storedRows();

        await captureFromMessage(activity);

        expect(TeamsInfo.getPagedMembers).toHaveBeenCalledTimes(1);
        expect(graphRequests).toHaveLength(1);
        expect(await storedRows()).toEqual(before);
      });

      test("the message backfill re-captures a chat the first release stored, keeping only three member names", async () => {
        mockRoster([
          member("29:uma", "Uma Example", "aad-uma"),
          member("29:victor", "Victor Example", "aad-victor"),
          member("29:wendy", "Wendy Example", "aad-wendy"),
          member("29:xavier", "Xavier Example", "aad-xavier"),
        ]);
        graphAnswers = { [FIRST_RELEASE_GROUP_CHAT_ID]: namedInTeams(null) };

        await captureFromMessage(
          groupChatActivity({
            chatId: FIRST_RELEASE_GROUP_CHAT_ID,
            tenantId: TENANT_ID,
          }),
        );

        for (const row of [projectA, projectB]) {
          expect(await storedChat(row, FIRST_RELEASE_GROUP_CHAT_ID)).toEqual({
            ...firstReleaseGroupChat(),
            // The full roster is no longer kept where every Viewer can read it.
            memberNames: ["Uma Example", "Victor Example", "Wendy Example"],
            memberCount: 4,
          });
        }

        await expect(
          isChatCapturedForTenant({
            tenantId: TENANT_ID,
            chatId: FIRST_RELEASE_GROUP_CHAT_ID,
            serviceUrl: SERVICE_URL,
          }),
        ).resolves.toBe(true);
      });

      test("the message backfill leaves a group chat with a member count alone", async () => {
        const before: Array<SqlRow> = await storedRows();

        await captureFromMessage(
          groupChatActivity({
            chatId: ROSTER_GROUP_CHAT_ID,
            tenantId: TENANT_ID,
          }),
        );

        expect(TeamsInfo.getPagedMembers).not.toHaveBeenCalled();
        expect(graphRequests).toEqual([]);
        expect(await storedRows()).toEqual(before);
      });
    });

    describe("names Postgres must store as they are", () => {
      test("non-ASCII Teams and member names round-trip through jsonb character for character", async () => {
        const topic: string = "Équipe d'astreinte · 障害対応 🚨";
        // 28 UTF-16 units, 27 characters: the emoji is one character of two units.
        const topicCharacters: number = Array.from(topic).length;
        expect(topicCharacters).toBe(topic.length - 1);
        const memberNames: Array<string> = [
          "Zoë Ünïcode-Łukasz",
          "李雷",
          "Ольга Пример",
          "محمد مثال",
        ];

        mockRoster(
          memberNames.map((name: string, index: number) => {
            return member(`29:member-${index}`, name, `aad-member-${index}`);
          }),
        );
        graphAnswers = { [NEW_GROUP_CHAT_ID]: namedInTeams(topic) };

        await botAddedToChat({ chatId: NEW_GROUP_CHAT_ID });

        for (const row of [projectA, projectB]) {
          expect(await storedChat(row, NEW_GROUP_CHAT_ID)).toMatchObject({
            name: topic,
            topic: topic,
            memberNames: memberNames.slice(0, 3),
            memberCount: 4,
          });
        }

        /*
         * Compared inside Postgres, and counted in characters: text stored as
         * escapes or re-encoded bytes would differ in length.
         */
        const stored: Array<SqlRow> = await database.query(
          `SELECT "miscData"->'availableChats'->($1::text)->>'topic' = $2 AS "sameTopic",
                  char_length("miscData"->'availableChats'->($1::text)->>'topic') AS "topicLength",
                  "miscData"->'availableChats'->($1::text)->'memberNames' = $3::jsonb AS "sameMembers"
             FROM "${schema}"."${TABLE}" WHERE "workspaceProjectId" = $4`,
          [
            NEW_GROUP_CHAT_ID,
            topic,
            JSON.stringify(memberNames.slice(0, 3)),
            TENANT_ID,
          ],
        );
        expect(stored).toEqual([
          { sameTopic: true, topicLength: topicCharacters, sameMembers: true },
          { sameTopic: true, topicLength: topicCharacters, sameMembers: true },
        ]);
      });

      test("a long Teams name cut where an emoji sits is stored, on capture and on refresh, without half an emoji", async () => {
        // Characters 78 and 79 (0-based UTF-16 units) are the two halves of 🚨.
        const longTopic: string =
          "A".repeat(78) + "🚨" + " Payments incident bridge, EMEA and APAC";
        // 78 characters and the ellipsis: the emoji is dropped whole.
        const expectedName: string = "A".repeat(78) + "…";

        /*
         * The probe that makes this test mean something: a name cut by UTF-16
         * units alone ends in a lone high surrogate, and Postgres refuses the
         * write that carries it - the chat is not stored at all.
         */
        const naiveCut: string = `${longTopic.substring(0, 79)}…`;
        expect(LONE_SURROGATE.test(naiveCut)).toBe(true);

        await expect(
          MicrosoftTeamsUtil.saveChatToProjectAuthTokens({
            tenantId: TENANT_ID,
            chat: {
              id: NEW_GROUP_CHAT_ID,
              name: naiveCut,
              chatType: "groupChat",
              serviceUrl: SERVICE_URL,
              addedAt: "2026-09-28T10:00:00.000Z",
              memberAadObjectIds: [],
            },
          }),
        ).rejects.toMatchObject({
          detail: "Unicode low surrogate must follow a high surrogate.",
        });
        expect(failedQueries.failures).toHaveLength(1);
        expect(failedQueries.failures[0]).toContain(
          "invalid input syntax for type json",
        );
        failedQueries.failures = [];
        expect(await storedChat(projectA, NEW_GROUP_CHAT_ID)).toBeUndefined();

        // Capture: the bot is added to the chat with the long name.
        mockRoster([member("29:heidi", "Heidi Example", "aad-heidi")]);
        graphAnswers = { [NEW_GROUP_CHAT_ID]: namedInTeams(longTopic) };

        await botAddedToChat({ chatId: NEW_GROUP_CHAT_ID });

        for (const row of [projectA, projectB]) {
          const chat: MicrosoftTeamsChat | undefined = await storedChat(
            row,
            NEW_GROUP_CHAT_ID,
          );
          expect(chat?.name).toBe(expectedName);
          // The Teams name itself is kept whole, emoji included.
          expect(chat?.topic).toBe(longTopic);
          expect(LONE_SURROGATE.test(chat?.name || "")).toBe(false);
          expect(LONE_SURROGATE.test(chat?.topic || "")).toBe(false);
        }

        // Refresh: the chat is renamed in Teams to another long name.
        const renamedTopic: string = "Ω".repeat(78) + "🚨" + " renamed bridge";
        graphAnswers = {
          ...everySeededGroupChat(refused()),
          [NEW_GROUP_CHAT_ID]: namedInTeams(renamedTopic),
        };

        const result: MicrosoftTeamsChatNameRefreshResult =
          await MicrosoftTeamsUtil.refreshChatNamesForProject({
            projectId: projectA.projectId,
          });

        expect(result.chats[NEW_GROUP_CHAT_ID]?.name).toBe(
          "Ω".repeat(78) + "…",
        );

        const stored: Array<SqlRow> = await database.query(
          `SELECT "miscData"->'availableChats'->($1::text)->>'name' AS "name",
                  char_length("miscData"->'availableChats'->($1::text)->>'name') AS "nameLength",
                  "miscData"->'availableChats'->($1::text)->>'topic' AS "topic"
             FROM "${schema}"."${TABLE}" WHERE "workspaceProjectId" = $2`,
          [NEW_GROUP_CHAT_ID, TENANT_ID],
        );
        expect(stored).toEqual([
          {
            name: "Ω".repeat(78) + "…",
            nameLength: 79,
            topic: renamedTopic,
          },
          {
            name: "Ω".repeat(78) + "…",
            nameLength: 79,
            topic: renamedTopic,
          },
        ]);
      });
    });

    describe("isChatCapturedForTenant (the message backfill's check)", () => {
      test("reads the stored records: group chats without a member count are stale, the rest are not", async () => {
        for (const chatId of [
          LEGACY_GROUP_CHAT_ID,
          // Stored its names, but no count: re-captured once as well.
          FIRST_RELEASE_GROUP_CHAT_ID,
        ]) {
          await expect(
            isChatCapturedForTenant({
              tenantId: TENANT_ID,
              chatId: chatId,
              serviceUrl: SERVICE_URL,
            }),
          ).resolves.toBe(false);
        }

        for (const chatId of [
          ROSTER_GROUP_CHAT_ID,
          NAMED_GROUP_CHAT_ID,
          QUIET_GROUP_CHAT_ID,
          DENIED_GROUP_CHAT_ID,
          PERSONAL_CHAT_ID,
        ]) {
          await expect(
            isChatCapturedForTenant({
              tenantId: TENANT_ID,
              chatId: chatId,
              serviceUrl: SERVICE_URL,
            }),
          ).resolves.toBe(true);
        }

        // A moved serviceUrl is still stale.
        await expect(
          isChatCapturedForTenant({
            tenantId: TENANT_ID,
            chatId: ROSTER_GROUP_CHAT_ID,
            serviceUrl: MOVED_SERVICE_URL,
          }),
        ).resolves.toBe(false);

        // A tenant with no connected project has nothing to capture into.
        await expect(
          isChatCapturedForTenant({
            tenantId: "no-such-tenant",
            chatId: ROSTER_GROUP_CHAT_ID,
            serviceUrl: SERVICE_URL,
          }),
        ).resolves.toBe(true);
      });

      test("a member count of 0 is a roster that was read, not a missing one", async () => {
        // A chat whose members Teams sent without display names.
        await MicrosoftTeamsUtil.saveChatToProjectAuthTokens({
          tenantId: TENANT_ID,
          chat: rosterGroupChat({ name: "Group chat", memberNames: [] }),
        });
        await database.query(
          `UPDATE "${schema}"."${TABLE}"
              SET "miscData" = jsonb_set("miscData", ARRAY['availableChats', $1::text, 'memberCount'], '0'::jsonb)
            WHERE "workspaceProjectId" = $2`,
          [ROSTER_GROUP_CHAT_ID, TENANT_ID],
        );

        for (const row of [projectA, projectB]) {
          expect(
            (await storedChat(row, ROSTER_GROUP_CHAT_ID))?.memberCount,
          ).toBe(0);
        }

        await expect(
          isChatCapturedForTenant({
            tenantId: TENANT_ID,
            chatId: ROSTER_GROUP_CHAT_ID,
            serviceUrl: SERVICE_URL,
          }),
        ).resolves.toBe(true);
      });

      test("a chat missing from one project of the tenant is stale", async () => {
        await database.query(
          `UPDATE "${schema}"."${TABLE}"
              SET "miscData" = jsonb_set("miscData", '{availableChats}', ("miscData"->'availableChats') - $1::text)
            WHERE "_id" = $2`,
          [ROSTER_GROUP_CHAT_ID, projectB.id.toString()],
        );

        await expect(
          isChatCapturedForTenant({
            tenantId: TENANT_ID,
            chatId: ROSTER_GROUP_CHAT_ID,
            serviceUrl: SERVICE_URL,
          }),
        ).resolves.toBe(false);
      });
    });

    describe("refreshChatNamesForProject (Refresh Chats)", () => {
      test("renames on both projects of the tenant with the Teams name, reports refusals and failures by id, and reads the token once", async () => {
        graphAnswers = refreshAnswers();

        const result: MicrosoftTeamsChatNameRefreshResult =
          await MicrosoftTeamsUtil.refreshChatNamesForProject({
            projectId: projectA.projectId,
          });

        expect(result.permissionDeniedChatIds).toEqual([DENIED_GROUP_CHAT_ID]);
        expect(result.failedChatIds).toEqual([NAMED_GROUP_CHAT_ID]);

        /*
         * One Graph read per group chat, none for the personal chat - two
         * batches, one token: the one stored on the project's own row.
         */
        expect(graphRequestUrls()).toEqual(
          SEEDED_GROUP_CHAT_IDS.map(graphChatUrl).sort(),
        );
        for (const request of graphRequests) {
          expect(request.headers?.["Authorization"]).toBe(
            `Bearer ${projectA.authToken}`,
          );
        }
        expect(tokenSpy).toHaveBeenCalledTimes(1);

        const expected: Record<string, MicrosoftTeamsChat> = {
          ...seedChats(),
          [LEGACY_GROUP_CHAT_ID]: {
            ...legacyGroupChat(),
            name: "Payments War Room",
            topic: "Payments War Room",
          },
          [ROSTER_GROUP_CHAT_ID]: rosterGroupChat({
            name: "Platform On-Call",
            topic: "Platform On-Call",
          }),
        };

        // What the page is sent is what is stored.
        expect(result.chats).toEqual(expected);

        for (const row of [projectA, projectB]) {
          expect(await storedChats(row)).toEqual(expected);
          // A name-only write: the legacy record gains no roster.
          for (const key of ["memberCount", "memberNames"]) {
            expect(await storedChatHasKey(row, LEGACY_GROUP_CHAT_ID, key)).toBe(
              false,
            );
          }
          await expectRestOfMiscDataKept(row);

          await expect(
            MicrosoftTeamsUtil.getChatsForProject({
              projectId: row.projectId,
            }),
          ).resolves.toEqual(expected);
        }

        // Both renames in one write per row.
        expect(await tenantRowVersions()).toEqual([2, 2]);

        await expectOtherTenantUntouched();
      });

      test('a name removed in Teams falls back to the stored member names, or to "Group chat" when there are none', async () => {
        // A named chat whose members all came without display names.
        const namelessMembers: MicrosoftTeamsChat = {
          ...quietGroupChat(),
          memberNames: [],
          memberCount: 0,
        };
        await MicrosoftTeamsUtil.saveChatToProjectAuthTokens({
          tenantId: TENANT_ID,
          chat: namelessMembers,
        });

        graphAnswers = {
          ...everySeededGroupChat(namedInTeams(null)),
          [FIRST_RELEASE_GROUP_CHAT_ID]: refused(),
          [DENIED_GROUP_CHAT_ID]: refused(),
        };

        const result: MicrosoftTeamsChatNameRefreshResult =
          await MicrosoftTeamsUtil.refreshChatNamesForProject({
            projectId: projectB.projectId,
          });

        expect([...result.permissionDeniedChatIds].sort()).toEqual(
          [FIRST_RELEASE_GROUP_CHAT_ID, DENIED_GROUP_CHAT_ID].sort(),
        );
        expect(result.failedChatIds).toEqual([]);

        const namedWithoutTopic: MicrosoftTeamsChat = {
          ...namedGroupChat(),
          name: "Kim Example, Lee Example",
        };
        delete namedWithoutTopic.topic;

        const quietWithoutTopic: MicrosoftTeamsChat = {
          ...namelessMembers,
          name: "Group chat",
        };
        delete quietWithoutTopic.topic;

        for (const row of [projectA, projectB]) {
          expect(await storedChats(row)).toEqual({
            ...seedChats(),
            [NAMED_GROUP_CHAT_ID]: namedWithoutTopic,
            [QUIET_GROUP_CHAT_ID]: quietWithoutTopic,
            /*
             * Unchanged, and so not rewritten: the roster chat already shows
             * its first three members and the count of the rest, and the
             * legacy chat has no members to fall back to.
             */
            [ROSTER_GROUP_CHAT_ID]: rosterGroupChat(),
            [LEGACY_GROUP_CHAT_ID]: legacyGroupChat(),
          });
          for (const chatId of [NAMED_GROUP_CHAT_ID, QUIET_GROUP_CHAT_ID]) {
            expect(await storedChatHasKey(row, chatId, "topic")).toBe(false);
          }
        }

        await expectOtherTenantUntouched();
      });

      test("a chat removed while names were read is neither resurrected nor returned, and one re-captured meanwhile keeps its new record under its Teams name", async () => {
        const recaptured: MicrosoftTeamsChat = rosterGroupChat({
          name: "Carol Example, Dan Example, Erin Example + 3 more",
          serviceUrl: MOVED_SERVICE_URL,
          memberAadObjectIds: [
            "aad-carol",
            "aad-dan",
            "aad-erin",
            "aad-ferdinand",
            "aad-gina",
            "aad-oscar",
          ],
          memberCount: 6,
        });

        /*
         * Both happen while the lookups are out, one after the other in one
         * answer: they are read-modify-writes of the same rows, and this test
         * is about the rename that follows them, not about each other.
         */
        graphAnswers = {
          ...refreshAnswers(),
          [LEGACY_GROUP_CHAT_ID]: async (): Promise<GraphAnswer> => {
            // The bot is removed from the chat mid-refresh...
            await MicrosoftTeamsUtil.removeChatFromProjectAuthTokens({
              tenantId: TENANT_ID,
              chatId: LEGACY_GROUP_CHAT_ID,
            });
            // ...and someone joins another, which is captured again.
            await MicrosoftTeamsUtil.saveChatToProjectAuthTokens({
              tenantId: TENANT_ID,
              chat: recaptured,
            });
            return graphOk({ topic: "Payments War Room" });
          },
        };

        const result: MicrosoftTeamsChatNameRefreshResult =
          await MicrosoftTeamsUtil.refreshChatNamesForProject({
            projectId: projectA.projectId,
          });

        const expected: Record<string, MicrosoftTeamsChat> = seedChats();
        delete expected[LEGACY_GROUP_CHAT_ID];
        expected[ROSTER_GROUP_CHAT_ID] = {
          ...recaptured,
          name: "Platform On-Call",
          topic: "Platform On-Call",
        };

        expect(result.chats).toEqual(expected);
        expect(result.chats[LEGACY_GROUP_CHAT_ID]).toBeUndefined();

        for (const row of [projectA, projectB]) {
          expect(await storedChats(row)).toEqual(expected);
          await expectRestOfMiscDataKept(row);
        }

        // It holds chats under both ids.
        await expectOtherTenantUntouched();
      });

      test("two refreshes of one project at once share one pass over the chats and one write per row", async () => {
        const lookupStarted: Deferred = deferred();
        const releaseLookup: Deferred = deferred();

        graphAnswers = {
          ...refreshAnswers(),
          [LEGACY_GROUP_CHAT_ID]: async (): Promise<GraphAnswer> => {
            lookupStarted.resolve();
            await releaseLookup.promise;
            return graphOk({ topic: "Payments War Room" });
          },
        };

        const first: Promise<MicrosoftTeamsChatNameRefreshResult> =
          MicrosoftTeamsUtil.refreshChatNamesForProject({
            projectId: projectA.projectId,
          });

        // A second click while the first is still reading names.
        await lookupStarted.promise;
        const second: Promise<MicrosoftTeamsChatNameRefreshResult> =
          MicrosoftTeamsUtil.refreshChatNamesForProject({
            projectId: projectA.projectId,
          });

        releaseLookup.resolve();

        const results: Array<MicrosoftTeamsChatNameRefreshResult> =
          await Promise.all([first, second]);

        expect(results[1]).toEqual(results[0]);
        expect(results[0]?.chats[LEGACY_GROUP_CHAT_ID]?.name).toBe(
          "Payments War Room",
        );
        expect(graphRequests).toHaveLength(SEEDED_GROUP_CHAT_IDS.length);
        expect(tokenSpy).toHaveBeenCalledTimes(1);
        expect(await tenantRowVersions()).toEqual([2, 2]);

        // Once it has settled, the next click runs a refresh of its own.
        await MicrosoftTeamsUtil.refreshChatNamesForProject({
          projectId: projectA.projectId,
        });

        expect(graphRequests).toHaveLength(2 * SEEDED_GROUP_CHAT_IDS.length);
        expect(tokenSpy).toHaveBeenCalledTimes(2);
        // Nothing new to write.
        expect(await tenantRowVersions()).toEqual([2, 2]);
      });

      test("a project with no group chats reads no token, makes no Graph call and writes nothing", async () => {
        await database.query(
          `UPDATE "${schema}"."${TABLE}"
              SET "miscData" = jsonb_set("miscData", '{availableChats}', jsonb_build_object($1::text, "miscData"->'availableChats'->($1::text)))
            WHERE "workspaceProjectId" = $2`,
          [PERSONAL_CHAT_ID, TENANT_ID],
        );
        const before: SqlRow = await storedRow(projectA);

        const result: MicrosoftTeamsChatNameRefreshResult =
          await MicrosoftTeamsUtil.refreshChatNamesForProject({
            projectId: projectA.projectId,
          });

        expect(result).toEqual({
          chats: { [PERSONAL_CHAT_ID]: personalChat() },
          permissionDeniedChatIds: [],
          failedChatIds: [],
        });
        expect(graphRequests).toEqual([]);
        expect(tokenSpy).not.toHaveBeenCalled();
        expect(await storedRow(projectA)).toEqual(before);
      });
    });

    describe("renameChatsInProjectAuthTokens", () => {
      test("writes the name and Teams name onto chats that exist, drops a removed Teams name, and skips rows it would not change", async () => {
        const updates: Record<string, MicrosoftTeamsChatNameUpdate> = {
          [ROSTER_GROUP_CHAT_ID]: {
            name: "Platform On-Call",
            topic: "Platform On-Call",
          },
          // The chat's name was removed in Teams.
          [NAMED_GROUP_CHAT_ID]: { name: "Kim Example, Lee Example" },
          [NEW_GROUP_CHAT_ID]: { name: "Never stored", topic: "Never stored" },
        };

        await MicrosoftTeamsUtil.renameChatsInProjectAuthTokens({
          tenantId: TENANT_ID,
          chatNames: updates,
        });

        const namedWithoutTopic: MicrosoftTeamsChat = {
          ...namedGroupChat(),
          name: "Kim Example, Lee Example",
        };
        delete namedWithoutTopic.topic;

        for (const row of [projectA, projectB]) {
          const chats: Record<string, MicrosoftTeamsChat> =
            await storedChats(row);
          expect(chats).toEqual({
            ...seedChats(),
            [ROSTER_GROUP_CHAT_ID]: rosterGroupChat({
              name: "Platform On-Call",
              topic: "Platform On-Call",
            }),
            [NAMED_GROUP_CHAT_ID]: namedWithoutTopic,
          });
          expect(chats[NEW_GROUP_CHAT_ID]).toBeUndefined();
          expect(
            await storedChatHasKey(row, NAMED_GROUP_CHAT_ID, "topic"),
          ).toBe(false);
          await expectRestOfMiscDataKept(row);
        }
        expect(await tenantRowVersions()).toEqual([2, 2]);
        await expectOtherTenantUntouched();

        // Nothing left to change: no row is written again.
        const before: Array<SqlRow> = await storedRows();

        await MicrosoftTeamsUtil.renameChatsInProjectAuthTokens({
          tenantId: TENANT_ID,
          chatNames: updates,
        });

        expect(await storedRows()).toEqual(before);
      });
    });

    describe("removeChatFromProjectAuthTokens", () => {
      test("removes the chat from every row of the tenant and keeps the rest", async () => {
        await MicrosoftTeamsUtil.removeChatFromProjectAuthTokens({
          tenantId: TENANT_ID,
          chatId: ROSTER_GROUP_CHAT_ID,
        });

        const expected: Record<string, MicrosoftTeamsChat> = seedChats();
        delete expected[ROSTER_GROUP_CHAT_ID];

        for (const row of [projectA, projectB]) {
          expect(await storedChats(row)).toEqual(expected);
          await expectRestOfMiscDataKept(row);
        }

        await expectOtherTenantUntouched();
      });
    });
  },
);
