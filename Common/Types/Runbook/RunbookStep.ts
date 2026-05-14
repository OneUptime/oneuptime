import RunbookStepType from "./RunbookStepType";

// Manual steps have no config beyond the step-level title/description.
export type ManualStepConfig = Record<string, never>;

export interface JavaScriptStepConfig {
  script: string;
  timeoutInMs?: number;
  /*
   * Tag identifying which Runbook Agent should execute this step. Any healthy
   * agent in the same project carrying this tag may claim and run the job.
   * Required for the step to execute — JavaScript never runs on the OneUptime
   * Worker.
   */
  agentTag: string;
  /*
   * Maximum time the Worker will wait for an agent to claim the job before
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
   * Tag identifying which Runbook Agent should execute this step. Any healthy
   * agent in the same project carrying this tag may claim and run the job.
   * Required for the step to execute — bash never runs on the OneUptime Worker.
   */
  agentTag: string;
  /*
   * Maximum time the Worker will wait for an agent to claim the job before
   * failing it with TimedOut. Defaults to a few minutes if unset.
   */
  claimTimeoutInMs?: number;
}

export type RunbookStepConfig =
  | ManualStepConfig
  | JavaScriptStepConfig
  | HttpRequestStepConfig
  | BashStepConfig;

export interface RunbookStep {
  id: string;
  order: number;
  type: RunbookStepType;
  title: string;
  description?: string;
  /*
   * Only meaningful for automated steps (JavaScript, HttpRequest, Bash).
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
