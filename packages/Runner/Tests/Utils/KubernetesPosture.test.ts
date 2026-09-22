/*
 * ---------------------------------------------------------------------------
 * KubernetesPosture: what a Runner may claim about its own cluster reach.
 *
 * The bug this pins: any Runner that happened to run in a pod (service host
 * in the environment + a mounted ServiceAccount token) reported itself as
 * in-cluster, and the server took that as the whole answer — so an ordinary
 * project Runner deployed in staging, selected on production's AI page, ran
 * every credential-less command against staging. Being in a pod says
 * nothing about WHICH cluster; only the kubernetes-agent Runner, which
 * registered with the cluster's name, may claim in-cluster access.
 *
 * Config.ts decides the mode from the environment at import time, so the
 * agent-mode cases load the modules in isolation with the environment set
 * first; the project-mode cases use the suite's jest.setup defaults.
 * ---------------------------------------------------------------------------
 */

import fs from "fs";
import { KubernetesRunnerPosture } from "Common/Types/Kubernetes/KubernetesClusterAiAccess";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  };
});

import KubernetesPosture, {
  SERVICE_ACCOUNT_TOKEN_PATH,
} from "../../Utils/KubernetesPosture";
import KubernetesAgentMode from "../../Utils/KubernetesAgentMode";

interface PostureModule {
  isInCluster: () => boolean;
  canUseOwnServiceAccount: () => boolean;
  build: () => Promise<KubernetesRunnerPosture>;
  detectKubectlVersion: () => Promise<string | null>;
}

interface AgentModeModule {
  isActive: () => boolean;
}

// Pretend the process runs in a pod: service host set, token mounted.
function pretendInPod(): void {
  process.env["KUBERNETES_SERVICE_HOST"] = "10.0.0.1";
  jest.spyOn(fs, "existsSync").mockImplementation((target: fs.PathLike) => {
    return String(target) === SERVICE_ACCOUNT_TOKEN_PATH;
  });
}

function loadIsolated(env: Record<string, string | undefined>): {
  KubernetesPosture: PostureModule;
  KubernetesAgentMode: AgentModeModule;
} {
  jest.resetModules();
  process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  const posture: PostureModule = require("../../Utils/KubernetesPosture")
    .default as PostureModule;
  const mode: AgentModeModule = require("../../Utils/KubernetesAgentMode")
    .default as AgentModeModule;
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

  return { KubernetesPosture: posture, KubernetesAgentMode: mode };
}

describe("KubernetesPosture in project mode (jest.setup defaults)", () => {
  const savedEnv: NodeJS.ProcessEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
    jest.restoreAllMocks();
  });

  test("the suite really is in project mode", () => {
    expect(KubernetesAgentMode.isActive()).toBe(false);
  });

  test("isInCluster reports the raw fact about the process", () => {
    delete process.env["KUBERNETES_SERVICE_HOST"];
    expect(KubernetesPosture.isInCluster()).toBe(false);

    pretendInPod();
    expect(KubernetesPosture.isInCluster()).toBe(true);
  });

  test("a project Runner that merely runs in a pod may NOT use its ServiceAccount", () => {
    pretendInPod();

    expect(KubernetesPosture.isInCluster()).toBe(true);
    expect(KubernetesPosture.canUseOwnServiceAccount()).toBe(false);
  });

  test("build() never claims in-cluster access or a cluster identity outside agent mode", async () => {
    pretendInPod();
    jest
      .spyOn(KubernetesPosture, "detectKubectlVersion")
      .mockResolvedValue("v1.31.4");

    const posture: KubernetesRunnerPosture = await KubernetesPosture.build();

    expect(posture.inCluster).toBe(false);
    expect(posture.clusterIdentifier).toBeUndefined();
    // The facts that are true of any Runner are still reported.
    expect(posture.kubectlVersion).toBe("v1.31.4");
  });

  test("canUseOwnServiceAccount follows the mode, not just the pod", () => {
    pretendInPod();
    jest.spyOn(KubernetesAgentMode, "isActive").mockReturnValue(true);

    expect(KubernetesPosture.canUseOwnServiceAccount()).toBe(true);

    (KubernetesAgentMode.isActive as jest.Mock).mockReturnValue(false);

    expect(KubernetesPosture.canUseOwnServiceAccount()).toBe(false);
  });
});

describe("KubernetesPosture with the mode decided from the environment", () => {
  const savedEnv: NodeJS.ProcessEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test("the kubernetes-agent Runner in its pod may use its ServiceAccount and names its cluster", async () => {
    const modules: ReturnType<typeof loadIsolated> = loadIsolated({
      ONEUPTIME_RUNNER_ID: undefined,
      ONEUPTIME_RUNNER_KEY: undefined,
      ONEUPTIME_INGESTION_KEY: "ingest-key-123",
      ONEUPTIME_KUBERNETES_CLUSTER_NAME: "prod-us",
      ONEUPTIME_KUBECTL_ALLOW_WRITES: "false",
    });
    pretendInPod();
    jest
      .spyOn(modules.KubernetesPosture, "detectKubectlVersion")
      .mockResolvedValue("v1.31.4");

    expect(modules.KubernetesAgentMode.isActive()).toBe(true);
    expect(modules.KubernetesPosture.canUseOwnServiceAccount()).toBe(true);

    const posture: KubernetesRunnerPosture =
      await modules.KubernetesPosture.build();

    expect(posture).toEqual({
      clusterIdentifier: "prod-us",
      inCluster: true,
      allowWrites: false,
      kubectlVersion: "v1.31.4",
      agentChartVersion: undefined,
    });
  });

  test("the kubernetes-agent Runner outside any pod may not use a ServiceAccount it does not have", () => {
    const modules: ReturnType<typeof loadIsolated> = loadIsolated({
      ONEUPTIME_RUNNER_ID: undefined,
      ONEUPTIME_RUNNER_KEY: undefined,
      ONEUPTIME_INGESTION_KEY: "ingest-key-123",
      ONEUPTIME_KUBERNETES_CLUSTER_NAME: "prod-us",
      KUBERNETES_SERVICE_HOST: undefined,
    });

    expect(modules.KubernetesAgentMode.isActive()).toBe(true);
    expect(modules.KubernetesPosture.isInCluster()).toBe(false);
    expect(modules.KubernetesPosture.canUseOwnServiceAccount()).toBe(false);
  });

  /*
   * A dashboard-issued Runner with the agent's env vars ALSO set is still a
   * project Runner (ONEUPTIME_RUNNER_ID wins in Config), so it must not
   * report a cluster identity it has no registration for.
   */
  test("a project Runner given a cluster name in its environment still reports no posture", async () => {
    const modules: ReturnType<typeof loadIsolated> = loadIsolated({
      ONEUPTIME_RUNNER_ID: "00000000-0000-4000-8000-000000000000",
      ONEUPTIME_RUNNER_KEY: "test-runner-key",
      ONEUPTIME_INGESTION_KEY: "ingest-key-123",
      ONEUPTIME_KUBERNETES_CLUSTER_NAME: "prod-us",
    });
    pretendInPod();
    jest
      .spyOn(modules.KubernetesPosture, "detectKubectlVersion")
      .mockResolvedValue(null);

    expect(modules.KubernetesAgentMode.isActive()).toBe(false);
    expect(modules.KubernetesPosture.canUseOwnServiceAccount()).toBe(false);

    const posture: KubernetesRunnerPosture =
      await modules.KubernetesPosture.build();

    expect(posture.inCluster).toBe(false);
    expect(posture.clusterIdentifier).toBeUndefined();
  });
});
