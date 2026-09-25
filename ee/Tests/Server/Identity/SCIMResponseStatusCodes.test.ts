import StatusPageSCIMRouter from "../../../Server/Identity/API/StatusPageSCIM";
import ProjectSCIMRouter from "../../../Server/Identity/API/SCIM";
import {
  createProjectSCIMLog,
  createStatusPageSCIMLog,
} from "../../../Server/Identity/Utils/SCIMLogger";
import StatusPagePrivateUserService from "Common/Server/Services/StatusPagePrivateUserService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import TeamService from "Common/Server/Services/TeamService";
import UserService from "Common/Server/Services/UserService";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "Common/Server/Utils/Express";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { createServer, Server } from "http";
import { AddressInfo } from "net";

/*
 * RFC 7644 says what status each SCIM operation answers with: 201 Created for
 * a POST that creates a resource (section 3.3), 204 No Content with no body
 * for a DELETE (section 3.6), and 400 for a Bulk request the server will not
 * process (section 3.12). IdPs read these codes, so this suite drives the
 * real routers over HTTP and asserts on the status the client actually gets,
 * and that the SCIM log records that same status.
 *
 * Response.sendJsonObjectResponse sends 200 unless it is given a statusCode,
 * which is how every case here used to answer 200.
 *
 * Every SCIM route starts with the license gate (IdentityLicenseGates.test.ts
 * covers it), so this suite runs as a self-hosted Enterprise install whose
 * license covers SCIM: billing pinned off (CI's config.env sets
 * BILLING_ENABLED=true), and a fake enterprise module with a valid license.
 */
jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

jest.mock("../../../Server/Identity/Middleware/SCIMAuthorization", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedSCIMRequest: (
        _req: ExpressRequest,
        _res: ExpressResponse,
        next: NextFunction,
      ): void => {
        next();
      },
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
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

jest.mock("Common/Server/Services/StatusPagePrivateUserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      create: jest.fn(),
      deleteOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      findOneById: jest.fn(),
      createByEmail: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      findBy: jest.fn(),
      create: jest.fn(),
      deleteBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/TeamService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      findOneById: jest.fn(),
      create: jest.fn(),
      deleteBy: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Identity/Utils/SCIMLogger", () => {
  return {
    createStatusPageSCIMLog: jest.fn().mockResolvedValue(undefined),
    createProjectSCIMLog: jest.fn().mockResolvedValue(undefined),
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SCIM_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const TEAM_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const GROUP_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const EMAIL: string = "new.user@example.com";
const GROUP_NAME: string = "Engineering";
const BULK_SCHEMA: string = "urn:ietf:params:scim:api:messages:2.0:BulkRequest";
const ERROR_SCHEMA: string = "urn:ietf:params:scim:api:messages:2.0:Error";

const privateUserService: {
  findOneBy: jest.Mock;
  create: jest.Mock;
  deleteOneById: jest.Mock;
} = StatusPagePrivateUserService as unknown as {
  findOneBy: jest.Mock;
  create: jest.Mock;
  deleteOneById: jest.Mock;
};
const userService: {
  findOneBy: jest.Mock;
  findOneById: jest.Mock;
  createByEmail: jest.Mock;
} = UserService as unknown as {
  findOneBy: jest.Mock;
  findOneById: jest.Mock;
  createByEmail: jest.Mock;
};
const teamMemberService: {
  findOneBy: jest.Mock;
  findBy: jest.Mock;
  create: jest.Mock;
  deleteBy: jest.Mock;
} = TeamMemberService as unknown as {
  findOneBy: jest.Mock;
  findBy: jest.Mock;
  create: jest.Mock;
  deleteBy: jest.Mock;
};
const teamService: {
  findOneBy: jest.Mock;
  findOneById: jest.Mock;
  create: jest.Mock;
  deleteBy: jest.Mock;
} = TeamService as unknown as {
  findOneBy: jest.Mock;
  findOneById: jest.Mock;
  create: jest.Mock;
  deleteBy: jest.Mock;
};

let statusPageConfig: StatusPageSCIM;
let projectConfig: ProjectSCIM;
let group: Team;
let httpServer: Server;
let baseUrl: string;

interface HttpResult {
  status: number;
  // The raw body, so a 204 can be shown to carry nothing at all.
  text: string;
  body: JSONObject;
}

type Scope = "status-page" | "project";

function scimPath(scope: Scope, resource: string): string {
  const prefix: string = scope === "status-page" ? "status-page-scim" : "scim";
  return `/${prefix}/v2/${SCIM_ID}/${resource}`;
}

async function send(
  method: string,
  path: string,
  body?: JSONObject,
): Promise<HttpResult> {
  const response: globalThis.Response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/scim+json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text: string = await response.text();
  return {
    status: response.status,
    text,
    body: text ? (JSON.parse(text) as JSONObject) : {},
  };
}

function scimLogFor(scope: Scope): jest.Mock {
  return (
    scope === "status-page" ? createStatusPageSCIMLog : createProjectSCIMLog
  ) as jest.Mock;
}

function expectLoggedStatus(
  scope: Scope,
  operationType: string,
  httpStatusCode: number,
): void {
  expect(scimLogFor(scope)).toHaveBeenCalledTimes(1);
  expect(scimLogFor(scope)).toHaveBeenCalledWith(
    expect.objectContaining({ operationType, httpStatusCode }),
  );
}

function expectNoContent(result: HttpResult): void {
  expect(result.status).toBe(204);
  expect(result.text).toBe("");
}

beforeAll(async () => {
  setTestBillingEnabled(false);
  installFakeEnterpriseModule({
    snapshot: createLicenseSnapshotWithStatus("valid"),
  });

  const app: ExpressApplication = createExpressApp();
  app.use(ExpressJson({ type: ["application/json", "application/scim+json"] }));
  app.use(
    (req: ExpressRequest, _res: ExpressResponse, next: NextFunction): void => {
      (req as OneUptimeRequest).bearerTokenData = {
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        scimConfig: req.path.startsWith("/status-page-scim/")
          ? statusPageConfig
          : projectConfig,
      };
      next();
    },
  );
  app.use(StatusPageSCIMRouter);
  app.use(ProjectSCIMRouter);
  app.use(
    (
      error: Error,
      _req: ExpressRequest,
      res: ExpressResponse,
      _next: NextFunction,
    ): void => {
      res
        .status(error instanceof NotFoundException ? 404 : 500)
        .json({ error: error.message });
    },
  );
  httpServer = createServer(app);
  await new Promise<void>((resolve: () => void) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  uninstallEnterpriseModule();

  if (httpServer) {
    await new Promise<void>(
      (resolve: () => void, reject: (error: Error) => void) => {
        httpServer.close((error?: Error): void => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      },
    );
  }
});

beforeEach(() => {
  jest.clearAllMocks();

  statusPageConfig = new StatusPageSCIM(SCIM_ID);
  statusPageConfig.autoProvisionUsers = true;
  statusPageConfig.autoDeprovisionUsers = true;

  projectConfig = new ProjectSCIM(SCIM_ID);
  projectConfig.autoProvisionUsers = true;
  projectConfig.autoDeprovisionUsers = true;
  projectConfig.enablePushGroups = false;
  projectConfig.teams = [new Team(TEAM_ID)];

  const privateUser: StatusPagePrivateUser = new StatusPagePrivateUser(USER_ID);
  privateUser.email = new Email(EMAIL);
  privateUser.statusPageId = STATUS_PAGE_ID;
  privateUser.projectId = PROJECT_ID;
  privateUserService.findOneBy.mockResolvedValue(privateUser);
  privateUserService.create.mockResolvedValue(privateUser);
  privateUserService.deleteOneById.mockResolvedValue(undefined);

  const user: User = new User(USER_ID);
  user.email = new Email(EMAIL);
  user.name = new Name("New User");
  userService.findOneBy.mockResolvedValue(null);
  userService.findOneById.mockResolvedValue(user);
  userService.createByEmail.mockResolvedValue(user);

  group = new Team(GROUP_ID);
  group.name = GROUP_NAME;
  group.projectId = PROJECT_ID;
  group.isTeamDeleteable = true;
  teamService.findOneBy.mockResolvedValue(null);
  teamService.findOneById.mockResolvedValue(group);
  teamService.create.mockResolvedValue(group);
  teamService.deleteBy.mockResolvedValue(undefined);

  teamMemberService.findOneBy.mockResolvedValue(null);
  teamMemberService.findBy.mockResolvedValue([]);
  teamMemberService.create.mockResolvedValue(undefined);
  teamMemberService.deleteBy.mockResolvedValue(undefined);
});

describe.each<Scope>(["project", "status-page"])(
  "%s SCIM Users",
  (scope: Scope) => {
    test("POST /Users answers 201 Created with the new user", async () => {
      privateUserService.findOneBy.mockResolvedValue(null);

      const result: HttpResult = await send("POST", scimPath(scope, "Users"), {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: EMAIL,
      });

      expect(result.status).toBe(201);
      expect(result.body["id"]).toBe(USER_ID.toString());
      expect(result.body["userName"]).toBe(EMAIL);
      expectLoggedStatus(scope, "CreateUser", 201);
    });

    test("DELETE /Users/:id answers 204 No Content with no body", async () => {
      const result: HttpResult = await send(
        "DELETE",
        scimPath(scope, `Users/${USER_ID}`),
      );

      expectNoContent(result);
      expectLoggedStatus(scope, "DeleteUser", 204);
    });

    test("a Bulk request that fails validation answers 400 with a SCIM error", async () => {
      const result: HttpResult = await send("POST", scimPath(scope, "Bulk"), {
        schemas: [BULK_SCHEMA],
        Operations: [],
      });

      expect(result.status).toBe(400);
      expect(result.body).toEqual({
        schemas: [ERROR_SCHEMA],
        status: "400",
        scimType: "invalidValue",
        detail: "At least one operation is required",
      });
      expectLoggedStatus(scope, "BulkOperation", 400);
    });

    test("a Bulk request that is processed still answers 200 with each operation's status", async () => {
      const result: HttpResult = await send("POST", scimPath(scope, "Bulk"), {
        schemas: [BULK_SCHEMA],
        Operations: [{ method: "DELETE", path: `/Users/${USER_ID}` }],
      });

      expect(result.status).toBe(200);
      expect(result.body["Operations"]).toEqual([
        expect.objectContaining({ method: "DELETE", status: "204" }),
      ]);
      expectLoggedStatus(scope, "BulkOperation", 200);
    });
  },
);

describe("project SCIM Groups", () => {
  test("POST /Groups answers 201 Created when it creates the team", async () => {
    const result: HttpResult = await send(
      "POST",
      scimPath("project", "Groups"),
      { displayName: GROUP_NAME },
    );

    expect(result.status).toBe(201);
    expect(result.body["id"]).toBe(GROUP_ID.toString());
    expect(result.body["displayName"]).toBe(GROUP_NAME);
    expect(teamService.create).toHaveBeenCalledTimes(1);
    expectLoggedStatus("project", "CreateGroup", 201);
  });

  test("POST /Groups answers 200 when a team of that name already exists", async () => {
    const existing: Team = new Team(GROUP_ID);
    existing.name = GROUP_NAME;
    existing.projectId = PROJECT_ID;
    teamService.findOneBy.mockResolvedValue(existing);

    const result: HttpResult = await send(
      "POST",
      scimPath("project", "Groups"),
      { displayName: GROUP_NAME },
    );

    expect(result.status).toBe(200);
    expect(result.body["id"]).toBe(GROUP_ID.toString());
    expect(teamService.create).not.toHaveBeenCalled();
    expectLoggedStatus("project", "CreateGroup", 200);
  });

  test("DELETE /Groups/:id answers 204 No Content with no body", async () => {
    teamService.findOneBy.mockResolvedValue(group);

    const result: HttpResult = await send(
      "DELETE",
      scimPath("project", `Groups/${GROUP_ID}`),
    );

    expectNoContent(result);
    expect(teamService.deleteBy).toHaveBeenCalledTimes(1);
    expectLoggedStatus("project", "DeleteGroup", 204);
  });
});
