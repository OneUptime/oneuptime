import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/CodeRepository";
import ObjectID from "../../Types/ObjectID";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import CodeRepositoryType from "../../Types/CodeRepository/CodeRepositoryType";
import URL from "../../Types/API/URL";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
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
}

export default new Service();
