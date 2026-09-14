import ProjectSCIMLog from "Common/Models/DatabaseModels/ProjectSCIMLog";
import StatusPageSCIMLog from "Common/Models/DatabaseModels/StatusPageSCIMLog";
import ProjectSCIMLogService from "Common/Server/Services/ProjectSCIMLogService";
import StatusPageSCIMLogService from "Common/Server/Services/StatusPageSCIMLogService";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SCIMLogStatus from "Common/Types/SCIM/SCIMLogStatus";
import {
  createProjectSCIMLog,
  createStatusPageSCIMLog,
} from "../../FeatureSet/Identity/Utils/SCIMLogger";

/*
 * The SCIM log is an audit trail an identity administrator reads when a user
 * provisioning run does something unexpected, and it stores the REQUEST BODY
 * of the call that caused it. SCIM clients (Okta, Entra, JumpCloud) send that
 * call with a bearer token, and some of them echo credentials inside the
 * payload itself. So this file has one job that is not about logging at all:
 * whatever it persists must not be a copy of the customer's credential,
 * sitting in a table that a project admin can read on a Logs page.
 *
 * And it has one job that is about logging: IT MUST NEVER FAIL A SCIM CALL.
 * A provisioning run that aborts because its audit line could not be written
 * would deprovision nobody and provision nobody, over a row in a log table.
 * Every error path here therefore has to be swallowed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SCIM_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

interface CreateSpy {
  mock: { calls: Array<Array<unknown>> };
}

type SpyOnProjectCreateFunction = () => CreateSpy;

const spyOnProjectCreate: SpyOnProjectCreateFunction = (): CreateSpy => {
  return jest
    .spyOn(ProjectSCIMLogService, "create")
    .mockResolvedValue(new ProjectSCIMLog() as never) as unknown as CreateSpy;
};

type SpyOnStatusPageCreateFunction = () => CreateSpy;

const spyOnStatusPageCreate: SpyOnStatusPageCreateFunction = (): CreateSpy => {
  return jest
    .spyOn(StatusPageSCIMLogService, "create")
    .mockResolvedValue(
      new StatusPageSCIMLog() as never,
    ) as unknown as CreateSpy;
};

type ReadPersistedLogFunction = (spy: CreateSpy) => ProjectSCIMLog;

const readPersistedLog: ReadPersistedLogFunction = (
  spy: CreateSpy,
): ProjectSCIMLog => {
  const call: Record<string, unknown> = spy.mock.calls[0]![0] as Record<
    string,
    unknown
  >;

  return call["data"] as ProjectSCIMLog;
};

type ReadLogBodyFunction = (spy: CreateSpy) => JSONObject;

const readLogBody: ReadLogBodyFunction = (spy: CreateSpy): JSONObject => {
  return JSON.parse(readPersistedLog(spy).logBody as string) as JSONObject;
};

describe("what reaches the SCIM log table", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("stamps the project, the SCIM configuration and the operation", async () => {
    const spy: CreateSpy = spyOnProjectCreate();

    await createProjectSCIMLog({
      projectId: PROJECT_ID,
      projectScimId: SCIM_ID,
      operationType: "CreateUser",
      status: SCIMLogStatus.Success,
    });

    const log: ProjectSCIMLog = readPersistedLog(spy);

    expect(log.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(log.projectScimId?.toString()).toBe(SCIM_ID.toString());
    expect(log.operationType).toBe("CreateUser");
    expect(log.status).toBe(SCIMLogStatus.Success);
  });

  test("writes as root, because the SCIM caller is not a project user", async () => {
    const spy: CreateSpy = spyOnProjectCreate();

    await createProjectSCIMLog({
      projectId: PROJECT_ID,
      projectScimId: SCIM_ID,
      operationType: "CreateUser",
      status: SCIMLogStatus.Success,
    });

    const call: Record<string, unknown> = spy.mock.calls[0]![0] as Record<
      string,
      unknown
    >;

    expect(call["props"]).toEqual({ isRoot: true });
  });

  test("carries the HTTP detail an administrator needs to find the call", async () => {
    const spy: CreateSpy = spyOnProjectCreate();

    await createProjectSCIMLog({
      projectId: PROJECT_ID,
      projectScimId: SCIM_ID,
      operationType: "CreateUser",
      status: SCIMLogStatus.Error,
      statusMessage: "User already exists",
      httpMethod: "POST",
      requestPath: "/scim/v2/Users",
      httpStatusCode: 409,
      affectedUserEmail: "someone@example.com",
      affectedGroupName: "Engineering",
    });

    const log: ProjectSCIMLog = readPersistedLog(spy);

    expect(log.statusMessage).toBe("User already exists");
    expect(log.httpMethod).toBe("POST");
    expect(log.requestPath).toBe("/scim/v2/Users");
    expect(log.httpStatusCode).toBe(409);
    expect(log.affectedUserEmail).toBe("someone@example.com");
    expect(log.affectedGroupName).toBe("Engineering");
  });

  /*
   * Optional fields are set only when they were supplied, so a column the
   * caller said nothing about stays untouched rather than being written as
   * undefined - which is what makes a partial update legible in the table.
   */
  test("leaves optional columns alone when the caller supplied none", async () => {
    const spy: CreateSpy = spyOnProjectCreate();

    await createProjectSCIMLog({
      projectId: PROJECT_ID,
      projectScimId: SCIM_ID,
      operationType: "ListUsers",
      status: SCIMLogStatus.Success,
    });

    const log: ProjectSCIMLog = readPersistedLog(spy);

    expect(log.statusMessage).toBeUndefined();
    expect(log.httpStatusCode).toBeUndefined();
    expect(log.affectedUserEmail).toBeUndefined();
  });

  test("always writes a timestamped body, even with nothing else to say", async () => {
    const spy: CreateSpy = spyOnProjectCreate();

    await createProjectSCIMLog({
      projectId: PROJECT_ID,
      projectScimId: SCIM_ID,
      operationType: "ListUsers",
      status: SCIMLogStatus.Success,
    });

    const body: JSONObject = readLogBody(spy);

    expect(typeof body["timestamp"]).toBe("string");
    expect(Number.isNaN(Date.parse(body["timestamp"] as string))).toBe(false);
  });

  test("omits sections the caller said nothing about", async () => {
    const spy: CreateSpy = spyOnProjectCreate();

    await createProjectSCIMLog({
      projectId: PROJECT_ID,
      projectScimId: SCIM_ID,
      operationType: "ListUsers",
      status: SCIMLogStatus.Success,
    });

    const body: JSONObject = readLogBody(spy);

    expect(body["request"]).toBeUndefined();
    expect(body["response"]).toBeUndefined();
    expect(body["executionSteps"]).toBeUndefined();
    expect(body["userDetails"]).toBeUndefined();
  });

  test("omits an empty query-parameter bag rather than writing {}", async () => {
    const spy: CreateSpy = spyOnProjectCreate();

    await createProjectSCIMLog({
      projectId: PROJECT_ID,
      projectScimId: SCIM_ID,
      operationType: "ListUsers",
      status: SCIMLogStatus.Success,
      queryParams: {},
      steps: [],
    });

    const body: JSONObject = readLogBody(spy);

    expect(body["queryParameters"]).toBeUndefined();
    expect(body["executionSteps"]).toBeUndefined();
  });

  test("keeps the execution steps in the order they were recorded", async () => {
    const spy: CreateSpy = spyOnProjectCreate();

    await createProjectSCIMLog({
      projectId: PROJECT_ID,
      projectScimId: SCIM_ID,
      operationType: "CreateUser",
      status: SCIMLogStatus.Success,
      steps: ["parsed request", "resolved user", "created membership"],
    });

    expect(readLogBody(spy)["executionSteps"]).toEqual([
      "parsed request",
      "resolved user",
      "created membership",
    ]);
  });
});

describe("credentials never reach the audit table", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const SENSITIVE_KEYS: Array<string> = [
    "password",
    "bearerToken",
    "bearer_token",
    "authorization",
    "Authorization",
    "token",
    "secret",
    "apiKey",
    "api_key",
  ];

  test.each(SENSITIVE_KEYS)(
    "redacts a top-level %s out of the request body",
    async (key: string) => {
      const spy: CreateSpy = spyOnProjectCreate();

      await createProjectSCIMLog({
        projectId: PROJECT_ID,
        projectScimId: SCIM_ID,
        operationType: "CreateUser",
        status: SCIMLogStatus.Success,
        requestBody: { [key]: "the-real-secret", userName: "someone" },
      });

      const request: JSONObject = readLogBody(spy)["request"] as JSONObject;

      expect(request[key]).toBe("[REDACTED]");
      expect(request["userName"]).toBe("someone");
      expect(JSON.stringify(readLogBody(spy))).not.toContain("the-real-secret");
    },
  );

  /*
   * The match is a case-insensitive SUBSTRING, so a client that spells the
   * field "userPassword" or "X-Authorization-Header" is covered too. SCIM
   * clients do not agree on these names and never have.
   */
  test("redacts a key that merely contains a sensitive word", async () => {
    const spy: CreateSpy = spyOnProjectCreate();

    await createProjectSCIMLog({
      projectId: PROJECT_ID,
      projectScimId: SCIM_ID,
      operationType: "CreateUser",
      status: SCIMLogStatus.Success,
      requestBody: {
        userPassword: "hunter2",
        refreshToken: "rt-value",
        clientSecret: "cs-value",
      },
    });

    const request: JSONObject = readLogBody(spy)["request"] as JSONObject;

    expect(request["userPassword"]).toBe("[REDACTED]");
    expect(request["refreshToken"]).toBe("[REDACTED]");
    expect(request["clientSecret"]).toBe("[REDACTED]");
  });

  test("redacts regardless of the casing the client used", async () => {
    const spy: CreateSpy = spyOnProjectCreate();

    await createProjectSCIMLog({
      projectId: PROJECT_ID,
      projectScimId: SCIM_ID,
      operationType: "CreateUser",
      status: SCIMLogStatus.Success,
      requestBody: { PASSWORD: "a", Token: "b", ApIkEy: "c" },
    });

    const request: JSONObject = readLogBody(spy)["request"] as JSONObject;

    expect(request["PASSWORD"]).toBe("[REDACTED]");
    expect(request["Token"]).toBe("[REDACTED]");
    expect(request["ApIkEy"]).toBe("[REDACTED]");
  });

  /*
   * SCIM payloads nest. Okta sends credentials under a schema-URN key, so a
   * redactor that only looked at the top level would miss every one of them.
   */
  test("redacts through a nested object", async () => {
    const spy: CreateSpy = spyOnProjectCreate();

    await createProjectSCIMLog({
      projectId: PROJECT_ID,
      projectScimId: SCIM_ID,
      operationType: "CreateUser",
      status: SCIMLogStatus.Success,
      requestBody: {
        "urn:ietf:params:scim:schemas:core:2.0:User": {
          userName: "someone",
          credentials: { password: "hunter2" },
        },
      },
    });

    expect(JSON.stringify(readLogBody(spy))).not.toContain("hunter2");
  });

  test("redacts inside objects held in an array", async () => {
    const spy: CreateSpy = spyOnProjectCreate();

    await createProjectSCIMLog({
      projectId: PROJECT_ID,
      projectScimId: SCIM_ID,
      operationType: "PatchUser",
      status: SCIMLogStatus.Success,
      requestBody: {
        Operations: [
          { op: "replace", path: "password", value: { token: "t-secret" } },
        ],
      },
    });

    expect(JSON.stringify(readLogBody(spy))).not.toContain("t-secret");
  });

  test("keeps ordinary array values intact", async () => {
    const spy: CreateSpy = spyOnProjectCreate();

    await createProjectSCIMLog({
      projectId: PROJECT_ID,
      projectScimId: SCIM_ID,
      operationType: "PatchUser",
      status: SCIMLogStatus.Success,
      requestBody: { schemas: ["urn:a", "urn:b"] },
    });

    expect((readLogBody(spy)["request"] as JSONObject)["schemas"]).toEqual([
      "urn:a",
      "urn:b",
    ]);
  });

  test("redacts the response body, the user bag, the group bag and the context too", async () => {
    const spy: CreateSpy = spyOnProjectCreate();

    await createProjectSCIMLog({
      projectId: PROJECT_ID,
      projectScimId: SCIM_ID,
      operationType: "CreateUser",
      status: SCIMLogStatus.Success,
      responseBody: { token: "response-secret" },
      userInfo: { password: "user-secret" },
      groupInfo: { apiKey: "group-secret" },
      additionalContext: { authorization: "context-secret" },
    });

    const serialized: string = JSON.stringify(readLogBody(spy));

    expect(serialized).not.toContain("response-secret");
    expect(serialized).not.toContain("user-secret");
    expect(serialized).not.toContain("group-secret");
    expect(serialized).not.toContain("context-secret");
  });

  test("does not mutate the caller's own object while redacting it", async () => {
    spyOnProjectCreate();

    const requestBody: JSONObject = { password: "hunter2" };

    await createProjectSCIMLog({
      projectId: PROJECT_ID,
      projectScimId: SCIM_ID,
      operationType: "CreateUser",
      status: SCIMLogStatus.Success,
      requestBody: requestBody,
    });

    // The SCIM handler goes on using this body after it logs.
    expect(requestBody["password"]).toBe("hunter2");
  });

  test("the status page logger redacts on the same terms", async () => {
    const spy: CreateSpy = spyOnStatusPageCreate();

    await createStatusPageSCIMLog({
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      statusPageScimId: SCIM_ID,
      operationType: "CreateUser",
      status: SCIMLogStatus.Success,
      requestBody: { bearerToken: "sp-secret" },
    });

    expect(JSON.stringify(readLogBody(spy))).not.toContain("sp-secret");
  });
});

describe("the status page logger", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("stamps the project, the status page and its SCIM configuration", async () => {
    const spy: CreateSpy = spyOnStatusPageCreate();

    await createStatusPageSCIMLog({
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      statusPageScimId: SCIM_ID,
      operationType: "CreateUser",
      status: SCIMLogStatus.Success,
    });

    const log: StatusPageSCIMLog = spy.mock.calls[0]![0] as never;
    const persisted: StatusPageSCIMLog = (
      log as unknown as { data: StatusPageSCIMLog }
    ).data;

    expect(persisted.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(persisted.statusPageId?.toString()).toBe(STATUS_PAGE_ID.toString());
    expect(persisted.statusPageScimId?.toString()).toBe(SCIM_ID.toString());
  });

  /*
   * groupInfo exists on the project logger and not on this one - status page
   * SCIM has no groups. Passing the shared body-builder no group bag must
   * simply omit the section.
   */
  test("writes no group section, because status page SCIM has no groups", async () => {
    const spy: CreateSpy = spyOnStatusPageCreate();

    await createStatusPageSCIMLog({
      projectId: PROJECT_ID,
      statusPageId: STATUS_PAGE_ID,
      statusPageScimId: SCIM_ID,
      operationType: "CreateUser",
      status: SCIMLogStatus.Success,
      userInfo: { userName: "someone" },
    });

    const body: JSONObject = readLogBody(spy);

    expect(body["groupDetails"]).toBeUndefined();
    expect(body["userDetails"]).toEqual({ userName: "someone" });
  });
});

describe("a failed log line never fails the SCIM call", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("swallows a rejection from the project log service", async () => {
    jest
      .spyOn(ProjectSCIMLogService, "create")
      .mockRejectedValue(new Error("database is down") as never);

    await expect(
      createProjectSCIMLog({
        projectId: PROJECT_ID,
        projectScimId: SCIM_ID,
        operationType: "CreateUser",
        status: SCIMLogStatus.Success,
      }),
    ).resolves.toBeUndefined();
  });

  test("swallows a rejection from the status page log service", async () => {
    jest
      .spyOn(StatusPageSCIMLogService, "create")
      .mockRejectedValue(new Error("database is down") as never);

    await expect(
      createStatusPageSCIMLog({
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
        statusPageScimId: SCIM_ID,
        operationType: "CreateUser",
        status: SCIMLogStatus.Success,
      }),
    ).resolves.toBeUndefined();
  });

  /*
   * A body that cannot be serialised - a circular reference built up while
   * assembling context - must not escape either. The log is lost; the
   * provisioning run is not.
   */
  test("swallows a body that cannot be serialised", async () => {
    spyOnProjectCreate();

    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    await expect(
      createProjectSCIMLog({
        projectId: PROJECT_ID,
        projectScimId: SCIM_ID,
        operationType: "CreateUser",
        status: SCIMLogStatus.Success,
        additionalContext: circular as JSONObject,
      }),
    ).resolves.toBeUndefined();
  });
});
