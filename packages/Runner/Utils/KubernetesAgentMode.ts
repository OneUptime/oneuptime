import { IS_KUBERNETES_AGENT_MODE } from "../Config";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";

/*
 * What the kubernetes-agent Runner is, and therefore what it refuses.
 *
 * The Runner the kubernetes-agent Helm chart installs exists for exactly one
 * job: running policy-tiered kubectl for OneUptime AI with the pod's own
 * ServiceAccount. Every safeguard this Runner has for cluster changes — the
 * tiers, the never-delete kinds, the read-only install switch, the
 * investigation read-only rule — lives in KubectlExecutor, and all of it is
 * skipped the moment the same kubectl (or the mounted ServiceAccount token)
 * is reached through `bash -c` or an SSH hop from inside the pod. So in this
 * mode the Runner only ever runs Kubectl steps: it asks the server for
 * nothing else at claim time and refuses anything else at execution time,
 * whatever origin the job carries and whatever the server said.
 *
 * Exposed as a function rather than a constant so tests can exercise the
 * mode without rebuilding the Config module from the environment.
 */
export default class KubernetesAgentMode {
  // The only step type the kubernetes-agent Runner ever executes.
  public static readonly allowedStepTypes: Array<RunbookStepType> = [
    RunbookStepType.Kubectl,
  ];

  public static isActive(): boolean {
    return IS_KUBERNETES_AGENT_MODE;
  }

  public static isStepTypeAllowed(stepType: string | undefined): boolean {
    return KubernetesAgentMode.allowedStepTypes.includes(
      (stepType || "") as RunbookStepType,
    );
  }

  /*
   * Why this Runner will not run a job of this step type — or null when it
   * will. Null outside kubernetes-agent mode: an ordinary Runner runs every
   * step type it has an executor for, gated by its own capabilities.
   */
  public static getStepTypeRefusal(
    stepType: string | undefined,
  ): string | null {
    if (!KubernetesAgentMode.isActive()) {
      return null;
    }

    if (KubernetesAgentMode.isStepTypeAllowed(stepType)) {
      return null;
    }

    return `This Runner is the Kubernetes agent's in-cluster Runner: it only runs policy-tiered kubectl for OneUptime AI and never ${
      stepType || "unknown"
    } steps. Bash and SSH commands need a Runner installed on a host (Project Settings > Runners).`;
  }
}
