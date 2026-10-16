import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import GitHubUtil, {
  GitHubRepository,
} from "../../../Server/Utils/CodeRepository/GitHub/GitHub";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Connecting a GitHub App installation imports its repositories into the
 * project, and must also put the project's rows for those repositories back
 * on it.
 *
 * A row loses its installation when the app is uninstalled (the
 * installation.deleted webhook clears it) or when the
 * QuarantineUnboundGitHubInstallations migration found it unbound. Such a
 * row can mint no token, so fix tasks, exception fixes and mentions all pass
 * it by. Reconnecting used to skip every repository the project already had,
 * so those rows stayed unusable after the very step meant to repair them.
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
    description: null,
    defaultBranch: "main",
    ownerLogin: "acme",
  };
}

function existingRow(data: {
  name: string;
  installationId?: string | undefined;
  hostedAt?: CodeRepositoryType | undefined;
  organizationName?: string | undefined;
}): CodeRepository {
  const row: CodeRepository = new CodeRepository();
  row._id = ObjectID.generate().toString();
  row.name = data.name;
  row.organizationName = data.organizationName || "acme";
  row.repositoryName = data.name;
  row.repositoryHostedAt = data.hostedAt || CodeRepositoryType.GitHub;

  if (data.installationId) {
    row.gitHubAppInstallationId = data.installationId;
  }

  return row;
}

describe("CodeRepositoryService.importReposFromInstallation, reconnecting", () => {
  let projectId: ObjectID;
  let updateSpy: jest.SpyInstance;
  let createSpy: jest.SpyInstance;

  beforeEach(() => {
    projectId = ObjectID.generate();

    updateSpy = jest
      .spyOn(CodeRepositoryService, "updateOneById")
      .mockResolvedValue(undefined as never);

    createSpy = jest
      .spyOn(CodeRepositoryService, "create")
      .mockImplementation(async (data: { data: CodeRepository }) => {
        return data.data;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function given(data: {
    installation: Array<GitHubRepository>;
    rows: Array<CodeRepository>;
  }): void {
    jest
      .spyOn(GitHubUtil, "listRepositoriesForInstallation")
      .mockResolvedValue(data.installation);

    jest.spyOn(CodeRepositoryService, "findBy").mockResolvedValue(data.rows);
  }

  function updatedRows(): Array<{ id: string; installationId: string }> {
    return updateSpy.mock.calls.map((call: Array<unknown>) => {
      const args: {
        id: ObjectID;
        data: { gitHubAppInstallationId: string };
      } = call[0] as {
        id: ObjectID;
        data: { gitHubAppInstallationId: string };
      };

      return {
        id: args.id.toString(),
        installationId: args.data.gitHubAppInstallationId,
      };
    });
  }

  test("puts a row an uninstall cleared back on the installation", async () => {
    const cleared: CodeRepository = existingRow({ name: "checkout" });

    given({ installation: [githubRepository("checkout")], rows: [cleared] });

    await expect(
      CodeRepositoryService.importReposFromInstallation({
        projectId: projectId,
        installationId: INSTALLATION_ID,
      }),
    ).resolves.toEqual({ imported: 0, reconnected: 1, skipped: 0 });

    expect(updatedRows()).toEqual([
      { id: cleared.id!.toString(), installationId: INSTALLATION_ID },
    ]);
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("moves a row from the installation the project had before", async () => {
    const previous: CodeRepository = existingRow({
      name: "checkout",
      installationId: "1111",
    });

    given({ installation: [githubRepository("checkout")], rows: [previous] });

    await expect(
      CodeRepositoryService.importReposFromInstallation({
        projectId: projectId,
        installationId: INSTALLATION_ID,
      }),
    ).resolves.toEqual({ imported: 0, reconnected: 1, skipped: 0 });

    expect(updatedRows()).toEqual([
      { id: previous.id!.toString(), installationId: INSTALLATION_ID },
    ]);
  });

  test("leaves a row already on the installation alone", async () => {
    given({
      installation: [githubRepository("checkout")],
      rows: [
        existingRow({ name: "checkout", installationId: INSTALLATION_ID }),
      ],
    });

    await expect(
      CodeRepositoryService.importReposFromInstallation({
        projectId: projectId,
        installationId: INSTALLATION_ID,
      }),
    ).resolves.toEqual({ imported: 0, reconnected: 0, skipped: 1 });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("matches the repository whatever its case, as the import always has", async () => {
    const cleared: CodeRepository = existingRow({
      name: "Checkout",
      organizationName: "ACME",
    });

    given({ installation: [githubRepository("checkout")], rows: [cleared] });

    await CodeRepositoryService.importReposFromInstallation({
      projectId: projectId,
      installationId: INSTALLATION_ID,
    });

    expect(updatedRows()).toEqual([
      { id: cleared.id!.toString(), installationId: INSTALLATION_ID },
    ]);
  });

  test("never moves a row that is not a GitHub repository", async () => {
    given({
      installation: [githubRepository("checkout")],
      rows: [
        existingRow({
          name: "checkout",
          hostedAt: "GitLab" as CodeRepositoryType,
        }),
      ],
    });

    await expect(
      CodeRepositoryService.importReposFromInstallation({
        projectId: projectId,
        installationId: INSTALLATION_ID,
      }),
    ).resolves.toEqual({ imported: 0, reconnected: 0, skipped: 1 });

    expect(updateSpy).not.toHaveBeenCalled();
  });

  test("never touches a row for a repository the installation does not hold", async () => {
    given({
      installation: [githubRepository("checkout")],
      rows: [existingRow({ name: "billing" })],
    });

    await expect(
      CodeRepositoryService.importReposFromInstallation({
        projectId: projectId,
        installationId: INSTALLATION_ID,
      }),
    ).resolves.toEqual({ imported: 1, reconnected: 0, skipped: 0 });

    expect(updateSpy).not.toHaveBeenCalled();
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  test("moves every duplicate row of the repository, not just one", async () => {
    const first: CodeRepository = existingRow({ name: "checkout" });
    const second: CodeRepository = existingRow({ name: "checkout" });

    given({
      installation: [githubRepository("checkout")],
      rows: [first, second],
    });

    await expect(
      CodeRepositoryService.importReposFromInstallation({
        projectId: projectId,
        installationId: INSTALLATION_ID,
      }),
    ).resolves.toEqual({ imported: 0, reconnected: 2, skipped: 0 });

    expect(
      updatedRows()
        .map((row: { id: string }) => {
          return row.id;
        })
        .sort(),
    ).toEqual([first.id!.toString(), second.id!.toString()].sort());
  });

  test("one row that cannot be moved does not stop the rest", async () => {
    const failing: CodeRepository = existingRow({ name: "checkout" });
    const fine: CodeRepository = existingRow({ name: "billing" });

    updateSpy.mockImplementation(async (data: { id: ObjectID }) => {
      if (data.id.toString() === failing.id!.toString()) {
        throw new Error("write failed");
      }
    });

    given({
      installation: [githubRepository("checkout"), githubRepository("billing")],
      rows: [failing, fine],
    });

    await expect(
      CodeRepositoryService.importReposFromInstallation({
        projectId: projectId,
        installationId: INSTALLATION_ID,
      }),
    ).resolves.toEqual({ imported: 0, reconnected: 1, skipped: 1 });
  });
});
