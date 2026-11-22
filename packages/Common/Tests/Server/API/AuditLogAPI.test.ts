import "../TestingUtils/Init";
import { mockRouter } from "./Helpers";
import AuditLogAPI from "../../../Server/API/AuditLogAPI";
import { AuditLogService } from "../../../Server/Services/AuditLogService";
import AuditLogRelatedNames from "../../../Server/Utils/AuditLog/AuditLogRelatedNames";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  AuditLogRelatedRecord,
  AuditLogRelatedRecordState,
  AuditLogRelatedRecords,
} from "../../../Utils/AuditLog/AuditLogRelatedRecords";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

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

/*
 * GET /audit-log/:id/related-record-names (#10470): the names of the
 * records an entry's changes name, for the changes dialog. The route reads
 * nothing of its own: it hands the caller's own permissions - as the
 * request carries them - and its own audit log service to
 * AuditLogRelatedNames, which reads the entry held to them (#10642) and
 * each related table once. Here: what the route takes from the request,
 * what it sends back, and what it refuses.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10470000-0000-4000-8000-000000000101",
);
const USER_ID: ObjectID = new ObjectID("10470000-0000-4000-8000-000000000102");
const ENTRY_ID: string = "10470000-0000-4000-8000-000000000103";
const OPERATIONAL: string = "10470000-0000-4000-8000-000000000104";

function tenantPermission(
  permissions: Array<Permission>,
): UserTenantAccessPermission {
  return {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };
}

// A person's request, as getUserMiddleware leaves it.
function personRequest(id: string): ExpressRequest {
  return {
    params: { id },
    query: {},
    headers: { tenantid: PROJECT_ID.toString() },
    body: {},
    tenantId: PROJECT_ID,
    userType: UserType.User,
    userAuthorization: {
      userId: USER_ID,
      email: "reader@example.com",
      name: "Reader",
      isMasterAdmin: false,
    },
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission([
        Permission.CurrentUser,
        Permission.ProjectUser,
        Permission.ReadAuditLog,
        Permission.MonitorViewer,
      ]),
    },
    userTeamIds: [],
  } as unknown as ExpressRequest;
}

async function call(req: ExpressRequest): Promise<{ thrownToNext: unknown }> {
  const res: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;
  let thrownToNext: unknown = undefined;

  await mockRouter
    .match("get", "/audit-log/:id/related-record-names")
    .handlerFunction(req, res, ((err?: unknown) => {
      thrownToNext = err;
    }) as NextFunction);

  return { thrownToNext };
}

let service: AuditLogService;

beforeEach(() => {
  jest.clearAllMocks();
  mockRouter.routes = [];
  service = new AuditLogService();
  new AuditLogAPI(service);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /audit-log/:id/related-record-names", () => {
  test("is registered beside the audit log's own reads, as a GET that reads no body", () => {
    const routes: Array<{ method: string; uri: string }> =
      mockRouter.routes as unknown as Array<{ method: string; uri: string }>;
    const route: { method: string; uri: string } | undefined = routes.find(
      (registered: { uri: string }): boolean => {
        return registered.uri === "/audit-log/:id/related-record-names";
      },
    );

    expect(route).toBeDefined();
    expect(route!.method).toBe("GET");
    // The audit log's reads are all still there.
    expect(
      routes.some((registered: { method: string; uri: string }): boolean => {
        return (
          registered.method === "POST" &&
          registered.uri === "/audit-log/get-list"
        );
      }),
    ).toBe(true);
  });

  test("reads the names with the caller's own permissions and the API's own service, and sends them back", async () => {
    const records: AuditLogRelatedRecords = new Map<
      string,
      Map<string, AuditLogRelatedRecord>
    >([
      [
        "currentMonitorStatusId",
        new Map<string, AuditLogRelatedRecord>([
          [
            OPERATIONAL,
            { state: AuditLogRelatedRecordState.Named, name: "Operational" },
          ],
        ]),
      ],
    ]);
    const read: ReturnType<typeof jest.fn> = jest.fn();
    jest
      .spyOn(AuditLogRelatedNames, "readForEntry")
      .mockImplementation(async (data: unknown) => {
        read(data);
        return records;
      });

    const { thrownToNext } = await call(personRequest(ENTRY_ID));

    expect(thrownToNext).toBeUndefined();

    const asked: {
      auditLogId: ObjectID;
      props: {
        tenantId?: ObjectID;
        userId?: ObjectID;
        isRoot?: boolean;
        userTenantAccessPermission?: unknown;
      };
      service: AuditLogService;
    } = read.mock.calls[0]![0] as never;

    expect(asked.auditLogId.toString()).toBe(ENTRY_ID);
    expect(asked.service).toBe(service);
    // The caller's props, never OneUptime's.
    expect(asked.props.isRoot).toBeFalsy();
    expect(asked.props.tenantId?.toString()).toBe(PROJECT_ID.toString());
    expect(asked.props.userId?.toString()).toBe(USER_ID.toString());
    expect(asked.props.userTenantAccessPermission).toBeDefined();

    expect(Response.sendJsonObjectResponse).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        fields: {
          currentMonitorStatusId: {
            [OPERATIONAL]: { state: "Named", name: "Operational" },
          },
        },
      },
    );
  });

  test("an id that is no id is refused before anything is read", async () => {
    const readForEntry: ReturnType<typeof jest.spyOn> = jest.spyOn(
      AuditLogRelatedNames,
      "readForEntry",
    );

    const { thrownToNext } = await call(personRequest("not-an-id"));

    expect(thrownToNext).toBeInstanceOf(BadDataException);
    expect(readForEntry).not.toHaveBeenCalled();
  });

  test("an entry the caller may not read is not found, as its own read says", async () => {
    jest.spyOn(service, "findOneById").mockResolvedValue(null);

    const { thrownToNext } = await call(personRequest(ENTRY_ID));

    expect(thrownToNext).toBeInstanceOf(NotFoundException);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
