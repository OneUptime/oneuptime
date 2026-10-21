import RunbookService from "../../Services/RunbookService";
import CallerPermission from "../Permission/CallerPermission";
import PropsHoldingOnly from "../Permission/PropsHoldingOnly";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  RUNBOOK_ADVANCE_GRANULAR_PERMISSIONS,
  RUNBOOK_ADVANCE_REFUSED_MESSAGE,
  RUNBOOK_RUN_GRANULAR_PERMISSIONS,
  RUNBOOK_RUN_REFUSED_MESSAGE,
  RUNBOOK_RUN_ROLE_PERMISSIONS,
} from "../../../Types/Runbook/RunbookRunPermissions";

export interface RunbookRunRequest {
  databaseProps: DatabaseCommonInteractionProps;
  projectId: ObjectID;
  // A runbook of `projectId`: the route has read it as OneUptime and matched it.
  runbookId: ObjectID;
}

/*
 * Which runbooks a caller may run - start a run of, or move one of its runs
 * along (complete a step, skip one, cancel) - once the route has let them
 * in by the run permissions (RunbookExecutePermission) and matched the
 * runbook to their project: the runbook routes
 * (App/FeatureSet/Runbook/API/Runbook) and approving a remediation that
 * starts a runbook (Server/API/AutoRemediationAPI).
 *
 * A role runs the runbooks its grant reaches. Read with the caller's rows of
 * the run roles alone (Project Owner, Project Admin, Project Member, Runbook
 * Admin, Runbook Member - allows and blocks), so their labels and owned
 * scope, and a block on a label the runbook carries, decide, and a grant
 * that only shows runbooks (Viewer, Runbook Viewer) widens nothing. Before
 * this a Runbook Member limited to some labels ran every runbook in the
 * project.
 *
 * The granular run permissions (Create Runbook Execution, and Edit Runbook
 * Execution for moving a run along) are about runs, which carry no labels:
 * they reach every runbook of the project, as they always did.
 *
 * Like App/FeatureSet/Workflow/Utils/WorkflowRunAccess for workflows. A
 * master admin is not asked: every route lets them through.
 */
export default class RunbookRunAccess {
  public static async assertMayStart(data: RunbookRunRequest): Promise<void> {
    if (
      !(await RunbookRunAccess.reaches({
        ...data,
        granularPermissions: RUNBOOK_RUN_GRANULAR_PERMISSIONS,
      }))
    ) {
      throw new NotAuthorizedException(RUNBOOK_RUN_REFUSED_MESSAGE);
    }
  }

  public static async assertMayAdvance(data: RunbookRunRequest): Promise<void> {
    if (
      !(await RunbookRunAccess.reaches({
        ...data,
        granularPermissions: RUNBOOK_ADVANCE_GRANULAR_PERMISSIONS,
      }))
    ) {
      throw new NotAuthorizedException(RUNBOOK_ADVANCE_REFUSED_MESSAGE);
    }
  }

  private static async reaches(
    data: RunbookRunRequest & {
      granularPermissions: ReadonlyArray<Permission>;
    },
  ): Promise<boolean> {
    if (data.databaseProps.isMasterAdmin) {
      return true;
    }

    // A run role: the runbooks its own rows reach.
    if (
      RunbookRunAccess.holdsAnyOf(data, RUNBOOK_RUN_ROLE_PERMISSIONS) &&
      (await RunbookRunAccess.canRead(
        data.runbookId,
        PropsHoldingOnly.build({
          databaseProps: data.databaseProps,
          projectId: data.projectId,
          permissions: RUNBOOK_RUN_ROLE_PERMISSIONS,
        }),
      ))
    ) {
      return true;
    }

    // A granular run permission: every runbook of the project.
    return RunbookRunAccess.holdsAnyOf(data, data.granularPermissions);
  }

  private static holdsAnyOf(
    data: RunbookRunRequest,
    permissions: ReadonlyArray<Permission>,
  ): boolean {
    return CallerPermission.holdsAnyOf(data.databaseProps, permissions, {
      projectId: data.projectId,
    });
  }

  // Whether a read with `props` finds the runbook.
  private static async canRead(
    runbookId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<boolean> {
    try {
      const runbook: Runbook | null = await RunbookService.findOneById({
        id: runbookId,
        select: {
          _id: true,
        },
        props: props,
      });

      return Boolean(runbook);
    } catch (error) {
      if (error instanceof NotAuthorizedException) {
        return false;
      }

      throw error;
    }
  }
}
