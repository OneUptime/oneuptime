import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/CodeRepository";
import ObjectID from "../../Types/ObjectID";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import QueryHelper from "../Types/Database/QueryHelper";
import CodeRepositoryType from "../../Types/CodeRepository/CodeRepositoryType";
import { CodeHost } from "../../Types/CodeRepository/CodeHost";
import URL from "../../Types/API/URL";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import WriteOnlyCredentialChanges from "../Utils/AuditLog/WriteOnlyCredentialChanges";
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
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import RunnerService, { Service as RunnerServiceClass } from "./RunnerService";
import Runner from "../../Models/DatabaseModels/Runner";
import { resolveReferenceId } from "../Utils/Database/ProjectScopedReferenceRefusal";
import CodeHostAccess, {
  CODE_HOST_REPOSITORY_SELECT,
  CodeHostReader,
} from "../Utils/CodeRepository/CodeHost/CodeHostAccess";
import CodeRepositoryConnectionService from "./CodeRepositoryConnectionService";
import DeleteBy from "../Types/Database/DeleteBy";

// What a repository a fix may be resolved to is read with.
const RESOLVABLE_REPOSITORY_SELECT: {
  _id: true;
  name: true;
  organizationName: true;
  repositoryName: true;
  mainBranchName: true;
  gitHubAppInstallationId: true;
  repositoryHostedAt: true;
} = {
  _id: true,
  name: true,
  organizationName: true,
  repositoryName: true,
  mainBranchName: true,
  gitHubAppInstallationId: true,
  repositoryHostedAt: true,
};

/*
 * How many repositories one read by id names: a long allowance goes in
 * several reads, so no statement grows past what Postgres binds.
 */
export const RESOLVABLE_REPOSITORIES_READ_BY_ID_AT_ONCE: number = 500;

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
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A create hands back the row it saved, with the webhook secret on it as
   * it was stored: encrypted. BaseAPI serializes the row whole into the
   * answer of POST /code-repository, without a column read check, and a
   * workflow step's create returns it to the workflow's logs - a ciphertext
   * of a secret nobody may read back (read: []). So it is taken off first.
   */
  @CaptureSpan()
  public override async create(createBy: CreateBy<Model>): Promise<Model> {
    const created: Model = await super.create(createBy);

    /*
     * Cleared rather than deleted, as BaseAPI.createItem clears a model's
     * `_id`: an unset column holds undefined, which serializes as nothing.
     */
    (created as unknown as Record<string, unknown>)["secretToken"] = undefined;

    return created;
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

    /*
     * The webhook secret is write-only: a change to it is recorded in the
     * audit log as changed, never with its value (WriteOnlyCredentialChanges).
     */
    WriteOnlyCredentialChanges.recordInAuditLog(updateBy, ["secretToken"]);

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
   * it picks no Runner: AI works in it on the project's default Runner
   * while the project has one, and on a global Runner while it has none
   * (Types/Runner/CodeRepositoryRunner) - following the default, so making
   * another Runner the default moves it too.
   */
  @CaptureSpan()
  public async importReposFromInstallation(data: {
    projectId: ObjectID;
    installationId: string;
  }): Promise<ImportReposFromInstallationResult> {
    const installationRepositories: Array<GitHubRepository> =
      await GitHubUtil.listRepositoriesForInstallation(data.installationId);

    /*
     * Every repository the project has, once, so duplicates are skipped and
     * display names de-duped - a page at a time, in an order with no ties
     * (#11076). The first 10,000 in no order were read: in a project with
     * more, a repository past them was imported a second time.
     */
    const existingRepositories: Array<Model> = await this.findAllBy({
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
      sort: { _id: SortOrder.Ascending },
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

    const newRepositoryDefaults: NewRepositoryDefaults =
      Service.getNewRepositoryDefaults();

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
   * (NewRepositoryDefaults). It picks no Runner of its own: where AI works
   * in it is left to the project - its default Runner, the same one a
   * runbook step that picks none runs on, and a global Runner while it has
   * none - and follows the project when its default changes
   * (Types/Runner/CodeRepositoryRunner). It used to start on a copy of the
   * default Runner, which a later default did not move.
   */
  public static getNewRepositoryDefaults(): NewRepositoryDefaults {
    return {
      isGitHubCommandsEnabled: true,
      isProductionReviewEnabled: true,
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
    /*
     * An allowance that names its repositories - a person's pick, the ones
     * a rule allows - is read by those ids alone, however many the project
     * has (#11076).
     */
    const resolvable: Array<ResolvableRepository> = keepAllowedCodeRepositories(
      {
        allowance: data.allowance,
        repositories: await this.getResolvableRepositories(data.projectId, {
          repositoryIds:
            data.allowance && !data.allowance.isEveryRepository
              ? data.allowance.repositoryIds
              : undefined,
        }),
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
   * (a Git server other than Azure DevOps) is still a candidate: its name,
   * or being the only one, can still pick it.
   *
   * Every one of them, however many the project has (#11076): read a page
   * at a time in an order with no ties (the id), or - `repositoryIds` -
   * only those, by their ids. The first 10,000 in no order were read, so in
   * a project with more, which ones a fix could be resolved to was chance:
   * a repository a person picked past them was never found to work in.
   */
  @CaptureSpan()
  public async getResolvableRepositories(
    projectId: ObjectID,
    options?: {
      // Only these (in any letter case), read by their ids. Unset: every one.
      repositoryIds?: Array<string> | undefined;
    },
  ): Promise<Array<ResolvableRepository>> {
    const repositories: Array<Model> = options?.repositoryIds
      ? await this.findResolvableCandidatesByIds({
          projectId,
          repositoryIds: options.repositoryIds,
        })
      : await this.findAllBy({
          query: {
            projectId: projectId,
          },
          select: RESOLVABLE_REPOSITORY_SELECT,
          sort: { _id: SortOrder.Ascending },
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

  // The project's repositories among these ids, in batches, by id.
  private async findResolvableCandidatesByIds(data: {
    projectId: ObjectID;
    repositoryIds: Array<string>;
  }): Promise<Array<Model>> {
    const ids: Array<string> = Array.from(
      new Set<string>(
        data.repositoryIds
          .map((id: string): string => {
            return (id || "").toString().trim().toLowerCase();
          })
          .filter((id: string): boolean => {
            return ObjectID.isValidUUID(id);
          }),
      ),
    ).sort();

    const repositories: Array<Model> = [];

    for (
      let start: number = 0;
      start < ids.length;
      start += RESOLVABLE_REPOSITORIES_READ_BY_ID_AT_ONCE
    ) {
      const batch: Array<string> = ids.slice(
        start,
        start + RESOLVABLE_REPOSITORIES_READ_BY_ID_AT_ONCE,
      );

      repositories.push(
        ...(await this.findBy({
          query: {
            projectId: data.projectId,
            _id: QueryHelper.any(batch),
          },
          select: RESOLVABLE_REPOSITORY_SELECT,
          sort: { _id: SortOrder.Ascending },
          limit: batch.length,
          skip: 0,
          props: {
            isRoot: true,
          },
        })),
      );
    }

    return repositories;
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

    const row: Model | null = await CodeRepositoryServiceInstance.findOneById({
      id: new ObjectID(repository.id),
      select: CODE_HOST_REPOSITORY_SELECT,
      props: { isRoot: true },
    });

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

  /*
   * One file's text on a resolvable repository's main branch, as its tree
   * is read above: GitHub's through the installation, any other host's
   * through its reader. Null when the file is not there; a host whose
   * files OneUptime does not read throws. What reads a repository's code
   * owners file (#10374) reads it this way.
   */
  public static async getRepositoryFileText(
    repository: ResolvableRepository,
    filePath: string,
  ): Promise<string | null> {
    if (
      !repository.repositoryHostedAt ||
      repository.repositoryHostedAt === CodeRepositoryType.GitHub
    ) {
      const file: { content: string } | null = await GitHubUtil.getFileContent({
        installationId: repository.gitHubAppInstallationId!,
        organizationName: repository.organizationName,
        repositoryName: repository.repositoryName,
        branchName: repository.mainBranchName,
        filePath,
      });

      return file ? file.content : null;
    }

    const row: Model | null = await CodeRepositoryServiceInstance.findOneById({
      id: new ObjectID(repository.id),
      select: CODE_HOST_REPOSITORY_SELECT,
      props: { isRoot: true },
    });

    const reader: CodeHostReader | null = row
      ? await CodeHostAccess.getReaderForRepository(row)
      : null;

    if (!reader || !reader.canReadCode) {
      throw new BadDataException(
        "OneUptime does not read this repository's files.",
      );
    }

    const file: { content: string } | null = await reader.getFileContent({
      filePath,
      branchName: repository.mainBranchName,
    });

    return file ? file.content : null;
  }
}

const CodeRepositoryServiceInstance: Service = new Service();

export default CodeRepositoryServiceInstance;
