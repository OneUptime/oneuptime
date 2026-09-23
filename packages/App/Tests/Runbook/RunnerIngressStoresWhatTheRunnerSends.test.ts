import logger from "Common/Server/Utils/Logger";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import KubernetesClusterFeedService from "Common/Server/Services/KubernetesClusterFeedService";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import RunbookCredentialService from "Common/Server/Services/RunbookCredentialService";
import RunbookSecretService from "Common/Server/Services/RunbookSecretService";
import RunnerService from "Common/Server/Services/RunnerService";
import { getKubernetesAgentRunnerNameForCluster } from "Common/Server/Services/KubernetesClusterAiAccessService";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Runner, {
  RunnerConnectionStatus,
} from "Common/Models/DatabaseModels/Runner";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import {
  KubernetesAiRemediationMode,
  KubernetesRunnerPosture,
  parseKubernetesRunnerPosture,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * Contract under test — what the Runner sends to the Runner ingress is what
 * ends up stored, driven from the route handler through the real service to
 * the last call before the database:
 *
 * - POST /job/:jobId/result: a result whose output or error message carries
 *   a NUL byte is ACCEPTED (200, accepted: true). Postgres refuses U+0000 in
 *   a text value, so before round four the result could never be stored:
 *   every POST answered 500, the Runner retried it as if the server were
 *   down, and the job read "result unknown" although the command had run.
 * - POST /register-kubernetes-agent: the write scope the Runner reports —
 *   the namespaces AI may change, the pod's own namespace and whether node
 *   operations are allowed — is stored on the Runner row's posture, on a
 *   first registration and on a re-key alike, where the claim path and the
 *   AI page read it. Nothing the Runner did not report is invented.
 * ---------------------------------------------------------------------------
 */

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

type MockRoute = {
  method: string;
  uri: string;
  handlerFunction: RouterFunction;
};

const mockRoutes: Array<MockRoute> = [];

function mockRegisterRoute(
  method: string,
): (uri: string, ...handlers: Array<RouterFunction>) => void {
  return (uri: string, ...handlers: Array<RouterFunction>): void => {
    mockRoutes.push({
      method: method.toUpperCase(),
      uri,
      handlerFunction: handlers[handlers.length - 1]!,
    });
  };
}

jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...((actual["default"] as Record<string, unknown>) || {}),
      getRouter: (): Record<string, unknown> => {
        return {
          get: jest.fn().mockImplementation(mockRegisterRoute("get")),
          post: jest.fn().mockImplementation(mockRegisterRoute("post")),
          put: jest.fn().mockImplementation(mockRegisterRoute("put")),
          delete: jest.fn().mockImplementation(mockRegisterRoute("delete")),
        };
      },
    },
  };
});

// VMUtil -> isolated-vm, a native binding not installed for this suite.
jest.mock("../../FeatureSet/Runbook/Utils/Secrets", () => {
  return {
    __esModule: true,
    default: { loadForAgent: jest.fn(), populateInScript: jest.fn() },
  };
});

jest.mock("../../FeatureSet/Runbook/Utils/Credentials", () => {
  return {
    __esModule: true,
    default: { resolveForJob: jest.fn() },
  };
});

// Import AFTER the jest.mock calls above (they are hoisted by jest).
import RunnerIngressAPI from "../../FeatureSet/Runbook/API/RunnerIngress";

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const JOB_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const NUL: string = String.fromCharCode(0);
const FFFD: string = String.fromCharCode(0xfffd);

// What went over the wire, and what reached the error handler instead.
interface WireResponse {
  statusCode: number | undefined;
  body: JSONObject | undefined;
  thrownToNext: unknown;
}

async function post(data: {
  uri: string;
  body: JSONObject;
  params?: Record<string, string> | undefined;
  extra?: Record<string, unknown> | undefined;
}): Promise<WireResponse> {
  const route: MockRoute | undefined = mockRoutes.find((route: MockRoute) => {
    return route.method === "POST" && route.uri === data.uri;
  });

  if (!route) {
    throw new Error(`Route POST ${data.uri} was never registered`);
  }

  const wire: WireResponse = {
    statusCode: undefined,
    body: undefined,
    thrownToNext: undefined,
  };

  const req: ExpressRequest = {
    params: data.params || {},
    query: {},
    headers: {},
    body: data.body,
    ...(data.extra || {}),
  } as unknown as ExpressRequest;

  const res: Record<string, unknown> = {};
  res["status"] = jest.fn().mockImplementation((code: unknown) => {
    wire.statusCode = code as number;
    return res;
  });
  res["send"] = jest.fn().mockImplementation((sent: unknown) => {
    wire.body = sent as JSONObject;
    return res;
  });
  res["set"] = jest.fn().mockImplementation(() => {
    return res;
  });

  const next: jest.Mock = jest.fn();

  await route.handlerFunction(
    req,
    res as unknown as ExpressResponse,
    next as unknown as NextFunction,
  );

  wire.thrownToNext = next.mock.calls[0] ? next.mock.calls[0][0] : undefined;

  return wire;
}

function silenceLogs(): void {
  for (const level of ["warn", "info", "error", "debug"] as const) {
    jest.spyOn(logger, level).mockImplementation((): void => {
      return undefined;
    });
  }
}

describe("POST /job/:jobId/result stores a result whose text carries a NUL byte", () => {
  let queries: Array<{ sql: string; params: Array<unknown> }>;

  beforeAll(() => {
    mockRoutes.length = 0;
    new RunnerIngressAPI();
  });

  beforeEach(() => {
    silenceLogs();
    queries = [];

    /*
     * The last call before Postgres, refusing a NUL in any text parameter
     * the way Postgres does (22021, at bind time).
     */
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
      query: jest
        .fn()
        .mockImplementation(
          async (sql: string, params: Array<unknown>): Promise<unknown> => {
            queries.push({ sql, params });

            // The origins list is a text[] parameter: its items count too.
            const texts: Array<unknown> = [];
            for (const param of params) {
              if (Array.isArray(param)) {
                texts.push(...param);
              } else {
                texts.push(param);
              }
            }

            if (
              texts.some((param: unknown) => {
                return typeof param === "string" && param.includes(NUL);
              })
            ) {
              throw new Error(
                'invalid byte sequence for encoding "UTF8": 0x00',
              );
            }

            return [[{ _id: JOB_ID.toString() }], 1];
          },
        ),
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function submit(body: JSONObject): Promise<WireResponse> {
    return post({
      uri: "/job/:jobId/result",
      params: { jobId: JOB_ID.toString() },
      body,
      extra: {
        runner: { id: RUNNER_ID, _id: RUNNER_ID.toString() } as Runner,
      },
    });
  }

  test("a kubectl logs output with NUL bytes answers 200 accepted, and is stored with U+FFFD", async () => {
    const wire: WireResponse = await submit({
      success: true,
      exitCode: 0,
      output: `[stdout]\nline one\n${NUL}${NUL}line two\n`,
    });

    expect(wire.thrownToNext).toBeUndefined();
    expect(wire.statusCode).toBe(200);
    expect(wire.body).toEqual({ accepted: true });
    expect(queries).toHaveLength(1);
    expect(queries[0]!.params[1]).toBe(
      `[stdout]\nline one\n${FFFD}${FFFD}line two\n`,
    );
  });

  test("a NUL in the error message is accepted too", async () => {
    const wire: WireResponse = await submit({
      success: false,
      exitCode: 1,
      output: "",
      errorMessage: `Exit code 1: ${NUL}`,
    });

    expect(wire.thrownToNext).toBeUndefined();
    expect(wire.body).toEqual({ accepted: true });
    expect(queries[0]!.params[3]).toBe(`Exit code 1: ${FFFD}`);
  });

  test("negative control: an ordinary result is stored exactly as sent", async () => {
    const wire: WireResponse = await submit({
      success: true,
      exitCode: 0,
      output: "[stdout]\nNAME READY\nweb-1 1/1\n",
    });

    expect(wire.body).toEqual({ accepted: true });
    expect(queries[0]!.params[1]).toBe("[stdout]\nNAME READY\nweb-1 1/1\n");
  });
});

describe("POST /register-kubernetes-agent stores the write scope the Runner reports", () => {
  let cluster: KubernetesCluster;
  let existingRunner: Runner | null;
  let createdRunner: Runner | null;
  let runnerUpdates: Array<Record<string, unknown>>;

  beforeAll(() => {
    mockRoutes.length = 0;
    new RunnerIngressAPI();
  });

  beforeEach(() => {
    silenceLogs();
    createdRunner = null;
    existingRunner = null;
    runnerUpdates = [];

    // A cluster nobody configured yet: the registration first-binds it.
    cluster = {
      id: CLUSTER_ID,
      _id: CLUSTER_ID.toString(),
      projectId: PROJECT_ID,
      name: "prod-us",
      clusterIdentifier: "prod-us",
      aiAccessRunnerId: undefined,
      isAiInvestigationEnabled: false,
      aiRemediationMode: KubernetesAiRemediationMode.Disabled,
    } as unknown as KubernetesCluster;

    jest
      .spyOn(KubernetesClusterService, "findOrCreateByClusterIdentifier")
      .mockImplementation(async (): Promise<KubernetesCluster> => {
        return cluster;
      });
    jest
      .spyOn(KubernetesClusterService, "findOneBy")
      .mockImplementation(async (): Promise<KubernetesCluster> => {
        return cluster;
      });
    jest
      .spyOn(KubernetesClusterService, "updateOneById")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(KubernetesClusterService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(RunnerService, "findOneBy")
      .mockImplementation(async (): Promise<Runner | null> => {
        return existingRunner;
      });
    jest
      .spyOn(RunnerService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(RunnerService, "create")
      .mockImplementation(async (args: unknown): Promise<Runner> => {
        const data: Runner = (args as { data: Runner }).data;
        data.id = RUNNER_ID;
        createdRunner = data;
        return data;
      });
    jest
      .spyOn(RunnerService, "updateOneById")
      .mockImplementation(async (args: unknown): Promise<never> => {
        runnerUpdates.push((args as { data: Record<string, unknown> }).data);
        return undefined as never;
      });
    jest
      .spyOn(RunbookCredentialService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(RunbookSecretService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(KubernetesClusterFeedService, "createKubernetesClusterFeedItem")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The body the kubernetes-agent Runner sends (RegisterRunner).
  const RUNNER_BODY: JSONObject = {
    clusterName: "prod-us",
    agentVersion: "13.0.4",
    allowWrites: true,
    allowNodeOperations: false,
    kubectlVersion: "v1.36.4",
    agentChartVersion: "0.9.0",
    writeNamespaces: ["web", "api"],
    podNamespace: "oneuptime-agent",
  };

  function register(body: JSONObject): Promise<WireResponse> {
    return post({
      uri: "/register-kubernetes-agent",
      body,
      extra: { projectId: PROJECT_ID },
    });
  }

  function storedPosture(hostInfo: unknown): Record<string, unknown> {
    return (hostInfo as { kubernetes: Record<string, unknown> }).kubernetes;
  }

  test("a first registration stores them on the new Runner row", async () => {
    const wire: WireResponse = await register(RUNNER_BODY);

    expect(wire.thrownToNext).toBeUndefined();
    expect(wire.statusCode).toBe(200);
    expect(wire.body!["bindingState"]).toBe("first_bind");
    expect(createdRunner).not.toBeNull();

    expect(storedPosture(createdRunner!.hostInfo)).toEqual({
      allowWrites: true,
      kubectlVersion: "v1.36.4",
      agentChartVersion: "0.9.0",
      writeNamespaces: ["web", "api"],
      podNamespace: "oneuptime-agent",
      allowNodeOperations: false,
      clusterIdentifier: "prod-us",
      inCluster: true,
    });

    // And the posture every reader parses back is the one the Runner sent.
    const parsed: KubernetesRunnerPosture | undefined =
      parseKubernetesRunnerPosture(createdRunner!.hostInfo);
    expect(parsed?.writeNamespaces).toEqual(["web", "api"]);
    expect(parsed?.podNamespace).toBe("oneuptime-agent");
    expect(parsed?.allowNodeOperations).toBe(false);
  });

  test("a re-key of the existing (offline) Runner row stores them too", async () => {
    existingRunner = {
      id: RUNNER_ID,
      _id: RUNNER_ID.toString(),
      name: getKubernetesAgentRunnerNameForCluster("prod-us"),
      key: "old-key",
      lastAlive: OneUptimeDate.getSomeMinutesAgo(30),
      connectionStatus: RunnerConnectionStatus.Disconnected,
      canRunRunbooks: false,
      canRunCodeFixTasks: false,
      hostInfo: {
        kubernetes: {
          inCluster: true,
          clusterIdentifier: "prod-us",
          allowWrites: false,
        },
      },
    } as unknown as Runner;

    const wire: WireResponse = await register({
      ...RUNNER_BODY,
      writeNamespaces: ["payments"],
      allowNodeOperations: true,
    });

    expect(wire.statusCode).toBe(200);
    expect(createdRunner).toBeNull();
    expect(runnerUpdates).toHaveLength(1);

    const stored: Record<string, unknown> = storedPosture(
      runnerUpdates[0]!["hostInfo"],
    );
    expect(stored["writeNamespaces"]).toEqual(["payments"]);
    expect(stored["podNamespace"]).toBe("oneuptime-agent");
    expect(stored["allowNodeOperations"]).toBe(true);
    expect(stored["allowWrites"]).toBe(true);
  });

  test("an empty namespace list is stored as the empty list the Runner sent, not dropped", async () => {
    await register({ ...RUNNER_BODY, writeNamespaces: [] });

    expect(storedPosture(createdRunner!.hostInfo)["writeNamespaces"]).toEqual(
      [],
    );
  });

  test("negative control: a Runner that does not report them leaves them unknown on the row", async () => {
    await register({
      clusterName: "prod-us",
      allowWrites: true,
    });

    const stored: Record<string, unknown> = storedPosture(
      createdRunner!.hostInfo,
    );
    expect(stored["writeNamespaces"]).toBeUndefined();
    expect(stored["podNamespace"]).toBeUndefined();
    expect(stored["allowNodeOperations"]).toBeUndefined();
    expect(stored["allowWrites"]).toBe(true);
  });

  test("the body can never claim another cluster or an out-of-cluster posture", async () => {
    await register({
      ...RUNNER_BODY,
      clusterIdentifier: "someone-else",
      inCluster: false,
    });

    const stored: Record<string, unknown> = storedPosture(
      createdRunner!.hostInfo,
    );
    expect(stored["clusterIdentifier"]).toBe("prod-us");
    expect(stored["inCluster"]).toBe(true);
  });
});
