import AccessTokenService from "../../Services/AccessTokenService";
import ApiKeyService from "../../Services/ApiKeyService";
import CustomRolePermissionService from "../../Services/CustomRolePermissionService";
import CustomRoleService from "../../Services/CustomRoleService";
import TeamPermissionService from "../../Services/TeamPermissionService";
import UserService from "../../Services/UserService";
import APIKeyAccessPermission from "../APIKey/AccessPermission";
import CallerPermission from "../Permission/CallerPermission";
import WorkflowPrincipal, { WorkflowRunAsGrant } from "./WorkflowPrincipal";
import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import CustomRole from "../../../Models/DatabaseModels/CustomRole";
import CustomRolePermission from "../../../Models/DatabaseModels/CustomRolePermission";
import Label from "../../../Models/DatabaseModels/Label";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  getCopyScope,
  isRolePermissionGivenToApiKeys,
} from "../../../Types/Team/CustomRoleCopyPlan";
import { getPermissionTitleForSentence } from "../../../Types/Team/CustomRole";
import UserType from "../../../Types/UserType";
import {
  WORKFLOW_RUN_AS_GIVER_ONLY_MESSAGE,
  WORKFLOW_RUN_AS_OWNER_REFUSED_MESSAGE,
  WORKFLOW_RUN_AS_ROLE_DELETED_MESSAGE,
  WORKFLOW_RUN_AS_ROLE_MISSING_MESSAGE,
  WORKFLOW_RUN_AS_ROLE_NOT_FOUND_MESSAGE,
  WORKFLOW_RUN_AS_UNKNOWN_MESSAGE,
  WORKFLOW_RUN_AS_UNREADABLE_MESSAGE,
  WorkflowRunAs,
  WorkflowRunAsChoice,
  getWorkflowRunAsChangeRefusedMessage,
  getWorkflowRunAsChildRefusedMessage,
  getWorkflowRunAsGiverGoneMessage,
  getWorkflowRunAsGiverLeftMessage,
  getWorkflowRunAsGiverLostMessage,
  getWorkflowRunAsGiverOnlyRefusedMessage,
  getWorkflowRunAsKeyExpiredMessage,
  getWorkflowRunAsKeyGoneMessage,
  getWorkflowRunAsKeyLostMessage,
  getWorkflowRunAsRoleRefusedMessage,
  getWorkflowRunAsRunRefusedMessage,
  getWorkflowRunAsVariableRefusedMessage,
  readWorkflowRunAs,
} from "../../../Types/Workflow/WorkflowRunAs";

/*
 * WHO MAY GIVE A WORKFLOW ITS PERMISSIONS, WHO MAY CHANGE ONE THAT HAS THEM,
 * AND WHAT A RUN ACTS AS (#9695, Types/Workflow/WorkflowRunAs).
 *
 * One question decides all of it: could this holder give the permissions
 * to a team themselves? It is the grant ceiling a person meets when they
 * give a team a permission or a role (TeamPermissionService
 * .assertCanGrantPermission), asked of:
 *
 *   - whoever chooses a Run As (assertMayGive): Project Owner takes an
 *     unblocked Project Owner of their own; a custom role takes every
 *     permission the role gives a workflow, at its scope and labels;
 *   - whoever changes, deletes, archives or runs by hand a workflow that has
 *     them (assertMayAct) - the same question for what it runs as now, so
 *     nobody who holds less makes it do what they could not;
 *   - whoever gave them, as every run starts (resolveForRun), so a workflow
 *     stops being able to do what its giver can no longer do - a person
 *     left the project or lost the role, a key was deleted, expired or
 *     narrowed, or the role grew;
 *   - another workflow's permissions, before its Run Workflow step starts a
 *     raised workflow (assertMayStart).
 *
 * WHO MAY GIVE THEM (getGiver): a person, or one of the project's API keys
 * (#9765) - each holder whose own permissions in the project can be read
 * again as every run starts. Only those own permissions count: no root, no
 * master admin's pass, and never a workflow's step or the server's master
 * API key, which holds nothing of its own in a project. A key is weighed
 * exactly as a person is - its rows, the copies of its custom roles among
 * them, against the same ceiling - so a key never raises a workflow beyond
 * itself, and a person never gets more through a key than the key holds,
 * which was itself given by someone who held it
 * (ApiKeyPermissionService.assertCallerCanGrantPermission) and is shown again
 * only to someone who could give all of it (ApiKeyService, on a reset).
 */

// Who gave a raised workflow its permissions: a person, or a project API key.
export enum WorkflowRunAsGiverKind {
  Person = "Person",
  ApiKey = "ApiKey",
}

export interface WorkflowRunAsGiver {
  kind: WorkflowRunAsGiverKind;
  // The person's id (Person), or the key's id (ApiKey).
  id: ObjectID;
  // The key's name, as the request carried it (ApiKey only).
  name?: string | undefined;
}

// What a workflow is set to run as, as stored.
export interface WorkflowRunAsSetting {
  runAs: unknown;
  customRoleId?: ObjectID | null | undefined;
}

// A custom role a workflow runs as: its name, and the rows it gives a workflow.
export interface WorkflowRunAsRole {
  id: ObjectID;
  name: string;
  rows: Array<UserPermission>;
}

// What someone did that a raised workflow's permissions decide.
export enum WorkflowRunAsAction {
  // Changed, deleted or archived it.
  Change = "Change",
  // Ran it, or one of its steps, by hand.
  Run = "Run",
  // Created, changed or deleted one of its own variables.
  ChangeVariable = "ChangeVariable",
}

/*
 * Why a run of a raised workflow did not start: its giver no longer holds
 * its permissions, or what it runs as can no longer be read. A
 * NotAuthorizedException, as anything else that refuses an act is.
 */
export class WorkflowRunAsRefusedException extends NotAuthorizedException {}

export default class WorkflowRunAsAuthority {
  /*
   * Whether `props` are a person's own: someone signed in as themselves, or
   * through a tool they authorized to act for them (Ask AI, an MCP client)
   * - never an API key (the master key included), a workflow's step or
   * OneUptime itself.
   */
  public static isPerson(props: DatabaseCommonInteractionProps): boolean {
    return (
      Boolean(props.userId) &&
      !props.isRoot &&
      !props.apiKeyId &&
      !props.apiKeyName &&
      (props.userType === UserType.User ||
        props.userType === UserType.MasterAdmin)
    );
  }

  /*
   * Whether `props` are one of a project's API keys (#9765): a request the
   * key made, carrying its id (ProjectMiddleware) and no person - never the
   * server's master API key, which is no key of a project and has no id,
   * never a workflow's step and never OneUptime itself.
   */
  public static isProjectApiKey(
    props: DatabaseCommonInteractionProps,
  ): boolean {
    return (
      Boolean(props.apiKeyId) &&
      !props.userId &&
      !props.isRoot &&
      !props.isMasterAdmin &&
      props.userType === UserType.API
    );
  }

  /*
   * Who `props` are, as someone who may give a workflow raised permissions:
   * a person, or a project API key - or null for anyone else, who may not.
   */
  public static getGiver(
    props: DatabaseCommonInteractionProps,
  ): WorkflowRunAsGiver | null {
    if (WorkflowRunAsAuthority.isPerson(props)) {
      return { kind: WorkflowRunAsGiverKind.Person, id: props.userId! };
    }

    if (WorkflowRunAsAuthority.isProjectApiKey(props)) {
      const giver: WorkflowRunAsGiver = {
        kind: WorkflowRunAsGiverKind.ApiKey,
        id: props.apiKeyId!,
      };

      if (props.apiKeyName) {
        giver.name = props.apiKeyName;
      }

      return giver;
    }

    return null;
  }

  /*
   * The columns of a workflow that record who gave it its permissions, as a
   * write sets them: the giver's own column, and the other one cleared, so
   * a workflow names one giver at a time.
   */
  public static getGivenByColumns(
    giver: WorkflowRunAsGiver,
  ): Record<"runAsGivenByUserId" | "runAsGivenByApiKeyId", ObjectID | null> {
    return {
      runAsGivenByUserId:
        giver.kind === WorkflowRunAsGiverKind.Person ? giver.id : null,
      runAsGivenByApiKeyId:
        giver.kind === WorkflowRunAsGiverKind.ApiKey ? giver.id : null,
    };
  }

  /*
   * A holder's own permissions in the workflow's project, as the grant
   * ceiling reads them: no root, and no master admin's pass - a workflow
   * runs with what its giver holds in the project, which is what its runs
   * check again.
   */
  public static getOwnProps(
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): DatabaseCommonInteractionProps {
    return {
      ...props,
      tenantId: projectId,
      isRoot: false,
      isMasterAdmin: false,
    };
  }

  // A stored setting, read: Default for none, null for one that cannot be.
  public static readSetting(
    setting: WorkflowRunAsSetting,
  ): WorkflowRunAs | null {
    return readWorkflowRunAs(setting.runAs);
  }

  /*
   * The custom role a Run As names, read in the workflow's project: its
   * name and the rows a workflow given it holds - each of its permissions
   * but those limited to what someone owns, which reach nothing of a
   * workflow's (a workflow owns nothing, as an API key owns nothing), at the
   * scope and labels a copy of it is given (CustomRoleCopyPlan). Null when
   * the role is not one of the project's, or is gone.
   */
  public static async readRole(data: {
    customRoleId: ObjectID;
    projectId: ObjectID;
  }): Promise<WorkflowRunAsRole | null> {
    const role: CustomRole | null = await CustomRoleService.findOneBy({
      query: {
        _id: data.customRoleId,
        projectId: data.projectId,
      },
      select: {
        _id: true,
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!role || !role.id) {
      return null;
    }

    const permissions: Array<CustomRolePermission> =
      await CustomRolePermissionService.findPermissionsOfRole({
        customRoleId: role.id,
        projectId: data.projectId,
      });

    return {
      id: role.id,
      name: role.name || "",
      rows: WorkflowRunAsAuthority.getRoleRows(permissions),
    };
  }

  // The rows a workflow given a role with these permissions holds.
  public static getRoleRows(
    permissions: Array<CustomRolePermission>,
  ): Array<UserPermission> {
    const rows: Array<UserPermission> = [];

    for (const permission of permissions) {
      if (
        !permission.permission ||
        !isRolePermissionGivenToApiKeys(permission.scope)
      ) {
        continue;
      }

      const copy: { scope: UserPermission["scope"]; labelIds: Array<string> } =
        getCopyScope({
          id: permission.id?.toString() || "",
          customRoleId: "",
          permission: permission.permission,
          scope: permission.scope,
          labelIds: (permission.labels || [])
            .map((label: Label): string => {
              return label.id?.toString() || "";
            })
            .filter((labelId: string): boolean => {
              return Boolean(labelId);
            }),
        });

      rows.push({
        permission: permission.permission,
        labelIds: copy.labelIds.map((labelId: string): ObjectID => {
          return new ObjectID(labelId);
        }),
        scope: copy.scope,
        isBlockPermission: false,
        _type: "UserPermission",
      });
    }

    return rows;
  }

  /*
   * The permission `holderProps` lack to give a workflow what it runs as -
   * or null when they hold everything it takes. Project Owner takes an
   * unblocked Project Owner for the whole project; a custom role takes each
   * row it gives a workflow, weighed as giving that row to a team is - at
   * its scope and labels, and not past a block - unless the holder is such
   * an owner. A role that is gone gives nothing, and takes nothing.
   */
  public static findMissingPermission(data: {
    runAs: WorkflowRunAs;
    role?: WorkflowRunAsRole | null | undefined;
    holderProps: DatabaseCommonInteractionProps;
  }): Permission | null {
    if (data.runAs === WorkflowRunAs.Default) {
      return null;
    }

    if (TeamPermissionService.canGrantEveryPermission(data.holderProps)) {
      return null;
    }

    if (data.runAs !== WorkflowRunAs.CustomRole) {
      return Permission.ProjectOwner;
    }

    for (const row of data.role?.rows || []) {
      try {
        TeamPermissionService.assertCanGrantPermission({
          permission: row.permission,
          labelIds: row.labelIds,
          scope: row.scope,
          props: data.holderProps,
        });
      } catch (err) {
        if (err instanceof NotAuthorizedException) {
          return row.permission;
        }

        throw err;
      }
    }

    return null;
  }

  /*
   * Refuses `props` giving a workflow of `projectId` this Run As, in words
   * that name what is missing. Default asks nothing: anyone who may create
   * or edit the workflow may set it, as before. Anything else takes a
   * person, or a project API key, who could give a team those permissions
   * themselves. Answers the role a custom role Run As names.
   */
  public static async assertMayGive(data: {
    setting: WorkflowRunAsSetting;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkflowRunAsRole | null> {
    const runAs: WorkflowRunAs | null = WorkflowRunAsAuthority.readSetting(
      data.setting,
    );

    if (runAs === null) {
      throw new BadDataException(WORKFLOW_RUN_AS_UNKNOWN_MESSAGE);
    }

    if (runAs === WorkflowRunAs.Default) {
      return null;
    }

    let role: WorkflowRunAsRole | null = null;

    if (runAs === WorkflowRunAs.CustomRole) {
      if (!data.setting.customRoleId) {
        throw new BadDataException(WORKFLOW_RUN_AS_ROLE_MISSING_MESSAGE);
      }

      role = await WorkflowRunAsAuthority.readRole({
        customRoleId: data.setting.customRoleId,
        projectId: data.projectId,
      });

      if (!role) {
        throw new BadDataException(WORKFLOW_RUN_AS_ROLE_NOT_FOUND_MESSAGE);
      }
    }

    if (!WorkflowRunAsAuthority.getGiver(data.props)) {
      throw new NotAuthorizedException(WORKFLOW_RUN_AS_GIVER_ONLY_MESSAGE);
    }

    const missing: Permission | null =
      WorkflowRunAsAuthority.findMissingPermission({
        runAs: runAs,
        role: role,
        holderProps: WorkflowRunAsAuthority.getOwnProps(
          data.props,
          data.projectId,
        ),
      });

    if (missing) {
      throw new NotAuthorizedException(
        runAs === WorkflowRunAs.ProjectOwner
          ? WORKFLOW_RUN_AS_OWNER_REFUSED_MESSAGE
          : getWorkflowRunAsRoleRefusedMessage({
              roleName: role?.name || "",
              permissionTitle: getPermissionTitleForSentence(missing),
            }),
      );
    }

    return role;
  }

  /*
   * Refuses `props` acting on a workflow that runs as `setting` - changing,
   * deleting or archiving it, running it by hand, changing its variables -
   * unless they could give it what it runs as themselves. A workflow that
   * runs as Default asks nothing, and nor does OneUptime's own write. A
   * custom role that is gone gives the workflow nothing (it does not run),
   * so it asks nothing either: anyone who may edit the workflow may choose
   * what it runs as now, held to assertMayGive. A Run As that cannot be
   * read is held to Project Owner.
   */
  public static async assertMayAct(data: {
    setting: WorkflowRunAsSetting;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    action: WorkflowRunAsAction;
  }): Promise<void> {
    if (data.props.isRoot) {
      return;
    }

    const read: WorkflowRunAs | null = WorkflowRunAsAuthority.readSetting(
      data.setting,
    );

    if (read === WorkflowRunAs.Default) {
      return;
    }

    const runAs: WorkflowRunAs = read || WorkflowRunAs.ProjectOwner;
    let role: WorkflowRunAsRole | null = null;

    if (runAs === WorkflowRunAs.CustomRole) {
      role = data.setting.customRoleId
        ? await WorkflowRunAsAuthority.readRole({
            customRoleId: data.setting.customRoleId,
            projectId: data.projectId,
          })
        : null;

      if (!role) {
        return;
      }
    }

    const choice: WorkflowRunAsChoice = {
      runAs: runAs,
      customRoleName: role?.name,
    };

    const refusal: string =
      data.action === WorkflowRunAsAction.Run
        ? getWorkflowRunAsRunRefusedMessage(choice)
        : data.action === WorkflowRunAsAction.ChangeVariable
          ? getWorkflowRunAsVariableRefusedMessage(choice)
          : getWorkflowRunAsChangeRefusedMessage(choice);

    if (!WorkflowRunAsAuthority.getGiver(data.props)) {
      throw new NotAuthorizedException(
        getWorkflowRunAsGiverOnlyRefusedMessage(refusal),
      );
    }

    const missing: Permission | null =
      WorkflowRunAsAuthority.findMissingPermission({
        runAs: runAs,
        role: role,
        holderProps: WorkflowRunAsAuthority.getOwnProps(
          data.props,
          data.projectId,
        ),
      });

    if (missing) {
      throw new NotAuthorizedException(refusal);
    }
  }

  /*
   * Whether `props` may act on a workflow that runs as `setting`
   * (assertMayAct), as a yes or a no.
   */
  public static async mayAct(data: {
    setting: WorkflowRunAsSetting;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    action: WorkflowRunAsAction;
  }): Promise<boolean> {
    try {
      await WorkflowRunAsAuthority.assertMayAct(data);
      return true;
    } catch (err) {
      if (err instanceof NotAuthorizedException) {
        return false;
      }

      throw err;
    }
  }

  /*
   * WHAT A RUN ACTS AS, as it starts or carries on after a Sleep step: the
   * workflow's Run As, checked against whoever gave it - a person, or a
   * project API key (#9765) - as they are in the project now. Default needs
   * nothing. Anything else is refused - the run does not start - when:
   *
   *   - it cannot be read, or its custom role is gone;
   *   - nobody is recorded as having given it, or that person or key is gone;
   *   - a person who gave it is no longer a member of the project, or may no
   *     longer sign in (blocked or turned off);
   *   - a key that gave it has expired;
   *   - they could not give it now: they lost the permission (a key's own
   *     permissions narrowed), or the role holds one they don't.
   *
   * A workflow names one giver; should it name both, the key is the one
   * asked. Each refusal says why, and who can give the permissions again.
   */
  public static async resolveForRun(data: {
    projectId: ObjectID;
    setting: WorkflowRunAsSetting;
    givenByUserId?: ObjectID | null | undefined;
    givenByApiKeyId?: ObjectID | null | undefined;
  }): Promise<WorkflowRunAsGrant> {
    const runAs: WorkflowRunAs | null = WorkflowRunAsAuthority.readSetting(
      data.setting,
    );

    if (runAs === null) {
      throw new WorkflowRunAsRefusedException(
        WORKFLOW_RUN_AS_UNREADABLE_MESSAGE,
      );
    }

    if (runAs === WorkflowRunAs.Default) {
      return { runAs: WorkflowRunAs.Default };
    }

    let role: WorkflowRunAsRole | null = null;

    if (runAs === WorkflowRunAs.CustomRole) {
      role = data.setting.customRoleId
        ? await WorkflowRunAsAuthority.readRole({
            customRoleId: data.setting.customRoleId,
            projectId: data.projectId,
          })
        : null;

      if (!role) {
        throw new WorkflowRunAsRefusedException(
          WORKFLOW_RUN_AS_ROLE_DELETED_MESSAGE,
        );
      }
    }

    const choice: WorkflowRunAsChoice = {
      runAs: runAs,
      customRoleName: role?.name,
    };

    const grant: WorkflowRunAsGrant = data.givenByApiKeyId
      ? await WorkflowRunAsAuthority.resolveKeyGiver({
          projectId: data.projectId,
          apiKeyId: data.givenByApiKeyId,
          runAs: runAs,
          role: role,
          choice: choice,
        })
      : await WorkflowRunAsAuthority.resolvePersonGiver({
          projectId: data.projectId,
          userId: data.givenByUserId,
          runAs: runAs,
          role: role,
          choice: choice,
        });

    if (role) {
      grant.customRoleId = role.id;
      grant.customRoleName = role.name;
      grant.rolePermissions = role.rows;
    }

    return grant;
  }

  /*
   * A raised run's person: still in the project, able to sign in, and
   * still able to give what the workflow runs as.
   */
  private static async resolvePersonGiver(data: {
    projectId: ObjectID;
    userId: ObjectID | null | undefined;
    runAs: WorkflowRunAs;
    role: WorkflowRunAsRole | null;
    choice: WorkflowRunAsChoice;
  }): Promise<WorkflowRunAsGrant> {
    const giver: User | null = data.userId
      ? await UserService.findOneById({
          id: data.userId,
          select: {
            _id: true,
            name: true,
            email: true,
            isBlocked: true,
            isDisabled: true,
          },
          props: {
            isRoot: true,
          },
        })
      : null;

    if (!giver || !giver.id) {
      throw new WorkflowRunAsRefusedException(
        getWorkflowRunAsGiverGoneMessage(data.choice),
      );
    }

    const giverName: string =
      giver.name?.toString() || giver.email?.toString() || "the person";

    const giverProps: DatabaseCommonInteractionProps =
      await AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject(
        {
          userId: giver.id,
          projectId: data.projectId,
        },
      );

    if (!CallerPermission.isProjectMember(giverProps, data.projectId)) {
      throw new WorkflowRunAsRefusedException(
        getWorkflowRunAsGiverLeftMessage({
          choice: data.choice,
          giverName: giverName,
        }),
      );
    }

    if (giver.isBlocked || giver.isDisabled) {
      throw new WorkflowRunAsRefusedException(
        getWorkflowRunAsGiverLostMessage({
          choice: data.choice,
          giverName: giverName,
        }),
      );
    }

    const missing: Permission | null =
      WorkflowRunAsAuthority.findMissingPermission({
        runAs: data.runAs,
        role: data.role,
        holderProps: WorkflowRunAsAuthority.getOwnProps(
          giverProps,
          data.projectId,
        ),
      });

    if (missing) {
      throw new WorkflowRunAsRefusedException(
        getWorkflowRunAsGiverLostMessage({
          choice: data.choice,
          giverName: giverName,
          missingPermissionTitle: getPermissionTitleForSentence(missing),
        }),
      );
    }

    return {
      runAs: data.runAs,
      givenByUserId: giver.id,
      givenByName: giverName,
    };
  }

  /*
   * A RAISED RUN'S API KEY (#9765), read again as every run starts: one of
   * the workflow's project's keys, not deleted (revoked) and not expired,
   * whose own permissions now - its rows and the copies of its custom
   * roles, read as a request the key made would read them
   * (APIKeyAccessPermission) - still give what the workflow runs as. A key
   * narrowed since, or a role grown since, stops the run before its first
   * step, as a person who lost the permission does.
   */
  private static async resolveKeyGiver(data: {
    projectId: ObjectID;
    apiKeyId: ObjectID;
    runAs: WorkflowRunAs;
    role: WorkflowRunAsRole | null;
    choice: WorkflowRunAsChoice;
  }): Promise<WorkflowRunAsGrant> {
    const key: ApiKey | null = await ApiKeyService.findOneBy({
      query: {
        _id: data.apiKeyId,
        projectId: data.projectId,
      },
      select: {
        _id: true,
        name: true,
        expiresAt: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!key || !key.id) {
      throw new WorkflowRunAsRefusedException(
        getWorkflowRunAsKeyGoneMessage(data.choice),
      );
    }

    const keyName: string = key.name?.toString() || "";

    if (
      !key.expiresAt ||
      OneUptimeDate.fromString(key.expiresAt).getTime() <=
        OneUptimeDate.getCurrentDate().getTime()
    ) {
      throw new WorkflowRunAsRefusedException(
        getWorkflowRunAsKeyExpiredMessage({
          choice: data.choice,
          keyName: keyName,
        }),
      );
    }

    const missing: Permission | null =
      WorkflowRunAsAuthority.findMissingPermission({
        runAs: data.runAs,
        role: data.role,
        holderProps: WorkflowRunAsAuthority.getOwnProps(
          await WorkflowRunAsAuthority.getApiKeyProps({
            apiKeyId: key.id,
            projectId: data.projectId,
          }),
          data.projectId,
        ),
      });

    if (missing) {
      throw new WorkflowRunAsRefusedException(
        getWorkflowRunAsKeyLostMessage({
          choice: data.choice,
          keyName: keyName,
          missingPermissionTitle: getPermissionTitleForSentence(missing),
        }),
      );
    }

    return {
      runAs: data.runAs,
      givenByApiKeyId: key.id,
      givenByName: keyName,
    };
  }

  /*
   * A project API key's props as a request it made has them
   * (ProjectMiddleware): the key, in its project, holding the defaults every
   * key has and its own permission rows, allows and blocks alike.
   */
  public static async getApiKeyProps(data: {
    apiKeyId: ObjectID;
    projectId: ObjectID;
  }): Promise<DatabaseCommonInteractionProps> {
    const tenantAccess: UserTenantAccessPermission =
      await APIKeyAccessPermission.getApiTenantAccessPermission(
        data.projectId,
        data.apiKeyId,
      );

    return {
      tenantId: data.projectId,
      userType: UserType.API,
      apiKeyId: data.apiKeyId,
      userGlobalAccessPermission:
        await APIKeyAccessPermission.getDefaultApiGlobalPermission(
          data.projectId,
        ),
      userTenantAccessPermission: {
        [data.projectId.toString()]: tenantAccess,
      },
    };
  }

  /*
   * Refuses a run of a workflow that runs as `parent` starting one that
   * runs as `child` with its Run Workflow step, unless the parent's own
   * permissions include the child's: whoever may change the parent
   * decides what the child is started with, and holds only the parent's
   * permissions. A child that runs as Default is started by any workflow,
   * as before.
   *
   * A parent that runs as Default starts no other child. Anyone who may
   * edit workflows decides what a Default workflow does - a Project Member
   * included - so the Project Admin its steps act as vouches for nobody.
   * Weighed by the grant ceiling alone, it would start a child whose custom
   * role holds only Project Admin, and whoever edits the parent would steer
   * a workflow that may give a team Project Admin.
   */
  public static async assertMayStart(data: {
    projectId: ObjectID;
    parent: WorkflowRunAsGrant | undefined;
    child: WorkflowRunAsSetting;
    childName?: string | undefined;
  }): Promise<void> {
    const read: WorkflowRunAs | null = WorkflowRunAsAuthority.readSetting(
      data.child,
    );

    if (read === WorkflowRunAs.Default) {
      return;
    }

    const runAs: WorkflowRunAs = read || WorkflowRunAs.ProjectOwner;

    const role: WorkflowRunAsRole | null =
      runAs === WorkflowRunAs.CustomRole && data.child.customRoleId
        ? await WorkflowRunAsAuthority.readRole({
            customRoleId: data.child.customRoleId,
            projectId: data.projectId,
          })
        : null;

    const isParentRaised: boolean = WorkflowPrincipal.isRaised(
      data.parent?.runAs,
    );

    const missing: Permission | null = isParentRaised
      ? WorkflowRunAsAuthority.findMissingPermission({
          runAs: runAs,
          role: role,
          holderProps: WorkflowPrincipal.getPropsWithoutPlan({
            projectId: data.projectId,
            workflowId: ObjectID.generate(),
            runAs: data.parent,
          }),
        })
      : null;

    if (!isParentRaised || missing) {
      throw new BadDataException(
        getWorkflowRunAsChildRefusedMessage({
          childName: data.childName,
          childChoice: { runAs: runAs, customRoleName: role?.name },
        }),
      );
    }
  }
}
