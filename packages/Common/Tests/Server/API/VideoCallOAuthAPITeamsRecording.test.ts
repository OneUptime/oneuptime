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
import type { SpyInstance } from "jest-mock";
import VideoCallConnection from "../../../Models/DatabaseModels/VideoCallConnection";
import VideoCallConnectionService from "../../../Server/Services/VideoCallConnectionService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import MicrosoftTeamsMeetingsOAuthApp from "../../../Server/Utils/VideoCall/OAuth/MicrosoftTeamsMeetingsOAuthApp";
import { VideoCallOAuthGrant } from "../../../Server/Utils/VideoCall/OAuth/VideoCallOAuth";
import IncidentCallRecordingSetting from "../../../Server/Utils/VideoCall/Transcripts/IncidentCallRecordingSetting";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceOAuthState from "../../../Server/Utils/Workspace/WorkspaceOAuthState";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import VideoCallAuthMethod from "../../../Types/VideoCall/VideoCallAuthMethod";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import {
  CacheEntry,
  cookieHeader,
  httpGet,
  ProbeResponse,
  queryOf,
  RunningApp,
  startApp,
  TEST_PERMISSIONS_HEADER,
  TEST_USER_HEADER,
} from "./WorkspaceOAuthTestHelpers";

/*
 * CONNECTING MICROSOFT TEAMS FOR A PROJECT THAT RECORDS ITS CALLS, OVER HTTP.
 *
 * A project with Record and transcribe incident calls on asks Microsoft for
 * two more permissions when it connects Teams: putting meetings on the
 * account's calendar, and reading their transcripts. The start decides from
 * the project's switch, its one-use state carries the answer to the
 * callback, and the code is exchanged for what the start asked - whatever
 * the switch says by then. A project that does not record asks for nothing
 * more, and one whose switch cannot be read still connects.
 *
 * Faked: the session middleware, Redis, the membership read, the switch,
 * the code exchange and the connection writes.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsMeetingsAppClientId: "6c1a8d3e-1111-4222-8333-944455556666",
    MicrosoftTeamsMeetingsAppClientSecret: "microsoft-client-secret",
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
    scope:
      "OnlineMeetings.ReadWrite Calendars.ReadWrite OnlineMeetingTranscript.Read.All",
  },
  account: {
    label: "incidents@acme.com",
    externalUserId: "7b2e9f10-aaaa-4bbb-8ccc-dddddddddddd",
    externalAccountId: "0d3b1c0e-58f1-4bd1-8bb0-2b0f6f3f6c11",
  },
};

// The commercial cloud's Graph scopes, where no MICROSOFT_TEAMS_CLOUD is set.
const MICROSOFT_TEAMS_MEETINGS_SCOPE: string =
  "https://graph.microsoft.com/OnlineMeetings.ReadWrite";
const MICROSOFT_TEAMS_MEETINGS_RECORDING_SCOPES: Array<string> = [
  "https://graph.microsoft.com/Calendars.ReadWrite",
  "https://graph.microsoft.com/OnlineMeetingTranscript.Read.All",
];

const BASE_SCOPES: Array<string> = [
  "openid",
  "profile",
  "email",
  "offline_access",
  MICROSOFT_TEAMS_MEETINGS_SCOPE,
];

const findOneBy: jest.Mock = VideoCallConnectionService.findOneBy as any;
const connectWithSignIn: jest.Mock =
  VideoCallConnectionService.connectWithSignIn as any;
const getCurrentPlan: jest.Mock = ProjectService.getCurrentPlan as any;

describe("Connecting Microsoft Teams for a project that records its calls", () => {
  let app: RunningApp;
  let projectId: ObjectID;
  let userId: ObjectID;
  let isRecording: SpyInstance<typeof IncidentCallRecordingSetting.isOn>;
  let exchangeCode: SpyInstance<MicrosoftTeamsMeetingsOAuthApp["exchangeCode"]>;

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
          return {
            userId: data.userId,
            tenantId: data.projectId,
            userTenantAccessPermission: {
              [data.projectId.toString()]: {
                _type: "UserTenantAccessPermission",
                projectId: data.projectId,
                permissions: [
                  {
                    _type: "UserPermission",
                    permission: Permission.ProjectAdmin,
                    labelIds: [],
                    isBlockPermission: false,
                  },
                ],
              },
            },
            userTeamIds: [],
          } as unknown as DatabaseCommonInteractionProps;
        },
      );

    jest.spyOn(UserService, "findOneById").mockImplementation(async () => {
      return { isMasterAdmin: false } as any;
    });

    isRecording = jest
      .spyOn(IncidentCallRecordingSetting, "isOn")
      .mockResolvedValue(true);

    exchangeCode = jest
      .spyOn(MicrosoftTeamsMeetingsOAuthApp.prototype, "exchangeCode")
      .mockResolvedValue(GRANT);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function start(query?: string): Promise<ProbeResponse> {
    return await httpGet({
      port: app.port,
      path: `/api/video-call-oauth/microsoft-teams/authorize-url${query || ""}`,
      headers: {
        [TEST_USER_HEADER]: userId.toString(),
        tenantid: projectId.toString(),
        [TEST_PERMISSIONS_HEADER]: Permission.ProjectAdmin,
      } as any,
      timeoutMs: ANSWER_WITHIN_MS,
    });
  }

  function scopesOf(started: ProbeResponse): Array<string> {
    return queryOf((started.body as JSONObject)["authorizationUrl"] as string)
      .get("scope")!
      .split(" ");
  }

  async function comeBack(started: ProbeResponse): Promise<ProbeResponse> {
    const state: string = queryOf(
      (started.body as JSONObject)["authorizationUrl"] as string,
    ).get("state")!;

    return await httpGet({
      port: app.port,
      path: `/api/video-call-oauth/microsoft-teams/callback?code=ms-code&state=${state}`,
      headers: {
        cookie: cookieHeader({
          [COOKIE_NAME]: started.setCookies[COOKIE_NAME]!,
        }),
      },
      timeoutMs: ANSWER_WITHIN_MS,
    });
  }

  test("Microsoft's sign-in also asks to use the account's calendar and read meeting transcripts", async () => {
    const started: ProbeResponse = await start();

    expect(started.status).toBe(200);
    expect(scopesOf(started)).toEqual([
      ...BASE_SCOPES,
      ...MICROSOFT_TEAMS_MEETINGS_RECORDING_SCOPES,
    ]);
    expect(isRecording).toHaveBeenCalledTimes(1);
    expect(isRecording.mock.calls[0]![0].toString()).toBe(projectId.toString());
  });

  test("a project that does not record its calls asks for the meeting permission alone", async () => {
    isRecording.mockResolvedValue(false);

    const started: ProbeResponse = await start();

    expect(started.status).toBe(200);
    expect(scopesOf(started)).toEqual(BASE_SCOPES);
  });

  test("a project whose switch cannot be read still connects, without the recording permissions", async () => {
    isRecording.mockRejectedValue(new Error("database unavailable"));

    const started: ProbeResponse = await start();

    expect(started.status).toBe(200);
    expect(scopesOf(started)).toEqual(BASE_SCOPES);
  });

  test("coming back, the code is exchanged for the recording permissions the start asked for", async () => {
    const response: ProbeResponse = await comeBack(await start());

    expect(response.status).toBe(302);
    expect(exchangeCode).toHaveBeenCalledWith({
      code: "ms-code",
      redirectUri: expect.stringMatching(
        /\/api\/video-call-oauth\/microsoft-teams\/callback$/,
      ),
      recordAndTranscribe: true,
    });
    expect(connectWithSignIn).toHaveBeenCalledWith({
      projectId: projectId,
      userId: userId,
      provider: VideoCallProvider.MicrosoftTeams,
      grant: GRANT,
      connectionId: undefined,
    });
  });

  test("a sign-in that did not ask for them is exchanged as it always was", async () => {
    isRecording.mockResolvedValue(false);

    await comeBack(await start());

    expect(exchangeCode).toHaveBeenCalledWith({
      code: "ms-code",
      redirectUri: expect.stringMatching(
        /\/api\/video-call-oauth\/microsoft-teams\/callback$/,
      ),
    });
  });

  test("the start's answer stands: the switch turned on before the callback asks for nothing the sign-in did not", async () => {
    isRecording.mockResolvedValue(false);
    const started: ProbeResponse = await start();

    isRecording.mockResolvedValue(true);
    await comeBack(started);

    expect(exchangeCode).toHaveBeenCalledWith(
      expect.not.objectContaining({ recordAndTranscribe: true }),
    );
    // The callback never reads the switch again.
    expect(isRecording).toHaveBeenCalledTimes(1);
  });

  test("a reconnect keeps naming its connection, and asks for the recording permissions too", async () => {
    const stored: VideoCallConnection = new VideoCallConnection();
    stored.id = CONNECTION_ID;
    stored.provider = VideoCallProvider.MicrosoftTeams;
    stored.authMethod = VideoCallAuthMethod.OAuth;
    findOneBy.mockResolvedValue(stored);

    const started: ProbeResponse = await start(
      `?connectionId=${CONNECTION_ID.toString()}`,
    );

    expect(started.status).toBe(200);
    expect(scopesOf(started)).toEqual([
      ...BASE_SCOPES,
      ...MICROSOFT_TEAMS_MEETINGS_RECORDING_SCOPES,
    ]);

    await comeBack(started);

    expect(exchangeCode).toHaveBeenCalledWith(
      expect.objectContaining({ recordAndTranscribe: true }),
    );
    expect(connectWithSignIn).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: CONNECTION_ID }),
    );
  });
});
