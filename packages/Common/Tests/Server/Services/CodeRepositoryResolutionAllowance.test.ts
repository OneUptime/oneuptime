import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import GitHubInstallationBinding from "../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import GitHubUtil from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import {
  CodeRepositoryAllowance,
  EVERY_CODE_REPOSITORY,
  NO_CODE_REPOSITORY,
} from "../../../Types/CodeRepository/CodeRepositoryAllowance";
import ObjectID from "../../../Types/ObjectID";
import { RepoResolution } from "../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A pull request the auto remediation rules opened is opened in one of the
 * repositories they name (CodeFixTaskContext.allowedCodeRepositoryIds): the
 * repository a run resolves to - from a stack trace, a service's name, or
 * being the only one - is picked among those alone, and the others' trees
 * are never read. With no allowance, or every repository, nothing changes.
 */

describe("resolveRepositoryForException among the repositories the rules allow", () => {
  const PROJECT_ID: ObjectID = new ObjectID(
    "11111111-1111-4111-8111-111111111111",
  );
  const CHECKOUT_ID: ObjectID = new ObjectID(
    "c1111111-1111-4111-8111-111111111111",
  );
  const BILLING_ID: ObjectID = new ObjectID(
    "c2222222-2222-4222-8222-222222222222",
  );

  let treePaths: SpyInstance<typeof GitHubUtil.getRepositoryTreePaths>;

  function repository(id: ObjectID, name: string): CodeRepository {
    const codeRepository: CodeRepository = new CodeRepository();
    codeRepository.id = id;
    codeRepository.projectId = PROJECT_ID;
    codeRepository.name = name;
    codeRepository.organizationName = "acme";
    codeRepository.repositoryName = name;
    codeRepository.mainBranchName = "main";
    codeRepository.repositoryHostedAt = CodeRepositoryType.GitHub;
    codeRepository.gitHubAppInstallationId = "11111111";
    return codeRepository;
  }

  async function resolve(data: {
    allowance?: CodeRepositoryAllowance | undefined;
    stackTrace?: string | null;
    serviceName?: string | null;
  }): Promise<RepoResolution | null> {
    return await CodeRepositoryService.resolveRepositoryForException({
      projectId: PROJECT_ID,
      stackTrace: data.stackTrace ?? null,
      serviceName: data.serviceName ?? null,
      ...(data.allowance ? { allowance: data.allowance } : {}),
    });
  }

  function treesRead(): Array<string> {
    return treePaths.mock.calls.map(
      (call: Parameters<typeof GitHubUtil.getRepositoryTreePaths>): string => {
        return call[0].repositoryName;
      },
    );
  }

  beforeEach(() => {
    jest
      .spyOn(CodeRepositoryService, "findBy")
      .mockResolvedValue([
        repository(CHECKOUT_ID, "checkout"),
        repository(BILLING_ID, "billing"),
      ] as never);
    jest
      .spyOn(GitHubInstallationBinding, "getBoundInstallationId")
      .mockResolvedValue("11111111");
    treePaths = jest
      .spyOn(GitHubUtil, "getRepositoryTreePaths")
      .mockResolvedValue(["src/app.ts"]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the one repository allowed is the only candidate: the run resolves to it", async () => {
    const resolution: RepoResolution | null = await resolve({
      allowance: {
        isEveryRepository: false,
        repositoryIds: [BILLING_ID.toString()],
      },
    });

    expect(resolution?.codeRepositoryId).toBe(BILLING_ID.toString());
  });

  test("a stack trace both repositories could hold is matched in the allowed one alone, and the other's tree is never read", async () => {
    const resolution: RepoResolution | null = await resolve({
      allowance: {
        isEveryRepository: false,
        repositoryIds: [CHECKOUT_ID.toString()],
      },
      stackTrace: "    at handler (/app/src/app.ts:10:5)",
    });

    expect(resolution?.codeRepositoryId).toBe(CHECKOUT_ID.toString());
    expect(treesRead()).not.toContain("billing");
  });

  test("a service named like a repository the rules leave out does not pull the run there", async () => {
    const resolution: RepoResolution | null = await resolve({
      allowance: {
        isEveryRepository: false,
        repositoryIds: [CHECKOUT_ID.toString()],
      },
      serviceName: "billing",
    });

    expect(resolution?.codeRepositoryId).not.toBe(BILLING_ID.toString());
  });

  test("none allowed: nothing resolves, and no tree is read", async () => {
    expect(await resolve({ allowance: NO_CODE_REPOSITORY })).toBeNull();
    expect(
      await resolve({
        allowance: NO_CODE_REPOSITORY,
        stackTrace: "    at handler (/app/src/app.ts:10:5)",
      }),
    ).toBeNull();
    expect(treePaths).not.toHaveBeenCalled();
  });

  test("every repository, or no allowance, keeps both candidates: a run with nothing to go on picks neither", async () => {
    expect(await resolve({ allowance: EVERY_CODE_REPOSITORY })).toBeNull();
    expect(await resolve({})).toBeNull();

    // A service named like one of them still finds it.
    expect(
      (
        await resolve({
          allowance: EVERY_CODE_REPOSITORY,
          serviceName: "billing",
        })
      )?.codeRepositoryId,
    ).toBe(BILLING_ID.toString());
  });
});
