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
import type { SpyInstance } from "jest-mock";
import http from "http";
import { AddressInfo } from "net";
import express from "express";
import API from "../../../Utils/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import Incident from "../../../Models/DatabaseModels/Incident";
import AIService from "../../../Server/Services/AIService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../Server/Services/IncidentService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import ObservabilityAssistant from "../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import BadDataException from "../../../Types/Exception/BadDataException";
import { PROJECT_AI_CREDITS_USED_UP_MESSAGE } from "../../../Utils/Project/ProjectBalance";
import ProductBrandingText from "../../../Server/Utils/ProductBrandingText";
import logger from "../../../Server/Utils/Logger";
import SlackDirectMessageHelp from "../../../Server/Utils/Workspace/Slack/SlackDirectMessageHelp";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceConnectCompletion from "../../../Server/Utils/Workspace/WorkspaceConnectCompletion";
import WorkspaceConnectRequest, {
  WorkspaceConnectRequestAgainKind,
  WorkspaceConnectRequestRecord,
} from "../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import {
  CONNECT_REQUEST_TOKEN_PATTERN,
  ConnectRequestOutcome,
} from "../../../Types/Workspace/ConnectCallback";

/*
 * #4768, THROUGH SLACK'S OWN EVENTS ENDPOINT.
 *
 * "Since the slack integration is enabled, our user who doesn't have
 * OneUptime account are spammed with this message when they answered in a
 * conversation: Unfortunately your Slack account is not connected to
 * OneUptime..." - every reply anybody wrote in the thread of an incident's
 * notification was taken for a question to OneUptime AI, since the app had
 * posted in that thread. Somebody not connected was told to connect, every
 * time; somebody connected got an answer from AI, every time.
 *
 * OneUptime now answers only what is addressed to it: an @mention, a direct
 * message, or a reply in a conversation with OneUptime AI - the thread
 * under a question somebody asked it at the top of a channel - by somebody
 * in that conversation. Somebody not connected is asked to connect once in
 * a conversation, not on each message, and where Slack shows it.
 *
 * These post what Slack posts to /api/slack/events - the event_callback
 * wrapper with its event, a person's message delivered both as app_mention
 * and as a message event when it mentions OneUptime, as Slack does - through
 * the real router, the real conversation and prompt records (in an
 * in-memory cache) and the real answers. Only the database reads, the AI
 * and Slack itself are stood in for: a small Slack workspace that keeps the
 * threads, answers conversations.replies and conversations.history from
 * them, and records every request OneUptime makes, which these pin.
 */

jest.mock("../../../Server/Middleware/SlackAuthorization", () => {
  return {
    __esModule: true,
    default: {
      // The signature check has its own tests; these drive what follows it.
      isAuthorizedSlackRequest: (
        _req: unknown,
        _res: unknown,
        next: () => void,
      ): void => {
        next();
      },
    },
  };
});

jest.mock("../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual("./WorkspaceOAuthTestHelpers") as {
        createInMemoryGlobalCache: () => unknown;
      }
    ).createInMemoryGlobalCache(),
  };
});

// Each test waits, at most a few seconds, for what OneUptime does after its 200.
jest.setTimeout(60000);

const DASHBOARD_URL: string = "https://oneuptime.test/dashboard";
const TEAM_ID: string = "T0ACME";
// The app's bot user, and its bot.
const ONEUPTIME: string = "U0ONEUPTIME";
const ONEUPTIME_BOT_ID: string = "B0ONEUPTIME";
const OPS: string = "C0OPS";
// People: Alice and Bob have connected their Slack accounts; Carol and Dave have not.
const ALICE: string = "U0ALICE";
const BOB: string = "U0BOB";
const CAROL: string = "U0CAROL";
const DAVE: string = "U0DAVE";
const PROJECT_ID: ObjectID = new ObjectID(
  "c4768000-0000-4000-8000-000000000001",
);
const ALICE_ID: ObjectID = new ObjectID("c4768000-0000-4000-8000-0000000000a1");
const BOB_ID: ObjectID = new ObjectID("c4768000-0000-4000-8000-0000000000b1");
const SLACK_PROJECT_TOKEN: string = "xoxb-project-token";

// Slack's own: a zero-width space around a bold span it draws.
const ZWSP: string = "\u{200B}";

const ANSWER_MARKDOWN: string =
  "Two monitors are down: **API** and **Checkout**.";
const ANSWER_TEXT: string = `Two monitors are down: ${ZWSP}*API*${ZWSP} and ${ZWSP}*Checkout*${ZWSP}.\n`;
const ACKNOWLEDGEMENT: string = "Looking into it… :hourglass_flowing_sand:";
const CONNECT_PROMPT_TEXT: string = `🔗 ${ZWSP}*Connect your Slack account to ask OneUptime AI.*${ZWSP} It takes one click. Then ask your question again.\n`;
const CONNECT_PROMPT_NOTIFICATION: string =
  "Connect your Slack account to ask OneUptime AI";

// What the debug log says of a message OneUptime does not answer.
const NOT_IN_A_CONVERSATION: string =
  "Slack message not answered: a reply in a thread that is not a conversation of its author's with OneUptime AI.";
const ASKED_ALREADY: string =
  "Slack message not answered: its author was asked to connect their Slack account in this conversation already.";
const MENTIONS_SOMEBODY: string =
  "Slack message not answered: a message that mentions somebody.";
const AT_THE_TOP: string =
  "Slack message not answered: a message at the top of a channel that mentions nobody.";
const A_BOT_OR_A_CHANGE: string =
  "Slack message not answered: a bot's message, or a change to a channel or a message.";
const RETRY: string =
  "Skipping Slack AI Ops event because it is a Slack retry.";

const PROPS: DatabaseCommonInteractionProps = {
  userId: ALICE_ID,
  tenantId: PROJECT_ID,
};

// ---- A Slack workspace, as much of it as OneUptime reads and writes ----

interface SlackMessageRecord {
  ts: string;
  user?: string | undefined;
  bot_id?: string | undefined;
  text: string;
  subtype?: string | undefined;
}

interface SlackCall {
  // The Web API method: "chat.postMessage", "conversations.replies", ...
  method: string;
  data: JSONObject;
}

// Each thread by "<channel>:<its first message's ts>", its first message first.
const threads: Map<string, Array<SlackMessageRecord>> = new Map();
// Each direct message conversation's messages at its top, newest first.
const directMessages: Map<string, Array<SlackMessageRecord>> = new Map();
let slackCalls: Array<SlackCall> = [];
// Methods Slack refuses, with the error it answers.
let refusals: Map<string, string> = new Map();
let messageNumber: number = 0;

function nextTs(): string {
  messageNumber++;
  return `1760000${String(messageNumber).padStart(3, "0")}.000100`;
}

function threadKey(channel: string, threadTs: string): string {
  return `${channel}:${threadTs}`;
}

const READ_METHODS: Array<string> = [
  "conversations.replies",
  "conversations.history",
];

/*
 * The "Looking into it…" that stands in for an answer is removed once the
 * answer is posted (chat.delete): counted apart from what is posted.
 */
const REMOVAL_METHODS: Array<string> = ["chat.delete"];

// What OneUptime posted: every request that is not a read or a removal.
function writes(): Array<SlackCall> {
  return slackCalls.filter((call: SlackCall): boolean => {
    return (
      !READ_METHODS.includes(call.method) &&
      !REMOVAL_METHODS.includes(call.method)
    );
  });
}

function removals(): Array<SlackCall> {
  return slackCalls.filter((call: SlackCall): boolean => {
    return REMOVAL_METHODS.includes(call.method);
  });
}

// The ts Slack gave each "Looking into it…" OneUptime posted, in order.
let placeholderTimestamps: Array<string> = [];

function reads(): Array<SlackCall> {
  return slackCalls.filter((call: SlackCall): boolean => {
    return READ_METHODS.includes(call.method);
  });
}

function methodsOf(calls: Array<SlackCall>): Array<string> {
  return calls.map((call: SlackCall): string => {
    return call.method;
  });
}

// Slack, answering a request of OneUptime's.
function answerSlack(method: string, data: JSONObject): JSONObject {
  const refusal: string | undefined = refusals.get(method);

  if (refusal) {
    return { ok: false, error: refusal };
  }

  if (method === "conversations.replies") {
    const thread: Array<SlackMessageRecord> | undefined = threads.get(
      threadKey(String(data["channel"]), String(data["ts"])),
    );

    return thread
      ? { ok: true, messages: thread as unknown as Array<JSONObject> }
      : { ok: false, error: "thread_not_found" };
  }

  if (method === "conversations.history") {
    return {
      ok: true,
      messages: (directMessages.get(String(data["channel"])) ||
        []) as unknown as Array<JSONObject>,
    };
  }

  if (method === "chat.delete") {
    for (const thread of threads.values()) {
      const index: number = thread.findIndex(
        (message: SlackMessageRecord): boolean => {
          return message.ts === data["ts"];
        },
      );

      if (index !== -1) {
        thread.splice(index, 1);
      }
    }

    return { ok: true, channel: data["channel"], ts: data["ts"] };
  }

  if (method === "chat.postMessage") {
    const ts: string = nextTs();
    const threadTs: string | undefined = data["thread_ts"] as
      | string
      | undefined;

    if (data["text"] === ACKNOWLEDGEMENT) {
      placeholderTimestamps.push(ts);
    }

    if (threadTs) {
      threads.get(threadKey(String(data["channel"]), threadTs))?.push({
        ts: ts,
        user: ONEUPTIME,
        bot_id: ONEUPTIME_BOT_ID,
        text: String(data["text"] || ""),
      });
    }

    return { ok: true, channel: data["channel"], ts: ts };
  }

  return { ok: true };
}

// ---- The events, as Slack posts them ----

let eventNumber: number = 0;

function eventCallback(event: JSONObject): JSONObject {
  eventNumber++;

  return {
    token: "verification-token",
    team_id: TEAM_ID,
    api_app_id: "A0ONEUPTIME",
    event: { ...event, team: TEAM_ID, event_ts: event["ts"] },
    type: "event_callback",
    event_id: `Ev04768${String(eventNumber).padStart(4, "0")}`,
    event_time: 1760000000 + eventNumber,
    authorizations: [
      {
        enterprise_id: null,
        team_id: TEAM_ID,
        user_id: ONEUPTIME,
        is_bot: true,
        is_enterprise_install: false,
      },
    ],
    is_ext_shared_channel: false,
    event_context: `4-eyJldCI6Im1lc3NhZ2UifQ-${eventNumber}`,
  };
}

interface RoutePort {
  port: number;
  close: () => Promise<void>;
}

let app: RoutePort;

async function startSlackApp(): Promise<RoutePort> {
  const SlackAPI: { new (): { getRouter: () => express.Router } } = (
    (await import("../../../Server/API/SlackAPI")) as unknown as {
      default: { new (): { getRouter: () => express.Router } };
    }
  ).default;

  const server: http.Server = http.createServer(
    express().use(express.json()).use("/api", new SlackAPI().getRouter()),
  );

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    port: (server.address() as AddressInfo).port,
    close: (): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

// Posts an event as Slack does: JSON, answered with a status and a body.
function deliver(
  payload: JSONObject,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  const body: string = JSON.stringify(payload);

  return new Promise<{ status: number; body: string }>(
    (
      resolve: (answer: { status: number; body: string }) => void,
      reject: (error: Error) => void,
    ) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: app.port,
          path: "/api/slack/events",
          method: "POST",
          headers: {
            ...headers,
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
          },
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on("end", () => {
            resolve({
              status: response.statusCode || 0,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );

      request.setTimeout(20000, () => {
        request.destroy(new Error("no answer"));
      });
      request.on("error", reject);
      request.write(body);
      request.end();
    },
  );
}

// Whether a text mentions OneUptime, as Slack writes a mention.
function mentionsOneUptime(text: string): boolean {
  return (
    text.indexOf(`<@${ONEUPTIME}>`) !== -1 ||
    text.indexOf(`<@${ONEUPTIME}|`) !== -1
  );
}

interface Said {
  ts: string;
  // What OneUptime answered each delivery with: always 200 "ok".
  statuses: Array<number>;
}

/*
 * Somebody writes in a channel - at its top, or in a thread - and Slack
 * delivers it: a message event, and an app_mention too when it mentions
 * OneUptime.
 */
async function say(data: {
  user: string;
  text: string;
  channel?: string | undefined;
  threadTs?: string | undefined;
  channelType?: "channel" | "group" | "mpim" | undefined;
  // What the first message of the thread is: who wrote it.
  parentUserId?: string | undefined;
  headers?: Record<string, string> | undefined;
}): Promise<Said> {
  const channel: string = data.channel || OPS;
  const ts: string = nextTs();
  const record: SlackMessageRecord = {
    ts: ts,
    user: data.user,
    text: data.text,
  };

  if (data.threadTs) {
    threads.get(threadKey(channel, data.threadTs))?.push(record);
  } else {
    threads.set(threadKey(channel, ts), [record]);
  }

  const common: JSONObject = {
    user: data.user,
    text: data.text,
    ts: ts,
    channel: channel,
    client_msg_id: `00000000-0000-4000-8000-${ts.split(".").join("").slice(-12)}`,
    blocks: [
      {
        type: "rich_text",
        block_id: "b4768",
        elements: [
          {
            type: "rich_text_section",
            elements: [{ type: "text", text: data.text }],
          },
        ],
      },
    ],
  };

  if (data.threadTs) {
    common["thread_ts"] = data.threadTs;
    common["parent_user_id"] = data.parentUserId || ONEUPTIME;
  }

  const statuses: Array<number> = [];

  if (mentionsOneUptime(data.text)) {
    statuses.push(
      (
        await deliver(
          eventCallback({ ...common, type: "app_mention" }),
          data.headers,
        )
      ).status,
    );
  }

  statuses.push(
    (
      await deliver(
        eventCallback({
          ...common,
          type: "message",
          channel_type: data.channelType || "channel",
        }),
        data.headers,
      )
    ).status,
  );

  return { ts: ts, statuses: statuses };
}

// Somebody writes to the app in its direct messages ("Messages" tab).
async function directMessage(data: {
  user: string;
  text: string;
  threadTs?: string | undefined;
}): Promise<Said> {
  const channel: string = `D${data.user.substring(1)}`;
  const ts: string = nextTs();

  if (!data.threadTs) {
    directMessages.set(channel, [
      { ts: ts, user: data.user, text: data.text },
      ...(directMessages.get(channel) || []),
    ]);
  }

  const event: JSONObject = {
    type: "message",
    user: data.user,
    text: data.text,
    ts: ts,
    channel: channel,
    channel_type: "im",
    client_msg_id: `00000000-0000-4000-8000-${ts.split(".").join("").slice(-12)}`,
  };

  if (data.threadTs) {
    event["thread_ts"] = data.threadTs;
    event["parent_user_id"] = data.user;
  }

  return {
    ts: ts,
    statuses: [(await deliver(eventCallback(event))).status],
  };
}

// ---- Waiting for what OneUptime does after its 200 ----

let debugLines: Array<string> = [];
let errorLines: Array<string> = [];

async function until(
  condition: () => boolean,
  what: string,
  attempts: number = 400,
): Promise<void> {
  for (let attempt: number = 0; attempt < attempts; attempt++) {
    if (condition()) {
      return;
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error(`Waited in vain for ${what}`);
}

function timesLogged(line: string): number {
  return debugLines.filter((logged: string): boolean => {
    return logged === line;
  }).length;
}

/*
 * The debug line OneUptime writes once it has decided, for good, not to
 * answer: `times` of them in all.
 */
async function untilLogged(line: string, times: number = 1): Promise<void> {
  await until((): boolean => {
    return timesLogged(line) >= times;
  }, `"${line}" logged ${times} time(s)`);
}

async function untilWrites(count: number): Promise<Array<SlackCall>> {
  await until((): boolean => {
    return writes().length >= count;
  }, `${count} request(s) posting to Slack`);

  /*
   * A placeholder whose answer is posted is removed right after it: waited
   * for too, so no request outlives the test.
   */
  await until((): boolean => {
    return removals().length >= answeredPlaceholders();
  }, "every answered placeholder removed");

  return writes();
}

// How many placeholders have their answer posted after them in their thread.
function answeredPlaceholders(): number {
  const posted: Array<SlackCall> = writes();
  let answered: number = 0;

  posted.forEach((call: SlackCall, index: number): void => {
    if (call.data["text"] !== ACKNOWLEDGEMENT) {
      return;
    }

    const isAnswered: boolean = posted
      .slice(index + 1)
      .some((later: SlackCall): boolean => {
        return (
          later.method === "chat.postMessage" &&
          later.data["channel"] === call.data["channel"] &&
          later.data["thread_ts"] === call.data["thread_ts"] &&
          later.data["text"] !== ACKNOWLEDGEMENT
        );
      });

    if (isAnswered) {
      answered++;
    }
  });

  return answered;
}

// ---- Who is who, and what OneUptime reads ----

let workspaceConnected: boolean = true;
let aiEnabled: boolean = true;
let linked: Map<string, ObjectID> = new Map();
let databaseReads: number = 0;

interface AssistantCall {
  question: string;
  userId: string;
  history: Array<{ role: string; content: string }> | undefined;
}

let assistantCalls: Array<AssistantCall> = [];

// The clock, moved on by a test: the cache's records expire against it.
let clockOffsetInMs: number = 0;
const realDateNow: () => number = Date.now.bind(Date);

function minutesPass(minutes: number): void {
  clockOffsetInMs += minutes * 60 * 1000;
}

// The thread of an incident's notification OneUptime posted to #ops.
let notificationTs: string = "";

beforeAll(async () => {
  app = await startSlackApp();
}, 600000);

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  threads.clear();
  directMessages.clear();
  slackCalls = [];
  placeholderTimestamps = [];
  refusals = new Map();
  debugLines = [];
  errorLines = [];
  workspaceConnected = true;
  aiEnabled = true;
  linked = new Map([
    [ALICE, ALICE_ID],
    [BOB, BOB_ID],
  ]);
  databaseReads = 0;
  assistantCalls = [];
  clockOffsetInMs = 0;
  (
    jest.requireMock("../../../Server/Infrastructure/GlobalCache") as {
      default: { store: Map<string, unknown> };
    }
  ).default.store.clear();

  notificationTs = nextTs();
  threads.set(threadKey(OPS, notificationTs), [
    {
      ts: notificationTs,
      user: ONEUPTIME,
      bot_id: ONEUPTIME_BOT_ID,
      text: "🔴 Incident INC-42 created: Checkout is down. Severity: Critical.",
    },
  ]);

  jest.spyOn(Date, "now").mockImplementation((): number => {
    return realDateNow() + clockOffsetInMs;
  });

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
    .mockImplementation((async () => {
      databaseReads++;

      if (!workspaceConnected) {
        return null;
      }

      const projectAuth: WorkspaceProjectAuthToken =
        new WorkspaceProjectAuthToken();
      projectAuth.projectId = PROJECT_ID;
      projectAuth.authToken = SLACK_PROJECT_TOKEN;
      projectAuth.miscData = { botUserId: ONEUPTIME } as never;
      return projectAuth;
    }) as never);
  // The workspace's connections, as WorkspaceProjectResolution reads them.
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "findBy")
    .mockImplementation((async (...args: Array<unknown>) => {
      const projectAuth: unknown = await (
        WorkspaceProjectAuthTokenService.findOneBy as unknown as (
          ...args: Array<unknown>
        ) => Promise<unknown>
      )(...args);
      return projectAuth ? [projectAuth] : [];
    }) as never);
  jest
    .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
    .mockImplementation((async (options: {
      query: { workspaceUserId: string };
    }) => {
      databaseReads++;

      const userId: ObjectID | undefined = linked.get(
        options.query.workspaceUserId,
      );

      if (!userId) {
        return null;
      }

      const userAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
      userAuth.userId = userId;
      return userAuth;
    }) as never);
  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockResolvedValue(PROPS);
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString(DASHBOARD_URL));
  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");
  jest.spyOn(AIService, "isProjectAIEnabled").mockImplementation(async () => {
    return aiEnabled;
  });
  jest.spyOn(AIService, "getReachedProjectDailyLimit").mockResolvedValue(null);
  /*
   * The project's AI credits, asked before every answer: none used up,
   * unless a test says so. With billing on, as CI runs Common, the real
   * check reads the project's LLM provider and balance from Postgres.
   */
  jest.spyOn(AIService, "getAiBalanceBlocker").mockResolvedValue(null);
  jest
    .spyOn(ObservabilityAssistant, "answerQuestion")
    .mockImplementation((async (data: {
      question: string;
      userId: ObjectID;
      history?: Array<{ role: string; content: string }> | undefined;
    }) => {
      assistantCalls.push({
        question: data.question,
        userId: data.userId.toString(),
        history: data.history,
      });

      return {
        contentInMarkdown: ANSWER_MARKDOWN,
        citations: [],
        totalTokens: 10,
        llmCallCount: 1,
        toolCallCount: 1,
      };
    }) as never);

  // Slack: every request is recorded, and answered as Slack would.
  jest.spyOn(API, "post").mockImplementation((async (options: {
    url: URL;
    data: JSONObject;
  }) => {
    const method: string = options.url.toString().split("/api/").pop() || "";
    slackCalls.push({ method: method, data: options.data });
    return new HTTPResponse<JSONObject>(
      200,
      answerSlack(method, options.data),
      {},
    );
  }) as never);

  jest.spyOn(logger, "debug").mockImplementation(((line: unknown) => {
    debugLines.push(String(line));
  }) as never);
  jest.spyOn(logger, "error").mockImplementation(((line: unknown) => {
    errorLines.push(String(line));
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---- What OneUptime posted ----

// An answer posted in a thread for everybody: chat.postMessage.
function threadPost(
  channel: string,
  threadTs: string,
  text: string,
): SlackCall {
  return {
    method: "chat.postMessage",
    data: { channel: channel, thread_ts: threadTs, text: text },
  };
}

// The AI's answer to a question, in its thread: "Looking into it…", then the answer.
function aiAnswer(channel: string, threadTs: string): Array<SlackCall> {
  return [
    threadPost(channel, threadTs, ACKNOWLEDGEMENT),
    threadPost(channel, threadTs, ANSWER_TEXT),
  ];
}

// The text of a message's first section.
function sectionText(blocks: unknown): string {
  const first: JSONObject | undefined = ((blocks as
    | Array<JSONObject>
    | undefined) || [])[0];

  return ((first?.["text"] as JSONObject | undefined)?.["text"] ||
    "") as string;
}

// The press a Connect button keeps, read back from its link.
async function keptRequestOf(
  call: SlackCall,
): Promise<WorkspaceConnectRequestRecord | null> {
  const actions: JSONObject | undefined = (
    (call.data["blocks"] as Array<JSONObject> | undefined) || []
  ).find((block: JSONObject): boolean => {
    return block["type"] === "actions";
  });
  const button: JSONObject | undefined = (
    actions?.["elements"] as Array<JSONObject> | undefined
  )?.[0];

  expect((button?.["text"] as JSONObject | undefined)?.["text"]).toBe(
    "Connect Slack account",
  );

  const url: globalThis.URL = new globalThis.URL(String(button?.["url"]));
  const token: string | null = url.searchParams.get("connect");

  expect(`${url.origin}${url.pathname}`).toBe(
    `${DASHBOARD_URL}/${PROJECT_ID.toString()}/user-settings/slack-integration`,
  );
  expect(token).toMatch(CONNECT_REQUEST_TOKEN_PATTERN);

  return await WorkspaceConnectRequest.peek(token);
}

/*
 * The Connect prompt for a question, only the person sees it, in the
 * channel - and in the thread `threadTs`, when given.
 */
async function expectEphemeralPrompt(
  call: SlackCall,
  expected: { user: string; channel: string; threadTs?: string | undefined },
): Promise<void> {
  expect(call.method).toBe("chat.postEphemeral");
  expect(call.data["channel"]).toBe(expected.channel);
  expect(call.data["user"]).toBe(expected.user);
  expect(call.data["thread_ts"]).toBe(expected.threadTs);
  expect(call.data["text"]).toBe(CONNECT_PROMPT_NOTIFICATION);
  expect(sectionText(call.data["blocks"])).toBe(CONNECT_PROMPT_TEXT);

  const kept: WorkspaceConnectRequestRecord | null = await keptRequestOf(call);

  expect(kept?.projectId.toString()).toBe(PROJECT_ID.toString());
  expect(kept).toMatchObject({
    workspaceUserId: expected.user,
    purpose: "ask OneUptime AI",
    again: { kind: WorkspaceConnectRequestAgainKind.Question },
  });
  // Once connected, they are answered where they were asked.
  expect(kept?.slack).toEqual(
    expected.threadTs
      ? {
          teamId: TEAM_ID,
          channelId: expected.channel,
          threadTs: expected.threadTs,
        }
      : { teamId: TEAM_ID, channelId: expected.channel },
  );
  // And their settings page says to ask again: no button asked the question.
  expect(WorkspaceConnectCompletion.getAgainOutcome(kept?.again)).toBe(
    ConnectRequestOutcome.AskAgain,
  );
}

describe("#4768: people talking under one of OneUptime's notifications are not answered", () => {
  test("somebody without a connected account replies in the thread of an incident's notification, three times: Slack gets its 200 each time, and nothing else happens - nothing sent to Slack, nothing read from it or the database", async () => {
    for (const text of [
      "Looking at it now",
      "It was the 10:02 deploy, rolling back",
      "Back up, closing this out",
    ]) {
      const said: Said = await say({
        user: CAROL,
        text: text,
        threadTs: notificationTs,
      });

      expect(said.statuses).toEqual([200]);
    }

    await untilLogged(NOT_IN_A_CONVERSATION, 3);

    expect(slackCalls).toEqual([]);
    expect(databaseReads).toBe(0);
    expect(assistantCalls).toEqual([]);
    expect(errorLines).toEqual([]);
  });

  test("somebody with a connected account replies there: no answer from AI either - the AI is never asked", async () => {
    await say({ user: ALICE, text: "I'm on it", threadTs: notificationTs });
    await say({
      user: BOB,
      text: "Thanks, ping me if you need a hand",
      threadTs: notificationTs,
    });

    await untilLogged(NOT_IN_A_CONVERSATION, 2);

    expect(slackCalls).toEqual([]);
    expect(databaseReads).toBe(0);
    expect(assistantCalls).toEqual([]);
  });

  test.each([["group" as const], ["mpim" as const]])(
    "the same in a private channel or a group DM (%s)",
    async (channelType: "group" | "mpim") => {
      const channel: string = channelType === "group" ? "C0PRIVATE" : "C0MPIM";
      const ts: string = nextTs();
      threads.set(threadKey(channel, ts), [
        { ts: ts, user: ONEUPTIME, bot_id: ONEUPTIME_BOT_ID, text: "🔴 Alert" },
      ]);

      await say({
        user: CAROL,
        text: "Is this the same as yesterday?",
        channel: channel,
        threadTs: ts,
        channelType: channelType,
      });
      await say({
        user: ALICE,
        text: "Looks like it",
        channel: channel,
        threadTs: ts,
        channelType: channelType,
      });

      await untilLogged(NOT_IN_A_CONVERSATION, 2);
      expect(slackCalls).toEqual([]);
      expect(assistantCalls).toEqual([]);
    },
  );

  test("a reply in the thread of another app's message is not for OneUptime either - any bot in a thread used to count as OneUptime taking part", async () => {
    const ts: string = nextTs();
    threads.set(threadKey(OPS, ts), [
      { ts: ts, user: "U0GITHUB", bot_id: "B0GITHUB", text: "PR #12 merged" },
    ]);

    await say({
      user: ALICE,
      text: "Nice, deploying",
      threadTs: ts,
      parentUserId: "U0GITHUB",
    });

    await untilLogged(NOT_IN_A_CONVERSATION);
    expect(slackCalls).toEqual([]);
    expect(assistantCalls).toEqual([]);
  });

  test("a message at the top of a channel that mentions nobody: dropped before anything is read", async () => {
    const said: Said = await say({
      user: CAROL,
      text: "Is anybody looking at checkout?",
    });

    expect(said.statuses).toEqual([200]);
    expect(timesLogged(AT_THE_TOP)).toBe(1);
    expect(slackCalls).toEqual([]);
    expect(databaseReads).toBe(0);
  });

  test.each([
    ["mentions a colleague", `<@${BOB}> can you check the dashboards?`],
    ["mentions a colleague by the older form", `<@${BOB}|bob> over to you`],
    ["mentions a user group", "<!subteam^S0ONCALL> please take a look"],
    ["mentions everybody here", "<!here> rolling back now"],
    ["mentions the channel", "<!channel> status page updated"],
  ])(
    "a reply that %s is addressed to people: dropped before anything is read",
    async (_name: string, text: string) => {
      await say({ user: CAROL, text: text, threadTs: notificationTs });

      expect(timesLogged(MENTIONS_SOMEBODY)).toBe(1);
      expect(slackCalls).toEqual([]);
      expect(databaseReads).toBe(0);
    },
  );

  test.each([
    [
      "OneUptime's own message (bot_id)",
      { user: ONEUPTIME, bot_id: ONEUPTIME_BOT_ID, text: "✅ Resolved" },
    ],
    [
      "another app's message (bot_id)",
      { user: "U0GITHUB", bot_id: "B0GITHUB", text: "Deployed" },
    ],
    [
      "a legacy bot message (subtype bot_message)",
      { subtype: "bot_message", bot_id: "B0OLD", text: "Build passed" },
    ],
    [
      "an edit (subtype message_changed)",
      {
        subtype: "message_changed",
        hidden: true,
        message: { user: ALICE, text: "edited", ts: "1760000001.000100" },
      },
    ],
    [
      "a deletion (subtype message_deleted)",
      { subtype: "message_deleted", hidden: true, deleted_ts: "1.2" },
    ],
    [
      "a reply also sent to the channel (subtype thread_broadcast)",
      { subtype: "thread_broadcast", user: ALICE, text: "FYI all" },
    ],
    [
      "somebody joining (subtype channel_join)",
      { subtype: "channel_join", user: CAROL, text: "<@U0CAROL> has joined" },
    ],
  ])(
    "%s in a notification's thread: never answered",
    async (_name: string, fields: JSONObject) => {
      const ts: string = nextTs();

      const answer: { status: number } = await deliver(
        eventCallback({
          type: "message",
          channel: OPS,
          channel_type: "channel",
          ts: ts,
          thread_ts: notificationTs,
          ...fields,
        }),
      );

      expect(answer.status).toBe(200);
      expect(timesLogged(A_BOT_OR_A_CHANGE)).toBe(1);
      expect(slackCalls).toEqual([]);
      expect(databaseReads).toBe(0);
    },
  );
});

describe("@mentions are answered wherever they are", () => {
  test("an @mention in the thread of an incident's notification, from somebody connected: answered there by AI, which reads the thread", async () => {
    const said: Said = await say({
      user: ALICE,
      text: `<@${ONEUPTIME}> what changed before this started?`,
      threadTs: notificationTs,
    });

    // Slack sends the mention twice - app_mention and message - and gets its 200 for both.
    expect(said.statuses).toEqual([200, 200]);

    const posted: Array<SlackCall> = await untilWrites(2);

    expect(posted).toEqual(aiAnswer(OPS, notificationTs));
    expect(methodsOf(reads())).toEqual(["conversations.replies"]);
    expect(assistantCalls).toEqual([
      {
        question: "what changed before this started?",
        userId: ALICE_ID.toString(),
        history: [
          {
            role: "assistant",
            content:
              "🔴 Incident INC-42 created: Checkout is down. Severity: Critical.",
          },
        ],
      },
    ]);
    // The message event of the mention is not answered a second time.
    expect(timesLogged(MENTIONS_SOMEBODY)).toBe(1);
  });

  test("…and that does not make the notification's thread a conversation: her next reply there, with no mention, is for the people in it", async () => {
    await say({
      user: ALICE,
      text: `<@${ONEUPTIME}> what changed before this started?`,
      threadTs: notificationTs,
    });
    await untilWrites(2);

    await say({
      user: ALICE,
      text: "Thanks. Bob, can you roll that back?",
      threadTs: notificationTs,
    });

    await untilLogged(NOT_IN_A_CONVERSATION);
    expect(writes()).toHaveLength(2);
    expect(assistantCalls).toHaveLength(1);
  });

  test("an @mention in a thread people started: answered, and the thread is still theirs - a reply there without a mention is not answered", async () => {
    const root: Said = await say({
      user: BOB,
      text: "Anyone else seeing 502s on checkout?",
    });
    await say({
      user: ALICE,
      text: `<@${ONEUPTIME}> how many 502s in the last hour?`,
      threadTs: root.ts,
      parentUserId: BOB,
    });

    expect(await untilWrites(2)).toEqual(aiAnswer(OPS, root.ts));

    await say({
      user: ALICE,
      text: "and which hosts?",
      threadTs: root.ts,
      parentUserId: BOB,
    });

    await untilLogged(NOT_IN_A_CONVERSATION);
    expect(assistantCalls).toHaveLength(1);
  });

  test("an @mention with nothing after it: nothing to answer", async () => {
    await say({
      user: ALICE,
      text: `<@${ONEUPTIME}>`,
      threadTs: notificationTs,
    });

    await untilLogged("Slack AI Ops event has no question text. Skipping.");
    expect(writes()).toEqual([]);
    expect(assistantCalls).toEqual([]);
  });

  test("Slack's retry of an @mention it already delivered: acknowledged and dropped, before anything is read", async () => {
    await say({
      user: ALICE,
      text: `<@${ONEUPTIME}> what changed?`,
      threadTs: notificationTs,
      headers: {
        "x-slack-retry-num": "1",
        "x-slack-retry-reason": "http_timeout",
      },
    });

    expect(timesLogged(RETRY)).toBe(2);
    expect(slackCalls).toEqual([]);
    expect(databaseReads).toBe(0);
  });

  test("a Slack workspace connected to no project: nothing answered", async () => {
    workspaceConnected = false;

    await say({ user: ALICE, text: `<@${ONEUPTIME}> what is down?` });

    await untilLogged(
      "Slack AI Ops event: workspace not connected to any project.",
    );
    expect(slackCalls).toEqual([]);
  });

  /*
   * An answer ends with what it was read from. A source that gave one row
   * was written "(1 rows)".
   */
  test("the answer ends with its sources, each with its rows counted as the language counts them: 2 rows, 1 row", async () => {
    jest.spyOn(ObservabilityAssistant, "answerQuestion").mockResolvedValue({
      contentInMarkdown: ANSWER_MARKDOWN,
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

    const asked: Said = await say({
      user: ALICE,
      text: `<@${ONEUPTIME}> which monitors are down?`,
    });

    expect(await untilWrites(2)).toEqual([
      threadPost(OPS, asked.ts, ACKNOWLEDGEMENT),
      threadPost(
        OPS,
        asked.ts,
        `Two monitors are down: ${ZWSP}*API*${ZWSP} and ${ZWSP}*Checkout*${ZWSP}.\n\n${ZWSP}_Sources_${ZWSP}\n• Monitor statuses (2 rows)\n• Deployments (1 row)\n`,
      ),
    ]);
  });

  test("AI turned off: the @mention is told so in its thread, and AI is not asked", async () => {
    aiEnabled = false;

    await say({
      user: ALICE,
      text: `<@${ONEUPTIME}> what changed?`,
      threadTs: notificationTs,
    });

    expect(await untilWrites(1)).toEqual([
      threadPost(
        OPS,
        notificationTs,
        "AI features are disabled for this project. Enable them in Project Settings → AI → AI Features.",
      ),
    ]);
    expect(assistantCalls).toEqual([]);
  });
});

describe("a conversation with OneUptime AI: the thread under a question asked at the top of a channel", () => {
  async function aliceAsks(): Promise<string> {
    const asked: Said = await say({
      user: ALICE,
      text: `<@${ONEUPTIME}> which monitors are down?`,
    });

    // Answered in a thread under her question.
    expect(await untilWrites(2)).toEqual(aiAnswer(OPS, asked.ts));
    expect(reads()).toEqual([]);

    return asked.ts;
  }

  test("her reply in that thread, with no mention, is a follow-up: answered there, with what was said before", async () => {
    const threadTs: string = await aliceAsks();

    await say({
      user: ALICE,
      text: "since when?",
      threadTs: threadTs,
      parentUserId: ALICE,
    });

    expect((await untilWrites(4)).slice(2)).toEqual(aiAnswer(OPS, threadTs));
    expect(methodsOf(reads())).toEqual(["conversations.replies"]);
    expect(reads()[0]!.data).toEqual({
      channel: OPS,
      ts: threadTs,
      limit: 50,
    });
    expect(assistantCalls[1]).toEqual({
      question: "since when?",
      userId: ALICE_ID.toString(),
      history: [
        { role: "user", content: "which monitors are down?" },
        {
          role: "assistant",
          content: ANSWER_TEXT.trim(),
        },
      ],
    });
  });

  test("somebody else's reply in her conversation, with no mention, is for the people in it: not answered, and nothing read", async () => {
    const threadTs: string = await aliceAsks();
    const readsBefore: number = databaseReads;

    await say({
      user: BOB,
      text: "Checkout is down because of the deploy, I'm rolling back",
      threadTs: threadTs,
      parentUserId: ALICE,
    });

    await untilLogged(NOT_IN_A_CONVERSATION);
    expect(writes()).toHaveLength(2);
    expect(reads()).toEqual([]);
    expect(databaseReads).toBe(readsBefore);
    expect(assistantCalls).toHaveLength(1);
  });

  test("…until they @mention OneUptime there: then they are in it, and their own follow-ups need no mention", async () => {
    const threadTs: string = await aliceAsks();

    await say({
      user: BOB,
      text: `<@${ONEUPTIME}> show me the errors for checkout`,
      threadTs: threadTs,
      parentUserId: ALICE,
    });
    expect((await untilWrites(4)).slice(2)).toEqual(aiAnswer(OPS, threadTs));

    await say({
      user: BOB,
      text: "and for the API?",
      threadTs: threadTs,
      parentUserId: ALICE,
    });
    expect((await untilWrites(6)).slice(4)).toEqual(aiAnswer(OPS, threadTs));

    expect(
      assistantCalls.map((call: AssistantCall): string => {
        return `${call.userId}: ${call.question}`;
      }),
    ).toEqual([
      `${ALICE_ID.toString()}: which monitors are down?`,
      `${BOB_ID.toString()}: show me the errors for checkout`,
      `${BOB_ID.toString()}: and for the API?`,
    ]);
  });

  test("a conversation started before this release - its question in Slack, no record of it here: an @mention in it joins it all the same", async () => {
    const asked: Said = await say({
      user: ALICE,
      text: `<@${ONEUPTIME}|oneuptime> which monitors are down?`,
    });
    await untilWrites(2);
    // As if the conversation had been started before OneUptime kept them.
    (
      jest.requireMock("../../../Server/Infrastructure/GlobalCache") as {
        default: { store: Map<string, unknown> };
      }
    ).default.store.clear();

    await say({
      user: BOB,
      text: `<@${ONEUPTIME}> and the API?`,
      threadTs: asked.ts,
      parentUserId: ALICE,
    });
    await untilWrites(4);

    await say({
      user: BOB,
      text: "since when?",
      threadTs: asked.ts,
      parentUserId: ALICE,
    });

    expect((await untilWrites(6)).slice(4)).toEqual(aiAnswer(OPS, asked.ts));
  });

  test("somebody not connected replying in her conversation, with no mention: not answered at all - not even asked to connect", async () => {
    const threadTs: string = await aliceAsks();

    await say({
      user: CAROL,
      text: "is this related to the outage this morning?",
      threadTs: threadTs,
      parentUserId: ALICE,
    });

    await untilLogged(NOT_IN_A_CONVERSATION);
    expect(writes()).toHaveLength(2);
    expect(assistantCalls).toHaveLength(1);
  });

  test("…who @mentions OneUptime there is asked to connect in that thread, once: her replies there are not prompted again; once she has connected, they are answered with no mention", async () => {
    const threadTs: string = await aliceAsks();

    await say({
      user: CAROL,
      text: `<@${ONEUPTIME}> is this related to the outage this morning?`,
      threadTs: threadTs,
      parentUserId: ALICE,
    });

    const posted: Array<SlackCall> = await untilWrites(3);
    await expectEphemeralPrompt(posted[2]!, {
      user: CAROL,
      channel: OPS,
      threadTs: threadTs,
    });

    await say({
      user: CAROL,
      text: "hello?",
      threadTs: threadTs,
      parentUserId: ALICE,
    });
    await untilLogged(ASKED_ALREADY);
    expect(writes()).toHaveLength(3);

    linked.set(CAROL, BOB_ID);
    await say({
      user: CAROL,
      text: "is this related to the outage this morning?",
      threadTs: threadTs,
      parentUserId: ALICE,
    });

    expect((await untilWrites(5)).slice(3)).toEqual(aiAnswer(OPS, threadTs));
    expect(assistantCalls).toHaveLength(2);
  });

  test("a reply in her conversation that mentions a colleague is for the colleague: not answered", async () => {
    const threadTs: string = await aliceAsks();
    // Her question's own message event, a mention answered as such.
    expect(timesLogged(MENTIONS_SOMEBODY)).toBe(1);

    await say({
      user: ALICE,
      text: `<@${BOB}> can you take the API one?`,
      threadTs: threadTs,
      parentUserId: ALICE,
    });

    expect(timesLogged(MENTIONS_SOMEBODY)).toBe(2);
    expect(writes()).toHaveLength(2);
    expect(assistantCalls).toHaveLength(1);
  });

  test("a conversation stays open a week after its asker's last message there, and closes after", async () => {
    const threadTs: string = await aliceAsks();

    minutesPass(6 * 24 * 60);
    await say({
      user: ALICE,
      text: "is it still down?",
      threadTs: threadTs,
      parentUserId: ALICE,
    });
    await untilWrites(4);

    // Six days after that follow-up: still open, counted from it.
    minutesPass(6 * 24 * 60);
    await say({
      user: ALICE,
      text: "and now?",
      threadTs: threadTs,
      parentUserId: ALICE,
    });
    await untilWrites(6);

    // Over a week after the last one: closed.
    minutesPass(7 * 24 * 60 + 1);
    await say({
      user: ALICE,
      text: "one more question",
      threadTs: threadTs,
      parentUserId: ALICE,
    });

    await untilLogged(NOT_IN_A_CONVERSATION);
    expect(writes()).toHaveLength(6);
  });

  test("Slack cannot give the thread (rate limited): the follow-up is still answered, without what was said before", async () => {
    const threadTs: string = await aliceAsks();
    refusals.set("conversations.replies", "ratelimited");

    await say({
      user: ALICE,
      text: "since when?",
      threadTs: threadTs,
      parentUserId: ALICE,
    });

    expect((await untilWrites(4)).slice(2)).toEqual(aiAnswer(OPS, threadTs));
    expect(assistantCalls[1]?.history).toBeUndefined();
  });

  test("a conversation in a group DM works the same", async () => {
    const asked: Said = await say({
      user: ALICE,
      text: `<@${ONEUPTIME}> which monitors are down?`,
      channel: "C0MPIM",
      channelType: "mpim",
    });
    await untilWrites(2);

    await say({
      user: ALICE,
      text: "since when?",
      channel: "C0MPIM",
      channelType: "mpim",
      threadTs: asked.ts,
      parentUserId: ALICE,
    });

    expect((await untilWrites(4)).slice(2)).toEqual(
      aiAnswer("C0MPIM", asked.ts),
    );
  });
});

describe("somebody without a connected account is asked to connect once in a conversation, where they see it", () => {
  test("an @mention in a notification's thread: asked there, only to them, with the Connect button that keeps where they asked - and AI is not asked", async () => {
    await say({
      user: CAROL,
      text: `<@${ONEUPTIME}> what changed?`,
      threadTs: notificationTs,
    });

    const posted: Array<SlackCall> = await untilWrites(1);

    expect(methodsOf(posted)).toEqual(["chat.postEphemeral"]);
    await expectEphemeralPrompt(posted[0]!, {
      user: CAROL,
      channel: OPS,
      threadTs: notificationTs,
    });
    expect(reads()).toEqual([]);
    expect(assistantCalls).toEqual([]);
  });

  test("…asking again in the same thread: no second prompt; the first is right above", async () => {
    await say({
      user: CAROL,
      text: `<@${ONEUPTIME}> what changed?`,
      threadTs: notificationTs,
    });
    await untilWrites(1);

    await say({
      user: CAROL,
      text: `<@${ONEUPTIME}> hello?`,
      threadTs: notificationTs,
    });
    await say({
      user: CAROL,
      text: `<@${ONEUPTIME}> anyone?`,
      threadTs: notificationTs,
    });

    await untilLogged(ASKED_ALREADY, 2);
    expect(writes()).toHaveLength(1);
  });

  test("…in another thread: asked there too, since a prompt shows only in its own thread", async () => {
    await say({
      user: CAROL,
      text: `<@${ONEUPTIME}> what changed?`,
      threadTs: notificationTs,
    });
    await untilWrites(1);

    const root: Said = await say({ user: BOB, text: "Deploy at 10:02" });
    await say({
      user: CAROL,
      text: `<@${ONEUPTIME}> did that deploy break checkout?`,
      threadTs: root.ts,
      parentUserId: BOB,
    });

    const posted: Array<SlackCall> = await untilWrites(2);
    await expectEphemeralPrompt(posted[1]!, {
      user: CAROL,
      channel: OPS,
      threadTs: root.ts,
    });
  });

  test("…and in the same thread again once that prompt's Connect button has expired (30 minutes), with a new one", async () => {
    await say({
      user: CAROL,
      text: `<@${ONEUPTIME}> what changed?`,
      threadTs: notificationTs,
    });
    const first: Array<SlackCall> = await untilWrites(1);

    minutesPass(29);
    await say({
      user: CAROL,
      text: `<@${ONEUPTIME}> what changed?`,
      threadTs: notificationTs,
    });
    await untilLogged(ASKED_ALREADY);

    minutesPass(2);
    await say({
      user: CAROL,
      text: `<@${ONEUPTIME}> what changed?`,
      threadTs: notificationTs,
    });

    const posted: Array<SlackCall> = await untilWrites(2);
    await expectEphemeralPrompt(posted[1]!, {
      user: CAROL,
      channel: OPS,
      threadTs: notificationTs,
    });
    // A new button: the first one's press is gone.
    expect(await keptRequestOf(first[0]!)).toBeNull();
  });

  test("a question at the top of a channel: asked under it in the channel - Slack shows a message only one person sees in a thread only once the thread has replies, and the question has none", async () => {
    await say({ user: DAVE, text: `<@${ONEUPTIME}> which monitors are down?` });

    const posted: Array<SlackCall> = await untilWrites(1);

    await expectEphemeralPrompt(posted[0]!, { user: DAVE, channel: OPS });
  });

  test("…and the thread under it is his conversation: his follow-up there is not prompted again while the button works, then is", async () => {
    const asked: Said = await say({
      user: DAVE,
      text: `<@${ONEUPTIME}> which monitors are down?`,
    });
    await untilWrites(1);

    await say({
      user: DAVE,
      text: "hello?",
      threadTs: asked.ts,
      parentUserId: DAVE,
    });
    await untilLogged(ASKED_ALREADY);

    minutesPass(31);
    await say({
      user: DAVE,
      text: "which monitors are down?",
      threadTs: asked.ts,
      parentUserId: DAVE,
    });

    const posted: Array<SlackCall> = await untilWrites(2);
    // Now the thread has replies, so the prompt goes in it.
    await expectEphemeralPrompt(posted[1]!, {
      user: DAVE,
      channel: OPS,
      threadTs: asked.ts,
    });
  });

  test("…and once he has connected, the same thread answers him", async () => {
    const asked: Said = await say({
      user: DAVE,
      text: `<@${ONEUPTIME}> which monitors are down?`,
    });
    await untilWrites(1);

    linked.set(DAVE, BOB_ID);
    await say({
      user: DAVE,
      text: "which monitors are down?",
      threadTs: asked.ts,
      parentUserId: DAVE,
    });

    expect((await untilWrites(3)).slice(1)).toEqual(aiAnswer(OPS, asked.ts));
  });

  test("a prompt Slack would take nowhere is not counted: the next @mention is asked again", async () => {
    // Not in the channel any more, and no direct message either.
    refusals.set("chat.postEphemeral", "user_not_in_channel");
    refusals.set("chat.postMessage", "cannot_dm_bot");

    await say({
      user: CAROL,
      text: `<@${ONEUPTIME}> what changed?`,
      threadTs: notificationTs,
    });
    await until((): boolean => {
      return errorLines.includes("Could not answer a Slack press anywhere.");
    }, "the prompt to reach nobody");

    refusals = new Map();
    await say({
      user: CAROL,
      text: `<@${ONEUPTIME}> what changed?`,
      threadTs: notificationTs,
    });

    await until((): boolean => {
      return (
        methodsOf(writes()).filter((method: string): boolean => {
          return method === "chat.postEphemeral";
        }).length === 2
      );
    }, "a second prompt");
    expect(timesLogged(ASKED_ALREADY)).toBe(0);
  });
});

describe("direct messages to the app", () => {
  test("from somebody connected: answered in a thread under the message, with the recent direct messages as what was said before", async () => {
    const sent: Said = await directMessage({
      user: ALICE,
      text: "which monitors are down?",
    });

    expect(sent.statuses).toEqual([200]);
    expect(await untilWrites(2)).toEqual(aiAnswer("D0ALICE", sent.ts));
    expect(reads()).toEqual([
      {
        method: "conversations.history",
        data: { channel: "D0ALICE", limit: 30 },
      },
    ]);
    expect(assistantCalls).toEqual([
      {
        question: "which monitors are down?",
        userId: ALICE_ID.toString(),
        history: [],
      },
    ]);
  });

  test("from somebody not connected: asked once, as a message of the app's own that stays in the conversation - not one that is gone once Slack reloads", async () => {
    await directMessage({ user: CAROL, text: "which monitors are down?" });

    const posted: Array<SlackCall> = await untilWrites(1);

    expect(methodsOf(posted)).toEqual(["chat.postMessage"]);
    expect(posted[0]!.data["channel"]).toBe(CAROL);
    expect(posted[0]!.data["text"]).toBe(CONNECT_PROMPT_NOTIFICATION);
    expect(sectionText(posted[0]!.data["blocks"])).toBe(CONNECT_PROMPT_TEXT);

    const kept: WorkspaceConnectRequestRecord | null = await keptRequestOf(
      posted[0]!,
    );
    /*
     * Once connected, they are answered in the direct messages too - by the
     * app's own message, so the press names no channel to answer in - and
     * the direct messages are what their settings page links back to.
     */
    expect(kept?.slack).toEqual({
      teamId: TEAM_ID,
      directMessageChannelId: "D0CAROL",
    });
    // And their settings page says to ask again: no button asked the question.
    expect(kept?.again).toEqual({
      kind: WorkspaceConnectRequestAgainKind.Question,
    });
    expect(WorkspaceConnectCompletion.getAgainOutcome(kept?.again)).toBe(
      ConnectRequestOutcome.AskAgain,
    );

    await directMessage({ user: CAROL, text: "hello?" });
    await directMessage({ user: CAROL, text: "are you there?" });
    await untilLogged(ASKED_ALREADY, 2);
    expect(writes()).toHaveLength(1);

    minutesPass(31);
    await directMessage({ user: CAROL, text: "which monitors are down?" });
    expect(methodsOf(await untilWrites(2))).toEqual([
      "chat.postMessage",
      "chat.postMessage",
    ]);
    expect(assistantCalls).toEqual([]);
  });

  test("OneUptime's own messages in a direct message are never answered", async () => {
    await deliver(
      eventCallback({
        type: "message",
        user: ONEUPTIME,
        bot_id: ONEUPTIME_BOT_ID,
        text: "Two monitors are down.",
        ts: nextTs(),
        channel: "D0ALICE",
        channel_type: "im",
      }),
    );

    expect(timesLogged(A_BOT_OR_A_CHANGE)).toBe(1);
    expect(slackCalls).toEqual([]);
    expect(databaseReads).toBe(0);
  });
});

/*
 * "HELP" IN THE APP'S DIRECT MESSAGES: THE COMMANDS, WITHOUT AI.
 *
 * Slack's reviewers write "help" in the Messages tab, in a project with no AI
 * model connected. It was a question for OneUptime AI like any other, so they
 * were told "AI features are disabled for this project" - or, not connected,
 * asked to connect. Now a direct message that is only the help word is
 * answered with what /oneuptime help lists, in a thread under it, for anybody
 * - and anything else is answered as before.
 */
describe("help in a direct message: the commands, with or without AI", () => {
  const AI_OFF: string =
    "AI features are disabled for this project. Enable them in Project Settings → AI → AI Features.";

  function helpText(): string {
    return SlackDirectMessageHelp.getAnswerText();
  }

  test("what it says: every command, as /oneuptime help lists them", () => {
    expect(helpText()).toContain(
      `👋 ${ZWSP}*Here's what \`/oneuptime\` can do*${ZWSP}`,
    );
    expect(helpText()).toContain(
      "•   `/oneuptime incident [title or number]`: declare an incident, or act on one by its number",
    );
    expect(helpText()).toContain("•   `/oneuptime help`: list every command");
  });

  test("from somebody connected, with AI off: the commands, in a thread under the message - AI is not asked, nothing is read", async () => {
    aiEnabled = false;

    const sent: Said = await directMessage({ user: ALICE, text: "help" });

    expect(sent.statuses).toEqual([200]);
    expect(await untilWrites(1)).toEqual([
      threadPost("D0ALICE", sent.ts, helpText()),
    ]);
    expect(reads()).toEqual([]);
    expect(assistantCalls).toEqual([]);
  });

  test("from somebody not connected: the commands too - not a Connect prompt", async () => {
    aiEnabled = false;

    const sent: Said = await directMessage({ user: CAROL, text: "Help?" });

    expect(await untilWrites(1)).toEqual([
      threadPost("D0CAROL", sent.ts, helpText()),
    ]);
    expect(assistantCalls).toEqual([]);

    // Asked again, answered again: the help is no prompt, asked once.
    const again: Said = await directMessage({ user: CAROL, text: "help" });

    expect(await untilWrites(2)).toEqual([
      threadPost("D0CAROL", sent.ts, helpText()),
      threadPost("D0CAROL", again.ts, helpText()),
    ]);
  });

  test("with AI on, from somebody connected: the commands, not an answer from AI", async () => {
    const sent: Said = await directMessage({ user: ALICE, text: "HELP" });

    expect(await untilWrites(1)).toEqual([
      threadPost("D0ALICE", sent.ts, helpText()),
    ]);
    expect(assistantCalls).toEqual([]);
  });

  test("with the app @mentioned, or the command typed as a message: the commands", async () => {
    const mentioned: Said = await directMessage({
      user: ALICE,
      text: `<@${ONEUPTIME}> help`,
    });

    expect(await untilWrites(1)).toEqual([
      threadPost("D0ALICE", mentioned.ts, helpText()),
    ]);

    const typed: Said = await directMessage({
      user: ALICE,
      text: " /oneuptime help",
    });

    expect(await untilWrites(2)).toEqual([
      threadPost("D0ALICE", mentioned.ts, helpText()),
      threadPost("D0ALICE", typed.ts, helpText()),
    ]);
    expect(assistantCalls).toEqual([]);
  });

  test("in a thread of the direct messages: answered in that thread", async () => {
    const asked: Said = await directMessage({
      user: ALICE,
      text: "which monitors are down?",
    });

    await untilWrites(2);

    const sent: Said = await directMessage({
      user: ALICE,
      text: "help",
      threadTs: asked.ts,
    });

    const posted: Array<SlackCall> = await untilWrites(3);

    expect(posted[2]).toEqual(threadPost("D0ALICE", asked.ts, helpText()));
    expect(sent.statuses).toEqual([200]);
    expect(assistantCalls).toHaveLength(1);
  });

  test("anything else is answered as before: a question with help in it goes to OneUptime AI", async () => {
    const sent: Said = await directMessage({
      user: ALICE,
      text: "help me find slow queries",
    });

    expect(await untilWrites(2)).toEqual(aiAnswer("D0ALICE", sent.ts));
    expect(assistantCalls).toEqual([
      {
        question: "help me find slow queries",
        userId: ALICE_ID.toString(),
        history: [],
      },
    ]);
  });

  test("…and with AI off, it is told so, as before", async () => {
    aiEnabled = false;

    const sent: Said = await directMessage({
      user: ALICE,
      text: "which monitors are down?",
    });

    expect(await untilWrites(1)).toEqual([
      threadPost("D0ALICE", sent.ts, AI_OFF),
    ]);
    expect(assistantCalls).toEqual([]);
  });

  test("…and somebody not connected is asked to connect, as before", async () => {
    await directMessage({ user: CAROL, text: "which monitors are down?" });

    const posted: Array<SlackCall> = await untilWrites(1);

    expect(posted[0]!.data["channel"]).toBe(CAROL);
    expect(posted[0]!.data["text"]).toBe(CONNECT_PROMPT_NOTIFICATION);
  });

  test("a Slack workspace connected to no project: nothing answered, as before", async () => {
    workspaceConnected = false;

    await directMessage({ user: ALICE, text: "help" });

    await untilLogged(
      "Slack AI Ops event: workspace not connected to any project.",
    );
    expect(slackCalls).toEqual([]);
  });

  test("help in a channel is a question for AI, as before: only a direct message is answered with the commands", async () => {
    const asked: Said = await say({
      user: ALICE,
      text: `<@${ONEUPTIME}> help`,
    });

    expect(await untilWrites(2)).toEqual(aiAnswer(OPS, asked.ts));
    expect(assistantCalls).toHaveLength(1);
  });
});

/*
 * "LOOKING INTO IT…" STANDS IN FOR AN ANSWER, AND GOES ONCE IT IS THERE.
 *
 * Each answer from OneUptime AI used to be two messages, and the first one
 * stayed for good: three of the nine messages of a short conversation said
 * "Looking into it…". It is removed once the answer is posted (chat.delete,
 * which the app's chat:write allows), and a question whose answer could not
 * be written is told so instead of being left on "Looking into it…".
 */
describe("the placeholder an answer stands behind", () => {
  test("removed once the answer is posted: exactly that message, after the answer, and the thread keeps the answer alone", async () => {
    const asked: Said = await say({
      user: ALICE,
      text: `<@${ONEUPTIME}> which monitors are down?`,
    });

    expect(await untilWrites(2)).toEqual(aiAnswer(OPS, asked.ts));

    expect(placeholderTimestamps).toHaveLength(1);
    expect(removals()).toEqual([
      {
        method: "chat.delete",
        data: { channel: OPS, ts: placeholderTimestamps[0] },
      },
    ]);
    // Removed after the answer was posted, never before it.
    expect(
      slackCalls.map((call: SlackCall): string => {
        return call.method;
      }),
    ).toEqual(["chat.postMessage", "chat.postMessage", "chat.delete"]);

    // What the thread reads now: the question, then the answer.
    expect(
      (threads.get(threadKey(OPS, asked.ts)) || []).map(
        (message: SlackMessageRecord): string => {
          return message.text;
        },
      ),
    ).toEqual([`<@${ONEUPTIME}> which monitors are down?`, ANSWER_TEXT]);
  });

  test("the answer could not be written: a short reply says so, and the placeholder goes all the same", async () => {
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockRejectedValue(new Error("the model timed out"));

    const asked: Said = await say({
      user: ALICE,
      text: `<@${ONEUPTIME}> which monitors are down?`,
    });

    expect(await untilWrites(2)).toEqual([
      threadPost(OPS, asked.ts, ACKNOWLEDGEMENT),
      threadPost(
        OPS,
        asked.ts,
        "Sorry, I ran into a problem answering that. Please try again in a minute.",
      ),
    ]);
    expect(removals()).toEqual([
      {
        method: "chat.delete",
        data: { channel: OPS, ts: placeholderTimestamps[0] },
      },
    ]);
  });

  /*
   * A project whose AI credits are used up - every new one - was told
   * "Please try again in a minute" on every question, which no retry
   * answers. Checked before the acknowledgement, as the AI switch and the
   * daily limits are: the reply says who can add credits, and where.
   */
  test("the project's AI credits are used up: one reply that says who can add them and where - no placeholder, and AI is not asked", async () => {
    jest
      .spyOn(AIService, "getAiBalanceBlocker")
      .mockResolvedValue(
        "This project's AI credit balance is used up and auto-recharge is off, so OneUptime AI cannot run.",
      );
    const answer: SpyInstance<typeof ObservabilityAssistant.answerQuestion> =
      jest.spyOn(ObservabilityAssistant, "answerQuestion");

    const asked: Said = await say({
      user: ALICE,
      text: `<@${ONEUPTIME}> which monitors are down?`,
    });

    expect(await untilWrites(1)).toEqual([
      threadPost(OPS, asked.ts, PROJECT_AI_CREDITS_USED_UP_MESSAGE),
    ]);
    expect(placeholderTimestamps).toEqual([]);
    expect(answer).not.toHaveBeenCalled();
  });

  test("the credits run out while the answer is written: the refusal, not 'try again in a minute', and the placeholder goes", async () => {
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockRejectedValue(
        new BadDataException(PROJECT_AI_CREDITS_USED_UP_MESSAGE),
      );

    const asked: Said = await say({
      user: ALICE,
      text: `<@${ONEUPTIME}> which monitors are down?`,
    });

    expect(await untilWrites(2)).toEqual([
      threadPost(OPS, asked.ts, ACKNOWLEDGEMENT),
      threadPost(OPS, asked.ts, PROJECT_AI_CREDITS_USED_UP_MESSAGE),
    ]);
    expect(removals()).toHaveLength(1);
  });

  test("Slack will not remove the placeholder: the answer stands, and nothing is thrown", async () => {
    refusals.set("chat.delete", "cant_delete_message");

    const asked: Said = await say({
      user: ALICE,
      text: `<@${ONEUPTIME}> which monitors are down?`,
    });

    expect(await untilWrites(2)).toEqual(aiAnswer(OPS, asked.ts));
    expect(removals()).toHaveLength(1);
    expect(errorLines).toEqual([]);
  });

  test("in a direct message the placeholder goes too", async () => {
    const sent: Said = await directMessage({
      user: ALICE,
      text: "which monitors are down?",
    });

    expect(await untilWrites(2)).toEqual(aiAnswer("D0ALICE", sent.ts));
    expect(removals()).toEqual([
      {
        method: "chat.delete",
        data: { channel: "D0ALICE", ts: placeholderTimestamps[0] },
      },
    ]);
  });
});

/*
 * A SLACK WORKSPACE CONNECTED TO MORE THAN ONE PROJECT.
 *
 * A question used to be answered in whichever of the workspace's projects
 * a lookup returned first - with that project's data, or a request to
 * connect an account the asker had connected in the other. Now it is asked
 * in the project of the channel it is asked in, or else the one project the
 * asker is in (WorkspaceProjectResolution); when neither tells, the asker is
 * told so, only to them, and AI is not asked.
 */
describe("a Slack workspace connected to more than one project", () => {
  const OTHER_PROJECT: ObjectID = new ObjectID(
    "c4768000-0000-4000-8000-0000000000ee",
  );

  let memberOf: Array<ObjectID>;
  let channelOwnerProject: ObjectID | null;
  let readIn: Array<string>;

  function connection(projectId: ObjectID): WorkspaceProjectAuthToken {
    const projectAuth: WorkspaceProjectAuthToken =
      new WorkspaceProjectAuthToken();
    projectAuth.projectId = projectId;
    projectAuth.authToken = SLACK_PROJECT_TOKEN;
    projectAuth.miscData = { botUserId: ONEUPTIME } as never;
    return projectAuth;
  }

  beforeEach(() => {
    memberOf = [OTHER_PROJECT, PROJECT_ID];
    channelOwnerProject = null;
    readIn = [];

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockResolvedValue([connection(OTHER_PROJECT), connection(PROJECT_ID)]);

    // Alice is connected in each project she is a member of.
    jest
      .spyOn(WorkspaceUserAuthTokenService, "findBy")
      .mockImplementation((async (findBy: {
        query: { workspaceUserId: string };
      }) => {
        const userId: ObjectID | undefined = linked.get(
          findBy.query.workspaceUserId,
        );

        if (!userId) {
          return [];
        }

        return memberOf.map((projectId: ObjectID): WorkspaceUserAuthToken => {
          const link: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
          link.projectId = projectId;
          link.userId = userId;
          return link;
        });
      }) as never);
    jest
      .spyOn(WorkspaceActionAuthorization, "isProjectMember")
      .mockResolvedValue(true);

    // The channel's record, when a test gives it one; no notification posts.
    jest.spyOn(IncidentService, "findBy").mockImplementation((async () => {
      if (!channelOwnerProject) {
        return [];
      }

      const incident: Incident = new Incident();
      incident.id = ObjectID.generate();
      incident.projectId = channelOwnerProject;
      return [incident];
    }) as never);

    for (const service of [
      AlertService,
      IncidentEpisodeService,
      AlertEpisodeService,
      ScheduledMaintenanceService,
    ] as unknown as Array<{ findBy: () => Promise<unknown> }>) {
      jest.spyOn(service, "findBy").mockResolvedValue([] as never);
    }

    jest
      .spyOn(WorkspaceNotificationLogService, "findOneBy")
      .mockResolvedValue(null);

    // Which project the asker was read in.
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockImplementation(
        async (data: { userId: ObjectID; projectId: ObjectID }) => {
          readIn.push(data.projectId.toString());
          return PROPS;
        },
      );
  });

  test("Alice, in both, @mentions OneUptime at the top of #ops: told which projects she is in, only to her - AI is not asked", async () => {
    await say({ user: ALICE, text: `<@${ONEUPTIME}> what is down?` });

    const posted: Array<SlackCall> = await untilWrites(1);

    expect(methodsOf(posted)).toEqual(["chat.postEphemeral"]);
    expect(posted[0]!.data["user"]).toBe(ALICE);
    expect(JSON.stringify(posted[0]!.data)).toContain(
      "connected to more than one OneUptime project",
    );
    expect(assistantCalls).toEqual([]);
    expect(readIn).toEqual([]);
  });

  test("…in a channel an incident of one project owns: answered by AI, as her, in that project", async () => {
    channelOwnerProject = PROJECT_ID;

    const asked: Said = await say({
      user: ALICE,
      text: `<@${ONEUPTIME}> what is down?`,
    });

    expect(await untilWrites(2)).toEqual(aiAnswer(OPS, asked.ts));
    expect(assistantCalls).toHaveLength(1);
    expect(readIn).toEqual([PROJECT_ID.toString()]);
  });

  test("a direct message from Alice, in one of the projects: answered for that project", async () => {
    memberOf = [PROJECT_ID];

    const sent: Said = await directMessage({
      user: ALICE,
      text: "which monitors are down?",
    });

    expect(await untilWrites(2)).toEqual(aiAnswer("D0ALICE", sent.ts));
    expect(readIn).toEqual([PROJECT_ID.toString()]);
  });

  test("Carol, connected in neither, @mentions OneUptime: told where to connect - no one project's Connect button", async () => {
    await say({ user: CAROL, text: `<@${ONEUPTIME}> what is down?` });

    const posted: Array<SlackCall> = await untilWrites(1);

    expect(methodsOf(posted)).toEqual(["chat.postEphemeral"]);
    expect(JSON.stringify(posted[0]!.data)).toContain(
      "isn't connected in any of them yet",
    );
    expect(JSON.stringify(posted[0]!.data)).not.toContain(DASHBOARD_URL);
    expect(assistantCalls).toEqual([]);
  });
});
