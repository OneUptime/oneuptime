import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import ModelPermission from "../../../Types/Database/Permissions/Index";
import Query from "../../../Types/Database/Query";
import QueryHelper from "../../../Types/Database/QueryHelper";
import Select from "../../../Types/Database/Select";
import CallerPermission from "../../Permission/CallerPermission";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHO MAY READ A REPOSITORY'S TASKS IN CODE, AND WHO MAY ASK AI TO WORK IN IT.
 *
 * A task belongs to the repository it works in, so the repository decides:
 *
 *  - Reading a repository's tasks - its list, a task's conversation, its
 *    steps - takes read access to the repository, under the caller's own
 *    permissions: a team whose Read Code Repository is limited by labels
 *    sees only those repositories, and their tasks.
 *  - Asking AI, replying in a task and stopping one takes what changing the
 *    repository takes (its update list, its labels and team blocks, as an
 *    edit of it weighs them): a project owner or admin, a member, or a role
 *    with Edit Code Repository. Read-only members read.
 *
 * A task whose repository is gone (or never resolved - an exception fix that
 * found no repository) is read with the AI runs' own read permissions, as
 * the old Tasks page read every task; nobody can reply in it, since there is
 * no repository for the AI to work in.
 */

export const CODE_TASK_REPOSITORY_NOT_FOUND_MESSAGE: string =
  "Repository not found, or you do not have access to it.";

export const CODE_TASK_NOT_FOUND_MESSAGE: string =
  "Task not found, or you do not have access to it.";

export const CODE_TASK_ASK_REFUSED_MESSAGE: string =
  "You can read this repository's tasks. Asking AI to work in it takes permission to edit the repository - ask a Project Admin for it.";

/*
 * What the Code pages show of a repository: only columns every reader of a
 * repository may read (its GitHub App installation id is not one of them -
 * whether AI can reach the repository is worked out as root, CodeTaskGate).
 */
export const CODE_TASK_REPOSITORY_SELECT: Select<CodeRepository> = {
  _id: true,
  projectId: true,
  name: true,
  description: true,
  repositoryHostedAt: true,
  organizationName: true,
  repositoryName: true,
  mainBranchName: true,
  repositoryUrl: true,
  createdAt: true,
  isProductionReviewEnabled: true,
  isGitHubCommandsEnabled: true,
};

/*
 * How many repositories one read by id asks for: a long list goes in
 * several, so no statement grows past what Postgres binds.
 */
export const REPOSITORIES_READ_BY_ID_AT_ONCE: number = 500;

export default class CodeTaskAccess {
  // The repository, when the caller may read it; null otherwise.
  @CaptureSpan()
  public static async findReadableRepository(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    repositoryId: ObjectID;
  }): Promise<CodeRepository | null> {
    return await CodeRepositoryService.findOneBy({
      query: {
        _id: data.repositoryId.toString(),
        projectId: data.projectId,
      },
      select: CODE_TASK_REPOSITORY_SELECT,
      props: data.props,
    });
  }

  // As findReadableRepository, answering a missing one with a 404.
  public static async getReadableRepository(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    repositoryId: ObjectID;
  }): Promise<CodeRepository> {
    const repository: CodeRepository | null =
      await CodeTaskAccess.findReadableRepository(data);

    if (!repository) {
      throw new NotFoundException(CODE_TASK_REPOSITORY_NOT_FOUND_MESSAGE);
    }

    return repository;
  }

  /*
   * EVERY repository the caller may read, by name - however many the
   * project has (#10764). They used to be the first 500, and a repository
   * past them was left out of everything read from this list: a task in it
   * dropped out of Code's list across repositories and out of an insight's
   * fix card, it could not be picked, and Data Security never offered it.
   * Read a page at a time through the caller's own permissions
   * (findAllBy), in an order with no ties (the id breaks them), so no page
   * skips or repeats one.
   */
  @CaptureSpan()
  public static async listReadableRepositories(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    // Unset: what Code's pages show of a repository.
    select?: Select<CodeRepository> | undefined;
  }): Promise<Array<CodeRepository>> {
    return await CodeRepositoryService.findAllBy({
      query: {
        projectId: data.projectId,
      },
      select: data.select || CODE_TASK_REPOSITORY_SELECT,
      sort: { name: SortOrder.Ascending },
      props: data.props,
    });
  }

  /*
   * One page of the repositories the caller may read, by name: for a reader
   * that stops once it has found what it needs among them (SourceLocator)
   * rather than reading every one.
   */
  @CaptureSpan()
  public static async readReadableRepositoriesPage(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    skip: number;
    limit: number;
    select?: Select<CodeRepository> | undefined;
  }): Promise<Array<CodeRepository>> {
    return await CodeRepositoryService.findBy({
      query: {
        projectId: data.projectId,
      },
      select: data.select || CODE_TASK_REPOSITORY_SELECT,
      sort: { name: SortOrder.Ascending },
      limit: data.limit,
      skip: data.skip,
      props: data.props,
    });
  }

  /*
   * The ids of every repository the caller may read: the scope of a list
   * across repositories (Code's first page). Never a first page of them: a
   * repository's tasks are the caller's to read exactly when the repository
   * is, however many repositories there are.
   */
  @CaptureSpan()
  public static async readReadableRepositoryIds(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
  }): Promise<Array<ObjectID>> {
    const repositories: Array<CodeRepository> =
      await CodeRepositoryService.findAllBy({
        query: {
          projectId: data.projectId,
        },
        select: { _id: true },
        sort: { _id: SortOrder.Ascending },
        props: data.props,
      });

    return repositories
      .map((repository: CodeRepository): ObjectID | undefined => {
        return repository.id || undefined;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return Boolean(id);
      });
  }

  /*
   * The repositories among `repositoryIds` the caller may read, read by
   * their ids under the caller's own permissions: what a task, a page or a
   * rule holds is named this way, never looked for in a list of the
   * project's first repositories. An id of another project, of no
   * repository, or of one the caller may not read is left out. In batches
   * of REPOSITORIES_READ_BY_ID_AT_ONCE.
   */
  @CaptureSpan()
  public static async listReadableRepositoriesByIds(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    repositoryIds: Array<ObjectID | string>;
    // Unset: what Code's pages show of a repository.
    select?: Select<CodeRepository> | undefined;
  }): Promise<Array<CodeRepository>> {
    const ids: Array<ObjectID> = CodeTaskAccess.toDistinctIds(
      data.repositoryIds,
    );
    const repositories: Array<CodeRepository> = [];

    for (
      let start: number = 0;
      start < ids.length;
      start += REPOSITORIES_READ_BY_ID_AT_ONCE
    ) {
      const batch: Array<ObjectID> = ids.slice(
        start,
        start + REPOSITORIES_READ_BY_ID_AT_ONCE,
      );

      repositories.push(
        ...(await CodeRepositoryService.findBy({
          query: {
            _id: QueryHelper.any(batch),
            projectId: data.projectId,
          },
          select: data.select || CODE_TASK_REPOSITORY_SELECT,
          limit: batch.length,
          skip: 0,
          props: data.props,
        })),
      );
    }

    return repositories;
  }

  /*
   * Of `repositoryIds`, the ones the caller may ask AI to work in - as a
   * set, lower-cased: canAskInRepository's rule (the repository's update
   * list, its labels and team blocks), asked of many repositories in one
   * read per batch rather than one repository at a time. A caller who may
   * change no repository at all, or whose plan does not include them, may
   * ask in none.
   */
  @CaptureSpan()
  public static async listAskableRepositoryIds(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    repositoryIds: Array<ObjectID | string>;
  }): Promise<Set<string>> {
    const ids: Array<ObjectID> = CodeTaskAccess.toDistinctIds(
      data.repositoryIds,
    );
    const askable: Set<string> = new Set<string>();

    for (
      let start: number = 0;
      start < ids.length;
      start += REPOSITORIES_READ_BY_ID_AT_ONCE
    ) {
      const batch: Array<ObjectID> = ids.slice(
        start,
        start + REPOSITORIES_READ_BY_ID_AT_ONCE,
      );

      let permittedQuery: Query<CodeRepository>;

      try {
        permittedQuery =
          await ModelPermission.getUpdatableQuery<CodeRepository>(
            CodeRepository,
            {
              _id: QueryHelper.any(batch),
              projectId: data.projectId,
            } as Query<CodeRepository>,
            data.props,
          );
      } catch (error) {
        // canAskInRepository's refusals: no repository may be asked in.
        if (
          error instanceof NotAuthorizedException ||
          error instanceof PaymentRequiredException ||
          error instanceof NotFoundException
        ) {
          return new Set<string>();
        }

        throw error;
      }

      const permitted: Array<CodeRepository> =
        await CodeRepositoryService.findBy({
          query: permittedQuery,
          select: { _id: true },
          limit: batch.length,
          skip: 0,
          props: { isRoot: true },
        });

      for (const repository of permitted) {
        if (repository.id) {
          askable.add(repository.id.toString().toLowerCase());
        }
      }
    }

    return askable;
  }

  /*
   * Of some repositories, in their order, the ones the caller may ask AI to
   * work in (listAskableRepositoryIds): what a Fix with AI offers to choose
   * from. With every repository the caller may read in play - not the first
   * 500 (#10764) - asking canAskInRepository of each in turn would take
   * three reads a repository; this takes one a batch.
   */
  @CaptureSpan()
  public static async keepAskableRepositories<TRepository>(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    repositories: ReadonlyArray<TRepository>;
    getId: (repository: TRepository) => string;
  }): Promise<Array<TRepository>> {
    if (data.repositories.length === 0) {
      return [];
    }

    const askable: Set<string> = await CodeTaskAccess.listAskableRepositoryIds({
      props: data.props,
      projectId: data.projectId,
      repositoryIds: data.repositories.map(data.getId),
    });

    return data.repositories.filter((repository: TRepository): boolean => {
      return askable.has(data.getId(repository).toLowerCase());
    });
  }

  // Ids as ObjectIDs, each once - a value that is not an id left out.
  private static toDistinctIds(
    values: Array<ObjectID | string>,
  ): Array<ObjectID> {
    const seen: Set<string> = new Set<string>();
    const ids: Array<ObjectID> = [];

    for (const value of values) {
      const text: string = value ? value.toString().trim().toLowerCase() : "";

      if (!ObjectID.isValidUUID(text) || seen.has(text)) {
        continue;
      }

      seen.add(text);
      ids.push(new ObjectID(text));
    }

    return ids;
  }

  /*
   * Whether the caller may ask AI to work in the repository: whether they
   * may change it, the way an edit of it is weighed - the table's update
   * list and plan, then the record's labels and team blocks.
   */
  @CaptureSpan()
  public static async canAskInRepository(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    repositoryId: ObjectID;
  }): Promise<boolean> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return true;
    }

    const repository: CodeRepository | null =
      await CodeRepositoryService.findOneById({
        id: data.repositoryId,
        select: { _id: true, projectId: true, labels: { _id: true } },
        props: { isRoot: true },
      });

    if (
      !repository ||
      repository.projectId?.toString() !== data.projectId.toString()
    ) {
      return false;
    }

    try {
      await ModelPermission.checkUpdatePermissionByModel<CodeRepository>({
        modelType: CodeRepository,
        fetchModelWithAccessControlIds: async (): Promise<CodeRepository> => {
          return repository;
        },
        props: data.props,
      });

      const permittedQuery: Query<CodeRepository> =
        await ModelPermission.getUpdatableQuery<CodeRepository>(
          CodeRepository,
          {
            _id: data.repositoryId.toString(),
            projectId: data.projectId,
          } as Query<CodeRepository>,
          data.props,
        );

      const permitted: CodeRepository | null =
        await CodeRepositoryService.findOneBy({
          query: permittedQuery,
          select: { _id: true },
          props: { isRoot: true },
        });

      return Boolean(permitted);
    } catch (error) {
      /*
       * A plan below the repositories' own is a refusal too; the Code pages
       * say so in its own words (CodeTaskGate), first. A record kept from
       * the caller's edits by its labels reads as "not found" to an edit -
       * while they may still read it, as a person who may read every
       * repository but change only some does.
       */
      if (
        error instanceof NotAuthorizedException ||
        error instanceof PaymentRequiredException ||
        error instanceof NotFoundException
      ) {
        return false;
      }

      throw error;
    }
  }

  /*
   * Whether the caller may read the tasks that have no repository: those
   * read like every AI run of the project (AIRun's read list).
   */
  public static mayReadTasksWithoutRepository(
    props: DatabaseCommonInteractionProps,
  ): boolean {
    if (props.isRoot || props.isMasterAdmin) {
      return true;
    }

    return CallerPermission.holdsModelPermission(props, {
      model: new AIRun(),
      operation: "read",
    });
  }
}
