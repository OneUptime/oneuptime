import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import GitHubUtil, {
  GitHubBranchInfo,
  GitHubCommitResult,
} from "../GitHub/GitHub";
import GitHubInstallationBinding from "../GitHub/GitHubInstallationBinding";
import CodeHostAccess, {
  CODE_HOST_REPOSITORY_SELECT,
  CodeHostConnectionApi,
} from "./CodeHostAccess";
import ForgejoApi from "./ForgejoApi";
import GitLabApi from "./GitLabApi";
import {
  CodeHostBranch,
  CodeHostCommitMade,
  CodeHostFileWrite,
  CodeHostOpenedPullRequest,
} from "./CodeHostTypes";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import {
  CodeHost,
  CodeHostUrl,
  PullRequestTerm,
} from "../../../../Types/CodeRepository/CodeHost";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import PullRequest from "../../../../Types/CodeRepository/PullRequest";
import ObjectID from "../../../../Types/ObjectID";

/*
 * HOW ONEUPTIME WRITES TO A REPOSITORY WITHOUT CLONING IT: A BRANCH, A
 * COMMIT AND A PULL (OR MERGE) REQUEST, WHEREVER THE REPOSITORY IS HOSTED.
 *
 * Chat's code tools (Utils/AI/Toolbox/CodeWriteTools) write through here:
 *
 *   GitHub          the GitHub App's installation the project is bound to
 *                   (GitHubUtil), as they always did;
 *   GitLab          the repository's connection - its access token - and
 *                   GitLab's API: a branch, one commit of several files,
 *                   and a merge request;
 *   Forgejo, Gitea  the repository's connection and their API: the same,
 *                   with a pull request.
 *
 * A Git server has no API for any of it, and is refused before anything is
 * written (CodeWriteTools says why, and where to ask instead). What may be
 * written - never the default branch, never a protected one - is the
 * caller's rule, asked of the branch this reads.
 */

export interface CodeHostWriter {
  provider: CodeRepositoryType;
  // The host's word for a pull request: "merge request" on GitLab.
  pullRequestTerm: PullRequestTerm;
  // The branch the host itself says is the default, not a stored copy.
  getDefaultBranchName(): Promise<string>;
  // A branch's head and protection, or null when it is not there.
  getBranch(branchName: string): Promise<CodeHostBranch | null>;
  // True when the branch was made, false when one of its name is there.
  createBranch(data: {
    branchName: string;
    fromBranchName: string;
  }): Promise<boolean>;
  // One commit on the branch that writes each file whole.
  commitFiles(data: {
    branchName: string;
    commitMessage: string;
    files: Array<CodeHostFileWrite>;
  }): Promise<CodeHostCommitMade>;
  // A pull (or merge) request from one branch into another, ready for review.
  openPullRequest(data: {
    baseBranchName: string;
    headBranchName: string;
    title: string;
    body: string;
  }): Promise<CodeHostOpenedPullRequest>;
}

/*
 * Why there is no writer for a repository: its host has no API OneUptime
 * writes through (a Git server), or OneUptime does not reach it now.
 */
export enum CodeHostWriterGap {
  NoApi = "NoApi",
  NotReached = "NotReached",
}

export type CodeHostWriterResult =
  | { writer: CodeHostWriter; gap: null }
  | { writer: null; gap: CodeHostWriterGap };

export default class CodeHostWriters {
  /*
   * The writer of a project's repository - read again here, as root, for
   * how it is reached, which a reader of it is not shown - or why there is
   * none.
   */
  @CaptureSpan()
  public static async openForRepository(data: {
    projectId: ObjectID;
    repositoryId: ObjectID;
  }): Promise<CodeHostWriterResult> {
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
      return { writer: null, gap: CodeHostWriterGap.NotReached };
    }

    return await CodeHostWriters.open(repository);
  }

  /*
   * The writer of a repository read with CODE_HOST_REPOSITORY_SELECT: a
   * GitHub one through the installation its project is bound to (the
   * installation id on a row is never trusted on its own), any other
   * through its usable connection.
   */
  @CaptureSpan()
  public static async open(
    repository: CodeRepository,
  ): Promise<CodeHostWriterResult> {
    const type: CodeRepositoryType = CodeHost.readType(
      repository.repositoryHostedAt,
    );

    if (type === CodeRepositoryType.Git) {
      return { writer: null, gap: CodeHostWriterGap.NoApi };
    }

    if (type === CodeRepositoryType.GitHub) {
      const boundInstallationId: string | null = repository.projectId
        ? await GitHubInstallationBinding.getBoundInstallationId(
            repository.projectId,
          )
        : null;

      if (
        !boundInstallationId ||
        repository.gitHubAppInstallationId !== boundInstallationId ||
        !repository.organizationName ||
        !repository.repositoryName
      ) {
        return { writer: null, gap: CodeHostWriterGap.NotReached };
      }

      return {
        writer: CodeHostWriters.gitHub({
          installationId: boundInstallationId,
          organizationName: repository.organizationName,
          repositoryName: repository.repositoryName,
        }),
        gap: null,
      };
    }

    const api: CodeHostConnectionApi | null =
      await CodeHostAccess.getConnectionApi(repository);

    if (api?.gitLab) {
      return { writer: CodeHostWriters.gitLab(api, api.gitLab), gap: null };
    }

    if (api?.forgejo) {
      return { writer: CodeHostWriters.forgejo(api, api.forgejo), gap: null };
    }

    return { writer: null, gap: CodeHostWriterGap.NotReached };
  }

  // A GitHub repository, through the App's installation (GitHubUtil).
  public static gitHub(data: {
    installationId: string;
    organizationName: string;
    repositoryName: string;
  }): CodeHostWriter {
    const repository: {
      installationId: string;
      organizationName: string;
      repositoryName: string;
    } = {
      installationId: data.installationId,
      organizationName: data.organizationName,
      repositoryName: data.repositoryName,
    };

    return {
      provider: CodeRepositoryType.GitHub,
      pullRequestTerm: "pull request",
      getDefaultBranchName: async (): Promise<string> => {
        return await GitHubUtil.getDefaultBranchName(repository);
      },
      getBranch: async (branchName: string): Promise<CodeHostBranch | null> => {
        const branch: GitHubBranchInfo | null = await GitHubUtil.getBranch({
          ...repository,
          branchName,
        });

        return branch;
      },
      createBranch: async (args: {
        branchName: string;
        fromBranchName: string;
      }): Promise<boolean> => {
        return await GitHubUtil.createBranch({
          ...repository,
          newBranchName: args.branchName,
          fromBranchName: args.fromBranchName,
        });
      },
      commitFiles: async (args: {
        branchName: string;
        commitMessage: string;
        files: Array<CodeHostFileWrite>;
      }): Promise<CodeHostCommitMade> => {
        const commit: GitHubCommitResult = await GitHubUtil.commitFilesToBranch(
          {
            ...repository,
            branchName: args.branchName,
            changes: args.files,
            commitMessage: args.commitMessage,
          },
        );

        return { commitSha: commit.commitSha, htmlUrl: commit.htmlUrl };
      },
      openPullRequest: async (args: {
        baseBranchName: string;
        headBranchName: string;
        title: string;
        body: string;
      }): Promise<CodeHostOpenedPullRequest> => {
        const pullRequest: PullRequest =
          await GitHubUtil.createPullRequestWithToken({
            ...repository,
            baseBranchName: args.baseBranchName,
            headBranchName: args.headBranchName,
            title: args.title,
            body: args.body,
            isDraft: false,
          });

        return {
          id: pullRequest.pullRequestId,
          number: pullRequest.pullRequestNumber,
          htmlUrl: `https://github.com/${repository.organizationName}/${repository.repositoryName}/pull/${pullRequest.pullRequestNumber}`,
          state: pullRequest.state,
        };
      },
    };
  }

  // A GitLab project, through its connection's access token.
  public static gitLab(
    api: CodeHostConnectionApi,
    gitLab: GitLabApi,
  ): CodeHostWriter {
    const project: string = api.gitLabProject;

    return {
      provider: CodeRepositoryType.GitLab,
      pullRequestTerm: "merge request",
      getDefaultBranchName: async (): Promise<string> => {
        return await api.call(() => {
          return gitLab.getDefaultBranchName(project);
        });
      },
      getBranch: async (branchName: string): Promise<CodeHostBranch | null> => {
        return await api.call(() => {
          return gitLab.getBranch(project, branchName);
        });
      },
      createBranch: async (args: {
        branchName: string;
        fromBranchName: string;
      }): Promise<boolean> => {
        return await api.call(() => {
          return gitLab.createBranch({
            project,
            branchName: args.branchName,
            fromBranchName: args.fromBranchName,
          });
        });
      },
      commitFiles: async (args: {
        branchName: string;
        commitMessage: string;
        files: Array<CodeHostFileWrite>;
      }): Promise<CodeHostCommitMade> => {
        return await api.call(() => {
          return gitLab.commitFiles({
            project,
            branchName: args.branchName,
            commitMessage: args.commitMessage,
            files: args.files,
          });
        });
      },
      openPullRequest: async (args: {
        baseBranchName: string;
        headBranchName: string;
        title: string;
        body: string;
      }): Promise<CodeHostOpenedPullRequest> => {
        const opened: CodeHostOpenedPullRequest = await api.call(() => {
          return gitLab.createMergeRequest({
            project,
            sourceBranch: args.headBranchName,
            targetBranch: args.baseBranchName,
            title: args.title,
            description: args.body,
          });
        });

        return {
          ...opened,
          htmlUrl:
            opened.htmlUrl ||
            `${CodeHostUrl.trimTrailingSlashes(api.webUrl)}/-/merge_requests/${opened.number}`,
        };
      },
    };
  }

  // A Forgejo or Gitea repository, through its connection's access token.
  public static forgejo(
    api: CodeHostConnectionApi,
    forgejo: ForgejoApi,
  ): CodeHostWriter {
    const owner: string = api.owner;
    const name: string = api.name;

    return {
      provider: CodeRepositoryType.Forgejo,
      pullRequestTerm: "pull request",
      getDefaultBranchName: async (): Promise<string> => {
        return await api.call(() => {
          return forgejo.getDefaultBranchName(owner, name);
        });
      },
      getBranch: async (branchName: string): Promise<CodeHostBranch | null> => {
        return await api.call(() => {
          return forgejo.getBranch(owner, name, branchName);
        });
      },
      createBranch: async (args: {
        branchName: string;
        fromBranchName: string;
      }): Promise<boolean> => {
        return await api.call(() => {
          return forgejo.createBranch({
            owner,
            name,
            branchName: args.branchName,
            fromBranchName: args.fromBranchName,
          });
        });
      },
      commitFiles: async (args: {
        branchName: string;
        commitMessage: string;
        files: Array<CodeHostFileWrite>;
      }): Promise<CodeHostCommitMade> => {
        return await api.call(() => {
          return forgejo.commitFiles({
            owner,
            name,
            branchName: args.branchName,
            commitMessage: args.commitMessage,
            files: args.files,
          });
        });
      },
      openPullRequest: async (args: {
        baseBranchName: string;
        headBranchName: string;
        title: string;
        body: string;
      }): Promise<CodeHostOpenedPullRequest> => {
        const opened: CodeHostOpenedPullRequest = await api.call(() => {
          return forgejo.createPullRequest({
            owner,
            name,
            headBranch: args.headBranchName,
            baseBranch: args.baseBranchName,
            title: args.title,
            body: args.body,
          });
        });

        return {
          ...opened,
          htmlUrl:
            opened.htmlUrl ||
            `${CodeHostUrl.trimTrailingSlashes(api.webUrl)}/pulls/${opened.number}`,
        };
      },
    };
  }
}
