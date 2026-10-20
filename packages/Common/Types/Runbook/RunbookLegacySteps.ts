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
 *     `kubectl rollout restart` and `kubectl scale` would also need "get".
 *     The step keeps its credential and its action beside the script, for
 *     a Runner older than kubectl scripts (see "A moved Kubernetes step on
 *     an older Runner" below);
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
 *
 * Stored steps hold the text this returns: a moved Kubernetes step keeps
 * its credential and action for an older Runner only while its script is
 * this text, for them (getLegacyKubernetesStepForOlderRunner,
 * mayKeepLegacyKubernetesFields). So the text an action becomes never
 * changes; RunbookLegacySteps.test.ts holds it, word for word.
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
 * A MOVED KUBERNETES STEP ON AN OLDER RUNNER.
 *
 * A Runner is updated on its owner's schedule, and one older than kubectl
 * scripts cannot run one (RunnerFeatures). So the data migration that moved
 * each Kubernetes step to the kubectl script its action became kept the
 * fields the step was written with - its credential and its action, exactly
 * as they were - beside the script and the kubeconfig, as a moved SSH step's
 * script is also sent as the command an older Runner runs. The step's job
 * carries them (getLegacyKubernetesStepForOlderRunner), and a Runner older
 * than kubectl scripts that takes it is handed the step as it was written -
 * the action, and its credential resolved for that Runner - and runs it as
 * it always did (RunnerIngress). A newer Runner runs the script.
 *
 * Only while the step is what the migration wrote: its script the one its
 * action became, and its kubeconfig the one the migration made of its
 * credential. A change to either drops them - on every save
 * (RunbookService, mayKeepLegacyKubernetesFields) and on the Steps page as
 * the step is edited - so an older Runner never runs the old action for a
 * step that now says something else: it fails the step, saying to update
 * the Runner, as it fails every step written as a script.
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

/*
 * Where a kubectl step's job carries the step an older Runner is handed
 * (RunnerJob.payload). Beside the script and the kubeconfig, never in place
 * of them: a job's own credentialId is what a step written with a
 * credential carries, which takes no variables (RunbookJobVariableFields).
 */
export const LEGACY_KUBERNETES_STEP_JOB_KEY: string = "legacyStep";

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
 * beside it: the shape the data migration left a moved Kubernetes step in.
 * A step with legacy fields and no script is a step written with a
 * credential (isLegacyKubernetesStepConfig), which runs as written.
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
 * The step a Runner older than kubectl scripts is handed for a moved
 * Kubernetes step: what a Kubernetes step written with a credential was
 * always dispatched with - its credential and its action, as written - or
 * null when it cannot be handed over that way. It cannot when the step
 * keeps no credential, or not everything its action needed to be sent at
 * all (a namespace and a workload, and the replica count to scale to), or
 * when its script is not the one its action became: then an older Runner
 * would not do what the step says.
 */
export function getLegacyKubernetesStepForOlderRunner(
  config: unknown,
): JSONObject | null {
  const values: JSONObject = readObject(config);
  const legacy: JSONObject = getLegacyKubernetesFields(values);

  if (
    !isText(legacy["credentialId"]) ||
    !legacy["namespace"] ||
    !legacy["workloadName"] ||
    (legacy["action"] === KubernetesAction.ScaleWorkload &&
      legacy["replicas"] === undefined) ||
    !isText(values["script"]) ||
    values["script"] !==
      getKubectlScriptForLegacyKubernetesStep(
        legacy as unknown as KubernetesStepConfig,
      )
  ) {
    return null;
  }

  return legacy;
}

/*
 * The step an older Runner is handed, read back from a kubectl step's job
 * (LEGACY_KUBERNETES_STEP_JOB_KEY): its legacy fields only, and only when
 * they name a credential, a namespace and a workload. Null for a job that
 * carries none - a step written as a script - or carries something else.
 */
export function readLegacyKubernetesStepOfJob(
  payload: unknown,
): JSONObject | null {
  const legacy: JSONObject = getLegacyKubernetesFields(
    readObject(payload)[LEGACY_KUBERNETES_STEP_JOB_KEY],
  );

  if (
    !isText(legacy["credentialId"]) ||
    !legacy["namespace"] ||
    !legacy["workloadName"]
  ) {
    return null;
  }

  return legacy;
}

function readKubeconfig(config: JSONObject): string {
  return typeof config["kubeconfig"] === "string"
    ? config["kubeconfig"].trim()
    : "";
}

/*
 * Whether a moved Kubernetes step saved over the step the runbook holds
 * (`heldConfig`, as stored) may keep its legacy fields: only when it is
 * still that step - the same legacy fields, the same kubeconfig, the same
 * script, and that script the one its action became. A step the runbook
 * does not hold yet, or held as anything but a moved step, keeps none: the
 * migration wrote every step that may.
 */
export function mayKeepLegacyKubernetesFields(data: {
  config: unknown;
  heldConfig: unknown;
}): boolean {
  const config: JSONObject = readObject(data.config);
  const held: JSONObject = readObject(data.heldConfig);

  if (
    !isMovedKubernetesStepConfig(config) ||
    !isMovedKubernetesStepConfig(held)
  ) {
    return false;
  }

  const legacy: JSONObject = getLegacyKubernetesFields(config);
  const heldLegacy: JSONObject = getLegacyKubernetesFields(held);

  for (const field of LEGACY_KUBERNETES_STEP_FIELDS) {
    if (legacy[field] !== heldLegacy[field]) {
      return false;
    }
  }

  return (
    readKubeconfig(config) === readKubeconfig(held) &&
    config["script"] === held["script"] &&
    config["script"] ===
      getKubectlScriptForLegacyKubernetesStep(
        legacy as unknown as KubernetesStepConfig,
      )
  );
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
