import { JSONObject } from "../JSON";

export const GITHUB_SUPPORTED_EVENTS: ReadonlyArray<string> = [
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "push",
  "workflow_run",
  "check_run",
  "check_suite",
  "release",
  "deployment_status",
];

export interface GitHubEventEnvelope extends JSONObject {
  event: string;
  action: string;
  deliveryId: string;
  installationId: string;
  repository: string;
  repositoryId: string;
  codeRepositoryId: string;
  sender: string;
  isBot: boolean;
  issueNumber: number | null;
  isPullRequest: boolean;
  comment: string;
  commandArguments: string;
  title: string;
  body: string;
  url: string;
  branch: string;
  labels: Array<string>;
  payload: JSONObject;
}

export interface GitHubEventMatch {
  matches: boolean;
  commandArguments: string;
  requireWriteAccess: boolean;
}
