import {
  CodeTaskChanges,
  CodeTaskFileChange,
  CodeTaskFileDiff,
  CodeTaskOutcomeReport,
} from "Common/Types/AI/CodeTask";
import { CodeHost } from "Common/Types/CodeRepository/CodeHost";
import CodeRepositoryType from "Common/Types/CodeRepository/CodeRepositoryType";
import { RepositoryToken } from "./BackendAPI";

/*
 * A CHANGE PUSHED TO A BRANCH, FOR A REPOSITORY WITH NO PULL REQUESTS.
 *
 * A plain Git repository has no pull request API OneUptime knows, so a run
 * that changes its code pushes the branch and stops there: the person opens
 * the pull request on their Git server. The run says so - which branch,
 * into which, and where to open it when the server's pages are known - as
 * its outcome, which Code shows in the task's conversation, instead of
 * reporting "no fix" for work that was done.
 */
export interface PushedBranch {
  repositoryId: string;
  // "team/app".
  repositoryName: string;
  branchName: string;
  baseBranchName: string;
  // The branch's page, when the server's pages are known.
  branchUrl: string | null;
  // Where the person opens the pull request, when the server's pages are known.
  newPullRequestUrl: string | null;
  // What the agent said it did.
  summary: string;
  changes: CodeTaskChanges | null;
}

export default class PushedBranches {
  public static create(data: {
    repositoryId: string;
    token: RepositoryToken;
    branchName: string;
    baseBranchName: string;
    summary: string;
    changes?: CodeTaskChanges | null | undefined;
  }): PushedBranch {
    const type: CodeRepositoryType =
      data.token.codeHost?.type || CodeRepositoryType.GitHub;
    const webUrl: string | null = data.token.codeHost?.webUrl || null;

    return {
      repositoryId: data.repositoryId,
      repositoryName: [data.token.organizationName, data.token.repositoryName]
        .filter((part: string): boolean => {
          return Boolean(part);
        })
        .join("/"),
      branchName: data.branchName,
      baseBranchName: data.baseBranchName,
      branchUrl: CodeHost.getBranchWebUrl({
        type,
        webUrl,
        branchName: data.branchName,
      }),
      newPullRequestUrl: CodeHost.getNewPullRequestWebUrl({
        type,
        webUrl,
        branchName: data.branchName,
        baseBranchName: data.baseBranchName,
      }),
      summary: data.summary,
      changes: data.changes || null,
    };
  }

  /*
   * What the person reads about one pushed branch, after the agent's own
   * words: where the work is, then the one thing left to do - open the pull
   * request, linked where the server's pages are known. The page already
   * says that a Git server gets a branch, not a pull request.
   */
  public static describe(branch: PushedBranch): string {
    const where: string = branch.newPullRequestUrl
      ? `[Open a pull request](${branch.newPullRequestUrl}) from it into \`${branch.baseBranchName}\`.`
      : `Open a pull request from it into \`${branch.baseBranchName}\` on your Git server.`;

    return `Pushed the branch \`${branch.branchName}\` to ${branch.repositoryName}. ${where}`;
  }

  /*
   * The run's outcome for branches it pushed and opened no pull request
   * for: the agent's summary, where each branch went, and the files the
   * first one changed with their diff.
   */
  public static toOutcome(
    branches: Array<PushedBranch>,
  ): CodeTaskOutcomeReport | null {
    const first: PushedBranch | undefined = branches[0];

    if (!first) {
      return null;
    }

    const summary: string = branches
      .map((branch: PushedBranch): string => {
        return [branch.summary.trim(), PushedBranches.describe(branch)]
          .filter((part: string): boolean => {
            return Boolean(part);
          })
          .join("\n\n");
      })
      .join("\n\n---\n\n");

    const filesChanged: Array<CodeTaskFileChange> = (
      first.changes?.files || []
    ).map((file: CodeTaskFileDiff): CodeTaskFileChange => {
      return {
        path: file.path,
        ...(file.previousPath ? { previousPath: file.previousPath } : {}),
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
      };
    });

    return {
      summary,
      needsInput: false,
      filesChanged,
      branchName: first.branchName,
      ...(first.changes ? { changes: first.changes } : {}),
    };
  }
}
