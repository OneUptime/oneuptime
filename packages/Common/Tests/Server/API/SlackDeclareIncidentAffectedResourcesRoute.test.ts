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
import { FindOperator } from "typeorm";
import API from "../../../Utils/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import PositiveNumber from "../../../Types/PositiveNumber";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Permission, { UserPermission } from "../../../Types/Permission";
import { AiAffectedResourceKind } from "../../../Types/AI/AiAffectedResources";
import { AffectedResourceKind } from "../../../Types/AffectedResources/AffectedResourceSearch";
import { INCIDENT_ALERT_IDS_TO_LINK_KEY } from "../../../Types/Incident/IncidentAlertLink";
import BadDataException from "../../../Types/Exception/BadDataException";
import Alert from "../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import AIService from "../../../Server/Services/AIService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentAlertService from "../../../Server/Services/IncidentAlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import MonitorService from "../../../Server/Services/MonitorService";
import ProjectService from "../../../Server/Services/ProjectService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import { getAffectedResourceKindService } from "../../../Server/Utils/AffectedResources/AffectedResourceSearch";
import LinkedAffectedResources, {
  LinkedAffectedResourceType,
} from "../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import logger from "../../../Server/Utils/Logger";
import ProductBrandingText from "../../../Server/Utils/ProductBrandingText";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceAffectedResources from "../../../Server/Utils/Workspace/WorkspaceAffectedResources";
import WorkspaceMemberActions, {
  WorkspaceEvent,
  WorkspaceEventStanding,
} from "../../../Server/Utils/Workspace/WorkspaceMemberActions";

/*
 * DECLARING AN INCIDENT FROM SLACK, LINKED TO WHAT IT IS ABOUT - THROUGH
 * SLACK'S OWN ENDPOINTS (#5303 follow-up, and #5409's alert channels).
 *
 * OneUptime AI investigates and fixes the resources an incident is linked
 * to, and an incident declared with /oneuptime incident was linked to
 * nothing. These post what Slack posts - the command, the field's options
 * requests to the Options Load URL, the form's submission - through the
 * real SlackAPI router, authorization, form and handlers; only the database
 * under them is stood in for (each kind of resource a table of rows the
 * stand-in reads as a query asks), and Slack itself, whose every request is
 * recorded. They pin:
 *
 *   - the form: Affected Resources right after the severity, searched as
 *     the person types, never a list sent with it - and none for a member
 *     who may read no resource; the Monitors field says what a pick there
 *     does;
 *   - the options request: answered within Slack's limits with the
 *     project's resources that match, read as the member in the project
 *     the form was drawn for - in a workspace connected to two projects,
 *     that one only - and nothing at all, no message either, for somebody
 *     OneUptime cannot act as;
 *   - the submission: every pick read again as the member, linked in its
 *     kind's list, created with the member's own props; the confirmation
 *     says what it is linked to; a pick that is not linked is said only to
 *     the person who picked it;
 *   - an alert's own channel: the form says it is declared from the alert,
 *     starts from its title and its resources, and the incident is linked
 *     to the alert - never to its monitor;
 *   - status page subscribers (#7606): the form asks nothing about them, so
 *     the incident is declared as the project starts Notify Status Page
 *     Subscribers on Declare New Incident - without notifying them where
 *     the project starts it unticked, as always everywhere else.
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

const DASHBOARD_URL: string = "https://oneuptime.test/dashboard";
const SLACK_TEAM_ID: string = "T0TEAM";
const SLACK_USER_ID: string = "U0SIMON";
const OPS_CHANNEL_ID: string = "C0OPS";
// The alert's own channel, which a notification rule created for it.
const ALERT_CHANNEL_ID: string = "C0ALT3";
const TRIGGER_ID: string = "1760000000.trigger";
const COMMAND_RESPONSE_URL: string =
  "https://hooks.slack.com/commands/T0TEAM/1760000000/decAbc123";
const ZERO_WIDTH_SPACE: string = String.fromCharCode(0x200b);

const PROJECT_ID: ObjectID = new ObjectID(
  "d3c10000-0000-4000-8000-000000000001",
);
// The other project the same Slack workspace is connected to.
const STAGING_PROJECT_ID: ObjectID = new ObjectID(
  "d3c10000-0000-4000-8000-000000000002",
);
const SIMON: ObjectID = new ObjectID("d3c10000-0000-4000-8000-0000000000a1");
const CRITICAL: ObjectID = new ObjectID("d3c10000-0000-4000-8000-0000000000c1");
const CHECKOUT_MONITOR: ObjectID = new ObjectID(
  "d3c10000-0000-4000-8000-0000000000c2",
);
const CREATED_INCIDENT_ID: ObjectID = new ObjectID(
  "d3c10000-0000-4000-8000-0000000000e1",
);
const ALERT_ID: ObjectID = new ObjectID("d3c10000-0000-4000-8000-0000000000f1");

const API_1: string = "d3c10000-0000-4000-8000-000000000101";
const API_2: string = "d3c10000-0000-4000-8000-000000000102";
const OLD_BOX: string = "d3c10000-0000-4000-8000-000000000103";
const STAGING_API: string = "d3c10000-0000-4000-8000-000000000104";
const PROD_CLUSTER: string = "d3c10000-0000-4000-8000-000000000201";
const CHECKOUT_SERVICE: string = "d3c10000-0000-4000-8000-000000000301";
const CORE_SWITCH: string = "d3c10000-0000-4000-8000-000000000401";

const ALERT_URL: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/alerts/${ALERT_ID.toString()}`;
const INCIDENT_URL: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/incidents/${CREATED_INCIDENT_ID.toString()}`;

// One resource of the stand-in database.
interface ResourceRow {
  kind: AiAffectedResourceKind;
  id: string;
  name: string;
  projectId: ObjectID;
  isArchived?: boolean | undefined;
  hostname?: string | undefined;
}

const RESOURCES: Array<ResourceRow> = [
  {
    kind: AiAffectedResourceKind.Host,
    id: API_1,
    name: "api-1",
    projectId: PROJECT_ID,
  },
  {
    kind: AiAffectedResourceKind.Host,
    id: API_2,
    name: "api-2",
    projectId: PROJECT_ID,
  },
  {
    kind: AiAffectedResourceKind.Host,
    id: OLD_BOX,
    name: "api-old",
    projectId: PROJECT_ID,
    isArchived: true,
  },
  {
    kind: AiAffectedResourceKind.Host,
    id: STAGING_API,
    name: "api-staging",
    projectId: STAGING_PROJECT_ID,
  },
  {
    kind: AiAffectedResourceKind.KubernetesCluster,
    id: PROD_CLUSTER,
    name: "prod",
    projectId: PROJECT_ID,
  },
  {
    kind: AiAffectedResourceKind.Service,
    id: CHECKOUT_SERVICE,
    name: "checkout-api",
    projectId: PROJECT_ID,
  },
  {
    kind: AiAffectedResourceKind.NetworkDevice,
    id: CORE_SWITCH,
    name: "core-sw-01",
    projectId: PROJECT_ID,
    hostname: "10.0.4.1",
  },
];

// A member's props, with the permissions of their role in a project.
function propsWith(
  permissions: Array<Permission>,
  projectId: ObjectID = PROJECT_ID,
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

interface SlackCall {
  url: string;
  data: JSONObject;
}

interface RoutePort {
  port: number;
  close: () => Promise<void>;
}

interface RouteAnswer {
  status: number;
  body: JSONObject | null;
}

// A read of a kind of resource, as the stand-in database saw it.
interface ResourceRead {
  kind: AiAffectedResourceKind;
  how: "findBy" | "countBy";
  query: JSONObject;
  props: DatabaseCommonInteractionProps;
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
}): Promise<RouteAnswer> {
  const payload: string = new globalThis.URLSearchParams(
    data.fields,
  ).toString();

  return new Promise<RouteAnswer>(
    (
      resolve: (answer: RouteAnswer) => void,
      reject: (error: Error) => void,
    ) => {
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
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            const raw: string = Buffer.concat(chunks).toString("utf8");
            let body: JSONObject | null = null;

            try {
              body = raw ? (JSON.parse(raw) as JSONObject) : null;
            } catch {
              body = null;
            }

            resolve({ status: response.statusCode || 0, body: body });
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

// The ids a condition such as QueryHelper.any names.
function idsOf(condition: unknown): Array<string> | null {
  if (!(condition instanceof FindOperator)) {
    return null;
  }

  for (const value of Object.values(
    (condition.objectLiteralParameters as Record<string, unknown>) || {},
  )) {
    if (Array.isArray(value)) {
      return value.map((id: unknown): string => {
        return String(id).toLowerCase();
      });
    }
  }

  return [];
}

// The rows of a kind a query asks for, as the stand-in database reads it.
function rowsFor(
  kind: AiAffectedResourceKind,
  query: JSONObject,
): Array<ResourceRow> {
  const ids: Array<string> | null = idsOf(query["_id"]);
  const search: unknown = query["_multiFieldSearch"];
  const startsWith: unknown = query["name"];

  return RESOURCES.filter((row: ResourceRow): boolean => {
    if (row.kind !== kind) {
      return false;
    }

    if (String(query["projectId"]) !== row.projectId.toString()) {
      return false;
    }

    if (query["isArchived"] === false && row.isArchived) {
      return false;
    }

    if (ids && !ids.includes(row.id)) {
      return false;
    }

    if (
      search instanceof MultiSearch &&
      !row.name.toLowerCase().includes(search.value.toLowerCase())
    ) {
      return false;
    }

    if (
      startsWith instanceof StartsWith &&
      !row.name.toLowerCase().startsWith(String(startsWith.value).toLowerCase())
    ) {
      return false;
    }

    return true;
  });
}

function toModel(kind: AiAffectedResourceKind, row: ResourceRow): BaseModel {
  const service: { modelType: { new (): BaseModel } } =
    getAffectedResourceKindService(
      kind as unknown as AffectedResourceKind,
    ) as unknown as { modelType: { new (): BaseModel } };
  const model: BaseModel = new service.modelType();

  model._id = row.id;
  (model as unknown as Record<string, unknown>)["name"] = row.name;
  (model as unknown as Record<string, unknown>)["isArchived"] =
    row.isArchived === true;

  if (row.hostname) {
    (model as unknown as Record<string, unknown>)["hostname"] = row.hostname;
  }

  return model;
}

/*
 * A kind's service as a table of RESOURCES: what each findBy and countBy
 * asks is recorded, and answered from the rows the query names.
 */
function stubResourceTable(
  kind: AiAffectedResourceKind,
  record: (read: ResourceRead) => void,
): void {
  const service: {
    findBy: (data: unknown) => Promise<Array<BaseModel>>;
    countBy: (data: unknown) => Promise<PositiveNumber>;
  } = getAffectedResourceKindService(
    kind as unknown as AffectedResourceKind,
  ) as never;

  jest.spyOn(service, "findBy").mockImplementation((async (findBy: {
    query: JSONObject;
    limit?: number;
    props: DatabaseCommonInteractionProps;
  }) => {
    record({
      kind: kind,
      how: "findBy",
      query: findBy.query,
      props: findBy.props,
    });

    return rowsFor(kind, findBy.query)
      .slice(0, findBy.limit || 10)
      .map((row: ResourceRow): BaseModel => {
        return toModel(kind, row);
      });
  }) as never);
  jest.spyOn(service, "countBy").mockImplementation((async (countBy: {
    query: JSONObject;
    props: DatabaseCommonInteractionProps;
  }) => {
    record({
      kind: kind,
      how: "countBy",
      query: countBy.query,
      props: countBy.props,
    });

    return new PositiveNumber(rowsFor(kind, countBy.query).length);
  }) as never);
}

// What Slack posts for /oneuptime <text>, from Simon, in a channel.
function slashCommand(
  text: string,
  channelId: string = OPS_CHANNEL_ID,
): Record<string, string> {
  return {
    token: "verification-token",
    team_id: SLACK_TEAM_ID,
    team_domain: "acme",
    channel_id: channelId,
    channel_name: channelId === ALERT_CHANNEL_ID ? "alt-3" : "ops",
    user_id: SLACK_USER_ID,
    user_name: "simon",
    command: "/oneuptime",
    text: text,
    api_app_id: "A0ONEUPTIME",
    response_url: COMMAND_RESPONSE_URL,
    trigger_id: TRIGGER_ID,
  };
}

// What Slack posts as the Affected Resources field asks for its options.
function optionsRequest(data: {
  privateMetadata: string;
  value: string;
  actionId?: string;
  slackUserId?: string;
}): Record<string, string> {
  return {
    payload: JSON.stringify({
      type: "block_suggestion",
      user: {
        id: data.slackUserId || SLACK_USER_ID,
        username: "simon",
        name: "simon",
        team_id: SLACK_TEAM_ID,
      },
      container: { type: "view", view_id: "V0FORM" },
      api_app_id: "A0ONEUPTIME",
      action_id: data.actionId || "affectedResources",
      block_id: "affectedResources",
      value: data.value,
      team: { id: SLACK_TEAM_ID, domain: "acme" },
      view: {
        id: "V0FORM",
        type: "modal",
        callback_id: "SubmitNewIncident",
        private_metadata: data.privateMetadata,
        state: { values: {} },
      },
    }),
  };
}

// What Slack posts when the New Incident form is submitted.
function formSubmission(data: {
  privateMetadata: string;
  title: string;
  picks: Array<{ value: string; text: string }>;
  monitors?: Array<string> | undefined;
}): Record<string, string> {
  const values: JSONObject = {
    incidentTitle: {
      incidentTitle: { type: "plain_text_input", value: data.title },
    },
    incidentDescription: {
      incidentDescription: {
        type: "plain_text_input",
        value: "Checkout requests time out.",
      },
    },
    incidentSeverity: {
      incidentSeverity: {
        type: "static_select",
        selected_option: {
          value: CRITICAL.toString(),
          text: { type: "plain_text", text: "Critical" },
        },
      },
    },
    affectedResources: {
      affectedResources: {
        type: "multi_external_select",
        selected_options: data.picks.map(
          (pick: { value: string; text: string }): JSONObject => {
            return {
              value: pick.value,
              text: { type: "plain_text", text: pick.text },
            };
          },
        ),
      },
    },
    incidentMonitors: {
      incidentMonitors: {
        type: "multi_static_select",
        selected_options: (data.monitors || []).map(
          (value: string): JSONObject => {
            return { value: value, text: { type: "plain_text", text: value } };
          },
        ),
      },
    },
  };

  return {
    payload: JSON.stringify({
      type: "view_submission",
      team: { id: SLACK_TEAM_ID },
      user: { id: SLACK_USER_ID, username: "simon", name: "simon" },
      trigger_id: TRIGGER_ID,
      view: {
        id: "V0FORM",
        type: "modal",
        callback_id: "SubmitNewIncident",
        private_metadata: data.privateMetadata,
        state: { values: values },
      },
    }),
  };
}

describe("declaring an incident from Slack, linked to what it is about", () => {
  let app: RoutePort;
  let slackCalls: Array<SlackCall>;
  let linkedUser: ObjectID | null;
  // The projects the workspace is connected to, oldest first.
  let connectedProjects: Array<ObjectID>;
  let memberProps: DatabaseCommonInteractionProps;
  let resourceReads: Array<ResourceRead>;
  let created: Array<{
    data: Incident;
    miscDataProps: JSONObject | undefined;
    props: DatabaseCommonInteractionProps;
  }>;
  let isAlertOpen: boolean;
  let isAlertPrivate: boolean;
  let mayLinkAlert: boolean;
  let isAiOn: boolean;
  /*
   * The project's Notify status page subscribers by default (Incidents >
   * Settings > Subscriber Notifications), and every read of it.
   */
  let notifiesByDefault: boolean;
  let projectReads: Array<JSONObject>;

  beforeAll(async () => {
    app = await startSlackApp();
  }, 600000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    slackCalls = [];
    linkedUser = SIMON;
    connectedProjects = [PROJECT_ID];
    memberProps = propsWith([Permission.ProjectMember]);
    resourceReads = [];
    created = [];
    isAlertOpen = true;
    isAlertPrivate = false;
    mayLinkAlert = true;
    isAiOn = true;
    notifiesByDefault = true;
    projectReads = [];

    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    jest.spyOn(ProjectService, "findOneById").mockImplementation((async (
      findOneById: JSONObject,
    ) => {
      projectReads.push(findOneById);

      const project: Project = new Project();
      project.id = findOneById["id"] as ObjectID;
      project.notifyStatusPageSubscribersOfNewIncidentsByDefault =
        notifiesByDefault;
      return project;
    }) as never);
    // The project's AI switch, which Affected Resources' hint follows.
    jest
      .spyOn(AIService, "isProjectAIEnabled")
      .mockImplementation(async (): Promise<boolean> => {
        return isAiOn;
      });

    (
      jest.requireMock("../../../Server/Infrastructure/GlobalCache") as {
        default: { store: Map<string, unknown> };
      }
    ).default.store.clear();

    const connectionOf: (projectId: ObjectID) => WorkspaceProjectAuthToken = (
      projectId: ObjectID,
    ): WorkspaceProjectAuthToken => {
      const projectAuth: WorkspaceProjectAuthToken =
        new WorkspaceProjectAuthToken();
      projectAuth.projectId = projectId;
      projectAuth.authToken = "xoxb-project-token";
      projectAuth.workspaceProjectId = SLACK_TEAM_ID;
      projectAuth.miscData = { botUserId: "B0BOT" } as never;
      return projectAuth;
    };

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
      .mockImplementation((async () => {
        return connectionOf(connectedProjects[0]!);
      }) as never);
    // The workspace's connections, as WorkspaceProjectResolution reads them.
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockImplementation((async () => {
        return connectedProjects.map(connectionOf);
      }) as never);
    jest
      .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
      .mockImplementation((async () => {
        if (!linkedUser) {
          return null;
        }

        const userAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
        userAuth.userId = linkedUser;
        userAuth.authToken = "xoxp-user-token";
        return userAuth;
      }) as never);
    // Simon, in every project the workspace is connected to.
    jest
      .spyOn(WorkspaceUserAuthTokenService, "findBy")
      .mockImplementation((async () => {
        if (!linkedUser) {
          return [];
        }

        return connectedProjects.map(
          (projectId: ObjectID): WorkspaceUserAuthToken => {
            const userAuth: WorkspaceUserAuthToken =
              new WorkspaceUserAuthToken();
            userAuth.userId = linkedUser!;
            userAuth.projectId = projectId;
            userAuth.workspaceUserId = SLACK_USER_ID;
            return userAuth;
          },
        );
      }) as never);
    jest
      .spyOn(WorkspaceActionAuthorization, "isProjectMember")
      .mockResolvedValue(true);
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockImplementation((async (data: { projectId: ObjectID }) => {
        return {
          ...memberProps,
          tenantId: data.projectId,
          userTenantAccessPermission: {
            [data.projectId.toString()]: {
              ...Object.values(
                memberProps.userTenantAccessPermission || {},
              )[0]!,
              projectId: data.projectId,
            },
          },
        };
      }) as never);
    // The form's own check, that the member may declare an incident.
    jest
      .spyOn(WorkspaceActionAuthorization, "authorize")
      .mockImplementation((async () => {
        return memberProps;
      }) as never);

    // The form's lists: one severity, one monitor; none of the rest.
    jest
      .spyOn(WorkspaceActionAuthorization, "findReadable")
      .mockImplementation((async (data: { service: unknown }) => {
        if (data.service === IncidentSeverityService) {
          const severity: IncidentSeverity = new IncidentSeverity();
          severity.id = CRITICAL;
          severity.name = "Critical";
          return [severity];
        }

        if (data.service === MonitorService) {
          const monitor: Monitor = new Monitor();
          monitor.id = CHECKOUT_MONITOR;
          monitor.name = "Checkout API";
          return [monitor];
        }

        return [];
      }) as never);

    // Each kind of resource, a table the stand-in reads as a query asks.
    const recordRead: (read: ResourceRead) => void = (
      read: ResourceRead,
    ): void => {
      resourceReads.push(read);
    };

    for (const kind of WorkspaceAffectedResources.getKinds()) {
      stubResourceTable(kind, recordRead);
    }

    // Which channel is a record's own: the alert's, read as OneUptime.
    jest.spyOn(IncidentService, "findOneBy").mockImplementation((async () => {
      return null;
    }) as never);
    jest
      .spyOn(AlertService, "findOneBy")
      .mockImplementation((async (findOneBy: { query: JSONObject }) => {
        const channels: unknown =
          findOneBy.query["postUpdatesToWorkspaceChannels"];

        if (
          channels !== undefined &&
          JSON.stringify(channels).includes(ALERT_CHANNEL_ID)
        ) {
          const alert: Alert = new Alert();
          alert.id = ALERT_ID;
          alert.createdAt = new Date("2026-11-03T08:00:00.000Z");
          return alert;
        }

        return null;
      }) as never);
    // The alert, as the member reads it.
    jest
      .spyOn(WorkspaceMemberActions, "readEventForMember")
      .mockImplementation((async (data: { event: WorkspaceEvent }) => {
        const alert: Alert = new Alert();
        alert.id = ALERT_ID;
        alert.title = "Disk almost full";
        alert.isPrivate = isAlertPrivate;

        return {
          record: alert,
          event: {
            type: data.event.type,
            id: data.event.id,
            projectId: PROJECT_ID,
            currentStateId: undefined,
            number: 3,
            numberWithPrefix: "ALT-3",
          },
        };
      }) as never);
    jest
      .spyOn(WorkspaceMemberActions, "getStanding")
      .mockImplementation(async (): Promise<WorkspaceEventStanding> => {
        return {
          isAcknowledged: !isAlertOpen,
          isResolved: !isAlertOpen,
          hasStarted: false,
          isComplete: false,
        };
      });
    // What the alert lists: its monitor, a host, and a host of no reach.
    jest.spyOn(LinkedAffectedResources, "readForAlert").mockResolvedValue([
      {
        type: LinkedAffectedResourceType.Monitor,
        id: CHECKOUT_MONITOR.toString(),
        name: "Checkout API",
      },
      { type: LinkedAffectedResourceType.Host, id: API_1, name: "api-1" },
      {
        type: LinkedAffectedResourceType.Host,
        id: OLD_BOX,
        name: "api-old",
      },
    ]);
    jest
      .spyOn(IncidentAlertService, "validateAlertIdsForNewIncident")
      .mockImplementation((async (data: { alertIds: Array<string> }) => {
        if (!mayLinkAlert) {
          throw new BadDataException(
            "You do not have permission to link alerts to incidents in this project.",
          );
        }

        return data.alertIds.map((id: string): ObjectID => {
          return new ObjectID(id);
        });
      }) as never);

    // The declaration itself, as the member.
    jest.spyOn(IncidentService, "create").mockImplementation((async (create: {
      data: Incident;
      miscDataProps?: JSONObject;
      props: DatabaseCommonInteractionProps;
    }) => {
      created.push({
        data: create.data,
        miscDataProps: create.miscDataProps,
        props: create.props,
      });

      const incident: Incident = new Incident();
      incident.id = CREATED_INCIDENT_ID;
      incident.projectId = PROJECT_ID;
      incident.incidentNumber = 43;
      incident.incidentNumberWithPrefix = "INC-43";
      return incident;
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
      const url: string = options.url.toString();
      slackCalls.push({ url: url, data: options.data });

      // The channel a confirmation goes to, and the bot already in it.
      if (url === "https://slack.com/api/conversations.info") {
        return new HTTPResponse<JSONObject>(
          200,
          { ok: true, channel: { name: "ops" } },
          {},
        );
      }

      if (url === "https://slack.com/api/conversations.members") {
        return new HTTPResponse<JSONObject>(
          200,
          { ok: true, members: ["B0BOT"] },
          {},
        );
      }

      return new HTTPResponse<JSONObject>(200, { ok: true }, {});
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function command(
    text: string,
    channelId: string = OPS_CHANNEL_ID,
  ): Promise<RouteAnswer> {
    return postForm({
      port: app.port,
      path: "/api/slack/command",
      fields: slashCommand(text, channelId),
    });
  }

  function askOptions(
    data: Parameters<typeof optionsRequest>[0],
  ): Promise<RouteAnswer> {
    return postForm({
      port: app.port,
      path: "/api/slack/options-load",
      fields: optionsRequest(data),
    });
  }

  function submit(
    data: Parameters<typeof formSubmission>[0],
  ): Promise<RouteAnswer> {
    return postForm({
      port: app.port,
      path: "/api/slack/interactive",
      fields: formSubmission(data),
    });
  }

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
    await slackCallsAfter(Number.MAX_SAFE_INTEGER, 30);
  }

  // The form views.open was sent.
  async function openedForm(): Promise<JSONObject> {
    const calls: Array<SlackCall> = await slackCallsAfter(1);
    const open: SlackCall | undefined = calls.find((call: SlackCall) => {
      return call.url === "https://slack.com/api/views.open";
    });

    expect(open).toBeDefined();

    return open!.data["view"] as JSONObject;
  }

  function blockIdsOf(view: JSONObject): Array<string> {
    return (view["blocks"] as Array<JSONObject>).map(
      (block: JSONObject): string => {
        return String(block["block_id"] || block["type"]);
      },
    );
  }

  function inputOf(view: JSONObject, blockId: string): JSONObject {
    const block: JSONObject | undefined = (
      view["blocks"] as Array<JSONObject>
    ).find((candidate: JSONObject): boolean => {
      return candidate["block_id"] === blockId;
    });

    expect(block).toBeDefined();
    return block!;
  }

  function textOf(blocks: unknown): string {
    return ((blocks as Array<JSONObject> | undefined) || [])
      .map((block: JSONObject): string => {
        return String(
          (block["text"] as JSONObject | undefined)?.["text"] || "",
        );
      })
      .join("\n")
      .split(ZERO_WIDTH_SPACE)
      .join("");
  }

  function groupsOf(answer: RouteAnswer): Array<{
    label: string;
    options: Array<string>;
  }> {
    return ((answer.body?.["option_groups"] as Array<JSONObject>) || []).map(
      (group: JSONObject) => {
        return {
          label: String((group["label"] as JSONObject)["text"]),
          options: (group["options"] as Array<JSONObject>).map(
            (option: JSONObject): string => {
              return `${String((option["text"] as JSONObject)["text"])} = ${String(option["value"])}`;
            },
          ),
        };
      },
    );
  }

  // The confirmation chat.postMessage posted, and what only Simon was told.
  function postedTo(
    url: string,
  ): Array<{ channel: string; text: string; user: string | undefined }> {
    return slackCalls
      .filter((call: SlackCall): boolean => {
        return call.url === url;
      })
      .map((call: SlackCall) => {
        return {
          channel: String(call.data["channel"]),
          text: textOf(call.data["blocks"]),
          user:
            typeof call.data["user"] === "string"
              ? (call.data["user"] as string)
              : undefined,
        };
      });
  }

  describe("the form", () => {
    test("Affected Resources comes right after the severity, searched as the person types; the Monitors field says what a pick there does", async () => {
      const answer: RouteAnswer = await command("incident Checkout is slow");

      expect(answer.status).toBe(200);

      const view: JSONObject = await openedForm();

      expect(view["callback_id"]).toBe("SubmitNewIncident");
      expect(blockIdsOf(view)).toEqual([
        "incidentTitle",
        "incidentDescription",
        "incidentSeverity",
        "affectedResources",
        "incidentMonitors",
      ]);

      const field: JSONObject = inputOf(view, "affectedResources");
      expect(field["optional"]).toBe(true);
      expect(field["label"]).toEqual({
        type: "plain_text",
        text: "Affected Resources",
      });
      expect(field["hint"]).toEqual({
        type: "plain_text",
        text: "OneUptime AI investigates what you pick here, and can fix it.",
      });

      const element: JSONObject = field["element"] as JSONObject;
      expect(element["type"]).toBe("multi_external_select");
      expect(element["min_query_length"]).toBe(0);
      // No list goes with the form: not one resource's name is in it.
      expect(element["options"]).toBeUndefined();
      expect(element["option_groups"]).toBeUndefined();
      expect(JSON.stringify(view)).not.toContain("api-1");

      expect(inputOf(view, "incidentMonitors")["hint"]).toEqual({
        type: "plain_text",
        text: "A monitor you pick here pauses its checks until the incident is resolved.",
      });

      // Whether there is anything to offer: one host read, as the member, in the project.
      const offerReads: Array<ResourceRead> = resourceReads.filter(
        (read: ResourceRead): boolean => {
          return read.how === "findBy";
        },
      );
      expect(offerReads).toHaveLength(1);
      expect(offerReads[0]!.kind).toBe(AiAffectedResourceKind.Host);
      expect(String(offerReads[0]!.query["projectId"])).toBe(
        PROJECT_ID.toString(),
      );
      expect(offerReads[0]!.props.userId).toEqual(SIMON);

      // The form carries the channel, and the project it was drawn for.
      expect(JSON.parse(view["private_metadata"] as string)).toEqual({
        oneuptime: 1,
        value: OPS_CHANNEL_ID,
        channelId: OPS_CHANNEL_ID,
        projectId: PROJECT_ID.toString(),
      });
    });

    test("a project whose AI is off: the field all the same, with no hint about AI", async () => {
      isAiOn = false;

      await command("incident");

      const view: JSONObject = await openedForm();
      const field: JSONObject = inputOf(view, "affectedResources");

      expect(field["hint"]).toBeUndefined();
      expect(JSON.stringify(view)).not.toContain("OneUptime AI");
      // The Monitors field still says what a pick there does.
      expect(inputOf(view, "incidentMonitors")["hint"]).toEqual({
        type: "plain_text",
        text: "A monitor you pick here pauses its checks until the incident is resolved.",
      });
    });

    test("a member whose role reads no kind of resource gets the form without the field, and nothing is read for it", async () => {
      memberProps = propsWith([
        Permission.CreateProjectIncident,
        Permission.ReadProjectIncident,
        Permission.ReadProjectMonitor,
      ]);

      await command("incident");

      const view: JSONObject = await openedForm();

      expect(blockIdsOf(view)).not.toContain("affectedResources");
      expect(resourceReads).toEqual([]);
    });
  });

  describe("the field's options, asked of the Options Load URL", () => {
    async function formMetadata(): Promise<string> {
      await command("incident");
      const view: JSONObject = await openedForm();
      slackCalls = [];
      resourceReads = [];
      return view["private_metadata"] as string;
    }

    test("what was typed finds the project's resources, a heading for each kind, read as the member in the form's project", async () => {
      const answer: RouteAnswer = await askOptions({
        privateMetadata: await formMetadata(),
        value: "api",
      });

      expect(answer.status).toBe(200);
      expect(groupsOf(answer)).toEqual([
        {
          label: "Hosts",
          options: [`api-1 = Host:${API_1}`, `api-2 = Host:${API_2}`],
        },
        {
          label: "Services",
          options: [`checkout-api = Service:${CHECKOUT_SERVICE}`],
        },
      ]);

      // Every kind read with Simon's own props, in the project only.
      expect(resourceReads.length).toBeGreaterThan(0);
      for (const read of resourceReads) {
        expect({
          kind: read.kind,
          projectId: String(read.query["projectId"]),
          userId: read.props.userId?.toString(),
          isRoot: read.props.isRoot === true,
        }).toEqual({
          kind: read.kind,
          projectId: PROJECT_ID.toString(),
          userId: SIMON.toString(),
          isRoot: false,
        });
      }

      // Never a monitor: those are picked under Monitors.
      expect(JSON.stringify(answer.body)).not.toContain("Checkout API");
      // Nothing was said to anybody.
      await settle();
      expect(slackCalls).toEqual([]);
    });

    test("opening it, before anything is typed: the first of each kind, an archived one never among them", async () => {
      const answer: RouteAnswer = await askOptions({
        privateMetadata: await formMetadata(),
        value: "",
      });

      expect(groupsOf(answer)).toEqual([
        {
          label: "Hosts",
          options: [`api-1 = Host:${API_1}`, `api-2 = Host:${API_2}`],
        },
        {
          label: "Network Devices",
          options: [`core-sw-01 = NetworkDevice:${CORE_SWITCH}`],
        },
        {
          label: "Kubernetes Clusters",
          options: [`prod = KubernetesCluster:${PROD_CLUSTER}`],
        },
        {
          label: "Services",
          options: [`checkout-api = Service:${CHECKOUT_SERVICE}`],
        },
      ]);
      expect(JSON.stringify(answer.body)).not.toContain("api-old");
      expect(JSON.stringify(answer.body)).not.toContain("api-staging");

      // A network device is told apart by its address, under its name.
      const devices: JSONObject = (
        answer.body!["option_groups"] as Array<JSONObject>
      )[1]!;
      expect(
        (
          (devices["options"] as Array<JSONObject>)[0]![
            "description"
          ] as JSONObject
        )["text"],
      ).toBe("10.0.4.1");
    });

    test("a Slack account nobody connected is listed nothing - and nobody is messaged", async () => {
      const privateMetadata: string = await formMetadata();
      linkedUser = null;

      const answer: RouteAnswer = await askOptions({
        privateMetadata: privateMetadata,
        value: "api",
      });

      expect(answer.status).toBe(200);
      expect(answer.body).toEqual({ options: [] });
      expect(resourceReads).toEqual([]);

      await settle();
      expect(slackCalls).toEqual([]);
    });

    test("a member whose role reads no kind of resource is listed nothing, and no kind is read", async () => {
      const privateMetadata: string = await formMetadata();
      memberProps = propsWith([
        Permission.CreateProjectIncident,
        Permission.ReadProjectIncident,
      ]);

      const answer: RouteAnswer = await askOptions({
        privateMetadata: privateMetadata,
        value: "api",
      });

      expect(answer.body).toEqual({ options: [] });
      expect(resourceReads).toEqual([]);
    });

    test("a request of another select is listed nothing, and never read", async () => {
      const answer: RouteAnswer = await askOptions({
        privateMetadata: await formMetadata(),
        value: "api",
        actionId: "labels",
      });

      expect(answer.body).toEqual({ options: [] });
      expect(resourceReads).toEqual([]);
    });

    test("in a workspace connected to two projects, a form drawn for the second searches the second only", async () => {
      connectedProjects = [PROJECT_ID, STAGING_PROJECT_ID];

      const answer: RouteAnswer = await askOptions({
        privateMetadata: JSON.stringify({
          oneuptime: 1,
          value: OPS_CHANNEL_ID,
          channelId: OPS_CHANNEL_ID,
          projectId: STAGING_PROJECT_ID.toString(),
        }),
        value: "api",
      });

      expect(groupsOf(answer)).toEqual([
        {
          label: "Hosts",
          options: [`api-staging = Host:${STAGING_API}`],
        },
      ]);

      for (const read of resourceReads) {
        expect(String(read.query["projectId"])).toBe(
          STAGING_PROJECT_ID.toString(),
        );
        expect(read.props.tenantId?.toString()).toBe(
          STAGING_PROJECT_ID.toString(),
        );
      }
    });

    test("in that workspace, a form that names a project it is not connected to is no clue, and Simon in both is listed nothing", async () => {
      connectedProjects = [PROJECT_ID, STAGING_PROJECT_ID];

      const answer: RouteAnswer = await askOptions({
        privateMetadata: JSON.stringify({
          oneuptime: 1,
          value: "",
          projectId: "d3c10000-0000-4000-8000-0000000000ff",
        }),
        value: "api",
      });

      expect(answer.body).toEqual({ options: [] });
      expect(resourceReads).toEqual([]);

      await settle();
      expect(slackCalls).toEqual([]);
    });
  });

  describe("the submission", () => {
    test("the picks are read again as the member and linked, each in its kind's list; the confirmation says what it is linked to", async () => {
      await command("incident");
      const view: JSONObject = await openedForm();
      slackCalls = [];
      resourceReads = [];

      const answer: RouteAnswer = await submit({
        privateMetadata: view["private_metadata"] as string,
        title: "Checkout is slow",
        picks: [
          { value: `Host:${API_1}`, text: "api-1" },
          { value: `KubernetesCluster:${PROD_CLUSTER}`, text: "prod" },
        ],
      });

      expect(answer.status).toBe(200);
      expect(answer.body).toEqual({ response_action: "clear" });

      const posted: Array<{ channel: string; text: string }> =
        await (async (): Promise<Array<{ channel: string; text: string }>> => {
          await slackCallsAfter(1);
          await settle();
          return postedTo("https://slack.com/api/chat.postMessage");
        })();

      expect(created).toHaveLength(1);
      const incident: Incident = created[0]!.data;
      expect(
        (incident.hosts || []).map((row: BaseModel): string => {
          return row.id!.toString();
        }),
      ).toEqual([API_1]);
      expect(
        (incident.kubernetesClusters || []).map((row: BaseModel): string => {
          return row.id!.toString();
        }),
      ).toEqual([PROD_CLUSTER]);
      // No monitor was picked, and none was put in for the person.
      expect(incident.monitors).toBeUndefined();
      // Declared as Simon, with his own props.
      expect(created[0]!.props).toBe(memberProps);
      expect(created[0]!.miscDataProps).toBeUndefined();

      // The picks read again as Simon, in the project.
      expect(resourceReads.length).toBeGreaterThan(0);
      for (const read of resourceReads) {
        expect(read.props.userId?.toString()).toBe(SIMON.toString());
        expect(String(read.query["projectId"])).toBe(PROJECT_ID.toString());
      }

      expect(posted).toEqual([
        {
          channel: OPS_CHANNEL_ID,
          text: `*Incident INC-43* created successfully. <${INCIDENT_URL}|View Incident>\nLinked to *api-1* (Host) and *prod* (Kubernetes Cluster).\n`,
        },
      ]);
      // Everything was linked: nothing more is said.
      expect(postedTo("https://slack.com/api/chat.postEphemeral")).toEqual([]);
    });

    test("nothing picked: declared as always, linked to nothing, and the confirmation says no more than it did", async () => {
      await command("incident");
      const view: JSONObject = await openedForm();
      slackCalls = [];

      await submit({
        privateMetadata: view["private_metadata"] as string,
        title: "Checkout is slow",
        picks: [],
      });

      await slackCallsAfter(1);
      await settle();

      expect(created).toHaveLength(1);
      expect(created[0]!.data.hosts).toBeUndefined();
      expect(postedTo("https://slack.com/api/chat.postMessage")).toEqual([
        {
          channel: OPS_CHANNEL_ID,
          text: `*Incident INC-43* created successfully. <${INCIDENT_URL}|View Incident>\n`,
        },
      ]);
    });

    /*
     * The app's Home tab has no channel: a form opened there - its Declare
     * incident button - carries only its project. It used to be declared
     * and confirmed nowhere; Simon is told, in his direct messages with the
     * app, as what was not linked is told to him.
     */
    test("a form opened where there is no channel - the app's Home tab: confirmed to Simon alone, in his direct messages with the app", async () => {
      const answer: RouteAnswer = await submit({
        privateMetadata: JSON.stringify({
          oneuptime: 1,
          value: "",
          projectId: PROJECT_ID.toString(),
        }),
        title: "Checkout is slow",
        picks: [{ value: `Host:${API_1}`, text: "api-1" }],
      });

      expect(answer.status).toBe(200);
      expect(answer.body).toEqual({ response_action: "clear" });

      await slackCallsAfter(1);
      await settle();

      expect(created).toHaveLength(1);
      // Posted to Simon himself: Slack opens his direct messages with the app.
      expect(postedTo("https://slack.com/api/chat.postMessage")).toEqual([
        {
          channel: SLACK_USER_ID,
          text: `*Incident INC-43* created successfully. <${INCIDENT_URL}|View Incident>\nLinked to *api-1* (Host).\n`,
          user: undefined,
        },
      ]);

      const dm: SlackCall = slackCalls.find((call: SlackCall): boolean => {
        return call.url === "https://slack.com/api/chat.postMessage";
      })!;

      // What its notification says.
      expect(dm.data["text"]).toBe("Incident INC-43 created successfully.");
      expect(postedTo("https://slack.com/api/chat.postEphemeral")).toEqual([]);
    });

    test("a pick that is not the project's, or archived since: declared without it, and only Simon is told", async () => {
      await command("incident");
      const view: JSONObject = await openedForm();
      slackCalls = [];

      await submit({
        privateMetadata: view["private_metadata"] as string,
        title: "Checkout is slow",
        picks: [
          { value: `Host:${API_2}`, text: "api-2" },
          { value: `Host:${STAGING_API}`, text: "api-staging" },
          { value: `Host:${OLD_BOX}`, text: "api-old" },
        ],
      });

      await slackCallsAfter(2);
      await settle();

      expect(
        (created[0]!.data.hosts || []).map((row: BaseModel): string => {
          return row.id!.toString();
        }),
      ).toEqual([API_2]);
      expect(postedTo("https://slack.com/api/chat.postMessage")[0]!.text).toBe(
        `*Incident INC-43* created successfully. <${INCIDENT_URL}|View Incident>\nLinked to *api-2* (Host).\n`,
      );
      // It names the incident: it may be read away from the confirmation.
      expect(postedTo("https://slack.com/api/chat.postEphemeral")).toEqual([
        {
          channel: OPS_CHANNEL_ID,
          user: SLACK_USER_ID,
          text: `The incident *<${INCIDENT_URL}|INC-43>* is not linked to 2 resources you picked: they were deleted or archived, or you may no longer view them.\n`,
        },
      ]);
    });
  });

  /*
   * The form asks nothing about status page subscribers. Where the project
   * starts Notify Status Page Subscribers unticked on Declare New Incident,
   * an incident declared here tells them nothing either; anywhere else it is
   * declared exactly as before, the column not written at all.
   */
  describe("status page subscribers, as the project starts Notify Status Page Subscribers", () => {
    async function declare(): Promise<Incident> {
      await command("incident");
      const view: JSONObject = await openedForm();
      slackCalls = [];

      await submit({
        privateMetadata: view["private_metadata"] as string,
        title: "Checkout is slow",
        picks: [],
      });

      await slackCallsAfter(1);
      await settle();

      expect(created).toHaveLength(1);
      return created[0]!.data;
    }

    test("a project that starts the box unticked: declared without notifying them, the project read as OneUptime for that one column", async () => {
      notifiesByDefault = false;

      const incident: Incident = await declare();

      expect(
        incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
      ).toBe(false);
      // Still declared as Simon, and confirmed as always.
      expect(created[0]!.props).toBe(memberProps);
      expect(postedTo("https://slack.com/api/chat.postMessage")).toEqual([
        {
          channel: OPS_CHANNEL_ID,
          text: `*Incident INC-43* created successfully. <${INCIDENT_URL}|View Incident>\n`,
        },
      ]);
      expect(projectReads).toEqual([
        {
          id: PROJECT_ID,
          select: { notifyStatusPageSubscribersOfNewIncidentsByDefault: true },
          props: { isRoot: true },
        },
      ]);
    });

    test("a project that keeps it on: declared as always - the column is not written, so the incident notifies them", async () => {
      const incident: Incident = await declare();

      expect(
        incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
      ).toBeUndefined();
      expect(projectReads).toHaveLength(1);
    });

    test("a project that cannot be read: declared all the same, as always", async () => {
      jest.spyOn(logger, "warn").mockImplementation((): void => {});
      jest
        .spyOn(ProjectService, "findOneById")
        .mockImplementation((async () => {
          throw new Error("the database is not connected");
        }) as never);

      const incident: Incident = await declare();

      expect(
        incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
      ).toBeUndefined();
      expect(postedTo("https://slack.com/api/chat.postMessage")).toHaveLength(
        1,
      );
    });

    test("in a workspace connected to two projects, the project the form was drawn for decides - not the first one connected", async () => {
      connectedProjects = [PROJECT_ID, STAGING_PROJECT_ID];
      // Staging starts the box unticked; the first project keeps it ticked.
      jest.spyOn(ProjectService, "findOneById").mockImplementation((async (
        findOneById: JSONObject,
      ) => {
        projectReads.push(findOneById);

        const project: Project = new Project();
        project.id = findOneById["id"] as ObjectID;
        project.notifyStatusPageSubscribersOfNewIncidentsByDefault =
          String(findOneById["id"]) !== STAGING_PROJECT_ID.toString();
        return project;
      }) as never);

      const answer: RouteAnswer = await submit({
        privateMetadata: JSON.stringify({
          oneuptime: 1,
          value: OPS_CHANNEL_ID,
          projectId: STAGING_PROJECT_ID.toString(),
        }),
        title: "Checkout is slow",
        picks: [],
      });

      expect(answer.status).toBe(200);
      await slackCallsAfter(1);
      await settle();

      expect(created).toHaveLength(1);
      expect(created[0]!.data.projectId?.toString()).toBe(
        STAGING_PROJECT_ID.toString(),
      );
      expect(
        created[0]!.data.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
      ).toBe(false);
      expect(
        projectReads.map((read: JSONObject): string => {
          return String(read["id"]);
        }),
      ).toEqual([STAGING_PROJECT_ID.toString()]);
    });
  });

  describe("in an alert's own channel", () => {
    test("the form says it is declared from the alert, starts from its title and its resources Simon may view - never its monitor", async () => {
      await command("incident", ALERT_CHANNEL_ID);

      const view: JSONObject = await openedForm();
      const blocks: Array<JSONObject> = view["blocks"] as Array<JSONObject>;

      // The alert by its number: its title is the form's title, right below.
      expect(textOf([blocks[0]])).toBe(
        `This incident will be linked to *<${ALERT_URL}|Alert ALT-3>*.\n`,
      );
      expect(
        (inputOf(view, "incidentTitle")["element"] as JSONObject)[
          "initial_value"
        ],
      ).toBe("Disk almost full");

      const element: JSONObject = inputOf(view, "affectedResources")[
        "element"
      ] as JSONObject;
      expect(element["initial_options"]).toEqual([
        {
          text: { type: "plain_text", text: "api-1" },
          value: `Host:${API_1}`,
        },
      ]);
      // Its monitor is never picked for Simon: it would pause its checks.
      expect(
        (inputOf(view, "incidentMonitors")["element"] as JSONObject)[
          "initial_options"
        ],
      ).toBeUndefined();

      // The form carries the alert it is declared from, for its submission.
      expect(JSON.parse(view["private_metadata"] as string)).toEqual({
        oneuptime: 1,
        value: `alert:${ALERT_ID.toString()}`,
        channelId: ALERT_CHANNEL_ID,
        projectId: PROJECT_ID.toString(),
      });
    });

    test("a title typed with the command is the title", async () => {
      await command("incident Disk full on api-1", ALERT_CHANNEL_ID);

      const view: JSONObject = await openedForm();

      expect(
        (inputOf(view, "incidentTitle")["element"] as JSONObject)[
          "initial_value"
        ],
      ).toBe("Disk full on api-1");
    });

    test("submitted: the incident is linked to the alert, as one declared from it in the Dashboard, and the confirmation says so", async () => {
      await command("incident", ALERT_CHANNEL_ID);
      const view: JSONObject = await openedForm();
      slackCalls = [];

      await submit({
        privateMetadata: view["private_metadata"] as string,
        title: "Disk almost full",
        picks: [{ value: `Host:${API_1}`, text: "api-1" }],
      });

      await slackCallsAfter(1);
      await settle();

      expect(created).toHaveLength(1);
      expect(created[0]!.miscDataProps).toEqual({
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: [ALERT_ID.toString()],
      });
      expect(created[0]!.data.isPrivate).toBeUndefined();
      expect(postedTo("https://slack.com/api/chat.postMessage")).toEqual([
        {
          channel: ALERT_CHANNEL_ID,
          text: `*Incident INC-43* created successfully. <${INCIDENT_URL}|View Incident>\nLinked to *<${ALERT_URL}|Alert ALT-3>* and *api-1* (Host).\n`,
        },
      ]);
    });

    test("a private alert's incident is private, as the Dashboard declares it, and the form says so", async () => {
      isAlertPrivate = true;

      await command("incident", ALERT_CHANNEL_ID);
      const view: JSONObject = await openedForm();
      slackCalls = [];

      expect(textOf([(view["blocks"] as Array<JSONObject>)[0]])).toBe(
        `This incident will be linked to *<${ALERT_URL}|Alert ALT-3>*. Like the alert, it will be private.\n`,
      );

      await submit({
        privateMetadata: view["private_metadata"] as string,
        title: "Disk almost full",
        picks: [],
      });

      await slackCallsAfter(1);
      await settle();

      expect(created[0]!.data.isPrivate).toBe(true);
    });

    test("Simon may not link alerts: declared all the same, not linked, and only he is told why", async () => {
      await command("incident", ALERT_CHANNEL_ID);
      const view: JSONObject = await openedForm();
      slackCalls = [];
      mayLinkAlert = false;

      await submit({
        privateMetadata: view["private_metadata"] as string,
        title: "Disk almost full",
        picks: [],
      });

      await slackCallsAfter(2);
      await settle();

      expect(created).toHaveLength(1);
      expect(created[0]!.miscDataProps).toBeUndefined();
      expect(postedTo("https://slack.com/api/chat.postMessage")[0]!.text).toBe(
        `*Incident INC-43* created successfully. <${INCIDENT_URL}|View Incident>\n`,
      );
      expect(postedTo("https://slack.com/api/chat.postEphemeral")).toEqual([
        {
          channel: ALERT_CHANNEL_ID,
          user: SLACK_USER_ID,
          text: `The incident *<${INCIDENT_URL}|INC-43>* is not linked to *<${ALERT_URL}|Alert ALT-3>*. You do not have permission to link alerts to incidents in this project.\n`,
        },
      ]);
    });

    test("Simon may not link alerts, as the form opens: the form says it will not be linked, and why - never a promise it cannot keep", async () => {
      mayLinkAlert = false;

      await command("incident", ALERT_CHANNEL_ID);
      const view: JSONObject = await openedForm();

      expect(textOf([(view["blocks"] as Array<JSONObject>)[0]])).toBe(
        `This incident will not be linked to *<${ALERT_URL}|Alert ALT-3>*. You do not have permission to link alerts to incidents in this project.\n`,
      );
      // It still starts from the alert: its title, and what Simon may view of it.
      expect(
        (inputOf(view, "incidentTitle")["element"] as JSONObject)[
          "initial_value"
        ],
      ).toBe("Disk almost full");
      expect(
        (inputOf(view, "affectedResources")["element"] as JSONObject)[
          "initial_options"
        ],
      ).toEqual([
        {
          text: { type: "plain_text", text: "api-1" },
          value: `Host:${API_1}`,
        },
      ]);
    });

    test("a private alert Simon may not link: declared without the link, private all the same, and he is told so", async () => {
      isAlertPrivate = true;
      mayLinkAlert = false;

      await command("incident", ALERT_CHANNEL_ID);
      const view: JSONObject = await openedForm();
      slackCalls = [];

      expect(textOf([(view["blocks"] as Array<JSONObject>)[0]])).toBe(
        `This incident will not be linked to *<${ALERT_URL}|Alert ALT-3>*. You do not have permission to link alerts to incidents in this project. Like the alert, it will be private.\n`,
      );

      await submit({
        privateMetadata: view["private_metadata"] as string,
        title: "Disk almost full",
        picks: [],
      });

      await slackCallsAfter(2);
      await settle();

      expect(created).toHaveLength(1);
      expect(created[0]!.miscDataProps).toBeUndefined();
      // Its title came from a private alert: never a public incident.
      expect(created[0]!.data.isPrivate).toBe(true);
      expect(postedTo("https://slack.com/api/chat.postEphemeral")).toEqual([
        {
          channel: ALERT_CHANNEL_ID,
          user: SLACK_USER_ID,
          text: `The incident *<${INCIDENT_URL}|INC-43>* is not linked to *<${ALERT_URL}|Alert ALT-3>*. You do not have permission to link alerts to incidents in this project. Like the alert, it is private.\n`,
        },
      ]);
    });

    test("a resolved alert's channel is no longer the alert's: the plain form, linked to nothing", async () => {
      isAlertOpen = false;

      await command("incident", ALERT_CHANNEL_ID);
      const view: JSONObject = await openedForm();

      expect(blockIdsOf(view)[0]).toBe("incidentTitle");
      expect(JSON.parse(view["private_metadata"] as string)["value"]).toBe(
        ALERT_CHANNEL_ID,
      );
    });
  });
});
