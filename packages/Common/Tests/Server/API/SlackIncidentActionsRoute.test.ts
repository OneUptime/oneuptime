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
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import Permission, { UserPermission } from "../../../Types/Permission";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentMember from "../../../Models/DatabaseModels/IncidentMember";
import IncidentRole from "../../../Models/DatabaseModels/IncidentRole";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentInternalNoteService from "../../../Server/Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "../../../Server/Services/IncidentPublicNoteService";
import IncidentMemberService from "../../../Server/Services/IncidentMemberService";
import IncidentRoleService from "../../../Server/Services/IncidentRoleService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import OnCallPageService, {
  OnCallPageRecordType,
  OnCallPageResult,
  OnCallPageTargets,
} from "../../../Server/Services/OnCallPageService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import ProductBrandingText from "../../../Server/Utils/ProductBrandingText";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceConnectRequest, {
  WorkspaceConnectRequestAgainKind,
  WorkspaceConnectRequestRecord,
} from "../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import WorkspaceIncidentCustomFields from "../../../Server/Utils/Workspace/WorkspaceIncidentCustomFields";
import WorkspaceMemberActions, {
  WorkspaceEventStanding,
} from "../../../Server/Utils/Workspace/WorkspaceMemberActions";
import WorkspacePage, {
  WorkspacePageChoiceGroup,
  WorkspacePageTargetKind,
} from "../../../Server/Utils/Workspace/WorkspacePage";
import { CONNECT_REQUEST_TOKEN_PATTERN } from "../../../Types/Workspace/ConnectCallback";

/*
 * ACTING ON AN INCIDENT FROM SLACK, THROUGH SLACK'S OWN ENDPOINTS.
 *
 * Customer feedback: "incident actions (set a custom fields, escalate to
 * someone else, etc.) cannot be triggered directly from Slack (requiring
 * users to use the web UI), and the /incident command only creates
 * incidents."
 *
 * An incident's message has a menu (⋯) - Change Severity, Change Incident
 * State, Assign Role, Page Someone, Edit Custom Fields - and
 * `/oneuptime incident 42` shows incident 42 with its buttons and menu.
 * These post what Slack posts - a choice of the menu, a form's submission,
 * the slash command - through the real SlackAPI router, authorization,
 * handlers and answers; only the database under them is stood in for, by a
 * project with one incident. Every request made to Slack is pinned, and
 * every write: as the member the Slack account is connected to.
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
// The incident's own channel, which a notification rule created for it.
const INCIDENT_CHANNEL_ID: string = "C0INC42";
const OPS_CHANNEL_ID: string = "C0OPS";
const TRIGGER_ID: string = "1760000000.trigger";
const COMMAND_RESPONSE_URL: string =
  "https://hooks.slack.com/commands/T0TEAM/1760000000/incAbc123";
const PRESS_RESPONSE_URL: string =
  "https://hooks.slack.com/actions/T0TEAM/1760000000/incDef456";
const ZERO_WIDTH_SPACE: string = String.fromCharCode(0x200b);

const PROJECT_ID: ObjectID = new ObjectID(
  "c5000000-0000-4000-8000-000000000001",
);
const SIMON: ObjectID = new ObjectID("c5000000-0000-4000-8000-0000000000a1");
const NAWAZ: ObjectID = new ObjectID("c5000000-0000-4000-8000-0000000000a2");
const ANA: ObjectID = new ObjectID("c5000000-0000-4000-8000-0000000000a3");
const INCIDENT_ID: ObjectID = new ObjectID(
  "c5000000-0000-4000-8000-0000000000b1",
);
const CRITICAL: ObjectID = new ObjectID("c5000000-0000-4000-8000-0000000000c1");
const MINOR: ObjectID = new ObjectID("c5000000-0000-4000-8000-0000000000c2");
const COMMANDER: ObjectID = new ObjectID(
  "c5000000-0000-4000-8000-0000000000d1",
);
const SCRIBE: ObjectID = new ObjectID("c5000000-0000-4000-8000-0000000000d2");
const ANA_AS_COMMANDER: ObjectID = new ObjectID(
  "c5000000-0000-4000-8000-0000000000e1",
);
const IMPACT_FIELD: ObjectID = new ObjectID(
  "c5000000-0000-4000-8000-0000000000f1",
);
const TICKET_FIELD: ObjectID = new ObjectID(
  "c5000000-0000-4000-8000-0000000000f2",
);
const USERS_FIELD: ObjectID = new ObjectID(
  "c5000000-0000-4000-8000-0000000000f3",
);
const PUBLIC_FIELD: ObjectID = new ObjectID(
  "c5000000-0000-4000-8000-0000000000f4",
);
const DUE_FIELD: ObjectID = new ObjectID(
  "c5000000-0000-4000-8000-0000000000f5",
);
const STARTED_FIELD: ObjectID = new ObjectID(
  "c5000000-0000-4000-8000-0000000000f6",
);
const IDENTIFIED: ObjectID = new ObjectID(
  "c5000000-0000-4000-8000-000000000101",
);
const RESOLVED: ObjectID = new ObjectID("c5000000-0000-4000-8000-000000000102");
const PRIMARY_SCHEDULE: ObjectID = new ObjectID(
  "c5000000-0000-4000-8000-000000000201",
);

const INCIDENT_URL: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/incidents/${INCIDENT_ID.toString()}`;

// A member's props, with the permissions of their role in the project.
function propsWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: SIMON,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
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

// Simon, the member the Slack account is connected to, as the gate reads him.
const PROPS: DatabaseCommonInteractionProps = propsWith([
  Permission.ProjectMember,
]);

const NAMES: Record<string, string> = {
  [SIMON.toString()]: "Simon Lee",
  [NAWAZ.toString()]: "Nawaz Dhandala",
  [ANA.toString()]: "Ana Ruiz",
};

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

// What the project's one incident holds, as the stand-in database has it.
interface StoredIncident {
  severityId: ObjectID;
  stateId: ObjectID;
  customFields: JSONObject;
  holders: Array<{ memberId: ObjectID; userId: ObjectID; roleId: ObjectID }>;
}

function userOf(id: ObjectID): User {
  const user: User = new User();
  user.id = id;
  user.name = new Name(NAMES[id.toString()] || "Someone");
  return user;
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
    channel_name: channelId === INCIDENT_CHANNEL_ID ? "incident-42" : "ops",
    user_id: SLACK_USER_ID,
    user_name: "simon",
    command: "/oneuptime",
    text: text,
    api_app_id: "A0ONEUPTIME",
    response_url: COMMAND_RESPONSE_URL,
    trigger_id: TRIGGER_ID,
  };
}

/*
 * What Slack posts when an item of the incident message's menu (⋯) is
 * chosen: the overflow element's one action id, and the option's value.
 * On the incident's message in its channel, or - `isEphemeral` - on the
 * incident a command showed, which only Simon sees.
 */
function menuChoice(
  value: string,
  options: { isEphemeral?: boolean } = {},
): Record<string, string> {
  return {
    payload: JSON.stringify({
      type: "block_actions",
      user: { id: SLACK_USER_ID, username: "simon", name: "simon" },
      team: { id: SLACK_TEAM_ID },
      channel: { id: INCIDENT_CHANNEL_ID, name: "incident-42" },
      container: {
        type: "message",
        channel_id: INCIDENT_CHANNEL_ID,
        message_ts: "1760000000.000200",
        ...(options.isEphemeral ? { is_ephemeral: true } : {}),
      },
      ...(options.isEphemeral ? {} : { message: { ts: "1760000000.000200" } }),
      response_url: PRESS_RESPONSE_URL,
      trigger_id: TRIGGER_ID,
      actions: [
        {
          type: "overflow",
          action_id: "MoreActions",
          block_id: "incident-buttons",
          selected_option: {
            text: { type: "plain_text", text: "an item", emoji: true },
            value: value,
          },
          action_ts: "1760000001.000300",
        },
      ],
    }),
  };
}

// The block values of a submitted form, as Slack sends a view's state.
type ViewState = Record<string, JSONObject>;

/*
 * What Slack posts when a form of the menu is submitted: the view, with
 * what was filled in, and the metadata the form was opened with.
 */
function formSubmission(data: {
  callbackId: string;
  privateMetadata: string;
  state: ViewState;
}): Record<string, string> {
  const values: JSONObject = {};

  for (const [blockId, value] of Object.entries(data.state)) {
    values[blockId] = { [blockId]: value };
  }

  return {
    payload: JSON.stringify({
      type: "view_submission",
      team: { id: SLACK_TEAM_ID },
      user: { id: SLACK_USER_ID, username: "simon", name: "simon" },
      trigger_id: TRIGGER_ID,
      view: {
        callback_id: data.callbackId,
        private_metadata: data.privateMetadata,
        state: { values: values },
      },
    }),
  };
}

function staticSelect(value: string | null): JSONObject {
  return {
    type: "static_select",
    selected_option: value ? { value: value, text: { text: value } } : null,
  };
}

function multiSelect(values: Array<string>): JSONObject {
  return {
    type: "multi_static_select",
    selected_options: values.map((value: string) => {
      return { value: value, text: { text: value } };
    }),
  };
}

function textInput(value: string | null): JSONObject {
  return { type: "plain_text_input", value: value };
}

function numberInput(value: string | null): JSONObject {
  return { type: "number_input", value: value };
}

function datePicker(day: string | null): JSONObject {
  return { type: "datepicker", selected_date: day };
}

function dateTimePicker(seconds: number | null): JSONObject {
  return { type: "datetimepicker", selected_date_time: seconds };
}

function customFieldInputId(id: ObjectID): string {
  return WorkspaceIncidentCustomFields.getInputId(id);
}

describe("acting on an incident from Slack: its message's menu, and /oneuptime incident <number>", () => {
  let app: RoutePort;
  let slackCalls: Array<SlackCall>;
  let linkedUser: ObjectID | null;
  let isMember: boolean;
  // Each permission the member's role may lack, by what it lets them do.
  let mayUpdateIncident: boolean;
  let mayAssignRoles: boolean;
  let mayPage: boolean;
  let isOnPlan: boolean;
  let incident: StoredIncident;
  let isIncidentReadable: boolean;
  // Simon's props, as the gate reads his role.
  let memberProps: DatabaseCommonInteractionProps;
  let viewsOpenError: string | null;
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

  beforeAll(async () => {
    app = await startSlackApp();
  }, 600000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    slackCalls = [];
    linkedUser = SIMON;
    isMember = true;
    mayUpdateIncident = true;
    mayAssignRoles = true;
    mayPage = true;
    isOnPlan = true;
    isIncidentReadable = true;
    memberProps = PROPS;
    viewsOpenError = null;
    updates = [];
    membersCreated = [];
    membersDeleted = [];
    pages = [];
    incidentReads = [];
    incident = {
      severityId: MINOR,
      stateId: IDENTIFIED,
      customFields: {
        "Customer Impact": "Medium",
        Ticket: "OPS-118",
        "Affected Users": 1200,
      },
      holders: [{ memberId: ANA_AS_COMMANDER, userId: ANA, roleId: COMMANDER }],
    };

    (
      jest.requireMock("../../../Server/Infrastructure/GlobalCache") as {
        default: { store: Map<string, unknown> };
      }
    ).default.store.clear();

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
      .mockImplementation((async () => {
        const projectAuth: WorkspaceProjectAuthToken =
          new WorkspaceProjectAuthToken();
        projectAuth.projectId = PROJECT_ID;
        projectAuth.authToken = "xoxb-project-token";
        projectAuth.miscData = { botUserId: "B0BOT" } as never;
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
      .mockImplementation((async () => {
        if (!linkedUser) {
          return null;
        }

        const userAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
        userAuth.userId = linkedUser;
        userAuth.authToken = "xoxp-user-token";
        return userAuth;
      }) as never);
    jest
      .spyOn(WorkspaceActionAuthorization, "isProjectMember")
      .mockImplementation(async () => {
        return isMember;
      });
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockImplementation(async () => {
        if (!isMember) {
          throw new NotAuthorizedException(
            "You are not a member of this project.",
          );
        }

        return memberProps;
      });
    // The new-incident form's own check (IPv6, below): its suites pin it.
    jest
      .spyOn(WorkspaceActionAuthorization, "authorize")
      .mockResolvedValue(PROPS);

    // The member's role, as the permission checks would read it.
    jest
      .spyOn(WorkspaceActionAuthorization, "assertCanUpdate")
      .mockImplementation(async (data: { action: string }) => {
        if (!isOnPlan) {
          throw new PaymentRequiredException(
            "Please upgrade your plan to use custom fields.",
          );
        }

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

    // The lists the forms offer, as the member may read them.
    jest
      .spyOn(WorkspaceActionAuthorization, "findReadable")
      .mockImplementation((async (data: { service: unknown }) => {
        switch (data.service) {
          case IncidentSeverityService:
            return [
              severityOf(CRITICAL, "Critical"),
              severityOf(MINOR, "Minor"),
            ];
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

    // The project's one incident, read as whoever reads it.
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

        if (updateOneById.data["incidentSeverityId"]) {
          incident.severityId = updateOneById.data[
            "incidentSeverityId"
          ] as unknown as ObjectID;
        }

        if (updateOneById.data["customFields"]) {
          incident.customFields = updateOneById.data[
            "customFields"
          ] as JSONObject;
        }

        return 1;
      }) as never);
    jest
      .spyOn(IncidentSeverityService, "findOneBy")
      .mockImplementation((async (findOneBy: { query: { _id: string } }) => {
        const id: string = String(findOneBy.query._id);

        if (id === CRITICAL.toString()) {
          return severityOf(CRITICAL, "Critical");
        }

        if (id === MINOR.toString()) {
          return severityOf(MINOR, "Minor");
        }

        return null;
      }) as never);
    jest
      .spyOn(IncidentRoleService, "findOneBy")
      .mockImplementation((async (findOneBy: { query: { _id: string } }) => {
        const id: string = String(findOneBy.query._id);

        return [COMMANDER, SCRIBE].find((role: ObjectID): boolean => {
          return role.toString() === id;
        })
          ? roleOf(new ObjectID(id))
          : null;
      }) as never);
    jest
      .spyOn(IncidentMemberService, "findBy")
      .mockImplementation((async () => {
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
    // Who somebody given a role is, read as OneUptime.
    jest
      .spyOn(TeamMemberService, "findOneBy")
      .mockImplementation((async (findOneBy: {
        query: { userId: ObjectID };
      }) => {
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
      .mockImplementation(
        async (): Promise<Array<WorkspacePageChoiceGroup>> => {
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
        },
      );
    jest
      .spyOn(WorkspaceMemberActions, "getStanding")
      .mockImplementation(async (): Promise<WorkspaceEventStanding> => {
        const isResolved: boolean =
          incident.stateId.toString() === RESOLVED.toString();

        return {
          isAcknowledged: true,
          isResolved: isResolved,
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
    // Who resolved the incident and when, for the answer to a late press.
    jest
      .spyOn(IncidentStateService, "getAllIncidentStates")
      .mockImplementation((async () => {
        return [stateOf(IDENTIFIED, 2, false), stateOf(RESOLVED, 3, true)];
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

      if (url === "https://slack.com/api/views.open" && viewsOpenError) {
        return new HTTPResponse<JSONObject>(
          200,
          { ok: false, error: viewsOpenError },
          {},
        );
      }

      return new HTTPResponse<JSONObject>(200, { ok: true }, {});
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function severityOf(id: ObjectID, name: string): IncidentSeverity {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity.id = id;
    severity.name = name;
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

  function stateOf(
    id: ObjectID,
    order: number,
    isResolvedState: boolean,
  ): IncidentState {
    const state: IncidentState = new IncidentState();
    state.id = id;
    state.projectId = PROJECT_ID;
    state.name = isResolvedState ? "Resolved" : "Identified";
    state.order = order;
    state.isCreatedState = false;
    state.isAcknowledgedState = order === 2;
    state.isResolvedState = isResolvedState;
    return state;
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
      field(PUBLIC_FIELD, "Public", CustomFieldType.Boolean, 4),
      field(DUE_FIELD, "Due", CustomFieldType.Date, 5),
      field(STARTED_FIELD, "Started", CustomFieldType.DateTime, 6),
    ];
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
    row.projectId = PROJECT_ID;
    row.title = "Checkout is down";
    row.incidentNumber = 42;
    row.incidentNumberWithPrefix = "INC-42";
    row.declaredAt = new Date("2026-10-15T09:30:00.000Z");
    row.incidentSeverityId = incident.severityId;
    row.incidentSeverity = severityOf(
      incident.severityId,
      incident.severityId.toString() === CRITICAL.toString()
        ? "Critical"
        : "Minor",
    );
    row.currentIncidentStateId = incident.stateId;
    const state: IncidentState = new IncidentState();
    state.name =
      incident.stateId.toString() === RESOLVED.toString()
        ? "Resolved"
        : "Identified";
    row.currentIncidentState = state;
    row.customFields = { ...incident.customFields };
    row.monitors = [];
    return row;
  }

  function pagedResult(): OnCallPageResult {
    return {
      record: {
        type: OnCallPageRecordType.Incident,
        id: INCIDENT_ID,
        label: "Incident INC-42",
        title: "Checkout is down",
        url: URL.fromString(INCIDENT_URL),
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
      summary: "Paged Nawaz Dhandala about Incident INC-42.",
    };
  }

  function command(
    text: string,
    channelId?: string | undefined,
  ): Promise<RouteAnswer> {
    return postForm({
      port: app.port,
      path: "/api/slack/command",
      fields: slashCommand(text, channelId),
    });
  }

  function choose(
    value: string,
    options: { isEphemeral?: boolean } = {},
  ): Promise<RouteAnswer> {
    return postForm({
      port: app.port,
      path: "/api/slack/interactive",
      fields: menuChoice(value, options),
    });
  }

  function submit(data: {
    callbackId: string;
    privateMetadata: string;
    state: ViewState;
  }): Promise<RouteAnswer> {
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

  // The form views.open was sent.
  async function openedForm(): Promise<JSONObject> {
    const calls: Array<SlackCall> = await slackCallsAfter(1);
    const open: SlackCall | undefined = calls.find((call: SlackCall) => {
      return call.url === "https://slack.com/api/views.open";
    });

    expect(open).toBeDefined();
    expect(open!.data["trigger_id"]).toBe(TRIGGER_ID);

    return open!.data["view"] as JSONObject;
  }

  // A form's input block, by its block id.
  function inputOf(view: JSONObject, blockId: string): JSONObject {
    const block: JSONObject | undefined = (
      view["blocks"] as Array<JSONObject>
    ).find((candidate: JSONObject): boolean => {
      return candidate["block_id"] === blockId;
    });

    expect(block).toBeDefined();
    return block!;
  }

  function elementOf(view: JSONObject, blockId: string): JSONObject {
    return inputOf(view, blockId)["element"] as JSONObject;
  }

  function optionTexts(options: unknown): Array<string> {
    return ((options as Array<JSONObject> | undefined) || []).map(
      (option: JSONObject): string => {
        return String((option["text"] as JSONObject)["text"]);
      },
    );
  }

  // The one answer only Simon sees: at a response_url, or chat.postEphemeral.
  async function onlyAnswer(): Promise<SlackCall> {
    await settle();

    expect(
      slackCalls.map((call: SlackCall): string => {
        return call.url;
      }),
    ).toHaveLength(1);

    return slackCalls[0]!;
  }

  function overflowOf(blocks: Array<JSONObject>): JSONObject | undefined {
    const actions: JSONObject | undefined = blocks.find(
      (block: JSONObject): boolean => {
        return block["type"] === "actions";
      },
    );

    return (actions?.["elements"] as Array<JSONObject> | undefined)?.find(
      (element: JSONObject): boolean => {
        return element["type"] === "overflow";
      },
    );
  }

  const ID: string = INCIDENT_ID.toString();
  const RECORD_MRKDWN: string = `*<${INCIDENT_URL}|Incident INC-42>*`;

  describe("the menu's forms open as the member, filled in as the incident is", () => {
    test("Change Severity: Slack is answered at once; the form opens with the severities they may pick, the incident's own picked", async () => {
      const answer: RouteAnswer = await choose(
        `ViewChangeIncidentSeverity:${ID}`,
      );

      expect(answer.status).toBe(200);

      const view: JSONObject = await openedForm();

      expect(view["callback_id"]).toBe("SubmitChangeIncidentSeverity");
      expect(view["title"]).toEqual({
        type: "plain_text",
        text: "Change Severity",
      });
      expect(view["submit"]).toEqual({ type: "plain_text", text: "Save" });
      expect(view["close"]).toEqual({ type: "plain_text", text: "Cancel" });
      expect(textOf([(view["blocks"] as Array<JSONObject>)[0]])).toBe(
        "🚨 *INC-42* Checkout is down\n",
      );

      const severity: JSONObject = elementOf(view, "incidentSeverity");
      expect(severity["type"]).toBe("static_select");
      expect(optionTexts(severity["options"])).toEqual(["Critical", "Minor"]);
      expect((severity["initial_option"] as JSONObject)["value"]).toBe(
        MINOR.toString(),
      );

      // The form carries the incident, the channel it was opened in, and its project.
      expect(JSON.parse(view["private_metadata"] as string)).toEqual({
        oneuptime: 1,
        value: ID,
        channelId: INCIDENT_CHANNEL_ID,
        projectId: PROJECT_ID.toString(),
      });

      // The incident, read as Simon.
      expect(
        incidentReads.every(
          (read: { props: DatabaseCommonInteractionProps }) => {
            return read.props === PROPS;
          },
        ),
      ).toBe(true);
    });

    test("Assign Role: who holds what, the primary role picked, and Simon - 'I'll take it' - picked", async () => {
      await choose(`ViewAssignIncidentRole:${ID}`);

      const view: JSONObject = await openedForm();

      expect(view["callback_id"]).toBe("SubmitAssignIncidentRole");
      expect(view["submit"]).toEqual({ type: "plain_text", text: "Assign" });
      expect(textOf([(view["blocks"] as Array<JSONObject>)[0]])).toBe(
        "🚨 *INC-42* Checkout is down\n👤 Incident Commander: *Ana Ruiz*\n",
      );

      const role: JSONObject = elementOf(view, "incidentRole");
      expect(optionTexts(role["options"])).toEqual([
        "Incident Commander",
        "Scribe",
      ]);
      expect((role["initial_option"] as JSONObject)["value"]).toBe(
        COMMANDER.toString(),
      );

      // Simon first - "I'll take it" - then everybody else by name.
      const person: JSONObject = elementOf(view, "incidentRolePerson");
      expect(optionTexts(person["options"])).toEqual([
        "Simon Lee (you)",
        "Ana Ruiz",
        "Nawaz Dhandala",
      ]);
      expect((person["initial_option"] as JSONObject)["value"]).toBe(
        SIMON.toString(),
      );
      // The role that takes one person, by name, and what picking does.
      expect(
        (inputOf(view, "incidentRolePerson")["hint"] as JSONObject)["text"],
      ).toBe(
        "Incident Commander takes one person: picking someone replaces whoever has it.",
      );
    });

    test("Page Someone: who they may page, in groups, many at once", async () => {
      await choose(`ViewPageAboutIncident:${ID}`);

      const view: JSONObject = await openedForm();

      expect(view["callback_id"]).toBe("SubmitPageAboutIncident");
      expect(view["submit"]).toEqual({ type: "plain_text", text: "Page" });

      const who: JSONObject = elementOf(view, "incidentPageTargets");
      expect(who["type"]).toBe("multi_static_select");
      expect(
        (who["option_groups"] as Array<JSONObject>).map(
          (group: JSONObject): [string, Array<string>] => {
            return [
              String((group["label"] as JSONObject)["text"]),
              optionTexts(group["options"]),
            ];
          },
        ),
      ).toEqual([
        ["On call now", ["Primary (Nawaz Dhandala)"]],
        ["People", ["Nawaz Dhandala"]],
      ]);
      expect(
        (inputOf(view, "incidentPageTargets")["hint"] as JSONObject)["text"],
      ).toBe(
        "They are paged about this incident until one of them answers. A schedule pages whoever is on call in it now; a policy pages through its escalation rules.",
      );

      // The page's own message, optional: the incident says what it is about.
      const message: JSONObject = inputOf(view, "incidentPageMessage");
      expect(message["optional"]).toBe(true);
      expect((message["label"] as JSONObject)["text"]).toBe("Message");
      expect((message["hint"] as JSONObject)["text"]).toBe(
        "The people you page see it with the incident.",
      );
      expect(elementOf(view, "incidentPageMessage")).toMatchObject({
        type: "plain_text_input",
        multiline: true,
        max_length: 500,
      });
    });

    test("Edit Custom Fields: each field as the input its type asks for, filled in with what the incident holds, all optional", async () => {
      await choose(`ViewEditIncidentCustomFields:${ID}`);

      const view: JSONObject = await openedForm();

      expect(view["callback_id"]).toBe("SubmitEditIncidentCustomFields");
      expect(view["title"]).toEqual({
        type: "plain_text",
        text: "Edit Custom Fields",
      });

      const impact: JSONObject = inputOf(
        view,
        customFieldInputId(IMPACT_FIELD),
      );
      expect(impact["optional"]).toBe(true);
      expect((impact["label"] as JSONObject)["text"]).toBe("Customer Impact");
      expect((impact["element"] as JSONObject)["type"]).toBe("static_select");
      expect(optionTexts((impact["element"] as JSONObject)["options"])).toEqual(
        ["High", "Medium", "Low"],
      );
      expect(
        (
          ((impact["element"] as JSONObject)["initial_option"] as JSONObject)[
            "text"
          ] as JSONObject
        )["text"],
      ).toBe("Medium");

      expect(elementOf(view, customFieldInputId(TICKET_FIELD))).toMatchObject({
        type: "plain_text_input",
        initial_value: "OPS-118",
      });
      expect(elementOf(view, customFieldInputId(USERS_FIELD))).toMatchObject({
        type: "number_input",
        is_decimal_allowed: true,
        initial_value: "1200",
      });
      expect(
        optionTexts(
          elementOf(view, customFieldInputId(PUBLIC_FIELD))["options"],
        ),
      ).toEqual(["Yes", "No"]);
      expect(elementOf(view, customFieldInputId(DUE_FIELD))["type"]).toBe(
        "datepicker",
      );
      expect(elementOf(view, customFieldInputId(STARTED_FIELD))["type"]).toBe(
        "datetimepicker",
      );

      // The note under the fields.
      const blocks: Array<JSONObject> = view["blocks"] as Array<JSONObject>;
      expect(blocks[blocks.length - 1]!["type"]).toBe("context");
      expect(
        String(
          (
            (
              blocks[blocks.length - 1]!["elements"] as Array<JSONObject>
            )[0] as JSONObject
          )["text"],
        ),
      ).toBe("Leave a field empty to clear it.\n");
    });

    test("a project with no custom fields: no empty form - where to add them, only to Simon", async () => {
      jest.spyOn(IncidentCustomFieldService, "findBy").mockResolvedValue([]);

      await choose(`ViewEditIncidentCustomFields:${ID}`);
      const answer: SlackCall = await onlyAnswer();

      expect(answer.url).toBe(PRESS_RESPONSE_URL);
      expect(answer.data["response_type"]).toBe("ephemeral");
      expect(textOf(answer.data["blocks"])).toBe(
        "This project has no incident custom fields yet. Add them in OneUptime under Incidents → Settings → Custom Fields.\n",
      );
    });
  });

  describe("a form of the menu, submitted: checked at once, closed, then the change - as the member", () => {
    function severityMetadata(): string {
      return JSON.stringify({
        oneuptime: 1,
        value: ID,
        channelId: INCIDENT_CHANNEL_ID,
      });
    }

    test("Change Severity: the incident's update, as Simon; the channel hears of it from the feed, so nothing else is sent", async () => {
      const answer: RouteAnswer = await submit({
        callbackId: "SubmitChangeIncidentSeverity",
        privateMetadata: severityMetadata(),
        state: { incidentSeverity: staticSelect(CRITICAL.toString()) },
      });

      expect(answer.status).toBe(200);
      expect(answer.body).toEqual({ response_action: "clear" });

      await settle();

      expect(updates).toEqual([
        {
          id: INCIDENT_ID,
          data: { incidentSeverityId: CRITICAL },
          props: PROPS,
        },
      ]);
      expect(slackCalls).toEqual([]);
    });

    test("the severity it has already: nothing written, and Simon is told so where he opened the form", async () => {
      await submit({
        callbackId: "SubmitChangeIncidentSeverity",
        privateMetadata: severityMetadata(),
        state: { incidentSeverity: staticSelect(MINOR.toString()) },
      });

      const answer: SlackCall = await onlyAnswer();

      expect(updates).toEqual([]);
      expect(answer.url).toBe("https://slack.com/api/chat.postEphemeral");
      expect(answer.data["channel"]).toBe(INCIDENT_CHANNEL_ID);
      expect(answer.data["user"]).toBe(SLACK_USER_ID);
      expect(textOf(answer.data["blocks"])).toBe(
        `${RECORD_MRKDWN} is already *Minor*. Nothing changed.\n`,
      );
    });

    test("no severity picked: said under the field, the form stays open, nothing written", async () => {
      const answer: RouteAnswer = await submit({
        callbackId: "SubmitChangeIncidentSeverity",
        privateMetadata: severityMetadata(),
        state: { incidentSeverity: staticSelect(null) },
      });

      expect(answer.body).toEqual({
        response_action: "errors",
        errors: { incidentSeverity: "Pick a severity." },
      });
      await settle();
      expect(updates).toEqual([]);
      expect(slackCalls).toEqual([]);
    });

    test("Assign Role: Simon becomes Incident Commander, as Simon - added first, then Ana taken off the role that takes one person", async () => {
      const answer: RouteAnswer = await submit({
        callbackId: "SubmitAssignIncidentRole",
        privateMetadata: severityMetadata(),
        state: {
          incidentRole: staticSelect(COMMANDER.toString()),
          incidentRolePerson: staticSelect(SIMON.toString()),
        },
      });

      expect(answer.body).toEqual({ response_action: "clear" });
      await settle();

      expect(membersCreated).toHaveLength(1);
      expect(membersCreated[0]!.member.userId).toEqual(SIMON);
      expect(membersCreated[0]!.member.incidentRoleId).toEqual(COMMANDER);
      expect(membersCreated[0]!.member.incidentId).toEqual(INCIDENT_ID);
      expect(membersCreated[0]!.props).toBe(PROPS);
      expect(membersDeleted).toEqual([{ id: ANA_AS_COMMANDER, props: PROPS }]);
      expect(slackCalls).toEqual([]);
    });

    test("Assign Role with nobody picked: said under each field left empty", async () => {
      const answer: RouteAnswer = await submit({
        callbackId: "SubmitAssignIncidentRole",
        privateMetadata: severityMetadata(),
        state: {
          incidentRole: staticSelect(null),
          incidentRolePerson: staticSelect(null),
        },
      });

      expect(answer.body).toEqual({
        response_action: "errors",
        errors: {
          incidentRole: "Pick a role.",
          incidentRolePerson: "Pick a person.",
        },
      });
      await settle();
      expect(membersCreated).toEqual([]);
    });

    test("a member who may add people to roles but not take them off cannot move the role that takes one person: why, and nothing written", async () => {
      memberProps = propsWith([
        Permission.IncidentViewer,
        Permission.CreateIncidentMember,
      ]);

      await submit({
        callbackId: "SubmitAssignIncidentRole",
        privateMetadata: severityMetadata(),
        state: {
          incidentRole: staticSelect(COMMANDER.toString()),
          incidentRolePerson: staticSelect(SIMON.toString()),
        },
      });
      const said: SlackCall = await onlyAnswer();

      expect(membersCreated).toEqual([]);
      expect(membersDeleted).toEqual([]);
      // The role, who would come off it, and what allows it - once each.
      expect(textOf(said.data["blocks"])).toBe(
        "Could not assign the role: Incident Commander takes one person, and you do not have permission to take Ana Ruiz off it. You need one of these permissions: Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Delete Incident Member.\n",
      );
    });

    test("Page Someone: the page about the incident, as Simon; who was paged, told to Simon", async () => {
      const answer: RouteAnswer = await submit({
        callbackId: "SubmitPageAboutIncident",
        privateMetadata: severityMetadata(),
        state: {
          incidentPageTargets: multiSelect([
            `${WorkspacePageTargetKind.Schedule}:${PRIMARY_SCHEDULE.toString()}`,
          ]),
        },
      });

      expect(answer.body).toEqual({ response_action: "clear" });
      const said: SlackCall = await onlyAnswer();

      expect(pages).toEqual([
        {
          targets: expect.objectContaining({
            onCallScheduleIds: [PRIMARY_SCHEDULE],
          }),
          about: { incidentId: INCIDENT_ID },
          props: PROPS,
        },
      ]);
      expect(said.url).toBe("https://slack.com/api/chat.postEphemeral");
      expect(textOf(said.data["blocks"])).toBe(
        `📟 Paged *Nawaz Dhandala* about ${RECORD_MRKDWN}\n`,
      );
    });

    test("Page Someone with a message: the page carries it as its own, and the answer quotes it", async () => {
      const answer: RouteAnswer = await submit({
        callbackId: "SubmitPageAboutIncident",
        privateMetadata: severityMetadata(),
        state: {
          incidentPageTargets: multiSelect([
            `${WorkspacePageTargetKind.Schedule}:${PRIMARY_SCHEDULE.toString()}`,
          ]),
          incidentPageMessage: textInput("  Can you check the\ndatabase?  "),
        },
      });

      expect(answer.body).toEqual({ response_action: "clear" });
      const said: SlackCall = await onlyAnswer();

      // About the incident - no alert - with the message on one line.
      expect(pages).toEqual([
        {
          targets: expect.objectContaining({
            onCallScheduleIds: [PRIMARY_SCHEDULE],
          }),
          about: {
            incidentId: INCIDENT_ID,
            message: "Can you check the database?",
          },
          props: PROPS,
        },
      ]);
      expect(textOf(said.data["blocks"])).toBe(
        `📟 Paged *Nawaz Dhandala* about ${RECORD_MRKDWN}: “Can you check the database?”\n`,
      );
    });

    test("Page Someone with a message of only spaces: no message at all", async () => {
      await submit({
        callbackId: "SubmitPageAboutIncident",
        privateMetadata: severityMetadata(),
        state: {
          incidentPageTargets: multiSelect([
            `${WorkspacePageTargetKind.Schedule}:${PRIMARY_SCHEDULE.toString()}`,
          ]),
          incidentPageMessage: textInput("   "),
        },
      });
      await onlyAnswer();

      expect(pages).toHaveLength(1);
      expect(pages[0]!.about).toEqual({ incidentId: INCIDENT_ID });
    });

    test("Page Someone with nobody picked: said under the field, nobody paged", async () => {
      const answer: RouteAnswer = await submit({
        callbackId: "SubmitPageAboutIncident",
        privateMetadata: severityMetadata(),
        state: { incidentPageTargets: multiSelect([]) },
      });

      expect(answer.body).toEqual({
        response_action: "errors",
        errors: { incidentPageTargets: "Pick who to page." },
      });
      await settle();
      expect(pages).toEqual([]);
    });

    test("Page Someone on an incident resolved meanwhile: nobody paged, and who resolved it, when", async () => {
      incident.stateId = RESOLVED;

      await submit({
        callbackId: "SubmitPageAboutIncident",
        privateMetadata: severityMetadata(),
        state: {
          incidentPageTargets: multiSelect([
            `${WorkspacePageTargetKind.Person}:${NAWAZ.toString()}`,
          ]),
        },
      });
      const said: SlackCall = await onlyAnswer();

      expect(pages).toEqual([]);
      expect(textOf(said.data["blocks"])).toBe(
        `${RECORD_MRKDWN} was already resolved by *Ana Ruiz* at <!date^1792057500^{time}|09:45 UTC>, so nobody was paged.\n`,
      );
    });

    test("Page Someone pressed on an incident resolved already: no form, the same answer where it was pressed", async () => {
      incident.stateId = RESOLVED;

      await choose(`ViewPageAboutIncident:${ID}`);
      const said: SlackCall = await onlyAnswer();

      expect(said.url).toBe(PRESS_RESPONSE_URL);
      expect(textOf(said.data["blocks"])).toBe(
        `${RECORD_MRKDWN} was already resolved by *Ana Ruiz* at <!date^1792057500^{time}|09:45 UTC>, so nobody was paged.\n`,
      );
    });

    test("Edit Custom Fields: only the fields changed are written - a new value, one emptied - as Simon", async () => {
      const answer: RouteAnswer = await submit({
        callbackId: "SubmitEditIncidentCustomFields",
        privateMetadata: severityMetadata(),
        state: {
          [customFieldInputId(IMPACT_FIELD)]: staticSelect(
            WorkspaceIncidentCustomFields.toToken(0, "High"),
          ),
          [customFieldInputId(TICKET_FIELD)]: textInput(null),
          [customFieldInputId(USERS_FIELD)]: numberInput("1200"),
          [customFieldInputId(PUBLIC_FIELD)]: staticSelect("true"),
          [customFieldInputId(DUE_FIELD)]: datePicker("2026-10-20"),
          // 2026-10-15 09:30 UTC, as Slack gives a date and time picker's pick.
          [customFieldInputId(STARTED_FIELD)]: dateTimePicker(1792056600),
        },
      });

      expect(answer.body).toEqual({ response_action: "clear" });
      await settle();

      expect(updates).toEqual([
        {
          id: INCIDENT_ID,
          data: {
            customFields: {
              "Customer Impact": "High",
              "Affected Users": 1200,
              Public: true,
              Due: "2026-10-20",
              Started: "2026-10-15T09:30:00.000Z",
            },
          },
          props: PROPS,
        },
      ]);
      expect(slackCalls).toEqual([]);
    });

    test("a value that does not fit its field: said under it, the form stays open, nothing written", async () => {
      const answer: RouteAnswer = await submit({
        callbackId: "SubmitEditIncidentCustomFields",
        privateMetadata: severityMetadata(),
        state: {
          [customFieldInputId(USERS_FIELD)]: numberInput("lots"),
          [customFieldInputId(IMPACT_FIELD)]: staticSelect("Critical"),
          [customFieldInputId(TICKET_FIELD)]: textInput("OPS-200"),
        },
      });

      expect(answer.body).toEqual({
        response_action: "errors",
        errors: {
          [customFieldInputId(USERS_FIELD)]: "Enter a number.",
          [customFieldInputId(IMPACT_FIELD)]:
            "The options of this field changed since the form was opened. Pick again.",
        },
      });
      await settle();
      expect(updates).toEqual([]);
    });

    test("the form saved as it opened: nothing written, and Simon is told nothing changed", async () => {
      await submit({
        callbackId: "SubmitEditIncidentCustomFields",
        privateMetadata: severityMetadata(),
        state: {
          [customFieldInputId(IMPACT_FIELD)]: staticSelect(
            WorkspaceIncidentCustomFields.toToken(1, "Medium"),
          ),
          [customFieldInputId(TICKET_FIELD)]: textInput("OPS-118"),
          [customFieldInputId(USERS_FIELD)]: numberInput("1200"),
        },
      });
      const said: SlackCall = await onlyAnswer();

      expect(updates).toEqual([]);
      expect(textOf(said.data["blocks"])).toBe(
        `Nothing changed: the custom fields of ${RECORD_MRKDWN} are as they were.\n`,
      );
    });
  });

  describe("somebody who may not: told where they pressed, and no form opens", () => {
    test("a member whose role may not change incidents: why, only to them; no form", async () => {
      mayUpdateIncident = false;

      await choose(`ViewChangeIncidentSeverity:${ID}`);
      const said: SlackCall = await onlyAnswer();

      expect(said.url).toBe(PRESS_RESPONSE_URL);
      expect(said.data["response_type"]).toBe("ephemeral");
      expect(textOf(said.data["blocks"])).toBe(
        "You do not have permission to change the severity of this incident. You need one of these permissions: Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Edit Incident.\n",
      );
    });

    test("a member who may not assign roles: why; no form", async () => {
      mayAssignRoles = false;

      await choose(`ViewAssignIncidentRole:${ID}`);
      const said: SlackCall = await onlyAnswer();

      expect(textOf(said.data["blocks"])).toBe(
        "You do not have permission to assign a role on this incident. You need one of these permissions: Project Owner, Project Admin, Project Member, Incident Admin, Incident Member, Create Incident Member.\n",
      );
    });

    test("a plan that does not include it: the plan's words; no form", async () => {
      isOnPlan = false;

      await choose(`ViewEditIncidentCustomFields:${ID}`);
      const said: SlackCall = await onlyAnswer();

      expect(textOf(said.data["blocks"])).toBe(
        "Please upgrade your plan to use custom fields.\n",
      );
    });

    test("an incident the member may not read - its labels, its owners - is refused with that, never as one that is not there", async () => {
      isIncidentReadable = false;

      await choose(`ViewChangeIncidentSeverity:${ID}`);
      const said: SlackCall = await onlyAnswer();

      expect(textOf(said.data["blocks"])).toBe(
        "You do not have permission to change the severity of this incident: your access in this project does not include this incident. Ask a project admin for access to it.\n",
      );
    });

    test("a refusal on submit - the role taken since the form opened - closes the form and says why", async () => {
      mayAssignRoles = false;

      const answer: RouteAnswer = await submit({
        callbackId: "SubmitAssignIncidentRole",
        privateMetadata: JSON.stringify({
          oneuptime: 1,
          value: ID,
          channelId: INCIDENT_CHANNEL_ID,
        }),
        state: {
          incidentRole: staticSelect(SCRIBE.toString()),
          incidentRolePerson: staticSelect(NAWAZ.toString()),
        },
      });

      expect(answer.body).toEqual({ response_action: "clear" });
      const said: SlackCall = await onlyAnswer();

      expect(membersCreated).toEqual([]);
      expect(said.url).toBe("https://slack.com/api/chat.postEphemeral");
      expect(textOf(said.data["blocks"])).toContain(
        "You do not have permission to assign a role on this incident.",
      );
    });

    test.each([
      [
        "ViewChangeIncidentSeverity",
        "change the severity of this incident",
        "Change Severity",
      ],
      [
        "ViewAssignIncidentRole",
        "assign a role on this incident",
        "Assign Role",
      ],
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
      "%s from a Slack account not connected: asked to connect, for exactly that, then to choose it again",
      async (action: string, purpose: string, item: string) => {
        linkedUser = null;

        await choose(`${action}:${ID}`);
        const said: SlackCall = await onlyAnswer();

        expect(said.url).toBe(PRESS_RESPONSE_URL);
        // An item of the menu, not a button: chosen from the menu again.
        expect(textOf(said.data["blocks"])).toContain(
          `🔗 *Connect your Slack account to ${purpose}.* It takes one click. Then choose *${item}* from the menu again.`,
        );

        // The Connect button carries the request, for this Slack account.
        const button: JSONObject = (
          (said.data["blocks"] as Array<JSONObject>).find(
            (block: JSONObject): boolean => {
              return block["type"] === "actions";
            },
          )!["elements"] as Array<JSONObject>
        )[0]!;
        const token: string | null = new globalThis.URL(
          button["url"] as string,
        ).searchParams.get("connect");
        expect(token).toMatch(CONNECT_REQUEST_TOKEN_PATTERN);

        const request: WorkspaceConnectRequestRecord | null =
          await WorkspaceConnectRequest.peek(token);
        expect(request!.purpose).toBe(purpose);
        expect(request!.workspaceUserId).toBe(SLACK_USER_ID);
        expect(request!.again).toEqual({
          kind: WorkspaceConnectRequestAgainKind.MenuItem,
          label: item,
        });
      },
    );

    test("Change Incident State, an item of the menu now and a button on messages posted before it: each asked again as it was pressed", async () => {
      linkedUser = null;

      await choose(`ViewChangeIncidentState:${ID}`);
      const fromMenu: SlackCall = await onlyAnswer();

      expect(textOf(fromMenu.data["blocks"])).toContain(
        "Then choose *Change Incident State* from the menu again.",
      );

      slackCalls.splice(0);

      // The same action, pressed as the button an older message carries.
      await postForm({
        port: app.port,
        path: "/api/slack/interactive",
        fields: {
          payload: JSON.stringify({
            type: "block_actions",
            user: { id: SLACK_USER_ID, username: "simon", name: "simon" },
            team: { id: SLACK_TEAM_ID },
            channel: { id: INCIDENT_CHANNEL_ID, name: "incident-42" },
            container: {
              type: "message",
              channel_id: INCIDENT_CHANNEL_ID,
              message_ts: "1760000000.000100",
            },
            message: { ts: "1760000000.000100" },
            response_url: PRESS_RESPONSE_URL,
            trigger_id: TRIGGER_ID,
            actions: [
              {
                type: "button",
                action_id: "ViewChangeIncidentState",
                block_id: "incident-buttons",
                value: ID,
                action_ts: "1760000001.000400",
              },
            ],
          }),
        },
      });
      const fromButton: SlackCall = await onlyAnswer();

      expect(textOf(fromButton.data["blocks"])).toContain(
        "Then press *Change Incident State* again.",
      );
    });
  });

  describe("/oneuptime incident <number>: the incident, with its buttons and menu, only to whoever asked", () => {
    test.each([["42"], ["#42"], ["INC-42"], ["inc-42"]])(
      "/oneuptime incident %s: an empty 200, then incident 42 at the command's response_url",
      async (typed: string) => {
        const answer: RouteAnswer = await command(`incident ${typed}`);

        expect(answer.status).toBe(200);
        expect(answer.body).toBeNull();

        const said: SlackCall = await onlyAnswer();
        const blocks: Array<JSONObject> = said.data[
          "blocks"
        ] as Array<JSONObject>;

        expect(said.url).toBe(COMMAND_RESPONSE_URL);
        expect(said.data["response_type"]).toBe("ephemeral");
        expect(said.data["text"]).toBe("INC-42 Checkout is down");
        /*
         * Its number and title, in bold, first; then what it is now - its
         * declared time in each reader's own calendar and clock - and who
         * holds its roles, each a line of its own.
         */
        expect(
          blocks.slice(0, 3).map((block: JSONObject): string => {
            return String(block["type"]);
          }),
        ).toEqual(["section", "section", "section"]);
        expect(textOf([blocks[0]])).toBe(
          `🚨 *<${INCIDENT_URL}|INC-42>* · *Checkout is down*\n`,
        );
        expect(textOf([blocks[1]])).toBe(
          "Severity: Minor · State: Identified · Declared <!date^1792056600^{date_short_pretty}|2026-10-15> at <!date^1792056600^{time}|09:30 UTC>\n",
        );
        expect(textOf([blocks[2]])).toBe("👤 Incident Commander: *Ana Ruiz*\n");

        // Its four buttons, then its menu of five.
        const actions: JSONObject = blocks.find((block: JSONObject) => {
          return block["type"] === "actions";
        })!;
        expect(
          (actions["elements"] as Array<JSONObject>).map(
            (element: JSONObject): string => {
              return element["type"] === "overflow"
                ? "⋯"
                : String((element["text"] as JSONObject)["text"]);
            },
          ),
        ).toEqual([
          "👀 Acknowledge Incident",
          "✅ Resolve Incident",
          "📄 Add Note",
          "🔗 View Incident",
          "⋯",
        ]);
        expect(optionTexts(overflowOf(blocks)!["options"])).toEqual([
          "⚠️ Change Severity",
          "➡️ Change Incident State",
          "👤 Assign Role",
          "📟 Page Someone",
          "📝 Edit Custom Fields",
        ]);

        // Found as Simon reads it.
        expect(incidentReads[0]).toEqual({
          query: { projectId: PROJECT_ID, incidentNumber: 42 },
          props: PROPS,
        });
      },
    );

    test("a number no incident has, or one Simon may not read: said so, and how to declare one", async () => {
      await command("incident 99");
      const said: SlackCall = await onlyAnswer();

      expect(said.url).toBe(COMMAND_RESPONSE_URL);
      expect(textOf(said.data["blocks"])).toBe(
        "🔍 There is no incident 99 in this project, or you do not have access to it. To declare a new incident, run `/oneuptime incident` followed by its title.\n",
      );
    });

    test("a word that only looks like a number - IPv6 - is the new incident's title, as the command always took it", async () => {
      const answer: RouteAnswer = await command("incident IPv6");

      expect(answer.status).toBe(200);

      const view: JSONObject = await openedForm();

      expect(view["callback_id"]).toBe("SubmitNewIncident");
      expect(JSON.stringify(view["blocks"])).toContain(
        '"initial_value":"IPv6"',
      );
    });

    test("plain /oneuptime incident in the incident's own channel: that incident, and how to declare another instead", async () => {
      await command("incident", INCIDENT_CHANNEL_ID);
      const said: SlackCall = await onlyAnswer();

      expect(said.url).toBe(COMMAND_RESPONSE_URL);

      const blocks: Array<JSONObject> = said.data[
        "blocks"
      ] as Array<JSONObject>;
      const last: JSONObject = blocks[blocks.length - 1]!;

      expect(last["type"]).toBe("context");
      expect(
        String((last["elements"] as Array<JSONObject>)[0]!["text"])
          .split(ZERO_WIDTH_SPACE)
          .join(""),
      ).toBe(
        "To declare a new incident instead, run `/oneuptime incident` followed by its title.\n",
      );

      // Which channel is an incident's is OneUptime's to know: read as root.
      expect(incidentReads[0]!.props).toEqual({ isRoot: true });
    });

    test("plain /oneuptime incident in any other channel: the incident form, as always", async () => {
      await command("incident", OPS_CHANNEL_ID);

      const view: JSONObject = await openedForm();

      expect(view["callback_id"]).toBe("SubmitNewIncident");
    });

    test("from a Slack account not connected: asked to connect to see it, then to run exactly that again", async () => {
      linkedUser = null;

      await command("incident 42");
      const said: SlackCall = await onlyAnswer();

      expect(said.url).toBe(COMMAND_RESPONSE_URL);
      expect(textOf(said.data["blocks"])).toContain(
        "🔗 *Connect your Slack account to see this incident.* It takes one click. Then run */oneuptime incident 42* again.",
      );
    });
  });

  describe("the incident a command showed, which only its asker sees", () => {
    test("its menu's form, submitted: what it did is said to them - nobody else saw the message", async () => {
      await choose(`ViewChangeIncidentSeverity:${ID}`, { isEphemeral: true });

      const view: JSONObject = await openedForm();

      // The form remembers it was opened from a message only Simon sees.
      expect(JSON.parse(view["private_metadata"] as string)).toEqual({
        oneuptime: 1,
        value: ID,
        channelId: INCIDENT_CHANNEL_ID,
        projectId: PROJECT_ID.toString(),
        private: 1,
      });

      slackCalls = [];

      await submit({
        callbackId: "SubmitChangeIncidentSeverity",
        privateMetadata: view["private_metadata"] as string,
        state: { incidentSeverity: staticSelect(CRITICAL.toString()) },
      });
      const said: SlackCall = await onlyAnswer();

      expect(updates).toHaveLength(1);
      expect(said.url).toBe("https://slack.com/api/chat.postEphemeral");
      expect(said.data["channel"]).toBe(INCIDENT_CHANNEL_ID);
      expect(textOf(said.data["blocks"])).toBe(
        `⚠️ ${RECORD_MRKDWN} is now *Critical*.\n`,
      );
    });

    test("Edit Custom Fields from it, saved: the fields it changed", async () => {
      await submit({
        callbackId: "SubmitEditIncidentCustomFields",
        privateMetadata: JSON.stringify({
          oneuptime: 1,
          value: ID,
          channelId: INCIDENT_CHANNEL_ID,
          private: 1,
        }),
        state: {
          [customFieldInputId(TICKET_FIELD)]: textInput("OPS-200"),
        },
      });
      const said: SlackCall = await onlyAnswer();

      expect(textOf(said.data["blocks"])).toBe(
        `📝 Updated *Ticket* on ${RECORD_MRKDWN}.\n`,
      );
    });

    test("Assign Role from it: who is now what", async () => {
      await submit({
        callbackId: "SubmitAssignIncidentRole",
        privateMetadata: JSON.stringify({
          oneuptime: 1,
          value: ID,
          channelId: INCIDENT_CHANNEL_ID,
          private: 1,
        }),
        state: {
          incidentRole: staticSelect(SCRIBE.toString()),
          incidentRolePerson: staticSelect(NAWAZ.toString()),
        },
      });
      const said: SlackCall = await onlyAnswer();

      expect(textOf(said.data["blocks"])).toBe(
        `👤 *Nawaz Dhandala* is now *Scribe* on ${RECORD_MRKDWN}.\n`,
      );
    });
  });

  /*
   * ADD NOTE ON A PRIVATE INCIDENT.
   *
   * A private incident takes no public notes (Types/StatusPage/
   * PrivateRecordPublicNotes): it is on no status page and told to no
   * subscriber. Its Add Note form asks for no kind - "Add Private Note", one
   * line that says why, and the note - and adds a private note. A form
   * opened before the incident was made private can still send Public Note:
   * that note is added as a private note, and Simon is told what it became
   * and why, where he opened the form. Whether it is private is read from
   * the incident itself, as OneUptime (PrivateRecordPublicNoteRule).
   */
  describe("Add Note on a private incident: one kind of note, and the form says why", () => {
    const NOTE: string = "Payroll export paused; nothing left the building.";
    let isIncidentPrivate: boolean;
    let privateNotesAdded: Array<JSONObject>;
    let publicNotesAdded: Array<JSONObject>;

    beforeEach(() => {
      isIncidentPrivate = true;
      privateNotesAdded = [];
      publicNotesAdded = [];

      // The project's one incident, with its Private switch.
      jest
        .spyOn(IncidentService, "findOneBy")
        .mockImplementation((async (findOneBy: {
          query: JSONObject;
          props: DatabaseCommonInteractionProps;
        }) => {
          incidentReads.push({
            query: findOneBy.query,
            props: findOneBy.props,
          });
          const row: Incident | null = readIncident(findOneBy);

          if (row) {
            row.isPrivate = isIncidentPrivate;
          }

          return row;
        }) as never);

      jest
        .spyOn(IncidentInternalNoteService, "addNote")
        .mockImplementation((async (data: JSONObject) => {
          privateNotesAdded.push(data);
          return new IncidentInternalNote();
        }) as never);
      jest
        .spyOn(IncidentPublicNoteService, "addNote")
        .mockImplementation((async (data: JSONObject) => {
          publicNotesAdded.push(data);
          return new IncidentPublicNote();
        }) as never);
    });

    // What Slack posts when 📄 Add Note on the incident's message is pressed.
    function pressAddNote(): Promise<RouteAnswer> {
      return postForm({
        port: app.port,
        path: "/api/slack/interactive",
        fields: {
          payload: JSON.stringify({
            type: "block_actions",
            user: { id: SLACK_USER_ID, username: "simon", name: "simon" },
            team: { id: SLACK_TEAM_ID },
            channel: { id: INCIDENT_CHANNEL_ID, name: "incident-42" },
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
                type: "button",
                action_id: "ViewAddIncidentNote",
                block_id: "incident-buttons",
                text: { type: "plain_text", text: "📄 Add Note", emoji: true },
                value: ID,
                action_ts: "1760000001.000300",
              },
            ],
          }),
        },
      });
    }

    function noteMetadata(): string {
      return JSON.stringify({
        oneuptime: 1,
        value: ID,
        channelId: INCIDENT_CHANNEL_ID,
      });
    }

    function blockIds(view: JSONObject): Array<string> {
      return (view["blocks"] as Array<JSONObject>).map(
        (block: JSONObject): string => {
          return String(block["block_id"] || block["type"]);
        },
      );
    }

    test("the form is 'Add Private Note': one line says why, then the note - no Note Type to pick", async () => {
      const answer: RouteAnswer = await pressAddNote();

      expect(answer.status).toBe(200);

      const view: JSONObject = await openedForm();

      expect(view["callback_id"]).toBe("SubmitIncidentNote");
      expect(view["title"]).toEqual({
        type: "plain_text",
        text: "Add Private Note",
      });
      expect(textOf([(view["blocks"] as Array<JSONObject>)[0]])).toBe(
        "🔒 This incident is private, so this note is private too: only the people who can see the incident can read it.\n",
      );
      expect(blockIds(view)).not.toContain("noteType");
      expect(elementOf(view, "note")["type"]).toBe("plain_text_input");
      expect(JSON.stringify(view)).not.toContain("Status Page");
      expect(JSON.parse(view["private_metadata"] as string)).toEqual({
        oneuptime: 1,
        value: ID,
        channelId: INCIDENT_CHANNEL_ID,
        projectId: PROJECT_ID.toString(),
      });

      // Whether it is private: read as OneUptime, the incident's switch only.
      expect(incidentReads).toContainEqual({
        query: { _id: ID, projectId: PROJECT_ID },
        props: { isRoot: true },
      });
    });

    test("an incident that is not private gets the form as always: Public Note or Private Note", async () => {
      isIncidentPrivate = false;

      await pressAddNote();
      const view: JSONObject = await openedForm();

      expect(view["title"]).toEqual({ type: "plain_text", text: "Add Note" });
      expect(optionTexts(elementOf(view, "noteType")["options"])).toEqual([
        "Public Note (Will be posted on Status Page)",
        "Private Note (Only visible to team members)",
      ]);
    });

    test("submitted, it adds a private note, as Simon; the form closes, and nothing else is said", async () => {
      const answer: RouteAnswer = await submit({
        callbackId: "SubmitIncidentNote",
        privateMetadata: noteMetadata(),
        state: { note: textInput(NOTE) },
      });

      expect(answer.status).toBe(200);
      expect(answer.body).toEqual({ response_action: "clear" });

      await settle();

      expect(publicNotesAdded).toEqual([]);
      expect(privateNotesAdded).toHaveLength(1);
      expect(privateNotesAdded[0]!["note"]).toBe(NOTE);
      expect(String(privateNotesAdded[0]!["incidentId"])).toBe(ID);
      expect(privateNotesAdded[0]!["props"]).toBe(PROPS);
      expect(slackCalls).toEqual([]);
    });

    test("a form opened before the incident was made private, sent with Public Note: a private note, and Simon is told why where he opened it", async () => {
      const answer: RouteAnswer = await submit({
        callbackId: "SubmitIncidentNote",
        privateMetadata: noteMetadata(),
        state: {
          noteType: staticSelect("public"),
          note: textInput(NOTE),
        },
      });

      expect(answer.body).toEqual({ response_action: "clear" });

      const said: SlackCall = await onlyAnswer();

      // Never a public note: the incident is private now.
      expect(publicNotesAdded).toEqual([]);
      expect(privateNotesAdded).toHaveLength(1);
      expect(privateNotesAdded[0]!["note"]).toBe(NOTE);
      expect(privateNotesAdded[0]!["props"]).toBe(PROPS);

      expect(said.url).toBe("https://slack.com/api/chat.postEphemeral");
      expect(said.data["channel"]).toBe(INCIDENT_CHANNEL_ID);
      expect(said.data["user"]).toBe(SLACK_USER_ID);
      expect(textOf(said.data["blocks"])).toBe(
        `📄 You added a private note to ${RECORD_MRKDWN}. The incident is private, so public notes cannot be added to it.\n`,
      );
    });

    test("Public Note on an incident that is not private is a public note, as always", async () => {
      isIncidentPrivate = false;

      await submit({
        callbackId: "SubmitIncidentNote",
        privateMetadata: noteMetadata(),
        state: {
          noteType: staticSelect("public"),
          note: textInput(NOTE),
        },
      });
      await settle();

      expect(privateNotesAdded).toEqual([]);
      expect(publicNotesAdded).toHaveLength(1);
      expect(publicNotesAdded[0]!["props"]).toBe(PROPS);
      expect(slackCalls).toEqual([]);
    });

    test("a Note Type no form offers is refused, and nothing is added", async () => {
      const answer: RouteAnswer = await submit({
        callbackId: "SubmitIncidentNote",
        privateMetadata: noteMetadata(),
        state: {
          noteType: staticSelect("everyone"),
          note: textInput(NOTE),
        },
      });
      await settle();

      expect(answer.status).toBe(400);
      expect(privateNotesAdded).toEqual([]);
      expect(publicNotesAdded).toEqual([]);
    });
  });

  test("Slack taking longer than its three seconds to open a form: told to try again", async () => {
    viewsOpenError = "expired_trigger_id";

    await choose(`ViewChangeIncidentSeverity:${ID}`);
    const calls: Array<SlackCall> = await slackCallsAfter(2);

    expect(calls[0]!.url).toBe("https://slack.com/api/views.open");
    expect(calls[1]!.url).toBe(PRESS_RESPONSE_URL);
    // Chosen from a menu, not pressed: "try again" says what to do in both.
    expect(textOf(calls[1]!.data["blocks"])).toBe(
      "OneUptime couldn't open the form in time. Please try again.\n",
    );
  });
});
