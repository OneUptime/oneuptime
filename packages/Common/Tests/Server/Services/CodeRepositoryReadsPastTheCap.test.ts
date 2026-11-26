import CodeRepositoryService, {
  RESOLVABLE_REPOSITORIES_READ_BY_ID_AT_ONCE,
} from "../../../Server/Services/CodeRepositoryService";
import CodeHostAccess from "../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import GitHubUtil, {
  GitHubRepository,
} from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import {
  RepoResolution,
  ResolvableRepository,
} from "../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import { EVERY_CODE_REPOSITORY } from "../../../Types/CodeRepository/CodeRepositoryAllowance";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { FindOperator } from "typeorm";

/*
 * THE REPOSITORIES A FIX MAY BE RESOLVED TO, AND THE ONES AN IMPORT SKIPS,
 * PAST THE PROJECT'S FIRST 10,000 (#11076).
 *
 * Both read the project's repositories with a limit of 10,000 and no
 * order. In a project with more:
 *
 *   - which repositories a fix could be resolved to was chance - and a
 *     repository a person picked for a trace's fix past them was never
 *     found to work in, so the run failed when it started;
 *   - and connecting GitHub again imported a repository past them a second
 *     time.
 *
 * Every one is read now, a page at a time in id order - or, when the
 * repositories a fix may use are named (a pick, the ones a rule allows),
 * only those, by their ids.
 *
 * A fake project of 10,050 repositories answers the reads as Postgres
 * would: by project, by id, sorted, a page at a time.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11076000-0000-4000-8000-000000000000",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "11076000-0000-4000-8000-0000000000ff",
);
const REPOSITORY_COUNT: number = 10050;
const INSTALLATION_ID: string = "11076";

interface Read {
  ids: Array<string> | null;
  skip: number;
  limit: number;
  sortedById: boolean;
}

// The 1-based nth repository's id: ids sort as their numbers do.
function idOf(n: number): string {
  return `11076000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function rowOf(n: number, projectId: ObjectID = PROJECT_ID): CodeRepository {
  const repository: CodeRepository = new CodeRepository();
  repository.id = new ObjectID(idOf(n));
  repository.projectId = projectId;
  repository.name = `service-${String(n).padStart(5, "0")}`;
  repository.organizationName = "harbour";
  repository.repositoryName = `service-${String(n).padStart(5, "0")}`;
  repository.mainBranchName = "main";
  repository.repositoryHostedAt = CodeRepositoryType.GitHub;
  repository.gitHubAppInstallationId = INSTALLATION_ID;
  return repository;
}

// The ids a by-id read names: the parameters of its IN (...).
function idsOf(operator: unknown): Array<string> {
  const parameters: Record<string, unknown> =
    (operator as FindOperator<unknown>).objectLiteralParameters || {};

  return (Object.values(parameters)[0] as Array<string>) || [];
}

describe("the repositories a fix may be resolved to, past the project's first 10,000 (#11076)", () => {
  let reads: Array<Read> = [];
  let repositories: Array<CodeRepository> = [];

  beforeEach(() => {
    reads = [];
    repositories = [
      ...Array.from(
        { length: REPOSITORY_COUNT },
        (_: unknown, index: number): CodeRepository => {
          return rowOf(index + 1);
        },
      ),
      // Another project's, read by nothing here.
      rowOf(REPOSITORY_COUNT + 1, OTHER_PROJECT_ID),
    ];

    jest
      .spyOn(CodeRepositoryService, "findBy")
      .mockImplementation((async (args: {
        query: Record<string, unknown>;
        skip?: number;
        limit?: number;
        sort?: Record<string, unknown>;
      }): Promise<Array<CodeRepository>> => {
        const ids: Array<string> | null =
          args.query["_id"] instanceof FindOperator
            ? idsOf(args.query["_id"])
            : null;
        const skip: number = Number(args.skip || 0);
        const limit: number = Number(args.limit || LIMIT_MAX);

        reads.push({
          ids,
          skip,
          limit,
          sortedById: args.sort?.["_id"] === SortOrder.Ascending,
        });

        const found: Array<CodeRepository> = repositories
          .filter((repository: CodeRepository): boolean => {
            return (
              repository.projectId?.toString() ===
                (args.query["projectId"] as ObjectID).toString() &&
              (!ids || ids.includes(repository.id!.toString()))
            );
          })
          .sort((left: CodeRepository, right: CodeRepository): number => {
            return left.id!.toString().localeCompare(right.id!.toString());
          });

        return found.slice(skip, skip + limit);
      }) as never);

    // Every repository is connected through the project's GitHub App.
    jest
      .spyOn(CodeHostAccess, "getReachableRepositoryIds")
      .mockImplementation(async (data: { repositoryIds: Array<ObjectID> }) => {
        return new Set<string>(
          data.repositoryIds.map((id: ObjectID): string => {
            return id.toString();
          }),
        );
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("every repository is read, a page at a time in id order - the ones past the 10,000th included", async () => {
    const resolvable: Array<ResolvableRepository> =
      await CodeRepositoryService.getResolvableRepositories(PROJECT_ID);

    expect(resolvable).toHaveLength(REPOSITORY_COUNT);
    expect(resolvable[REPOSITORY_COUNT - 1]!.id).toBe(idOf(REPOSITORY_COUNT));
    expect(
      resolvable.some((repository: ResolvableRepository): boolean => {
        return repository.id === idOf(REPOSITORY_COUNT + 1);
      }),
    ).toBe(false);

    // Two pages, each in an order with no ties, so none skips or repeats one.
    expect(reads).toEqual([
      { ids: null, skip: 0, limit: LIMIT_MAX, sortedById: true },
      { ids: null, skip: LIMIT_MAX, limit: LIMIT_MAX, sortedById: true },
    ]);
  });

  test("repositories named by id are read by those ids alone - each once, in the case the database writes, nothing that is no id", async () => {
    const resolvable: Array<ResolvableRepository> =
      await CodeRepositoryService.getResolvableRepositories(PROJECT_ID, {
        repositoryIds: [
          idOf(10049).toUpperCase(),
          idOf(10049),
          "repo-1",
          "",
          // Another project's: never read as this project's.
          idOf(REPOSITORY_COUNT + 1),
        ],
      });

    expect(
      resolvable.map((repository: ResolvableRepository): string => {
        return repository.id;
      }),
    ).toEqual([idOf(10049)]);
    expect(reads).toHaveLength(1);
    expect(reads[0]!.ids!.sort()).toEqual(
      [idOf(10049), idOf(REPOSITORY_COUNT + 1)].sort(),
    );
  });

  test("many named ids are read in batches, none past what Postgres binds at once", async () => {
    const named: Array<string> = Array.from(
      { length: 1200 },
      (_: unknown, index: number): string => {
        return idOf(REPOSITORY_COUNT - index);
      },
    );

    const resolvable: Array<ResolvableRepository> =
      await CodeRepositoryService.getResolvableRepositories(PROJECT_ID, {
        repositoryIds: named,
      });

    expect(resolvable).toHaveLength(1200);
    expect(
      reads.map((read: Read): number => {
        return read.ids!.length;
      }),
    ).toEqual([
      RESOLVABLE_REPOSITORIES_READ_BY_ID_AT_ONCE,
      RESOLVABLE_REPOSITORIES_READ_BY_ID_AT_ONCE,
      1200 - 2 * RESOLVABLE_REPOSITORIES_READ_BY_ID_AT_ONCE,
    ]);
  });

  test("no repository named: nothing is read", async () => {
    expect(
      await CodeRepositoryService.getResolvableRepositories(PROJECT_ID, {
        repositoryIds: [],
      }),
    ).toEqual([]);
    expect(reads).toEqual([]);
  });

  test("a fix held to a pick past the 10,000th resolves to it - only it is read", async () => {
    const resolution: RepoResolution | null =
      await CodeRepositoryService.resolveRepositoryForException({
        projectId: PROJECT_ID,
        stackTrace: null,
        serviceName: null,
        allowance: {
          isEveryRepository: false,
          repositoryIds: [idOf(REPOSITORY_COUNT)],
        },
      });

    expect(resolution?.codeRepositoryId).toBe(idOf(REPOSITORY_COUNT));
    expect(reads).toHaveLength(1);
    expect(reads[0]!.ids).toEqual([idOf(REPOSITORY_COUNT)]);
  });

  test("a fix's service named like a repository past the 10,000th resolves to it, every repository weighed", async () => {
    const resolution: RepoResolution | null =
      await CodeRepositoryService.resolveRepositoryForException({
        projectId: PROJECT_ID,
        stackTrace: null,
        serviceName: "service-10050",
        allowance: EVERY_CODE_REPOSITORY,
      });

    expect(resolution?.codeRepositoryId).toBe(idOf(REPOSITORY_COUNT));
    expect(
      reads.every((read: Read): boolean => {
        return read.ids === null && read.sortedById;
      }),
    ).toBe(true);
  });

  test("an allowance that names none reads nothing and resolves to none", async () => {
    const resolution: RepoResolution | null =
      await CodeRepositoryService.resolveRepositoryForException({
        projectId: PROJECT_ID,
        stackTrace: null,
        serviceName: "service-00001",
        allowance: { isEveryRepository: false, repositoryIds: [] },
      });

    expect(resolution).toBeNull();
    expect(reads).toEqual([]);
  });

  test("connecting GitHub again imports no repository a second time - not one past the project's first 10,000", async () => {
    const create: SpyInstance<typeof CodeRepositoryService.create> = jest.spyOn(
      CodeRepositoryService,
      "create",
    );
    const update: SpyInstance<typeof CodeRepositoryService.updateOneById> =
      jest.spyOn(CodeRepositoryService, "updateOneById");
    const last: CodeRepository = rowOf(REPOSITORY_COUNT);
    const listed: Array<GitHubRepository> = [
      {
        id: 11076,
        name: last.repositoryName!,
        fullName: `harbour/${last.repositoryName!}`,
        ownerLogin: "harbour",
        defaultBranch: "main",
      } as unknown as GitHubRepository,
    ];
    jest
      .spyOn(GitHubUtil, "listRepositoriesForInstallation")
      .mockResolvedValue(listed);

    const result: { imported: number; reconnected: number; skipped: number } =
      await CodeRepositoryService.importReposFromInstallation({
        projectId: PROJECT_ID,
        installationId: INSTALLATION_ID,
      });

    expect(result).toEqual({ imported: 0, reconnected: 0, skipped: 1 });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    // Every repository of the project was read, in id order.
    expect(reads).toEqual([
      { ids: null, skip: 0, limit: LIMIT_MAX, sortedById: true },
      { ids: null, skip: LIMIT_MAX, limit: LIMIT_MAX, sortedById: true },
    ]);
  });

  test("a new repository past them is still imported - under a name none of the 10,050 has", async () => {
    const create: SpyInstance<typeof CodeRepositoryService.create> = jest
      .spyOn(CodeRepositoryService, "create")
      .mockResolvedValue(new CodeRepository() as never);
    jest
      .spyOn(GitHubUtil, "listRepositoriesForInstallation")
      .mockResolvedValue([
        {
          id: 11077,
          // Named like the 10,050th, in another organization.
          name: "service-10050",
          fullName: "lighthouse/service-10050",
          ownerLogin: "lighthouse",
          defaultBranch: "main",
        } as unknown as GitHubRepository,
      ]);

    const result: { imported: number; reconnected: number; skipped: number } =
      await CodeRepositoryService.importReposFromInstallation({
        projectId: PROJECT_ID,
        installationId: INSTALLATION_ID,
      });

    expect(result.imported).toBe(1);
    // The 10,050th's display name is taken: the org-qualified one is used.
    expect(
      (create.mock.calls[0]![0] as { data: CodeRepository }).data.name,
    ).toBe("lighthouse/service-10050");
  });
});
