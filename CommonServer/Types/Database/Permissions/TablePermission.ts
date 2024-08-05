import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import BillingPermissions from "./BillingPermission";
import PublicPermission from "./PublicPermission";
import BaseModel, { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "Common/Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "Common/Types/Permission";

export default class TablePermission {
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

    if (
      !PermissionHelper.doesPermissionsIntersect(
        userPermissions.map((userPermission: UserPermission) => {
          return userPermission.permission;
        }) || [],
        modelPermissions,
      )
    ) {
      throw new NotAuthorizedException(
        `You do not have permissions to ${type} ${
          new modelType().singularName
        }. You need one of these permissions: ${PermissionHelper.getPermissionTitles(
          modelPermissions,
        ).join(", ")}`,
      );
    }
  }

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
