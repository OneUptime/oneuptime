import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import TablePermission from "./TablePermission";
import { DatabaseBaseModelType } from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthenticatedException from "../../../../Types/Exception/NotAuthenticatedException";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";
import Permission from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";

export default class PublicPermission {
  @CaptureSpan()
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

  @CaptureSpan()
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
