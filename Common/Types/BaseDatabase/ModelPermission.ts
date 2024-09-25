import { getModelTypeByName } from "../../Models/DatabaseModels/Index";
import { getModelTypeByName as getAnalyticsModelTypeByname } from "../../Models/AnalyticsModels/Index";
import Permission, {
  PermissionHelper,
  UserPermission,
  UserTenantAccessPermission,
  instanceOfUserTenantAccessPermission,
} from "../Permission";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseRequestType from "../../Server/Types/BaseDatabase/DatabaseRequestType";

export default class ModelPermission {
  public static hasPermissionsByModelName(
    userProjectPermissions: UserTenantAccessPermission | Array<Permission>,
    modelName: string,
    requestType: DatabaseRequestType,
  ): boolean {
    let modelPermissions: Array<Permission> = [];

    let modelType:
      | { new (): BaseModel }
      | { new (): AnalyticsBaseModel }
      | null = getModelTypeByName(modelName);

    if (!modelType) {
      // check if it is an analytics model
      modelType = getAnalyticsModelTypeByname(modelName);

      if (!modelType) {
        return false;
      }
    }

    if (requestType === DatabaseRequestType.Create) {
      modelPermissions = new modelType().getCreatePermissions();
    }

    if (requestType === DatabaseRequestType.Read) {
      modelPermissions = new modelType().getReadPermissions();
    }

    if (requestType === DatabaseRequestType.Update) {
      modelPermissions = new modelType().getUpdatePermissions();
    }

    if (requestType === DatabaseRequestType.Delete) {
      modelPermissions = new modelType().getDeletePermissions();
    }

    return this.hasPermissions(userProjectPermissions, modelPermissions);
  }

  public static hasPermissions(
    userProjectPermissions: UserTenantAccessPermission | Array<Permission>,
    modelPermissions: Array<Permission>,
  ): boolean {
    let userPermissions: Array<Permission> = [];

    if (
      instanceOfUserTenantAccessPermission(userProjectPermissions) &&
      userProjectPermissions.permissions &&
      Array.isArray(userProjectPermissions.permissions)
    ) {
      userPermissions = userProjectPermissions.permissions.map(
        (item: UserPermission) => {
          return item.permission;
        },
      );
    } else {
      userPermissions = userProjectPermissions as Array<Permission>;
    }

    return Boolean(
      userPermissions &&
        PermissionHelper.doesPermissionsIntersect(
          modelPermissions,
          userPermissions,
        ),
    );
  }
}
