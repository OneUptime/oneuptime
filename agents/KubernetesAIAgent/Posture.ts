import fs from "fs";
import os from "os";
import { spawn } from "child_process";
import { AgentConfig } from "./Config";
import { KubernetesAgentPosture } from "./Common/Types/Kubernetes/KubernetesClusterAiAccess";

/*
 * What the agent can say about its own Kubernetes reach: whether it runs in
 * a pod with a mounted ServiceAccount token, whether writes and node
 * operations are allowed, into which namespaces, and which kubectl it
 * carries. It is sent on registration and on every heartbeat, so the
 * cluster's AI agent page describes the pod that is actually running.
 */

export const SERVICE_ACCOUNT_DIR: string =
  "/var/run/secrets/kubernetes.io/serviceaccount";

/*
 * Where the kubelet mounts the pod's ServiceAccount. A parameter everywhere
 * it is used, so tests can point it at a temporary directory; production
 * always uses the defaults below.
 */
export interface ServiceAccountPaths {
  token: string;
  ca: string;
  namespace: string;
}

export const DEFAULT_SERVICE_ACCOUNT_PATHS: ServiceAccountPaths = {
  token: `${SERVICE_ACCOUNT_DIR}/token`,
  ca: `${SERVICE_ACCOUNT_DIR}/ca.crt`,
  namespace: `${SERVICE_ACCOUNT_DIR}/namespace`,
};

// The in-cluster API server address, as kubectl's own detection reads it.
export interface InClusterApiServer {
  host: string;
  port: string;
}

const KUBECTL_VERSION_TIMEOUT_MS: number = 10_000;

/*
 * The posture as the agent sends it (the wire protocol's `posture`): the
 * shared KubernetesAgentPosture, with the fields the agent always knows
 * made required.
 */
export interface AgentPosture extends KubernetesAgentPosture {
  clusterIdentifier: string;
  inCluster: boolean;
  allowWrites: boolean;
  allowNodeOperations: boolean;
  writeNamespaces: Array<string>;
}

/*
 * The in-cluster API server the pod's ServiceAccount talks to, or null
 * outside a pod. Both HOST and PORT are needed — client-go's own in-cluster
 * detection needs both, and a host without a port cannot be dialled.
 */
export function getInClusterApiServer(
  env: NodeJS.ProcessEnv,
): InClusterApiServer | null {
  const host: string = (env["KUBERNETES_SERVICE_HOST"] || "").trim();
  const port: string = (env["KUBERNETES_SERVICE_PORT"] || "").trim();

  if (!host || !port) {
    return null;
  }

  return { host, port };
}

export function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/*
 * Whether this process runs inside a pod with a usable ServiceAccount: the
 * API server's service host AND port in the environment, and a mounted
 * token that is a file — the three facts kubectl's in-cluster detection
 * (client-go inClusterClientConfig) needs.
 */
export function isInCluster(data: {
  env: NodeJS.ProcessEnv;
  serviceAccount: ServiceAccountPaths;
}): boolean {
  return (
    getInClusterApiServer(data.env) !== null &&
    isFile(data.serviceAccount.token)
  );
}

/*
 * The namespace the pod runs in: the chart's downward-API value when set,
 * else the ServiceAccount mount's namespace file, else null. Lowercased,
 * like every namespace the write scope compares.
 */
export function resolvePodNamespace(data: {
  configured: string | null;
  serviceAccount: ServiceAccountPaths;
}): string | null {
  const configured: string = (data.configured || "").trim().toLowerCase();

  if (configured) {
    return configured;
  }

  try {
    const fromMount: string = fs
      .readFileSync(data.serviceAccount.namespace, "utf8")
      .trim()
      .toLowerCase();
    return fromMount || null;
  } catch {
    return null;
  }
}

export function buildPosture(data: {
  config: AgentConfig;
  env: NodeJS.ProcessEnv;
  serviceAccount: ServiceAccountPaths;
  kubectlVersion: string | null;
}): AgentPosture {
  const podNamespace: string | null = resolvePodNamespace({
    configured: data.config.podNamespace,
    serviceAccount: data.serviceAccount,
  });

  return {
    clusterIdentifier: data.config.clusterName,
    inCluster: isInCluster({
      env: data.env,
      serviceAccount: data.serviceAccount,
    }),
    allowWrites: data.config.allowWrites,
    /*
     * What the agent would actually run: a node operation is a write, so an
     * agent that refuses writes refuses node operations too, whatever the
     * node switch says.
     */
    allowNodeOperations:
      data.config.allowWrites && data.config.allowNodeOperations,
    writeNamespaces: [...data.config.writeNamespaces],
    ...(podNamespace ? { podNamespace } : {}),
    ...(data.kubectlVersion ? { kubectlVersion: data.kubectlVersion } : {}),
    ...(data.config.chartVersion
      ? { agentChartVersion: data.config.chartVersion }
      : {}),
  };
}

/*
 * "vX.Y.Z" from `kubectl version --client -o json`, or null when kubectl is
 * missing or answers something else. Run once in a closed environment (no
 * kuberc preferences, a throwaway HOME) and cached for the life of the
 * process: the binary does not change under a running container.
 */
export class KubectlVersionProbe {
  private cached: Promise<string | null> | null = null;

  public constructor(
    private readonly options: {
      binary?: string | undefined;
      // The PATH kubectl is looked up on (the agent's own by default).
      path?: string | undefined;
      timeoutMs?: number | undefined;
    } = {},
  ) {}

  public detect(): Promise<string | null> {
    if (!this.cached) {
      this.cached = probeKubectlVersion({
        binary: this.options.binary || "kubectl",
        path: this.options.path,
        timeoutMs: this.options.timeoutMs ?? KUBECTL_VERSION_TIMEOUT_MS,
      });
    }

    return this.cached;
  }
}

export function parseKubectlClientVersion(stdout: string): string | null {
  try {
    const parsed: unknown = JSON.parse(stdout);

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const clientVersion: unknown = (parsed as Record<string, unknown>)[
      "clientVersion"
    ];

    if (!clientVersion || typeof clientVersion !== "object") {
      return null;
    }

    const gitVersion: unknown = (clientVersion as Record<string, unknown>)[
      "gitVersion"
    ];

    return typeof gitVersion === "string" && gitVersion.trim()
      ? gitVersion.trim()
      : null;
  } catch {
    return null;
  }
}

function probeKubectlVersion(data: {
  binary: string;
  path: string | undefined;
  timeoutMs: number;
}): Promise<string | null> {
  return new Promise<string | null>(
    (resolve: (value: string | null) => void): void => {
      let stdout: string = "";
      let settled: boolean = false;

      const finish: (value: string | null) => void = (
        value: string | null,
      ): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };

      let child: ReturnType<typeof spawn>;

      try {
        child = spawn(data.binary, ["version", "--client", "-o", "json"], {
          timeout: data.timeoutMs,
          killSignal: "SIGKILL",
          stdio: ["ignore", "pipe", "ignore"],
          env: {
            PATH:
              data.path ||
              process.env["PATH"] ||
              "/usr/local/bin:/usr/bin:/bin",
            HOME: os.tmpdir(),
            KUBERC: "off",
            KUBECTL_KUBERC: "false",
          },
        });
      } catch {
        finish(null);
        return;
      }

      child.stdout?.on("data", (chunk: Buffer): void => {
        stdout += chunk.toString("utf8");
      });

      child.on("error", (): void => {
        finish(null);
      });

      child.on("close", (code: number | null): void => {
        finish(code === 0 ? parseKubectlClientVersion(stdout) : null);
      });
    },
  );
}
