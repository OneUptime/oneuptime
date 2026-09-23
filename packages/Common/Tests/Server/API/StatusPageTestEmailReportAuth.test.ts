import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageOwnerTeamService from "../../../Server/Services/StatusPageOwnerTeamService";
import StatusPageOwnerUserService from "../../../Server/Services/StatusPageOwnerUserService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import logger from "../../../Server/Utils/Logger";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import Label from "../../../Models/DatabaseModels/Label";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageOwnerUser from "../../../Models/DatabaseModels/StatusPageOwnerUser";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import { FindOperator } from "typeorm";

/*
 * POST /status-page/test-email-report sends a status page's report to an
 * address named in the body, so only someone who could update that page may
 * call it. These tests drive the route through a real Express app with the
 * production middleware chain (getUserMiddleware, requireUserAuthentication),
 * the real model permission layer and the production error handler, so the
 * statuses asserted are the ones a client actually receives. Only the data
 * layer is stubbed: token decoding, permission and ownership lookups, the
 * status page reads and the email send.
 */

const PROJECT_A: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const PROJECT_B: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const STATUS_PAGE_IN_A: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MISSING_STATUS_PAGE: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

// The label the status page carries, and one it does not.
const PAGE_LABEL: ObjectID = new ObjectID(
  "1abe1000-0000-4000-8000-000000000001",
);
const OTHER_LABEL: ObjectID = new ObjectID(
  "1abe1000-0000-4000-8000-000000000002",
);

function user(suffix: string): ObjectID {
  return new ObjectID(`00000000-0000-4000-8000-0000000000${suffix}`);
}

const EDITOR_IN_A: ObjectID = user("0a");
const VIEWER_IN_A: ObjectID = user("0b");
const BLOCK_ONLY_IN_A: ObjectID = user("0c");
const OWNER_IN_B: ObjectID = user("0d");
const MEMBER_WITH_BLOCK_IN_A: ObjectID = user("0e");
const MEMBER_WITH_LABELLED_BLOCK_IN_A: ObjectID = user("0f");
const LABEL_SCOPED_ELSEWHERE_IN_A: ObjectID = user("10");
const LABEL_SCOPED_TO_PAGE_IN_A: ObjectID = user("11");
const OWNED_SCOPE_NOT_OWNER_IN_A: ObjectID = user("12");
const OWNED_SCOPE_OWNER_IN_A: ObjectID = user("13");

// Users recorded as owners of STATUS_PAGE_IN_A.
const PAGE_OWNERS: Array<string> = [OWNED_SCOPE_OWNER_IN_A.toString()];

const TARGET_EMAIL: string = "someone@example.com";

type Grant = {
  permission: Permission;
  isBlockPermission?: boolean;
  labelIds?: Array<ObjectID>;
  scope?: PermissionScope;
};

// userId -> projectId -> grants. A missing entry means "not a member".
const MEMBERSHIPS: Dictionary<Dictionary<Array<Grant>>> = {
  [EDITOR_IN_A.toString()]: {
    [PROJECT_A.toString()]: [{ permission: Permission.StatusPageAdmin }],
  },
  [VIEWER_IN_A.toString()]: {
    [PROJECT_A.toString()]: [
      { permission: Permission.Viewer },
      { permission: Permission.StatusPageViewer },
      { permission: Permission.ReadProjectStatusPage },
    ],
  },
  [BLOCK_ONLY_IN_A.toString()]: {
    [PROJECT_A.toString()]: [
      { permission: Permission.ReadProjectStatusPage },
      {
        permission: Permission.EditProjectStatusPage,
        isBlockPermission: true,
      },
    ],
  },
  [OWNER_IN_B.toString()]: {
    [PROJECT_B.toString()]: [{ permission: Permission.ProjectOwner }],
  },
  // A broad role, with status page editing taken away by a team block row.
  [MEMBER_WITH_BLOCK_IN_A.toString()]: {
    [PROJECT_A.toString()]: [
      { permission: Permission.ProjectMember },
      {
        permission: Permission.EditProjectStatusPage,
        isBlockPermission: true,
      },
    ],
  },
  // The same, but the block only covers pages carrying PAGE_LABEL.
  [MEMBER_WITH_LABELLED_BLOCK_IN_A.toString()]: {
    [PROJECT_A.toString()]: [
      { permission: Permission.ProjectMember },
      {
        permission: Permission.EditProjectStatusPage,
        isBlockPermission: true,
        labelIds: [PAGE_LABEL],
      },
    ],
  },
  [LABEL_SCOPED_ELSEWHERE_IN_A.toString()]: {
    [PROJECT_A.toString()]: [
      {
        permission: Permission.StatusPageMember,
        labelIds: [OTHER_LABEL],
        scope: PermissionScope.Labels,
      },
    ],
  },
  [LABEL_SCOPED_TO_PAGE_IN_A.toString()]: {
    [PROJECT_A.toString()]: [
      {
        permission: Permission.StatusPageMember,
        labelIds: [PAGE_LABEL],
        scope: PermissionScope.Labels,
      },
    ],
  },
  [OWNED_SCOPE_NOT_OWNER_IN_A.toString()]: {
    [PROJECT_A.toString()]: [
      { permission: Permission.StatusPageMember, scope: PermissionScope.Owned },
    ],
  },
  [OWNED_SCOPE_OWNER_IN_A.toString()]: {
    [PROJECT_A.toString()]: [
      { permission: Permission.StatusPageMember, scope: PermissionScope.Owned },
    ],
  },
};

function tenantPermissionFor(
  userId: ObjectID,
  projectId: ObjectID,
): UserTenantAccessPermission | null {
  const grants: Array<Grant> | undefined =
    MEMBERSHIPS[userId.toString()]?.[projectId.toString()];

  if (!grants) {
    return null;
  }

  return {
    _type: "UserTenantAccessPermission",
    projectId,
    permissions: grants.map((grant: Grant) => {
      return {
        _type: "UserPermission",
        permission: grant.permission,
        labelIds: grant.labelIds || [],
        isBlockPermission: grant.isBlockPermission || false,
        scope: grant.scope,
      };
    }),
  };
}

function tokenFor(userId: ObjectID): string {
  return `token-${userId.toString()}`;
}

/*
 * Whether a serialized query condition admits `value`. Understands exactly the
 * shapes the permission layer produces for this route (plain ids, Equal, In,
 * And, and Raw operators whose bound parameters hold the permitted values) and
 * throws on anything else, so a test cannot pass because the fake silently
 * ignored a narrowing it did not recognise.
 */
function conditionAdmits(condition: unknown, value: string): boolean {
  if (condition === undefined) {
    return true;
  }

  if (typeof condition === "string" || condition instanceof ObjectID) {
    return condition.toString() === value;
  }

  if (condition instanceof FindOperator) {
    const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

    switch (operator.type) {
      case "and":
        return (operator.value as unknown as Array<unknown>).every(
          (child: unknown) => {
            return conditionAdmits(child, value);
          },
        );
      case "equal":
        return String(operator.value) === value;
      case "in":
        return (operator.value as unknown as Array<unknown>)
          .map(String)
          .includes(value);
      case "raw":
        return Object.values(operator.objectLiteralParameters || {})
          .flat()
          .map(String)
          .includes(value);
      default:
        break;
    }
  }

  throw new Error(
    `Unexpected query condition in test fake: ${JSON.stringify(condition)}`,
  );
}

function queryMatchesPage(
  query: Dictionary<unknown>,
  page: StatusPage,
): boolean {
  for (const key of Object.keys(query)) {
    if (key !== "_id" && key !== "projectId" && key !== "labels") {
      throw new Error(`Unexpected query key in test fake: ${key}`);
    }
  }

  if (!conditionAdmits(query["_id"], page.id!.toString())) {
    return false;
  }

  if (!conditionAdmits(query["projectId"], page.projectId!.toString())) {
    return false;
  }

  const labelCondition: unknown = query["labels"];

  if (labelCondition === undefined) {
    return true;
  }

  const pageLabelIds: Array<string> = (page.labels || []).map(
    (label: Label) => {
      return label.id!.toString();
    },
  );

  if (Array.isArray(labelCondition)) {
    return labelCondition.some((labelId: unknown) => {
      return pageLabelIds.includes(String(labelId));
    });
  }

  const labelIdCondition: unknown =
    labelCondition instanceof FindOperator
      ? labelCondition
      : (labelCondition as Dictionary<unknown>)["_id"];

  return pageLabelIds.some((labelId: string) => {
    return conditionAdmits(labelIdCondition, labelId);
  });
}

type HttpResult = { status: number; body: unknown };

function post(data: {
  port: number;
  headers: http.OutgoingHttpHeaders;
  body: unknown;
}): Promise<HttpResult> {
  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
      const payload: string = JSON.stringify(data.body);
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: "/api/status-page/test-email-report",
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
            ...data.headers,
          },
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];
          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on("end", () => {
            const raw: string = Buffer.concat(chunks).toString("utf8");
            let body: unknown = raw;
            try {
              body = raw ? JSON.parse(raw) : null;
            } catch {
              // keep the raw text
            }
            resolve({ status: response.statusCode || 0, body });
          });
        },
      );
      request.on("error", reject);
      request.write(payload);
      request.end();
    },
  );
}

describe("POST /status-page/test-email-report authorization", () => {
  let server: http.Server;
  let port: number;
  let sendEmailReport: jest.SpyInstance;

  function send(data: {
    userId?: ObjectID | undefined;
    tenantId?: ObjectID | undefined;
    statusPageId?: ObjectID | undefined;
    headers?: http.OutgoingHttpHeaders | undefined;
  }): Promise<HttpResult> {
    const headers: http.OutgoingHttpHeaders = { ...(data.headers || {}) };

    if (data.userId) {
      headers["authorization"] = `Bearer ${tokenFor(data.userId)}`;
    }

    if (data.tenantId) {
      headers["tenantid"] = data.tenantId.toString();
    }

    return post({
      port,
      headers,
      body: {
        statusPageId: (data.statusPageId || STATUS_PAGE_IN_A).toString(),
        email: TARGET_EMAIL,
      },
    });
  }

  function expectRejected(result: HttpResult, status: number): void {
    expect(result.status).toBe(status);
    expect(sendEmailReport).not.toHaveBeenCalled();
  }

  function expectSent(result: HttpResult): void {
    expect(result.status).toBe(200);
    expect(sendEmailReport).toHaveBeenCalledTimes(1);

    const args: { email?: Email | undefined; statusPageId: ObjectID } =
      sendEmailReport.mock.calls[0]![0];
    expect(args.statusPageId.toString()).toBe(STATUS_PAGE_IN_A.toString());
    expect(args.email?.toString()).toBe(TARGET_EMAIL);
  }

  beforeAll(async () => {
    const app: express.Express = express();
    app.use(express.json());
    app.use("/api", new StatusPageAPI().getRouter());
    app.use(expressErrorHandler);

    server = http.createServer(app);
    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    jest
      .spyOn(JSONWebToken, "decode")
      .mockImplementation((token: string): JSONWebTokenData => {
        const userId: string = token.replace(/^token-/, "");

        if (!MEMBERSHIPS[userId]) {
          throw new Error("invalid token");
        }

        return {
          userId: new ObjectID(userId),
          email: new Email(`${userId}@example.com`),
          isMasterAdmin: false,
          isGlobalLogin: true,
        };
      });

    jest
      .spyOn(AccessTokenService, "getUserGlobalAccessPermission")
      .mockImplementation(
        async (userId: ObjectID): Promise<UserGlobalAccessPermission> => {
          return {
            _type: "UserGlobalAccessPermission",
            projectIds: Object.keys(MEMBERSHIPS[userId.toString()] || {}).map(
              (id: string) => {
                return new ObjectID(id);
              },
            ),
            // What every signed-in user carries; none of it is a project grant.
            globalPermissions: [
              Permission.Public,
              Permission.User,
              Permission.CurrentUser,
            ],
          };
        },
      );

    jest
      .spyOn(UserMiddleware, "getUserTenantAccessPermissionWithTenantId")
      .mockImplementation(
        async (data: {
          tenantId: ObjectID;
          userId: ObjectID;
        }): Promise<UserTenantAccessPermission | null> => {
          return tenantPermissionFor(data.userId, data.tenantId);
        },
      );

    jest
      .spyOn(UserMiddleware, "getUserTenantAccessPermissionForMultiTenant")
      .mockImplementation(
        async (
          _req: unknown,
          userId: ObjectID,
          projectIds: Array<ObjectID>,
        ): Promise<Dictionary<UserTenantAccessPermission> | null> => {
          const result: Dictionary<UserTenantAccessPermission> = {};

          for (const projectId of projectIds) {
            const permission: UserTenantAccessPermission | null =
              tenantPermissionFor(userId, projectId);

            if (permission) {
              result[projectId.toString()] = permission;
            }
          }

          return result;
        },
      );

    jest.spyOn(TeamMemberService, "getTeamIdsForUser").mockResolvedValue([]);
    jest
      .spyOn(UserService, "updateLastActive")
      .mockResolvedValue(undefined as never);
    // A blocked user's token is BlockedUserMiddleware.test.ts; here nobody is blocked.
    jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(false as never);
    jest
      .spyOn(ProjectService, "updateLastActive")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ProjectService, "getCurrentPlan")
      .mockResolvedValue({ plan: null, isSubscriptionUnpaid: false });

    // Ownership lookups made by the Owned permission scope.
    jest
      .spyOn(StatusPageOwnerUserService, "findBy")
      .mockImplementation(async (findBy: any): Promise<Array<any>> => {
        const userId: string = findBy.query.userId.toString();

        if (!PAGE_OWNERS.includes(userId)) {
          return [];
        }

        const owner: StatusPageOwnerUser = new StatusPageOwnerUser();
        owner.statusPageId = STATUS_PAGE_IN_A;
        return [owner];
      });
    jest.spyOn(StatusPageOwnerTeamService, "findBy").mockResolvedValue([]);

    const buildPage: () => StatusPage = (): StatusPage => {
      const statusPage: StatusPage = new StatusPage();
      statusPage.id = STATUS_PAGE_IN_A;
      statusPage.projectId = PROJECT_A;
      const label: Label = new Label();
      label.id = PAGE_LABEL;
      statusPage.labels = [label];
      return statusPage;
    };

    jest
      .spyOn(StatusPageService, "findOneById")
      .mockImplementation(async (findBy: any): Promise<StatusPage | null> => {
        if (findBy.id.toString() !== STATUS_PAGE_IN_A.toString()) {
          return null;
        }

        return buildPage();
      });

    // The permission-narrowed existence check.
    jest
      .spyOn(StatusPageService, "findOneBy")
      .mockImplementation(async (findBy: any): Promise<StatusPage | null> => {
        const page: StatusPage = buildPage();
        return queryMatchesPage(findBy.query, page) ? page : null;
      });

    sendEmailReport = jest
      .spyOn(StatusPageService, "sendEmailReport")
      .mockResolvedValue(undefined);
  });

  describe("authentication", () => {
    it("rejects an anonymous caller with 401 and sends no email", async () => {
      expectRejected(await send({ tenantId: PROJECT_A }), 401);
      expect(StatusPageService.findOneById).not.toHaveBeenCalled();
    });

    it("rejects an anonymous caller with no tenant header with 401", async () => {
      expectRejected(await send({}), 401);
    });
  });

  describe("project membership", () => {
    it("rejects a member of another project with 422 and sends no email", async () => {
      expectRejected(
        await send({ userId: OWNER_IN_B, tenantId: PROJECT_B }),
        422,
      );
    });

    it("rejects a member of another project who names the owning project in the tenant header", async () => {
      expectRejected(
        await send({ userId: OWNER_IN_B, tenantId: PROJECT_A }),
        422,
      );
    });

    it("rejects a status page that does not exist the same way as a foreign one", async () => {
      expectRejected(
        await send({
          userId: EDITOR_IN_A,
          tenantId: PROJECT_A,
          statusPageId: MISSING_STATUS_PAGE,
        }),
        422,
      );
    });
  });

  describe("status page edit permission", () => {
    it("rejects a member of the project who cannot edit status pages with 422", async () => {
      expectRejected(
        await send({ userId: VIEWER_IN_A, tenantId: PROJECT_A }),
        422,
      );
    });

    it("does not count a blocked edit permission as a grant", async () => {
      expectRejected(
        await send({ userId: BLOCK_ONLY_IN_A, tenantId: PROJECT_A }),
        422,
      );
    });

    it("honours a team block on status page editing over a broader role", async () => {
      expectRejected(
        await send({ userId: MEMBER_WITH_BLOCK_IN_A, tenantId: PROJECT_A }),
        422,
      );
    });

    it("honours a label-restricted block that covers this page", async () => {
      expectRejected(
        await send({
          userId: MEMBER_WITH_LABELLED_BLOCK_IN_A,
          tenantId: PROJECT_A,
        }),
        422,
      );
    });

    it("rejects an edit grant restricted to labels this page does not carry", async () => {
      expectRejected(
        await send({
          userId: LABEL_SCOPED_ELSEWHERE_IN_A,
          tenantId: PROJECT_A,
        }),
        422,
      );
    });

    it("rejects an Owned-scoped edit grant for a page the caller does not own", async () => {
      expectRejected(
        await send({
          userId: OWNED_SCOPE_NOT_OWNER_IN_A,
          tenantId: PROJECT_A,
        }),
        422,
      );
    });

    it("applies the same checks when the multi-tenant header is sent", async () => {
      expectRejected(
        await send({
          userId: OWNED_SCOPE_NOT_OWNER_IN_A,
          tenantId: PROJECT_A,
          headers: { "is-multi-tenant-query": "true" },
        }),
        422,
      );
    });
  });

  describe("permitted callers", () => {
    it("sends the report once for a member permitted to edit the status page", async () => {
      expectSent(await send({ userId: EDITOR_IN_A, tenantId: PROJECT_A }));
    });

    it("sends the report for an edit grant restricted to a label this page carries", async () => {
      expectSent(
        await send({ userId: LABEL_SCOPED_TO_PAGE_IN_A, tenantId: PROJECT_A }),
      );
    });

    it("sends the report for an Owned-scoped edit grant on a page the caller owns", async () => {
      expectSent(
        await send({ userId: OWNED_SCOPE_OWNER_IN_A, tenantId: PROJECT_A }),
      );
    });
  });
});
