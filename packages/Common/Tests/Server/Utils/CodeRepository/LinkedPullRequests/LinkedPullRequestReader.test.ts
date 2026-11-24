import CodeRepository from "../../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryService from "../../../../../Server/Services/CodeRepositoryService";
import { CodeHostReader } from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import {
  CodeHostHttpError,
  CodeHostHttpErrorKind,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import { CodeHostPullRequestState } from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostTypes";
import LinkedPullRequestReader, {
  LinkedPullRequestReadError,
  LinkedPullRequestReadProblem,
  getRepositoryPageAddress,
  isRepositoryOfLink,
} from "../../../../../Server/Utils/CodeRepository/LinkedPullRequests/LinkedPullRequestReader";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import URL from "../../../../../Types/API/URL";
import CodeRepositoryType from "../../../../../Types/CodeRepository/CodeRepositoryType";
import PullRequestState from "../../../../../Types/CodeRepository/PullRequestState";
import {
  PullRequestLink,
  parsePullRequestLink,
} from "../../../../../Types/CodeRepository/PullRequestLink";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A pull request a person linked (#10604): the project's repository it is
 * in, found by its address, and its state read through that repository's
 * connection - every failure said as what went wrong, so the link is
 * refused with a reason.
 */

function repository(data: Partial<CodeRepository>): CodeRepository {
  const row: CodeRepository = new CodeRepository();
  row.id = ObjectID.generate();
  row.projectId = ObjectID.generate();
  Object.assign(row, data);
  return row;
}

const GITHUB: CodeRepository = repository({
  repositoryHostedAt: CodeRepositoryType.GitHub,
  organizationName: "acme",
  repositoryName: "search",
});
const GITLAB: CodeRepository = repository({
  repositoryHostedAt: CodeRepositoryType.GitLab,
  organizationName: "acme/platform",
  repositoryName: "search",
  repositoryUrl: URL.fromString("https://gitlab.com/acme/platform/search"),
});

function link(address: string): PullRequestLink {
  return parsePullRequestLink(address)!;
}

function reader(data: {
  canTrackPullRequests?: boolean;
  read?: () => Promise<CodeHostPullRequestState>;
}): CodeHostReader {
  return {
    canTrackPullRequests: data.canTrackPullRequests ?? true,
    getPullRequestState: async (): Promise<
      CodeHostPullRequestState & { ci: null }
    > => {
      return { ...(await data.read!()), ci: null };
    },
  } as unknown as CodeHostReader;
}

async function problemOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LinkedPullRequestReadError);
    return (error as LinkedPullRequestReadError).problem;
  }

  throw new Error("Expected the read to throw.");
}

describe("the repository a pull request's address names", () => {
  test("a GitHub repository's page is the App's to know, by its owner and name", () => {
    expect(getRepositoryPageAddress(GITHUB)).toBe(
      "https://github.com/acme/search",
    );
    expect(
      isRepositoryOfLink(GITHUB, link("https://github.com/Acme/Search/pull/1")),
    ).toBe(true);
    expect(
      isRepositoryOfLink(GITHUB, link("https://github.com/acme/other/pull/1")),
    ).toBe(false);
  });

  test("any other repository by the page its connection keeps", () => {
    expect(
      isRepositoryOfLink(
        GITLAB,
        link("https://gitlab.com/acme/platform/search/-/merge_requests/17"),
      ),
    ).toBe(true);
    expect(
      isRepositoryOfLink(
        GITLAB,
        link("https://gitlab.example.com/acme/platform/search/-/merge_requests/17"),
      ),
    ).toBe(false);
    // A repository with no page and no GitHub name is matched by nothing.
    expect(
      isRepositoryOfLink(
        repository({ repositoryHostedAt: CodeRepositoryType.Git }),
        link("https://git.example.com/acme/search/pulls/1"),
      ),
    ).toBe(false);
  });

  test("is found among the project's repositories, or is not connected", async () => {
    const findBy: jest.SpiedFunction<typeof CodeRepositoryService.findBy> =
      jest
        .spyOn(CodeRepositoryService, "findBy")
        .mockResolvedValue([GITLAB, GITHUB]);
    const projectId: ObjectID = ObjectID.generate();

    expect(
      await LinkedPullRequestReader.findRepository({
        projectId,
        link: link("https://github.com/acme/search/pull/482"),
      }),
    ).toBe(GITHUB);
    expect(findBy.mock.calls[0]![0]).toMatchObject({
      query: { projectId },
      props: { isRoot: true },
    });
    expect(
      await LinkedPullRequestReader.findRepository({
        projectId,
        link: link("https://github.com/acme/elsewhere/pull/1"),
      }),
    ).toBeNull();
  });
});

describe("its state, through the repository's connection", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("open, or merged with the commit it merged as and when", async () => {
    const mergedAt: Date = new Date("2026-11-17T19:00:00.000Z");

    expect(
      await LinkedPullRequestReader.readState({
        repository: GITHUB,
        number: 482,
        reader: reader({
          read: async (): Promise<CodeHostPullRequestState> => {
            return { state: PullRequestState.Open };
          },
        }),
      }),
    ).toEqual({ state: PullRequestState.Open });
    expect(
      await LinkedPullRequestReader.readState({
        repository: GITHUB,
        number: 482,
        reader: reader({
          read: async (): Promise<CodeHostPullRequestState> => {
            return {
              state: PullRequestState.Merged,
              mergeCommitSha: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
              mergedAt,
            };
          },
        }),
      }),
    ).toEqual({
      state: PullRequestState.Merged,
      mergeCommitSha: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
      mergedAt,
    });
  });

  test("a connection that cannot read pull requests - none, or a Git repository's - is not followed", async () => {
    expect(
      await problemOf(
        LinkedPullRequestReader.readState({
          repository: GITHUB,
          number: 1,
          reader: null,
        }),
      ),
    ).toBe(LinkedPullRequestReadProblem.NotFollowed);
    expect(
      await problemOf(
        LinkedPullRequestReader.readState({
          repository: GITHUB,
          number: 1,
          reader: reader({ canTrackPullRequests: false }),
        }),
      ),
    ).toBe(LinkedPullRequestReadProblem.NotFollowed);
  });

  test("a pull request the host does not have, on GitHub or another host, is not found", async () => {
    const githubNotFound: HTTPErrorResponse = new HTTPErrorResponse(
      404,
      { message: "Not Found" },
      {},
    );

    for (const failure of [
      githubNotFound,
      new CodeHostHttpError({
        kind: CodeHostHttpErrorKind.NotFound,
        message: "404 Not Found",
        statusCode: 404,
      }),
    ]) {
      expect(
        await problemOf(
          LinkedPullRequestReader.readState({
            repository: GITHUB,
            number: 404,
            reader: reader({
              read: async (): Promise<CodeHostPullRequestState> => {
                throw failure;
              },
            }),
          }),
        ),
      ).toBe(LinkedPullRequestReadProblem.NotFound);
    }
  });

  test("any other failure is a read that failed, said in the host's words", async () => {
    try {
      await LinkedPullRequestReader.readState({
        repository: GITHUB,
        number: 1,
        reader: reader({
          read: async (): Promise<CodeHostPullRequestState> => {
            throw new CodeHostHttpError({
              kind: CodeHostHttpErrorKind.Unavailable,
              message: "The server did not answer.",
            });
          },
        }),
      });
    } catch (error) {
      expect((error as LinkedPullRequestReadError).problem).toBe(
        LinkedPullRequestReadProblem.ReadFailed,
      );
      expect((error as Error).message).toBe("The server did not answer.");
      return;
    }

    throw new Error("Expected the read to throw.");
  });
});
