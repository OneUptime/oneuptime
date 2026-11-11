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
import cookieParser from "cookie-parser";
import express from "express";
import API from "../../../Utils/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { ConnectRequestOutcome } from "../../../Types/Workspace/ConnectCallback";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import { DashboardClientUrl } from "../../../Server/EnvironmentConfig";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../Server/Services/IncidentService";
import MonitorService from "../../../Server/Services/MonitorService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import ProjectService from "../../../Server/Services/ProjectService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import logger from "../../../Server/Utils/Logger";
import ProductBrandingText from "../../../Server/Utils/ProductBrandingText";
import SlackOrganization from "../../../Server/Utils/Workspace/Slack/SlackOrganization";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceConnectCompletion from "../../../Server/Utils/Workspace/WorkspaceConnectCompletion";
import WorkspaceConnectRequest, {
  WorkspaceConnectRequestAgainKind,
  WorkspaceConnectRequestRecord,
} from "../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import WorkspaceOAuthState from "../../../Server/Utils/Workspace/WorkspaceOAuthState";
import {
  makeUnsignedJwt,
  ProbeResponse,
  TEST_PERMISSIONS_HEADER,
  TEST_USER_HEADER,
} from "./WorkspaceOAuthTestHelpers";
import {
  Browser,
  EAST,
  FakeSlack,
  finishConnection,
  InMemorySlackConnections,
  LAB,
  ORG_ID,
  ORG_NAME,
  ORG_TOKEN,
  SlackCall,
  startConnection,
  WEST,
} from "./SlackOrganizationTestHelpers";

/*
 * "BACK TO SLACK" FOR A CHANNEL ONEUPTIME DOES NOT KNOW, IN A SLACK
 * ENTERPRISE ORGANIZATION (#6772).
 *
 * Somebody of Acme West who has not connected their Slack account presses
 * Acknowledge in a channel of Acme East. Slack's press of OneUptime's
 * installation for the whole organization names no workspace for the
 * channel - `team` is null, and user.team_id is Acme West - and no rule of
 * the project created or looked the channel up, so OneUptime does not know
 * its workspace. The press is answered at once, with a Connect button, and
 * kept with the person's own workspace. Once they have connected, the
 * settings page's "Back to Slack" opens Slack's app_redirect link to the
 * channel: OneUptime asks Slack which workspace the channel is in, once,
 * with the organization's token (conversations.info) - while the browser
 * comes back from signing in, never while the press waits for its answer -
 * and takes only a workspace OneUptime is added to.
 *
 * These drive the real routes over HTTP: the press, the sign-in its Connect
 * button starts, and the sign-in's callback, through the real authorization,
 * connect request and SlackOrganization. Slack is stood in for by FakeSlack,
 * answering conversations.info as its Web API documents
 * (https://docs.slack.dev/reference/methods/conversations.info). No real
 * Enterprise organization was at hand: what Slack's app_redirect does with
 * the link is not checked here.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    SlackAppClientId: "1234567890.0987654321",
    SlackAppClientSecret: "slack-client-secret",
  };
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

jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: (...args: Array<unknown>) => {
        return (
          jest.requireActual("./WorkspaceOAuthTestHelpers") as {
            fakeGetUserMiddleware: (...args: Array<unknown>) => void;
          }
        ).fakeGetUserMiddleware(...args);
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
const SIGN_IN_START: string = "/api/slack/sign-in-url";
const COOKIE_NAME: string = WorkspaceOAuthState.BROWSER_BINDING_COOKIE_NAME;

// Connected to the whole organization: Acme East and Acme West.
const EVERYWHERE: ObjectID = new ObjectID(
  "e6772000-0000-4000-8000-000000000001",
);
// Connected to Acme East alone.
const EAST_OPS: ObjectID = new ObjectID("e6772000-0000-4000-8000-000000000002");
const EAST_TOKEN: string = "xoxb-acme-east";

// Somebody of Acme West, not connected yet, and the OneUptime member they are.
const NOBODY: string = "W0NOBODY";
const NOBODY_MEMBER: ObjectID = new ObjectID(
  "e6772000-0000-4000-8000-0000000000a1",
);

// A channel of Acme East no rule of the project created or looked up.
const CHANNEL_ID: string = "C0EASTCHECKOUT";
const MESSAGE_TS: string = "1762900000.000100";
const INCIDENT_ID: string = "e6772000-0000-4000-8000-0000000000c1";
const PRESS_RESPONSE_URL: string =
  "https://hooks.slack.com/actions/T0EAST/1762900000/pressBackToSlack";

interface RunningSlackApp {
  port: number;
  close: () => Promise<void>;
}

/*
 * The SlackAPI router on an app that reads requests as the server does:
 * presses as forms, events as JSON, and the sign-in's binding cookie.
 */
async function startSlackApp(): Promise<RunningSlackApp> {
  const SlackAPI: { new (): { getRouter: () => express.Router } } = (
    (await import("../../../Server/API/SlackAPI")) as unknown as {
      default: { new (): { getRouter: () => express.Router } };
    }
  ).default;

  const app: express.Express = express();
  app.use(cookieParser());
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

// Posts a press as Slack does: a form with the payload as JSON.
function postPress(
  port: number,
  payload: JSONObject,
): Promise<{ status: number; elapsedMs: number }> {
  const body: string = new globalThis.URLSearchParams({
    payload: JSON.stringify(payload),
  }).toString();
  const startedAt: number = Date.now();

  return new Promise<{ status: number; elapsedMs: number }>(
    (
      resolve: (answer: { status: number; elapsedMs: number }) => void,
      reject: (error: Error) => void,
    ) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: port,
          path: "/api/slack/interactive",
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "content-length": Buffer.byteLength(body),
          },
        },
        (response: http.IncomingMessage) => {
          response.resume();
          response.on("end", () => {
            resolve({
              status: response.statusCode || 0,
              elapsedMs: Date.now() - startedAt,
            });
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

/*
 * Acknowledge on an incident's message in CHANNEL_ID, pressed by NOBODY.
 * For the organization's installation Slack names no team and the person's
 * own workspace (user.team_id); for a workspace's installation, the
 * workspace.
 */
function acknowledgePress(data: {
  isEnterpriseInstall: boolean;
  personWorkspaceId: string;
}): JSONObject {
  return {
    type: "block_actions",
    user: {
      id: NOBODY,
      username: "nobody",
      name: "nobody",
      team_id: data.personWorkspaceId,
    },
    api_app_id: "A0ONEUPTIME",
    token: "verification-token",
    team: data.isEnterpriseInstall ? null : { id: EAST.id, domain: "acme" },
    enterprise: { id: ORG_ID, name: ORG_NAME },
    is_enterprise_install: data.isEnterpriseInstall,
    container: {
      type: "message",
      message_ts: MESSAGE_TS,
      channel_id: CHANNEL_ID,
      is_ephemeral: false,
    },
    channel: { id: CHANNEL_ID, name: "checkout" },
    message: {
      type: "message",
      ts: MESSAGE_TS,
      text: "Incident #42: Checkout is down",
    },
    response_url: PRESS_RESPONSE_URL,
    trigger_id: "1762900000.press-trigger",
    actions: [
      {
        action_id: "AcknowledgeIncident",
        value: INCIDENT_ID,
        type: "button",
      },
    ],
  };
}

// A channel of one workspace, as conversations.info documents it.
function channelInfoOf(teamId: string): JSONObject {
  return {
    ok: true,
    channel: {
      id: CHANNEL_ID,
      name: "checkout",
      is_channel: true,
      is_private: false,
      is_shared: false,
      is_org_shared: false,
      is_ext_shared: false,
      context_team_id: teamId,
      shared_team_ids: [teamId],
      pending_shared: [],
      pending_connected_team_ids: [],
    },
  };
}

describe("Back to Slack for a channel OneUptime does not know, in a Slack Enterprise organization", () => {
  let app: RunningSlackApp;
  let connections: InMemorySlackConnections;
  let slack: FakeSlack;
  let errorLines: Array<string>;

  beforeAll(async () => {
    app = await startSlackApp();
  }, 600000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    (
      jest.requireMock("../../../Server/Infrastructure/GlobalCache") as {
        default: { store: Map<string, unknown> };
      }
    ).default.store.clear();

    connections = new InMemorySlackConnections();
    connections.install();

    slack = new FakeSlack();
    slack.install();

    errorLines = [];

    // Nobody connected a Slack account yet; connecting one is recorded.
    jest
      .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
      .mockResolvedValue(null);
    jest.spyOn(WorkspaceUserAuthTokenService, "findBy").mockResolvedValue([]);
    jest
      .spyOn(WorkspaceUserAuthTokenService, "refreshAuthToken")
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(WorkspaceActionAuthorization, "isProjectMember")
      .mockResolvedValue(true);
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockImplementation(
        async (data: {
          userId: ObjectID;
          projectId: ObjectID;
        }): Promise<DatabaseCommonInteractionProps> => {
          return { userId: data.userId, tenantId: data.projectId };
        },
      );

    // No record owns the channel, and no project has posted in it.
    for (const service of [
      IncidentService,
      AlertService,
      IncidentEpisodeService,
      AlertEpisodeService,
      ScheduledMaintenanceService,
      MonitorService,
      OnCallDutyPolicyService,
    ] as unknown as Array<{
      findBy: () => Promise<unknown>;
      findOneBy: () => Promise<unknown>;
    }>) {
      jest.spyOn(service, "findBy").mockResolvedValue([] as never);
      jest.spyOn(service, "findOneBy").mockResolvedValue(null as never);
    }
    jest
      .spyOn(WorkspaceNotificationLogService, "findOneBy")
      .mockResolvedValue(null);

    jest
      .spyOn(ProjectService, "findOneById")
      .mockImplementation((async (options: { id: ObjectID }) => {
        const project: Project = new Project();
        project.id = options.id;
        project.name = "Acme Everywhere";
        return project;
      }) as never);
    jest.spyOn(ProjectService, "findBy").mockResolvedValue([] as never);
    // With billing on, as CI runs Common, the sign-in reads the plan.
    jest
      .spyOn(ProjectService, "getCurrentPlan")
      .mockResolvedValue({ plan: null, isSubscriptionUnpaid: false } as never);
    jest.spyOn(UserService, "findOneById").mockResolvedValue({
      isMasterAdmin: false,
    } as never);

    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString(DASHBOARD_URL));
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("OneUptime");

    // Acknowledged once they are connected: what that does has its own tests.
    jest.spyOn(WorkspaceConnectCompletion, "complete").mockResolvedValue({
      outcome: ConnectRequestOutcome.Done,
      answer: {
        markdown:
          "✅ **Your Slack account is connected to OneUptime.** You acknowledged **Incident #42**.",
        text: "Your Slack account is connected to OneUptime. You acknowledged Incident #42.",
      },
    });

    // The app's Home, drawn again once they are connected, is not looked at here.
    const SlackAPI: { refreshHomeAfterConnect: () => void } = (
      (await import("../../../Server/API/SlackAPI")) as unknown as {
        default: { refreshHomeAfterConnect: () => void };
      }
    ).default;
    jest.spyOn(SlackAPI, "refreshHomeAfterConnect").mockImplementation(() => {
      return undefined;
    });

    for (const level of ["debug", "info", "warn", "trace"] as const) {
      jest.spyOn(logger, level).mockImplementation((() => {
        return undefined;
      }) as never);
    }
    jest.spyOn(logger, "error").mockImplementation(((line: unknown) => {
      errorLines.push(String(line));
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The project of the whole organization, added to Acme East and Acme West.
  function connectEverywhere(more?: JSONObject): void {
    connections.add({
      projectId: EVERYWHERE,
      workspaceProjectId: ORG_ID,
      authToken: ORG_TOKEN,
      miscData: {
        teamId: ORG_ID,
        teamName: ORG_NAME,
        botUserId: "W0ONEUPTIMEBOT",
        enterpriseId: ORG_ID,
        enterpriseName: ORG_NAME,
        isEnterpriseInstall: true,
        workspaces: [EAST, WEST],
        workspacesReadAt: new Date().toISOString(),
        defaultWorkspaceId: EAST.id,
        ...(more || {}),
      },
    });
  }

  function connectEastOps(): void {
    connections.add({
      projectId: EAST_OPS,
      workspaceProjectId: EAST.id,
      authToken: EAST_TOKEN,
      miscData: {
        teamId: EAST.id,
        teamName: EAST.name,
        botUserId: "U0EASTBOT",
        enterpriseId: ORG_ID,
        enterpriseName: ORG_NAME,
      },
    });
  }

  async function until(condition: () => boolean, what: string): Promise<void> {
    for (let attempt: number = 0; attempt < 500; attempt++) {
      if (condition()) {
        return;
      }

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 10);
      });
    }

    throw new Error(
      `Waited in vain for ${what}. Slack was asked: ${JSON.stringify(
        slack.calls.map((call: SlackCall): string => {
          return call.method;
        }),
      )}; errors: ${JSON.stringify(errorLines)}`,
    );
  }

  // What Slack was asked of the channel's workspace.
  function channelLookups(): Array<SlackCall> {
    return slack.callsOf("conversations.info");
  }

  /*
   * Presses Acknowledge and reads the Connect button it is answered with:
   * the token of the press kept behind it.
   */
  async function pressAndReadConnectToken(press: JSONObject): Promise<{
    token: string;
    pressAnswer: { status: number; elapsedMs: number };
  }> {
    const pressAnswer: { status: number; elapsedMs: number } = await postPress(
      app.port,
      press,
    );

    await until((): boolean => {
      return slack.callsOf(PRESS_RESPONSE_URL).length === 1;
    }, "the Connect prompt");

    const blocks: Array<JSONObject> = slack.callsOf(PRESS_RESPONSE_URL)[0]!
      .data["blocks"] as Array<JSONObject>;
    const button: JSONObject = (
      blocks.find((block: JSONObject): boolean => {
        return block["type"] === "actions";
      })!["elements"] as Array<JSONObject>
    )[0]!;

    return {
      token: new globalThis.URL(button["url"] as string).searchParams.get(
        "connect",
      )!,
      pressAnswer: pressAnswer,
    };
  }

  // Starts signing in from the Connect button, as the settings page does.
  function startSignIn(
    projectId: ObjectID,
    token: string,
  ): Promise<{ state: string; url: string; browser: Browser }> {
    return startConnection({
      port: app.port,
      path: `${SIGN_IN_START}?from=user-settings&connect=${encodeURIComponent(token)}`,
      headers: {
        [TEST_USER_HEADER]: NOBODY_MEMBER.toString(),
        tenantid: projectId.toString(),
        [TEST_PERMISSIONS_HEADER]: Permission.ProjectMember,
      },
      cookieName: COOKIE_NAME,
    });
  }

  /*
   * Where Slack sends the browser back once NOBODY signed in: Slack's ID
   * token names their own workspace and the organization.
   */
  function comeBack(
    projectId: ObjectID,
    started: { state: string; browser: Browser },
    teamId: string = WEST.id,
  ): Promise<ProbeResponse> {
    slack.answers.set("openid.connect.token", (): JSONObject => {
      return {
        ok: true,
        access_token: "xoxp-nobody",
        id_token: makeUnsignedJwt({
          iss: "https://slack.com",
          sub: NOBODY,
          "https://slack.com/user_id": NOBODY,
          "https://slack.com/team_id": teamId,
          "https://slack.com/enterprise_id": ORG_ID,
        }),
      };
    });

    return finishConnection({
      port: app.port,
      path: `/api/slack/auth/${projectId.toString()}/${NOBODY_MEMBER.toString()}/user`,
      query: { code: "slack-code", state: started.state },
      browser: started.browser,
    });
  }

  // The person's own Slack settings page, and what the sign-in tells it.
  function pageQuery(
    projectId: ObjectID,
    response: ProbeResponse,
  ): Record<string, string> {
    expect(response.status).toBe(302);

    const location: globalThis.URL = new globalThis.URL(response.location!);

    expect(`${location.origin}${location.pathname}`).toBe(
      `${DashboardClientUrl.toString()}/${projectId.toString()}/user-settings/slack-integration`,
    );

    return Object.fromEntries(location.searchParams.entries());
  }

  test("pressed by somebody of Acme West in a channel of Acme East: answered at once with no question to Slack; once connected, Back to Slack opens the channel in Acme East, which Slack names for it - asked once, with the organization's token", async () => {
    connectEverywhere();
    slack.answers.set("conversations.info", (): JSONObject => {
      return channelInfoOf(EAST.id);
    });

    const { token, pressAnswer } = await pressAndReadConnectToken(
      acknowledgePress({
        isEnterpriseInstall: true,
        personWorkspaceId: WEST.id,
      }),
    );

    // Slack had its 200, and the Connect prompt, without being asked of the channel.
    expect(pressAnswer.status).toBe(200);
    expect(channelLookups()).toEqual([]);

    // Kept with the person's own workspace: the press named no other.
    const kept: WorkspaceConnectRequestRecord | null =
      await WorkspaceConnectRequest.peek(token);
    expect(kept!.slack).toMatchObject({
      teamId: WEST.id,
      channelId: CHANNEL_ID,
      responseUrl: PRESS_RESPONSE_URL,
    });

    const response: ProbeResponse = await comeBack(
      EVERYWHERE,
      await startSignIn(EVERYWHERE, token),
    );

    expect(pageQuery(EVERYWHERE, response)).toEqual({
      pressed: "done",
      slackChannel: CHANNEL_ID,
      slackTeam: EAST.id,
    });

    // Asked once, of the channel, with the organization's token: no team_id.
    expect(channelLookups()).toEqual([
      {
        method: "conversations.info",
        data: { channel: CHANNEL_ID },
        token: ORG_TOKEN,
      },
    ]);

    // The account is connected, and the press answered where it was made.
    expect(
      WorkspaceUserAuthTokenService.refreshAuthToken,
    ).toHaveBeenCalledTimes(1);
    expect(slack.callsOf(PRESS_RESPONSE_URL)).toHaveLength(2);
    expect(slack.callsOf(PRESS_RESPONSE_URL)[1]!.data["text"]).toBe(
      "Your Slack account is connected to OneUptime. You acknowledged Incident #42.",
    );
  });

  test.each([
    [
      "refuses: a private channel OneUptime is not in",
      (): JSONObject => {
        return { ok: false, error: "channel_not_found" };
      },
    ],
    [
      "refuses: a workspace OneUptime is not added to",
      (): JSONObject => {
        return { ok: false, error: "team_access_not_granted" };
      },
    ],
    [
      "names no workspace for it",
      (): JSONObject => {
        return { ok: true, channel: { id: CHANNEL_ID, is_im: false } };
      },
    ],
    [
      "names only a workspace OneUptime is not added to",
      (): JSONObject => {
        return channelInfoOf(LAB.id);
      },
    ],
    [
      "names only the organization",
      (): JSONObject => {
        return {
          ok: true,
          channel: {
            id: CHANNEL_ID,
            context_team_id: ORG_ID,
            conversation_host_id: ORG_ID,
          },
        };
      },
    ],
  ])(
    "Slack %s: Back to Slack opens the person's own workspace, and the press is answered all the same",
    async (_label: string, answer: () => JSONObject) => {
      connectEverywhere();
      slack.answers.set("conversations.info", answer);

      const { token, pressAnswer } = await pressAndReadConnectToken(
        acknowledgePress({
          isEnterpriseInstall: true,
          personWorkspaceId: WEST.id,
        }),
      );

      expect(pressAnswer.status).toBe(200);

      const response: ProbeResponse = await comeBack(
        EVERYWHERE,
        await startSignIn(EVERYWHERE, token),
      );

      expect(pageQuery(EVERYWHERE, response)).toEqual({
        pressed: "done",
        slackChannel: CHANNEL_ID,
        slackTeam: WEST.id,
      });
      expect(channelLookups()).toHaveLength(1);
      expect(slack.callsOf(PRESS_RESPONSE_URL)).toHaveLength(2);
    },
  );

  test("Slack answering with an HTTP error: the person's own workspace", async () => {
    connectEverywhere();

    const fakeSlackPost: (options: { url: URL }) => Promise<unknown> = (
      API.post as unknown as {
        getMockImplementation: () => (options: {
          url: URL;
        }) => Promise<unknown>;
      }
    ).getMockImplementation();

    jest.spyOn(API, "post").mockImplementation((async (options: {
      url: URL;
      data?: JSONObject;
      headers?: Record<string, string>;
    }) => {
      if (options.url.toString().endsWith("/api/conversations.info")) {
        slack.calls.push({
          method: "conversations.info",
          data: { ...(options.data || {}) },
          token: String(options.headers?.["Authorization"] || "").replace(
            /^Bearer /,
            "",
          ),
        });
        return new HTTPErrorResponse(503, { ok: false }, {});
      }

      return await fakeSlackPost(options);
    }) as never);

    const { token } = await pressAndReadConnectToken(
      acknowledgePress({
        isEnterpriseInstall: true,
        personWorkspaceId: WEST.id,
      }),
    );

    const response: ProbeResponse = await comeBack(
      EVERYWHERE,
      await startSignIn(EVERYWHERE, token),
    );

    expect(pageQuery(EVERYWHERE, response)["slackTeam"]).toBe(WEST.id);
    expect(channelLookups()).toHaveLength(1);
  });

  test("Slack too slow to say: the person's own workspace, and the page waits no longer than CHANNEL_WORKSPACE_TIMEOUT_IN_MS for it", async () => {
    connectEverywhere();

    const fakeSlackPost: (options: { url: URL }) => Promise<unknown> = (
      API.post as unknown as {
        getMockImplementation: () => (options: {
          url: URL;
        }) => Promise<unknown>;
      }
    ).getMockImplementation();

    // Slack takes a minute to answer conversations.info.
    let lateAnswer: ReturnType<typeof setTimeout> | undefined = undefined;

    jest.spyOn(API, "post").mockImplementation((async (options: {
      url: URL;
      data?: JSONObject;
      headers?: Record<string, string>;
    }) => {
      if (options.url.toString().endsWith("/api/conversations.info")) {
        slack.calls.push({
          method: "conversations.info",
          data: { ...(options.data || {}) },
          token: String(options.headers?.["Authorization"] || "").replace(
            /^Bearer /,
            "",
          ),
        });

        return await new Promise<HTTPResponse<JSONObject>>(
          (resolve: (value: HTTPResponse<JSONObject>) => void) => {
            lateAnswer = setTimeout(() => {
              resolve(
                new HTTPResponse<JSONObject>(200, channelInfoOf(EAST.id), {}),
              );
            }, 60000);
          },
        );
      }

      return await fakeSlackPost(options);
    }) as never);

    try {
      const { token, pressAnswer } = await pressAndReadConnectToken(
        acknowledgePress({
          isEnterpriseInstall: true,
          personWorkspaceId: WEST.id,
        }),
      );

      expect(pressAnswer.status).toBe(200);

      const started: { state: string; browser: Browser } = await startSignIn(
        EVERYWHERE,
        token,
      );

      const startedAt: number = Date.now();
      const response: ProbeResponse = await comeBack(EVERYWHERE, started);
      const elapsedMs: number = Date.now() - startedAt;

      expect(pageQuery(EVERYWHERE, response)).toEqual({
        pressed: "done",
        slackChannel: CHANNEL_ID,
        slackTeam: WEST.id,
      });
      expect(channelLookups()).toHaveLength(1);
      // The wait, and no more than a test machine's own slowness on top of it.
      expect(elapsedMs).toBeGreaterThanOrEqual(
        SlackOrganization.CHANNEL_WORKSPACE_TIMEOUT_IN_MS - 50,
      );
      expect(elapsedMs).toBeLessThan(
        SlackOrganization.CHANNEL_WORKSPACE_TIMEOUT_IN_MS + 5000,
      );
    } finally {
      if (lateAnswer) {
        clearTimeout(lateAnswer);
      }
    }
  }, 30000);

  test("a channel OneUptime created in Acme East: the press kept Acme East already, and Back to Slack opens it there without asking Slack", async () => {
    connectEverywhere({
      channelCache: {
        checkout: {
          id: CHANNEL_ID,
          name: "checkout",
          lastUpdated: new Date().toISOString(),
          teamId: EAST.id,
        },
      },
    });

    const { token } = await pressAndReadConnectToken(
      acknowledgePress({
        isEnterpriseInstall: true,
        personWorkspaceId: WEST.id,
      }),
    );

    expect((await WorkspaceConnectRequest.peek(token))!.slack!.teamId).toBe(
      EAST.id,
    );

    const response: ProbeResponse = await comeBack(
      EVERYWHERE,
      await startSignIn(EVERYWHERE, token),
    );

    expect(pageQuery(EVERYWHERE, response)["slackTeam"]).toBe(EAST.id);
    expect(channelLookups()).toEqual([]);
  });

  test("a project connected to Acme East alone: Back to Slack opens Acme East, its own workspace - Slack is not asked of the channel", async () => {
    connectEastOps();
    slack.answers.set("conversations.info", (): JSONObject => {
      return channelInfoOf(WEST.id);
    });

    const { token } = await pressAndReadConnectToken(
      acknowledgePress({
        isEnterpriseInstall: false,
        personWorkspaceId: EAST.id,
      }),
    );

    const response: ProbeResponse = await comeBack(
      EAST_OPS,
      await startSignIn(EAST_OPS, token),
      EAST.id,
    );

    expect(pageQuery(EAST_OPS, response)).toEqual({
      pressed: "done",
      slackChannel: CHANNEL_ID,
      slackTeam: EAST.id,
    });
    expect(channelLookups()).toEqual([]);
  });

  test("a command run in a channel OneUptime does not know: Back to Slack opens the channel's workspace too", async () => {
    connectEverywhere();
    slack.answers.set("conversations.info", (): JSONObject => {
      return channelInfoOf(EAST.id);
    });

    // `/oneuptime incident` in the channel, kept as the Connect button keeps it.
    const { token } = await WorkspaceConnectRequest.create({
      workspaceType: WorkspaceType.Slack,
      projectId: EVERYWHERE,
      workspaceUserId: NOBODY,
      purpose: "declare an incident",
      again: {
        kind: WorkspaceConnectRequestAgainKind.Command,
        label: "/oneuptime incident",
      },
      slack: { teamId: WEST.id, channelId: CHANNEL_ID },
    });

    const response: ProbeResponse = await comeBack(
      EVERYWHERE,
      await startSignIn(EVERYWHERE, token),
    );

    expect(pageQuery(EVERYWHERE, response)).toMatchObject({
      slackChannel: CHANNEL_ID,
      slackTeam: EAST.id,
    });
    expect(channelLookups()).toHaveLength(1);
  });

  test("a question asked in the app's direct messages: Back to Slack opens them in the person's own workspace - Slack is not asked", async () => {
    connectEverywhere();
    slack.answers.set("conversations.info", (): JSONObject => {
      return channelInfoOf(EAST.id);
    });

    const { token } = await WorkspaceConnectRequest.create({
      workspaceType: WorkspaceType.Slack,
      projectId: EVERYWHERE,
      workspaceUserId: NOBODY,
      purpose: "ask OneUptime AI",
      again: { kind: WorkspaceConnectRequestAgainKind.Question },
      slack: { teamId: WEST.id, directMessageChannelId: "D0NOBODY" },
    });

    const response: ProbeResponse = await comeBack(
      EVERYWHERE,
      await startSignIn(EVERYWHERE, token),
    );

    expect(pageQuery(EVERYWHERE, response)).toMatchObject({
      slackChannel: "D0NOBODY",
      slackTeam: WEST.id,
    });
    expect(channelLookups()).toEqual([]);
  });

  test("two sign-ins started from one Connect button: the press is finished once, and Slack asked of its channel once", async () => {
    connectEverywhere();
    slack.answers.set("conversations.info", (): JSONObject => {
      return channelInfoOf(EAST.id);
    });

    const { token } = await pressAndReadConnectToken(
      acknowledgePress({
        isEnterpriseInstall: true,
        personWorkspaceId: WEST.id,
      }),
    );

    // Two tabs, both opened from the button before either came back.
    const first: { state: string; browser: Browser } = await startSignIn(
      EVERYWHERE,
      token,
    );
    const second: { state: string; browser: Browser } = await startSignIn(
      EVERYWHERE,
      token,
    );

    expect(pageQuery(EVERYWHERE, await comeBack(EVERYWHERE, first))).toEqual({
      pressed: "done",
      slackChannel: CHANNEL_ID,
      slackTeam: EAST.id,
    });
    expect(pageQuery(EVERYWHERE, await comeBack(EVERYWHERE, second))).toEqual({
      pressed: "expired",
    });

    expect(channelLookups()).toHaveLength(1);
    expect(WorkspaceConnectCompletion.complete).toHaveBeenCalledTimes(1);
  });
});
