import { mockRouter } from "./Helpers";

let mockIsBillingEnabled: boolean = false;

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = {
    ...actual,
    __esModule: true,
  };

  Object.defineProperty(mocked, "IsBillingEnabled", {
    get: (): boolean => {
      return mockIsBillingEnabled;
    },
  });

  return mocked;
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

import CommonAPI from "../../../Server/API/CommonAPI";
import TelemetryUsageAPI, {
  canReadProjectTelemetryUsage,
  canReadProjectTelemetryUsageCost,
  TELEMETRY_USAGE_READ_REFUSAL,
} from "../../../Server/API/TelemetryUsageAPI";
import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ProjectService from "../../../Server/Services/ProjectService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import TelemetryUsageReads from "../../../Server/Utils/TelemetryUsage/TelemetryUsageReads";
import TelemetryUsageBilling from "../../../Models/DatabaseModels/TelemetryUsageBilling";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  TELEMETRY_USAGE_ADMIN_PROJECTS_ROUTE,
  TELEMETRY_USAGE_PROJECT_ROUTE,
} from "../../../Types/Telemetry/TelemetryUsage";
import UserType from "../../../Types/UserType";
import {
  PROJECT_TELEMETRY_USAGE_READ_PERMISSIONS,
  PROJECT_USAGE_READ_PERMISSIONS,
} from "../../../Utils/Project/ProjectBilling";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * GET /telemetry-usage/project and the instance admin's
 * /telemetry-usage/admin/projects[/:projectId] (issue #5916), run through
 * their real guards and handlers; only the reads behind them are answered
 * here.
 *
 *   - Usage is read by whoever reads the project's telemetry over the whole
 *     project, or a billing role - with billing on or off.
 *   - What it cost is in the answer only where billing is on, and only for
 *     whoever reads billing.
 *   - The admin routes are the master admin's, behind its middleware.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const LABEL_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

interface RegisteredRoute {
  method: string;
  uri: string;
  middlewares: Array<RouterFunction>;
  handlerFunction: RouterFunction;
}

function row(
  permission: Permission,
  extra?: Partial<UserPermission>,
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    ...extra,
  } as UserPermission;
}

function memberProps(
  rows: Array<UserPermission>,
  overrides?: Partial<DatabaseCommonInteractionProps>,
): DatabaseCommonInteractionProps {
  const tenant: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: rows,
  };

  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    userTenantAccessPermission: { [PROJECT_ID.toString()]: tenant },
    ...overrides,
  };
}

function routeFor(uri: string): RegisteredRoute {
  const route: RegisteredRoute | undefined = (
    mockRouter.routes as unknown as Array<RegisteredRoute>
  ).find((candidate: RegisteredRoute): boolean => {
    return candidate.method === "GET" && candidate.uri === uri;
  });

  if (!route) {
    throw new Error(`No GET route for ${uri}`);
  }

  return route;
}

const ADMIN_PROJECT_ROUTE: string = `${TELEMETRY_USAGE_ADMIN_PROJECTS_ROUTE}/:projectId`;

let props: DatabaseCommonInteractionProps;
let getProjectUsage: jest.SpyInstance;
let getUsageByProject: jest.SpyInstance;
let sendJson: jest.SpyInstance;

beforeEach(() => {
  mockIsBillingEnabled = false;
  props = memberProps([row(Permission.ProjectMember)]);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });

  getProjectUsage = jest
    .spyOn(TelemetryUsageReads, "getProjectUsage")
    .mockResolvedValue({ days: [] } as never);
  getUsageByProject = jest
    .spyOn(TelemetryUsageReads, "getUsageByProject")
    .mockResolvedValue({ projects: [] } as never);
  sendJson = jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation((() => {}) as never);
});

afterEach(() => {
  mockIsBillingEnabled = false;
  jest.restoreAllMocks();
});

async function call(
  uri: string,
  query: Record<string, string>,
  params?: Record<string, string>,
): Promise<unknown> {
  const next: jest.Mock = jest.fn();

  await routeFor(uri).handlerFunction(
    { query: query, params: params || {}, headers: {} } as never,
    {} as never,
    next as unknown as NextFunction,
  );

  return next.mock.calls[0]?.[0];
}

const RANGE: Record<string, string> = {
  startDay: "2026-10-01",
  endDay: "2026-10-30",
};

describe("the routes", () => {
  test("are mounted from one bare router: the project's, and the admin's two", () => {
    expect(TelemetryUsageAPI).toBe(mockRouter);
    expect(routeFor(TELEMETRY_USAGE_PROJECT_ROUTE)).toBeDefined();
    expect(routeFor(TELEMETRY_USAGE_ADMIN_PROJECTS_ROUTE)).toBeDefined();
    expect(routeFor(ADMIN_PROJECT_ROUTE)).toBeDefined();
    expect(TELEMETRY_USAGE_PROJECT_ROUTE).toBe("/telemetry-usage/project");
  });

  test("ask who the caller is first: a session that expired is a 401, to be refreshed", () => {
    expect(routeFor(TELEMETRY_USAGE_PROJECT_ROUTE).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
  });

  test("keep the instance-wide reads to master admins", () => {
    for (const uri of [
      TELEMETRY_USAGE_ADMIN_PROJECTS_ROUTE,
      ADMIN_PROJECT_ROUTE,
    ]) {
      expect(routeFor(uri).middlewares).toEqual([
        MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      ]);
    }
  });
});

describe("GET /telemetry-usage/project", () => {
  test("answers a project member with the project's usage of the range, without its cost where billing is off", async () => {
    expect(await call(TELEMETRY_USAGE_PROJECT_ROUTE, RANGE)).toBeUndefined();

    expect(getProjectUsage).toHaveBeenCalledTimes(1);
    expect(getProjectUsage.mock.calls[0]![0]).toEqual({
      projectId: PROJECT_ID,
      window: {
        start: new Date("2026-10-01T00:00:00.000Z"),
        end: new Date("2026-10-31T00:00:00.000Z"),
        days: 30,
      },
      isCostIncluded: false,
      nameProps: props,
    });
    expect(sendJson).toHaveBeenCalledTimes(1);
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.TelemetryAdmin,
    Permission.TelemetryMember,
    Permission.TelemetryViewer,
    Permission.ManageProjectBilling,
    Permission.BillingAdmin,
    Permission.BillingMember,
    Permission.BillingViewer,
  ])("is read by %s", async (permission: Permission) => {
    props = memberProps([row(permission)]);

    expect(await call(TELEMETRY_USAGE_PROJECT_ROUTE, RANGE)).toBeUndefined();
    expect(getProjectUsage).toHaveBeenCalledTimes(1);
  });

  test.each([
    Permission.IncidentMember,
    Permission.StatusPageAdmin,
    Permission.ReadTelemetryServiceLog,
  ])("is refused to %s, which reads none of the project's telemetry usage", async (
    permission: Permission,
  ) => {
    props = memberProps([row(permission)]);

    const thrown: unknown = await call(TELEMETRY_USAGE_PROJECT_ROUTE, RANGE);

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect((thrown as Error).message).toBe(TELEMETRY_USAGE_READ_REFUSAL);
    expect(getProjectUsage).not.toHaveBeenCalled();
  });

  test("is refused to a role limited to some labels: the answer is about the whole project", async () => {
    props = memberProps([
      row(Permission.TelemetryViewer, { labelIds: [LABEL_ID] }),
    ]);

    expect(await call(TELEMETRY_USAGE_PROJECT_ROUTE, RANGE)).toBeInstanceOf(
      NotAuthorizedException,
    );
    expect(getProjectUsage).not.toHaveBeenCalled();
  });

  test("is refused when a team blocks the role that would read it", async () => {
    props = memberProps([
      row(Permission.ProjectMember),
      row(Permission.ProjectMember, { isBlockPermission: true }),
    ]);

    expect(await call(TELEMETRY_USAGE_PROJECT_ROUTE, RANGE)).toBeInstanceOf(
      NotAuthorizedException,
    );
  });

  test("is refused to a caller whose rows are another project's", async () => {
    props = memberProps([row(Permission.ProjectOwner)], {
      tenantId: OTHER_PROJECT_ID,
    });

    expect(await call(TELEMETRY_USAGE_PROJECT_ROUTE, RANGE)).toBeInstanceOf(
      NotAuthorizedException,
    );
    expect(getProjectUsage).not.toHaveBeenCalled();
  });

  test("asks a caller with no credentials to sign in again (401)", async () => {
    props = {
      tenantId: PROJECT_ID,
      userType: UserType.Public,
    };

    const thrown: unknown = await call(TELEMETRY_USAGE_PROJECT_ROUTE, RANGE);

    expect(thrown).toBeInstanceOf(NotAuthenticatedException);
    expect(getProjectUsage).not.toHaveBeenCalled();
  });

  test("answers a project API key with a reading role, for automation", async () => {
    props = memberProps([row(Permission.ProjectAdmin)], {
      userId: undefined,
      userType: UserType.API,
    });

    expect(await call(TELEMETRY_USAGE_PROJECT_ROUTE, RANGE)).toBeUndefined();
    expect(getProjectUsage).toHaveBeenCalledTimes(1);
  });

  test("answers a master admin, for any project", async () => {
    props = {
      tenantId: PROJECT_ID,
      userId: USER_ID,
      userType: UserType.MasterAdmin,
      isMasterAdmin: true,
    };

    expect(await call(TELEMETRY_USAGE_PROJECT_ROUTE, RANGE)).toBeUndefined();
    expect(getProjectUsage.mock.calls[0]![0].isCostIncluded).toBe(false);
  });

  test.each([
    [Permission.ProjectOwner, true],
    [Permission.ProjectAdmin, true],
    [Permission.ManageProjectBilling, true],
    [Permission.BillingAdmin, true],
    [Permission.BillingMember, true],
    [Permission.BillingViewer, true],
    [Permission.ProjectMember, false],
    [Permission.Viewer, false],
    [Permission.TelemetryAdmin, false],
    [Permission.TelemetryViewer, false],
  ])(
    "with billing on, says what usage cost to %s: %s",
    async (permission: Permission, isCostIncluded: boolean) => {
      mockIsBillingEnabled = true;
      props = memberProps([row(permission)]);

      expect(await call(TELEMETRY_USAGE_PROJECT_ROUTE, RANGE)).toBeUndefined();
      expect(getProjectUsage.mock.calls[0]![0].isCostIncluded).toBe(
        isCostIncluded,
      );
    },
  );

  test("never says what usage cost where billing is off, even to an owner", async () => {
    props = memberProps([row(Permission.ProjectOwner)]);

    await call(TELEMETRY_USAGE_PROJECT_ROUTE, RANGE);

    expect(getProjectUsage.mock.calls[0]![0].isCostIncluded).toBe(false);
  });

  test.each([
    [{}, "startDay and endDay are required, as days written YYYY-MM-DD."],
    [
      { startDay: "2026-10-30", endDay: "2026-10-01" },
      "startDay must not be after endDay.",
    ],
    [
      { startDay: "2020-01-01", endDay: "2026-10-01" },
      "A range can be at most 1095 days long.",
    ],
    [
      { startDay: "2026-10-01", endDay: "2026-10-01' OR 1=1" },
      "startDay and endDay are required, as days written YYYY-MM-DD.",
    ],
  ])(
    "refuses a range that is not one: %j",
    async (query: Record<string, string>, message: string) => {
      props = memberProps([row(Permission.ProjectOwner)]);

      const thrown: unknown = await call(TELEMETRY_USAGE_PROJECT_ROUTE, query);

      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as Error).message).toBe(message);
      expect(getProjectUsage).not.toHaveBeenCalled();
    },
  );
});

describe("who reads usage, and its cost", () => {
  test("usage: the model's own read list, which is every telemetry reader and every cost reader", () => {
    expect([...PROJECT_TELEMETRY_USAGE_READ_PERMISSIONS].sort()).toEqual(
      [...new TelemetryUsageBilling().getReadPermissions()].sort(),
    );

    for (const permission of PROJECT_TELEMETRY_USAGE_READ_PERMISSIONS) {
      expect({
        permission,
        reads: canReadProjectTelemetryUsage(memberProps([row(permission)])),
      }).toEqual({ permission, reads: true });
    }
  });

  test("cost: only where billing is on, and only to who reads the cost column", () => {
    const costReaders: Array<Permission> = [
      ...(new TelemetryUsageBilling().getColumnAccessControlForAllColumns()[
        "totalCostInUSD"
      ]?.read || []),
    ];

    expect([...costReaders].sort()).toEqual(
      [...PROJECT_USAGE_READ_PERMISSIONS].sort(),
    );

    for (const permission of PROJECT_TELEMETRY_USAGE_READ_PERMISSIONS) {
      const caller: DatabaseCommonInteractionProps = memberProps([
        row(permission),
      ]);

      mockIsBillingEnabled = false;
      expect(canReadProjectTelemetryUsageCost(caller)).toBe(false);

      mockIsBillingEnabled = true;
      expect({
        permission,
        readsCost: canReadProjectTelemetryUsageCost(caller),
      }).toEqual({
        permission,
        readsCost: PROJECT_USAGE_READ_PERMISSIONS.includes(permission),
      });
    }
  });
});

describe("GET /telemetry-usage/admin/projects", () => {
  test("reads every project's usage, heaviest first by default, 50 a page", async () => {
    expect(
      await call(TELEMETRY_USAGE_ADMIN_PROJECTS_ROUTE, RANGE),
    ).toBeUndefined();

    expect(getUsageByProject.mock.calls[0]![0]).toEqual({
      window: {
        start: new Date("2026-10-01T00:00:00.000Z"),
        end: new Date("2026-10-31T00:00:00.000Z"),
        days: 30,
      },
      isCostIncluded: false,
      sortBy: "total",
      sortOrder: "desc",
      skip: 0,
      limit: 50,
    });
  });

  test("says what usage cost where billing is on", async () => {
    mockIsBillingEnabled = true;

    await call(TELEMETRY_USAGE_ADMIN_PROJECTS_ROUTE, RANGE);

    expect(getUsageByProject.mock.calls[0]![0].isCostIncluded).toBe(true);
  });

  test("sorts by the name A to Z, and by a signal or the total heaviest first, unless told otherwise", async () => {
    await call(TELEMETRY_USAGE_ADMIN_PROJECTS_ROUTE, {
      ...RANGE,
      sortBy: "name",
    });
    await call(TELEMETRY_USAGE_ADMIN_PROJECTS_ROUTE, {
      ...RANGE,
      sortBy: ProductType.Logs,
      sortOrder: "asc",
      skip: "50",
      limit: "500",
    });

    expect(getUsageByProject.mock.calls[0]![0]).toEqual(
      expect.objectContaining({ sortBy: "name", sortOrder: "asc" }),
    );
    expect(getUsageByProject.mock.calls[1]![0]).toEqual(
      expect.objectContaining({
        sortBy: ProductType.Logs,
        sortOrder: "asc",
        skip: 50,
        limit: 500,
      }),
    );
  });

  test.each([
    [{ sortBy: "cost" }],
    [{ sortBy: ProductType.ActiveMonitoring }],
    [{ sortOrder: "up" }],
    [{ limit: "0" }],
    [{ limit: "501" }],
    [{ limit: "ten" }],
    [{ skip: "-1" }],
    [{ skip: "1.5" }],
  ])("refuses %j", async (extra: Record<string, string>) => {
    const thrown: unknown = await call(TELEMETRY_USAGE_ADMIN_PROJECTS_ROUTE, {
      ...RANGE,
      ...extra,
    });

    expect(thrown).toBeInstanceOf(BadDataException);
    expect(getUsageByProject).not.toHaveBeenCalled();
  });
});

describe("GET /telemetry-usage/admin/projects/:projectId", () => {
  test("reads any one project's usage as root, with its cost where billing is on", async () => {
    mockIsBillingEnabled = true;
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(
        Object.assign(new Project(), { _id: PROJECT_ID.toString() }) as never,
      );

    expect(
      await call(ADMIN_PROJECT_ROUTE, RANGE, {
        projectId: PROJECT_ID.toString(),
      }),
    ).toBeUndefined();

    expect(getProjectUsage.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        isCostIncluded: true,
        nameProps: { isRoot: true },
      }),
    );
    expect(getProjectUsage.mock.calls[0]![0].projectId.toString()).toBe(
      PROJECT_ID.toString(),
    );
  });

  test("says when the project does not exist", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(null as never);

    expect(
      await call(ADMIN_PROJECT_ROUTE, RANGE, {
        projectId: PROJECT_ID.toString(),
      }),
    ).toBeInstanceOf(NotFoundException);
    expect(getProjectUsage).not.toHaveBeenCalled();
  });

  test("refuses an id that is not one", async () => {
    expect(
      await call(ADMIN_PROJECT_ROUTE, RANGE, { projectId: "../users" }),
    ).toBeInstanceOf(BadDataException);
  });
});
