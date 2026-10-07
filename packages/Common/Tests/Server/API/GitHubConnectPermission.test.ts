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
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ProjectService from "../../../Server/Services/ProjectService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import UserService from "../../../Server/Services/UserService";
import GitHubUtil from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceOAuthState, {
  WorkspaceOAuthFlow,
} from "../../../Server/Utils/Workspace/WorkspaceOAuthState";
import CallerPlan from "../../../Server/Utils/Billing/CallerPlan";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import {
  DashboardClientUrl,
  HomeClientUrl,
} from "../../../Server/EnvironmentConfig";
import {
  GITHUB_CONNECT_FAILED_MESSAGE,
  GITHUB_CONNECT_LINK_MESSAGE,
  GITHUB_CONNECT_PERMISSION_MESSAGE,
} from "../../../Server/API/GitHubConnectAccess";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import {
  CacheEntry,
  cookieHeader,
  httpGet,
  ProbeResponse,
  queryOf,
  RunningApp,
  startApp,
  TEST_API_KEY_HEADER,
  TEST_BLOCKED_PERMISSIONS_HEADER,
  TEST_LABELLED_BLOCKED_PERMISSIONS_HEADER,
  TEST_MASTER_ADMIN_HEADER,
  TEST_MEMBER_OF_HEADER,
  TEST_PERMISSIONS_HEADER,
  TEST_READ_ONLY_HEADER,
  TEST_USER_HEADER,
  TEST_BLOCK_LABEL_ID,
} from "./WorkspaceOAuthTestHelpers";

/*
 * Connecting a GitHub App installation to a project imports every repository
 * in it as the project's code repositories, written by OneUptime itself. So
 * it asks what adding them by hand asks (GitHubConnectAccess):
 *
 *  - a signed-in member of the project, as a person (never an API key), on a
 *    credential that may make changes;
 *  - on OneUptime Cloud, the plan code repositories are sold on;
 *  - permission to create code repositories, team blocks counted.
 *
 * It asks when the connection starts (GET /github/install-url), and again
 * when GitHub sends the browser back (GET /github/auth/callback), of the
 * person the one-use state names, as they are now. The callback learns the
 * project and the person only from that state (WorkspaceOAuthState), and
 * writes nothing before both answers are yes and GitHub has confirmed the
 * installation.
 *
 * These tests drive the real routes over HTTP, with the real state, the real
 * permission rule and the real plan checks. Faked: the session middleware,
 * Redis, the membership read at the callback, and everything that writes or
 * talks to GitHub.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag({
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    GitHubAppName: "oneuptime-test-app",
  });
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

jest.mock("../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      getCurrentPlan: jest.fn(),
      updateOneById: jest.fn(),
      findBy: jest.fn(),
      updateBy: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/CodeRepositoryService", () => {
  return {
    __esModule: true,
    default: {
      importReposFromInstallation: jest.fn(),
      deleteBy: jest.fn(),
      updateBy: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/CodeRepository/GitHub/GitHub", () => {
  return {
    __esModule: true,
    default: {
      assertUserControlsInstallation: jest.fn(),
      verifyWebhookSignature: jest.fn(),
    },
  };
});

jest.mock(
  "../../../Server/Utils/CodeRepository/GitHub/GitHubWebhookHandler",
  () => {
    return {
      __esModule: true,
      default: {
        handleEvent: jest.fn(),
      },
    };
  },
);

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

const START: string = "/api/github/install-url";
const CALLBACK: string = "/api/github/auth/callback";

const COOKIE_NAME: string = WorkspaceOAuthState.BROWSER_BINDING_COOKIE_NAME;

const INSTALLATION_ID: string = "424242";
const OAUTH_CODE: string = "github-oauth-code";

const GROWTH_REFUSAL: string =
  "Please upgrade your plan to Growth to access this feature";

const PLAN_ENVIRONMENT: Record<string, string> = {
  SUBSCRIPTION_PLAN_BASIC: "Free,price_free_month,price_free_year,0,0,1,0",
  SUBSCRIPTION_PLAN_GROWTH:
    "Growth,price_growth_month,price_growth_year,22,20,2,14",
  SUBSCRIPTION_PLAN_SCALE:
    "Scale,price_scale_month,price_scale_year,99,84,3,14",
  SUBSCRIPTION_PLAN_ENTERPRISE:
    "Enterprise,price_enterprise_month,price_enterprise_year,-1,-1,4,14",
};

// What the in-memory GlobalCache has recorded (see createInMemoryGlobalCache).
const mockCacheStore: Map<string, CacheEntry> = (GlobalCache as any).store;

type Browser = Record<string, string>;

interface Role {
  role: string;
  allow: Array<Permission>;
}

// The Code Repositories page's create list: each may connect.
const ROLES_THAT_MAY_CONNECT: ReadonlyArray<Role> = [
  { role: "Project Owner", allow: [Permission.ProjectOwner] },
  { role: "Project Admin", allow: [Permission.ProjectAdmin] },
  { role: "Project Member", allow: [Permission.ProjectMember] },
  { role: "Settings Admin", allow: [Permission.SettingsAdmin] },
  { role: "Settings Member", allow: [Permission.SettingsMember] },
  {
    role: "Create Code Repository",
    allow: [Permission.CreateCodeRepository],
  },
];

// Members who may look at, change or delete code repositories, and add none.
const ROLES_THAT_MAY_NOT_CONNECT: ReadonlyArray<Role> = [
  { role: "Viewer", allow: [Permission.Viewer] },
  { role: "Settings Viewer", allow: [Permission.SettingsViewer] },
  { role: "Read Code Repository", allow: [Permission.ReadCodeRepository] },
  {
    role: "Edit and Delete Code Repository",
    allow: [
      Permission.ReadCodeRepository,
      Permission.EditCodeRepository,
      Permission.DeleteCodeRepository,
    ],
  },
  { role: "Incident Member", allow: [Permission.IncidentMember] },
];

interface Membership {
  allow: Array<Permission>;
  block?: Array<Permission> | undefined;
  labelledBlock?: Array<Permission> | undefined;
}

describe("Connecting a GitHub App installation", () => {
  let app: RunningApp;
  let routePaths: Array<string>;
  let projectId: ObjectID;
  let otherProjectId: ObjectID;
  let userId: ObjectID;

  // Who is a member of what when the callback reads it: `${userId}:${projectId}`.
  let memberships: Map<string, Membership>;
  let masterAdmins: Set<string>;
  let currentPlan: PlanType | null;
  let callOrder: Array<string>;

  const updateProject: jest.Mock =
    ProjectService.updateOneById as unknown as jest.Mock;
  const getCurrentPlan: jest.Mock =
    ProjectService.getCurrentPlan as unknown as jest.Mock;
  const importRepositories: jest.Mock =
    CodeRepositoryService.importReposFromInstallation as unknown as jest.Mock;
  const verifyInstallation: jest.Mock =
    GitHubUtil.assertUserControlsInstallation as unknown as jest.Mock;

  const savedPlanEnvironment: Record<string, string | undefined> = {};

  // Loading the API pulls in a large module graph; give it its own budget.
  beforeAll(async () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("SUBSCRIPTION_PLAN_")) {
        savedPlanEnvironment[key] = process.env[key];
        delete process.env[key];
      }
    }

    Object.assign(process.env, PLAN_ENVIRONMENT);

    const GitHubAPI: any = (await import("../../../Server/API/GitHubAPI"))
      .default;

    const router: any = new GitHubAPI().getRouter();

    // The paths the router serves, read off express's own route table.
    routePaths = ((router.stack || []) as Array<any>)
      .map((layer: any): string | undefined => {
        return layer.route?.path;
      })
      .filter((path: string | undefined): path is string => {
        return Boolean(path);
      });

    app = await startApp([router]);
  }, 600000);

  afterAll(async () => {
    await app.close();

    for (const key of Object.keys(PLAN_ENVIRONMENT)) {
      delete process.env[key];
    }

    for (const [key, value] of Object.entries(savedPlanEnvironment)) {
      if (value !== undefined) {
        process.env[key] = value;
      }
    }
  });

  beforeEach(() => {
    mockCacheStore.clear();
    jest.clearAllMocks();
    setTestBillingEnabled(false);

    projectId = ObjectID.generate();
    otherProjectId = ObjectID.generate();
    userId = ObjectID.generate();

    memberships = new Map<string, Membership>();
    masterAdmins = new Set<string>();
    currentPlan = PlanType.Growth;
    callOrder = [];

    // By default the person who starts is still a Project Owner at the callback.
    grantAtCallback({ allow: [Permission.ProjectOwner] });

    getCurrentPlan.mockImplementation(async () => {
      return { plan: currentPlan, isSubscriptionUnpaid: false };
    });

    updateProject.mockImplementation(async () => {
      callOrder.push("bind");
      return 1;
    });

    importRepositories.mockImplementation(async () => {
      callOrder.push("import");
      return { imported: 3, skipped: 0 };
    });

    verifyInstallation.mockImplementation(async () => {
      callOrder.push("verify");
    });

    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockImplementation(
        async (data: {
          userId: ObjectID;
          projectId: ObjectID;
        }): Promise<DatabaseCommonInteractionProps> => {
          callOrder.push("member");

          const membership: Membership | undefined = memberships.get(
            `${data.userId.toString()}:${data.projectId.toString()}`,
          );

          if (!membership) {
            throw new NotAuthorizedException(
              WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
            );
          }

          return memberProps(data.userId, data.projectId, membership);
        },
      );

    jest
      .spyOn(UserService, "findOneById")
      .mockImplementation(async (data: any): Promise<any> => {
        return {
          isMasterAdmin: masterAdmins.has(data.id.toString()),
        };
      });
  });

  afterEach(() => {
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  function memberProps(
    memberUserId: ObjectID,
    memberProjectId: ObjectID,
    membership: Membership,
  ): DatabaseCommonInteractionProps {
    const row: (
      permission: Permission,
      isBlockPermission: boolean,
      labelIds: Array<ObjectID>,
    ) => UserPermission = (
      permission: Permission,
      isBlockPermission: boolean,
      labelIds: Array<ObjectID>,
    ): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: labelIds,
        isBlockPermission: isBlockPermission,
      };
    };

    return {
      userId: memberUserId,
      tenantId: memberProjectId,
      userGlobalAccessPermission: {
        _type: "UserGlobalAccessPermission",
        projectIds: [memberProjectId],
        globalPermissions: [Permission.Public, Permission.CurrentUser],
      },
      userTenantAccessPermission: {
        [memberProjectId.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: memberProjectId,
          permissions: [
            ...membership.allow.map((permission: Permission) => {
              return row(permission, false, []);
            }),
            ...(membership.block || []).map((permission: Permission) => {
              return row(permission, true, []);
            }),
            ...(membership.labelledBlock || []).map(
              (permission: Permission) => {
                return row(permission, true, [
                  new ObjectID(TEST_BLOCK_LABEL_ID),
                ]);
              },
            ),
          ],
        },
      },
      userTeamIds: [],
    };
  }

  // What the person holds in the project when GitHub sends them back.
  function grantAtCallback(membership: Membership): void {
    memberships.set(`${userId.toString()}:${projectId.toString()}`, membership);
  }

  // They are no longer a member of the project when GitHub sends them back.
  function removeAtCallback(): void {
    memberships.delete(`${userId.toString()}:${projectId.toString()}`);
  }

  function signedInHeaders(options?: {
    permissions?: Array<Permission> | undefined;
    blocked?: Array<Permission> | undefined;
    labelledBlocked?: Array<Permission> | undefined;
    memberOf?: ObjectID | undefined;
    tenantId?: ObjectID | null | undefined;
    apiKey?: boolean | undefined;
    readOnly?: boolean | undefined;
    masterAdmin?: boolean | undefined;
    browser?: Browser | undefined;
  }): Record<string, string> {
    const headers: Record<string, string> = {
      [TEST_PERMISSIONS_HEADER]: (
        options?.permissions || [Permission.ProjectOwner]
      ).join(","),
    };

    if (!options?.apiKey) {
      headers[TEST_USER_HEADER] = userId.toString();
    } else {
      headers[TEST_API_KEY_HEADER] = "1";
    }

    if (options?.tenantId !== null) {
      headers["tenantid"] = (options?.tenantId || projectId).toString();
    }

    if (options?.memberOf) {
      headers[TEST_MEMBER_OF_HEADER] = options.memberOf.toString();
    }

    if (options?.blocked) {
      headers[TEST_BLOCKED_PERMISSIONS_HEADER] = options.blocked.join(",");
    }

    if (options?.labelledBlocked) {
      headers[TEST_LABELLED_BLOCKED_PERMISSIONS_HEADER] =
        options.labelledBlocked.join(",");
    }

    if (options?.readOnly) {
      headers[TEST_READ_ONLY_HEADER] = "1";
    }

    if (options?.masterAdmin) {
      headers[TEST_MASTER_ADMIN_HEADER] = "1";
    }

    if (options?.browser && Object.keys(options.browser).length > 0) {
      headers["cookie"] = cookieHeader(options.browser);
    }

    return headers;
  }

  function get(
    path: string,
    headers?: Record<string, string>,
  ): Promise<ProbeResponse> {
    return httpGet({ port: app.port, path, headers });
  }

  function start(
    options?: Parameters<typeof signedInHeaders>[0],
  ): Promise<ProbeResponse> {
    return get(START, signedInHeaders(options));
  }

  // Starts a connection that is let through; what the browser was handed.
  async function startFlow(
    options?: Parameters<typeof signedInHeaders>[0],
  ): Promise<{ state: string; installUrl: string; browser: Browser }> {
    const response: ProbeResponse = await start(options);

    expect(response.status).toBe(200);

    const installUrl: string = (response.body as JSONObject)[
      "installUrl"
    ] as string;

    // The browser keeps its binding: the one just set, or the one it had.
    const binding: string =
      response.setCookies[COOKIE_NAME] || options?.browser?.[COOKIE_NAME] || "";

    return {
      state: queryOf(installUrl).get("state")!,
      installUrl,
      browser: { [COOKIE_NAME]: binding },
    };
  }

  function callback(
    query: Record<string, string>,
    browser?: Browser,
  ): Promise<ProbeResponse> {
    return get(
      `${CALLBACK}?${new URLSearchParams(query).toString()}`,
      browser && Object.keys(browser).length > 0
        ? { cookie: cookieHeader(browser) }
        : {},
    );
  }

  function connectQuery(
    state: string,
    overrides?: Record<string, string>,
  ): Record<string, string> {
    return {
      state: state,
      installation_id: INSTALLATION_ID,
      code: OAUTH_CODE,
      setup_action: "install",
      ...(overrides || {}),
    };
  }

  function messageOf(response: ProbeResponse): unknown {
    return (response.body as JSONObject | null)?.["message"];
  }

  function expectNoStateIssued(response: ProbeResponse): void {
    expect(mockCacheStore.size).toBe(0);
    expect(response.setCookies[COOKIE_NAME]).toBeUndefined();
  }

  function expectNothingWritten(): void {
    expect(updateProject).not.toHaveBeenCalled();
    expect(importRepositories).not.toHaveBeenCalled();
  }

  function useBilling(plan: PlanType | null): void {
    setTestBillingEnabled(true);
    currentPlan = plan;
  }

  describe("GET /github/install-url: who may start", () => {
    test.each(ROLES_THAT_MAY_CONNECT)(
      "$role may start: the install URL carries a one-use state",
      async (role: Role) => {
        const response: ProbeResponse = await start({
          permissions: role.allow,
        });

        expect(response.status).toBe(200);

        const installUrl: string = (response.body as JSONObject)[
          "installUrl"
        ] as string;

        expect(
          installUrl.startsWith(
            "https://github.com/apps/oneuptime-test-app/installations/new?",
          ),
        ).toBe(true);

        const query: URLSearchParams = queryOf(installUrl);

        expect(query.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(query.get("redirect_uri")).toBe(
          `${HomeClientUrl.toString()}api/github/auth/callback`,
        );
        expect(response.setCookies[COOKIE_NAME]).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(mockCacheStore.size).toBe(1);
      },
    );

    test.each(ROLES_THAT_MAY_NOT_CONNECT)(
      "$role may not start, and is told the one sentence",
      async (role: Role) => {
        const response: ProbeResponse = await start({
          permissions: role.allow,
        });

        // NotAuthorizedException is answered with 422 throughout the API.
        expect(response.status).toBe(422);
        expect(messageOf(response)).toBe(GITHUB_CONNECT_PERMISSION_MESSAGE);
        expectNoStateIssued(response);
      },
    );

    test("the state is recorded for the caller and the project the request names, for this flow only", async () => {
      const { state } = await startFlow();

      expect(state).not.toContain(projectId.toString());
      expect(state).not.toContain(userId.toString());

      const [entry] = Array.from(mockCacheStore.values());
      const record: JSONObject = JSON.parse(entry!.value) as JSONObject;

      expect(record["flow"]).toBe(WorkspaceOAuthFlow.GitHubAppInstall);
      expect(record["projectId"]).toBe(projectId.toString());
      expect(record["userId"]).toBe(userId.toString());
    });

    test("refuses an anonymous caller (401, so the session is refreshed) and issues no state", async () => {
      const response: ProbeResponse = await get(START, {
        tenantid: projectId.toString(),
      });

      expect(response.status).toBe(401);
      expectNoStateIssued(response);
    });

    test("needs the project to be named", async () => {
      const response: ProbeResponse = await start({ tenantId: null });

      expect(response.status).toBe(400);
      expectNoStateIssued(response);
    });

    test("refuses a member of another project, with the same sentence", async () => {
      const response: ProbeResponse = await start({
        memberOf: otherProjectId,
      });

      expect(response.status).toBe(422);
      expect(messageOf(response)).toBe(GITHUB_CONNECT_PERMISSION_MESSAGE);
      expectNoStateIssued(response);
    });

    test("refuses a project API key, whatever it holds: a connection is made by a person", async () => {
      const response: ProbeResponse = await start({
        apiKey: true,
        permissions: [Permission.ProjectOwner],
      });

      expect(response.status).toBe(422);
      expect(messageOf(response)).toBe(GITHUB_CONNECT_PERMISSION_MESSAGE);
      expectNoStateIssued(response);
    });

    test("refuses a credential issued for reading only", async () => {
      const response: ProbeResponse = await start({
        permissions: [Permission.ProjectOwner],
        readOnly: true,
      });

      expect(response.status).toBe(422);
      expect(messageOf(response)).toBe(GITHUB_CONNECT_PERMISSION_MESSAGE);
      expectNoStateIssued(response);
    });

    test.each([
      Permission.CreateCodeRepository,
      Permission.ProjectMember,
      Permission.ProjectOwner,
    ])(
      "a team's block on %s takes it away, whatever else the caller holds",
      async (blocked: Permission) => {
        const response: ProbeResponse = await start({
          permissions: [Permission.ProjectOwner, Permission.ProjectMember],
          blocked: [blocked],
        });

        expect(response.status).toBe(422);
        expect(messageOf(response)).toBe(GITHUB_CONNECT_PERMISSION_MESSAGE);
        expectNoStateIssued(response);
      },
    );

    test("a block row is no grant: blocking a permission nobody granted lets nobody in", async () => {
      const response: ProbeResponse = await start({
        permissions: [Permission.Viewer],
        blocked: [Permission.CreateCodeRepository],
      });

      expect(response.status).toBe(422);
      expectNoStateIssued(response);
    });

    test("a block limited to labels does not stop it, as it does not stop adding a repository by hand", async () => {
      const response: ProbeResponse = await start({
        permissions: [Permission.ProjectMember],
        labelledBlocked: [Permission.CreateCodeRepository],
      });

      expect(response.status).toBe(200);
    });

    test("a server admin who is a member may start, as they may add a repository by hand", async () => {
      const response: ProbeResponse = await start({
        permissions: [Permission.Viewer],
        masterAdmin: true,
      });

      expect(response.status).toBe(200);
    });

    test("a server admin who is not a member of the project may not", async () => {
      const response: ProbeResponse = await start({
        memberOf: otherProjectId,
        masterAdmin: true,
      });

      expect(response.status).toBe(422);
      expectNoStateIssued(response);
    });

    test("two starts in one browser share its binding, and each state is its own", async () => {
      const first: { state: string; browser: Browser } = await startFlow();
      const second: { state: string; browser: Browser } = await startFlow({
        browser: first.browser,
      });

      expect(second.state).not.toBe(first.state);
      expect(second.browser[COOKIE_NAME]).toBe(first.browser[COOKIE_NAME]);
      expect(mockCacheStore.size).toBe(2);
    });

    test("the old navigation route is gone: a connection starts only here", () => {
      expect(routePaths).toEqual(
        expect.arrayContaining([
          "/github/install-url",
          "/github/auth/callback",
        ]),
      );
      expect(routePaths).not.toContain("/github/auth/install");
    });
  });

  describe("GET /github/install-url on OneUptime Cloud", () => {
    test("below the plan code repositories are sold on: refused with the plan's name, no state", async () => {
      useBilling(PlanType.Free);

      const response: ProbeResponse = await start();

      expect(response.status).toBe(402);
      expect(messageOf(response)).toBe(GROWTH_REFUSAL);
      expectNoStateIssued(response);
    });

    test.each([PlanType.Growth, PlanType.Scale, PlanType.Enterprise])(
      "on %s: let through",
      async (plan: PlanType) => {
        useBilling(plan);

        const response: ProbeResponse = await start();

        expect(response.status).toBe(200);
      },
    );

    test("a plan that cannot be read is never read as any plan", async () => {
      useBilling(null);

      const response: ProbeResponse = await start();

      expect(response.status).toBe(422);
      expect(messageOf(response)).toBe(CallerPlan.PLAN_UNKNOWN_MESSAGE);
      expectNoStateIssued(response);
    });

    test("a credential issued for reading only is told the one sentence, before the plan is asked", async () => {
      useBilling(PlanType.Free);

      const response: ProbeResponse = await start({
        permissions: [Permission.ProjectOwner],
        readOnly: true,
      });

      expect(response.status).toBe(422);
      expect(messageOf(response)).toBe(GITHUB_CONNECT_PERMISSION_MESSAGE);
      expectNoStateIssued(response);
    });

    test("a server admin below the plan is refused at the start, as every request to the project holds one to its plan", async () => {
      useBilling(PlanType.Free);

      const response: ProbeResponse = await start({ masterAdmin: true });

      expect(response.status).toBe(402);
      expect(messageOf(response)).toBe(GROWTH_REFUSAL);
      expectNoStateIssued(response);
    });

    test("someone outside the project is told the one sentence, nothing about its plan", async () => {
      useBilling(PlanType.Free);

      const response: ProbeResponse = await start({
        memberOf: otherProjectId,
      });

      expect(response.status).toBe(422);
      expect(messageOf(response)).toBe(GITHUB_CONNECT_PERMISSION_MESSAGE);
    });

    test("without billing, the plan is never read", async () => {
      currentPlan = PlanType.Free;

      const response: ProbeResponse = await start();

      expect(response.status).toBe(200);
      expect(getCurrentPlan).not.toHaveBeenCalled();
    });
  });

  describe("GET /github/auth/callback: the state", () => {
    test("connects the installation to the project and person the state was issued for", async () => {
      const { state, browser } = await startFlow();

      const response: ProbeResponse = await callback(
        connectQuery(state),
        browser,
      );

      expect(response.status).toBe(302);
      expect(response.location).toBe(
        `${DashboardClientUrl.toString()}/${projectId.toString()}/code-repository?installation_id=${INSTALLATION_ID}`,
      );

      expect(verifyInstallation).toHaveBeenCalledTimes(1);
      expect(verifyInstallation.mock.calls[0]![0]).toEqual({
        oauthCode: OAUTH_CODE,
        installationId: INSTALLATION_ID,
      });

      expect(updateProject).toHaveBeenCalledTimes(1);
      const binding: JSONObject = updateProject.mock.calls[0]![0] as JSONObject;
      expect((binding["id"] as ObjectID).toString()).toBe(projectId.toString());
      expect(binding["data"]).toEqual({
        gitHubAppInstallationId: INSTALLATION_ID,
      });

      expect(importRepositories).toHaveBeenCalledTimes(1);
      const imported: JSONObject = importRepositories.mock
        .calls[0]![0] as JSONObject;
      expect((imported["projectId"] as ObjectID).toString()).toBe(
        projectId.toString(),
      );
      expect(imported["installationId"]).toBe(INSTALLATION_ID);
    });

    test("asks whether the person may still connect before GitHub is asked, and both before anything is written", async () => {
      const { state, browser } = await startFlow();

      await callback(connectQuery(state), browser);

      expect(callOrder).toEqual(["member", "verify", "bind", "import"]);
    });

    test("ignores a project or person named in the redirect: the state alone decides", async () => {
      const { state, browser } = await startFlow();

      const response: ProbeResponse = await callback(
        connectQuery(state, {
          projectId: otherProjectId.toString(),
          userId: ObjectID.generate().toString(),
          tenantid: otherProjectId.toString(),
        }),
        browser,
      );

      expect(response.status).toBe(302);
      expect(
        (
          (updateProject.mock.calls[0]![0] as JSONObject)["id"] as ObjectID
        ).toString(),
      ).toBe(projectId.toString());
    });

    test("refuses a callback with no state, and writes nothing", async () => {
      const response: ProbeResponse = await callback({
        installation_id: INSTALLATION_ID,
        code: OAUTH_CODE,
      });

      expect(response.status).toBe(400);
      expect(messageOf(response)).toBe(GITHUB_CONNECT_LINK_MESSAGE);
      expect(verifyInstallation).not.toHaveBeenCalled();
      expectNothingWritten();
    });

    test("refuses a well-formed state OneUptime never issued", async () => {
      const { browser } = await startFlow();

      const response: ProbeResponse = await callback(
        connectQuery(crypto.randomBytes(32).toString("base64url")),
        browser,
      );

      expect(response.status).toBe(400);
      expect(messageOf(response)).toBe(GITHUB_CONNECT_LINK_MESSAGE);
      expect(verifyInstallation).not.toHaveBeenCalled();
      expectNothingWritten();
    });

    test("refuses a state that is not a state at all", async () => {
      const { browser } = await startFlow();

      for (const forged of [
        "",
        "not-a-state",
        `${projectId.toString()}:${userId.toString()}`,
        "eyJhbGciOiJIUzI1NiJ9.eyJwcm9qZWN0SWQiOiJ4In0.c2lnbmF0dXJl",
      ]) {
        const response: ProbeResponse = await callback(
          connectQuery(forged),
          browser,
        );

        expect([forged, response.status]).toEqual([forged, 400]);
      }

      expectNothingWritten();
    });

    test("is single-use: a replayed state is refused, and the installation is connected once", async () => {
      const { state, browser } = await startFlow();

      const first: ProbeResponse = await callback(connectQuery(state), browser);
      const replay: ProbeResponse = await callback(
        connectQuery(state, { installation_id: "777" }),
        browser,
      );

      expect(first.status).toBe(302);
      expect(replay.status).toBe(400);
      expect(messageOf(replay)).toBe(GITHUB_CONNECT_LINK_MESSAGE);
      expect(updateProject).toHaveBeenCalledTimes(1);
      expect(importRepositories).toHaveBeenCalledTimes(1);
    });

    test("refuses a state brought back by a browser that did not start the connection, and burns it", async () => {
      const { state, browser } = await startFlow();

      const withoutCookie: ProbeResponse = await callback(connectQuery(state));

      expect(withoutCookie.status).toBe(400);
      expect(messageOf(withoutCookie)).toBe(GITHUB_CONNECT_LINK_MESSAGE);

      // The state was spent by that first presentation.
      const withCookie: ProbeResponse = await callback(
        connectQuery(state),
        browser,
      );

      expect(withCookie.status).toBe(400);
      expectNothingWritten();
    });

    test("refuses a state brought back with another browser's binding", async () => {
      const first: { state: string; browser: Browser } = await startFlow();
      const second: { state: string; browser: Browser } = await startFlow();

      expect(second.browser[COOKIE_NAME]).not.toBe(first.browser[COOKIE_NAME]);

      const response: ProbeResponse = await callback(
        connectQuery(first.state),
        second.browser,
      );

      expect(response.status).toBe(400);
      expectNothingWritten();
    });

    test("refuses a state issued for another connection (a Slack install)", async () => {
      const cookies: Record<string, string> = {};
      const res: ExpressResponse = {
        cookie: (name: string, value: string): void => {
          cookies[name] = value;
        },
      } as unknown as ExpressResponse;

      const { state } = await WorkspaceOAuthState.create({
        req: {
          cookies: {},
          query: {},
          params: {},
          headers: {},
        } as unknown as ExpressRequest,
        res,
        flow: WorkspaceOAuthFlow.SlackInstall,
        projectId: projectId,
        userId: userId,
      });

      const response: ProbeResponse = await callback(
        connectQuery(state),
        cookies,
      );

      expect(response.status).toBe(400);
      expect(messageOf(response)).toBe(GITHUB_CONNECT_LINK_MESSAGE);
      expect(verifyInstallation).not.toHaveBeenCalled();
      expectNothingWritten();
    });

    test("refuses an expired state", async () => {
      const { state, browser } = await startFlow();

      const later: number =
        Date.now() + (WorkspaceOAuthState.EXPIRES_IN_SECONDS + 1) * 1000;
      jest.spyOn(Date, "now").mockReturnValue(later);

      const response: ProbeResponse = await callback(
        connectQuery(state),
        browser,
      );

      expect(response.status).toBe(400);
      expectNothingWritten();
    });
  });

  describe("GET /github/auth/callback: the person, asked again", () => {
    test("someone who has left the project since starting is refused, before GitHub is asked", async () => {
      const { state, browser } = await startFlow();
      removeAtCallback();

      const response: ProbeResponse = await callback(
        connectQuery(state),
        browser,
      );

      expect(response.status).toBe(422);
      expect(messageOf(response)).toBe(GITHUB_CONNECT_PERMISSION_MESSAGE);
      expect(verifyInstallation).not.toHaveBeenCalled();
      expectNothingWritten();
    });

    test.each(ROLES_THAT_MAY_NOT_CONNECT)(
      "someone who is only $role by the time GitHub sends them back is refused",
      async (role: Role) => {
        const { state, browser } = await startFlow();
        grantAtCallback({ allow: role.allow });

        const response: ProbeResponse = await callback(
          connectQuery(state),
          browser,
        );

        expect(response.status).toBe(422);
        expect(messageOf(response)).toBe(GITHUB_CONNECT_PERMISSION_MESSAGE);
        expect(verifyInstallation).not.toHaveBeenCalled();
        expectNothingWritten();
      },
    );

    test.each(ROLES_THAT_MAY_CONNECT)(
      "someone who is $role at the callback connects",
      async (role: Role) => {
        const { state, browser } = await startFlow();
        grantAtCallback({ allow: role.allow });

        const response: ProbeResponse = await callback(
          connectQuery(state),
          browser,
        );

        expect(response.status).toBe(302);
        expect(updateProject).toHaveBeenCalledTimes(1);
      },
    );

    test("a team's block given since starting refuses it", async () => {
      const { state, browser } = await startFlow();
      grantAtCallback({
        allow: [Permission.ProjectOwner],
        block: [Permission.CreateCodeRepository],
      });

      const response: ProbeResponse = await callback(
        connectQuery(state),
        browser,
      );

      expect(response.status).toBe(422);
      expect(messageOf(response)).toBe(GITHUB_CONNECT_PERMISSION_MESSAGE);
      expectNothingWritten();
    });

    test("a block limited to labels does not refuse it, as at the start", async () => {
      const { state, browser } = await startFlow();
      grantAtCallback({
        allow: [Permission.ProjectMember],
        labelledBlock: [Permission.CreateCodeRepository],
      });

      const response: ProbeResponse = await callback(
        connectQuery(state),
        browser,
      );

      expect(response.status).toBe(302);
    });

    test("a server admin who is still a member connects, as at the start", async () => {
      const { state, browser } = await startFlow({
        permissions: [Permission.Viewer],
        masterAdmin: true,
      });
      grantAtCallback({ allow: [Permission.Viewer] });
      masterAdmins.add(userId.toString());

      const response: ProbeResponse = await callback(
        connectQuery(state),
        browser,
      );

      expect(response.status).toBe(302);
    });

    test("someone who stopped being a server admin since starting is held to their role", async () => {
      const { state, browser } = await startFlow({
        permissions: [Permission.Viewer],
        masterAdmin: true,
      });
      grantAtCallback({ allow: [Permission.Viewer] });

      const response: ProbeResponse = await callback(
        connectQuery(state),
        browser,
      );

      expect(response.status).toBe(422);
      expectNothingWritten();
    });

    test("a check that fails is answered plainly, never with what failed, before GitHub is asked", async () => {
      const { state, browser } = await startFlow();
      (
        WorkspaceActionAuthorization.getProjectMemberProps as unknown as jest.Mock
      ).mockImplementationOnce(async () => {
        throw new Error('relation "TeamMember" does not exist');
      });

      const response: ProbeResponse = await callback(
        connectQuery(state),
        browser,
      );

      expect(response.status).toBe(500);
      expect(messageOf(response)).toBe(GITHUB_CONNECT_FAILED_MESSAGE);
      expect(JSON.stringify(response.body)).not.toContain("TeamMember");
      expect(verifyInstallation).not.toHaveBeenCalled();
      expectNothingWritten();
    });

    test("the person and project are the state's, for the membership read too", async () => {
      const { state, browser } = await startFlow();

      await callback(connectQuery(state), browser);

      const read: { userId: ObjectID; projectId: ObjectID } = (
        WorkspaceActionAuthorization.getProjectMemberProps as unknown as jest.Mock
      ).mock.calls[0]![0] as { userId: ObjectID; projectId: ObjectID };

      expect(read.userId.toString()).toBe(userId.toString());
      expect(read.projectId.toString()).toBe(projectId.toString());
    });
  });

  describe("GET /github/auth/callback on OneUptime Cloud", () => {
    test("a project that dropped below the plan since starting is refused with the plan's name", async () => {
      useBilling(PlanType.Growth);
      const { state, browser } = await startFlow();
      currentPlan = PlanType.Free;

      const response: ProbeResponse = await callback(
        connectQuery(state),
        browser,
      );

      expect(response.status).toBe(402);
      expect(messageOf(response)).toBe(GROWTH_REFUSAL);
      expect(verifyInstallation).not.toHaveBeenCalled();
      expectNothingWritten();
    });

    test("a plan that cannot be read at the callback is never read as any plan", async () => {
      useBilling(PlanType.Growth);
      const { state, browser } = await startFlow();
      currentPlan = null;

      const response: ProbeResponse = await callback(
        connectQuery(state),
        browser,
      );

      expect(response.status).toBe(422);
      expect(messageOf(response)).toBe(CallerPlan.PLAN_UNKNOWN_MESSAGE);
      expectNothingWritten();
    });

    test("a server admin is held to no plan at the callback, as adding a repository by hand holds none", async () => {
      useBilling(PlanType.Growth);
      const { state, browser } = await startFlow({ masterAdmin: true });
      masterAdmins.add(userId.toString());
      currentPlan = PlanType.Free;
      getCurrentPlan.mockClear();

      const response: ProbeResponse = await callback(
        connectQuery(state),
        browser,
      );

      expect(response.status).toBe(302);
      expect(getCurrentPlan).not.toHaveBeenCalled();
      expect(updateProject).toHaveBeenCalledTimes(1);
    });

    test("someone who stopped being a server admin since starting is held to the plan again", async () => {
      useBilling(PlanType.Growth);
      const { state, browser } = await startFlow({ masterAdmin: true });
      currentPlan = PlanType.Free;

      const response: ProbeResponse = await callback(
        connectQuery(state),
        browser,
      );

      expect(response.status).toBe(402);
      expect(messageOf(response)).toBe(GROWTH_REFUSAL);
      expectNothingWritten();
    });

    test("on the plan, it connects", async () => {
      useBilling(PlanType.Scale);
      const { state, browser } = await startFlow();

      const response: ProbeResponse = await callback(
        connectQuery(state),
        browser,
      );

      expect(response.status).toBe(302);
      expect(updateProject).toHaveBeenCalledTimes(1);
    });
  });

  describe("GET /github/auth/callback: what GitHub returns", () => {
    test("refuses a redirect without an installation, and writes nothing", async () => {
      const { state, browser } = await startFlow();
      const query: Record<string, string> = connectQuery(state);
      delete query["installation_id"];

      const response: ProbeResponse = await callback(query, browser);

      expect(response.status).toBe(400);
      expect(verifyInstallation).not.toHaveBeenCalled();
      expectNothingWritten();
    });

    test("refuses a redirect without an authorization code, and writes nothing", async () => {
      const { state, browser } = await startFlow();
      const query: Record<string, string> = connectQuery(state);
      delete query["code"];

      const response: ProbeResponse = await callback(query, browser);

      expect(response.status).toBe(400);
      expect(verifyInstallation).not.toHaveBeenCalled();
      expectNothingWritten();
    });

    test("refuses an installation GitHub does not confirm, and writes nothing", async () => {
      const { state, browser } = await startFlow();
      verifyInstallation.mockImplementation(async () => {
        throw new Error("The GitHub account does not administer it.");
      });

      const response: ProbeResponse = await callback(
        connectQuery(state),
        browser,
      );

      expect(response.status).toBe(400);
      expectNothingWritten();
    });

    test("a binding that cannot be written is answered plainly, never with what failed, and imports nothing", async () => {
      const { state, browser } = await startFlow();
      updateProject.mockImplementation(async () => {
        throw new Error(
          'duplicate key value violates unique constraint "Project_pkey"',
        );
      });

      const response: ProbeResponse = await callback(
        connectQuery(state),
        browser,
      );

      expect(response.status).toBe(500);
      expect(messageOf(response)).toBe(GITHUB_CONNECT_FAILED_MESSAGE);
      expect(JSON.stringify(response.body)).not.toContain("Project_pkey");
      expect(importRepositories).not.toHaveBeenCalled();
    });

    test("still sends the browser back when the import fails: the webhooks retry it", async () => {
      const { state, browser } = await startFlow();
      importRepositories.mockImplementation(async () => {
        throw new Error("GitHub is unavailable");
      });

      const response: ProbeResponse = await callback(
        connectQuery(state),
        browser,
      );

      expect(response.status).toBe(302);
      expect(updateProject).toHaveBeenCalledTimes(1);
    });
  });
});
