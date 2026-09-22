/*
 * ---------------------------------------------------------------------------
 * Kubernetes-agent mode registration: the Runner the kubernetes-agent chart
 * installs has no dashboard-issued identity. It must exchange the project's
 * ingestion key and the cluster's name for a Runner id + key, remember both
 * for every later request, and take its capabilities from the server.
 *
 * Config.ts decides the mode from the environment at import time, so this
 * suite sets the environment BEFORE requiring anything under test and loads
 * the modules in isolation from jest.setup's project-mode defaults.
 * ---------------------------------------------------------------------------
 */

import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";

const postMock: jest.Mock = jest.fn();

jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
    },
  };
});

jest.mock("Common/Types/Sleep", () => {
  return {
    __esModule: true,
    default: {
      sleep: async (): Promise<void> => {
        return undefined;
      },
    },
  };
});

const warnLog: Array<unknown> = [];

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: (value: unknown) => {
        warnLog.push(value);
      },
      error: jest.fn(),
    },
  };
});

function response(
  statusCode: number,
  data?: JSONObject,
): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(statusCode, data || {}, {});
}

interface LoadedModules {
  Register: {
    registerRunner: () => Promise<void>;
    tryRegisterRunner: (data: { maxAttempts: number }) => Promise<boolean>;
  };
  RunnerIdentity: {
    getRunnerId: () => { toString: () => string };
    getRunnerKey: () => string;
  };
  RunnerCapabilities: {
    resolve: () => {
      canRunRunbooks: boolean;
      canRunCodeFixTasks: boolean;
      canRunAiCommands: boolean;
    };
  };
  Config: {
    IS_KUBERNETES_AGENT_MODE: boolean;
    KUBECTL_ALLOW_WRITES_OVERRIDE: boolean | null;
  };
  KubernetesPosture: {
    detectKubectlVersion: () => Promise<string | null>;
    isInCluster: () => boolean;
    resetCache: () => void;
  };
}

function loadInAgentMode(
  env: Record<string, string | undefined>,
): LoadedModules {
  jest.resetModules();
  delete process.env["ONEUPTIME_RUNNER_ID"];
  delete process.env["ONEUPTIME_RUNNER_KEY"];
  process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
  process.env["ONEUPTIME_INGESTION_KEY"] = "ingest-key-123";
  process.env["ONEUPTIME_KUBERNETES_CLUSTER_NAME"] = "prod-us";
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  const Config: LoadedModules["Config"] = require("../../Config");
  const KubernetesPosture: LoadedModules["KubernetesPosture"] =
    require("../../Utils/KubernetesPosture").default;
  const Register: LoadedModules["Register"] =
    require("../../Services/RegisterRunner").default;
  const RunnerIdentity: LoadedModules["RunnerIdentity"] =
    require("../../Utils/RunnerIdentity").default;
  const RunnerCapabilities: LoadedModules["RunnerCapabilities"] =
    require("../../Utils/RunnerCapabilities").default;
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

  return {
    Register,
    RunnerIdentity,
    RunnerCapabilities,
    Config,
    KubernetesPosture,
  };
}

describe("Register.registerRunner in kubernetes-agent mode", () => {
  const savedEnv: NodeJS.ProcessEnv = { ...process.env };

  beforeEach(() => {
    postMock.mockReset();
    warnLog.length = 0;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    jest.restoreAllMocks();
  });

  test("Config recognises the mode from the ingestion key and cluster name alone", () => {
    const modules: LoadedModules = loadInAgentMode({
      ONEUPTIME_KUBECTL_ALLOW_WRITES: "false",
    });

    expect(modules.Config.IS_KUBERNETES_AGENT_MODE).toBe(true);
    expect(modules.Config.KUBECTL_ALLOW_WRITES_OVERRIDE).toBe(false);
  });

  test("registers with the ingestion key header, stores the issued identity and adopts the server's capabilities", async () => {
    const modules: LoadedModules = loadInAgentMode({
      ONEUPTIME_KUBECTL_ALLOW_WRITES: "true",
      ONEUPTIME_KUBERNETES_AGENT_CHART_VERSION: "0.7.0",
    });
    jest
      .spyOn(modules.KubernetesPosture, "detectKubectlVersion")
      .mockResolvedValue("v1.31.4");
    jest.spyOn(modules.KubernetesPosture, "isInCluster").mockReturnValue(true);

    postMock.mockResolvedValueOnce(
      response(200, {
        runnerId: "11111111-1111-4111-8111-111111111111",
        runnerKey: "issued-key-abc",
        clusterId: "33333333-3333-4333-8333-333333333333",
        isBoundToCluster: true,
        capabilities: {
          canRunRunbooks: false,
          canRunCodeFixTasks: false,
          canRunAiCommands: true,
        },
      }),
    );

    await modules.Register.registerRunner();

    expect(postMock).toHaveBeenCalledTimes(1);
    const request: JSONObject = postMock.mock.calls[0]![0] as JSONObject;
    expect(String(request["url"])).toBe(
      "https://oneuptime.example.com/runner-ingest/register-kubernetes-agent",
    );
    expect(request["headers"]).toEqual({
      "x-oneuptime-token": "ingest-key-123",
    });
    expect(request["data"]).toMatchObject({
      clusterName: "prod-us",
      allowWrites: true,
      kubectlVersion: "v1.31.4",
      agentChartVersion: "0.7.0",
    });

    expect(modules.RunnerIdentity.getRunnerId().toString()).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(modules.RunnerIdentity.getRunnerKey()).toBe("issued-key-abc");
    expect(modules.RunnerCapabilities.resolve()).toEqual({
      canRunRunbooks: false,
      canRunCodeFixTasks: false,
      canRunAiCommands: true,
    });
    expect(warnLog).toEqual([]);
  });

  /*
   * The server re-keys a live Runner only when the request proves it is the
   * same Runner by presenting the current key. A fresh pod has nothing to
   * present; a running process re-registering (the heartbeat loop) does.
   */
  test("a first registration sends no previousRunnerKey; a re-registration sends the key it holds", async () => {
    const modules: LoadedModules = loadInAgentMode({});
    jest
      .spyOn(modules.KubernetesPosture, "detectKubectlVersion")
      .mockResolvedValue("v1.31.4");

    postMock
      .mockResolvedValueOnce(
        response(200, {
          runnerId: "11111111-1111-4111-8111-111111111111",
          runnerKey: "issued-key-abc",
          isBoundToCluster: true,
          capabilities: { canRunAiCommands: true },
        }),
      )
      .mockResolvedValueOnce(
        response(200, {
          runnerId: "11111111-1111-4111-8111-111111111111",
          runnerKey: "rotated-key-xyz",
          isBoundToCluster: true,
          capabilities: { canRunAiCommands: true },
        }),
      );

    await modules.Register.registerRunner();
    const first: JSONObject = postMock.mock.calls[0]![0] as JSONObject;
    expect(Object.keys(first["data"] as JSONObject)).not.toContain(
      "previousRunnerKey",
    );

    await modules.Register.tryRegisterRunner({ maxAttempts: 1 });
    const second: JSONObject = postMock.mock.calls[1]![0] as JSONObject;
    expect((second["data"] as JSONObject)["previousRunnerKey"]).toBe(
      "issued-key-abc",
    );
    expect(modules.RunnerIdentity.getRunnerKey()).toBe("rotated-key-xyz");
  });

  test("explains an operator-cleared binding differently from a binding another Runner holds", async () => {
    const modules: LoadedModules = loadInAgentMode({});
    jest
      .spyOn(modules.KubernetesPosture, "detectKubectlVersion")
      .mockResolvedValue("v1.31.4");

    postMock.mockResolvedValueOnce(
      response(200, {
        runnerId: "11111111-1111-4111-8111-111111111111",
        runnerKey: "issued-key-abc",
        isBoundToCluster: false,
        bindingState: "left_unbound_by_operator",
        capabilities: { canRunAiCommands: true },
      }),
    );

    await modules.Register.registerRunner();

    expect(
      warnLog.some((entry: unknown) => {
        return String(entry).includes("an operator cleared it");
      }),
    ).toBe(true);
    expect(
      warnLog.some((entry: unknown) => {
        return String(entry).includes("bound to a different Runner");
      }),
    ).toBe(false);
  });

  test("warns when the dashboard bound the cluster to a different Runner", async () => {
    const modules: LoadedModules = loadInAgentMode({});
    jest
      .spyOn(modules.KubernetesPosture, "detectKubectlVersion")
      .mockResolvedValue("v1.31.4");

    postMock.mockResolvedValueOnce(
      response(200, {
        runnerId: "11111111-1111-4111-8111-111111111111",
        runnerKey: "issued-key-abc",
        isBoundToCluster: false,
        capabilities: { canRunAiCommands: true },
      }),
    );

    await modules.Register.registerRunner();

    expect(
      warnLog.some((entry: unknown) => {
        return String(entry).includes("bound to a different Runner");
      }),
    ).toBe(true);
  });

  test("retries on a rejected ingestion key and explains which key to check", async () => {
    const modules: LoadedModules = loadInAgentMode({});
    jest
      .spyOn(modules.KubernetesPosture, "detectKubectlVersion")
      .mockResolvedValue(null);

    postMock.mockResolvedValueOnce(response(401, {})).mockResolvedValueOnce(
      response(200, {
        runnerId: "11111111-1111-4111-8111-111111111111",
        runnerKey: "issued-key-abc",
        isBoundToCluster: true,
        capabilities: { canRunAiCommands: true },
      }),
    );

    await modules.Register.registerRunner();

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(modules.RunnerIdentity.getRunnerKey()).toBe("issued-key-abc");
    // kubectl missing is surfaced, not hidden.
    expect(
      warnLog.some((entry: unknown) => {
        return String(entry).includes("kubectl was not found");
      }),
    ).toBe(true);
  });

  /*
   * The heartbeat loop re-registers with a bounded budget: a revoked
   * ingestion key must produce a trickle of attempts, not a loop that never
   * returns (the start-up registration is the one that retries forever).
   */
  describe("tryRegisterRunner (bounded, for re-registration)", () => {
    test("gives up after maxAttempts, returns false and keeps the current identity", async () => {
      const modules: LoadedModules = loadInAgentMode({});
      jest
        .spyOn(modules.KubernetesPosture, "detectKubectlVersion")
        .mockResolvedValue("v1.31.4");

      postMock.mockResolvedValue(response(401, {}));

      await expect(
        modules.Register.tryRegisterRunner({ maxAttempts: 3 }),
      ).resolves.toBe(false);

      expect(postMock).toHaveBeenCalledTimes(3);
      // Nothing was issued, so there is still no identity to speak of.
      expect(() => {
        return modules.RunnerIdentity.getRunnerKey();
      }).toThrow(/has not finished registering/);
    });

    test("returns true as soon as an attempt within the budget succeeds", async () => {
      const modules: LoadedModules = loadInAgentMode({});
      jest
        .spyOn(modules.KubernetesPosture, "detectKubectlVersion")
        .mockResolvedValue("v1.31.4");

      postMock
        .mockResolvedValueOnce(response(503, {}))
        .mockResolvedValueOnce(response(503, {}))
        .mockResolvedValueOnce(
          response(200, {
            runnerId: "11111111-1111-4111-8111-111111111111",
            runnerKey: "rotated-key-xyz",
            isBoundToCluster: true,
            capabilities: { canRunAiCommands: true },
          }),
        );

      await expect(
        modules.Register.tryRegisterRunner({ maxAttempts: 5 }),
      ).resolves.toBe(true);

      expect(postMock).toHaveBeenCalledTimes(3);
      expect(modules.RunnerIdentity.getRunnerKey()).toBe("rotated-key-xyz");
    });

    test("a budget below one still makes exactly one attempt", async () => {
      const modules: LoadedModules = loadInAgentMode({});
      jest
        .spyOn(modules.KubernetesPosture, "detectKubectlVersion")
        .mockResolvedValue(null);

      postMock.mockResolvedValue(response(401, {}));

      await expect(
        modules.Register.tryRegisterRunner({ maxAttempts: 0 }),
      ).resolves.toBe(false);

      expect(postMock).toHaveBeenCalledTimes(1);
    });

    test("a failed round leaves the previously issued identity in place", async () => {
      const modules: LoadedModules = loadInAgentMode({});
      jest
        .spyOn(modules.KubernetesPosture, "detectKubectlVersion")
        .mockResolvedValue("v1.31.4");

      postMock.mockResolvedValueOnce(
        response(200, {
          runnerId: "11111111-1111-4111-8111-111111111111",
          runnerKey: "issued-key-abc",
          isBoundToCluster: true,
          capabilities: { canRunAiCommands: true },
        }),
      );
      await modules.Register.registerRunner();

      postMock.mockResolvedValue(response(401, {}));
      await expect(
        modules.Register.tryRegisterRunner({ maxAttempts: 2 }),
      ).resolves.toBe(false);

      expect(modules.RunnerIdentity.getRunnerKey()).toBe("issued-key-abc");
    });
  });
});
