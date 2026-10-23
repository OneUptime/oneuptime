import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/CodeRepository";
import ObjectID from "../../Types/ObjectID";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import CodeRepositoryType from "../../Types/CodeRepository/CodeRepositoryType";
import { CodeHost } from "../../Types/CodeRepository/CodeHost";
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
import GitHubInstallationBinding from "../Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import BadDataException from "../../Types/Exception/BadDataException";
import {
  CodeRepositoryAllowance,
  keepAllowedCodeRepositories,
} from "../../Types/CodeRepository/CodeRepositoryAllowance";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import RunnerService, { Service as RunnerServiceClass } from "./RunnerService";
import Runner from "../../Models/DatabaseModels/Runner";
import { resolveReferenceId } from "../Utils/Database/ProjectScopedReferenceRefusal";
import GlobalRunnerChoice from "../Utils/Runner/GlobalRunnerChoice";
import CodeHostAccess, {
  CODE_HOST_REPOSITORY_SELECT,
  CodeHostReader,
} from "../Utils/CodeRepository/CodeHost/CodeHostAccess";
import CodeRepositoryConnectionService from "./CodeRepositoryConnectionService";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnDelete } from "../Types/Database/Hooks";

/*
 * Why a repository may not pick an in-cluster Runner the Kubernetes agent
 * chart installed as its Runner (CodeRepository.runnerId).
 */
export const KUBERNETES_AGENT_RUNNER_FOR_CODE_MESSAGE: string =
  "This Runner is the in-cluster Runner the Kubernetes agent chart installed. It runs kubectl for its own cluster only and never works in a code repository, so a repository cannot pick it. Pick another of your Runners, or none for a global Runner.";

export interface ImportReposFromInstallationResult {
  imported: number;
  // Rows already in the project, moved onto this installation.
  reconnected: number;
  skipped: number;
}

/*
 * What a repository the GitHub App imports starts with, beyond what GitHub
 * says about it (its name, its default branch). Nothing else is set: AI may
 * open fix pull requests without a limit (maxOpenFixPullRequests empty), the
 * trigger label is "oneuptime" (gitHubTriggerLabel empty), and no build or
 * test command is set - the code agent reads how to build and test from the
 * repository itself (its AGENTS.md).
 */
export interface NewRepositoryDefaults {
  // "Respond to GitHub Commands": on.
  isGitHubCommandsEnabled: boolean;
  /*
   * "Review pull requests against production": on. A repository connected
   * from now on has its pull requests reviewed against production unless
   * someone turns it off; those connected before keep it off.
   */
  isProductionReviewEnabled: boolean;
  /*
   * The project's default Runner (Runner.isProjectDefault), when it has
   * one: a Runner of the project's own, which builds and tests a change
   * before its pull request opens. None otherwise: a global Runner takes
   * the repository's work.
   */
  runnerId: ObjectID | null;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Last line of defence for the installation-to-project binding.
   *
   * gitHubAppInstallationId is already closed to API callers at the column
   * level, but that only stops requests that go through permission checks —
   * every write here is made with `props: { isRoot: true }`, which skips them
   * entirely. This hook runs regardless of isRoot, so any route (including one
   * added later) that writes a row carrying another tenant's installation ID
   * is refused at the service boundary rather than at the token endpoint.
   *
   * The legitimate writer is importReposFromInstallation, which the install
   * callback and the installation webhooks only ever call for a project the
   * installation is already bound to — so this check passes for them.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    await Service.assertRunnerCanWorkInRepositories(createBy.data);

    const installationId: string | undefined =
      createBy.data.gitHubAppInstallationId;

    if (installationId) {
      const projectId: ObjectID | undefined =
        createBy.data.projectId || createBy.props.tenantId;

      if (!projectId) {
        throw new BadDataException(
          "A project is required to connect a GitHub App installation to a repository.",
        );
      }

      await GitHubInstallationBinding.assertInstallationBoundToProject({
        projectId: projectId,
        installationId: installationId,
      });
    }

    return { createBy, carryForward: null };
  }

  /*
   * Same rule on the update path. Clearing the installation ID is always
   * allowed — that is how the `installation.deleted` webhook tears a
   * disconnected installation out of the database.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    await Service.assertRunnerCanWorkInRepositories(updateBy.data);

    const installationId: string | undefined = updateBy.data
      .gitHubAppInstallationId as string | undefined;

    if (installationId) {
      /*
       * updateBy matches by query rather than by id, so check every row the
       * write would touch: one unbound row is enough to leak a token.
       */
      const repositories: Array<Model> = await this.findRowsAndHoldUpdateToThem(
        updateBy,
        {
          _id: true,
          projectId: true,
        },
      );

      for (const repository of repositories) {
        if (!repository.projectId) {
          throw new BadDataException(
            "A project is required to connect a GitHub App installation to a repository.",
          );
        }

        await GitHubInstallationBinding.assertInstallationBoundToProject({
          projectId: repository.projectId,
          installationId: installationId,
        });
      }
    }

    return { updateBy, carryForward: null };
  }

  /*
   * A connection (CodeRepositoryConnection) holds an access token for the
   * repositories that use it. Once the last of them is deleted, so is it:
   * a token no repository needs is not kept. The rows the delete removes
   * are read here, and the delete held to them, as the rows are gone by
   * the time onDeleteSuccess runs.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    await super.onBeforeDelete(deleteBy);

    const rows: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
        projectId: true,
        codeRepositoryConnectionId: true,
      },
    );

    const projectIds: Array<string> = Array.from(
      new Set<string>(
        rows
          .filter((row: Model): boolean => {
            return Boolean(row.codeRepositoryConnectionId && row.projectId);
          })
          .map((row: Model): string => {
            return row.projectId!.toString();
          }),
      ),
    );

    return {
      deleteBy,
      carryForward: { connectionProjectIds: projectIds },
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const projectIds: Array<string> =
      (onDelete.carryForward?.connectionProjectIds as Array<string>) || [];

    for (const projectId of projectIds) {
      try {
        await CodeRepositoryConnectionService.deleteUnusedConnections(
          new ObjectID(projectId),
        );
      } catch (error) {
        // The repositories are deleted; a connection left over is harmless.
        logger.error(
          `Could not delete project ${projectId}'s unused code repository connections:`,
        );
        logger.error(error);
      }
    }

    return onDelete;
  }

  /*
   * The Runner a write gives repositories (their Runner setting in Code) is
   * one AI can work in them on. That it is one of the repositories' own
   * project's Runners - never another project's, never a global Runner,
   * which belongs to no project - the project check in
   * super.onBeforeCreate / onBeforeUpdate has decided before this runs.
   * What is left is an in-cluster Runner the Kubernetes agent chart
   * installed: it never clones a repository, and its code-fix identity is
   * refused (CodeFixAgentAuth), so a repository that picked it would never
   * have its AI work done. Clearing the Runner (a global Runner) is always
   * allowed.
   */
  public static async assertRunnerCanWorkInRepositories(
    data: Model | Record<string, unknown> | undefined,
  ): Promise<void> {
    if (!data) {
      return;
    }

    const written: Record<string, unknown> = data as unknown as Record<
      string,
      unknown
    >;

    const runnerIds: Array<string> = Array.from(
      new Set<string>(
        [written["runnerId"], written["runner"]]
          .map((value: unknown): string => {
            const id: ObjectID | string | undefined = resolveReferenceId(value);
            return id ? id.toString().trim() : "";
          })
          .filter((id: string): boolean => {
            return Boolean(id);
          }),
      ),
    );

    for (const runnerId of runnerIds) {
      // An id that is not one was refused before the hooks (UUID checks).
      if (!ObjectID.isValidUUID(runnerId)) {
        continue;
      }

      const runner: Runner | null = await RunnerService.findOneById({
        id: new ObjectID(runnerId),
        select: {
          _id: true,
          name: true,
          hostInfo: true,
        },
        props: { isRoot: true },
      });

      if (runner && RunnerServiceClass.isKubernetesAgentRunnerRow(runner)) {
        throw new BadDataException(KUBERNETES_AGENT_RUNNER_FOR_CODE_MESSAGE);
      }
    }
  }

  /*
   * Imports all repositories accessible to a GitHub App installation into a
   * project. A repository the project already has (matched on
   * organizationName + repositoryName) is not imported again; its row is
   * moved onto this installation when it is on no installation or another
   * one, and keeps its settings. Never deletes anything.
   *
   * Connecting asks nothing, so a new repository starts with what most
   * teams want (getNewRepositoryDefaults): its main branch is GitHub's
   * default branch, GitHub commands are on, its pull requests are reviewed
   * against production, AI may open fix pull requests without a limit, and
   * AI works on the project's default Runner when the project has one -
   * otherwise it picks none, and a global Runner takes its work.
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
        repositoryHostedAt: true,
        gitHubAppInstallationId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const existingRepositoriesByKey: Map<string, Array<Model>> = new Map<
      string,
      Array<Model>
    >();

    for (const repository of existingRepositories) {
      const repositoryKey: string = `${repository.organizationName?.toLowerCase()}/${repository.repositoryName?.toLowerCase()}`;

      existingRepositoriesByKey.set(repositoryKey, [
        ...(existingRepositoriesByKey.get(repositoryKey) || []),
        repository,
      ]);
    }

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
    let reconnected: number = 0;
    let skipped: number = 0;

    // Read once, and only when there is something to import.
    let newRepositoryDefaults: NewRepositoryDefaults | null = null;

    for (const repository of installationRepositories) {
      const repositoryKey: string = `${repository.ownerLogin.toLowerCase()}/${repository.name.toLowerCase()}`;

      const sameRepositoryRows: Array<Model> | undefined =
        existingRepositoriesByKey.get(repositoryKey);

      if (sameRepositoryRows) {
        /*
         * The project already has this repository. A row on no installation
         * (the app was uninstalled, or QuarantineUnboundGitHubInstallations
         * cleared it) or on another one (the project was connected to a
         * different installation before) can mint no token, so fix tasks,
         * exception fixes and mentions all pass it by. Connecting again is
         * what puts it back on the installation.
         */
        for (const row of sameRepositoryRows) {
          if (
            !row.id ||
            row.repositoryHostedAt !== CodeRepositoryType.GitHub ||
            row.gitHubAppInstallationId === data.installationId
          ) {
            skipped++;
            continue;
          }

          try {
            await this.updateOneById({
              id: row.id,
              data: {
                gitHubAppInstallationId: data.installationId,
              },
              props: {
                isRoot: true,
              },
            });

            row.gitHubAppInstallationId = data.installationId;
            reconnected++;
          } catch (error) {
            logger.error(
              `Failed to move repository ${repository.fullName} onto GitHub App installation ${data.installationId} in project ${data.projectId.toString()}:`,
            );
            logger.error(error);
            skipped++;
          }
        }

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

      if (!newRepositoryDefaults) {
        newRepositoryDefaults = await Service.getNewRepositoryDefaults(
          data.projectId,
        );
      }

      const codeRepository: Model = new Model();
      codeRepository.projectId = data.projectId;
      codeRepository.name = displayName;
      codeRepository.repositoryHostedAt = CodeRepositoryType.GitHub;
      codeRepository.organizationName = repository.ownerLogin;
      codeRepository.repositoryName = repository.name;
      codeRepository.mainBranchName = repository.defaultBranch || "main";
      codeRepository.gitHubAppInstallationId = data.installationId;
      codeRepository.isGitHubCommandsEnabled =
        newRepositoryDefaults.isGitHubCommandsEnabled;
      codeRepository.isProductionReviewEnabled =
        newRepositoryDefaults.isProductionReviewEnabled;

      if (newRepositoryDefaults.runnerId) {
        codeRepository.runnerId = newRepositoryDefaults.runnerId;
      }

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

        existingRepositoriesByKey.set(repositoryKey, [codeRepository]);
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

    return { imported, reconnected, skipped };
  }

  /*
   * What a repository the GitHub App imports into the project starts with
   * (NewRepositoryDefaults). The project's default Runner is read through
   * GlobalRunnerChoice, the one reader of it, so a repository starts on the
   * same Runner a runbook step that picks none runs on. A default Runner
   * that cannot be read leaves the repository on a global Runner: the
   * import never fails for it.
   */
  public static async getNewRepositoryDefaults(
    projectId: ObjectID,
  ): Promise<NewRepositoryDefaults> {
    let runnerId: ObjectID | null = null;

    try {
      const defaultRunnerId: string =
        await GlobalRunnerChoice.findProjectDefaultRunnerId(projectId);

      if (defaultRunnerId && ObjectID.isValidUUID(defaultRunnerId)) {
        runnerId = new ObjectID(defaultRunnerId);
      }
    } catch (error) {
      logger.error(
        `Could not read project ${projectId.toString()}'s default Runner for its new repositories; they start on a global Runner:`,
      );
      logger.error(error);
    }

    return {
      isGitHubCommandsEnabled: true,
      isProductionReviewEnabled: true,
      runnerId,
    };
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
    /*
     * The repositories the work may be done in (CodeRepositoryAllowance):
     * the others are never candidates. Left out, every resolvable one is.
     */
    allowance?: CodeRepositoryAllowance | undefined;
  }): Promise<RepoResolution | null> {
    const resolvable: Array<ResolvableRepository> = keepAllowedCodeRepositories(
      {
        allowance: data.allowance,
        repositories: await this.getResolvableRepositories(data.projectId),
        getId: (repository: ResolvableRepository): string => {
          return repository.id;
        },
      },
    );

    if (resolvable.length === 0) {
      return null;
    }

    return resolveRepositoryForExceptionFix({
      stackTrace: data.stackTrace,
      serviceName: data.serviceName,
      repositories: resolvable,
      getTreePaths: Service.getRepositoryTreePaths,
    });
  }

  /*
   * The project's repositories a fix can be resolved to: every one AI can
   * work in (CodeHostAccess) - a GitHub repository whose installation this
   * project actually owns, or one whose connection to its Git server is the
   * project's and was not refused. Resolution probes EVERY candidate's file
   * tree, so an unbound or foreign row here would have the server read
   * another tenant's private repository on its own initiative
   * (GHSA-xx95-gmcf-7q86). A repository whose files OneUptime does not read
   * (a Git server) is still a candidate: its name, or being the only one,
   * can still pick it.
   */
  @CaptureSpan()
  public async getResolvableRepositories(
    projectId: ObjectID,
  ): Promise<Array<ResolvableRepository>> {
    const repositories: Array<Model> = await this.findBy({
      query: {
        projectId: projectId,
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

    const reachable: Set<string> =
      await CodeHostAccess.getReachableRepositoryIds({
        projectId,
        repositoryIds: repositories
          .filter((repository: Model): boolean => {
            return Boolean(repository.id);
          })
          .map((repository: Model): ObjectID => {
            return repository.id!;
          }),
      });

    return repositories
      .filter((repository: Model) => {
        return (
          Boolean(repository.id) && reachable.has(repository.id!.toString())
        );
      })
      .map((repository: Model): ResolvableRepository => {
        return {
          id: repository.id!.toString(),
          name: repository.name || "",
          organizationName: repository.organizationName || "",
          repositoryName: repository.repositoryName || "",
          mainBranchName: repository.mainBranchName || "main",
          gitHubAppInstallationId: repository.gitHubAppInstallationId || null,
          repositoryHostedAt: CodeHost.readType(repository.repositoryHostedAt),
        };
      });
  }

  /*
   * A resolvable repository's file tree, cached: GitHub's through the
   * installation (GitHubUtil), any other host's through its reader. A host
   * whose files OneUptime does not read throws, and the resolver leaves the
   * repository out of matching stack traces.
   */
  public static async getRepositoryTreePaths(
    repository: ResolvableRepository,
  ): Promise<Array<string>> {
    if (
      !repository.repositoryHostedAt ||
      repository.repositoryHostedAt === CodeRepositoryType.GitHub
    ) {
      return GitHubUtil.getRepositoryTreePaths({
        installationId: repository.gitHubAppInstallationId!,
        organizationName: repository.organizationName,
        repositoryName: repository.repositoryName,
        branchName: repository.mainBranchName,
      });
    }

    const row: Model | null = await CodeRepositoryServiceInstance.findOneById(
      {
        id: new ObjectID(repository.id),
        select: CODE_HOST_REPOSITORY_SELECT,
        props: { isRoot: true },
      },
    );

    const reader: CodeHostReader | null = row
      ? await CodeHostAccess.getReaderForRepository(row)
      : null;

    if (!reader || !reader.canReadCode) {
      throw new BadDataException(
        "OneUptime does not read this repository's files.",
      );
    }

    return await reader.getTreePaths(repository.mainBranchName);
  }
}

const CodeRepositoryServiceInstance: Service = new Service();

export default CodeRepositoryServiceInstance;
