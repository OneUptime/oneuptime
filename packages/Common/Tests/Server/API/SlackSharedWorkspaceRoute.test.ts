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
import { AddressInfo } from "net";
import express from "express";
import API from "../../../Utils/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Name from "../../../Types/Name";
import BadDataException from "../../../Types/Exception/BadDataException";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import WorkspaceNotificationLog from "../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentInternalNoteService from "../../../Server/Services/IncidentInternalNoteService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import MonitorService from "../../../Server/Services/MonitorService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallPageService, {
  OnCallPageRecordType,
} from "../../../Server/Services/OnCallPageService";
import ProjectService from "../../../Server/Services/ProjectService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceLiveMessageService from "../../../Server/Services/WorkspaceLiveMessageService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import ProductBrandingText from "../../../Server/Utils/ProductBrandingText";
import CallerPlan from "../../../Server/Utils/Billing/CallerPlan";
import OnCallPolicyRunMessage from "../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceIncidentCustomFields from "../../../Server/Utils/Workspace/WorkspaceIncidentCustomFields";
import { WorkspaceNoteFormType } from "../../../Server/Utils/Workspace/WorkspaceNoteForm";
import WorkspaceOnCallNow from "../../../Server/Utils/Workspace/WorkspaceOnCallNow";
import WorkspacePage, {
  WorkspacePageTargetKind,
} from "../../../Server/Utils/Workspace/WorkspacePage";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import AIService from "../../../Server/Services/AIService";
import ObservabilityAssistant from "../../../Server/Utils/AI/Chat/ObservabilityAssistant";

jest.mock("../../../Server/Utils/Logger");

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

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

/*
 * ONE SLACK WORKSPACE, MORE THAN ONE ONEUPTIME PROJECT.
 *
 * A customer: "as an on-call user, I am added to the channel. But I am
 * unable to acknowledge/resolve the incident from the slack channel, I am
 * able to acknowledge using the link from the Slack PM." The incident's own
 * channel answered every button "You do not have permission to acknowledge
 * this incident: the incident was not found in this project, or you do not
 * have access to it." - to the incident's commander and owner - while a 📌
 * on a message there saved a note, and the link in the on-call direct
 * message acknowledged it. Another person, in the same workspace, was asked
 * to connect a Slack account they had connected, when they ran /irm page in
 * an incident's channel.
 *
 * Their Slack workspace is connected to two OneUptime projects. Slack sends
 * a press with the workspace's id and nothing else, and the press was read
 * in whichever of the two connections the database returned first - here,
 * the platform project - while the incident is the other project's. So the
 * incident was read in the wrong project, and was not there. The 📌 looked
 * the channel up in every connected project, and the direct message's link
 * names the page itself, so both worked.
 *
 * And on OneUptime Cloud, `/oneuptime page @someone test` answered "Could
 * not page: OneUptime could not confirm which plan this project is on" every
 * time: the member's props carried no plan, and the page's own check
 * refuses that.
 *
 * These post what Slack posts, through the real SlackAPI router,
 * authorization and handlers; only the database under them is stood in for,
 * by the two projects, their connections and members, and the incident.
 * Each refused-then-fixed path is here, and so is everybody who must still
 * be refused.
 */

const DASHBOARD_URL: string = "https://irm.test/dashboard";
const SLACK_TEAM_ID: string = "T0AVEPOINT";
const BOT_USER_ID: string = "B0IRM";
const TRIGGER_ID: string = "1760000000.trigger";
const PRESS_RESPONSE_URL: string =
  "https://hooks.slack.com/actions/T0AVEPOINT/1760000000/pressAbc123";
const COMMAND_RESPONSE_URL: string =
  "https://hooks.slack.com/commands/T0AVEPOINT/1760000000/cmdDef456";
const ZERO_WIDTH_SPACE: string = String.fromCharCode(0x200b);

/*
 * A press of one of the buttons that ask which project a request is for
 * (SlackProjectChoice): where Slack takes its answer, its trigger, and the
 * modal a shortcut's project is chosen in.
 */
const CHOICE_RESPONSE_URL: string =
  "https://hooks.slack.com/actions/T0AVEPOINT/1760000002/choiceGhi789";
const CHOICE_TRIGGER_ID: string = "1760000002.choice-trigger";
const CHOICE_VIEW_ID: string = "V0CHOICE";

// Deane's direct messages with the app.
const DM_CHANNEL_ID: string = "D0DEANE";

// The channel a notification rule created for INC-12, and two of no record.
const INCIDENT_CHANNEL_ID: string = "C0IRMINC12";
const GENERAL_CHANNEL_ID: string = "C0GENERAL";
// A channel only the platform project posts its notifications to.
const PLATFORM_ALERTS_CHANNEL_ID: string = "C0PLATFORMALERTS";

// Connected to the workspace first: the connection a lookup returned first.
const PLATFORM: ObjectID = new ObjectID("d1000000-0000-4000-8000-000000000001");
// INC-12's project.
const NONPRD: ObjectID = new ObjectID("d1000000-0000-4000-8000-000000000002");

// The commander and an owner of INC-12; a member of both projects.
const DEANE: ObjectID = new ObjectID("d1000000-0000-4000-8000-0000000000a1");
// A member of INC-12's project only.
const NITIN: ObjectID = new ObjectID("d1000000-0000-4000-8000-0000000000a2");
// A member of the platform project only.
const PRIYA: ObjectID = new ObjectID("d1000000-0000-4000-8000-0000000000a3");
// INC-12's project: may read incidents, not change their state.
const VIEWER: ObjectID = new ObjectID("d1000000-0000-4000-8000-0000000000a4");
// INC-12's project: their role does not cover INC-12 (its labels).
const LABELLED: ObjectID = new ObjectID("d1000000-0000-4000-8000-0000000000a5");
// Connected in INC-12's project, and removed from it since.
const FORMER: ObjectID = new ObjectID("d1000000-0000-4000-8000-0000000000a6");

const INCIDENT_ID: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-0000000000b1",
);
const TICKET_FIELD: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-0000000000f1",
);

const CREATED: ObjectID = new ObjectID("d1000000-0000-4000-8000-0000000000c1");
const ACKNOWLEDGED: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-0000000000c2",
);
const RESOLVED: ObjectID = new ObjectID("d1000000-0000-4000-8000-0000000000c3");

const SLACK_USERS: Record<string, ObjectID> = {
  U0DEANE: DEANE,
  U0NITIN: NITIN,
  U0PRIYA: PRIYA,
  U0VIEWER: VIEWER,
  U0LABELLED: LABELLED,
  U0FORMER: FORMER,
};

const NAMES: Record<string, string> = {
  [DEANE.toString()]: "Deane Looi",
  [NITIN.toString()]: "Nitin Bharathy",
  [PRIYA.toString()]: "Priya Raman",
};

const PROJECT_NAMES: Record<string, string> = {
  [PLATFORM.toString()]: "IRM Platform",
  [NONPRD.toString()]: "IRM Non-Prod",
};

// The plans OneUptime Cloud sells, as config.env names them.
const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

interface SlackCall {
  url: string;
  data: JSONObject;
}

interface RoutePort {
  port: number;
  close: () => Promise<void>;
}

interface Membership {
  userId: ObjectID;
  projectId: ObjectID;
  permissions: Array<Permission>;
}

function sameId(a: unknown, b: ObjectID | string): boolean {
  return (
    String(a ?? "")
      .toLowerCase()
      .trim() === b.toString().toLowerCase()
  );
}

/*
 * The ids a query's value names: an id, or the values of a Raw clause -
 * QueryHelper.any's IN (...), jsonContains' JSON, a privacy rule's user.
 */
function idsOf(value: unknown): Array<string> {
  if (value === undefined || value === null) {
    return [];
  }

  if (value instanceof ObjectID || typeof value === "string") {
    return [value.toString().toLowerCase()];
  }

  const parameters: JSONObject | undefined = (
    value as { objectLiteralParameters?: JSONObject }
  ).objectLiteralParameters;

  if (!parameters) {
    return [];
  }

  return Object.values(parameters)
    .flatMap((entry: unknown): Array<unknown> => {
      return Array.isArray(entry) ? entry : [entry];
    })
    .map((entry: unknown): string => {
      return String(entry).toLowerCase();
    });
}

// Whether a query's projectId names `projectId` - or names no project at all.
function namesProject(query: JSONObject, projectId: ObjectID): boolean {
  const ids: Array<string> = idsOf(query["projectId"]);
  return ids.length === 0 || ids.includes(projectId.toString().toLowerCase());
}

function tenantPermission(data: {
  projectId: ObjectID;
  permissions: Array<Permission>;
}): UserTenantAccessPermission {
  return {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    permissions: data.permissions.map(
      (permission: Permission): UserPermission => {
        return {
          _type: "UserPermission",
          permission: permission,
          isBlockPermission: false,
          labelIds: [],
        };
      },
    ),
  };
}

function userOf(id: ObjectID): User {
  const user: User = new User();
  user.id = id;
  user.name = new Name(NAMES[id.toString()] || "Someone");
  return user;
}

function stateOf(id: ObjectID, order: number): IncidentState {
  const state: IncidentState = new IncidentState();
  state.id = id;
  state.projectId = NONPRD;
  state.order = order;
  state.name =
    order === 1 ? "Created" : order === 2 ? "Acknowledged" : "Resolved";
  state.isCreatedState = order === 1;
  state.isAcknowledgedState = order === 2;
  state.isResolvedState = order === 3;
  return state;
}

async function startSlackApp(): Promise<RoutePort> {
  const SlackAPI: { new (): { getRouter: () => express.Router } } = (
    (await import("../../../Server/API/SlackAPI")) as unknown as {
      default: { new (): { getRouter: () => express.Router } };
    }
  ).default;

  const app: express.Express = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use("/api", new SlackAPI().getRouter());

  const server: http.Server = http.createServer(app);

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

function postForm(data: {
  port: number;
  path: string;
  fields: Record<string, string>;
}): Promise<number> {
  const payload: string = new globalThis.URLSearchParams(
    data.fields,
  ).toString();

  return new Promise<number>(
    (resolve: (status: number) => void, reject: (error: Error) => void) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: data.path,
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "content-length": Buffer.byteLength(payload),
          },
        },
        (response: http.IncomingMessage) => {
          response.resume();
          response.on("end", () => {
            resolve(response.statusCode || 0);
          });
        },
      );

      request.setTimeout(20000, () => {
        request.destroy(new Error("no answer"));
      });
      request.on("error", reject);
      request.write(payload);
      request.end();
    },
  );
}

/*
 * What Slack posts when a button of the incident's message is pressed in a
 * channel: a block action with the button's action id and value - the
 * incident's id.
 */
function buttonPress(data: {
  slackUserId: string;
  actionId: string;
  value: string;
  channelId?: string | undefined;
}): Record<string, string> {
  const channelId: string = data.channelId || INCIDENT_CHANNEL_ID;

  return {
    payload: JSON.stringify({
      type: "block_actions",
      user: {
        id: data.slackUserId,
        username: data.slackUserId.toLowerCase(),
        name: data.slackUserId.toLowerCase(),
        team_id: SLACK_TEAM_ID,
      },
      api_app_id: "A0IRM",
      team: { id: SLACK_TEAM_ID, domain: "avepoint" },
      channel: { id: channelId, name: "irm-nonprd-inc-12" },
      container: {
        type: "message",
        channel_id: channelId,
        message_ts: "1760000000.000200",
        is_ephemeral: false,
      },
      message: { ts: "1760000000.000200", type: "message" },
      response_url: PRESS_RESPONSE_URL,
      trigger_id: TRIGGER_ID,
      actions: [
        {
          type: "button",
          action_id: data.actionId,
          block_id: "incident-buttons",
          text: { type: "plain_text", text: data.actionId, emoji: true },
          value: data.value,
          action_ts: "1760000001.000300",
        },
      ],
    }),
  };
}

// The incident message's menu (⋯), an item chosen.
function menuChoice(data: {
  slackUserId: string;
  value: string;
}): Record<string, string> {
  return {
    payload: JSON.stringify({
      type: "block_actions",
      user: {
        id: data.slackUserId,
        username: data.slackUserId.toLowerCase(),
        name: data.slackUserId.toLowerCase(),
      },
      team: { id: SLACK_TEAM_ID },
      channel: { id: INCIDENT_CHANNEL_ID, name: "irm-nonprd-inc-12" },
      container: {
        type: "message",
        channel_id: INCIDENT_CHANNEL_ID,
        message_ts: "1760000000.000200",
      },
      message: { ts: "1760000000.000200" },
      response_url: PRESS_RESPONSE_URL,
      trigger_id: TRIGGER_ID,
      actions: [
        {
          type: "overflow",
          action_id: "MoreActions",
          block_id: "incident-buttons",
          selected_option: {
            text: { type: "plain_text", text: "an item", emoji: true },
            value: data.value,
          },
          action_ts: "1760000001.000300",
        },
      ],
    }),
  };
}

// A form's submission: the view, what was filled in, and its metadata.
function formSubmission(data: {
  slackUserId: string;
  callbackId: string;
  privateMetadata: string;
  state: Record<string, JSONObject>;
}): Record<string, string> {
  const values: JSONObject = {};

  for (const [blockId, value] of Object.entries(data.state)) {
    values[blockId] = { [blockId]: value };
  }

  return {
    payload: JSON.stringify({
      type: "view_submission",
      team: { id: SLACK_TEAM_ID },
      user: {
        id: data.slackUserId,
        username: data.slackUserId.toLowerCase(),
        name: data.slackUserId.toLowerCase(),
      },
      trigger_id: TRIGGER_ID,
      view: {
        type: "modal",
        callback_id: data.callbackId,
        private_metadata: data.privateMetadata,
        state: { values: values },
      },
    }),
  };
}

// A button of the app's Home tab, which carries the project it shows.
function homePress(data: {
  slackUserId: string;
  actionId: string;
  privateMetadata: string;
}): Record<string, string> {
  return {
    payload: JSON.stringify({
      type: "block_actions",
      user: {
        id: data.slackUserId,
        username: data.slackUserId.toLowerCase(),
        name: data.slackUserId.toLowerCase(),
      },
      team: { id: SLACK_TEAM_ID },
      trigger_id: TRIGGER_ID,
      view: {
        type: "home",
        callback_id: "",
        private_metadata: data.privateMetadata,
        state: { values: {} },
      },
      actions: [
        {
          type: "button",
          action_id: data.actionId,
          block_id: "home-buttons",
          value: "",
          action_ts: "1760000001.000300",
        },
      ],
    }),
  };
}

// What Slack posts for /oneuptime <text>.
function slashCommand(data: {
  slackUserId: string;
  text: string;
  channelId: string;
}): Record<string, string> {
  return {
    token: "verification-token",
    team_id: SLACK_TEAM_ID,
    team_domain: "avepoint",
    channel_id: data.channelId,
    channel_name:
      data.channelId === INCIDENT_CHANNEL_ID ? "irm-nonprd-inc-12" : "general",
    user_id: data.slackUserId,
    user_name: data.slackUserId.toLowerCase(),
    command: "/oneuptime",
    text: data.text,
    api_app_id: "A0IRM",
    response_url: COMMAND_RESPONSE_URL,
    trigger_id: TRIGGER_ID,
  };
}

describe("one Slack workspace connected to two OneUptime projects", () => {
  let app: RoutePort;
  let slackCalls: Array<SlackCall>;
  let timelines: Array<{
    data: IncidentStateTimeline;
    props: DatabaseCommonInteractionProps;
  }>;
  let updates: Array<{
    id: ObjectID;
    data: JSONObject;
    props: DatabaseCommonInteractionProps;
  }>;
  let notes: Array<{
    incidentId: ObjectID;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }>;
  let onCallReads: Array<{
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }>;
  let connections: Array<WorkspaceProjectAuthToken>;
  let links: Array<WorkspaceUserAuthToken>;
  let memberships: Array<Membership>;
  let channelPosts: Array<{ projectId: ObjectID; channelId: string }>;
  let incidentStateId: ObjectID;
  let isIncidentDeleted: boolean;
  let isIncidentPrivate: boolean;
  let incidentOwners: Array<ObjectID>;

  const savedPlanEnvironment: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SUBSCRIPTION_PLAN_")) {
        savedPlanEnvironment[key] = process.env[key];
        delete process.env[key];
      }
    }

    Object.assign(process.env, PLAN_ENVIRONMENT);

    app = await startSlackApp();
  }, 600000);

  afterAll(async () => {
    await app.close();

    for (const key of Object.keys(PLAN_ENVIRONMENT)) {
      delete process.env[key];
    }

    for (const [key, value] of Object.entries(savedPlanEnvironment)) {
      if (value !== undefined) {
        process.env[key] = value;
      }
    }
  });

  function connectionOf(projectId: ObjectID): WorkspaceProjectAuthToken {
    const connection: WorkspaceProjectAuthToken =
      new WorkspaceProjectAuthToken();
    connection.id = ObjectID.generate();
    connection.projectId = projectId;
    connection.workspaceType = WorkspaceType.Slack;
    connection.workspaceProjectId = SLACK_TEAM_ID;
    connection.authToken = `xoxb-${projectId.toString().substring(0, 8)}`;
    connection.miscData = {
      teamId: SLACK_TEAM_ID,
      teamName: "AvePoint",
      botUserId: BOT_USER_ID,
    } as never;
    return connection;
  }

  function linkOf(
    slackUserId: string,
    projectId: ObjectID,
  ): WorkspaceUserAuthToken {
    const link: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
    link.id = ObjectID.generate();
    link.projectId = projectId;
    link.userId = SLACK_USERS[slackUserId]!;
    link.workspaceType = WorkspaceType.Slack;
    link.workspaceUserId = slackUserId;
    link.authToken = "";
    return link;
  }

  function incidentRow(): Incident {
    const row: Incident = new Incident();
    row.id = INCIDENT_ID;
    row.projectId = NONPRD;
    row.title = "test private slack channel";
    row.incidentNumber = 12;
    row.incidentNumberWithPrefix = "INC-12";
    row.currentIncidentStateId = incidentStateId;
    row.customFields = {};
    row.monitors = [];
    row.isPrivate = isIncidentPrivate;
    row.createdAt = new Date("2026-10-19T06:00:00.000Z");
    return row;
  }

  // The member's role in a project, or nothing when they are not in it.
  function membershipOf(
    userId: ObjectID | undefined,
    projectId: ObjectID | undefined,
  ): Membership | undefined {
    return memberships.find((membership: Membership): boolean => {
      return (
        Boolean(userId && projectId) &&
        sameId(membership.userId, userId!) &&
        sameId(membership.projectId, projectId!)
      );
    });
  }

  // Whether `userId` sees INC-12 under its privacy: an owner, or not private.
  function seesPrivacy(userId: string | undefined): boolean {
    return (
      !isIncidentPrivate ||
      incidentOwners.some((owner: ObjectID): boolean => {
        return sameId(owner, userId || "");
      })
    );
  }

  beforeEach(() => {
    slackCalls = [];
    timelines = [];
    updates = [];
    notes = [];
    onCallReads = [];
    channelPosts = [
      { projectId: PLATFORM, channelId: PLATFORM_ALERTS_CHANNEL_ID },
    ];
    incidentStateId = CREATED;
    isIncidentDeleted = false;
    isIncidentPrivate = false;
    incidentOwners = [DEANE];
    connections = [connectionOf(PLATFORM), connectionOf(NONPRD)];
    links = [
      linkOf("U0DEANE", PLATFORM),
      linkOf("U0DEANE", NONPRD),
      linkOf("U0NITIN", NONPRD),
      linkOf("U0PRIYA", PLATFORM),
      linkOf("U0VIEWER", NONPRD),
      linkOf("U0LABELLED", NONPRD),
      linkOf("U0FORMER", NONPRD),
    ];
    memberships = [
      {
        userId: DEANE,
        projectId: PLATFORM,
        permissions: [Permission.ProjectMember],
      },
      {
        userId: DEANE,
        projectId: NONPRD,
        permissions: [Permission.ProjectMember],
      },
      {
        userId: NITIN,
        projectId: NONPRD,
        permissions: [Permission.ProjectMember],
      },
      {
        userId: PRIYA,
        projectId: PLATFORM,
        permissions: [Permission.ProjectMember],
      },
      {
        userId: VIEWER,
        projectId: NONPRD,
        permissions: [Permission.IncidentViewer],
      },
      {
        userId: LABELLED,
        projectId: NONPRD,
        permissions: [Permission.ProjectMember],
      },
    ];

    (
      jest.requireMock("../../../Server/Infrastructure/GlobalCache") as {
        default: { store: Map<string, unknown> };
      }
    ).default.store.clear();

    // The workspace's connections, in the order the database returns them.
    const findConnections: (
      query: JSONObject,
    ) => Array<WorkspaceProjectAuthToken> = (
      query: JSONObject,
    ): Array<WorkspaceProjectAuthToken> => {
      return connections.filter(
        (connection: WorkspaceProjectAuthToken): boolean => {
          return (
            (query["workspaceProjectId"] === undefined ||
              query["workspaceProjectId"] === connection.workspaceProjectId) &&
            (query["workspaceType"] === undefined ||
              query["workspaceType"] === connection.workspaceType) &&
            namesProject(query, connection.projectId!)
          );
        },
      );
    };

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
      .mockImplementation((async (findOneBy: { query: JSONObject }) => {
        return findConnections(findOneBy.query)[0] || null;
      }) as never);
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockImplementation((async (findBy: { query: JSONObject }) => {
        return findConnections(findBy.query);
      }) as never);

    // Who connected which Slack account, in which project.
    const findLinks: (query: JSONObject) => Array<WorkspaceUserAuthToken> = (
      query: JSONObject,
    ): Array<WorkspaceUserAuthToken> => {
      return links.filter((link: WorkspaceUserAuthToken): boolean => {
        const workspaceUserIds: Array<string> = idsOf(query["workspaceUserId"]);

        return (
          (workspaceUserIds.length === 0 ||
            workspaceUserIds.includes(link.workspaceUserId!.toLowerCase())) &&
          (query["workspaceType"] === undefined ||
            query["workspaceType"] === link.workspaceType) &&
          namesProject(query, link.projectId!) &&
          (query["userId"] === undefined ||
            sameId(query["userId"], link.userId!))
        );
      });
    };

    jest
      .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
      .mockImplementation((async (findOneBy: { query: JSONObject }) => {
        return findLinks(findOneBy.query)[0] || null;
      }) as never);
    jest
      .spyOn(WorkspaceUserAuthTokenService, "findBy")
      .mockImplementation((async (findBy: { query: JSONObject }) => {
        return findLinks(findBy.query);
      }) as never);

    // Membership, read from TeamMember as the authorization reads it.
    jest.spyOn(TeamMemberService, "findBy").mockImplementation((async (findBy: {
      query: JSONObject;
    }) => {
      const membership: Membership | undefined = membershipOf(
        findBy.query["userId"] as ObjectID,
        findBy.query["projectId"] as ObjectID,
      );

      if (!membership) {
        return [];
      }

      const member: TeamMember = new TeamMember();
      member.teamId = new ObjectID(
        `d1000000-0000-4000-8000-${membership.projectId
          .toString()
          .substring(24)}`,
      );
      return [member];
    }) as never);
    jest
      .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
      .mockResolvedValue(null);
    jest
      .spyOn(AccessTokenService, "getUserTenantAccessPermission")
      .mockImplementation((async (userId: ObjectID, projectId: ObjectID) => {
        const membership: Membership | undefined = membershipOf(
          userId,
          projectId,
        );

        return membership
          ? tenantPermission({
              projectId: projectId,
              permissions: membership.permissions,
            })
          : null;
      }) as never);
    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
    jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Growth,
      isSubscriptionUnpaid: false,
    });
    jest.spyOn(ProjectService, "findBy").mockImplementation((async (findBy: {
      query: JSONObject;
    }) => {
      return [PLATFORM, NONPRD]
        .filter((projectId: ObjectID): boolean => {
          return idsOf(findBy.query["_id"]).includes(
            projectId.toString().toLowerCase(),
          );
        })
        .map((projectId: ObjectID): Project => {
          const project: Project = new Project();
          project.id = projectId;
          project.name = PROJECT_NAMES[projectId.toString()]!;
          return project;
        });
    }) as never);

    // INC-12, in the non-production project, and its own channel.
    const findIncident: (findOneBy: {
      query: JSONObject;
      props: DatabaseCommonInteractionProps;
    }) => Incident | null = (findOneBy: {
      query: JSONObject;
      props: DatabaseCommonInteractionProps;
    }): Incident | null => {
      const query: JSONObject = findOneBy.query;

      if (isIncidentDeleted || !namesProject(query, NONPRD)) {
        return null;
      }

      if (
        query["_id"] !== undefined &&
        !idsOf(query["_id"]).includes(INCIDENT_ID.toString())
      ) {
        return null;
      }

      if (
        query["postUpdatesToWorkspaceChannels"] !== undefined &&
        !JSON.stringify(
          idsOf(query["postUpdatesToWorkspaceChannels"]),
        ).includes(INCIDENT_CHANNEL_ID.toLowerCase())
      ) {
        return null;
      }

      if (
        query["incidentNumber"] !== undefined &&
        Number(query["incidentNumber"]) !== 12
      ) {
        return null;
      }

      // OneUptime's own read under a member's rule for private incidents.
      if (
        query["isPrivate"] !== undefined &&
        !seesPrivacy(idsOf(query["isPrivate"])[0])
      ) {
        return null;
      }

      if (!findOneBy.props.isRoot) {
        const userId: string = findOneBy.props.userId?.toString() || "";

        if (
          !membershipOf(findOneBy.props.userId, NONPRD) ||
          sameId(userId, LABELLED) ||
          !seesPrivacy(userId)
        ) {
          return null;
        }
      }

      return incidentRow();
    };

    jest
      .spyOn(IncidentService, "findOneBy")
      .mockImplementation((async (findOneBy: {
        query: JSONObject;
        props: DatabaseCommonInteractionProps;
      }) => {
        return findIncident(findOneBy);
      }) as never);
    jest.spyOn(IncidentService, "findBy").mockImplementation((async (findBy: {
      query: JSONObject;
      props: DatabaseCommonInteractionProps;
    }) => {
      const incident: Incident | null = findIncident(findBy);
      return incident ? [incident] : [];
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

    // Records of the other kinds: none.
    for (const service of [
      AlertService,
      IncidentEpisodeService,
      AlertEpisodeService,
      ScheduledMaintenanceService,
      MonitorService,
      OnCallDutyPolicyService,
    ] as Array<{
      findOneBy: (...args: Array<unknown>) => Promise<unknown>;
      findBy: (...args: Array<unknown>) => Promise<unknown>;
    }>) {
      jest.spyOn(service, "findOneBy").mockResolvedValue(null as never);
      jest.spyOn(service, "findBy").mockResolvedValue([] as never);
    }

    // Which projects post to which channels.
    jest
      .spyOn(WorkspaceNotificationLogService, "findOneBy")
      .mockImplementation((async (findOneBy: { query: JSONObject }) => {
        const posted: boolean = channelPosts.some(
          (post: { projectId: ObjectID; channelId: string }): boolean => {
            return (
              namesProject(findOneBy.query, post.projectId) &&
              findOneBy.query["channelId"] === post.channelId
            );
          },
        );

        if (!posted) {
          return null;
        }

        const log: WorkspaceNotificationLog = new WorkspaceNotificationLog();
        log.id = ObjectID.generate();
        return log;
      }) as never);
    jest.spyOn(WorkspaceNotificationLogService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(WorkspaceNotificationLogService, "logButtonPressed")
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(IncidentStateService, "getAllIncidentStates")
      .mockImplementation((async () => {
        return [
          stateOf(CREATED, 1),
          stateOf(ACKNOWLEDGED, 2),
          stateOf(RESOLVED, 3),
        ];
      }) as never);
    jest
      .spyOn(IncidentStateTimelineService, "create")
      .mockImplementation((async (create: {
        data: IncidentStateTimeline;
        props: DatabaseCommonInteractionProps;
      }) => {
        timelines.push({ data: create.data, props: create.props });
        incidentStateId = create.data.incidentStateId!;
        return create.data;
      }) as never);
    jest
      .spyOn(IncidentInternalNoteService, "addNote")
      .mockImplementation((async (addNote: {
        incidentId: ObjectID;
        projectId: ObjectID;
        props: DatabaseCommonInteractionProps;
      }) => {
        notes.push(addNote);
        return undefined;
      }) as never);

    // One custom field, as the Custom Fields card defines it.
    jest
      .spyOn(IncidentCustomFieldService, "findBy")
      .mockImplementation((async () => {
        const field: IncidentCustomField = new IncidentCustomField();
        field.id = TICKET_FIELD;
        field.name = "Ticket";
        field.customFieldType = CustomFieldType.Text;
        field.sortOrder = 1;
        return [field];
      }) as never);

    // Who is on call, read as the member: which project they were read in.
    jest
      .spyOn(WorkspaceOnCallNow, "getOnCallNowAnswer")
      .mockImplementation(
        async (data: {
          projectId: ObjectID;
          props: DatabaseCommonInteractionProps;
        }) => {
          onCallReads.push(data);
          return {
            markdown: `On call in ${PROJECT_NAMES[data.projectId.toString()]}`,
            text: `On call in ${PROJECT_NAMES[data.projectId.toString()]}`,
          };
        },
      );

    jest.spyOn(UserService, "findOneBy").mockImplementation((async (findOneBy: {
      query: { _id: ObjectID };
    }) => {
      return userOf(new ObjectID(findOneBy.query._id.toString()));
    }) as never);
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString(DASHBOARD_URL));
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("OneUptime");

    // Slack: every request is recorded, and answered as Slack would.
    jest.spyOn(API, "post").mockImplementation((async (options: {
      url: URL;
      data: JSONObject;
    }) => {
      slackCalls.push({ url: options.url.toString(), data: options.data });
      return new HTTPResponse<JSONObject>(200, { ok: true }, {});
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setTestBillingEnabled(false);
  });

  // Waits for the work after Slack's answer: `count` requests to Slack.
  async function slackCallsAfter(
    count: number,
    attempts: number = 300,
  ): Promise<Array<SlackCall>> {
    for (let wait: number = 0; wait < attempts; wait++) {
      if (slackCalls.length >= count) {
        break;
      }

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 10);
      });
    }

    return slackCalls;
  }

  // Long enough for a request to Slack to have gone out, were one sent.
  async function settle(): Promise<void> {
    await slackCallsAfter(Number.MAX_SAFE_INTEGER, 40);
  }

  // What the person was answered, only to them, at the press's response URL.
  function answers(): Array<string> {
    return slackCalls
      .filter((call: SlackCall): boolean => {
        return (
          call.url === PRESS_RESPONSE_URL || call.url === COMMAND_RESPONSE_URL
        );
      })
      .map((call: SlackCall): string => {
        return String(call.data["text"] || "")
          .split(ZERO_WIDTH_SPACE)
          .join("");
      });
  }

  // The blocks of what they were answered, as JSON: links included.
  function answerBlocks(): string {
    return JSON.stringify(
      slackCalls
        .filter((call: SlackCall): boolean => {
          return (
            call.url === PRESS_RESPONSE_URL || call.url === COMMAND_RESPONSE_URL
          );
        })
        .map((call: SlackCall): unknown => {
          return call.data["blocks"];
        }),
    );
  }

  // The form views.open was sent, once.
  function openedForm(): JSONObject {
    const opened: Array<SlackCall> = slackCalls.filter(
      (call: SlackCall): boolean => {
        return call.url === "https://slack.com/api/views.open";
      },
    );

    expect(opened).toHaveLength(1);
    return opened[0]!.data["view"] as JSONObject;
  }

  function press(fields: Record<string, string>): Promise<number> {
    return postForm({
      port: app.port,
      path: "/api/slack/interactive",
      fields: fields,
    });
  }

  function command(fields: Record<string, string>): Promise<number> {
    return postForm({
      port: app.port,
      path: "/api/slack/command",
      fields: fields,
    });
  }

  // Posts an event as Slack does: JSON, to the Events API endpoint.
  function deliverEvent(payload: JSONObject): Promise<number> {
    const body: string = JSON.stringify(payload);

    return new Promise<number>(
      (resolve: (status: number) => void, reject: (error: Error) => void) => {
        const request: http.ClientRequest = http.request(
          {
            host: "127.0.0.1",
            port: app.port,
            path: "/api/slack/events",
            method: "POST",
            headers: {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
            },
          },
          (response: http.IncomingMessage) => {
            response.resume();
            response.on("end", () => {
              resolve(response.statusCode || 0);
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

  // Somebody writes to the app in its direct messages.
  function directMessage(data: {
    slackUserId: string;
    text: string;
    ts: string;
    threadTs?: string | undefined;
  }): Promise<number> {
    const event: JSONObject = {
      type: "message",
      channel_type: "im",
      user: data.slackUserId,
      text: data.text,
      ts: data.ts,
      channel: DM_CHANNEL_ID,
      team: SLACK_TEAM_ID,
      event_ts: data.ts,
    };

    if (data.threadTs) {
      event["thread_ts"] = data.threadTs;
    }

    return deliverEvent({
      token: "verification-token",
      team_id: SLACK_TEAM_ID,
      api_app_id: "A0IRM",
      type: "event_callback",
      event_id: `Ev${data.ts.split(".").join("")}`,
      event_time: 1760000000,
      event: event,
    });
  }

  interface OfferedButton {
    title: string;
    actionId: string;
    value: string;
  }

  /*
   * The buttons of the last question of which project a request is for, as
   * Slack was sent them: in a message's blocks, or a modal's.
   */
  function offeredButtons(): Array<OfferedButton> {
    for (const call of [...slackCalls].reverse()) {
      const blocks: unknown =
        call.data["blocks"] ||
        (call.data["view"] as JSONObject | undefined)?.["blocks"];

      if (!Array.isArray(blocks)) {
        continue;
      }

      const buttons: Array<JSONObject> = (blocks as Array<JSONObject>)
        .filter((block: JSONObject): boolean => {
          return block["type"] === "actions";
        })
        .flatMap((block: JSONObject): Array<JSONObject> => {
          return block["elements"] as Array<JSONObject>;
        })
        .filter((element: JSONObject): boolean => {
          return String(element["action_id"] || "").startsWith("ChooseProject");
        });

      if (buttons.length > 0) {
        return buttons.map((button: JSONObject): OfferedButton => {
          return {
            title: String((button["text"] as JSONObject)["text"]),
            actionId: String(button["action_id"]),
            value: String(button["value"]),
          };
        });
      }
    }

    return [];
  }

  function offeredButton(title: string): OfferedButton {
    const button: OfferedButton | undefined = offeredButtons().find(
      (candidate: OfferedButton): boolean => {
        return candidate.title === title;
      },
    );

    expect(button).toBeDefined();
    return button!;
  }

  /*
   * What Slack posts when one of them is pressed: on the message only the
   * person sees, in the channel they asked in, with its response_url - or
   * in the modal a shortcut's project is asked in, with the view and no
   * response_url.
   */
  function choicePress(data: {
    slackUserId: string;
    button: OfferedButton;
    channelId?: string | undefined;
    isInModal?: boolean | undefined;
  }): Record<string, string> {
    const payload: JSONObject = {
      type: "block_actions",
      user: {
        id: data.slackUserId,
        username: data.slackUserId.toLowerCase(),
        name: data.slackUserId.toLowerCase(),
        team_id: SLACK_TEAM_ID,
      },
      api_app_id: "A0IRM",
      team: { id: SLACK_TEAM_ID, domain: "avepoint" },
      trigger_id: CHOICE_TRIGGER_ID,
      actions: [
        {
          type: "button",
          action_id: data.button.actionId,
          block_id: "choose-project",
          text: { type: "plain_text", text: data.button.title, emoji: true },
          value: data.button.value,
          action_ts: "1760000002.000300",
        },
      ],
    };

    if (data.isInModal) {
      payload["container"] = { type: "view", view_id: CHOICE_VIEW_ID };
      payload["view"] = {
        id: CHOICE_VIEW_ID,
        type: "modal",
        callback_id: "",
        private_metadata: "",
        state: { values: {} },
      };
    } else {
      const channelId: string = data.channelId || GENERAL_CHANNEL_ID;

      payload["channel"] = { id: channelId, name: "general" };
      payload["container"] = {
        type: "message",
        channel_id: channelId,
        message_ts: "1760000002.000100",
        is_ephemeral: channelId !== DM_CHANNEL_ID,
      };
      payload["response_url"] = CHOICE_RESPONSE_URL;
    }

    return { payload: JSON.stringify(payload) };
  }

  // What the question of which project became, at its press's response_url.
  function replacements(): Array<JSONObject> {
    return slackCalls
      .filter((call: SlackCall): boolean => {
        return call.url === CHOICE_RESPONSE_URL;
      })
      .map((call: SlackCall): JSONObject => {
        return call.data;
      });
  }

  // What was sent to a method of Slack's Web API, in order.
  function sentTo(method: string): Array<JSONObject> {
    return slackCalls
      .filter((call: SlackCall): boolean => {
        return call.url === `https://slack.com/api/${method}`;
      })
      .map((call: SlackCall): JSONObject => {
        return call.data;
      });
  }

  // The question of which project, as its notification reads.
  const WHICH_PROJECT: string =
    "Which project is this for: IRM Platform or IRM Non-Prod? This Slack workspace is connected to more than one OneUptime project.";

  describe("the incident's channel, as the customer pressed in it", () => {
    test("Acknowledge acknowledges INC-12 in its own project, as Deane", async () => {
      expect(
        await press(
          buttonPress({
            slackUserId: "U0DEANE",
            actionId: "AcknowledgeIncident",
            value: INCIDENT_ID.toString(),
          }),
        ),
      ).toBe(200);

      await settle();

      expect(answers()).toEqual([]);
      expect(timelines).toHaveLength(1);
      expect(timelines[0]!.data.incidentId!.toString()).toBe(
        INCIDENT_ID.toString(),
      );
      expect(timelines[0]!.data.projectId!.toString()).toBe(NONPRD.toString());
      expect(timelines[0]!.data.incidentStateId!.toString()).toBe(
        ACKNOWLEDGED.toString(),
      );
      expect(timelines[0]!.props.userId!.toString()).toBe(DEANE.toString());
      expect(timelines[0]!.props.tenantId!.toString()).toBe(NONPRD.toString());
    });

    test("Resolve resolves INC-12 in its own project, as Deane", async () => {
      incidentStateId = ACKNOWLEDGED;

      await press(
        buttonPress({
          slackUserId: "U0DEANE",
          actionId: "ResolveIncident",
          value: INCIDENT_ID.toString(),
        }),
      );

      await settle();

      expect(answers()).toEqual([]);
      expect(timelines).toHaveLength(1);
      expect(timelines[0]!.data.incidentStateId!.toString()).toBe(
        RESOLVED.toString(),
      );
      expect(timelines[0]!.props.tenantId!.toString()).toBe(NONPRD.toString());
    });

    test("whichever connection comes first, the press acts in its record's project", async () => {
      connections = [connectionOf(NONPRD), connectionOf(PLATFORM)];

      await press(
        buttonPress({
          slackUserId: "U0DEANE",
          actionId: "AcknowledgeIncident",
          value: INCIDENT_ID.toString(),
        }),
      );

      await settle();

      expect(answers()).toEqual([]);
      expect(timelines[0]!.props.tenantId!.toString()).toBe(NONPRD.toString());
    });

    test("Edit Custom Fields opens INC-12's form, which carries its project", async () => {
      await press(
        menuChoice({
          slackUserId: "U0DEANE",
          value: `ViewEditIncidentCustomFields:${INCIDENT_ID.toString()}`,
        }),
      );

      await slackCallsAfter(1);
      await settle();

      expect(answers()).toEqual([]);

      const view: JSONObject = openedForm();
      expect(JSON.stringify(view)).toContain("Ticket");
      expect(JSON.parse(view["private_metadata"] as string)).toEqual({
        oneuptime: 1,
        value: INCIDENT_ID.toString(),
        channelId: INCIDENT_CHANNEL_ID,
        projectId: NONPRD.toString(),
      });
    });

    test("Edit Custom Fields, submitted: saved on INC-12, in its project, as Deane", async () => {
      await press(
        formSubmission({
          slackUserId: "U0DEANE",
          callbackId: "SubmitEditIncidentCustomFields",
          privateMetadata: JSON.stringify({
            oneuptime: 1,
            value: INCIDENT_ID.toString(),
            channelId: INCIDENT_CHANNEL_ID,
            projectId: NONPRD.toString(),
          }),
          state: {
            [WorkspaceIncidentCustomFields.getInputId(TICKET_FIELD)]: {
              type: "plain_text_input",
              value: "OPS-2",
            },
          },
        }),
      );

      await settle();

      expect(answers()).toEqual([]);
      expect(updates).toHaveLength(1);
      expect(updates[0]!.id.toString()).toBe(INCIDENT_ID.toString());
      expect(updates[0]!.data["customFields"]).toEqual({ Ticket: "OPS-2" });
      expect(updates[0]!.props.userId!.toString()).toBe(DEANE.toString());
      expect(updates[0]!.props.tenantId!.toString()).toBe(NONPRD.toString());
    });

    test("a form opened before forms carried their project is read by its record: a note saved on INC-12", async () => {
      await press(
        formSubmission({
          slackUserId: "U0DEANE",
          callbackId: "SubmitIncidentNote",
          // The bare value forms carried: the incident's id, nothing else.
          privateMetadata: INCIDENT_ID.toString(),
          state: {
            noteType: {
              type: "static_select",
              selected_option: {
                value: WorkspaceNoteFormType.Private,
                text: { text: "Private" },
              },
            },
            note: { type: "plain_text_input", value: "Rolled back." },
          },
        }),
      );

      await settle();

      expect(notes).toHaveLength(1);
      expect(notes[0]!.incidentId.toString()).toBe(INCIDENT_ID.toString());
      expect(notes[0]!.projectId.toString()).toBe(NONPRD.toString());
      expect(notes[0]!.props.tenantId!.toString()).toBe(NONPRD.toString());
      expect(notes[0]!.props.userId!.toString()).toBe(DEANE.toString());
    });

    test("/oneuptime page from the incident's channel is read in its project, where Nitin is connected: the form opens there", async () => {
      jest.spyOn(WorkspacePage, "getChoices").mockResolvedValue([
        {
          kind: WorkspacePageTargetKind.Person,
          label: "People",
          choices: [
            {
              label: "Deane Looi",
              name: "Deane Looi",
              value: `${WorkspacePageTargetKind.Person}:${DEANE.toString()}`,
            },
          ],
        },
      ]);

      await command(
        slashCommand({
          slackUserId: "U0NITIN",
          text: "page",
          channelId: INCIDENT_CHANNEL_ID,
        }),
      );

      await slackCallsAfter(1);
      await settle();

      for (const answer of answers()) {
        expect(answer).not.toContain("Connect your Slack account");
      }

      const view: JSONObject = openedForm();
      expect(
        (JSON.parse(view["private_metadata"] as string) as JSONObject)[
          "projectId"
        ],
      ).toBe(NONPRD.toString());
    });

    test("/oneuptime oncall from the incident's channel answers for INC-12's project, for Deane who is in both", async () => {
      await command(
        slashCommand({
          slackUserId: "U0DEANE",
          text: "oncall",
          channelId: INCIDENT_CHANNEL_ID,
        }),
      );

      await slackCallsAfter(1);
      await settle();

      expect(onCallReads).toHaveLength(1);
      expect(onCallReads[0]!.projectId.toString()).toBe(NONPRD.toString());
      expect(answers()).toEqual(["On call in IRM Non-Prod"]);
    });
  });

  describe("who presses: refused only for what is actually wrong, and told what", () => {
    test("Priya, connected only in the other project, is asked to connect in INC-12's project, named - and nothing is written", async () => {
      await press(
        buttonPress({
          slackUserId: "U0PRIYA",
          actionId: "AcknowledgeIncident",
          value: INCIDENT_ID.toString(),
        }),
      );

      await slackCallsAfter(1);
      await settle();

      expect(timelines).toEqual([]);
      /*
       * Her account is connected - in the platform project: the prompt says
       * which project it asks her to connect it in, so she sees why.
       */
      expect(answers()).toEqual([
        expect.stringContaining(
          "Connect your Slack account in IRM Non-Prod to acknowledge this incident",
        ),
      ]);
      expect(answerBlocks()).toContain(
        "Connect your Slack account in IRM Non-Prod to acknowledge this incident.",
      );
      // The Connect button connects her account in INC-12's project.
      expect(answerBlocks()).toContain(
        `${DASHBOARD_URL}/${NONPRD.toString()}/`,
      );
      expect(answerBlocks()).not.toContain(
        `${DASHBOARD_URL}/${PLATFORM.toString()}/`,
      );
    });

    test("a member who may only read incidents is still refused, with the permission they lack - nothing is written", async () => {
      await press(
        buttonPress({
          slackUserId: "U0VIEWER",
          actionId: "AcknowledgeIncident",
          value: INCIDENT_ID.toString(),
        }),
      );

      await slackCallsAfter(1);
      await settle();

      expect(timelines).toEqual([]);
      expect(answers()).toEqual([
        expect.stringContaining(
          "You do not have permission to acknowledge this incident. You do not have permissions to create Incident State Timeline.",
        ),
      ]);
      expect(answers()[0]).not.toContain("not found");
    });

    test("a member whose access does not include INC-12 is told so - never that it is not there - and nothing is written", async () => {
      await press(
        buttonPress({
          slackUserId: "U0LABELLED",
          actionId: "ResolveIncident",
          value: INCIDENT_ID.toString(),
        }),
      );

      await slackCallsAfter(1);
      await settle();

      expect(timelines).toEqual([]);
      expect(answers()).toEqual([
        "You do not have permission to resolve this incident: your access in this project does not include this incident. Ask a project admin for access to it.",
      ]);
    });

    test("a private INC-12 is acted on by its owner - Deane - and refused to a member who is not one, with who can add them", async () => {
      isIncidentPrivate = true;

      await press(
        buttonPress({
          slackUserId: "U0DEANE",
          actionId: "AcknowledgeIncident",
          value: INCIDENT_ID.toString(),
        }),
      );

      await settle();

      expect(answers()).toEqual([]);
      expect(timelines).toHaveLength(1);

      slackCalls = [];

      await press(
        buttonPress({
          slackUserId: "U0NITIN",
          actionId: "ResolveIncident",
          value: INCIDENT_ID.toString(),
        }),
      );

      await slackCallsAfter(1);
      await settle();

      expect(timelines).toHaveLength(1);
      expect(answers()).toEqual([
        "You do not have permission to resolve this incident: this incident is private, so only its owners and the project's owners and admins can see it. Ask one of them to add you as an owner.",
      ]);
    });

    test("somebody removed from INC-12's project is told they are not a member - not that it is not there", async () => {
      await press(
        buttonPress({
          slackUserId: "U0FORMER",
          actionId: "AcknowledgeIncident",
          value: INCIDENT_ID.toString(),
        }),
      );

      await slackCallsAfter(1);
      await settle();

      expect(timelines).toEqual([]);
      expect(answers()).toEqual([
        WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
      ]);
    });

    test("an incident deleted since its message was posted is not found - it may have been deleted", async () => {
      isIncidentDeleted = true;

      await press(
        buttonPress({
          slackUserId: "U0NITIN",
          actionId: "AcknowledgeIncident",
          value: INCIDENT_ID.toString(),
        }),
      );

      await slackCallsAfter(1);
      await settle();

      expect(timelines).toEqual([]);
      expect(answers()).toEqual([
        "Could not acknowledge this incident: the incident was not found. It may have been deleted.",
      ]);
    });
  });

  describe("commands and Home, where no record names the project", () => {
    test("Nitin, in one of the projects, runs /oneuptime oncall in #general: answered for his project", async () => {
      await command(
        slashCommand({
          slackUserId: "U0NITIN",
          text: "oncall",
          channelId: GENERAL_CHANNEL_ID,
        }),
      );

      await slackCallsAfter(1);
      await settle();

      expect(onCallReads).toHaveLength(1);
      expect(onCallReads[0]!.projectId.toString()).toBe(NONPRD.toString());
      expect(onCallReads[0]!.props.userId!.toString()).toBe(NITIN.toString());
    });

    test("in a channel only one project posts to: that project, for Deane who is in both", async () => {
      await command(
        slashCommand({
          slackUserId: "U0DEANE",
          text: "oncall",
          channelId: PLATFORM_ALERTS_CHANNEL_ID,
        }),
      );

      await slackCallsAfter(1);
      await settle();

      expect(onCallReads).toHaveLength(1);
      expect(onCallReads[0]!.projectId.toString()).toBe(PLATFORM.toString());
    });

    test("Deane, in both, runs /oneuptime oncall in #general: asked which project, with a button for each he is in - nothing is read in either yet", async () => {
      await command(
        slashCommand({
          slackUserId: "U0DEANE",
          text: "oncall",
          channelId: GENERAL_CHANNEL_ID,
        }),
      );

      await slackCallsAfter(1);
      await settle();

      expect(onCallReads).toEqual([]);
      expect(answers()).toEqual([WHICH_PROJECT]);
      expect(answerBlocks().split(ZERO_WIDTH_SPACE).join("")).toContain(
        "*Which project is this for?* This Slack workspace is connected to more than one OneUptime project, and OneUptime can't tell which one you mean here.",
      );
      expect(
        offeredButtons().map((button: OfferedButton): string => {
          return button.title;
        }),
      ).toEqual(["IRM Platform", "IRM Non-Prod"]);
      expect(
        offeredButtons().map((button: OfferedButton): string => {
          return button.actionId;
        }),
      ).toEqual(["ChooseProject:0", "ChooseProject:1"]);
    });

    test("somebody connected in neither runs /oneuptime page: told where to connect, not which project", async () => {
      await command(
        slashCommand({
          slackUserId: "U0NOBODY",
          text: "page",
          channelId: GENERAL_CHANNEL_ID,
        }),
      );

      await slackCallsAfter(1);
      await settle();

      expect(answers()).toEqual([
        "This Slack workspace is connected to more than one OneUptime project, and your Slack account isn't connected in any of them yet. In OneUptime, open the project you use and connect your account under User Settings → Workspace → Slack, then try again.",
      ]);
      // No Connect button for a project they may not be in.
      expect(answerBlocks()).not.toContain(DASHBOARD_URL);
    });

    test("a link - Set up notifications - reads and writes nothing, and is not answered, wherever it is pressed", async () => {
      expect(
        await press(
          buttonPress({
            slackUserId: "U0DEANE",
            actionId: "OpenInOneUptime",
            value: "",
            channelId: GENERAL_CHANNEL_ID,
          }),
        ),
      ).toBe(200);

      await settle();

      expect(answers()).toEqual([]);
      expect(slackCalls).toEqual([]);
    });

    test("a button of the Home tab acts in the project the Home shows - for Deane, who is in both", async () => {
      await press(
        homePress({
          slackUserId: "U0DEANE",
          actionId: "ShowOnCall",
          privateMetadata: JSON.stringify({
            oneuptime: 1,
            value: "",
            projectId: PLATFORM.toString(),
          }),
        }),
      );

      await slackCallsAfter(1);
      await settle();

      expect(onCallReads).toHaveLength(1);
      expect(onCallReads[0]!.projectId.toString()).toBe(PLATFORM.toString());
    });
  });

  /*
   * Where somebody is told to make a request again, it has to be somewhere
   * it can be told apart: a question is asked again in a project's channel,
   * and a shortcut from Slack's shortcuts menu - which never says where it
   * was used, so trying it again anywhere is ambiguous again - is pointed to
   * the command that does the same.
   */
  describe("how somebody in several projects is told to try again", () => {
    // Slack's shortcuts menu: Create New Incident (the app's manifest).
    function globalShortcut(slackUserId: string): Record<string, string> {
      return {
        payload: JSON.stringify({
          type: "shortcut",
          token: "verification-token",
          action_ts: "1760000001.000300",
          team: { id: SLACK_TEAM_ID, domain: "avepoint" },
          user: {
            id: slackUserId,
            username: slackUserId.toLowerCase(),
            team_id: SLACK_TEAM_ID,
          },
          is_enterprise_install: false,
          callback_id: "/incident",
          trigger_id: TRIGGER_ID,
        }),
      };
    }

    // What views.open was sent: a shortcut has no channel to answer in.
    function openedViews(): string {
      return JSON.stringify(
        slackCalls
          .filter((call: SlackCall): boolean => {
            return call.url === "https://slack.com/api/views.open";
          })
          .map((call: SlackCall): unknown => {
            return call.data["view"];
          }),
      )
        .split(ZERO_WIDTH_SPACE)
        .join("");
    }

    test("Deane uses the shortcut Create New Incident: asked which project, in a modal where he is - no form opens yet", async () => {
      await press(globalShortcut("U0DEANE"));

      await slackCallsAfter(1);
      await settle();

      const views: string = openedViews();

      expect(views).toContain("*Which project is this for?*");
      expect(
        offeredButtons().map((button: OfferedButton): string => {
          return button.title;
        }),
      ).toEqual(["IRM Platform", "IRM Non-Prod"]);
      expect(views).not.toContain("try it again");
      // The question, not the New Incident form.
      expect(views).not.toContain("SubmitNewIncident");
    });

    test("when the question cannot be asked - the projects cannot be named - a shortcut is still pointed to /oneuptime incident", async () => {
      jest
        .spyOn(ProjectService, "findBy")
        .mockRejectedValue(new Error("connection refused"));

      await press(globalShortcut("U0DEANE"));

      await slackCallsAfter(1);
      await settle();

      expect(offeredButtons()).toEqual([]);
      expect(openedViews()).toContain(
        "/oneuptime incident* in a channel of the project you mean instead.",
      );
    });

    test("somebody connected in neither uses the shortcut: where to connect", async () => {
      await press(globalShortcut("U0NOBODY"));

      await slackCallsAfter(1);
      await settle();

      expect(openedViews()).toContain(
        "your Slack account isn't connected in any of them yet",
      );
    });

    test("Deane asks OneUptime AI in #general (/oneuptime ask): asked which project, with a button for each - nothing is read in either yet", async () => {
      const asked: ReturnType<typeof jest.spyOn> = jest.spyOn(
        ObservabilityAssistant,
        "answerQuestion",
      );

      await command(
        slashCommand({
          slackUserId: "U0DEANE",
          text: "ask which monitors are down?",
          channelId: GENERAL_CHANNEL_ID,
        }),
      );

      await slackCallsAfter(1);
      await settle();

      expect(answers()).toEqual([WHICH_PROJECT]);
      expect(
        offeredButtons().map((button: OfferedButton): string => {
          return button.title;
        }),
      ).toEqual(["IRM Platform", "IRM Non-Prod"]);
      expect(asked).not.toHaveBeenCalled();
    });

    test("when the question cannot be asked - the cache is down - a question is told to ask again in a channel of the project he means", async () => {
      // The in-memory cache's own setString, put back once this request is made.
      const cache: {
        setString: {
          getMockImplementation: () => unknown;
          mockImplementation: (implementation: never) => unknown;
        };
      } = (
        jest.requireMock("../../../Server/Infrastructure/GlobalCache") as {
          default: {
            setString: {
              getMockImplementation: () => unknown;
              mockImplementation: (implementation: never) => unknown;
            };
          };
        }
      ).default;
      const realSetString: (...args: Array<unknown>) => Promise<unknown> =
        cache.setString.getMockImplementation() as (
          ...args: Array<unknown>
        ) => Promise<unknown>;

      cache.setString.mockImplementation((async (
        namespace: string,
        ...rest: Array<unknown>
      ) => {
        if (namespace === "slack-project-choice") {
          throw new Error("connection refused");
        }

        return await realSetString(namespace, ...rest);
      }) as never);

      try {
        await command(
          slashCommand({
            slackUserId: "U0DEANE",
            text: "ask which monitors are down?",
            channelId: GENERAL_CHANNEL_ID,
          }),
        );

        await slackCallsAfter(1);
        await settle();
      } finally {
        cache.setString.mockImplementation(realSetString as never);
      }

      expect(offeredButtons()).toEqual([]);
      expect(answers()).toHaveLength(1);
      expect(answers()[0]).toContain(
        "ask again in a channel of the project you mean, such as one of its incident channels.",
      );
      expect(answers()[0]).toContain("IRM Platform");
      expect(answers()[0]).toContain("IRM Non-Prod");
    });

    test("Nitin, a member of both but connected only in the platform project, presses Acknowledge on INC-12: asked to connect in IRM Non-Prod, named", async () => {
      links = links.filter((link: WorkspaceUserAuthToken): boolean => {
        return link.workspaceUserId !== "U0NITIN";
      });
      links.push(linkOf("U0NITIN", PLATFORM));
      memberships.push({
        userId: NITIN,
        projectId: PLATFORM,
        permissions: [Permission.ProjectMember],
      });

      await press(
        buttonPress({
          slackUserId: "U0NITIN",
          actionId: "AcknowledgeIncident",
          value: INCIDENT_ID.toString(),
        }),
      );

      await slackCallsAfter(1);
      await settle();

      expect(timelines).toEqual([]);
      expect(answers()).toEqual([
        expect.stringContaining(
          "Connect your Slack account in IRM Non-Prod to acknowledge this incident",
        ),
      ]);
    });

    test("a workspace connected to one project names no project in its Connect prompt", async () => {
      connections = [connectionOf(NONPRD)];
      links = links.filter((link: WorkspaceUserAuthToken): boolean => {
        return link.workspaceUserId !== "U0NITIN";
      });

      await press(
        buttonPress({
          slackUserId: "U0NITIN",
          actionId: "AcknowledgeIncident",
          value: INCIDENT_ID.toString(),
        }),
      );

      await slackCallsAfter(1);
      await settle();

      expect(answers()).toEqual([
        expect.stringContaining(
          "Connect your Slack account to acknowledge this incident",
        ),
      ]);
      expect(answers()[0]).not.toContain("IRM Non-Prod");
    });
  });

  /*
   * ASKED WHICH PROJECT, WITH A BUTTON FOR EACH, AND MADE AGAIN THERE.
   *
   * Deane is in both projects. A command he runs in #general, a shortcut
   * from Slack's menu, a question in the app's direct messages name no
   * record, and no channel tells: he used to be told to try again from a
   * channel of the project he meant - which a direct message or a shortcut
   * does not have. Now he is asked which, and the request is made again in
   * the project he chooses, as him, held to his permissions there.
   */
  describe("asked which project, with a button for each, and made again in the one chosen", () => {
    let assistantCalls: Array<{
      projectId: string;
      userId: string;
      question: string;
    }>;
    let readable: Array<{ projectId: string; userId: string }>;

    beforeEach(() => {
      assistantCalls = [];
      readable = [];

      jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(true);
      jest
        .spyOn(AIService, "getReachedProjectDailyLimit")
        .mockResolvedValue(null);
      jest.spyOn(AIService, "getAiBalanceBlocker").mockResolvedValue(null);
      jest
        .spyOn(ObservabilityAssistant, "answerQuestion")
        .mockImplementation((async (data: {
          projectId: ObjectID;
          userId: ObjectID;
          question: string;
        }) => {
          assistantCalls.push({
            projectId: data.projectId.toString(),
            userId: data.userId.toString(),
            question: data.question,
          });

          return {
            contentInMarkdown: `Nothing is down in ${PROJECT_NAMES[data.projectId.toString()]}.`,
            citations: [],
            totalTokens: 10,
            llmCallCount: 1,
            toolCallCount: 1,
          };
        }) as never);

      // What a form offers, read as the member, in the project it is drawn for.
      jest
        .spyOn(WorkspaceActionAuthorization, "findReadable")
        .mockImplementation((async (data: {
          query: JSONObject;
          props: DatabaseCommonInteractionProps;
        }) => {
          readable.push({
            projectId: String(data.query["projectId"]),
            userId: data.props.userId?.toString() || "",
          });
          return [];
        }) as never);
    });

    // Deane runs `/oneuptime <text>` in #general, and is asked which project.
    async function deaneRuns(text: string): Promise<void> {
      await command(
        slashCommand({
          slackUserId: "U0DEANE",
          text: text,
          channelId: GENERAL_CHANNEL_ID,
        }),
      );

      await slackCallsAfter(1);
      await settle();

      expect(offeredButtons()).toHaveLength(2);
    }

    // What happened once the question was asked.
    function afterTheQuestion(): void {
      slackCalls = [];
    }

    test("Deane chooses IRM Non-Prod: who is on call there, read as him, where he ran the command - and the question says so", async () => {
      await deaneRuns("oncall");

      const nonProd: OfferedButton = offeredButton("IRM Non-Prod");
      afterTheQuestion();

      expect(
        await press(choicePress({ slackUserId: "U0DEANE", button: nonProd })),
      ).toBe(200);

      await slackCallsAfter(2);
      await settle();

      expect(onCallReads).toHaveLength(1);
      expect(onCallReads[0]!.projectId.toString()).toBe(NONPRD.toString());
      expect(onCallReads[0]!.props.userId!.toString()).toBe(DEANE.toString());
      expect(onCallReads[0]!.props.tenantId!.toString()).toBe(
        NONPRD.toString(),
      );

      // The answer goes where he ran the command, only to him.
      expect(answers()).toEqual(["On call in IRM Non-Prod"]);
      expect(
        slackCalls.find((call: SlackCall): boolean => {
          return call.url === COMMAND_RESPONSE_URL;
        })!.data["response_type"],
      ).toBe("ephemeral");

      // The question, in its place: what he chose.
      expect(replacements()).toHaveLength(1);
      expect(replacements()[0]!["replace_original"]).toBe(true);
      expect(replacements()[0]!["text"]).toBe("Going ahead in IRM Non-Prod.");
      expect(
        JSON.stringify(replacements()[0]!["blocks"])
          .split(ZERO_WIDTH_SPACE)
          .join(""),
      ).toContain("Going ahead in *IRM Non-Prod*.");
      expect(JSON.stringify(replacements()[0]!["blocks"])).not.toContain(
        "ChooseProject",
      );
    });

    test("Deane chooses IRM Platform: read there instead", async () => {
      await deaneRuns("oncall");

      const platform: OfferedButton = offeredButton("IRM Platform");
      afterTheQuestion();

      await press(choicePress({ slackUserId: "U0DEANE", button: platform }));

      await slackCallsAfter(2);
      await settle();

      expect(onCallReads).toHaveLength(1);
      expect(onCallReads[0]!.projectId.toString()).toBe(PLATFORM.toString());
      expect(answers()).toEqual(["On call in IRM Platform"]);
      expect(replacements()[0]!["text"]).toBe("Going ahead in IRM Platform.");
    });

    test("a second press - the other button, or the same again - makes nothing again: told the choice is gone", async () => {
      await deaneRuns("oncall");

      const nonProd: OfferedButton = offeredButton("IRM Non-Prod");
      const platform: OfferedButton = offeredButton("IRM Platform");

      await press(choicePress({ slackUserId: "U0DEANE", button: nonProd }));
      await slackCallsAfter(3);
      await settle();

      afterTheQuestion();

      for (const button of [platform, nonProd]) {
        await press(choicePress({ slackUserId: "U0DEANE", button: button }));
      }

      await slackCallsAfter(2);
      await settle();

      expect(onCallReads).toHaveLength(1);
      expect(answers()).toEqual([]);
      expect(
        replacements().map((replacement: JSONObject): unknown => {
          return replacement["text"];
        }),
      ).toEqual([
        "This choice has expired, or was already made. Please try again.",
        "This choice has expired, or was already made. Please try again.",
      ]);
    });

    test("somebody else pressing Deane's button makes nothing, and Deane can still choose", async () => {
      await deaneRuns("oncall");

      const nonProd: OfferedButton = offeredButton("IRM Non-Prod");
      afterTheQuestion();

      await press(choicePress({ slackUserId: "U0NITIN", button: nonProd }));
      await slackCallsAfter(1);
      await settle();

      expect(onCallReads).toEqual([]);
      expect(replacements()[0]!["text"]).toBe(
        "This choice has expired, or was already made. Please try again.",
      );

      afterTheQuestion();

      await press(choicePress({ slackUserId: "U0DEANE", button: nonProd }));
      await slackCallsAfter(2);
      await settle();

      expect(onCallReads).toHaveLength(1);
      expect(onCallReads[0]!.props.userId!.toString()).toBe(DEANE.toString());
    });

    test("a press naming a project that was not offered, or no request at all, makes nothing", async () => {
      await deaneRuns("oncall");

      const nonProd: OfferedButton = offeredButton("IRM Non-Prod");
      const token: string = nonProd.value.split(":")[1]!;
      afterTheQuestion();

      for (const value of [
        `${ObjectID.generate().toString()}:${token}`,
        `${NONPRD.toString()}:${"x".repeat(43)}`,
        "not a choice",
      ]) {
        await press(
          choicePress({
            slackUserId: "U0DEANE",
            button: { ...nonProd, value: value },
          }),
        );
      }

      await slackCallsAfter(3);
      await settle();

      expect(onCallReads).toEqual([]);
      expect(replacements()).toHaveLength(3);

      // The real one still works.
      afterTheQuestion();
      await press(choicePress({ slackUserId: "U0DEANE", button: nonProd }));
      await slackCallsAfter(2);
      await settle();

      expect(onCallReads).toHaveLength(1);
    });

    test("/oneuptime page in #general: the Page someone form opens in the chosen project, on the choice's own trigger", async () => {
      jest.spyOn(WorkspacePage, "getChoices").mockResolvedValue([
        {
          kind: WorkspacePageTargetKind.Person,
          label: "People",
          choices: [
            {
              label: "Nitin Bharathy",
              name: "Nitin Bharathy",
              value: `${WorkspacePageTargetKind.Person}:${NITIN.toString()}`,
            },
          ],
        },
      ]);

      await deaneRuns("page");

      const nonProd: OfferedButton = offeredButton("IRM Non-Prod");
      afterTheQuestion();

      await press(choicePress({ slackUserId: "U0DEANE", button: nonProd }));
      await slackCallsAfter(2);
      await settle();

      const opened: Array<JSONObject> = sentTo("views.open");

      expect(opened).toHaveLength(1);
      // Slack's trigger of the command expired seconds after it was run.
      expect(opened[0]!["trigger_id"]).toBe(CHOICE_TRIGGER_ID);
      expect(JSON.stringify(opened[0]!["view"])).toContain("Nitin Bharathy");
      expect(
        JSON.parse(
          (opened[0]!["view"] as JSONObject)["private_metadata"] as string,
        ),
      ).toMatchObject({
        projectId: NONPRD.toString(),
        channelId: GENERAL_CHANNEL_ID,
      });
      expect(answers()).toEqual([]);
    });

    test("/oneuptime incident with a title, in #general: the New Incident form opens in the chosen project, with the title, its lists read there as Deane", async () => {
      await deaneRuns("incident Checkout is down");

      const nonProd: OfferedButton = offeredButton("IRM Non-Prod");
      afterTheQuestion();

      await press(choicePress({ slackUserId: "U0DEANE", button: nonProd }));
      await slackCallsAfter(2);
      await settle();

      const opened: Array<JSONObject> = sentTo("views.open");

      expect(opened).toHaveLength(1);
      expect(opened[0]!["trigger_id"]).toBe(CHOICE_TRIGGER_ID);

      const view: JSONObject = opened[0]!["view"] as JSONObject;

      expect(view["callback_id"]).toBe("SubmitNewIncident");
      expect(JSON.stringify(view)).toContain("Checkout is down");
      expect(JSON.parse(view["private_metadata"] as string)).toMatchObject({
        projectId: NONPRD.toString(),
        channelId: GENERAL_CHANNEL_ID,
      });

      expect(readable.length).toBeGreaterThan(0);
      for (const read of readable) {
        expect(read.projectId).toBe(NONPRD.toString());
        expect(read.userId).toBe(DEANE.toString());
      }
    });

    test("the shortcut Create New Incident: the New Incident form takes the place of the modal he chose in", async () => {
      await press(
        globalShortcutOf({ slackUserId: "U0DEANE", callbackId: "/incident" }),
      );
      await slackCallsAfter(1);
      await settle();

      expect(sentTo("views.open")).toHaveLength(1);

      const nonProd: OfferedButton = offeredButton("IRM Non-Prod");
      afterTheQuestion();

      expect(
        await press(
          choicePress({
            slackUserId: "U0DEANE",
            button: nonProd,
            isInModal: true,
          }),
        ),
      ).toBe(200);
      await slackCallsAfter(1);
      await settle();

      // views.open cannot open a form over the modal: it is updated instead.
      expect(sentTo("views.open")).toEqual([]);

      const updated: Array<JSONObject> = sentTo("views.update");

      expect(updated).toHaveLength(1);
      expect(updated[0]!["view_id"]).toBe(CHOICE_VIEW_ID);

      const view: JSONObject = updated[0]!["view"] as JSONObject;

      expect(view["callback_id"]).toBe("SubmitNewIncident");
      expect(JSON.parse(view["private_metadata"] as string)).toMatchObject({
        projectId: NONPRD.toString(),
      });
      // No message to replace: a modal has no response_url.
      expect(replacements()).toEqual([]);

      for (const read of readable) {
        expect(read.projectId).toBe(NONPRD.toString());
      }
    });

    test("the shortcut Create Scheduled Event: its form takes the place of the modal, in the chosen project", async () => {
      await press(
        globalShortcutOf({
          slackUserId: "U0DEANE",
          callbackId: "/maintenance",
        }),
      );
      await slackCallsAfter(1);
      await settle();

      const platform: OfferedButton = offeredButton("IRM Platform");
      afterTheQuestion();

      await press(
        choicePress({
          slackUserId: "U0DEANE",
          button: platform,
          isInModal: true,
        }),
      );
      await slackCallsAfter(1);
      await settle();

      const updated: Array<JSONObject> = sentTo("views.update");

      expect(updated).toHaveLength(1);
      expect(updated[0]!["view_id"]).toBe(CHOICE_VIEW_ID);
      expect(
        JSON.parse(
          (updated[0]!["view"] as JSONObject)["private_metadata"] as string,
        ),
      ).toMatchObject({ projectId: PLATFORM.toString() });
    });

    test("a Home drawn before Homes carried their project: Who's on call asks which, and answers in the modal he chose in", async () => {
      await press(
        homePress({
          slackUserId: "U0DEANE",
          actionId: "ShowOnCall",
          privateMetadata: "",
        }),
      );
      await slackCallsAfter(1);
      await settle();

      expect(onCallReads).toEqual([]);
      expect(sentTo("views.open")).toHaveLength(1);

      const nonProd: OfferedButton = offeredButton("IRM Non-Prod");
      afterTheQuestion();

      await press(
        choicePress({
          slackUserId: "U0DEANE",
          button: nonProd,
          isInModal: true,
        }),
      );
      await slackCallsAfter(1);
      await settle();

      expect(onCallReads).toHaveLength(1);
      expect(onCallReads[0]!.projectId.toString()).toBe(NONPRD.toString());

      const updated: Array<JSONObject> = sentTo("views.update");

      expect(updated).toHaveLength(1);
      expect(updated[0]!["view_id"]).toBe(CHOICE_VIEW_ID);
      expect(JSON.stringify(updated[0]!["view"])).toContain(
        "On call in IRM Non-Prod",
      );
    });

    test("/oneuptime ask in #general: the question is answered in the chosen project, as Deane, in the channel", async () => {
      await deaneRuns("ask which monitors are down?");

      const nonProd: OfferedButton = offeredButton("IRM Non-Prod");
      afterTheQuestion();

      await press(choicePress({ slackUserId: "U0DEANE", button: nonProd }));
      await slackCallsAfter(2);
      await settle();

      expect(assistantCalls).toEqual([
        {
          projectId: NONPRD.toString(),
          userId: DEANE.toString(),
          question: "which monitors are down?",
        },
      ]);

      const answered: Array<SlackCall> = slackCalls.filter(
        (call: SlackCall): boolean => {
          return call.url === COMMAND_RESPONSE_URL;
        },
      );

      expect(answered).toHaveLength(1);
      expect(answered[0]!.data["response_type"]).toBe("in_channel");
      expect(String(answered[0]!.data["text"])).toContain(
        "Nothing is down in IRM Non-Prod.",
      );
      expect(replacements()[0]!["text"]).toBe("Going ahead in IRM Non-Prod.");
    });

    test("a question in the app's direct messages: asked which there, answered in the chosen project in its thread - and its follow-ups there too, without asking again", async () => {
      expect(
        await directMessage({
          slackUserId: "U0DEANE",
          text: "is checkout healthy?",
          ts: "1760000100.000100",
        }),
      ).toBe(200);
      await slackCallsAfter(1);
      await settle();

      expect(assistantCalls).toEqual([]);

      // The app's own message in his direct messages: it stays there.
      const asked: Array<JSONObject> = sentTo("chat.postMessage");

      expect(asked).toHaveLength(1);
      expect(asked[0]!["channel"]).toBe("U0DEANE");
      expect(String(asked[0]!["text"])).toContain(
        "Which project is this for: IRM Platform or IRM Non-Prod?",
      );

      const nonProd: OfferedButton = offeredButton("IRM Non-Prod");
      afterTheQuestion();

      await press(
        choicePress({
          slackUserId: "U0DEANE",
          button: nonProd,
          channelId: DM_CHANNEL_ID,
        }),
      );
      await slackCallsAfter(2);
      await settle();

      expect(assistantCalls).toEqual([
        {
          projectId: NONPRD.toString(),
          userId: DEANE.toString(),
          question: "is checkout healthy?",
        },
      ]);
      expect(
        sentTo("chat.postMessage").some((sent: JSONObject): boolean => {
          return (
            sent["channel"] === DM_CHANNEL_ID &&
            sent["thread_ts"] === "1760000100.000100" &&
            String(sent["text"]).includes("Nothing is down in IRM Non-Prod.")
          );
        }),
      ).toBe(true);
      expect(replacements()[0]!["text"]).toBe("Going ahead in IRM Non-Prod.");

      // A follow-up in the thread: answered in IRM Non-Prod, not asked again.
      afterTheQuestion();
      await directMessage({
        slackUserId: "U0DEANE",
        text: "and payments?",
        ts: "1760000100.000300",
        threadTs: "1760000100.000100",
      });
      await slackCallsAfter(1);
      await settle();

      expect(offeredButtons()).toEqual([]);
      expect(assistantCalls).toHaveLength(2);
      expect(assistantCalls[1]).toEqual({
        projectId: NONPRD.toString(),
        userId: DEANE.toString(),
        question: "and payments?",
      });

      // A new question, at the top: asked again.
      afterTheQuestion();
      await directMessage({
        slackUserId: "U0DEANE",
        text: "anything firing?",
        ts: "1760000200.000100",
      });
      await slackCallsAfter(1);
      await settle();

      expect(offeredButtons()).toHaveLength(2);
      expect(assistantCalls).toHaveLength(2);
    });

    test("the projects cannot be named: told how to say which, as before - no buttons without names", async () => {
      jest
        .spyOn(ProjectService, "findBy")
        .mockRejectedValue(new Error("connection refused"));

      await command(
        slashCommand({
          slackUserId: "U0DEANE",
          text: "oncall",
          channelId: GENERAL_CHANNEL_ID,
        }),
      );
      await slackCallsAfter(1);
      await settle();

      expect(offeredButtons()).toEqual([]);
      expect(answers()).toEqual([
        "This Slack workspace is connected to more than one OneUptime project, so OneUptime can't tell which one you mean here. Try it again in a channel of the project you mean, such as one of its incident channels.",
      ]);
    });

    test("removed from the chosen project between the question and the choice: told he is not a member - nothing is read", async () => {
      await deaneRuns("oncall");

      const nonProd: OfferedButton = offeredButton("IRM Non-Prod");
      afterTheQuestion();

      memberships = memberships.filter((membership: Membership): boolean => {
        return !(
          sameId(membership.userId, DEANE) &&
          sameId(membership.projectId, NONPRD)
        );
      });

      await press(choicePress({ slackUserId: "U0DEANE", button: nonProd }));
      await slackCallsAfter(2);
      await settle();

      expect(onCallReads).toEqual([]);
      expect(answers()).toEqual([
        WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
      ]);
    });

    test("his account disconnected in the chosen project since: asked to connect it there, named", async () => {
      await deaneRuns("oncall");

      const nonProd: OfferedButton = offeredButton("IRM Non-Prod");
      afterTheQuestion();

      links = links.filter((link: WorkspaceUserAuthToken): boolean => {
        return !(
          link.workspaceUserId === "U0DEANE" && sameId(link.projectId, NONPRD)
        );
      });

      await press(choicePress({ slackUserId: "U0DEANE", button: nonProd }));
      await slackCallsAfter(2);
      await settle();

      expect(onCallReads).toEqual([]);
      expect(answers()).toEqual([
        expect.stringContaining("Connect your Slack account in IRM Non-Prod"),
      ]);
      expect(answerBlocks()).toContain(
        `${DASHBOARD_URL}/${NONPRD.toString()}/`,
      );
    });

    test("held to his permissions in the project he chose: a member who may only read incidents there may not page from it", async () => {
      // The viewer of INC-12's project is a member of the platform one too.
      links.push(linkOf("U0VIEWER", PLATFORM));
      memberships.push({
        userId: VIEWER,
        projectId: PLATFORM,
        permissions: [Permission.ProjectMember],
      });

      await command(
        slashCommand({
          slackUserId: "U0VIEWER",
          text: "page",
          channelId: GENERAL_CHANNEL_ID,
        }),
      );
      await slackCallsAfter(1);
      await settle();

      const nonProd: OfferedButton = offeredButton("IRM Non-Prod");
      afterTheQuestion();

      await press(choicePress({ slackUserId: "U0VIEWER", button: nonProd }));
      await slackCallsAfter(2);
      await settle();

      expect(sentTo("views.open")).toEqual([]);
      expect(answers()).toEqual([
        expect.stringContaining("You do not have permission to page"),
      ]);
    });

    test("somebody in only one of the projects is never asked: his command runs there", async () => {
      await command(
        slashCommand({
          slackUserId: "U0NITIN",
          text: "oncall",
          channelId: GENERAL_CHANNEL_ID,
        }),
      );
      await slackCallsAfter(1);
      await settle();

      expect(offeredButtons()).toEqual([]);
      expect(onCallReads).toHaveLength(1);
      expect(onCallReads[0]!.projectId.toString()).toBe(NONPRD.toString());
    });

    test("somebody connected in neither is never asked: told where to connect", async () => {
      await command(
        slashCommand({
          slackUserId: "U0NOBODY",
          text: "oncall",
          channelId: GENERAL_CHANNEL_ID,
        }),
      );
      await slackCallsAfter(1);
      await settle();

      expect(offeredButtons()).toEqual([]);
      expect(answers()[0]).toContain(
        "your Slack account isn't connected in any of them yet",
      );
    });

    test("a workspace connected to one project never asks", async () => {
      connections = [connectionOf(NONPRD)];

      await deaneRunsWithoutQuestion("oncall");

      expect(offeredButtons()).toEqual([]);
      expect(onCallReads).toHaveLength(1);
      expect(onCallReads[0]!.projectId.toString()).toBe(NONPRD.toString());
    });

    async function deaneRunsWithoutQuestion(text: string): Promise<void> {
      await command(
        slashCommand({
          slackUserId: "U0DEANE",
          text: text,
          channelId: GENERAL_CHANNEL_ID,
        }),
      );

      await slackCallsAfter(1);
      await settle();
    }
  });

  // A shortcut from Slack's shortcuts menu, by its callback id.
  function globalShortcutOf(data: {
    slackUserId: string;
    callbackId: string;
  }): Record<string, string> {
    return {
      payload: JSON.stringify({
        type: "shortcut",
        token: "verification-token",
        action_ts: "1760000001.000300",
        team: { id: SLACK_TEAM_ID, domain: "avepoint" },
        user: {
          id: data.slackUserId,
          username: data.slackUserId.toLowerCase(),
          team_id: SLACK_TEAM_ID,
        },
        is_enterprise_install: false,
        callback_id: data.callbackId,
        trigger_id: TRIGGER_ID,
      }),
    };
  }

  describe("OneUptime Cloud: /oneuptime page on the project's plan", () => {
    let pagedWith: Array<DatabaseCommonInteractionProps>;
    let directPages: number;

    beforeEach(() => {
      setTestBillingEnabled(true);
      pagedWith = [];
      directPages = 0;
      // A workspace connected to one project, as the SaaS one is.
      connections = [connectionOf(NONPRD)];

      jest
        .spyOn(ProjectMembership, "getMemberUserIds")
        .mockResolvedValue(
          new Set<string>([DEANE.toString(), NITIN.toString()]),
        );
      jest.spyOn(UserService, "findBy").mockImplementation((async () => {
        return [userOf(DEANE), userOf(NITIN)];
      }) as never);
      jest
        .spyOn(OnCallDutyPolicyExecutionLogService, "checkCallerMayCreate")
        .mockResolvedValue(undefined as never);

      // What OnCallPageService reads and writes after its own check.
      const pageService: Record<string, unknown> =
        OnCallPageService as unknown as Record<string, unknown>;
      jest
        .spyOn(
          pageService as { resolveTargets: () => Promise<unknown> },
          "resolveTargets",
        )
        .mockImplementation((async (request: {
          props: DatabaseCommonInteractionProps;
        }) => {
          pagedWith.push(request.props);
          return {
            users: [userOf(DEANE)],
            teams: [],
            schedules: [],
            policies: [],
            notFound: [],
          };
        }) as never);
      jest
        .spyOn(
          pageService as { resolveRecord: () => Promise<unknown> },
          "resolveRecord",
        )
        .mockResolvedValue({
          type: OnCallPageRecordType.Alert,
          id: ObjectID.generate(),
          label: "Alert #1",
          title: "test",
          url: URL.fromString(`${DASHBOARD_URL}/alerts/1`),
          isNew: true,
        } as never);
      jest
        .spyOn(OnCallPageService, "waitUntilRecordIsSetUp")
        .mockResolvedValue(undefined);
      jest
        .spyOn(OnCallDutyPolicyExecutionLogService, "startDirectPage")
        .mockImplementation((async () => {
          directPages++;
          return {
            executionLogId: ObjectID.generate(),
            outcome: { paged: [], notPaged: [] },
          };
        }) as never);
      jest
        .spyOn(
          pageService as { nameOutcome: () => Promise<unknown> },
          "nameOutcome",
        )
        .mockResolvedValue({
          paged: [
            {
              userId: DEANE,
              name: "Deane Looi",
              email: null,
              teamName: null,
              scheduleName: null,
              coveringForName: null,
            },
          ],
          notPaged: [],
        } as never);
      jest
        .spyOn(
          WorkspacePage as unknown as { keepPlace: () => Promise<void> },
          "keepPlace",
        )
        .mockResolvedValue(undefined);
      jest
        .spyOn(OnCallPolicyRunMessage, "syncRun")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(WorkspaceLiveMessageService, "findByMessageKey")
        .mockResolvedValue([]);
    });

    function pageDeane(): Promise<number> {
      return command(
        slashCommand({
          slackUserId: "U0NITIN",
          text: "page <@U0DEANE|deane> test",
          channelId: GENERAL_CHANNEL_ID,
        }),
      );
    }

    test("on the plan that includes it: the page goes out, its check made on the project's plan", async () => {
      await pageDeane();

      await slackCallsAfter(2);
      await settle();

      for (const answer of answers()) {
        expect(answer).not.toContain(CallerPlan.PLAN_UNKNOWN_MESSAGE);
      }

      expect(answers()[0]).toContain("Paging Deane Looi");
      expect(directPages).toBe(1);
      expect(pagedWith).toHaveLength(1);
      expect(pagedWith[0]!.currentPlan).toBe(PlanType.Growth);
      expect(pagedWith[0]!.userId!.toString()).toBe(NITIN.toString());
    });

    test("a plan that cannot be read: told so, and nobody is paged - never paged on 'any plan'", async () => {
      jest
        .spyOn(ProjectService, "getCurrentPlan")
        .mockImplementation((async () => {
          throw new BadDataException("Project does not have any plans");
        }) as never);

      await pageDeane();

      await slackCallsAfter(1);
      await settle();

      expect(directPages).toBe(0);
      expect(answers()).toEqual([CallerPlan.PLAN_UNKNOWN_MESSAGE]);
    });

    test("below the plan that includes on-call: refused with the plan it needs, and nobody is paged", async () => {
      jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
        plan: PlanType.Free,
        isSubscriptionUnpaid: false,
      });

      await pageDeane();

      await slackCallsAfter(1);
      await settle();

      expect(directPages).toBe(0);
      expect(answers()).toEqual([
        expect.stringContaining("Please upgrade your plan to Growth"),
      ]);
      expect(answers()[0]).not.toContain(CallerPlan.PLAN_UNKNOWN_MESSAGE);
    });

    test("billing off: no plan is read, and the page goes out", async () => {
      setTestBillingEnabled(false);
      const planRead: ReturnType<typeof jest.spyOn> = jest.spyOn(
        ProjectService,
        "getCurrentPlan",
      );

      await pageDeane();

      await slackCallsAfter(2);
      await settle();

      expect(planRead).not.toHaveBeenCalled();
      expect(directPages).toBe(1);
      expect(pagedWith[0]!.currentPlan).toBeUndefined();
    });

    test("Execute On-Call Policy below the plan is told the plan it needs, not left unanswered", async () => {
      jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
        plan: PlanType.Free,
        isSubscriptionUnpaid: false,
      });

      await press(
        buttonPress({
          slackUserId: "U0NITIN",
          actionId: "ViewExecuteIncidentOnCallPolicy",
          value: INCIDENT_ID.toString(),
        }),
      );

      await slackCallsAfter(1);
      await settle();

      expect(answers()).toEqual([
        "Could not execute an on-call policy for this incident: Please upgrade your plan to Growth to access this feature",
      ]);
    });
  });
});
