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
import OneUptimeDate from "../../../Types/Date";
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
 * ONEUPTIME INSTALLED FOR A WHOLE SLACK ENTERPRISE ORGANIZATION.
 *
 * A customer's Slack is an Enterprise organization of several workspaces,
 * and they work in one OneUptime project. An org admin can install
 * OneUptime once for the whole organization (the manifest allows it:
 * org_deploy_enabled) - and then Slack's oauth.v2.access names no workspace
 * (`team` is null), only the organization, with is_enterprise_install. The
 * install callback used to refuse that answer; now the connection is the
 * organization's, stored under its id, with the workspaces Slack lists
 * OneUptime as added to (SlackOrganization).
 *
 * A project already connected to one workspace of that organization moves
 * to the organization's installation instead of being refused - its rules,
 * linked accounts and known channels are the organization's too - keeping
 * that workspace as the default its channels are created in. Any other
 * change of workspace is still refused, as before.
 *
 * These drive the real install callback over HTTP, and the real
 * WorkspaceProjectAuthTokenService under it - its refusal to repoint a
 * project included - on an in-memory table of connections, against a
 * recorded Slack.
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

const INSTALL_START: string = "/api/slack/install-url";
const COOKIE_NAME: string = WorkspaceOAuthState.BROWSER_BINDING_COOKIE_NAME;
const mockCacheStore: Map<string, CacheEntry> = (GlobalCache as any).store;

// Who installs it in Slack: an org admin, the Slack user whose account is linked.
const ADMIN_SLACK_USER_ID: string = "U0ORGADMIN";
const BOT_USER_ID: string = "U0ONEUPTIMEBOT";

describe("Slack install callback: a whole Enterprise organization", () => {
  let app: RunningApp;
  let projectId: ObjectID;
  let userId: ObjectID;
  let connections: InMemorySlackConnections;
  let slack: FakeSlack;
  let infoLines: Array<string>;
  let errorLines: Array<string>;

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
    infoLines = [];
    errorLines = [];

    connections = new InMemorySlackConnections();
    connections.install();

    slack = new FakeSlack();
    slack.workspacesOfToken.set(ORG_TOKEN, [WEST, EAST]);
    slack.install();

    linkUser.mockImplementation(async () => {
      return undefined;
    });

    // Whoever started the install may still connect the project.
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
          };
        },
      );

    jest.spyOn(UserService, "findOneById").mockImplementation(async () => {
      return { isMasterAdmin: false } as any;
    });

    // The Home drawn for whoever installed it has its own tests (SlackHomeAndWelcome).
    const SlackAPI: any = (await import("../../../Server/API/SlackAPI"))
      .default;
    jest.spyOn(SlackAPI, "refreshHomeAfterConnect").mockImplementation(() => {
      return undefined;
    });

    jest.spyOn(logger, "info").mockImplementation(((line: unknown) => {
      infoLines.push(String(line));
    }) as never);
    jest.spyOn(logger, "error").mockImplementation(((line: unknown) => {
      errorLines.push(line instanceof Error ? line.message : String(line));
    }) as never);
    jest.spyOn(logger, "debug").mockImplementation((() => {
      return undefined;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function signedInHeaders(): Record<string, string> {
    return {
      [TEST_USER_HEADER]: userId.toString(),
      tenantid: projectId.toString(),
      [TEST_PERMISSIONS_HEADER]: Permission.ProjectAdmin,
    };
  }

  // The project's Slack page, which every callback answers on.
  function slackPage(): string {
    return `${DashboardClientUrl.toString()}/${projectId.toString()}/settings/slack-integration`;
  }

  // What oauth.v2.access answers an org admin who installed it for the organization.
  function organizationInstall(overrides?: JSONObject): JSONObject {
    return {
      ok: true,
      app_id: "A0ONEUPTIME",
      authed_user: { id: ADMIN_SLACK_USER_ID },
      scope: "chat:write,channels:read",
      token_type: "bot",
      access_token: ORG_TOKEN,
      bot_user_id: BOT_USER_ID,
      team: null,
      enterprise: { id: ORG_ID, name: ORG_NAME },
      is_enterprise_install: true,
      ...(overrides || {}),
    };
  }

  // What it answers an install into one workspace, of an organization or of none.
  function workspaceInstall(data: {
    teamId: string;
    teamName: string;
    enterprise?: { id: string; name: string } | null | undefined;
    token?: string | undefined;
  }): JSONObject {
    return {
      ok: true,
      app_id: "A0ONEUPTIME",
      authed_user: { id: ADMIN_SLACK_USER_ID },
      token_type: "bot",
      access_token: data.token || "xoxb-workspace-token",
      bot_user_id: BOT_USER_ID,
      team: { id: data.teamId, name: data.teamName },
      enterprise: data.enterprise || null,
      is_enterprise_install: false,
    };
  }

  // Installs, with Slack answering the token exchange `answer`.
  async function install(answer: JSONObject): Promise<ProbeResponse> {
    const started: { state: string; browser: Browser } = await startConnection({
      port: app.port,
      path: INSTALL_START,
      headers: signedInHeaders(),
      cookieName: COOKIE_NAME,
    });

    slack.answers.set("oauth.v2.access", (): JSONObject => {
      return answer;
    });

    return await finishConnection({
      port: app.port,
      path: `/api/slack/auth/${projectId.toString()}/${userId.toString()}`,
      query: { code: "slack-code", state: started.state },
      browser: started.browser,
    });
  }

  function stored(): StoredSlackConnection {
    const row: StoredSlackConnection | undefined =
      connections.slackOf(projectId);

    expect(row).toBeDefined();

    return row!;
  }

  function expectInstalled(response: ProbeResponse): void {
    if (response.location !== slackPage()) {
      // Says why, when it was not: what was logged.
      expect({ location: response.location, infoLines, errorLines }).toEqual({
        location: slackPage(),
        infoLines: infoLines,
        errorLines: errorLines,
      });
    }

    expect(response.status).toBe(302);
  }

  function expectRefused(response: ProbeResponse): void {
    expect(response.status).toBe(302);
    expect(response.location).toBe(`${slackPage()}?error=could-not-finish`);
  }

  function workspacesListedWith(): Array<string> {
    return slack.callsOf("auth.teams.list").map((call: SlackCall): string => {
      return call.token;
    });
  }

  describe("a project with no Slack connection yet", () => {
    test("is connected under the organization: its id, its name, the bot, and the workspaces Slack lists OneUptime as added to", async () => {
      const before: number = Date.now();

      const response: ProbeResponse = await install(organizationInstall());

      expectInstalled(response);

      expect(connections.rows).toHaveLength(1);

      const row: StoredSlackConnection = stored();
      expect(row.workspaceProjectId).toBe(ORG_ID);
      expect(row.authToken).toBe(ORG_TOKEN);
      expect(row.workspaceType).toBe(WorkspaceType.Slack);

      const { workspacesReadAt, ...miscData } = row.miscData;

      expect(miscData).toEqual({
        teamId: ORG_ID,
        teamName: ORG_NAME,
        botUserId: BOT_USER_ID,
        enterpriseId: ORG_ID,
        enterpriseName: ORG_NAME,
        isEnterpriseInstall: true,
        // As Slack listed them; the default is picked when they are read.
        workspaces: [WEST, EAST],
      });

      const readAt: number = OneUptimeDate.fromString(
        workspacesReadAt as string,
      ).getTime();
      expect(readAt).toBeGreaterThanOrEqual(before - 1000);
      expect(readAt).toBeLessThanOrEqual(Date.now() + 1000);

      // Listed once, with the organization's own token.
      expect(workspacesListedWith()).toEqual([ORG_TOKEN]);
    });

    test("the org admin who installed it has their Slack account linked, as for a workspace's install", async () => {
      expectInstalled(await install(organizationInstall()));

      expect(linkUser).toHaveBeenCalledTimes(1);
      const link: JSONObject = linkUser.mock.calls[0]![0] as JSONObject;
      expect((link["projectId"] as ObjectID).toString()).toBe(
        projectId.toString(),
      );
      expect((link["userId"] as ObjectID).toString()).toBe(userId.toString());
      expect(link["workspaceType"]).toBe(WorkspaceType.Slack);
      expect(link["workspaceUserId"]).toBe(ADMIN_SLACK_USER_ID);
    });

    test("Slack not listing the workspaces yet does not stop the install: they are read when they are needed", async () => {
      slack.answers.set("auth.teams.list", (): JSONObject => {
        return { ok: false, error: "ratelimited" };
      });

      const response: ProbeResponse = await install(organizationInstall());

      expectInstalled(response);

      const row: StoredSlackConnection = stored();
      expect(row.workspaceProjectId).toBe(ORG_ID);
      expect(row.miscData["isEnterpriseInstall"]).toBe(true);
      expect(row.miscData["workspaces"]).toBeUndefined();
      expect(row.miscData["workspacesReadAt"]).toBeUndefined();
    });

    test("is_enterprise_install as Slack's text 'true' is the organization's install too", async () => {
      const response: ProbeResponse = await install(
        organizationInstall({ is_enterprise_install: "true" }),
      );

      expectInstalled(response);
      expect(stored().workspaceProjectId).toBe(ORG_ID);
      expect(stored().miscData["isEnterpriseInstall"]).toBe(true);
    });

    test("a workspace of an organization, installed on its own: the workspace's connection, which records its organization", async () => {
      const response: ProbeResponse = await install(
        workspaceInstall({
          teamId: EAST.id,
          teamName: EAST.name,
          enterprise: { id: ORG_ID, name: ORG_NAME },
        }),
      );

      expectInstalled(response);

      const row: StoredSlackConnection = stored();
      expect(row.workspaceProjectId).toBe(EAST.id);
      expect(row.miscData).toEqual({
        teamId: EAST.id,
        teamName: EAST.name,
        botUserId: BOT_USER_ID,
        enterpriseId: ORG_ID,
        enterpriseName: ORG_NAME,
      });
      // Nothing to list: it is one workspace's.
      expect(workspacesListedWith()).toEqual([]);
    });

    test("a workspace of no organization is stored as it always was", async () => {
      const response: ProbeResponse = await install(
        workspaceInstall({ teamId: LONE_WORKSPACE_ID, teamName: "Lonely" }),
      );

      expectInstalled(response);
      expect(stored().miscData).toEqual({
        teamId: LONE_WORKSPACE_ID,
        teamName: "Lonely",
        botUserId: BOT_USER_ID,
      });
    });
  });

  describe("an answer that names neither a workspace nor an organization", () => {
    test.each([
      [
        "no team and no enterprise",
        { team: null, enterprise: null, is_enterprise_install: false },
      ],
      [
        "is_enterprise_install, with no organization named",
        { team: null, enterprise: null, is_enterprise_install: true },
      ],
      [
        "an enterprise with no id",
        { team: null, enterprise: { name: ORG_NAME } },
      ],
      ["a team with no id", { team: { name: "Nameless" }, enterprise: null }],
    ])(
      "%s: refused, and nothing is connected or linked",
      async (_label: string, overrides: JSONObject) => {
        const response: ProbeResponse = await install(
          organizationInstall(overrides),
        );

        expectRefused(response);
        expect(connections.rows).toHaveLength(0);
        expect(connections.writes).toEqual([]);
        expect(linkUser).not.toHaveBeenCalled();
        expect(
          infoLines.some((line: string): boolean => {
            return line.includes(
              "Slack named no workspace or organization for the installation.",
            );
          }),
        ).toBe(true);
      },
    );
  });

  describe("a project connected to one workspace of the organization", () => {
    function connectToEast(miscData?: JSONObject): StoredSlackConnection {
      return connections.add({
        projectId: projectId,
        workspaceProjectId: EAST.id,
        authToken: "xoxb-east-token",
        miscData: miscData || {
          teamId: EAST.id,
          teamName: EAST.name,
          botUserId: "U0EASTBOT",
          enterpriseId: ORG_ID,
          enterpriseName: ORG_NAME,
          channelCache: {
            ops: {
              id: "C0OPS",
              name: "ops",
              workspaceType: WorkspaceType.Slack,
              lastUpdated: "2026-10-30T10:00:00.000Z",
            },
            "west-alerts": {
              id: "C0WESTALERTS",
              name: "west-alerts",
              workspaceType: WorkspaceType.Slack,
              lastUpdated: "2026-10-30T10:00:00.000Z",
              teamId: WEST.id,
            },
          },
        },
      });
    }

    test("moves to the organization's installation: the same connection, now the organization's, with its workspace the default", async () => {
      const east: StoredSlackConnection = connectToEast();

      const response: ProbeResponse = await install(organizationInstall());

      expectInstalled(response);

      // Updated in place - its rules and linked accounts are the project's still.
      expect(connections.rows).toHaveLength(1);
      expect(
        connections.writes.map((write: { kind: string }): string => {
          return write.kind;
        }),
      ).toEqual(["update"]);

      const row: StoredSlackConnection = stored();
      expect(row.id.toString()).toBe(east.id.toString());
      expect(row.workspaceProjectId).toBe(ORG_ID);
      expect(row.authToken).toBe(ORG_TOKEN);
      expect(row.miscData["isEnterpriseInstall"]).toBe(true);
      expect(row.miscData["enterpriseId"]).toBe(ORG_ID);
      expect(row.miscData["teamId"]).toBe(ORG_ID);
      expect(row.miscData["botUserId"]).toBe(BOT_USER_ID);
      expect(row.miscData["workspaces"]).toEqual([WEST, EAST]);
      // Where its channels were created: where they are created still.
      expect(row.miscData["defaultWorkspaceId"]).toBe(EAST.id);
    });

    test("the channels it knew are kept, each in the workspace it was found in", async () => {
      connectToEast();

      expectInstalled(await install(organizationInstall()));

      expect(stored().miscData["channelCache"]).toEqual({
        // Found when the project was the workspace's: that workspace's.
        ops: {
          id: "C0OPS",
          name: "ops",
          workspaceType: WorkspaceType.Slack,
          lastUpdated: "2026-10-30T10:00:00.000Z",
          teamId: EAST.id,
        },
        // A channel that names its workspace keeps it.
        "west-alerts": {
          id: "C0WESTALERTS",
          name: "west-alerts",
          workspaceType: WorkspaceType.Slack,
          lastUpdated: "2026-10-30T10:00:00.000Z",
          teamId: WEST.id,
        },
      });
    });

    test("the move is logged, naming both", async () => {
      connectToEast();

      expectInstalled(await install(organizationInstall()));

      expect(
        infoLines.some((line: string): boolean => {
          return (
            line.includes(projectId.toString()) &&
            line.includes(`moves from ${EAST.id} to ${ORG_ID}`)
          );
        }),
      ).toBe(true);
    });

    test("connected before installs recorded the organization: the organization's workspaces say it is one of them", async () => {
      connectToEast({
        teamId: EAST.id,
        teamName: EAST.name,
        botUserId: "U0EASTBOT",
      });

      const response: ProbeResponse = await install(organizationInstall());

      expectInstalled(response);
      expect(stored().workspaceProjectId).toBe(ORG_ID);
      expect(stored().miscData["defaultWorkspaceId"]).toBe(EAST.id);
      // The workspaces told it: Slack was not asked about the old token.
      expect(slack.callsOf("auth.test")).toEqual([]);
    });

    test("…and when the organization's installation is not added to it yet, Slack is asked with the workspace's own token", async () => {
      connectToEast({
        teamId: EAST.id,
        teamName: EAST.name,
        botUserId: "U0EASTBOT",
      });
      slack.workspacesOfToken.set(ORG_TOKEN, [WEST]);
      slack.authTestOfToken.set("xoxb-east-token", {
        ok: true,
        team_id: EAST.id,
        team: EAST.name,
        enterprise_id: ORG_ID,
        user_id: "U0EASTBOT",
      });

      const response: ProbeResponse = await install(organizationInstall());

      expectInstalled(response);
      expect(
        slack.callsOf("auth.test").map((call: SlackCall): string => {
          return call.token;
        }),
      ).toEqual(["xoxb-east-token"]);
      expect(stored().workspaceProjectId).toBe(ORG_ID);
      // Kept as the default, though Slack does not list it among them yet.
      expect(stored().miscData["defaultWorkspaceId"]).toBe(EAST.id);
    });

    test("…but not when Slack says the workspace is of another organization: refused, and nothing changes", async () => {
      const east: StoredSlackConnection = connectToEast({
        teamId: EAST.id,
        teamName: EAST.name,
        botUserId: "U0EASTBOT",
      });
      slack.workspacesOfToken.set(ORG_TOKEN, [WEST]);
      slack.authTestOfToken.set("xoxb-east-token", {
        ok: true,
        team_id: EAST.id,
        enterprise_id: OTHER_ORG_ID,
      });

      const response: ProbeResponse = await install(organizationInstall());

      expectRefused(response);
      expect(connections.writes).toEqual([]);
      expect(stored().workspaceProjectId).toBe(east.workspaceProjectId);
      expect(stored().authToken).toBe("xoxb-east-token");
      expect(linkUser).not.toHaveBeenCalled();
    });
  });

  describe("installed again for the same organization", () => {
    test("keeps the default chosen and the channels it knows, with the new token and the workspaces listed again", async () => {
      const organization: StoredSlackConnection = connections.add({
        projectId: projectId,
        workspaceProjectId: ORG_ID,
        authToken: "xoxb-acme-organization-old",
        miscData: {
          teamId: ORG_ID,
          teamName: ORG_NAME,
          botUserId: BOT_USER_ID,
          enterpriseId: ORG_ID,
          enterpriseName: ORG_NAME,
          isEnterpriseInstall: true,
          workspaces: [EAST, WEST],
          workspacesReadAt: "2026-10-01T00:00:00.000Z",
          defaultWorkspaceId: WEST.id,
          channelCache: {
            ops: {
              id: "C0OPS",
              name: "ops",
              workspaceType: WorkspaceType.Slack,
              lastUpdated: "2026-10-30T10:00:00.000Z",
              teamId: EAST.id,
            },
          },
        },
      });
      slack.workspacesOfToken.set(ORG_TOKEN, [EAST, WEST, LAB]);

      const response: ProbeResponse = await install(organizationInstall());

      expectInstalled(response);
      expect(connections.rows).toHaveLength(1);

      const row: StoredSlackConnection = stored();
      expect(row.id.toString()).toBe(organization.id.toString());
      expect(row.authToken).toBe(ORG_TOKEN);
      expect(row.miscData["defaultWorkspaceId"]).toBe(WEST.id);
      expect(row.miscData["workspaces"]).toEqual([EAST, WEST, LAB]);
      expect(row.miscData["channelCache"]).toEqual({
        ops: {
          id: "C0OPS",
          name: "ops",
          workspaceType: WorkspaceType.Slack,
          lastUpdated: "2026-10-30T10:00:00.000Z",
          teamId: EAST.id,
        },
      });
    });

    test("keeps the workspaces OneUptime was removed from by the names they had - one Slack no longer lists joins them, one it lists again leaves", async () => {
      const OLD: JSONObject = { id: "T0OLD", name: "Acme Old" };

      connections.add({
        projectId: projectId,
        workspaceProjectId: ORG_ID,
        authToken: "xoxb-acme-organization-old",
        miscData: {
          teamId: ORG_ID,
          teamName: ORG_NAME,
          botUserId: BOT_USER_ID,
          enterpriseId: ORG_ID,
          enterpriseName: ORG_NAME,
          isEnterpriseInstall: true,
          workspaces: [EAST, WEST],
          workspacesReadAt: "2026-10-01T00:00:00.000Z",
          removedWorkspaces: [OLD, LAB],
        },
      });
      // West removed since; Lab added again.
      slack.workspacesOfToken.set(ORG_TOKEN, [EAST, LAB]);

      expectInstalled(await install(organizationInstall()));

      expect(stored().miscData["workspaces"]).toEqual([EAST, LAB]);
      expect(stored().miscData["removedWorkspaces"]).toEqual([WEST, OLD]);
    });

    test("Slack not listing the workspaces at install: those removed stay as they were", async () => {
      const OLD: JSONObject = { id: "T0OLD", name: "Acme Old" };

      connections.add({
        projectId: projectId,
        workspaceProjectId: ORG_ID,
        authToken: "xoxb-acme-organization-old",
        miscData: {
          teamId: ORG_ID,
          teamName: ORG_NAME,
          botUserId: BOT_USER_ID,
          enterpriseId: ORG_ID,
          enterpriseName: ORG_NAME,
          isEnterpriseInstall: true,
          workspaces: [EAST, WEST],
          workspacesReadAt: "2026-10-01T00:00:00.000Z",
          removedWorkspaces: [OLD],
        },
      });
      slack.answers.set("auth.teams.list", (): JSONObject => {
        return { ok: false, error: "ratelimited" };
      });

      expectInstalled(await install(organizationInstall()));

      expect(stored().miscData["removedWorkspaces"]).toEqual([OLD]);
    });
  });

  describe("connected back to one workspace of the organization", () => {
    test("the organization's project may move to one of its workspaces' installation", async () => {
      connections.add({
        projectId: projectId,
        workspaceProjectId: ORG_ID,
        authToken: "xoxb-acme-organization-old",
        miscData: {
          teamId: ORG_ID,
          teamName: ORG_NAME,
          botUserId: BOT_USER_ID,
          enterpriseId: ORG_ID,
          enterpriseName: ORG_NAME,
          isEnterpriseInstall: true,
          workspaces: [EAST, WEST],
          defaultWorkspaceId: WEST.id,
        },
      });

      const response: ProbeResponse = await install(
        workspaceInstall({
          teamId: WEST.id,
          teamName: WEST.name,
          enterprise: { id: ORG_ID, name: ORG_NAME },
          token: "xoxb-west-token",
        }),
      );

      expectInstalled(response);
      expect(connections.rows).toHaveLength(1);

      const row: StoredSlackConnection = stored();
      expect(row.workspaceProjectId).toBe(WEST.id);
      expect(row.authToken).toBe("xoxb-west-token");
      // One workspace's connection again: nothing of the organization's installation.
      expect(row.miscData).toEqual({
        teamId: WEST.id,
        teamName: WEST.name,
        botUserId: BOT_USER_ID,
        enterpriseId: ORG_ID,
        enterpriseName: ORG_NAME,
      });
    });
  });

  describe("any other change of workspace is still refused", () => {
    test("a project connected to a workspace of another organization: refused, its connection unchanged, nobody linked", async () => {
      connections.add({
        projectId: projectId,
        workspaceProjectId: OTHER_ORG_WORKSPACE_ID,
        authToken: "xoxb-globex-token",
        miscData: {
          teamId: OTHER_ORG_WORKSPACE_ID,
          teamName: "Globex HQ",
          botUserId: "U0GLOBEXBOT",
          enterpriseId: OTHER_ORG_ID,
          enterpriseName: "Globex",
        },
      });

      const response: ProbeResponse = await install(organizationInstall());

      expectRefused(response);
      expect(connections.writes).toEqual([]);
      expect(stored().workspaceProjectId).toBe(OTHER_ORG_WORKSPACE_ID);
      expect(stored().authToken).toBe("xoxb-globex-token");
      expect(linkUser).not.toHaveBeenCalled();
      expect(
        errorLines.some((line: string): boolean => {
          return line.includes(
            `from workspace ${OTHER_ORG_WORKSPACE_ID} to ${ORG_ID}`,
          );
        }),
      ).toBe(true);
    });

    test("a project connected to a workspace of no organization, as its install recorded and as Slack says still: refused", async () => {
      connections.add({
        projectId: projectId,
        workspaceProjectId: LONE_WORKSPACE_ID,
        authToken: "xoxb-lonely-token",
        miscData: {
          teamId: LONE_WORKSPACE_ID,
          teamName: "Lonely",
          botUserId: "U0LONELYBOT",
          // Asked once, and part of none.
          enterpriseId: "",
        },
      });
      slack.authTestOfToken.set("xoxb-lonely-token", {
        ok: true,
        team_id: LONE_WORKSPACE_ID,
      });

      const response: ProbeResponse = await install(organizationInstall());

      expectRefused(response);
      expect(stored().workspaceProjectId).toBe(LONE_WORKSPACE_ID);
      expect(connections.writes).toEqual([]);
    });

    test("a workspace recorded as part of no organization that has joined this one since: Slack says so, and it moves", async () => {
      connections.add({
        projectId: projectId,
        workspaceProjectId: LONE_WORKSPACE_ID,
        authToken: "xoxb-lonely-token",
        miscData: {
          teamId: LONE_WORKSPACE_ID,
          teamName: "Lonely",
          botUserId: "U0LONELYBOT",
          enterpriseId: "",
        },
      });
      // Migrated into the organization, which has not added OneUptime to it yet.
      slack.authTestOfToken.set("xoxb-lonely-token", {
        ok: true,
        team_id: LONE_WORKSPACE_ID,
        enterprise_id: ORG_ID,
      });

      const response: ProbeResponse = await install(organizationInstall());

      expectInstalled(response);
      expect(stored().workspaceProjectId).toBe(ORG_ID);
      expect(stored().miscData["defaultWorkspaceId"]).toBe(LONE_WORKSPACE_ID);
    });

    test("a project connected to a workspace Slack says is of no organization: refused", async () => {
      connections.add({
        projectId: projectId,
        workspaceProjectId: LONE_WORKSPACE_ID,
        authToken: "xoxb-lonely-token",
        miscData: {
          teamId: LONE_WORKSPACE_ID,
          teamName: "Lonely",
          botUserId: "U0LONELYBOT",
        },
      });
      slack.authTestOfToken.set("xoxb-lonely-token", {
        ok: true,
        team_id: LONE_WORKSPACE_ID,
      });

      const response: ProbeResponse = await install(organizationInstall());

      expectRefused(response);
      expect(
        slack.callsOf("auth.test").map((call: SlackCall): string => {
          return call.token;
        }),
      ).toEqual(["xoxb-lonely-token"]);
      expect(stored().workspaceProjectId).toBe(LONE_WORKSPACE_ID);
      expect(connections.writes).toEqual([]);
    });

    test("a project connected to the whole organization, installing a workspace of another organization: refused", async () => {
      connections.add({
        projectId: projectId,
        workspaceProjectId: ORG_ID,
        authToken: ORG_TOKEN,
        miscData: {
          teamId: ORG_ID,
          teamName: ORG_NAME,
          botUserId: BOT_USER_ID,
          enterpriseId: ORG_ID,
          enterpriseName: ORG_NAME,
          isEnterpriseInstall: true,
          workspaces: [EAST, WEST],
        },
      });

      const response: ProbeResponse = await install(
        workspaceInstall({
          teamId: OTHER_ORG_WORKSPACE_ID,
          teamName: "Globex HQ",
          enterprise: { id: OTHER_ORG_ID, name: "Globex" },
        }),
      );

      expectRefused(response);
      expect(stored().workspaceProjectId).toBe(ORG_ID);
      expect(connections.writes).toEqual([]);
    });

    test("a project connected to the whole organization, installing a workspace of no organization: refused", async () => {
      connections.add({
        projectId: projectId,
        workspaceProjectId: ORG_ID,
        authToken: ORG_TOKEN,
        miscData: {
          teamId: ORG_ID,
          teamName: ORG_NAME,
          botUserId: BOT_USER_ID,
          enterpriseId: ORG_ID,
          isEnterpriseInstall: true,
        },
      });

      const response: ProbeResponse = await install(
        workspaceInstall({ teamId: LONE_WORKSPACE_ID, teamName: "Lonely" }),
      );

      expectRefused(response);
      expect(stored().workspaceProjectId).toBe(ORG_ID);
      expect(connections.writes).toEqual([]);
    });

    test("a project connected to one organization, installing another organization: refused", async () => {
      connections.add({
        projectId: projectId,
        workspaceProjectId: OTHER_ORG_ID,
        authToken: "xoxb-globex-organization",
        miscData: {
          teamId: OTHER_ORG_ID,
          teamName: "Globex",
          botUserId: "U0GLOBEXBOT",
          enterpriseId: OTHER_ORG_ID,
          enterpriseName: "Globex",
          isEnterpriseInstall: true,
          workspaces: [{ id: OTHER_ORG_WORKSPACE_ID, name: "Globex HQ" }],
        },
      });

      const response: ProbeResponse = await install(organizationInstall());

      expectRefused(response);
      expect(stored().workspaceProjectId).toBe(OTHER_ORG_ID);
      expect(stored().authToken).toBe("xoxb-globex-organization");
      expect(connections.writes).toEqual([]);
    });

    test("a project connected to a workspace of the organization, installing another workspace of it on its own: refused, as any other workspace", async () => {
      connections.add({
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

      const response: ProbeResponse = await install(
        workspaceInstall({
          teamId: WEST.id,
          teamName: WEST.name,
          enterprise: { id: ORG_ID, name: ORG_NAME },
        }),
      );

      expectRefused(response);
      expect(stored().workspaceProjectId).toBe(EAST.id);
      expect(connections.writes).toEqual([]);
    });
  });
});
