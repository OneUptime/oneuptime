import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Issue #4111: in Microsoft Teams, "create incident" and "create maintenance"
 * answered "Sorry, I encountered an error processing your request. Please try
 * again later.", and every such bubble showed up TWICE. The form was too large
 * for Teams (413 MessageSizeTooBig), and handleBotMessageActivity replied and
 * then RETHREW: the CloudAdapter (it has no onTurnError) answered Teams HTTP
 * 500, and Teams delivered the same activity again, which failed and replied
 * a second time. Any failure doubled that way, not only the 413.
 *
 * This file pins the message-level half of the fix, with a fake TurnContext:
 *
 * - handleBotMessageActivity never rejects. Whatever fails, the user gets
 *   exactly one reply, and it names the activity id, which the error log line
 *   names too, so an administrator can find what went wrong. That line names
 *   the command ("incident", "ask", or "a 43-character question"),
 *   never the text, which can carry what does not belong in an error log; the
 *   error itself follows it, with its stack, unless it is a Bot Framework
 *   HTTP error, whose status and code the line already gives.
 * - "incident <title>" and "maintenance <title>" - the words Slack's
 *   /oneuptime takes, read for both chats by WorkspaceCommands - and "create
 *   incident <title>" and "create maintenance <title>", as Teams took them
 *   before, go to MicrosoftTeamsCreateCommands with the title as the user
 *   typed it; "oncall" goes to MicrosoftTeamsCommands; help is a reply that
 *   mentions whoever asked, listing every command, and a command misspelt
 *   gets it too, with the command it looks like; the "show ..." commands go
 *   to MicrosoftTeamsCommands.handleListCommand, which reads them as the
 *   member (WorkspaceOpenRecords), and "ask" to the assistant.
 * - A redelivered activity (same conversation, same id) is dropped, also when
 *   Teams retries a slow first delivery that is still being handled: the id
 *   is claimed before the work, not after it. The claim is kept in this
 *   process's memory as well as in Redis, so a redelivery is dropped even if
 *   Redis came back since the first delivery, which it never heard of. A
 *   message the bot does not answer (no @mention in a channel or group chat)
 *   is ignored WITHOUT claiming its id.
 * - getUnexpectedErrorMessage,
 *   recoverFromFailedTurn (the last line of defence processBotActivity puts
 *   around every turn) and the catch of handleBotInvokeActivity: one reply
 *   that says why, sent best-effort, never a throw; and the failure logged
 *   the same way as above, OneUptime's exceptions by their class.
 *
 * The real botbuilder stack (413s, HTTP statuses, Teams' redelivery) runs in
 * MicrosoftTeamsCreateCommandsEndToEnd.test.ts. Here everything that touches
 * the database is stubbed. The bot drops an activity id it has already
 * handled for ten minutes, in this process's memory (Redis is stubbed out as
 * not connected, see beforeEach), so every test sends activities with ids of
 * its own.
 */

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

/*
 * Same botbuilder module factory as MicrosoftTeamsTeamInstalls.test.ts: the
 * repo-wide manual mock (Tests/__mocks__/botbuilder.js) does not expose
 * TeamsInfo or MessageFactory.attachment, which MicrosoftTeams.ts uses.
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

import type { SpyInstance } from "jest-mock";
import MicrosoftTeamsUtil, {
  MicrosoftTeamsTenantResolution,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsActivityDeduplicator from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsActivityDeduplicator";
import MicrosoftTeamsCreateCommands from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCreateCommands";
import MicrosoftTeamsCommands, {
  MicrosoftTeamsListCommand,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCommands";
import MicrosoftTeamsActionAnswer, {
  MicrosoftTeamsAnswerLink,
  MicrosoftTeamsMention,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsActionAnswer";
import { MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE } from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsReplies";
import { WorkspaceAnswer } from "../../../../Server/Utils/Workspace/WorkspaceActionAnswers";
import {
  WorkspaceCommandMisspelling,
  WorkspaceCommandName,
} from "../../../../Server/Utils/Workspace/WorkspaceCommands";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsAccountNotLinkedException,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Auth";
import MicrosoftTeamsIncidentActions from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Incident";
import { MicrosoftTeamsIncidentActionType } from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import logger, { LogAttributes } from "../../../../Server/Utils/Logger";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import DatabaseNotConnectedException from "../../../../Types/Exception/DatabaseNotConnectedException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { CONNECT_REQUEST_TOKEN_PATTERN } from "../../../../Types/Workspace/ConnectCallback";
import type { Activity, ResourceResponse, TurnContext } from "botbuilder";

// ---- Fixtures ----

const BOT_ID: string = "28:0b8e3f5a-7c1d-4e2f-9a3b-5c6d7e8f9a0b";
const TENANT_ID: string = "8f3a2b1c-4111-4d5e-9f60-7a8b9c0d1e2f";
const USER_AAD_OBJECT_ID: string = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const SERVICE_URL: string = "https://smba.trafficmanager.net/amer/";
const PERSONAL_CHAT_ID: string = "a:1pQ3dFxkGqKZ8Yv0cWm7bT2nR5sL9hJ4uE6oA";
const OTHER_PERSONAL_CHAT_ID: string = "a:1zZ9yY8xX7wW6vV5uU4tT3sS2rR1qQ0pP";
const GROUP_CHAT_ID: string = "19:4b1d7c9e0f2a4b6c8d0e2f4a6b8c0d2e@thread.v2";
const TEAM_ID: string = "19:team-engineering@thread.tacv2";
const CHANNEL_ID: string = "19:general-engineering@thread.tacv2";
const CHANNEL_THREAD_ID: string = `${CHANNEL_ID};messageid=1727712000000`;
const DASHBOARD_URL: string = "https://oneuptime.example.com/dashboard";

const PROJECT_ID: ObjectID = ObjectID.generate();
const ONEUPTIME_USER_ID: ObjectID = ObjectID.generate();
const INCIDENT_ID: ObjectID = ObjectID.generate();

// How the @mention of the bot appears in the text Teams delivers.
const BOT_MENTION_TEXT: string = "<at>OneUptime</at>";

// Another member of the chat, whom a message can @mention instead of the bot.
const OTHER_MEMBER_ID: string = "29:1Bq7-bob-oncall-teams-user";
const OTHER_MEMBER_MENTION_TEXT: string = "<at>Bob Oncall</at>";

const UNEXPECTED_ERROR_TEXT: string =
  "Sorry, something went wrong in OneUptime while handling that message. Please try again in a minute.";

// What master answered to every failure, and then rethrew.
const MASTER_ERROR_TEXT: string =
  "Sorry, I encountered an error processing your request. Please try again later.";

const ACTION_FAILED_TEXT: string =
  "Sorry, that action failed. Please try again later.";

// ---- The private statics this file stubs or reads ----

// What the stubbed "show ..." handler answers, unless a test says otherwise.
const CANNED_LIST_REPLY: string = "✅ No open incidents.";

/*
 * Private statics of MicrosoftTeamsUtil, reached through a cast the way
 * neighbouring suites reach captureChatFromBotActivity.
 */
interface MicrosoftTeamsUtilInternals {
  captureChatFromBotActivity: (data: {
    activity: JSONObject;
    turnContext: TurnContext;
    onlyIfMissingOrStale?: boolean | undefined;
  }) => Promise<void>;
  answerObservabilityQuestion: (data: {
    activity: JSONObject;
    turnContext: TurnContext;
    projectId: ObjectID;
    question: string;
  }) => Promise<void>;
}

const internals: MicrosoftTeamsUtilInternals =
  MicrosoftTeamsUtil as unknown as MicrosoftTeamsUtilInternals;

// Who the messages here are from, as a reply mentions them.
const SENDER_MENTION: MicrosoftTeamsMention = {
  id: "29:1Hk8-teams-user",
  name: "Alice Admin",
};

// The help, as Microsoft Teams shows it.
const HELP_ANSWER: WorkspaceAnswer = MicrosoftTeamsCommands.getHelpAnswer();

/*
 * The answer to "help", as the bot sends it: a card that mentions whoever
 * asked (MicrosoftTeamsActionAnswer), listing the commands Slack's
 * /oneuptime takes and Teams' own lists - and, after a command misspelt,
 * one short answer instead: the command it looks like.
 */
function helpReply(misspelt?: WorkspaceCommandMisspelling): Partial<Activity> {
  const answer: WorkspaceAnswer = misspelt
    ? MicrosoftTeamsCommands.getMisspellingAnswer(misspelt)
    : MicrosoftTeamsCommands.getHelpAnswer();

  return {
    attachments: [
      {
        contentType: MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
        content: MicrosoftTeamsActionAnswer.buildCard({
          answer: answer,
          mention: SENDER_MENTION,
          // The help leads somewhere; the answer to a misspelling does not.
          links: misspelt ? undefined : helpLinks,
        }),
      },
    ],
    summary: answer.text,
  };
}

// The help's buttons, on this server's own address.
let helpLinks: Array<MicrosoftTeamsAnswerLink> = [];
let HELP_REPLY: Partial<Activity> = helpReply();

beforeAll(async () => {
  helpLinks = await MicrosoftTeamsCommands.getHelpLinks({ isConnected: true });
  HELP_REPLY = helpReply();
});

type CreateCommandInput = Parameters<
  typeof MicrosoftTeamsCreateCommands.handleCreateIncidentCommand
>[0];

type InvokeHandlerInput = Parameters<
  typeof MicrosoftTeamsUtil.handleBotInvokeActivity
>[0];

interface Stubs {
  resolveTenant: SpyInstance<
    typeof MicrosoftTeamsUtil.resolveProjectByTenantId
  >;
  // A pass-through spy: the real in-process dedupe runs.
  claim: SpyInstance<typeof MicrosoftTeamsActivityDeduplicator.claim>;
  // The dedupe's Redis claim: refused (not connected) unless a test says so.
  redisClaim: SpyInstance<typeof GlobalCache.setStringIfNotExists>;
  captureChat: SpyInstance<
    MicrosoftTeamsUtilInternals["captureChatFromBotActivity"]
  >;
  captureTeam: SpyInstance<
    typeof MicrosoftTeamsUtil.captureTeamFromBotActivity
  >;
  createIncident: SpyInstance<
    typeof MicrosoftTeamsCreateCommands.handleCreateIncidentCommand
  >;
  createMaintenance: SpyInstance<
    typeof MicrosoftTeamsCreateCommands.handleCreateScheduledMaintenanceCommand
  >;
  onCall: SpyInstance<typeof MicrosoftTeamsCommands.handleOnCallCommand>;
  askAssistant: SpyInstance<
    MicrosoftTeamsUtilInternals["answerObservabilityQuestion"]
  >;
  // Teams' own lists, read as the member (MicrosoftTeamsCommands).
  listCommand: SpyInstance<typeof MicrosoftTeamsCommands.handleListCommand>;
}

let stubs: Stubs;

function tenantResolvedToProject(): MicrosoftTeamsTenantResolution {
  return {
    projectAuth: {
      projectId: PROJECT_ID,
    } as unknown as WorkspaceProjectAuthToken,
    isAmbiguous: false,
    candidateProjectIds: [PROJECT_ID],
  };
}

beforeEach(() => {
  /*
   * The dedupe claims an activity in Redis first. Nothing connects Redis in
   * unit tests, so every claim falls back to this process's memory; the stub
   * makes that explicit, so a reachable Redis (whose keys outlive the run,
   * while the activity ids here are the same on every run) can never turn a
   * first delivery into a "repeat".
   */
  stubs = {
    resolveTenant: jest
      .spyOn(MicrosoftTeamsUtil, "resolveProjectByTenantId")
      .mockResolvedValue(tenantResolvedToProject()),
    claim: jest.spyOn(MicrosoftTeamsActivityDeduplicator, "claim"),
    redisClaim: jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockRejectedValue(
        new DatabaseNotConnectedException("Cache is not connected"),
      ),
    captureChat: jest
      .spyOn(internals, "captureChatFromBotActivity")
      .mockResolvedValue(undefined),
    captureTeam: jest
      .spyOn(MicrosoftTeamsUtil, "captureTeamFromBotActivity")
      .mockResolvedValue(undefined),
    createIncident: jest
      .spyOn(MicrosoftTeamsCreateCommands, "handleCreateIncidentCommand")
      .mockResolvedValue(undefined),
    createMaintenance: jest
      .spyOn(
        MicrosoftTeamsCreateCommands,
        "handleCreateScheduledMaintenanceCommand",
      )
      .mockResolvedValue(undefined),
    onCall: jest
      .spyOn(MicrosoftTeamsCommands, "handleOnCallCommand")
      .mockResolvedValue(undefined),
    askAssistant: jest
      .spyOn(internals, "answerObservabilityQuestion")
      .mockResolvedValue(undefined),
    /*
     * The list handler answers with one plain reply of its own, so what
     * the router does with a reply - and with a reply Teams refuses - shows.
     */
    listCommand: jest
      .spyOn(MicrosoftTeamsCommands, "handleListCommand")
      .mockImplementation(
        async (data: { turnContext: TurnContext }): Promise<void> => {
          await data.turnContext.sendActivity(CANNED_LIST_REPLY);
        },
      ),
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

// No "show ..." list, create command, oncall or AI question ran.
function expectNoCommandRan(): void {
  expect(stubs.listCommand).not.toHaveBeenCalled();
  expect(stubs.createIncident).not.toHaveBeenCalled();
  expect(stubs.createMaintenance).not.toHaveBeenCalled();
  expect(stubs.onCall).not.toHaveBeenCalled();
  expect(stubs.askAssistant).not.toHaveBeenCalled();
}

// ---- A fake TurnContext that records what the bot sends ----

type Reply = string | Partial<Activity>;

// accept: Teams takes every reply. refuse-first: the first reply is refused.
type SendBehaviour = "accept" | "refuse-first" | "refuse-all";

interface FakeTurn {
  turnContext: TurnContext;
  // Every reply the bot tried to send, in order, whether Teams took it or not.
  attempted: Array<Reply>;
  // The replies Teams took: what the user sees in the chat.
  delivered: Array<Reply>;
}

interface FakeTurnContextFields {
  activity: JSONObject | undefined;
  responded: boolean;
  sendActivity: (reply: Reply) => Promise<ResourceResponse>;
}

// The RestError the Bot Connector throws when Teams refuses a reply.
function connectorError(data: {
  statusCode: number;
  code: string;
  message: string;
}): Error {
  return Object.assign(new Error(data.message), {
    name: "RestError",
    statusCode: data.statusCode,
    code: data.code,
    details: { error: { code: data.code, message: data.message } },
    response: { status: data.statusCode },
  });
}

function messageTooLarge(): Error {
  return connectorError({
    statusCode: 413,
    code: "MessageSizeTooBig",
    message: "Message size too large.",
  });
}

function connectorUnavailable(): Error {
  return connectorError({
    statusCode: 503,
    code: "ServiceUnavailable",
    message: "The service is temporarily unavailable.",
  });
}

function buildTurn(data: {
  activity: JSONObject | undefined;
  responded?: boolean | undefined;
  send?: SendBehaviour | undefined;
  sendError?: Error | undefined;
}): FakeTurn {
  const attempted: Array<Reply> = [];
  const delivered: Array<Reply> = [];
  const behaviour: SendBehaviour = data.send || "accept";

  const fields: FakeTurnContextFields = {
    activity: data.activity,
    responded: data.responded || false,
    sendActivity: async (reply: Reply): Promise<ResourceResponse> => {
      attempted.push(reply);

      if (
        behaviour === "refuse-all" ||
        (behaviour === "refuse-first" && attempted.length === 1)
      ) {
        throw data.sendError || messageTooLarge();
      }

      delivered.push(reply);
      fields.responded = true;
      return { id: `bot-reply-${delivered.length}` };
    },
  };

  return {
    turnContext: fields as unknown as TurnContext,
    attempted: attempted,
    delivered: delivered,
  };
}

function textOf(reply: Reply | undefined): string {
  if (typeof reply === "string") {
    return reply;
  }

  return reply?.text || "";
}

// One inbound message, handled the way processBotActivity hands it over.
async function deliver(
  activity: JSONObject,
  options?: {
    send?: SendBehaviour | undefined;
    sendError?: Error | undefined;
  },
): Promise<FakeTurn> {
  const turn: FakeTurn = buildTurn({
    activity: activity,
    send: options?.send,
    sendError: options?.sendError,
  });

  await MicrosoftTeamsUtil.handleBotMessageActivity({
    activity: activity,
    turnContext: turn.turnContext,
  });

  return turn;
}

// A promise a test opens by hand, to hold a handler at a chosen point.
interface Gate {
  opened: Promise<void>;
  open: () => void;
}

function createGate(): Gate {
  let resolveGate: () => void = (): void => {
    return undefined;
  };
  const opened: Promise<void> = new Promise<void>((resolve: () => void) => {
    resolveGate = resolve;
  });

  return {
    opened: opened,
    open: (): void => {
      resolveGate();
    },
  };
}

// ---- Teams activities ----

let lastActivityNumber: number = 0;

// Teams activity ids look like "1727712345678"; every call returns a new one.
function nextActivityId(): string {
  lastActivityNumber += 1;
  return `17277124${String(lastActivityNumber).padStart(5, "0")}`;
}

function idOf(activity: JSONObject): string {
  return activity["id"] as string;
}

function clientInfoEntity(): JSONObject {
  return {
    type: "clientInfo",
    locale: "en-US",
    country: "US",
    platform: "Web",
    timezone: "America/New_York",
  };
}

function botMentionEntity(): JSONObject {
  return {
    type: "mention",
    mentioned: { id: BOT_ID, name: "OneUptime" },
    text: BOT_MENTION_TEXT,
  };
}

function otherMemberMentionEntity(): JSONObject {
  return {
    type: "mention",
    mentioned: { id: OTHER_MEMBER_ID, name: "Bob Oncall" },
    text: OTHER_MEMBER_MENTION_TEXT,
  };
}

// Whom a message in a group chat or channel @mentions.
type Mention = "the bot" | "someone else" | "nobody";

// The text and entities Teams delivers for a message with that @mention.
function withMention(
  text: string,
  mention: Mention,
): { text: string; entities: Array<JSONObject> } {
  if (mention === "the bot") {
    return {
      text: `${BOT_MENTION_TEXT} ${text}`,
      entities: [botMentionEntity(), clientInfoEntity()],
    };
  }

  if (mention === "someone else") {
    return {
      text: `${OTHER_MEMBER_MENTION_TEXT} ${text}`,
      entities: [otherMemberMentionEntity(), clientInfoEntity()],
    };
  }

  return { text: text, entities: [clientInfoEntity()] };
}

// A message typed to the bot in a personal (1:1) chat, as Teams delivers it.
function personalMessage(text: string, overrides?: JSONObject): JSONObject {
  return {
    type: "message",
    id: nextActivityId(),
    text: text,
    from: {
      id: "29:1Hk8-teams-user",
      name: "Alice Admin",
      aadObjectId: USER_AAD_OBJECT_ID,
    },
    recipient: { id: BOT_ID, name: "OneUptime" },
    conversation: {
      conversationType: "personal",
      id: PERSONAL_CHAT_ID,
      tenantId: TENANT_ID,
    },
    channelData: { tenant: { id: TENANT_ID } },
    entities: [clientInfoEntity()],
    serviceUrl: SERVICE_URL,
    ...(overrides || {}),
  };
}

// A message in a group chat, which the bot only answers when @mentioned.
function groupChatMessage(data: {
  text: string;
  mention: Mention;
  id?: string | undefined;
}): JSONObject {
  const message: { text: string; entities: Array<JSONObject> } = withMention(
    data.text,
    data.mention,
  );

  return personalMessage(message.text, {
    ...(data.id ? { id: data.id } : {}),
    conversation: {
      conversationType: "groupChat",
      id: GROUP_CHAT_ID,
      tenantId: TENANT_ID,
      isGroup: true,
    },
    entities: message.entities,
  });
}

// "@OneUptime <text>" in a group chat: the mention is in the text and entities.
function groupChatMention(text: string): JSONObject {
  return groupChatMessage({ text: text, mention: "the bot" });
}

// A message in a team channel, which the bot only answers when @mentioned.
function channelMessage(data: {
  text: string;
  mention: Mention;
  id: string;
  value?: JSONObject | undefined;
}): JSONObject {
  const message: { text: string; entities: Array<JSONObject> } = withMention(
    data.text,
    data.mention,
  );

  const activity: JSONObject = personalMessage(message.text, {
    id: data.id,
    conversation: {
      conversationType: "channel",
      id: CHANNEL_THREAD_ID,
      tenantId: TENANT_ID,
      isGroup: true,
    },
    channelData: {
      tenant: { id: TENANT_ID },
      team: { id: TEAM_ID, name: "Engineering" },
      channel: { id: CHANNEL_ID },
    },
    entities: message.entities,
  });

  if (data.value) {
    activity["value"] = data.value;
  }

  return activity;
}

// An Adaptive Card Action.Submit, which Teams delivers as a message with a value.
function cardSubmit(value: JSONObject): JSONObject {
  const activity: JSONObject = personalMessage("", { value: value });
  delete activity["text"];
  return activity;
}

// An Adaptive Card action delivered as an invoke activity.
function invokeActivity(value: JSONObject): JSONObject {
  return {
    type: "invoke",
    name: "adaptiveCard/action",
    id: nextActivityId(),
    from: {
      id: "29:1Hk8-teams-user",
      name: "Alice Admin",
      aadObjectId: USER_AAD_OBJECT_ID,
    },
    recipient: { id: BOT_ID, name: "OneUptime" },
    conversation: {
      conversationType: "personal",
      id: PERSONAL_CHAT_ID,
      tenantId: TENANT_ID,
    },
    channelData: { tenant: { id: TENANT_ID } },
    serviceUrl: SERVICE_URL,
    value: value,
  };
}

function acknowledgeIncidentValue(): JSONObject {
  return {
    action: MicrosoftTeamsIncidentActionType.AckIncident,
    actionValue: INCIDENT_ID.toString(),
  };
}

function silenceErrorLog(): SpyInstance<typeof logger.error> {
  return jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
}

function loggedErrorLines(
  errorLog: SpyInstance<typeof logger.error>,
): Array<string> {
  return errorLog.mock.calls.map((call: Parameters<typeof logger.error>) => {
    return String(call[0]);
  });
}

/*
 * Every logger.error call, with exactly the arguments it was given. Copied
 * into arrays made here: jest records calls in arrays of its own realm,
 * which toStrictEqual would tell apart from the literals they are compared
 * with.
 */
function errorLogCalls(
  errorLog: SpyInstance<typeof logger.error>,
): Array<Array<unknown>> {
  return Array.from(
    errorLog.mock.calls,
    (call: Parameters<typeof logger.error>): Array<unknown> => {
      return [...call];
    },
  );
}

/*
 * What MicrosoftTeamsReplies.logFailure logs for an error without an HTTP
 * status, and nothing else: what failed and why, then the error as it was
 * thrown, which keeps its stack and its class.
 */
function expectFailureLogged(
  errorLog: SpyInstance<typeof logger.error>,
  expected: {
    line: string;
    error: unknown;
    attributes: LogAttributes | undefined;
  },
): void {
  expect(errorLogCalls(errorLog)).toStrictEqual([
    [expected.line, expected.attributes],
    [expected.error, expected.attributes],
  ]);
  expect(errorLog.mock.calls[1]?.[0]).toBe(expected.error);
}

// Everything logger.error was given, as text, to look for what must not be there.
function errorLogText(errorLog: SpyInstance<typeof logger.error>): string {
  return errorLog.mock.calls
    .map((call: Parameters<typeof logger.error>): string => {
      return call
        .map((argument: unknown): string => {
          if (argument instanceof Error) {
            return `${String(argument)}\n${argument.stack || ""}`;
          }

          return typeof argument === "string"
            ? argument
            : String(JSON.stringify(argument));
        })
        .join("\n");
    })
    .join("\n");
}

describe("handleBotMessageActivity never rejects: one reply, never a rethrow (#4111)", () => {
  test("tenant resolution throws: exactly one reply, the unexpected-error text naming the activity id, which the error log names too", async () => {
    const outage: Error = new Error("simulated database outage");
    stubs.resolveTenant.mockRejectedValue(outage);
    const errorLog: SpyInstance<typeof logger.error> = silenceErrorLog();
    const activity: JSONObject = personalMessage(
      "create incident Database Is Down",
    );
    const turn: FakeTurn = buildTurn({ activity: activity });

    await expect(
      MicrosoftTeamsUtil.handleBotMessageActivity({
        activity: activity,
        turnContext: turn.turnContext,
      }),
    ).resolves.toBeUndefined();

    expect(turn.attempted).toEqual([
      MicrosoftTeamsUtil.getUnexpectedErrorMessage(activity),
    ]);
    expect(turn.delivered).toEqual(turn.attempted);
    expect(textOf(turn.delivered[0])).toContain(
      `reference ${idOf(activity)} in the server logs`,
    );
    expect(textOf(turn.delivered[0])).not.toContain(MASTER_ERROR_TEXT);
    expect(stubs.createIncident).not.toHaveBeenCalled();

    // The reference in the reply is what an administrator searches the log for.
    expect(
      loggedErrorLines(errorLog).filter((line: string) => {
        return (
          line.includes(idOf(activity)) &&
          line.includes("simulated database outage")
        );
      }),
    ).toHaveLength(1);

    // Named by its command, not by the title typed after it.
    expectFailureLogged(errorLog, {
      line: `Microsoft Teams message ${idOf(activity)} ("incident") failed: Error: simulated database outage`,
      error: outage,
      // The project was not known yet.
      attributes: { projectId: undefined },
    });
    expect(errorLogText(errorLog)).not.toContain("Database Is Down");
  });

  test("a misspelt command that fails is logged as the command it looks like - never as help, never by what was typed", async () => {
    const outage: Error = new Error("simulated database outage");
    stubs.resolveTenant.mockRejectedValue(outage);
    const errorLog: SpyInstance<typeof logger.error> = silenceErrorLog();
    const activity: JSONObject = personalMessage("incidnet Database Is Down");
    const turn: FakeTurn = buildTurn({ activity: activity });

    await MicrosoftTeamsUtil.handleBotMessageActivity({
      activity: activity,
      turnContext: turn.turnContext,
    });

    expectFailureLogged(errorLog, {
      line: `Microsoft Teams message ${idOf(activity)} ("misspelt incident") failed: Error: simulated database outage`,
      error: outage,
      attributes: { projectId: undefined },
    });
    expect(errorLogText(errorLog)).not.toContain("Database Is Down");
  });

  test("the error reply cannot be sent either: still resolves, after exactly one attempt", async () => {
    const outage: Error = new Error("simulated database outage");
    stubs.resolveTenant.mockRejectedValue(outage);
    const errorLog: SpyInstance<typeof logger.error> = silenceErrorLog();
    const activity: JSONObject = personalMessage("show active incidents");
    const turn: FakeTurn = buildTurn({
      activity: activity,
      send: "refuse-all",
      sendError: connectorUnavailable(),
    });

    await expect(
      MicrosoftTeamsUtil.handleBotMessageActivity({
        activity: activity,
        turnContext: turn.turnContext,
      }),
    ).resolves.toBeUndefined();

    expect(turn.attempted).toEqual([
      MicrosoftTeamsUtil.getUnexpectedErrorMessage(activity),
    ]);
    expect(turn.delivered).toEqual([]);
    expect(errorLogCalls(errorLog)).toStrictEqual([
      [
        `Microsoft Teams message ${idOf(activity)} ("show active incidents") failed: Error: simulated database outage`,
        { projectId: undefined },
      ],
      [outage, { projectId: undefined }],
      // The refused reply: logged, never thrown, never tried again.
      [
        "Could not send a Microsoft Teams reply: RestError 503 ServiceUnavailable: The service is temporarily unavailable.",
      ],
    ]);
  });

  test("Teams refuses the answer itself (413): the user gets the one error reply instead, and nothing is thrown", async () => {
    const errorLog: SpyInstance<typeof logger.error> = silenceErrorLog();
    const activity: JSONObject = personalMessage("show active incidents");
    const turn: FakeTurn = buildTurn({
      activity: activity,
      send: "refuse-first",
    });

    await expect(
      MicrosoftTeamsUtil.handleBotMessageActivity({
        activity: activity,
        turnContext: turn.turnContext,
      }),
    ).resolves.toBeUndefined();

    expect(turn.attempted).toEqual([
      CANNED_LIST_REPLY,
      MicrosoftTeamsUtil.getUnexpectedErrorMessage(activity),
    ]);
    expect(turn.delivered).toEqual([
      MicrosoftTeamsUtil.getUnexpectedErrorMessage(activity),
    ]);
    // A Bot Framework error is one line: its status and code say it all.
    expect(errorLogCalls(errorLog)).toStrictEqual([
      [
        `Microsoft Teams message ${idOf(activity)} ("show active incidents") failed: RestError 413 MessageSizeTooBig: Message size too large.`,
        { projectId: PROJECT_ID.toString() },
      ],
    ]);
  });

  test("Teams refuses the help card: it is sent once, as well as Teams allows - logged, nothing thrown, no second reply", async () => {
    const errorLog: SpyInstance<typeof logger.error> = silenceErrorLog();
    const activity: JSONObject = personalMessage("help");
    const turn: FakeTurn = buildTurn({
      activity: activity,
      send: "refuse-first",
    });

    await expect(
      MicrosoftTeamsUtil.handleBotMessageActivity({
        activity: activity,
        turnContext: turn.turnContext,
      }),
    ).resolves.toBeUndefined();

    expect(turn.attempted).toEqual([HELP_REPLY]);
    expect(turn.delivered).toEqual([]);
    expect(loggedErrorLines(errorLog)).toEqual([
      "Could not send a Microsoft Teams reply: RestError 413 MessageSizeTooBig: Message size too large.",
    ]);
  });

  test("a 'show' command whose handler throws unexpectedly: one reply", async () => {
    const errorLog: SpyInstance<typeof logger.error> = silenceErrorLog();
    const bug: TypeError = new TypeError(
      "Cannot read properties of undefined (reading 'name')",
    );
    stubs.listCommand.mockRejectedValue(bug);
    const activity: JSONObject = personalMessage("show scheduled maintenance");

    const turn: FakeTurn = await deliver(activity);

    expect(stubs.listCommand).toHaveBeenCalledWith({
      turnContext: turn.turnContext,
      activity: activity,
      projectId: PROJECT_ID,
      listCommand: MicrosoftTeamsListCommand.ScheduledMaintenance,
    });
    expect(turn.attempted).toEqual([
      MicrosoftTeamsUtil.getUnexpectedErrorMessage(activity),
    ]);
    expectFailureLogged(errorLog, {
      line: `Microsoft Teams message ${idOf(activity)} ("show scheduled maintenance") failed: TypeError: Cannot read properties of undefined (reading 'name')`,
      error: bug,
      attributes: { projectId: PROJECT_ID.toString() },
    });
  });

  test("a create command that throws (a 413 escaping the form): one reply, no rethrow, and Teams' redelivery adds no second bubble", async () => {
    const errorLog: SpyInstance<typeof logger.error> = silenceErrorLog();
    stubs.createIncident.mockRejectedValue(messageTooLarge());
    const activity: JSONObject = personalMessage(
      "create incident Database Is Down",
    );
    const first: FakeTurn = buildTurn({ activity: activity });

    await expect(
      MicrosoftTeamsUtil.handleBotMessageActivity({
        activity: activity,
        turnContext: first.turnContext,
      }),
    ).resolves.toBeUndefined();
    const redelivery: FakeTurn = await deliver(activity);

    expect(first.delivered).toEqual([
      MicrosoftTeamsUtil.getUnexpectedErrorMessage(activity),
    ]);
    expect(redelivery.attempted).toEqual([]);
    expect(stubs.createIncident).toHaveBeenCalledTimes(1);
    // Logged once, for the first delivery only.
    expect(errorLogCalls(errorLog)).toStrictEqual([
      [
        `Microsoft Teams message ${idOf(activity)} ("incident") failed: RestError 413 MessageSizeTooBig: Message size too large.`,
        { projectId: PROJECT_ID.toString() },
      ],
    ]);
  });

  test("an activity without a tenant: one reply saying the organization could not be identified", async () => {
    silenceErrorLog();
    const activity: JSONObject = personalMessage("create incident", {
      channelData: {},
    });

    const turn: FakeTurn = await deliver(activity);

    expect(turn.attempted).toEqual([
      "Sorry, I couldn't identify your organization. Please try again later.",
    ]);
    expect(stubs.resolveTenant).not.toHaveBeenCalled();
    expect(stubs.createIncident).not.toHaveBeenCalled();
  });

  test.each([
    [
      "no project is connected to the tenant",
      {
        projectAuth: null,
        isAmbiguous: false,
        candidateProjectIds: [],
      },
      "couldn't find your project configuration",
    ],
    [
      "more than one project is connected to the tenant",
      {
        projectAuth: null,
        isAmbiguous: true,
        candidateProjectIds: [PROJECT_ID, ObjectID.generate()],
      },
      "connected to more than one OneUptime project",
    ],
  ])(
    "%s: one reply that says so, and no form",
    async (
      _situation: string,
      resolution: MicrosoftTeamsTenantResolution,
      saying: string,
    ) => {
      stubs.resolveTenant.mockResolvedValue(resolution);
      const activity: JSONObject = personalMessage(
        "create maintenance Patch Tuesday",
      );

      const turn: FakeTurn = await deliver(activity);

      expect(turn.attempted).toEqual([
        MicrosoftTeamsUtil.getTenantResolutionFailureMessage(resolution),
      ]);
      expect(textOf(turn.attempted[0])).toContain(saying);
      expectNoCommandRan();
    },
  );

  test.each([
    ["a personal chat (the chat backfill)", "chat"],
    ["a team channel (the team backfill)", "team"],
  ])(
    "%s whose backfill cannot read the database: the answer still goes out, once",
    async (_where: string, backfill: string) => {
      // The real backfills run; their first read fails.
      stubs.captureChat.mockRestore();
      stubs.captureTeam.mockRestore();
      jest
        .spyOn(WorkspaceProjectAuthTokenService, "findBy")
        .mockRejectedValue(new Error("simulated database outage"));
      const errorLog: SpyInstance<typeof logger.error> = silenceErrorLog();
      const activity: JSONObject =
        backfill === "chat"
          ? personalMessage("help")
          : channelMessage({
              text: "help",
              mention: "the bot",
              id: nextActivityId(),
            });

      const turn: FakeTurn = await deliver(activity);

      expect(turn.attempted).toEqual([HELP_REPLY]);
      expect(loggedErrorLines(errorLog)).toContain(
        `Error capturing Microsoft Teams ${backfill} from bot activity:`,
      );
    },
  );
});

describe("a failed message is logged by the command it is, never by its text", () => {
  /*
   * The error log goes to whoever runs OneUptime, and what is typed to the
   * bot can carry anything: a customer's name, an address, a secret pasted
   * by mistake. The line names the command instead, or how long a question
   * was; the text itself is only in the debug log.
   */
  interface FailedMessageCase {
    name: string;
    activity: () => JSONObject;
    // How the error log line names the message.
    label: string;
    // Makes what the message runs fail with `failure`.
    fail: (failure: Error) => void;
    // Something the user typed that must not reach the error log, if any.
    typed: string | null;
  }

  const QUESTION: string = "why did alice@example.com get paged at 3am?";

  const FAILED_MESSAGES: ReadonlyArray<FailedMessageCase> = [
    {
      name: "'create incident <title>'",
      activity: (): JSONObject => {
        return personalMessage(
          "create incident Payroll export leaks alice@example.com",
        );
      },
      label: '"incident"',
      fail: (failure: Error): void => {
        stubs.createIncident.mockRejectedValue(failure);
      },
      typed: "alice@example.com",
    },
    {
      name: "'Create Maintenance <title>' in a group chat",
      activity: (): JSONObject => {
        return groupChatMention(
          "Create Maintenance Rotate the key alice@example.com leaked",
        );
      },
      label: '"maintenance"',
      fail: (failure: Error): void => {
        stubs.createMaintenance.mockRejectedValue(failure);
      },
      typed: "alice@example.com",
    },
    {
      name: "'Show Active Incidents'",
      activity: (): JSONObject => {
        return personalMessage("Show Active Incidents");
      },
      label: '"show active incidents"',
      fail: (failure: Error): void => {
        stubs.listCommand.mockRejectedValue(failure);
      },
      typed: null,
    },
    {
      // A short form is logged as the command it runs.
      name: "'ongoing maintenance'",
      activity: (): JSONObject => {
        return personalMessage("ongoing maintenance");
      },
      label: '"show ongoing maintenance"',
      fail: (failure: Error): void => {
        stubs.listCommand.mockRejectedValue(failure);
      },
      typed: null,
    },
    {
      /*
       * Starts with a command's words but is a question: the router sends
       * it to the assistant, so the log must not call it "help".
       */
      name: "'help me find slow queries' (a question, not the help command)",
      activity: (): JSONObject => {
        return personalMessage("help me find slow queries");
      },
      label: "a 25-character question",
      fail: (failure: Error): void => {
        stubs.askAssistant.mockRejectedValue(failure);
      },
      typed: "slow queries",
    },
    {
      name: "'show active incidents in eu-west-1' (a question, not the show command)",
      activity: (): JSONObject => {
        return personalMessage("show active incidents in eu-west-1");
      },
      label: "a 34-character question",
      fail: (failure: Error): void => {
        stubs.askAssistant.mockRejectedValue(failure);
      },
      typed: "eu-west-1",
    },
    {
      name: "'ask <question>'",
      activity: (): JSONObject => {
        return personalMessage(`ask ${QUESTION}`);
      },
      label: '"ask"',
      fail: (failure: Error): void => {
        stubs.askAssistant.mockRejectedValue(failure);
      },
      typed: "alice@example.com",
    },
    {
      name: "a question in plain words",
      activity: (): JSONObject => {
        return personalMessage(QUESTION);
      },
      label: "a 43-character question",
      fail: (failure: Error): void => {
        stubs.askAssistant.mockRejectedValue(failure);
      },
      typed: "alice@example.com",
    },
    {
      name: "a question in plain words to '@OneUptime' in a channel (the mention is not counted)",
      activity: (): JSONObject => {
        return channelMessage({
          text: QUESTION,
          mention: "the bot",
          id: nextActivityId(),
        });
      },
      label: "a 43-character question",
      fail: (failure: Error): void => {
        stubs.askAssistant.mockRejectedValue(failure);
      },
      typed: "alice@example.com",
    },
  ];

  test.each(FAILED_MESSAGES)(
    "$name: the one reply, and a log line that names the command and the error",
    async (failedMessage: FailedMessageCase) => {
      const errorLog: SpyInstance<typeof logger.error> = silenceErrorLog();
      const debugLog: SpyInstance<typeof logger.debug> = jest
        .spyOn(logger, "debug")
        .mockImplementation(() => {
          return undefined;
        });
      const failure: Error = new Error("simulated command failure");
      failedMessage.fail(failure);
      const activity: JSONObject = failedMessage.activity();

      const turn: FakeTurn = await deliver(activity);

      expect(turn.attempted).toEqual([
        MicrosoftTeamsUtil.getUnexpectedErrorMessage(activity),
      ]);
      expectFailureLogged(errorLog, {
        line: `Microsoft Teams message ${idOf(activity)} (${failedMessage.label}) failed: Error: simulated command failure`,
        error: failure,
        attributes: { projectId: PROJECT_ID.toString() },
      });

      if (failedMessage.typed) {
        expect(errorLogText(errorLog)).not.toContain(failedMessage.typed);
        // Whoever turns the debug log on to look into it finds the text there.
        expect(debugLog).toHaveBeenCalledWith(
          `Message text: ${activity["text"] as string}`,
        );
      }
    },
  );
});

describe("'create incident' and 'create maintenance' go to MicrosoftTeamsCreateCommands with the title as typed", () => {
  test("'create incident Database Is Down' in a personal chat", async () => {
    const activity: JSONObject = personalMessage(
      "create incident Database Is Down",
    );

    const turn: FakeTurn = await deliver(activity);

    // By the tenant, with what tells its projects apart: who sent it, and where.
    expect(stubs.resolveTenant).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      clues: {
        recordIds: [],
        channelId: undefined,
        workspaceUserId: USER_AAD_OBJECT_ID,
      },
    });
    expect(stubs.createIncident).toHaveBeenCalledTimes(1);
    expect(stubs.createIncident).toHaveBeenCalledWith({
      turnContext: turn.turnContext,
      activity: activity,
      projectId: PROJECT_ID,
      initialTitle: "Database Is Down",
    });
    expect(stubs.createMaintenance).not.toHaveBeenCalled();
    expect(stubs.askAssistant).not.toHaveBeenCalled();
    // The command answers for itself; the message handler adds nothing.
    expect(turn.attempted).toEqual([]);
  });

  test("'@OneUptime create maintenance Patch Tuesday' in a group chat", async () => {
    const activity: JSONObject = groupChatMention(
      "create maintenance Patch Tuesday",
    );

    const turn: FakeTurn = await deliver(activity);

    expect(stubs.captureChat).toHaveBeenCalledTimes(1);
    expect(stubs.createMaintenance).toHaveBeenCalledTimes(1);
    expect(stubs.createMaintenance).toHaveBeenCalledWith({
      turnContext: turn.turnContext,
      activity: activity,
      projectId: PROJECT_ID,
      initialTitle: "Patch Tuesday",
    });
    expect(stubs.createIncident).not.toHaveBeenCalled();
    expect(turn.attempted).toEqual([]);
  });

  test("'@OneUptime create incident Checkout is slow' in a team channel", async () => {
    const activity: JSONObject = channelMessage({
      text: "create incident Checkout is slow",
      mention: "the bot",
      id: nextActivityId(),
    });

    const turn: FakeTurn = await deliver(activity);

    expect(stubs.captureTeam).toHaveBeenCalledTimes(1);
    expect(stubs.createIncident).toHaveBeenCalledTimes(1);
    expect(stubs.createIncident).toHaveBeenCalledWith({
      turnContext: turn.turnContext,
      activity: activity,
      projectId: PROJECT_ID,
      initialTitle: "Checkout is slow",
    });
    expect(stubs.createMaintenance).not.toHaveBeenCalled();
    expect(turn.attempted).toEqual([]);
  });

  test("the @mention may sit anywhere in the text: 'create incident @OneUptime Database Is Down' in a group chat", async () => {
    const activity: JSONObject = groupChatMessage({
      text: "",
      mention: "the bot",
    });
    activity["text"] = `create incident ${BOT_MENTION_TEXT} Database Is Down`;

    await deliver(activity);

    expect(stubs.createIncident).toHaveBeenCalledTimes(1);
    expect(stubs.createIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        initialTitle: "Database Is Down",
      }),
    );
  });

  test.each([
    ["CREATE INCIDENT Database Is Down", "Database Is Down"],
    ["Create Incident API p99 > 2s on EU-West", "API p99 > 2s on EU-West"],
    ["   create incident    Disk full on DB-01   ", "Disk full on DB-01"],
  ])(
    "the command is matched in any case; the title keeps the user's casing: %j",
    async (text: string, expectedTitle: string) => {
      await deliver(personalMessage(text));

      expect(stubs.createIncident).toHaveBeenCalledTimes(1);
      expect(stubs.createIncident).toHaveBeenCalledWith(
        expect.objectContaining({ initialTitle: expectedTitle }),
      );
      expect(stubs.createMaintenance).not.toHaveBeenCalled();
    },
  );

  test("'Create Maintenance Q3 Kernel Upgrade (Frankfurt)' keeps the title's casing and punctuation", async () => {
    await deliver(
      groupChatMention("Create Maintenance Q3 Kernel Upgrade (Frankfurt)"),
    );

    expect(stubs.createMaintenance).toHaveBeenCalledTimes(1);
    expect(stubs.createMaintenance).toHaveBeenCalledWith(
      expect.objectContaining({
        initialTitle: "Q3 Kernel Upgrade (Frankfurt)",
      }),
    );
    expect(stubs.createIncident).not.toHaveBeenCalled();
  });

  test("bare 'create incident' and bare 'create maintenance' open the form with no title", async () => {
    await deliver(personalMessage("create incident"));
    await deliver(groupChatMention("create maintenance"));

    expect(stubs.createIncident).toHaveBeenCalledTimes(1);
    expect(stubs.createIncident).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, initialTitle: "" }),
    );
    expect(stubs.createMaintenance).toHaveBeenCalledTimes(1);
    expect(stubs.createMaintenance).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, initialTitle: "" }),
    );
  });

  test.each([
    "creative incident",
    "create incidents",
    "create incident-report for yesterday",
    "create maintenance-window for db",
    "please create incident Database Is Down",
  ])(
    "%j is not a create command: it goes to the AI assistant as typed",
    async (text: string) => {
      const activity: JSONObject = personalMessage(text);

      const turn: FakeTurn = await deliver(activity);

      expect(stubs.createIncident).not.toHaveBeenCalled();
      expect(stubs.createMaintenance).not.toHaveBeenCalled();
      expect(stubs.askAssistant).toHaveBeenCalledTimes(1);
      expect(stubs.askAssistant).toHaveBeenCalledWith({
        activity: activity,
        turnContext: turn.turnContext,
        projectId: PROJECT_ID,
        question: text,
      });
    },
  );
});

describe("the words Slack's /oneuptime takes: incident, maintenance and oncall, typed to the bot", () => {
  test("'incident Database Is Down' in a personal chat opens the incident form with the title", async () => {
    const activity: JSONObject = personalMessage("incident Database Is Down");

    const turn: FakeTurn = await deliver(activity);

    expect(stubs.createIncident).toHaveBeenCalledTimes(1);
    expect(stubs.createIncident).toHaveBeenCalledWith({
      turnContext: turn.turnContext,
      activity: activity,
      projectId: PROJECT_ID,
      initialTitle: "Database Is Down",
    });
    expect(stubs.createMaintenance).not.toHaveBeenCalled();
    expect(stubs.askAssistant).not.toHaveBeenCalled();
    expect(turn.attempted).toEqual([]);
  });

  test("'@OneUptime maintenance Patch Tuesday' in a group chat opens the maintenance form with the title", async () => {
    const activity: JSONObject = groupChatMention("maintenance Patch Tuesday");

    const turn: FakeTurn = await deliver(activity);

    expect(stubs.createMaintenance).toHaveBeenCalledTimes(1);
    expect(stubs.createMaintenance).toHaveBeenCalledWith({
      turnContext: turn.turnContext,
      activity: activity,
      projectId: PROJECT_ID,
      initialTitle: "Patch Tuesday",
    });
    expect(stubs.createIncident).not.toHaveBeenCalled();
  });

  test("'@OneUptime incident Checkout is slow' in a team channel", async () => {
    const activity: JSONObject = channelMessage({
      text: "incident Checkout is slow",
      mention: "the bot",
      id: nextActivityId(),
    });

    await deliver(activity);

    expect(stubs.createIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        initialTitle: "Checkout is slow",
      }),
    );
  });

  test.each([
    ["INCIDENT   Disk   full on DB-01  ", "Disk full on DB-01"],
    ["Incident: Checkout is slow", "Checkout is slow"],
    ["incident", ""],
  ])(
    "%j: the command in any case, the title on one line",
    async (text: string, title: string) => {
      await deliver(personalMessage(text));

      expect(stubs.createIncident).toHaveBeenCalledTimes(1);
      expect(stubs.createIncident).toHaveBeenCalledWith(
        expect.objectContaining({ initialTitle: title }),
      );
    },
  );

  test.each(["oncall", "OnCall", "on-call", "on call", "oncall?"])(
    "%j: who is on call, answered by MicrosoftTeamsCommands",
    async (text: string) => {
      const activity: JSONObject = personalMessage(text);

      const turn: FakeTurn = await deliver(activity);

      expect(stubs.onCall).toHaveBeenCalledTimes(1);
      expect(stubs.onCall).toHaveBeenCalledWith({
        turnContext: turn.turnContext,
        activity: activity,
        projectId: PROJECT_ID,
      });
      expect(stubs.askAssistant).not.toHaveBeenCalled();
      // The command answers for itself; the message handler adds nothing.
      expect(turn.attempted).toEqual([]);
    },
  );

  test("'oncall for the database team?' is a question for the AI assistant, as typed", async () => {
    const activity: JSONObject = personalMessage(
      "oncall for the database team?",
    );

    const turn: FakeTurn = await deliver(activity);

    expect(stubs.onCall).not.toHaveBeenCalled();
    expect(stubs.askAssistant).toHaveBeenCalledWith({
      activity: activity,
      turnContext: turn.turnContext,
      projectId: PROJECT_ID,
      question: "oncall for the database team?",
    });
  });

  test.each([
    [
      "incidnet Database Is Down",
      {
        word: "incidnet",
        command: WorkspaceCommandName.Incident,
        text: "Database Is Down",
      },
    ],
    [
      "maintenence",
      {
        word: "maintenence",
        command: WorkspaceCommandName.Maintenance,
        text: "",
      },
    ],
    [
      "oncal",
      { word: "oncal", command: WorkspaceCommandName.OnCall, text: "" },
    ],
  ])(
    "%j - a command misspelt - gets the command it looks like, in one short reply; nothing runs, and AI is not asked",
    async (text: string, misspelt: WorkspaceCommandMisspelling) => {
      const turn: FakeTurn = await deliver(personalMessage(text));

      expect(turn.attempted).toEqual([helpReply(misspelt)]);
      expectNoCommandRan();
    },
  );

  test("the misspelt command's answer is the command it looks like, and how to ask AI instead - not the whole help", () => {
    const answer: WorkspaceAnswer = MicrosoftTeamsCommands.getMisspellingAnswer(
      {
        word: "incidnet",
        command: WorkspaceCommandName.Incident,
        text: "Database Is Down",
      },
    );

    expect(answer.markdown).toBe(
      "🤔 **incidnet** is not a command. Did you mean **incident Database Is Down**? To ask OneUptime AI instead, start with **ask**.",
    );
  });
});

describe("help, 'show ...' and 'ask' are routed as before", () => {
  const HELP_REQUESTS: Array<[string, () => JSONObject]> = [
    [
      "'help'",
      (): JSONObject => {
        return personalMessage("help");
      },
    ],
    [
      "'HELP', in capitals",
      (): JSONObject => {
        return personalMessage("HELP");
      },
    ],
    [
      "'?'",
      (): JSONObject => {
        return personalMessage("?");
      },
    ],
    [
      "an @mention with no text",
      (): JSONObject => {
        return groupChatMention("");
      },
    ],
  ];

  test.each(HELP_REQUESTS)(
    "%s: the help text, once, and nothing else runs",
    async (_request: string, buildActivity: () => JSONObject) => {
      const turn: FakeTurn = await deliver(buildActivity());

      expect(turn.attempted).toEqual([HELP_REPLY]);
      expectNoCommandRan();
    },
  );

  test("the help says incident and maintenance take a title, as the router reads them, and lists Teams' own lists", () => {
    expect(HELP_ANSWER.markdown).toContain(
      "\n- **incident [title or number]**: declare an incident, or act on one by its number\n",
    );
    expect(HELP_ANSWER.markdown).toContain(
      "\n- **maintenance [title]**: schedule maintenance\n",
    );
    expect(HELP_ANSWER.markdown).toContain(
      "\n- **oncall**: see who is on call right now\n",
    );
    expect(HELP_ANSWER.markdown).toContain(
      "\n- **show active incidents**, **show active alerts**: list what is open right now\n",
    );
    expect(HELP_ANSWER.markdown).toContain(
      "\n- **show scheduled maintenance**, **show ongoing maintenance**: list upcoming and ongoing maintenance\n",
    );
  });

  const SHOW_ROUTES: Array<[string, MicrosoftTeamsListCommand]> = [
    ["show active incidents", MicrosoftTeamsListCommand.ActiveIncidents],
    ["active incidents", MicrosoftTeamsListCommand.ActiveIncidents],
    [
      "show scheduled maintenance",
      MicrosoftTeamsListCommand.ScheduledMaintenance,
    ],
    ["scheduled maintenance", MicrosoftTeamsListCommand.ScheduledMaintenance],
    ["show ongoing maintenance", MicrosoftTeamsListCommand.OngoingMaintenance],
    ["ongoing maintenance", MicrosoftTeamsListCommand.OngoingMaintenance],
    ["Show Active Alerts", MicrosoftTeamsListCommand.ActiveAlerts],
    ["active alerts", MicrosoftTeamsListCommand.ActiveAlerts],
  ];

  /*
   * The list is read as the member who typed it (handleListCommand,
   * WorkspaceOpenRecords): the router hands over the message and the
   * project the tenant resolved to, and answers nothing of its own.
   */
  test.each(SHOW_ROUTES)(
    "%j: handed once to the member-scoped list %j for the resolved project",
    async (text: string, listCommand: MicrosoftTeamsListCommand) => {
      const activity: JSONObject = personalMessage(text);

      const turn: FakeTurn = await deliver(activity);

      expect(stubs.listCommand).toHaveBeenCalledTimes(1);
      expect(stubs.listCommand).toHaveBeenCalledWith({
        turnContext: turn.turnContext,
        activity: activity,
        projectId: PROJECT_ID,
        listCommand: listCommand,
      });
      expect(stubs.askAssistant).not.toHaveBeenCalled();
      expect(turn.attempted).toEqual([CANNED_LIST_REPLY]);
    },
  );

  test.each([
    [
      "ask Which monitors are down right now?",
      "Which monitors are down right now?",
    ],
    ["ASK why did checkout latency spike?", "why did checkout latency spike?"],
    [
      "ask   create incident Database Is Down",
      "create incident Database Is Down",
    ],
  ])(
    "%j: the AI assistant gets the question after 'ask', as typed",
    async (text: string, question: string) => {
      const activity: JSONObject = personalMessage(text);

      const turn: FakeTurn = await deliver(activity);

      expect(stubs.askAssistant).toHaveBeenCalledTimes(1);
      expect(stubs.askAssistant).toHaveBeenCalledWith({
        activity: activity,
        turnContext: turn.turnContext,
        projectId: PROJECT_ID,
        question: question,
      });
      expect(stubs.createIncident).not.toHaveBeenCalled();
      // The assistant answers for itself; the message handler adds nothing.
      expect(turn.attempted).toEqual([]);
    },
  );

  test("a bare 'ask': the help text, and the assistant is not asked anything", async () => {
    const turn: FakeTurn = await deliver(personalMessage("ask"));

    expect(turn.attempted).toEqual([HELP_REPLY]);
    expectNoCommandRan();
  });
});

describe("a redelivered activity is handled once (#4111's second bubble)", () => {
  test("the same activity delivered twice: the second delivery sends nothing and does not run the command again", async () => {
    const activity: JSONObject = personalMessage(
      "create incident Database Is Down",
    );

    await deliver(activity);
    const redelivery: FakeTurn = await deliver(activity);

    expect(stubs.createIncident).toHaveBeenCalledTimes(1);
    expect(redelivery.attempted).toEqual([]);
    // Dropped before anything else runs: no second tenant lookup either.
    expect(stubs.resolveTenant).toHaveBeenCalledTimes(1);
    expect(stubs.claim).toHaveBeenCalledTimes(2);
    await expect(stubs.claim.mock.results[0]?.value).resolves.toBe(true);
    await expect(stubs.claim.mock.results[1]?.value).resolves.toBe(false);
  });

  /*
   * A claim made while Redis was down never reached Redis. If Redis is back
   * by the time Teams redelivers, Redis alone would take the redelivery for a
   * first delivery; this process remembers the claim, and that decides.
   */
  test("Redis comes back between a delivery and its redelivery: the redelivery is still dropped, and Redis is told of the claim", async () => {
    const activity: JSONObject = personalMessage(
      "create incident Database Is Down",
    );

    await deliver(activity);
    // Back, and it never heard of the first delivery.
    stubs.redisClaim.mockResolvedValue(true);
    const redelivery: FakeTurn = await deliver(activity);

    expect(redelivery.attempted).toEqual([]);
    expect(stubs.createIncident).toHaveBeenCalledTimes(1);
    await expect(stubs.claim.mock.results[1]?.value).resolves.toBe(false);
    // Asked all the same, so that another App instance drops it too.
    expect(stubs.redisClaim).toHaveBeenCalledTimes(2);
    expect(stubs.redisClaim).toHaveBeenLastCalledWith(
      "microsoft-teams-inbound-activity",
      MicrosoftTeamsActivityDeduplicator.getClaimKey(activity),
      "1",
      { expiresInSeconds: 600 },
    );
  });

  test("an activity another App instance claimed first (Redis answers that it is taken): nothing is sent, and nothing runs", async () => {
    stubs.redisClaim.mockResolvedValue(false);
    const activity: JSONObject = personalMessage(
      "create incident Database Is Down",
    );

    const turn: FakeTurn = await deliver(activity);

    expect(turn.attempted).toEqual([]);
    expect(stubs.resolveTenant).not.toHaveBeenCalled();
    expectNoCommandRan();
  });

  test("the same 'help' delivered twice is answered once", async () => {
    const activity: JSONObject = personalMessage("help");

    const first: FakeTurn = await deliver(activity);
    const redelivery: FakeTurn = await deliver(activity);

    expect(first.delivered).toEqual([HELP_REPLY]);
    expect(redelivery.attempted).toEqual([]);
  });

  /*
   * Teams delivers an activity again when the bot has not answered it within
   * 15 seconds, so the retry arrives while the first delivery is still being
   * handled. Only claiming the id BEFORE the work (not remembering it once
   * handled) drops that retry.
   */
  test("Teams retries a slow 'create incident' that is still being handled: the retry sends nothing, and the form is sent once", async () => {
    const formReply: string = "📝 Create New Incident (form)";
    const release: Gate = createGate();
    const commandEntered: Gate = createGate();
    stubs.createIncident
      .mockImplementation(async (data: CreateCommandInput): Promise<void> => {
        await data.turnContext.sendActivity(formReply);
      })
      .mockImplementationOnce(
        async (data: CreateCommandInput): Promise<void> => {
          commandEntered.open();
          await release.opened;
          await data.turnContext.sendActivity(formReply);
        },
      );
    const activity: JSONObject = personalMessage(
      "create incident Database Is Down",
    );
    const first: FakeTurn = buildTurn({ activity: activity });
    let firstSettled: boolean = false;
    const firstDelivery: Promise<void> =
      MicrosoftTeamsUtil.handleBotMessageActivity({
        activity: activity,
        turnContext: first.turnContext,
      }).then(() => {
        firstSettled = true;
      });

    let retry: FakeTurn | undefined = undefined;
    let firstSettledWhenRetryWasDone: boolean = true;
    try {
      // Also settles if the first delivery ends without reaching the command.
      await Promise.race([commandEntered.opened, firstDelivery]);
      retry = await deliver(activity);
      firstSettledWhenRetryWasDone = firstSettled;
    } finally {
      release.open();
      await firstDelivery;
    }

    expect(firstSettledWhenRetryWasDone).toBe(false);
    expect(retry?.attempted).toEqual([]);
    expect(first.delivered).toEqual([formReply]);
    expect(stubs.createIncident).toHaveBeenCalledTimes(1);
    expect(stubs.resolveTenant).toHaveBeenCalledTimes(1);
  });

  test("Teams retries a slow form submit that is still being handled: the submit runs once, so one incident", async () => {
    const confirmation: string = "✅ Incident created successfully!";
    const release: Gate = createGate();
    const submitEntered: Gate = createGate();
    const invokeHandler: SpyInstance<
      typeof MicrosoftTeamsUtil.handleBotInvokeActivity
    > = jest
      .spyOn(MicrosoftTeamsUtil, "handleBotInvokeActivity")
      .mockImplementation(async (data: InvokeHandlerInput): Promise<void> => {
        await data.turnContext.sendActivity(confirmation);
      })
      .mockImplementationOnce(
        async (data: InvokeHandlerInput): Promise<void> => {
          submitEntered.open();
          await release.opened;
          await data.turnContext.sendActivity(confirmation);
        },
      );
    const activity: JSONObject = cardSubmit({
      action: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
      incidentTitle: "Database Is Down",
    });
    const first: FakeTurn = buildTurn({ activity: activity });
    const firstDelivery: Promise<void> =
      MicrosoftTeamsUtil.handleBotMessageActivity({
        activity: activity,
        turnContext: first.turnContext,
      });

    let retry: FakeTurn | undefined = undefined;
    try {
      // Also settles if the first delivery ends without reaching the submit.
      await Promise.race([submitEntered.opened, firstDelivery]);
      retry = await deliver(activity);
    } finally {
      release.open();
      await firstDelivery;
    }

    expect(retry?.attempted).toEqual([]);
    expect(first.delivered).toEqual([confirmation]);
    expect(invokeHandler).toHaveBeenCalledTimes(1);
  });

  test("the same activity id in another conversation is another activity: both are handled", async () => {
    const activity: JSONObject = personalMessage(
      "create incident Database Is Down",
    );
    const sameIdElsewhere: JSONObject = personalMessage(
      "create incident Database Is Down",
      {
        id: idOf(activity),
        conversation: {
          conversationType: "personal",
          id: OTHER_PERSONAL_CHAT_ID,
          tenantId: TENANT_ID,
        },
      },
    );

    await deliver(activity);
    await deliver(sameIdElsewhere);

    expect(stubs.createIncident).toHaveBeenCalledTimes(2);
    expect(stubs.createIncident.mock.calls[0]?.[0].activity).toBe(activity);
    expect(stubs.createIncident.mock.calls[1]?.[0].activity).toBe(
      sameIdElsewhere,
    );
  });

  test("an activity without an id is handled every time", async () => {
    const activity: JSONObject = personalMessage("help");
    delete activity["id"];

    const turns: Array<FakeTurn> = [
      await deliver(activity),
      await deliver(activity),
      await deliver(activity),
    ];

    expect(
      turns.map((turn: FakeTurn) => {
        return turn.delivered;
      }),
    ).toEqual([[HELP_REPLY], [HELP_REPLY], [HELP_REPLY]]);
  });

  test("a card submit (value.action) delivered twice runs handleBotInvokeActivity once", async () => {
    const invokeHandler: SpyInstance<
      typeof MicrosoftTeamsUtil.handleBotInvokeActivity
    > = jest
      .spyOn(MicrosoftTeamsUtil, "handleBotInvokeActivity")
      .mockResolvedValue(undefined);
    const activity: JSONObject = cardSubmit({
      action: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
      incidentTitle: "Database Is Down",
    });

    const first: FakeTurn = await deliver(activity);
    const redelivery: FakeTurn = await deliver(activity);

    expect(invokeHandler).toHaveBeenCalledTimes(1);
    expect(invokeHandler).toHaveBeenCalledWith({
      activity: activity,
      turnContext: first.turnContext,
    });
    expect(redelivery.attempted).toEqual([]);
    // A submit is not a command: the text path never runs.
    expect(stubs.resolveTenant).not.toHaveBeenCalled();
    expectNoCommandRan();
  });

  test("a card submit whose action is under value.data, in a channel without an @mention, is handled and claimed", async () => {
    const invokeHandler: SpyInstance<
      typeof MicrosoftTeamsUtil.handleBotInvokeActivity
    > = jest
      .spyOn(MicrosoftTeamsUtil, "handleBotInvokeActivity")
      .mockResolvedValue(undefined);
    const activity: JSONObject = channelMessage({
      text: "",
      mention: "nobody",
      id: nextActivityId(),
      value: { data: acknowledgeIncidentValue() },
    });

    await deliver(activity);
    await deliver(activity);

    expect(stubs.claim).toHaveBeenCalledTimes(2);
    expect(invokeHandler).toHaveBeenCalledTimes(1);
  });

  const UNANSWERED_MESSAGES: Array<
    [
      string,
      "chat" | "team",
      (id: string) => JSONObject,
      (id: string) => JSONObject,
    ]
  > = [
    [
      "a channel message that does not @mention the bot",
      "team",
      (id: string): JSONObject => {
        return channelMessage({ text: "help", mention: "nobody", id: id });
      },
      (id: string): JSONObject => {
        return channelMessage({ text: "help", mention: "the bot", id: id });
      },
    ],
    [
      "a channel message that @mentions someone else",
      "team",
      (id: string): JSONObject => {
        return channelMessage({
          text: "help",
          mention: "someone else",
          id: id,
        });
      },
      (id: string): JSONObject => {
        return channelMessage({ text: "help", mention: "the bot", id: id });
      },
    ],
    [
      "a group chat message that does not @mention the bot",
      "chat",
      (id: string): JSONObject => {
        return groupChatMessage({ text: "help", mention: "nobody", id: id });
      },
      (id: string): JSONObject => {
        return groupChatMessage({ text: "help", mention: "the bot", id: id });
      },
    ],
  ];

  test.each(UNANSWERED_MESSAGES)(
    "%s is ignored without claiming its id: a delivery with that id that @mentions the bot is still answered",
    async (
      _message: string,
      backfill: "chat" | "team",
      buildIgnored: (id: string) => JSONObject,
      buildMentioned: (id: string) => JSONObject,
    ) => {
      const activityId: string = nextActivityId();

      const ignored: FakeTurn = await deliver(buildIgnored(activityId));

      expect(ignored.attempted).toEqual([]);
      // The install backfill runs for every message, answered or not.
      expect(
        backfill === "team" ? stubs.captureTeam : stubs.captureChat,
      ).toHaveBeenCalledTimes(1);
      expect(stubs.claim).not.toHaveBeenCalled();
      expect(stubs.resolveTenant).not.toHaveBeenCalled();

      const mentioned: JSONObject = buildMentioned(activityId);
      const answered: FakeTurn = await deliver(mentioned);

      expect(stubs.claim).toHaveBeenCalledTimes(1);
      expect(stubs.claim).toHaveBeenCalledWith(mentioned);
      expect(answered.delivered).toEqual([HELP_REPLY]);
    },
  );

  test.each([
    ["the bot itself", { id: BOT_ID, name: "OneUptime" }],
    [
      "another bot",
      { id: "28:9f8e7d6c-build-bot", name: "Build Bot", role: "bot" },
    ],
  ])(
    "a message from %s is ignored before anything is claimed",
    async (_sender: string, from: JSONObject) => {
      const activity: JSONObject = personalMessage("help", { from: from });

      const turn: FakeTurn = await deliver(activity);

      expect(turn.attempted).toEqual([]);
      expect(stubs.claim).not.toHaveBeenCalled();
      expect(stubs.captureChat).not.toHaveBeenCalled();
      expect(stubs.resolveTenant).not.toHaveBeenCalled();
    },
  );
});

describe("MicrosoftTeamsUtil.getUnexpectedErrorMessage", () => {
  test("with an activity id: names it as the reference to look for in the server logs", () => {
    expect(
      MicrosoftTeamsUtil.getUnexpectedErrorMessage({ id: "1727712345678" }),
    ).toBe(
      `${UNEXPECTED_ERROR_TEXT} If it keeps happening, ask your OneUptime administrator to look for reference 1727712345678 in the server logs.`,
    );
  });

  test("without an activity id, or with an empty one: no reference sentence", () => {
    expect(MicrosoftTeamsUtil.getUnexpectedErrorMessage({})).toBe(
      UNEXPECTED_ERROR_TEXT,
    );
    expect(MicrosoftTeamsUtil.getUnexpectedErrorMessage({ id: "" })).toBe(
      UNEXPECTED_ERROR_TEXT,
    );
  });

  test("the reference is text in the reply, whatever it holds", () => {
    expect(
      MicrosoftTeamsUtil.getUnexpectedErrorMessage({
        id: "**1727** [logs](https://example.com)",
      }),
    ).toBe(
      `${UNEXPECTED_ERROR_TEXT} If it keeps happening, ask your OneUptime administrator to look for reference \\*\\*1727\\*\\* \\[logs\\](https://example.com) in the server logs.`,
    );
  });
});

describe("MicrosoftTeamsUtil.recoverFromFailedTurn: the turn ends normally, with at most one reply", () => {
  test("a message that got no reply yet: one generic reply naming the activity id, and the error is logged with it", async () => {
    const errorLog: SpyInstance<typeof logger.error> = silenceErrorLog();
    const activity: JSONObject = personalMessage("create incident");
    const turn: FakeTurn = buildTurn({ activity: activity });
    const bug: Error = new Error("simulated handler bug");

    await expect(
      MicrosoftTeamsUtil.recoverFromFailedTurn({
        turnContext: turn.turnContext,
        error: bug,
      }),
    ).resolves.toBeUndefined();

    expect(turn.delivered).toEqual([
      MicrosoftTeamsUtil.getUnexpectedErrorMessage(activity),
    ]);
    // The line carries the reference the reply gives; the error, its stack.
    expectFailureLogged(errorLog, {
      line: `Microsoft Teams message activity ${idOf(activity)} failed: Error: simulated handler bug`,
      error: bug,
      attributes: undefined,
    });
  });

  test("a message that was already answered: nothing more is sent, and the failure is still logged", async () => {
    const errorLog: SpyInstance<typeof logger.error> = silenceErrorLog();
    const activity: JSONObject = personalMessage("create incident");
    const turn: FakeTurn = buildTurn({
      activity: activity,
      responded: true,
    });
    const bug: Error = new Error("simulated failure after the reply");

    await MicrosoftTeamsUtil.recoverFromFailedTurn({
      turnContext: turn.turnContext,
      error: bug,
    });

    expect(turn.attempted).toEqual([]);
    expectFailureLogged(errorLog, {
      line: `Microsoft Teams message activity ${idOf(activity)} failed: Error: simulated failure after the reply`,
      error: bug,
      attributes: undefined,
    });
  });

  test("a Bot Framework HTTP error: one log line with its status and code, not the error object, which carries the whole request", async () => {
    const errorLog: SpyInstance<typeof logger.error> = silenceErrorLog();
    const activity: JSONObject = personalMessage("create incident");
    const turn: FakeTurn = buildTurn({ activity: activity });

    await MicrosoftTeamsUtil.recoverFromFailedTurn({
      turnContext: turn.turnContext,
      error: connectorUnavailable(),
    });

    expect(turn.delivered).toEqual([
      MicrosoftTeamsUtil.getUnexpectedErrorMessage(activity),
    ]);
    expect(errorLogCalls(errorLog)).toStrictEqual([
      [
        `Microsoft Teams message activity ${idOf(activity)} failed: RestError 503 ServiceUnavailable: The service is temporarily unavailable.`,
        undefined,
      ],
    ]);
  });

  test("an invoke: the invoke response Teams waits for, status 200, and no message", async () => {
    const errorLog: SpyInstance<typeof logger.error> = silenceErrorLog();
    const activity: JSONObject = invokeActivity(acknowledgeIncidentValue());
    const turn: FakeTurn = buildTurn({ activity: activity });
    const failure: Error = new Error("simulated invoke failure");

    await MicrosoftTeamsUtil.recoverFromFailedTurn({
      turnContext: turn.turnContext,
      error: failure,
    });

    expect(turn.attempted).toEqual([
      { type: "invokeResponse", value: { status: 200 } },
    ]);
    expectFailureLogged(errorLog, {
      line: `Microsoft Teams invoke activity ${idOf(activity)} failed: Error: simulated invoke failure`,
      error: failure,
      attributes: undefined,
    });
  });

  /*
   * turnContext.responded turns true with any reply, but only an
   * invokeResponse answers the invoke itself: without one, CloudAdapter
   * answers Teams HTTP 501.
   */
  test("an invoke whose handler already posted a message still gets the invoke response", async () => {
    silenceErrorLog();
    const turn: FakeTurn = buildTurn({
      activity: invokeActivity(acknowledgeIncidentValue()),
      responded: true,
    });

    await MicrosoftTeamsUtil.recoverFromFailedTurn({
      turnContext: turn.turnContext,
      error: new Error("simulated failure after the reply"),
    });

    expect(turn.attempted).toEqual([
      { type: "invokeResponse", value: { status: 200 } },
    ]);
  });

  test.each(["conversationUpdate", "installationUpdate", "messageReaction"])(
    "activity type %j: logged only, nothing is sent",
    async (activityType: string) => {
      const errorLog: SpyInstance<typeof logger.error> = silenceErrorLog();
      const activity: JSONObject = personalMessage("", { type: activityType });
      const turn: FakeTurn = buildTurn({ activity: activity });
      const failure: Error = new Error("simulated capture failure");

      await MicrosoftTeamsUtil.recoverFromFailedTurn({
        turnContext: turn.turnContext,
        error: failure,
      });

      expect(turn.attempted).toEqual([]);
      expectFailureLogged(errorLog, {
        line: `Microsoft Teams ${activityType} activity ${idOf(activity)} failed: Error: simulated capture failure`,
        error: failure,
        attributes: undefined,
      });
    },
  );

  test("a turn with no activity at all: logged only, nothing is sent, nothing is thrown", async () => {
    silenceErrorLog();
    const turn: FakeTurn = buildTurn({ activity: undefined });

    await expect(
      MicrosoftTeamsUtil.recoverFromFailedTurn({
        turnContext: turn.turnContext,
        error: "a thrown string",
      }),
    ).resolves.toBeUndefined();

    expect(turn.attempted).toEqual([]);
  });

  test("the generic reply cannot be sent: nothing is thrown", async () => {
    silenceErrorLog();
    const turn: FakeTurn = buildTurn({
      activity: personalMessage("create incident"),
      send: "refuse-all",
      sendError: connectorUnavailable(),
    });

    await expect(
      MicrosoftTeamsUtil.recoverFromFailedTurn({
        turnContext: turn.turnContext,
        error: new Error("simulated handler bug"),
      }),
    ).resolves.toBeUndefined();

    expect(turn.attempted).toHaveLength(1);
    expect(turn.delivered).toEqual([]);
  });

  test("the invoke response cannot be sent: nothing is thrown", async () => {
    silenceErrorLog();
    const turn: FakeTurn = buildTurn({
      activity: invokeActivity(acknowledgeIncidentValue()),
      send: "refuse-all",
      sendError: connectorUnavailable(),
    });

    await expect(
      MicrosoftTeamsUtil.recoverFromFailedTurn({
        turnContext: turn.turnContext,
        error: new Error("simulated invoke failure"),
      }),
    ).resolves.toBeUndefined();

    expect(turn.attempted).toHaveLength(1);
  });
});

describe("handleBotInvokeActivity: a failed action gets one reply that says why, and never throws", () => {
  const SETTINGS_LINK: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/user-settings/microsoft-teams-integration`;

  // Who pressed (invokeActivity), as every answer mentions them.
  const MENTION: string = "<at>Alice Admin</at>";

  interface AnswerCard {
    // The answer, after the mention it opens with.
    text: string;
    // The Connect button's link, if it has one.
    connectUrl: string | null;
  }

  /*
   * A reply that is an answer card (MicrosoftTeamsActionAnswer): one text
   * block that mentions who pressed, and at most the Connect button.
   */
  function answerCardOf(reply: Reply | undefined): AnswerCard {
    const attachments: Array<JSONObject> = (reply as Partial<Activity>)
      .attachments as unknown as Array<JSONObject>;

    expect(attachments).toHaveLength(1);

    const card: JSONObject = attachments[0]!["content"] as JSONObject;
    const body: Array<JSONObject> = card["body"] as Array<JSONObject>;

    expect(body).toHaveLength(1);

    const text: string = body[0]!["text"] as string;

    expect(text.startsWith(`${MENTION} `)).toBe(true);
    expect((card["msteams"] as JSONObject)["entities"]).toEqual([
      {
        type: "mention",
        text: MENTION,
        mentioned: { id: "29:1Hk8-teams-user", name: "Alice Admin" },
      },
    ]);

    const actions: Array<JSONObject> =
      (card["actions"] as Array<JSONObject> | undefined) || [];

    expect(actions.length).toBeLessThanOrEqual(1);

    return {
      text: text.substring(MENTION.length + 1),
      connectUrl: actions[0] ? (actions[0]["url"] as string) : null,
    };
  }

  function stubLinkedMember(): void {
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockResolvedValue(ONEUPTIME_USER_ID);
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockResolvedValue({
        userId: ONEUPTIME_USER_ID,
        tenantId: PROJECT_ID,
      } as DatabaseCommonInteractionProps);
  }

  // The sender's account is linked, but it is not a member of the project.
  function stubLinkedNonMember(): void {
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockResolvedValue(ONEUPTIME_USER_ID);
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockRejectedValue(
        new NotAuthorizedException(
          WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
        ),
      );
  }

  function stubDashboardUrl(): void {
    jest.spyOn(DatabaseConfig, "getDashboardUrl").mockImplementation(() => {
      return Promise.resolve(URL.fromString(DASHBOARD_URL));
    });
  }

  function stubIncidentAction(): SpyInstance<
    typeof MicrosoftTeamsIncidentActions.handleBotIncidentAction
  > {
    return jest.spyOn(MicrosoftTeamsIncidentActions, "handleBotIncidentAction");
  }

  async function invoke(
    activity: JSONObject,
    send?: SendBehaviour | undefined,
  ): Promise<FakeTurn> {
    const turn: FakeTurn = buildTurn({ activity: activity, send: send });

    await MicrosoftTeamsUtil.handleBotInvokeActivity({
      activity: activity,
      turnContext: turn.turnContext,
    });

    return turn;
  }

  test("a Teams account nobody connected: asked, by name, to connect it to acknowledge the incident, with a one-click Connect button; not an error", async () => {
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockRejectedValue(
        new MicrosoftTeamsAccountNotLinkedException(
          "No OneUptime user linked to this Microsoft Teams user. Please authenticate with Microsoft Teams.",
        ),
      );
    stubDashboardUrl();
    // The press, kept to finish once the account is connected.
    const kept: SpyInstance<typeof GlobalCache.setString> = jest
      .spyOn(GlobalCache, "setString")
      .mockResolvedValue(undefined);
    const action: SpyInstance<
      typeof MicrosoftTeamsIncidentActions.handleBotIncidentAction
    > = stubIncidentAction().mockResolvedValue(undefined);
    const errorLog: SpyInstance<typeof logger.error> = silenceErrorLog();

    const turn: FakeTurn = await invoke(
      invokeActivity(acknowledgeIncidentValue()),
    );

    expect(turn.attempted).toHaveLength(1);

    const answer: AnswerCard = answerCardOf(turn.attempted[0]);

    // master: "To use OneUptime actions in Microsoft Teams, first connect ..."
    expect(answer.text).toBe(
      "🔗 **Connect your Microsoft Teams account to acknowledge this incident.** It takes one click, and OneUptime acknowledges it for you as soon as you're connected.",
    );

    const url: globalThis.URL = new globalThis.URL(answer.connectUrl || "");

    expect(`${url.origin}${url.pathname}`).toBe(SETTINGS_LINK);
    expect(url.searchParams.get("connect")).toMatch(
      CONNECT_REQUEST_TOKEN_PATTERN,
    );
    expect(kept).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveBeenCalled();
    // Expected, not a server fault: nothing for an operator to chase.
    expect(errorLog).not.toHaveBeenCalled();
  });

  test("a Teams account nobody connected, dashboard URL unknown: where to connect it in words, with no button", async () => {
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockRejectedValue(
        new MicrosoftTeamsAccountNotLinkedException("No linked user."),
      );
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockRejectedValue(new Error("GlobalConfig is not reachable"));

    const turn: FakeTurn = await invoke(
      invokeActivity(acknowledgeIncidentValue()),
    );

    expect(turn.attempted).toHaveLength(1);
    expect(answerCardOf(turn.attempted[0])).toEqual({
      text: "🔗 **Connect your Microsoft Teams account to acknowledge this incident.** In OneUptime, go to **User Settings → Workspace → Microsoft Teams** and press **Connect my account with Microsoft Teams**. Once you're connected, press the button again.",
      connectUrl: null,
    });
  });

  test("a sender who is not a member of the project: the refusal's own message, not an error", async () => {
    stubLinkedNonMember();
    const action: SpyInstance<
      typeof MicrosoftTeamsIncidentActions.handleBotIncidentAction
    > = stubIncidentAction().mockResolvedValue(undefined);
    const errorLog: SpyInstance<typeof logger.error> = silenceErrorLog();

    const turn: FakeTurn = await invoke(
      invokeActivity(acknowledgeIncidentValue()),
    );

    expect(turn.attempted).toHaveLength(1);
    expect(answerCardOf(turn.attempted[0])).toEqual({
      text: WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
      connectUrl: null,
    });
    expect(action).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
  });

  test("the refusal cannot be sent: handleBotInvokeActivity still resolves, after one attempt", async () => {
    stubLinkedNonMember();
    silenceErrorLog();
    const activity: JSONObject = invokeActivity(acknowledgeIncidentValue());
    const turn: FakeTurn = buildTurn({
      activity: activity,
      send: "refuse-all",
      sendError: connectorUnavailable(),
    });

    await expect(
      MicrosoftTeamsUtil.handleBotInvokeActivity({
        activity: activity,
        turnContext: turn.turnContext,
      }),
    ).resolves.toBeUndefined();

    expect(turn.attempted).toHaveLength(1);
    expect(answerCardOf(turn.attempted[0]).text).toBe(
      WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
    );
    expect(turn.delivered).toEqual([]);
  });

  test("an action refused by a permission check inside it: the refusal's own message", async () => {
    stubLinkedMember();
    const errorLog: SpyInstance<typeof logger.error> = silenceErrorLog();
    stubIncidentAction().mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permission to acknowledge this incident.",
      ),
    );

    const turn: FakeTurn = await invoke(
      invokeActivity(acknowledgeIncidentValue()),
    );

    expect(turn.attempted).toHaveLength(1);
    expect(answerCardOf(turn.attempted[0]).text).toBe(
      "You do not have permission to acknowledge this incident.",
    );
    expect(errorLog).not.toHaveBeenCalled();
  });

  // What handleBotInvokeActivity's log lines carry, for the Acknowledge button.
  const ACKNOWLEDGE_LOG_ATTRIBUTES: LogAttributes = {
    actionType: MicrosoftTeamsIncidentActionType.AckIncident,
    projectId: PROJECT_ID.toString(),
  };

  test("an action that throws BadDataException: 'Sorry, that action failed: <reason>'", async () => {
    stubLinkedMember();
    const errorLog: SpyInstance<typeof logger.error> = silenceErrorLog();
    const refusal: BadDataException = new BadDataException(
      "Incident not found.",
    );
    const action: SpyInstance<
      typeof MicrosoftTeamsIncidentActions.handleBotIncidentAction
    > = stubIncidentAction().mockRejectedValue(refusal);

    const turn: FakeTurn = await invoke(
      invokeActivity(acknowledgeIncidentValue()),
    );

    // Named by its class: OneUptime's exceptions all keep Error's name.
    expectFailureLogged(errorLog, {
      line: "Error handling bot invoke activity: BadDataException: Incident not found.",
      error: refusal,
      attributes: ACKNOWLEDGE_LOG_ATTRIBUTES,
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: MicrosoftTeamsIncidentActionType.AckIncident,
        actionValue: INCIDENT_ID.toString(),
        projectId: PROJECT_ID,
        oneUptimeUserId: ONEUPTIME_USER_ID,
      }),
    );
    expect(turn.attempted).toEqual([
      "Sorry, that action failed: Incident not found.",
    ]);
  });

  test("an action that throws anything else: the generic line, and the internal error stays in the log", async () => {
    stubLinkedMember();
    const errorLog: SpyInstance<typeof logger.error> = silenceErrorLog();
    const failure: Error = new Error("connect ECONNREFUSED 10.0.0.5:5432");
    stubIncidentAction().mockRejectedValue(failure);

    const turn: FakeTurn = await invoke(
      invokeActivity(acknowledgeIncidentValue()),
    );

    expect(turn.attempted).toEqual([ACTION_FAILED_TEXT]);
    expect(
      loggedErrorLines(errorLog).some((line: string) => {
        return line.includes("connect ECONNREFUSED 10.0.0.5:5432");
      }),
    ).toBe(true);
    expectFailureLogged(errorLog, {
      line: "Error handling bot invoke activity: Error: connect ECONNREFUSED 10.0.0.5:5432",
      error: failure,
      attributes: ACKNOWLEDGE_LOG_ATTRIBUTES,
    });
  });

  test("an action whose own reply Teams refused (RestError 413): the generic line, not Teams' text, and the log keeps the status and code", async () => {
    stubLinkedMember();
    const errorLog: SpyInstance<typeof logger.error> = silenceErrorLog();
    stubIncidentAction().mockRejectedValue(messageTooLarge());

    const turn: FakeTurn = await invoke(
      invokeActivity(acknowledgeIncidentValue()),
    );

    expect(turn.attempted).toEqual([ACTION_FAILED_TEXT]);
    // One line: the error object would carry the whole request and response.
    expect(errorLogCalls(errorLog)).toStrictEqual([
      [
        "Error handling bot invoke activity: RestError 413 MessageSizeTooBig: Message size too large.",
        ACKNOWLEDGE_LOG_ATTRIBUTES,
      ],
    ]);
  });

  test.each([
    ["a BadDataException with no message", new BadDataException("")],
    ["a thrown string", "simulated string failure"],
    ["a thrown plain object", { status: "broken" }],
  ])(
    "an action that fails with %s: the generic line",
    async (_failure: string, thrown: unknown) => {
      stubLinkedMember();
      silenceErrorLog();
      stubIncidentAction().mockRejectedValue(thrown);

      const turn: FakeTurn = await invoke(
        invokeActivity(acknowledgeIncidentValue()),
      );

      expect(turn.attempted).toEqual([ACTION_FAILED_TEXT]);
    },
  );

  test("the failure reply cannot be sent: handleBotInvokeActivity still resolves, after one attempt", async () => {
    stubLinkedMember();
    silenceErrorLog();
    stubIncidentAction().mockRejectedValue(
      new BadDataException("Incident not found."),
    );
    const activity: JSONObject = invokeActivity(acknowledgeIncidentValue());
    const turn: FakeTurn = buildTurn({
      activity: activity,
      send: "refuse-all",
      sendError: connectorUnavailable(),
    });

    await expect(
      MicrosoftTeamsUtil.handleBotInvokeActivity({
        activity: activity,
        turnContext: turn.turnContext,
      }),
    ).resolves.toBeUndefined();

    expect(turn.attempted).toEqual([
      "Sorry, that action failed: Incident not found.",
    ]);
    expect(turn.delivered).toEqual([]);
  });

  test("the not-linked guidance cannot be sent: still resolves", async () => {
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockRejectedValue(
        new MicrosoftTeamsAccountNotLinkedException("No linked user."),
      );
    stubDashboardUrl();
    silenceErrorLog();
    const activity: JSONObject = invokeActivity(acknowledgeIncidentValue());
    const turn: FakeTurn = buildTurn({
      activity: activity,
      send: "refuse-all",
    });

    await expect(
      MicrosoftTeamsUtil.handleBotInvokeActivity({
        activity: activity,
        turnContext: turn.turnContext,
      }),
    ).resolves.toBeUndefined();

    expect(turn.attempted).toHaveLength(1);
  });

  test("through handleBotMessageActivity (an Action.Submit): one 'that action failed' reply, and the redelivered submit adds nothing", async () => {
    stubLinkedMember();
    silenceErrorLog();
    const action: SpyInstance<
      typeof MicrosoftTeamsIncidentActions.handleBotIncidentAction
    > = stubIncidentAction().mockRejectedValue(
      new BadDataException("Incident not found."),
    );
    const activity: JSONObject = cardSubmit(acknowledgeIncidentValue());

    const first: FakeTurn = await deliver(activity);
    const redelivery: FakeTurn = await deliver(activity);

    expect(first.attempted).toEqual([
      "Sorry, that action failed: Incident not found.",
    ]);
    expect(redelivery.attempted).toEqual([]);
    expect(action).toHaveBeenCalledTimes(1);
  });
});
