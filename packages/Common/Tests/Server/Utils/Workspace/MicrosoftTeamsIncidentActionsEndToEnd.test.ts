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
import type { SpyInstance } from "jest-mock";
import type { AddressInfo } from "net";

/*
 * ACTING ON AN INCIDENT FROM MICROSOFT TEAMS, END TO END.
 *
 * Customer feedback: "incident actions (set a custom fields, escalate to
 * someone else, etc.) cannot be triggered directly from Slack (requiring
 * users to use the web UI), and the /incident command only creates
 * incidents." Teams gets what Slack gets: the incident card's menu (…) -
 * Change Severity, Change Incident State, Assign Role, Page Someone, Edit
 * Custom Fields - and `incident 42` typed to the bot.
 *
 * Runs through the REAL botbuilder stack, as MicrosoftTeamsPageCommandEndToEnd
 * does:
 *
 *   fake Express req -> MicrosoftTeamsUtil.processBotActivity
 *     -> real CloudAdapter -> real TeamsActivityHandler
 *     -> the incident command / a card's button / a card's submit
 *     -> real TurnContext and ConnectorClient
 *     -> HTTP -> a fake Bot Connector on 127.0.0.1
 *
 * and pins what the Bot Connector is sent: the incident's card and its
 * menu, each form card, each submit's write - as the member who submitted
 * it - its confirmation and the card's removal, the refusals and the
 * Connect prompt. Only the database under the actions is stood in for, by
 * a project with one incident.
 */

jest.mock("botbuilder", () => {
  return (
    jest.requireActual("../../../Helpers/RealBotbuilder") as {
      loadRealBotbuilder: (fromFile: string) => unknown;
    }
  ).loadRealBotbuilder(__filename);
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
import MicrosoftTeamsCreateCommands from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCreateCommands";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceConnectRequest, {
  WorkspaceConnectRequestAgainKind,
  WorkspaceConnectRequestRecord,
} from "../../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import WorkspaceIncidentCustomFields from "../../../../Server/Utils/Workspace/WorkspaceIncidentCustomFields";
import WorkspaceMemberActions, {
  WorkspaceEventStanding,
} from "../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import WorkspacePage, {
  WorkspacePageChoiceGroup,
  WorkspacePageTargetKind,
} from "../../../../Server/Utils/Workspace/WorkspacePage";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import IncidentCustomFieldService from "../../../../Server/Services/IncidentCustomFieldService";
import IncidentMemberService from "../../../../Server/Services/IncidentMemberService";
import IncidentRoleService from "../../../../Server/Services/IncidentRoleService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import OnCallPageService, {
  OnCallPageRecordType,
  OnCallPageResult,
  OnCallPageTargets,
} from "../../../../Server/Services/OnCallPageService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import UserService from "../../../../Server/Services/UserService";
import logger from "../../../../Server/Utils/Logger";
import ProductBrandingText from "../../../../Server/Utils/ProductBrandingText";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../../Models/DatabaseModels/IncidentCustomField";
import IncidentMember from "../../../../Models/DatabaseModels/IncidentMember";
import IncidentRole from "../../../../Models/DatabaseModels/IncidentRole";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import Name from "../../../../Types/Name";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
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

// ---- A fake Bot Connector: records what the bot sends ----

const ACTIVITIES_PATH: RegExp =
  /^\/v3\/conversations\/([^/]+)\/activities(?:\/([^/]+))?$/;

interface ConnectorRequest {
  method: string;
  conversationId: string;
  // The activity a reply answers, or a removal removes.
  activityId: string | null;
  activity: JSONObject;
}

interface FakeBotConnector {
  serviceUrl: string;
  requests: Array<ConnectorRequest>;
  close: () => Promise<void>;
}

async function startFakeBotConnector(): Promise<FakeBotConnector> {
  let messageNumber: number = 0;

  const fake: FakeBotConnector = {
    serviceUrl: "",
    requests: [],
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
        const activities: RegExpExecArray | null = ACTIVITIES_PATH.exec(path);

        if (activities) {
          messageNumber++;
          fake.requests.push({
            method: req.method || "",
            conversationId: decodeURIComponent(activities[1] || ""),
            activityId: activities[2]
              ? decodeURIComponent(activities[2])
              : null,
            activity: bodyText ? (JSON.parse(bodyText) as JSONObject) : {},
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

// ---- The project behind the bot, and its one incident ----

const TENANT_ID: string = "4242aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BOT: JSONObject = { id: "28:oneuptime-bot-app-id", name: "OneUptime" };
const SENDER: JSONObject = {
  id: "29:1simon",
  name: "Simon Lee",
  aadObjectId: "00000000-0000-4000-8000-00000000b1b1",
};
const SENDER_MENTION: string = "<at>Simon Lee</at>";
const PERSONAL_CONVERSATION_ID: string = "a:4242-personal-chat";
// The incident's own channel, which a notification rule created for it.
const INCIDENT_CHANNEL_ID: string = "19:incident-42@thread.tacv2";
const OPS_CHANNEL_ID: string = "19:ops-4242@thread.tacv2";
const TEAM_THREAD_ID: string = "19:ops-team-4242@thread.tacv2";
const GRAPH_TEAM_ID: string = "aaaa4242-0000-4000-8000-000000000001";
const DASHBOARD_URL: string = "https://oneuptime.example.com/dashboard";
// The form card a submit answers: its replyToId, which Teams removes.
const FORM_CARD_ID: string = "form-card-1";

const SIMON: ObjectID = new ObjectID("d6000000-0000-4000-8000-0000000000a1");
const NAWAZ: ObjectID = new ObjectID("d6000000-0000-4000-8000-0000000000a2");
const ANA: ObjectID = new ObjectID("d6000000-0000-4000-8000-0000000000a3");
const INCIDENT_ID: ObjectID = new ObjectID(
  "d6000000-0000-4000-8000-0000000000b1",
);
const CRITICAL: ObjectID = new ObjectID("d6000000-0000-4000-8000-0000000000c1");
const MINOR: ObjectID = new ObjectID("d6000000-0000-4000-8000-0000000000c2");
const COMMANDER: ObjectID = new ObjectID(
  "d6000000-0000-4000-8000-0000000000d1",
);
const SCRIBE: ObjectID = new ObjectID("d6000000-0000-4000-8000-0000000000d2");
const ANA_AS_COMMANDER: ObjectID = new ObjectID(
  "d6000000-0000-4000-8000-0000000000e1",
);
const IMPACT_FIELD: ObjectID = new ObjectID(
  "d6000000-0000-4000-8000-0000000000f1",
);
const TICKET_FIELD: ObjectID = new ObjectID(
  "d6000000-0000-4000-8000-0000000000f2",
);
const USERS_FIELD: ObjectID = new ObjectID(
  "d6000000-0000-4000-8000-0000000000f3",
);
const STARTED_FIELD: ObjectID = new ObjectID(
  "d6000000-0000-4000-8000-0000000000f4",
);
const IDENTIFIED: ObjectID = new ObjectID(
  "d6000000-0000-4000-8000-000000000101",
);
const RESOLVED: ObjectID = new ObjectID("d6000000-0000-4000-8000-000000000102");
const PRIMARY_SCHEDULE: ObjectID = new ObjectID(
  "d6000000-0000-4000-8000-000000000201",
);

const NAMES: Record<string, string> = {
  [SIMON.toString()]: "Simon Lee",
  [NAWAZ.toString()]: "Nawaz Dhandala",
  [ANA.toString()]: "Ana Ruiz",
};

let connector: FakeBotConnector;
let projectId: ObjectID;
let activityCounter: number = 0;
let memberProps: DatabaseCommonInteractionProps;
let mayUpdateIncident: boolean;
let mayAssignRoles: boolean;
let mayPage: boolean;
let isIncidentReadable: boolean;
let incident: {
  severityId: ObjectID;
  stateId: ObjectID;
  customFields: JSONObject;
  holders: Array<{ memberId: ObjectID; userId: ObjectID; roleId: ObjectID }>;
};
let updates: Array<{
  id: ObjectID;
  data: JSONObject;
  props: DatabaseCommonInteractionProps;
}>;
let membersCreated: Array<{
  member: IncidentMember;
  props: DatabaseCommonInteractionProps;
}>;
let membersDeleted: Array<{
  id: ObjectID;
  props: DatabaseCommonInteractionProps;
}>;
let pages: Array<{
  targets: OnCallPageTargets;
  about: unknown;
  props: DatabaseCommonInteractionProps;
}>;
let incidentReads: Array<{
  query: JSONObject;
  props: DatabaseCommonInteractionProps;
}>;

function propsWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: SIMON,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: {
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
      },
    },
  };
}

function incidentUrl(): string {
  return `${DASHBOARD_URL}/${projectId.toString()}/incidents/${INCIDENT_ID.toString()}`;
}

function recordMarkdown(): string {
  return `**[Incident INC-42](${incidentUrl()})**`;
}

function nextActivityId(label: string): string {
  activityCounter++;
  return `4242-${label}-${activityCounter}-${ObjectID.generate().toString().substring(0, 8)}`;
}

function userOf(id: ObjectID): User {
  const user: User = new User();
  user.id = id;
  user.name = new Name(NAMES[id.toString()] || "Someone");
  return user;
}

function severityOf(id: ObjectID): IncidentSeverity {
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.id = id;
  severity.name = id.toString() === CRITICAL.toString() ? "Critical" : "Minor";
  return severity;
}

function roleOf(id: ObjectID): IncidentRole {
  const role: IncidentRole = new IncidentRole();
  role.id = id;
  role.name =
    id.toString() === COMMANDER.toString() ? "Incident Commander" : "Scribe";
  role.canAssignMultipleUsers = id.toString() !== COMMANDER.toString();
  return role;
}

function stateOf(id: ObjectID): IncidentState {
  const state: IncidentState = new IncidentState();
  const isResolvedState: boolean = id.toString() === RESOLVED.toString();
  state.id = id;
  state.projectId = projectId;
  state.name = isResolvedState ? "Resolved" : "Identified";
  state.order = isResolvedState ? 3 : 2;
  state.isCreatedState = false;
  state.isAcknowledgedState = !isResolvedState;
  state.isResolvedState = isResolvedState;
  return state;
}

/*
 * The incident as a read of it is answered: by its id, its number, or a
 * channel made for it - none for a read the member may not make.
 */
function readIncident(findOneBy: {
  query: JSONObject;
  props: DatabaseCommonInteractionProps;
}): Incident | null {
  const query: JSONObject = findOneBy.query;

  if (!findOneBy.props.isRoot && !isIncidentReadable) {
    return null;
  }

  if (query["incidentNumber"] !== undefined) {
    if (Number(query["incidentNumber"]) !== 42) {
      return null;
    }
  } else if (query["postUpdatesToWorkspaceChannels"] !== undefined) {
    // A JSON containment of [{ id: <channel> }], as findChannelOwner asks.
    if (
      !JSON.stringify(query["postUpdatesToWorkspaceChannels"]).includes(
        INCIDENT_CHANNEL_ID,
      )
    ) {
      return null;
    }
  } else if (String(query["_id"]) !== INCIDENT_ID.toString()) {
    return null;
  }

  const row: Incident = new Incident();
  row.id = INCIDENT_ID;
  row.projectId = projectId;
  row.title = "Checkout is down";
  row.incidentNumber = 42;
  row.incidentNumberWithPrefix = "INC-42";
  row.declaredAt = new Date("2026-10-15T09:30:00.000Z");
  row.incidentSeverityId = incident.severityId;
  row.incidentSeverity = severityOf(incident.severityId);
  row.currentIncidentStateId = incident.stateId;
  row.currentIncidentState = stateOf(incident.stateId);
  row.customFields = { ...incident.customFields };
  row.monitors = [];
  return row;
}

function customFieldDefinitions(): Array<IncidentCustomField> {
  const field: (
    id: ObjectID,
    name: string,
    type: CustomFieldType,
    sortOrder: number,
    options?: string,
  ) => IncidentCustomField = (
    id: ObjectID,
    name: string,
    type: CustomFieldType,
    sortOrder: number,
    options?: string,
  ): IncidentCustomField => {
    const row: IncidentCustomField = new IncidentCustomField();
    row.id = id;
    row.name = name;
    row.customFieldType = type;
    row.sortOrder = sortOrder;

    if (options) {
      row.dropdownOptions = options;
    }

    return row;
  };

  return [
    field(
      IMPACT_FIELD,
      "Customer Impact",
      CustomFieldType.Dropdown,
      1,
      "High\nMedium\nLow",
    ),
    field(TICKET_FIELD, "Ticket", CustomFieldType.Text, 2),
    field(USERS_FIELD, "Affected Users", CustomFieldType.Number, 3),
    field(STARTED_FIELD, "Started", CustomFieldType.DateTime, 4),
  ];
}

function pagedResult(): OnCallPageResult {
  return {
    record: {
      type: OnCallPageRecordType.Incident,
      id: INCIDENT_ID,
      label: "Incident INC-42",
      title: "Checkout is down",
      url: URL.fromString(incidentUrl()),
      isNew: false,
    },
    paged: [
      {
        userId: NAWAZ,
        name: "Nawaz Dhandala",
        email: null,
        teamName: null,
        scheduleName: "Primary",
        coveringForName: null,
      },
    ],
    startedPolicies: [],
    notPaged: [],
    isAnyonePaged: true,
    directPageExecutionLogId: PRIMARY_SCHEDULE,
    summary: "",
  };
}

type Where = "personal" | "incidentChannel" | "opsChannel";

// A message typed to the bot: in a personal chat, or after @OneUptime in a channel.
function message(text: string, where: Where = "personal"): JSONObject {
  const channelId: string | null =
    where === "incidentChannel"
      ? INCIDENT_CHANNEL_ID
      : where === "opsChannel"
        ? OPS_CHANNEL_ID
        : null;

  return {
    type: "message",
    id: nextActivityId(where),
    timestamp: "2026-10-15T10:00:00.000Z",
    serviceUrl: connector.serviceUrl,
    channelId: "msteams",
    from: SENDER,
    conversation: channelId
      ? {
          conversationType: "channel",
          tenantId: TENANT_ID,
          id: `${channelId};messageid=1760000000001`,
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
    text: channelId ? `<at>OneUptime</at> ${text}` : text,
    entities: channelId
      ? [{ type: "mention", text: "<at>OneUptime</at>", mentioned: BOT }]
      : [],
    channelData: channelId
      ? {
          tenant: { id: TENANT_ID },
          team: {
            id: TEAM_THREAD_ID,
            name: "Operations",
            aadGroupId: GRAPH_TEAM_ID,
          },
          channel: { id: channelId, name: "incident-42" },
        }
      : { tenant: { id: TENANT_ID } },
  };
}

/*
 * A card's button pressed, or a form card submitted (Action.Submit): a
 * message whose value names the action and the incident. A form's submit
 * answers the form card (replyToId).
 */
function press(
  action: string,
  fields: JSONObject = {},
  where: Where = "incidentChannel",
): JSONObject {
  const activity: JSONObject = message("", where);
  activity["text"] = "";
  activity["entities"] = [];
  activity["replyToId"] = FORM_CARD_ID;
  activity["value"] = {
    action: action,
    actionValue: INCIDENT_ID.toString(),
    ...fields,
  };
  return activity;
}

interface Delivery {
  httpStatus: number | null;
  requests: Array<ConnectorRequest>;
}

async function deliver(activity: JSONObject): Promise<Delivery> {
  const first: number = connector.requests.length;
  const res: RecordingResponse = new RecordingResponse();

  await MicrosoftTeamsUtil.processBotActivity(
    {
      method: "POST",
      headers: {},
      body: JSON.parse(JSON.stringify(activity)),
    } as unknown as ExpressRequest,
    res as unknown as ExpressResponse,
  );

  return {
    httpStatus: res.statusCode,
    requests: connector.requests.slice(first),
  };
}

// What the bot posted to the conversation, typing indicators left out.
function posted(delivery: Delivery): Array<ConnectorRequest> {
  return delivery.requests.filter((request: ConnectorRequest): boolean => {
    return request.method === "POST" && request.activity["type"] !== "typing";
  });
}

function removals(delivery: Delivery): Array<string | null> {
  return delivery.requests
    .filter((request: ConnectorRequest): boolean => {
      return request.method === "DELETE";
    })
    .map((request: ConnectorRequest): string | null => {
      return request.activityId;
    });
}

function cardOf(request: ConnectorRequest | undefined): JSONObject {
  const attachment: JSONObject | undefined = (
    request?.activity["attachments"] as Array<JSONObject> | undefined
  )?.[0];

  expect(attachment?.["contentType"]).toBe(
    "application/vnd.microsoft.card.adaptive",
  );

  return attachment!["content"] as JSONObject;
}

// An answer card (MicrosoftTeamsActionAnswer): what it says after the mention.
function answerOf(request: ConnectorRequest | undefined): string {
  const card: JSONObject = cardOf(request);
  const text: string = String(
    ((card["body"] as Array<JSONObject>)[0] as JSONObject)["text"],
  );

  expect(text.startsWith(`${SENDER_MENTION} `)).toBe(true);

  return text.substring(SENDER_MENTION.length + 1);
}

function elementOf(card: JSONObject, id: string): JSONObject {
  const element: JSONObject | undefined = (
    card["body"] as Array<JSONObject>
  ).find((candidate: JSONObject): boolean => {
    return candidate["id"] === id;
  });

  expect(element).toBeDefined();
  return element!;
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
  connector.requests.splice(0);
  projectId = ObjectID.generate();
  memberProps = propsWith([Permission.ProjectMember]);
  mayUpdateIncident = true;
  mayAssignRoles = true;
  mayPage = true;
  isIncidentReadable = true;
  incident = {
    severityId: MINOR,
    stateId: IDENTIFIED,
    customFields: { "Customer Impact": "Medium", Ticket: "OPS-118" },
    holders: [{ memberId: ANA_AS_COMMANDER, userId: ANA, roleId: COMMANDER }],
  };
  updates = [];
  membersCreated = [];
  membersDeleted = [];
  pages = [];
  incidentReads = [];

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

  // Simon has a connected account and is a member.
  jest
    .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
    .mockResolvedValue(SIMON);
  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockImplementation(async () => {
      return memberProps;
    });

  // The member's role, as the permission checks would read it.
  jest
    .spyOn(WorkspaceActionAuthorization, "assertCanUpdate")
    .mockImplementation(async (data: { action: string }) => {
      if (!mayUpdateIncident) {
        throw new NotAuthorizedException(
          `You do not have permission to ${data.action}. You need one of these permissions: Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Edit Incident.`,
        );
      }
    });
  jest
    .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
    .mockImplementation(
      async (data: { modelType: unknown; action: string }) => {
        if (data.modelType === IncidentMember && !mayAssignRoles) {
          throw new NotAuthorizedException(
            `You do not have permission to ${data.action}. You need one of these permissions: Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Create Incident Member.`,
          );
        }

        if (data.modelType === OnCallDutyPolicyExecutionLog && !mayPage) {
          throw new NotAuthorizedException(
            `You do not have permission to ${data.action}.`,
          );
        }
      },
    );

  // The lists the cards offer, as the member may read them.
  jest
    .spyOn(WorkspaceActionAuthorization, "findReadable")
    .mockImplementation((async (data: { service: unknown }) => {
      switch (data.service) {
        case IncidentSeverityService:
          return [severityOf(CRITICAL), severityOf(MINOR)];
        case IncidentRoleService:
          return [roleOf(COMMANDER), roleOf(SCRIBE)];
        case TeamMemberService:
          return [SIMON, NAWAZ, ANA].map((id: ObjectID): TeamMember => {
            const member: TeamMember = new TeamMember();
            member.userId = id;
            member.user = userOf(id);
            return member;
          });
        default:
          return [];
      }
    }) as never);

  jest
    .spyOn(IncidentService, "findOneBy")
    .mockImplementation((async (findOneBy: {
      query: JSONObject;
      props: DatabaseCommonInteractionProps;
    }) => {
      incidentReads.push({ query: findOneBy.query, props: findOneBy.props });
      return readIncident(findOneBy);
    }) as never);
  jest
    .spyOn(IncidentService, "updateOneById")
    .mockImplementation((async (updateOneById: {
      id: ObjectID;
      data: JSONObject;
      props: DatabaseCommonInteractionProps;
    }) => {
      updates.push(updateOneById);
      return 1;
    }) as never);
  jest
    .spyOn(IncidentSeverityService, "findOneBy")
    .mockImplementation((async (findOneBy: { query: { _id: string } }) => {
      const id: string = String(findOneBy.query._id);
      return [CRITICAL, MINOR].some((severity: ObjectID): boolean => {
        return severity.toString() === id;
      })
        ? severityOf(new ObjectID(id))
        : null;
    }) as never);
  jest
    .spyOn(IncidentRoleService, "findOneBy")
    .mockImplementation((async (findOneBy: { query: { _id: string } }) => {
      const id: string = String(findOneBy.query._id);
      return [COMMANDER, SCRIBE].some((role: ObjectID): boolean => {
        return role.toString() === id;
      })
        ? roleOf(new ObjectID(id))
        : null;
    }) as never);
  jest.spyOn(IncidentMemberService, "findBy").mockImplementation((async () => {
    return incident.holders.map(
      (holder: {
        memberId: ObjectID;
        userId: ObjectID;
        roleId: ObjectID;
      }): IncidentMember => {
        const member: IncidentMember = new IncidentMember();
        member.id = holder.memberId;
        member.userId = holder.userId;
        member.incidentRoleId = holder.roleId;
        member.user = userOf(holder.userId);
        member.incidentRole = roleOf(holder.roleId);
        return member;
      },
    );
  }) as never);
  jest
    .spyOn(IncidentMemberService, "create")
    .mockImplementation((async (create: {
      data: IncidentMember;
      props: DatabaseCommonInteractionProps;
    }) => {
      membersCreated.push({ member: create.data, props: create.props });
      return create.data;
    }) as never);
  jest
    .spyOn(IncidentMemberService, "deleteOneById")
    .mockImplementation((async (deleteOneById: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
    }) => {
      membersDeleted.push(deleteOneById);
      return 1;
    }) as never);
  jest
    .spyOn(TeamMemberService, "findOneBy")
    .mockImplementation((async (findOneBy: { query: { userId: ObjectID } }) => {
      const member: TeamMember = new TeamMember();
      member.user = userOf(findOneBy.query.userId);
      return member;
    }) as never);
  jest
    .spyOn(IncidentCustomFieldService, "findBy")
    .mockImplementation((async () => {
      return customFieldDefinitions();
    }) as never);
  jest
    .spyOn(WorkspacePage, "getChoices")
    .mockImplementation(async (): Promise<Array<WorkspacePageChoiceGroup>> => {
      return [
        {
          kind: WorkspacePageTargetKind.Schedule,
          label: "On call now",
          choices: [
            {
              label: "Primary (Nawaz Dhandala)",
              value: `${WorkspacePageTargetKind.Schedule}:${PRIMARY_SCHEDULE.toString()}`,
            },
          ],
        },
        {
          kind: WorkspacePageTargetKind.Person,
          label: "People",
          choices: [
            {
              label: "Nawaz Dhandala",
              value: `${WorkspacePageTargetKind.Person}:${NAWAZ.toString()}`,
            },
          ],
        },
      ] as Array<WorkspacePageChoiceGroup>;
    });
  jest
    .spyOn(WorkspaceMemberActions, "getStanding")
    .mockImplementation(async (): Promise<WorkspaceEventStanding> => {
      return {
        isAcknowledged: true,
        isResolved: incident.stateId.toString() === RESOLVED.toString(),
        hasStarted: true,
        isComplete: false,
      };
    });
  jest.spyOn(OnCallPageService, "page").mockImplementation((async (page: {
    targets: OnCallPageTargets;
    about: unknown;
    props: DatabaseCommonInteractionProps;
  }) => {
    pages.push({
      targets: page.targets,
      about: page.about,
      props: page.props,
    });
    return pagedResult();
  }) as never);
  jest
    .spyOn(IncidentStateService, "getAllIncidentStates")
    .mockImplementation((async () => {
      return [stateOf(IDENTIFIED), stateOf(RESOLVED)];
    }) as never);
  jest
    .spyOn(IncidentStateTimelineService, "findBy")
    .mockImplementation((async () => {
      const row: IncidentStateTimeline = new IncidentStateTimeline();
      row.incidentStateId = RESOLVED;
      row.startsAt = new Date("2026-10-15T09:45:00.000Z");
      row.createdByUserId = ANA;
      return [row];
    }) as never);
  jest.spyOn(UserService, "findOneBy").mockImplementation((async (findOneBy: {
    query: { _id: ObjectID };
  }) => {
    return userOf(new ObjectID(findOneBy.query._id.toString()));
  }) as never);

  jest.spyOn(DatabaseConfig, "getDashboardUrl").mockImplementation(() => {
    return Promise.resolve(URL.fromString(DASHBOARD_URL));
  });
  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");

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

  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
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

describe("incident <number>, typed to the bot: the incident, with its buttons and menu", () => {
  test.each([["incident 42"], ["incident #42"], ["incident INC-42"]])(
    "%s: incident 42's card - its number and title, what it is now, who holds its roles, four buttons, then five in its menu (…)",
    async (typed: string) => {
      const delivery: Delivery = await deliver(message(typed));

      expect(delivery.httpStatus).toBe(200);

      const posts: Array<ConnectorRequest> = posted(delivery);
      expect(posts).toHaveLength(1);
      expect(posts[0]!.activity["summary"]).toBe("INC-42 Checkout is down");

      const card: JSONObject = cardOf(posts[0]);
      const body: Array<JSONObject> = card["body"] as Array<JSONObject>;

      /*
       * Each line a text block of its own: Teams runs lines one break apart
       * together in one block.
       */
      expect(
        body.map((block: JSONObject): string => {
          return String(block["text"]);
        }),
      ).toEqual([
        `🚨 **[INC-42](${incidentUrl()})** · **Checkout is down**`,
        "Severity: Minor · State: Identified · Declared {{DATE(2026-10-15T09:30:00Z, SHORT)}} at {{TIME(2026-10-15T09:30:00Z)}}",
        "👤 Incident Commander: **Ana Ruiz**",
      ]);

      expect(
        (card["actions"] as Array<JSONObject>).map(
          (action: JSONObject): [string, string, string | undefined] => {
            return [
              String(action["type"]),
              String(action["title"]),
              action["mode"] as string | undefined,
            ];
          },
        ),
      ).toEqual([
        ["Action.Submit", "👀 Acknowledge Incident", undefined],
        ["Action.Submit", "✅ Resolve Incident", undefined],
        ["Action.Submit", "📄 Add Note", undefined],
        ["Action.OpenUrl", "🔗 View Incident", undefined],
        ["Action.Submit", "⚠️ Change Severity", "secondary"],
        ["Action.Submit", "➡️ Change Incident State", "secondary"],
        ["Action.Submit", "👤 Assign Role", "secondary"],
        ["Action.Submit", "📟 Page Someone", "secondary"],
        ["Action.Submit", "📝 Edit Custom Fields", "secondary"],
      ]);

      // Each carries the incident, pressed by the same ids as Slack's.
      expect((card["actions"] as Array<JSONObject>)[4]!["data"]).toEqual({
        action: "ViewChangeIncidentSeverity",
        actionValue: INCIDENT_ID.toString(),
      });

      // Found as Simon reads it.
      expect(incidentReads[0]).toEqual({
        query: { projectId: projectId, incidentNumber: 42 },
        props: memberProps,
      });
    },
  );

  test("a number no incident has, or one Simon may not read: said so, mentioning him, and how to declare one", async () => {
    const delivery: Delivery = await deliver(message("incident 99"));

    expect(answerOf(posted(delivery)[0])).toBe(
      "🔍 There is no incident 99 in this project, or you do not have access to it. To declare a new incident, type **incident** followed by its title.",
    );
  });

  test("a word that only looks like a number - IPv6 - is the new incident's title, as the command always took it", async () => {
    const declare: SpyInstance<
      typeof MicrosoftTeamsCreateCommands.handleCreateIncidentCommand
    > = jest
      .spyOn(MicrosoftTeamsCreateCommands, "handleCreateIncidentCommand")
      .mockResolvedValue(undefined);

    await deliver(message("incident IPv6"));

    expect(declare).toHaveBeenCalledTimes(1);
    expect(declare.mock.calls[0]![0].initialTitle).toBe("IPv6");
  });

  test("plain 'incident' in the incident's own channel: that incident, and how to declare another instead", async () => {
    const delivery: Delivery = await deliver(
      message("incident", "incidentChannel"),
    );

    const card: JSONObject = cardOf(posted(delivery)[0]);
    const body: Array<JSONObject> = card["body"] as Array<JSONObject>;

    expect(String(body[body.length - 1]!["text"])).toBe(
      "To declare a new incident instead, type **incident** followed by its title.",
    );
    // Which channel is an incident's is OneUptime's to know: read as root.
    expect(incidentReads[0]!.props).toEqual({ isRoot: true });
  });

  test("plain 'incident' in any other channel: the incident form, as always", async () => {
    const declare: SpyInstance<
      typeof MicrosoftTeamsCreateCommands.handleCreateIncidentCommand
    > = jest
      .spyOn(MicrosoftTeamsCreateCommands, "handleCreateIncidentCommand")
      .mockResolvedValue(undefined);

    await deliver(message("incident", "opsChannel"));

    expect(declare).toHaveBeenCalledTimes(1);
  });

  test("from a Teams account not connected: asked to connect to see it, then to type exactly that again", async () => {
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockRejectedValue(
        new MicrosoftTeamsAccountNotLinkedException("not linked"),
      );

    const delivery: Delivery = await deliver(message("incident 42"));

    expect(answerOf(posted(delivery)[0])).toBe(
      "🔗 **Connect your Microsoft Teams account to see this incident.** It takes one click. Then type **incident 42** again.",
    );
  });
});

describe("the incident card's menu: each form, as a card, filled in as Simon reads the incident", () => {
  test("Change Severity: the severities he may pick, the incident's own picked; Save carries the incident", async () => {
    const delivery: Delivery = await deliver(
      press("ViewChangeIncidentSeverity"),
    );

    const posts: Array<ConnectorRequest> = posted(delivery);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.activity["summary"]).toBe("Change Severity");

    const card: JSONObject = cardOf(posts[0]);
    const body: Array<JSONObject> = card["body"] as Array<JSONObject>;

    expect(body[0]).toMatchObject({
      type: "TextBlock",
      text: "Change Severity",
    });
    expect(body[1]!["text"]).toBe("🚨 **INC-42** Checkout is down");
    expect(elementOf(card, "incidentSeverity")).toMatchObject({
      type: "Input.ChoiceSet",
      label: "Incident Severity",
      placeholder: "Select Incident Severity",
      isRequired: true,
      value: MINOR.toString(),
    });
    expect(
      (elementOf(card, "incidentSeverity")["choices"] as Array<JSONObject>).map(
        (choice: JSONObject) => {
          return choice["title"];
        },
      ),
    ).toEqual(["Critical", "Minor"]);
    expect(card["actions"]).toEqual([
      {
        type: "Action.Submit",
        title: "Save",
        style: "positive",
        data: {
          action: "SubmitChangeIncidentSeverity",
          actionValue: INCIDENT_ID.toString(),
        },
      },
    ]);
    // The card the press came from stays: it is the incident's.
    expect(removals(delivery)).toEqual([]);
  });

  test("Assign Role: who holds what, the primary role picked, Simon picked", async () => {
    const delivery: Delivery = await deliver(press("ViewAssignIncidentRole"));
    const card: JSONObject = cardOf(posted(delivery)[0]);

    expect((card["body"] as Array<JSONObject>)[2]!["text"]).toBe(
      "👤 Incident Commander: **Ana Ruiz**",
    );
    expect(elementOf(card, "incidentRole")["value"]).toBe(COMMANDER.toString());
    expect(
      (
        elementOf(card, "incidentRolePerson")["choices"] as Array<JSONObject>
      ).map((choice: JSONObject) => {
        return choice["title"];
      }),
    ).toEqual(["Simon Lee (you)", "Ana Ruiz", "Nawaz Dhandala"]);
    // The role that takes one person, by name, and what picking does.
    expect(
      (card["body"] as Array<JSONObject>).some((block: JSONObject): boolean => {
        return (
          block["text"] ===
          "Incident Commander takes one person: picking someone replaces whoever has it."
        );
      }),
    ).toBe(true);
    expect(elementOf(card, "incidentRolePerson")["value"]).toBe(
      SIMON.toString(),
    );
  });

  test("Page Someone: one list, each choice led by its kind, many at once", async () => {
    const delivery: Delivery = await deliver(press("ViewPageAboutIncident"));
    const card: JSONObject = cardOf(posted(delivery)[0]);

    expect(elementOf(card, "incidentPageTargets")).toMatchObject({
      type: "Input.ChoiceSet",
      isMultiSelect: true,
      isRequired: true,
      choices: [
        {
          title: "Schedule · Primary (Nawaz Dhandala)",
          value: `schedule:${PRIMARY_SCHEDULE.toString()}`,
        },
        {
          title: "Person · Nawaz Dhandala",
          value: `user:${NAWAZ.toString()}`,
        },
      ],
    });
  });

  test("Page Someone: says the page goes on until one of them answers, then an optional message for the people paged", async () => {
    const delivery: Delivery = await deliver(press("ViewPageAboutIncident"));
    const card: JSONObject = cardOf(posted(delivery)[0]);
    const body: Array<JSONObject> = card["body"] as Array<JSONObject>;
    const texts: Array<string> = body.map((element: JSONObject): string => {
      return String(element["text"] || "");
    });

    expect(texts).toContain(
      "They are paged about this incident until one of them answers. A schedule pages whoever is on call in it now; a policy pages through its escalation rules.",
    );

    const message: JSONObject = elementOf(card, "incidentPageMessage");

    expect(message).toMatchObject({
      type: "Input.Text",
      label: "Message",
      isMultiline: true,
      maxLength: 500,
    });
    // Optional: the incident says what the page is about.
    expect(message["isRequired"]).toBeUndefined();
    expect(texts[body.indexOf(message) + 1]).toBe(
      "Optional. The people you page see it with the incident.",
    );
    // After the list of who to page.
    expect(body.indexOf(message)).toBeGreaterThan(
      body.indexOf(elementOf(card, "incidentPageTargets")),
    );
  });

  test("Edit Custom Fields: each field as the input its type asks for, a date and time as a day and a time", async () => {
    const delivery: Delivery = await deliver(
      press("ViewEditIncidentCustomFields"),
    );
    const card: JSONObject = cardOf(posted(delivery)[0]);
    const impact: JSONObject = elementOf(
      card,
      WorkspaceIncidentCustomFields.getInputId(IMPACT_FIELD),
    );

    expect(impact).toMatchObject({
      type: "Input.ChoiceSet",
      label: "Customer Impact",
      isMultiSelect: false,
      value: WorkspaceIncidentCustomFields.toToken(1, "Medium"),
    });
    expect(
      elementOf(card, WorkspaceIncidentCustomFields.getInputId(TICKET_FIELD)),
    ).toMatchObject({ type: "Input.Text", value: "OPS-118" });
    expect(
      elementOf(card, WorkspaceIncidentCustomFields.getInputId(USERS_FIELD))[
        "type"
      ],
    ).toBe("Input.Number");
    expect(
      elementOf(
        card,
        `${WorkspaceIncidentCustomFields.getInputId(STARTED_FIELD)}__date`,
      )["type"],
    ).toBe("Input.Date");
    // The time is labelled, with the zone it is read in: UTC, none known.
    expect(
      elementOf(
        card,
        `${WorkspaceIncidentCustomFields.getInputId(STARTED_FIELD)}__time`,
      ),
    ).toMatchObject({ type: "Input.Time", label: "Time in UTC" });
    expect(
      (card["actions"] as Array<JSONObject>)[0]!["data"] as JSONObject,
    ).toMatchObject({
      action: "SubmitEditIncidentCustomFields",
      actionValue: INCIDENT_ID.toString(),
    });
  });

  test("Edit Custom Fields from someone whose Teams says their zone: the time in it, named where it is typed", async () => {
    incident.customFields = {
      ...incident.customFields,
      Started: "2026-10-15T09:30:00.000Z",
    };

    const activity: JSONObject = press("ViewEditIncidentCustomFields");
    activity["localTimezone"] = "Europe/Berlin";

    const card: JSONObject = cardOf(posted(await deliver(activity))[0]);

    expect(
      elementOf(
        card,
        `${WorkspaceIncidentCustomFields.getInputId(STARTED_FIELD)}__time`,
      ),
    ).toMatchObject({
      type: "Input.Time",
      label: "Time in Europe/Berlin",
      value: "11:30",
    });
    // Said at the time itself, so the note under the fields does not.
    expect(JSON.stringify(card["body"])).not.toContain("Times are in");
    expect(
      ((card["actions"] as Array<JSONObject>)[0]!["data"] as JSONObject)[
        "timezone"
      ],
    ).toBe("Europe/Berlin");
  });

  test("a project with no custom fields: no empty card - where to add them", async () => {
    jest.spyOn(IncidentCustomFieldService, "findBy").mockResolvedValue([]);

    const delivery: Delivery = await deliver(
      press("ViewEditIncidentCustomFields"),
    );

    expect(answerOf(posted(delivery)[0])).toBe(
      "This project has no incident custom fields yet. Add them in OneUptime under Incidents → Settings → Custom Fields.",
    );
  });
});

describe("a form card, submitted: the change as Simon, said in the conversation, and the card removed", () => {
  test("Change Severity: the incident's update, as Simon; then the confirmation; then the card goes", async () => {
    const delivery: Delivery = await deliver(
      press("SubmitChangeIncidentSeverity", {
        incidentSeverity: CRITICAL.toString(),
      }),
    );

    expect(updates).toEqual([
      {
        id: INCIDENT_ID,
        data: { incidentSeverityId: CRITICAL },
        props: memberProps,
      },
    ]);

    /*
     * Said in the conversation, mentioning who did it - anyone there may
     * submit a card - with what a notification of it shows.
     */
    const posts: Array<ConnectorRequest> = posted(delivery);
    expect(posts).toHaveLength(1);
    expect(answerOf(posts[0])).toBe(
      `⚠️ ${recordMarkdown()} is now **Critical**.`,
    );
    expect(posts[0]!.activity["summary"]).toBe(
      "Incident INC-42 is now Critical",
    );
    expect(removals(delivery)).toEqual([FORM_CARD_ID]);
  });

  test("no severity picked: said, mentioning Simon; nothing written; the card stays to pick again", async () => {
    const delivery: Delivery = await deliver(
      press("SubmitChangeIncidentSeverity", { incidentSeverity: "" }),
    );

    expect(updates).toEqual([]);
    expect(answerOf(posted(delivery)[0])).toBe(
      "Pick a severity, then press Save again.",
    );
    expect(removals(delivery)).toEqual([]);
  });

  test("Assign Role: Simon is Incident Commander now - added first, then Ana taken off", async () => {
    const delivery: Delivery = await deliver(
      press("SubmitAssignIncidentRole", {
        incidentRole: COMMANDER.toString(),
        incidentRolePerson: SIMON.toString(),
      }),
    );

    expect(membersCreated).toHaveLength(1);
    expect(membersCreated[0]!.member.userId).toEqual(SIMON);
    expect(membersCreated[0]!.member.incidentRoleId).toEqual(COMMANDER);
    expect(membersCreated[0]!.props).toBe(memberProps);
    expect(membersDeleted).toEqual([
      { id: ANA_AS_COMMANDER, props: memberProps },
    ]);
    expect(answerOf(posted(delivery)[0])).toBe(
      `👤 **Simon Lee** is now **Incident Commander** on ${recordMarkdown()}, in place of **Ana Ruiz**.`,
    );
    expect(removals(delivery)).toEqual([FORM_CARD_ID]);
  });

  test("Page Someone: the page about the incident, as Simon; who was paged; the card goes", async () => {
    const delivery: Delivery = await deliver(
      press("SubmitPageAboutIncident", {
        incidentPageTargets: `schedule:${PRIMARY_SCHEDULE.toString()},user:${NAWAZ.toString()}`,
      }),
    );

    expect(pages).toEqual([
      {
        targets: expect.objectContaining({
          userIds: [NAWAZ],
          onCallScheduleIds: [PRIMARY_SCHEDULE],
        }),
        about: { incidentId: INCIDENT_ID },
        props: memberProps,
      },
    ]);
    expect(answerOf(posted(delivery)[0])).toBe(
      `📟 Paged **Nawaz Dhandala** about ${recordMarkdown()}`,
    );
    expect(removals(delivery)).toEqual([FORM_CARD_ID]);
  });

  test("Page Someone with a message: the page about the incident carries it, and the answer quotes it", async () => {
    const delivery: Delivery = await deliver(
      press("SubmitPageAboutIncident", {
        incidentPageTargets: `user:${NAWAZ.toString()}`,
        incidentPageMessage: "  Can you check the database?\nIt is slow.  ",
      }),
    );

    expect(pages).toEqual([
      {
        targets: expect.objectContaining({ userIds: [NAWAZ] }),
        about: {
          incidentId: INCIDENT_ID,
          message: "Can you check the database? It is slow.",
        },
        props: memberProps,
      },
    ]);
    expect(answerOf(posted(delivery)[0])).toBe(
      `📟 Paged **Nawaz Dhandala** about ${recordMarkdown()}: “Can you check the database? It is slow.”`,
    );
  });

  test("Page Someone with only spaces for a message: paged with none, as from a card sent before it was asked", async () => {
    await deliver(
      press("SubmitPageAboutIncident", {
        incidentPageTargets: `user:${NAWAZ.toString()}`,
        incidentPageMessage: "   ",
      }),
    );

    expect(pages).toHaveLength(1);
    expect(pages[0]!.about).toEqual({ incidentId: INCIDENT_ID });
  });

  test("Page Someone with nobody picked: said; nobody paged; the card stays", async () => {
    const delivery: Delivery = await deliver(
      press("SubmitPageAboutIncident", { incidentPageTargets: "" }),
    );

    expect(pages).toEqual([]);
    // In the conversation, so with what to do next, as the other cards say.
    expect(answerOf(posted(delivery)[0])).toBe(
      "Pick who to page, then press Page again.",
    );
    expect(removals(delivery)).toEqual([]);
  });

  test("Page Someone on an incident resolved meanwhile: nobody paged, who resolved it and when", async () => {
    incident.stateId = RESOLVED;

    const delivery: Delivery = await deliver(
      press("SubmitPageAboutIncident", {
        incidentPageTargets: `user:${NAWAZ.toString()}`,
      }),
    );

    expect(pages).toEqual([]);
    expect(answerOf(posted(delivery)[0])).toBe(
      `${recordMarkdown()} was already resolved by **Ana Ruiz** at {{TIME(2026-10-15T09:45:00Z)}}, so nobody was paged.`,
    );
  });

  test("Edit Custom Fields: only what changed is written, as Simon - a time read in the zone the card showed", async () => {
    const delivery: Delivery = await deliver(
      press("SubmitEditIncidentCustomFields", {
        [WorkspaceIncidentCustomFields.getInputId(IMPACT_FIELD)]:
          WorkspaceIncidentCustomFields.toToken(0, "High"),
        [WorkspaceIncidentCustomFields.getInputId(TICKET_FIELD)]: "OPS-118",
        [WorkspaceIncidentCustomFields.getInputId(USERS_FIELD)]: "1200",
        [`${WorkspaceIncidentCustomFields.getInputId(STARTED_FIELD)}__date`]:
          "2026-10-15",
        [`${WorkspaceIncidentCustomFields.getInputId(STARTED_FIELD)}__time`]:
          "11:30",
        timezone: "Europe/Berlin",
      }),
    );

    expect(updates).toEqual([
      {
        id: INCIDENT_ID,
        data: {
          customFields: {
            "Customer Impact": "High",
            Ticket: "OPS-118",
            "Affected Users": 1200,
            Started: "2026-10-15T09:30:00.000Z",
          },
        },
        props: memberProps,
      },
    ]);
    expect(answerOf(posted(delivery)[0])).toBe(
      `📝 Updated **Customer Impact**, **Affected Users** and **Started** on ${recordMarkdown()}.`,
    );
    expect(removals(delivery)).toEqual([FORM_CARD_ID]);
  });

  test("a value that does not fit its field: what to fix, mentioning Simon; nothing saved; the card stays", async () => {
    const delivery: Delivery = await deliver(
      press("SubmitEditIncidentCustomFields", {
        [WorkspaceIncidentCustomFields.getInputId(USERS_FIELD)]: "lots",
        [WorkspaceIncidentCustomFields.getInputId(TICKET_FIELD)]: "OPS-200",
      }),
    );

    expect(updates).toEqual([]);
    expect(answerOf(posted(delivery)[0])).toBe(
      "Nothing was saved. Fix these, then press Save again:\n\n- **Affected Users**: Enter a number.",
    );
    expect(removals(delivery)).toEqual([]);
  });
});

describe("somebody who may not: told why, mentioning them, and no card", () => {
  test("a member whose role may not change incidents presses Change Severity", async () => {
    mayUpdateIncident = false;

    const delivery: Delivery = await deliver(
      press("ViewChangeIncidentSeverity"),
    );

    expect(posted(delivery)).toHaveLength(1);
    expect(answerOf(posted(delivery)[0])).toBe(
      "You do not have permission to change the severity of this incident. You need one of these permissions: Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Edit Incident.",
    );
  });

  test("a card submitted by somebody else in the channel who may not: checked as them, refused, nothing written", async () => {
    mayAssignRoles = false;

    const delivery: Delivery = await deliver(
      press("SubmitAssignIncidentRole", {
        incidentRole: SCRIBE.toString(),
        incidentRolePerson: NAWAZ.toString(),
      }),
    );

    expect(membersCreated).toEqual([]);
    expect(answerOf(posted(delivery)[0])).toBe(
      "You do not have permission to assign a role on this incident. You need one of these permissions: Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Create Incident Member.",
    );
    expect(removals(delivery)).toEqual([]);
  });

  test("an incident Simon may not read - its labels, its owners - is refused with that, never as one that is not there", async () => {
    isIncidentReadable = false;

    const delivery: Delivery = await deliver(press("ViewAssignIncidentRole"));

    expect(answerOf(posted(delivery)[0])).toBe(
      "You do not have permission to assign a role on this incident: your access in this project does not include this incident. Ask a project admin for access to it.",
    );
  });

  test.each([
    [
      "ViewChangeIncidentSeverity",
      "change the severity of this incident",
      "Change Severity",
    ],
    ["ViewAssignIncidentRole", "assign a role on this incident", "Assign Role"],
    [
      "ViewPageAboutIncident",
      "page someone about this incident",
      "Page Someone",
    ],
    [
      "ViewEditIncidentCustomFields",
      "edit the custom fields of this incident",
      "Edit Custom Fields",
    ],
  ])(
    "%s from a Teams account not connected: asked to connect, for exactly that, then to choose it from the menu again",
    async (action: string, purpose: string, item: string) => {
      jest
        .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
        .mockRejectedValue(
          new MicrosoftTeamsAccountNotLinkedException("not linked"),
        );

      const delivery: Delivery = await deliver(press(action));

      // An item of the card's menu (…), not a button: chosen again there.
      expect(answerOf(posted(delivery)[0])).toBe(
        `🔗 **Connect your Microsoft Teams account to ${purpose}.** It takes one click. Then choose **${item}** from the menu again.`,
      );

      const button: JSONObject = (
        cardOf(posted(delivery)[0])["actions"] as Array<JSONObject>
      )[0]!;
      const token: string | null = new globalThis.URL(
        String(button["url"]),
      ).searchParams.get("connect");
      expect(token).toMatch(CONNECT_REQUEST_TOKEN_PATTERN);

      const kept: WorkspaceConnectRequestRecord | null =
        await WorkspaceConnectRequest.peek(token);
      expect(kept).toMatchObject({
        purpose: purpose,
        again: { kind: WorkspaceConnectRequestAgainKind.MenuItem, label: item },
      });
    },
  );
});
