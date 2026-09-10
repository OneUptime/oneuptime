/*
 * The GitHub webhook events the interactive app subscribes to, and the small
 * amount of shape-reading needed to get from a raw payload to "who said what,
 * where".
 *
 * Split out from the handler because these are the only places a raw,
 * attacker-influenced JSON blob is turned into typed values, and they should
 * be readable — and testable — without the surrounding orchestration.
 */

import { JSONArray, JSONObject } from "../../../../Types/JSON";

// The label that hands an issue to the app when no other is configured.
export const DEFAULT_GITHUB_TRIGGER_LABEL: string = "oneuptime";

export enum GitHubWebhookEvent {
  IssueComment = "issue_comment",
  Issues = "issues",
  PullRequest = "pull_request",
  PullRequestReview = "pull_request_review",
  PullRequestReviewComment = "pull_request_review_comment",
  Installation = "installation",
  InstallationRepositories = "installation_repositories",
}

export interface GitHubWebhookRepository {
  organizationName: string;
  repositoryName: string;
}

export interface GitHubWebhookSender {
  login: string;
  // "User" or "Bot". GitHub App comments are always "Bot".
  type: string | undefined;
}

export default class GitHubWebhookEvents {
  /*
   * `full_name` is "owner/repo". Splitting on the FIRST slash is deliberate:
   * an owner name cannot contain one, a repository name cannot either, and
   * anything that does not split cleanly into two non-empty parts is not a
   * shape we should act on.
   */
  public static getRepository(
    payload: JSONObject,
  ): GitHubWebhookRepository | null {
    const fullName: string | undefined = (
      payload["repository"] as JSONObject
    )?.["full_name"]?.toString();

    if (!fullName) {
      return null;
    }

    const separatorIndex: number = fullName.indexOf("/");

    if (separatorIndex <= 0 || separatorIndex === fullName.length - 1) {
      return null;
    }

    return {
      organizationName: fullName.substring(0, separatorIndex),
      repositoryName: fullName.substring(separatorIndex + 1),
    };
  }

  public static getInstallationId(payload: JSONObject): string | null {
    const installationId: string | undefined = (
      payload["installation"] as JSONObject
    )?.["id"]?.toString();

    return installationId || null;
  }

  public static getSender(payload: JSONObject): GitHubWebhookSender | null {
    const sender: JSONObject | undefined = payload["sender"] as JSONObject;
    const login: string | undefined = sender?.["login"]?.toString();

    if (!login) {
      return null;
    }

    return {
      login: login,
      type: sender?.["type"]?.toString(),
    };
  }

  public static getAction(payload: JSONObject): string | null {
    return payload["action"]?.toString() || null;
  }

  /*
   * On `issue_comment`, GitHub sends the SAME event for issues and for pull
   * requests — a pull request is an issue with a `pull_request` key. This is
   * the only reliable way to tell them apart, and getting it wrong means
   * trying to revise an issue or implement a pull request.
   */
  public static isPullRequestIssue(issue: JSONObject | undefined): boolean {
    return Boolean(issue?.["pull_request"]);
  }

  public static getNumber(container: JSONObject | undefined): number | null {
    const value: unknown = container?.["number"];

    return typeof value === "number" ? value : null;
  }

  public static getLabelNames(issue: JSONObject | undefined): Array<string> {
    const labels: JSONArray = (issue?.["labels"] as JSONArray) || [];

    return labels
      .map((label: JSONObject) => {
        return ((label as JSONObject)?.["name"] as string) || "";
      })
      .filter((name: string) => {
        return Boolean(name);
      });
  }

  /*
   * Case-insensitive because GitHub labels are case-preserving but
   * case-insensitively unique, so "OneUptime" and "oneuptime" are the same
   * label and a configuration that matched exactly would miss half of them.
   */
  public static hasLabel(data: {
    labelNames: Array<string>;
    labelName: string;
  }): boolean {
    const wanted: string = data.labelName.trim().toLowerCase();

    if (!wanted) {
      return false;
    }

    return data.labelNames.some((name: string) => {
      return name.trim().toLowerCase() === wanted;
    });
  }
}
