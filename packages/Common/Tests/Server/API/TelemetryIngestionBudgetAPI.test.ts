import { mockRouter } from "./Helpers";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

import CommonAPI from "../../../Server/API/CommonAPI";
import TelemetryIngestionBudgetAPI, {
  TELEMETRY_INGESTION_BUDGET_READ_REFUSAL,
} from "../../../Server/API/TelemetryIngestionBudgetAPI";
import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ProjectService from "../../../Server/Services/ProjectService";
import { NextFunction } from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import TelemetryIngestionBudgetStatusReader from "../../../Server/Utils/Telemetry/TelemetryIngestionBudgetStatusReader";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  TELEMETRY_INGESTION_BUDGET_ADMIN_PROJECTS_ROUTE,
  TELEMETRY_INGESTION_BUDGET_PROJECT_ROUTE,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Who may read a project's ingestion budgets (issue #5917): whoever reads its
 * telemetry usage - the budgets limit the usage they are shown beside - and a
 * master admin for any project. Writing them is the models' own routes', and
 * their column permissions keep a project's own budget to master admins
 * (ProjectIngestionBudgetPermissions.test.ts).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111181",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999981",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222281");
const LABEL_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333381");

type RouterFunction = (
  req: unknown,
  res: unknown,
  next: NextFunction,
) => void | Promise<void>;

interface RegisteredRoute {
  method: string;
  uri: string;
  middlewares: Array<RouterFunction>;
  handlerFunction: RouterFunction;
}

const row: (
  permission: Permission,
  extra?: Partial<UserPermission>,
) => UserPermission = (
  permission: Permission,
  extra?: Partial<UserPermission>,
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    ...extra,
  } as UserPermission;
};

const memberProps: (
  rows: Array<UserPermission>,
  overrides?: Partial<DatabaseCommonInteractionProps>,
) => DatabaseCommonInteractionProps = (
  rows: Array<UserPermission>,
  overrides?: Partial<DatabaseCommonInteractionProps>,
): DatabaseCommonInteractionProps => {
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
};

const routeFor: (uri: string) => RegisteredRoute = (
  uri: string,
): RegisteredRoute => {
  const route: RegisteredRoute | undefined = (
    mockRouter.routes as unknown as Array<RegisteredRoute>
  ).find((candidate: RegisteredRoute): boolean => {
    return candidate.method === "GET" && candidate.uri === uri;
  });

  if (!route) {
    throw new Error(`No GET route for ${uri}`);
  }

  return route;
};

const ADMIN_PROJECT_ROUTE: string = `${TELEMETRY_INGESTION_BUDGET_ADMIN_PROJECTS_ROUTE}/:projectId`;

let props: DatabaseCommonInteractionProps;
let getProjectStatus: jest.SpyInstance;
let sendJson: jest.SpyInstance;

beforeEach(() => {
  props = memberProps([row(Permission.ProjectMember)]);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });

  getProjectStatus = jest
    .spyOn(TelemetryIngestionBudgetStatusReader, "getProjectStatus")
    .mockResolvedValue({ project: { signals: [] } } as never);
  sendJson = jest
    .spyOn(Response, "sendJsonObjectResponse")
    .mockImplementation((() => {}) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const call: (uri: string, params?: Record<string, string>) => Promise<unknown> =
  async (uri: string, params?: Record<string, string>): Promise<unknown> => {
    const next: jest.Mock = jest.fn();

    await routeFor(uri).handlerFunction(
      { query: {}, params: params || {}, headers: {} },
      {},
      next as unknown as NextFunction,
    );

    return next.mock.calls[0]?.[0];
  };

describe("the routes", () => {
  test("are one bare router: the project's read, and the admin's", () => {
    expect(TelemetryIngestionBudgetAPI).toBe(mockRouter);
    expect(TELEMETRY_INGESTION_BUDGET_PROJECT_ROUTE).toBe(
      "/telemetry-ingestion-budget/project",
    );
    expect(routeFor(TELEMETRY_INGESTION_BUDGET_PROJECT_ROUTE).middlewares).toEqual(
      [UserMiddleware.getUserMiddleware, UserMiddleware.requireUserAuthentication],
    );
    expect(routeFor(ADMIN_PROJECT_ROUTE).middlewares).toEqual([
      MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
    ]);
  });
});

describe("GET /telemetry-ingestion-budget/project", () => {
  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.ProjectMember,
    Permission.Viewer,
    Permission.TelemetryAdmin,
    Permission.TelemetryMember,
    Permission.TelemetryViewer,
    Permission.BillingAdmin,
  ])("is read by %s, for the caller's own project", async (permission: Permission) => {
    props = memberProps([row(permission)]);

    expect(await call(TELEMETRY_INGESTION_BUDGET_PROJECT_ROUTE)).toBeUndefined();
    expect(getProjectStatus).toHaveBeenCalledWith({ projectId: PROJECT_ID });
    expect(sendJson).toHaveBeenCalledTimes(1);
  });

  test.each([Permission.IncidentMember, Permission.StatusPageAdmin])(
    "is refused to %s, which reads none of the project's telemetry usage",
    async (permission: Permission) => {
      props = memberProps([row(permission)]);

      const thrown: unknown = await call(TELEMETRY_INGESTION_BUDGET_PROJECT_ROUTE);

      expect(thrown).toBeInstanceOf(NotAuthorizedException);
      expect((thrown as Error).message).toBe(
        TELEMETRY_INGESTION_BUDGET_READ_REFUSAL,
      );
      expect(getProjectStatus).not.toHaveBeenCalled();
    },
  );

  test("is refused to a role limited to some labels: the budgets are the whole project's", async () => {
    props = memberProps([
      row(Permission.TelemetryViewer, { labelIds: [LABEL_ID] }),
    ]);

    expect(await call(TELEMETRY_INGESTION_BUDGET_PROJECT_ROUTE)).toBeInstanceOf(
      NotAuthorizedException,
    );
  });

  test("is refused to a caller whose rows are another project's", async () => {
    props = memberProps([row(Permission.ProjectOwner)], {
      tenantId: OTHER_PROJECT_ID,
    });

    expect(await call(TELEMETRY_INGESTION_BUDGET_PROJECT_ROUTE)).toBeInstanceOf(
      NotAuthorizedException,
    );
    expect(getProjectStatus).not.toHaveBeenCalled();
  });

  test("asks a caller with no credentials to sign in again", async () => {
    props = { tenantId: PROJECT_ID, userType: UserType.Public };

    expect(await call(TELEMETRY_INGESTION_BUDGET_PROJECT_ROUTE)).toBeInstanceOf(
      NotAuthenticatedException,
    );
  });

  test("answers a master admin for the project its tenant header names", async () => {
    props = { tenantId: PROJECT_ID, isMasterAdmin: true, userId: USER_ID };

    expect(await call(TELEMETRY_INGESTION_BUDGET_PROJECT_ROUTE)).toBeUndefined();
    expect(getProjectStatus).toHaveBeenCalledWith({ projectId: PROJECT_ID });
  });
});

describe("GET /telemetry-ingestion-budget/admin/projects/:projectId", () => {
  test("answers any project that exists", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue({ id: PROJECT_ID } as unknown as Project);

    expect(
      await call(ADMIN_PROJECT_ROUTE, { projectId: PROJECT_ID.toString() }),
    ).toBeUndefined();
    expect(getProjectStatus).toHaveBeenCalledWith({ projectId: PROJECT_ID });
  });

  test("is a 404 for a project that does not exist, and a 400 for an id that is not one", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(null);

    expect(
      await call(ADMIN_PROJECT_ROUTE, { projectId: PROJECT_ID.toString() }),
    ).toBeInstanceOf(NotFoundException);
    expect(
      await call(ADMIN_PROJECT_ROUTE, { projectId: "not-an-id" }),
    ).toBeInstanceOf(BadDataException);
    expect(getProjectStatus).not.toHaveBeenCalled();
  });
});
