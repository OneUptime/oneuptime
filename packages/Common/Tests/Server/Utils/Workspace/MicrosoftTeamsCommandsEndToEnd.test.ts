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
 * CUSTOMER FEEDBACK #5, IN MICROSOFT TEAMS, END TO END.
 *
 * Slack's commands are words after one command now - /oneuptime incident,
 * maintenance, oncall, ask, help - and Microsoft Teams, which has no slash
 * commands, takes the same words typed to the bot ("@OneUptime incident
 * Checkout is down" in a channel). These run them through the REAL botbuilder
 * stack, as MicrosoftTeamsCreateCommandsEndToEnd does (see its header for
 * how the real package gets past Common's moduleNameMapper stub):
 *
 *   fake Express req -> MicrosoftTeamsUtil.processBotActivity
 *     -> real CloudAdapter -> real TeamsActivityHandler
 *     -> handleBotMessageActivity -> real TurnContext.sendActivity
 *     -> real ConnectorClient -> HTTP -> a fake Bot Connector on 127.0.0.1
 *
 * and pin what the Bot Connector is sent: the help card that mentions the
 * asker, the short answer to a misspelt command, the forms with their
 * titles, who is on call, the Connect prompts that say which word to type
 * again, and the AI refusal that points at help.
 * Only the database seams are stubbed.
 */

jest.mock("botbuilder", () => {
  const nodeModuleBuiltin: typeof import("module") =
    typeof process.getBuiltinModule === "function"
      ? process.getBuiltinModule("module")
      : Object.getPrototypeOf(jest.requireActual("module"));

  return nodeModuleBuiltin.createRequire(__filename)("botbuilder");
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

import MicrosoftTeamsUtil, {
  MicrosoftTeamsTenantResolution,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsAccountNotLinkedException,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Auth";
import MicrosoftTeamsIncidentActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import MicrosoftTeamsScheduledMaintenanceActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ScheduledMaintenance";
import MicrosoftTeamsCommands from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCommands";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceMessageTime from "../../../../Server/Utils/Workspace/WorkspaceMessageTime";
import WorkspaceConnectRequest, {
  WorkspaceConnectRequestAgainKind,
  WorkspaceConnectRequestRecord,
} from "../../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import AIService from "../../../../Server/Services/AIService";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../../Server/Services/ScheduledMaintenanceStateService";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import logger from "../../../../Server/Utils/Logger";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import User from "../../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import { CONNECT_REQUEST_TOKEN_PATTERN } from "../../../../Types/Workspace/ConnectCallback";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../Server/Utils/Express";
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  TeamsActivityHandler,
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
  close: () => Promise<void>;
}

async function startFakeBotConnector(): Promise<FakeBotConnector> {
  let messageNumber: number = 0;

  const fake: FakeBotConnector = {
    serviceUrl: "",
    posts: [],
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

// ---- The project behind the bot ----

const TENANT_ID: string = "4220aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BOT: JSONObject = { id: "28:oneuptime-bot-app-id", name: "OneUptime" };
const SENDER: JSONObject = {
  id: "29:1on-call-asker",
  name: "Customer User",
  aadObjectId: "00000000-0000-4000-8000-000000004220",
};
const SENDER_MENTION: string = "<at>Customer User</at>";
const PERSONAL_CONVERSATION_ID: string = "a:4220-personal-chat";
const CHANNEL_CONVERSATION_ID: string = "19:ops-4220@thread.tacv2";
const DASHBOARD_URL: string = "https://oneuptime.example.com/dashboard";
const ONEUPTIME_USER_ID: ObjectID = ObjectID.generate();
const HANDOFF: Date = new Date("2026-10-17T09:00:00.000Z");

let connector: FakeBotConnector;
let projectId: ObjectID;
let activityCounter: number = 0;
let loggedErrors: Array<string> = [];

function nextActivityId(label: string): string {
  activityCounter++;
  return `4220-${label}-${activityCounter}-${ObjectID.generate().toString().substring(0, 8)}`;
}

// A message typed to the bot: in a 1:1 chat, or after @OneUptime in a channel.
function message(
  text: string,
  where: "personal" | "channel" = "personal",
): JSONObject {
  const inChannel: boolean = where === "channel";

  return {
    type: "message",
    id: nextActivityId(where),
    timestamp: "2026-10-13T10:00:00.000Z",
    serviceUrl: connector.serviceUrl,
    channelId: "msteams",
    from: SENDER,
    conversation: inChannel
      ? {
          conversationType: "channel",
          tenantId: TENANT_ID,
          id: CHANNEL_CONVERSATION_ID,
          isGroup: true,
        }
      : {
          conversationType: "personal",
          tenantId: TENANT_ID,
          id: PERSONAL_CONVERSATION_ID,
        },
    recipient: BOT,
    textFormat: "plain",
    locale: "en-US",
    text: inChannel ? `<at>OneUptime</at> ${text}` : text,
    entities: inChannel
      ? [{ type: "mention", text: "<at>OneUptime</at>", mentioned: BOT }]
      : [],
    channelData: inChannel
      ? {
          tenant: { id: TENANT_ID },
          team: { id: "19:ops-team-4220@thread.tacv2", name: "Operations" },
          channel: { id: CHANNEL_CONVERSATION_ID, name: "incidents" },
        }
      : { tenant: { id: TENANT_ID } },
  };
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
 * An answer card (MicrosoftTeamsActionAnswer): what it says after the
 * mention of whoever asked, whom it mentions. Checks the mention too.
 */
function answerOf(post: ConnectorPost | undefined): string {
  const card: JSONObject = cardOf(post);
  const texts: Array<string> = textBlocksOf(card);

  expect(texts).toHaveLength(1);
  expect(texts[0]!.startsWith(`${SENDER_MENTION} `)).toBe(true);
  expect((card["msteams"] as JSONObject)["entities"]).toEqual([
    {
      type: "mention",
      text: SENDER_MENTION,
      mentioned: { id: SENDER["id"], name: SENDER["name"] },
    },
  ]);

  return texts[0]!.substring(SENDER_MENTION.length + 1);
}

function connectUrlOf(post: ConnectorPost | undefined): string | null {
  const button: JSONObject | undefined = (
    (cardOf(post)["actions"] as Array<JSONObject> | undefined) || []
  ).find((action: JSONObject): boolean => {
    return action["title"] === "Connect Microsoft Teams account";
  });

  return button ? String(button["url"]) : null;
}

// The press a Connect button keeps, read back from where it was kept.
async function keptRequestOf(
  post: ConnectorPost | undefined,
): Promise<WorkspaceConnectRequestRecord | null> {
  const url: globalThis.URL = new globalThis.URL(connectUrlOf(post) || "");
  const token: string | null = url.searchParams.get("connect");

  expect(`${url.origin}${url.pathname}`).toBe(
    `${DASHBOARD_URL}/${projectId.toString()}/user-settings/microsoft-teams-integration`,
  );
  expect(token).toMatch(CONNECT_REQUEST_TOKEN_PATTERN);

  return await WorkspaceConnectRequest.peek(token);
}

// ---- Lifecycle ----

const keptConnectRequests: Map<string, string> = new Map<string, string>();

beforeAll(async () => {
  connector = await startFakeBotConnector();
});

afterAll(async () => {
  await connector.close();
});

beforeEach(() => {
  connector.posts.splice(0);
  projectId = ObjectID.generate();

  (MicrosoftTeamsUtil as unknown as CachedAdapterSlot).cachedAdapter =
    new CloudAdapter(new ConfigurationBotFrameworkAuthentication({}));

  jest.spyOn(MicrosoftTeamsUtil, "resolveProjectByTenantId").mockResolvedValue({
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

  // The sender has a connected account and is a member.
  jest
    .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
    .mockResolvedValue(ONEUPTIME_USER_ID);
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

  // The forms' lists: one severity, nothing else.
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
  jest
    .spyOn(
      MicrosoftTeamsScheduledMaintenanceActions,
      "getNewScheduledMaintenanceFormChoices",
    )
    .mockResolvedValue({
      monitors: { choices: [], totalCount: 0 },
      monitorStatuses: { choices: [], totalCount: 0 },
      labels: { choices: [], totalCount: 0 },
    });

  jest.spyOn(DatabaseConfig, "getDashboardUrl").mockImplementation(() => {
    return Promise.resolve(URL.fromString(DASHBOARD_URL));
  });

  // The presses Connect buttons carry live in Redis: in this map here.
  keptConnectRequests.clear();
  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        keptConnectRequests.set(`${namespace}:${key}`, value);
      },
    );
  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      return keptConnectRequests.get(`${namespace}:${key}`) ?? null;
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

describe("harness: the real botbuilder stack", () => {
  test("botbuilder is the real package, not Common's stub", () => {
    expect(typeof CloudAdapter.prototype.process).toBe("function");
    expect(typeof TeamsActivityHandler.prototype.run).toBe("function");
  });
});

describe("help: one card that mentions whoever asked, with the words Slack's /oneuptime takes", () => {
  test.each([
    ["'help' in a personal chat", "help", "personal" as const],
    ["'@OneUptime help' in a channel", "help", "channel" as const],
    ["'?'", "?", "personal" as const],
    ["'@OneUptime' with nothing after it", "", "channel" as const],
    ["a bare 'ask'", "ask", "personal" as const],
  ])(
    "%s: the help card, HTTP 200",
    async (_name: string, text: string, where: "personal" | "channel") => {
      const delivery: Delivery = await deliver(message(text, where));

      expect(delivery.httpStatus).toBe(200);
      expect(delivery.posts).toHaveLength(1);
      expect(delivery.posts[0]!.conversationId).toBe(
        where === "channel"
          ? CHANNEL_CONVERSATION_ID
          : PERSONAL_CONVERSATION_ID,
      );
      expect(answerOf(delivery.posts[0])).toBe(
        MicrosoftTeamsCommands.getHelpAnswer().markdown,
      );
      // What a notification of it says.
      expect(delivery.posts[0]!.activity["summary"]).toBe(
        "Here's what I can do: incident, maintenance, oncall, page, ask, help",
      );
    },
  );

  test("the help lists every word, and Teams' own lists, in the order Teams suggests them", async () => {
    const delivery: Delivery = await deliver(message("help"));

    expect(answerOf(delivery.posts[0]).split("\n")).toEqual([
      "👋 **Here's what I can do.** In a channel or a group chat, mention @OneUptime first.",
      "- **incident [title]**: declare an incident",
      "- **maintenance [title]**: schedule maintenance",
      "- **oncall**: see who is on call right now",
      "- **page [who] [message]**: page a person, a team or whoever is on call",
      "- **ask [question]**: ask OneUptime AI about your logs, traces, metrics, incidents and monitors",
      "- **show active incidents**, **show active alerts**: list what is open right now",
      "- **show scheduled maintenance**, **show ongoing maintenance**: list upcoming and ongoing maintenance",
      "- **help**: list every command",
      "",
      'For example: "incident Checkout is down". Anything else you type is a question for OneUptime AI too, such as "which monitors are down right now?"',
    ]);
  });

  test("the help names the bot as Teams shows it - the name the message was sent to - for the @mention a channel needs", async () => {
    const activity: JSONObject = message("help", "channel");
    activity["recipient"] = { id: BOT["id"], name: "OneUptime Staging" };

    const delivery: Delivery = await deliver(activity);

    expect(answerOf(delivery.posts[0]).split("\n")[0]).toBe(
      "👋 **Here's what I can do.** In a channel or a group chat, mention @OneUptime Staging first.",
    );
  });

  test("'incidnet Checkout is down' - a command misspelt: one short reply with the command it looks like, and how to ask AI instead; AI is not asked", async () => {
    const assistant: ReturnType<typeof jest.spyOn> = jest.spyOn(
      AIService,
      "isProjectAIEnabled",
    );

    const delivery: Delivery = await deliver(
      message("incidnet Checkout is down", "channel"),
    );

    expect(delivery.httpStatus).toBe(200);
    expect(delivery.posts).toHaveLength(1);
    expect(answerOf(delivery.posts[0])).toBe(
      "🤔 **incidnet** is not a command. Did you mean **incident Checkout is down**? To ask OneUptime AI instead, start with **ask**.",
    );
    expect(delivery.posts[0]!.activity["summary"]).toBe(
      "incidnet is not a command. Did you mean incident Checkout is down?",
    );
    expect(assistant).not.toHaveBeenCalled();
  });

  test("'ask incidnet Checkout is down' - the way out the reply offers - is a question for AI", async () => {
    const enabled: ReturnType<typeof jest.spyOn> = jest
      .spyOn(AIService, "isProjectAIEnabled")
      .mockResolvedValue(false);

    const delivery: Delivery = await deliver(
      message("ask incidnet Checkout is down"),
    );

    expect(enabled).toHaveBeenCalledWith(projectId);
    expect(delivery.posts).toHaveLength(1);
    expect(delivery.posts[0]!.activity["text"]).toContain(
      "AI features are disabled for this project.",
    );
  });
});

describe("incident and maintenance: the forms, with the title as typed", () => {
  test.each([
    ["incident Checkout is down", "Checkout is down"],
    ["Create Incident Checkout is down", "Checkout is down"],
    ["INCIDENT   Disk   full", "Disk full"],
  ])(
    "%j in a channel: one 'Create New Incident' card, its title %j",
    async (text: string, title: string) => {
      const delivery: Delivery = await deliver(message(text, "channel"));

      expect(delivery.httpStatus).toBe(200);
      expect(delivery.posts).toHaveLength(1);

      const card: JSONObject = cardOf(delivery.posts[0]);
      expect(textBlocksOf(card)[0]).toBe("Create New Incident");
      expect(
        ((card["body"] as Array<JSONObject>).find(
          (element: JSONObject): boolean => {
            return element["id"] === "incidentTitle";
          },
        ) || {})["value"],
      ).toBe(title);
    },
  );

  test("'maintenance Database upgrade': one 'Create New Scheduled Maintenance' card, its title filled in", async () => {
    const delivery: Delivery = await deliver(
      message("maintenance Database upgrade"),
    );

    expect(delivery.httpStatus).toBe(200);
    expect(delivery.posts).toHaveLength(1);

    const card: JSONObject = cardOf(delivery.posts[0]);
    expect(textBlocksOf(card)[0]).toBe("Create New Scheduled Maintenance");
    expect(
      ((card["body"] as Array<JSONObject>).find(
        (element: JSONObject): boolean => {
          return element["id"] === "scheduledMaintenanceTitle";
        },
      ) || {})["value"],
    ).toBe("Database upgrade");
  });

  test.each([
    ["incident Checkout is down", "declare an incident", "incident"],
    ["create incident Checkout is down", "declare an incident", "incident"],
    [
      "maintenance Database upgrade",
      "create a scheduled maintenance event",
      "maintenance",
    ],
  ])(
    "%j from a Teams user with no connected account: one reply, mentioning them, with a Connect button - and to type %3$s again",
    async (text: string, purpose: string, again: string) => {
      jest
        .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
        .mockRejectedValue(
          new MicrosoftTeamsAccountNotLinkedException("not linked"),
        );

      const delivery: Delivery = await deliver(message(text, "channel"));

      expect(delivery.httpStatus).toBe(200);
      expect(delivery.posts).toHaveLength(1);
      expect(answerOf(delivery.posts[0])).toBe(
        `🔗 **Connect your Microsoft Teams account to ${purpose}.** It takes one click. Then type **${again}** again.`,
      );

      const request: WorkspaceConnectRequestRecord | null = await keptRequestOf(
        delivery.posts[0],
      );
      expect(request?.again).toEqual({
        kind: WorkspaceConnectRequestAgainKind.Command,
        label: again,
      });
    },
  );
});

describe("oncall: who is on call right now, as a card that reads each moment in the reader's own time", () => {
  function onCallSchedule(): OnCallDutyPolicySchedule {
    const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
    schedule.id = ObjectID.generate();
    schedule.name = "Primary";
    const simon: User = new User();
    simon.id = ObjectID.generate();
    simon.name = new Name("Simon Lee");
    schedule.currentUserOnRoster = simon;
    schedule.rosterHandoffAt = HANDOFF;
    return schedule;
  }

  test("'oncall': one reply, mentioning the asker, with each schedule's on-call person, read with the asker's own permissions", async () => {
    const schedule: OnCallDutyPolicySchedule = onCallSchedule();
    const findBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(OnCallDutyPolicyScheduleService, "findBy")
      .mockResolvedValue([schedule] as never);

    const delivery: Delivery = await deliver(message("oncall"));

    expect(delivery.httpStatus).toBe(200);
    expect(delivery.posts).toHaveLength(1);
    expect(answerOf(delivery.posts[0])).toBe(
      [
        "👥 **On call now**",
        `- [Primary](${DASHBOARD_URL}/${projectId.toString()}/on-call-duty/schedules/${schedule.id!.toString()}): **Simon Lee** until ${WorkspaceMessageTime.dateAndTime(HANDOFF).toString()}.`,
        "",
        `[Open the on-call schedules in OneUptime](${DASHBOARD_URL}/${projectId.toString()}/on-call-duty/schedules)`,
      ].join("\n"),
    );
    // Teams draws {{DATE()}} and {{TIME()}} in each reader's own zone.
    expect(answerOf(delivery.posts[0])).toContain(
      "{{DATE(2026-10-17T09:00:00Z, SHORT)}} at {{TIME(2026-10-17T09:00:00Z)}}",
    );
    expect(delivery.posts[0]!.activity["summary"]).toBe(
      "On call now: Simon Lee (Primary)",
    );
    expect(findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { projectId: projectId },
        props: { userId: ONEUPTIME_USER_ID, tenantId: projectId },
      }),
    );
  });

  test.each(["on-call", "On Call", "oncall?"])(
    "%j is oncall too",
    async (text: string) => {
      jest
        .spyOn(OnCallDutyPolicyScheduleService, "findBy")
        .mockResolvedValue([] as never);

      const delivery: Delivery = await deliver(message(text, "channel"));

      expect(delivery.posts).toHaveLength(1);
      expect(answerOf(delivery.posts[0])).toContain(
        "**No on-call schedules yet.**",
      );
    },
  );

  test("from a Teams user with no connected account: asked to connect, and to type oncall again - no schedule read", async () => {
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockRejectedValue(
        new MicrosoftTeamsAccountNotLinkedException("not linked"),
      );
    const findBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      OnCallDutyPolicyScheduleService,
      "findBy",
    );

    const delivery: Delivery = await deliver(message("oncall", "channel"));

    expect(delivery.httpStatus).toBe(200);
    expect(delivery.posts).toHaveLength(1);
    expect(answerOf(delivery.posts[0])).toBe(
      "🔗 **Connect your Microsoft Teams account to see who is on call.** It takes one click. Then type **oncall** again.",
    );

    const request: WorkspaceConnectRequestRecord | null = await keptRequestOf(
      delivery.posts[0],
    );
    expect(request).toMatchObject({
      workspaceUserId: SENDER["aadObjectId"],
      purpose: "see who is on call",
      again: {
        kind: WorkspaceConnectRequestAgainKind.Command,
        label: "oncall",
      },
    });
    expect(findBy).not.toHaveBeenCalled();
  });

  test("from somebody no longer a member of the project: told so, and nothing read", async () => {
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockRejectedValue(
        new NotAuthorizedException(
          WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
        ),
      );
    const findBy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      OnCallDutyPolicyScheduleService,
      "findBy",
    );

    const delivery: Delivery = await deliver(message("oncall"));

    expect(answerOf(delivery.posts[0])).toBe(
      "Your OneUptime account is not a member of this project. Ask a project admin to invite you, then try again.",
    );
    expect(findBy).not.toHaveBeenCalled();
  });

  test("the schedules cannot be read: one reply that says so, logged - and HTTP 200, so Teams does not deliver it again", async () => {
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "findBy")
      .mockRejectedValue(new Error("connection reset"));

    const delivery: Delivery = await deliver(message("oncall"));

    expect(delivery.httpStatus).toBe(200);
    expect(delivery.posts).toHaveLength(1);
    expect(answerOf(delivery.posts[0])).toBe(
      "Sorry, I couldn't read who is on call just now. Please try again in a minute.",
    );
    expect(loggedErrors[0]).toBe(
      "Could not read who is on call for a Microsoft Teams command: Error: connection reset",
    );
  });
});

describe("a question, with AI turned off", () => {
  test("'which monitors are down?': said so, and that the other commands need no AI", async () => {
    jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(false);

    const delivery: Delivery = await deliver(
      message("which monitors are down?"),
    );

    expect(delivery.httpStatus).toBe(200);
    expect(delivery.posts).toHaveLength(1);
    expect(delivery.posts[0]!.activity["text"]).toBe(
      "AI features are disabled for this project. Enable them in Project Settings → AI Features. Type **help** to see the other commands.",
    );
  });
});

/*
 * TEAMS' OWN LISTS, READ AS THE MEMBER.
 *
 * "show active incidents", "show active alerts", "show scheduled
 * maintenance" and "show ongoing maintenance" read as OneUptime itself:
 * anybody in a connected Microsoft 365 organization - with no OneUptime
 * account, or a role that may not read incidents - could list a project's
 * open incidents by typing them to the bot. They act as the member the
 * sender's account is connected to now, as oncall and the forms do
 * (MicrosoftTeamsCommands.handleListCommand, WorkspaceOpenRecords).
 */
describe("the 'show' lists: read as the member who typed them, never as OneUptime", () => {
  const OPEN_STATE: ObjectID = ObjectID.generate();

  interface StoredIncident {
    projectId: ObjectID;
    incident: Incident;
  }

  /*
   * A small database of incidents across two projects: a read gets the rows
   * of the project its query names, as the real one does.
   */
  function stubIncidents(
    rows: Array<StoredIncident>,
  ): ReturnType<typeof jest.spyOn> {
    jest
      .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
      .mockResolvedValue([OPEN_STATE]);

    return jest
      .spyOn(IncidentService, "findBy")
      .mockImplementation(async (findBy: unknown) => {
        const asked: string = String(
          (findBy as { query: { projectId: unknown } }).query.projectId,
        );

        return rows
          .filter((row: StoredIncident): boolean => {
            return row.projectId.toString() === asked;
          })
          .map((row: StoredIncident): Incident => {
            return row.incident;
          }) as never;
      });
  }

  function incidentNumbered(number: number, title: string): Incident {
    const incident: Incident = new Incident();
    incident.id = ObjectID.generate();
    incident.incidentNumber = number;
    incident.incidentNumberWithPrefix = `INC-${number}`;
    incident.title = title;
    incident.incidentSeverity = { name: "Critical" } as never;
    incident.currentIncidentState = { name: "Identified" } as never;
    return incident;
  }

  test("'show active incidents': one reply that mentions the asker, with the project's open incidents read with the asker's own permissions", async () => {
    const ours: Incident = incidentNumbered(12, "Checkout is down");
    const theirs: Incident = incidentNumbered(99, "Another project's secret");
    const findBy: ReturnType<typeof jest.spyOn> = stubIncidents([
      { projectId: projectId, incident: ours },
      { projectId: ObjectID.generate(), incident: theirs },
    ]);

    const delivery: Delivery = await deliver(message("show active incidents"));

    expect(delivery.httpStatus).toBe(200);
    expect(delivery.posts).toHaveLength(1);
    expect(delivery.posts[0]!.conversationId).toBe(PERSONAL_CONVERSATION_ID);
    expect(answerOf(delivery.posts[0])).toBe(
      [
        "🚨 **Open incidents**",
        `- **[INC-12](${DASHBOARD_URL}/${projectId.toString()}/incidents/${ours.id!.toString()})** Checkout is down · Critical · Identified`,
        "",
        `[See every incident in OneUptime](${DASHBOARD_URL}/${projectId.toString()}/incidents)`,
      ].join("\n"),
    );
    expect(delivery.posts[0]!.activity["summary"]).toBe(
      "Open incidents: INC-12 Checkout is down",
    );
    // The asker's own props, scoped to the project - never OneUptime's.
    expect(findBy).toHaveBeenCalledTimes(1);
    const read: { props: DatabaseCommonInteractionProps } = findBy.mock
      .calls[0]![0] as { props: DatabaseCommonInteractionProps };
    expect(read.props).toEqual({
      userId: ONEUPTIME_USER_ID,
      tenantId: projectId,
    });
    expect(read.props.isRoot).toBeUndefined();
    expect(JSON.stringify(delivery.posts)).not.toContain("secret");
  });

  test("'@OneUptime show active alerts' in a channel: answered in the channel's thread", async () => {
    jest
      .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
      .mockResolvedValue([OPEN_STATE]);
    const disk: Alert = new Alert();
    disk.id = ObjectID.generate();
    disk.alertNumberWithPrefix = "AL-7";
    disk.title = "Disk 95% on web-1";
    jest.spyOn(AlertService, "findBy").mockResolvedValue([disk] as never);

    const delivery: Delivery = await deliver(
      message("show active alerts", "channel"),
    );

    expect(delivery.posts).toHaveLength(1);
    expect(delivery.posts[0]!.conversationId).toBe(CHANNEL_CONVERSATION_ID);
    expect(answerOf(delivery.posts[0])).toContain(
      `- **[AL-7](${DASHBOARD_URL}/${projectId.toString()}/alerts/${disk.id.toString()})** Disk 95% on web-1`,
    );
  });

  test.each([
    ["scheduled maintenance", "🛠️ **No scheduled maintenance coming up.**"],
    ["show ongoing maintenance", "🔧 **No maintenance in progress.**"],
  ])(
    "%j with nothing to list: one short line",
    async (text: string, said: string) => {
      jest
        .spyOn(
          ScheduledMaintenanceStateService,
          "getWaitingToStartScheduledMaintenanceStateIds",
        )
        .mockResolvedValue([OPEN_STATE]);
      jest
        .spyOn(
          ScheduledMaintenanceStateService,
          "getInProgressScheduledMaintenanceStateIds",
        )
        .mockResolvedValue([OPEN_STATE]);
      jest
        .spyOn(ScheduledMaintenanceService, "findBy")
        .mockResolvedValue([] as never);

      const delivery: Delivery = await deliver(message(text));

      expect(delivery.posts).toHaveLength(1);
      expect(answerOf(delivery.posts[0])).toBe(said);
    },
  );

  test("from a Teams user with no connected account: asked to connect, and to type the list again - nothing read", async () => {
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockRejectedValue(
        new MicrosoftTeamsAccountNotLinkedException("not linked"),
      );
    const findBy: ReturnType<typeof jest.spyOn> = stubIncidents([
      { projectId: projectId, incident: incidentNumbered(1, "Checkout") },
    ]);

    const delivery: Delivery = await deliver(
      message("show active incidents", "channel"),
    );

    expect(delivery.httpStatus).toBe(200);
    expect(delivery.posts).toHaveLength(1);
    expect(answerOf(delivery.posts[0])).toBe(
      "🔗 **Connect your Microsoft Teams account to see the open incidents.** It takes one click. Then type **show active incidents** again.",
    );
    const request: WorkspaceConnectRequestRecord | null = await keptRequestOf(
      delivery.posts[0],
    );
    expect(request).toMatchObject({
      workspaceUserId: SENDER["aadObjectId"],
      purpose: "see the open incidents",
      again: {
        kind: WorkspaceConnectRequestAgainKind.Command,
        label: "show active incidents",
      },
    });
    expect(findBy).not.toHaveBeenCalled();
    expect(JSON.stringify(delivery.posts)).not.toContain("Checkout");
  });

  test("from somebody no longer a member of the project: told so, and nothing read", async () => {
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockRejectedValue(
        new NotAuthorizedException(
          WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
        ),
      );
    const findBy: ReturnType<typeof jest.spyOn> = stubIncidents([]);

    const delivery: Delivery = await deliver(message("active incidents"));

    expect(answerOf(delivery.posts[0])).toBe(
      "Your OneUptime account is not a member of this project. Ask a project admin to invite you, then try again.",
    );
    expect(findBy).not.toHaveBeenCalled();
  });

  test("from a member whose role may not read incidents: told so, and shown nothing", async () => {
    jest
      .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
      .mockResolvedValue([OPEN_STATE]);
    jest
      .spyOn(IncidentService, "findBy")
      .mockRejectedValue(
        new NotAuthorizedException(
          "You do not have permissions to read Incident.",
        ),
      );

    const delivery: Delivery = await deliver(message("show active incidents"));

    expect(answerOf(delivery.posts[0])).toBe(
      "You do not have permission to see the incidents in this project. Ask a project admin for access to them.",
    );
  });

  test("the list cannot be read: one reply that says so, logged - and HTTP 200, so Teams does not deliver it again", async () => {
    jest
      .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
      .mockResolvedValue([OPEN_STATE]);
    jest
      .spyOn(IncidentService, "findBy")
      .mockRejectedValue(new Error("connection reset"));

    const delivery: Delivery = await deliver(message("show active incidents"));

    expect(delivery.httpStatus).toBe(200);
    expect(delivery.posts).toHaveLength(1);
    expect(answerOf(delivery.posts[0])).toBe(
      "Sorry, I couldn't read the open incidents just now. Please try again in a minute.",
    );
    expect(loggedErrors[0]).toBe(
      'Could not read the list for a Microsoft Teams "show active incidents" command: Error: connection reset',
    );
  });
});
