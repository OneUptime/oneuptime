/*
 * OAuth 2.0 workflow variables in a run.
 *
 * The customer problem: a bearer token pasted into a workflow variable works
 * until it expires, and then every run fails with 401 until somebody pastes a
 * new one. An OAuth 2.0 variable stores what the token exchange needs, and the
 * runner makes sure that right before a step uses the variable, the variable
 * holds a token that has not expired - fetching one from the identity provider
 * when it does not.
 *
 * These tests pin the runner's half: which steps trigger a refresh, what the
 * component receives, what happens when the identity provider says no, and
 * that neither the old nor the new token ever reaches the persisted log.
 */

import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import Semaphore, {
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import WorkflowVariableService from "Common/Server/Services/WorkflowVariableService";
import logger from "Common/Server/Utils/Logger";
import OAuth2TokenClient, {
  OAuth2TokenHttpRequest,
  OAuth2TokenRequestException,
} from "Common/Server/Utils/Workflow/OAuth2TokenClient";
import WorkflowVariableOAuthToken from "Common/Server/Utils/Workflow/WorkflowVariableOAuthToken";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
  NodeDataProp,
  NodeType,
  Port,
} from "Common/Types/Workflow/Component";
import {
  WorkflowStepStatus,
  WorkflowStepTrace,
  WorkflowStepTraceEntry,
  parseTrace,
} from "Common/Types/Workflow/StepTrace";
import WorkflowStatus from "Common/Types/Workflow/WorkflowStatus";
import {
  OAuth2GrantType,
  WorkflowVariableType,
} from "Common/Types/Workflow/WorkflowVariableOAuth";
import RunWorkflow, {
  RunStack,
  StorageMap,
  getWorkflowVariableValue,
} from "../../../FeatureSet/Workflow/Services/RunWorkflow";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "11111111-aaaa-4111-8111-111111111111",
);
const WORKFLOW_LOG_ID: ObjectID = new ObjectID(
  "22222222-aaaa-4222-8222-222222222222",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-aaaa-4333-8333-333333333333",
);
const GLOBAL_TOKEN_ID: ObjectID = new ObjectID(
  "44444444-aaaa-4444-8444-444444444444",
);
const LOCAL_TOKEN_ID: ObjectID = new ObjectID(
  "55555555-aaaa-4555-8555-555555555555",
);
const OTHER_TOKEN_ID: ObjectID = new ObjectID(
  "66666666-aaaa-4666-8666-666666666666",
);

const SUCCESS_PORT: Port = {
  id: "success",
  title: "Success",
  description: "Success",
};

interface RecordedSpy {
  mock: { calls: Array<Array<unknown>> };
}

function secondsFromNow(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

function metadata(): ComponentMetadata {
  return {
    id: "api-post",
    title: "API Post",
    category: "API",
    description: "Calls an API",
    iconProp: IconProp.Globe,
    componentType: ComponentType.Component,
    arguments: [
      {
        id: "url",
        name: "URL",
        description: "URL",
        type: ComponentInputType.URL,
        required: true,
      },
      {
        id: "request-headers",
        name: "Headers",
        description: "Headers",
        type: ComponentInputType.StringDictionary,
        required: false,
      },
    ],
    returnValues: [],
    inPorts: [],
    outPorts: [SUCCESS_PORT],
  };
}

function node(id: string, headers: string): NodeDataProp {
  return {
    error: "",
    id,
    nodeType: NodeType.Node,
    metadata: metadata(),
    metadataId: "api-post",
    internalId: `internal-${id}`,
    arguments: {
      url: "https://api.example.com/v1/incidents",
      "request-headers": headers,
    },
    returnValues: {},
    componentType: ComponentType.Component,
  };
}

function oauthVariable(values: {
  id: ObjectID;
  name: string;
  workflowId?: ObjectID | undefined;
  accessToken?: string | undefined;
  expiresAt?: Date | null | undefined;
  refreshedAt?: Date | null | undefined;
}): WorkflowVariable {
  const variable: WorkflowVariable = new WorkflowVariable();
  variable._id = values.id.toString();
  variable.name = values.name;
  variable.content = "";
  (variable as unknown as { isSecret: boolean }).isSecret = true;
  variable.variableType = WorkflowVariableType.OAuth2;

  if (values.workflowId) {
    variable.workflowId = values.workflowId;
  }

  if (values.accessToken) {
    variable.oauthAccessToken = values.accessToken;
  }

  variable.oauthAccessTokenExpiresAt = values.expiresAt as Date;
  variable.oauthLastRefreshedAt = values.refreshedAt as Date;

  return variable;
}

function staticVariable(name: string, content: string): WorkflowVariable {
  const variable: WorkflowVariable = new WorkflowVariable();
  variable._id = ObjectID.generate().toString();
  variable.name = name;
  variable.content = content;
  (variable as unknown as { isSecret: boolean }).isSecret = false;
  variable.variableType = WorkflowVariableType.Static;
  return variable;
}

interface Harness {
  runner: RunWorkflow;
  updateLog: RecordedSpy;
  componentArgs: Array<JSONObject>;
}

/*
 * A run of the given nodes in sequence, with the real getVariables reading the
 * given local and global rows through a stubbed WorkflowVariableService.findBy.
 */
function prepareRun(data: {
  nodes: Array<NodeDataProp>;
  local?: Array<WorkflowVariable> | undefined;
  global?: Array<WorkflowVariable> | undefined;
  onComponent?: ((index: number) => void) | undefined;
}): Harness {
  const workflowRow: Workflow = new Workflow();
  workflowRow._id = WORKFLOW_ID.toString();
  workflowRow.graph = { nodes: [], edges: [] } as JSONObject;
  workflowRow.projectId = PROJECT_ID;
  workflowRow.isEnabled = true;

  jest
    .spyOn(WorkflowService as never, "findOneById")
    .mockResolvedValue(workflowRow as never);

  const updateLog: RecordedSpy = jest
    .spyOn(WorkflowLogService as never, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never) as unknown as RecordedSpy;

  jest
    .spyOn(WorkflowVariableService, "findBy")
    .mockImplementation(async (findBy: unknown) => {
      const query: Record<string, unknown> = (
        findBy as { query: Record<string, unknown> }
      ).query;

      // getVariables asks for local rows by workflowId, global rows by project.
      return (query["projectId"] ? data.global : data.local) || [];
    });

  const runner: RunWorkflow = new RunWorkflow();

  const stack: RunStack["stack"] = {};

  data.nodes.forEach((item: NodeDataProp, index: number) => {
    const nextNode: NodeDataProp | undefined = data.nodes[index + 1];
    stack[item.id] = {
      node: item,
      outPorts: nextNode ? { success: [nextNode.id] } : {},
    };
  });

  jest.spyOn(runner, "makeRunStack").mockResolvedValue({
    startWithComponentId: data.nodes[0]!.id,
    stack,
  } as never);

  const componentArgs: Array<JSONObject> = [];

  jest
    .spyOn(runner, "runComponent")
    .mockImplementation(async (args: JSONObject) => {
      componentArgs.push(args);

      if (data.onComponent) {
        data.onComponent(componentArgs.length - 1);
      }

      return {
        returnValues: {},
        executePort:
          componentArgs.length < data.nodes.length ? SUCCESS_PORT : undefined,
      } as never;
    });

  return { runner, updateLog, componentArgs };
}

async function run(harness: Harness, timeout: number = 60000): Promise<void> {
  await harness.runner.runWorkflow({
    arguments: {},
    workflowId: WORKFLOW_ID,
    workflowLogId: WORKFLOW_LOG_ID,
    timeout,
  });
}

function lastPersisted(harness: Harness): JSONObject {
  const calls: Array<Array<unknown>> = harness.updateLog.mock.calls;
  return (calls[calls.length - 1]![0] as { data: JSONObject }).data;
}

function lastTrace(harness: Harness): WorkflowStepTrace {
  return parseTrace(lastPersisted(harness)["stepTrace"] as never);
}

function headersOf(args: JSONObject): string {
  return JSON.stringify(args["request-headers"]);
}

describe("RunWorkflow with OAuth 2.0 variables", () => {
  let getAccessToken: RecordedSpy & {
    mockResolvedValue: (value: never) => void;
    mockRejectedValue: (value: never) => void;
    mockResolvedValueOnce: (value: never) => unknown;
  };

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    getAccessToken = jest.spyOn(
      WorkflowVariableOAuthToken,
      "getAccessToken",
    ) as unknown as typeof getAccessToken;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("hands the component the cached token when it has not expired", async () => {
    const harness: Harness = prepareRun({
      nodes: [
        node(
          "call-api",
          '{"Authorization":"Bearer {{global.variables.API_TOKEN}}"}',
        ),
      ],
      global: [
        oauthVariable({
          id: GLOBAL_TOKEN_ID,
          name: "API_TOKEN",
          accessToken: "cached-access-token",
          expiresAt: secondsFromNow(1800),
          refreshedAt: secondsFromNow(-1800),
        }),
      ],
    });

    await run(harness);

    expect(getAccessToken.mock.calls).toHaveLength(0);
    expect(headersOf(harness.componentArgs[0]!)).toContain(
      "Bearer cached-access-token",
    );
    expect(lastPersisted(harness)["workflowStatus"]).toBe(
      WorkflowStatus.Success,
    );
  });

  test("fetches a new token right before the step when the cached one has expired", async () => {
    getAccessToken.mockResolvedValue({
      accessToken: "fresh-access-token",
      expiresAt: secondsFromNow(3600),
      refreshedAt: new Date(),
      didRefresh: true,
    } as never);

    const harness: Harness = prepareRun({
      nodes: [
        node(
          "call-api",
          '{"Authorization":"Bearer {{global.variables.API_TOKEN}}"}',
        ),
      ],
      global: [
        oauthVariable({
          id: GLOBAL_TOKEN_ID,
          name: "API_TOKEN",
          accessToken: "expired-access-token",
          expiresAt: secondsFromNow(-60),
          refreshedAt: secondsFromNow(-3660),
        }),
      ],
    });

    await run(harness);

    expect(getAccessToken.mock.calls).toHaveLength(1);

    const request: {
      variableId: ObjectID;
      acceptTokenRefreshedAtOrAfter: Date;
      timeoutInMs: number;
    } = getAccessToken.mock.calls[0]![0] as never;

    expect(request.variableId.toString()).toBe(GLOBAL_TOKEN_ID.toString());
    expect(request.acceptTokenRefreshedAtOrAfter).toBeInstanceOf(Date);
    expect(request.timeoutInMs).toBeLessThanOrEqual(20000);

    expect(headersOf(harness.componentArgs[0]!)).toContain(
      "Bearer fresh-access-token",
    );
    expect(headersOf(harness.componentArgs[0]!)).not.toContain(
      "expired-access-token",
    );

    const logs: string = lastPersisted(harness)["logs"] as string;
    expect(logs).toContain(
      "Fetched a new OAuth 2.0 access token for {{global.variables.API_TOKEN}}, valid until",
    );
  });

  test("fetches a token for a variable that has never had one", async () => {
    getAccessToken.mockResolvedValue({
      accessToken: "first-access-token",
      expiresAt: secondsFromNow(3600),
      refreshedAt: new Date(),
      didRefresh: true,
    } as never);

    const harness: Harness = prepareRun({
      nodes: [
        node(
          "call-api",
          '{"Authorization":"Bearer {{global.variables.API_TOKEN}}"}',
        ),
      ],
      global: [oauthVariable({ id: GLOBAL_TOKEN_ID, name: "API_TOKEN" })],
    });

    await run(harness);

    expect(headersOf(harness.componentArgs[0]!)).toContain(
      "Bearer first-access-token",
    );
  });

  /*
   * A project can have OAuth variables for a dozen systems. A step that uses
   * none of them must not fetch any token - or fail because one of those
   * identity providers is down.
   */
  test("does not touch an OAuth variable the step does not refer to", async () => {
    const harness: Harness = prepareRun({
      nodes: [node("call-api", '{"X-Static":"{{global.variables.PLAIN}}"}')],
      global: [
        staticVariable("PLAIN", "plain-value"),
        oauthVariable({
          id: OTHER_TOKEN_ID,
          name: "UNUSED_TOKEN",
          accessToken: "expired",
          expiresAt: secondsFromNow(-60),
        }),
      ],
    });

    await run(harness);

    expect(getAccessToken.mock.calls).toHaveLength(0);
    expect(headersOf(harness.componentArgs[0]!)).toContain("plain-value");
    expect(lastPersisted(harness)["workflowStatus"]).toBe(
      WorkflowStatus.Success,
    );
  });

  test("refreshes the local variable a local reference names, not the global one of the same name", async () => {
    getAccessToken.mockResolvedValue({
      accessToken: "fresh-local-token",
      expiresAt: secondsFromNow(3600),
      refreshedAt: new Date(),
      didRefresh: true,
    } as never);

    const harness: Harness = prepareRun({
      nodes: [
        node(
          "call-api",
          '{"Authorization":"Bearer {{local.variables.TOKEN}}"}',
        ),
      ],
      local: [
        oauthVariable({
          id: LOCAL_TOKEN_ID,
          name: "TOKEN",
          workflowId: WORKFLOW_ID,
          accessToken: "expired-local",
          expiresAt: secondsFromNow(-60),
        }),
      ],
      global: [
        oauthVariable({
          id: GLOBAL_TOKEN_ID,
          name: "TOKEN",
          accessToken: "expired-global",
          expiresAt: secondsFromNow(-60),
        }),
      ],
    });

    await run(harness);

    expect(getAccessToken.mock.calls).toHaveLength(1);
    expect(
      (
        getAccessToken.mock.calls[0]![0] as { variableId: ObjectID }
      ).variableId.toString(),
    ).toBe(LOCAL_TOKEN_ID.toString());
    expect(headersOf(harness.componentArgs[0]!)).toContain(
      "Bearer fresh-local-token",
    );
  });

  test("fails the step, and the run, when no usable token can be had - naming the variable", async () => {
    getAccessToken.mockRejectedValue(
      new OAuth2TokenRequestException(
        "The token endpoint refused the request (HTTP 401): invalid_client.",
        "invalid_client",
      ) as never,
    );

    const harness: Harness = prepareRun({
      nodes: [
        node(
          "call-api",
          '{"Authorization":"Bearer {{global.variables.API_TOKEN}}"}',
        ),
      ],
      global: [
        oauthVariable({
          id: GLOBAL_TOKEN_ID,
          name: "API_TOKEN",
          accessToken: "expired-access-token",
          expiresAt: secondsFromNow(-60),
        }),
      ],
    });

    await run(harness);

    // The component never ran with a token that would have been refused.
    expect(harness.componentArgs).toHaveLength(0);
    expect(lastPersisted(harness)["workflowStatus"]).toBe(WorkflowStatus.Error);

    const step: WorkflowStepTraceEntry = lastTrace(harness)
      .steps[0] as WorkflowStepTraceEntry;

    expect(step.componentId).toBe("call-api");
    expect(step.status).toBe(WorkflowStepStatus.Error);
    expect(step.errorMessage).toBe(
      "Could not get an OAuth 2.0 access token for {{global.variables.API_TOKEN}}: The token endpoint refused the request (HTTP 401): invalid_client.",
    );

    expect(lastPersisted(harness)["logs"] as string).toContain(
      "Could not get an OAuth 2.0 access token for {{global.variables.API_TOKEN}}",
    );
  });

  /*
   * Inside the refresh margin the cached token still works. If the identity
   * provider is unavailable at that moment, failing a run that holds a working
   * token would be worse than going ahead - so it goes ahead, and says so.
   */
  test("goes ahead with a cached token that has not actually expired when the refresh fails", async () => {
    getAccessToken.mockRejectedValue(
      new OAuth2TokenRequestException(
        "Could not reach the token endpoint: it did not answer within 20 seconds.",
      ) as never,
    );

    const harness: Harness = prepareRun({
      nodes: [
        node(
          "call-api",
          '{"Authorization":"Bearer {{global.variables.API_TOKEN}}"}',
        ),
      ],
      global: [
        oauthVariable({
          id: GLOBAL_TOKEN_ID,
          name: "API_TOKEN",
          accessToken: "nearly-expired-token",
          expiresAt: secondsFromNow(30),
          refreshedAt: secondsFromNow(-3570),
        }),
      ],
    });

    await run(harness);

    expect(getAccessToken.mock.calls).toHaveLength(1);
    expect(headersOf(harness.componentArgs[0]!)).toContain(
      "Bearer nearly-expired-token",
    );
    expect(lastPersisted(harness)["workflowStatus"]).toBe(
      WorkflowStatus.Success,
    );
    expect(lastPersisted(harness)["logs"] as string).toContain(
      "Could not refresh the OAuth 2.0 access token for {{global.variables.API_TOKEN}}: Could not reach the token endpoint: it did not answer within 20 seconds. Using the cached token, which expires at",
    );
  });

  /*
   * No expires_in and not a JWT: the token's lifetime is unknown. It is fetched
   * once per run - the first step that needs it fetches it, and every later
   * step of the same run shares it.
   */
  test("fetches a token with no known expiry once per run and shares it between steps", async () => {
    /*
     * Stamped when the refresh happens, as WorkflowVariableOAuthToken does -
     * a timestamp taken before the run started would rightly not count as
     * fetched for this run.
     */
    (
      getAccessToken as unknown as {
        mockImplementation: (fn: () => Promise<unknown>) => void;
      }
    ).mockImplementation(async () => {
      return {
        accessToken: "per-run-token",
        expiresAt: null,
        refreshedAt: new Date(),
        didRefresh: true,
      };
    });

    const harness: Harness = prepareRun({
      nodes: [
        node(
          "first",
          '{"Authorization":"Bearer {{global.variables.API_TOKEN}}"}',
        ),
        node(
          "second",
          '{"Authorization":"Bearer {{global.variables.API_TOKEN}}"}',
        ),
      ],
      global: [
        oauthVariable({
          id: GLOBAL_TOKEN_ID,
          name: "API_TOKEN",
          accessToken: "previous-run-token",
          expiresAt: null,
          refreshedAt: secondsFromNow(-600),
        }),
      ],
    });

    await run(harness);

    expect(getAccessToken.mock.calls).toHaveLength(1);
    expect(harness.componentArgs).toHaveLength(2);
    expect(headersOf(harness.componentArgs[0]!)).toContain("per-run-token");
    expect(headersOf(harness.componentArgs[1]!)).toContain("per-run-token");
    expect(lastPersisted(harness)["logs"] as string).toContain(
      "The identity provider did not say when it expires, so a new one is fetched on every run.",
    );
  });

  /*
   * The token expires between two steps of one long run. The second step gets
   * a new one - and the log, which by then quotes the old token in the first
   * step's arguments, must redact both.
   */
  test("refreshes mid-run and redacts both the old and the new token from the persisted log and trace", async () => {
    const globalToken: WorkflowVariable = oauthVariable({
      id: GLOBAL_TOKEN_ID,
      name: "API_TOKEN",
      accessToken: "old-access-token-value",
      expiresAt: secondsFromNow(1800),
      refreshedAt: secondsFromNow(-1800),
    });

    getAccessToken.mockResolvedValue({
      accessToken: "new-access-token-value",
      expiresAt: secondsFromNow(3600),
      refreshedAt: new Date(),
      didRefresh: true,
    } as never);

    const harness: Harness = prepareRun({
      nodes: [
        node(
          "first",
          '{"Authorization":"Bearer {{global.variables.API_TOKEN}}"}',
        ),
        node(
          "second",
          '{"Authorization":"Bearer {{global.variables.API_TOKEN}}"}',
        ),
      ],
      global: [globalToken],
      onComponent: (index: number) => {
        if (index === 0) {
          // The first step ran long enough for the token to lapse.
          globalToken.oauthAccessTokenExpiresAt = secondsFromNow(-1);
        }
      },
    });

    await run(harness);

    expect(headersOf(harness.componentArgs[0]!)).toContain(
      "old-access-token-value",
    );
    expect(headersOf(harness.componentArgs[1]!)).toContain(
      "new-access-token-value",
    );

    const persisted: string = JSON.stringify(lastPersisted(harness));

    expect(persisted).not.toContain("old-access-token-value");
    expect(persisted).not.toContain("new-access-token-value");
    expect(persisted).toContain("[REDACTED]");
  });

  test("bounds the token request by the time the run has left", async () => {
    getAccessToken.mockResolvedValue({
      accessToken: "fresh",
      expiresAt: secondsFromNow(3600),
      refreshedAt: new Date(),
      didRefresh: true,
    } as never);

    const harness: Harness = prepareRun({
      nodes: [
        node(
          "call-api",
          '{"Authorization":"Bearer {{global.variables.API_TOKEN}}"}',
        ),
      ],
      global: [oauthVariable({ id: GLOBAL_TOKEN_ID, name: "API_TOKEN" })],
    });

    await run(harness, 5000);

    expect(
      (getAccessToken.mock.calls[0]![0] as { timeoutInMs: number }).timeoutInMs,
    ).toBeLessThanOrEqual(5000);
  });
});

describe("RunWorkflow.getVariables with OAuth 2.0 variables", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("resolves an OAuth variable to its access token, and reads no credentials", async () => {
    const selects: Array<Record<string, unknown>> = [];

    jest
      .spyOn(WorkflowVariableService, "findBy")
      .mockImplementation(async (findBy: unknown) => {
        const typed: {
          query: Record<string, unknown>;
          select: Record<string, unknown>;
        } = findBy as {
          query: Record<string, unknown>;
          select: Record<string, unknown>;
        };

        selects.push(typed.select);

        return typed.query["projectId"]
          ? [
              oauthVariable({
                id: GLOBAL_TOKEN_ID,
                name: "API_TOKEN",
                accessToken: "cached-access-token",
                expiresAt: secondsFromNow(60),
              }),
              staticVariable("PLAIN", "plain-value"),
            ]
          : [];
      });

    const result: { storageMap: StorageMap } =
      await new RunWorkflow().getVariables(PROJECT_ID, WORKFLOW_ID);

    expect(result.storageMap.global.variables).toEqual({
      API_TOKEN: "cached-access-token",
      PLAIN: "plain-value",
    });

    for (const select of selects) {
      expect(select).toEqual(
        expect.objectContaining({
          _id: true,
          workflowId: true,
          variableType: true,
          oauthAccessToken: true,
          oauthAccessTokenExpiresAt: true,
          oauthLastRefreshedAt: true,
        }),
      );
      // Only the token manager reads these, and only when it refreshes.
      expect(select).not.toHaveProperty("oauthClientSecret");
      expect(select).not.toHaveProperty("oauthRefreshToken");
    }
  });

  test("getWorkflowVariableValue: content for Static, the access token for OAuth", () => {
    expect(getWorkflowVariableValue(staticVariable("A", "content-a"))).toBe(
      "content-a",
    );
    expect(
      getWorkflowVariableValue(
        oauthVariable({
          id: GLOBAL_TOKEN_ID,
          name: "B",
          accessToken: "token-b",
        }),
      ),
    ).toBe("token-b");
    expect(
      getWorkflowVariableValue(
        oauthVariable({ id: GLOBAL_TOKEN_ID, name: "C" }),
      ),
    ).toBe("");
  });
});

/*
 * One run end to end through the real WorkflowVariableOAuthToken and the real
 * OAuth2TokenClient. Only the edges are fake: the database row, the Redis lock
 * and the socket.
 */
describe("RunWorkflow, WorkflowVariableOAuthToken and OAuth2TokenClient together", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an expired client-credentials token is re-fetched, stored and used", async () => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    const stored: Record<string, unknown> = {
      _id: GLOBAL_TOKEN_ID.toString(),
      name: "API_TOKEN",
      variableType: WorkflowVariableType.OAuth2,
      oauthGrantType: OAuth2GrantType.ClientCredentials,
      oauthTokenUrl: "https://login.example.com/oauth2/token",
      oauthClientId: "client-123",
      oauthClientSecret: "client-secret-value",
      oauthScope: "incidents.write",
      oauthAccessToken: "expired-access-token",
      oauthAccessTokenExpiresAt: secondsFromNow(-60),
      oauthLastRefreshedAt: secondsFromNow(-3660),
    };

    jest
      .spyOn(WorkflowVariableService, "findOneById")
      .mockImplementation(async () => {
        const row: WorkflowVariable = new WorkflowVariable();
        Object.assign(row, stored);
        return row;
      });

    const writes: Array<Record<string, unknown>> = [];

    jest
      .spyOn(WorkflowVariableService, "updateOneById")
      .mockImplementation(async (input: unknown) => {
        const data: Record<string, unknown> = (
          input as { data: Record<string, unknown> }
        ).data;
        writes.push(data);
        Object.assign(stored, data);
        return 1 as never;
      });

    jest
      .spyOn(Semaphore, "lock")
      .mockResolvedValue({} as unknown as SemaphoreMutex);
    jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);

    const tokenRequests: Array<OAuth2TokenHttpRequest> = [];

    jest
      .spyOn(OAuth2TokenClient, "transport")
      .mockImplementation(async (request: OAuth2TokenHttpRequest) => {
        tokenRequests.push(request);
        return {
          statusCode: 200,
          bodyText: JSON.stringify({
            access_token: "brand-new-access-token",
            token_type: "Bearer",
            expires_in: 3599,
          }),
          headers: { "content-type": "application/json" },
        };
      });

    const harness: Harness = prepareRun({
      nodes: [
        node(
          "call-api",
          '{"Authorization":"Bearer {{global.variables.API_TOKEN}}"}',
        ),
      ],
      global: [
        oauthVariable({
          id: GLOBAL_TOKEN_ID,
          name: "API_TOKEN",
          accessToken: "expired-access-token",
          expiresAt: stored["oauthAccessTokenExpiresAt"] as Date,
          refreshedAt: stored["oauthLastRefreshedAt"] as Date,
        }),
      ],
    });

    await run(harness);

    expect(tokenRequests).toHaveLength(1);
    expect(tokenRequests[0]!.url).toBe(
      "https://login.example.com/oauth2/token",
    );
    expect(tokenRequests[0]!.body).toEqual({
      grant_type: "client_credentials",
      scope: "incidents.write",
    });
    expect(tokenRequests[0]!.headers["Authorization"]).toBe(
      `Basic ${Buffer.from("client-123:client-secret-value").toString("base64")}`,
    );

    expect(writes).toHaveLength(1);
    expect(writes[0]!["oauthAccessToken"]).toBe("brand-new-access-token");
    expect(writes[0]!["oauthAccessTokenExpiresAt"]).toBeInstanceOf(Date);

    expect(headersOf(harness.componentArgs[0]!)).toContain(
      "Bearer brand-new-access-token",
    );

    const persisted: string = JSON.stringify(lastPersisted(harness));
    expect(lastPersisted(harness)["workflowStatus"]).toBe(
      WorkflowStatus.Success,
    );
    expect(persisted).not.toContain("brand-new-access-token");
    expect(persisted).not.toContain("client-secret-value");
  });
});
