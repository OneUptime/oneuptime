import RunbookStepType from "./RunbookStepType";

// Manual steps have no config beyond the step-level title/description.
export type ManualStepConfig = Record<string, never>;

export interface JavaScriptStepConfig {
  script: string;
  timeoutInMs?: number;
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
  continueOnFailure?: boolean;
  config: RunbookStepConfig;
}
