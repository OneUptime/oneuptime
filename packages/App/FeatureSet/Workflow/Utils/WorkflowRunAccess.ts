import CommonAPI from "Common/Server/API/CommonAPI";
import WorkflowService from "Common/Server/Services/WorkflowService";
import CallerPermission from "Common/Server/Utils/Permission/CallerPermission";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import PropsHoldingOnly from "Common/Server/Utils/Permission/PropsHoldingOnly";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import {
  WORKFLOW_EDIT_PERMISSIONS,
  WORKFLOW_RUN_ONLY_PERMISSIONS,
  WORKFLOW_RUN_PERMISSIONS,
  WORKFLOW_RUN_WILDCARD,
  WORKFLOW_RUN_REFUSED_MESSAGE,
  WORKFLOW_STEP_RUN_REFUSED_MESSAGE,
} from "Common/Types/Workflow/WorkflowRunPermissions";

export interface WorkflowRunRequest {
  databaseProps: DatabaseCommonInteractionProps;
  projectId: ObjectID;
  workflowId: ObjectID;
}

/*
 * Who may start a run of a workflow from the dashboard - the whole workflow
 * (ManualAPI) or one step of it (RunStepAPI) - asked once, here, for both.
 *
 * Both routes first prove the caller is a signed-in member of the project
 * they name (CommonAPI.assertAuthenticatedProjectMember). Then:
 *
 *   1. the permission, before anything is read: Run Workflow takes one of
 *      WORKFLOW_RUN_PERMISSIONS (the workflow's editors and Workflow
 *      Members), a step on its own one of WORKFLOW_EDIT_PERMISSIONS (its
 *      editors) - each read by the rule every check follows
 *      (CallerPermission), so a team's block is no grant and a block with no
 *      labels refuses;
 *   2. the workflow's project, read as OneUptime and matched to the one the
 *      caller named: a workflow of another project and one that does not
 *      exist are refused alike, so the route tells nobody which ids exist,
 *      and nothing below ever reads another project's row;
 *   3. the workflow itself, against the grant that lets the caller run it -
 *      its labels and owned scope, and the blocks on it:
 *        - an editor runs the workflows they may change (the update scope,
 *          DatabaseService.findOneUpdatableById);
 *        - a Workflow Member runs the workflows their Workflow Member grant
 *          reaches, read with that grant alone, so a grant that only shows
 *          workflows (Viewer, say) widens nothing.
 *      Running one step on its own takes the first.
 *
 * A master admin skips the permission and the grant, as every route lets
 * them, but not the project: the workflow must belong to the project they
 * are acting in.
 */
export default class WorkflowRunAccess {
  public static async assertMayRunWorkflow(
    data: WorkflowRunRequest,
  ): Promise<void> {
    WorkflowRunAccess.assertHoldsAnyOf(
      data,
      WORKFLOW_RUN_PERMISSIONS,
      WORKFLOW_RUN_REFUSED_MESSAGE,
    );

    await WorkflowRunAccess.assertInProject(data);

    if (data.databaseProps.isMasterAdmin) {
      return;
    }

    if (
      WorkflowRunAccess.holdsAnyOf(data, WORKFLOW_EDIT_PERMISSIONS) &&
      (await WorkflowRunAccess.mayChange(data))
    ) {
      return;
    }

    if (
      WorkflowRunAccess.holdsAnyOf(data, WORKFLOW_RUN_ONLY_PERMISSIONS) &&
      (await WorkflowRunAccess.reachesWithOnly(
        data,
        WORKFLOW_RUN_ONLY_PERMISSIONS,
      ))
    ) {
      return;
    }

    throw new NotAuthorizedException(WORKFLOW_RUN_REFUSED_MESSAGE);
  }

  public static async assertMayRunStep(
    data: WorkflowRunRequest,
  ): Promise<void> {
    WorkflowRunAccess.assertHoldsAnyOf(
      data,
      WORKFLOW_EDIT_PERMISSIONS,
      WORKFLOW_STEP_RUN_REFUSED_MESSAGE,
    );

    await WorkflowRunAccess.assertInProject(data);

    if (data.databaseProps.isMasterAdmin) {
      return;
    }

    if (!(await WorkflowRunAccess.mayChange(data))) {
      throw new NotAuthorizedException(WORKFLOW_STEP_RUN_REFUSED_MESSAGE);
    }
  }

  /*
   * The workflow's own project must be the one the caller named. Read as
   * OneUptime, and only its project: the reads below are the caller's, and
   * the update check names a row's labels when it refuses, so they only
   * ever see a row of the caller's own project.
   */
  private static async assertInProject(
    data: WorkflowRunRequest,
  ): Promise<void> {
    const owner: Workflow | null = await WorkflowService.findOneById({
      id: data.workflowId,
      select: {
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    CommonAPI.assertResourceBelongsToProject({
      resourceProjectId: owner?.projectId,
      projectId: data.projectId,
    });
  }

  /*
   * Whether the caller may change the workflow: the update scope of their
   * edit grants - labels, owned scope, and a block on a label the workflow
   * carries, which the update check refuses outright.
   */
  private static async mayChange(data: WorkflowRunRequest): Promise<boolean> {
    try {
      const updatable: Workflow | null =
        await WorkflowService.findOneUpdatableById({
          id: data.workflowId,
          select: {
            _id: true,
          },
          props: data.databaseProps,
        });

      return Boolean(updatable);
    } catch (error) {
      if (error instanceof NotAuthorizedException) {
        return false;
      }

      throw error;
    }
  }

  /*
   * Whether the caller's grants of `permissions` alone reach the workflow:
   * a read with only those rows of theirs, allows and blocks alike, so
   * their labels, owned scope and blocks decide and no other grant widens
   * it.
   */
  private static async reachesWithOnly(
    data: WorkflowRunRequest,
    permissions: ReadonlyArray<Permission>,
  ): Promise<boolean> {
    try {
      const reached: Workflow | null = await WorkflowService.findOneById({
        id: data.workflowId,
        select: {
          _id: true,
        },
        props: WorkflowRunAccess.propsHoldingOnly(data, permissions),
      });

      return Boolean(reached);
    } catch (error) {
      if (error instanceof NotAuthorizedException) {
        return false;
      }

      throw error;
    }
  }

  /*
   * The caller's props holding only their rows of `permissions` in the
   * project - read the way the CRUD path reads them, allows and blocks
   * alike - and none of their global permissions (the CRUD path adds back
   * the ones every caller holds). Who the caller is - user, project, teams
   * - is kept, so labels and owned scope still apply.
   */
  public static propsHoldingOnly(
    data: WorkflowRunRequest,
    permissions: ReadonlyArray<Permission>,
  ): DatabaseCommonInteractionProps {
    return PropsHoldingOnly.build({
      databaseProps: data.databaseProps,
      projectId: data.projectId,
      permissions: permissions,
    });
  }

  private static holdsAnyOf(
    data: WorkflowRunRequest,
    permissions: ReadonlyArray<Permission>,
  ): boolean {
    return CallerPermission.holdsAnyOf(data.databaseProps, permissions, {
      projectId: data.projectId,
      wildcard: WORKFLOW_RUN_WILDCARD,
    });
  }

  private static assertHoldsAnyOf(
    data: WorkflowRunRequest,
    permissions: ReadonlyArray<Permission>,
    refusedMessage: string,
  ): void {
    // Master admins bypass permission checks, as they do in requirePermission.
    if (data.databaseProps.isMasterAdmin) {
      return;
    }

    if (!WorkflowRunAccess.holdsAnyOf(data, permissions)) {
      throw new NotAuthorizedException(refusedMessage);
    }
  }
}
