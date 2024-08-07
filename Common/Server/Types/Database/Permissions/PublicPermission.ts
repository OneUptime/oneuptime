import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import TablePermission from "./TablePermission";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import Permission from "Common/Types/Permission";
import UserType from "Common/Types/UserType";

export default class PublicPermission {
  public static isPublicPermissionAllowed(
    modelType: DatabaseBaseModelType,
    type: DatabaseRequestType,
  ): boolean {
    let isPublicAllowed: boolean = false;
    isPublicAllowed = TablePermission.getTablePermission(
      modelType,
      type,
    ).includes(Permission.Public);
    return isPublicAllowed;
  }

  public static checkIfUserIsLoggedIn(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): void {
    // 1 CHECK: PUBLIC check -- Check if this is a public request and if public is allowed.

    if (!this.isPublicPermissionAllowed(modelType, type) && !props.userId) {
      if (props.userType === UserType.API) {
        // if its an API request then continue.
        return;
      }

      // this means the record is not publicly createable and the user is not logged in.
      throw new NotAuthenticatedException(
        `A user should be logged in to ${type} record of ${
          new modelType().singularName
        }.`,
      );
    }
  }
}
