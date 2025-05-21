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

    if (
      !PermissionHelper.doesPermissionsIntersect(
        userPermissions.map((userPermission: UserPermission) => {
          return userPermission.permission;
        }) || [],
        modelPermissions,
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
