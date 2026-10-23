import CallerPlan from "../Billing/CallerPlan";
import UserPermissionUtil from "../UserPermission/UserPermission";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import WorkflowAccessChangeRefusedException from "../../Types/Database/Permissions/WorkflowAccessChangeRefusedException";
import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
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
 * record a workflow started on - acts with these props, built here and
 * nowhere else:
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
 * So what a Project Admin of the project may not do - an owner-only or a
 * billing change, a table or column the plan does not include - a step may
 * not do either, and its error port says so in plain words, naming the step
 * (LogComponentError).
 *
 * One thing a Project Admin may do is not lent to a step: read the settings
 * that hold credentials - SMTP servers, call and SMS providers, SNMP
 * credentials, video call connections, API keys and outside MCP servers.
 * Whoever may edit a workflow decides what its steps do, with whatever its
 * variables, webhooks and runs hand them, so a step names none of those
 * settings: a person who may read them has to
 * (RelationListPermission.mayReadTable).
 *
 * Nor is a step lent what a Project Admin may do to who may do what in the
 * project: it creates, changes and deletes no team, team member, team
 * permission, custom role, role permission, team role, API key, API key
 * permission, API key role, SSO or SCIM setting (ACCESS_TABLES). Who may build a workflow
 * is not who may manage the project's access - a Project Member, a Workflow
 * Admin, someone with Create Workflow or Edit Workflow builds one - so a
 * step that could would hand its builder the access they were not given: a
 * team that holds Project Admin, a seat on the Admin team. Its triggers and
 * Find steps still read these records, as the builder may; changes are made
 * by a person (assertDoesNotChangeAccess, which TablePermission asks on
 * every create, update and delete).
 *
 * The run itself - finding the workflow, its variables, writing its run log
 * - is OneUptime's own bookkeeping and stays as it was.
 */

/*
 * THE RECORDS THAT DECIDE WHO MAY DO WHAT IN A PROJECT, by table name: its
 * teams, who is on them and what they hold, the custom roles a team may be
 * given and what those hold, the project's API keys and what they hold,
 * and the SSO and SCIM settings that put people on teams. A workflow's step
 * writes none of them, whatever its builder or its data
 * (WorkflowPrincipal.assertDoesNotChangeAccess). A table that stores a
 * permission (a Permission column) belongs here, which a test holds.
 */
const ACCESS_TABLES: Array<string> = [
  "ApiKey",
  "ApiKeyCustomRole",
  "ApiKeyPermission",
  "CustomRole",
  "CustomRolePermission",
  "ProjectSCIM",
  "ProjectSSO",
  "Team",
  "TeamCustomRole",
  "TeamMember",
  "TeamPermission",
];

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

  // The tables that decide who may do what in a project (ACCESS_TABLES).
  public static getAccessTables(): Array<string> {
    return [...ACCESS_TABLES];
  }

  // Whether `modelType` decides who may do what in a project.
  public static isAccessTable(modelType: DatabaseBaseModelType): boolean {
    return ACCESS_TABLES.includes(new modelType().tableName || "");
  }

  /*
   * Refuses a workflow's step that would create, change or delete a record
   * that decides who may do what in its project (ACCESS_TABLES), before
   * anything else is asked: the step acts as a Project Admin, who may, but
   * a step never does. Anyone else - a person, an API key, OneUptime itself
   * - and any read pass untouched.
   */
  public static assertDoesNotChangeAccess(data: {
    modelType: DatabaseBaseModelType;
    props: DatabaseCommonInteractionProps;
    type: DatabaseRequestType;
  }): void {
    if (
      data.type === DatabaseRequestType.Read ||
      !WorkflowPrincipal.isWorkflow(data.props) ||
      !WorkflowPrincipal.isAccessTable(data.modelType)
    ) {
      return;
    }

    throw new WorkflowAccessChangeRefusedException(
      WorkflowPrincipal.getAccessChangeRefusal(data.modelType, data.type),
    );
  }

  // What a refused step's run log says (assertDoesNotChangeAccess).
  public static getAccessChangeRefusal(
    modelType: DatabaseBaseModelType,
    type: DatabaseRequestType,
  ): string {
    const verb: string =
      type === DatabaseRequestType.Create
        ? "create"
        : type === DatabaseRequestType.Delete
          ? "delete"
          : "change";

    const model: { pluralName: string | null; tableName: string | null } =
      new modelType();

    return `Workflow steps don't change who has access to this project, so they can't ${verb} ${model.pluralName || model.tableName}. A person who manages the project's teams and API keys has to make this change.`;
  }
}
