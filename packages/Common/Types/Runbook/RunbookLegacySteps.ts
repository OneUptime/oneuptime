import {
  KubernetesAction,
  KubernetesStepConfig,
  KubernetesWorkloadKind,
} from "./RunbookStep";
import { shellQuote } from "./ShellWord";

/*
 * WHAT A STEP WRITTEN BEFORE RUNBOOK VARIABLES BECOMES.
 *
 * SSH and Kubernetes steps named a runbook credential, and a Kubernetes step
 * picked one of two actions from dropdowns. They take a script now, and the
 * secret they sign in with is a runbook variable. The data migration that
 * brought variables in (Common/Server/Utils/Runbook/RunbookVariablesMove)
 * turns each stored step into the new shape with what is here, so it does
 * exactly what it did:
 *
 *   - an SSH step's command becomes its script;
 *   - a Kubernetes step's action becomes the kubectl command that makes the
 *     same change: the same PATCH the Runner's KubernetesExecutor sent, so a
 *     service account allowed only "patch" (as the docs advised) still may.
 *     `kubectl rollout restart` and `kubectl scale` would also need "get";
 *   - a credential's API server URL, token and CA become a kubeconfig
 *     (Common/Server/Utils/Runbook/ServiceAccountKubeconfig).
 */

const KIND_RESOURCES: Record<string, string> = {
  [KubernetesWorkloadKind.Deployment]: "deployment",
  [KubernetesWorkloadKind.StatefulSet]: "statefulset",
  [KubernetesWorkloadKind.DaemonSet]: "daemonset",
};

// A script that fails the step with `message`, as the old step would have.
function failingScript(message: string): string {
  return [`# ${message}`, `echo ${shellQuote(message)} >&2`, "exit 1", ""].join(
    "\n",
  );
}

/*
 * The kubectl script that does what a legacy Kubernetes step's action did,
 * or one that fails with the reason the old step failed for.
 */
export function getKubectlScriptForLegacyKubernetesStep(
  config: Pick<
    KubernetesStepConfig,
    "action" | "workloadKind" | "namespace" | "workloadName" | "replicas"
  >,
): string {
  const kind: string = String(
    config.workloadKind || KubernetesWorkloadKind.Deployment,
  );
  const resource: string | undefined = KIND_RESOURCES[kind];
  const namespace: string = String(config.namespace || "").trim();
  const name: string = String(config.workloadName || "").trim();

  if (!resource) {
    return failingScript(`Unsupported workload kind: ${kind}`);
  }

  if (!namespace || !name) {
    return failingScript(
      "This step needs a namespace and a workload name. Write the kubectl commands it should run.",
    );
  }

  const target: string = `${resource} ${shellQuote(name)} --namespace ${shellQuote(namespace)}`;

  if (config.action === KubernetesAction.ScaleWorkload) {
    if (kind === KubernetesWorkloadKind.DaemonSet) {
      return failingScript(
        "A DaemonSet cannot be scaled - it runs one pod per node. Restart it instead.",
      );
    }

    const replicas: unknown = config.replicas;

    if (
      typeof replicas !== "number" ||
      !Number.isInteger(replicas) ||
      replicas < 0
    ) {
      return failingScript("Scale step needs a replica count.");
    }

    return [
      `# Scale ${resource}/${name} in namespace ${namespace} to ${replicas} replica(s).`,
      `kubectl patch ${target} --subresource scale --patch '{"spec":{"replicas":${replicas}}}'`,
      "",
    ].join("\n");
  }

  if (
    config.action !== undefined &&
    config.action !== KubernetesAction.RestartWorkload
  ) {
    return failingScript(
      `Unsupported Kubernetes action: ${String(config.action)}`,
    );
  }

  return [
    `# Restart ${resource}/${name} in namespace ${namespace}: a new pod template annotation makes the controller replace its pods, as kubectl rollout restart does.`,
    `patch=$(printf '{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"%s"}}}}}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)")`,
    `kubectl patch ${target} --patch "$patch"`,
    "",
  ].join("\n");
}

/*
 * Whether a secret an SSH step signs in with is a private key - PEM (RSA,
 * EC, PKCS#8, encrypted or not), OpenSSH or PuTTY - rather than a password.
 * A password cannot start like a key does, so the value says which it is
 * and the step needs no "key or password" choice.
 */
export function isSshPrivateKey(value: string | null | undefined): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const text: string = value.trim();

  if (text.startsWith("PuTTY-User-Key-File-")) {
    return true;
  }

  if (!text.startsWith("-----BEGIN ")) {
    return false;
  }

  const firstLineEnd: number = text.indexOf("\n");
  const firstLine: string =
    firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);

  return firstLine.trim().endsWith("PRIVATE KEY-----");
}
