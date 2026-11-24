import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import { CodeHost } from "../../../../Types/CodeRepository/CodeHost";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import {
  PullRequestLink,
  getRepositoryAddressKey,
} from "../../../../Types/CodeRepository/PullRequestLink";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import ObjectID from "../../../../Types/ObjectID";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import CodeHostAccess, {
  CODE_HOST_REPOSITORY_SELECT,
  CodeHostReader,
} from "../CodeHost/CodeHostAccess";
import {
  CodeHostHttpError,
  CodeHostHttpErrorKind,
} from "../CodeHost/CodeHostHttp";
import { CodeHostPullRequestState } from "../CodeHost/CodeHostTypes";

/*
 * A PULL REQUEST A PERSON LINKED TO SOMETHING ONEUPTIME FOLLOWS (#10604):
 * the repository of the project's it is in, found by its address, and its
 * state read through that repository's connection under Code - GitHub's
 * App, a GitLab, Forgejo or Gitea access token - as OneUptime reads the
 * state of the pull requests it opens itself (SyncPullRequestStates).
 *
 * Not tied to what the pull request is linked to: a security case's Fix
 * step links one (SecurityCasePullRequest), and a Data Security issue's
 * fix (#10831) can read its own the same way.
 */

export enum LinkedPullRequestReadProblem {
  // The repository's connection cannot read pull requests: a Git repository, a token refused.
  NotFollowed = "NotFollowed",
  // The host has no such pull request, or the connection cannot see it.
  NotFound = "NotFound",
  // The host did not answer, or answered with something else.
  ReadFailed = "ReadFailed",
}

export class LinkedPullRequestReadError extends Error {
  public problem: LinkedPullRequestReadProblem;

  public constructor(problem: LinkedPullRequestReadProblem, message: string) {
    super(message);
    this.problem = problem;
  }
}

// A repository's page, as the project connected it.
export function getRepositoryPageAddress(repository: CodeRepository): string {
  const url: string = repository.repositoryUrl?.toString() || "";

  if (url) {
    return url;
  }

  // A GitHub repository's page is the App's to know: github.com, by its owner and name.
  return CodeHost.readType(repository.repositoryHostedAt) ===
    CodeRepositoryType.GitHub &&
    repository.organizationName &&
    repository.repositoryName
    ? `https://github.com/${repository.organizationName}/${repository.repositoryName}`
    : "";
}

// Whether a repository the project connected is the one a pull request's address names.
export function isRepositoryOfLink(
  repository: CodeRepository,
  link: PullRequestLink,
): boolean {
  const page: string = getRepositoryPageAddress(repository);

  return (
    Boolean(page) &&
    getRepositoryAddressKey(page) ===
      getRepositoryAddressKey(link.repositoryUrl)
  );
}

export default class LinkedPullRequestReader {
  // The project's repository the pull request is in, by its address; null when the project has not connected it.
  public static async findRepository(data: {
    projectId: ObjectID;
    link: PullRequestLink;
  }): Promise<CodeRepository | null> {
    const repositories: Array<CodeRepository> =
      await CodeRepositoryService.findBy({
        query: { projectId: data.projectId },
        select: CODE_HOST_REPOSITORY_SELECT,
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

    return (
      repositories.find((repository: CodeRepository): boolean => {
        return isRepositoryOfLink(repository, data.link);
      }) || null
    );
  }

  /*
   * The pull request's state, and once merged its merge commit and time,
   * read through the repository's connection. Throws a
   * LinkedPullRequestReadError that says what went wrong.
   */
  public static async readState(data: {
    repository: CodeRepository;
    number: number;
    // The reader to read it with; the repository's own by default.
    reader?: CodeHostReader | null | undefined;
  }): Promise<CodeHostPullRequestState> {
    const reader: CodeHostReader | null =
      data.reader !== undefined
        ? data.reader
        : await CodeHostAccess.getReaderForRepository(data.repository);

    if (!reader || !reader.canTrackPullRequests) {
      throw new LinkedPullRequestReadError(
        LinkedPullRequestReadProblem.NotFollowed,
        "The repository's connection cannot read its pull requests.",
      );
    }

    try {
      const read: CodeHostPullRequestState = await reader.getPullRequestState({
        number: data.number,
      });

      return {
        state: read.state,
        ...(read.mergeCommitSha ? { mergeCommitSha: read.mergeCommitSha } : {}),
        ...(read.mergedAt ? { mergedAt: read.mergedAt } : {}),
      };
    } catch (error) {
      const isNotFound: boolean =
        (error instanceof HTTPErrorResponse && error.statusCode === 404) ||
        (error instanceof CodeHostHttpError &&
          error.kind === CodeHostHttpErrorKind.NotFound);

      throw new LinkedPullRequestReadError(
        isNotFound
          ? LinkedPullRequestReadProblem.NotFound
          : LinkedPullRequestReadProblem.ReadFailed,
        error instanceof HTTPErrorResponse || error instanceof Error
          ? error.message
          : String(error),
      );
    }
  }
}
