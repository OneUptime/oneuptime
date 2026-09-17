import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import GitHubInstallationBinding from "../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import GitHubUtil from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import ObjectID from "../../../Types/ObjectID";
import { RepoResolution } from "../../../Server/Utils/CodeRepository/StackTraceRepoResolver";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * GHSA-xx95-gmcf-7q86, downstream guard.
 *
 * resolveRepositoryForException runs server-side, as root, and probes the file
 * tree of EVERY candidate repository in a project to work out which one an
 * exception came from. A row carrying an installation its project does not own
 * would therefore have OneUptime read another tenant's private repository on
 * its own initiative — no attacker request needed at the time it happens.
 *
 * The write boundary is closed and the quarantine migration clears rows that
 * predate it, so on a healthy database nothing is filtered here. It stays
 * because a database exploited before the fix would otherwise keep leaking.
 */

describe("resolveRepositoryForException only considers bound installations", () => {
  let projectId: ObjectID;
  let boundRepositoryId: ObjectID;
  let unboundRepositoryId: ObjectID;
  let treePathsSpy: jest.SpyInstance;

  beforeEach(() => {
    projectId = ObjectID.generate();
    boundRepositoryId = ObjectID.generate();
    unboundRepositoryId = ObjectID.generate();

    treePathsSpy = jest.spyOn(GitHubUtil, "getRepositoryTreePaths");
    treePathsSpy.mockResolvedValue(["src/app.ts"]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function repository(data: {
    id: ObjectID;
    installationId: string;
  }): CodeRepository {
    const codeRepository: CodeRepository = new CodeRepository();
    codeRepository.id = data.id;
    codeRepository.projectId = projectId;
    codeRepository.name = "service";
    codeRepository.organizationName = "org";
    codeRepository.repositoryName = `repo-${data.id.toString()}`;
    codeRepository.mainBranchName = "main";
    codeRepository.repositoryHostedAt = CodeRepositoryType.GitHub;
    codeRepository.gitHubAppInstallationId = data.installationId;
    return codeRepository;
  }

  function mockRepositories(repositories: Array<CodeRepository>): void {
    const findBySpy: jest.SpyInstance = jest.spyOn(
      CodeRepositoryService,
      "findBy",
    );
    findBySpy.mockResolvedValue(repositories);
  }

  // Only "11111111" genuinely belongs to this project.
  function mockBinding(): void {
    jest
      .spyOn(GitHubInstallationBinding, "getBoundInstallationId")
      .mockResolvedValue("11111111");
  }

  test("never fetches the tree of a repository whose installation is unbound", async () => {
    mockRepositories([
      repository({ id: unboundRepositoryId, installationId: "99999999" }),
    ]);
    mockBinding();

    await CodeRepositoryService.resolveRepositoryForException({
      projectId: projectId,
      stackTrace: "at /src/app.ts:10:5",
      serviceName: "api",
    });

    expect(treePathsSpy).not.toHaveBeenCalled();
  });

  test("returns null when every candidate is unbound", async () => {
    mockRepositories([
      repository({ id: unboundRepositoryId, installationId: "99999999" }),
    ]);
    mockBinding();

    const resolution: RepoResolution | null =
      await CodeRepositoryService.resolveRepositoryForException({
        projectId: projectId,
        stackTrace: "at /src/app.ts:10:5",
        serviceName: "api",
      });

    expect(resolution).toBeNull();
  });

  test("still resolves against a repository whose installation is bound", async () => {
    mockRepositories([
      repository({ id: boundRepositoryId, installationId: "11111111" }),
    ]);
    mockBinding();

    const resolution: RepoResolution | null =
      await CodeRepositoryService.resolveRepositoryForException({
        projectId: projectId,
        stackTrace: "at /src/app.ts:10:5",
        serviceName: "api",
      });

    expect(resolution).not.toBeNull();
  });

  /*
   * The dangerous shape: one legitimate row plus one planted row. Resolution
   * fans out across every candidate, so the planted one must be dropped
   * without the legitimate one being disturbed.
   */
  test("drops only the unbound row when both are present", async () => {
    mockRepositories([
      repository({ id: boundRepositoryId, installationId: "11111111" }),
      repository({ id: unboundRepositoryId, installationId: "99999999" }),
    ]);
    mockBinding();

    await CodeRepositoryService.resolveRepositoryForException({
      projectId: projectId,
      stackTrace: "at /src/app.ts:10:5",
      serviceName: "api",
    });

    const probedInstallationIds: Array<string> = treePathsSpy.mock.calls.map(
      (call: Array<unknown>) => {
        return (call[0] as { installationId: string }).installationId;
      },
    );

    expect(probedInstallationIds).not.toContain("99999999");
  });
});
