import logger from "../../Logger";
import CodeHostAccess, {
  CodeHostConnectionApi,
} from "../CodeHost/CodeHostAccess";
import {
  CodeHostHttpError,
  CodeHostHttpErrorKind,
} from "../CodeHost/CodeHostHttp";
import {
  CodeHostChangedFiles,
  CodeHostComment,
  CodeHostLineComment,
  CodeHostPullRequestDetails,
  CodeHostServerInfo,
} from "../CodeHost/CodeHostTypes";
import ForgejoApi from "../CodeHost/ForgejoApi";
import GitLabApi, { GitLabDiscussion } from "../CodeHost/GitLabApi";
import { LineSuggestionFormat } from "./ProductionReviewComposer";
import GitHubConversation, {
  GitHubIssueComment,
  GitHubPullRequestDetails,
  GitHubPullRequestFile,
} from "../GitHub/GitHubConversation";
import GitHubCheckRuns, {
  GitHubCheckRunContent,
  GitHubCheckRunWritten,
} from "../GitHub/GitHubCheckRuns";
import GitHubInstallationBinding from "../GitHub/GitHubInstallationBinding";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import { GitHubTaskContext } from "../../../../Types/AI/CodeFixTaskContext";
import { CodeHost } from "../../../../Types/CodeRepository/CodeHost";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHERE A PRODUCTION REVIEW READS ITS PULL REQUEST, AND KEEPS ITS COMMENT.
 *
 * A review reads the same things on every host that has pull requests -
 * the pull request (open, a draft, its head, from a fork), the files it
 * changes with their diff, whether the repository is public - and keeps
 * ONE comment on it, edited in place. Only where they come from differs:
 *
 *   GitHub          the GitHub App's installation the project is bound to
 *                   (GitHubConversation), as every review always was;
 *   GitLab          the repository's connection - its access token - and
 *                   GitLab's API (merge requests, their notes);
 *   Forgejo, Gitea  the repository's connection and their API (pull
 *                   requests, their issue comments).
 *
 * Everything else a review does - what production shows of the change,
 * OneUptime AI's read, the comment's words - is the same on every host
 * (ProductionReviewRunner). A leak's suggested change goes on its line in
 * each host's own review comments (#10777): a GitHub review, a GitLab diff
 * discussion, a Forgejo or Gitea review - as a block its author can apply
 * where the host applies one, else as a diff.
 *
 * GitLab, Forgejo and Gitea send OneUptime no webhooks: their pull
 * requests are found by the poll (ProductionReviewPoller), which also asks
 * the host who may write to the repository - what PolledReviewHost adds.
 */

// A GitHub repository, as the App's installation reaches it.
export interface GitHubReviewedRepository {
  installationId: string;
  organizationName: string;
  repositoryName: string;
}

export interface ProductionReviewHost {
  provider: CodeRepositoryType;
  // The host's word for a pull request: "merge request" on GitLab.
  pullRequestTerm: "pull request" | "merge request";
  getPullRequest(number: number): Promise<CodeHostPullRequestDetails>;
  listFiles(data: {
    pullRequest: CodeHostPullRequestDetails;
    maxFiles: number;
  }): Promise<CodeHostChangedFiles>;
  /*
   * Whether anyone on the internet can read the repository: null when the
   * host could not say, which a caller deciding what to post reads as
   * public.
   */
  isRepositoryPublic(): Promise<boolean | null>;
  /*
   * The review's one comment: the one there edited in place, or written
   * when there is none - or when the one there is gone (someone deleted
   * it, an ordinary thing to do to a bot's comment).
   */
  writeComment(data: {
    pullRequest: { number: number; htmlUrl: string };
    commentId: number | undefined;
    body: string;
  }): Promise<CodeHostComment>;
  /*
   * What someone types on the pull request to ask for a review on the host
   * itself ("@oneuptime production review"), or null where OneUptime reads
   * no commands - there, Review again in OneUptime asks.
   */
  getReviewCommand(): Promise<string | null>;
  /*
   * GitHub only: the review as a check run on the pull request's head -
   * written, or the one of the same head edited in place. Null when the
   * App may not write checks there (GitHubCheckRuns). Left out on hosts
   * with no checks OneUptime writes.
   */
  writeCheckRun?:
    | ((data: {
        checkRunId: number | undefined;
        checkRunHeadSha: string | undefined;
        content: GitHubCheckRunContent;
      }) => Promise<GitHubCheckRunWritten | null>)
    | undefined;
  /*
   * GitLab, Forgejo and Gitea, which have no check runs OneUptime writes:
   * the review's commit status on the pull request's head (#10376) -
   * success, or failed when the change leaks sensitive data the repository
   * fails its check on. Written only for a repository that asked, so a
   * branch rule can require it.
   */
  writeCommitStatus?:
    | ((data: {
        headSha: string;
        isFailure: boolean;
        name: string;
        description: string;
        targetUrl: string;
      }) => Promise<void>)
    | undefined;
  /*
   * Suggested changes, each on the line it changes (#10376, #10777), with
   * the host's own review comments: GitHub's and Forgejo's or Gitea's as
   * one review of the pull request, which the host takes whole or refuses
   * (and this throws); GitLab's as a diff discussion each, which it takes
   * or refuses one by one. Answers the keys of the suggestions the host
   * took. A review is never posted without its comments.
   */
  writeSuggestions?:
    | ((data: {
        pullRequest: Pick<
          CodeHostPullRequestDetails,
          "number" | "headSha" | "diffRefs"
        >;
        // The review's own words, where the host's comments are a review's.
        body: string;
        suggestions: Array<LineSuggestion>;
      }) => Promise<Array<string>>)
    | undefined;
  /*
   * What a suggested change on its line is written as on this host: a
   * block its author can apply, in the host's syntax - or the change as a
   * diff, where the host applies none (Gitea, Forgejo before 18).
   */
  getLineSuggestionFormat?: (() => Promise<LineSuggestionFormat>) | undefined;
}

// One suggested change on its line: the point it is of, and the comment.
export interface LineSuggestion extends CodeHostLineComment {
  key: string;
}

/*
 * The open pull requests that changed after a time - and, when the host
 * listed them oldest first and stopped at a page, the time to go on from.
 */
export interface UpdatedPullRequests {
  pullRequests: Array<CodeHostPullRequestDetails>;
  continueFrom: Date | null;
}

/*
 * What a host says of whether a pull request's author may write to the
 * repository (push to it).
 */
export enum AuthorWriteAccess {
  // Developer or more on GitLab; write, admin or owner on Forgejo and Gitea.
  CanWrite = "CanWrite",
  // Less than that, or not a member at all.
  CannotWrite = "CannotWrite",
  /*
   * The host will not say: Forgejo and Gitea tell another user's
   * permission only to the repository's administrators, and the token's
   * account only writes. The poll then goes by the pull request's branch,
   * which only someone who can write could push.
   */
  NotSaid = "NotSaid",
}

// A host whose pull requests the poll finds: GitLab, Forgejo, Gitea.
export interface PolledReviewHost extends ProductionReviewHost {
  // The open pull requests that changed after a time.
  listUpdatedPullRequests(updatedAfter: Date): Promise<UpdatedPullRequests>;
  // Whether a pull request's author may write to the repository.
  getAuthorWriteAccess(
    pullRequest: CodeHostPullRequestDetails,
  ): Promise<AuthorWriteAccess>;
  /*
   * Whether OneUptime opened the pull request itself: its account (the
   * token's) wrote it, on one of the branches AI pushes ("oneuptime-...").
   */
  isOwnPullRequest(pullRequest: CodeHostPullRequestDetails): boolean;
}

// The branches AI pushes its work to start with this (Runner, chat tools).
export const ONEUPTIME_BRANCH_PREFIX: string = "oneuptime-";

// The open merge requests the poll reads at once on GitLab: a page.
const GITLAB_POLL_PAGE_SIZE: number = 100;

// The pages of pull requests the poll reads at most on Forgejo and Gitea.
const FORGEJO_POLL_MAX_PAGES: number = 3;

/*
 * Whether a login is a bot's: a GitHub-style "[bot]", a GitLab project or
 * group access token's own user ("project_42_bot_1a2b..."), or one named
 * as a bot ("renovate-bot", "deploy_bot"). The poll reviews no bot's pull
 * request on its own - dependency updates would spend a project's AI
 * reads by the dozen - and Review again still reviews one when asked.
 */
export function isBotLogin(login: string | null | undefined): boolean {
  const name: string = (login || "").trim().toLowerCase();

  if (!name) {
    return false;
  }

  if (
    name.endsWith("[bot]") ||
    name.endsWith("-bot") ||
    name.endsWith("_bot")
  ) {
    return true;
  }

  // GitLab's access token users: project_<id>_bot_<hash>, group_<id>_bot_<hash>.
  for (const prefix of ["project_", "group_"]) {
    if (!name.startsWith(prefix)) {
      continue;
    }

    const rest: string = name.substring(prefix.length);
    const underscore: number = rest.indexOf("_");
    const id: string = underscore > 0 ? rest.substring(0, underscore) : "";

    if (
      id &&
      Array.from(id).every((character: string): boolean => {
        return character >= "0" && character <= "9";
      }) &&
      rest.substring(underscore).startsWith("_bot")
    ) {
      return true;
    }
  }

  return false;
}

// A GitHub pull request's details, as every host gives them.
export function fromGitHubPullRequest(data: {
  pullRequest: GitHubPullRequestDetails;
  organizationName: string;
  repositoryName: string;
}): CodeHostPullRequestDetails {
  const pullRequest: GitHubPullRequestDetails = data.pullRequest;

  return {
    number: pullRequest.pullRequestNumber,
    title: pullRequest.title,
    isOpen: pullRequest.state === "open",
    isMerged: pullRequest.isMerged,
    isDraft: pullRequest.isDraft,
    htmlUrl: pullRequest.htmlUrl,
    authorLogin: pullRequest.authorLogin,
    authorId: "",
    headSha: pullRequest.headSha,
    headRefName: pullRequest.headRefName,
    baseRefName: pullRequest.baseRefName,
    isFromFork: GitHubConversation.isFromFork({
      headRepositoryFullName: pullRequest.headRepositoryFullName,
      organizationName: data.organizationName,
      repositoryName: data.repositoryName,
    }),
    changedFilesCount: pullRequest.changedFilesCount,
    changedLineCount: pullRequest.additions + pullRequest.deletions,
    updatedAt: "",
  };
}

// The points of the suggestions a host took whole.
function keysOf(suggestions: Array<LineSuggestion>): Array<string> {
  return suggestions.map((suggestion: LineSuggestion): string => {
    return suggestion.key;
  });
}

/*
 * Whether a host's refusal of one comment refuses every one after it: the
 * token refused (401), or not allowed to comment there (403) - unlike a
 * line it cannot place (400), which is that comment's alone.
 */
export function isRefusalOfEveryComment(error: unknown): boolean {
  return (
    error instanceof CodeHostHttpError &&
    (error.kind === CodeHostHttpErrorKind.Unauthorized ||
      error.kind === CodeHostHttpErrorKind.Forbidden)
  );
}

/*
 * The comment edited in place when there is one, else written - and
 * written when the edit fails: the comment is gone, or no longer editable.
 */
async function editOrWrite(data: {
  commentId: number | undefined;
  edit: (commentId: number) => Promise<CodeHostComment>;
  write: () => Promise<CodeHostComment>;
}): Promise<CodeHostComment> {
  if (data.commentId) {
    try {
      return await data.edit(data.commentId);
    } catch (error) {
      logger.info(
        `Production review: its comment ${data.commentId} could not be edited (${error}); writing a new one.`,
      );
    }
  }

  return await data.write();
}

export default class ProductionReviewHosts {
  /*
   * The host a review reads and posts through, or null when OneUptime no
   * longer reaches the repository the way the review needs: a GitHub
   * repository no longer connected through the installation the review
   * was asked on (the installation id on a row is never trusted on its
   * own), or a GitLab, Forgejo or Gitea one whose connection is gone,
   * refused, or not reached from OneUptime's server.
   */
  public static async open(data: {
    projectId: ObjectID;
    repository: CodeRepository;
    provider: CodeRepositoryType;
    github: GitHubTaskContext | null;
  }): Promise<ProductionReviewHost | null> {
    const type: CodeRepositoryType = CodeHost.readType(
      data.repository.repositoryHostedAt,
    );

    if (type !== data.provider) {
      // The task was asked on another host than the repository is on now.
      return null;
    }

    if (type === CodeRepositoryType.GitHub) {
      const github: GitHubTaskContext | null = data.github;

      const isBound: boolean = Boolean(
        github &&
          data.repository.gitHubAppInstallationId &&
          data.repository.gitHubAppInstallationId === github.installationId &&
          (await GitHubInstallationBinding.isInstallationBoundToProject({
            projectId: data.projectId,
            installationId: data.repository.gitHubAppInstallationId,
          })),
      );

      return isBound && github ? ProductionReviewHosts.gitHub(github) : null;
    }

    return await ProductionReviewHosts.openPolled(data.repository);
  }

  /*
   * A GitLab, Forgejo or Gitea repository's host, for the poll and its
   * reviews - or null when its connection is not usable from OneUptime's
   * server.
   */
  public static async openPolled(
    repository: CodeRepository,
  ): Promise<PolledReviewHost | null> {
    const api: CodeHostConnectionApi | null =
      await CodeHostAccess.getConnectionApi(repository);

    if (!api) {
      return null;
    }

    if (api.gitLab) {
      return ProductionReviewHosts.gitLab(api, api.gitLab);
    }

    if (api.forgejo) {
      return ProductionReviewHosts.forgejo(api, api.forgejo);
    }

    return null;
  }

  // A GitHub repository, through the App's installation (GitHubConversation).
  public static gitHub(github: GitHubReviewedRepository): ProductionReviewHost {
    const repository: GitHubReviewedRepository = {
      installationId: github.installationId,
      organizationName: github.organizationName,
      repositoryName: github.repositoryName,
    };

    return {
      provider: CodeRepositoryType.GitHub,
      pullRequestTerm: "pull request",
      getPullRequest: async (
        number: number,
      ): Promise<CodeHostPullRequestDetails> => {
        const pullRequest: GitHubPullRequestDetails =
          await GitHubConversation.getPullRequestDetails({
            ...repository,
            pullRequestNumber: number,
          });

        return fromGitHubPullRequest({
          pullRequest,
          organizationName: repository.organizationName,
          repositoryName: repository.repositoryName,
        });
      },
      listFiles: async (args: {
        pullRequest: CodeHostPullRequestDetails;
        maxFiles: number;
      }): Promise<CodeHostChangedFiles> => {
        const files: Array<GitHubPullRequestFile> =
          await GitHubConversation.listPullRequestFiles({
            ...repository,
            pullRequestNumber: args.pullRequest.number,
            maxFiles: args.maxFiles,
          });

        return {
          files,
          hasMore: args.pullRequest.changedFilesCount > files.length,
        };
      },
      isRepositoryPublic: async (): Promise<boolean | null> => {
        return await GitHubConversation.isRepositoryPublic(repository);
      },
      writeComment: async (args: {
        pullRequest: { number: number; htmlUrl: string };
        commentId: number | undefined;
        body: string;
      }): Promise<CodeHostComment> => {
        return await editOrWrite({
          commentId: args.commentId,
          edit: async (commentId: number): Promise<CodeHostComment> => {
            const edited: GitHubIssueComment =
              await GitHubConversation.updateIssueComment({
                ...repository,
                commentId,
                body: args.body,
              });

            return { commentId: edited.commentId, htmlUrl: edited.htmlUrl };
          },
          write: async (): Promise<CodeHostComment> => {
            const written: GitHubIssueComment =
              await GitHubConversation.createIssueComment({
                ...repository,
                issueNumber: args.pullRequest.number,
                body: args.body,
              });

            return { commentId: written.commentId, htmlUrl: written.htmlUrl };
          },
        });
      },
      getReviewCommand: async (): Promise<string | null> => {
        const slug: string | null = await GitHubConversation.getAppSlug();

        return slug ? `@${slug} production review` : null;
      },
      writeCheckRun: async (args: {
        checkRunId: number | undefined;
        checkRunHeadSha: string | undefined;
        content: GitHubCheckRunContent;
      }): Promise<GitHubCheckRunWritten | null> => {
        return await GitHubCheckRuns.write({
          ...repository,
          checkRunId: args.checkRunId,
          checkRunHeadSha: args.checkRunHeadSha,
          content: args.content,
        });
      },
      writeSuggestions: async (args: {
        pullRequest: Pick<CodeHostPullRequestDetails, "number" | "headSha">;
        body: string;
        suggestions: Array<LineSuggestion>;
      }): Promise<Array<string>> => {
        await GitHubConversation.createPullRequestReview({
          ...repository,
          pullRequestNumber: args.pullRequest.number,
          body: args.body,
          comments: args.suggestions.map((suggestion: LineSuggestion) => {
            return {
              path: suggestion.path,
              line: suggestion.line,
              body: suggestion.body,
            };
          }),
          commitSha: args.pullRequest.headSha,
          isOnlyItsComments: true,
        });

        return keysOf(args.suggestions);
      },
      getLineSuggestionFormat: async (): Promise<LineSuggestionFormat> => {
        return LineSuggestionFormat.Suggestion;
      },
    };
  }

  // A GitLab project, through its connection's access token.
  public static gitLab(
    api: CodeHostConnectionApi,
    gitLab: GitLabApi,
  ): PolledReviewHost {
    const project: string = api.gitLabProject;

    return {
      provider: CodeRepositoryType.GitLab,
      pullRequestTerm: "merge request",
      getPullRequest: async (
        number: number,
      ): Promise<CodeHostPullRequestDetails> => {
        return await api.call(() => {
          return gitLab.getMergeRequest({ project, iid: number });
        });
      },
      listFiles: async (args: {
        pullRequest: CodeHostPullRequestDetails;
        maxFiles: number;
      }): Promise<CodeHostChangedFiles> => {
        const listed: CodeHostChangedFiles = await api.call(() => {
          return gitLab.listMergeRequestFiles({
            project,
            iid: args.pullRequest.number,
            maxFiles: args.maxFiles,
          });
        });

        return {
          files: listed.files,
          hasMore:
            listed.hasMore ||
            args.pullRequest.changedFilesCount > listed.files.length,
        };
      },
      isRepositoryPublic: async (): Promise<boolean | null> => {
        return await gitLab.isProjectPublic(project);
      },
      writeComment: async (args: {
        pullRequest: { number: number; htmlUrl: string };
        commentId: number | undefined;
        body: string;
      }): Promise<CodeHostComment> => {
        return await editOrWrite({
          commentId: args.commentId,
          edit: async (noteId: number): Promise<CodeHostComment> => {
            return await api.call(() => {
              return gitLab.updateMergeRequestNote({
                project,
                iid: args.pullRequest.number,
                noteId,
                body: args.body,
                mergeRequestUrl: args.pullRequest.htmlUrl,
              });
            });
          },
          write: async (): Promise<CodeHostComment> => {
            return await api.call(() => {
              return gitLab.createMergeRequestNote({
                project,
                iid: args.pullRequest.number,
                body: args.body,
                mergeRequestUrl: args.pullRequest.htmlUrl,
              });
            });
          },
        });
      },
      getReviewCommand: async (): Promise<string | null> => {
        return null;
      },
      writeCommitStatus: async (args: {
        headSha: string;
        isFailure: boolean;
        name: string;
        description: string;
        targetUrl: string;
      }): Promise<void> => {
        await api.call(() => {
          return gitLab.setCommitStatus({
            project,
            sha: args.headSha,
            state: args.isFailure ? "failed" : "success",
            name: args.name,
            description: args.description,
            targetUrl: args.targetUrl,
          });
        });
      },
      /*
       * Each suggestion as a discussion on its line of the diff the review
       * read (its diff_refs), one at a time: one GitLab refuses - a line a
       * push moved, a file it shows collapsed - is left to the comment's
       * diff, and the rest are still posted. A token GitLab refuses, or
       * that may not comment there, posts none after it.
       */
      writeSuggestions: async (args: {
        pullRequest: Pick<
          CodeHostPullRequestDetails,
          "number" | "headSha" | "diffRefs"
        >;
        body: string;
        suggestions: Array<LineSuggestion>;
      }): Promise<Array<string>> => {
        const diffRefs: CodeHostPullRequestDetails["diffRefs"] =
          args.pullRequest.diffRefs;

        if (!diffRefs) {
          logger.info(
            `Production review: GitLab did not say which diff merge request !${args.pullRequest.number} is, so its suggested changes stay in its comment.`,
          );

          return [];
        }

        const posted: Array<string> = [];

        for (const suggestion of args.suggestions) {
          try {
            const discussion: GitLabDiscussion = await api.call(() => {
              return gitLab.createMergeRequestDiffDiscussion({
                project,
                iid: args.pullRequest.number,
                body: suggestion.body,
                diffRefs,
                comment: suggestion,
              });
            });

            if (!discussion.isOnItsLine) {
              logger.info(
                `Production review: GitLab started the suggestion for ${suggestion.path}:${suggestion.line} on merge request !${args.pullRequest.number} as a thread of its own, not on its line.`,
              );
            }

            posted.push(suggestion.key);
          } catch (error) {
            logger.info(
              `Production review: GitLab did not take the suggestion for ${suggestion.path}:${suggestion.line} on merge request !${args.pullRequest.number}, so its comment holds it alone: ${error instanceof Error ? error.message : String(error)}`,
            );

            if (isRefusalOfEveryComment(error)) {
              break;
            }
          }
        }

        return posted;
      },
      getLineSuggestionFormat: async (): Promise<LineSuggestionFormat> => {
        return LineSuggestionFormat.GitLabSuggestion;
      },
      listUpdatedPullRequests: async (
        updatedAfter: Date,
      ): Promise<UpdatedPullRequests> => {
        const pullRequests: Array<CodeHostPullRequestDetails> = await api.call(
          () => {
            return gitLab.listUpdatedMergeRequests({
              project,
              updatedAfter,
              limit: GITLAB_POLL_PAGE_SIZE,
            });
          },
        );

        /*
         * Oldest first: a full page may stop short of the newest, which the
         * next poll goes on from.
         */
        const last: CodeHostPullRequestDetails | undefined =
          pullRequests[pullRequests.length - 1];
        const lastTime: number = last ? Date.parse(last.updatedAt) : NaN;

        return {
          pullRequests,
          continueFrom:
            pullRequests.length >= GITLAB_POLL_PAGE_SIZE &&
            Number.isFinite(lastTime)
              ? new Date(lastTime)
              : null,
        };
      },
      getAuthorWriteAccess: async (
        pullRequest: CodeHostPullRequestDetails,
      ): Promise<AuthorWriteAccess> => {
        const level: number = await api.call(() => {
          return gitLab.getMemberAccessLevel({
            project,
            userId: pullRequest.authorId,
          });
        });

        return GitLabApi.canPush(level)
          ? AuthorWriteAccess.CanWrite
          : AuthorWriteAccess.CannotWrite;
      },
      isOwnPullRequest: (pullRequest: CodeHostPullRequestDetails): boolean => {
        return ProductionReviewHosts.isOwn(api, pullRequest);
      },
    };
  }

  // A Forgejo or Gitea repository, through its connection's access token.
  public static forgejo(
    api: CodeHostConnectionApi,
    forgejo: ForgejoApi,
  ): PolledReviewHost {
    const owner: string = api.owner;
    const name: string = api.name;

    return {
      provider: CodeRepositoryType.Forgejo,
      pullRequestTerm: "pull request",
      getPullRequest: async (
        number: number,
      ): Promise<CodeHostPullRequestDetails> => {
        return await api.call(() => {
          return forgejo.getPullRequest({ owner, name, number });
        });
      },
      listFiles: async (args: {
        pullRequest: CodeHostPullRequestDetails;
        maxFiles: number;
      }): Promise<CodeHostChangedFiles> => {
        const listed: CodeHostChangedFiles = await api.call(() => {
          return forgejo.listPullRequestFiles({
            owner,
            name,
            number: args.pullRequest.number,
            maxFiles: args.maxFiles,
            changedLineCount: args.pullRequest.changedLineCount,
          });
        });

        return {
          files: listed.files,
          hasMore:
            listed.hasMore ||
            args.pullRequest.changedFilesCount > listed.files.length,
        };
      },
      isRepositoryPublic: async (): Promise<boolean | null> => {
        return await forgejo.isRepositoryPublic(owner, name);
      },
      writeComment: async (args: {
        pullRequest: { number: number; htmlUrl: string };
        commentId: number | undefined;
        body: string;
      }): Promise<CodeHostComment> => {
        return await editOrWrite({
          commentId: args.commentId,
          edit: async (commentId: number): Promise<CodeHostComment> => {
            return await api.call(() => {
              return forgejo.updateIssueComment({
                owner,
                name,
                commentId,
                body: args.body,
              });
            });
          },
          write: async (): Promise<CodeHostComment> => {
            return await api.call(() => {
              return forgejo.createIssueComment({
                owner,
                name,
                number: args.pullRequest.number,
                body: args.body,
              });
            });
          },
        });
      },
      getReviewCommand: async (): Promise<string | null> => {
        return null;
      },
      writeCommitStatus: async (args: {
        headSha: string;
        isFailure: boolean;
        name: string;
        description: string;
        targetUrl: string;
      }): Promise<void> => {
        await api.call(() => {
          return forgejo.setCommitStatus({
            owner,
            name,
            sha: args.headSha,
            state: args.isFailure ? "failure" : "success",
            context: args.name,
            description: args.description,
            targetUrl: args.targetUrl,
          });
        });
      },
      /*
       * One review of the head the review read, its comments each on its
       * line. Forgejo and Gitea take a comment on any line, unchecked
       * against the diff (as read from Forgejo 11 and Gitea 1.24): pinned
       * to that head, each stays on the line the review read it on.
       */
      writeSuggestions: async (args: {
        pullRequest: Pick<CodeHostPullRequestDetails, "number" | "headSha">;
        body: string;
        suggestions: Array<LineSuggestion>;
      }): Promise<Array<string>> => {
        await api.call(() => {
          return forgejo.createPullRequestReview({
            owner,
            name,
            number: args.pullRequest.number,
            commitId: args.pullRequest.headSha,
            body: args.body,
            comments: args.suggestions,
          });
        });

        return keysOf(args.suggestions);
      },
      /*
       * Forgejo applies a ```suggestion block from version 18; Gitea, and
       * an older Forgejo, draw one as code - there the change is a diff.
       */
      getLineSuggestionFormat: async (): Promise<LineSuggestionFormat> => {
        const info: CodeHostServerInfo = await forgejo.getServerInfo();

        return ForgejoApi.appliesSuggestions(info)
          ? LineSuggestionFormat.Suggestion
          : LineSuggestionFormat.Diff;
      },
      listUpdatedPullRequests: async (
        updatedAfter: Date,
      ): Promise<UpdatedPullRequests> => {
        /*
         * Newest first, as far as a few pages: what changed in the minutes
         * since the last poll, which is all but a burst of hundreds.
         */
        const pullRequests: Array<CodeHostPullRequestDetails> = await api.call(
          () => {
            return forgejo.listUpdatedPullRequests({
              owner,
              name,
              updatedAfter,
              maxPages: FORGEJO_POLL_MAX_PAGES,
            });
          },
        );

        return { pullRequests, continueFrom: null };
      },
      getAuthorWriteAccess: async (
        pullRequest: CodeHostPullRequestDetails,
      ): Promise<AuthorWriteAccess> => {
        const permission: string | null = await api.call(() => {
          return forgejo.getUserPermission({
            owner,
            name,
            login: pullRequest.authorLogin,
          });
        });

        if (permission === null) {
          return AuthorWriteAccess.NotSaid;
        }

        return ForgejoApi.canPush(permission)
          ? AuthorWriteAccess.CanWrite
          : AuthorWriteAccess.CannotWrite;
      },
      isOwnPullRequest: (pullRequest: CodeHostPullRequestDetails): boolean => {
        return ProductionReviewHosts.isOwn(api, pullRequest);
      },
    };
  }

  /*
   * A pull request OneUptime opened: by its connection's account, from a
   * branch AI pushes. A person who connected with their own token keeps
   * their own pull requests reviewed: only AI's branches are OneUptime's.
   */
  private static isOwn(
    api: CodeHostConnectionApi,
    pullRequest: CodeHostPullRequestDetails,
  ): boolean {
    return Boolean(
      api.accountLogin &&
        pullRequest.authorLogin.toLowerCase() ===
          api.accountLogin.toLowerCase() &&
        pullRequest.headRefName.startsWith(ONEUPTIME_BRANCH_PREFIX),
    );
  }
}
