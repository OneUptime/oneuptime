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
    _modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
    _type: DatabaseRequestType,
  ): void {
    // 1 CHECK: PUBLIC check -- Check if this is a public request and if public is allowed.

    if (!this.isPublicPermissionAllowed(_modelType, _type) && !props.userId) {
      if (props.userType === UserType.API) {
        // if its an API request then continue.
        return;
      }

      /*
       * The record is not publicly accessible and the caller presented
       * neither a session nor an API key.
       */
      throw new NotAuthenticatedException(
        "Authenticated user or a valid API key is required.",
      );
    }
  }
}