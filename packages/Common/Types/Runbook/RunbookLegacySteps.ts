import { JSONObject } from "../JSON";
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
 *
 * Runbook credentials are gone now. A step that still names one - written
 * through the API, and not moved - can no longer run; the Steps page turns
 * it into the script step that does what it did (isLegacyCredentialStep in
 * the Dashboard), and the author picks the secret variable it signs in
 * with.
 */

/*
 * What an SSH or Kubernetes step that still names a runbook credential (one
 * written through the API and never moved to variables) is answered with
 * when it would run: runbook credentials were removed. Its Steps page turns
 * it into the script step that does the same.
 */
export const REMOVED_RUNBOOK_CREDENTIAL_STEP_MESSAGE: string =
  "This step names a runbook credential, and runbook credentials were removed, so it was not run. Open the runbook's Steps page, choose Turn into a script step on this step, and pick the secret runbook variable it signs in with.";

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
 *
 * Stored steps hold the text this returns, so the text an action becomes
 * never changes; RunbookLegacySteps.test.ts holds it, word for word.
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
 * THE FIELDS A MOVED KUBERNETES STEP KEPT.
 *
 * The data migration that moved each Kubernetes step to the kubectl script
 * its action became first kept the fields the step was written with - its
 * runbook credential and its action - beside the script and the kubeconfig,
 * so a Runner older than kubectl scripts could still be handed the step as
 * it was written. Runbook credentials are gone, and that with them: the
 * data migration that removed them took those fields off every moved step
 * (withoutLegacyKubernetesFields), and a Runner older than kubectl scripts
 * fails a kubectl step, saying to update the Runner.
 */

// The fields a Kubernetes step was written with before kubectl scripts.
export const LEGACY_KUBERNETES_STEP_FIELDS: ReadonlyArray<string> = [
  "credentialId",
  "action",
  "workloadKind",
  "namespace",
  "workloadName",
  "replicas",
];

function readObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// The legacy fields a step's config holds, as it holds them (an empty one, null, is none).
export function getLegacyKubernetesFields(config: unknown): JSONObject {
  const values: JSONObject = readObject(config);
  const fields: JSONObject = {};

  for (const field of LEGACY_KUBERNETES_STEP_FIELDS) {
    if (values[field] !== undefined && values[field] !== null) {
      fields[field] = values[field];
    }
  }

  return fields;
}

export function hasLegacyKubernetesFields(config: unknown): boolean {
  return Object.keys(getLegacyKubernetesFields(config)).length > 0;
}

/*
 * Whether a step's config is a kubectl script that kept legacy fields
 * beside it: the shape the data migration first left a moved Kubernetes
 * step in. A step with legacy fields and no script is a step written with a
 * credential (isLegacyKubernetesStepConfig).
 */
export function isMovedKubernetesStepConfig(config: unknown): boolean {
  return (
    isText(readObject(config)["script"]) && hasLegacyKubernetesFields(config)
  );
}

// A step's config without its legacy fields.
export function withoutLegacyKubernetesFields<
  T extends Record<string, unknown>,
>(config: T): T {
  const next: Record<string, unknown> = { ...config };

  for (const field of LEGACY_KUBERNETES_STEP_FIELDS) {
    delete next[field];
  }

  return next as T;
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
