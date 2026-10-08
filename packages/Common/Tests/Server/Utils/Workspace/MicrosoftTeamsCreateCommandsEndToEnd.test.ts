/** @timezone Asia/Tokyo */
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
import type { AddressInfo } from "net";
import util from "util";
import moment from "moment-timezone";

/*
 * Issue #4111, end to end: in Microsoft Teams, "create incident" and "create
 * maintenance" answered "Sorry, I encountered an error processing your
 * request. Please try again later." - and every such bubble showed up TWICE -
 * while "show scheduled maintenance" worked.
 *
 * What master (14.0.8) did, which this file was first written to reproduce:
 * the form listed every monitor, label and on-call policy of the project, so
 * with a few hundred monitors the card was over Teams' size limit. The Bot
 * Connector answered 413 MessageSizeTooBig -> the handler replied "Sorry..."
 * and rethrew -> the CloudAdapter (it has no onTurnError) answered Teams HTTP
 * 500 -> Teams delivered the same activity again -> a second "Sorry..."
 * bubble. Any failure doubled that way, not only the 413.
 *
 * What these tests pin, the fixed behaviour: every inbound turn is answered
 * HTTP 200 (an invoke with its invoke response) and a message gets exactly
 * one reply; the form is fitted to a size budget and names what it left off;
 * a card Teams refuses as too large is sent again smaller and then replaced
 * by a text that says why, while any other refusal is explained at once; a
 * redelivered activity id is dropped, even while its first delivery is still
 * being handled; a submitted form is confirmed before the form is removed,
 * neither a confirmation Teams refuses nor a removal that fails is reported
 * as a failed create, and a create OneUptime refuses keeps the form and says
 * why.
 *
 * And what the review of that fix changed, pinned here end to end as well:
 * the form is filled in as the sender of a create command, wherever they ask
 * (a personal chat, a channel or a group chat): they are checked before the
 * form, its lists are the ones they may read, and the submit is made as
 * whoever submits it, with their own permissions; the maintenance form names the zone its
 * times are read in, a submit is read in that zone first, and a reply read at
 * a bare UTC offset says so; a start that has just gone by (five minutes at
 * most) begins now; a submit pointing at a record the project does not have
 * gets a fixed answer that never names another project's record; an
 * unexpected failure links to creating the thing in OneUptime; no form action
 * that happened is reported as failed because Teams refused its confirmation;
 * a question for the AI assistant whose account lookup fails gets the one
 * generic answer, not "connect your account"; and every failure is logged as
 * one line that names the command, never a question's text, followed by the
 * error itself - unless it is a Bot Connector HTTP error, whose status and
 * code say it all.
 *
 * Every other Teams test in Common drives MicrosoftTeamsUtil with a fake
 * TurnContext, because Common's jest config maps botbuilder,
 * botframework-connector and @azure/* to tiny stubs. That cannot show what the
 * Bot Connector does with an oversized reply, nor what the real CloudAdapter
 * answers Teams when a turn throws. So this file runs the REAL botbuilder
 * stack end to end:
 *
 *   fake Express req -> MicrosoftTeamsUtil.processBotActivity
 *     -> real CloudAdapter.process -> real TeamsActivityHandler
 *     -> handleBotMessageActivity -> real TurnContext.sendActivity
 *     -> real ConnectorClient (@azure/core-client pipeline) -> HTTP
 *     -> fake Bot Connector on 127.0.0.1 (records every POST and DELETE,
 *        answers 413 MessageSizeTooBig above a UTF-16 size limit, like Teams,
 *        and any other refusal a test asks for)
 *   and back: RestError -> handler -> CloudAdapter.process -> HTTP status.
 *
 * How the real botbuilder gets in (the moduleNameMapper stubs win otherwise):
 *
 * - jest.mock("botbuilder", factory) still works although the name is
 *   moduleNameMapper-mapped: jest keys explicit mocks by the resolved path, and
 *   both the mock registration and every importer resolve "botbuilder" to the
 *   same mapped stub path, so the factory result replaces the stub for this
 *   file's whole module registry (MicrosoftTeams.ts and Actions/* included).
 *
 * - The factory must load botbuilder with NODE's require, not jest's. Inside
 *   jest, require("module") is jest's own shim whose createRequire() returns
 *   a jest-registry require - it still applies moduleNameMapper and hands back
 *   the 7-key stub. process.getBuiltinModule("module") (Node >= 22.3; CI runs
 *   Node 26) is not shimmed and returns the real node:module, so its
 *   createRequire() loads botbuilder and all of its dependencies
 *   (botbuilder-core, botframework-connector, @azure/*, zod...) through
 *   Node's own loader, outside jest's registry and mapper.
 *
 * - Consequence: the real stack lives in the worker's OUTER realm (real Node
 *   globals), while the code under test runs in the jsdom test realm. Errors
 *   the connector throws are outer-realm Errors, so `err instanceof Error` is
 *   FALSE in this file and in the code under test here (it is true in
 *   production, where there is one realm). That is one reason the production
 *   code recognizes connector errors by their fields (statusCode, code), not
 *   by their class. CloudAdapter.process likewise logs with the outer realm's
 *   console, which is what outerConsole below watches.
 *
 * Authentication: the adapter is built with no MicrosoftAppId, so
 * botframework-connector reports authentication disabled - a request with no
 * Authorization header is accepted anonymously and outbound connector calls
 * carry no bearer token. Everything after authentication is the production
 * path. The adapter is injected as MicrosoftTeamsUtil's cached adapter, so
 * processBotActivity uses it exactly as it would use the one getBotAdapter()
 * builds (which, like this one, has no onTurnError).
 *
 * Teams redelivery is the one step this file cannot run for real. Microsoft
 * documents that Teams retries a turn that takes over 15 seconds, and resends
 * activities after transient failures; the customer's two identical bubbles a
 * few seconds apart were one such redelivery after our HTTP 500.
 * deliverLikeTeams() simulates it: after a 5xx answer, or no answer at all,
 * it delivers the same activity (same id) once more, as Teams does. The retry
 * of a slow turn is simulated by holding the first delivery up in a database
 * read and delivering the same activity again meanwhile.
 *
 * Only the seams that touch the database are stubbed: the project's lists,
 * tenant resolution, the chat and team install capture, the sender check (or
 * the tables under it: the account link, the memberships and permissions),
 * the dashboard URL, the reference check (or the records it reads) and the
 * final create. The bot drops an activity id it has already handled for ten
 * minutes (in this process's memory, as Redis is not connected here; one test
 * gives the process a Redis client whose connection is down), so every test
 * sends activities with ids of its own - see nextActivityId().
 *
 * The worker runs in Asia/Tokyo (the docblock on the first line), a zone no
 * sender here is in, so a maintenance window read in the server's zone
 * instead of the sender's cannot pass on any machine. A test that needs the
 * time of day stops the test realm's Date alone (stopTheClockAt); timers stay
 * real, and the botbuilder stack reads the outer realm's clock anyway.
 */

/*
 * Real botbuilder through Node's loader - see the header. Self-contained,
 * because jest hoists this call above every import and declaration.
 */
jest.mock("botbuilder", () => {
  const nodeModuleBuiltin: typeof import("module") =
    typeof process.getBuiltinModule === "function"
      ? process.getBuiltinModule("module")
      : // Fallback: jest's shim subclasses the real Module class.
        Object.getPrototypeOf(jest.requireActual("module"));

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
import {
  MicrosoftTeamsAlertActionType,
  MicrosoftTeamsAlertEpisodeActionType,
  MicrosoftTeamsIncidentActionType,
  MicrosoftTeamsIncidentEpisodeActionType,
  MicrosoftTeamsScheduledMaintenanceActionType,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import {
  MICROSOFT_TEAMS_MAX_CHOICE_TITLE_LENGTH,
  MICROSOFT_TEAMS_MAX_MONITOR_CHOICES,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCardChoices";
import MicrosoftTeamsMessageSize, {
  MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES,
  MICROSOFT_TEAMS_TEXT_MESSAGE_BUDGET_IN_BYTES,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsMessageSize";
import MicrosoftTeamsReplies, {
  MICROSOFT_TEAMS_UNAVAILABLE_REFERENCE_MESSAGE,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsReplies";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import { ProjectScopedReferenceException } from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import { UnreadableReferenceException } from "../../../../Server/Utils/Database/ProjectScopedReferenceRefusal";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import Redis from "../../../../Server/Infrastructure/Redis";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import AlertEpisodeInternalNoteService from "../../../../Server/Services/AlertEpisodeInternalNoteService";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import AlertInternalNoteService from "../../../../Server/Services/AlertInternalNoteService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentEpisodeInternalNoteService from "../../../../Server/Services/IncidentEpisodeInternalNoteService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentPublicNoteService from "../../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import LabelService from "../../../../Server/Services/LabelService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import ScheduledMaintenancePublicNoteService from "../../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import WorkspaceUserAuthTokenService from "../../../../Server/Services/WorkspaceUserAuthTokenService";
import AlertEpisodeInternalNote from "../../../../Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertInternalNote from "../../../../Models/DatabaseModels/AlertInternalNote";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisodeInternalNote from "../../../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "../../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import URL from "../../../../Types/API/URL";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import PositiveNumber from "../../../../Types/PositiveNumber";
import ErrorClass from "../../../../Types/Telemetry/ErrorClass";
import { ERROR_CLASS_ATTRIBUTE_KEY } from "../../../../Types/Telemetry/UnitOfWork";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../Server/Utils/Express";
import logger, { LogAttributes } from "../../../../Server/Utils/Logger";
import {
  Activity,
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  ResourceResponse,
  TeamsActivityHandler,
  TeamsInfo,
  TurnContext,
} from "botbuilder";

// ---- Real Node (the outer realm) ----

type NodeModuleBuiltin = typeof import("module");

function getRealNodeModuleBuiltin(): NodeModuleBuiltin {
  if (typeof process.getBuiltinModule === "function") {
    return process.getBuiltinModule("module");
  }

  return Object.getPrototypeOf(
    jest.requireActual("module"),
  ) as NodeModuleBuiltin;
}

// Node's own require, rooted at this file: outside jest's registry and mapper.
const nativeRequire: NodeJS.Require =
  getRealNodeModuleBuiltin().createRequire(__filename);

/*
 * The outer realm's console: CloudAdapter.process console.error()s a turn
 * that threw, just before it answers Teams with HTTP 500. (jest replaces only
 * the test realm's console.)
 */
const outerConsole: Console = nativeRequire("console") as Console;

// ---- Fake Bot Connector ----

/*
 * Microsoft Learn ("Message size limits"): a bot message may be about 100 KB,
 * measured as UTF-16, and Teams refuses a larger one with HTTP 413 and code
 * MessageSizeTooBig. Tests lower the limit to make Teams refuse a card.
 */
const TEAMS_MESSAGE_LIMIT_IN_UTF16_BYTES: number = 100 * 1024;

/*
 * What the fixed forms are built to: the first card budget, 40 KiB. Written
 * out rather than read from MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES, so a
 * looser budget fails here instead of moving the bar with it.
 */
const CARD_BUDGET_IN_UTF16_BYTES: number = 40 * 1024;

// A card's or a text's size as Teams measures it: UTF-16, two bytes a unit.
function toUtf16Bytes(value: string | JSONObject): number {
  return (typeof value === "string" ? value : JSON.stringify(value)).length * 2;
}

const MESSAGE_SIZE_TOO_BIG_BODY: JSONObject = {
  error: { code: "MessageSizeTooBig", message: "Message size too large." },
};

const ACTIVITY_NOT_FOUND_BODY: JSONObject = {
  error: { code: "NotFound", message: "The activity could not be found." },
};

// Send, reply and delete, as botframework-connector calls them.
const ACTIVITIES_PATH: RegExp =
  /^\/v3\/conversations\/([^/]+)\/activities(?:\/([^/]+))?$/;

interface ConnectorRequestRecord {
  method: string;
  path: string;
  conversationId: string | null;
  // POST: the activity replied to. DELETE: the activity removed.
  activityIdInPath: string | null;
  // The request body's size as Teams measures it: UTF-16, two bytes a unit.
  wireUtf16Bytes: number;
  answeredStatus: number;
  answeredBody: JSONObject;
  activity: JSONObject | null;
}

interface ConnectorAnswer {
  status: number;
  body: JSONObject;
}

// A request to the activities API, as a refusal rule sees it.
interface ConnectorRequest {
  method: string;
  activity: JSONObject | null;
}

/*
 * Refusals the connector gives up on at once (its pipeline retries 408, 5xx
 * but 501 and 505, and a 429 or 503 that says when to retry): Teams refusing
 * a message outright, and refusing a card for a reason other than its size.
 */
const MESSAGE_REFUSED_ANSWER: ConnectorAnswer = {
  status: 403,
  body: { error: { code: "Forbidden", message: "The message was refused." } },
};

const CARD_REFUSED_ANSWER: ConnectorAnswer = {
  status: 400,
  body: { error: { code: "BadArgument", message: "The card was refused." } },
};

// Whether a request posts an adaptive card, such as the form.
function isCardPost(request: ConnectorRequest): boolean {
  return (
    request.method === "POST" &&
    asObjectArray(request.activity?.["attachments"]).length > 0
  );
}

interface FakeBotConnector {
  serviceUrl: string;
  requests: Array<ConnectorRequestRecord>;
  // A POST larger than this is refused with 413 MessageSizeTooBig.
  maxUtf16Bytes: number;
  // What a DELETE of an activity is answered with.
  deleteStatus: number;
  /*
   * When set, a request this returns an answer for is refused with it, e.g.
   * to make Teams refuse one particular message.
   */
  refuse: ((request: ConnectorRequest) => ConnectorAnswer | null) | null;
  close: () => Promise<void>;
}

async function startFakeBotConnector(): Promise<FakeBotConnector> {
  let nextMessageNumber: number = 0;

  const fakeConnector: FakeBotConnector = {
    serviceUrl: "",
    requests: [],
    maxUtf16Bytes: TEAMS_MESSAGE_LIMIT_IN_UTF16_BYTES,
    deleteStatus: 200,
    refuse: null,
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
        const wireUtf16Bytes: number = bodyText.length * 2;

        let activity: JSONObject | null = null;
        try {
          activity = bodyText ? (JSON.parse(bodyText) as JSONObject) : null;
        } catch {
          activity = null;
        }

        let answeredStatus: number = 404;
        let answeredBody: JSONObject = {
          error: {
            code: "NotFound",
            message: `The fake connector has no route for ${req.method} ${path}`,
          },
        };

        const refusal: ConnectorAnswer | null =
          match && fakeConnector.refuse
            ? fakeConnector.refuse({
                method: req.method || "",
                activity: activity,
              })
            : null;

        if (refusal) {
          answeredStatus = refusal.status;
          answeredBody = refusal.body;
        } else if (req.method === "POST" && match) {
          if (wireUtf16Bytes > fakeConnector.maxUtf16Bytes) {
            answeredStatus = 413;
            answeredBody = MESSAGE_SIZE_TOO_BIG_BODY;
          } else {
            nextMessageNumber++;
            answeredStatus = 200;
            answeredBody = { id: `msg-${nextMessageNumber}` };
          }
        } else if (req.method === "DELETE" && match?.[2]) {
          answeredStatus = fakeConnector.deleteStatus;
          answeredBody =
            fakeConnector.deleteStatus < 300 ? {} : ACTIVITY_NOT_FOUND_BODY;
        }

        fakeConnector.requests.push({
          method: req.method || "",
          path: path,
          conversationId: match?.[1] ? decodeURIComponent(match[1]) : null,
          activityIdInPath: match?.[2] ? decodeURIComponent(match[2]) : null,
          wireUtf16Bytes: wireUtf16Bytes,
          answeredStatus: answeredStatus,
          answeredBody: answeredBody,
          activity: activity,
        });

        res.writeHead(answeredStatus, {
          "Content-Type": "application/json; charset=utf-8",
        });
        res.end(JSON.stringify(answeredBody));
      });
    },
  );

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const address: AddressInfo = server.address() as AddressInfo;
  fakeConnector.serviceUrl = `http://127.0.0.1:${address.port}/`;
  fakeConnector.close = async (): Promise<void> => {
    server.closeAllConnections();
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  };

  return fakeConnector;
}

// ---- Fake Express response: what Teams gets back ----

class RecordingResponse {
  // Null until the bot answers, so a delivery nobody answered never reads as 200.
  public statusCode: number | null = null;
  public body: unknown = undefined;
  public ended: boolean = false;
  public headersSent: boolean = false;
  public headers: Record<string, string> = {};

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
    this.ended = true;
    this.headersSent = true;
    return this;
  }

  public header(name: string, value: string): this {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  public setHeader(name: string, value: string): this {
    return this.header(name, value);
  }
}

// ---- The real adapter under test ----

type CachedAdapterSlot = { cachedAdapter: CloudAdapter | null };

interface RealAdapterUnderTest {
  adapter: CloudAdapter;
  // Every error that escaped adapter.sendActivities, i.e. turnContext.sendActivity.
  sendActivitiesErrors: Array<unknown>;
}

function installRealCloudAdapter(): RealAdapterUnderTest {
  const adapter: CloudAdapter = new CloudAdapter(
    new ConfigurationBotFrameworkAuthentication({}),
  );

  const sendActivitiesErrors: Array<unknown> = [];
  const realSendActivities: CloudAdapter["sendActivities"] =
    adapter.sendActivities.bind(adapter);

  // A transparent tap: it records and rethrows, so behaviour is unchanged.
  adapter.sendActivities = async (
    context: TurnContext,
    activities: Array<Partial<Activity>>,
  ): Promise<Array<ResourceResponse>> => {
    try {
      return await realSendActivities(context, activities);
    } catch (error) {
      sendActivitiesErrors.push(error);
      throw error;
    }
  };

  (MicrosoftTeamsUtil as unknown as CachedAdapterSlot).cachedAdapter = adapter;

  return { adapter, sendActivitiesErrors };
}

// ---- The project behind the bot (only the database seams are stubbed) ----

const TENANT_ID: string = "4111aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BOT_ID: string = "28:oneuptime-bot-app-id";
const BOT_NAME: string = "OneUptime";
const SENDER_AAD_OBJECT_ID: string = "00000000-0000-4000-8000-000000004111";
const PERSONAL_CONVERSATION_ID: string = "a:4111-personal-chat";
const GROUP_CONVERSATION_ID: string = "19:group-chat-4111@thread.v2";
const CHANNEL_CONVERSATION_ID: string = "19:ops-channel-4111@thread.tacv2";
const TEAM_ID: string = "19:ops-team-4111@thread.tacv2";
const SENDER_TIMEZONE: string = "America/New_York";
const DASHBOARD_URL: string = "https://oneuptime.example.com/dashboard";
const ONEUPTIME_USER_ID: ObjectID = ObjectID.generate();

const INCIDENT_ADD_LATER_HINT: string =
  "You can add them to the incident in OneUptime after it is created.";
const MAINTENANCE_ADD_LATER_HINT: string =
  "You can add them to the event in OneUptime after it is created.";

type NamedRow = { _id: string; name: string };

interface ProjectShape {
  monitors: number;
  labels?: number | undefined;
  onCallPolicies?: number | undefined;
  severities?: number | undefined;
  monitorStatuses?: number | undefined;
  // Monitor, label and on-call policy names of 100 characters.
  longNames?: boolean | undefined;
}

// Every record the project has, in the order the bot reads them.
interface ProjectData {
  monitors: Array<NamedRow>;
  labels: Array<NamedRow>;
  onCallPolicies: Array<NamedRow>;
  severities: Array<NamedRow>;
  monitorStatuses: Array<NamedRow>;
}

const LONG_NAME_TAIL: string =
  " - checkout, payments and identity services in eu-west-1, us-east-1 and ap-southeast-2";

function padded(index: number, width: number): string {
  return String(index).padStart(width, "0");
}

function toLongName(name: string): string {
  return (name + LONG_NAME_TAIL + LONG_NAME_TAIL).substring(0, 100);
}

function namedRows(
  count: number,
  nameFor: (index: number) => string,
): Array<NamedRow> {
  const rows: Array<NamedRow> = [];
  for (let index: number = 1; index <= count; index++) {
    rows.push({ _id: ObjectID.generate().toString(), name: nameFor(index) });
  }
  return rows;
}

/*
 * The rows a findBy for this query returns: the project's rows (generated in
 * the query's sort order) up to the query's limit, as the database would.
 */
function firstRowsFor(rows: Array<NamedRow>, findBy: unknown): Array<NamedRow> {
  const limit: unknown = (findBy as { limit?: unknown } | undefined)?.limit;

  if (typeof limit === "number") {
    return rows.slice(0, limit);
  }

  if (limit instanceof PositiveNumber) {
    return rows.slice(0, limit.toNumber());
  }

  return rows;
}

function stubProjectData(shape: ProjectShape): ProjectData {
  const name: (value: string) => string = (value: string): string => {
    return shape.longNames ? toLongName(value) : value;
  };

  const data: ProjectData = {
    // 30 characters each, e.g. "Production HTTP Monitor 000001".
    monitors: namedRows(shape.monitors, (index: number) => {
      return name(`Production HTTP Monitor ${padded(index, 6)}`);
    }),
    labels: namedRows(shape.labels ?? 20, (index: number) => {
      return name(`team:platform-${padded(index, 3)}`);
    }),
    onCallPolicies: namedRows(shape.onCallPolicies ?? 10, (index: number) => {
      return name(`Primary On-Call Policy ${padded(index, 3)}`);
    }),
    severities: namedRows(shape.severities ?? 4, (index: number) => {
      return name(`Severity Level ${padded(index, 2)}`);
    }),
    monitorStatuses: namedRows(shape.monitorStatuses ?? 4, (index: number) => {
      return name(
        ["Operational", "Degraded", "Offline", "Under Maintenance"][
          index - 1
        ] || `Status ${padded(index, 2)}`,
      );
    }),
  };

  // Re-spying a spied method returns the same spy, so this just swaps rows.
  jest.spyOn(MonitorService, "findBy").mockImplementation((findBy: unknown) => {
    return Promise.resolve(
      firstRowsFor(data.monitors, findBy) as unknown as Array<Monitor>,
    );
  });
  jest
    .spyOn(MonitorService, "countBy")
    .mockResolvedValue(new PositiveNumber(data.monitors.length));

  jest.spyOn(LabelService, "findBy").mockImplementation((findBy: unknown) => {
    return Promise.resolve(
      firstRowsFor(data.labels, findBy) as unknown as Array<Label>,
    );
  });
  jest
    .spyOn(LabelService, "countBy")
    .mockResolvedValue(new PositiveNumber(data.labels.length));

  jest
    .spyOn(OnCallDutyPolicyService, "findBy")
    .mockImplementation((findBy: unknown) => {
      return Promise.resolve(
        firstRowsFor(
          data.onCallPolicies,
          findBy,
        ) as unknown as Array<OnCallDutyPolicy>,
      );
    });
  jest
    .spyOn(OnCallDutyPolicyService, "countBy")
    .mockResolvedValue(new PositiveNumber(data.onCallPolicies.length));

  jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockImplementation((findBy: unknown) => {
      return Promise.resolve(
        firstRowsFor(
          data.severities,
          findBy,
        ) as unknown as Array<IncidentSeverity>,
      );
    });

  jest
    .spyOn(MonitorStatusService, "findBy")
    .mockImplementation((findBy: unknown) => {
      return Promise.resolve(
        firstRowsFor(
          data.monitorStatuses,
          findBy,
        ) as unknown as Array<MonitorStatus>,
      );
    });

  return data;
}

function stubTenantAndInstallCapture(forProjectId: ObjectID): void {
  jest.spyOn(MicrosoftTeamsUtil, "resolveProjectByTenantId").mockResolvedValue({
    projectAuth: {
      projectId: forProjectId,
    } as unknown as WorkspaceProjectAuthToken,
    isAmbiguous: false,
    candidateProjectIds: [forProjectId],
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
}

// The sender has a connected account and is a member who may create things.
function stubSenderCheck(forProjectId: ObjectID): void {
  jest
    .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
    .mockResolvedValue(ONEUPTIME_USER_ID);

  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockResolvedValue({
      userId: ONEUPTIME_USER_ID,
      tenantId: forProjectId,
    } as DatabaseCommonInteractionProps);

  jest
    .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
    .mockResolvedValue(undefined);
}

/*
 * The real membership and permission checks (getProjectMemberProps and
 * assertCanCreate) in place of the stubs above, over the reads under them:
 * the sender's accepted memberships and their permissions in the project.
 * Null: the linked user holds no accepted membership in the project any
 * more. assertCanCreate stays watched.
 */
function useRealMembershipCheck(permissions: Array<Permission> | null): void {
  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockRestore();
  jest.spyOn(WorkspaceActionAuthorization, "assertCanCreate").mockRestore();
  jest.spyOn(WorkspaceActionAuthorization, "assertCanCreate");

  const memberships: Array<TeamMember> = [];
  if (permissions) {
    const membership: TeamMember = new TeamMember();
    membership.teamId = ObjectID.generate();
    memberships.push(membership);
  }

  const tenantPermission: UserTenantAccessPermission | null = permissions
    ? {
        _type: "UserTenantAccessPermission",
        projectId: projectId,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              isBlockPermission: false,
              labelIds: [],
            };
          },
        ),
      }
    : null;

  jest.spyOn(TeamMemberService, "findBy").mockResolvedValue(memberships);
  jest
    .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
    .mockResolvedValue(null);
  jest
    .spyOn(AccessTokenService, "getUserTenantAccessPermission")
    .mockResolvedValue(tenantPermission);
}

function stubDashboardUrl(): void {
  jest.spyOn(DatabaseConfig, "getDashboardUrl").mockImplementation(() => {
    return Promise.resolve(URL.fromString(DASHBOARD_URL));
  });
}

// ---- Teams activities ----

let activityCounter: number = 0;

/*
 * Unique to this run, so an id claimed by an earlier run can never be taken
 * for a redelivery, even by a claim store that outlives the process.
 */
const RUN_TOKEN: string = ObjectID.generate().toString().substring(0, 8);

/*
 * A fresh activity id. The bot drops an id it has seen in the same
 * conversation (see the header), so tests must not share one.
 */
function nextActivityId(label: string): string {
  activityCounter++;
  return `4111-${RUN_TOKEN}-${label}-${activityCounter}`;
}

type ConversationKind = "personal" | "groupChat" | "channel";

const SENDER: JSONObject = {
  id: "29:1customer-user",
  name: "Customer User",
  aadObjectId: SENDER_AAD_OBJECT_ID,
};

// Someone else in a group chat or channel, who fills in a form posted there.
const OTHER_MEMBER: JSONObject = {
  id: "29:1another-user",
  name: "Another User",
  aadObjectId: "00000000-0000-4000-8000-000000004112",
};

const BOT: JSONObject = { id: BOT_ID, name: BOT_NAME };

function buildConversation(kind: ConversationKind): JSONObject {
  if (kind === "groupChat") {
    return {
      conversationType: "groupChat",
      tenantId: TENANT_ID,
      id: GROUP_CONVERSATION_ID,
      isGroup: true,
    };
  }

  if (kind === "channel") {
    return {
      conversationType: "channel",
      tenantId: TENANT_ID,
      id: CHANNEL_CONVERSATION_ID,
      isGroup: true,
    };
  }

  return {
    conversationType: "personal",
    tenantId: TENANT_ID,
    id: PERSONAL_CONVERSATION_ID,
  };
}

// What Teams puts in channelData: the tenant, and in a channel its team.
function buildChannelData(kind: ConversationKind): JSONObject {
  return kind === "channel"
    ? {
        tenant: { id: TENANT_ID },
        team: { id: TEAM_ID, name: "Operations" },
        channel: { id: CHANNEL_CONVERSATION_ID, name: "incidents" },
      }
    : { tenant: { id: TENANT_ID } };
}

// Teams' clientInfo entity; it names the sender's zone when Teams knows it.
function buildClientInfo(timezone: string | undefined): JSONObject {
  return {
    type: "clientInfo",
    locale: "en-US",
    country: "US",
    platform: "Web",
    ...(timezone ? { timezone: timezone } : {}),
  };
}

/*
 * A message typed to the bot: in a 1:1 chat, or with an @mention in a group
 * chat or a channel.
 */
function buildMessageActivity(options: {
  id: string;
  text: string;
  conversation?: ConversationKind | undefined;
  // The IANA zone Teams puts on the activity itself.
  localTimezone?: string | undefined;
  // The zone in the clientInfo entity: localTimezone's, unless given (even as undefined).
  clientInfoTimezone?: string | undefined;
}): JSONObject {
  const conversation: ConversationKind = options.conversation || "personal";
  const isMention: boolean = conversation !== "personal";
  const timezone: string | undefined = options.localTimezone;
  const clientInfoTimezone: string | undefined =
    "clientInfoTimezone" in options ? options.clientInfoTimezone : timezone;

  return {
    type: "message",
    id: options.id,
    timestamp: "2026-09-29T10:00:00.000Z",
    localTimestamp: "2026-09-29T06:00:00.000-04:00",
    ...(timezone ? { localTimezone: timezone } : {}),
    serviceUrl: connector.serviceUrl,
    channelId: "msteams",
    from: SENDER,
    conversation: buildConversation(conversation),
    recipient: BOT,
    textFormat: "plain",
    locale: "en-US",
    text: isMention ? `<at>${BOT_NAME}</at> ${options.text}` : options.text,
    entities: isMention
      ? [
          {
            type: "mention",
            text: `<at>${BOT_NAME}</at>`,
            mentioned: BOT,
          },
          buildClientInfo(clientInfoTimezone),
        ]
      : [buildClientInfo(clientInfoTimezone)],
    channelData: buildChannelData(conversation),
  };
}

/*
 * What Teams sends when the user presses a card's Action.Submit: a message
 * with no text and no @mention (in a group chat too), replying to the card,
 * whose value holds the inputs and the action's data.
 */
function buildCardSubmitActivity(options: {
  id: string;
  replyToId: string;
  value: JSONObject;
  conversation?: ConversationKind | undefined;
  // Who pressed the button: the sender, unless someone else in the chat did.
  from?: JSONObject | undefined;
  localTimezone?: string | undefined;
  localTimestamp?: string | undefined;
}): JSONObject {
  const conversation: ConversationKind = options.conversation || "personal";
  const timezone: string | undefined = options.localTimezone;

  return {
    type: "message",
    id: options.id,
    replyToId: options.replyToId,
    timestamp: "2026-09-29T10:05:00.000Z",
    localTimestamp: options.localTimestamp || "2026-09-29T06:05:00.000-04:00",
    ...(timezone ? { localTimezone: timezone } : {}),
    serviceUrl: connector.serviceUrl,
    channelId: "msteams",
    from: options.from || SENDER,
    conversation: buildConversation(conversation),
    recipient: BOT,
    locale: "en-US",
    entities: [buildClientInfo(timezone)],
    channelData: {
      ...buildChannelData(conversation),
      source: { name: "message" },
      legacy: { replyToId: options.replyToId },
    },
    value: options.value,
  };
}

// An Adaptive Card Universal Action (Action.Execute) arrives as an invoke.
function buildInvokeActivity(id: string): JSONObject {
  return {
    type: "invoke",
    name: "adaptiveCard/action",
    id: id,
    timestamp: "2026-09-29T10:10:00.000Z",
    serviceUrl: connector.serviceUrl,
    channelId: "msteams",
    from: SENDER,
    conversation: buildConversation("personal"),
    recipient: BOT,
    locale: "en-US",
    value: {
      action: {
        type: "Action.Execute",
        verb: MicrosoftTeamsIncidentActionType.AckIncident,
        data: {
          action: MicrosoftTeamsIncidentActionType.AckIncident,
          actionValue: ObjectID.generate().toString(),
        },
      },
      trigger: "manual",
    },
    channelData: { tenant: { id: TENANT_ID }, source: { name: "message" } },
  };
}

type BotAddedActivityType = "conversationUpdate" | "installationUpdate";

/*
 * The bot added to a group chat, as Teams announces it: a conversationUpdate
 * naming the bot among the members added, and an installationUpdate "add".
 */
function buildBotAddedActivity(
  type: BotAddedActivityType,
  id: string,
): JSONObject {
  return {
    type: type,
    id: id,
    timestamp: "2026-09-29T10:15:00.000Z",
    serviceUrl: connector.serviceUrl,
    channelId: "msteams",
    from: SENDER,
    conversation: buildConversation("groupChat"),
    recipient: BOT,
    ...(type === "conversationUpdate"
      ? { membersAdded: [BOT] }
      : { action: "add" }),
    channelData: { tenant: { id: TENANT_ID } },
  };
}

// ---- Delivery, as Teams does it ----

interface ConnectorCall {
  method: string;
  kind: "card" | "text" | "delete" | "other";
  // A card's heading (first TextBlock), a text's text, a DELETE's target id.
  label: string;
  text: string | null;
  card: JSONObject | null;
  /*
   * The card alone, measured here rather than by MicrosoftTeamsMessageSize,
   * so a wrong measure in the code under test cannot pass its own check.
   */
  cardUtf16Bytes: number | null;
  // The whole request body, as Teams measures it.
  wireUtf16Bytes: number;
  connectorStatus: number;
  accepted: boolean;
  conversationId: string | null;
  activityIdInPath: string | null;
  // The id the connector gave an accepted message; a card submit replies to it.
  messageId: string | null;
}

interface DeliveryRecord {
  // Null when the bot never answered the delivery.
  httpStatus: number | null;
  httpBody: unknown;
  // Everything the bot asked the connector to do while handling it.
  calls: Array<ConnectorCall>;
}

function asObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function asObjectArray(value: unknown): Array<JSONObject> {
  return Array.isArray(value) ? (value as Array<JSONObject>) : [];
}

function summarizeCall(record: ConnectorRequestRecord): ConnectorCall {
  const activity: JSONObject = record.activity || {};
  const firstAttachment: JSONObject | undefined = asObjectArray(
    activity["attachments"],
  )[0];
  const card: JSONObject | null =
    firstAttachment &&
    firstAttachment["contentType"] === "application/vnd.microsoft.card.adaptive"
      ? asObject(firstAttachment["content"])
      : null;
  const text: string | null =
    typeof activity["text"] === "string" ? activity["text"] : null;
  const accepted: boolean =
    record.answeredStatus >= 200 && record.answeredStatus < 300;

  let kind: ConnectorCall["kind"] = "other";
  let label: string = `${record.method} ${record.path}`;

  if (record.method === "DELETE") {
    kind = "delete";
    label = record.activityIdInPath || "";
  } else if (card) {
    kind = "card";
    label = getTextBlocks(card)[0] || "";
  } else if (text !== null) {
    kind = "text";
    label = text;
  }

  return {
    method: record.method,
    kind: kind,
    label: label,
    text: text,
    card: card,
    cardUtf16Bytes: card ? toUtf16Bytes(card) : null,
    wireUtf16Bytes: record.wireUtf16Bytes,
    connectorStatus: record.answeredStatus,
    accepted: accepted,
    conversationId: record.conversationId,
    activityIdInPath: record.activityIdInPath,
    messageId:
      record.method === "POST" &&
      accepted &&
      typeof record.answeredBody["id"] === "string"
        ? record.answeredBody["id"]
        : null,
  };
}

async function deliverOnce(activity: JSONObject): Promise<DeliveryRecord> {
  const firstRequestIndex: number = connector.requests.length;

  const req: ExpressRequest = {
    method: "POST",
    headers: {},
    // Teams posts the JSON again for every delivery; the adapter mutates it.
    body: JSON.parse(JSON.stringify(activity)),
  } as unknown as ExpressRequest;
  const res: RecordingResponse = new RecordingResponse();

  await MicrosoftTeamsUtil.processBotActivity(
    req,
    res as unknown as ExpressResponse,
  );

  return {
    httpStatus: res.statusCode,
    httpBody: res.body,
    calls: connector.requests.slice(firstRequestIndex).map(summarizeCall),
  };
}

// Teams tries a delivery again when the bot failed it or never answered it.
function isFailedDelivery(delivery: DeliveryRecord): boolean {
  return delivery.httpStatus === null || delivery.httpStatus >= 500;
}

/*
 * Delivers an activity and, when the bot answers 5xx or not at all, delivers
 * the SAME activity again (see the header). One redelivery is enough to show
 * a doubled reply.
 */
async function deliverLikeTeams(
  activity: JSONObject,
  maxRedeliveries: number = 1,
): Promise<Array<DeliveryRecord>> {
  const deliveries: Array<DeliveryRecord> = [await deliverOnce(activity)];

  while (
    isFailedDelivery(deliveries[deliveries.length - 1]!) &&
    deliveries.length <= maxRedeliveries
  ) {
    deliveries.push(await deliverOnce(activity));
  }

  return deliveries;
}

// What Teams and the user got, over every delivery of one activity.
interface TeamsView {
  /*
   * The bot's HTTP answer to each delivery (null: none); more than one entry
   * means Teams delivered the activity again.
   */
  httpStatuses: Array<number | null>;
  // What the user sees, in order: every message the connector accepted.
  bubbles: Array<ConnectorCall>;
  // Messages the connector refused.
  refused: Array<ConnectorCall>;
  deletes: Array<ConnectorCall>;
}

function viewOf(deliveries: Array<DeliveryRecord>): TeamsView {
  const calls: Array<ConnectorCall> = [];
  for (const delivery of deliveries) {
    calls.push(...delivery.calls);
  }

  return {
    httpStatuses: deliveries.map((delivery: DeliveryRecord) => {
      return delivery.httpStatus;
    }),
    bubbles: calls.filter((call: ConnectorCall) => {
      return call.method === "POST" && call.accepted;
    }),
    refused: calls.filter((call: ConnectorCall) => {
      return call.method === "POST" && !call.accepted;
    }),
    deletes: calls.filter((call: ConnectorCall) => {
      return call.method === "DELETE";
    }),
  };
}

function labelsOf(calls: Array<ConnectorCall>): Array<string> {
  return calls.map((call: ConnectorCall) => {
    return call.label;
  });
}

function cardOf(call: ConnectorCall | undefined): JSONObject {
  if (!call || !call.card) {
    throw new Error(
      `Expected an adaptive card, got ${call?.kind || "nothing"}`,
    );
  }
  return call.card;
}

function textOf(call: ConnectorCall | undefined): string {
  if (!call || call.text === null) {
    throw new Error(`Expected a text message, got ${call?.kind || "nothing"}`);
  }
  return call.text;
}

// ---- Reading a card ----

function getBodyElements(card: JSONObject): Array<JSONObject> {
  return asObjectArray(card["body"]);
}

function getTextBlocks(card: JSONObject): Array<string> {
  return getBodyElements(card)
    .filter((element: JSONObject) => {
      return element["type"] === "TextBlock";
    })
    .map((element: JSONObject) => {
      return String(element["text"]);
    });
}

function getElement(card: JSONObject, id: string): JSONObject | undefined {
  return getBodyElements(card).find((element: JSONObject) => {
    return element["id"] === id;
  });
}

function getChoices(card: JSONObject, id: string): Array<JSONObject> {
  return asObjectArray(getElement(card, id)?.["choices"]);
}

function getChoiceValues(card: JSONObject, id: string): Array<string> {
  return getChoices(card, id).map((choice: JSONObject) => {
    return String(choice["value"]);
  });
}

function getActions(card: JSONObject): Array<JSONObject> {
  return asObjectArray(card["actions"]);
}

function getSubmitData(card: JSONObject): JSONObject {
  return asObject(
    getActions(card).find((action: JSONObject) => {
      return action["type"] === "Action.Submit";
    })?.["data"],
  );
}

function getCreateInOneUptimeActions(card: JSONObject): Array<JSONObject> {
  return getActions(card).filter((action: JSONObject) => {
    return action["type"] === "Action.OpenUrl";
  });
}

function dashboardLink(route: string): string {
  return `${DASHBOARD_URL}/${projectId.toString()}${route}`;
}

interface CardListExpectation {
  choiceSetId: string;
  pluralNoun: string;
  addLaterHint: string;
  // Every record the project has, in name order.
  rows: Array<NamedRow>;
}

/*
 * The card lists the first N records by name and, when N is short of all of
 * them, says so under the list. Returns N.
 */
function expectListAccountedFor(
  card: JSONObject,
  list: CardListExpectation,
): number {
  const shownIds: Array<string> = getChoiceValues(card, list.choiceSetId);
  const shownCount: number = shownIds.length;
  const totalCount: number = list.rows.length;

  expect(shownIds).toEqual(
    list.rows.slice(0, shownCount).map((row: NamedRow) => {
      return row._id;
    }),
  );

  for (const choice of getChoices(card, list.choiceSetId)) {
    expect(String(choice["title"]).length).toBeLessThanOrEqual(
      MICROSOFT_TEAMS_MAX_CHOICE_TITLE_LENGTH,
    );
  }

  let expectedNote: string | null = null;
  if (shownCount < totalCount) {
    expectedNote =
      shownCount === 0
        ? `This project has ${totalCount} ${list.pluralNoun}, too many to list in Microsoft Teams. ${list.addLaterHint}`
        : `Showing the first ${shownCount} of ${totalCount} ${list.pluralNoun}, by name. ${list.addLaterHint}`;
  }

  expect(
    getTextBlocks(card).filter((text: string) => {
      return (
        text.includes(` ${list.pluralNoun},`) &&
        text.endsWith(list.addLaterHint)
      );
    }),
  ).toEqual(expectedNote ? [expectedNote] : []);

  return shownCount;
}

// ---- The operator log ----

// One logger.error call, as the operator log got it.
interface LoggedErrorCall {
  message: unknown;
  attributes: LogAttributes | undefined;
}

/*
 * MicrosoftTeamsReplies.logFailure: a line that says what failed and why,
 * then the error object itself with the same attributes, so the log keeps its
 * stack and class. (A Bot Connector HTTP error gets the line alone.) Checks
 * both calls, the line at `at` and the error right after it.
 */
function expectFailureLogged(data: {
  at: number;
  line: string;
  error: unknown;
  attributes: LogAttributes | undefined;
}): void {
  expect(loggedErrorCalls[data.at]).toStrictEqual({
    message: data.line,
    attributes: data.attributes,
  });
  expect(loggedErrorCalls[data.at + 1]?.message).toBe(data.error);
  expect(loggedErrorCalls[data.at + 1]?.attributes).toStrictEqual(
    data.attributes,
  );
}

// OneUptime does not know its dashboard URL, so no reply can link into it.
function withoutDashboardUrl(): void {
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockRejectedValue(new Error("simulated: no dashboard URL configured"));
}

/*
 * Stops the clock the code under test reads - the test realm's Date - at
 * `now`, and only that: timers stay real, so HTTP to the fake connector and
 * the real botbuilder stack (which reads the outer realm's clock) run as
 * ever. afterEach starts it again.
 */
function stopTheClockAt(now: Date): void {
  jest.useFakeTimers({
    now: now,
    doNotFake: [
      "hrtime",
      "nextTick",
      "performance",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  });
}

// ---- Lifecycle ----

let connector: FakeBotConnector;
let realAdapter: RealAdapterUnderTest;
let projectId: ObjectID;
let loggedErrors: Array<string> = [];
let loggedErrorCalls: Array<LoggedErrorCall> = [];
let loggedWarnings: Array<string> = [];
let outerConsoleErrorCalls: Array<Array<unknown>> = [];
let originalOuterConsoleError: Console["error"];

beforeAll(async () => {
  connector = await startFakeBotConnector();
});

afterAll(async () => {
  await connector.close();
});

beforeEach(() => {
  connector.requests.splice(0);
  connector.maxUtf16Bytes = TEAMS_MESSAGE_LIMIT_IN_UTF16_BYTES;
  connector.deleteStatus = 200;
  connector.refuse = null;

  realAdapter = installRealCloudAdapter();
  projectId = ObjectID.generate();
  stubTenantAndInstallCapture(projectId);
  stubSenderCheck(projectId);
  stubDashboardUrl();

  loggedErrors = [];
  loggedErrorCalls = [];
  jest
    .spyOn(logger, "error")
    .mockImplementation(
      (message: unknown, attributes?: LogAttributes | undefined): void => {
        loggedErrors.push(String(message));
        loggedErrorCalls.push({ message: message, attributes: attributes });
      },
    );
  loggedWarnings = [];
  jest.spyOn(logger, "warn").mockImplementation((message: unknown) => {
    loggedWarnings.push(String(message));
  });
  // processBotActivity debug-logs whole activities.
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined;
  });

  outerConsoleErrorCalls = [];
  originalOuterConsoleError = outerConsole.error;
  outerConsole.error = (...args: Array<unknown>): void => {
    outerConsoleErrorCalls.push(args);
  };
});

afterEach(() => {
  outerConsole.error = originalOuterConsoleError;
  (MicrosoftTeamsUtil as unknown as CachedAdapterSlot).cachedAdapter = null;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ---- Tests ----

describe("harness: MicrosoftTeamsUtil runs on the real botbuilder stack", () => {
  test("botbuilder is the real package, not the moduleNameMapper stub, and processBotActivity uses the injected adapter", () => {
    expect(typeof CloudAdapter.prototype.process).toBe("function");
    expect(typeof TeamsActivityHandler.prototype.run).toBe("function");
    expect(typeof TeamsInfo.getPagedMembers).toBe("function");
    expect(
      (MicrosoftTeamsUtil as unknown as CachedAdapterSlot).cachedAdapter,
    ).toBe(realAdapter.adapter);
  });

  test("the budgets this file checks against are the ones the code builds to: cards of 40 KiB, then 20 KiB, then no lists; texts of 40 KiB", () => {
    expect(MICROSOFT_TEAMS_CARD_SIZE_BUDGETS_IN_BYTES).toEqual([
      CARD_BUDGET_IN_UTF16_BYTES,
      20 * 1024,
      0,
    ]);
    expect(MICROSOFT_TEAMS_TEXT_MESSAGE_BUDGET_IN_BYTES).toBe(40 * 1024);
  });

  test("Teams' 413 reaches the bot as a RestError whose fields the production code reads", async () => {
    stubProjectData({ monitors: 800 });
    // Low enough that Teams refuses the first card.
    connector.maxUtf16Bytes = 30 * 1024;

    await deliverOnce(
      buildMessageActivity({
        id: nextActivityId("rest-error-shape"),
        text: "create incident",
      }),
    );

    expect(realAdapter.sendActivitiesErrors).toHaveLength(1);
    const error: unknown = realAdapter.sendActivitiesErrors[0];
    const fields: {
      name?: unknown;
      message?: unknown;
      statusCode?: unknown;
      code?: unknown;
      details?: unknown;
      response?: { status?: unknown } | undefined;
    } = error as {
      name?: unknown;
      message?: unknown;
      statusCode?: unknown;
      code?: unknown;
      details?: unknown;
      response?: { status?: unknown } | undefined;
    };

    expect(fields.name).toBe("RestError");
    expect(fields.message).toBe("Message size too large.");
    expect(fields.statusCode).toBe(413);
    expect(fields.code).toBe("MessageSizeTooBig");
    // @azure/core-client puts the parsed error body on details.
    expect(fields.details).toEqual(MESSAGE_SIZE_TOO_BIG_BODY);
    expect(fields.response?.status).toBe(413);

    // A native Error of Node's realm: instanceof this realm's Error is false.
    expect(util.types.isNativeError(error)).toBe(true);
    expect(error instanceof Error).toBe(false);

    // What the production code reads off it.
    expect(MicrosoftTeamsMessageSize.isMessageTooLargeError(error)).toBe(true);
    expect(MicrosoftTeamsMessageSize.getErrorStatusCode(error)).toBe(413);
    expect(MicrosoftTeamsMessageSize.getErrorCode(error)).toBe(
      "MessageSizeTooBig",
    );
    expect(MicrosoftTeamsReplies.describeError(error)).toBe(
      "RestError 413 MessageSizeTooBig: Message size too large.",
    );
  });
});

describe("'create incident' (#4111): one form Teams accepts, one answer, HTTP 200", () => {
  test("800 monitors: one 'Create New Incident' card within 40 KiB that names what it left off, HTTP 200, no redelivery", async () => {
    const project: ProjectData = stubProjectData({ monitors: 800 });
    const activityId: string = nextActivityId("create-incident-800");

    const view: TeamsView = viewOf(
      await deliverLikeTeams(
        buildMessageActivity({ id: activityId, text: "create incident" }),
      ),
    );

    // master: [500, 500] and two "Sorry" bubbles.
    expect(view.httpStatuses).toEqual([200]);
    expect(view.refused).toEqual([]);
    expect(labelsOf(view.bubbles)).toEqual(["Create New Incident"]);

    const form: ConnectorCall = view.bubbles[0]!;
    expect(form.kind).toBe("card");
    // Threaded under the user's message.
    expect(form.conversationId).toBe(PERSONAL_CONVERSATION_ID);
    expect(form.activityIdInPath).toBe(activityId);
    // The whole message, envelope included, is within 40 KiB.
    expect(form.wireUtf16Bytes).toBeLessThanOrEqual(40 * 1024);
    expect(form.cardUtf16Bytes).toBeLessThanOrEqual(CARD_BUDGET_IN_UTF16_BYTES);

    const card: JSONObject = cardOf(form);
    const shownMonitors: number = expectListAccountedFor(card, {
      choiceSetId: "incidentMonitors",
      pluralNoun: "monitors",
      addLaterHint: INCIDENT_ADD_LATER_HINT,
      rows: project.monitors,
    });
    expect(shownMonitors).toBeGreaterThan(0);
    expect(shownMonitors).toBeLessThan(800);
    expect(shownMonitors).toBeLessThanOrEqual(
      MICROSOFT_TEAMS_MAX_MONITOR_CHOICES,
    );
    expect(getTextBlocks(card)).toContain(
      `Showing the first ${shownMonitors} of 800 monitors, by name. ${INCIDENT_ADD_LATER_HINT}`,
    );

    // The shorter lists fit whole, so they carry no note.
    expectListAccountedFor(card, {
      choiceSetId: "labels",
      pluralNoun: "labels",
      addLaterHint: INCIDENT_ADD_LATER_HINT,
      rows: project.labels,
    });
    expect(getChoiceValues(card, "labels")).toHaveLength(20);
    expectListAccountedFor(card, {
      choiceSetId: "onCallDutyPolicies",
      pluralNoun: "on-call policies",
      addLaterHint: INCIDENT_ADD_LATER_HINT,
      rows: project.onCallPolicies,
    });
    expect(getChoiceValues(card, "onCallDutyPolicies")).toHaveLength(10);
    // Severity is required, so it is always listed whole.
    expect(getChoiceValues(card, "incidentSeverity")).toHaveLength(4);

    expect(getSubmitData(card)).toEqual({
      action: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
    });
    expect(getCreateInOneUptimeActions(card)).toEqual([
      {
        type: "Action.OpenUrl",
        title: "Create in OneUptime",
        url: dashboardLink("/incidents/create"),
      },
    ]);

    // Nothing failed on the way, and nothing reached the adapter's 500 path.
    expect(realAdapter.sendActivitiesErrors).toEqual([]);
    expect(outerConsoleErrorCalls).toEqual([]);
    expect(loggedErrors).toEqual([]);
  });

  test("the same activity delivered twice (Teams redelivers after a slow 200): the repeat posts nothing and is answered 200", async () => {
    stubProjectData({ monitors: 800 });
    const activity: JSONObject = buildMessageActivity({
      id: nextActivityId("redelivered"),
      text: "create incident",
    });

    const first: DeliveryRecord = await deliverOnce(activity);
    const repeat: DeliveryRecord = await deliverOnce(activity);

    expect(first.httpStatus).toBe(200);
    expect(labelsOf(first.calls)).toEqual(["Create New Incident"]);
    expect(repeat.httpStatus).toBe(200);
    expect(repeat.calls).toEqual([]);
    // Dropped before any work: the project's monitors were read once.
    expect(MonitorService.findBy).toHaveBeenCalledTimes(1);

    // A new message in the same chat is still answered.
    const next: DeliveryRecord = await deliverOnce(
      buildMessageActivity({
        id: nextActivityId("after-redelivery"),
        text: "create incident",
      }),
    );
    expect(next.httpStatus).toBe(200);
    expect(labelsOf(next.calls)).toEqual(["Create New Incident"]);
  });

  test("Teams redelivers while the first delivery is still being handled (its retry of a slow turn): the redelivery is answered 200 at once and posts nothing, and the user gets one card", async () => {
    const project: ProjectData = stubProjectData({ monitors: 800 });
    const activity: JSONObject = buildMessageActivity({
      id: nextActivityId("slow-first-delivery"),
      text: "create incident",
    });

    /*
     * The first read of the monitors waits until the redelivery has been
     * answered, as a slow database would. Later reads go straight through, so
     * a redelivery that is not dropped posts a card of its own rather than
     * waiting here for ever.
     */
    let isFirstReadStarted: boolean = false;
    let signalFirstReadStarted: () => void = (): void => {
      return undefined;
    };
    const firstReadStarted: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        signalFirstReadStarted = resolve;
      },
    );
    let releaseFirstRead: () => void = (): void => {
      return undefined;
    };
    const firstReadReleased: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        releaseFirstRead = resolve;
      },
    );
    jest
      .spyOn(MonitorService, "findBy")
      .mockImplementation(async (findBy: unknown): Promise<Array<Monitor>> => {
        if (!isFirstReadStarted) {
          isFirstReadStarted = true;
          signalFirstReadStarted();
          await firstReadReleased;
        }
        return firstRowsFor(
          project.monitors,
          findBy,
        ) as unknown as Array<Monitor>;
      });

    const firstDelivery: Promise<DeliveryRecord> = deliverOnce(activity);
    // Fails at once, instead of hanging, if the first delivery never reads the list.
    const failUnlessFirstReadStarted: (error?: unknown) => void = (
      error?: unknown,
    ): void => {
      if (!isFirstReadStarted) {
        throw error || new Error("The first delivery never read the monitors");
      }
    };
    await Promise.race([
      firstReadStarted,
      firstDelivery.then(
        (): void => {
          return failUnlessFirstReadStarted();
        },
        (error: unknown): void => {
          return failUnlessFirstReadStarted(error);
        },
      ),
    ]);

    const redelivery: DeliveryRecord = await deliverOnce(activity);
    releaseFirstRead();
    const first: DeliveryRecord = await firstDelivery;

    // Dropped on arrival: answered while the first delivery was held up.
    expect(redelivery.httpStatus).toBe(200);
    expect(redelivery.calls).toEqual([]);
    /*
     * The first delivery's window spans the redelivery's, so it would show a
     * card the redelivery posted too; it shows exactly one.
     */
    expect(first.httpStatus).toBe(200);
    expect(labelsOf(first.calls)).toEqual(["Create New Incident"]);
    expect(MonitorService.findBy).toHaveBeenCalledTimes(1);
    expect(loggedErrors).toEqual([]);
    expect(outerConsoleErrorCalls).toEqual([]);
  });

  test("the same activity id in another chat is another message (Teams numbers messages per chat): both are answered", async () => {
    stubProjectData({ monitors: 5 });
    const activityId: string = nextActivityId("same-id-two-chats");

    const inPersonalChat: DeliveryRecord = await deliverOnce(
      buildMessageActivity({ id: activityId, text: "create incident" }),
    );
    const inGroupChat: DeliveryRecord = await deliverOnce(
      buildMessageActivity({
        id: activityId,
        text: "create incident",
        conversation: "groupChat",
      }),
    );

    expect([inPersonalChat.httpStatus, inGroupChat.httpStatus]).toEqual([
      200, 200,
    ]);
    expect(
      [...inPersonalChat.calls, ...inGroupChat.calls].map(
        (call: ConnectorCall) => {
          return [call.conversationId, call.label];
        },
      ),
    ).toEqual([
      [PERSONAL_CONVERSATION_ID, "Create New Incident"],
      [GROUP_CONVERSATION_ID, "Create New Incident"],
    ]);
  });

  test("Teams refuses the 40 KiB card (limit lowered to 30 KiB): the connector sees 413 then a smaller card it accepts, and the user sees one card", async () => {
    const project: ProjectData = stubProjectData({ monitors: 800 });
    connector.maxUtf16Bytes = 30 * 1024;

    const deliveries: Array<DeliveryRecord> = await deliverLikeTeams(
      buildMessageActivity({
        id: nextActivityId("create-incident-30k"),
        text: "create incident",
      }),
    );
    const view: TeamsView = viewOf(deliveries);
    const calls: Array<ConnectorCall> = deliveries[0]!.calls;

    expect(view.httpStatuses).toEqual([200]);
    expect(
      calls.map((call: ConnectorCall) => {
        return [call.kind, call.label, call.connectorStatus];
      }),
    ).toEqual([
      ["card", "Create New Incident", 413],
      ["card", "Create New Incident", 200],
    ]);

    const refused: ConnectorCall = calls[0]!;
    const accepted: ConnectorCall = calls[1]!;
    expect(refused.wireUtf16Bytes).toBeGreaterThan(30 * 1024);
    expect(refused.cardUtf16Bytes).toBeLessThanOrEqual(
      CARD_BUDGET_IN_UTF16_BYTES,
    );
    expect(accepted.wireUtf16Bytes).toBeLessThanOrEqual(30 * 1024);
    // Built for the second budget, 20 KiB.
    expect(accepted.cardUtf16Bytes).toBeLessThanOrEqual(20 * 1024);
    expect(view.bubbles).toEqual([accepted]);

    // The smaller card lists fewer monitors, and still says what it left off.
    const shownInRefused: number = getChoiceValues(
      cardOf(refused),
      "incidentMonitors",
    ).length;
    const shownInAccepted: number = expectListAccountedFor(cardOf(accepted), {
      choiceSetId: "incidentMonitors",
      pluralNoun: "monitors",
      addLaterHint: INCIDENT_ADD_LATER_HINT,
      rows: project.monitors,
    });
    expect(shownInAccepted).toBeGreaterThan(0);
    expect(shownInAccepted).toBeLessThan(shownInRefused);
    expect(getCreateInOneUptimeActions(cardOf(accepted))).toEqual([
      {
        type: "Action.OpenUrl",
        title: "Create in OneUptime",
        url: dashboardLink("/incidents/create"),
      },
    ]);

    // The refusal is a warning for the operator, not an error for the user.
    expect(loggedWarnings).toEqual([
      `Microsoft Teams refused a ${refused.cardUtf16Bytes} byte card as too large (budget ${CARD_BUDGET_IN_UTF16_BYTES} bytes); trying a smaller one.`,
    ]);
    expect(loggedErrors).toEqual([]);
    expect(outerConsoleErrorCalls).toEqual([]);
  });

  test("Teams refuses every card (limit 2 KiB): one text says the form was refused as too large and links to creating it in OneUptime, HTTP 200", async () => {
    stubProjectData({ monitors: 800 });
    connector.maxUtf16Bytes = 2 * 1024;

    const deliveries: Array<DeliveryRecord> = await deliverLikeTeams(
      buildMessageActivity({
        id: nextActivityId("create-incident-2k"),
        text: "create incident",
      }),
    );
    const view: TeamsView = viewOf(deliveries);
    const calls: Array<ConnectorCall> = deliveries[0]!.calls;

    expect(view.httpStatuses).toEqual([200]);
    // One card per budget (40 KiB, 20 KiB, no lists), then the explanation.
    expect(
      calls.map((call: ConnectorCall) => {
        return [call.kind, call.connectorStatus];
      }),
    ).toEqual([
      ["card", 413],
      ["card", 413],
      ["card", 413],
      ["text", 200],
    ]);

    const withoutLists: JSONObject = cardOf(calls[2]);
    expect(getElement(withoutLists, "incidentMonitors")).toBeUndefined();
    expect(getElement(withoutLists, "labels")).toBeUndefined();
    expect(getElement(withoutLists, "onCallDutyPolicies")).toBeUndefined();

    expect(view.bubbles).toHaveLength(1);
    const reply: string = textOf(view.bubbles[0]);
    expect(reply).toMatch(
      /^Sorry, I couldn't open the form to create an incident: Microsoft Teams refused it as too large/,
    );
    expect(reply).toContain(dashboardLink("/incidents/create"));

    /*
     * A Bot Connector HTTP error is logged as the one line: its status and
     * code say it all, and the object carries the whole request and response.
     */
    expect(loggedErrorCalls).toStrictEqual([
      {
        message:
          "Microsoft Teams did not accept the form to create an incident: RestError 413 MessageSizeTooBig: Message size too large.",
        attributes: { projectId: projectId.toString() },
      },
    ]);
    expect(outerConsoleErrorCalls).toEqual([]);
  });

  test("Teams refuses the explanation too (limit 512 bytes): still one delivery answered HTTP 200, and the operator log says why the user saw nothing", async () => {
    stubProjectData({ monitors: 800 });
    connector.maxUtf16Bytes = 512;

    const deliveries: Array<DeliveryRecord> = await deliverLikeTeams(
      buildMessageActivity({
        id: nextActivityId("create-incident-512"),
        text: "create incident",
      }),
    );
    const view: TeamsView = viewOf(deliveries);

    /*
     * master: the handler's catch replied "Sorry..." and rethrew; whether or
     * not that reply got through, the adapter answered 500 and Teams
     * delivered the message again.
     */
    expect(view.httpStatuses).toEqual([200]);
    expect(
      deliveries[0]!.calls.map((call: ConnectorCall) => {
        return [call.kind, call.connectorStatus];
      }),
    ).toEqual([
      ["card", 413],
      ["card", 413],
      ["card", 413],
      ["text", 413],
    ]);
    expect(view.bubbles).toEqual([]);
    expect(loggedErrors).toEqual([
      "Microsoft Teams did not accept the form to create an incident: RestError 413 MessageSizeTooBig: Message size too large.",
      "Could not send a Microsoft Teams reply: RestError 413 MessageSizeTooBig: Message size too large.",
    ]);
    expect(outerConsoleErrorCalls).toEqual([]);
  });

  test("Teams refuses the form for a reason other than its size (400 BadArgument): no smaller card is tried, and one text names Teams' status and code and links to creating it in OneUptime, HTTP 200", async () => {
    stubProjectData({ monitors: 800 });
    connector.refuse = (request: ConnectorRequest): ConnectorAnswer | null => {
      return isCardPost(request) ? CARD_REFUSED_ANSWER : null;
    };

    const deliveries: Array<DeliveryRecord> = await deliverLikeTeams(
      buildMessageActivity({
        id: nextActivityId("create-incident-400"),
        text: "create incident",
      }),
    );
    const view: TeamsView = viewOf(deliveries);

    expect(view.httpStatuses).toEqual([200]);
    // Only a refusal for size is worth a smaller card; this one is final.
    expect(
      deliveries[0]!.calls.map((call: ConnectorCall) => {
        return [call.kind, call.connectorStatus];
      }),
    ).toEqual([
      ["card", 400],
      ["text", 200],
    ]);
    // The real RestError's status and code, in the user's words.
    expect(labelsOf(view.bubbles)).toEqual([
      `Sorry, I couldn't open the form to create an incident: Microsoft Teams did not accept it (400 BadArgument). You can create it in OneUptime instead: ${dashboardLink("/incidents/create")}`,
    ]);
    expect(loggedWarnings).toEqual([]);
    // One line, as for any Bot Connector HTTP error.
    expect(loggedErrorCalls).toStrictEqual([
      {
        message:
          "Microsoft Teams did not accept the form to create an incident: RestError 400 BadArgument: The card was refused.",
        attributes: { projectId: projectId.toString() },
      },
    ]);
    expect(outerConsoleErrorCalls).toEqual([]);
  });

  // A type, not an interface: test.each wants a Record<string, unknown> row.
  type ListsUnreadableCase = {
    command: string;
    what: string;
    createRoute: string;
    // Whether OneUptime knows its dashboard URL, to link to the create page.
    hasDashboardUrl: boolean;
  };

  test.each<ListsUnreadableCase>([
    {
      command: "create incident",
      what: "an incident",
      createRoute: "/incidents/create",
      hasDashboardUrl: true,
    },
    {
      command: "create maintenance",
      what: "a scheduled maintenance event",
      createRoute: "/scheduled-maintenance-events/create",
      hasDashboardUrl: true,
    },
    {
      command: "create incident",
      what: "an incident",
      createRoute: "/incidents/create",
      hasDashboardUrl: false,
    },
  ])(
    "'$command' when the project's monitors cannot be read (dashboard URL known: $hasDashboardUrl): one text that says so and where else to create it, HTTP 200, no redelivery",
    async (unreadable: ListsUnreadableCase) => {
      stubProjectData({ monitors: 5 });
      const databaseFailure: Error = new Error("simulated database failure");
      jest.spyOn(MonitorService, "findBy").mockRejectedValue(databaseFailure);
      if (!unreadable.hasDashboardUrl) {
        withoutDashboardUrl();
      }

      const view: TeamsView = viewOf(
        await deliverLikeTeams(
          buildMessageActivity({
            id: nextActivityId("lists-unreadable"),
            text: unreadable.command,
          }),
        ),
      );

      // master: [500, 500] and two "Sorry" bubbles.
      expect(view.httpStatuses).toEqual([200]);
      expect(view.refused).toEqual([]);
      expect(labelsOf(view.bubbles)).toEqual([
        `Sorry, I couldn't open the form to create ${unreadable.what} because OneUptime could not load the lists it needs just now. Please try again in a minute, or create it in OneUptime instead${
          unreadable.hasDashboardUrl
            ? `: ${dashboardLink(unreadable.createRoute)}`
            : "."
        }`,
      ]);
      // What failed, then the error itself.
      expect(loggedErrors).toEqual([
        `Could not load the Microsoft Teams form to create ${unreadable.what}: Error: simulated database failure`,
        "Error: simulated database failure",
      ]);
      expectFailureLogged({
        at: 0,
        line: loggedErrors[0]!,
        error: databaseFailure,
        attributes: { projectId: projectId.toString() },
      });
      expect(outerConsoleErrorCalls).toEqual([]);
    },
  );

  // A type, not an interface: test.each wants a Record<string, unknown> row.
  type NoSeveritiesCase = {
    hasDashboardUrl: boolean;
  };

  test.each<NoSeveritiesCase>([
    { hasDashboardUrl: true },
    { hasDashboardUrl: false },
  ])(
    "a project without incident severities (dashboard URL known: $hasDashboardUrl): one text that says where to add one, no form",
    async (noSeverities: NoSeveritiesCase) => {
      stubProjectData({ monitors: 5, severities: 0 });
      if (!noSeverities.hasDashboardUrl) {
        withoutDashboardUrl();
      }

      const view: TeamsView = viewOf(
        await deliverLikeTeams(
          buildMessageActivity({
            id: nextActivityId("no-severities"),
            text: "create incident",
          }),
        ),
      );

      expect(view.httpStatuses).toEqual([200]);
      expect(view.refused).toEqual([]);
      /*
       * Where the dashboard has the page, linked when it can be:
       * /dashboard/<project>/incidents/settings/severity.
       */
      expect(labelsOf(view.bubbles)).toEqual([
        `An incident needs a severity, and this project has no incident severities yet. Add one in OneUptime under ${
          noSeverities.hasDashboardUrl
            ? `[Incidents → Settings → Incident Severity](${dashboardLink("/incidents/settings/severity")})`
            : "Incidents → Settings → Incident Severity"
        }, then try again.`,
      ]);
      expect(loggedErrors).toEqual([]);
    },
  );

  // A type, not an interface: test.each wants a Record<string, unknown> row.
  type NotLinkedCase = {
    command: string;
    // How the reply starts: why the sender needs a connected account.
    purpose: string;
  };

  test.each<NotLinkedCase>([
    {
      command: "create incident",
      purpose: "To create incidents from Microsoft Teams",
    },
    {
      command: "create maintenance",
      purpose: "To schedule maintenance from Microsoft Teams",
    },
  ])(
    "'$command' from a Teams user with no connected account: one reply pointing at User Settings → Microsoft Teams, no form",
    async (notLinked: NotLinkedCase) => {
      stubProjectData({ monitors: 800 });
      /*
       * The real account lookup runs, and finds no link: only the table under
       * it is stubbed, so it is Auth.ts that says the account is not linked.
       */
      jest
        .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
        .mockRestore();
      jest
        .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
        .mockResolvedValue(null);

      const view: TeamsView = viewOf(
        await deliverLikeTeams(
          buildMessageActivity({
            id: nextActivityId("not-linked"),
            text: notLinked.command,
          }),
        ),
      );

      expect(view.httpStatuses).toEqual([200]);
      expect(view.refused).toEqual([]);
      expect(view.bubbles).toHaveLength(1);
      const reply: string = textOf(view.bubbles[0]);
      expect(reply.startsWith(notLinked.purpose)).toBe(true);
      expect(reply).toContain("User Settings → Microsoft Teams");
      expect(reply).toContain(
        dashboardLink("/user-settings/microsoft-teams-integration"),
      );
      // The link looked for was this sender's, in this project.
      expect(WorkspaceUserAuthTokenService.findOneBy).toHaveBeenCalledTimes(1);
      expect(WorkspaceUserAuthTokenService.findOneBy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            workspaceUserId: SENDER_AAD_OBJECT_ID,
            projectId: projectId,
          }),
        }),
      );
      // Told before filling the form in: the lists were never read.
      expect(MonitorService.findBy).not.toHaveBeenCalled();
      // Expected, not a server error.
      expect(loggedErrors).toEqual([]);
    },
  );
});

describe("'create maintenance' (#4111)", () => {
  test("in a group chat (@mention), 800 monitors: one card for everyone there, that names the sender's time zone and carries it in its submit data", async () => {
    const project: ProjectData = stubProjectData({ monitors: 800 });
    const activityId: string = nextActivityId("create-maintenance-group");

    const view: TeamsView = viewOf(
      await deliverLikeTeams(
        buildMessageActivity({
          id: activityId,
          text: "create maintenance Database Upgrade Window",
          conversation: "groupChat",
          localTimezone: SENDER_TIMEZONE,
        }),
      ),
    );

    // master: [500, 500] and two "Sorry" bubbles.
    expect(view.httpStatuses).toEqual([200]);
    expect(view.refused).toEqual([]);
    expect(labelsOf(view.bubbles)).toEqual([
      "Create New Scheduled Maintenance",
    ]);

    const form: ConnectorCall = view.bubbles[0]!;
    expect(form.conversationId).toBe(GROUP_CONVERSATION_ID);
    expect(form.activityIdInPath).toBe(activityId);
    expect(form.wireUtf16Bytes).toBeLessThanOrEqual(40 * 1024);
    expect(form.cardUtf16Bytes).toBeLessThanOrEqual(CARD_BUDGET_IN_UTF16_BYTES);

    const card: JSONObject = cardOf(form);
    /*
     * The zone the start and end are typed in, named and sent back on submit.
     * Not "your time zone": whoever fills the form in may be somewhere else.
     */
    expect(getTextBlocks(card)).toContain(
      `Start and end times are in ${SENDER_TIMEZONE}.`,
    );
    expect(getSubmitData(card)).toEqual({
      action:
        MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
      timezone: SENDER_TIMEZONE,
    });
    // The words after the command, as typed (the @mention stripped).
    expect(getElement(card, "scheduledMaintenanceTitle")?.["value"]).toBe(
      "Database Upgrade Window",
    );

    const shownMonitors: number = expectListAccountedFor(card, {
      choiceSetId: "scheduledMaintenanceMonitors",
      pluralNoun: "monitors",
      addLaterHint: MAINTENANCE_ADD_LATER_HINT,
      rows: project.monitors,
    });
    expect(shownMonitors).toBeGreaterThan(0);
    expect(shownMonitors).toBeLessThan(800);
    expect(getCreateInOneUptimeActions(card)).toEqual([
      {
        type: "Action.OpenUrl",
        title: "Create in OneUptime",
        url: dashboardLink("/scheduled-maintenance-events/create"),
      },
    ]);

    /*
     * The form is filled in as the one who asked for it, in a group chat too:
     * they are checked first, and its lists are the ones they may read.
     * Whoever submits it is checked as themselves.
     */
    expect(
      MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId,
    ).toHaveBeenCalledTimes(1);
    expect(
      WorkspaceActionAuthorization.getProjectMemberProps,
    ).toHaveBeenCalledTimes(1);
    expect(WorkspaceActionAuthorization.assertCanCreate).toHaveBeenCalledTimes(
      1,
    );
    const monitorRead: { props: DatabaseCommonInteractionProps } = (
      MonitorService.findBy as unknown as jest.Mock
    ).mock.calls[0]![0] as { props: DatabaseCommonInteractionProps };
    expect(monitorRead.props).toEqual({
      userId: ONEUPTIME_USER_ID,
      tenantId: projectId,
    });
    expect(outerConsoleErrorCalls).toEqual([]);
    expect(loggedErrors).toEqual([]);
  });

  // A type, not an interface: test.each wants a Record<string, unknown> row.
  type ZoneSourceCase = {
    description: string;
    localTimezone: string | undefined;
    clientInfoTimezone: string | undefined;
    // The zone the card names and carries in its submit data; null for none.
    expectedTimezone: string | null;
  };

  /*
   * Each place Teams names the sender's zone, as the real adapter hands the
   * activity over: a field it dropped would leave the form without a zone.
   */
  test.each<ZoneSourceCase>([
    {
      description:
        "the activity's localTimezone, over a different clientInfo zone",
      localTimezone: SENDER_TIMEZONE,
      clientInfoTimezone: "Europe/Berlin",
      expectedTimezone: SENDER_TIMEZONE,
    },
    {
      description: "the clientInfo entity's zone, when the activity names none",
      localTimezone: undefined,
      clientInfoTimezone: "Asia/Kolkata",
      expectedTimezone: "Asia/Kolkata",
    },
    {
      description:
        "no zone anywhere (iOS has been seen to send none): the card says so and carries none",
      localTimezone: undefined,
      clientInfoTimezone: undefined,
      expectedTimezone: null,
    },
  ])(
    "the zone on the form comes from $description",
    async (zoneCase: ZoneSourceCase) => {
      stubProjectData({ monitors: 5 });

      const view: TeamsView = viewOf(
        await deliverLikeTeams(
          buildMessageActivity({
            id: nextActivityId("maintenance-zone"),
            text: "create maintenance",
            localTimezone: zoneCase.localTimezone,
            clientInfoTimezone: zoneCase.clientInfoTimezone,
          }),
        ),
      );

      expect(view.httpStatuses).toEqual([200]);
      expect(labelsOf(view.bubbles)).toEqual([
        "Create New Scheduled Maintenance",
      ]);
      const card: JSONObject = cardOf(view.bubbles[0]);
      expect(getTextBlocks(card)).toContain(
        zoneCase.expectedTimezone
          ? `Start and end times are in ${zoneCase.expectedTimezone}.`
          : "Start and end times are in the time zone Microsoft Teams reports for you, or in UTC if it does not report one.",
      );
      expect(getSubmitData(card)).toEqual({
        action:
          MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
        ...(zoneCase.expectedTimezone
          ? { timezone: zoneCase.expectedTimezone }
          : {}),
      });
    },
  );
});

describe("who is checked before the form (#4111 review): the sender of a personal chat; in a channel or group chat nobody, as the submit checks whoever submits", () => {
  // A type, not an interface: test.each wants a Record<string, unknown> row.
  type SharedChatCase = {
    command: string;
    heading: string;
    conversation: ConversationKind;
    conversationId: string;
  };

  test.each<SharedChatCase>([
    {
      command: "create incident",
      heading: "Create New Incident",
      conversation: "groupChat",
      conversationId: GROUP_CONVERSATION_ID,
    },
    {
      command: "create incident",
      heading: "Create New Incident",
      conversation: "channel",
      conversationId: CHANNEL_CONVERSATION_ID,
    },
    {
      command: "create maintenance",
      heading: "Create New Scheduled Maintenance",
      conversation: "groupChat",
      conversationId: GROUP_CONVERSATION_ID,
    },
    {
      command: "create maintenance",
      heading: "Create New Scheduled Maintenance",
      conversation: "channel",
      conversationId: CHANNEL_CONVERSATION_ID,
    },
  ])(
    "'$command' in a $conversation, from a sender without a connected account: told where to connect it, and no form is posted for everyone there",
    async (sharedChat: SharedChatCase) => {
      stubProjectData({ monitors: 5 });
      // Each check would refuse this sender, were it asked.
      jest
        .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
        .mockRejectedValue(
          new MicrosoftTeamsAccountNotLinkedException(
            "No OneUptime user linked to this Microsoft Teams user. Please authenticate with Microsoft Teams.",
          ),
        );
      jest
        .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
        .mockRejectedValue(
          new NotAuthorizedException(
            WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
          ),
        );
      jest
        .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
        .mockRejectedValue(
          new NotAuthorizedException(
            "You do not have permission to create a scheduled maintenance event.",
          ),
        );
      const activityId: string = nextActivityId("shared-chat-form");

      const view: TeamsView = viewOf(
        await deliverLikeTeams(
          buildMessageActivity({
            id: activityId,
            text: sharedChat.command,
            conversation: sharedChat.conversation,
          }),
        ),
      );

      expect(view.httpStatuses).toEqual([200]);
      expect(view.refused).toEqual([]);
      // One text bubble, in the chat it was asked in: where to connect the account.
      expect(
        view.bubbles.map((call: ConnectorCall) => {
          return [call.kind, call.conversationId];
        }),
      ).toEqual([["text", sharedChat.conversationId]]);
      expect(view.bubbles[0]!.label).toMatch(
        /^To (create incidents|schedule maintenance) from Microsoft Teams, first connect your Microsoft Teams account to OneUptime/,
      );
      expect(
        MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId,
      ).toHaveBeenCalledTimes(1);
      expect(
        WorkspaceActionAuthorization.getProjectMemberProps,
      ).not.toHaveBeenCalled();
      expect(
        WorkspaceActionAuthorization.assertCanCreate,
      ).not.toHaveBeenCalled();
      // Nobody's lists were read for everyone there.
      expect(MonitorService.findBy).not.toHaveBeenCalled();
      expect(loggedErrors).toEqual([]);
    },
  );

  // A type, not an interface: test.each wants a Record<string, unknown> row.
  type PersonalChatCommandCase = {
    command: string;
  };

  test.each<PersonalChatCommandCase>([
    { command: "create incident" },
    { command: "create maintenance" },
  ])(
    "'$command' in a personal chat from a Teams user who is no longer a member of the project: told so by the real membership check, once, before the form; the lists are never read",
    async (personal: PersonalChatCommandCase) => {
      stubProjectData({ monitors: 800 });
      useRealMembershipCheck(null);

      const view: TeamsView = viewOf(
        await deliverLikeTeams(
          buildMessageActivity({
            id: nextActivityId("personal-not-member"),
            text: personal.command,
          }),
        ),
      );

      expect(view.httpStatuses).toEqual([200]);
      expect(labelsOf(view.bubbles)).toEqual([
        "Your OneUptime account is not a member of this project. Ask a project admin to invite you, then try again.",
      ]);
      // The one checked is the sender, in this project, from the database.
      expect(TeamMemberService.findBy).toHaveBeenCalledTimes(1);
      expect(TeamMemberService.findBy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            userId: ONEUPTIME_USER_ID,
            projectId: projectId,
            hasAcceptedInvitation: true,
          },
        }),
      );
      expect(MonitorService.findBy).not.toHaveBeenCalled();
      // A refusal, not a server error.
      expect(loggedErrors).toEqual([]);
    },
  );

  test("'create maintenance' in a personal chat from a member who may not create scheduled maintenance (a read-only Viewer): told why by the real permission check, once, before the form", async () => {
    stubProjectData({ monitors: 5 });
    useRealMembershipCheck([Permission.Viewer]);

    const view: TeamsView = viewOf(
      await deliverLikeTeams(
        buildMessageActivity({
          id: nextActivityId("personal-no-permission"),
          text: "create maintenance",
        }),
      ),
    );

    expect(view.httpStatuses).toEqual([200]);
    // The same refusal a submit would get (see the maintenance submit tests).
    expect(labelsOf(view.bubbles)).toEqual([
      "You do not have permission to create a scheduled maintenance event. You do not have permissions to create Scheduled Maintenance Event. You need one of these permissions: Project Owner, Project Admin, Project Member, Scheduled Maintenance Admin, Scheduled Maintenance Member, Create Scheduled Maintenance",
    ]);
    expect(WorkspaceActionAuthorization.assertCanCreate).toHaveBeenCalledTimes(
      1,
    );
    expect(WorkspaceActionAuthorization.assertCanCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: ScheduledMaintenance,
        action: "create a scheduled maintenance event",
      }),
    );
    expect(MonitorService.findBy).not.toHaveBeenCalled();
    expect(loggedErrors).toEqual([]);
  });

  test("'create incident' in a personal chat from a member who may not declare an incident (a read-only Viewer): told why by the real permission check, once, before the form", async () => {
    stubProjectData({ monitors: 5 });
    useRealMembershipCheck([Permission.Viewer]);

    const view: TeamsView = viewOf(
      await deliverLikeTeams(
        buildMessageActivity({
          id: nextActivityId("personal-incident-no-permission"),
          text: "create incident",
        }),
      ),
    );

    expect(view.httpStatuses).toEqual([200]);
    // The same refusal a submit would get (see the incident submit tests).
    expect(labelsOf(view.bubbles)).toEqual([
      "You do not have permission to declare an incident. You do not have permissions to create Incident. You need one of these permissions: Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Create Incident",
    ]);
    expect(TeamMemberService.findBy).toHaveBeenCalledTimes(1);
    expect(WorkspaceActionAuthorization.assertCanCreate).toHaveBeenCalledTimes(
      1,
    );
    expect(WorkspaceActionAuthorization.assertCanCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: Incident,
        action: "declare an incident",
      }),
    );
    expect(MonitorService.findBy).not.toHaveBeenCalled();
    expect(loggedErrors).toEqual([]);
  });

  test("the sender of a personal chat cannot be checked (the membership read fails): one reply says to try again, the log says why, HTTP 200", async () => {
    stubProjectData({ monitors: 5 });
    const membershipFailure: Error = new Error(
      "simulated membership read failure",
    );
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockRejectedValue(membershipFailure);

    const view: TeamsView = viewOf(
      await deliverLikeTeams(
        buildMessageActivity({
          id: nextActivityId("personal-check-fails"),
          text: "create incident",
        }),
      ),
    );

    expect(view.httpStatuses).toEqual([200]);
    expect(labelsOf(view.bubbles)).toEqual([
      "Sorry, I couldn't open the form to create an incident because OneUptime could not check your account just now. Please try again in a minute.",
    ]);
    expect(MonitorService.findBy).not.toHaveBeenCalled();
    expect(loggedErrors).toEqual([
      "Could not check the Microsoft Teams sender of a create command: Error: simulated membership read failure",
      "Error: simulated membership read failure",
    ]);
    expectFailureLogged({
      at: 0,
      line: loggedErrors[0]!,
      error: membershipFailure,
      attributes: { projectId: projectId.toString() },
    });
  });
});

describe("a title or a name past the form's limits (#4111 review): cut before an emoji, never through it", () => {
  // A type, not an interface: test.each wants a Record<string, unknown> row.
  type TitleCutCase = {
    command: string;
    titleInputId: string;
    monitorsChoiceSetId: string;
    // The title column's length, and the title input's maxLength.
    titleMaxLength: number;
  };

  test.each<TitleCutCase>([
    {
      command: "create incident",
      titleInputId: "incidentTitle",
      monitorsChoiceSetId: "incidentMonitors",
      titleMaxLength: 500,
    },
    {
      command: "create maintenance",
      titleInputId: "scheduledMaintenanceTitle",
      monitorsChoiceSetId: "scheduledMaintenanceMonitors",
      titleMaxLength: 100,
    },
  ])(
    "'$command <title>' with an emoji across the $titleMaxLength-character cut, and a monitor named with one across the choice cut: both end before the emoji",
    async (cut: TitleCutCase) => {
      const project: ProjectData = stubProjectData({ monitors: 3 });
      /*
       * A choice title over MICROSOFT_TEAMS_MAX_CHOICE_TITLE_LENGTH keeps one
       * place less than that for its text, then "…"; the emoji straddles the
       * cut.
       */
      const beforeChoiceCut: string = "a".repeat(
        MICROSOFT_TEAMS_MAX_CHOICE_TITLE_LENGTH - 2,
      );
      project.monitors[0]!.name = `${beforeChoiceCut}🔥 checkout, payments`;
      const beforeTitleCut: string = "b".repeat(cut.titleMaxLength - 1);

      const view: TeamsView = viewOf(
        await deliverLikeTeams(
          buildMessageActivity({
            id: nextActivityId("emoji-cut"),
            text: `${cut.command} ${beforeTitleCut}🔧 and the rest`,
          }),
        ),
      );

      expect(view.httpStatuses).toEqual([200]);
      expect(view.bubbles).toHaveLength(1);
      const card: JSONObject = cardOf(view.bubbles[0]);
      /*
       * Half an emoji is a lone UTF-16 surrogate, which Teams shows as "�"
       * and a database write turns into U+FFFD. The whole emoji goes.
       */
      expect(getElement(card, cut.titleInputId)?.["value"]).toBe(
        beforeTitleCut,
      );
      expect(getElement(card, cut.titleInputId)?.["maxLength"]).toBe(
        cut.titleMaxLength,
      );
      expect(getChoices(card, cut.monitorsChoiceSetId)[0]).toEqual({
        title: `${beforeChoiceCut}…`,
        value: project.monitors[0]!._id,
      });
    },
  );
});

describe("questions for the AI assistant (#4111 review): one answer, and the question stays out of the error log", () => {
  // A type, not an interface: test.each wants a Record<string, unknown> row.
  type QuestionCase = {
    description: string;
    text: string;
    // How the error log names the message, since it must not quote it.
    label: string;
  };

  const QUESTIONS: Array<QuestionCase> = [
    {
      description: "'ask <question>'",
      text: "ask which monitors are down in eu-west-1?",
      label: '"ask"',
    },
    {
      description: "a question in plain words",
      text: "Which monitors are down in eu-west-1?",
      label: "a 37-character question",
    },
  ];

  test.each<QuestionCase>(QUESTIONS)(
    "$description from a Teams user with no connected account: one reply that says where to connect it, with the link; nothing logged as an error",
    async (question: QuestionCase) => {
      // The real account lookup runs, and finds no link.
      jest
        .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
        .mockRestore();
      jest
        .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
        .mockResolvedValue(null);

      const view: TeamsView = viewOf(
        await deliverLikeTeams(
          buildMessageActivity({
            id: nextActivityId("question-not-linked"),
            text: question.text,
          }),
        ),
      );

      expect(view.httpStatuses).toEqual([200]);
      expect(labelsOf(view.bubbles)).toEqual([
        `To ask OneUptime questions from Microsoft Teams, first connect your Microsoft Teams account to OneUptime in [OneUptime → User Settings → Microsoft Teams](${dashboardLink("/user-settings/microsoft-teams-integration")}), then try again.`,
      ]);
      expect(loggedErrors).toEqual([]);
    },
  );

  test.each<QuestionCase>(QUESTIONS)(
    "$description whose account lookup fails: the one generic reply with its reference, not 'connect your account'; the log names the message as $label",
    async (question: QuestionCase) => {
      const lookupFailure: Error = new Error(
        "simulated account lookup failure",
      );
      jest
        .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
        .mockRejectedValue(lookupFailure);
      const activityId: string = nextActivityId("question-lookup-fails");
      const activity: JSONObject = buildMessageActivity({
        id: activityId,
        text: question.text,
      });

      const view: TeamsView = viewOf(await deliverLikeTeams(activity));

      /*
       * Before, any failed lookup was answered as a missing account, which
       * told a linked user to connect an account they had connected. It is an
       * unexpected failure like any other.
       */
      expect(view.httpStatuses).toEqual([200]);
      expect(labelsOf(view.bubbles)).toEqual([
        MicrosoftTeamsUtil.getUnexpectedErrorMessage(activity),
      ]);
      expect(loggedErrors).toEqual([
        `Microsoft Teams message ${activityId} (${question.label}) failed: Error: simulated account lookup failure`,
        "Error: simulated account lookup failure",
      ]);
      expectFailureLogged({
        at: 0,
        line: loggedErrors[0]!,
        error: lookupFailure,
        attributes: { projectId: projectId.toString() },
      });
      // What was asked is for the debug log only.
      for (const line of loggedErrors) {
        expect(line).not.toContain("eu-west-1");
      }
      expect(outerConsoleErrorCalls).toEqual([]);
    },
  );
});

describe("controls: commands that always worked still answer once with HTTP 200", () => {
  test("'help'", async () => {
    const view: TeamsView = viewOf(
      await deliverLikeTeams(
        buildMessageActivity({ id: nextActivityId("help"), text: "help" }),
      ),
    );

    expect(view.httpStatuses).toEqual([200]);
    expect(view.bubbles).toHaveLength(1);
    const reply: string = textOf(view.bubbles[0]);
    expect(reply).toMatch(/^Hello! I'm the OneUptime bot/);
    // Both create commands take the form's title after them.
    expect(reply).toContain(
      "\n- **create incident [title]** - Create a new incident\n- **create maintenance [title]** - Create a new scheduled maintenance event\n",
    );
  });

  test("'show scheduled maintenance' (the command the customer saw working)", async () => {
    jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockResolvedValue([] as Array<ScheduledMaintenance>);

    const view: TeamsView = viewOf(
      await deliverLikeTeams(
        buildMessageActivity({
          id: nextActivityId("show-maintenance"),
          text: "show scheduled maintenance",
        }),
      ),
    );

    expect(view.httpStatuses).toEqual([200]);
    expect(view.bubbles).toHaveLength(1);
    expect(textOf(view.bubbles[0])).toContain(
      "**Scheduled Maintenance Events**",
    );
  });

  test("'show scheduled maintenance' with 10 events of 800 monitors each: one reply within the text budget that names 10 monitors per event", async () => {
    const monitors: Array<Monitor> = namedRows(800, (index: number) => {
      return `Production HTTP Monitor ${padded(index, 6)}`;
    }) as unknown as Array<Monitor>;
    const events: Array<ScheduledMaintenance> = [];
    for (let index: number = 1; index <= 10; index++) {
      events.push({
        id: ObjectID.generate(),
        title: `Maintenance window ${index}`,
        description: "Rolling restart of every production monitor host.",
        startsAt: new Date("2026-10-01T14:00:00.000Z"),
        endsAt: new Date("2026-10-01T16:00:00.000Z"),
        currentScheduledMaintenanceState: { name: "Scheduled" },
        monitors: monitors,
        scheduledMaintenanceNumber: index,
      } as unknown as ScheduledMaintenance);
    }
    jest.spyOn(ScheduledMaintenanceService, "findBy").mockResolvedValue(events);

    const view: TeamsView = viewOf(
      await deliverLikeTeams(
        buildMessageActivity({
          id: nextActivityId("show-maintenance-800"),
          text: "show scheduled maintenance",
        }),
      ),
    );

    // Listing all 800 names per event was half a megabyte.
    expect(view.httpStatuses).toEqual([200]);
    expect(view.refused).toEqual([]);
    expect(view.bubbles).toHaveLength(1);
    const reply: string = textOf(view.bubbles[0]);
    expect(toUtf16Bytes(reply)).toBeLessThanOrEqual(
      MICROSOFT_TEAMS_TEXT_MESSAGE_BUDGET_IN_BYTES,
    );
    expect(reply.split(" and 790 more").length - 1).toBe(10);
    expect(reply).toContain(
      "Production HTTP Monitor 000009, Production HTTP Monitor 000010 and 790 more",
    );
    expect(reply).not.toContain("Production HTTP Monitor 000011");
  });

  test("'show active incidents' at the columns' limits (10 incidents with 500-character titles, 100-character monitor names): one reply cut to the text budget, with a note, accepted at once", async () => {
    const truncationNote: string =
      "…\n\n_This reply was shortened to fit in Microsoft Teams. Open OneUptime to see everything._";
    jest
      .spyOn(IncidentStateService, "getUnresolvedIncidentStates")
      .mockResolvedValue([
        { id: ObjectID.generate() } as unknown as IncidentState,
      ]);
    const monitors: Array<Monitor> = namedRows(12, (index: number) => {
      return toLongName(`Production HTTP Monitor ${padded(index, 6)}`);
    }) as unknown as Array<Monitor>;
    const incidents: Array<Incident> = [];
    for (let index: number = 1; index <= 10; index++) {
      incidents.push({
        id: ObjectID.generate(),
        incidentNumber: index,
        // An incident title may be 500 characters long.
        title: (
          `Incident ${index}: ` +
          "Checkout API returns 502 for card payments in every region. ".repeat(
            10,
          )
        ).substring(0, 500),
        description: "Customers cannot pay. ".repeat(20),
        currentIncidentState: { name: "Investigating" },
        incidentSeverity: { name: "Critical" },
        declaredAt: new Date("2026-09-29T09:00:00.000Z"),
        monitors: monitors,
      } as unknown as Incident);
    }
    jest.spyOn(IncidentService, "findBy").mockResolvedValue(incidents);

    const view: TeamsView = viewOf(
      await deliverLikeTeams(
        buildMessageActivity({
          id: nextActivityId("show-incidents-long"),
          text: "show active incidents",
        }),
      ),
    );

    expect(view.httpStatuses).toEqual([200]);
    expect(view.refused).toEqual([]);
    expect(view.bubbles).toHaveLength(1);
    const reply: string = textOf(view.bubbles[0]);
    // Whole, the reply is about 43,000 bytes, over the budget; Teams got it cut.
    expect(toUtf16Bytes(reply)).toBeLessThanOrEqual(40 * 1024);
    expect(reply.startsWith("**Active Incidents** (10)\n\n")).toBe(true);
    expect(reply.endsWith(truncationNote)).toBe(true);
    const shownIncidents: number =
      reply.split("• [Open in Dashboard](").length - 1;
    expect(shownIncidents).toBeGreaterThan(0);
    expect(shownIncidents).toBeLessThan(10);
  });
});

describe("never a 500: whatever fails, Teams gets HTTP 200 and the user one answer", () => {
  test("tenant resolution throws: one reply that gives the activity id as a reference, HTTP 200 (master: 500 and no reply at all)", async () => {
    const outage: Error = new Error("simulated database outage");
    jest
      .spyOn(MicrosoftTeamsUtil, "resolveProjectByTenantId")
      .mockRejectedValue(outage);
    const activityId: string = nextActivityId("tenant-unresolved");
    const activity: JSONObject = buildMessageActivity({
      id: activityId,
      text: "create incident",
    });

    const view: TeamsView = viewOf(await deliverLikeTeams(activity));

    expect(view.httpStatuses).toEqual([200]);
    expect(view.bubbles).toHaveLength(1);
    const reply: string = textOf(view.bubbles[0]);
    expect(reply).toBe(MicrosoftTeamsUtil.getUnexpectedErrorMessage(activity));
    expect(reply).toContain(`reference ${activityId}`);
    /*
     * The server log carries the same reference, so it can be found. Logged
     * by the message handler itself (it names the command): the failure was
     * handled where it happened, not left to escape to the last-resort guard
     * in processBotActivity, which logs it differently. The line, then the
     * error itself, which keeps its stack.
     */
    expect(loggedErrors).toEqual([
      `Microsoft Teams message ${activityId} ("create incident") failed: Error: simulated database outage`,
      "Error: simulated database outage",
    ]);
    // The project was never resolved, so the log cannot name one.
    expectFailureLogged({
      at: 0,
      line: loggedErrors[0]!,
      error: outage,
      attributes: { projectId: undefined },
    });
    expect(outerConsoleErrorCalls).toEqual([]);
  });

  test("a message handler that throws before replying: one generic reply, HTTP 200", async () => {
    const handlerBug: Error = new Error("simulated handler bug");
    jest
      .spyOn(MicrosoftTeamsUtil, "handleBotMessageActivity")
      .mockRejectedValue(handlerBug);
    const activityId: string = nextActivityId("handler-throws");
    const activity: JSONObject = buildMessageActivity({
      id: activityId,
      text: "create incident",
    });

    const view: TeamsView = viewOf(await deliverLikeTeams(activity));

    expect(view.httpStatuses).toEqual([200]);
    expect(
      view.bubbles.map((call: ConnectorCall) => {
        return call.text;
      }),
    ).toEqual([MicrosoftTeamsUtil.getUnexpectedErrorMessage(activity)]);
    expect(loggedErrors).toEqual([
      `Microsoft Teams message activity ${activityId} failed: Error: simulated handler bug`,
      "Error: simulated handler bug",
    ]);
    // The error as the handler threw it, through the real botbuilder run.
    expectFailureLogged({
      at: 0,
      line: loggedErrors[0]!,
      error: handlerBug,
      attributes: undefined,
    });
    expect(outerConsoleErrorCalls).toEqual([]);
  });

  test("a message handler that throws, and Teams refuses the apology too: still HTTP 200, after a single attempt", async () => {
    jest
      .spyOn(MicrosoftTeamsUtil, "handleBotMessageActivity")
      .mockRejectedValue(new Error("simulated handler bug"));
    connector.refuse = (): ConnectorAnswer => {
      return MESSAGE_REFUSED_ANSWER;
    };
    const activityId: string = nextActivityId("apology-refused");
    const activity: JSONObject = buildMessageActivity({
      id: activityId,
      text: "create incident",
    });

    const view: TeamsView = viewOf(await deliverLikeTeams(activity));

    // The last line of defence cannot itself end the turn in a 500.
    expect(view.httpStatuses).toEqual([200]);
    expect(view.bubbles).toEqual([]);
    expect(labelsOf(view.refused)).toEqual([
      MicrosoftTeamsUtil.getUnexpectedErrorMessage(activity),
    ]);
    expect(loggedErrors).toEqual([
      `Microsoft Teams message activity ${activityId} failed: Error: simulated handler bug`,
      "Error: simulated handler bug",
      "Could not send a Microsoft Teams reply: RestError 403 Forbidden: The message was refused.",
    ]);
    expect(outerConsoleErrorCalls).toEqual([]);
  });

  test("a message handler that throws after it replied: no second reply, HTTP 200", async () => {
    jest
      .spyOn(MicrosoftTeamsUtil, "handleBotMessageActivity")
      .mockImplementation(
        async (data: {
          activity: JSONObject;
          turnContext: TurnContext;
        }): Promise<void> => {
          await data.turnContext.sendActivity("The only reply.");
          throw new Error("simulated failure after the reply");
        },
      );

    const view: TeamsView = viewOf(
      await deliverLikeTeams(
        buildMessageActivity({
          id: nextActivityId("throws-after-reply"),
          text: "create incident",
        }),
      ),
    );

    expect(view.httpStatuses).toEqual([200]);
    expect(labelsOf(view.bubbles)).toEqual(["The only reply."]);
    expect(outerConsoleErrorCalls).toEqual([]);
  });

  test("an invoke whose handling throws is answered HTTP 200, not 500 (the error) or 501 (no invoke response)", async () => {
    const invokeFailure: Error = new Error("simulated invoke failure");
    jest
      .spyOn(MicrosoftTeamsUtil, "handleBotInvokeActivity")
      .mockRejectedValue(invokeFailure);
    const activityId: string = nextActivityId("invoke-throws");

    const deliveries: Array<DeliveryRecord> = await deliverLikeTeams(
      buildInvokeActivity(activityId),
    );

    expect(
      deliveries.map((delivery: DeliveryRecord) => {
        return delivery.httpStatus;
      }),
    ).toEqual([200]);
    // The invoke response travels back in the HTTP answer; nothing is posted.
    expect(deliveries[0]!.calls).toEqual([]);
    expect(MicrosoftTeamsUtil.handleBotInvokeActivity).toHaveBeenCalledTimes(1);
    expect(loggedErrors).toEqual([
      `Microsoft Teams invoke activity ${activityId} failed: Error: simulated invoke failure`,
      "Error: simulated invoke failure",
    ]);
    expectFailureLogged({
      at: 0,
      line: loggedErrors[0]!,
      error: invokeFailure,
      attributes: undefined,
    });
    expect(outerConsoleErrorCalls).toEqual([]);
  });

  test("an invoke action that fails inside the handler: one 'that action failed' reply, HTTP 200", async () => {
    const lookupFailure: Error = new Error(
      "simulated membership lookup failure",
    );
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockRejectedValue(lookupFailure);

    const view: TeamsView = viewOf(
      await deliverLikeTeams(
        buildInvokeActivity(nextActivityId("invoke-fails")),
      ),
    );

    expect(view.httpStatuses).toEqual([200]);
    expect(
      view.bubbles.map((call: ConnectorCall) => {
        return call.text;
      }),
    ).toEqual(["Sorry, that action failed. Please try again later."]);
    // Answered by the invoke handler itself: nothing escaped to the guard.
    expect(loggedErrors).toEqual([
      "Error handling bot invoke activity: Error: simulated membership lookup failure",
      "Error: simulated membership lookup failure",
    ]);
    expectFailureLogged({
      at: 0,
      line: loggedErrors[0]!,
      error: lookupFailure,
      attributes: {
        actionType: MicrosoftTeamsIncidentActionType.AckIncident,
        projectId: projectId.toString(),
      },
    });
    expect(outerConsoleErrorCalls).toEqual([]);
  });

  test("a submitted form whose action fails, and Teams refuses the apology too: HTTP 200 after a single attempt, and no second apology", async () => {
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockRejectedValue(new Error("simulated membership lookup failure"));
    connector.refuse = (): ConnectorAnswer => {
      return MESSAGE_REFUSED_ANSWER;
    };

    const view: TeamsView = viewOf(
      await deliverLikeTeams(
        buildCardSubmitActivity({
          id: nextActivityId("submit-apology-refused"),
          replyToId: "msg-incident-form",
          value: {
            action: MicrosoftTeamsIncidentActionType.SubmitNewIncident,
          },
        }),
      ),
    );

    expect(view.httpStatuses).toEqual([200]);
    expect(view.bubbles).toEqual([]);
    expect(labelsOf(view.refused)).toEqual([
      "Sorry, that action failed. Please try again later.",
    ]);
    expect(loggedErrors).toEqual([
      "Error handling bot invoke activity: Error: simulated membership lookup failure",
      "Error: simulated membership lookup failure",
      "Could not send a Microsoft Teams reply: RestError 403 Forbidden: The message was refused.",
    ]);
    expect(outerConsoleErrorCalls).toEqual([]);
  });

  // A type, not an interface: test.each wants a Record<string, unknown> row.
  type BotAddedCase = {
    type: BotAddedActivityType;
    handler:
      | "handleConversationUpdateActivity"
      | "handleInstallationUpdateActivity";
  };

  test.each<BotAddedCase>([
    {
      type: "conversationUpdate",
      handler: "handleConversationUpdateActivity",
    },
    {
      type: "installationUpdate",
      handler: "handleInstallationUpdateActivity",
    },
  ])(
    "the bot added to a chat, announced as $type, and the handler throws: HTTP 200, logged, and nothing posted in a chat nobody wrote in (master: 500, so Teams sent it again)",
    async (botAdded: BotAddedCase) => {
      const installFailure: Error = new Error("simulated install failure");
      jest
        .spyOn(MicrosoftTeamsUtil, botAdded.handler)
        .mockRejectedValue(installFailure);
      const activityId: string = nextActivityId(botAdded.type);

      const deliveries: Array<DeliveryRecord> = await deliverLikeTeams(
        buildBotAddedActivity(botAdded.type, activityId),
      );

      expect(
        deliveries.map((delivery: DeliveryRecord) => {
          return delivery.httpStatus;
        }),
      ).toEqual([200]);
      expect(deliveries[0]!.calls).toEqual([]);
      expect(MicrosoftTeamsUtil[botAdded.handler]).toHaveBeenCalledTimes(1);
      expect(loggedErrors).toEqual([
        `Microsoft Teams ${botAdded.type} activity ${activityId} failed: Error: simulated install failure`,
        "Error: simulated install failure",
      ]);
      expectFailureLogged({
        at: 0,
        line: loggedErrors[0]!,
        error: installFailure,
        attributes: undefined,
      });
      expect(outerConsoleErrorCalls).toEqual([]);
    },
  );
});

describe("submitting the form (#4111): confirmed first, then the form is removed, best-effort", () => {
  const CREATED_INCIDENT_ID: ObjectID = ObjectID.generate();

  interface OpenedIncidentForm {
    project: ProjectData;
    formId: string;
    card: JSONObject;
  }

  // Asks for the form the way a user does, and returns the card Teams got.
  async function openIncidentForm(
    conversation: ConversationKind = "personal",
  ): Promise<OpenedIncidentForm> {
    const project: ProjectData = stubProjectData({
      monitors: 5,
      labels: 3,
      onCallPolicies: 2,
    });

    const view: TeamsView = viewOf(
      await deliverLikeTeams(
        buildMessageActivity({
          id: nextActivityId("open-form"),
          text: "create incident Checkout API returns 502",
          conversation: conversation,
        }),
      ),
    );

    expect(labelsOf(view.bubbles)).toEqual(["Create New Incident"]);
    const form: ConnectorCall = view.bubbles[0]!;

    return {
      project: project,
      formId: form.messageId || "",
      card: cardOf(form),
    };
  }

  // What the card's inputs hold after the user filled it in.
  function filledInIncidentForm(opened: OpenedIncidentForm): JSONObject {
    return {
      ...getSubmitData(opened.card),
      incidentTitle: `  ${String(getElement(opened.card, "incidentTitle")?.["value"])}  `,
      incidentDescription: "Customers cannot pay.",
      incidentSeverity: getChoiceValues(opened.card, "incidentSeverity")[0]!,
      incidentMonitors: getChoiceValues(opened.card, "incidentMonitors")
        .slice(0, 2)
        .join(","),
      monitorStatus: getChoiceValues(opened.card, "monitorStatus")[2]!,
    };
  }

  function stubIncidentCreate(): void {
    jest.spyOn(IncidentService, "create").mockImplementation(() => {
      const created: Incident = new Incident();
      created.id = CREATED_INCIDENT_ID;
      return Promise.resolve(created);
    });
  }

  // The props the incident was created with: the submitter's own.
  function createdIncidentProps(): DatabaseCommonInteractionProps {
    const createSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      IncidentService,
      "create",
    );
    const firstCall: Array<unknown> | undefined = createSpy.mock.calls[0];
    return (firstCall?.[0] as { props: DatabaseCommonInteractionProps }).props;
  }

  function createdIncidentData(): Incident {
    const createSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      IncidentService,
      "create",
    );
    const firstCall: Array<unknown> | undefined = createSpy.mock.calls[0];
    return (firstCall?.[0] as { data: Incident }).data;
  }

  // What the user reads once the incident exists.
  function incidentCreatedConfirmation(): string {
    return `✅ Incident created successfully!\n\nView incident: ${dashboardLink(`/incidents/${CREATED_INCIDENT_ID.toString()}`)}`;
  }

  test("the confirmation is posted, then the form is deleted; the incident has what the form offered and the user chose", async () => {
    const opened: OpenedIncidentForm = await openIncidentForm();
    // "create incident <title>" filled the title in, as typed.
    expect(getElement(opened.card, "incidentTitle")?.["value"]).toBe(
      "Checkout API returns 502",
    );
    expect(opened.formId).not.toBe("");
    stubIncidentCreate();
    const submitId: string = nextActivityId("submit-incident");
    const value: JSONObject = filledInIncidentForm(opened);

    const deliveries: Array<DeliveryRecord> = await deliverLikeTeams(
      buildCardSubmitActivity({
        id: submitId,
        replyToId: opened.formId,
        value: value,
      }),
    );
    const view: TeamsView = viewOf(deliveries);

    expect(value["action"]).toBe(
      MicrosoftTeamsIncidentActionType.SubmitNewIncident,
    );
    expect(view.httpStatuses).toEqual([200]);
    expect(
      deliveries[0]!.calls.map((call: ConnectorCall) => {
        return [call.method, call.label, call.connectorStatus];
      }),
    ).toEqual([
      ["POST", incidentCreatedConfirmation(), 200],
      ["DELETE", opened.formId, 200],
    ]);
    // The confirmation answers the submit; the DELETE removes the form.
    expect(view.bubbles[0]!.activityIdInPath).toBe(submitId);
    expect(view.deletes[0]!.conversationId).toBe(PERSONAL_CONVERSATION_ID);

    expect(IncidentService.create).toHaveBeenCalledTimes(1);
    const incident: Incident = createdIncidentData();
    expect(incident.title).toBe("Checkout API returns 502");
    expect(incident.description).toBe("Customers cannot pay.");
    expect(incident.projectId?.toString()).toBe(projectId.toString());
    // Declared as the member who submitted it: their props, and the create credits them.
    expect(createdIncidentProps()).toEqual({
      userId: ONEUPTIME_USER_ID,
      tenantId: projectId,
    });
    expect(incident.createdByUserId).toBeUndefined();
    expect(incident.incidentSeverityId?.toString()).toBe(
      opened.project.severities[0]!._id,
    );
    expect(
      (incident.monitors || []).map((monitor: Monitor) => {
        return monitor.id?.toString();
      }),
    ).toEqual([
      opened.project.monitors[0]!._id,
      opened.project.monitors[1]!._id,
    ]);
    // The status change goes through the incident, not onto the monitors.
    expect(incident.changeMonitorStatusToId?.toString()).toBe(
      opened.project.monitorStatuses[2]!._id,
    );
    expect(loggedErrors).toEqual([]);
    expect(outerConsoleErrorCalls).toEqual([]);
  });

  test("the form cannot be deleted (404): the user still sees only the confirmation, nothing that says it failed, HTTP 200", async () => {
    const opened: OpenedIncidentForm = await openIncidentForm();
    stubIncidentCreate();
    connector.deleteStatus = 404;

    const view: TeamsView = viewOf(
      await deliverLikeTeams(
        buildCardSubmitActivity({
          id: nextActivityId("submit-delete-404"),
          replyToId: opened.formId,
          value: filledInIncidentForm(opened),
        }),
      ),
    );

    expect(view.httpStatuses).toEqual([200]);
    expect(
      view.deletes.map((call: ConnectorCall) => {
        return [call.label, call.connectorStatus];
      }),
    ).toEqual([[opened.formId, 404]]);
    expect(labelsOf(view.bubbles)).toEqual([incidentCreatedConfirmation()]);
    expect(IncidentService.create).toHaveBeenCalledTimes(1);
    // Removing the form is a courtesy: its failure is not even an error log.
    expect(loggedErrors).toEqual([]);
    expect(outerConsoleErrorCalls).toEqual([]);
  });

  test("Teams refuses the confirmation (a 403, which the connector does not retry): one incident, nothing says the create failed, HTTP 200", async () => {
    const opened: OpenedIncidentForm = await openIncidentForm();
    stubIncidentCreate();
    connector.refuse = (request: ConnectorRequest): ConnectorAnswer | null => {
      const text: unknown = request.activity?.["text"];
      return request.method === "POST" &&
        typeof text === "string" &&
        text.startsWith("✅")
        ? MESSAGE_REFUSED_ANSWER
        : null;
    };

    const view: TeamsView = viewOf(
      await deliverLikeTeams(
        buildCardSubmitActivity({
          id: nextActivityId("submit-confirmation-refused"),
          replyToId: opened.formId,
          value: filledInIncidentForm(opened),
        }),
      ),
    );

    /*
     * master: the refusal landed in the create's catch, which answered
     * "❌ Failed to create incident. Please try again." for an incident that
     * existed, inviting a second one.
     */
    expect(view.httpStatuses).toEqual([200]);
    expect(IncidentService.create).toHaveBeenCalledTimes(1);
    // The confirmation is the only message the bot even tried to post.
    expect(
      view.refused.map((call: ConnectorCall) => {
        return [call.label, call.connectorStatus];
      }),
    ).toEqual([[incidentCreatedConfirmation(), 403]]);
    expect(view.bubbles).toEqual([]);
    // The operator can see why the user got no confirmation.
    expect(loggedErrors).toEqual([
      "Could not send a Microsoft Teams reply: RestError 403 Forbidden: The message was refused.",
    ]);
    expect(outerConsoleErrorCalls).toEqual([]);
  });

  test("the same submit delivered twice creates one incident and confirms once", async () => {
    const opened: OpenedIncidentForm = await openIncidentForm();
    stubIncidentCreate();
    const submit: JSONObject = buildCardSubmitActivity({
      id: nextActivityId("submit-redelivered"),
      replyToId: opened.formId,
      value: filledInIncidentForm(opened),
    });

    const first: DeliveryRecord = await deliverOnce(submit);
    const repeat: DeliveryRecord = await deliverOnce(submit);

    expect([first.httpStatus, repeat.httpStatus]).toEqual([200, 200]);
    expect(
      first.calls.map((call: ConnectorCall) => {
        return call.method;
      }),
    ).toEqual(["POST", "DELETE"]);
    expect(repeat.calls).toEqual([]);
    expect(IncidentService.create).toHaveBeenCalledTimes(1);
  });

  // A type, not an interface: test.each wants a Record<string, unknown> row.
  type RedisStoryCase = {
    story: string;
    // What Redis answers the claim of the first delivery: taken, or down.
    firstClaim: "taken" | "down";
  };

  /*
   * The claim is shared through Redis and remembered in this process too. A
   * redelivery must be dropped whatever Redis says in between: a Redis that
   * has no record of the first claim answers "not claimed yet".
   */
  test.each<RedisStoryCase>([
    {
      story:
        "Redis was down for the first delivery and is back, with no record of it, for the redelivery",
      firstClaim: "down",
    },
    {
      story:
        "Redis took the first claim and lost it (a restart) before the redelivery",
      firstClaim: "taken",
    },
  ])(
    "the same submit delivered twice while $story: still one incident, and the redelivery posts nothing",
    async (redis: RedisStoryCase) => {
      const opened: OpenedIncidentForm = await openIncidentForm();
      stubIncidentCreate();
      const claimInRedis: SpyInstance<typeof GlobalCache.setStringIfNotExists> =
        jest.spyOn(GlobalCache, "setStringIfNotExists");
      if (redis.firstClaim === "down") {
        claimInRedis.mockRejectedValueOnce(new Error("Cache is not connected"));
      } else {
        claimInRedis.mockResolvedValueOnce(true);
      }
      // Asked again for the redelivery, Redis finds no key and sets it.
      claimInRedis.mockResolvedValueOnce(true);
      const submit: JSONObject = buildCardSubmitActivity({
        id: nextActivityId("submit-redis-story"),
        replyToId: opened.formId,
        value: filledInIncidentForm(opened),
      });

      const first: DeliveryRecord = await deliverOnce(submit);
      const redelivery: DeliveryRecord = await deliverOnce(submit);

      /*
       * Redis is asked for both, so that other App instances learn of the
       * claim, but this process's memory decides the redelivery first.
       */
      expect(claimInRedis).toHaveBeenCalledTimes(2);
      // A second incident would page its on-call policies a second time.
      expect(IncidentService.create).toHaveBeenCalledTimes(1);
      expect([first.httpStatus, redelivery.httpStatus]).toEqual([200, 200]);
      expect(
        first.calls.map((call: ConnectorCall) => {
          return call.method;
        }),
      ).toEqual(["POST", "DELETE"]);
      expect(redelivery.calls).toEqual([]);
      /*
       * No Redis client in this process (as in a test or a script), so there
       * is no other instance to miss the claim: the fallback is not an error.
       */
      expect(loggedErrors).toEqual([]);
    },
  );

  test("Redis is configured but down: every message is still answered once and a redelivery still dropped, and the operator hears of the fallback once a minute, not once a message", async () => {
    stubProjectData({ monitors: 5 });
    /*
     * A client whose connection dropped: GlobalCache refuses every claim with
     * "Cache is not connected", and the dedupe falls back to memory.
     */
    jest
      .spyOn(Redis, "getClient")
      .mockReturnValue(
        {} as unknown as NonNullable<ReturnType<typeof Redis.getClient>>,
      );
    /*
     * The clock the once-a-minute throttle reads, stopped a day ahead of any
     * fallback an earlier test could have logged.
     */
    const start: number = Date.now() + 24 * 60 * 60 * 1000;
    stopTheClockAt(new Date(start));
    const firstMessage: JSONObject = buildMessageActivity({
      id: nextActivityId("redis-down-first"),
      text: "create incident",
    });

    const first: DeliveryRecord = await deliverOnce(firstMessage);
    const redelivery: DeliveryRecord = await deliverOnce(firstMessage);
    jest.setSystemTime(start + 59 * 1000);
    const withinTheMinute: DeliveryRecord = await deliverOnce(
      buildMessageActivity({
        id: nextActivityId("redis-down-within-minute"),
        text: "create incident",
      }),
    );
    jest.setSystemTime(start + 61 * 1000);
    const afterTheMinute: DeliveryRecord = await deliverOnce(
      buildMessageActivity({
        id: nextActivityId("redis-down-after-minute"),
        text: "create incident",
      }),
    );

    expect(
      [first, redelivery, withinTheMinute, afterTheMinute].map(
        (delivery: DeliveryRecord) => {
          return delivery.httpStatus;
        },
      ),
    ).toEqual([200, 200, 200, 200]);
    expect(labelsOf(first.calls)).toEqual(["Create New Incident"]);
    expect(redelivery.calls).toEqual([]);
    expect(labelsOf(withinTheMinute.calls)).toEqual(["Create New Incident"]);
    expect(labelsOf(afterTheMinute.calls)).toEqual(["Create New Incident"]);

    // Four claims fell back; the first and the one a minute later are logged.
    const fallback: string =
      "Microsoft Teams activity dedupe fell back to this process's memory (Redis refused the claim); a Teams redelivery that reaches another App instance may be handled twice.";
    expect(loggedErrors).toEqual([
      fallback,
      "Error: Cache is not connected",
      fallback,
      "Error: Cache is not connected",
    ]);
    // Tagged as infrastructure, not as a fault in the code.
    for (const call of loggedErrorCalls) {
      expect(call.attributes).toStrictEqual({
        [ERROR_CLASS_ATTRIBUTE_KEY]: ErrorClass.Infrastructure,
      });
    }
    expect(outerConsoleErrorCalls).toEqual([]);
  });

  test("a submit that carries a monitor its member may not name (a tampered card: another project's, or one outside their read): the create, made as the member, refuses it, and the one '❌' reply says so in fixed words that never name that monitor; nothing is created and the form stays, HTTP 200", async () => {
    const opened: OpenedIncidentForm = await openIncidentForm();
    const foreignMonitorId: ObjectID = ObjectID.generate();
    // What the create's own reference check answers such a monitor with.
    const reason: string = `This incident references records that are not in this project: Monitor "${foreignMonitorId.toString()}". Please pick values from this project and try again.`;
    jest
      .spyOn(IncidentService, "create")
      .mockRejectedValue(new UnreadableReferenceException(reason));

    const deliveries: Array<DeliveryRecord> = await deliverLikeTeams(
      buildCardSubmitActivity({
        id: nextActivityId("submit-foreign-monitor"),
        replyToId: opened.formId,
        value: {
          ...filledInIncidentForm(opened),
          // A monitor the form offered, and one it never could have.
          incidentMonitors: `${opened.project.monitors[0]!._id},${foreignMonitorId.toString()}`,
        },
      }),
    );
    const view: TeamsView = viewOf(deliveries);

    expect(view.httpStatuses).toEqual([200]);
    expect(
      deliveries[0]!.calls.map((call: ConnectorCall) => {
        return [call.method, call.label, call.connectorStatus];
      }),
    ).toEqual([
      [
        "POST",
        "❌ Could not create the incident: One of the values you picked (a monitor, label, on-call policy, severity or status) is not available in this project any more. Please pick it again.",
        200,
      ],
    ]);
    expect(MICROSOFT_TEAMS_UNAVAILABLE_REFERENCE_MESSAGE).toBe(
      "One of the values you picked (a monitor, label, on-call policy, severity or status) is not available in this project any more. Please pick it again.",
    );
    // The monitor is named to nobody in the chat.
    for (const call of deliveries[0]!.calls) {
      expect(JSON.stringify(call.label)).not.toContain(
        foreignMonitorId.toString(),
      );
    }
    // Asked once, as the member, with every id the card carried; refused, so the form stays.
    expect(IncidentService.create).toHaveBeenCalledTimes(1);
    expect(createdIncidentProps()).toEqual({
      userId: ONEUPTIME_USER_ID,
      tenantId: projectId,
    });
    expect(
      (createdIncidentData().monitors || []).map((monitor: Monitor) => {
        return monitor.id?.toString();
      }),
    ).toEqual([opened.project.monitors[0]!._id, foreignMonitorId.toString()]);
    expect(view.deletes).toEqual([]);
    /*
     * The operator log has its id - never its name - with the class it was
     * refused as: a BadDataException with the same message API callers get.
     */
    expect(loggedErrors).toEqual([
      `Could not create an incident from Microsoft Teams: UnreadableReferenceException: ${reason}`,
      `Error: ${reason}`,
    ]);
    const refusal: unknown = loggedErrorCalls[1]?.message;
    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect(refusal).toBeInstanceOf(ProjectScopedReferenceException);
    expect(refusal).toBeInstanceOf(BadDataException);
    expectFailureLogged({
      at: 0,
      line: loggedErrors[0]!,
      error: refusal,
      attributes: { projectId: projectId.toString() },
    });
    expect(outerConsoleErrorCalls).toEqual([]);
  });

  test("the create fails unexpectedly: the one '❌' reply says to try again or create it in OneUptime, with the link; nothing says why, the log does; the form stays, HTTP 200", async () => {
    const opened: OpenedIncidentForm = await openIncidentForm();
    stubIncidentCreate();
    const databaseFailure: Error = new Error(
      "simulated database failure: connection terminated",
    );
    jest.spyOn(IncidentService, "create").mockRejectedValue(databaseFailure);

    const deliveries: Array<DeliveryRecord> = await deliverLikeTeams(
      buildCardSubmitActivity({
        id: nextActivityId("submit-create-fails"),
        replyToId: opened.formId,
        value: filledInIncidentForm(opened),
      }),
    );

    expect(
      deliveries.map((delivery: DeliveryRecord) => {
        return delivery.httpStatus;
      }),
    ).toEqual([200]);
    expect(
      deliveries[0]!.calls.map((call: ConnectorCall) => {
        return [call.method, call.label, call.connectorStatus];
      }),
    ).toEqual([
      [
        "POST",
        `❌ Could not create the incident because of an unexpected error. Please try again, or create it in OneUptime: ${dashboardLink("/incidents/create")}`,
        200,
      ],
    ]);
    expect(IncidentService.create).toHaveBeenCalledTimes(1);
    expect(loggedErrors).toEqual([
      "Could not create an incident from Microsoft Teams: Error: simulated database failure: connection terminated",
      "Error: simulated database failure: connection terminated",
    ]);
    expectFailureLogged({
      at: 0,
      line: loggedErrors[0]!,
      error: databaseFailure,
      attributes: { projectId: projectId.toString() },
    });
    expect(outerConsoleErrorCalls).toEqual([]);
  });

  test("the create fails unexpectedly and OneUptime does not know its dashboard URL: the same reply, without a link", async () => {
    const opened: OpenedIncidentForm = await openIncidentForm();
    stubIncidentCreate();
    jest
      .spyOn(IncidentService, "create")
      .mockRejectedValue(new Error("simulated database failure"));
    withoutDashboardUrl();

    const view: TeamsView = viewOf(
      await deliverLikeTeams(
        buildCardSubmitActivity({
          id: nextActivityId("submit-create-fails-no-link"),
          replyToId: opened.formId,
          value: filledInIncidentForm(opened),
        }),
      ),
    );

    expect(view.httpStatuses).toEqual([200]);
    expect(labelsOf(view.bubbles)).toEqual([
      "❌ Could not create the incident because of an unexpected error. Please try again, or create it in OneUptime.",
    ]);
    expect(view.deletes).toEqual([]);
  });

  /*
   * Declaring an incident from chat takes what declaring one in OneUptime
   * takes: the submitter's own permission to declare incidents, asked as
   * them (it used to take membership only, by an earlier product decision
   * the maintainer has since changed). A scheduled maintenance event takes
   * its own permission the same way (see the maintenance submit tests).
   */
  test("a member whose role may not declare incidents (a read-only Viewer) is refused by the real permission check: one reply that says why, nothing created, the form stays, HTTP 200", async () => {
    const opened: OpenedIncidentForm = await openIncidentForm();
    stubIncidentCreate();
    useRealMembershipCheck([Permission.Viewer]);

    const deliveries: Array<DeliveryRecord> = await deliverLikeTeams(
      buildCardSubmitActivity({
        id: nextActivityId("submit-viewer"),
        replyToId: opened.formId,
        value: filledInIncidentForm(opened),
      }),
    );

    expect(
      deliveries.map((delivery: DeliveryRecord) => {
        return delivery.httpStatus;
      }),
    ).toEqual([200]);
    expect(
      deliveries[0]!.calls.map((call: ConnectorCall) => {
        return [call.method, call.label, call.connectorStatus];
      }),
    ).toEqual([
      [
        "POST",
        "You do not have permission to declare an incident. You do not have permissions to create Incident. You need one of these permissions: Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Create Incident",
        200,
      ],
    ]);
    expect(IncidentService.create).not.toHaveBeenCalled();
    // Membership was read from the database, for this user in this project.
    expect(TeamMemberService.findBy).toHaveBeenCalledTimes(1);
    expect(TeamMemberService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          userId: ONEUPTIME_USER_ID,
          projectId: projectId,
          hasAcceptedInvitation: true,
        },
      }),
    );
    expect(WorkspaceActionAuthorization.assertCanCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        modelType: Incident,
        action: "declare an incident",
      }),
    );
    // A refusal written for the user, not a fault for an operator.
    expect(loggedErrors).toEqual([]);
  });

  test("a member whose role may declare incidents (an Incident Member) creates one, as themselves, from the form", async () => {
    const opened: OpenedIncidentForm = await openIncidentForm();
    stubIncidentCreate();
    useRealMembershipCheck([Permission.IncidentMember]);

    const deliveries: Array<DeliveryRecord> = await deliverLikeTeams(
      buildCardSubmitActivity({
        id: nextActivityId("submit-incident-member"),
        replyToId: opened.formId,
        value: filledInIncidentForm(opened),
      }),
    );

    expect(
      deliveries[0]!.calls.map((call: ConnectorCall) => {
        return [call.method, call.label, call.connectorStatus];
      }),
    ).toEqual([
      ["POST", incidentCreatedConfirmation(), 200],
      ["DELETE", opened.formId, 200],
    ]);
    expect(IncidentService.create).toHaveBeenCalledTimes(1);
    // The member's own props, as the membership check built them.
    expect(createdIncidentProps().userId?.toString()).toBe(
      ONEUPTIME_USER_ID.toString(),
    );
    expect(createdIncidentProps().isRoot).toBeUndefined();
    expect(loggedErrors).toEqual([]);
  });

  test("a Teams user who is no longer a member of the project is refused: one reply that says so, nothing created, the form stays, HTTP 200", async () => {
    const opened: OpenedIncidentForm = await openIncidentForm();
    stubIncidentCreate();
    useRealMembershipCheck(null);

    const view: TeamsView = viewOf(
      await deliverLikeTeams(
        buildCardSubmitActivity({
          id: nextActivityId("submit-not-member"),
          replyToId: opened.formId,
          value: filledInIncidentForm(opened),
        }),
      ),
    );

    expect(view.httpStatuses).toEqual([200]);
    expect(labelsOf(view.bubbles)).toEqual([
      "Your OneUptime account is not a member of this project. Ask a project admin to invite you, then try again.",
    ]);
    expect(IncidentService.create).not.toHaveBeenCalled();
    expect(view.deletes).toEqual([]);
    // A refusal, not a server error.
    expect(loggedErrors).toEqual([]);
  });

  test("a form submitted in a group chat (Teams sends the submit without an @mention): created, confirmed and removed there, HTTP 200", async () => {
    const opened: OpenedIncidentForm = await openIncidentForm("groupChat");
    stubIncidentCreate();
    const submitId: string = nextActivityId("submit-group-chat");

    const deliveries: Array<DeliveryRecord> = await deliverLikeTeams(
      buildCardSubmitActivity({
        id: submitId,
        replyToId: opened.formId,
        value: filledInIncidentForm(opened),
        conversation: "groupChat",
      }),
    );

    expect(
      deliveries.map((delivery: DeliveryRecord) => {
        return delivery.httpStatus;
      }),
    ).toEqual([200]);
    expect(
      deliveries[0]!.calls.map((call: ConnectorCall) => {
        return [
          call.method,
          call.conversationId,
          call.activityIdInPath,
          call.connectorStatus,
        ];
      }),
    ).toEqual([
      ["POST", GROUP_CONVERSATION_ID, submitId, 200],
      ["DELETE", GROUP_CONVERSATION_ID, opened.formId, 200],
    ]);
    expect(labelsOf(deliveries[0]!.calls)[0]).toBe(
      incidentCreatedConfirmation(),
    );
    expect(IncidentService.create).toHaveBeenCalledTimes(1);
  });
});

describe("submitting the maintenance form: start and end are read in the zone the form named, else the submitter's, through the real adapter", () => {
  const CREATED_MAINTENANCE_ID: ObjectID = ObjectID.generate();

  function stubMaintenanceCreate(): void {
    jest.spyOn(ScheduledMaintenanceService, "create").mockImplementation(() => {
      const created: ScheduledMaintenance = new ScheduledMaintenance();
      created.id = CREATED_MAINTENANCE_ID;
      return Promise.resolve(created);
    });
  }

  function createdMaintenanceData(): ScheduledMaintenance {
    const createSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ScheduledMaintenanceService,
      "create",
    );
    const firstCall: Array<unknown> | undefined = createSpy.mock.calls[0];
    return (firstCall?.[0] as { data: ScheduledMaintenance }).data;
  }

  function maintenanceFormValue(data: {
    day: string;
    timezone?: string | undefined;
    // What the user picked from the form's optional lists, by input id.
    picked?: JSONObject | undefined;
  }): JSONObject {
    return {
      action:
        MicrosoftTeamsScheduledMaintenanceActionType.SubmitNewScheduledMaintenance,
      ...(data.timezone ? { timezone: data.timezone } : {}),
      scheduledMaintenanceTitle: "Database Upgrade Window",
      scheduledMaintenanceDescription: "Upgrading the primary database.",
      startDate: data.day,
      startTime: "14:00",
      endDate: data.day,
      endTime: "16:00",
      ...(data.picked || {}),
    };
  }

  test("a client that sends no zone on the submit (as iOS does): read in the zone the form was sent for, echoed back, and only then is the form removed", async () => {
    stubMaintenanceCreate();
    const day: string = moment
      .tz(SENDER_TIMEZONE)
      .add(7, "days")
      .format("YYYY-MM-DD");
    const monitorIds: Array<string> = [
      ObjectID.generate().toString(),
      ObjectID.generate().toString(),
    ];
    const monitorStatusId: string = ObjectID.generate().toString();
    const labelId: string = ObjectID.generate().toString();

    const deliveries: Array<DeliveryRecord> = await deliverLikeTeams(
      buildCardSubmitActivity({
        id: nextActivityId("submit-maintenance-card-zone"),
        replyToId: "msg-maintenance-form",
        value: maintenanceFormValue({
          day: day,
          timezone: SENDER_TIMEZONE,
          picked: {
            scheduledMaintenanceMonitors: monitorIds.join(","),
            monitorStatus: monitorStatusId,
            labels: labelId,
          },
        }),
      }),
    );
    const view: TeamsView = viewOf(deliveries);

    const startsAt: Date = moment
      .tz(`${day} 14:00`, "YYYY-MM-DD HH:mm", SENDER_TIMEZONE)
      .toDate();
    const endsAt: Date = moment
      .tz(`${day} 16:00`, "YYYY-MM-DD HH:mm", SENDER_TIMEZONE)
      .toDate();
    const dayAsRead: string = moment
      .tz(day, "YYYY-MM-DD", SENDER_TIMEZONE)
      .format("MMM D, YYYY");

    expect(view.httpStatuses).toEqual([200]);
    // master removed the form first, and a failed removal hid the confirmation.
    expect(
      deliveries[0]!.calls.map((call: ConnectorCall) => {
        return [call.method, call.label, call.connectorStatus];
      }),
    ).toEqual([
      [
        "POST",
        `✅ Scheduled maintenance created successfully!\n\n**Starts:** ${dayAsRead}, 14:00 (${SENDER_TIMEZONE})\n\n**Ends:** ${dayAsRead}, 16:00 (${SENDER_TIMEZONE})\n\nView scheduled maintenance: ${dashboardLink(`/scheduled-maintenance-events/${CREATED_MAINTENANCE_ID.toString()}`)}`,
        200,
      ],
      ["DELETE", "msg-maintenance-form", 200],
    ]);

    expect(ScheduledMaintenanceService.create).toHaveBeenCalledTimes(1);
    const maintenance: ScheduledMaintenance = createdMaintenanceData();
    expect(maintenance.startsAt?.toISOString()).toBe(startsAt.toISOString());
    expect(maintenance.endsAt?.toISOString()).toBe(endsAt.toISOString());
    expect(maintenance.title).toBe("Database Upgrade Window");
    expect(maintenance.projectId?.toString()).toBe(projectId.toString());
    // Created as the member who submitted it: the create credits them.
    expect(maintenance.createdByUserId).toBeUndefined();
    expect(
      (
        (ScheduledMaintenanceService.create as unknown as jest.Mock).mock
          .calls[0]![0] as { props: DatabaseCommonInteractionProps }
      ).props,
    ).toEqual({ userId: ONEUPTIME_USER_ID, tenantId: projectId });
    expect(
      (maintenance.monitors || []).map((monitor: Monitor) => {
        return monitor.id?.toString();
      }),
    ).toEqual(monitorIds);
    expect(
      (maintenance.labels || []).map((label: Label) => {
        return label.id?.toString();
      }),
    ).toEqual([labelId]);
    // The status change goes through the event, not onto the monitors.
    expect(maintenance.changeMonitorStatusToId?.toString()).toBe(
      monitorStatusId,
    );
    expect(loggedErrors).toEqual([]);
  });

  test("no zone anywhere: read at the UTC offset of the activity's local timestamp, which botbuilder hands over as rawLocalTimestamp, and the reply says it was read at that offset", async () => {
    stubMaintenanceCreate();
    const day: string = moment.utc().add(7, "days").format("YYYY-MM-DD");

    const view: TeamsView = viewOf(
      await deliverLikeTeams(
        buildCardSubmitActivity({
          id: nextActivityId("submit-maintenance-offset"),
          replyToId: "msg-maintenance-form-2",
          localTimestamp: "2026-09-29T15:35:00.000+05:30",
          value: maintenanceFormValue({ day: day }),
        }),
      ),
    );

    const dayAsRead: string = moment
      .utc(day, "YYYY-MM-DD")
      .format("MMM D, YYYY");

    /*
     * Today's offset, which a daylight saving change before the event would
     * make an hour out: the reply says so, and where to check.
     */
    expect(view.httpStatuses).toEqual([200]);
    expect(labelsOf(view.bubbles)).toEqual([
      `✅ Scheduled maintenance created successfully!\n\n**Starts:** ${dayAsRead}, 14:00 (UTC+05:30)\n\n**Ends:** ${dayAsRead}, 16:00 (UTC+05:30)\n\nMicrosoft Teams did not say which time zone you are in, so these times were read at your current offset, UTC+05:30. If daylight saving time changes before then, check them in OneUptime.\n\nView scheduled maintenance: ${dashboardLink(`/scheduled-maintenance-events/${CREATED_MAINTENANCE_ID.toString()}`)}`,
    ]);

    // 14:00 at UTC+05:30 is 08:30 UTC.
    const maintenance: ScheduledMaintenance = createdMaintenanceData();
    expect(maintenance.startsAt?.toISOString()).toBe(`${day}T08:30:00.000Z`);
    expect(maintenance.endsAt?.toISOString()).toBe(`${day}T10:30:00.000Z`);
  });

  test("a form sent to a group chat for New York, filled in by someone whose Teams says Berlin: read in New York, the zone the form named, and named back", async () => {
    stubMaintenanceCreate();
    const day: string = moment
      .tz(SENDER_TIMEZONE)
      .add(7, "days")
      .format("YYYY-MM-DD");

    const deliveries: Array<DeliveryRecord> = await deliverLikeTeams(
      buildCardSubmitActivity({
        id: nextActivityId("submit-maintenance-other-zone"),
        replyToId: "msg-maintenance-form-group",
        conversation: "groupChat",
        from: OTHER_MEMBER,
        localTimezone: "Europe/Berlin",
        localTimestamp: "2026-09-29T12:05:00.000+02:00",
        value: maintenanceFormValue({ day: day, timezone: SENDER_TIMEZONE }),
      }),
    );

    const dayAsRead: string = moment
      .tz(day, "YYYY-MM-DD", SENDER_TIMEZONE)
      .format("MMM D, YYYY");

    /*
     * The form told whoever filled it in that its times are in New York, so
     * 14:00 is 14:00 there: read in Berlin, the event would start six hours
     * early.
     */
    expect(
      deliveries.map((delivery: DeliveryRecord) => {
        return delivery.httpStatus;
      }),
    ).toEqual([200]);
    expect(
      deliveries[0]!.calls.map((call: ConnectorCall) => {
        return [call.method, call.conversationId, call.label];
      }),
    ).toEqual([
      [
        "POST",
        GROUP_CONVERSATION_ID,
        `✅ Scheduled maintenance created successfully!\n\n**Starts:** ${dayAsRead}, 14:00 (${SENDER_TIMEZONE})\n\n**Ends:** ${dayAsRead}, 16:00 (${SENDER_TIMEZONE})\n\nView scheduled maintenance: ${dashboardLink(`/scheduled-maintenance-events/${CREATED_MAINTENANCE_ID.toString()}`)}`,
      ],
      ["DELETE", GROUP_CONVERSATION_ID, "msg-maintenance-form-group"],
    ]);
    const maintenance: ScheduledMaintenance = createdMaintenanceData();
    expect(maintenance.startsAt?.toISOString()).toBe(
      moment
        .tz(`${day} 14:00`, "YYYY-MM-DD HH:mm", SENDER_TIMEZONE)
        .toDate()
        .toISOString(),
    );
    // Created by whoever submitted it, as their own linked account.
    expect(
      MicrosoftTeamsAuthAction.getOneUptimeUserIdFromTeamsUserId,
    ).toHaveBeenCalledWith({
      teamsUserId: OTHER_MEMBER["aadObjectId"],
      projectId: projectId,
    });
  });

  // A type, not an interface: test.each wants a Record<string, unknown> row.
  type JustGoneByCase = {
    description: string;
    // When the submit arrives: October 6, 2026, on the clock in New York.
    arrivesAt: string;
    endTime: string;
    // The one reply.
    reply: string;
    // When the event starts, if it was created.
    startsAt: string | null;
  };

  /*
   * Input.Time has minute precision, so a start picked as "now" is a minute
   * or two in the past by the time the form is filled in. A start up to five
   * minutes gone by begins now; an older one is refused, as before.
   */
  test.each<JustGoneByCase>([
    {
      description: "4:59 ago: the event is created, starting now",
      arrivesAt: "14:04:59",
      endTime: "16:00",
      reply: `✅ Scheduled maintenance created successfully!\n\n**Starts:** Oct 6, 2026, 14:04 (${SENDER_TIMEZONE})\n\n**Ends:** Oct 6, 2026, 16:00 (${SENDER_TIMEZONE})\n\nView scheduled maintenance: `,
      startsAt: "2026-10-06T18:04:59.000Z",
    },
    {
      description: "exactly 5:00 ago: still created, starting now",
      arrivesAt: "14:05:00",
      endTime: "16:00",
      reply: `✅ Scheduled maintenance created successfully!\n\n**Starts:** Oct 6, 2026, 14:05 (${SENDER_TIMEZONE})\n\n**Ends:** Oct 6, 2026, 16:00 (${SENDER_TIMEZONE})\n\nView scheduled maintenance: `,
      startsAt: "2026-10-06T18:05:00.000Z",
    },
    {
      description: "5:01 ago: refused as in the past",
      arrivesAt: "14:05:01",
      endTime: "16:00",
      reply: `Unable to create scheduled maintenance: the start time (Oct 6, 2026, 14:00 (${SENDER_TIMEZONE})) is in the past.`,
      startsAt: null,
    },
    {
      description:
        "4:59 ago, but ending before now: refused, the end must come after the start it was moved to",
      arrivesAt: "14:04:59",
      endTime: "14:03",
      reply: `Unable to create scheduled maintenance: the end time (Oct 6, 2026, 14:03 (${SENDER_TIMEZONE})) must be after the start time (Oct 6, 2026, 14:04 (${SENDER_TIMEZONE})).`,
      startsAt: null,
    },
  ])(
    "a start of 14:00 that has just gone by, $description",
    async (goneBy: JustGoneByCase) => {
      stubMaintenanceCreate();
      stopTheClockAt(
        moment
          .tz(
            `2026-10-06 ${goneBy.arrivesAt}`,
            "YYYY-MM-DD HH:mm:ss",
            SENDER_TIMEZONE,
          )
          .toDate(),
      );

      const deliveries: Array<DeliveryRecord> = await deliverLikeTeams(
        buildCardSubmitActivity({
          id: nextActivityId("submit-maintenance-just-gone-by"),
          replyToId: "msg-maintenance-form-now",
          value: {
            ...maintenanceFormValue({
              day: "2026-10-06",
              timezone: SENDER_TIMEZONE,
            }),
            endTime: goneBy.endTime,
          },
        }),
      );
      const view: TeamsView = viewOf(deliveries);

      expect(view.httpStatuses).toEqual([200]);
      expect(labelsOf(view.bubbles)).toEqual([
        goneBy.startsAt
          ? `${goneBy.reply}${dashboardLink(`/scheduled-maintenance-events/${CREATED_MAINTENANCE_ID.toString()}`)}`
          : goneBy.reply,
      ]);

      if (goneBy.startsAt) {
        expect(ScheduledMaintenanceService.create).toHaveBeenCalledTimes(1);
        const maintenance: ScheduledMaintenance = createdMaintenanceData();
        expect(maintenance.startsAt?.toISOString()).toBe(goneBy.startsAt);
        expect(maintenance.endsAt?.toISOString()).toBe(
          "2026-10-06T20:00:00.000Z",
        );
        expect(labelsOf(view.deletes)).toEqual(["msg-maintenance-form-now"]);
      } else {
        // Refused: nothing created, and the form stays to pick again.
        expect(ScheduledMaintenanceService.create).not.toHaveBeenCalled();
        expect(view.deletes).toEqual([]);
      }
      expect(loggedErrors).toEqual([]);
    },
  );

  test("a submit that picks a label deleted since the form was sent: the create's own reference check refuses it, and the one '❌' reply says so in fixed words; nothing is created, HTTP 200", async () => {
    const deletedLabelId: string = ObjectID.generate().toString();
    const reason: string = `This scheduled maintenance event references records that are not in this project: Label "${deletedLabelId}". Please pick values from this project and try again.`;
    // What the create, made as the member, answers a label the project no longer has.
    jest
      .spyOn(ScheduledMaintenanceService, "create")
      .mockRejectedValue(new ProjectScopedReferenceException(reason));
    const day: string = moment
      .tz(SENDER_TIMEZONE)
      .add(7, "days")
      .format("YYYY-MM-DD");

    const deliveries: Array<DeliveryRecord> = await deliverLikeTeams(
      buildCardSubmitActivity({
        id: nextActivityId("submit-maintenance-deleted-label"),
        replyToId: "msg-maintenance-form-deleted-label",
        value: maintenanceFormValue({
          day: day,
          timezone: SENDER_TIMEZONE,
          picked: { labels: deletedLabelId },
        }),
      }),
    );

    expect(
      deliveries.map((delivery: DeliveryRecord) => {
        return delivery.httpStatus;
      }),
    ).toEqual([200]);
    expect(
      deliveries[0]!.calls.map((call: ConnectorCall) => {
        return [call.method, call.label, call.connectorStatus];
      }),
    ).toEqual([
      [
        "POST",
        `❌ Could not create the scheduled maintenance event: ${MICROSOFT_TEAMS_UNAVAILABLE_REFERENCE_MESSAGE}`,
        200,
      ],
    ]);
    // Asked once, with the label, and refused: nothing was made.
    expect(ScheduledMaintenanceService.create).toHaveBeenCalledTimes(1);
    expect(
      (
        (ScheduledMaintenanceService.create as unknown as jest.Mock).mock
          .calls[0]![0] as { data: ScheduledMaintenance }
      ).data.labels?.map((label: Label) => {
        return label.id?.toString();
      }),
    ).toEqual([deletedLabelId]);
    expect(loggedErrors).toEqual([
      `Could not create a scheduled maintenance event from Microsoft Teams: ProjectScopedReferenceException: ${reason}`,
      `Error: ${reason}`,
    ]);
    expect(loggedErrorCalls[1]?.message).toBeInstanceOf(
      ProjectScopedReferenceException,
    );
    expect(outerConsoleErrorCalls).toEqual([]);
  });

  test("OneUptime refuses the create for a reason written for the user (the project has no scheduled state): the one '❌' reply gives that reason, HTTP 200", async () => {
    stubMaintenanceCreate();
    // What ScheduledMaintenanceService.onBeforeCreate throws in that case.
    const refusal: BadDataException = new BadDataException(
      "Scheduled state not found for this project. Please add an scheduled event state from settings.",
    );
    jest
      .spyOn(ScheduledMaintenanceService, "create")
      .mockRejectedValue(refusal);
    const day: string = moment
      .tz(SENDER_TIMEZONE)
      .add(7, "days")
      .format("YYYY-MM-DD");

    const view: TeamsView = viewOf(
      await deliverLikeTeams(
        buildCardSubmitActivity({
          id: nextActivityId("submit-maintenance-refused"),
          replyToId: "msg-maintenance-form-refused",
          value: maintenanceFormValue({ day: day, timezone: SENDER_TIMEZONE }),
        }),
      ),
    );

    expect(view.httpStatuses).toEqual([200]);
    expect(labelsOf(view.bubbles)).toEqual([
      `❌ Could not create the scheduled maintenance event: ${refusal.message}`,
    ]);
    expect(view.deletes).toEqual([]);
    // The class it was refused as, from the constructor: its name is Error's.
    expect(loggedErrors).toEqual([
      `Could not create a scheduled maintenance event from Microsoft Teams: BadDataException: ${refusal.message}`,
      `Error: ${refusal.message}`,
    ]);
    expectFailureLogged({
      at: 0,
      line: loggedErrors[0]!,
      error: refusal,
      attributes: { projectId: projectId.toString() },
    });
  });

  test("the create fails unexpectedly: the one '❌' reply says to try again or create it in OneUptime, with the link, HTTP 200", async () => {
    stubMaintenanceCreate();
    const databaseFailure: Error = new Error("simulated database failure");
    jest
      .spyOn(ScheduledMaintenanceService, "create")
      .mockRejectedValue(databaseFailure);
    const day: string = moment
      .tz(SENDER_TIMEZONE)
      .add(7, "days")
      .format("YYYY-MM-DD");

    const view: TeamsView = viewOf(
      await deliverLikeTeams(
        buildCardSubmitActivity({
          id: nextActivityId("submit-maintenance-create-fails"),
          replyToId: "msg-maintenance-form-fails",
          value: maintenanceFormValue({ day: day, timezone: SENDER_TIMEZONE }),
        }),
      ),
    );

    expect(view.httpStatuses).toEqual([200]);
    expect(labelsOf(view.bubbles)).toEqual([
      `❌ Could not create the scheduled maintenance event because of an unexpected error. Please try again, or create it in OneUptime: ${dashboardLink("/scheduled-maintenance-events/create")}`,
    ]);
    expect(view.deletes).toEqual([]);
    expect(loggedErrors).toEqual([
      "Could not create a scheduled maintenance event from Microsoft Teams: Error: simulated database failure",
      "Error: simulated database failure",
    ]);
    expectFailureLogged({
      at: 0,
      line: loggedErrors[0]!,
      error: databaseFailure,
      attributes: { projectId: projectId.toString() },
    });
  });

  test("a member whose role may not create scheduled maintenance (a read-only Viewer) is refused by the real permission check: one reply that says why, nothing created (unlike an incident, see the incident submit tests)", async () => {
    stubMaintenanceCreate();
    useRealMembershipCheck([Permission.Viewer]);
    const day: string = moment
      .tz(SENDER_TIMEZONE)
      .add(7, "days")
      .format("YYYY-MM-DD");

    const view: TeamsView = viewOf(
      await deliverLikeTeams(
        buildCardSubmitActivity({
          id: nextActivityId("submit-maintenance-viewer"),
          replyToId: "msg-maintenance-form-viewer",
          value: maintenanceFormValue({ day: day, timezone: SENDER_TIMEZONE }),
        }),
      ),
    );

    expect(view.httpStatuses).toEqual([200]);
    expect(labelsOf(view.bubbles)).toEqual([
      "You do not have permission to create a scheduled maintenance event. You do not have permissions to create Scheduled Maintenance Event. You need one of these permissions: Project Owner, Project Admin, Project Member, Scheduled Maintenance Admin, Scheduled Maintenance Member, Create Scheduled Maintenance",
    ]);
    expect(WorkspaceActionAuthorization.assertCanCreate).toHaveBeenCalledTimes(
      1,
    );
    expect(ScheduledMaintenanceService.create).not.toHaveBeenCalled();
    expect(view.deletes).toEqual([]);
    expect(loggedErrors).toEqual([]);
  });
});

describe("a form action that happened is never reported as failed (#4111 review): when Teams refuses its confirmation, that refused reply is the only one, the form is removed, HTTP 200", () => {
  const RECORD_ID: string = ObjectID.generate().toString();
  const ON_CALL_POLICY_ID: string = ObjectID.generate().toString();
  const STATE_ID: string = ObjectID.generate().toString();
  const NOTE: string =
    "Rolled back the 14:02 deploy; the error rate is normal.";

  // A stubbed write, as the test checks it: done once.
  type StubbedWrite = { mock: { calls: Array<Array<unknown>> } };

  // A type, not an interface: test.each wants a Record<string, unknown> row.
  type DoneActionCase = {
    name: string;
    action: string;
    // The record the form acts on; a maintenance form carries it in `fields`.
    actionValue: string;
    fields: JSONObject;
    confirmation: string;
    stubWrite: () => StubbedWrite;
  };

  function stubExecutePolicy(): StubbedWrite {
    return jest
      .spyOn(OnCallDutyPolicyService, "executePolicy")
      .mockResolvedValue(undefined);
  }

  // The event a maintenance form acts on, read before the action.
  function stubExistingMaintenance(): void {
    const maintenance: ScheduledMaintenance = new ScheduledMaintenance();
    maintenance.id = new ObjectID(RECORD_ID);
    maintenance.projectId = projectId;
    maintenance.title = "Database upgrade";
    jest
      .spyOn(ScheduledMaintenanceService, "findOneBy")
      .mockResolvedValue(maintenance);
  }

  /*
   * Every form submit that confirms with a reply and then removes its form,
   * but the two create forms (whose confirmation the submit tests above
   * refuse): one row per handler in Actions/.
   */
  test.each<DoneActionCase>([
    {
      name: "incident: Add Note",
      action: MicrosoftTeamsIncidentActionType.SubmitIncidentNote,
      actionValue: RECORD_ID,
      fields: { noteType: "public", note: NOTE },
      confirmation: "✅ Note added successfully.",
      stubWrite: (): StubbedWrite => {
        return jest
          .spyOn(IncidentPublicNoteService, "addNote")
          .mockResolvedValue(new IncidentPublicNote());
      },
    },
    {
      name: "incident: Execute On-Call Policy",
      action:
        MicrosoftTeamsIncidentActionType.SubmitExecuteIncidentOnCallPolicy,
      actionValue: RECORD_ID,
      fields: { onCallPolicy: ON_CALL_POLICY_ID },
      confirmation: "✅ On-call policy executed successfully.",
      stubWrite: stubExecutePolicy,
    },
    {
      name: "incident: Change Incident State",
      action: MicrosoftTeamsIncidentActionType.SubmitChangeIncidentState,
      actionValue: RECORD_ID,
      fields: { incidentState: STATE_ID },
      confirmation: "✅ Incident state changed successfully.",
      stubWrite: (): StubbedWrite => {
        return jest
          .spyOn(IncidentService, "updateOneById")
          .mockResolvedValue(1);
      },
    },
    {
      name: "alert: Add Note",
      action: MicrosoftTeamsAlertActionType.SubmitAlertNote,
      actionValue: RECORD_ID,
      fields: { note: NOTE },
      confirmation: "✅ Note added successfully.",
      stubWrite: (): StubbedWrite => {
        return jest
          .spyOn(AlertInternalNoteService, "addNote")
          .mockResolvedValue(new AlertInternalNote());
      },
    },
    {
      name: "alert: Execute On-Call Policy",
      action: MicrosoftTeamsAlertActionType.SubmitExecuteAlertOnCallPolicy,
      actionValue: RECORD_ID,
      fields: { onCallPolicy: ON_CALL_POLICY_ID },
      confirmation: "✅ On-call policy executed successfully.",
      stubWrite: stubExecutePolicy,
    },
    {
      name: "alert: Change Alert State",
      action: MicrosoftTeamsAlertActionType.SubmitChangeAlertState,
      actionValue: RECORD_ID,
      fields: { alertState: STATE_ID },
      confirmation: "✅ Alert state changed successfully.",
      stubWrite: (): StubbedWrite => {
        return jest.spyOn(AlertService, "updateOneById").mockResolvedValue(1);
      },
    },
    {
      name: "alert episode: Add Note",
      action: MicrosoftTeamsAlertEpisodeActionType.SubmitAlertEpisodeNote,
      actionValue: RECORD_ID,
      fields: { note: NOTE },
      confirmation: "✅ Note added successfully.",
      stubWrite: (): StubbedWrite => {
        return jest
          .spyOn(AlertEpisodeInternalNoteService, "addNote")
          .mockResolvedValue(new AlertEpisodeInternalNote());
      },
    },
    {
      name: "alert episode: Execute On-Call Policy",
      action:
        MicrosoftTeamsAlertEpisodeActionType.SubmitExecuteAlertEpisodeOnCallPolicy,
      actionValue: RECORD_ID,
      fields: { onCallPolicy: ON_CALL_POLICY_ID },
      confirmation: "✅ On-call policy executed successfully.",
      stubWrite: stubExecutePolicy,
    },
    {
      name: "alert episode: Change Episode State",
      action:
        MicrosoftTeamsAlertEpisodeActionType.SubmitChangeAlertEpisodeState,
      actionValue: RECORD_ID,
      fields: { alertState: STATE_ID },
      confirmation: "✅ Alert episode state changed successfully.",
      stubWrite: (): StubbedWrite => {
        return jest
          .spyOn(AlertEpisodeService, "changeEpisodeState")
          .mockResolvedValue(undefined);
      },
    },
    {
      name: "incident episode: Add Note",
      action: MicrosoftTeamsIncidentEpisodeActionType.SubmitIncidentEpisodeNote,
      actionValue: RECORD_ID,
      fields: { note: NOTE },
      confirmation: "Note added successfully.",
      stubWrite: (): StubbedWrite => {
        return jest
          .spyOn(IncidentEpisodeInternalNoteService, "addNote")
          .mockResolvedValue(new IncidentEpisodeInternalNote());
      },
    },
    {
      name: "incident episode: Execute On-Call Policy",
      action:
        MicrosoftTeamsIncidentEpisodeActionType.SubmitExecuteIncidentEpisodeOnCallPolicy,
      actionValue: RECORD_ID,
      fields: { onCallPolicy: ON_CALL_POLICY_ID },
      confirmation: "On-call policy executed successfully.",
      stubWrite: stubExecutePolicy,
    },
    {
      name: "incident episode: Change Episode State",
      action:
        MicrosoftTeamsIncidentEpisodeActionType.SubmitChangeIncidentEpisodeState,
      actionValue: RECORD_ID,
      fields: { incidentState: STATE_ID },
      confirmation: "Incident episode state changed successfully.",
      stubWrite: (): StubbedWrite => {
        return jest
          .spyOn(IncidentEpisodeService, "changeEpisodeState")
          .mockResolvedValue(undefined);
      },
    },
    {
      name: "scheduled maintenance: Add Note",
      action:
        MicrosoftTeamsScheduledMaintenanceActionType.SubmitScheduledMaintenanceNote,
      actionValue: "",
      fields: { scheduledMaintenanceId: RECORD_ID, note: NOTE, isPublic: true },
      confirmation: "Note added successfully",
      stubWrite: (): StubbedWrite => {
        stubExistingMaintenance();
        return jest
          .spyOn(ScheduledMaintenancePublicNoteService, "addNote")
          .mockResolvedValue(new ScheduledMaintenancePublicNote());
      },
    },
    {
      name: "scheduled maintenance: Change State",
      action:
        MicrosoftTeamsScheduledMaintenanceActionType.SubmitChangeScheduledMaintenanceState,
      actionValue: "",
      fields: { scheduledMaintenanceId: RECORD_ID, stateId: STATE_ID },
      confirmation: "ScheduledMaintenance state changed successfully",
      stubWrite: (): StubbedWrite => {
        stubExistingMaintenance();
        return jest
          .spyOn(ScheduledMaintenanceService, "updateOneById")
          .mockResolvedValue(1);
      },
    },
  ])("$name", async (done: DoneActionCase) => {
    const write: StubbedWrite = done.stubWrite();
    // Teams refuses the confirmation, and nothing else.
    connector.refuse = (request: ConnectorRequest): ConnectorAnswer | null => {
      return request.method === "POST" &&
        request.activity?.["text"] === done.confirmation
        ? MESSAGE_REFUSED_ANSWER
        : null;
    };
    const formId: string = `msg-form-${nextActivityId("done-action")}`;

    const deliveries: Array<DeliveryRecord> = await deliverLikeTeams(
      buildCardSubmitActivity({
        id: nextActivityId("done-action-submit"),
        replyToId: formId,
        value: {
          action: done.action,
          actionValue: done.actionValue,
          ...done.fields,
        },
      }),
    );

    /*
     * Before: the refusal escaped into "Sorry, that action failed. Please try
     * again later." (for maintenance, "An error occurred while processing the
     * action") under an action that had happened, and the form stayed to be
     * submitted again: a second note, a second page of the on-call policy.
     */
    expect(
      deliveries.map((delivery: DeliveryRecord) => {
        return delivery.httpStatus;
      }),
    ).toEqual([200]);
    expect(
      deliveries[0]!.calls.map((call: ConnectorCall) => {
        return [call.method, call.label, call.connectorStatus];
      }),
    ).toEqual([
      ["POST", done.confirmation, 403],
      ["DELETE", formId, 200],
    ]);
    expect(write.mock.calls).toHaveLength(1);
    // The operator can see why the user got no confirmation.
    expect(loggedErrors).toEqual([
      "Could not send a Microsoft Teams reply: RestError 403 Forbidden: The message was refused.",
    ]);
    expect(outerConsoleErrorCalls).toEqual([]);
  });
});

describe("card size sweep: whatever the project, the form Teams gets fits the 40 KiB card budget", () => {
  const MONITOR_COUNTS: Array<number> = [
    0, 1, 50, 150, 200, 249, 250, 251, 400, 800, 1000, 2000, 5000,
  ];

  interface SweepShape {
    description: string;
    shape: Omit<ProjectShape, "monitors">;
  }

  const SHAPES: Array<SweepShape> = [
    {
      description: "30-character names, 20 labels, 10 on-call policies",
      shape: {},
    },
    {
      description:
        "100-character names, 150 labels, 120 on-call policies (both over what is read)",
      shape: { longNames: true, labels: 150, onCallPolicies: 120 },
    },
    {
      description:
        "100-character names and every list at the most that is read, 50 severities and 50 monitor statuses included",
      shape: {
        longNames: true,
        labels: 100,
        onCallPolicies: 100,
        severities: 50,
        monitorStatuses: 50,
      },
    },
  ];

  interface SweepCommand {
    text: string;
    heading: string;
    monitorsChoiceSetId: string;
    addLaterHint: string;
    createRoute: string;
    hasOnCallPolicies: boolean;
  }

  const COMMANDS: Array<SweepCommand> = [
    {
      text: "create incident",
      heading: "Create New Incident",
      monitorsChoiceSetId: "incidentMonitors",
      addLaterHint: INCIDENT_ADD_LATER_HINT,
      createRoute: "/incidents/create",
      hasOnCallPolicies: true,
    },
    {
      text: "create maintenance",
      heading: "Create New Scheduled Maintenance",
      monitorsChoiceSetId: "scheduledMaintenanceMonitors",
      addLaterHint: MAINTENANCE_ADD_LATER_HINT,
      createRoute: "/scheduled-maintenance-events/create",
      hasOnCallPolicies: false,
    },
  ];

  // One delivery of the sweep: the form is accepted at once and fits.
  async function expectFormFits(data: {
    command: SweepCommand;
    shape: ProjectShape;
  }): Promise<void> {
    const project: ProjectData = stubProjectData(data.shape);
    const description: string = `${data.command.text} with ${data.shape.monitors} monitors`;

    const view: TeamsView = viewOf(
      await deliverLikeTeams(
        buildMessageActivity({
          id: nextActivityId("sweep"),
          text: data.command.text,
        }),
      ),
    );

    expect({ description, httpStatuses: view.httpStatuses }).toEqual({
      description,
      httpStatuses: [200],
    });
    // Accepted the first time at the documented limit: no 413 at all.
    expect({ description, refused: view.refused.length }).toEqual({
      description,
      refused: 0,
    });
    expect({ description, bubbles: labelsOf(view.bubbles) }).toEqual({
      description,
      bubbles: [data.command.heading],
    });

    const form: ConnectorCall = view.bubbles[0]!;
    expect(form.cardUtf16Bytes).toBeLessThanOrEqual(CARD_BUDGET_IN_UTF16_BYTES);

    const card: JSONObject = cardOf(form);
    const shownCounts: Array<{ shown: number; total: number }> = [];
    const lists: Array<CardListExpectation> = [
      {
        choiceSetId: data.command.monitorsChoiceSetId,
        pluralNoun: "monitors",
        addLaterHint: data.command.addLaterHint,
        rows: project.monitors,
      },
      {
        choiceSetId: "labels",
        pluralNoun: "labels",
        addLaterHint: data.command.addLaterHint,
        rows: project.labels,
      },
    ];
    if (data.command.hasOnCallPolicies) {
      lists.push({
        choiceSetId: "onCallDutyPolicies",
        pluralNoun: "on-call policies",
        addLaterHint: data.command.addLaterHint,
        rows: project.onCallPolicies,
      });
    }

    for (const list of lists) {
      shownCounts.push({
        shown: expectListAccountedFor(card, list),
        total: list.rows.length,
      });
    }

    const shownMonitors: number = shownCounts[0]!.shown;
    expect(shownMonitors).toBeLessThanOrEqual(
      MICROSOFT_TEAMS_MAX_MONITOR_CHOICES,
    );
    // Monitor statuses are offered only alongside monitors.
    expect(getElement(card, "monitorStatus") !== undefined).toBe(
      shownMonitors > 0,
    );

    // "Create in OneUptime" exactly when something was left off.
    const isAnythingLeftOff: boolean = shownCounts.some(
      (count: { shown: number; total: number }) => {
        return count.shown < count.total;
      },
    );
    expect(getCreateInOneUptimeActions(card)).toEqual(
      isAnythingLeftOff
        ? [
            {
              type: "Action.OpenUrl",
              title: "Create in OneUptime",
              url: dashboardLink(data.command.createRoute),
            },
          ]
        : [],
    );
  }

  for (const command of COMMANDS) {
    for (const sweepShape of SHAPES) {
      test(`'${command.text}', ${sweepShape.description}: 0 to 5000 monitors`, async () => {
        for (const monitorCount of MONITOR_COUNTS) {
          await expectFormFits({
            command: command,
            shape: { ...sweepShape.shape, monitors: monitorCount },
          });
        }
      });
    }
  }
});
