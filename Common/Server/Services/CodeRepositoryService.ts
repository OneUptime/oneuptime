import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/CodeRepository";
import ObjectID from "../../Types/ObjectID";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import CodeRepositoryType from "../../Types/CodeRepository/CodeRepositoryType";
import URL from "../../Types/API/URL";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import {
  RepoResolution,
  ResolvableRepository,
  resolveRepositoryForExceptionFix,
} from "../Utils/CodeRepository/StackTraceRepoResolver";
import GitHubUtil, {
  GitHubRepository,
} from "../Utils/CodeRepository/GitHub/GitHub";

export interface ImportReposFromInstallationResult {
  imported: number;
  skipped: number;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Imports all repositories accessible to a GitHub App installation into a
   * project. Repositories that already exist for the project (matched on
   * organizationName + repositoryName) are skipped. Never deletes anything.
   */
  @CaptureSpan()
  public async importReposFromInstallation(data: {
    projectId: ObjectID;
    installationId: string;
  }): Promise<ImportReposFromInstallationResult> {
    const installationRepositories: Array<GitHubRepository> =
      await GitHubUtil.listRepositoriesForInstallation(data.installationId);

    // Fetch existing repositories once so we can skip duplicates and de-dupe display names.
    const existingRepositories: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
      },
      select: {
        _id: true,
        name: true,
        organizationName: true,
        repositoryName: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const existingRepositoryKeys: Set<string> = new Set<string>(
      existingRepositories.map((repository: Model) => {
        return `${repository.organizationName?.toLowerCase()}/${repository.repositoryName?.toLowerCase()}`;
      }),
    );

    const existingDisplayNames: Set<string> = new Set<string>(
      existingRepositories
        .map((repository: Model) => {
          return repository.name?.toLowerCase() || "";
        })
        .filter((name: string) => {
          return Boolean(name);
        }),
    );

    let imported: number = 0;
    let skipped: number = 0;

    for (const repository of installationRepositories) {
      const repositoryKey: string = `${repository.ownerLogin.toLowerCase()}/${repository.name.toLowerCase()}`;

      if (existingRepositoryKeys.has(repositoryKey)) {
        skipped++;
        continue;
      }

      /*
       * Display name is unique per project. If a repository with the same
       * name exists (e.g. same repo name in a different org), fall back to
       * the org-qualified name, then a numeric suffix.
       */
      let displayName: string = repository.name;

      if (existingDisplayNames.has(displayName.toLowerCase())) {
        displayName = repository.fullName;
      }

      let suffix: number = 2;

      while (existingDisplayNames.has(displayName.toLowerCase())) {
        displayName = `${repository.fullName} (${suffix})`;
        suffix++;
      }

      const codeRepository: Model = new Model();
      codeRepository.projectId = data.projectId;
      codeRepository.name = displayName;
      codeRepository.repositoryHostedAt = CodeRepositoryType.GitHub;
      codeRepository.organizationName = repository.ownerLogin;
      codeRepository.repositoryName = repository.name;
      codeRepository.mainBranchName = repository.defaultBranch || "main";
      codeRepository.gitHubAppInstallationId = data.installationId;

      if (repository.htmlUrl) {
        codeRepository.repositoryUrl = URL.fromString(repository.htmlUrl);
      }

      if (repository.description) {
        codeRepository.description = repository.description;
      }

      try {
        await this.create({
          data: codeRepository,
          props: {
            isRoot: true,
          },
        });

        existingRepositoryKeys.add(repositoryKey);
        existingDisplayNames.add(displayName.toLowerCase());
        imported++;
      } catch (error) {
        // One bad repository should not abort the whole import.
        logger.error(
          `Failed to import repository ${repository.fullName} from GitHub App installation ${data.installationId} into project ${data.projectId.toString()}:`,
        );
        logger.error(error);
        skipped++;
      }
    }

    return { imported, skipped };
  }

  /*
   * Resolve which of the project's repositories an exception's code lives
   * in, AT RUNTIME — stack-trace path matching over cached git trees, with
   * exact-name-match and only-repository fallbacks. This replaces the old
   * manual ServiceCodeRepository mapping table.
   */
  @CaptureSpan()
  public async resolveRepositoryForException(data: {
    projectId: ObjectID;
    stackTrace: string | null;
    serviceName: string | null;
  }): Promise<RepoResolution | null> {
    const repositories: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
      },
      select: {
        _id: true,
        name: true,
        organizationName: true,
        repositoryName: true,
        mainBranchName: true,
        gitHubAppInstallationId: true,
        repositoryHostedAt: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    // Only GitHub-App-connected repos can be cloned/pushed by the agent.
    const resolvable: Array<ResolvableRepository> = repositories
      .filter((repository: Model) => {
        return (
          repository.repositoryHostedAt === CodeRepositoryType.GitHub &&
          Boolean(repository.gitHubAppInstallationId) &&
          Boolean(repository.id)
        );
      })
      .map((repository: Model) => {
        return {
          id: repository.id!.toString(),
          name: repository.name || "",
          organizationName: repository.organizationName || "",
          repositoryName: repository.repositoryName || "",
          mainBranchName: repository.mainBranchName || "main",
          gitHubAppInstallationId: repository.gitHubAppInstallationId || null,
        };
      });

    if (resolvable.length === 0) {
      return null;
    }

    return resolveRepositoryForExceptionFix({
      stackTrace: data.stackTrace,
      serviceName: data.serviceName,
      repositories: resolvable,
      getTreePaths: (
        repository: ResolvableRepository,
      ): Promise<Array<string>> => {
        return GitHubUtil.getRepositoryTreePaths({
          installationId: repository.gitHubAppInstallationId!,
          organizationName: repository.organizationName,
          repositoryName: repository.repositoryName,
          branchName: repository.mainBranchName,
        });
      },
    });
  }
}

export default new Service();
