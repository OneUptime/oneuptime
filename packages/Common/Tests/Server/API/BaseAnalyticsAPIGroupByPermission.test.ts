import "../TestingUtils/Init";
import BaseAnalyticsAPI from "../../../Server/API/BaseAnalyticsAPI";
import AnalyticsDatabaseService from "../../../Server/Services/AnalyticsDatabaseService";
import ProjectService from "../../../Server/Services/ProjectService";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import { getJestSpyOn } from "../../Spy";
import ColumnRefusalMessage from "../../../Server/Types/Database/Permissions/ColumnRefusalMessage";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Log from "../../../Models/AnalyticsModels/Log";
import { mockRouter } from "./Helpers";
import Dictionary from "../../../Types/Dictionary";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * POST /<telemetry>/get-list with a `groupBy`: the list returns the columns
 * it groups by in place of its select, so a member is refused a group by of
 * a column they may not read exactly as they are refused a select of it
 * (422, the select's refusal) - in one project and across their projects.
 * The read check is the real one; only ClickHouse is answered here.
 */

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();

const RETENTION_DATE_REFUSAL: string = ColumnRefusalMessage.getSelectRefusal({
  column: "retentionDate",
  permissions: [],
});

type CallResult = {
  thrownToNext: unknown;
};

function memberOf(projectId: ObjectID): UserTenantAccessPermission {
  return {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectMember,
        labelIds: [],
        isBlockPermission: false,
      } as UserPermission,
    ],
  };
}

// The request as getUserMiddleware leaves it for a logged-in member.
function buildMemberRequest(data: {
  body: JSONObject;
  isAcrossProjects?: boolean | undefined;
}): ExpressRequest {
  const tenantPermissions: Dictionary<UserTenantAccessPermission> = {
    [PROJECT_ID.toString()]: memberOf(PROJECT_ID),
    [OTHER_PROJECT_ID.toString()]: memberOf(OTHER_PROJECT_ID),
  };

  return {
    params: {},
    query: {},
    headers: data.isAcrossProjects
      ? { "is-multi-tenant-query": "true" }
      : { tenantid: PROJECT_ID.toString() },
    body: data.body,
    tenantId: data.isAcrossProjects ? undefined : PROJECT_ID,
    userType: UserType.User,
    userAuthorization: {
      userId: ObjectID.generate(),
      email: "member@example.com",
      name: "Member",
      isMasterAdmin: false,
    },
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID, OTHER_PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
    },
    userTenantAccessPermission: tenantPermissions,
    userTeamIds: [],
  } as unknown as ExpressRequest;
}

async function callListRoute(req: ExpressRequest): Promise<CallResult> {
  const res: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
    "POST",
    "/logs/get-list",
  );

  let thrownToNext: unknown = undefined;

  await route.handlerFunction(req, res, ((err?: unknown) => {
    thrownToNext = err;
  }) as NextFunction);

  return { thrownToNext };
}

describe("BaseAnalyticsAPI list group by permissions", () => {
  let statements: Array<Statement>;
  let rows: Array<JSONObject>;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockRouter.routes = [];
    /*
     * CI runs these with billing on (packages/Common/test-setup.sh), and a read
     * then first asks the project's plan (CallerPlan, through
     * ProjectService.getCurrentPlan) from Postgres, which these suites never
     * start: every read failed "Database not connected" before it reached a
     * column check. The project is on the plan that gates nothing, so only the
     * permissions these suites are about decide, with billing on or off.
     */
    getJestSpyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Enterprise,
      isSubscriptionUnpaid: false,
    });
    getJestSpyOn(ProjectService, "updateLastActive").mockResolvedValue(
      undefined,
    );

    const logService: AnalyticsDatabaseService<Log> =
      new AnalyticsDatabaseService<Log>({ modelType: Log });

    new BaseAnalyticsAPI<Log, AnalyticsDatabaseService<Log>>(Log, logService);

    statements = [];
    rows = [];

    jest
      .spyOn(logService, "executeQuery")
      .mockImplementation((statement: Statement | string) => {
        statements.push(statement as Statement);

        return Promise.resolve({
          json: () => {
            return Promise.resolve({ data: rows });
          },
        } as never);
      });
  });

  test("a member is refused a list grouped by a column they may not read, with the refusal a select gets", async () => {
    rows = [{ retentionDate: "2026-12-01" }];

    const result: CallResult = await callListRoute(
      buildMemberRequest({
        body: { query: {}, groupBy: { retentionDate: true } },
      }),
    );

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as NotAuthorizedException).code).toBe(422);
    expect((result.thrownToNext as NotAuthorizedException).message).toBe(
      RETENTION_DATE_REFUSAL,
    );
    expect(statements).toHaveLength(0);
    expect(Response.sendEntityArrayResponse).not.toHaveBeenCalled();
  });

  test("the refusal is the one a select of the same column gets", async () => {
    const selected: CallResult = await callListRoute(
      buildMemberRequest({
        body: { query: {}, select: { retentionDate: true } },
      }),
    );

    const grouped: CallResult = await callListRoute(
      buildMemberRequest({
        body: { query: {}, groupBy: { retentionDate: true } },
      }),
    );

    expect(selected.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((grouped.thrownToNext as NotAuthorizedException).message).toBe(
      (selected.thrownToNext as NotAuthorizedException).message,
    );
  });

  test("a member is refused it across their projects too", async () => {
    const result: CallResult = await callListRoute(
      buildMemberRequest({
        body: { query: {}, groupBy: { retentionDate: true } },
        isAcrossProjects: true,
      }),
    );

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as NotAuthorizedException).message).toBe(
      RETENTION_DATE_REFUSAL,
    );
    expect(statements).toHaveLength(0);
  });

  test("a member gets a list grouped by a column they may read", async () => {
    rows = [{ severityText: "Error" }, { severityText: "Info" }];

    const result: CallResult = await callListRoute(
      buildMemberRequest({
        body: { query: {}, groupBy: { severityText: true } },
      }),
    );

    expect(result.thrownToNext).toBeUndefined();
    expect(statements).toHaveLength(1);

    const sendEntityArrayResponse: jest.Mock =
      Response.sendEntityArrayResponse as unknown as jest.Mock;
    expect(sendEntityArrayResponse).toHaveBeenCalledTimes(1);

    const list: Array<Log> = sendEntityArrayResponse.mock
      .calls[0]![2] as Array<Log>;
    expect(
      list.map((log: Log): string | undefined => {
        return log.severityText;
      }),
    ).toEqual(["Error", "Info"]);
  });
});
