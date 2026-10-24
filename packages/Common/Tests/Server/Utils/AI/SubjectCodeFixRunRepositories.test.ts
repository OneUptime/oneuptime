import SubjectCodeFixRun from "../../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import CodeRepositoryService from "../../../../Server/Services/CodeRepositoryService";
import CodeHostAccess from "../../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryType from "../../../../Types/CodeRepository/CodeRepositoryType";
import {
  EVERY_CODE_REPOSITORY,
  NO_CODE_REPOSITORY,
} from "../../../../Types/CodeRepository/CodeRepositoryAllowance";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Whether a fix pull request can be opened at all: the project needs a
 * connected repository - one connected through the GitHub App, or one on
 * GitLab, Forgejo, Gitea or a Git server whose connection works - and, for
 * one the auto remediation rules open, one of the repositories they allow.
 * Asked before a run is queued, so a rule that names only repositories that
 * are not connected opens nothing, rather than a run that can only fail.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CHECKOUT_REPO: string = "c1111111-1111-4111-8111-111111111111";
const BILLING_REPO: string = "c2222222-2222-4222-8222-222222222222";

function mockConnected(
  count: number,
): SpyInstance<typeof CodeRepositoryService.countBy> {
  return jest.spyOn(CodeRepositoryService, "countBy").mockResolvedValue({
    toNumber: (): number => {
      return count;
    },
  } as never);
}

// The project's repositories on other hosts, as their rows are read.
function mockOtherHosts(
  ids: Array<string>,
): SpyInstance<typeof CodeRepositoryService.findBy> {
  return jest.spyOn(CodeRepositoryService, "findBy").mockResolvedValue(
    ids.map((id: string): CodeRepository => {
      const repository: CodeRepository = new CodeRepository();
      repository.id = new ObjectID(id);
      return repository;
    }),
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SubjectCodeFixRun.hasConnectedRepository", () => {
  test("counts the project's GitHub-App-connected repositories, as root", async () => {
    const countBy: SpyInstance<typeof CodeRepositoryService.countBy> =
      mockConnected(1);

    expect(await SubjectCodeFixRun.hasConnectedRepository(PROJECT_ID)).toBe(
      true,
    );

    const query: Record<string, unknown> = countBy.mock.calls[0]![0]
      .query as Record<string, unknown>;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["repositoryHostedAt"]).toBe(CodeRepositoryType.GitHub);
    expect(query["gitHubAppInstallationId"]).toBeDefined();
    // No allowance: every connected repository counts.
    expect(query["_id"]).toBeUndefined();
    expect(countBy.mock.calls[0]![0].props).toEqual({ isRoot: true });
  });

  test("every repository allowed counts them all, as no allowance does", async () => {
    const countBy: SpyInstance<typeof CodeRepositoryService.countBy> =
      mockConnected(2);

    expect(
      await SubjectCodeFixRun.hasConnectedRepository(
        PROJECT_ID,
        EVERY_CODE_REPOSITORY,
      ),
    ).toBe(true);
    expect(
      (countBy.mock.calls[0]![0].query as Record<string, unknown>)["_id"],
    ).toBeUndefined();
  });

  test("some repositories allowed: only those count", async () => {
    const countBy: SpyInstance<typeof CodeRepositoryService.countBy> =
      mockConnected(1);

    expect(
      await SubjectCodeFixRun.hasConnectedRepository(PROJECT_ID, {
        isEveryRepository: false,
        repositoryIds: [CHECKOUT_REPO, BILLING_REPO],
      }),
    ).toBe(true);

    const restricted: unknown = (
      countBy.mock.calls[0]![0].query as Record<string, unknown>
    )["_id"];

    expect(restricted).toBeDefined();
    expect(JSON.stringify(restricted)).toContain(CHECKOUT_REPO);
    expect(JSON.stringify(restricted)).toContain(BILLING_REPO);
  });

  test("the allowed repositories are not connected: no pull request can open", async () => {
    mockConnected(0);
    mockOtherHosts([]);

    expect(
      await SubjectCodeFixRun.hasConnectedRepository(PROJECT_ID, {
        isEveryRepository: false,
        repositoryIds: [CHECKOUT_REPO],
      }),
    ).toBe(false);
  });

  test("none allowed: no pull request can open, and nothing is counted", async () => {
    const countBy: SpyInstance<typeof CodeRepositoryService.countBy> =
      mockConnected(5);

    expect(
      await SubjectCodeFixRun.hasConnectedRepository(
        PROJECT_ID,
        NO_CODE_REPOSITORY,
      ),
    ).toBe(false);
    expect(countBy).not.toHaveBeenCalled();
  });
});

describe("SubjectCodeFixRun.hasConnectedRepository, off GitHub", () => {
  test("a repository on GitLab whose connection works counts, asked of its connection", async () => {
    mockConnected(0);
    const findBy: SpyInstance<typeof CodeRepositoryService.findBy> =
      mockOtherHosts([CHECKOUT_REPO]);
    const reachable: SpyInstance<
      typeof CodeHostAccess.getReachableRepositoryIds
    > = jest
      .spyOn(CodeHostAccess, "getReachableRepositoryIds")
      .mockResolvedValue(new Set([CHECKOUT_REPO]));

    expect(await SubjectCodeFixRun.hasConnectedRepository(PROJECT_ID)).toBe(
      true,
    );

    const query: Record<string, unknown> = findBy.mock.calls[0]![0]
      .query as Record<string, unknown>;

    expect(query["projectId"]).toBe(PROJECT_ID);
    // Only repositories with a connection of their own are read.
    expect(query["codeRepositoryConnectionId"]).toBeDefined();
    expect(findBy.mock.calls[0]![0].props).toEqual({ isRoot: true });
    expect(
      reachable.mock.calls[0]![0].repositoryIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([CHECKOUT_REPO]);
  });

  test("one whose token its server refused does not count", async () => {
    mockConnected(0);
    mockOtherHosts([CHECKOUT_REPO]);
    jest
      .spyOn(CodeHostAccess, "getReachableRepositoryIds")
      .mockResolvedValue(new Set());

    expect(await SubjectCodeFixRun.hasConnectedRepository(PROJECT_ID)).toBe(
      false,
    );
  });

  test("the rules' allowance holds there too", async () => {
    mockConnected(0);
    const findBy: SpyInstance<typeof CodeRepositoryService.findBy> =
      mockOtherHosts([]);

    expect(
      await SubjectCodeFixRun.hasConnectedRepository(PROJECT_ID, {
        isEveryRepository: false,
        repositoryIds: [BILLING_REPO],
      }),
    ).toBe(false);
    expect(
      JSON.stringify(
        (findBy.mock.calls[0]![0].query as Record<string, unknown>)["_id"],
      ),
    ).toContain(BILLING_REPO);
  });

  test("a GitHub repository connected through the App answers before any other host is asked", async () => {
    mockConnected(1);
    const findBy: SpyInstance<typeof CodeRepositoryService.findBy> =
      mockOtherHosts([CHECKOUT_REPO]);

    expect(await SubjectCodeFixRun.hasConnectedRepository(PROJECT_ID)).toBe(
      true,
    );
    expect(findBy).not.toHaveBeenCalled();
  });
});
