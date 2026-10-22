import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import ModelPermission from "../../../Types/Database/Permissions/Index";
import Query from "../../../Types/Database/Query";
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
  "You can read this repository's tasks. Asking AI to work in it takes permission to edit the repository - ask a project admin for it.";

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

// At most this many repositories are listed on Code's first page.
export const MAX_LISTED_REPOSITORIES: number = 500;

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
   * The repositories the caller may read, by name. Code's first page filters
   * them as the person types, so they come in one read.
   */
  @CaptureSpan()
  public static async listReadableRepositories(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
  }): Promise<Array<CodeRepository>> {
    return await CodeRepositoryService.findBy({
      query: {
        projectId: data.projectId,
      },
      select: CODE_TASK_REPOSITORY_SELECT,
      sort: { name: SortOrder.Ascending },
      limit: MAX_LISTED_REPOSITORIES,
      skip: 0,
      props: data.props,
    });
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
