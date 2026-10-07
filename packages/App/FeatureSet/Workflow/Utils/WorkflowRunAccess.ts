import CommonAPI from "Common/Server/API/CommonAPI";
import WorkflowService from "Common/Server/Services/WorkflowService";
import CallerPermission from "Common/Server/Utils/Permission/CallerPermission";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import {
  WORKFLOW_EDIT_PERMISSIONS,
  WORKFLOW_RUN_PERMISSIONS,
  WORKFLOW_RUN_WILDCARD,
  WORKFLOW_RUN_REFUSED_MESSAGE,
  WORKFLOW_STEP_RUN_REFUSED_MESSAGE,
} from "Common/Types/Workflow/WorkflowRunPermissions";

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
 *   2. the workflow itself, in the caller's project. A run reads it with
 *      the caller's own permissions: a workflow they cannot see - their
 *      labels or owned scope leave it out, or it is another project's, or
 *      it does not exist - is refused alike, so the route tells nobody
 *      which ids exist. A step reads it the way an update would
 *      (DatabaseService.findOneUpdatableById): one they may not change is
 *      refused.
 *
 * A master admin skips the permission, as every route lets them, but not
 * the project: the workflow must belong to the project they are acting in.
 */
export default class WorkflowRunAccess {
  public static async assertMayRunWorkflow(data: {
    databaseProps: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    workflowId: ObjectID;
  }): Promise<void> {
    WorkflowRunAccess.assertHoldsAnyOf({
      databaseProps: data.databaseProps,
      projectId: data.projectId,
      permissions: WORKFLOW_RUN_PERMISSIONS,
      refusedMessage: WORKFLOW_RUN_REFUSED_MESSAGE,
    });

    const workflow: Workflow | null = await WorkflowService.findOneById({
      id: data.workflowId,
      select: {
        _id: true,
        projectId: true,
      },
      props: data.databaseProps,
    });

    CommonAPI.assertResourceBelongsToProject({
      resourceProjectId: workflow?.projectId,
      projectId: data.projectId,
    });
  }

  public static async assertMayRunStep(data: {
    databaseProps: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    workflowId: ObjectID;
  }): Promise<void> {
    WorkflowRunAccess.assertHoldsAnyOf({
      databaseProps: data.databaseProps,
      projectId: data.projectId,
      permissions: WORKFLOW_EDIT_PERMISSIONS,
      refusedMessage: WORKFLOW_STEP_RUN_REFUSED_MESSAGE,
    });

    /*
     * The project first, read as OneUptime and matched to the caller's: the
     * update check below reads a row's labels before it narrows to a
     * project, and its refusal names them.
     */
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

    const updatable: Workflow | null =
      await WorkflowService.findOneUpdatableById({
        id: data.workflowId,
        select: {
          _id: true,
        },
        props: data.databaseProps,
      });

    if (!updatable) {
      throw new NotAuthorizedException(WORKFLOW_STEP_RUN_REFUSED_MESSAGE);
    }
  }

  private static assertHoldsAnyOf(data: {
    databaseProps: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    permissions: ReadonlyArray<Permission>;
    refusedMessage: string;
  }): void {
    // Master admins bypass permission checks, as they do in requirePermission.
    if (data.databaseProps.isMasterAdmin) {
      return;
    }

    if (
      !CallerPermission.holdsAnyOf(data.databaseProps, data.permissions, {
        projectId: data.projectId,
        wildcard: WORKFLOW_RUN_WILDCARD,
      })
    ) {
      throw new NotAuthorizedException(data.refusedMessage);
    }
  }
}
