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

/*
 * Sleeps resolve at once but are recorded, so the retry schedule itself is
 * assertable without fake timers.
 */
const sleepsInMs: Array<number> = [];
// Called with every requested sleep (a test's fake clock).
const sleepHooks: Array<(ms: number) => void> = [];

jest.mock("Common/Types/Sleep", () => {
  return {
    __esModule: true,
    default: {
      sleep: async (ms: number): Promise<void> => {
        sleepsInMs.push(ms);
        for (const hook of sleepHooks) {
          hook(ms);
        }
        return undefined;
      },
    },
  };
});

const warnLog: Array<unknown> = [];

/*
 * The registration loop logs its failures rather than throwing them — that
 * log line is all the operator of the agent pod gets to see, so it is
 * captured and asserted on directly.
 */
const errorLog: Array<unknown> = [];

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: (value: unknown) => {
        warnLog.push(value);
      },
      error: (value: unknown) => {
        errorLog.push(value);
      },
    },
  };
});

function loggedErrors(): string {
  return errorLog
    .map((entry: unknown) => {
      return entry instanceof Error ? entry.message : String(entry);
    })
    .join("\n");
}

function response(
  statusCode: number,
  data?: JSONObject,
): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(statusCode, data || {}, {});
}

interface LoadedModules {
  Register: {
    registerRunner: () => Promise<void>;
    tryRegisterRunner: (data: {
      maxAttempts: number;
      shouldContinue?: () => boolean;
    }) => Promise<boolean>;
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
    KUBECTL_ALLOW_WRITES: boolean;
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
    errorLog.length = 0;
    sleepsInMs.length = 0;
    sleepHooks.length = 0;
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
    expect(modules.Config.KUBECTL_ALLOW_WRITES).toBe(false);
  });

  /*
   * The write switch fails closed: "readonly" used to parse as ALLOW and
   * the Runner registered with allowWrites: true.
   */
  test.each([
    ["readonly", false],
    ["disabled", false],
    [undefined, false],
    ["TRUE", true],
  ])(
    "ONEUPTIME_KUBECTL_ALLOW_WRITES=%p registers with allowWrites %p",
    async (value: string | undefined, expected: boolean) => {
      const modules: LoadedModules = loadInAgentMode({
        ONEUPTIME_KUBECTL_ALLOW_WRITES: value,
      });
      jest
        .spyOn(modules.KubernetesPosture, "detectKubectlVersion")
        .mockResolvedValue("v1.36.4");

      postMock.mockResolvedValueOnce(
        response(200, {
          runnerId: "11111111-1111-4111-8111-111111111111",
          runnerKey: "issued-key-abc",
          isBoundToCluster: true,
          capabilities: { canRunAiCommands: true },
        }),
      );

      await modules.Register.registerRunner();

      const request: JSONObject = postMock.mock.calls[0]![0] as JSONObject;
      expect((request["data"] as JSONObject)["allowWrites"]).toBe(expected);
    },
  );

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
    // And the log says which key to check.
    expect(loggedErrors()).toContain("oneuptime.apiKey");
    expect(loggedErrors()).not.toContain("ONEUPTIME_RUNNER_ID");
  });

  /*
   * -------------------------------------------------------------------------
   * What a refused registration logs. The server answers this route with
   * distinct, actionable reasons (a 403 while the previous instance still
   * looks online — "keep retrying"; a 422 for a disabled key; a 429 for a
   * limit), and the Runner used to log only "Failed to register Runner:
   * 403", then say it was waiting "until the server is reachable" — and a
   * 400 told the operator to check ONEUPTIME_RUNNER_ID and
   * ONEUPTIME_RUNNER_KEY, which the chart never sets.
   * -------------------------------------------------------------------------
   */
  describe("what a refused registration logs", () => {
    const REGISTERED: HTTPResponse<JSONObject> = response(200, {
      runnerId: "11111111-1111-4111-8111-111111111111",
      runnerKey: "issued-key-abc",
      isBoundToCluster: true,
      capabilities: { canRunAiCommands: true },
    });

    async function registerAfter(
      refusal: HTTPResponse<JSONObject>,
    ): Promise<string> {
      const modules: LoadedModules = loadInAgentMode({});
      jest
        .spyOn(modules.KubernetesPosture, "detectKubectlVersion")
        .mockResolvedValue("v1.36.4");

      postMock.mockResolvedValueOnce(refusal).mockResolvedValueOnce(REGISTERED);

      await modules.Register.registerRunner();

      expect(postMock).toHaveBeenCalledTimes(2);
      return loggedErrors();
    }

    test("a 403 while the previous instance still looks online says to wait, with the server's words", async () => {
      const logged: string = await registerAfter(
        response(403, {
          message:
            'Runner "kubernetes-agent/prod-us" for cluster "prod-us" is online. If the Runner pod just restarted, keep retrying: it is admitted as soon as the previous instance\'s last heartbeat is older than 5 minutes.',
        }),
      );

      expect(logged).toContain("keep retrying");
      expect(logged).toContain("prod-us");
      expect(logged).toContain("still looks online");
      expect(logged).toContain("no action is needed");
      expect(logged).not.toContain("ONEUPTIME_RUNNER_ID");
      expect(logged).not.toContain("ONEUPTIME_RUNNER_KEY");
      // The server answered, so it is not "waiting for the server".
      expect(logged).not.toContain("until the server is reachable");
    });

    test("a 422 for a disabled key says the key was refused, with the server's words", async () => {
      const logged: string = await registerAfter(
        response(422, {
          message: "This telemetry ingestion key has been disabled.",
        }),
      );

      expect(logged).toContain("has been disabled");
      expect(logged).toContain("oneuptime.apiKey");
      expect(logged).not.toContain("ONEUPTIME_RUNNER_ID");
    });

    test("a 429 says it is a limit, with the server's words", async () => {
      const logged: string = await registerAfter(
        response(429, {
          message:
            "This project registered 30 new in-cluster Runners in the last hour. Delete the Runners of clusters that no longer exist.",
        }),
      );

      expect(logged).toContain("rate limited");
      expect(logged).toContain("Delete the Runners of clusters");
    });

    test("a 400 never sends the operator to variables the chart does not set", async () => {
      const logged: string = await registerAfter(
        response(400, { message: "Project could not be resolved." }),
      );

      expect(logged).toContain("Project could not be resolved.");
      expect(logged).not.toContain("ONEUPTIME_RUNNER_ID");
      expect(logged).not.toContain("ONEUPTIME_RUNNER_KEY");
    });

    test("an overlong reason is capped, and the ingestion key never appears in the log", async () => {
      const logged: string = await registerAfter(
        response(403, {
          message: `echo ingest-key-123 ${"x".repeat(5_000)}`,
        }),
      );

      expect(logged).not.toContain("ingest-key-123");
      expect(logged).toContain("[redacted ingestion key]");
      expect(logged).not.toContain("x".repeat(600));
      expect(logged).toContain(`${"x".repeat(100)}...`);
    });

    test("a body that is not JSON (an ingress error page) is retried without a crash", async () => {
      const logged: string = await registerAfter(
        new HTTPResponse<JSONObject>(
          502,
          "<html><body>Bad Gateway</body></html>" as unknown as JSONObject,
          {},
        ),
      );

      expect(logged).toContain("502");
      expect(logged).not.toContain("<html>");
      expect(logged).not.toContain("Server said");
    });
  });

  /*
   * -------------------------------------------------------------------------
   * The retry schedule. A pod that replaces a crashed one (no sign-off) is
   * refused until the old row's last heartbeat is 5 minutes old; with the
   * 30/60/120/240s doubling it came back at about 7.5 minutes. The agent
   * Runner now retries that 403 every 20s (or when the server says), and
   * caps every other backoff at a minute.
   * -------------------------------------------------------------------------
   */
  describe("the retry schedule", () => {
    const REGISTERED: HTTPResponse<JSONObject> = response(200, {
      runnerId: "11111111-1111-4111-8111-111111111111",
      runnerKey: "issued-key-abc",
      isBoundToCluster: true,
      capabilities: { canRunAiCommands: true },
    });

    function load(): LoadedModules {
      const modules: LoadedModules = loadInAgentMode({});
      jest
        .spyOn(modules.KubernetesPosture, "detectKubectlVersion")
        .mockResolvedValue("v1.36.4");
      return modules;
    }

    test("a predecessor-online 403 is retried at a short fixed interval, never with a growing backoff", async () => {
      const modules: LoadedModules = load();

      for (let i: number = 0; i < 6; i++) {
        postMock.mockResolvedValueOnce(
          response(403, { message: "is online ... keep retrying" }),
        );
      }
      postMock.mockResolvedValueOnce(REGISTERED);

      await modules.Register.registerRunner();

      expect(postMock).toHaveBeenCalledTimes(7);
      expect(sleepsInMs).toEqual([
        20_000, 20_000, 20_000, 20_000, 20_000, 20_000,
      ]);
    });

    test("the server's own wait is honoured, capped at a minute", async () => {
      const modules: LoadedModules = load();

      postMock
        .mockResolvedValueOnce(response(403, { retryAfterSeconds: 45 }))
        .mockResolvedValueOnce(response(403, { retryAfterSeconds: 3_600 }))
        .mockResolvedValueOnce(
          new HTTPResponse<JSONObject>(403, {}, { "retry-after": "12" }),
        )
        .mockResolvedValueOnce(REGISTERED);

      await modules.Register.registerRunner();

      expect(sleepsInMs).toEqual([45_000, 60_000, 12_000]);
    });

    test("an outage still backs off, but never past a minute for the agent Runner", async () => {
      const modules: LoadedModules = load();

      for (let i: number = 0; i < 5; i++) {
        postMock.mockResolvedValueOnce(response(503, {}));
      }
      postMock.mockResolvedValueOnce(REGISTERED);

      await modules.Register.registerRunner();

      expect(sleepsInMs).toEqual([30_000, 60_000, 60_000, 60_000, 60_000]);
    });

    test("a network error is retried on the same capped backoff", async () => {
      const modules: LoadedModules = load();

      postMock
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockRejectedValueOnce(new Error("ECONNREFUSED"))
        .mockResolvedValueOnce(REGISTERED);

      await modules.Register.registerRunner();

      expect(sleepsInMs).toEqual([30_000, 60_000, 60_000]);
      expect(loggedErrors()).toContain("until the server is reachable");
    });

    /*
     * The scenario from the review, end to end on a clock: the old
     * instance's last heartbeat was 20s before the crash, the new process
     * starts 5s after it, and the server admits it once that heartbeat is
     * 5 minutes old. It must be back within a retry interval of that.
     */
    test("after a crash the replacement is admitted within 20 seconds of the alive window closing", async () => {
      const modules: LoadedModules = load();

      const LAST_HEARTBEAT_AT_MS: number = -20_000;
      const ADMITTED_FROM_MS: number = LAST_HEARTBEAT_AT_MS + 5 * 60 * 1000;
      let nowMs: number = 5_000;

      postMock.mockImplementation(async () => {
        return nowMs >= ADMITTED_FROM_MS
          ? REGISTERED
          : response(403, { message: "is online ... keep retrying" });
      });

      // Advance the fake clock by every requested sleep.
      sleepHooks.push((ms: number): void => {
        nowMs += ms;
      });

      await modules.Register.registerRunner();

      expect(nowMs).toBeGreaterThanOrEqual(ADMITTED_FROM_MS);
      expect(nowMs - ADMITTED_FROM_MS).toBeLessThanOrEqual(20_000);
    });

    test("a round the caller has ended makes no further attempt", async () => {
      const modules: LoadedModules = load();
      let keepGoing: boolean = true;

      postMock.mockImplementation(async () => {
        keepGoing = false;
        return response(403, {});
      });

      await expect(
        modules.Register.tryRegisterRunner({
          maxAttempts: 5,
          shouldContinue: () => {
            return keepGoing;
          },
        }),
      ).resolves.toBe(false);

      expect(postMock).toHaveBeenCalledTimes(1);
    });
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
