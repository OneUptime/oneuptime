import GitHubWebhookProcessor from "../../../Server/Utils/CodeRepository/GitHub/GitHubWebhookProcessor";
import { GitHubWebhookDelivery } from "../../../Server/Utils/CodeRepository/GitHub/GitHubWebhookQueue";
import ProjectService from "../../../Server/Services/ProjectService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import Redis from "../../../Server/Infrastructure/Redis";
import Project from "../../../Models/DatabaseModels/Project";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import ObjectID from "../../../Types/ObjectID";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import GitHubUtil, {
  GitHubRepository,
} from "../../../Server/Utils/CodeRepository/GitHub/GitHub";

jest.mock("../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), updateBy: jest.fn() },
  };
});
jest.mock("../../../Server/Services/CodeRepositoryService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      importReposFromInstallation: jest.fn(),
      updateBy: jest.fn(),
      deleteBy: jest.fn(),
    },
  };
});
jest.mock("../../../Server/Utils/CodeRepository/GitHub/GitHub", () => {
  return {
    __esModule: true,
    default: {
      getInstallationSuspensionStatus: jest.fn(),
      listRepositoriesForInstallation: jest.fn(),
    },
  };
});

const projectA: ObjectID = ObjectID.generate();
const projectB: ObjectID = ObjectID.generate();
const repoA: ObjectID = ObjectID.generate();
const delivery: GitHubWebhookDelivery = {
  event: "issues",
  deliveryId: "event-1",
  payload: {
    action: "opened",
    installation: { id: 12 },
    repository: { id: 34, full_name: "acme/service" },
    sender: { login: "user", type: "User" },
    issue: { number: 5, title: "Incident", body: "Description" },
  },
};
function project(id: ObjectID): Project {
  const value: Project = new Project();
  value.id = id;
  return value;
}
function repository(id: ObjectID): CodeRepository {
  const value: CodeRepository = new CodeRepository();
  value.id = id;
  return value;
}

describe("GitHub delivery project and repository dispatch", () => {
  const client: { exists: jest.Mock; set: jest.Mock; del: jest.Mock } = {
    exists: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };
  const dispatch: jest.Mock = jest.fn();
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    client.exists.mockResolvedValue(0);
    client.set.mockResolvedValue("OK");
    client.del.mockResolvedValue(1);
    dispatch.mockResolvedValue(undefined);
    jest
      .mocked(GitHubUtil.getInstallationSuspensionStatus)
      .mockResolvedValue(false);
    jest
      .mocked(GitHubUtil.listRepositoriesForInstallation)
      .mockResolvedValue([]);
    jest
      .spyOn(Redis, "getClient")
      .mockReturnValue(client as unknown as ReturnType<typeof Redis.getClient>);
    jest.spyOn(ProjectService, "findBy").mockResolvedValue([project(projectA)]);
    jest
      .spyOn(CodeRepositoryService, "findOneBy")
      .mockResolvedValue(repository(repoA));
    jest
      .spyOn(CodeRepositoryService, "importReposFromInstallation")
      .mockResolvedValue({
        imported: 1,
        skipped: 0,
        repositories: [],
      } as never);
    jest.spyOn(CodeRepositoryService, "deleteBy").mockResolvedValue(1);
    jest.spyOn(CodeRepositoryService, "updateBy").mockResolvedValue(1);
    jest.spyOn(ProjectService, "updateBy").mockResolvedValue(1);
  });
  afterAll(() => {
    jest.restoreAllMocks();
  });

  test("resolves only authoritative project bindings, then a connected GitHub repository", async () => {
    await GitHubWebhookProcessor.process(delivery, dispatch);
    expect(ProjectService.findBy).toHaveBeenCalledWith(
      expect.objectContaining({ query: { gitHubAppInstallationId: "12" } }),
    );
    expect(CodeRepositoryService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          projectId: projectA,
          gitHubAppInstallationId: "12",
          repositoryHostedAt: CodeRepositoryType.GitHub,
          organizationName: new Wildcard("acme"),
          repositoryName: new Wildcard("service"),
        },
      }),
    );
    expect(dispatch).toHaveBeenCalledWith({
      projectId: projectA,
      envelope: expect.objectContaining({
        event: "issues",
        installationId: "12",
        repository: "acme/service",
        codeRepositoryId: repoA.toString(),
        issueNumber: 5,
      }),
    });
  });
  test("repository capitalization changes use exact case-insensitive names with literal underscores", async () => {
    await GitHubWebhookProcessor.process(
      {
        ...delivery,
        payload: {
          ...delivery.payload,
          repository: { id: 34, full_name: "Acme_Org/Payments_Service" },
        },
      },
      dispatch,
    );
    const query: Parameters<
      typeof CodeRepositoryService.findOneBy
    >[0]["query"] = jest.mocked(CodeRepositoryService.findOneBy).mock
      .calls[0]![0].query;
    expect(query.organizationName).toBeInstanceOf(Wildcard);
    expect(query.repositoryName).toBeInstanceOf(Wildcard);
    expect((query.organizationName as Wildcard<string>).toPatterns()).toEqual([
      "Acme\\_Org",
    ]);
    expect((query.repositoryName as Wildcard<string>).toPatterns()).toEqual([
      "Payments\\_Service",
    ]);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
  test("unbound installations cannot nominate projects through repository rows", async () => {
    jest.mocked(ProjectService.findBy).mockResolvedValue([]);
    await GitHubWebhookProcessor.process(delivery, dispatch);
    expect(CodeRepositoryService.findOneBy).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
  test("removed, foreign, or unconnected repository cannot trigger workflows", async () => {
    jest.mocked(CodeRepositoryService.findOneBy).mockResolvedValue(null);
    await GitHubWebhookProcessor.process(delivery, dispatch);
    expect(dispatch).not.toHaveBeenCalled();
  });
  test("fanout continues other projects but fails delivery for retry", async () => {
    jest
      .mocked(ProjectService.findBy)
      .mockResolvedValue([project(projectA), project(projectB)]);
    dispatch
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(undefined);
    await expect(
      GitHubWebhookProcessor.process(delivery, dispatch),
    ).rejects.toThrow("every linked project");
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[1]![0].projectId).toEqual(projectB);
  });
  test("suspended installations cannot trigger workflows", async () => {
    client.exists.mockResolvedValue(1);
    await GitHubWebhookProcessor.process(delivery, dispatch);
    expect(dispatch).not.toHaveBeenCalled();
    expect(ProjectService.findBy).not.toHaveBeenCalled();
  });
  test("missing delivery storage fails closed", async () => {
    jest.mocked(Redis.getClient).mockReturnValue(null);
    await expect(
      GitHubWebhookProcessor.process(delivery, dispatch),
    ).rejects.toThrow("unavailable");
    expect(dispatch).not.toHaveBeenCalled();
  });
  test.each(["created", "new_permissions_accepted", "unsuspend"])(
    "%s imports repositories only into bound projects",
    async (action: string) => {
      await GitHubWebhookProcessor.process(
        {
          ...delivery,
          event: "installation",
          payload: { action, installation: { id: 12 } },
        },
        dispatch,
      );
      expect(
        CodeRepositoryService.importReposFromInstallation,
      ).toHaveBeenCalledWith({
        projectId: projectA,
        installationId: "12",
        strictImportErrors: true,
      });
      expect(dispatch).not.toHaveBeenCalled();
      if (action === "unsuspend") {
        expect(client.del).toHaveBeenCalledWith(
          "github-installation-suspended:12",
        );
      }
    },
  );
  test("installation import failures remain retryable", async () => {
    jest
      .mocked(CodeRepositoryService.importReposFromInstallation)
      .mockRejectedValueOnce(new Error("GitHub unavailable"));
    await expect(
      GitHubWebhookProcessor.process(
        {
          ...delivery,
          event: "installation",
          payload: { action: "created", installation: { id: 12 } },
        },
        dispatch,
      ),
    ).rejects.toThrow("GitHub unavailable");
  });
  test("uninstall removes repository credentials before project binding", async () => {
    await GitHubWebhookProcessor.process(
      {
        ...delivery,
        event: "installation",
        payload: { action: "deleted", installation: { id: 12 } },
      },
      dispatch,
    );
    expect(CodeRepositoryService.updateBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { gitHubAppInstallationId: "12" },
        data: { gitHubAppInstallationId: null },
      }),
    );
    expect(ProjectService.updateBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { gitHubAppInstallationId: "12" },
        data: { gitHubAppInstallationId: null },
      }),
    );
    expect(
      jest.mocked(CodeRepositoryService.updateBy).mock.invocationCallOrder[0],
    ).toBeLessThan(
      jest.mocked(ProjectService.updateBy).mock.invocationCallOrder[0]!,
    );
  });
  test("failed repository cleanup preserves binding for retry", async () => {
    jest
      .mocked(CodeRepositoryService.updateBy)
      .mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      GitHubWebhookProcessor.process(
        {
          ...delivery,
          event: "installation",
          payload: { action: "deleted", installation: { id: 12 } },
        },
        dispatch,
      ),
    ).rejects.toThrow("database unavailable");
    expect(ProjectService.updateBy).not.toHaveBeenCalled();
  });
  test("suspend records installation suspension", async () => {
    jest
      .mocked(GitHubUtil.getInstallationSuspensionStatus)
      .mockResolvedValue(true);
    await GitHubWebhookProcessor.process(
      {
        ...delivery,
        event: "installation",
        payload: { action: "suspend", installation: { id: 12 } },
      },
      dispatch,
    );
    expect(client.set).toHaveBeenCalledWith(
      "github-installation-suspended:12",
      "1",
    );
    expect(dispatch).not.toHaveBeenCalled();
  });
  test("an old suspend delivery cannot pause an installation that is currently active", async () => {
    await GitHubWebhookProcessor.process(
      {
        ...delivery,
        event: "installation",
        payload: {
          action: "suspend",
          installation: { id: 12, suspended_at: "old" },
        },
      },
      dispatch,
    );
    expect(GitHubUtil.getInstallationSuspensionStatus).toHaveBeenCalledWith(
      "12",
    );
    expect(client.set).not.toHaveBeenCalled();
    expect(client.del).toHaveBeenCalledWith("github-installation-suspended:12");
    expect(
      CodeRepositoryService.importReposFromInstallation,
    ).toHaveBeenCalledWith({
      projectId: projectA,
      installationId: "12",
      strictImportErrors: true,
    });
  });
  test("an unsuspend retry cannot undo a newer suspension", async () => {
    const unsuspend: GitHubWebhookDelivery = {
      ...delivery,
      event: "installation",
      payload: { action: "unsuspend", installation: { id: 12 } },
    };
    jest
      .mocked(CodeRepositoryService.importReposFromInstallation)
      .mockRejectedValueOnce(new Error("temporary import failure"));
    await expect(
      GitHubWebhookProcessor.process(unsuspend, dispatch),
    ).rejects.toThrow("temporary import failure");
    client.del.mockClear();
    jest
      .mocked(GitHubUtil.getInstallationSuspensionStatus)
      .mockResolvedValue(true);
    await GitHubWebhookProcessor.process(unsuspend, dispatch);
    expect(client.del).not.toHaveBeenCalled();
    expect(client.set).toHaveBeenCalledWith(
      "github-installation-suspended:12",
      "1",
    );
    expect(
      CodeRepositoryService.importReposFromInstallation,
    ).toHaveBeenCalledTimes(1);
  });
  test("a stale suspension delivery for a deleted installation changes no state", async () => {
    jest
      .mocked(GitHubUtil.getInstallationSuspensionStatus)
      .mockResolvedValue(null);
    await GitHubWebhookProcessor.process(
      {
        ...delivery,
        event: "installation",
        payload: { action: "suspend", installation: { id: 12 } },
      },
      dispatch,
    );
    expect(client.set).not.toHaveBeenCalled();
    expect(client.del).not.toHaveBeenCalled();
    expect(
      CodeRepositoryService.importReposFromInstallation,
    ).not.toHaveBeenCalled();
  });
  test("status lookup failure preserves cached state and retries the delivery", async () => {
    jest
      .mocked(GitHubUtil.getInstallationSuspensionStatus)
      .mockRejectedValue(new Error("GitHub unavailable"));
    await expect(
      GitHubWebhookProcessor.process(
        {
          ...delivery,
          event: "installation",
          payload: { action: "unsuspend", installation: { id: 12 } },
        },
        dispatch,
      ),
    ).rejects.toThrow("GitHub unavailable");
    expect(client.set).not.toHaveBeenCalled();
    expect(client.del).not.toHaveBeenCalled();
    expect(
      CodeRepositoryService.importReposFromInstallation,
    ).not.toHaveBeenCalled();
  });
  test("repository removal is installation-scoped and additions are imported", async () => {
    await GitHubWebhookProcessor.process(
      {
        ...delivery,
        event: "installation_repositories",
        payload: {
          action: "removed",
          installation: { id: 12 },
          repositories_removed: [{ full_name: "acme/old" }],
          repositories_added: [{ full_name: "acme/new" }],
        },
      },
      dispatch,
    );
    expect(CodeRepositoryService.updateBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          gitHubAppInstallationId: "12",
          repositoryHostedAt: CodeRepositoryType.GitHub,
          organizationName: new Wildcard("acme"),
          repositoryName: new Wildcard("old"),
        },
        data: { gitHubAppInstallationId: null },
      }),
    );
    expect(
      CodeRepositoryService.importReposFromInstallation,
    ).toHaveBeenCalledTimes(1);
    expect(CodeRepositoryService.deleteBy).not.toHaveBeenCalled();
  });
  test.each([
    "acme/*",
    "acme/serv?ce",
    "acme/%",
    "acme/..",
    "../service",
    "acme/service/other",
    "invalid",
    42,
    null,
  ])(
    "malformed removed repository %p cannot expand the disconnection scope",
    async (fullName: unknown) => {
      await GitHubWebhookProcessor.process(
        {
          ...delivery,
          event: "installation_repositories",
          payload: {
            action: "removed",
            installation: { id: 12 },
            repositories_removed: [{ full_name: fullName }] as never,
          },
        },
        dispatch,
      );
      expect(CodeRepositoryService.updateBy).not.toHaveBeenCalled();
      expect(CodeRepositoryService.deleteBy).not.toHaveBeenCalled();
    },
  );
  test("failed repository removal does not acknowledge a completed delivery", async () => {
    jest
      .mocked(CodeRepositoryService.updateBy)
      .mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      GitHubWebhookProcessor.process(
        {
          ...delivery,
          event: "installation_repositories",
          payload: {
            action: "removed",
            installation: { id: 12 },
            repositories_removed: [{ full_name: "acme/old" }],
          },
        },
        dispatch,
      ),
    ).rejects.toThrow("database unavailable");
  });

  test("a stale removal preserves repositories that currently belong to the installation", async () => {
    jest
      .mocked(GitHubUtil.listRepositoriesForInstallation)
      .mockResolvedValue([
        { fullName: "ACME/Readded" } as GitHubRepository,
        { fullName: "acme/unrelated" } as GitHubRepository,
      ]);
    await GitHubWebhookProcessor.process(
      {
        ...delivery,
        event: "installation_repositories",
        payload: {
          action: "removed",
          installation: { id: 12 },
          repositories_removed: [
            { full_name: "acme/readded" },
            { full_name: "acme/old" },
          ],
        },
      },
      dispatch,
    );
    expect(GitHubUtil.listRepositoriesForInstallation).toHaveBeenCalledTimes(1);
    expect(GitHubUtil.listRepositoriesForInstallation).toHaveBeenCalledWith(
      "12",
    );
    expect(CodeRepositoryService.updateBy).toHaveBeenCalledTimes(1);
    expect(CodeRepositoryService.updateBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          gitHubAppInstallationId: "12",
          repositoryHostedAt: CodeRepositoryType.GitHub,
          organizationName: new Wildcard("acme"),
          repositoryName: new Wildcard("old"),
        },
        data: { gitHubAppInstallationId: null },
      }),
    );
  });

  test("unbound removal deliveries neither look up installation repositories nor disconnect records", async () => {
    jest.mocked(ProjectService.findBy).mockResolvedValue([]);
    await GitHubWebhookProcessor.process(
      {
        ...delivery,
        event: "installation_repositories",
        payload: {
          action: "removed",
          installation: { id: 12 },
          repositories_removed: [{ full_name: "acme/old" }],
        },
      },
      dispatch,
    );
    expect(GitHubUtil.listRepositoriesForInstallation).not.toHaveBeenCalled();
    expect(CodeRepositoryService.updateBy).not.toHaveBeenCalled();
  });

  test("a repository membership lookup failure preserves records and retries the removal", async () => {
    const removal: GitHubWebhookDelivery = {
      ...delivery,
      event: "installation_repositories",
      payload: {
        action: "removed",
        installation: { id: 12 },
        repositories_removed: [{ full_name: "acme/old" }],
      },
    };
    jest
      .mocked(GitHubUtil.listRepositoriesForInstallation)
      .mockRejectedValueOnce(new Error("GitHub unavailable"));
    await expect(
      GitHubWebhookProcessor.process(removal, dispatch),
    ).rejects.toThrow("GitHub unavailable");
    expect(CodeRepositoryService.updateBy).not.toHaveBeenCalled();
    await GitHubWebhookProcessor.process(removal, dispatch);
    expect(CodeRepositoryService.updateBy).toHaveBeenCalledTimes(1);
  });

  test("a removal retry preserves a repository re-added after a database failure", async () => {
    const removal: GitHubWebhookDelivery = {
      ...delivery,
      event: "installation_repositories",
      payload: {
        action: "removed",
        installation: { id: 12 },
        repositories_removed: [{ full_name: "acme/old" }],
      },
    };
    jest
      .mocked(CodeRepositoryService.updateBy)
      .mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      GitHubWebhookProcessor.process(removal, dispatch),
    ).rejects.toThrow("database unavailable");
    jest.mocked(CodeRepositoryService.updateBy).mockClear();
    jest
      .mocked(GitHubUtil.listRepositoriesForInstallation)
      .mockResolvedValue([{ fullName: "acme/old" } as GitHubRepository]);
    await GitHubWebhookProcessor.process(removal, dispatch);
    expect(CodeRepositoryService.updateBy).not.toHaveBeenCalled();
  });
});
