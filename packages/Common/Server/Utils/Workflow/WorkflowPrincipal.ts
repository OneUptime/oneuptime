import CallerPlan from "../Billing/CallerPlan";
import UserPermissionUtil from "../UserPermission/UserPermission";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";

/*
 * WHAT A WORKFLOW STEP MAY DO: WHAT A PROJECT ADMIN MAY DO, AND NO MORE.
 *
 * Every step that reads or writes a project's records - Find, Create,
 * Update and Delete One and Many, and the model-event triggers that read the
 * record a workflow started on - used to act as OneUptime itself (root),
 * with only the project stamped on: past every table, column and plan
 * check. A workflow could set what only a project owner may (who owns the
 * project, its billing), create what the project's plan does not sell, and
 * mint the Owner role for a team - so anyone allowed to edit a workflow could
 * do anything at all in the project, and more than its plan allows.
 *
 * Now a step acts with these props, built here and nowhere else:
 *
 *  - in its own project only (the tenant), as every API request does;
 *  - with the permissions of a Project Admin: the role every table that a
 *    project's people manage lists, and which the owner-only and billing
 *    permissions (ProjectOwner, ManageProjectBilling, DeleteProject...) are
 *    deliberately kept from - so what a Project Admin may not do, a step is
 *    refused, by the same table, column, label and block checks a person
 *    meets;
 *  - on the project's plan (CallerPlan): what the plan does not sell is
 *    refused, as it is to a person, and an unpaid subscription is unpaid;
 *  - as no person (UserType.Workflow, no userId): a record a workflow creates
 *    names no creator (UserAttribution), a person's own settings stay theirs
 *    (OwnerOnlyColumn), and the audit trail names the workflow instead
 *    (workflowId, workflowName).
 *
 * The run itself - finding the workflow, its variables, writing its run log
 * - is OneUptime's own bookkeeping and stays as it was.
 */

export interface WorkflowPrincipalOptions {
  // The project the workflow belongs to and runs in.
  projectId: ObjectID;
  workflowId: ObjectID;
  // For the audit trail only.
  workflowName?: string | undefined;
}

export default class WorkflowPrincipal {
  // The one role a step holds in its project.
  public static readonly PERMISSION: Permission = Permission.ProjectAdmin;

  /*
   * The fixed global half every principal carries: Public, User and
   * CurrentUser like a signed-in person, and AuthenticatedRequest like an API
   * key - no person, but signed in (see APIKeyAccessPermission for why that
   * marker matters on File).
   */
  public static getGlobalAccessPermission(
    projectId: ObjectID,
  ): UserGlobalAccessPermission {
    return {
      projectIds: [projectId],
      globalPermissions: [
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
        Permission.AuthenticatedRequest,
      ],
      _type: "UserGlobalAccessPermission",
    };
  }

  /*
   * What a member of the project holds who is a Project Admin and nothing
   * else: the defaults every member has, ProjectUser, and ProjectAdmin for
   * the whole project, with no block rows.
   */
  public static getTenantAccessPermission(
    projectId: ObjectID,
  ): UserTenantAccessPermission {
    const member: UserTenantAccessPermission =
      UserPermissionUtil.withProjectUserPermission(
        UserPermissionUtil.getDefaultUserTenantAccessPermission(projectId),
      );

    return {
      ...member,
      permissions: [
        ...member.permissions,
        {
          permission: WorkflowPrincipal.PERMISSION,
          labelIds: [],
          isBlockPermission: false,
          _type: "UserPermission",
        },
      ],
    };
  }

  // The props a step acts with, before the project's plan is read.
  public static getPropsWithoutPlan(
    options: WorkflowPrincipalOptions,
  ): DatabaseCommonInteractionProps {
    const props: DatabaseCommonInteractionProps = {
      tenantId: options.projectId,
      userType: UserType.Workflow,
      userGlobalAccessPermission: WorkflowPrincipal.getGlobalAccessPermission(
        options.projectId,
      ),
      userTenantAccessPermission: {
        [options.projectId.toString()]:
          WorkflowPrincipal.getTenantAccessPermission(options.projectId),
      },
      workflowId: options.workflowId,
    };

    if (options.workflowName) {
      props.workflowName = options.workflowName;
    }

    return props;
  }

  /*
   * The props a step acts with: a new object each time, so nothing one step
   * hands down can reach the next. The project's plan is read through
   * ProjectService (cached for 60 seconds), and only on a server with
   * billing.
   */
  public static async getProps(
    options: WorkflowPrincipalOptions,
  ): Promise<DatabaseCommonInteractionProps> {
    return await CallerPlan.withPlan(
      WorkflowPrincipal.getPropsWithoutPlan(options),
    );
  }

  // Whether these props are a workflow step's.
  public static isWorkflow(props: DatabaseCommonInteractionProps): boolean {
    return props.userType === UserType.Workflow;
  }
}
