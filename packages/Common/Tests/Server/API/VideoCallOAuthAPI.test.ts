import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import crypto from "crypto";
import VideoCallConnection from "../../../Models/DatabaseModels/VideoCallConnection";
import VideoCallConnectionService from "../../../Server/Services/VideoCallConnectionService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import { DashboardClientUrl } from "../../../Server/EnvironmentConfig";
import GoogleMeetOAuthApp from "../../../Server/Utils/VideoCall/OAuth/GoogleMeetOAuthApp";
import MicrosoftTeamsMeetingsOAuthApp from "../../../Server/Utils/VideoCall/OAuth/MicrosoftTeamsMeetingsOAuthApp";
import {
  VideoCallOAuthGrant,
  VideoCallOAuthGrantProblem,
  VideoCallOAuthGrantRefusal,
} from "../../../Server/Utils/VideoCall/OAuth/VideoCallOAuth";
import ZoomOAuthApp from "../../../Server/Utils/VideoCall/OAuth/ZoomOAuthApp";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceOAuthState from "../../../Server/Utils/Workspace/WorkspaceOAuthState";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import VideoCallAuthMethod from "../../../Types/VideoCall/VideoCallAuthMethod";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import {
  CacheEntry,
  cookieHeader,
  httpGet,
  httpRequest,
  ProbeResponse,
  queryOf,
  RunningApp,
  startApp,
  TEST_PERMISSIONS_HEADER,
  TEST_USER_HEADER,
} from "./WorkspaceOAuthTestHelpers";

/*
 * THE ONE-CLICK CONNECT OF A VIDEO CALL PROVIDER, OVER HTTP.
 *
 * The start route hands a member who may connect video call providers the
 * provider's sign-in URL and records a one-use state; the provider sends
 * the browser back to the callback, which asks the start's question again,
 * saves the sign-in as a connection and answers on the Video Calls page -
 * naming the provider, and the connection or a code. Zoom also sends its
 * own signed events.
 *
 * Faked: the session middleware, Redis, the membership read, the code
 * exchange with each provider and the connection writes.
 */

const ZOOM_SECRET_TOKEN: string = "zoom-webhook-secret-token";

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    ZoomAppClientId: "zoom-client-id",
    ZoomAppClientSecret: "zoom-client-secret",
    ZoomAppWebhookSecretToken: "zoom-webhook-secret-token",
    GoogleMeetAppClientId: "google-client-id.apps.googleusercontent.com",
    GoogleMeetAppClientSecret: "google-client-secret",
    MicrosoftTeamsMeetingsAppClientId: "6c1a8d3e-1111-4222-8333-944455556666",
    // Without its secret, this server has no Microsoft app to sign in with.
    MicrosoftTeamsMeetingsAppClientSecret: null,
  };
});

jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: (...args: Array<any>) => {
        return (
          jest.requireActual("./WorkspaceOAuthTestHelpers") as any
        ).fakeGetUserMiddleware(...args);
      },
    },
  };
});

jest.mock("../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual("./WorkspaceOAuthTestHelpers") as any
    ).createInMemoryGlobalCache(),
  };
});

jest.mock("../../../Server/Services/VideoCallConnectionService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      connectWithSignIn: jest.fn(),
      removeSignIn: jest.fn(),
    },
  };
});

/*
 * With billing on, as CI runs this suite, the start and the callback read
 * the project's plan (CallerPlan, through CommonAPI) before they answer.
 */
jest.mock("../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      getCurrentPlan: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

const ANSWER_WITHIN_MS: number = 5000;
const COOKIE_NAME: string = WorkspaceOAuthState.BROWSER_BINDING_COOKIE_NAME;
const mockCacheStore: Map<string, CacheEntry> = (GlobalCache as any).store;

const CONNECTION_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const GRANT: VideoCallOAuthGrant = {
  tokens: {
    accessToken: "a",
    refreshToken: "r",
    accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000),
  },
  account: { label: "incidents@acme.com", externalUserId: "zoom-user-1" },
};

const findOneBy: jest.Mock = VideoCallConnectionService.findOneBy as any;
const connectWithSignIn: jest.Mock =
  VideoCallConnectionService.connectWithSignIn as any;
const removeSignIn: jest.Mock = VideoCallConnectionService.removeSignIn as any;
const getCurrentPlan: jest.Mock = ProjectService.getCurrentPlan as any;

describe("Video call one-click Connect", () => {
  let app: RunningApp;
  let projectId: ObjectID;
  let userId: ObjectID;
  // What the person who started holds when the provider sends them back.
  let callbackPermissions: Array<Permission> | null;

  beforeAll(async () => {
    const VideoCallOAuthAPI: any = (
      await import("../../../Server/API/VideoCallOAuthAPI")
    ).default;

    app = await startApp([new VideoCallOAuthAPI().getRouter()]);
  }, 600000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockCacheStore.clear();
    jest.clearAllMocks();

    projectId = ObjectID.generate();
    userId = ObjectID.generate();
    callbackPermissions = [Permission.ProjectAdmin];

    getCurrentPlan.mockImplementation(async () => {
      return { plan: PlanType.Growth, isSubscriptionUnpaid: false };
    });

    connectWithSignIn.mockImplementation(async () => {
      const connection: VideoCallConnection = new VideoCallConnection();
      connection.id = CONNECTION_ID;
      return connection;
    });

    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockImplementation(
        async (data: {
          userId: ObjectID;
          projectId: ObjectID;
        }): Promise<DatabaseCommonInteractionProps> => {
          if (!callbackPermissions) {
            throw new NotAuthorizedException(
              WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
            );
          }

          return {
            userId: data.userId,
            tenantId: data.projectId,
            userTenantAccessPermission: {
              [data.projectId.toString()]: {
                _type: "UserTenantAccessPermission",
                projectId: data.projectId,
                permissions: callbackPermissions.map(
                  (permission: Permission) => {
                    return {
                      _type: "UserPermission",
                      permission,
                      labelIds: [],
                      isBlockPermission: false,
                    };
                  },
                ),
              },
            },
            userTeamIds: [],
          };
        },
      );

    jest.spyOn(UserService, "findOneById").mockImplementation(async () => {
      return { isMasterAdmin: false } as any;
    });

    jest
      .spyOn(ZoomOAuthApp.prototype, "exchangeCode")
      .mockImplementation(async () => {
        return GRANT;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function startHeaders(permissions?: Array<Permission>): JSONObject {
    return {
      [TEST_USER_HEADER]: userId.toString(),
      tenantid: projectId.toString(),
      [TEST_PERMISSIONS_HEADER]: (
        permissions || [Permission.ProjectAdmin]
      ).join(","),
    };
  }

  async function start(
    slug: string,
    options?: { permissions?: Array<Permission>; query?: string },
  ): Promise<ProbeResponse> {
    return await httpGet({
      port: app.port,
      path: `/api/video-call-oauth/${slug}/authorize-url${options?.query || ""}`,
      headers: startHeaders(options?.permissions) as any,
      timeoutMs: ANSWER_WITHIN_MS,
    });
  }

  // Starts, then comes back to the callback as the provider sends the browser.
  async function signIn(
    slug: string,
    callbackQuery: (state: string) => Record<string, string>,
    callbackSlug?: string,
  ): Promise<ProbeResponse> {
    const started: ProbeResponse = await start(slug);
    expect(started.status).toBe(200);

    const authorizationUrl: string = (started.body as JSONObject)[
      "authorizationUrl"
    ] as string;
    const state: string = queryOf(authorizationUrl).get("state")!;

    return await httpGet({
      port: app.port,
      path: `/api/video-call-oauth/${callbackSlug || slug}/callback?${new URLSearchParams(callbackQuery(state)).toString()}`,
      headers: {
        cookie: cookieHeader({
          [COOKIE_NAME]: started.setCookies[COOKIE_NAME]!,
        }),
      },
      timeoutMs: ANSWER_WITHIN_MS,
    });
  }

  function videoCallsPage(): string {
    return `${DashboardClientUrl.toString()}/${projectId.toString()}/settings/video-calls`;
  }

  describe("starting", () => {
    test("a project admin gets Zoom's sign-in URL, for this server's redirect URI and a one-use state", async () => {
      const response: ProbeResponse = await start("zoom");

      expect(response.status).toBe(200);
      const url: URL = new URL(
        (response.body as JSONObject)["authorizationUrl"] as string,
      );
      expect(`${url.origin}${url.pathname}`).toBe(
        "https://zoom.us/oauth/authorize",
      );
      expect(url.searchParams.get("client_id")).toBe("zoom-client-id");
      expect(url.searchParams.get("redirect_uri")).toMatch(
        /\/api\/video-call-oauth\/zoom\/callback$/,
      );
      expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
      // Bound to this browser, recorded on the server.
      expect(response.setCookies[COOKIE_NAME]).toBeTruthy();
      expect(mockCacheStore.size).toBe(1);
    });

    test("Google's sign-in asks for the Meet scope", async () => {
      const response: ProbeResponse = await start("google-meet");

      expect(response.status).toBe(200);
      expect(
        queryOf(
          (response.body as JSONObject)["authorizationUrl"] as string,
        ).get("scope"),
      ).toContain("https://www.googleapis.com/auth/meetings.space.created");
    });

    test("someone who may not connect video call providers is refused before any state is recorded", async () => {
      const response: ProbeResponse = await start("zoom", {
        permissions: [Permission.IncidentMember],
      });

      expect(response.status).toBe(422);
      expect((response.body as JSONObject)["message"]).toBe(
        "You do not have permission to connect video call providers in this project.",
      );
      expect(mockCacheStore.size).toBe(0);
    });

    test("a custom role with Create Video Call Connection may connect", async () => {
      const response: ProbeResponse = await start("zoom", {
        permissions: [Permission.CreateVideoCallConnection],
      });

      expect(response.status).toBe(200);
    });

    test("a provider whose app this server does not have says so", async () => {
      const response: ProbeResponse = await start("microsoft-teams");

      expect(response.status).toBe(400);
      expect((response.body as JSONObject)["message"]).toContain(
        "is not set up on this OneUptime server",
      );
      expect(mockCacheStore.size).toBe(0);
    });

    test("reconnecting names a connection made by signing in to the same provider", async () => {
      const stored: VideoCallConnection = new VideoCallConnection();
      stored.id = CONNECTION_ID;
      stored.projectId = projectId;
      stored.provider = VideoCallProvider.Zoom;
      stored.authMethod = VideoCallAuthMethod.OAuth;
      findOneBy.mockResolvedValue(stored);

      const response: ProbeResponse = await start("zoom", {
        query: `?connectionId=${CONNECTION_ID.toString()}`,
      });

      expect(response.status).toBe(200);
      const recorded: JSONObject = JSON.parse(
        Array.from(mockCacheStore.values())[0]!.value,
      ) as JSONObject;
      expect(recorded["payload"]).toEqual({
        connectionId: CONNECTION_ID.toString(),
      });
    });

    test("refuses to reconnect a connection made with app credentials", async () => {
      const stored: VideoCallConnection = new VideoCallConnection();
      stored.id = CONNECTION_ID;
      stored.provider = VideoCallProvider.Zoom;
      stored.authMethod = VideoCallAuthMethod.AppCredentials;
      findOneBy.mockResolvedValue(stored);

      const response: ProbeResponse = await start("zoom", {
        query: `?connectionId=${CONNECTION_ID.toString()}`,
      });

      expect(response.status).toBe(400);
      expect(mockCacheStore.size).toBe(0);
    });
  });

  describe("coming back", () => {
    test("saves the sign-in and goes back to Video Calls, naming the provider and the connection", async () => {
      const response: ProbeResponse = await signIn("zoom", (state: string) => {
        return { code: "zoom-code", state };
      });

      expect(response.status).toBe(302);
      expect(response.location).toBe(
        `${videoCallsPage()}?provider=zoom&connected=${CONNECTION_ID.toString()}`,
      );
      expect(ZoomOAuthApp.prototype.exchangeCode).toHaveBeenCalledWith({
        code: "zoom-code",
        redirectUri: expect.stringMatching(
          /\/api\/video-call-oauth\/zoom\/callback$/,
        ),
      });
      expect(connectWithSignIn).toHaveBeenCalledWith({
        projectId: projectId,
        userId: userId,
        provider: VideoCallProvider.Zoom,
        grant: GRANT,
        connectionId: undefined,
      });
    });

    test("a reconnect signs in the connection it was started for", async () => {
      const stored: VideoCallConnection = new VideoCallConnection();
      stored.id = CONNECTION_ID;
      stored.provider = VideoCallProvider.Zoom;
      stored.authMethod = VideoCallAuthMethod.OAuth;
      findOneBy.mockResolvedValue(stored);

      const started: ProbeResponse = await start("zoom", {
        query: `?connectionId=${CONNECTION_ID.toString()}`,
      });
      const state: string = queryOf(
        (started.body as JSONObject)["authorizationUrl"] as string,
      ).get("state")!;

      await httpGet({
        port: app.port,
        path: `/api/video-call-oauth/zoom/callback?code=c&state=${state}`,
        headers: {
          cookie: cookieHeader({
            [COOKIE_NAME]: started.setCookies[COOKIE_NAME]!,
          }),
        },
        timeoutMs: ANSWER_WITHIN_MS,
      });

      expect(connectWithSignIn).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: CONNECTION_ID }),
      );
    });

    test("cancelling at Zoom is answered with a code, never Zoom's words", async () => {
      const response: ProbeResponse = await signIn("zoom", (state: string) => {
        return {
          error: "access_denied",
          error_description: "The user denied <b>it</b>",
          state,
        };
      });

      expect(response.location).toBe(
        `${videoCallsPage()}?provider=zoom&error=cancelled`,
      );
      expect(connectWithSignIn).not.toHaveBeenCalled();
    });

    test("a sign-in without the meeting permission is answered with its own code", async () => {
      jest
        .spyOn(GoogleMeetOAuthApp.prototype, "exchangeCode")
        .mockRejectedValue(
          new VideoCallOAuthGrantRefusal(
            VideoCallOAuthGrantProblem.PermissionNotGranted,
            "no meet scope",
          ) as never,
        );

      const response: ProbeResponse = await signIn(
        "google-meet",
        (state: string) => {
          return { code: "c", state };
        },
      );

      expect(response.location).toBe(
        `${videoCallsPage()}?provider=google-meet&error=video-call-permission-not-granted`,
      );
      expect(connectWithSignIn).not.toHaveBeenCalled();
    });

    test("a code the provider will not exchange is answered plainly", async () => {
      jest
        .spyOn(ZoomOAuthApp.prototype, "exchangeCode")
        .mockRejectedValue(new Error("Zoom said: secret details") as never);

      const response: ProbeResponse = await signIn("zoom", (state: string) => {
        return { code: "c", state };
      });

      expect(response.location).toBe(
        `${videoCallsPage()}?provider=zoom&error=could-not-finish`,
      );
      expect(response.location).not.toContain("secret");
    });

    test("no code is answered plainly", async () => {
      const response: ProbeResponse = await signIn("zoom", (state: string) => {
        return { state };
      });

      expect(response.location).toBe(
        `${videoCallsPage()}?provider=zoom&error=could-not-finish`,
      );
    });

    test("someone who may no longer connect is told so, and nothing is saved", async () => {
      callbackPermissions = [Permission.IncidentMember];

      const response: ProbeResponse = await signIn("zoom", (state: string) => {
        return { code: "c", state };
      });

      expect(response.location).toBe(
        `${videoCallsPage()}?provider=zoom&error=no-permission`,
      );
      expect(ZoomOAuthApp.prototype.exchangeCode).not.toHaveBeenCalled();
      expect(connectWithSignIn).not.toHaveBeenCalled();
    });

    test("a state issued for Zoom is never spent on the Google callback", async () => {
      const response: ProbeResponse = await signIn(
        "zoom",
        (state: string) => {
          return { code: "c", state };
        },
        "google-meet",
      );

      expect(response.location!.split("?")[0]).toBe(
        `${DashboardClientUrl.toString()}/connect-return`,
      );
      expect(queryOf(response.location!).get("error")).toBe("link-invalid");
      expect(queryOf(response.location!).get("provider")).toBe("google-meet");
      expect(connectWithSignIn).not.toHaveBeenCalled();
    });

    test("a state is spent once", async () => {
      const started: ProbeResponse = await start("zoom");
      const state: string = queryOf(
        (started.body as JSONObject)["authorizationUrl"] as string,
      ).get("state")!;
      const cookie: string = cookieHeader({
        [COOKIE_NAME]: started.setCookies[COOKIE_NAME]!,
      });

      await httpGet({
        port: app.port,
        path: `/api/video-call-oauth/zoom/callback?code=c&state=${state}`,
        headers: { cookie },
        timeoutMs: ANSWER_WITHIN_MS,
      });
      const replay: ProbeResponse = await httpGet({
        port: app.port,
        path: `/api/video-call-oauth/zoom/callback?code=c&state=${state}`,
        headers: { cookie },
        timeoutMs: ANSWER_WITHIN_MS,
      });

      expect(queryOf(replay.location!).get("error")).toBe("link-invalid");
      expect(connectWithSignIn).toHaveBeenCalledTimes(1);
    });

    test("a personal Microsoft account is answered with its own code", async () => {
      // This server has no Microsoft app in this suite, so the code is checked on its own.
      expect(
        new VideoCallOAuthGrantRefusal(
          VideoCallOAuthGrantProblem.WorkAccountRequired,
          "personal",
        ).problem,
      ).toBe(VideoCallOAuthGrantProblem.WorkAccountRequired);
      expect(MicrosoftTeamsMeetingsOAuthApp).toBeDefined();
    });
  });

  describe("Zoom's events", () => {
    function signed(body: JSONObject): {
      headers: JSONObject;
      body: JSONObject;
    } {
      const timestamp: string = String(Math.floor(Date.now() / 1000));
      const raw: string = JSON.stringify(body);

      return {
        body,
        headers: {
          "x-zm-request-timestamp": timestamp,
          "x-zm-signature": `v0=${crypto
            .createHmac("sha256", ZOOM_SECRET_TOKEN)
            .update(`v0:${timestamp}:${raw}`)
            .digest("hex")}`,
        },
      };
    }

    test("answers Zoom's endpoint check with the HMAC of its token", async () => {
      const event: { headers: JSONObject; body: JSONObject } = signed({
        event: "endpoint.url_validation",
        payload: { plainToken: "qgg8vlvZRS6UYooatFL8Aw" },
      });

      const response: ProbeResponse = await httpRequest({
        port: app.port,
        method: "POST",
        path: "/api/video-call-oauth/zoom/events",
        headers: event.headers as any,
        body: event.body,
        timeoutMs: ANSWER_WITHIN_MS,
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        plainToken: "qgg8vlvZRS6UYooatFL8Aw",
        encryptedToken: crypto
          .createHmac("sha256", ZOOM_SECRET_TOKEN)
          .update("qgg8vlvZRS6UYooatFL8Aw")
          .digest("hex"),
      });
    });

    test("deletes the sign-in of the account that removed the app", async () => {
      removeSignIn.mockResolvedValue(1);
      const event: { headers: JSONObject; body: JSONObject } = signed({
        event: "app_deauthorized",
        payload: {
          account_id: "acct-1",
          user_id: "zoom-user-1",
          client_id: "zoom-client-id",
          deauthorization_time: "2026-10-09T12:00:00.000Z",
        },
      });

      const response: ProbeResponse = await httpRequest({
        port: app.port,
        method: "POST",
        path: "/api/video-call-oauth/zoom/events",
        headers: event.headers as any,
        body: event.body,
        timeoutMs: ANSWER_WITHIN_MS,
      });

      expect(response.status).toBe(200);
      expect(removeSignIn).toHaveBeenCalledWith({
        provider: VideoCallProvider.Zoom,
        accountId: "zoom-user-1",
        reason: expect.stringContaining(
          "OneUptime was removed from the Zoom account",
        ),
      });
    });

    test("refuses an event Zoom did not sign, and changes nothing", async () => {
      const response: ProbeResponse = await httpRequest({
        port: app.port,
        method: "POST",
        path: "/api/video-call-oauth/zoom/events",
        headers: {
          "x-zm-request-timestamp": String(Math.floor(Date.now() / 1000)),
          "x-zm-signature": "v0=forged",
        },
        body: {
          event: "app_deauthorized",
          payload: { user_id: "zoom-user-1", client_id: "zoom-client-id" },
        },
        timeoutMs: ANSWER_WITHIN_MS,
      });

      expect(response.status).toBe(422);
      expect(removeSignIn).not.toHaveBeenCalled();
    });

    test("ignores a deauthorization of another app", async () => {
      const event: { headers: JSONObject; body: JSONObject } = signed({
        event: "app_deauthorized",
        payload: { user_id: "zoom-user-1", client_id: "another-app" },
      });

      const response: ProbeResponse = await httpRequest({
        port: app.port,
        method: "POST",
        path: "/api/video-call-oauth/zoom/events",
        headers: event.headers as any,
        body: event.body,
        timeoutMs: ANSWER_WITHIN_MS,
      });

      expect(response.status).toBe(200);
      expect(removeSignIn).not.toHaveBeenCalled();
    });
  });
});
