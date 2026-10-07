import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Who may press a custom domain's Check now, order its certificate or
 * reissue it - for a status page's domains and a dashboard's.
 *
 * All three change the domain: they verify its record, order or replace its
 * certificate and write down what came of it. So they take what editing the
 * domain takes, asked the way an update of the domain asks it
 * (CustomDomainRoutes.getChangeRefusal): one of the domain table's update
 * permissions in the caller's project, no team block on them, and the
 * domain inside the caller's update scope. Reading the domain is not
 * enough: a Viewer or a read-only API key sees its status and the record to
 * add, and the 15-minute checks verify it and order on their own. The Status
 * column's certificates stay a read.
 *
 * The server's own permission layer runs here; only the domain table, the
 * DNS lookup and the certificate authority are stand-ins.
 */

const mockCNameRecord: string = "custom-domains.example.com";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    StatusPageCNameRecord: mockCNameRecord,
    DashboardCNameRecord: mockCNameRecord,
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import StatusPageDomainAPI from "../../../Server/API/StatusPageDomainAPI";
import DashboardDomainAPI from "../../../Server/API/DashboardDomainAPI";
import { DOMAIN_NOT_CHANGEABLE_MESSAGE } from "../../../Server/API/CustomDomainRoutes";
import CommonAPI from "../../../Server/API/CommonAPI";
import StatusPageDomainService from "../../../Server/Services/StatusPageDomainService";
import DashboardDomainService from "../../../Server/Services/DashboardDomainService";
import Response from "../../../Server/Utils/Response";
import CertificateOrder, {
  CertificateOrderOutcome,
} from "../../../Server/Utils/Greenlock/CertificateOrder";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DashboardDomain from "../../../Models/DatabaseModels/DashboardDomain";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import { CustomDomainCertificateStatus } from "../../../Types/CustomDomain/CustomDomainVerification";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { customDomainCaller } from "./CustomDomainCallers";
import { withLabelJoinTables } from "../TestingUtils/LabelJoinTables";

type MockedFn = ReturnType<typeof jest.fn>;

const sendErrorResponseMock: MockedFn =
  Response.sendErrorResponse as unknown as MockedFn;
const sendJsonObjectResponseMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;
const sendEmptySuccessResponseMock: MockedFn =
  Response.sendEmptySuccessResponse as unknown as MockedFn;

type DomainService = typeof StatusPageDomainService;

type Kind = {
  name: string;
  path: string;
  service: DomainService;
  modelType: { new (): BaseModel };
  parentColumn: string;
  readPermission: Permission;
  editPermission: Permission;
  createPermission: Permission;
  deletePermission: Permission;
  // Read-only roles that open the Custom Domains page.
  readOnlyRoles: Array<Permission>;
  // Granted with labels, it narrows which domains the caller may change.
  labelledParentEditPermission: Permission;
  parentRelation: string;
};

const KINDS: Array<[string, Kind]> = [
  [
    "status page domains",
    {
      name: "Status Page Domain",
      path: "/status-page-domain",
      service: StatusPageDomainService,
      modelType: StatusPageDomain,
      parentColumn: "statusPageId",
      readPermission: Permission.ReadStatusPageDomain,
      editPermission: Permission.EditStatusPageDomain,
      createPermission: Permission.CreateStatusPageDomain,
      deletePermission: Permission.DeleteStatusPageDomain,
      readOnlyRoles: [Permission.Viewer, Permission.StatusPageViewer],
      labelledParentEditPermission: Permission.StatusPageMember,
      parentRelation: "statusPage",
    },
  ],
  [
    "dashboard domains",
    {
      name: "Dashboard Domain",
      path: "/dashboard-domain",
      service: DashboardDomainService as unknown as DomainService,
      modelType: DashboardDomain,
      parentColumn: "dashboardId",
      readPermission: Permission.ReadDashboardDomain,
      editPermission: Permission.EditDashboardDomain,
      createPermission: Permission.CreateDashboardDomain,
      deletePermission: Permission.DeleteDashboardDomain,
      readOnlyRoles: [Permission.Viewer, Permission.SettingsViewer],
      labelledParentEditPermission: Permission.EditDashboard,
      parentRelation: "dashboard",
    },
  ],
];

// The three routes that change a domain, and the step each one guards.
type ChangeRoute = {
  route: string;
  // Whether the route went past its access check to the change itself.
  reachedTheChange: (spies: Spies) => boolean;
};

const CHANGE_ROUTES: Array<[string, ChangeRoute]> = [
  [
    "verify-cname (Check now)",
    {
      route: "verify-cname",
      reachedTheChange: (spies: Spies): boolean => {
        return spies.isCnameValid.mock.calls.length > 0;
      },
    },
  ],
  [
    "order-ssl",
    {
      route: "order-ssl",
      reachedTheChange: (spies: Spies): boolean => {
        return spies.orderOnDemand.mock.calls.length > 0;
      },
    },
  ],
  [
    "reissue-ssl",
    {
      route: "reissue-ssl",
      reachedTheChange: (spies: Spies): boolean => {
        return spies.reissueCert.mock.calls.length > 0;
      },
    },
  ],
];

// Every permission a team can grant inside a project.
const GRANTABLE: Array<Permission> = PermissionHelper.getTenantPermissionProps()
  .map((props: PermissionProps) => {
    return props.permission;
  })
  .sort();

const ROLES: Array<Permission> = PermissionHelper.getRolePermissionProps()
  .map((props: PermissionProps) => {
    return props.permission;
  })
  .filter((permission: Permission) => {
    return GRANTABLE.includes(permission);
  });

type Spies = {
  findOneBy: MockedFn;
  findOneById: MockedFn;
  isCnameValid: MockedFn;
  orderCertOnceCnameIsVerified: MockedFn;
  orderCertIfMissing: MockedFn;
  reissueCert: MockedFn;
  orderOnDemand: MockedFn;
};

let domainId: ObjectID;

function stubDomainTable(kind: Kind, data: { inScope?: boolean } = {}): Spies {
  const row: Record<string, unknown> = {
    _id: domainId.toString(),
    id: domainId,
    fullDomain: "custom.acme.com",
    cnameVerificationToken: "token",
    isCnameVerified: true,
    isSslProvisioned: false,
    isSslOrdered: false,
    isCustomCertificate: false,
    projectId: ObjectID.generate(),
  };

  return {
    /*
     * The one lookup a route makes: the domain, read as root on the query
     * the update check narrowed to the caller's scope - nothing when it is
     * outside it.
     */
    findOneBy: jest
      .spyOn(kind.service, "findOneBy")
      .mockResolvedValue(
        (data.inScope === false ? null : row) as never,
      ) as unknown as MockedFn,
    findOneById: jest
      .spyOn(kind.service, "findOneById")
      .mockResolvedValue(row as never) as unknown as MockedFn,
    isCnameValid: jest
      .spyOn(kind.service, "isCnameValid")
      .mockResolvedValue(true) as unknown as MockedFn,
    orderCertOnceCnameIsVerified: jest
      .spyOn(kind.service, "orderCertOnceCnameIsVerified")
      .mockResolvedValue({
        certificateStatus: CustomDomainCertificateStatus.Issuing,
      } as never) as unknown as MockedFn,
    orderCertIfMissing: jest
      .spyOn(kind.service, "orderCertIfMissing")
      .mockResolvedValue(
        CertificateOrderOutcome.Ordered as never,
      ) as unknown as MockedFn,
    reissueCert: jest
      .spyOn(kind.service, "reissueCert")
      .mockResolvedValue(undefined as never) as unknown as MockedFn,
    orderOnDemand: jest
      .spyOn(CertificateOrder, "orderOnDemand")
      .mockResolvedValue(undefined as never) as unknown as MockedFn,
  };
}

async function callAs(
  props: DatabaseCommonInteractionProps,
  kind: Kind,
  route: string,
  params?: Record<string, string>,
): Promise<{ next: MockedFn }> {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);

  const req: ExpressRequest = {
    params: params || { id: domainId.toString() },
    query: {},
    body: {},
    headers: {},
  } as unknown as ExpressRequest;

  const next: MockedFn = jest.fn();

  const uri: string =
    route === "certificates"
      ? `${kind.path}/certificates/:${kind.parentColumn}`
      : `${kind.path}/${route}/:id`;

  await mockRouter
    .match("GET", uri)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return { next };
}

function sentError(): Error | undefined {
  return sendErrorResponseMock.mock.calls[0]?.[2] as unknown as
    | Error
    | undefined;
}

function answeredSuccess(): boolean {
  return (
    sendJsonObjectResponseMock.mock.calls.length > 0 ||
    sendEmptySuccessResponseMock.mock.calls.length > 0
  );
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new StatusPageDomainAPI();
  new DashboardDomainAPI();
});

beforeEach(() => {
  jest.clearAllMocks();
  domainId = ObjectID.generate();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(KINDS)("%s", (_label: string, kind: Kind) => {
  const updateList: Array<Permission> = new kind.modelType()
    .getUpdatePermissions()
    .slice()
    .sort();

  test("the update list the routes hold callers to is the domain table's own", () => {
    expect(updateList).toContain(kind.editPermission);
    expect(updateList).not.toContain(kind.readPermission);
    expect(updateList).not.toContain(kind.createPermission);
    expect(updateList).not.toContain(kind.deletePermission);

    for (const role of kind.readOnlyRoles) {
      expect([role, updateList.includes(role)]).toEqual([role, false]);
    }
  });

  describe.each(CHANGE_ROUTES)(
    "%s",
    (_routeLabel: string, changeRoute: ChangeRoute) => {
      /*
       * Every role a team can grant, one at a time: exactly the roles on the
       * domain table's update list get past the check.
       */
      test("a role gets to the change exactly when it may edit the domain", async () => {
        const reached: Array<Permission> = [];

        for (const role of ROLES) {
          jest.clearAllMocks();
          const spies: Spies = stubDomainTable(kind);

          await callAs(
            customDomainCaller({ permissions: [role] }),
            kind,
            changeRoute.route,
          );

          if (changeRoute.reachedTheChange(spies)) {
            reached.push(role);
          }

          jest.restoreAllMocks();
        }

        expect(reached.sort()).toEqual(
          updateList.filter((permission: Permission) => {
            return ROLES.includes(permission);
          }),
        );
      });

      /*
       * A key or a custom role built from the domain's own permissions: with
       * read beside it, the edit permission gets through and no other one
       * does.
       */
      test("of the domain's own permissions, only the edit permission gets to the change", async () => {
        const reached: Array<Permission> = [];

        for (const permission of [
          kind.readPermission,
          kind.createPermission,
          kind.editPermission,
          kind.deletePermission,
        ]) {
          jest.clearAllMocks();
          const spies: Spies = stubDomainTable(kind);

          await callAs(
            customDomainCaller({
              permissions: [kind.readPermission, permission],
            }),
            kind,
            changeRoute.route,
          );

          if (changeRoute.reachedTheChange(spies)) {
            reached.push(permission);
          }

          jest.restoreAllMocks();
        }

        expect(reached).toEqual([kind.editPermission]);
      });

      test.each([["read-only role"], ["read permission"]])(
        "a %s is refused, never reads the domain and never reaches the certificate authority",
        async (which: string) => {
          const spies: Spies = stubDomainTable(kind);

          const permissions: Array<Permission> =
            which === "read-only role"
              ? kind.readOnlyRoles
              : [kind.readPermission];

          await callAs(
            customDomainCaller({ permissions }),
            kind,
            changeRoute.route,
          );

          const error: Error | undefined = sentError();

          expect(error).toBeInstanceOf(NotAuthorizedException);
          expect(error!.message).toContain(
            `You do not have permissions to update ${kind.name}.`,
          );
          expect(spies.findOneBy).not.toHaveBeenCalled();
          expect(spies.isCnameValid).not.toHaveBeenCalled();
          expect(spies.orderCertOnceCnameIsVerified).not.toHaveBeenCalled();
          expect(spies.orderCertIfMissing).not.toHaveBeenCalled();
          expect(spies.orderOnDemand).not.toHaveBeenCalled();
          expect(spies.reissueCert).not.toHaveBeenCalled();
          expect(answeredSuccess()).toBe(false);
        },
      );

      test("a read-only API key is refused", async () => {
        const spies: Spies = stubDomainTable(kind);

        await callAs(
          customDomainCaller({
            permissions: [kind.readPermission],
            isApiKey: true,
          }),
          kind,
          changeRoute.route,
        );

        expect(sentError()).toBeInstanceOf(NotAuthorizedException);
        expect(changeRoute.reachedTheChange(spies)).toBe(false);
      });

      test("an API key that may edit the domain gets to the change", async () => {
        const spies: Spies = stubDomainTable(kind);

        await callAs(
          customDomainCaller({
            permissions: [kind.readPermission, kind.editPermission],
            isApiKey: true,
          }),
          kind,
          changeRoute.route,
        );

        expect(sentError()).toBeUndefined();
        expect(changeRoute.reachedTheChange(spies)).toBe(true);
      });

      test("a credential connected for reading only is refused, whatever its permissions", async () => {
        const spies: Spies = stubDomainTable(kind);

        await callAs(
          customDomainCaller({
            permissions: [Permission.ProjectOwner],
            isReadOnlyCredential: true,
          }),
          kind,
          changeRoute.route,
        );

        const error: Error | undefined = sentError();

        expect(error).toBeInstanceOf(NotAuthorizedException);
        expect(error!.message).toBe(
          DatabaseCommonInteractionPropsUtil.READ_ONLY_CREDENTIAL_MESSAGE,
        );
        expect(changeRoute.reachedTheChange(spies)).toBe(false);
      });

      test("a team block on the edit permission refuses an editor", async () => {
        const spies: Spies = stubDomainTable(kind);

        await callAs(
          customDomainCaller({
            permissions: [kind.readPermission, kind.editPermission],
            blocks: [kind.editPermission],
          }),
          kind,
          changeRoute.route,
        );

        expect(sentError()).toBeInstanceOf(NotAuthorizedException);
        expect(changeRoute.reachedTheChange(spies)).toBe(false);
      });

      test("no credentials at all is a 401, so the browser refreshes the session", async () => {
        const spies: Spies = stubDomainTable(kind);

        await callAs(
          {
            userType: UserType.Public,
          } as DatabaseCommonInteractionProps,
          kind,
          changeRoute.route,
        );

        expect(sentError()).toBeInstanceOf(NotAuthenticatedException);
        expect(changeRoute.reachedTheChange(spies)).toBe(false);
      });

      test("an editor is refused a domain outside their update scope, in the same words as a missing one", async () => {
        const spies: Spies = stubDomainTable(kind, { inScope: false });

        await callAs(
          customDomainCaller({
            permissions: [kind.readPermission, kind.editPermission],
          }),
          kind,
          changeRoute.route,
        );

        const error: Error | undefined = sentError();

        expect(error).toBeInstanceOf(BadDataException);
        expect(error!.message).toBe(DOMAIN_NOT_CHANGEABLE_MESSAGE);
        // Looked for once, inside their scope, and not found there.
        expect(spies.findOneBy).toHaveBeenCalledTimes(1);
        expect(changeRoute.reachedTheChange(spies)).toBe(false);
      });

      test("the domain is looked for in the caller's project, as root, on the narrowed query", async () => {
        const spies: Spies = stubDomainTable(kind);

        const props: DatabaseCommonInteractionProps = customDomainCaller({
          permissions: [kind.readPermission, kind.editPermission],
        });

        await callAs(props, kind, changeRoute.route);

        // One read of the domain: the check and the row the route works on.
        expect(spies.findOneBy).toHaveBeenCalledTimes(1);

        const lookup: {
          query: Record<string, unknown>;
          select: Record<string, unknown>;
          props: Record<string, unknown>;
        } = spies.findOneBy.mock.calls[0]![0] as {
          query: Record<string, unknown>;
          select: Record<string, unknown>;
          props: Record<string, unknown>;
        };

        expect(lookup.query["_id"]).toBe(domainId.toString());
        expect(JSON.stringify(lookup.query["projectId"])).toContain(
          props.tenantId!.toString(),
        );
        expect(lookup.props).toEqual({ isRoot: true });
        expect(lookup.select["_id"]).toBe(true);
        expect(changeRoute.reachedTheChange(spies)).toBe(true);
      });

      /*
       * An editor whose access is limited to some labels changes only the
       * domains of the status pages or dashboards carrying them - the update
       * of the domain is narrowed that way, and so is the check.
       */
      test("an editor limited to some labels may change only domains of the status pages or dashboards that carry them", async () => {
        const spies: Spies = stubDomainTable(kind);
        const labelId: ObjectID = ObjectID.generate();

        // The label join tables, as a migrated database names them.
        withLabelJoinTables();

        const props: DatabaseCommonInteractionProps = customDomainCaller({
          permissions: [kind.readPermission, kind.editPermission],
        });

        props.userTenantAccessPermission![
          props.tenantId!.toString()
        ]!.permissions.push({
          _type: "UserPermission",
          permission: kind.labelledParentEditPermission,
          labelIds: [labelId],
          isBlockPermission: false,
        });

        await callAs(props, kind, changeRoute.route);

        const lookup: { query: Record<string, unknown> } = spies.findOneBy.mock
          .calls[0]![0] as { query: Record<string, unknown> };

        /*
         * An update narrows by the parents the caller may edit with a
         * condition on the domain's own id, leaving the caller's filter on
         * the relation as it was sent.
         */
        expect(JSON.stringify(lookup.query["_id"])).toContain(
          labelId.toString(),
        );
        expect(lookup.query[kind.parentRelation]).toBeUndefined();
      });

      test("a master admin gets to the change", async () => {
        const spies: Spies = stubDomainTable(kind);

        await callAs(
          customDomainCaller({ permissions: [], isMasterAdmin: true }),
          kind,
          changeRoute.route,
        );

        expect(sentError()).toBeUndefined();
        expect(changeRoute.reachedTheChange(spies)).toBe(true);
      });

      test("a malformed id is refused before any permission is asked", async () => {
        const spies: Spies = stubDomainTable(kind);

        await callAs(
          customDomainCaller({ permissions: [Permission.ProjectOwner] }),
          kind,
          changeRoute.route,
          { id: "not-a-uuid" },
        );

        expect(sentError()!.message).toBe("The domain ID is not valid.");
        expect(spies.findOneBy).not.toHaveBeenCalled();
        expect(changeRoute.reachedTheChange(spies)).toBe(false);
      });
    },
  );

  /*
   * The Status column only reads, so read access is enough, as before.
   */
  test("the Status column's certificates stay readable with read access alone", async () => {
    const findBy: MockedFn = jest
      .spyOn(kind.service, "findBy")
      .mockResolvedValue([] as never) as unknown as MockedFn;
    jest.spyOn(kind.service, "getCertificates").mockResolvedValue([] as never);

    const props: DatabaseCommonInteractionProps = customDomainCaller({
      permissions: [kind.readPermission],
    });

    await callAs(props, kind, "certificates", {
      [kind.parentColumn]: ObjectID.generate().toString(),
    });

    expect(sentError()).toBeUndefined();
    expect(sendJsonObjectResponseMock).toHaveBeenCalledTimes(1);
    expect((findBy.mock.calls[0]![0] as { props: unknown }).props).toBe(props);
  });
});
