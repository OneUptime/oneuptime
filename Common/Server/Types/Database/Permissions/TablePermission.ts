import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import BillingPermissions from "./BillingPermission";
import PublicPermission from "./PublicPermission";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../../Types/Permission";

export default class TablePermission {
  @CaptureSpan()
  public static getTablePermission(
    modelType: DatabaseBaseModelType,
    type: DatabaseRequestType,
  ): Array<Permission> {
    let modelPermissions: Array<Permission> = [];
    const model: BaseModel = new modelType();

    if (type === DatabaseRequestType.Create) {
      modelPermissions = model.createRecordPermissions;
    }

    if (type === DatabaseRequestType.Update) {
      modelPermissions = model.updateRecordPermissions;
    }

    if (type === DatabaseRequestType.Delete) {
      modelPermissions = model.deleteRecordPermissions;
    }

    if (type === DatabaseRequestType.Read) {
      modelPermissions = model.readRecordPermissions;
    }

    return modelPermissions;
  }

  @CaptureSpan()
  public static checkTableLevelPermissions(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): void {
    // 1 CHECK: PUBLIC check -- Check if this is a public request and if public is allowed.
    PublicPermission.checkIfUserIsLoggedIn(modelType, props, type);

    // 2nd CHECK: Is user project in active state?
    BillingPermissions.checkBillingPermissions(modelType, props, type);

    // 2nd CHECK: Does user have access to CRUD data on this model.
    const userPermissions: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      );

    const modelPermissions: Array<Permission> =
      TablePermission.getTablePermission(modelType, type);

    const effectiveModelPermissions: Array<Permission> =
      TablePermission.getEffectiveModelPermissions(
        modelType,
        modelPermissions,
        type,
      );

    if (
      !PermissionHelper.doesPermissionsIntersect(
        userPermissions.map((userPermission: UserPermission) => {
          return userPermission.permission;
        }) || [],
        effectiveModelPermissions,
      )
    ) {
      const permissions: Array<string> =
        PermissionHelper.getPermissionTitles(modelPermissions);

      if (permissions.length === 0) {
        throw new NotAuthorizedException(
          `${type} on ${new modelType().singularName} is not allowed.`,
        );
      }

      throw new NotAuthorizedException(
        `You do not have permissions to ${type} ${
          new modelType().singularName
        }. You need one of these permissions: ${permissions.join(", ")}`,
      );
    }
  }

  /*
   * Resolves the model's enumerated permissions plus any wildcards that should
   * grant access. See Internal/Docs/PermissionsSimplification.md.
   *
   * - Runtime equivalence: anywhere ReadAllProjectResources is accepted,
   *   ReadAllOperationalResources is too (and vice versa for operational reads). No DB
   *   migration is performed; this is the only place the alias lives.
   * - Operational-resource wildcard: models marked @OperationalResource also
   *   accept the matching *AllOperationalResources wildcard (ReadAllOperationalResources for read,
   *   EditAllOperationalResources for update, etc.). Scope (All/Owned/Labels) on the
   *   permission row is evaluated in a later step, not here.
   */
  private static getEffectiveModelPermissions(
    modelType: DatabaseBaseModelType,
    modelPermissions: Array<Permission>,
    type: DatabaseRequestType,
  ): Array<Permission> {
    const effective: Array<Permission> = [...modelPermissions];

    if (
      effective.includes(Permission.ReadAllProjectResources) &&
      !effective.includes(Permission.ReadAllOperationalResources)
    ) {
      effective.push(Permission.ReadAllOperationalResources);
    }

    const model: BaseModel = new modelType();
    if (model.isOperationalResource) {
      const wildcard: Permission | null =
        TablePermission.getWildcardPermissionForOperation(type);
      if (wildcard && !effective.includes(wildcard)) {
        effective.push(wildcard);
      }
      if (
        type === DatabaseRequestType.Read &&
        !effective.includes(Permission.ReadAllProjectResources)
      ) {
        effective.push(Permission.ReadAllProjectResources);
      }
    }

    return effective;
  }

  private static getWildcardPermissionForOperation(
    type: DatabaseRequestType,
  ): Permission | null {
    switch (type) {
      case DatabaseRequestType.Read:
        return Permission.ReadAllOperationalResources;
      case DatabaseRequestType.Update:
        return Permission.EditAllOperationalResources;
      case DatabaseRequestType.Delete:
        return Permission.DeleteAllOperationalResources;
      case DatabaseRequestType.Create:
        return Permission.CreateAllOperationalResources;
      default:
        return null;
    }
  }

  @CaptureSpan()
  public static checkTableLevelBlockPermissions(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): void {
    // 1 CHECK: PUBLIC check -- Check if this is a public request and if public is allowed.
    PublicPermission.checkIfUserIsLoggedIn(modelType, props, type);

    // 2nd CHECK: Does user have access to CRUD data on this model.
    const userPermissions: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Block,
      );

    const modelPermissions: Array<Permission> =
      TablePermission.getTablePermission(modelType, type);

    const intersectingPermissions: Array<Permission> =
      PermissionHelper.getIntersectingPermissions(
        userPermissions.map((userPermission: UserPermission) => {
          return userPermission.permission;
        }) || [],
        modelPermissions,
      );

    if (intersectingPermissions && intersectingPermissions.length > 0) {
      for (const permission of intersectingPermissions) {
        const userPermission: UserPermission = userPermissions.find(
          (userPermission: UserPermission) => {
            return userPermission.permission === permission;
          },
        ) as UserPermission;

        if (
          userPermission &&
          (!userPermission.labelIds || userPermission.labelIds.length === 0)
        ) {
          throw new NotAuthorizedException(
            `You are not authorized to ${type} ${
              new modelType().singularName
            } because ${
              userPermission.permission
            } is in your team's permission block list.`,
          );
        }
      }
    }
  }
}
