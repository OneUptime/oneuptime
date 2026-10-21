import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import ProjectSCIMRouter from "../../../Server/Identity/API/SCIM";
import SCIMOAuthTokenRouter from "../../../Server/Identity/API/SCIMOAuthToken";
import StatusPageSCIMRouter from "../../../Server/Identity/API/StatusPageSCIM";
import { ACCESS_TOKEN_SECRET_ENDED_MESSAGE } from "../../../Server/Identity/Middleware/SCIMAuthorization";
import {
  createProjectSCIMLog,
  createStatusPageSCIMLog,
} from "../../../Server/Identity/Utils/SCIMLogger";
import {
  generateScimClientSecret,
  hashScimClientSecret,
} from "../../../Server/Identity/Utils/SCIMOAuth";
import { fakeProjectSCIMUserService } from "./FakeProjectSCIMUserService";
import { scimWorld } from "./InMemorySCIMWorld";
import ProjectSCIMService from "Common/Server/Services/ProjectSCIMService";
import ProjectService from "Common/Server/Services/ProjectService";
import StatusPagePrivateUserService from "Common/Server/Services/StatusPagePrivateUserService";
import StatusPageSCIMService from "Common/Server/Services/StatusPageSCIMService";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
  ExpressUrlEncoded,
} from "Common/Server/Utils/Express";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import Team from "Common/Models/DatabaseModels/Team";
import { PlanType } from "Common/Types/Billing/SubscriptionPlan";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import FakeEnterpriseModule, {
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { createServer, Server } from "http";
import { AddressInfo } from "net";

/*
 * ---------------------------------------------------------------------------
 * THE TOKEN ENDPOINT OF SCIM'S OAUTH 2.0 CLIENT CREDENTIALS, END TO END.
 *
 * Microsoft Entra ID's gallery validation asks POST <token endpoint> for an
 * access token - grant_type=client_credentials, the client ID and secret
 * form-urlencoded into HTTP Basic, or in the form body - and then calls
 * GET /Users?startIndex=1&count=1 with it, which must answer 2xx. It reads
 * access_token and expires_in, which must be 60 minutes to 6 hours.
 *
 * Driven here over HTTP against the real token endpoint, the real SCIM
 * routers and the real SCIM authorization middleware, with the connections
 * and the database in memory.
 * ---------------------------------------------------------------------------
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

jest.mock("../../../Server/Identity/Utils/SCIMLogger", () => {
  return {
    createStatusPageSCIMLog: jest.fn().mockResolvedValue(undefined),
    createProjectSCIMLog: jest.fn().mockResolvedValue(undefined),
  };
});

jest.mock("Common/Server/Services/ProjectSCIMUserService", () => {
  const fake: typeof import("./FakeProjectSCIMUserService") =
    jest.requireActual(
      "./FakeProjectSCIMUserService",
    ) as typeof import("./FakeProjectSCIMUserService");

  return { __esModule: true, default: fake.fakeProjectSCIMUserService };
});

jest.mock("Common/Server/Services/UserService", () => {
  const world: typeof import("./InMemorySCIMWorld") = jest.requireActual(
    "./InMemorySCIMWorld",
  ) as typeof import("./InMemorySCIMWorld");

  return { __esModule: true, default: world.fakeUserService };
});

jest.mock("Common/Server/Services/TeamMemberService", () => {
  const world: typeof import("./InMemorySCIMWorld") = jest.requireActual(
    "./InMemorySCIMWorld",
  ) as typeof import("./InMemorySCIMWorld");

  return { __esModule: true, default: world.fakeTeamMemberService };
});

jest.mock("Common/Server/Services/TeamService", () => {
  const world: typeof import("./InMemorySCIMWorld") = jest.requireActual(
    "./InMemorySCIMWorld",
  ) as typeof import("./InMemorySCIMWorld");

  return { __esModule: true, default: world.fakeTeamService };
});

const PROJECT_ID: string = "1a000000-0000-4000-8000-000000000001";
const PROJECT_SCIM_ID: string = "1a000000-0000-4000-8000-000000000002";
const OTHER_PROJECT_SCIM_ID: string = "1a000000-0000-4000-8000-000000000003";
const STATUS_PAGE_ID: string = "1a000000-0000-4000-8000-000000000004";
const STATUS_PAGE_SCIM_ID: string = "1a000000-0000-4000-8000-000000000005";
const BEARER_TOKEN: string = "b".repeat(64);
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const ERROR_SCHEMA: string = "urn:ietf:params:scim:api:messages:2.0:Error";

let enterpriseModule: FakeEnterpriseModule;
let httpServer: Server;
let baseUrl: string;
let currentPlan: PlanType;
let secret: string;
let previousSecret: string;
let projectConnections: Map<string, ProjectSCIM>;
let statusPageConnection: StatusPageSCIM;

interface HttpResult {
  status: number;
  headers: Headers;
  body: JSONObject;
}

async function call(
  method: string,
  path: string,
  options: {
    authorization?: string;
    form?: Record<string, string>;
  } = {},
): Promise<HttpResult> {
  const headers: Record<string, string> = {};

  if (options.authorization) {
    headers["Authorization"] = options.authorization;
  }

  if (options.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  const response: globalThis.Response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(options.form
      ? { body: new URLSearchParams(options.form).toString() }
      : {}),
  });
  const text: string = await response.text();

  return {
    status: response.status,
    headers: response.headers,
    body: (text ? JSON.parse(text) : {}) as JSONObject,
  };
}

// HTTP Basic as RFC 6749 section 2.3.1 says, and Microsoft Entra ID sends it.
function basic(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(
    `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`,
  ).toString("base64")}`;
}

async function requestToken(
  options: { authorization?: string; form?: Record<string, string> } = {},
): Promise<HttpResult> {
  return call("POST", "/scim/oauth/token", {
    form: { grant_type: "client_credentials", ...(options.form || {}) },
    ...(options.authorization ? { authorization: options.authorization } : {}),
  });
}

async function listUsers(
  scimPath: string,
  accessToken: string,
): Promise<HttpResult> {
  return call("GET", `${scimPath}/Users?startIndex=1&count=1`, {
    authorization: `Bearer ${accessToken}`,
  });
}

const PROJECT_SCIM_PATH: string = `/scim/v2/${PROJECT_SCIM_ID}`;
const STATUS_PAGE_SCIM_PATH: string = `/status-page-scim/v2/${STATUS_PAGE_SCIM_ID}`;

// A connection lookup as the services answer it, by _id and, for a bearer token, the token.
function matches(
  connection: ProjectSCIM | StatusPageSCIM,
  query: Record<string, unknown>,
): boolean {
  if (String(query["_id"]).toLowerCase() !== connection.id!.toString()) {
    return false;
  }

  return (
    query["bearerToken"] === undefined ||
    query["bearerToken"] === connection.bearerToken
  );
}

function projectConnection(id: string): ProjectSCIM {
  const connection: ProjectSCIM = new ProjectSCIM(new ObjectID(id));
  connection.projectId = new ObjectID(PROJECT_ID);
  connection.bearerToken = BEARER_TOKEN;
  connection.autoProvisionUsers = true;
  connection.autoDeprovisionUsers = true;
  connection.enablePushGroups = false;
  connection.teams = [];
  connection.oauthClientSecretHash = hashScimClientSecret(secret);
  connection.oauthClientSecretExpiresAt = new Date(
    Date.now() + 365 * DAY_IN_MS,
  );
  connection.oauthPreviousClientSecretHash =
    hashScimClientSecret(previousSecret);
  connection.oauthPreviousClientSecretExpiresAt = new Date(
    Date.now() + 30 * DAY_IN_MS,
  );
  return connection;
}

beforeAll(async () => {
  enterpriseModule = installFakeEnterpriseModule({
    snapshot: createLicenseSnapshotWithStatus("valid"),
  });

  const app: ExpressApplication = createExpressApp();
  app.use(ExpressJson({ type: ["application/json", "application/scim+json"] }));
  app.use(ExpressUrlEncoded({ extended: true }));
  app.use(SCIMOAuthTokenRouter);
  app.use(ProjectSCIMRouter);
  app.use(StatusPageSCIMRouter);
  httpServer = createServer(app);
  await new Promise<void>((resolve: () => void) => {
    httpServer.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);

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
  setTestBillingEnabled(false);
  enterpriseModule.setSnapshot(createLicenseSnapshotWithStatus("valid"));
  currentPlan = PlanType.Scale;
  scimWorld.reset();
  fakeProjectSCIMUserService.reset();

  secret = generateScimClientSecret();
  previousSecret = generateScimClientSecret();

  projectConnections = new Map<string, ProjectSCIM>([
    [PROJECT_SCIM_ID, projectConnection(PROJECT_SCIM_ID)],
    [OTHER_PROJECT_SCIM_ID, projectConnection(OTHER_PROJECT_SCIM_ID)],
  ]);

  statusPageConnection = new StatusPageSCIM(new ObjectID(STATUS_PAGE_SCIM_ID));
  statusPageConnection.projectId = new ObjectID(PROJECT_ID);
  statusPageConnection.statusPageId = new ObjectID(STATUS_PAGE_ID);
  statusPageConnection.bearerToken = BEARER_TOKEN;
  statusPageConnection.autoProvisionUsers = true;
  statusPageConnection.autoDeprovisionUsers = true;
  statusPageConnection.oauthClientSecretHash = hashScimClientSecret(secret);
  statusPageConnection.oauthClientSecretExpiresAt = new Date(
    Date.now() + 365 * DAY_IN_MS,
  );

  jest
    .spyOn(ProjectSCIMService, "findOneBy")
    .mockImplementation(async (findBy: unknown) => {
      const query: Record<string, unknown> = (
        findBy as { query: Record<string, unknown> }
      ).query;

      for (const connection of projectConnections.values()) {
        if (matches(connection, query)) {
          return connection as never;
        }
      }

      return null as never;
    });

  jest
    .spyOn(StatusPageSCIMService, "findOneBy")
    .mockImplementation(async (findBy: unknown) => {
      const query: Record<string, unknown> = (
        findBy as { query: Record<string, unknown> }
      ).query;

      return (
        matches(statusPageConnection, query) ? statusPageConnection : null
      ) as never;
    });

  jest
    .spyOn(StatusPagePrivateUserService, "findBy")
    .mockResolvedValue([] as never);
  jest.spyOn(StatusPagePrivateUserService, "countBy").mockResolvedValue({
    toNumber: (): number => {
      return 0;
    },
  } as never);

  jest.spyOn(ProjectService, "getCurrentPlan").mockImplementation(async () => {
    return { plan: currentPlan, isSubscriptionUnpaid: false };
  });

  // One member, as GET /Users?count=1 finds.
  const team: string = scimWorld.seedTeam({
    projectId: PROJECT_ID,
    name: "Members",
  });
  const member: string = scimWorld.seedUser({ email: "member@acme.example" });
  scimWorld.seedMembership({
    userId: member,
    projectId: PROJECT_ID,
    teamId: team,
  });
  projectConnections.get(PROJECT_SCIM_ID)!.teams = [
    new Team(new ObjectID(team)),
  ];
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Microsoft Entra ID's credential test", () => {
  test("HTTP Basic with the id and secret form-urlencoded: a token for an hour, then GET /Users with it", async () => {
    const token: HttpResult = await requestToken({
      authorization: basic(PROJECT_SCIM_ID, secret),
    });

    expect(token.status).toBe(200);
    expect(token.body["token_type"]).toBe("Bearer");
    expect(token.body["expires_in"]).toBe(3600);
    expect(typeof token.body["access_token"]).toBe("string");
    expect(token.headers.get("cache-control")).toBe("no-store");
    expect(token.headers.get("pragma")).toBe("no-cache");

    const users: HttpResult = await listUsers(
      PROJECT_SCIM_PATH,
      token.body["access_token"] as string,
    );

    expect(users.status).toBe(200);
    expect(users.body["totalResults"]).toBe(1);
  });

  test("client_id and client_secret in the form body", async () => {
    const token: HttpResult = await requestToken({
      form: { client_id: PROJECT_SCIM_ID, client_secret: secret },
    });

    expect(token.status).toBe(200);
    expect(
      (await listUsers(PROJECT_SCIM_PATH, token.body["access_token"] as string))
        .status,
    ).toBe(200);
  });

  test("a scope is accepted and changes nothing", async () => {
    const token: HttpResult = await requestToken({
      authorization: basic(PROJECT_SCIM_ID, secret),
      form: { scope: "scim" },
    });

    expect(token.status).toBe(200);
  });

  test("the request and its answer are logged for the connection, never the secret or the token", async () => {
    const token: HttpResult = await requestToken({
      authorization: basic(PROJECT_SCIM_ID, secret),
    });

    expect(createProjectSCIMLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: "IssueAccessToken",
        status: "Success",
        httpStatusCode: 200,
      }),
    );

    const logged: string = JSON.stringify(
      (createProjectSCIMLog as unknown as jest.Mock).mock.calls,
    );

    expect(logged).not.toContain(secret);
    expect(logged).not.toContain(token.body["access_token"] as string);
  });
});

describe("refusals, as RFC 6749 section 5.2 words them", () => {
  test("an unknown client: 401 invalid_client, with the scheme it used", async () => {
    for (const clientId of [ObjectID.generate().toString(), "not-a-uuid"]) {
      const token: HttpResult = await requestToken({
        authorization: basic(clientId, secret),
      });

      expect(token.status).toBe(401);
      expect(token.body["error"]).toBe("invalid_client");
      expect(token.headers.get("www-authenticate")).toBe(
        'Basic realm="OneUptime SCIM"',
      );
    }
  });

  test("a wrong secret: 401 invalid_client, logged for the connection's admins", async () => {
    const token: HttpResult = await requestToken({
      form: {
        client_id: PROJECT_SCIM_ID,
        client_secret: generateScimClientSecret(),
      },
    });

    expect(token.status).toBe(401);
    expect(token.body["error"]).toBe("invalid_client");
    expect(token.headers.get("www-authenticate")).toBe(null);
    expect(createProjectSCIMLog).toHaveBeenCalledWith(
      expect.objectContaining({
        operationType: "IssueAccessToken",
        status: "Error",
        httpStatusCode: 401,
      }),
    );
  });

  test("the bearer token is no client secret", async () => {
    expect(
      (
        await requestToken({
          authorization: basic(PROJECT_SCIM_ID, BEARER_TOKEN),
        })
      ).status,
    ).toBe(401);
  });

  test("an expired secret gets no token", async () => {
    projectConnections.get(PROJECT_SCIM_ID)!.oauthClientSecretExpiresAt =
      new Date(Date.now() - 1000);

    const token: HttpResult = await requestToken({
      authorization: basic(PROJECT_SCIM_ID, secret),
    });

    expect(token.status).toBe(401);
    expect(token.body["error"]).toBe("invalid_client");
  });

  test("a grant other than client_credentials, or none, is refused", async () => {
    const other: HttpResult = await call("POST", "/scim/oauth/token", {
      authorization: basic(PROJECT_SCIM_ID, secret),
      form: { grant_type: "authorization_code", code: "x" },
    });

    expect(other.status).toBe(400);
    expect(other.body["error"]).toBe("unsupported_grant_type");

    const none: HttpResult = await call("POST", "/scim/oauth/token", {
      authorization: basic(PROJECT_SCIM_ID, secret),
      form: {},
    });

    expect(none.status).toBe(400);
    expect(none.body["error"]).toBe("invalid_request");
  });

  test("HTTP Basic and a secret in the body at once is refused", async () => {
    const token: HttpResult = await requestToken({
      authorization: basic(PROJECT_SCIM_ID, secret),
      form: { client_secret: secret },
    });

    expect(token.status).toBe(400);
    expect(token.body["error"]).toBe("invalid_request");
  });

  test("no client authentication at all is invalid_client", async () => {
    const token: HttpResult = await requestToken({});

    expect(token.status).toBe(401);
    expect(token.body["error"]).toBe("invalid_client");
  });
});

describe("rotation: a new secret, with the one before still working until it is deleted", () => {
  test("the previous secret still gets a token", async () => {
    const token: HttpResult = await requestToken({
      authorization: basic(PROJECT_SCIM_ID, previousSecret),
    });

    expect(token.status).toBe(200);
  });

  test("deleting the previous secret ends the tokens it gave, at once", async () => {
    const token: HttpResult = await requestToken({
      authorization: basic(PROJECT_SCIM_ID, previousSecret),
    });
    const accessToken: string = token.body["access_token"] as string;

    expect((await listUsers(PROJECT_SCIM_PATH, accessToken)).status).toBe(200);

    // As the row reads once the previous secret is deleted.
    const columns: Record<string, unknown> = projectConnections.get(
      PROJECT_SCIM_ID,
    ) as unknown as Record<string, unknown>;
    columns["oauthPreviousClientSecretHash"] = null;
    columns["oauthPreviousClientSecretExpiresAt"] = null;

    const refused: HttpResult = await listUsers(PROJECT_SCIM_PATH, accessToken);

    expect(refused.status).toBe(401);
    expect(refused.body["schemas"]).toEqual([ERROR_SCHEMA]);
    expect(refused.body["detail"]).toBe(ACCESS_TOKEN_SECRET_ENDED_MESSAGE);
  });

  test("a secret that expires ends the tokens it gave", async () => {
    const token: HttpResult = await requestToken({
      authorization: basic(PROJECT_SCIM_ID, secret),
    });

    projectConnections.get(PROJECT_SCIM_ID)!.oauthClientSecretExpiresAt =
      new Date(Date.now() - 1000);

    expect(
      (await listUsers(PROJECT_SCIM_PATH, token.body["access_token"] as string))
        .status,
    ).toBe(401);
  });
});

describe("an access token is for its own connection only", () => {
  test("one connection's token is refused at another's SCIM URL", async () => {
    const token: HttpResult = await requestToken({
      authorization: basic(PROJECT_SCIM_ID, secret),
    });

    const elsewhere: HttpResult = await listUsers(
      `/scim/v2/${OTHER_PROJECT_SCIM_ID}`,
      token.body["access_token"] as string,
    );

    expect(elsewhere.status).toBe(401);
  });

  test("a status page connection gets tokens for its own SCIM URL", async () => {
    const token: HttpResult = await requestToken({
      authorization: basic(STATUS_PAGE_SCIM_ID, secret),
    });

    expect(token.status).toBe(200);
    expect(createStatusPageSCIMLog).toHaveBeenCalledWith(
      expect.objectContaining({ operationType: "IssueAccessToken" }),
    );

    expect(
      (
        await listUsers(
          STATUS_PAGE_SCIM_PATH,
          token.body["access_token"] as string,
        )
      ).status,
    ).toBe(200);
    expect(
      (await listUsers(PROJECT_SCIM_PATH, token.body["access_token"] as string))
        .status,
    ).toBe(401);
  });

  test("the connection's own bearer token works as it always did", async () => {
    expect((await listUsers(PROJECT_SCIM_PATH, BEARER_TOKEN)).status).toBe(200);
  });
});

describe("the license and the plan", () => {
  test("without a license that covers SCIM, no token", async () => {
    enterpriseModule.setSnapshot(createLicenseSnapshotWithStatus("expired"));

    const token: HttpResult = await requestToken({
      authorization: basic(PROJECT_SCIM_ID, secret),
    });

    expect(token.status).toBe(403);
    expect(token.body["schemas"]).toEqual([ERROR_SCHEMA]);
  });

  test("below the plan SCIM needs, a token is still issued, and lookups are answered with it", async () => {
    setTestBillingEnabled(true);
    currentPlan = PlanType.Free;

    const token: HttpResult = await requestToken({
      authorization: basic(PROJECT_SCIM_ID, secret),
    });

    expect(token.status).toBe(200);
    expect(
      (await listUsers(PROJECT_SCIM_PATH, token.body["access_token"] as string))
        .status,
    ).toBe(200);
  });
});
