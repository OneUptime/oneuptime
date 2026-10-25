import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import http from "http";
import type { AddressInfo } from "net";

/*
 * #4768, IN MICROSOFT TEAMS, END TO END.
 *
 * In Slack, everybody who replied in the thread of one of OneUptime's
 * notifications was answered by OneUptime, every time: "Connect your Slack
 * account" for somebody not connected. Microsoft Teams delivers the bot
 * every message of the channels and group chats it is in too (the app asks
 * for ChannelMessage.Read.Group and ChatMessage.Read.Chat), so these hold
 * the bot to the same rule, through the REAL botbuilder stack as
 * MicrosoftTeamsCommandsEndToEnd does:
 *
 *   - people talking to each other - a post, a reply under a notification
 *     card, a message in a group chat, a mention of somebody else - get no
 *     answer, and the bot reads nothing for them;
 *   - an @mention, or a message in a personal chat, is answered;
 *   - somebody not connected who asks OneUptime AI is asked to connect once
 *     in a conversation - a channel's thread, a chat - not on every
 *     question there, while that card's Connect button works; a command is
 *     answered every time.
 *
 * Only the database seams, the AI and the cache (kept in memory) are stood
 * in for; the fake Bot Connector records every activity the bot sends.
 */

jest.mock("botbuilder", () => {
  const nodeModuleBuiltin: typeof import("module") =
    typeof process.getBuiltinModule === "function"
      ? process.getBuiltinModule("module")
      : Object.getPrototypeOf(jest.requireActual("module"));

  return nodeModuleBuiltin.createRequire(__filename)("botbuilder");
});

/*
 * The Bot Connector's mappers, from where that botbuilder loads them: what
 * MicrosoftTeamsAiAnswer lets keep an entity's properties is the model the
 * real serializer writes the answer's AI label with.
 */
jest.mock("botframework-connector/lib/connectorApi/models/mappers", () => {
  const nodeModuleBuiltin: typeof import("module") =
    typeof process.getBuiltinModule === "function"
      ? process.getBuiltinModule("module")
      : Object.getPrototypeOf(jest.requireActual("module"));

  return nodeModuleBuiltin.createRequire(__filename)(
    "botframework-connector/lib/connectorApi/models/mappers",
  );
});

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

jest.mock("../../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual("../../API/WorkspaceOAuthTestHelpers") as {
        createInMemoryGlobalCache: () => unknown;
      }
    ).createInMemoryGlobalCache(),
  };
});

import MicrosoftTeamsUtil, {
  MicrosoftTeamsTenantResolution,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsAccountNotLinkedException,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Auth";
import MicrosoftTeamsIncidentActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceConnectCompletion from "../../../../Server/Utils/Workspace/WorkspaceConnectCompletion";
import WorkspaceConnectRequest, {
  WorkspaceConnectRequestAgainKind,
  WorkspaceConnectRequestRecord,
} from "../../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import AIService from "../../../../Server/Services/AIService";
import ObservabilityAssistant from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import MicrosoftTeamsAiAnswer from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsAiAnswer";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { PROJECT_AI_CREDITS_USED_UP_MESSAGE } from "../../../../Utils/Project/ProjectBalance";
import logger from "../../../../Server/Utils/Logger";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  CONNECT_REQUEST_TOKEN_PATTERN,
  ConnectRequestOutcome,
} from "../../../../Types/Workspace/ConnectCallback";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../Server/Utils/Express";
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
} from "botbuilder";

// ---- A fake Bot Connector: records every activity the bot sends ----

const ACTIVITIES_PATH: RegExp =
  /^\/v3\/conversations\/([^/]+)\/activities(?:\/([^/]+))?$/;

interface ConnectorPost {
  conversationId: string;
  // The activity a reply answers, when it is a reply.
  replyToId: string | null;
  activity: JSONObject;
}

interface FakeBotConnector {
  serviceUrl: string;
  posts: Array<ConnectorPost>;
  // Activities changed in place (PUT): a placeholder becoming its answer.
  updates: Array<{
    conversationId: string;
    activityId: string;
    activity: JSONObject;
  }>;
  // Statuses the next posts are refused with, one each, before any is taken.
  refuseNext: Array<number>;
  // Statuses the next changes in place are refused with.
  refuseNextUpdates: Array<number>;
  close: () => Promise<void>;
}

async function startFakeBotConnector(): Promise<FakeBotConnector> {
  let messageNumber: number = 0;

  const fake: FakeBotConnector = {
    serviceUrl: "",
    posts: [],
    updates: [],
    refuseNext: [],
    refuseNextUpdates: [],
    close: async (): Promise<void> => {
      return undefined;
    },
  };

  const server: http.Server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      let bodyText: string = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => {
        bodyText += chunk;
      });
      req.on("end", () => {
        const path: string = (req.url || "/").split("?")[0] || "/";
        const match: RegExpExecArray | null = ACTIVITIES_PATH.exec(path);

        if (req.method === "POST" && match) {
          const refusal: number | undefined = fake.refuseNext.shift();

          if (refusal) {
            res.writeHead(refusal, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { code: "Forbidden" } }));
            return;
          }

          messageNumber++;
          fake.posts.push({
            conversationId: decodeURIComponent(match[1] || ""),
            replyToId: match[2] ? decodeURIComponent(match[2]) : null,
            activity: JSON.parse(bodyText || "{}") as JSONObject,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: `msg-${messageNumber}` }));
          return;
        }

        if (req.method === "PUT" && match && match[2]) {
          const refusal: number | undefined = fake.refuseNextUpdates.shift();

          if (refusal) {
            res.writeHead(refusal, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { code: "Forbidden" } }));
            return;
          }

          fake.updates.push({
            conversationId: decodeURIComponent(match[1] || ""),
            activityId: decodeURIComponent(match[2]),
            activity: JSON.parse(bodyText || "{}") as JSONObject,
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: decodeURIComponent(match[2]) }));
          return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "NotFound" } }));
      });
    },
  );

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  fake.serviceUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  fake.close = async (): Promise<void> => {
    server.closeAllConnections();
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  };

  return fake;
}

// ---- What Teams gets back for the activity it posted ----

class RecordingResponse {
  public statusCode: number | null = null;
  public body: unknown = undefined;
  public headersSent: boolean = false;

  public status(code: number): this {
    this.statusCode = code;
    return this;
  }

  public send(body?: unknown): this {
    this.body = body;
    this.headersSent = true;
    return this;
  }

  public json(body?: unknown): this {
    this.body = body;
    this.headersSent = true;
    return this;
  }

  public end(): this {
    this.headersSent = true;
    return this;
  }

  public header(): this {
    return this;
  }

  public setHeader(): this {
    return this;
  }
}

type CachedAdapterSlot = { cachedAdapter: CloudAdapter | null };

// ---- The organization, its channel, and who is talking ----

const TENANT_ID: string = "4768aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BOT: JSONObject = { id: "28:oneuptime-bot-app-id", name: "OneUptime" };
// Carol: her Microsoft Teams account is not connected to OneUptime.
const CAROL: JSONObject = {
  id: "29:1carol",
  name: "Carol Diaz",
  aadObjectId: "00000000-0000-4000-8000-000000004768",
};
const CAROL_MENTION: string = "<at>Carol Diaz</at>";
const BOB: JSONObject = {
  id: "29:1bob",
  name: "Bob Chen",
  aadObjectId: "00000000-0000-4000-8000-000000004769",
};
const OPS_CHANNEL: string = "19:ops-4768@thread.tacv2";
const TEAM: JSONObject = { id: "19:ops-team-4768@thread.tacv2", name: "Ops" };
// The post of an incident's notification card OneUptime made in #ops.
const NOTIFICATION_POST_ID: string = "1760000000001";
const GROUP_CHAT_ID: string = "19:on-call-4768@thread.v2";
const PERSONAL_CHAT_ID: string = "a:4768-carol-personal-chat";
const DASHBOARD_URL: string = "https://oneuptime.example.com/dashboard";
const ONEUPTIME_USER_ID: ObjectID = ObjectID.generate();
const ASK_PROMPT: string =
  "🔗 **Connect your Microsoft Teams account to ask OneUptime AI.** It takes one click. Then ask your question again.";
// The line under every answer from OneUptime AI (MicrosoftTeamsAiAnswer).
const AI_NOTICE: string =
  "_Written by OneUptime AI, which can make mistakes: check important details before you act on them. Use 👎 to report an answer that is wrong or inappropriate._";
const ANSWER: string = `Two monitors are down: **API** and **Checkout**.\n\n${AI_NOTICE}`;

/*
 * What makes an answer OneUptime AI's in Teams: Teams' "AI generated" label,
 * and its 👍 and 👎 buttons.
 */
function expectAiAnswerMetadata(activity: JSONObject): void {
  expect(activity["entities"]).toEqual([
    {
      type: "https://schema.org/Message",
      "@type": "Message",
      "@context": "https://schema.org",
      additionalType: ["AIGeneratedContent"],
    },
  ]);
  expect((activity["channelData"] as JSONObject)["feedbackLoop"]).toEqual({
    type: "default",
  });
}

let connector: FakeBotConnector;
let projectId: ObjectID;
let activityCounter: number = 0;
let loggedErrors: Array<string> = [];
let clockOffsetInMs: number = 0;
const realDateNow: () => number = Date.now.bind(Date);

function minutesPass(minutes: number): void {
  clockOffsetInMs += minutes * 60 * 1000;
}

function nextActivityId(): string {
  activityCounter++;
  return `1760000${String(activityCounter).padStart(6, "0")}`;
}

type Where =
  // A new post in #ops.
  | { in: "channel" }
  // A reply in the thread of a post in #ops.
  | { in: "thread"; postId: string }
  | { in: "groupChat" }
  | { in: "personal" };

/*
 * A message, as Teams posts it to the bot. `mentions` are who the message
 * mentions: the bot's mention starts the text, as Teams writes it.
 */
function message(data: {
  from: JSONObject;
  text: string;
  where: Where;
  mentions?: Array<JSONObject> | undefined;
}): JSONObject {
  const id: string = nextActivityId();
  const mentions: Array<JSONObject> = data.mentions || [];
  const mentionText: string = mentions
    .map((mentioned: JSONObject): string => {
      return `<at>${String(mentioned["name"])}</at>`;
    })
    .join(" ");

  const activity: JSONObject = {
    type: "message",
    id: id,
    timestamp: "2026-10-13T10:00:00.000Z",
    serviceUrl: connector.serviceUrl,
    channelId: "msteams",
    from: data.from,
    recipient: BOT,
    textFormat: "plain",
    locale: "en-US",
    text: mentionText ? `${mentionText} ${data.text}` : data.text,
    entities: [
      ...mentions.map((mentioned: JSONObject): JSONObject => {
        return {
          type: "mention",
          text: `<at>${String(mentioned["name"])}</at>`,
          mentioned: mentioned,
        };
      }),
      { type: "clientInfo", locale: "en-US", platform: "Web" },
    ],
  };

  switch (data.where.in) {
    case "channel":
    case "thread": {
      const rootId: string =
        data.where.in === "thread" ? data.where.postId : id;

      activity["conversation"] = {
        conversationType: "channel",
        tenantId: TENANT_ID,
        id: `${OPS_CHANNEL};messageid=${rootId}`,
        isGroup: true,
      };
      activity["channelData"] = {
        tenant: { id: TENANT_ID },
        team: TEAM,
        channel: { id: OPS_CHANNEL, name: "ops" },
      };

      if (data.where.in === "thread") {
        activity["replyToId"] = data.where.postId;
      }
      break;
    }
    case "groupChat":
      activity["conversation"] = {
        conversationType: "groupChat",
        tenantId: TENANT_ID,
        id: GROUP_CHAT_ID,
        isGroup: true,
      };
      activity["channelData"] = { tenant: { id: TENANT_ID } };
      break;
    case "personal":
      activity["conversation"] = {
        conversationType: "personal",
        tenantId: TENANT_ID,
        id: PERSONAL_CHAT_ID,
      };
      activity["channelData"] = { tenant: { id: TENANT_ID } };
      break;
  }

  return activity;
}

interface Delivery {
  httpStatus: number | null;
  posts: Array<ConnectorPost>;
}

async function deliver(activity: JSONObject): Promise<Delivery> {
  const first: number = connector.posts.length;
  const res: RecordingResponse = new RecordingResponse();

  await MicrosoftTeamsUtil.processBotActivity(
    {
      method: "POST",
      headers: {},
      body: JSON.parse(JSON.stringify(activity)),
    } as unknown as ExpressRequest,
    res as unknown as ExpressResponse,
  );

  return { httpStatus: res.statusCode, posts: connector.posts.slice(first) };
}

function cardOf(post: ConnectorPost | undefined): JSONObject {
  const attachment: JSONObject | undefined = (
    post?.activity["attachments"] as Array<JSONObject> | undefined
  )?.[0];

  expect(attachment?.["contentType"]).toBe(
    "application/vnd.microsoft.card.adaptive",
  );

  return attachment!["content"] as JSONObject;
}

function textBlocksOf(card: JSONObject): Array<string> {
  return ((card["body"] as Array<JSONObject> | undefined) || [])
    .filter((element: JSONObject): boolean => {
      return element["type"] === "TextBlock";
    })
    .map((element: JSONObject): string => {
      return String(element["text"]);
    });
}

/*
 * The Connect card for a question: in the conversation it was asked in,
 * mentioning Carol, with a Connect button that keeps where she asked. The
 * kept request is returned.
 */
async function expectAskPrompt(
  post: ConnectorPost | undefined,
  conversationId: string,
): Promise<WorkspaceConnectRequestRecord | null> {
  expect(post?.conversationId).toBe(conversationId);

  const card: JSONObject = cardOf(post);

  expect(textBlocksOf(card)).toEqual([`${CAROL_MENTION} ${ASK_PROMPT}`]);
  expect((card["msteams"] as JSONObject)["entities"]).toEqual([
    {
      type: "mention",
      text: CAROL_MENTION,
      mentioned: { id: CAROL["id"], name: CAROL["name"] },
    },
  ]);
  expect(post?.activity["summary"]).toBe(
    "Connect your Microsoft Teams account to ask OneUptime AI",
  );

  const button: JSONObject | undefined = (
    (card["actions"] as Array<JSONObject> | undefined) || []
  ).find((action: JSONObject): boolean => {
    return action["title"] === "Connect Microsoft Teams account";
  });
  const url: globalThis.URL = new globalThis.URL(String(button?.["url"]));
  const token: string | null = url.searchParams.get("connect");

  expect(`${url.origin}${url.pathname}`).toBe(
    `${DASHBOARD_URL}/${projectId.toString()}/user-settings/microsoft-teams-integration`,
  );
  expect(token).toMatch(CONNECT_REQUEST_TOKEN_PATTERN);

  const request: WorkspaceConnectRequestRecord | null =
    await WorkspaceConnectRequest.peek(token);

  /*
   * Where to answer once she is connected is kept only for a Bot Connector
   * of Microsoft's own (MicrosoftTeamsServiceUrl), which this fake one is not.
   */
  expect(request).toMatchObject({
    workspaceUserId: CAROL["aadObjectId"],
    purpose: "ask OneUptime AI",
    again: { kind: WorkspaceConnectRequestAgainKind.Question },
  });
  // Her settings page says to ask again: no button asked the question.
  expect(WorkspaceConnectCompletion.getAgainOutcome(request?.again)).toBe(
    ConnectRequestOutcome.AskAgain,
  );

  return request;
}

// ---- Lifecycle ----

let resolveTenant: ReturnType<typeof jest.spyOn>;
let lookUpAccount: ReturnType<typeof jest.spyOn>;
let askAssistant: ReturnType<typeof jest.spyOn>;

beforeAll(async () => {
  connector = await startFakeBotConnector();
});

afterAll(async () => {
  await connector.close();
});

beforeEach(() => {
  connector.posts.splice(0);
  connector.updates.splice(0);
  connector.refuseNextUpdates.splice(0);
  connector.refuseNext = [];
  projectId = ObjectID.generate();
  clockOffsetInMs = 0;
  (
    jest.requireMock("../../../../Server/Infrastructure/GlobalCache") as {
      default: { store: Map<string, unknown> };
    }
  ).default.store.clear();

  (MicrosoftTeamsUtil as unknown as CachedAdapterSlot).cachedAdapter =
    new CloudAdapter(new ConfigurationBotFrameworkAuthentication({}));

  jest.spyOn(Date, "now").mockImplementation((): number => {
    return realDateNow() + clockOffsetInMs;
  });

  resolveTenant = jest
    .spyOn(MicrosoftTeamsUtil, "resolveProjectByTenantId")
    .mockResolvedValue({
      projectAuth: {
        projectId: projectId,
      } as unknown as WorkspaceProjectAuthToken,
      isAmbiguous: false,
      candidateProjectIds: [projectId],
    } as MicrosoftTeamsTenantResolution);
  jest
    .spyOn(
      MicrosoftTeamsUtil as unknown as {
        captureChatFromBotActivity: () => Promise<void>;
      },
      "captureChatFromBotActivity",
    )
    .mockResolvedValue(undefined);
  jest
    .spyOn(MicrosoftTeamsUtil, "captureTeamFromBotActivity")
    .mockResolvedValue(undefined);

  // Carol's account is not connected; anybody else's is.
  lookUpAccount = jest
    .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
    .mockImplementation((async (data: { teamsUserId: string }) => {
      if (data.teamsUserId === CAROL["aadObjectId"]) {
        throw new MicrosoftTeamsAccountNotLinkedException("not linked");
      }

      return ONEUPTIME_USER_ID;
    }) as never);
  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockImplementation(async () => {
      return {
        userId: ONEUPTIME_USER_ID,
        tenantId: projectId,
      } as DatabaseCommonInteractionProps;
    });
  jest
    .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
    .mockResolvedValue(undefined);
  jest
    .spyOn(MicrosoftTeamsIncidentActions, "getNewIncidentFormChoices")
    .mockResolvedValue({
      severities: {
        choices: [{ title: "Critical", value: ObjectID.generate().toString() }],
        totalCount: 1,
      },
      monitors: { choices: [], totalCount: 0 },
      monitorStatuses: { choices: [], totalCount: 0 },
      labels: { choices: [], totalCount: 0 },
      onCallDutyPolicies: { choices: [], totalCount: 0 },
    });

  jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(true);
  jest.spyOn(AIService, "getReachedProjectDailyLimit").mockResolvedValue(null);
  jest.spyOn(AIService, "getAiBalanceBlocker").mockResolvedValue(null);
  askAssistant = jest
    .spyOn(ObservabilityAssistant, "answerQuestion")
    .mockResolvedValue({
      contentInMarkdown: "Two monitors are down: **API** and **Checkout**.",
      citations: [],
      totalTokens: 10,
      llmCallCount: 1,
      toolCallCount: 1,
    } as never);
  // What was said before, read from Microsoft Graph: nothing, here.
  jest
    .spyOn(
      MicrosoftTeamsUtil as unknown as {
        getConversationHistoryTurns: () => Promise<Array<JSONObject>>;
      },
      "getConversationHistoryTurns",
    )
    .mockResolvedValue([]);

  jest.spyOn(DatabaseConfig, "getDashboardUrl").mockImplementation(() => {
    return Promise.resolve(URL.fromString(DASHBOARD_URL));
  });

  loggedErrors = [];
  jest.spyOn(logger, "error").mockImplementation((line: unknown) => {
    loggedErrors.push(String(line));
  });
  jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  (MicrosoftTeamsUtil as unknown as CachedAdapterSlot).cachedAdapter = null;
  jest.restoreAllMocks();
});

// ---- Tests ----

describe("people talking to each other are not answered", () => {
  test.each([
    [
      "a new post in a channel",
      (): JSONObject => {
        return message({
          from: CAROL,
          text: "Is anybody looking at checkout?",
          where: { in: "channel" },
        });
      },
    ],
    [
      "a reply under OneUptime's incident card, from somebody not connected",
      (): JSONObject => {
        return message({
          from: CAROL,
          text: "Looking at it now",
          where: { in: "thread", postId: NOTIFICATION_POST_ID },
        });
      },
    ],
    [
      "a reply under OneUptime's incident card, from somebody connected",
      (): JSONObject => {
        return message({
          from: BOB,
          text: "Rolling back the 10:02 deploy",
          where: { in: "thread", postId: NOTIFICATION_POST_ID },
        });
      },
    ],
    [
      "a reply that mentions a colleague",
      (): JSONObject => {
        return message({
          from: CAROL,
          text: "can you take this one?",
          where: { in: "thread", postId: NOTIFICATION_POST_ID },
          mentions: [{ id: BOB["id"], name: BOB["name"] }],
        });
      },
    ],
    [
      "a message in a group chat",
      (): JSONObject => {
        return message({
          from: CAROL,
          text: "who is on call tonight?",
          where: { in: "groupChat" },
        });
      },
    ],
  ])(
    "%s: HTTP 200 and nothing else - no reply, nothing read, AI not asked",
    async (_name: string, build: () => JSONObject) => {
      for (let time: number = 0; time < 3; time++) {
        const delivery: Delivery = await deliver(build());

        expect(delivery.httpStatus).toBe(200);
        expect(delivery.posts).toEqual([]);
      }

      expect(resolveTenant).not.toHaveBeenCalled();
      expect(lookUpAccount).not.toHaveBeenCalled();
      expect(askAssistant).not.toHaveBeenCalled();
      expect(loggedErrors).toEqual([]);
    },
  );
});

describe("@mentions, and personal chats, are answered", () => {
  /*
   * A channel shows no typing, so a "Looking into it…" reply stands there
   * while the answer is written - and becomes the answer, in its place: the
   * thread keeps one message, not a placeholder above every answer.
   */
  test("an @mention under OneUptime's incident card, from somebody connected: AI answers in that thread, every time - in place of its placeholder", async () => {
    for (let time: number = 0; time < 2; time++) {
      const updatesBefore: number = connector.updates.length;

      const delivery: Delivery = await deliver(
        message({
          from: BOB,
          text: "what changed before this started?",
          where: { in: "thread", postId: NOTIFICATION_POST_ID },
          mentions: [BOT],
        }),
      );

      expect(delivery.httpStatus).toBe(200);
      expect(
        delivery.posts.map((post: ConnectorPost): string => {
          return `${post.conversationId}: ${String(post.activity["text"])}`;
        }),
      ).toEqual([
        `${OPS_CHANNEL};messageid=${NOTIFICATION_POST_ID}: Looking into it…`,
      ]);

      const updates: Array<{
        conversationId: string;
        activityId: string;
        activity: JSONObject;
      }> = connector.updates.slice(updatesBefore);

      expect(updates).toHaveLength(1);
      expect(updates[0]!.conversationId).toBe(
        `${OPS_CHANNEL};messageid=${NOTIFICATION_POST_ID}`,
      );
      expect(updates[0]!.activity["text"]).toBe(ANSWER);
      expectAiAnswerMetadata(updates[0]!.activity);
    }

    expect(askAssistant).toHaveBeenCalledTimes(2);
  });

  /*
   * A chat shows OneUptime typing while the answer is written; the typing
   * goes by itself, and the answer is a message of its own, which notifies.
   */
  test("a personal chat needs no mention: OneUptime types, then answers - no placeholder to stay behind", async () => {
    const delivery: Delivery = await deliver(
      message({
        from: BOB,
        text: "which monitors are down?",
        where: { in: "personal" },
      }),
    );

    expect(
      delivery.posts.map((post: ConnectorPost): unknown => {
        return [post.activity["type"], post.activity["text"]];
      }),
    ).toEqual([
      ["typing", undefined],
      ["message", ANSWER],
    ]);
    expectAiAnswerMetadata(delivery.posts[1]!.activity);
    expect(connector.updates).toEqual([]);
    expect(askAssistant).toHaveBeenCalledTimes(1);
  });

  test("Teams will not change the placeholder in place: the answer comes as a reply of its own", async () => {
    connector.refuseNextUpdates.push(403);

    const delivery: Delivery = await deliver(
      message({
        from: BOB,
        text: "what changed before this started?",
        where: { in: "thread", postId: NOTIFICATION_POST_ID },
        mentions: [BOT],
      }),
    );

    expect(
      delivery.posts.map((post: ConnectorPost): string => {
        return String(post.activity["text"]);
      }),
    ).toEqual(["Looking into it…", ANSWER]);
    // The placeholder is no answer of AI's; the reply in its place is.
    expect(delivery.posts[0]!.activity["entities"]).toBeUndefined();
    expectAiAnswerMetadata(delivery.posts[1]!.activity);
  });

  test("the answer could not be written: said in place of the placeholder", async () => {
    askAssistant.mockRejectedValue(new Error("the model timed out"));

    const delivery: Delivery = await deliver(
      message({
        from: BOB,
        text: "what changed before this started?",
        where: { in: "thread", postId: NOTIFICATION_POST_ID },
        mentions: [BOT],
      }),
    );

    expect(delivery.posts).toHaveLength(1);
    expect(connector.updates[0]!.activity["text"]).toBe(
      "Sorry, I ran into a problem answering that question. Please try again later.",
    );
    // No answer was written, so nothing is labelled AI's.
    expect(connector.updates[0]!.activity["entities"]).toBeUndefined();
    expect(connector.updates[0]!.activity["channelData"]).toBeUndefined();
  });

  /*
   * Microsoft's reviewers asked in a project they had just created, whose AI
   * credits - like every new project's - were used up: AIService refused
   * each call, and the bot said "Please try again later", which no retry
   * answers. Checked before the acknowledgement, as the AI switch and the
   * daily limits are: the refusal says who can add credits, and where.
   */
  test("the project's AI credits are used up: said so, with who can add them and where - no placeholder, and AI is not asked", async () => {
    jest
      .spyOn(AIService, "getAiBalanceBlocker")
      .mockResolvedValue(
        "This project's AI credit balance is used up and auto-recharge is off, so OneUptime AI cannot run.",
      );

    const delivery: Delivery = await deliver(
      message({
        from: BOB,
        text: "ask how many incidents are still in progress?",
        where: { in: "thread", postId: NOTIFICATION_POST_ID },
        mentions: [BOT],
      }),
    );

    expect(
      delivery.posts.map((post: ConnectorPost): string => {
        return String(post.activity["text"]);
      }),
    ).toEqual([
      `${PROJECT_AI_CREDITS_USED_UP_MESSAGE} Type **help** to see the other commands.`,
    ]);
    expect(connector.updates).toEqual([]);
    expect(askAssistant).not.toHaveBeenCalled();
  });

  test("the credits run out while the answer is written: the refusal, in place of the placeholder - not 'try again later'", async () => {
    askAssistant.mockRejectedValue(
      new BadDataException(PROJECT_AI_CREDITS_USED_UP_MESSAGE),
    );

    const delivery: Delivery = await deliver(
      message({
        from: BOB,
        text: "what changed before this started?",
        where: { in: "thread", postId: NOTIFICATION_POST_ID },
        mentions: [BOT],
      }),
    );

    expect(delivery.posts).toHaveLength(1);
    expect(connector.updates[0]!.activity["text"]).toBe(
      `${PROJECT_AI_CREDITS_USED_UP_MESSAGE} Type **help** to see the other commands.`,
    );
    // A setting somebody chose is no error in the log.
    expect(loggedErrors).toEqual([]);
  });

  /*
   * An answer ends with what it was read from. A source that gave one row
   * was written "(1 rows)".
   */
  test("the answer ends with its sources, each with its rows counted as the language counts them: 2 rows, 1 row", async () => {
    askAssistant.mockResolvedValue({
      contentInMarkdown: "Two monitors are down: **API** and **Checkout**.",
      citations: [
        {
          id: "C1",
          toolName: "query_monitors",
          label: "Monitor statuses",
          queryArguments: {},
          rowCount: 2,
        },
        {
          id: "C2",
          toolName: "query_deployments",
          label: "Deployments",
          queryArguments: {},
          rowCount: 1,
        },
      ],
      totalTokens: 10,
      llmCallCount: 1,
      toolCallCount: 2,
    } as never);

    const delivery: Delivery = await deliver(
      message({
        from: BOB,
        text: "which monitors are down?",
        where: { in: "personal" },
      }),
    );

    expect(
      delivery.posts
        .filter((post: ConnectorPost): boolean => {
          return post.activity["type"] !== "typing";
        })
        .map((post: ConnectorPost): string => {
          return String(post.activity["text"]);
        }),
    ).toEqual([
      `Two monitors are down: **API** and **Checkout**.\n\n**Sources**\n• Monitor statuses (2 rows)\n• Deployments (1 row)\n\n${AI_NOTICE}`,
    ]);
  });

  /*
   * 👍 or 👎 under an answer reaches the bot as an invoke: Teams needs its
   * 200, and shows its own thanks; nobody is answered in the conversation,
   * and nobody needs to be connected for it.
   */
  test("👍 or 👎 under an answer: Teams gets its 200, nothing is posted, and the report is handled", async () => {
    const handleFeedback: ReturnType<typeof jest.spyOn> = jest
      .spyOn(MicrosoftTeamsAiAnswer, "handleFeedback")
      .mockResolvedValue(undefined);

    const feedback: JSONObject = {
      type: "invoke",
      name: "message/submitAction",
      id: nextActivityId(),
      replyToId: "msg-1",
      timestamp: "2026-10-13T10:00:00.000Z",
      serviceUrl: connector.serviceUrl,
      channelId: "msteams",
      from: CAROL,
      recipient: BOT,
      conversation: {
        conversationType: "channel",
        tenantId: TENANT_ID,
        id: `${OPS_CHANNEL};messageid=${NOTIFICATION_POST_ID}`,
        isGroup: true,
      },
      channelData: { tenant: { id: TENANT_ID } },
      value: {
        actionName: "feedback",
        actionValue: {
          reaction: "dislike",
          feedback: JSON.stringify({ feedbackText: "Wrong monitor" }),
        },
      },
    };

    const delivery: Delivery = await deliver(feedback);

    expect(delivery.httpStatus).toBe(200);
    expect(delivery.posts).toEqual([]);
    expect(handleFeedback).toHaveBeenCalledTimes(1);
    expect(
      (handleFeedback.mock.calls[0]![0] as { activity: JSONObject }).activity[
        "value"
      ],
    ).toEqual(feedback["value"]);
    // Carol is not connected, and is not asked to be: a report needs nobody.
    expect(lookUpAccount).not.toHaveBeenCalled();
    expect(resolveTenant).not.toHaveBeenCalled();
  });
});

describe("somebody not connected is asked to connect once in a conversation", () => {
  function carolAsks(where: Where): JSONObject {
    return message({
      from: CAROL,
      text: "what changed before this started?",
      where: where,
      mentions: where.in === "personal" ? [] : [BOT],
    });
  }

  test("an @mention under OneUptime's incident card: one card in that thread, mentioning her; asking again there brings no second one", async () => {
    const thread: string = `${OPS_CHANNEL};messageid=${NOTIFICATION_POST_ID}`;
    const where: Where = { in: "thread", postId: NOTIFICATION_POST_ID };

    const first: Delivery = await deliver(carolAsks(where));

    expect(first.httpStatus).toBe(200);
    expect(first.posts).toHaveLength(1);
    await expectAskPrompt(first.posts[0], thread);

    for (let time: number = 0; time < 2; time++) {
      const again: Delivery = await deliver(carolAsks(where));

      expect(again.httpStatus).toBe(200);
      expect(again.posts).toEqual([]);
    }

    expect(askAssistant).not.toHaveBeenCalled();
    expect(loggedErrors).toEqual([]);
  });

  test("another thread is another conversation: asked there too", async () => {
    await deliver(carolAsks({ in: "thread", postId: NOTIFICATION_POST_ID }));

    const elsewhere: Delivery = await deliver(
      carolAsks({ in: "thread", postId: "1760000000999" }),
    );

    expect(elsewhere.posts).toHaveLength(1);
    await expectAskPrompt(
      elsewhere.posts[0],
      `${OPS_CHANNEL};messageid=1760000000999`,
    );
  });

  test("once that card's Connect button has expired (30 minutes), asking again there brings a new one", async () => {
    const where: Where = { in: "thread", postId: NOTIFICATION_POST_ID };
    const first: Delivery = await deliver(carolAsks(where));
    const firstRequest: WorkspaceConnectRequestRecord | null =
      await expectAskPrompt(
        first.posts[0],
        `${OPS_CHANNEL};messageid=${NOTIFICATION_POST_ID}`,
      );

    expect(firstRequest).not.toBeNull();

    minutesPass(29);
    expect((await deliver(carolAsks(where))).posts).toEqual([]);

    minutesPass(2);
    const later: Delivery = await deliver(carolAsks(where));

    expect(later.posts).toHaveLength(1);
    await expectAskPrompt(
      later.posts[0],
      `${OPS_CHANNEL};messageid=${NOTIFICATION_POST_ID}`,
    );
  });

  test("a personal chat is one conversation: one card, then none while its button works", async () => {
    const first: Delivery = await deliver(carolAsks({ in: "personal" }));

    expect(first.posts).toHaveLength(1);
    await expectAskPrompt(first.posts[0], PERSONAL_CHAT_ID);

    const again: Delivery = await deliver(
      message({
        from: CAROL,
        text: "hello?",
        where: { in: "personal" },
      }),
    );

    expect(again.httpStatus).toBe(200);
    expect(again.posts).toEqual([]);
  });

  test("a group chat is one conversation too", async () => {
    const first: Delivery = await deliver(carolAsks({ in: "groupChat" }));

    await expectAskPrompt(first.posts[0], GROUP_CHAT_ID);
    expect((await deliver(carolAsks({ in: "groupChat" }))).posts).toEqual([]);
  });

  test("a card Teams refused is not counted: her next question is asked again", async () => {
    connector.refuseNext = [403];

    const refused: Delivery = await deliver(carolAsks({ in: "personal" }));

    expect(refused.httpStatus).toBe(200);
    expect(refused.posts).toEqual([]);

    const next: Delivery = await deliver(carolAsks({ in: "personal" }));

    expect(next.posts).toHaveLength(1);
    await expectAskPrompt(next.posts[0], PERSONAL_CHAT_ID);
  });

  test("a command is answered every time: each is a request of its own", async () => {
    for (let time: number = 0; time < 2; time++) {
      const delivery: Delivery = await deliver(
        message({
          from: CAROL,
          text: "incident Checkout is down",
          where: { in: "personal" },
        }),
      );

      expect(delivery.posts).toHaveLength(1);
      expect(textBlocksOf(cardOf(delivery.posts[0]))).toEqual([
        `${CAROL_MENTION} 🔗 **Connect your Microsoft Teams account to declare an incident.** It takes one click. Then type **incident** again.`,
      ]);
    }
  });
});
