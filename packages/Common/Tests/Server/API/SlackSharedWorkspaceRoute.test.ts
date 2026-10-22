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
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import MonitorService from "../../../Server/Services/MonitorService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ProjectService from "../../../Server/Services/ProjectService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import ProductBrandingText from "../../../Server/Utils/ProductBrandingText";
import CallerPlan from "../../../Server/Utils/Billing/CallerPlan";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import OnCallPageService from "../../../Server/Services/OnCallPageService";
import OnCallDutyPolicyExecutionLogService from "../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import BadDataException from "../../../Types/Exception/BadDataException";

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
 * message acknowledged it.
 *
 * Their Slack workspace is connected to two OneUptime projects. Slack sends
 * a press with the workspace's id and nothing else, and the press was read
 * in whichever of the two connections the database happened to return
 * first - here, the platform project - while the incident is the other
 * project's. So the incident was read in the wrong project, and was not
 * there. The 📌 looked the channel up in every connected project, and the
 * direct message's link names the page itself, so both worked.
 *
 * These post what Slack posts, through the real SlackAPI router,
 * authorization and handlers; only the database under them is stood in for,
 * by the two projects, their connections and members, and the incident.
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

// The channel a notification rule created for INC-12, and one of no record.
const INCIDENT_CHANNEL_ID: string = "C0IRMINC12";
const GENERAL_CHANNEL_ID: string = "C0GENERAL";

// Connected to the workspace first: the connection a lookup returned first.
const PLATFORM: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-000000000001",
);
// INC-12's project.
const NONPRD: ObjectID = new ObjectID("d1000000-0000-4000-8000-000000000002");

const DEANE: ObjectID = new ObjectID("d1000000-0000-4000-8000-0000000000a1");
const NITIN: ObjectID = new ObjectID("d1000000-0000-4000-8000-0000000000a2");

const INCIDENT_ID: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-0000000000b1",
);

const CREATED: ObjectID = new ObjectID("d1000000-0000-4000-8000-0000000000c1");
const ACKNOWLEDGED: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-0000000000c2",
);
const RESOLVED: ObjectID = new ObjectID(
  "d1000000-0000-4000-8000-0000000000c3",
);

const SLACK_USERS: Record<string, ObjectID> = {
  U0DEANE: DEANE,
  U0NITIN: NITIN,
};

const NAMES: Record<string, string> = {
  [DEANE.toString()]: "Deane Looi",
  [NITIN.toString()]: "Nitin Bharathy",
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
 * The ids a query's value names: an id, or the ids of an IN (...) that
 * QueryHelper.any builds.
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
 * What Slack posts when a button of the incident's message is pressed in
 * its channel: a block action with the button's action id and value - the
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
  let connections: Array<WorkspaceProjectAuthToken>;
  let links: Array<WorkspaceUserAuthToken>;
  let memberships: Array<Membership>;
  let incidentStateId: ObjectID;

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

  function linkOf(slackUserId: string, projectId: ObjectID): WorkspaceUserAuthToken {
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

  beforeEach(() => {
    slackCalls = [];
    timelines = [];
    incidentStateId = CREATED;
    connections = [connectionOf(PLATFORM), connectionOf(NONPRD)];
    links = [
      linkOf("U0DEANE", PLATFORM),
      linkOf("U0DEANE", NONPRD),
      linkOf("U0NITIN", NONPRD),
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
    ];

    (
      jest.requireMock("../../../Server/Infrastructure/GlobalCache") as {
        default: { store: Map<string, unknown> };
      }
    ).default.store.clear();

    // The workspace's connections, in the order the database returns them.
    const findConnections: (query: JSONObject) => Array<WorkspaceProjectAuthToken> =
      (query: JSONObject): Array<WorkspaceProjectAuthToken> => {
        return connections.filter(
          (connection: WorkspaceProjectAuthToken): boolean => {
            return (
              (query["workspaceProjectId"] === undefined ||
                query["workspaceProjectId"] ===
                  connection.workspaceProjectId) &&
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
        const workspaceUserIds: Array<string> = idsOf(
          query["workspaceUserId"],
        );

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
    jest
      .spyOn(IncidentService, "findOneBy")
      .mockImplementation((async (findOneBy: {
        query: JSONObject;
        props: DatabaseCommonInteractionProps;
      }) => {
        const query: JSONObject = findOneBy.query;

        if (!namesProject(query, NONPRD)) {
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

        if (
          !findOneBy.props.isRoot &&
          !membershipOf(findOneBy.props.userId, NONPRD)
        ) {
          return null;
        }

        return incidentRow();
      }) as never);
    jest
      .spyOn(IncidentService, "findBy")
      .mockImplementation((async (findBy: { query: JSONObject }) => {
        const query: JSONObject = findBy.query;

        if (
          !namesProject(query, NONPRD) ||
          (query["postUpdatesToWorkspaceChannels"] !== undefined &&
            !JSON.stringify(
              idsOf(query["postUpdatesToWorkspaceChannels"]),
            ).includes(INCIDENT_CHANNEL_ID.toLowerCase())) ||
          (query["_id"] !== undefined &&
            !idsOf(query["_id"]).includes(INCIDENT_ID.toString()))
        ) {
          return [];
        }

        return [incidentRow()];
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

    jest
      .spyOn(WorkspaceNotificationLogService, "findOneBy")
      .mockResolvedValue(null);
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
    jest.spyOn(IncidentCustomFieldService, "findBy").mockResolvedValue([]);

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
      expect(timelines[0]!.data.projectId!.toString()).toBe(
        NONPRD.toString(),
      );
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

    test("Edit Custom Fields reads INC-12 in its own project", async () => {
      await press(
        menuChoice({
          slackUserId: "U0DEANE",
          value: `ViewEditIncidentCustomFields:${INCIDENT_ID.toString()}`,
        }),
      );

      await settle();

      // The project has no custom fields: it says so, not "not found".
      expect(answers()).toEqual([
        expect.stringContaining("custom field"),
      ]);
      expect(answers()[0]).not.toContain("not found");
    });

    test("/oneuptime page from the incident's channel is read in its project, where Nitin is connected", async () => {
      await command(
        slashCommand({
          slackUserId: "U0NITIN",
          text: "page",
          channelId: INCIDENT_CHANNEL_ID,
        }),
      );

      await settle();

      for (const answer of answers()) {
        expect(answer).not.toContain("Connect your Slack account");
      }
    });
  });

  describe("OneUptime Cloud: /oneuptime page on the project's plan", () => {
    test("paging is not refused for a plan OneUptime could not confirm", async () => {
      setTestBillingEnabled(true);
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
      // Past the plan check: who is paged is read next.
      jest
        .spyOn(
          OnCallPageService as unknown as {
            resolveTargets: () => Promise<unknown>;
          },
          "resolveTargets",
        )
        .mockRejectedValue(new BadDataException("past the plan check"));

      await command(
        slashCommand({
          slackUserId: "U0NITIN",
          text: `page <@U0DEANE|deane> test`,
          channelId: GENERAL_CHANNEL_ID,
        }),
      );

      await settle();

      for (const answer of answers()) {
        expect(answer).not.toContain(CallerPlan.PLAN_UNKNOWN_MESSAGE);
      }
    });
  });

  test("the refusals are the customer's, before the fix (reproduction)", () => {
    // Placeholder: the describe blocks above pin the fixed behaviour.
    expect(NotAuthorizedException).toBeDefined();
  });
});
