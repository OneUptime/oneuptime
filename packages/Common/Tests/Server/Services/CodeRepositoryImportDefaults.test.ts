import CodeRepositoryService, {
  NewRepositoryDefaults,
  Service as CodeRepositoryServiceClass,
} from "../../../Server/Services/CodeRepositoryService";
import GitHubUtil, {
  GitHubRepository,
} from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import GlobalRunnerChoice from "../../../Server/Utils/Runner/GlobalRunnerChoice";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Connecting GitHub asks nothing: installing the GitHub App imports every
 * repository of the installation, so what a new repository starts with is
 * what most teams want, picked for them (NewRepositoryDefaults):
 *
 *   - "Respond to GitHub Commands" on - people with write access can mention
 *     the app straight away;
 *   - the project's default Runner when it has one - a Runner of its own
 *     builds and tests a change before the pull request opens - and none
 *     otherwise, so a global Runner takes the work;
 *   - nothing else: no limit on AI's fix pull requests, the "oneuptime"
 *     trigger label, no build or test command (the agent reads the
 *     repository's AGENTS.md).
 *
 * Repositories the project already has keep every setting they hold:
 * reconnecting moves them onto the installation and nothing more.
 */

jest.mock("../../../Server/Utils/Logger");

const INSTALLATION_ID: string = "172006714";

function githubRepository(name: string): GitHubRepository {
  return {
    id: name.length,
    name: name,
    fullName: `acme/${name}`,
    private: true,
    htmlUrl: `https://github.com/acme/${name}`,
    description: `The ${name} service.`,
    defaultBranch: name === "legacy" ? "master" : "main",
    ownerLogin: "acme",
  };
}

describe("a repository the GitHub App imports starts with what most teams want", () => {
  let projectId: ObjectID;
  let createSpy: jest.SpyInstance;
  let updateSpy: jest.SpyInstance;
  let defaultRunnerSpy: jest.SpyInstance;

  beforeEach(() => {
    projectId = ObjectID.generate();

    createSpy = jest
      .spyOn(CodeRepositoryService, "create")
      .mockImplementation(async (data: { data: CodeRepository }) => {
        return data.data;
      });

    updateSpy = jest
      .spyOn(CodeRepositoryService, "updateOneById")
      .mockResolvedValue(undefined as never);

    defaultRunnerSpy = jest
      .spyOn(GlobalRunnerChoice, "findProjectDefaultRunnerId")
      .mockResolvedValue("");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function given(data: {
    installation: Array<GitHubRepository>;
    rows?: Array<CodeRepository>;
  }): void {
    jest
      .spyOn(GitHubUtil, "listRepositoriesForInstallation")
      .mockResolvedValue(data.installation);

    jest
      .spyOn(CodeRepositoryService, "findBy")
      .mockResolvedValue(data.rows || []);
  }

  function created(): Array<CodeRepository> {
    return createSpy.mock.calls.map((call: Array<unknown>): CodeRepository => {
      return (call[0] as { data: CodeRepository }).data;
    });
  }

  test("GitHub commands on, its GitHub default branch, nothing else set", async () => {
    given({
      installation: [githubRepository("checkout"), githubRepository("legacy")],
    });

    await expect(
      CodeRepositoryService.importReposFromInstallation({
        projectId,
        installationId: INSTALLATION_ID,
      }),
    ).resolves.toEqual({ imported: 2, reconnected: 0, skipped: 0 });

    const [checkout, legacy] = created();

    for (const repository of [checkout!, legacy!]) {
      expect(repository.isGitHubCommandsEnabled).toBe(true);
      expect(repository.projectId?.toString()).toBe(projectId.toString());
      expect(repository.repositoryHostedAt).toBe(CodeRepositoryType.GitHub);
      expect(repository.gitHubAppInstallationId).toBe(INSTALLATION_ID);
      // No Runner of the project's own picked: a global Runner works in it.
      expect(repository.runnerId).toBeUndefined();
      // No limit on AI's pull requests, the default trigger label.
      expect(repository.maxOpenFixPullRequests).toBeUndefined();
      expect(repository.gitHubTriggerLabel).toBeUndefined();
      // No build or test command: the agent reads the repository's AGENTS.md.
      expect(repository.setupCommand).toBeUndefined();
      expect(repository.buildCommand).toBeUndefined();
      expect(repository.testCommand).toBeUndefined();
    }

    expect(checkout!.mainBranchName).toBe("main");
    expect(legacy!.mainBranchName).toBe("master");
    expect(checkout!.description).toBe("The checkout service.");
  });

  test("a project with a default Runner: new repositories start on it", async () => {
    const defaultRunnerId: ObjectID = ObjectID.generate();
    defaultRunnerSpy.mockResolvedValue(defaultRunnerId.toString());

    given({
      installation: [githubRepository("checkout"), githubRepository("web")],
    });

    await CodeRepositoryService.importReposFromInstallation({
      projectId,
      installationId: INSTALLATION_ID,
    });

    expect(
      created().map((repository: CodeRepository): string => {
        return repository.runnerId?.toString() || "";
      }),
    ).toEqual([defaultRunnerId.toString(), defaultRunnerId.toString()]);

    // Read once for the whole import, for the project being imported into.
    expect(defaultRunnerSpy).toHaveBeenCalledTimes(1);
    expect(defaultRunnerSpy.mock.calls[0]![0]!.toString()).toBe(
      projectId.toString(),
    );
  });

  test("a default Runner that cannot be read leaves the repository on a global Runner - the import goes on", async () => {
    defaultRunnerSpy.mockRejectedValue(new Error("database unavailable"));

    given({ installation: [githubRepository("checkout")] });

    await expect(
      CodeRepositoryService.importReposFromInstallation({
        projectId,
        installationId: INSTALLATION_ID,
      }),
    ).resolves.toEqual({ imported: 1, reconnected: 0, skipped: 0 });

    expect(created()[0]!.runnerId).toBeUndefined();
    expect(created()[0]!.isGitHubCommandsEnabled).toBe(true);
  });

  test("nothing to import: the project's default Runner is not even read", async () => {
    given({
      installation: [githubRepository("checkout")],
      rows: [
        (() => {
          const row: CodeRepository = new CodeRepository();
          row._id = ObjectID.generate().toString();
          row.name = "checkout";
          row.organizationName = "acme";
          row.repositoryName = "checkout";
          row.repositoryHostedAt = CodeRepositoryType.GitHub;
          row.gitHubAppInstallationId = INSTALLATION_ID;
          return row;
        })(),
      ],
    });

    await CodeRepositoryService.importReposFromInstallation({
      projectId,
      installationId: INSTALLATION_ID,
    });

    expect(defaultRunnerSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("a repository the project already has keeps its own settings: reconnecting writes the installation alone", async () => {
    const existing: CodeRepository = new CodeRepository();
    existing._id = ObjectID.generate().toString();
    existing.name = "checkout";
    existing.organizationName = "acme";
    existing.repositoryName = "checkout";
    existing.repositoryHostedAt = CodeRepositoryType.GitHub;

    defaultRunnerSpy.mockResolvedValue(ObjectID.generate().toString());
    given({ installation: [githubRepository("checkout")], rows: [existing] });

    await CodeRepositoryService.importReposFromInstallation({
      projectId,
      installationId: INSTALLATION_ID,
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(
      (updateSpy.mock.calls[0]![0] as { data: Record<string, unknown> }).data,
    ).toEqual({ gitHubAppInstallationId: INSTALLATION_ID });
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe("getNewRepositoryDefaults", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("commands on, and the project's default Runner as an id", async () => {
    const runnerId: string = ObjectID.generate().toString();
    jest
      .spyOn(GlobalRunnerChoice, "findProjectDefaultRunnerId")
      .mockResolvedValue(runnerId);

    const defaults: NewRepositoryDefaults =
      await CodeRepositoryServiceClass.getNewRepositoryDefaults(
        ObjectID.generate(),
      );

    expect(defaults.isGitHubCommandsEnabled).toBe(true);
    expect(defaults.runnerId?.toString()).toBe(runnerId);
  });

  test("no default Runner, or an id that is not one: no Runner", async () => {
    const spy: jest.SpyInstance = jest
      .spyOn(GlobalRunnerChoice, "findProjectDefaultRunnerId")
      .mockResolvedValue("");

    expect(
      (
        await CodeRepositoryServiceClass.getNewRepositoryDefaults(
          ObjectID.generate(),
        )
      ).runnerId,
    ).toBeNull();

    spy.mockResolvedValue("not-a-runner-id");

    expect(
      (
        await CodeRepositoryServiceClass.getNewRepositoryDefaults(
          ObjectID.generate(),
        )
      ).runnerId,
    ).toBeNull();
  });
});
