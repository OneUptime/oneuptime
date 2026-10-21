import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import API from "../../../../Utils/API";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * What a deploy shipped, from GitHub: the commits between two commits, one
 * commit, the pull requests a commit came from, and the diff of a pull
 * request's files. Read with an installation token the caller mints
 * (contents and pull requests, read), so one token serves every call for one
 * change.
 *
 * The parsers are pure and exported, so the shapes GitHub answers with are
 * pinned by tests without a network.
 */

// The most commits and files a reply keeps.
export const MAX_COMMITS: number = 30;
export const MAX_FILES: number = 50;

export interface GitHubCommitSummary {
  sha: string;
  // The first line of the commit message.
  message: string;
  authorName: string;
  authorLogin?: string | undefined;
  date?: string | undefined;
  // The pull requests the message names: "(#482)", "Merge pull request #482".
  pullRequestNumbers: Array<number>;
}

export interface GitHubChangedFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface GitHubCommitRange {
  // "ahead", "behind", "diverged" or "identical", as GitHub says.
  status: string;
  totalCommits: number;
  // Newest first, at most MAX_COMMITS.
  commits: Array<GitHubCommitSummary>;
  files: Array<GitHubChangedFile>;
  isTruncated: boolean;
}

export interface GitHubPullRequestSummary {
  number: number;
  title: string;
  authorLogin?: string | undefined;
  mergedAt?: string | undefined;
  url: string;
}

export interface GitHubRepositoryName {
  owner: string;
  name: string;
}

// One file a pull request changed, and its unified diff when GitHub has one.
export interface GitHubPullRequestFilePatch {
  path: string;
  // Absent for a binary file, or one too large for GitHub to show.
  patch?: string | undefined;
}

// Files GitHub lists per page of a pull request's files, at most.
export const PULL_REQUEST_FILES_PER_PAGE: number = 100;

// The most pages of a pull request's files read: 300 files.
export const MAX_PULL_REQUEST_FILE_PAGES: number = 3;

// A full or abbreviated commit SHA.
const COMMIT_SHA: RegExp = /^[0-9a-f]{7,64}$/i;

// "(#482)" at the end of a squash merge, "Merge pull request #482 from".
const PULL_REQUEST_REFERENCE: RegExp =
  /(?:\(#(\d{1,9})\)|Merge pull request #(\d{1,9}))/g;

// "https://github.com/acme/api(.git)", "git@github.com:acme/api.git", "acme/api".
const GITHUB_URL: RegExp =
  /^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)?([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?\/?$/;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export default class GitHubCommits {
  public static isCommitSha(value: string | undefined): boolean {
    return Boolean(value && COMMIT_SHA.test(value.trim()));
  }

  // The owner and name of a GitHub repository, from its URL or "owner/name".
  public static parseRepositoryName(
    value: string | undefined,
  ): GitHubRepositoryName | null {
    if (!value) {
      return null;
    }

    const match: RegExpExecArray | null = GITHUB_URL.exec(value.trim());

    if (!match || !match[1] || !match[2]) {
      return null;
    }

    return { owner: match[1], name: match[2] };
  }

  public static pullRequestNumbersFromMessage(message: string): Array<number> {
    const numbers: Array<number> = [];

    for (const match of message.matchAll(PULL_REQUEST_REFERENCE)) {
      const number: number = Number(match[1] || match[2]);

      if (Number.isFinite(number) && !numbers.includes(number)) {
        numbers.push(number);
      }
    }

    return numbers;
  }

  // One commit as GitHub's commits and compare APIs list it.
  public static parseCommit(json: JSONObject): GitHubCommitSummary {
    const commit: JSONObject = (json["commit"] as JSONObject) || {};
    const author: JSONObject = (commit["author"] as JSONObject) || {};
    const fullMessage: string = asString(commit["message"]);
    const login: string = asString((json["author"] as JSONObject)?.["login"]);
    const date: string = asString(author["date"]);

    return {
      sha: asString(json["sha"]),
      message: fullMessage.split("\n")[0]!.trim(),
      authorName: asString(author["name"]) || login || "unknown",
      ...(login ? { authorLogin: login } : {}),
      ...(date ? { date } : {}),
      pullRequestNumbers:
        GitHubCommits.pullRequestNumbersFromMessage(fullMessage),
    };
  }

  public static parseFiles(files: unknown): Array<GitHubChangedFile> {
    if (!Array.isArray(files)) {
      return [];
    }

    return (files as JSONArray)
      .filter((file: unknown): file is JSONObject => {
        return typeof file === "object" && file !== null;
      })
      .map((file: JSONObject): GitHubChangedFile => {
        return {
          path: asString(file["filename"]),
          status: asString(file["status"]),
          additions: asNumber(file["additions"]),
          deletions: asNumber(file["deletions"]),
        };
      })
      .filter((file: GitHubChangedFile): boolean => {
        return Boolean(file.path);
      });
  }

  // GitHub's compare reply, newest commit first and capped.
  public static parseCompare(json: JSONObject): GitHubCommitRange {
    const commits: Array<GitHubCommitSummary> = (
      Array.isArray(json["commits"]) ? (json["commits"] as JSONArray) : []
    )
      .filter((commit: unknown): commit is JSONObject => {
        return typeof commit === "object" && commit !== null;
      })
      .map(GitHubCommits.parseCommit)
      .reverse();
    const files: Array<GitHubChangedFile> = GitHubCommits.parseFiles(
      json["files"],
    );
    const totalCommits: number =
      asNumber(json["total_commits"]) || commits.length;

    return {
      status: asString(json["status"]),
      totalCommits,
      commits: commits.slice(0, MAX_COMMITS),
      files: files.slice(0, MAX_FILES),
      isTruncated:
        commits.length > MAX_COMMITS ||
        totalCommits > commits.length ||
        files.length > MAX_FILES,
    };
  }

  // A page of GitHub's pull request files, with each file's diff.
  public static parsePullRequestFilePatches(
    json: unknown,
  ): Array<GitHubPullRequestFilePatch> {
    if (!Array.isArray(json)) {
      return [];
    }

    return (json as JSONArray)
      .filter((file: unknown): file is JSONObject => {
        return typeof file === "object" && file !== null;
      })
      .map((file: JSONObject): GitHubPullRequestFilePatch => {
        const patch: string = asString(file["patch"]);

        return {
          path: asString(file["filename"]),
          ...(patch ? { patch } : {}),
        };
      })
      .filter((file: GitHubPullRequestFilePatch): boolean => {
        return Boolean(file.path);
      });
  }

  public static parsePullRequests(
    json: unknown,
  ): Array<GitHubPullRequestSummary> {
    if (!Array.isArray(json)) {
      return [];
    }

    return (json as JSONArray)
      .filter((pullRequest: unknown): pullRequest is JSONObject => {
        return typeof pullRequest === "object" && pullRequest !== null;
      })
      .map((pullRequest: JSONObject): GitHubPullRequestSummary => {
        const login: string = asString(
          (pullRequest["user"] as JSONObject)?.["login"],
        );
        const mergedAt: string = asString(pullRequest["merged_at"]);

        return {
          number: asNumber(pullRequest["number"]),
          title: asString(pullRequest["title"]),
          ...(login ? { authorLogin: login } : {}),
          ...(mergedAt ? { mergedAt } : {}),
          url: asString(pullRequest["html_url"]),
        };
      })
      .filter((pullRequest: GitHubPullRequestSummary): boolean => {
        return pullRequest.number > 0;
      });
  }

  // The commits from `base` to `head`, and the files they touched.
  @CaptureSpan()
  public static async compare(data: {
    token: string;
    owner: string;
    repository: string;
    base: string;
    head: string;
  }): Promise<GitHubCommitRange> {
    const json: JSONObject = await GitHubCommits.get(
      data.token,
      `repos/${encodeURIComponent(data.owner)}/${encodeURIComponent(data.repository)}/compare/${encodeURIComponent(data.base)}...${encodeURIComponent(data.head)}`,
    );

    return GitHubCommits.parseCompare(json);
  }

  // One commit, and the files it touched.
  @CaptureSpan()
  public static async getCommit(data: {
    token: string;
    owner: string;
    repository: string;
    sha: string;
  }): Promise<{
    commit: GitHubCommitSummary;
    files: Array<GitHubChangedFile>;
  }> {
    const json: JSONObject = await GitHubCommits.get(
      data.token,
      `repos/${encodeURIComponent(data.owner)}/${encodeURIComponent(data.repository)}/commits/${encodeURIComponent(data.sha)}`,
    );

    return {
      commit: GitHubCommits.parseCommit(json),
      files: GitHubCommits.parseFiles(json["files"]).slice(0, MAX_FILES),
    };
  }

  // The pull requests a commit belongs to.
  @CaptureSpan()
  public static async listPullRequestsForCommit(data: {
    token: string;
    owner: string;
    repository: string;
    sha: string;
  }): Promise<Array<GitHubPullRequestSummary>> {
    const json: unknown = await GitHubCommits.get(
      data.token,
      `repos/${encodeURIComponent(data.owner)}/${encodeURIComponent(data.repository)}/commits/${encodeURIComponent(data.sha)}/pulls`,
    );

    return GitHubCommits.parsePullRequests(json);
  }

  /*
   * The files a pull request changed, each with its diff, up to
   * MAX_PULL_REQUEST_FILE_PAGES pages. Needs pull requests: read.
   */
  @CaptureSpan()
  public static async listPullRequestFilePatches(data: {
    token: string;
    owner: string;
    repository: string;
    pullRequestNumber: number;
  }): Promise<{
    files: Array<GitHubPullRequestFilePatch>;
    // Whether the pull request has more files than were read.
    isTruncated: boolean;
  }> {
    const files: Array<GitHubPullRequestFilePatch> = [];

    for (let page: number = 1; page <= MAX_PULL_REQUEST_FILE_PAGES; page++) {
      const json: unknown = await GitHubCommits.get(
        data.token,
        `repos/${encodeURIComponent(data.owner)}/${encodeURIComponent(data.repository)}/pulls/${encodeURIComponent(String(data.pullRequestNumber))}/files?per_page=${PULL_REQUEST_FILES_PER_PAGE}&page=${page}`,
      );
      const pageFiles: Array<GitHubPullRequestFilePatch> =
        GitHubCommits.parsePullRequestFilePatches(json);
      const isFullPage: boolean =
        Array.isArray(json) && json.length >= PULL_REQUEST_FILES_PER_PAGE;

      files.push(...pageFiles);

      if (!isFullPage) {
        return { files, isTruncated: false };
      }
    }

    return { files, isTruncated: true };
  }

  private static async get(token: string, path: string): Promise<JSONObject> {
    const result: HTTPErrorResponse | HTTPResponse<JSONObject> = await API.get({
      url: URL.fromString(`https://api.github.com/${path}`),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (result instanceof HTTPErrorResponse) {
      throw result;
    }

    return result.data;
  }
}
