import RunbookStepType from "./RunbookStepType";

// Manual steps have no config beyond the step-level title/description.
export type ManualStepConfig = Record<string, never>;

export interface JavaScriptStepConfig {
  script: string;
  timeoutInMs?: number;
  /*
   * ID of the Runbook Agent that should execute this step. Required for the
   * step to execute — JavaScript never runs on the OneUptime Worker. Only the
   * selected agent may claim the job.
   */
  agentId: string;
  /*
   * Maximum time the Worker will wait for the agent to claim the job before
   * failing it with TimedOut. Defaults to a few minutes if unset.
   */
  claimTimeoutInMs?: number;
}

export type HttpRequestMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD";

export interface HttpRequestStepConfig {
  url: string;
  method: HttpRequestMethod;
  headersJson?: string;
  body?: string;
  timeoutInMs?: number;
}

export interface BashStepConfig {
  script: string;
  timeoutInMs?: number;
  /*
   * ID of the Runbook Agent that should execute this step. Required for the
   * step to execute — bash never runs on the OneUptime Worker. Only the
   * selected agent may claim the job.
   */
  agentId: string;
  /*
   * Maximum time the Worker will wait for the agent to claim the job before
   * failing it with TimedOut. Defaults to a few minutes if unset.
   */
  claimTimeoutInMs?: number;
}

export interface AIStepConfig {
  /*
   * Instructions for the AI — what to analyze, summarize or decide. The
   * model's response becomes the step output on the execution timeline.
   */
  prompt: string;
  /*
   * When true, the prompt includes everything about the steps that ran
   * before this one: title, type, status, output and error message.
   */
  includePreviousStepContext?: boolean;
  /*
   * When true, the prompt includes context about what started this
   * execution: the linked incident, alert or scheduled maintenance event,
   * or the user who ran the runbook manually.
   */
  includeTriggerContext?: boolean;
  /*
   * Response token cap. Defaults to 4096; clamped server-side.
   */
  maxTokens?: number;
  /*
   * Pin this step to a specific LLM provider. Optional — when unset the step
   * uses the project's default provider (and, failing that, the global
   * OneUptime provider), which is what every AI step did before this field
   * existed.
   *
   * The id must name a provider the project owns or a global one; the server
   * re-checks that on every run rather than trusting the stored config, since
   * Runbook.steps is an unvalidated JSON column. A pinned provider that no
   * longer resolves FAILS the step instead of quietly falling back to the
   * default: an AI step runs unattended, and silently answering on a
   * different model than the one a responder pinned is a change nobody would
   * see. (Interactive chat, which has a human watching, does fall back.)
   */
  llmProviderId?: string;
}

/*
 * Sign in to a machine over SSH and run a bash script there.
 *
 * The step says where (host, user, port) and the script; the key or the
 * password it signs in with is a secret runbook variable, named by
 * reference ({{global.variables.NAME}} or {{local.variables.NAME}}) - never
 * typed into the step, which everyone who may read the runbook reads. The
 * server fills the references in when the step's Runner takes it, and only
 * for a Runner the variable may be used on (RunbookVariable).
 *
 * The host, the user and the script may name variables too, plain or
 * secret: "{{global.variables.DB_HOST}}".
 *
 * A step written before runbook variables names a credential instead
 * (credentialId) and its command (command). Such a step still runs as it
 * did; the data migration that brought variables in rewrote every stored
 * one (Common/Server/Utils/Runbook/RunbookVariablesMove), so only a step
 * written through the API since has that shape (isLegacySSHStepConfig).
 */
export interface SSHStepConfig {
  // The machine to sign in to: a host name or an address.
  host?: string;
  // The user to sign in as.
  username?: string;
  // 22 when left out.
  port?: number;
  /*
   * The secret variable the step signs in with, as one reference. It holds
   * a private key (PEM, OpenSSH or PuTTY) or a password; which, is read
   * from the value (isSshPrivateKey).
   */
  signIn?: string;
  // The secret variable holding the key's passphrase, for a key that has one.
  passphrase?: string;
  // The bash script to run on the machine.
  script?: string;
  /*
   * LEGACY. The RunbookCredential (type SSH) holding the host, user and key,
   * resolved for the Runner when it takes the step. Never set by the
   * dashboard since runbook variables.
   */
  credentialId?: string;
  // LEGACY. The command a credential step runs on the host, verbatim.
  command?: string;
  timeoutInMs?: number;
  // ID of the Runner that opens the connection. Only it may claim the job.
  agentId: string;
  claimTimeoutInMs?: number;
}

/*
 * LEGACY. The two workload actions a Kubernetes step offered before it took
 * a kubectl script. A step written through the API with one still runs it
 * (the Runner's KubernetesExecutor); the dashboard writes scripts only.
 */
export enum KubernetesAction {
  // Rolling restart: stamps the pod template so the controller recreates pods.
  RestartWorkload = "RestartWorkload",
  // Set replica count — scale out under load, or to zero and back.
  ScaleWorkload = "ScaleWorkload",
}

export enum KubernetesWorkloadKind {
  Deployment = "Deployment",
  StatefulSet = "StatefulSet",
  DaemonSet = "DaemonSet",
}

/*
 * A kubectl step: a bash script of kubectl commands, run on a Runner with
 * KUBECONFIG pointing at the cluster's kubeconfig.
 *
 * The step type keeps its stored name, Kubernetes; the dashboard calls it
 * kubectl. (RunbookStepType.Kubectl is another thing: one kubectl command
 * OneUptime AI composed, run as an argv under the AI command policy.)
 *
 * The kubeconfig is a secret runbook variable, named by one reference. Left
 * empty, kubectl uses the Runner's own access - its kubeconfig, or its
 * service account when the Runner runs inside the cluster.
 *
 * A step written before runbook variables restarted or scaled one workload
 * with a credential (credentialId, action, workloadKind, namespace,
 * workloadName, replicas). Such a step still runs as it did; the data
 * migration that brought variables in rewrote every stored one into the
 * kubectl script that does the same (RunbookLegacySteps), so only a step
 * written through the API since has that shape
 * (isLegacyKubernetesStepConfig).
 */
export interface KubernetesStepConfig {
  // The secret variable holding the cluster's kubeconfig, as one reference.
  kubeconfig?: string;
  // The bash script of kubectl commands to run.
  script?: string;
  /*
   * LEGACY. The RunbookCredential (type Kubernetes) holding the API server
   * URL, the service-account token and the CA certificate.
   */
  credentialId?: string;
  // LEGACY, with the fields below: the one workload action the step took.
  action?: KubernetesAction;
  workloadKind?: KubernetesWorkloadKind;
  namespace?: string;
  workloadName?: string;
  /*
   * Target replica count. Required for ScaleWorkload and ignored otherwise.
   * Zero is legitimate — draining a workload is a remediation.
   */
  replicas?: number;
  timeoutInMs?: number;
  // ID of the Runner that talks to the API server. Only it may claim the job.
  agentId: string;
  claimTimeoutInMs?: number;
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/*
 * Whether an SSH step was written the way steps were before runbook
 * variables: it names a credential and has no script.
 */
export function isLegacySSHStepConfig(config: unknown): boolean {
  const values: Record<string, unknown> =
    config && typeof config === "object"
      ? (config as Record<string, unknown>)
      : {};

  return hasText(values["credentialId"]) && !hasText(values["script"]);
}

/*
 * Whether a Kubernetes step was written the way steps were before kubectl
 * scripts: it names a credential and has no script.
 */
export function isLegacyKubernetesStepConfig(config: unknown): boolean {
  const values: Record<string, unknown> =
    config && typeof config === "object"
      ? (config as Record<string, unknown>)
      : {};

  return hasText(values["credentialId"]) && !hasText(values["script"]);
}

export type RunbookStepConfig =
  | ManualStepConfig
  | JavaScriptStepConfig
  | HttpRequestStepConfig
  | BashStepConfig
  | AIStepConfig
  | SSHStepConfig
  | KubernetesStepConfig;

export interface RunbookStep {
  id: string;
  order: number;
  type: RunbookStepType;
  title: string;
  description?: string;
  /*
   * Only meaningful for automated steps (JavaScript, HttpRequest, Bash, AI).
   * Manual steps have no failure semantics.
   */
  continueOnFailure?: boolean;
  /*
   * Only meaningful for automated steps. When true, the runbook pauses
   * after this step completes and waits for a user to approve before
   * running the next step.
   */
  requireApproval?: boolean;
  config: RunbookStepConfig;
}
