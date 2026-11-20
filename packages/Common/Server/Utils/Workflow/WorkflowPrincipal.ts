import CallerPlan from "../Billing/CallerPlan";
import UserPermissionUtil from "../UserPermission/UserPermission";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import WorkflowAccessChangeRefusedException from "../../Types/Database/Permissions/WorkflowAccessChangeRefusedException";
import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  WorkflowRunAs,
  WorkflowRunAsAudit,
  readWorkflowRunAs,
} from "../../../Types/Workflow/WorkflowRunAs";

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
 *    (workflowId, workflowName), with what it ran as and whose permissions
 *    those were (workflowRunAsAudit, #9766).
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
 * Nor is a step lent a Project Admin's sight of private incidents, alerts
 * and episodes (#8914, Types/Workflow/WorkflowPrivateRecords): whoever may
 * create a workflow - a Project Member - decides where what its steps read
 * goes, and may not see a private record, or may only view it through a
 * team that owns it. A step sees and changes no private record, nor
 * anything of one, as a caller who is no person and owns nothing
 * (PrivacyFilterUtil.shouldBypassRecordPrivacy), and a workflow does not
 * start on one (DatabaseService.isAboutPrivateRecord).
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
 * ALL OF THE ABOVE IS THE DEFAULT. A person may give a workflow other
 * permissions to run with - Project Owner, or one of the project's custom
 * roles - which only someone who holds them may do, and only someone who
 * holds them may then change the workflow (Types/Workflow/WorkflowRunAs,
 * WorkflowRunAsAuthority, #9695). The runner checks the person still holds
 * them as each run starts, and hands its steps what it found
 * (WorkflowRunAsGrant), and those are the permissions they act with here
 * instead of Project Admin's: exactly what a Project Owner, or the role,
 * allows - with the same table, column, label, block and grant ceiling
 * checks a person meets. Such a step may also change who is on which team
 * and which permissions and roles teams have (TEAM_ACCESS_TABLES), held to
 * the grant ceiling of the permissions it runs with: whoever may change the
 * workflow holds them, so nothing it hands on is anything they could not.
 * It never changes API keys, SSO or SCIM settings (CREDENTIAL_ACCESS_TABLES):
 * those are credentials, and what a step writes lands in its run log. And
 * it is no more lent the read of a credential setting or of a private
 * record than a default step is: those are refused to every workflow,
 * whatever it runs as.
 *
 * The run itself - finding the workflow, its variables, writing its run log
 * - is OneUptime's own bookkeeping and stays as it was.
 */

/*
 * THE RECORDS THAT DECIDE WHO MAY DO WHAT IN A PROJECT, by table name, in
 * two parts:
 *
 *   - its teams, who is on them and what they hold, and the custom roles a
 *     team may be given and what those hold (TEAM_ACCESS_TABLES): changed
 *     by no step of a workflow that runs with the default permissions, and
 *     by a step of one that runs as Project Owner or a custom role only as
 *     far as those permissions allow, held to their grant ceiling;
 *   - the project's API keys and what they hold, and the SSO and SCIM
 *     settings that put people on teams (CREDENTIAL_ACCESS_TABLES): changed
 *     by no step at all, whatever its workflow runs as. They are
 *     credentials, or hold them.
 *
 * (WorkflowPrincipal.assertDoesNotChangeAccess.) A table that stores a
 * permission (a Permission column) belongs to one of them, which a test
 * holds.
 */
const TEAM_ACCESS_TABLES: Array<string> = [
  "CustomRole",
  "CustomRolePermission",
  "Team",
  "TeamCustomRole",
  "TeamMember",
  "TeamPermission",
];

const CREDENTIAL_ACCESS_TABLES: Array<string> = [
  "ApiKey",
  "ApiKeyCustomRole",
  "ApiKeyPermission",
  "ProjectSCIM",
  "ProjectSSO",
];

const ACCESS_TABLES: Array<string> = [
  ...CREDENTIAL_ACCESS_TABLES,
  ...TEAM_ACCESS_TABLES,
].sort();

/*
 * The broad roles every write list names, left out where a refusal names
 * the permission a change takes.
 */
const PROJECT_ROLES: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

/*
 * What a run of a workflow acts as, once the runner has checked it against
 * whoever gave it (WorkflowRunAsAuthority.resolveForRun): Project Owner, or
 * a custom role with the rows it gives. Absent - or Default - for a
 * workflow that runs with the default permissions.
 */
export interface WorkflowRunAsGrant {
  runAs: WorkflowRunAs;
  customRoleId?: ObjectID | undefined;
  // The role's name, for the run's log and its refusals.
  customRoleName?: string | undefined;
  // The rows the role gives a workflow, as its steps hold them (CustomRole only).
  rolePermissions?: Array<UserPermission> | undefined;
  /*
   * Whose permissions the run runs with: a person, or one of the project's
   * API keys (#9765) - one of the two - and their name (the person's name
   * or email, or the key's name), for the run's log and the audit log.
   */
  givenByUserId?: ObjectID | undefined;
  givenByApiKeyId?: ObjectID | undefined;
  givenByName?: string | undefined;
}

export interface WorkflowPrincipalOptions {
  // The project the workflow belongs to and runs in.
  projectId: ObjectID;
  workflowId: ObjectID;
  // For the audit trail only.
  workflowName?: string | undefined;
  // What the run acts as; the default permissions when absent.
  runAs?: WorkflowRunAsGrant | undefined;
}

export default class WorkflowPrincipal {
  // The one role a step of a workflow that runs as Default holds in its project.
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
   * What a member of the project holds who holds what the workflow runs as
   * and nothing else: the defaults every member has, ProjectUser, and the
   * run's own rows (getRunAsRows) - ProjectAdmin for the whole project when
   * it runs as Default - with no block rows.
   */
  public static getTenantAccessPermission(
    projectId: ObjectID,
    runAs?: WorkflowRunAsGrant | undefined,
  ): UserTenantAccessPermission {
    const member: UserTenantAccessPermission =
      UserPermissionUtil.withProjectUserPermission(
        UserPermissionUtil.getDefaultUserTenantAccessPermission(projectId),
      );

    return {
      ...member,
      permissions: [
        ...member.permissions,
        ...WorkflowPrincipal.getRunAsRows(runAs),
      ],
    };
  }

  /*
   * The rows what a run acts as gives its steps, each a new object: Project
   * Admin for the whole project (Default), Project Owner for the whole
   * project, or a copy of each row the custom role gives a workflow. A role
   * that gives a workflow nothing gives its steps nothing more than the
   * defaults every member has.
   */
  public static getRunAsRows(
    runAs?: WorkflowRunAsGrant | undefined,
  ): Array<UserPermission> {
    const projectWide: (permission: Permission) => UserPermission = (
      permission: Permission,
    ): UserPermission => {
      return {
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
        _type: "UserPermission",
      };
    };

    switch (runAs?.runAs) {
      case WorkflowRunAs.ProjectOwner:
        return [projectWide(Permission.ProjectOwner)];
      case WorkflowRunAs.CustomRole:
        return (runAs.rolePermissions || []).map(
          (row: UserPermission): UserPermission => {
            const copy: UserPermission = {
              permission: row.permission,
              labelIds: [...(row.labelIds || [])],
              isBlockPermission: false,
              _type: "UserPermission",
            };

            if (row.scope) {
              copy.scope = row.scope;
            }

            return copy;
          },
        );
      default:
        return [projectWide(WorkflowPrincipal.PERMISSION)];
    }
  }

  /*
   * Whether `runAs` is one a step may change teams and roles with: Project
   * Owner or a custom role. Default - and anything that cannot be read as
   * one of them - may not.
   */
  public static isRaised(runAs: unknown): boolean {
    const read: WorkflowRunAs | null = readWorkflowRunAs(runAs);

    return (
      read === WorkflowRunAs.ProjectOwner || read === WorkflowRunAs.CustomRole
    );
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
          WorkflowPrincipal.getTenantAccessPermission(
            options.projectId,
            options.runAs,
          ),
      },
      workflowId: options.workflowId,
    };

    if (options.workflowName) {
      props.workflowName = options.workflowName;
    }

    /*
     * Only a raised workflow's props carry the mark the access rule reads:
     * a default step's permissions are exactly what they were before Run As
     * existed, and the access rule reads no mark as Default.
     */
    if (options.runAs && WorkflowPrincipal.isRaised(options.runAs.runAs)) {
      props.workflowRunAs = options.runAs.runAs;
    }

    // What every step ran as, and with whose permissions, for the audit log.
    props.workflowRunAsAudit = WorkflowPrincipal.getRunAsAudit(options.runAs);

    return props;
  }

  /*
   * WHAT A STEP RAN AS, FOR THE AUDIT LOG (#9766): Default for a run with
   * the default permissions - none named, or one that cannot be read as
   * raised - and for Project Owner or a custom role, the role's name and
   * whoever gave them, as the run checked them as it started. A new object
   * each time, holding nothing a step could use to act.
   */
  public static getRunAsAudit(
    runAs?: WorkflowRunAsGrant | undefined,
  ): WorkflowRunAsAudit {
    if (!runAs || !WorkflowPrincipal.isRaised(runAs.runAs)) {
      return { runAs: WorkflowRunAs.Default };
    }

    const audit: WorkflowRunAsAudit = { runAs: runAs.runAs };

    if (runAs.runAs === WorkflowRunAs.CustomRole && runAs.customRoleName) {
      audit.customRoleName = runAs.customRoleName;
    }

    if (runAs.givenByApiKeyId) {
      audit.givenByApiKeyId = runAs.givenByApiKeyId;
    } else if (runAs.givenByUserId) {
      audit.givenByUserId = runAs.givenByUserId;
    }

    if (runAs.givenByName) {
      audit.givenByName = runAs.givenByName;
    }

    return audit;
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

  // The teams-and-roles part of them (TEAM_ACCESS_TABLES).
  public static getTeamAccessTables(): Array<string> {
    return [...TEAM_ACCESS_TABLES];
  }

  // The credentials part of them (CREDENTIAL_ACCESS_TABLES).
  public static getCredentialAccessTables(): Array<string> {
    return [...CREDENTIAL_ACCESS_TABLES];
  }

  // Whether `modelType` decides who may do what in a project.
  public static isAccessTable(modelType: DatabaseBaseModelType): boolean {
    return ACCESS_TABLES.includes(new modelType().tableName || "");
  }

  // Whether `modelType` is one of the credentials among them.
  public static isCredentialAccessTable(
    modelType: DatabaseBaseModelType,
  ): boolean {
    return CREDENTIAL_ACCESS_TABLES.includes(new modelType().tableName || "");
  }

  /*
   * Refuses a workflow's step that would create, change or delete a record
   * that decides who may do what in its project, before anything else is
   * asked:
   *
   *   - an API key, SSO or SCIM setting (CREDENTIAL_ACCESS_TABLES): every
   *     step, whatever its workflow runs as;
   *   - a team, a team member, a team's permissions or roles, a custom role
   *     or its permissions (TEAM_ACCESS_TABLES): a step of a workflow that
   *     runs with the default permissions. A step of one that runs as
   *     Project Owner or a custom role passes on to the checks a person
   *     meets - the table, its columns, its labels and blocks, and the grant
   *     ceiling of the permissions it runs with.
   *
   * Anyone else - a person, an API key, OneUptime itself - and any read
   * pass untouched.
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

    if (
      !WorkflowPrincipal.isCredentialAccessTable(data.modelType) &&
      WorkflowPrincipal.isRaised(data.props.workflowRunAs)
    ) {
      return;
    }

    throw new WorkflowAccessChangeRefusedException(
      WorkflowPrincipal.getAccessChangeRefusal(data.modelType, data.type),
    );
  }

  /*
   * What a refused step's run log says (assertDoesNotChangeAccess): for a
   * credential, that no step changes one; for a team or a role, that a
   * workflow running with the default permissions does not, and what would
   * let this one - the permission the change takes, by its title.
   */
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

    const model: {
      pluralName: string | null;
      tableName: string | null;
      createRecordPermissions: Array<Permission>;
      updateRecordPermissions: Array<Permission>;
      deleteRecordPermissions: Array<Permission>;
    } = new modelType();
    const records: string = model.pluralName || model.tableName || "these";

    if (WorkflowPrincipal.isCredentialAccessTable(modelType)) {
      return `Workflow steps never change the project's API keys, single sign-on or SCIM settings, whatever the workflow runs as, so they can't ${verb} ${records}. A person who manages them has to make this change.`;
    }

    // The model's own list for the write, as the table check reads it.
    const writeList: Array<Permission> =
      (type === DatabaseRequestType.Create
        ? model.createRecordPermissions
        : type === DatabaseRequestType.Delete
          ? model.deleteRecordPermissions
          : model.updateRecordPermissions) || [];

    const needed: Array<string> = PermissionHelper.getPermissionTitles(
      Array.from(new Set<Permission>(writeList)).filter(
        (permission: Permission): boolean => {
          return !PROJECT_ROLES.includes(permission);
        },
      ),
    );

    const role: string =
      needed.length > 0
        ? `a custom role that has ${needed.join(" or ")}`
        : "a custom role that may do this";

    return `Workflows that run with the default permissions don't change who has access to this project, so this step can't ${verb} ${records}. To let this workflow do it, choose what it runs as in its Settings: Project Owner, or ${role}.`;
  }
}
