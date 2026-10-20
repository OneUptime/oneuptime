/*
 * What "Test connection" answers. A test reads a little of what a real read
 * would (the last few days of usage, or the newest chats) and says, in one
 * sentence, whether the connection works and what it would bring in - or,
 * when it does not work, what to do about it.
 *
 * Never carries a credential, nor anything a person wrote: a test of a
 * company AI tool counts chats, it does not show them.
 */

export type LlmConnectionTestStatus = "pass" | "warn" | "fail";

/*
 * Why a test or a read failed, so the dashboard can say what to fix without
 * reading the provider's error text.
 */
export enum LlmConnectionFailureKind {
  // The key, secret or token was refused.
  Authentication = "authentication",
  // The credential is valid but may not read this (role, scope, permission).
  Permission = "permission",
  // The provider asked us to slow down.
  RateLimited = "rate-limited",
  // The provider could not be reached, or answered with a server error.
  Unavailable = "unavailable",
  // The settings are wrong (an unknown subscription, project or group).
  Settings = "settings",
  // Anything else.
  Other = "other",
}

export interface LlmConnectionTestCounts {
  days?: number | undefined;
  models?: number | undefined;
  people?: number | undefined;
  apiKeys?: number | undefined;
  projects?: number | undefined;
  resources?: number | undefined;
  conversations?: number | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  requests?: number | undefined;
  costUsd?: number | undefined;
}

export interface LlmConnectionTestResult {
  provider: string;
  status: LlmConnectionTestStatus;
  // One or two sentences for the person reading it. Never a credential.
  message: string;
  // What to do when it did not pass.
  remediation?: string | undefined;
  failureKind?: LlmConnectionFailureKind | undefined;
  // What the test found over the days it read.
  counts?: LlmConnectionTestCounts | undefined;
  durationMs: number;
}
