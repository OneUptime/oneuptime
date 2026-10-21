import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AccessTokenService from "../../../Server/Services/AccessTokenService";
import MonitorGroupResourceService from "../../../Server/Services/MonitorGroupResourceService";
import MonitorService from "../../../Server/Services/MonitorService";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import logger from "../../../Server/Utils/Logger";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorGroupResource from "../../../Models/DatabaseModels/MonitorGroupResource";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import StatusPageEventType from "../../../Types/StatusPage/StatusPageEventType";
import StatusPagesListingMonitors, {
  StatusPageListingMonitors,
} from "../../../Types/StatusPage/StatusPagesListingMonitors";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import express from "express";
import http from "http";
import { AddressInfo } from "net";
import { FindOperator } from "typeorm";

/*
 * POST /status-page/listing-monitors: the status pages the dashboard
 * suggests under the status page picker of a scheduled maintenance event or
 * an announcement - the pages that show the affected monitors.
 *
 * These drive the route through a real Express app with the production
 * middleware chain (getUserMiddleware, requireUserAuthentication) and the
 * production error handler, the real builder, the real monitor-to-page
 * lookup (StatusPageResourceService.findByMonitors, monitor groups and all),
 * and - what decides what a caller learns - the real model permission
 * layer: the caller's monitor and status page reads are narrowed by their
 * roles and labels exactly as on any CRUD read. Only the rows are faked: each
 * service's repository answers the query the permission layer built,
 * applying every condition in it (and failing on one it does not know, so a
 * test cannot pass because the fake ignored a narrowing).
 *
 * So these pin, end to end: a Status Page Viewer limited to some labels
 * hears only of the pages carrying them, and nothing counts the others; a
 * monitor the caller cannot read is not looked up; another project's pages
 * never come back; and who may ask at all.
 */

const PROJECT_A: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const PROJECT_B: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);

// Labels.
const API_LABEL: string = "1abe1000-0000-4000-8000-000000000001";
const PUBLIC_LABEL: string = "1abe1000-0000-4000-8000-000000000002";
const EU_LABEL: string = "1abe1000-0000-4000-8000-000000000003";

// Project A's monitors; the cache monitor is on a page through a group.
const API_MONITOR: string = "c0000000-0000-4000-8000-000000000001";
const DB_MONITOR: string = "c0000000-0000-4000-8000-000000000002";
const CACHE_MONITOR: string = "c0000000-0000-4000-8000-000000000003";
const UNLISTED_MONITOR: string = "c0000000-0000-4000-8000-000000000004";
// Project B's.
const B_MONITOR: string = "c0000000-0000-4000-8000-0000000000b1";

const CACHE_GROUP: string = "90000000-0000-4000-8000-000000000001";

// Project A's status pages.
const PUBLIC_PAGE: string = "b0000000-0000-4000-8000-000000000001";
const EU_PAGE: string = "b0000000-0000-4000-8000-000000000002";
const PLATFORM_PAGE: string = "b0000000-0000-4000-8000-000000000003";
const ARCHIVED_PAGE: string = "b0000000-0000-4000-8000-000000000004";
const INCIDENTS_ONLY_PAGE: string = "b0000000-0000-4000-8000-000000000005";
// Project B's.
const B_PAGE: string = "b0000000-0000-4000-8000-0000000000b1";

function user(suffix: string): ObjectID {
  return new ObjectID(`00000000-0000-4000-8000-0000000000${suffix}`);
}

const MEMBER_IN_A: ObjectID = user("0a");
const EU_PAGES_ONLY_IN_A: ObjectID = user("0b");
const API_MONITORS_ONLY_IN_A: ObjectID = user("0c");
const MONITORS_ONLY_IN_A: ObjectID = user("0d");
const PAGES_ONLY_IN_A: ObjectID = user("0e");
const OWNER_IN_B: ObjectID = user("0f");
const MEMBER_IN_A_AND_B: ObjectID = user("10");
const BLOCKED_FROM_PAGES_IN_A: ObjectID = user("11");

type Grant = {
  permission: Permission;
  isBlockPermission?: boolean;
  labelIds?: Array<string>;
  scope?: PermissionScope;
};

// userId -> projectId -> grants. A missing entry means "not a member".
const MEMBERSHIPS: Dictionary<Dictionary<Array<Grant>>> = {
  [MEMBER_IN_A.toString()]: {
    [PROJECT_A.toString()]: [{ permission: Permission.ProjectMember }],
  },
  // Every monitor; only the status pages labelled EU.
  [EU_PAGES_ONLY_IN_A.toString()]: {
    [PROJECT_A.toString()]: [
      { permission: Permission.MonitorViewer },
      {
        permission: Permission.StatusPageViewer,
        labelIds: [EU_LABEL],
        scope: PermissionScope.Labels,
      },
    ],
  },
  // Every status page; only the monitors labelled API.
  [API_MONITORS_ONLY_IN_A.toString()]: {
    [PROJECT_A.toString()]: [
      { permission: Permission.StatusPageViewer },
      {
        permission: Permission.MonitorViewer,
        labelIds: [API_LABEL],
        scope: PermissionScope.Labels,
      },
    ],
  },
  [MONITORS_ONLY_IN_A.toString()]: {
    [PROJECT_A.toString()]: [{ permission: Permission.MonitorViewer }],
  },
  [PAGES_ONLY_IN_A.toString()]: {
    [PROJECT_A.toString()]: [{ permission: Permission.StatusPageViewer }],
  },
  [OWNER_IN_B.toString()]: {
    [PROJECT_B.toString()]: [{ permission: Permission.ProjectOwner }],
  },
  [MEMBER_IN_A_AND_B.toString()]: {
    [PROJECT_A.toString()]: [{ permission: Permission.ProjectMember }],
    [PROJECT_B.toString()]: [{ permission: Permission.ProjectMember }],
  },
  // A broad role, with reading status pages taken away by a team block.
  [BLOCKED_FROM_PAGES_IN_A.toString()]: {
    [PROJECT_A.toString()]: [
      { permission: Permission.ProjectMember },
      {
        permission: Permission.ReadProjectStatusPage,
        isBlockPermission: true,
      },
      {
        permission: Permission.StatusPageViewer,
        isBlockPermission: true,
      },
      {
        permission: Permission.ProjectMember,
        isBlockPermission: false,
      },
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
        labelIds: (grant.labelIds || []).map((id: string): ObjectID => {
          return new ObjectID(id);
        }),
        isBlockPermission: grant.isBlockPermission || false,
        scope: grant.scope,
      };
    }),
  };
}

/*
 * THE ROWS
 */

type Row = Dictionary<unknown> & { _id: string; labels?: Array<string> };

const MONITORS: Array<Row> = [
  { _id: API_MONITOR, projectId: PROJECT_A.toString(), labels: [API_LABEL] },
  { _id: DB_MONITOR, projectId: PROJECT_A.toString(), labels: [] },
  { _id: CACHE_MONITOR, projectId: PROJECT_A.toString(), labels: [] },
  { _id: UNLISTED_MONITOR, projectId: PROJECT_A.toString(), labels: [] },
  { _id: B_MONITOR, projectId: PROJECT_B.toString(), labels: [] },
];

const STATUS_PAGES: Array<Row> = [
  {
    _id: PUBLIC_PAGE,
    projectId: PROJECT_A.toString(),
    name: "Acme Public",
    labels: [PUBLIC_LABEL],
  },
  {
    _id: EU_PAGE,
    projectId: PROJECT_A.toString(),
    name: "EU Status",
    labels: [EU_LABEL],
  },
  {
    _id: PLATFORM_PAGE,
    projectId: PROJECT_A.toString(),
    name: "Platform Status",
    labels: [EU_LABEL],
  },
  {
    _id: ARCHIVED_PAGE,
    projectId: PROJECT_A.toString(),
    name: "Old Status",
    labels: [EU_LABEL],
    isArchived: true,
  },
  {
    _id: INCIDENTS_ONLY_PAGE,
    projectId: PROJECT_A.toString(),
    name: "Incidents Only",
    labels: [EU_LABEL],
    showScheduledMaintenanceEventsOnStatusPage: false,
  },
  {
    _id: B_PAGE,
    projectId: PROJECT_B.toString(),
    name: "Project B Status",
    labels: [],
  },
];

const STATUS_PAGE_RESOURCES: Array<Row> = [
  {
    _id: "e0000000-0000-4000-8000-000000000001",
    statusPageId: PUBLIC_PAGE,
    monitorId: API_MONITOR,
  },
  {
    _id: "e0000000-0000-4000-8000-000000000002",
    statusPageId: PUBLIC_PAGE,
    monitorId: DB_MONITOR,
  },
  {
    _id: "e0000000-0000-4000-8000-000000000003",
    statusPageId: EU_PAGE,
    monitorId: API_MONITOR,
  },
  {
    _id: "e0000000-0000-4000-8000-000000000004",
    statusPageId: PLATFORM_PAGE,
    monitorGroupId: CACHE_GROUP,
  },
  {
    _id: "e0000000-0000-4000-8000-000000000005",
    statusPageId: ARCHIVED_PAGE,
    monitorId: API_MONITOR,
  },
  {
    _id: "e0000000-0000-4000-8000-000000000006",
    statusPageId: INCIDENTS_ONLY_PAGE,
    monitorId: API_MONITOR,
  },
  // Another project's page pointing at A's monitor: never named in A.
  {
    _id: "e0000000-0000-4000-8000-000000000007",
    statusPageId: B_PAGE,
    monitorId: API_MONITOR,
  },
];

const MONITOR_GROUP_RESOURCES: Array<Row> = [
  {
    _id: "f0000000-0000-4000-8000-000000000001",
    monitorGroupId: CACHE_GROUP,
    monitorId: CACHE_MONITOR,
  },
];

// The SQL QueryHelper.any/in and equalTo write, for a column called "col".
const RAW_IN_LIST: RegExp = /^\(col IN \(:\.\.\.\w+\)\)$/;
const RAW_EQUALS: RegExp = /^\(col = :\w+\)$/;

/*
 * Whether a query condition admits `value`. Understands exactly the shapes
 * the permission layer and QueryHelper produce for these reads - plain ids,
 * Equal, In, And, and Raw operators whose SQL is an IN list, an equality or
 * the always-false TRUE = FALSE - and throws on anything else.
 */
function conditionAdmits(condition: unknown, value: string): boolean {
  if (condition === undefined) {
    return true;
  }

  if (typeof condition === "string" || condition instanceof ObjectID) {
    return condition.toString().toLowerCase() === value.toLowerCase();
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
        return String(operator.value).toLowerCase() === value.toLowerCase();
      case "in":
        return (operator.value as unknown as Array<unknown>)
          .map((item: unknown): string => {
            return String(item).toLowerCase();
          })
          .includes(value.toLowerCase());
      case "raw": {
        const sql: string = operator.getSql ? operator.getSql("col") : "";

        if (sql === "TRUE = FALSE") {
          return false;
        }

        if (!RAW_IN_LIST.test(sql) && !RAW_EQUALS.test(sql)) {
          throw new Error(`Unexpected raw condition in test fake: ${sql}`);
        }

        return Object.values(operator.objectLiteralParameters || {})
          .flat()
          .map((item: unknown): string => {
            return String(item).toLowerCase();
          })
          .includes(value.toLowerCase());
      }
      default:
        break;
    }
  }

  throw new Error(
    `Unexpected query condition in test fake: ${JSON.stringify(condition)}`,
  );
}

const KNOWN_COLUMNS: Array<string> = [
  "_id",
  "projectId",
  "monitorId",
  "monitorGroupId",
  "statusPageId",
];

function rowMatches(where: Dictionary<unknown>, row: Row): boolean {
  for (const key of Object.keys(where)) {
    if (key === "labels") {
      const condition: unknown = where["labels"];
      const labelIds: Array<string> = row.labels || [];

      if (Array.isArray(condition)) {
        const wanted: Array<string> = condition.map((id: unknown): string => {
          return String(id).toLowerCase();
        });

        if (
          !labelIds.some((labelId: string): boolean => {
            return wanted.includes(labelId);
          })
        ) {
          return false;
        }

        continue;
      }

      const idCondition: unknown =
        condition instanceof FindOperator
          ? condition
          : (condition as Dictionary<unknown>)["_id"];

      if (
        !labelIds.some((labelId: string): boolean => {
          return conditionAdmits(idCondition, labelId);
        })
      ) {
        return false;
      }

      continue;
    }

    if (!KNOWN_COLUMNS.includes(key)) {
      throw new Error(`Unexpected query key in test fake: ${key}`);
    }

    if (!conditionAdmits(where[key], String(row[key] ?? ""))) {
      return false;
    }
  }

  return true;
}

// Every query each repository was asked, in order.
const queriesAsked: Dictionary<Array<Dictionary<unknown>>> = {};

function fakeRepository<T extends BaseModel>(data: {
  name: string;
  modelType: { new (): T };
  rows: Array<Row>;
}): { find: (options: JSONObject) => Promise<Array<T>> } {
  return {
    find: async (options: JSONObject): Promise<Array<T>> => {
      const where: Dictionary<unknown> = (options["where"] ||
        {}) as Dictionary<unknown>;

      (queriesAsked[data.name] = queriesAsked[data.name] || []).push(where);

      return data.rows
        .filter((row: Row): boolean => {
          return rowMatches(where, row);
        })
        .slice(0, Number(options["take"]) || undefined)
        .map((row: Row): T => {
          const model: T = new data.modelType();

          for (const [key, value] of Object.entries(row)) {
            if (key === "labels") {
              (model as unknown as Dictionary<unknown>)[key] = (
                value as Array<string>
              ).map((id: string): Label => {
                const label: Label = new Label();
                label._id = id;
                return label;
              });
              continue;
            }

            if (
              key === "projectId" ||
              key === "statusPageId" ||
              key === "monitorId" ||
              key === "monitorGroupId"
            ) {
              (model as unknown as Dictionary<unknown>)[key] = new ObjectID(
                value as string,
              );
              continue;
            }

            (model as unknown as Dictionary<unknown>)[key] = value;
          }

          return model;
        });
    },
  };
}

type HttpResult = {
  status: number;
  body: unknown;
  headers: http.IncomingHttpHeaders;
};

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
          path: `/api${StatusPagesListingMonitors.apiPath}`,
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
            resolve({
              status: response.statusCode || 0,
              body,
              headers: response.headers,
            });
          });
        },
      );
      request.on("error", reject);
      request.write(payload);
      request.end();
    },
  );
}

describe("POST /status-page/listing-monitors", () => {
  let server: http.Server;
  let port: number;

  function send(data: {
    userId?: ObjectID | undefined;
    tenantId?: ObjectID | undefined;
    body?: unknown;
    headers?: http.OutgoingHttpHeaders | undefined;
  }): Promise<HttpResult> {
    const headers: http.OutgoingHttpHeaders = { ...(data.headers || {}) };

    if (data.userId) {
      headers["authorization"] = `Bearer token-${data.userId.toString()}`;
    }

    if (data.tenantId) {
      headers["tenantid"] = data.tenantId.toString();
    }

    return post({
      port,
      headers,
      body:
        data.body === undefined
          ? {
              monitorIds: [API_MONITOR, DB_MONITOR, CACHE_MONITOR],
              eventType: StatusPageEventType.ScheduledEvent,
            }
          : data.body,
    });
  }

  // The names in an answer, after checking it is one.
  function namesIn(result: HttpResult): Array<string> {
    expect(result.status).toBe(200);

    return StatusPagesListingMonitors.fromJSON(
      result.body as JSONObject,
    ).statusPages.map((page: StatusPageListingMonitors): string => {
      return page.name;
    });
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

    for (const key of Object.keys(queriesAsked)) {
      delete queriesAsked[key];
    }

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
    jest.spyOn(UserService, "isUserBlocked").mockResolvedValue(false as never);
    jest
      .spyOn(ProjectService, "updateLastActive")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ProjectService, "getCurrentPlan")
      .mockResolvedValue({ plan: null, isSubscriptionUnpaid: false });

    jest.spyOn(MonitorService, "getRepository").mockReturnValue(
      fakeRepository({
        name: "Monitor",
        modelType: Monitor,
        rows: MONITORS,
      }) as never,
    );
    jest.spyOn(StatusPageService, "getRepository").mockReturnValue(
      fakeRepository({
        name: "StatusPage",
        modelType: StatusPage,
        rows: STATUS_PAGES,
      }) as never,
    );
    jest.spyOn(StatusPageResourceService, "getRepository").mockReturnValue(
      fakeRepository({
        name: "StatusPageResource",
        modelType: StatusPageResource,
        rows: STATUS_PAGE_RESOURCES,
      }) as never,
    );
    jest.spyOn(MonitorGroupResourceService, "getRepository").mockReturnValue(
      fakeRepository({
        name: "MonitorGroupResource",
        modelType: MonitorGroupResource,
        rows: MONITOR_GROUP_RESOURCES,
      }) as never,
    );
  });

  describe("who may ask", () => {
    it("refuses an anonymous caller with 401, and reads nothing", async () => {
      const result: HttpResult = await send({ tenantId: PROJECT_A });

      expect(result.status).toBe(401);
      expect(queriesAsked).toEqual({});
    });

    it("refuses a member of another project who names this one in the tenant header, and reads nothing", async () => {
      const result: HttpResult = await send({
        userId: OWNER_IN_B,
        tenantId: PROJECT_A,
      });

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.status).toBeLessThan(500);
      expect(result.status).not.toBe(200);
      expect(queriesAsked).toEqual({});
    });

    it("asks for the project when the tenant header is missing", async () => {
      const result: HttpResult = await send({ userId: MEMBER_IN_A });

      expect(result.status).toBe(400);
      expect(JSON.stringify(result.body)).toContain("Project ID is required");
      expect(queriesAsked).toEqual({});
    });

    it("answers a member of the project, and says not to cache the answer", async () => {
      const result: HttpResult = await send({
        userId: MEMBER_IN_A,
        tenantId: PROJECT_A,
      });

      expect(namesIn(result)).toEqual([
        "Acme Public",
        "EU Status",
        "Platform Status",
      ]);
      expect(result.headers["cache-control"]).toBe(
        "no-store, no-cache, must-revalidate",
      );
    });
  });

  describe("what a member learns", () => {
    it("names the pages that list the monitors - directly, or through a monitor group - with their ids, in name order", async () => {
      const result: HttpResult = await send({
        userId: MEMBER_IN_A,
        tenantId: PROJECT_A,
      });

      expect(result.status).toBe(200);
      expect(result.body).toEqual({
        statusPages: [
          { statusPageId: PUBLIC_PAGE, name: "Acme Public" },
          { statusPageId: EU_PAGE, name: "EU Status" },
          { statusPageId: PLATFORM_PAGE, name: "Platform Status" },
        ],
      });
    });

    it("leaves out an archived page, and, for a maintenance event, a page that hides maintenance events", async () => {
      expect(
        namesIn(
          await send({
            userId: MEMBER_IN_A,
            tenantId: PROJECT_A,
            body: { monitorIds: [API_MONITOR] },
          }),
        ),
      ).toEqual(["Acme Public", "EU Status", "Incidents Only"]);

      expect(
        namesIn(
          await send({
            userId: MEMBER_IN_A,
            tenantId: PROJECT_A,
            body: {
              monitorIds: [API_MONITOR],
              eventType: StatusPageEventType.ScheduledEvent,
            },
          }),
        ),
      ).toEqual(["Acme Public", "EU Status"]);

      expect(
        namesIn(
          await send({
            userId: MEMBER_IN_A,
            tenantId: PROJECT_A,
            body: {
              monitorIds: [API_MONITOR],
              eventType: StatusPageEventType.Announcement,
            },
          }),
        ),
      ).toEqual(["Acme Public", "EU Status", "Incidents Only"]);
    });

    it("never names another project's page, even one that lists this project's monitor", async () => {
      const result: HttpResult = await send({
        userId: MEMBER_IN_A,
        tenantId: PROJECT_A,
        body: { monitorIds: [API_MONITOR] },
      });

      expect(result.status).toBe(200);
      expect(JSON.stringify(result.body)).not.toContain(B_PAGE);
      expect(JSON.stringify(result.body)).not.toContain("Project B Status");
    });

    it("the multi-tenant header changes nothing: the answer is for the project in the tenant header", async () => {
      const result: HttpResult = await send({
        userId: MEMBER_IN_A_AND_B,
        tenantId: PROJECT_A,
        body: { monitorIds: [API_MONITOR, B_MONITOR] },
        headers: { "is-multi-tenant-query": "true" },
      });

      expect(namesIn(result)).toEqual([
        "Acme Public",
        "EU Status",
        "Incidents Only",
      ]);
      expect(JSON.stringify(result.body)).not.toContain(B_PAGE);
    });

    it("monitors on no status page suggest nothing", async () => {
      expect(
        namesIn(
          await send({
            userId: MEMBER_IN_A,
            tenantId: PROJECT_A,
            body: { monitorIds: [UNLISTED_MONITOR] },
          }),
        ),
      ).toEqual([]);
    });
  });

  describe("bounded by what the caller may read", () => {
    it("a Status Page Viewer limited to a label hears only of the pages that carry it", async () => {
      const result: HttpResult = await send({
        userId: EU_PAGES_ONLY_IN_A,
        tenantId: PROJECT_A,
      });

      expect(result.body).toEqual({
        statusPages: [
          { statusPageId: EU_PAGE, name: "EU Status" },
          { statusPageId: PLATFORM_PAGE, name: "Platform Status" },
        ],
      });
      // Not named, not counted: nothing in the answer stands for it.
      expect(JSON.stringify(result.body)).not.toContain(PUBLIC_PAGE);
      expect(JSON.stringify(result.body)).not.toContain("Acme Public");
    });

    it("the label narrowing reached the status page read: it asked only for pages carrying the label", async () => {
      await send({ userId: EU_PAGES_ONLY_IN_A, tenantId: PROJECT_A });

      const statusPageReads: Array<Dictionary<unknown>> =
        queriesAsked["StatusPage"] || [];

      expect(
        statusPageReads.some((where: Dictionary<unknown>): boolean => {
          return where["labels"] !== undefined;
        }),
      ).toBe(true);
    });

    it("a monitor outside the labels the caller's monitor access is limited to is not looked up", async () => {
      // Only the API monitor is readable; the database and cache monitors are not.
      const result: HttpResult = await send({
        userId: API_MONITORS_ONLY_IN_A,
        tenantId: PROJECT_A,
      });

      expect(namesIn(result)).toEqual(["Acme Public", "EU Status"]);

      // The resource lookup was asked about the API monitor alone.
      const lookedUp: Array<string> = (queriesAsked["StatusPageResource"] || [])
        .filter((where: Dictionary<unknown>): boolean => {
          return where["monitorId"] !== undefined;
        })
        .flatMap((where: Dictionary<unknown>): Array<string> => {
          return Object.values(
            (where["monitorId"] as FindOperator<unknown>)
              .objectLiteralParameters || {},
          )
            .flat()
            .map((id: unknown): string => {
              return String(id);
            });
        });

      expect(lookedUp).toEqual([API_MONITOR]);
    });

    it("a caller who cannot read status pages hears of none", async () => {
      expect(
        namesIn(
          await send({ userId: MONITORS_ONLY_IN_A, tenantId: PROJECT_A }),
        ),
      ).toEqual([]);
    });

    it("a team block on reading status pages wins over a broader role", async () => {
      expect(
        namesIn(
          await send({ userId: BLOCKED_FROM_PAGES_IN_A, tenantId: PROJECT_A }),
        ),
      ).toEqual([]);
    });

    it("a caller who cannot read monitors hears of no page, and nothing is looked up", async () => {
      expect(
        namesIn(await send({ userId: PAGES_ONLY_IN_A, tenantId: PROJECT_A })),
      ).toEqual([]);
      expect(queriesAsked["StatusPageResource"]).toBeUndefined();
      expect(queriesAsked["StatusPage"]).toBeUndefined();
    });

    it("another project's member asking about this project's monitors in their own project hears of nothing", async () => {
      expect(
        namesIn(
          await send({
            userId: OWNER_IN_B,
            tenantId: PROJECT_B,
            body: { monitorIds: [API_MONITOR, DB_MONITOR, CACHE_MONITOR] },
          }),
        ),
      ).toEqual([]);
      expect(queriesAsked["StatusPageResource"]).toBeUndefined();
    });
  });

  describe("the request", () => {
    it("refuses a body without a list of monitors", async () => {
      for (const body of [{}, { monitorIds: API_MONITOR }]) {
        const result: HttpResult = await send({
          userId: MEMBER_IN_A,
          tenantId: PROJECT_A,
          body: body,
        });

        expect(result.status).toBe(400);
        expect(JSON.stringify(result.body)).toContain(
          "monitorIds must be a list of IDs.",
        );
      }
    });

    it("refuses more than 1000 monitors", async () => {
      const result: HttpResult = await send({
        userId: MEMBER_IN_A,
        tenantId: PROJECT_A,
        body: {
          monitorIds: Array.from(
            { length: StatusPagesListingMonitors.maxIdsPerRequest + 1 },
            (_value: unknown, index: number): string => {
              return `c0000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
            },
          ),
        },
      });

      expect(result.status).toBe(400);
      expect(JSON.stringify(result.body)).toContain(
        "monitorIds can list at most 1000 IDs.",
      );
      expect(queriesAsked).toEqual({});
    });

    it("refuses an id that is not one, and a kind of event it does not suggest pages for", async () => {
      const badId: HttpResult = await send({
        userId: MEMBER_IN_A,
        tenantId: PROJECT_A,
        body: { monitorIds: ["not-an-id"] },
      });

      expect(badId.status).toBe(400);

      const incident: HttpResult = await send({
        userId: MEMBER_IN_A,
        tenantId: PROJECT_A,
        body: {
          monitorIds: [API_MONITOR],
          eventType: StatusPageEventType.Incident,
        },
      });

      expect(incident.status).toBe(400);
      expect(queriesAsked).toEqual({});
    });
  });
});
