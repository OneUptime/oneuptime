import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import GitHubUtil, {
  GitHubRepository,
} from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import GitHubInstallationBinding from "../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import ObjectID from "../../../Types/ObjectID";

jest.mock("../../../Server/Services/DatabaseService", () => {
  return {
    __esModule: true,
    default: class {
      public findBy: jest.Mock = jest.fn();
      public create: jest.Mock = jest.fn();
      public updateOneBy: jest.Mock = jest.fn();
    },
  };
});
jest.mock("../../../Server/Utils/CodeRepository/GitHub/GitHub", () => {
  return {
    __esModule: true,
    default: { listRepositoriesForInstallation: jest.fn() },
  };
});
jest.mock(
  "../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding",
  () => {
    return {
      __esModule: true,
      default: { assertInstallationBoundToProject: jest.fn() },
    };
  },
);
jest.mock("../../../Server/Utils/Logger", () => {
  return { __esModule: true, default: { error: jest.fn() } };
});

function githubRepository(name: string, id: number): GitHubRepository {
  return {
    id,
    name,
    fullName: `acme/${name}`,
    private: true,
    htmlUrl: `https://github.com/acme/${name}`,
    description: null,
    defaultBranch: "main",
    ownerLogin: "acme",
  };
}

describe("GitHub repository import retries", () => {
  const projectId: ObjectID = ObjectID.generate();
  const request: { projectId: ObjectID; installationId: string } = {
    projectId,
    installationId: "123",
  };
  let persisted: Array<CodeRepository>;

  function retainedRepository(
    name: string,
    installationId?: string | null,
  ): CodeRepository {
    const repository: CodeRepository = new CodeRepository();
    repository.id = ObjectID.generate();
    repository.projectId = projectId;
    repository.name = name;
    repository.repositoryHostedAt = CodeRepositoryType.GitHub;
    repository.organizationName = "acme";
    repository.repositoryName = name;
    if (installationId !== undefined) {
      repository.gitHubAppInstallationId = installationId as string;
    }
    return repository;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    persisted = [];
    jest
      .mocked(GitHubInstallationBinding.assertInstallationBoundToProject)
      .mockResolvedValue(undefined);
    jest
      .mocked(GitHubUtil.listRepositoriesForInstallation)
      .mockResolvedValue([
        githubRepository("first", 1),
        githubRepository("second", 2),
      ]);
    jest
      .mocked(CodeRepositoryService.findBy)
      .mockImplementation(async (): Promise<Array<CodeRepository>> => {
        return [...persisted];
      });
    jest
      .mocked(CodeRepositoryService.create)
      .mockImplementation(
        async (
          data: Parameters<typeof CodeRepositoryService.create>[0],
        ): Promise<CodeRepository> => {
          data.data.id = ObjectID.generate();
          persisted.push(data.data);
          return data.data;
        },
      );
    jest
      .mocked(CodeRepositoryService.updateOneBy)
      .mockImplementation(
        async (
          data: Parameters<typeof CodeRepositoryService.updateOneBy>[0],
        ): Promise<number> => {
          const repository: CodeRepository | undefined = persisted.find(
            (row: CodeRepository): boolean => {
              return (
                row.id?.toString() === data.query._id &&
                row.projectId?.toString() ===
                  (data.query.projectId as ObjectID | undefined)?.toString() &&
                row.repositoryHostedAt === data.query.repositoryHostedAt
              );
            },
          );
          if (!repository) {
            return 0;
          }
          Object.assign(repository, data.data);
          return 1;
        },
      );
  });

  test("keeps the interactive callback best effort by default", async () => {
    jest
      .mocked(CodeRepositoryService.create)
      .mockRejectedValueOnce(new Error("temporary failure"));
    await expect(
      CodeRepositoryService.importReposFromInstallation(request),
    ).resolves.toEqual({ imported: 1, skipped: 1 });
    expect(CodeRepositoryService.create).toHaveBeenCalledTimes(2);
  });

  test("strict worker imports fail on partial persistence after attempting every repository", async () => {
    jest
      .mocked(CodeRepositoryService.create)
      .mockRejectedValueOnce(new Error("temporary failure"));
    await expect(
      CodeRepositoryService.importReposFromInstallation({
        ...request,
        strictImportErrors: true,
      }),
    ).rejects.toThrow("1 GitHub repositories could not be imported");
    expect(CodeRepositoryService.create).toHaveBeenCalledTimes(2);
    expect(
      persisted.map((repository: CodeRepository): string | undefined => {
        return repository.repositoryName;
      }),
    ).toEqual(["second"]);
  });

  test("retry imports failed repositories while skipping already persisted ones", async () => {
    jest
      .mocked(CodeRepositoryService.create)
      .mockRejectedValueOnce(new Error("temporary failure"));
    await expect(
      CodeRepositoryService.importReposFromInstallation({
        ...request,
        strictImportErrors: true,
      }),
    ).rejects.toThrow();
    await expect(
      CodeRepositoryService.importReposFromInstallation({
        ...request,
        strictImportErrors: true,
      }),
    ).resolves.toEqual({ imported: 1, skipped: 1 });
    expect(CodeRepositoryService.create).toHaveBeenCalledTimes(3);
    expect(
      persisted
        .map((repository: CodeRepository): string | undefined => {
          return repository.repositoryName;
        })
        .sort(),
    ).toEqual(["first", "second"]);
  });

  test("does not fail strict imports just because repositories already exist", async () => {
    await CodeRepositoryService.importReposFromInstallation(request);
    jest.mocked(CodeRepositoryService.create).mockClear();
    await expect(
      CodeRepositoryService.importReposFromInstallation({
        ...request,
        strictImportErrors: true,
      }),
    ).resolves.toEqual({ imported: 0, skipped: 2 });
    expect(CodeRepositoryService.create).not.toHaveBeenCalled();
  });

  test("counts every failed insert and allows explicit best-effort mode", async () => {
    jest
      .mocked(CodeRepositoryService.create)
      .mockRejectedValue(new Error("database unavailable"));
    await expect(
      CodeRepositoryService.importReposFromInstallation({
        ...request,
        strictImportErrors: true,
      }),
    ).rejects.toThrow("2 GitHub repositories");
    await expect(
      CodeRepositoryService.importReposFromInstallation({
        ...request,
        strictImportErrors: false,
      }),
    ).resolves.toEqual({ imported: 0, skipped: 2 });
  });

  test("retries repository listing and database lookup failures", async () => {
    jest
      .mocked(GitHubUtil.listRepositoriesForInstallation)
      .mockRejectedValueOnce(new Error("GitHub unavailable"));
    await expect(
      CodeRepositoryService.importReposFromInstallation({
        ...request,
        strictImportErrors: true,
      }),
    ).rejects.toThrow("GitHub unavailable");
    jest
      .mocked(CodeRepositoryService.findBy)
      .mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      CodeRepositoryService.importReposFromInstallation({
        ...request,
        strictImportErrors: true,
      }),
    ).rejects.toThrow("database unavailable");
    expect(CodeRepositoryService.create).not.toHaveBeenCalled();
  });

  test.each([undefined, null, "99"])(
    "reinstall reconnects a retained repository from installation %s without replacing its settings or ID",
    async (installationId: string | null | undefined) => {
      const repository: CodeRepository = retainedRepository(
        "first",
        installationId,
      );
      repository.name = "Production API";
      repository.mainBranchName = "release";
      repository.description = "Keep our description";
      repository.setupCommand = "npm ci";
      repository.buildCommand = "npm run build";
      repository.testCommand = "npm test";
      repository.maxOpenFixPullRequests = 3;
      const original: CodeRepository = Object.assign(
        new CodeRepository(),
        repository,
      );
      persisted.push(repository);
      jest
        .mocked(GitHubUtil.listRepositoriesForInstallation)
        .mockResolvedValue([githubRepository("first", 1)]);

      await expect(
        CodeRepositoryService.importReposFromInstallation({
          ...request,
          strictImportErrors: true,
        }),
      ).resolves.toEqual({ imported: 1, skipped: 0 });

      expect(persisted).toHaveLength(1);
      expect(repository).toEqual(
        Object.assign(new CodeRepository(), original, {
          gitHubAppInstallationId: "123",
        }),
      );
      expect(CodeRepositoryService.create).not.toHaveBeenCalled();
      expect(CodeRepositoryService.updateOneBy).toHaveBeenCalledWith({
        query: {
          _id: original.id!.toString(),
          projectId,
          repositoryHostedAt: CodeRepositoryType.GitHub,
        },
        data: { gitHubAppInstallationId: "123" },
        props: { isRoot: true },
      });
    },
  );

  test("an unchanged active repository is not written again", async () => {
    const repository: CodeRepository = retainedRepository("first", "123");
    persisted.push(repository);
    jest
      .mocked(GitHubUtil.listRepositoriesForInstallation)
      .mockResolvedValue([githubRepository("first", 1)]);

    await expect(
      CodeRepositoryService.importReposFromInstallation(request),
    ).resolves.toEqual({ imported: 0, skipped: 1 });

    expect(CodeRepositoryService.updateOneBy).not.toHaveBeenCalled();
    expect(CodeRepositoryService.create).not.toHaveBeenCalled();
  });

  test("reconnects a case-insensitive owner/repository match", async () => {
    const repository: CodeRepository = retainedRepository("FIRST");
    repository.organizationName = "Acme";
    persisted.push(repository);
    jest
      .mocked(GitHubUtil.listRepositoriesForInstallation)
      .mockResolvedValue([githubRepository("first", 1)]);

    await expect(
      CodeRepositoryService.importReposFromInstallation(request),
    ).resolves.toEqual({ imported: 1, skipped: 0 });

    expect(repository.gitHubAppInstallationId).toBe("123");
    expect(repository.organizationName).toBe("Acme");
    expect(repository.repositoryName).toBe("FIRST");
    expect(CodeRepositoryService.create).not.toHaveBeenCalled();
  });

  test("does not reconnect a same-name repository from another project", async () => {
    const other: CodeRepository = retainedRepository("first", "99");
    other.projectId = ObjectID.generate();
    persisted.push(other);
    jest
      .mocked(GitHubUtil.listRepositoriesForInstallation)
      .mockResolvedValue([githubRepository("first", 1)]);

    await expect(
      CodeRepositoryService.importReposFromInstallation(request),
    ).resolves.toEqual({ imported: 1, skipped: 0 });

    expect(other.gitHubAppInstallationId).toBe("99");
    expect(CodeRepositoryService.updateOneBy).not.toHaveBeenCalled();
    expect(CodeRepositoryService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId,
          name: "first",
          repositoryHostedAt: CodeRepositoryType.GitHub,
          gitHubAppInstallationId: "123",
        }),
      }),
    );
    expect(CodeRepositoryService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({ query: { projectId } }),
    );
  });

  test("a same-name GitLab repository is preserved and does not suppress GitHub import", async () => {
    const other: CodeRepository = retainedRepository("first");
    other.repositoryHostedAt = CodeRepositoryType.GitLab;
    other.gitLabProjectId = "456";
    other.secretToken = "gitlab-test-token";
    const original: CodeRepository = Object.assign(new CodeRepository(), other);
    persisted.push(other);
    jest
      .mocked(GitHubUtil.listRepositoriesForInstallation)
      .mockResolvedValue([githubRepository("first", 1)]);

    await expect(
      CodeRepositoryService.importReposFromInstallation(request),
    ).resolves.toEqual({ imported: 1, skipped: 0 });

    expect(other).toEqual(original);
    expect(CodeRepositoryService.updateOneBy).not.toHaveBeenCalled();
    expect(CodeRepositoryService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "acme/first",
          repositoryHostedAt: CodeRepositoryType.GitHub,
          gitHubAppInstallationId: "123",
        }),
      }),
    );
    expect(persisted).toHaveLength(2);
  });

  test.each(["other/first", "acme/other"])(
    "does not reconnect a different owner/repository: %s",
    async (fullName: string) => {
      const repository: CodeRepository = retainedRepository("first");
      const parts: Array<string> = fullName.split("/");
      repository.organizationName = parts[0]!;
      repository.repositoryName = parts[1]!;
      persisted.push(repository);
      jest
        .mocked(GitHubUtil.listRepositoriesForInstallation)
        .mockResolvedValue([githubRepository("first", 1)]);

      await CodeRepositoryService.importReposFromInstallation(request);

      expect(repository.gitHubAppInstallationId).toBeUndefined();
      expect(CodeRepositoryService.updateOneBy).not.toHaveBeenCalled();
      expect(CodeRepositoryService.create).toHaveBeenCalledTimes(1);
    },
  );

  test("a retained row is not reconnected unless GitHub lists it in the installation", async () => {
    const repository: CodeRepository = retainedRepository("first");
    persisted.push(repository);
    jest
      .mocked(GitHubUtil.listRepositoriesForInstallation)
      .mockResolvedValue([]);

    await expect(
      CodeRepositoryService.importReposFromInstallation(request),
    ).resolves.toEqual({ imported: 0, skipped: 0 });

    expect(repository.gitHubAppInstallationId).toBeUndefined();
    expect(CodeRepositoryService.updateOneBy).not.toHaveBeenCalled();
    expect(CodeRepositoryService.create).not.toHaveBeenCalled();
  });

  test("rejects an unbound installation before GitHub lookup or database access", async () => {
    jest
      .mocked(GitHubInstallationBinding.assertInstallationBoundToProject)
      .mockRejectedValueOnce(new Error("installation is not bound"));

    await expect(
      CodeRepositoryService.importReposFromInstallation(request),
    ).rejects.toThrow("installation is not bound");

    expect(
      GitHubInstallationBinding.assertInstallationBoundToProject,
    ).toHaveBeenCalledWith(request);
    expect(GitHubUtil.listRepositoriesForInstallation).not.toHaveBeenCalled();
    expect(CodeRepositoryService.findBy).not.toHaveBeenCalled();
    expect(CodeRepositoryService.updateOneBy).not.toHaveBeenCalled();
    expect(CodeRepositoryService.create).not.toHaveBeenCalled();
  });

  test("checks ownership before requesting live membership and membership before reconnecting", async () => {
    persisted.push(retainedRepository("first"));
    jest
      .mocked(GitHubUtil.listRepositoriesForInstallation)
      .mockResolvedValue([githubRepository("first", 1)]);

    await CodeRepositoryService.importReposFromInstallation(request);

    expect(
      jest.mocked(GitHubInstallationBinding.assertInstallationBoundToProject)
        .mock.invocationCallOrder[0],
    ).toBeLessThan(
      jest.mocked(GitHubUtil.listRepositoriesForInstallation).mock
        .invocationCallOrder[0]!,
    );
    expect(
      jest.mocked(GitHubUtil.listRepositoriesForInstallation).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      jest.mocked(CodeRepositoryService.updateOneBy).mock
        .invocationCallOrder[0]!,
    );
  });

  test("strict retries finish failed reconnects without rewriting successful rows", async () => {
    const first: CodeRepository = retainedRepository("first");
    const second: CodeRepository = retainedRepository("second", "99");
    persisted.push(first, second);
    jest
      .mocked(CodeRepositoryService.updateOneBy)
      .mockRejectedValueOnce(new Error("temporary update failure"));

    await expect(
      CodeRepositoryService.importReposFromInstallation({
        ...request,
        strictImportErrors: true,
      }),
    ).rejects.toThrow("1 GitHub repositories could not be imported");
    expect(first.gitHubAppInstallationId).toBeUndefined();
    expect(second.gitHubAppInstallationId).toBe("123");
    await expect(
      CodeRepositoryService.importReposFromInstallation({
        ...request,
        strictImportErrors: true,
      }),
    ).resolves.toEqual({ imported: 1, skipped: 1 });

    expect(first.gitHubAppInstallationId).toBe("123");
    expect(CodeRepositoryService.updateOneBy).toHaveBeenCalledTimes(3);
    expect(CodeRepositoryService.create).not.toHaveBeenCalled();
    expect(persisted).toEqual([first, second]);
  });

  test("interactive reconnect errors stay best effort while other repositories import", async () => {
    persisted.push(retainedRepository("first"));
    jest
      .mocked(CodeRepositoryService.updateOneBy)
      .mockRejectedValueOnce(new Error("temporary update failure"));

    await expect(
      CodeRepositoryService.importReposFromInstallation(request),
    ).resolves.toEqual({ imported: 1, skipped: 1 });

    expect(CodeRepositoryService.updateOneBy).toHaveBeenCalledTimes(1);
    expect(CodeRepositoryService.create).toHaveBeenCalledTimes(1);
  });

  test("a zero-row reconnect is retryable instead of falsely reporting success", async () => {
    const repository: CodeRepository = retainedRepository("first");
    persisted.push(repository);
    jest
      .mocked(GitHubUtil.listRepositoriesForInstallation)
      .mockResolvedValue([githubRepository("first", 1)]);
    jest.mocked(CodeRepositoryService.updateOneBy).mockResolvedValueOnce(0);

    await expect(
      CodeRepositoryService.importReposFromInstallation({
        ...request,
        strictImportErrors: true,
      }),
    ).rejects.toThrow("1 GitHub repositories could not be imported");
    expect(repository.gitHubAppInstallationId).toBeUndefined();
    await expect(
      CodeRepositoryService.importReposFromInstallation({
        ...request,
        strictImportErrors: true,
      }),
    ).resolves.toEqual({ imported: 1, skipped: 0 });

    expect(CodeRepositoryService.create).not.toHaveBeenCalled();
    expect(persisted).toHaveLength(1);
  });

  test("re-add imports a deleted repository while preserving other connected rows", async () => {
    await CodeRepositoryService.importReposFromInstallation(request);
    const firstId: string = persisted[0]!.id!.toString();
    const second: CodeRepository = persisted[1]!;
    persisted = [second];
    jest.mocked(CodeRepositoryService.create).mockClear();

    await expect(
      CodeRepositoryService.importReposFromInstallation(request),
    ).resolves.toEqual({ imported: 1, skipped: 1 });

    expect(persisted[0]).toBe(second);
    expect(persisted[1]!.id!.toString()).not.toBe(firstId);
    expect(CodeRepositoryService.create).toHaveBeenCalledTimes(1);
    expect(CodeRepositoryService.updateOneBy).not.toHaveBeenCalled();
  });

  test("existing duplicate records are both reconnected without creating another row", async () => {
    const first: CodeRepository = retainedRepository("first");
    const duplicate: CodeRepository = retainedRepository("first", "99");
    duplicate.name = "Alternate configuration";
    persisted.push(first, duplicate);
    jest
      .mocked(GitHubUtil.listRepositoriesForInstallation)
      .mockResolvedValue([githubRepository("first", 1)]);

    await expect(
      CodeRepositoryService.importReposFromInstallation(request),
    ).resolves.toEqual({ imported: 1, skipped: 0 });

    expect(persisted).toHaveLength(2);
    expect(first.gitHubAppInstallationId).toBe("123");
    expect(duplicate.gitHubAppInstallationId).toBe("123");
    expect(CodeRepositoryService.updateOneBy).toHaveBeenCalledTimes(2);
    expect(CodeRepositoryService.create).not.toHaveBeenCalled();
  });
});
