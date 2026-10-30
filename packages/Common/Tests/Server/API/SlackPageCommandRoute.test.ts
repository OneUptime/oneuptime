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
import Email from "../../../Types/Email";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import BadDataException from "../../../Types/Exception/BadDataException";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { WorkspaceLiveMessageDestinationType } from "../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import Alert from "../../../Models/DatabaseModels/Alert";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import WorkspaceUserGroup from "../../../Models/DatabaseModels/WorkspaceUserGroup";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import {
  OnCallPageRecordType,
  OnCallPageResult,
  OnCallPageTargets,
} from "../../../Server/Services/OnCallPageService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import WorkspaceUserGroupService from "../../../Server/Services/WorkspaceUserGroupService";
import ProductBrandingText from "../../../Server/Utils/ProductBrandingText";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import { WorkspaceEventType } from "../../../Server/Utils/Workspace/WorkspaceMemberActions";
import WorkspaceConnectRequest, {
  WorkspaceConnectRequestAgainKind,
  WorkspaceConnectRequestRecord,
} from "../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import WorkspacePage, {
  WorkspacePageOutcome,
  WorkspacePagePlace,
} from "../../../Server/Utils/Workspace/WorkspacePage";
import WorkspacePageAbout, {
  WORKSPACE_PAGE_NEW_ALERT_SUBJECT,
  WorkspacePageSubject,
} from "../../../Server/Utils/Workspace/WorkspacePageAbout";
import { CONNECT_REQUEST_TOKEN_PATTERN } from "../../../Types/Workspace/ConnectCallback";

/*
 * CUSTOMER FEEDBACK #4, THROUGH SLACK'S OWN ENDPOINTS: "How can we manually
 * trigger a page to someone -- e.g. /oneuptime page @nawaz some-message?"
 *
 * These post what Slack posts for `/oneuptime page ...` - a form,
 * application/x-www-form-urlencoded, with people written <@U0123|name> as
 * the command's escaping sends them - and for the Page someone form's
 * submission, through the real SlackAPI router, authorization and answers.
 * The page itself (WorkspacePage.page) is stood in for: its own suites run
 * it. Every request made to Slack is pinned:
 *
 *   - people @mentioned that OneUptime can tell, and a message: an empty 200,
 *     "📟 Paging Nawaz Dhandala…" only to the person who ran it, then the
 *     page - shown in the channel it was asked from;
 *   - anything else: an empty 200, then the Page someone form (views.open),
 *     with what was typed filled in, and a note for whoever it cannot pick;
 *   - the form, submitted: checked at once, then closed, then the page;
 *   - somebody not connected, not a member, or who may not page: told so
 *     where they ran it, and nobody is paged.
 */

jest.mock("../../../Server/Middleware/SlackAuthorization", () => {
  return {
    __esModule: true,
    default: {
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
const CHANNEL_ID: string = "C0OPS";
const TRIGGER_ID: string = "1760000000.trigger";
const RESPONSE_URL: string =
  "https://hooks.slack.com/commands/T0TEAM/1760000000/pageAbc123";
const PROJECT_ID: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-000000000001",
);
const SIMON: ObjectID = new ObjectID("c4000000-0000-4000-8000-0000000000a1");
const NAWAZ: ObjectID = new ObjectID("c4000000-0000-4000-8000-0000000000a2");
const ANA: ObjectID = new ObjectID("c4000000-0000-4000-8000-0000000000a3");
const OUTSIDER: ObjectID = new ObjectID("c4000000-0000-4000-8000-0000000000a9");
const PRIMARY: ObjectID = new ObjectID("c4000000-0000-4000-8000-0000000000d1");
// A schedule the member may not read.
const HIDDEN: ObjectID = new ObjectID("c4000000-0000-4000-8000-0000000000d9");
const PLATFORM: ObjectID = new ObjectID("c4000000-0000-4000-8000-0000000000e1");
const DB_ESCALATION: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-0000000000f1",
);
const ALERT_ID: ObjectID = new ObjectID("c4000000-0000-4000-8000-0000000000b1");
const RUN_ID: ObjectID = new ObjectID("c4000000-0000-4000-8000-0000000000c1");

const ALERT_URL: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/alerts/${ALERT_ID.toString()}`;
const INCIDENT_ID: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-0000000000b2",
);
const INCIDENT_URL: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/incidents/${INCIDENT_ID.toString()}`;

const PROPS: DatabaseCommonInteractionProps = {
  userId: SIMON,
  tenantId: PROJECT_ID,
};

const NAMES: Record<string, string> = {
  [SIMON.toString()]: "Simon Lee",
  [NAWAZ.toString()]: "Nawaz Dhandala",
  [ANA.toString()]: "Ana Ruiz",
  [OUTSIDER.toString()]: "Olga Outside",
};

// The Slack accounts connected to OneUptime accounts in the project.
const CONNECTED: Record<string, ObjectID> = {
  U0NAWAZ: NAWAZ,
};

// What Slack's users.info tells of a Slack account.
const SLACK_PROFILES: Record<string, { name: string; email?: string }> = {
  U0ANA: { name: "Ana Ruiz", email: "ana@example.com" },
  U0NOEMAIL: { name: "Dana Nomail" },
  U0OLGA: { name: "Olga Outside", email: "olga@example.com" },
};

const ZERO_WIDTH_SPACE: string = String.fromCharCode(0x200b);

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

function userOf(id: ObjectID): User {
  const user: User = new User();
  user.id = id;
  user.name = (NAMES[id.toString()] || "") as never;
  user.email = new Email(
    `${(NAMES[id.toString()] || "x").split(" ")[0]!.toLowerCase()}@example.com`,
  );
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

// What Slack posts for /oneuptime <text>, from Simon in #ops.
function slashCommand(text: string): Record<string, string> {
  return {
    token: "verification-token",
    team_id: SLACK_TEAM_ID,
    team_domain: "acme",
    channel_id: CHANNEL_ID,
    channel_name: "ops",
    user_id: SLACK_USER_ID,
    user_name: "simon",
    command: "/oneuptime",
    text: text,
    api_app_id: "A0ONEUPTIME",
    response_url: RESPONSE_URL,
    trigger_id: TRIGGER_ID,
  };
}

/*
 * What Slack posts when the Page someone form is submitted: the view, with
 * the picks and the message, and where the form was opened.
 */
function formSubmission(data: {
  picks: Array<string>;
  message: string;
  // What the form carries of what it pages about: "" for something new.
  value?: string | undefined;
}): Record<string, string> {
  return {
    payload: JSON.stringify({
      type: "view_submission",
      team: { id: SLACK_TEAM_ID },
      user: { id: SLACK_USER_ID, username: "simon", name: "simon" },
      trigger_id: TRIGGER_ID,
      view: {
        callback_id: "SubmitPageSomeone",
        private_metadata: JSON.stringify({
          oneuptime: 1,
          value: data.value || "",
          channelId: CHANNEL_ID,
        }),
        state: {
          values: {
            pageTargets: {
              pageTargets: {
                type: "multi_static_select",
                selected_options: data.picks.map((value: string) => {
                  return { value: value, text: { text: value } };
                }),
              },
            },
            pageMessage: {
              pageMessage: {
                type: "plain_text_input",
                value: data.message,
              },
            },
          },
        },
      },
    }),
  };
}

function scheduleOf(
  id: ObjectID,
  name: string,
  onCall?: User,
): OnCallDutyPolicySchedule {
  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule.id = id;
  schedule.name = name;

  if (onCall) {
    schedule.currentUserOnRoster = onCall;
  }

  return schedule;
}

/*
 * A Slack user group OneUptime keeps equal to whoever is on call in
 * `scheduleIds` (WorkspaceUserGroup), as the project's rows hold it.
 */
function userGroupOf(data: {
  slackGroupId: string;
  name: string;
  scheduleIds: Array<ObjectID>;
}): WorkspaceUserGroup {
  const row: WorkspaceUserGroup = new WorkspaceUserGroup();
  row.id = ObjectID.generate();
  row.workspaceType = WorkspaceType.Slack;
  row.workspaceGroupId = data.slackGroupId;
  row.name = data.name;
  row.onCallDutyPolicySchedules = data.scheduleIds.map(
    (id: ObjectID): OnCallDutyPolicySchedule => {
      return scheduleOf(id, "");
    },
  );
  return row;
}

function memberOf(user: User): TeamMember {
  const member: TeamMember = new TeamMember();
  member.userId = user.id!;
  member.user = user;
  return member;
}

describe("POST /slack/command: /oneuptime page", () => {
  let app: RoutePort;
  let slackCalls: Array<SlackCall>;
  let linkedUser: ObjectID | null;
  let isMember: boolean;
  let mayPage: boolean;
  let mayCreateAlert: boolean;
  let members: Array<ObjectID>;
  let pages: Array<{
    targets: OnCallPageTargets;
    message: string;
    place: WorkspacePagePlace | undefined;
    props: DatabaseCommonInteractionProps;
    workspaceType: WorkspaceType;
    about: WorkspacePageSubject | undefined;
  }>;
  /*
   * What a page in #ops is about (WorkspacePageAbout.read, its own suite's):
   * something new, or the channel's incident, or a refusal to read it.
   */
  let channelAbout: WorkspacePageSubject | Error;
  // What a submitted form's value reads as, again as the member.
  let valueAbout: WorkspacePageSubject | Error;
  let aboutReads: Array<{ kind: string; at: unknown; props: unknown }>;
  let outcome: () => Promise<WorkspacePageOutcome>;
  let schedules: Array<OnCallDutyPolicySchedule>;
  let viewsOpenError: string | null;
  // The project's user groups that follow on-call schedules.
  let userGroups: Array<WorkspaceUserGroup>;
  let userGroupsAskedWith: Array<unknown>;

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
    mayPage = true;
    mayCreateAlert = true;
    members = [SIMON, NAWAZ, ANA];
    pages = [];
    schedules = [scheduleOf(PRIMARY, "Primary", userOf(NAWAZ))];
    viewsOpenError = null;
    userGroups = [
      userGroupOf({
        slackGroupId: "S0PAYMENTS",
        name: "Payments on-call",
        scheduleIds: [PRIMARY],
      }),
    ];
    userGroupsAskedWith = [];
    channelAbout = WORKSPACE_PAGE_NEW_ALERT_SUBJECT;
    valueAbout = WORKSPACE_PAGE_NEW_ALERT_SUBJECT;
    aboutReads = [];
    outcome = async (): Promise<WorkspacePageOutcome> => {
      return {
        result: pagedResult(),
        isShownAtPlace: true,
        answer: null,
      };
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
    // The Slack accounts the command mentions, as their connections say.
    jest
      .spyOn(WorkspaceUserAuthTokenService, "findBy")
      .mockImplementation((async () => {
        return Object.keys(CONNECTED).map(
          (slackUserId: string): WorkspaceUserAuthToken => {
            const token: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
            token.workspaceUserId = slackUserId;
            token.userId = CONNECTED[slackUserId]!;
            return token;
          },
        );
      }) as never);
    jest
      .spyOn(WorkspaceActionAuthorization, "isProjectMember")
      .mockImplementation(async () => {
        return isMember;
      });
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockResolvedValue(PROPS);
    // The permission check itself is pinned in WorkspaceActionAuthorization's tests.
    jest
      .spyOn(WorkspaceActionAuthorization, "authorize")
      .mockImplementation(async (data: { action: string }) => {
        if (!mayPage) {
          throw new NotAuthorizedException(
            `You do not have permission to ${data.action}. You do not have permissions to create On-Call Duty Policy Execution Log. You need one of these permissions: Project Owner, Project Admin, Project Member.`,
          );
        }

        return PROPS;
      });
    jest
      .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
      .mockImplementation(
        async (data: { modelType: unknown; action: string }) => {
          if (data.modelType === OnCallDutyPolicyExecutionLog && !mayPage) {
            throw new NotAuthorizedException(
              `You do not have permission to ${data.action}.`,
            );
          }

          if (data.modelType === Alert && !mayCreateAlert) {
            throw new NotAuthorizedException(
              `You do not have permission to ${data.action}. You do not have permissions to create Alert. You need one of these permissions: Project Owner, Project Admin, Project Member, Alert Admin.`,
            );
          }
        },
      );
    // What the form offers, as the member may read it.
    jest
      .spyOn(WorkspaceActionAuthorization, "findReadable")
      .mockImplementation((async (data: {
        service: unknown;
        props: unknown;
        query: unknown;
      }) => {
        switch (data.service) {
          case WorkspaceUserGroupService:
            userGroupsAskedWith.push({ props: data.props, query: data.query });
            return userGroups;
          case OnCallDutyPolicyScheduleService:
            return schedules;
          case TeamMemberService:
            return members.map((id: ObjectID) => {
              return memberOf(userOf(id));
            });
          case TeamService: {
            const team: Team = new Team();
            team.id = PLATFORM;
            team.name = "Platform";
            return [team];
          }
          case OnCallDutyPolicyService: {
            const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
            policy.id = DB_ESCALATION;
            policy.name = "DB Escalation";
            return [policy];
          }
          default:
            return [];
        }
      }) as never);
    jest
      .spyOn(ProjectMembership, "getMemberUserIds")
      .mockImplementation(async () => {
        return new Set<string>(
          members.map((id: ObjectID): string => {
            return id.toString().toLowerCase();
          }),
        );
      });
    jest.spyOn(UserService, "findBy").mockImplementation((async (data: {
      query: { email?: unknown };
    }) => {
      const everybody: Array<User> = [SIMON, NAWAZ, ANA, OUTSIDER].map(
        (id: ObjectID): User => {
          return userOf(id);
        },
      );

      if (data.query.email) {
        return everybody.filter((user: User): boolean => {
          return JSON.stringify(data.query.email).includes(
            `"${user.email!.toString()}"`,
          );
        });
      }

      return everybody;
    }) as never);
    jest
      .spyOn(WorkspacePage, "page")
      .mockImplementation(
        async (data: Parameters<typeof WorkspacePage.page>[0]) => {
          pages.push({
            targets: data.targets,
            message: data.message,
            place: data.place,
            props: data.props,
            workspaceType: data.workspaceType,
            about: data.about,
          });
          return await outcome();
        },
      );
    jest
      .spyOn(WorkspacePageAbout, "read")
      .mockImplementation(
        async (data: {
          channelId: string | undefined;
          props: DatabaseCommonInteractionProps;
        }) => {
          aboutReads.push({
            kind: "channel",
            at: data.channelId,
            props: data.props,
          });

          if (channelAbout instanceof Error) {
            throw channelAbout;
          }

          return channelAbout;
        },
      );
    jest
      .spyOn(WorkspacePageAbout, "readValue")
      .mockImplementation(
        async (data: {
          value: string | undefined;
          props: DatabaseCommonInteractionProps;
        }) => {
          aboutReads.push({ kind: "value", at: data.value, props: data.props });

          if (valueAbout instanceof Error) {
            throw valueAbout;
          }

          return valueAbout;
        },
      );
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

      if (url === "https://slack.com/api/users.info") {
        const profile: { name: string; email?: string } | undefined =
          SLACK_PROFILES[String(options.data["user"])];

        return new HTTPResponse<JSONObject>(
          200,
          profile
            ? {
                ok: true,
                user: {
                  name: profile.name.toLowerCase(),
                  profile: {
                    display_name: profile.name,
                    ...(profile.email ? { email: profile.email } : {}),
                  },
                },
              }
            : { ok: false, error: "user_not_found" },
          {},
        );
      }

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

  function pagedResult(): OnCallPageResult {
    return {
      record: {
        type: OnCallPageRecordType.Alert,
        id: ALERT_ID,
        label: "Alert AL-12",
        title: "The checkout API is down",
        url: URL.fromString(ALERT_URL),
        isNew: true,
      },
      paged: [
        {
          userId: NAWAZ,
          name: "Nawaz Dhandala",
          email: "nawaz@example.com",
          teamName: null,
          scheduleName: null,
          coveringForName: null,
        },
      ],
      startedPolicies: [],
      notPaged: [],
      isAnyonePaged: true,
      directPageExecutionLogId: RUN_ID,
      summary: "Paged Nawaz Dhandala about Alert AL-12.",
    };
  }

  function post(text: string): Promise<RouteAnswer> {
    return postForm({
      port: app.port,
      path: "/api/slack/command",
      fields: slashCommand(text),
    });
  }

  function submit(data: {
    picks: Array<string>;
    message: string;
    // What the form carries of what it pages about (formSubmission).
    value?: string | undefined;
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

  // Waits for `count` pages to go out.
  async function pagesAfter(count: number): Promise<void> {
    for (let wait: number = 0; wait < 300; wait++) {
      if (pages.length >= count) {
        return;
      }

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 10);
      });
    }
  }

  // The requests to Slack, but its users.info reads.
  function sentToSlack(): Array<SlackCall> {
    return slackCalls.filter((call: SlackCall): boolean => {
      return call.url !== "https://slack.com/api/users.info";
    });
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

  function inputOf(view: JSONObject, actionId: string): JSONObject | undefined {
    return (view["blocks"] as Array<JSONObject>).find(
      (block: JSONObject): boolean => {
        return (
          (block["element"] as JSONObject | undefined)?.["action_id"] ===
          actionId
        );
      },
    );
  }

  function connectUrlOf(blocks: unknown): string | null {
    const actions: JSONObject | undefined = (
      (blocks as Array<JSONObject> | undefined) || []
    ).find((block: JSONObject): boolean => {
      return block["type"] === "actions";
    });
    const button: JSONObject | undefined = (
      actions?.["elements"] as Array<JSONObject> | undefined
    )?.[0];

    return button ? (button["url"] as string) : null;
  }

  // The form views.open was sent, once the command's work is done.
  async function openedForm(): Promise<JSONObject> {
    const calls: Array<SlackCall> = await slackCallsAfter(1);
    const open: SlackCall | undefined = calls.find((call: SlackCall) => {
      return call.url === "https://slack.com/api/views.open";
    });

    expect(open).toBeDefined();
    expect(open!.data["trigger_id"]).toBe(TRIGGER_ID);

    return open!.data["view"] as JSONObject;
  }

  function pickedIn(view: JSONObject): Array<string> {
    return (
      ((inputOf(view, "pageTargets")?.["element"] as JSONObject)[
        "initial_options"
      ] as Array<JSONObject> | undefined) || []
    ).map((option: JSONObject): string => {
      return option["value"] as string;
    });
  }

  function messageIn(view: JSONObject): unknown {
    return (inputOf(view, "pageMessage")?.["element"] as JSONObject)[
      "initial_value"
    ];
  }

  function notesIn(view: JSONObject): string {
    const first: JSONObject = (view["blocks"] as Array<JSONObject>)[0]!;

    return first["type"] === "section"
      ? String((first["text"] as JSONObject)["text"])
          .split(ZERO_WIDTH_SPACE)
          .join("")
      : "";
  }

  describe("people @mentioned, and a message: paged at once", () => {
    test("/oneuptime page @nawaz The checkout API is down: an empty 200, 'Paging Nawaz Dhandala…' only to Simon, then the page, shown in #ops", async () => {
      const answer: RouteAnswer = await post(
        "page <@U0NAWAZ|nawaz> The checkout API is down",
      );

      // Slack's three seconds: answered at once, with nothing to show.
      expect(answer.status).toBe(200);
      expect(answer.body).toBeNull();

      await pagesAfter(1);
      const calls: Array<SlackCall> = sentToSlack();

      // One answer, only to Simon, before the page goes out.
      expect(
        calls.map((call: SlackCall): string => {
          return call.url;
        }),
      ).toEqual([RESPONSE_URL]);
      expect(calls[0]!.data["response_type"]).toBe("ephemeral");
      expect(textOf(calls[0]!.data["blocks"])).toBe(
        "📟 Paging *Nawaz Dhandala* about a new alert…\n",
      );
      expect(calls[0]!.data["text"]).toBe(
        "Paging Nawaz Dhandala about a new alert…",
      );
      // Read where the command was run, as Simon.
      expect(aboutReads).toEqual([
        { kind: "channel", at: CHANNEL_ID, props: PROPS },
      ]);

      // The page: Nawaz, the message as typed, as Simon, shown in #ops.
      expect(pages).toEqual([
        {
          targets: { userIds: [NAWAZ] },
          message: "The checkout API is down",
          place: {
            workspaceType: WorkspaceType.Slack,
            destinationType: WorkspaceLiveMessageDestinationType.Channel,
            channelId: CHANNEL_ID,
            channelName: "ops",
          },
          props: PROPS,
          workspaceType: WorkspaceType.Slack,
          // #ops is no record's own channel: something new.
          about: WORKSPACE_PAGE_NEW_ALERT_SUBJECT,
        },
      ]);
    });

    test("shown in the channel, the page needs no other answer", async () => {
      await post("page <@U0NAWAZ|nawaz> db down");
      await pagesAfter(1);
      // Long enough for an answer to have gone out, were one sent.
      await slackCallsAfter(2, 30);

      expect(sentToSlack()).toHaveLength(1);
    });

    test("a page the channel does not show - the app is not in it - is answered with what came of it", async () => {
      outcome = async (): Promise<WorkspacePageOutcome> => {
        return {
          result: pagedResult(),
          isShownAtPlace: false,
          answer: {
            markdown: `📟 Paged **Nawaz Dhandala** about **[Alert AL-12](${ALERT_URL})**: “db down”`,
            text: "Paged Nawaz Dhandala about Alert AL-12",
          },
        };
      };

      await post("page <@U0NAWAZ|nawaz> db down");
      const calls: Array<SlackCall> = await slackCallsAfter(2);

      expect(sentToSlack()).toHaveLength(2);
      expect(calls[calls.length - 1]!.url).toBe(RESPONSE_URL);
      expect(textOf(calls[calls.length - 1]!.data["blocks"])).toBe(
        `📟 Paged *Nawaz Dhandala* about *<${ALERT_URL}|Alert AL-12>*: “db down”\n`,
      );
    });

    test("several people, a comma and 'and' between them, a separator before the message", async () => {
      CONNECTED["U0ANA"] = ANA;

      try {
        await post(
          "page <@U0NAWAZ|nawaz>, <@U0ANA|ana> and <@U0NAWAZ|nawaz>: replica is 10 minutes behind",
        );
        await pagesAfter(1);
      } finally {
        delete CONNECTED["U0ANA"];
      }

      expect(pages[0]!.targets).toEqual({ userIds: [NAWAZ, ANA] });
      expect(pages[0]!.message).toBe("replica is 10 minutes behind");
      expect(textOf(sentToSlack()[0]!.data["blocks"])).toBe(
        "📟 Paging *Nawaz Dhandala* and *Ana Ruiz* about a new alert…\n",
      );
    });

    test("somebody whose Slack account is not connected is paged by the email address Slack has for them", async () => {
      await post("page <@U0ANA|ana> db down");
      await pagesAfter(1);

      expect(
        slackCalls.find((call: SlackCall) => {
          return call.url === "https://slack.com/api/users.info";
        })!.data,
      ).toEqual({ user: "U0ANA" });
      expect(pages[0]!.targets).toEqual({ userIds: [ANA] });
    });

    test("a refusal of the page itself - no access to every on-call policy - is told where it was run, as 'Could not page'", async () => {
      outcome = async (): Promise<WorkspacePageOutcome> => {
        throw new NotAuthorizedException(
          "Paging people, teams or on-call schedules directly takes access to every on-call policy of the project. You can start only the policies of the Platform label.",
        );
      };

      await post("page <@U0NAWAZ|nawaz> db down");
      const calls: Array<SlackCall> = await slackCallsAfter(2);

      expect(textOf(calls[calls.length - 1]!.data["blocks"])).toBe(
        "Could not page: Paging people, teams or on-call schedules directly takes access to every on-call policy of the project. You can start only the policies of the Platform label.\n",
      );
    });

    test("/oneuptime page @payments-oncall: the user group OneUptime keeps pages the on-call schedules it follows - 'Paging @payments-oncall…', then the page", async () => {
      const answer: RouteAnswer = await post(
        "page <!subteam^S0PAYMENTS|@payments-oncall> The checkout API is down",
      );

      expect(answer.status).toBe(200);
      expect(answer.body).toBeNull();

      await pagesAfter(1);

      // The project's Slack user groups, read as Simon.
      expect(userGroupsAskedWith).toEqual([
        {
          props: PROPS,
          query: { projectId: PROJECT_ID, workspaceType: WorkspaceType.Slack },
        },
      ]);
      expect(textOf(sentToSlack()[0]!.data["blocks"])).toBe(
        "📟 Paging *@payments-oncall* about a new alert…\n",
      );
      expect(sentToSlack()[0]!.data["text"]).toBe(
        "Paging @payments-oncall about a new alert…",
      );
      expect(pages).toEqual([
        {
          targets: { userIds: [], onCallScheduleIds: [PRIMARY] },
          message: "The checkout API is down",
          place: {
            workspaceType: WorkspaceType.Slack,
            destinationType: WorkspaceLiveMessageDestinationType.Channel,
            channelId: CHANNEL_ID,
            channelName: "ops",
          },
          props: PROPS,
          workspaceType: WorkspaceType.Slack,
          about: WORKSPACE_PAGE_NEW_ALERT_SUBJECT,
        },
      ]);
    });

    test("a person and a user group together: one page, of both", async () => {
      await post(
        "page <@U0NAWAZ|nawaz> and <!subteam^S0PAYMENTS|@payments-oncall>: replica is behind",
      );
      await pagesAfter(1);

      expect(pages[0]!.targets).toEqual({
        userIds: [NAWAZ],
        onCallScheduleIds: [PRIMARY],
      });
      expect(pages[0]!.message).toBe("replica is behind");
      expect(textOf(sentToSlack()[0]!.data["blocks"])).toBe(
        "📟 Paging *Nawaz Dhandala* and *@payments-oncall* about a new alert…\n",
      );
    });

    test("a page that names nobody pageable is told so", async () => {
      outcome = async (): Promise<WorkspacePageOutcome> => {
        throw new BadDataException(
          "Nobody was paged. No member of this project has the ID x.",
        );
      };

      await post("page <@U0NAWAZ|nawaz> db down");
      const calls: Array<SlackCall> = await slackCallsAfter(2);

      expect(textOf(calls[calls.length - 1]!.data["blocks"])).toBe(
        "Could not page: Nobody was paged. No member of this project has the ID x.\n",
      );
    });
  });

  describe("anything else: the Page someone form, with what was typed filled in", () => {
    test("/oneuptime page alone: the empty form - who to page, under their headings, and the message", async () => {
      const answer: RouteAnswer = await post("page");

      expect(answer.status).toBe(200);
      expect(answer.body).toBeNull();

      const view: JSONObject = await openedForm();

      expect(view["callback_id"]).toBe("SubmitPageSomeone");
      expect(view["title"]).toEqual({
        type: "plain_text",
        text: "Page someone",
      });
      expect(view["submit"]).toEqual({ type: "plain_text", text: "Page" });
      expect(view["close"]).toEqual({ type: "plain_text", text: "Cancel" });
      // Its submission is answered in #ops, where it was opened.
      expect(JSON.parse(view["private_metadata"] as string)).toMatchObject({
        channelId: CHANNEL_ID,
      });

      const who: JSONObject = inputOf(view, "pageTargets")!;

      expect(who["block_id"]).toBe("pageTargets");
      expect(who["optional"]).toBe(false);
      expect(who["label"]).toEqual({
        type: "plain_text",
        text: "Who to page",
      });
      expect(who["hint"]).toEqual({
        type: "plain_text",
        text: "A schedule pages whoever is on call in it now. A policy pages through its escalation rules.",
      });
      expect((who["element"] as JSONObject)["type"]).toBe(
        "multi_static_select",
      );
      expect((who["element"] as JSONObject)["options"]).toBeUndefined();
      expect(
        (
          (who["element"] as JSONObject)["option_groups"] as Array<JSONObject>
        ).map((group: JSONObject) => {
          return [
            (group["label"] as JSONObject)["text"],
            (group["options"] as Array<JSONObject>).map(
              (option: JSONObject) => {
                return [
                  (option["text"] as JSONObject)["text"],
                  option["value"],
                ];
              },
            ),
          ];
        }),
      ).toEqual([
        [
          "On-call schedules",
          [
            [
              "Primary (Nawaz Dhandala on call now)",
              `schedule:${PRIMARY.toString()}`,
            ],
          ],
        ],
        [
          "People",
          [
            ["Ana Ruiz", `user:${ANA.toString()}`],
            ["Nawaz Dhandala", `user:${NAWAZ.toString()}`],
            ["Simon Lee (you)", `user:${SIMON.toString()}`],
          ],
        ],
        ["Teams", [["Platform", `team:${PLATFORM.toString()}`]]],
        [
          "On-call policies",
          [["DB Escalation", `policy:${DB_ESCALATION.toString()}`]],
        ],
      ]);
      expect(pickedIn(view)).toEqual([]);

      const message: JSONObject = inputOf(view, "pageMessage")!;
      expect(message["block_id"]).toBe("pageMessage");
      expect(message["label"]).toEqual({
        type: "plain_text",
        text: "Message",
      });
      expect((message["element"] as JSONObject)["multiline"]).toBe(true);
      expect(messageIn(view)).toBeUndefined();

      // Nothing to say above it, and nobody paged yet.
      expect(notesIn(view)).toBe("");
      expect(pages).toEqual([]);
    });

    test("@nawaz with no message: Nawaz picked, the message to write", async () => {
      await post("page <@U0NAWAZ|nawaz>");
      const view: JSONObject = await openedForm();

      expect(pickedIn(view)).toEqual([`user:${NAWAZ.toString()}`]);
      expect(messageIn(view)).toBeUndefined();
      expect(pages).toEqual([]);
    });

    test("a message alone: written in, who to page left to pick", async () => {
      await post("page The checkout API is down");
      const view: JSONObject = await openedForm();

      expect(pickedIn(view)).toEqual([]);
      expect(messageIn(view)).toBe("The checkout API is down");
    });

    test("a schedule's name first: picked, the rest the message - never paged on a name alone", async () => {
      await post("page primary the DB is down");
      const view: JSONObject = await openedForm();

      expect(pickedIn(view)).toEqual([`schedule:${PRIMARY.toString()}`]);
      expect(messageIn(view)).toBe("the DB is down");
      expect(pages).toEqual([]);
    });

    test("somebody whose Slack account is not connected and whose email Slack does not give: a note says so, and they are picked in the form", async () => {
      await post("page <@U0NOEMAIL|dana> db down");
      const view: JSONObject = await openedForm();

      expect(notesIn(view)).toBe(
        "⚠️ OneUptime can't tell who @dana is: their Slack account isn't connected to OneUptime. Pick them below.\n",
      );
      expect(pickedIn(view)).toEqual([]);
      expect(messageIn(view)).toBe("db down");
      expect(pages).toEqual([]);
    });

    test("one who is not a member: a note says so - the others are picked, and nobody is paged until the form is sent", async () => {
      await post("page <@U0NAWAZ|nawaz> <@U0OLGA|olga> db down");
      const view: JSONObject = await openedForm();

      expect(notesIn(view)).toBe(
        "⚠️ @olga isn't a member of this project, so OneUptime can't page them.\n",
      );
      expect(pickedIn(view)).toEqual([`user:${NAWAZ.toString()}`]);
      expect(pages).toEqual([]);
    });

    test("a user group that follows no on-call schedule: a note says what makes one pageable, and to pick who it means", async () => {
      await post("page <!subteam^S0DB|@oncall-db> db down");
      const view: JSONObject = await openedForm();

      expect(notesIn(view)).toBe(
        "⚠️ OneUptime can't page @oncall-db: it isn't connected to an on-call schedule you can see. Pick the on-call schedule, the team or the people below.\n",
      );
      expect(messageIn(view)).toBe("db down");
      expect(pages).toEqual([]);
    });

    test("@here is nobody to page: a note says so", async () => {
      await post("page <!here> db down");
      const view: JSONObject = await openedForm();

      expect(notesIn(view)).toBe(
        "⚠️ OneUptime can't page @here. Pick the on-call schedule, the team or the people below.\n",
      );
      // Nothing to look up for @here.
      expect(userGroupsAskedWith).toEqual([]);
    });

    test("a user group OneUptime keeps, with no message: the form, its schedule picked - nothing to say", async () => {
      await post("page <!subteam^S0PAYMENTS|@payments-oncall>");
      const view: JSONObject = await openedForm();

      expect(pickedIn(view)).toEqual([`schedule:${PRIMARY.toString()}`]);
      expect(notesIn(view)).toBe("");
      expect(pages).toEqual([]);
    });

    test("a user group that follows only a schedule the member may not read: not paged through it - the form, and the note", async () => {
      userGroups = [
        userGroupOf({
          slackGroupId: "S0PAYMENTS",
          name: "Payments on-call",
          scheduleIds: [HIDDEN],
        }),
      ];

      await post("page <!subteam^S0PAYMENTS|@payments-oncall> db down");
      const view: JSONObject = await openedForm();

      expect(notesIn(view)).toBe(
        "⚠️ OneUptime can't page @payments-oncall: it isn't connected to an on-call schedule you can see. Pick the on-call schedule, the team or the people below.\n",
      );
      expect(pickedIn(view)).toEqual([]);
      expect(pages).toEqual([]);
    });

    test("an app created from an older manifest sends '@nawaz' as text: the form, with a note", async () => {
      await post("page @nawaz db down");
      const view: JSONObject = await openedForm();

      expect(notesIn(view)).toBe(
        "⚠️ OneUptime can't tell who @nawaz is. Pick them below.\n",
      );
      expect(messageIn(view)).toBe("db down");
    });

    test("a form Slack would not open in time: told to run the command again", async () => {
      viewsOpenError = "expired_trigger_id";

      await post("page");
      const calls: Array<SlackCall> = await slackCallsAfter(2);

      expect(calls[calls.length - 1]!.url).toBe(RESPONSE_URL);
      expect(textOf(calls[calls.length - 1]!.data["blocks"])).toBe(
        "OneUptime couldn't open the form to page someone in time. Please run the command again.\n",
      );
    });

    test("nothing the member may page at all: told so, and no empty form", async () => {
      schedules = [];
      members = [];
      jest
        .spyOn(WorkspaceActionAuthorization, "findReadable")
        .mockResolvedValue([] as never);

      await post("page");
      const calls: Array<SlackCall> = await slackCallsAfter(1);

      expect(
        calls.map((call: SlackCall): string => {
          return call.url;
        }),
      ).toEqual([RESPONSE_URL]);
      expect(textOf(calls[0]!.data["blocks"])).toBe(
        "There is nobody you can page in this project yet: no on-call schedules, people, teams or on-call policies are available to you.\n",
      );
    });
  });

  describe("who may page", () => {
    test("an account nobody connected: one answer, with a Connect button - and to run /oneuptime page again; nobody is paged", async () => {
      linkedUser = null;

      const answer: RouteAnswer = await post("page <@U0NAWAZ|nawaz> db down");

      expect(answer.status).toBe(200);
      expect(answer.body).toBeNull();

      const calls: Array<SlackCall> = await slackCallsAfter(1);

      expect(
        calls.map((call: SlackCall): string => {
          return call.url;
        }),
      ).toEqual([RESPONSE_URL]);
      // The prompt, then its Connect button.
      expect(textOf(calls[0]!.data["blocks"])).toBe(
        "🔗 *Connect your Slack account to page someone.* It takes one click. Then run */oneuptime page* again.\n\n",
      );

      const connectUrl: globalThis.URL = new globalThis.URL(
        connectUrlOf(calls[0]!.data["blocks"]) || "",
      );
      const token: string | null = connectUrl.searchParams.get("connect");
      expect(token).toMatch(CONNECT_REQUEST_TOKEN_PATTERN);

      // Never paged for them once they connect: they run it again.
      const request: WorkspaceConnectRequestRecord | null =
        await WorkspaceConnectRequest.peek(token);
      expect(request).toMatchObject({
        workspaceUserId: SLACK_USER_ID,
        purpose: "page someone",
        again: {
          kind: WorkspaceConnectRequestAgainKind.Command,
          label: "/oneuptime page",
        },
      });
      expect(request!.pendingAction).toBeUndefined();
      expect(pages).toEqual([]);
    });

    test("somebody no longer a member of the project: told so, and nobody is paged", async () => {
      isMember = false;

      await post("page <@U0NAWAZ|nawaz> db down");
      const calls: Array<SlackCall> = await slackCallsAfter(1);

      expect(textOf(calls[0]!.data["blocks"])).toBe(
        "Your OneUptime account is not a member of this project. Ask a project admin to invite you, then try again.\n",
      );
      expect(pages).toEqual([]);
    });

    test("somebody who may not start an on-call run: told which permission it takes, before any form", async () => {
      mayPage = false;

      await post("page");
      const calls: Array<SlackCall> = await slackCallsAfter(1);

      expect(
        calls.map((call: SlackCall): string => {
          return call.url;
        }),
      ).toEqual([RESPONSE_URL]);
      expect(textOf(calls[0]!.data["blocks"])).toBe(
        "You do not have permission to page people. You do not have permissions to create On-Call Duty Policy Execution Log. You need one of these permissions: Project Owner, Project Admin, Project Member.\n",
      );
      expect(pages).toEqual([]);
    });

    test("somebody who may not create the alert a page is: told so, and nobody is paged", async () => {
      mayCreateAlert = false;

      await post("page <@U0NAWAZ|nawaz> db down");
      const calls: Array<SlackCall> = await slackCallsAfter(1);

      expect(textOf(calls[0]!.data["blocks"])).toBe(
        "You do not have permission to page people. You do not have permissions to create Alert. You need one of these permissions: Project Owner, Project Admin, Project Member, Alert Admin.\n",
      );
      expect(pages).toEqual([]);
    });
  });

  describe("the Page someone form, submitted", () => {
    test("checked at once: nobody picked and no message are answered on the form itself, which stays open", async () => {
      const answer: RouteAnswer = await submit({ picks: [], message: "   " });

      expect(answer.status).toBe(200);
      expect(answer.body).toEqual({
        response_action: "errors",
        errors: {
          pageTargets: "Pick who to page.",
          pageMessage: "Write what the page is about.",
        },
      });
      expect(pages).toEqual([]);
    });

    test("closed at once, then the page: everybody picked, the message as written, shown where the form was opened", async () => {
      const answer: RouteAnswer = await submit({
        picks: [
          `schedule:${PRIMARY.toString()}`,
          `user:${NAWAZ.toString()}`,
          `team:${PLATFORM.toString()}`,
          `policy:${DB_ESCALATION.toString()}`,
        ],
        message: "The checkout API is down\nsince 9:58",
      });

      expect(answer.body).toEqual({ response_action: "clear" });

      await pagesAfter(1);

      expect(pages).toEqual([
        {
          targets: {
            userIds: [NAWAZ],
            teamIds: [PLATFORM],
            onCallScheduleIds: [PRIMARY],
            onCallDutyPolicyIds: [DB_ESCALATION],
          },
          message: "The checkout API is down\nsince 9:58",
          place: {
            workspaceType: WorkspaceType.Slack,
            destinationType: WorkspaceLiveMessageDestinationType.Channel,
            channelId: CHANNEL_ID,
          },
          props: PROPS,
          workspaceType: WorkspaceType.Slack,
          // A form that carries no record pages about something new.
          about: WORKSPACE_PAGE_NEW_ALERT_SUBJECT,
        },
      ]);
    });

    test("a refusal of the page is told in the channel the form was opened from, only to the person", async () => {
      outcome = async (): Promise<WorkspacePageOutcome> => {
        throw new NotAuthorizedException("You may not page these people.");
      };

      await submit({
        picks: [`user:${NAWAZ.toString()}`],
        message: "db down",
      });
      const calls: Array<SlackCall> = await slackCallsAfter(1);

      expect(calls[0]!.url).toBe("https://slack.com/api/chat.postEphemeral");
      expect(calls[0]!.data["channel"]).toBe(CHANNEL_ID);
      expect(calls[0]!.data["user"]).toBe(SLACK_USER_ID);
      expect(textOf(calls[0]!.data["blocks"])).toBe(
        "Could not page: You may not page these people.\n",
      );
    });

    test("submitted by somebody who may no longer page: told so, and nobody is paged", async () => {
      mayPage = false;

      await submit({ picks: [`user:${NAWAZ.toString()}`], message: "db" });
      await slackCallsAfter(1);

      expect(pages).toEqual([]);
    });
  });

  /*
   * THE MAINTAINER'S ASK (block 31): "If I am paging someone from an
   * incident channel, it's because of that incident. You should not create
   * an alert for it." In #ops made into an incident's own channel - as
   * WorkspacePageAbout.read says it is - the page is about the incident.
   */
  describe("in an incident's own channel: the page is about the incident, and nothing new is made", () => {
    function incidentAbout(): WorkspacePageSubject {
      return {
        record: {
          type: OnCallPageRecordType.Incident,
          event: {
            type: WorkspaceEventType.Incident,
            id: INCIDENT_ID,
            projectId: PROJECT_ID,
            currentStateId: undefined,
            number: 42,
            numberWithPrefix: "INC-42",
          },
          name: { label: "Incident INC-42", link: INCIDENT_URL },
          title: "Checkout is down",
        },
      };
    }

    function alertAbout(): WorkspacePageSubject {
      return {
        record: {
          type: OnCallPageRecordType.Alert,
          event: {
            type: WorkspaceEventType.Alert,
            id: ALERT_ID,
            projectId: PROJECT_ID,
            currentStateId: undefined,
            number: 3,
            numberWithPrefix: "ALT-3",
          },
          name: { label: "Alert ALT-3", link: ALERT_URL },
          title: "Disk almost full",
        },
      };
    }

    test("@nawaz with no message pages at once - the incident says what it is about - and Simon is told it is about the incident", async () => {
      channelAbout = incidentAbout();

      await post("page <@U0NAWAZ|nawaz>");
      await pagesAfter(1);

      // Nobody is asked for a message, and no form opens.
      expect(
        sentToSlack().map((call: SlackCall): string => {
          return call.url;
        }),
      ).toEqual([RESPONSE_URL]);
      expect(textOf(sentToSlack()[0]!.data["blocks"])).toBe(
        "📟 Paging *Nawaz Dhandala* about Incident INC-42…\n",
      );
      expect(sentToSlack()[0]!.data["text"]).toBe(
        "Paging Nawaz Dhandala about Incident INC-42…",
      );
      expect(pages).toEqual([
        {
          targets: { userIds: [NAWAZ] },
          message: "",
          place: {
            workspaceType: WorkspaceType.Slack,
            destinationType: WorkspaceLiveMessageDestinationType.Channel,
            channelId: CHANNEL_ID,
            channelName: "ops",
          },
          props: PROPS,
          workspaceType: WorkspaceType.Slack,
          about: incidentAbout(),
        },
      ]);
    });

    test("a message after @nawaz is the page's own message, passed on as typed", async () => {
      channelAbout = incidentAbout();

      await post("page <@U0NAWAZ|nawaz> Can you check the database?");
      await pagesAfter(1);

      expect(pages).toHaveLength(1);
      expect(pages[0]!.message).toBe("Can you check the database?");
      expect(pages[0]!.about).toEqual(incidentAbout());
    });

    test("in an alert's own channel, the page is about the alert", async () => {
      channelAbout = alertAbout();

      await post("page <@U0NAWAZ|nawaz>");
      await pagesAfter(1);

      expect(textOf(sentToSlack()[0]!.data["blocks"])).toBe(
        "📟 Paging *Nawaz Dhandala* about Alert ALT-3…\n",
      );
      expect(pages[0]!.about).toEqual(alertAbout());
    });

    test("/oneuptime page alone: the form opens with the incident, its message optional, and carries the incident", async () => {
      channelAbout = incidentAbout();

      await post("page");
      const view: JSONObject = await openedForm();

      // The incident first, as the incident's own forms open.
      const heading: JSONObject = (view["blocks"] as Array<JSONObject>)[0]!;
      expect(heading["type"]).toBe("section");
      expect(
        String((heading["text"] as JSONObject)["text"])
          .split(ZERO_WIDTH_SPACE)
          .join(""),
      ).toBe(`🚨 *<${INCIDENT_URL}|INC-42>* Checkout is down\n`);

      const message: JSONObject = inputOf(view, "pageMessage")!;
      expect(message["optional"]).toBe(true);
      expect(message["hint"]).toEqual({
        type: "plain_text",
        text: "Optional. The people you page see it with Incident INC-42.",
      });
      expect((message["element"] as JSONObject)["max_length"]).toBe(500);

      // Its submission reads the incident again, from the form.
      expect(
        JSON.parse(view["private_metadata"] as string) as JSONObject,
      ).toMatchObject({
        value: `incident:${INCIDENT_ID.toString()}`,
        channelId: CHANNEL_ID,
      });
      expect(pages).toEqual([]);
    });

    test("the form submitted with no message pages about the incident it carries, read again as Simon", async () => {
      valueAbout = incidentAbout();

      const answer: RouteAnswer = await submit({
        picks: [`team:${PLATFORM.toString()}`],
        message: "",
        value: `incident:${INCIDENT_ID.toString()}`,
      });

      // No "Write what the page is about." for a page about an incident.
      expect(answer.body).toEqual({ response_action: "clear" });

      await pagesAfter(1);

      expect(aboutReads).toEqual([
        {
          kind: "value",
          at: `incident:${INCIDENT_ID.toString()}`,
          props: PROPS,
        },
      ]);
      expect(pages).toHaveLength(1);
      expect(pages[0]!.targets).toEqual({
        userIds: [],
        teamIds: [PLATFORM],
        onCallScheduleIds: [],
        onCallDutyPolicyIds: [],
      });
      expect(pages[0]!.message).toBe("");
      expect(pages[0]!.about).toEqual(incidentAbout());
    });

    test("a form whose incident was resolved after it opened pages nobody, and says why", async () => {
      valueAbout = {
        record: null,
        resolvedRecord: { label: "Incident INC-42", link: INCIDENT_URL },
      };

      await submit({
        picks: [`user:${NAWAZ.toString()}`],
        message: "",
        value: `incident:${INCIDENT_ID.toString()}`,
      });
      const calls: Array<SlackCall> = await slackCallsAfter(1);

      expect(pages).toEqual([]);
      expect(calls[0]!.url).toBe("https://slack.com/api/chat.postEphemeral");
      expect(textOf(calls[0]!.data["blocks"])).toBe(
        "Incident INC-42 was resolved after the form opened, so nobody was paged.\n",
      );
    });

    test("the channel of an incident Simon may not read: told why, and nobody is paged, no form", async () => {
      channelAbout = new NotAuthorizedException(
        "You do not have permission to page someone about this incident: this incident is private, so only its owners and the people its private team names can see it.",
      );

      await post("page <@U0NAWAZ|nawaz> db down");
      const calls: Array<SlackCall> = await slackCallsAfter(1);
      await slackCallsAfter(2, 30);

      expect(pages).toEqual([]);
      expect(
        sentToSlack().map((call: SlackCall): string => {
          return call.url;
        }),
      ).toEqual([RESPONSE_URL]);
      expect(textOf(calls[0]!.data["blocks"])).toBe(
        "You do not have permission to page someone about this incident: this incident is private, so only its owners and the people its private team names can see it.\n",
      );
    });

    test("a member who may not create alerts pages about the incident all the same: nothing is created, so no alert is asked for", async () => {
      mayCreateAlert = false;
      channelAbout = incidentAbout();

      await post("page <@U0NAWAZ|nawaz> Can you check the database?");
      await pagesAfter(1);

      expect(textOf(sentToSlack()[0]!.data["blocks"])).toBe(
        "📟 Paging *Nawaz Dhandala* about Incident INC-42…\n",
      );
      expect(pages).toHaveLength(1);
      expect(pages[0]!.about).toEqual(incidentAbout());
    });

    test("their form, submitted, pages about the incident it carries too", async () => {
      mayCreateAlert = false;
      valueAbout = incidentAbout();

      const answer: RouteAnswer = await submit({
        picks: [`user:${NAWAZ.toString()}`],
        message: "",
        value: `incident:${INCIDENT_ID.toString()}`,
      });

      expect(answer.body).toEqual({ response_action: "clear" });

      await pagesAfter(1);

      expect(pages).toHaveLength(1);
      expect(pages[0]!.about).toEqual(incidentAbout());
    });

    test("in a resolved incident's channel the page is about something new: a member who may not create alerts is told so, and nobody is paged", async () => {
      mayCreateAlert = false;
      channelAbout = {
        record: null,
        resolvedRecord: { label: "Incident INC-42", link: INCIDENT_URL },
      };

      await post("page <@U0NAWAZ|nawaz> db down");
      const calls: Array<SlackCall> = await slackCallsAfter(1);
      await slackCallsAfter(2, 30);

      expect(textOf(calls[0]!.data["blocks"])).toBe(
        "You do not have permission to page people. You do not have permissions to create Alert. You need one of these permissions: Project Owner, Project Admin, Project Member, Alert Admin.\n",
      );
      expect(pages).toEqual([]);
    });

    test("somebody who may not start an on-call run is refused in the incident's channel too, before its incident is read", async () => {
      mayPage = false;
      channelAbout = incidentAbout();

      await post("page <@U0NAWAZ|nawaz>");
      const calls: Array<SlackCall> = await slackCallsAfter(1);

      expect(textOf(calls[0]!.data["blocks"])).toBe(
        "You do not have permission to page people. You do not have permissions to create On-Call Duty Policy Execution Log. You need one of these permissions: Project Owner, Project Admin, Project Member.\n",
      );
      expect(aboutReads).toEqual([]);
      expect(pages).toEqual([]);
    });

    test("the channel of a resolved incident: a page about something new, and the form says why its message becomes a new alert's title", async () => {
      channelAbout = {
        record: null,
        resolvedRecord: { label: "Incident INC-42", link: INCIDENT_URL },
      };

      await post("page <@U0NAWAZ|nawaz>");
      const view: JSONObject = await openedForm();

      // A new alert needs its title: the form asks for the message.
      expect(inputOf(view, "pageMessage")!["optional"]).toBe(false);
      expect(inputOf(view, "pageMessage")!["hint"]).toEqual({
        type: "plain_text",
        text: "Incident INC-42 is resolved, so the people you page get this as the title of a new alert.",
      });
      expect(
        (JSON.parse(view["private_metadata"] as string) as JSONObject)["value"],
      ).toBe("");
      expect(pages).toEqual([]);
    });
  });
});
