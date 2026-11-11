import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceOAuthState from "../../../Server/Utils/Workspace/WorkspaceOAuthState";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import logger from "../../../Server/Utils/Logger";
import { DashboardClientUrl } from "../../../Server/EnvironmentConfig";
import {
  CacheEntry,
  makeUnsignedJwt,
  ProbeResponse,
  RunningApp,
  startApp,
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
  LONE_WORKSPACE_ID,
  ORG_ID,
  ORG_NAME,
  ORG_TOKEN,
  OTHER_ORG_ID,
  OTHER_ORG_WORKSPACE_ID,
  SlackCall,
  startConnection,
  StoredSlackConnection,
  WEST,
} from "./SlackOrganizationTestHelpers";

/*
 * SIGNING IN WITH SLACK, IN A PROJECT CONNECTED TO A WHOLE SLACK ENTERPRISE
 * ORGANIZATION.
 *
 * A member links their Slack account by signing in with Slack, and the
 * account must be one of the project's Slack: Slack's ID token names the
 * workspace it signed in from (https://slack.com/team_id), and the sign-in
 * was refused unless that was the project's own workspace. A project
 * connected to a whole organization is connected under the organization's
 * id, which no account signs in from - so every member was refused, from
 * every one of its workspaces.
 *
 * Now an account is the organization's when the ID token names the
 * organization (https://slack.com/enterprise_id), or when it signed in from
 * a workspace OneUptime was added to - listed again from Slack once, for a
 * workspace an admin added it to since. A project connected to one
 * workspace still takes accounts of that workspace only.
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

jest.mock("../../../Server/Services/WorkspaceUserAuthTokenService", () => {
  return {
    __esModule: true,
    default: {
      refreshAuthToken: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      getCurrentPlan: jest.fn(async () => {
        return { plan: null, isSubscriptionUnpaid: false };
      }),
    },
  };
});

const SIGN_IN_START: string = "/api/slack/sign-in-url";
const COOKIE_NAME: string = WorkspaceOAuthState.BROWSER_BINDING_COOKIE_NAME;
const mockCacheStore: Map<string, CacheEntry> = (GlobalCache as any).store;

const SLACK_USER_ID: string = "U0PRIYA";

describe("Slack sign-in callback: accounts of a whole Enterprise organization", () => {
  let app: RunningApp;
  let projectId: ObjectID;
  let userId: ObjectID;
  let connections: InMemorySlackConnections;
  let slack: FakeSlack;

  const linkUser: jest.Mock =
    WorkspaceUserAuthTokenService.refreshAuthToken as unknown as jest.Mock;

  beforeAll(async () => {
    const SlackAPI: any = (await import("../../../Server/API/SlackAPI"))
      .default;

    app = await startApp([new SlackAPI().getRouter()]);
  }, 600000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    mockCacheStore.clear();
    jest.clearAllMocks();
    projectId = ObjectID.generate();
    userId = ObjectID.generate();

    connections = new InMemorySlackConnections();
    connections.install();

    slack = new FakeSlack();
    slack.install();

    linkUser.mockImplementation(async () => {
      return undefined;
    });

    // Whoever started signing in is still a member when Slack sends them back.
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
                    permission: Permission.ProjectMember,
                    labelIds: [],
                    isBlockPermission: false,
                  },
                ],
              },
            },
            userTeamIds: [],
          };
        },
      );

    jest.spyOn(UserService, "findOneById").mockImplementation(async () => {
      return { isMasterAdmin: false } as any;
    });

    const SlackAPI: any = (await import("../../../Server/API/SlackAPI"))
      .default;
    jest.spyOn(SlackAPI, "refreshHomeAfterConnect").mockImplementation(() => {
      return undefined;
    });

    jest.spyOn(logger, "info").mockImplementation((() => {
      return undefined;
    }) as never);
    jest.spyOn(logger, "debug").mockImplementation((() => {
      return undefined;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function slackPage(): string {
    return `${DashboardClientUrl.toString()}/${projectId.toString()}/settings/slack-integration`;
  }

  function connectToOrganization(miscData?: JSONObject): StoredSlackConnection {
    return connections.add({
      projectId: projectId,
      workspaceProjectId: ORG_ID,
      authToken: ORG_TOKEN,
      miscData: miscData || {
        teamId: ORG_ID,
        teamName: ORG_NAME,
        botUserId: "U0ONEUPTIMEBOT",
        enterpriseId: ORG_ID,
        enterpriseName: ORG_NAME,
        isEnterpriseInstall: true,
        workspaces: [EAST, WEST],
        workspacesReadAt: new Date().toISOString(),
        defaultWorkspaceId: EAST.id,
      },
    });
  }

  function connectToEast(): StoredSlackConnection {
    return connections.add({
      projectId: projectId,
      workspaceProjectId: EAST.id,
      authToken: "xoxb-east-token",
      miscData: {
        teamId: EAST.id,
        teamName: EAST.name,
        botUserId: "U0EASTBOT",
        enterpriseId: ORG_ID,
        enterpriseName: ORG_NAME,
      },
    });
  }

  /*
   * Signs in with Slack, Slack's ID token naming the workspace the account
   * signed in from (`teamId`) and - for a workspace of an organization -
   * the organization (`enterpriseId`).
   */
  async function signIn(idToken: {
    teamId?: string | undefined;
    enterpriseId?: string | undefined;
  }): Promise<ProbeResponse> {
    const started: { state: string; browser: Browser } = await startConnection({
      port: app.port,
      path: SIGN_IN_START,
      headers: {
        [TEST_USER_HEADER]: userId.toString(),
        tenantid: projectId.toString(),
        [TEST_PERMISSIONS_HEADER]: Permission.ProjectMember,
      },
      cookieName: COOKIE_NAME,
    });

    const claims: JSONObject = {
      iss: "https://slack.com",
      sub: SLACK_USER_ID,
      "https://slack.com/user_id": SLACK_USER_ID,
    };

    if (idToken.teamId) {
      claims["https://slack.com/team_id"] = idToken.teamId;
    }

    if (idToken.enterpriseId) {
      claims["https://slack.com/enterprise_id"] = idToken.enterpriseId;
    }

    slack.answers.set("openid.connect.token", (): JSONObject => {
      return {
        ok: true,
        access_token: "xoxp-priya",
        id_token: makeUnsignedJwt(claims),
      };
    });

    return await finishConnection({
      port: app.port,
      path: `/api/slack/auth/${projectId.toString()}/${userId.toString()}/user`,
      query: { code: "slack-code", state: started.state },
      browser: started.browser,
    });
  }

  function expectLinked(response: ProbeResponse): void {
    expect(response.status).toBe(302);
    expect(response.location).toBe(slackPage());
    expect(linkUser).toHaveBeenCalledTimes(1);

    const link: JSONObject = linkUser.mock.calls[0]![0] as JSONObject;
    expect((link["projectId"] as ObjectID).toString()).toBe(
      projectId.toString(),
    );
    expect((link["userId"] as ObjectID).toString()).toBe(userId.toString());
    expect(link["workspaceType"]).toBe(WorkspaceType.Slack);
    expect(link["workspaceUserId"]).toBe(SLACK_USER_ID);
  }

  function expectRefusedAsOtherWorkspace(response: ProbeResponse): void {
    expect(response.status).toBe(302);
    expect(response.location).toBe(
      `${slackPage()}?error=slack-other-workspace`,
    );
    expect(linkUser).not.toHaveBeenCalled();
  }

  function workspacesListedWith(): Array<string> {
    return slack.callsOf("auth.teams.list").map((call: SlackCall): string => {
      return call.token;
    });
  }

  describe("a project connected to the whole organization", () => {
    test("an account whose ID token names the organization is linked, from any of its workspaces - Slack is not asked again", async () => {
      connectToOrganization();

      const response: ProbeResponse = await signIn({
        teamId: LAB.id,
        enterpriseId: ORG_ID,
      });

      expectLinked(response);
      expect(workspacesListedWith()).toEqual([]);
    });

    test("an account of a workspace OneUptime was added to is linked, the ID token naming no organization", async () => {
      connectToOrganization();

      expectLinked(await signIn({ teamId: WEST.id }));
      expect(workspacesListedWith()).toEqual([]);
    });

    test("an account of a workspace added since Slack listed them: listed again, once, and linked - the workspaces kept for next time", async () => {
      connectToOrganization();
      slack.workspacesOfToken.set(ORG_TOKEN, [EAST, WEST, LAB]);

      const response: ProbeResponse = await signIn({ teamId: LAB.id });

      expectLinked(response);
      expect(workspacesListedWith()).toEqual([ORG_TOKEN]);
      expect(connections.slackOf(projectId)!.miscData["workspaces"]).toEqual([
        EAST,
        WEST,
        LAB,
      ]);
    });

    test("an account of a workspace Slack does not list even then is refused - asked once, not more", async () => {
      connectToOrganization();
      slack.workspacesOfToken.set(ORG_TOKEN, [EAST, WEST]);

      const response: ProbeResponse = await signIn({ teamId: LAB.id });

      expectRefusedAsOtherWorkspace(response);
      expect(workspacesListedWith()).toEqual([ORG_TOKEN]);
    });

    test("an account of another organization is refused", async () => {
      connectToOrganization();
      slack.workspacesOfToken.set(ORG_TOKEN, [EAST, WEST]);

      const response: ProbeResponse = await signIn({
        teamId: OTHER_ORG_WORKSPACE_ID,
        enterpriseId: OTHER_ORG_ID,
      });

      expectRefusedAsOtherWorkspace(response);
    });

    test("an account of a workspace of no organization is refused", async () => {
      connectToOrganization();
      slack.workspacesOfToken.set(ORG_TOKEN, [EAST, WEST]);

      expectRefusedAsOtherWorkspace(
        await signIn({ teamId: LONE_WORKSPACE_ID }),
      );
    });

    test("Slack failing to list the workspaces again refuses an unlisted workspace's account rather than guessing", async () => {
      connectToOrganization();
      slack.answers.set("auth.teams.list", (): JSONObject => {
        return { ok: false, error: "ratelimited" };
      });

      const response: ProbeResponse = await signIn({ teamId: LAB.id });

      expectRefusedAsOtherWorkspace(response);
      // Nothing written over the workspaces it knew.
      expect(connections.slackOf(projectId)!.miscData["workspaces"]).toEqual([
        EAST,
        WEST,
      ]);
    });

    test("an ID token naming no workspace is refused, whatever organization it names", async () => {
      connectToOrganization();

      const response: ProbeResponse = await signIn({ enterpriseId: ORG_ID });

      expectRefusedAsOtherWorkspace(response);
      expect(workspacesListedWith()).toEqual([]);
    });

    test("an organization's installation Slack has listed no workspaces of yet: an account naming the organization is linked", async () => {
      connectToOrganization({
        teamId: ORG_ID,
        teamName: ORG_NAME,
        botUserId: "U0ONEUPTIMEBOT",
        enterpriseId: ORG_ID,
        enterpriseName: ORG_NAME,
        isEnterpriseInstall: true,
      });

      expectLinked(await signIn({ teamId: EAST.id, enterpriseId: ORG_ID }));
    });
  });

  describe("a project connected to one workspace of the organization", () => {
    test("an account of that workspace is linked, as always", async () => {
      connectToEast();

      expectLinked(await signIn({ teamId: EAST.id, enterpriseId: ORG_ID }));
      expect(workspacesListedWith()).toEqual([]);
    });

    test("an account of another workspace of the same organization is refused: the connection is the workspace's, not the organization's", async () => {
      connectToEast();

      const response: ProbeResponse = await signIn({
        teamId: WEST.id,
        enterpriseId: ORG_ID,
      });

      expectRefusedAsOtherWorkspace(response);
      expect(slack.callsOf("auth.teams.list")).toEqual([]);
    });
  });

  test("a project not connected to Slack says so, and links nobody", async () => {
    const response: ProbeResponse = await signIn({
      teamId: EAST.id,
      enterpriseId: ORG_ID,
    });

    expect(response.status).toBe(302);
    expect(response.location).toBe(`${slackPage()}?error=slack-not-installed`);
    expect(linkUser).not.toHaveBeenCalled();
  });
});
