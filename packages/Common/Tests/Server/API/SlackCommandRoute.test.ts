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
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import User from "../../../Models/DatabaseModels/User";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import AIService from "../../../Server/Services/AIService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import ObservabilityAssistant from "../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import ProductBrandingText from "../../../Server/Utils/ProductBrandingText";
import logger from "../../../Server/Utils/Logger";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceConnectRequest, {
  WorkspaceConnectRequestAgainKind,
  WorkspaceConnectRequestRecord,
} from "../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import WorkspaceMessageTime from "../../../Server/Utils/Workspace/WorkspaceMessageTime";
import { CONNECT_REQUEST_TOKEN_PATTERN } from "../../../Types/Workspace/ConnectCallback";

/*
 * CUSTOMER FEEDBACK #5, THROUGH SLACK'S OWN ENDPOINTS.
 *
 * "I noticed it registers as /incident, /maintenance. This can easily
 * conflict with the other apps we have. Can we have a prefix namespace e.g.
 * /irm incident, /irm maintenance?"
 *
 * The Slack app has one command now, /oneuptime, and Slack posts it, with
 * whatever followed it, to /api/slack/command. These post what Slack posts
 * for a slash command - a form, application/x-www-form-urlencoded - through
 * the real router, authorization and answers (only the database reads under
 * them are stubbed), and pin every request made to Slack:
 *
 *   - help, nothing, or a command misspelt: the commands, answered at once
 *     in the HTTP response, only to the person who ran it - no request to
 *     Slack, no question to AI;
 *   - incident and maintenance: an empty 200, then the form (views.open)
 *     with the title filled in, as /incident and /maintenance opened it;
 *   - oncall: an empty 200, then who is on call, at the command's
 *     response_url;
 *   - ask, or anything else: a question for OneUptime AI, as before;
 *   - somebody not connected: asked to connect, and to run the command
 *     again - named as they typed it.
 *
 * And the old commands: an app created from an older manifest still posts
 * /incident and /maintenance to /api/slack/interactive, where they open the
 * same forms, and are named as typed when somebody must run them again.
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
const SLACK_USER_ID: string = "U0NITIN";
const CHANNEL_ID: string = "C0OPS";
const TRIGGER_ID: string = "1760000000.trigger";
const RESPONSE_URL: string =
  "https://hooks.slack.com/commands/T0TEAM/1760000000/abcDEF123";
const PROJECT_ID: ObjectID = new ObjectID(
  "c2000000-0000-4000-8000-000000000001",
);
const MEMBER_ID: ObjectID = new ObjectID(
  "c2000000-0000-4000-8000-0000000000a1",
);
const SIMON_ID: ObjectID = new ObjectID("c2000000-0000-4000-8000-0000000000b1");
const SEVERITY_ID: ObjectID = new ObjectID(
  "c2000000-0000-4000-8000-0000000000c1",
);
const SCHEDULE_ID: ObjectID = new ObjectID(
  "c2000000-0000-4000-8000-0000000000d1",
);
const HANDOFF: Date = new Date("2026-10-17T09:00:00.000Z");

const PROPS: DatabaseCommonInteractionProps = {
  userId: MEMBER_ID,
  tenantId: PROJECT_ID,
};

const SLACK_HELP_TEXT: string = [
  "👋 ​*Here's what `/oneuptime` can do*​",
  "",
  "•   `/oneuptime incident [title or number]`: declare an incident, or act on one by its number",
  "•   `/oneuptime maintenance [title]`: schedule maintenance",
  "•   `/oneuptime oncall`: see who is on call right now",
  "•   `/oneuptime page [who] [message]`: page a person, a team or whoever is on call",
  "•   `/oneuptime ask [question]`: ask OneUptime AI about your logs, traces, metrics, incidents and monitors",
  "•   `/oneuptime help`: list every command",
  "",
  "For example: `/oneuptime incident Checkout is down`. Anything else after `/oneuptime` is a question for OneUptime AI too, such as `/oneuptime which monitors are down?`",
  "",
].join("\n");

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

/*
 * The SlackAPI router on an app that reads bodies as the server does:
 * Slack posts commands and presses as forms.
 */
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

// Posts a form, as Slack does, and reads the JSON it is answered with.
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

// What Slack posts for /oneuptime <text>, from the Slack user in #ops.
function slashCommand(
  text: string,
  command: string = "/oneuptime",
): Record<string, string> {
  return {
    token: "verification-token",
    team_id: SLACK_TEAM_ID,
    team_domain: "acme",
    channel_id: CHANNEL_ID,
    channel_name: "ops",
    user_id: SLACK_USER_ID,
    user_name: "nitin",
    command: command,
    text: text,
    api_app_id: "A0ONEUPTIME",
    response_url: RESPONSE_URL,
    trigger_id: TRIGGER_ID,
  };
}

describe("POST /slack/command: /oneuptime and the words after it", () => {
  let app: RoutePort;
  let slackCalls: Array<SlackCall>;
  let workspaceConnected: boolean;
  let linkedUser: ObjectID | null;
  let isMember: boolean;
  let mayDeclare: boolean;
  let aiEnabled: boolean;
  let assistantQuestions: Array<string>;
  let schedules: Array<OnCallDutyPolicySchedule>;

  beforeAll(async () => {
    app = await startSlackApp();
  }, 600000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    slackCalls = [];
    workspaceConnected = true;
    linkedUser = MEMBER_ID;
    isMember = true;
    mayDeclare = true;
    aiEnabled = true;
    assistantQuestions = [];
    schedules = [];
    (
      jest.requireMock("../../../Server/Infrastructure/GlobalCache") as {
        default: { store: Map<string, unknown> };
      }
    ).default.store.clear();

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
      .mockImplementation((async () => {
        if (!workspaceConnected) {
          return null;
        }

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
      .mockResolvedValue(PROPS);
    // The permission check itself has its own tests (SlackNewIncidentModalScope).
    jest
      .spyOn(WorkspaceActionAuthorization, "authorize")
      .mockImplementation(async (data: { action: string }) => {
        if (!mayDeclare) {
          throw new NotAuthorizedException(
            `You do not have permission to ${data.action}.`,
          );
        }

        return PROPS;
      });
    // The form's lists, as the member may read them: one severity.
    jest
      .spyOn(WorkspaceActionAuthorization, "findReadable")
      .mockImplementation((async (data: { service: unknown }) => {
        if (data.service === IncidentSeverityService) {
          const severity: IncidentSeverity = new IncidentSeverity();
          severity._id = SEVERITY_ID.toString();
          severity.name = "Critical";
          return [severity];
        }

        return [];
      }) as never);
    jest
      .spyOn(OnCallDutyPolicyScheduleService, "findBy")
      .mockImplementation((async () => {
        return schedules;
      }) as never);
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString(DASHBOARD_URL));
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("OneUptime");
    jest.spyOn(AIService, "isProjectAIEnabled").mockImplementation(async () => {
      return aiEnabled;
    });
    jest
      .spyOn(AIService, "getReachedProjectDailyLimit")
      .mockResolvedValue(null);
    // No AI credits used up: with billing on, as CI runs Common, the real check reads Postgres.
    jest.spyOn(AIService, "getAiBalanceBlocker").mockResolvedValue(null);
    jest
      .spyOn(ObservabilityAssistant, "answerQuestion")
      .mockImplementation((async (data: { question: string }) => {
        assistantQuestions.push(data.question);
        return {
          contentInMarkdown: "Two monitors are down: **API** and **Checkout**.",
          citations: [],
          totalTokens: 10,
          llmCallCount: 1,
          toolCallCount: 1,
        };
      }) as never);

    // Slack: every request is recorded, and taken.
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
  });

  function post(
    text: string,
    command?: string | undefined,
  ): Promise<RouteAnswer> {
    return postForm({
      port: app.port,
      path: "/api/slack/command",
      fields: slashCommand(text, command),
    });
  }

  /*
   * Slack is answered first; what follows it comes after. Waits for
   * `count` requests to Slack, for `attempts` tens of milliseconds at most.
   */
  async function slackCallsAfter(
    count: number,
    attempts: number = 200,
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

  function urlsOf(calls: Array<SlackCall>): Array<string> {
    return calls.map((call: SlackCall): string => {
      return call.url;
    });
  }

  // The text of a message's first section.
  function sectionText(blocks: unknown): string {
    const first: JSONObject | undefined = ((blocks as
      | Array<JSONObject>
      | undefined) || [])[0];

    return ((first?.["text"] as JSONObject | undefined)?.["text"] ||
      "") as string;
  }

  // The Connect button of an answer, if it has one.
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

  // The input of a modal whose element is `actionId`.
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

  describe("help: the commands, at once, only to the person who ran it", () => {
    test("/oneuptime help: every command, one short line each, as the HTTP response itself - nothing asked of Slack or AI", async () => {
      const answer: RouteAnswer = await post("help");

      expect(answer.status).toBe(200);
      expect(answer.body).toEqual({
        response_type: "ephemeral",
        text: "Here's what /oneuptime can do: incident, maintenance, oncall, page, ask, help",
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: SLACK_HELP_TEXT },
          },
        ],
      });

      // Long enough for a request to have gone out, were one sent.
      await slackCallsAfter(1, 30);
      expect(slackCalls).toEqual([]);
      expect(assistantQuestions).toEqual([]);
    });

    test.each(["", "   ", "HELP", "Help!", "?", "ask", "  ask  "])(
      "/oneuptime %j: the same commands",
      async (text: string) => {
        const answer: RouteAnswer = await post(text);

        expect(answer.status).toBe(200);
        expect(sectionText(answer.body?.["blocks"])).toBe(SLACK_HELP_TEXT);
        await slackCallsAfter(1, 30);
        expect(slackCalls).toEqual([]);
        expect(assistantQuestions).toEqual([]);
      },
    );

    test("help needs no connected account, and no project connected: it reads nothing", async () => {
      workspaceConnected = false;
      linkedUser = null;

      const answer: RouteAnswer = await post("help");

      expect(sectionText(answer.body?.["blocks"])).toBe(SLACK_HELP_TEXT);
      expect(WorkspaceProjectAuthTokenService.findOneBy).not.toHaveBeenCalled();
      expect(WorkspaceProjectAuthTokenService.findBy).not.toHaveBeenCalled();
    });

    test("/oneuptime incidnet Checkout is down - a command misspelt: the command it looks like, ready to run, and how to ask AI instead - one short answer, never a question to AI", async () => {
      const answer: RouteAnswer = await post("incidnet Checkout is down");

      expect(answer.status).toBe(200);
      expect(answer.body).toEqual({
        response_type: "ephemeral",
        text: "/oneuptime incidnet is not a command. Did you mean /oneuptime incident Checkout is down?",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "🤔 `/oneuptime incidnet` is not a command. Did you mean `/oneuptime incident Checkout is down`? To ask OneUptime AI instead, start with `/oneuptime ask`.\n",
            },
          },
        ],
      });
      await slackCallsAfter(1, 30);
      expect(slackCalls).toEqual([]);
      expect(assistantQuestions).toEqual([]);
    });

    test("/oneuptime ask incidnet Checkout is down - the way out the answer offers - asks AI the question, as typed", async () => {
      await post("ask incidnet Checkout is down");
      await slackCallsAfter(1);

      expect(assistantQuestions).toEqual(["incidnet Checkout is down"]);
    });

    test("a workspace that runs OneUptime with a command of its own: the help names that command", async () => {
      const answer: RouteAnswer = await post("help", "/irm");

      expect(sectionText(answer.body?.["blocks"])).toBe(
        SLACK_HELP_TEXT.split("/oneuptime").join("/irm"),
      );
    });
  });

  describe("incident and maintenance: the forms /incident and /maintenance opened", () => {
    test("/oneuptime incident Checkout is down: an empty 200 at once, then the New Incident form with the title filled in, where the command was run", async () => {
      const answer: RouteAnswer = await post("incident Checkout is down");

      // Slack's three seconds: answered at once, with nothing to show.
      expect(answer.status).toBe(200);
      expect(answer.body).toBeNull();

      const calls: Array<SlackCall> = await slackCallsAfter(1);

      expect(urlsOf(calls)).toEqual(["https://slack.com/api/views.open"]);
      expect(calls[0]!.data["trigger_id"]).toBe(TRIGGER_ID);

      const view: JSONObject = calls[0]!.data["view"] as JSONObject;
      expect(view["callback_id"]).toBe("SubmitNewIncident");
      expect(view["title"]).toEqual({
        type: "plain_text",
        text: "New Incident",
      });
      expect(
        (inputOf(view, "incidentTitle")?.["element"] as JSONObject)[
          "initial_value"
        ],
      ).toBe("Checkout is down");
      // The form's submission is answered in #ops, where it was opened.
      expect(JSON.parse(view["private_metadata"] as string)).toMatchObject({
        channelId: CHANNEL_ID,
      });
      // Declared as the member the Slack account is connected to.
      expect(WorkspaceActionAuthorization.authorize).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: MEMBER_ID,
          projectId: PROJECT_ID,
          action: "declare an incident",
        }),
      );
    });

    test.each([
      ["  INCIDENT   Checkout   is down  ", "Checkout is down"],
      ["Incident: Checkout is down", "Checkout is down"],
      ["create incident Checkout is down", "Checkout is down"],
      ["incident API p99 &gt; 2s &amp; rising", "API p99 > 2s & rising"],
      ["incident", ""],
    ])(
      "/oneuptime %j: the form, its title %j",
      async (text: string, title: string) => {
        await post(text);

        const calls: Array<SlackCall> = await slackCallsAfter(1);
        const view: JSONObject = calls[0]!.data["view"] as JSONObject;

        expect(urlsOf(calls)).toEqual(["https://slack.com/api/views.open"]);
        expect(
          (inputOf(view, "incidentTitle")?.["element"] as JSONObject)[
            "initial_value"
          ],
        ).toBe(title);
      },
    );

    test("/oneuptime maintenance Database upgrade: the New Scheduled Maintenance form with the title filled in", async () => {
      const answer: RouteAnswer = await post("maintenance Database upgrade");

      expect(answer.status).toBe(200);
      expect(answer.body).toBeNull();

      const calls: Array<SlackCall> = await slackCallsAfter(1);
      const view: JSONObject = calls[0]!.data["view"] as JSONObject;

      expect(urlsOf(calls)).toEqual(["https://slack.com/api/views.open"]);
      expect(view["callback_id"]).toBe("SubmitNewScheduledMaintenance");
      expect(view["title"]).toEqual({
        type: "plain_text",
        text: "New Scheduled Event",
      });
      expect(
        (inputOf(view, "scheduledMaintenanceTitle")?.["element"] as JSONObject)[
          "initial_value"
        ],
      ).toBe("Database upgrade");
    });

    test("from an account nobody connected: one answer, at the command's response_url, with a Connect button - and to run /oneuptime incident again", async () => {
      linkedUser = null;

      const answer: RouteAnswer = await post("incident Checkout is down");

      expect(answer.status).toBe(200);
      expect(answer.body).toBeNull();

      const calls: Array<SlackCall> = await slackCallsAfter(1);

      // No form: the person is asked to connect, where they ran it.
      expect(urlsOf(calls)).toEqual([RESPONSE_URL]);
      expect(calls[0]!.data["response_type"]).toBe("ephemeral");
      expect(sectionText(calls[0]!.data["blocks"])).toBe(
        "🔗 ​*Connect your Slack account to declare an incident.*​ It takes one click. Then run ​*/oneuptime incident*​ again.\n",
      );

      const connectUrl: globalThis.URL = new globalThis.URL(
        connectUrlOf(calls[0]!.data["blocks"]) || "",
      );
      expect(`${connectUrl.origin}${connectUrl.pathname}`).toBe(
        `${DASHBOARD_URL}/${PROJECT_ID.toString()}/user-settings/slack-integration`,
      );
      const token: string | null = connectUrl.searchParams.get("connect");
      expect(token).toMatch(CONNECT_REQUEST_TOKEN_PATTERN);

      // Kept for this Slack account: run the command again, as typed.
      const request: WorkspaceConnectRequestRecord | null =
        await WorkspaceConnectRequest.peek(token);
      expect(request).toMatchObject({
        workspaceUserId: SLACK_USER_ID,
        purpose: "declare an incident",
        again: {
          kind: WorkspaceConnectRequestAgainKind.Command,
          label: "/oneuptime incident",
        },
        slack: {
          teamId: SLACK_TEAM_ID,
          channelId: CHANNEL_ID,
          responseUrl: RESPONSE_URL,
        },
      });
      expect(request!.pendingAction).toBeUndefined();
    });

    test("from somebody who may not declare an incident: told so where they ran it, and no form", async () => {
      mayDeclare = false;

      await post("incident Checkout is down");

      const calls: Array<SlackCall> = await slackCallsAfter(1);

      expect(urlsOf(calls)).toEqual([RESPONSE_URL]);
      expect(sectionText(calls[0]!.data["blocks"])).toBe(
        "You do not have permission to declare an incident.\n",
      );
    });

    test("from somebody no longer a member of the project: told so, with no Connect button", async () => {
      isMember = false;

      await post("maintenance Database upgrade");

      const calls: Array<SlackCall> = await slackCallsAfter(1);

      expect(urlsOf(calls)).toEqual([RESPONSE_URL]);
      expect(sectionText(calls[0]!.data["blocks"])).toBe(
        "Your OneUptime account is not a member of this project. Ask a project admin to invite you, then try again.\n",
      );
      expect(connectUrlOf(calls[0]!.data["blocks"])).toBeNull();
    });

    test("from a Slack workspace connected to no project: said so at once, and nothing else", async () => {
      workspaceConnected = false;

      const answer: RouteAnswer = await post("incident Checkout is down");

      expect(answer.status).toBe(200);
      expect(answer.body).toEqual({
        response_type: "ephemeral",
        text: "This Slack workspace is not connected to a OneUptime project yet. A project admin can connect it in OneUptime under Project Settings → Workspace → Slack.",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "This Slack workspace is not connected to a OneUptime project yet. A project admin can connect it in OneUptime under Project Settings → Workspace → Slack.\n",
            },
          },
        ],
      });
      await slackCallsAfter(1, 30);
      expect(slackCalls).toEqual([]);
    });
  });

  describe("oncall: who is on call right now", () => {
    test("/oneuptime oncall: an empty 200, then each schedule's on-call person at the command's response_url, read as the member", async () => {
      const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
      schedule.id = SCHEDULE_ID;
      schedule.name = "Primary";
      const simon: User = new User();
      simon.id = SIMON_ID;
      simon.name = new Name("Simon Lee");
      schedule.currentUserOnRoster = simon;
      schedule.rosterHandoffAt = HANDOFF;
      schedules = [schedule];

      const answer: RouteAnswer = await post("oncall");

      expect(answer.status).toBe(200);
      expect(answer.body).toBeNull();

      const calls: Array<SlackCall> = await slackCallsAfter(1);

      expect(urlsOf(calls)).toEqual([RESPONSE_URL]);
      expect(calls[0]!.data["response_type"]).toBe("ephemeral");
      expect(calls[0]!.data["text"]).toBe("On call now: Simon Lee (Primary)");
      expect(sectionText(calls[0]!.data["blocks"])).toBe(
        WorkspaceMessageTime.toSlack(
          [
            "👥 ​*On call now*​",
            "",
            `•   <${DASHBOARD_URL}/${PROJECT_ID.toString()}/on-call-duty/schedules/${SCHEDULE_ID.toString()}|Primary>: \u200b*Simon Lee*\u200b until {{DATE(2026-10-17T09:00:00Z, SHORT)}} at {{TIME(2026-10-17T09:00:00Z)}}.`,
            "",
            `<${DASHBOARD_URL}/${PROJECT_ID.toString()}/on-call-duty/schedules|Open the on-call schedules in OneUptime>`,
            "",
          ].join("\n"),
        ),
      );
      expect(OnCallDutyPolicyScheduleService.findBy).toHaveBeenCalledWith(
        expect.objectContaining({ props: PROPS }),
      );
    });

    test.each(["OnCall", "on-call", "on call", "oncall?"])(
      "/oneuptime %j is oncall too",
      async (text: string) => {
        await post(text);

        const calls: Array<SlackCall> = await slackCallsAfter(1);

        expect(urlsOf(calls)).toEqual([RESPONSE_URL]);
        expect(calls[0]!.data["text"]).toBe("No on-call schedules yet");
        expect(assistantQuestions).toEqual([]);
      },
    );

    test("from an account nobody connected: asked to connect, and to run /oneuptime oncall again", async () => {
      linkedUser = null;

      await post("oncall");

      const calls: Array<SlackCall> = await slackCallsAfter(1);

      expect(urlsOf(calls)).toEqual([RESPONSE_URL]);
      expect(calls[0]!.data["text"]).toBe(
        "Connect your Slack account to see who is on call",
      );
      expect(sectionText(calls[0]!.data["blocks"])).toContain(
        "Then run ​*/oneuptime oncall*​ again.",
      );
      expect(OnCallDutyPolicyScheduleService.findBy).not.toHaveBeenCalled();
    });

    test("the schedules cannot be read just now: one answer that says so where the command was run, and the failure logged", async () => {
      const loggedErrors: Array<string> = [];
      jest.spyOn(logger, "error").mockImplementation((line: unknown) => {
        loggedErrors.push(String(line));
      });
      jest
        .spyOn(OnCallDutyPolicyScheduleService, "findBy")
        .mockRejectedValue(new Error("connection reset"));

      await post("oncall");

      const calls: Array<SlackCall> = await slackCallsAfter(1);

      expect(urlsOf(calls)).toEqual([RESPONSE_URL]);
      expect(calls[0]!.data["response_type"]).toBe("ephemeral");
      expect(calls[0]!.data["text"]).toBe(
        "OneUptime couldn't read who is on call just now. Please try again in a minute.",
      );
      expect(sectionText(calls[0]!.data["blocks"])).toBe(
        "OneUptime couldn't read who is on call just now. Please try again in a minute.\n",
      );
      expect(loggedErrors).toEqual([
        "Could not read who is on call for a Slack command.",
        "Error: connection reset",
      ]);
    });

    test("/oneuptime oncall for the database team? - with more after it - is a question for AI", async () => {
      await post("oncall for the database team?");
      await slackCallsAfter(1);

      expect(assistantQuestions).toEqual(["oncall for the database team?"]);
      expect(OnCallDutyPolicyScheduleService.findBy).not.toHaveBeenCalled();
    });
  });

  describe("ask, or any other text: a question for OneUptime AI, as before", () => {
    test("/oneuptime ask which monitors are down?: acknowledged at once, then answered in the channel - the question without 'ask'", async () => {
      const answer: RouteAnswer = await post("ask which monitors are down?");

      expect(answer.status).toBe(200);
      expect(answer.body).toEqual({
        response_type: "ephemeral",
        text: "On it… :hourglass_flowing_sand:",
      });

      const calls: Array<SlackCall> = await slackCallsAfter(1);

      expect(urlsOf(calls)).toEqual([RESPONSE_URL]);
      expect(calls[0]!.data).toEqual({
        response_type: "in_channel",
        text: "Two monitors are down: ​*API*​ and ​*Checkout*​.\n",
      });
      expect(assistantQuestions).toEqual(["which monitors are down?"]);
    });

    test.each([
      ["which monitors are down?", "which monitors are down?"],
      [
        "  why did checkout latency spike?  ",
        "why did checkout latency spike?",
      ],
      ["incidents today?", "incidents today?"],
      ["help me find slow queries", "help me find slow queries"],
      ["is API &lt; 99% up?", "is API < 99% up?"],
    ])("/oneuptime %j asks AI %j", async (text: string, question: string) => {
      await post(text);
      await slackCallsAfter(1);

      expect(assistantQuestions).toEqual([question]);
    });

    test("with AI turned off: said so, and where the commands that need no AI are", async () => {
      aiEnabled = false;

      await post("which monitors are down?");

      const calls: Array<SlackCall> = await slackCallsAfter(1);

      expect(urlsOf(calls)).toEqual([RESPONSE_URL]);
      expect(calls[0]!.data).toEqual({
        response_type: "ephemeral",
        text: "AI features are disabled for this project. Enable them in Project Settings → AI → AI Features. Run `/oneuptime help` to see the other commands.\n",
      });
      expect(assistantQuestions).toEqual([]);
    });

    test("from an account nobody connected: asked to connect, and to ask again", async () => {
      linkedUser = null;

      await post("which monitors are down?");

      const calls: Array<SlackCall> = await slackCallsAfter(1);

      expect(urlsOf(calls)).toEqual([RESPONSE_URL]);
      expect(sectionText(calls[0]!.data["blocks"])).toBe(
        "🔗 ​*Connect your Slack account to ask OneUptime AI.*​ It takes one click. Then ask your question again.\n",
      );
      expect(assistantQuestions).toEqual([]);
    });

    test("from a Slack workspace connected to no project: said so", async () => {
      workspaceConnected = false;

      await post("which monitors are down?");

      const calls: Array<SlackCall> = await slackCallsAfter(1);

      expect(calls[0]!.data).toEqual({
        response_type: "ephemeral",
        text: "This Slack workspace is not connected to a OneUptime project yet. A project admin can connect it in OneUptime under Project Settings → Workspace → Slack.",
      });
    });
  });

  describe("the old commands, from an app created from an older manifest", () => {
    function postLegacy(command: string, text: string): Promise<RouteAnswer> {
      return postForm({
        port: app.port,
        path: "/api/slack/interactive",
        fields: slashCommand(text, command),
      });
    }

    test("/incident Checkout is down: still the New Incident form, with the title filled in", async () => {
      const answer: RouteAnswer = await postLegacy(
        "/incident",
        "Checkout is down",
      );

      expect(answer.status).toBe(200);

      const calls: Array<SlackCall> = await slackCallsAfter(1);
      const view: JSONObject = calls[0]!.data["view"] as JSONObject;

      expect(urlsOf(calls)).toEqual(["https://slack.com/api/views.open"]);
      expect(view["callback_id"]).toBe("SubmitNewIncident");
      expect(
        (inputOf(view, "incidentTitle")?.["element"] as JSONObject)[
          "initial_value"
        ],
      ).toBe("Checkout is down");
    });

    test("/incident help: everything after the old command is still the title", async () => {
      await postLegacy("/incident", "help");

      const calls: Array<SlackCall> = await slackCallsAfter(1);
      const view: JSONObject = calls[0]!.data["view"] as JSONObject;

      expect(
        (inputOf(view, "incidentTitle")?.["element"] as JSONObject)[
          "initial_value"
        ],
      ).toBe("help");
    });

    test("/maintenance Database upgrade: still the New Scheduled Maintenance form", async () => {
      await postLegacy("/maintenance", "Database upgrade");

      const calls: Array<SlackCall> = await slackCallsAfter(1);
      const view: JSONObject = calls[0]!.data["view"] as JSONObject;

      expect(view["callback_id"]).toBe("SubmitNewScheduledMaintenance");
      expect(
        (inputOf(view, "scheduledMaintenanceTitle")?.["element"] as JSONObject)[
          "initial_value"
        ],
      ).toBe("Database upgrade");
    });

    test("/incident from an account nobody connected: asked to run /incident again - the command that app has", async () => {
      linkedUser = null;

      await postLegacy("/incident", "Checkout is down");

      const calls: Array<SlackCall> = await slackCallsAfter(1);

      expect(urlsOf(calls)).toEqual([RESPONSE_URL]);
      expect(sectionText(calls[0]!.data["blocks"])).toBe(
        "🔗 ​*Connect your Slack account to declare an incident.*​ It takes one click. Then run ​*/incident*​ again.\n",
      );

      const token: string | null = new globalThis.URL(
        connectUrlOf(calls[0]!.data["blocks"]) || "",
      ).searchParams.get("connect");
      const request: WorkspaceConnectRequestRecord | null =
        await WorkspaceConnectRequest.peek(token);

      expect(request?.again).toEqual({
        kind: WorkspaceConnectRequestAgainKind.Command,
        label: "/incident",
      });
    });

    test("/oneuptime incident posted to /api/slack/interactive opens the form there too", async () => {
      await postLegacy("/oneuptime", "incident Checkout is down");

      const calls: Array<SlackCall> = await slackCallsAfter(1);

      expect(urlsOf(calls)).toEqual(["https://slack.com/api/views.open"]);
    });
  });
});
