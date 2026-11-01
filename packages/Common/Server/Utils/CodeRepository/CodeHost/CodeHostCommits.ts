import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import GitHubUtil, { GitHubInstallationToken } from "../GitHub/GitHub";
import GitHubCommits, {
  GitHubCommitRange,
  GitHubCommitSummary,
  GitHubChangedFile,
  GitHubPullRequestSummary,
  GitHubRepositoryName,
} from "../GitHub/GitHubCommits";
import CodeHostAccess, {
  CODE_HOST_REPOSITORY_SELECT,
  CodeHostConnectionApi,
} from "./CodeHostAccess";
import ForgejoApi from "./ForgejoApi";
import GitLabApi from "./GitLabApi";
import {
  CodeHostCommitFile,
  CodeHostCommitRange,
  CodeHostCommitSummary,
  CodeHostPullRequestSummary,
} from "./CodeHostTypes";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import {
  CodeHost,
  CodeHostUrl,
  PullRequestTerm,
} from "../../../../Types/CodeRepository/CodeHost";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHAT A DEPLOY SHIPPED, READ FROM THE REPOSITORY'S HOST.
 *
 * OneUptime AI's get_change_details lists the commits a deploy shipped -
 * since the service's previous deploy, or its one commit and the pull
 * requests it came from - and the files they changed. Each host answers
 * it its own way:
 *
 *   GitHub          the GitHub App's installation (GitHubCommits): the
 *                   compare API, with each file's lines counted;
 *   GitLab          the repository's connection and GitLab's compare,
 *                   from the two commits' merge base, files counted from
 *                   its diffs;
 *   Forgejo, Gitea  the repository's connection and their compare - or,
 *                   on a Gitea older than 1.23 that compares branches
 *                   only, the head's history back to the base - with
 *                   which files changed and how, not how many lines.
 *
 * A Git server has no API to read commits from: get_change_details says
 * so. Nothing here is written anywhere: the reads are for the AI's answer.
 */

export interface CodeHostCommitReader {
  provider: CodeRepositoryType;
  // The host's word for a pull request: "merge request" on GitLab.
  pullRequestTerm: PullRequestTerm;
  // The commits from `base` to `head`, newest first, and their files.
  compare(data: { base: string; head: string }): Promise<CodeHostCommitRange>;
  // One commit, and the files it changed.
  getCommit(sha: string): Promise<{
    commit: CodeHostCommitSummary;
    files: Array<CodeHostCommitFile>;
  }>;
  // The pull (or merge) requests a commit came from.
  listPullRequestsForCommit(
    sha: string,
  ): Promise<Array<CodeHostPullRequestSummary>>;
}

/*
 * A repository's address as a pipeline sends it with a deploy - an https
 * URL, an ssh one, git@host:path, or a bare "owner/name" - read as the
 * server it is on (null when it does not say) and the repository's path
 * there, without .git: "acme/checkout", or a GitLab group's
 * "acme/backend/checkout".
 */
export interface RepositoryAddress {
  host: string | null;
  path: string;
}

// The most an address may be: longer is no repository's.
const MAX_ADDRESS_LENGTH: number = 2000;

export default class CodeHostCommits {
  /*
   * The commit reader of a project's repository - read again here, as
   * root, for how it is reached - or null when its host has no API for
   * commits (a Git server), or OneUptime does not reach it now.
   */
  @CaptureSpan()
  public static async openForRepository(data: {
    projectId: ObjectID;
    repositoryId: ObjectID;
  }): Promise<CodeHostCommitReader | null> {
    const repository: CodeRepository | null =
      await CodeRepositoryService.findOneBy({
        query: {
          _id: data.repositoryId.toString(),
          projectId: data.projectId,
        },
        select: CODE_HOST_REPOSITORY_SELECT,
        props: { isRoot: true },
      });

    if (!repository) {
      return null;
    }

    const type: CodeRepositoryType = CodeHost.readType(
      repository.repositoryHostedAt,
    );

    if (
      type !== CodeRepositoryType.GitLab &&
      type !== CodeRepositoryType.Forgejo
    ) {
      return null;
    }

    const api: CodeHostConnectionApi | null =
      await CodeHostAccess.getConnectionApi(repository);

    if (api?.gitLab) {
      return CodeHostCommits.gitLab(api, api.gitLab);
    }

    if (api?.forgejo) {
      return CodeHostCommits.forgejo(api, api.forgejo);
    }

    return null;
  }

  /*
   * A GitHub repository, through the App's installation: one token that
   * reads contents and pull requests, minted at the first read and used for
   * every read of this change.
   */
  public static gitHub(data: {
    installationId: string;
    organizationName: string;
    repositoryName: string;
  }): CodeHostCommitReader {
    let token: Promise<GitHubInstallationToken> | null = null;

    const target: () => Promise<{
      token: string;
      owner: string;
      repository: string;
    }> = async (): Promise<{
      token: string;
      owner: string;
      repository: string;
    }> => {
      if (!token) {
        token = GitHubUtil.getInstallationAccessToken(data.installationId, {
          permissions: {
            contents: "read",
            pull_requests: "read",
            metadata: "read",
          },
        });
      }

      return {
        token: (await token).token,
        owner: data.organizationName,
        repository: data.repositoryName,
      };
    };

    return {
      provider: CodeRepositoryType.GitHub,
      pullRequestTerm: "pull request",
      compare: async (args: {
        base: string;
        head: string;
      }): Promise<CodeHostCommitRange> => {
        const range: GitHubCommitRange = await GitHubCommits.compare({
          ...(await target()),
          base: args.base,
          head: args.head,
        });

        return range;
      },
      getCommit: async (
        sha: string,
      ): Promise<{
        commit: CodeHostCommitSummary;
        files: Array<CodeHostCommitFile>;
      }> => {
        const read: {
          commit: GitHubCommitSummary;
          files: Array<GitHubChangedFile>;
        } = await GitHubCommits.getCommit({ ...(await target()), sha });

        return read;
      },
      listPullRequestsForCommit: async (
        sha: string,
      ): Promise<Array<CodeHostPullRequestSummary>> => {
        const pullRequests: Array<GitHubPullRequestSummary> =
          await GitHubCommits.listPullRequestsForCommit({
            ...(await target()),
            sha,
          });

        return pullRequests;
      },
    };
  }

  // A GitLab project, through its connection's access token.
  public static gitLab(
    api: CodeHostConnectionApi,
    gitLab: GitLabApi,
  ): CodeHostCommitReader {
    const project: string = api.gitLabProject;

    return {
      provider: CodeRepositoryType.GitLab,
      pullRequestTerm: "merge request",
      compare: async (args: {
        base: string;
        head: string;
      }): Promise<CodeHostCommitRange> => {
        return await api.call(() => {
          return gitLab.compareCommits({
            project,
            base: args.base,
            head: args.head,
          });
        });
      },
      getCommit: async (
        sha: string,
      ): Promise<{
        commit: CodeHostCommitSummary;
        files: Array<CodeHostCommitFile>;
      }> => {
        return await api.call(() => {
          return gitLab.getCommit({ project, sha });
        });
      },
      listPullRequestsForCommit: async (
        sha: string,
      ): Promise<Array<CodeHostPullRequestSummary>> => {
        return await api.call(() => {
          return gitLab.listMergeRequestsOfCommit({ project, sha });
        });
      },
    };
  }

  // A Forgejo or Gitea repository, through its connection's access token.
  public static forgejo(
    api: CodeHostConnectionApi,
    forgejo: ForgejoApi,
  ): CodeHostCommitReader {
    const owner: string = api.owner;
    const name: string = api.name;

    return {
      provider: CodeRepositoryType.Forgejo,
      pullRequestTerm: "pull request",
      compare: async (args: {
        base: string;
        head: string;
      }): Promise<CodeHostCommitRange> => {
        return await api.call(() => {
          return forgejo.compareCommits({
            owner,
            name,
            base: args.base,
            head: args.head,
          });
        });
      },
      getCommit: async (
        sha: string,
      ): Promise<{
        commit: CodeHostCommitSummary;
        files: Array<CodeHostCommitFile>;
      }> => {
        return await api.call(() => {
          return forgejo.getCommit({ owner, name, sha });
        });
      },
      listPullRequestsForCommit: async (
        sha: string,
      ): Promise<Array<CodeHostPullRequestSummary>> => {
        return await api.call(() => {
          return forgejo.getPullRequestOfCommit({ owner, name, sha });
        });
      },
    };
  }

  /*
   * A repository's address, read (RepositoryAddress) - or null for one that
   * names no repository. GitHub's forms are read as GitHubCommits reads
   * them; any other is read with the URL parser, or as git@host:path.
   */
  public static parseRepositoryAddress(
    value: string | null | undefined,
  ): RepositoryAddress | null {
    const text: string = (value || "").trim();

    if (!text || text.length > MAX_ADDRESS_LENGTH) {
      return null;
    }

    const gitHub: GitHubRepositoryName | null =
      GitHubCommits.parseRepositoryName(text);

    if (gitHub) {
      /*
       * GitHubCommits reads a full address only on github.com: one with a
       * scheme or a user is GitHub's, a bare "owner/name" says no server.
       */
      const isBare: boolean = !text.includes("://") && !text.includes("@");

      return {
        host: isBare ? null : "github.com",
        path: `${gitHub.owner}/${gitHub.name}`,
      };
    }

    let host: string = "";
    let path: string = "";

    if (text.includes("://")) {
      try {
        const url: URL = new URL(text);
        host = url.hostname.toLowerCase();
        path = url.pathname;
      } catch {
        return null;
      }
    } else {
      // The scp-like form: git@host:path/to/repository.git.
      const at: number = text.indexOf("@");
      const colon: number = text.indexOf(":", at + 1);

      if (at <= 0 || colon <= at + 1) {
        return null;
      }

      host = text.substring(at + 1, colon).toLowerCase();
      path = text.substring(colon + 1);
    }

    const segments: Array<string> = CodeHostUrl.trimTrailingSlashes(path)
      .split("/")
      .filter((segment: string): boolean => {
        return segment.length > 0;
      });

    if (segments.length < 2 || !host) {
      return null;
    }

    const last: string = segments[segments.length - 1]!;

    segments[segments.length - 1] = last.toLowerCase().endsWith(".git")
      ? last.substring(0, last.length - 4)
      : last;

    if (!segments[segments.length - 1]) {
      return null;
    }

    return {
      host: host === "www.github.com" ? "github.com" : host,
      path: segments.join("/"),
    };
  }

  /*
   * Whether two addresses name the same repository: the same path, in any
   * case, on the same server when both say which.
   */
  public static isSameRepository(
    first: RepositoryAddress,
    second: RepositoryAddress,
  ): boolean {
    if (first.path.toLowerCase() !== second.path.toLowerCase()) {
      return false;
    }

    return !first.host || !second.host || first.host === second.host;
  }

  /*
   * Whether a repository connected to OneUptime is the one an address
   * names: its owner's path and its name, and - for an address on
   * github.com - a GitHub repository, as one anywhere else is not.
   */
  public static isRepositoryAt(
    repository: Pick<
      CodeRepository,
      "organizationName" | "repositoryName" | "repositoryHostedAt"
    >,
    address: RepositoryAddress,
  ): boolean {
    const path: string =
      `${repository.organizationName || ""}/${repository.repositoryName || ""}`.toLowerCase();

    if (path !== address.path.toLowerCase()) {
      return false;
    }

    const isOnGitHub: boolean =
      CodeHost.readType(repository.repositoryHostedAt) ===
      CodeRepositoryType.GitHub;

    if (address.host === "github.com") {
      return isOnGitHub;
    }

    return !address.host || !isOnGitHub;
  }
}
