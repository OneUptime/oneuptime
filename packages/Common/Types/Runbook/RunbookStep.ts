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
 * Run a command on a host the Runner can reach over SSH.
 *
 * The point of a first-class step type — rather than "write `ssh host cmd` in
 * a Bash step" — is that the credential is a managed, encrypted object with
 * its own permissions instead of a private key sitting on the Runner's disk,
 * and the command is a value we can validate rather than an opaque script.
 */
export interface SSHStepConfig {
  /*
   * ID of the RunbookCredential (type SSH) holding the host, user and key.
   * The Runner resolves it at claim time; it is never stored on the step.
   */
  credentialId: string;
  // The command to run on the remote host, verbatim.
  command: string;
  timeoutInMs?: number;
  // ID of the Runner that opens the connection. Only it may claim the job.
  agentId: string;
  claimTimeoutInMs?: number;
}

/*
 * The workload actions that cover almost every "turn it off and on again"
 * remediation. Deliberately a closed set of verbs rather than free-form
 * manifests: a runbook that can PATCH arbitrary Kubernetes objects is a
 * cluster-admin shell, and the whole reason this exists is to make the common
 * remediations safe rather than to add another way to run anything.
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

export interface KubernetesStepConfig {
  /*
   * ID of the RunbookCredential (type Kubernetes) holding the API server URL,
   * the service-account token and the CA certificate.
   */
  credentialId: string;
  action: KubernetesAction;
  workloadKind: KubernetesWorkloadKind;
  namespace: string;
  workloadName: string;
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
