import StatusPageSCIMRouter from "../../../Server/Identity/API/StatusPageSCIM";
import ProjectSCIMRouter from "../../../Server/Identity/API/SCIM";
import {
  createProjectSCIMLog,
  createStatusPageSCIMLog,
} from "../../../Server/Identity/Utils/SCIMLogger";
import StatusPagePrivateUserService from "Common/Server/Services/StatusPagePrivateUserService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
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
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import FakeEnterpriseModule, {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { createServer, Server } from "http";
import { AddressInfo } from "net";

/*
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
      findOneById: jest.fn(),
      deleteOneById: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      updateOneById: jest.fn(),
      deleteOneById: jest.fn(),
      deleteBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      deleteBy: jest.fn(),
      create: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/TeamService", () => {
  return { __esModule: true, default: {} };
});

jest.mock("../../../Server/Identity/Utils/SCIMLogger", () => {
  return {
    createStatusPageSCIMLog: jest.fn().mockResolvedValue(undefined),
    createProjectSCIMLog: jest.fn().mockResolvedValue(undefined),
  };
});

/*
 * Exercise real HTTP routing, JSON parsing, PatchOp extraction and responses.
 * Authentication has already supplied the tenant context; persistence and
 * audit-log writes are mocked so every test can prove which user or team
 * memberships the request actually asks the services to change.
 */
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SCIM_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const TEAM_IDS: ObjectID[] = [
  new ObjectID("55555555-5555-4555-8555-555555555555"),
  new ObjectID("66666666-6666-4666-8666-666666666666"),
];
const ORIGINAL_EMAIL: string = "before@example.com";
const UPDATED_EMAIL: string = "after@example.com";
const PATCH_SCHEMA: string = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const BULK_SCHEMA: string = "urn:ietf:params:scim:api:messages:2.0:BulkRequest";

interface MockUserService {
  findOneBy: jest.Mock;
  findOneById: jest.Mock;
  deleteOneById: jest.Mock;
  updateOneById: jest.Mock;
}

const privateUserService: MockUserService =
  StatusPagePrivateUserService as unknown as MockUserService;
const projectUserService: {
  findOneById: jest.Mock;
  updateOneById: jest.Mock;
  deleteOneById: jest.Mock;
  deleteBy: jest.Mock;
} = UserService as unknown as {
  findOneById: jest.Mock;
  updateOneById: jest.Mock;
  deleteOneById: jest.Mock;
  deleteBy: jest.Mock;
};
const teamMemberService: {
  findOneBy: jest.Mock;
  deleteBy: jest.Mock;
  create: jest.Mock;
} = TeamMemberService as unknown as {
  findOneBy: jest.Mock;
  deleteBy: jest.Mock;
  create: jest.Mock;
};

let statusPageConfig: StatusPageSCIM;
let projectConfig: ProjectSCIM;
let privateUser: StatusPagePrivateUser;
let projectUser: User;
let httpServer: Server;
let baseUrl: string;
let enterpriseModule: FakeEnterpriseModule;

interface HttpResult {
  status: number;
  body: JSONObject;
}

function patch(...operations: JSONObject[]): JSONObject {
  return { schemas: [PATCH_SCHEMA], Operations: operations };
}

function userPath(scope: "status-page" | "project"): string {
  const prefix: string = scope === "status-page" ? "status-page-scim" : "scim";
  return `/${prefix}/v2/${SCIM_ID}/Users/${USER_ID}`;
}

async function send(
  method: string,
  path: string,
  body: JSONObject,
): Promise<HttpResult> {
  const response: globalThis.Response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/scim+json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as JSONObject,
  };
}

async function sendBulk(method: string, body: JSONObject): Promise<HttpResult> {
  return send("POST", `/status-page-scim/v2/${SCIM_ID}/Bulk`, {
    schemas: [BULK_SCHEMA],
    Operations: [{ method, path: `/Users/${USER_ID}`, data: body }],
  });
}

function expectPrivateUserDeleted(): void {
  expect(privateUserService.deleteOneById).toHaveBeenCalledTimes(1);
  expect(privateUserService.deleteOneById).toHaveBeenCalledWith({
    id: USER_ID,
    props: { isRoot: true },
  });
  expect(privateUserService.updateOneById).not.toHaveBeenCalled();
  expect(projectUserService.deleteOneById).not.toHaveBeenCalled();
}

function expectProjectAccountRetained(): void {
  expect(projectUserService.deleteOneById).not.toHaveBeenCalled();
  expect(projectUserService.deleteBy).not.toHaveBeenCalled();
  expect(privateUserService.deleteOneById).not.toHaveBeenCalled();
}

beforeAll(async () => {
  setTestBillingEnabled(false);
  enterpriseModule = installFakeEnterpriseModule({
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
  statusPageConfig.autoDeprovisionUsers = true;
  projectConfig = new ProjectSCIM(SCIM_ID);
  projectConfig.autoDeprovisionUsers = true;
  projectConfig.enablePushGroups = false;
  projectConfig.teams = TEAM_IDS.map((id: ObjectID): Team => {
    return new Team(id);
  });

  privateUser = new StatusPagePrivateUser(USER_ID);
  privateUser.email = new Email(ORIGINAL_EMAIL);
  privateUser.statusPageId = STATUS_PAGE_ID;
  privateUser.projectId = PROJECT_ID;
  privateUserService.findOneBy.mockResolvedValue(privateUser);
  privateUserService.findOneById.mockResolvedValue(privateUser);
  privateUserService.deleteOneById.mockResolvedValue(undefined);
  privateUserService.updateOneById.mockResolvedValue(undefined);

  projectUser = new User(USER_ID);
  projectUser.email = new Email(ORIGINAL_EMAIL);
  projectUser.name = new Name("Existing User");
  const membership: TeamMember = new TeamMember();
  membership.userId = USER_ID;
  membership.user = projectUser;
  membership.projectId = PROJECT_ID;
  teamMemberService.findOneBy.mockResolvedValue(membership);
  teamMemberService.deleteBy.mockResolvedValue(undefined);
  projectUserService.findOneById.mockResolvedValue(projectUser);
  projectUserService.updateOneById.mockResolvedValue(undefined);
});

interface UpdateCase {
  label: string;
  method: "PUT" | "PATCH";
  body: JSONObject;
}

const deactivationCases: UpdateCase[] = [
  {
    label: "Entra ID Replace active=false",
    method: "PATCH",
    body: patch({ op: "Replace", path: "active", value: false }),
  },
  {
    label: "string False",
    method: "PATCH",
    body: patch({ op: "replace", path: "active", value: "False" }),
  },
  {
    label: "mixed-case Add active=false",
    method: "PATCH",
    body: patch({ op: "aDd", path: "active", value: false }),
  },
  {
    label: "object-valued Replace without a path",
    method: "PATCH",
    body: patch({ op: "REPLACE", value: { active: false } }),
  },
  {
    label: "Okta full-resource PUT active=false",
    method: "PUT",
    body: { userName: ORIGINAL_EMAIL, active: false },
  },
  {
    label: "full-resource PUT string False",
    method: "PUT",
    body: { userName: ORIGINAL_EMAIL, active: "False" },
  },
];

const emailCases: UpdateCase[] = [
  {
    label: "work-email value path",
    method: "PATCH",
    body: patch({
      op: "Replace",
      path: 'emails[type eq "work"].value',
      value: UPDATED_EMAIL,
    }),
  },
  {
    label: "emails array path",
    method: "PATCH",
    body: patch({
      op: "replace",
      path: "emails",
      value: [{ type: "work", value: UPDATED_EMAIL }],
    }),
  },
  {
    label: "userName path",
    method: "PATCH",
    body: patch({ op: "Replace", path: "userName", value: UPDATED_EMAIL }),
  },
  {
    label: "no-path email replacement",
    method: "PATCH",
    body: patch({
      op: "Replace",
      value: { emails: [{ type: "work", value: UPDATED_EMAIL }] },
    }),
  },
  {
    label: "full-resource PUT email replacement",
    method: "PUT",
    body: { userName: UPDATED_EMAIL, active: true },
  },
];

describe("Status Page SCIM single-user PUT/PATCH", () => {
  test.each(deactivationCases)(
    "deletes the private user for $label",
    async ({ method, body }: UpdateCase) => {
      const result: HttpResult = await send(
        method,
        userPath("status-page"),
        body,
      );

      expect(result).toEqual({ status: 200, body: {} });
      expectPrivateUserDeleted();
      expect(privateUserService.findOneBy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { statusPageId: STATUS_PAGE_ID, _id: USER_ID },
        }),
      );
      expect(createStatusPageSCIMLog).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: body,
          additionalContext: { action: "deactivation", userRemoved: true },
        }),
      );
    },
  );

  test.each(deactivationCases)(
    "retains the private user and logs disabled deprovisioning for $label",
    async ({ method, body }: UpdateCase) => {
      statusPageConfig.autoDeprovisionUsers = false;
      const result: HttpResult = await send(
        method,
        userPath("status-page"),
        body,
      );

      expect(result.status).toBe(200);
      expect(result.body["id"]).toBe(USER_ID.toString());
      expect(result.body["active"]).toBe(true);
      expect(privateUserService.deleteOneById).not.toHaveBeenCalled();
      expect(privateUserService.updateOneById).not.toHaveBeenCalled();
      expect(createStatusPageSCIMLog).toHaveBeenCalledWith(
        expect.objectContaining({
          steps: expect.arrayContaining([
            expect.stringMatching(/Auto-deprovisioning is disabled/i),
          ]),
        }),
      );
    },
  );

  test.each(emailCases)(
    "persists and returns the new email for $label",
    async ({ method, body }: UpdateCase) => {
      const updatedUser: StatusPagePrivateUser = new StatusPagePrivateUser(
        USER_ID,
      );
      updatedUser.email = new Email(UPDATED_EMAIL);
      privateUserService.findOneById.mockResolvedValue(updatedUser);

      const result: HttpResult = await send(
        method,
        userPath("status-page"),
        body,
      );

      expect(result.status).toBe(200);
      expect(result.body["userName"]).toBe(UPDATED_EMAIL);
      expect(privateUserService.updateOneById).toHaveBeenCalledTimes(1);
      expect(privateUserService.updateOneById).toHaveBeenCalledWith({
        id: USER_ID,
        data: { email: new Email(UPDATED_EMAIL) },
        props: { isRoot: true },
      });
      expect(privateUserService.deleteOneById).not.toHaveBeenCalled();
    },
  );

  test("does not treat removal of active as active=false", async () => {
    const result: HttpResult = await send(
      "PATCH",
      userPath("status-page"),
      patch({ op: "Remove", path: "active" }),
    );

    expect(result.status).toBe(200);
    expect(result.body["active"]).toBe(true);
    expect(privateUserService.deleteOneById).not.toHaveBeenCalled();
  });

  test("does not delete a private user outside the authenticated status page", async () => {
    privateUserService.findOneBy.mockResolvedValue(null);

    const result: HttpResult = await send(
      "PATCH",
      userPath("status-page"),
      patch({ op: "Replace", path: "active", value: false }),
    );

    expect(result.status).toBe(404);
    expect(privateUserService.deleteOneById).not.toHaveBeenCalled();
    expect(privateUserService.updateOneById).not.toHaveBeenCalled();
  });
});

describe("Status Page SCIM Bulk PUT/PATCH", () => {
  test.each(deactivationCases)(
    "deletes the private user and counts deactivation for $label",
    async ({ method, body }: UpdateCase) => {
      const result: HttpResult = await sendBulk(method, body);

      expect(result.status).toBe(200);
      expect(result.body["Operations"]).toEqual([
        expect.objectContaining({ method, status: "204" }),
      ]);
      expectPrivateUserDeleted();
      expect(createStatusPageSCIMLog).toHaveBeenCalledWith(
        expect.objectContaining({
          additionalContext: expect.objectContaining({
            usersDeactivated: 1,
            usersUpdated: 0,
            errorCount: 0,
          }),
        }),
      );
    },
  );

  test.each(deactivationCases)(
    "retains the private user and logs disabled deprovisioning for $label",
    async ({ method, body }: UpdateCase) => {
      statusPageConfig.autoDeprovisionUsers = false;

      const result: HttpResult = await sendBulk(method, body);

      expect(result.status).toBe(200);
      expect(result.body["Operations"]).toEqual([
        expect.objectContaining({
          status: "200",
          response: expect.objectContaining({
            id: USER_ID.toString(),
            active: true,
          }),
        }),
      ]);
      expect(privateUserService.deleteOneById).not.toHaveBeenCalled();
      expect(privateUserService.updateOneById).not.toHaveBeenCalled();
      expect(createStatusPageSCIMLog).toHaveBeenCalledWith(
        expect.objectContaining({
          steps: expect.arrayContaining([
            expect.stringMatching(/Auto-deprovisioning is disabled/i),
          ]),
          additionalContext: expect.objectContaining({ usersDeactivated: 0 }),
        }),
      );
    },
  );

  test.each(emailCases)(
    "persists and returns the new email for $label",
    async ({ method, body }: UpdateCase) => {
      const updatedUser: StatusPagePrivateUser = new StatusPagePrivateUser(
        USER_ID,
      );
      updatedUser.email = new Email(UPDATED_EMAIL);
      privateUserService.findOneById.mockResolvedValue(updatedUser);

      const result: HttpResult = await sendBulk(method, body);

      expect(result.status).toBe(200);
      expect(result.body["Operations"]).toEqual([
        expect.objectContaining({
          status: "200",
          response: expect.objectContaining({ userName: UPDATED_EMAIL }),
        }),
      ]);
      expect(privateUserService.updateOneById).toHaveBeenCalledWith({
        id: USER_ID,
        data: { email: new Email(UPDATED_EMAIL) },
        props: { isRoot: true },
      });
      expect(privateUserService.deleteOneById).not.toHaveBeenCalled();
    },
  );

  test("keeps deactivation and email updates separate within the same bulk request", async () => {
    const secondUserId: ObjectID = new ObjectID(
      "77777777-7777-4777-8777-777777777777",
    );
    const secondUser: StatusPagePrivateUser = new StatusPagePrivateUser(
      secondUserId,
    );
    secondUser.email = new Email(ORIGINAL_EMAIL);
    const updatedSecondUser: StatusPagePrivateUser = new StatusPagePrivateUser(
      secondUserId,
    );
    updatedSecondUser.email = new Email(UPDATED_EMAIL);
    privateUserService.findOneBy
      .mockResolvedValueOnce(privateUser)
      .mockResolvedValueOnce(secondUser);
    privateUserService.findOneById.mockResolvedValue(updatedSecondUser);
    const result: HttpResult = await send(
      "POST",
      `/status-page-scim/v2/${SCIM_ID}/Bulk`,
      {
        schemas: [BULK_SCHEMA],
        Operations: [
          {
            method: "PATCH",
            path: `/Users/${USER_ID}`,
            data: patch({ op: "Replace", path: "active", value: false }),
          },
          {
            method: "PATCH",
            path: `/Users/${secondUserId}`,
            data: patch({
              op: "Replace",
              path: "userName",
              value: UPDATED_EMAIL,
            }),
          },
        ],
      },
    );

    expect(result.status).toBe(200);
    expect(
      (result.body["Operations"] as JSONObject[]).map(
        (operation: JSONObject) => {
          return operation["status"];
        },
      ),
    ).toEqual(["204", "200"]);
    expect(privateUserService.deleteOneById).toHaveBeenCalledWith({
      id: USER_ID,
      props: { isRoot: true },
    });
    expect(privateUserService.updateOneById).toHaveBeenCalledWith({
      id: secondUserId,
      data: { email: new Email(UPDATED_EMAIL) },
      props: { isRoot: true },
    });
    expect(createStatusPageSCIMLog).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalContext: expect.objectContaining({
          usersDeactivated: 1,
          usersUpdated: 1,
        }),
      }),
    );
  });
});

describe("while the license is lapsed, the real SCIM handlers never run", () => {
  afterEach(() => {
    enterpriseModule.setSnapshot(createLicenseSnapshotWithStatus("valid"));
  });

  test.each(["status-page", "project"] as const)(
    "%s: a deactivation is refused with a SCIM error, changes nothing, and works again after renewal",
    async (scope: "status-page" | "project") => {
      const deactivate: JSONObject = patch({
        op: "Replace",
        path: "active",
        value: false,
      });

      enterpriseModule.setSnapshot(createLicenseSnapshotWithStatus("expired"));

      const refused: HttpResult = await send(
        "PATCH",
        userPath(scope),
        deactivate,
      );

      expect(refused.status).toBe(403);
      expect(refused.body["schemas"]).toEqual([
        "urn:ietf:params:scim:api:messages:2.0:Error",
      ]);
      expect(privateUserService.findOneBy).not.toHaveBeenCalled();
      expect(privateUserService.deleteOneById).not.toHaveBeenCalled();
      expect(projectUserService.findOneById).not.toHaveBeenCalled();
      expect(teamMemberService.deleteBy).not.toHaveBeenCalled();
      expect(createStatusPageSCIMLog).not.toHaveBeenCalled();
      expect(createProjectSCIMLog).not.toHaveBeenCalled();

      // Renewed: the very same request is handled, with no restart.
      enterpriseModule.setSnapshot(createLicenseSnapshotWithStatus("valid"));

      const handled: HttpResult = await send(
        "PATCH",
        userPath(scope),
        deactivate,
      );

      expect(handled.status).toBe(200);

      if (scope === "status-page") {
        expectPrivateUserDeleted();
      } else {
        expect(teamMemberService.deleteBy).toHaveBeenCalledTimes(1);
      }
    },
  );
});

describe("Project SCIM user PATCH", () => {
  test.each(deactivationCases)(
    "removes configured team memberships and preserves the account for $label",
    async ({ method, body }: UpdateCase) => {
      const result: HttpResult = await send(method, userPath("project"), body);

      expect(result.status).toBe(200);
      expect(result.body["id"]).toBe(USER_ID.toString());
      expect(teamMemberService.deleteBy).toHaveBeenCalledTimes(1);
      expect(teamMemberService.deleteBy).toHaveBeenCalledWith({
        query: {
          projectId: PROJECT_ID,
          userId: USER_ID,
          teamId: expect.anything(),
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });
      const deletion: {
        query: {
          teamId: { objectLiteralParameters: Record<string, string[]> };
        };
      } = teamMemberService.deleteBy.mock.calls[0]![0];
      expect(
        Object.values(deletion.query.teamId.objectLiteralParameters),
      ).toEqual([
        TEAM_IDS.map((id: ObjectID): string => {
          return id.toString();
        }),
      ]);
      expectProjectAccountRetained();
      expect(createProjectSCIMLog).toHaveBeenCalledWith(
        expect.objectContaining({
          additionalContext: expect.objectContaining({
            activeStatus: false,
            teamOperationPerformed: "removed_from_teams",
          }),
        }),
      );
    },
  );

  test("retains memberships and logs when auto-deprovisioning is disabled", async () => {
    projectConfig.autoDeprovisionUsers = false;

    const result: HttpResult = await send(
      "PATCH",
      userPath("project"),
      patch({ op: "Replace", path: "active", value: false }),
    );

    expect(result.status).toBe(200);
    expect(teamMemberService.deleteBy).not.toHaveBeenCalled();
    expectProjectAccountRetained();
    expect(createProjectSCIMLog).toHaveBeenCalledWith(
      expect.objectContaining({
        steps: expect.arrayContaining([
          expect.stringMatching(/Auto-deprovisioning is disabled/i),
        ]),
        additionalContext: expect.objectContaining({
          teamOperationPerformed: null,
        }),
      }),
    );
  });

  test("leaves group membership to group operations when push groups are enabled", async () => {
    projectConfig.enablePushGroups = true;

    const result: HttpResult = await send(
      "PATCH",
      userPath("project"),
      patch({ op: "Replace", path: "active", value: false }),
    );

    expect(result.status).toBe(200);
    expect(teamMemberService.deleteBy).not.toHaveBeenCalled();
    expectProjectAccountRetained();
  });

  test.each(emailCases)(
    "persists and returns the new email for $label",
    async ({ method, body }: UpdateCase) => {
      const updatedUser: User = new User(USER_ID);
      updatedUser.email = new Email(UPDATED_EMAIL);
      projectUserService.findOneById.mockResolvedValue(updatedUser);

      const result: HttpResult = await send(method, userPath("project"), body);

      expect(result.status).toBe(200);
      expect(result.body["userName"]).toBe(UPDATED_EMAIL);
      expect(projectUserService.updateOneById).toHaveBeenCalledWith({
        id: USER_ID,
        data: { email: new Email(UPDATED_EMAIL) },
        props: { isRoot: true },
      });
      expect(teamMemberService.deleteBy).not.toHaveBeenCalled();
      expectProjectAccountRetained();
    },
  );
});
