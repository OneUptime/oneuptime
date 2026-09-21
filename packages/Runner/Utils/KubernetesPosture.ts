import fs from "fs";
import { spawn } from "child_process";
import {
  KUBECTL_ALLOW_WRITES_OVERRIDE,
  KUBERNETES_AGENT_CHART_VERSION,
  KUBERNETES_AGENT_CLUSTER_NAME,
} from "../Config";
import { KubernetesRunnerPosture } from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import logger from "Common/Server/Utils/Logger";

/*
 * What this Runner can say about its own Kubernetes reach: whether it runs
 * inside a cluster (a pod with a mounted ServiceAccount), whether its host
 * lets AI-composed writes through, and which kubectl it carries. Reported
 * at registration and on every heartbeat, so the dashboard's "what is
 * missing" checklist reflects the container that is actually running.
 */

export const SERVICE_ACCOUNT_TOKEN_PATH: string =
  "/var/run/secrets/kubernetes.io/serviceaccount/token";

const KUBECTL_VERSION_TIMEOUT_MS: number = 10_000;

export default class KubernetesPosture {
  private static cachedKubectlVersion: string | null | undefined = undefined;

  /*
   * kubectl's own in-cluster detection is the same two facts: the API
   * server's service host in the environment and a mounted token.
   */
  public static isInCluster(): boolean {
    if (!process.env["KUBERNETES_SERVICE_HOST"]) {
      return false;
    }

    try {
      return fs.existsSync(SERVICE_ACCOUNT_TOKEN_PATH);
    } catch {
      return false;
    }
  }

  /*
   * Only "false" refuses: an external Runner with a Kubernetes credential
   * is bounded by that credential's RBAC, so writes are allowed unless the
   * host says otherwise. The chart sets this explicitly from
   * aiAccess.remediation.enabled.
   */
  public static allowsWrites(): boolean {
    return KUBECTL_ALLOW_WRITES_OVERRIDE !== false;
  }

  public static async build(): Promise<KubernetesRunnerPosture> {
    return {
      clusterIdentifier: KUBERNETES_AGENT_CLUSTER_NAME || undefined,
      inCluster: KubernetesPosture.isInCluster(),
      allowWrites: KubernetesPosture.allowsWrites(),
      kubectlVersion:
        (await KubernetesPosture.detectKubectlVersion()) || undefined,
      agentChartVersion: KUBERNETES_AGENT_CHART_VERSION || undefined,
    };
  }

  /*
   * "vX.Y.Z" from `kubectl version --client -o json`, or null when the
   * binary is missing — which is itself the diagnostic an operator needs
   * when a kubectl job fails on this host.
   */
  public static async detectKubectlVersion(): Promise<string | null> {
    if (KubernetesPosture.cachedKubectlVersion !== undefined) {
      return KubernetesPosture.cachedKubectlVersion;
    }

    const version: string | null = await new Promise<string | null>(
      (resolve: (value: string | null) => void) => {
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
          child = spawn("kubectl", ["version", "--client", "-o", "json"], {
            timeout: KUBECTL_VERSION_TIMEOUT_MS,
            killSignal: "SIGKILL",
            stdio: ["ignore", "pipe", "ignore"],
          });
        } catch {
          finish(null);
          return;
        }

        child.stdout?.on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
        });

        child.on("error", () => {
          finish(null);
        });

        child.on("close", (code: number | null) => {
          if (code !== 0) {
            finish(null);
            return;
          }

          try {
            const parsed: { clientVersion?: { gitVersion?: string } } =
              JSON.parse(stdout);
            finish(parsed.clientVersion?.gitVersion || null);
          } catch {
            finish(null);
          }
        });
      },
    );

    if (!version) {
      logger.warn(
        "kubectl is not available on this Runner's PATH — kubectl jobs for OneUptime AI will fail here.",
      );
    }

    KubernetesPosture.cachedKubectlVersion = version;
    return version;
  }

  // Test seam.
  public static resetCache(): void {
    KubernetesPosture.cachedKubectlVersion = undefined;
  }
}
