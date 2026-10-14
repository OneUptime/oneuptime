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
import DatabaseConfig from "../../../Server/DatabaseConfig";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import {
  OnCallPageRecordType,
  OnCallPageResult,
} from "../../../Server/Services/OnCallPageService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import ProductBrandingText from "../../../Server/Utils/ProductBrandingText";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceConnectRequest, {
  WorkspaceConnectRequestAgainKind,
  WorkspaceConnectRequestRecord,
} from "../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import WorkspacePage, {
  WorkspacePageOutcome,
  WorkspacePagePlace,
} from "../../../Server/Utils/Workspace/WorkspacePage";
import { OnCallPageTargets } from "../../../Server/Services/OnCallPageService";
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
const OUTSIDER: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-0000000000a9",
);
const PRIMARY: ObjectID = new ObjectID("c4000000-0000-4000-8000-0000000000d1");
const PLATFORM: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-0000000000e1",
);
const DB_ESCALATION: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-0000000000f1",
);
const ALERT_ID: ObjectID = new ObjectID(
  "c4000000-0000-4000-8000-0000000000b1",
);
const RUN_ID: ObjectID = new ObjectID("c4000000-0000-4000-8000-0000000000c1");

const ALERT_URL: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/alerts/${ALERT_ID.toString()}`;

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
          value: "",
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

function scheduleOf(id: ObjectID, name: string, onCall?: User): OnCallDutyPolicySchedule {
  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule.id = id;
  schedule.name = name;

  if (onCall) {
    schedule.currentUserOnRoster = onCall;
  }

  return schedule;
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
  }>;
  let outcome: () => Promise<WorkspacePageOutcome>;
  let schedules: Array<OnCallDutyPolicySchedule>;
  let viewsOpenError: string | null;

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
    schedules = [
      scheduleOf(PRIMARY, "Primary", userOf(NAWAZ)),
    ];
    viewsOpenError = null;
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
      .mockImplementation(async (data: { modelType: unknown; action: string }) => {
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
      });
    // What the form offers, as the member may read it.
    jest
      .spyOn(WorkspaceActionAuthorization, "findReadable")
      .mockImplementation((async (data: { service: unknown }) => {
        switch (data.service) {
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
    jest
      .spyOn(UserService, "findBy")
      .mockImplementation((async (data: { query: { email?: unknown } }) => {
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
      .mockImplementation(async (data: Parameters<typeof WorkspacePage.page>[0]) => {
        pages.push({
          targets: data.targets,
          message: data.message,
          place: data.place,
          props: data.props,
          workspaceType: data.workspaceType,
        });
        return await outcome();
      });
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
        return String((block["text"] as JSONObject | undefined)?.["text"] || "");
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
        "📟 Paging *Nawaz Dhandala*…\n",
      );
      expect(calls[0]!.data["text"]).toBe("Paging Nawaz Dhandala…");

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
        "📟 Paging *Nawaz Dhandala* and *Ana Ruiz*…\n",
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
        text: "A schedule pages whoever is on call in it now. Everybody you pick is paged at once.",
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
                return [(option["text"] as JSONObject)["text"], option["value"]];
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
        "⚠️ OneUptime can't tell who @dana is: their Slack account isn't connected to OneUptime.\n",
      );
      expect(pickedIn(view)).toEqual([]);
      expect(messageIn(view)).toBe("db down");
      expect(pages).toEqual([]);
    });

    test("one who is not a member: a note says so - the others are picked, and nobody is paged until the form is sent", async () => {
      await post("page <@U0NAWAZ|nawaz> <@U0OLGA|olga> db down");
      const view: JSONObject = await openedForm();

      expect(notesIn(view)).toBe(
        "⚠️ @olga isn't a member of this project.\n",
      );
      expect(pickedIn(view)).toEqual([`user:${NAWAZ.toString()}`]);
      expect(pages).toEqual([]);
    });

    test("a user group: a note says OneUptime cannot page it, and to pick who it means", async () => {
      await post("page <!subteam^S0DB|@oncall-db> db down");
      const view: JSONObject = await openedForm();

      expect(notesIn(view)).toBe(
        "⚠️ OneUptime can't page @oncall-db. Pick the on-call schedule, the team or the people below.\n",
      );
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
          pageMessage:
            "Write what the page is about: it is what the people paged are told.",
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
});
