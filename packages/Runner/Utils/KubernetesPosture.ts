import fs from "fs";
import os from "os";
import { spawn } from "child_process";
import {
  KUBECTL_ALLOW_WRITES,
  KUBECTL_ALLOW_WRITES_RAW,
  KUBECTL_WRITE_NAMESPACES,
  KUBERNETES_AGENT_CHART_VERSION,
  KUBERNETES_AGENT_CLUSTER_NAME,
  RUNNER_POD_NAMESPACE,
} from "../Config";
import KubernetesAgentMode from "./KubernetesAgentMode";
import { KubernetesRunnerPosture } from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import logger from "Common/Server/Utils/Logger";

/*
 * What this Runner can say about its own Kubernetes reach: whether it may
 * run kubectl with its pod's own ServiceAccount, whether its host lets
 * AI-composed writes through and into which namespaces, and which kubectl
 * it carries. Reported at
 * registration and on every heartbeat of the kubernetes-agent Runner, so the
 * dashboard's "what is missing" checklist reflects the container that is
 * actually running.
 *
 * Only the kubernetes-agent Runner has a posture at all. Merely running in a
 * pod says nothing about WHICH cluster that pod is in: an ordinary project
 * Runner deployed in staging could be selected on production's AI page, and
 * if being in a pod were enough for "in-cluster access" every command for
 * production would run, credential-less, against staging's ServiceAccount.
 * The agent Runner is different because it registered with the cluster's
 * name and the server bound it to that cluster.
 */

export const SERVICE_ACCOUNT_TOKEN_PATH: string =
  "/var/run/secrets/kubernetes.io/serviceaccount/token";

const KUBECTL_VERSION_TIMEOUT_MS: number = 10_000;

export default class KubernetesPosture {
  private static cachedKubectlVersion: string | null | undefined = undefined;

  /*
   * kubectl's own in-cluster detection is the same two facts: the API
   * server's service host in the environment and a mounted token. This is
   * the raw fact about the process — it is NOT permission to use that
   * ServiceAccount for OneUptime AI; see canUseOwnServiceAccount.
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
   * Whether a kubectl job that arrives WITHOUT a credential may run with
   * this pod's ServiceAccount. True only for the kubernetes-agent Runner
   * (which knows which cluster it is in and was registered as that
   * cluster's Runner) and only while it actually runs inside a cluster. A
   * project Runner that happens to live in a pod answers false, so a
   * credential-less job reaching it is refused rather than run against
   * whatever cluster its pod is in.
   */
  public static canUseOwnServiceAccount(): boolean {
    return KubernetesAgentMode.isActive() && KubernetesPosture.isInCluster();
  }

  /*
   * Whether an AI-composed write may run from this host (see Config): a set
   * ONEUPTIME_KUBECTL_ALLOW_WRITES allows writes only when it is "true"; an
   * unset one refuses them on the kubernetes-agent Runner (the chart always
   * sets it) and allows them on any other Runner, whose credential's RBAC
   * bounds them.
   */
  public static allowsWrites(): boolean {
    return KUBECTL_ALLOW_WRITES;
  }

  // The switch exactly as set (null when unset), for refusal messages.
  public static getAllowWritesSetting(): string | null {
    return KUBECTL_ALLOW_WRITES_RAW;
  }

  /*
   * The namespaces AI-composed writes may land in, lowercased; empty means
   * cluster-wide. Methods rather than the constants so tests can scope a
   * Runner without rebuilding Config from the environment.
   */
  public static getWriteNamespaces(): Array<string> {
    return [...KUBECTL_WRITE_NAMESPACES];
  }

  /*
   * The namespace this Runner's pod runs in, or null when the Runner was not
   * told (an external Runner, or an agent chart that predates the setting).
   */
  public static getPodNamespace(): string | null {
    return RUNNER_POD_NAMESPACE;
  }

  /*
   * Only meaningful for the kubernetes-agent Runner, which is the only
   * caller that should report it. Outside that mode it never claims
   * in-cluster access or a cluster identity, whatever environment the
   * process runs in, so a misrouted call cannot make an ordinary Runner
   * look like a cluster's agent.
   */
  public static async build(): Promise<KubernetesRunnerPosture> {
    const isAgent: boolean = KubernetesAgentMode.isActive();

    return {
      clusterIdentifier:
        isAgent && KUBERNETES_AGENT_CLUSTER_NAME
          ? KUBERNETES_AGENT_CLUSTER_NAME
          : undefined,
      inCluster: KubernetesPosture.canUseOwnServiceAccount(),
      allowWrites: KubernetesPosture.allowsWrites(),
      kubectlVersion:
        (await KubernetesPosture.detectKubectlVersion()) || undefined,
      agentChartVersion: KUBERNETES_AGENT_CHART_VERSION || undefined,
      writeNamespaces: KubernetesPosture.getWriteNamespaces(),
      podNamespace: KubernetesPosture.getPodNamespace() || undefined,
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
            /*
             * A closed environment like the one KubectlExecutor gives every
             * AI command, with kuberc preferences switched off, so nothing
             * on this host can rewrite what the probe asks for.
             */
            env: {
              PATH: process.env["PATH"] || "/usr/local/bin:/usr/bin:/bin",
              HOME: os.tmpdir(),
              KUBERC: "off",
              KUBECTL_KUBERC: "false",
            },
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
