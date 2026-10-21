import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncomingCallPolicy from "../../Models/DatabaseModels/IncomingCallPolicy";
import ProjectCallSMSConfig from "../../Models/DatabaseModels/ProjectCallSMSConfig";
import HeldPermissionsUtil, {
  HeldPermissions,
  PermissionOperation,
} from "../../Types/HeldPermissions";
import Permission from "../../Types/Permission";

/*
 * WHO MAY LOOK UP, ADD AND RELEASE AN INCOMING CALL POLICY'S PHONE NUMBERS.
 *
 * A policy's numbers are found, bought, attached and released through the
 * project's own Twilio account - the policy's Call and SMS config - by
 * routes of their own (App Notification/API/PhoneNumber), not the CRUD API.
 * They take the roles of the policy they serve, read from the models
 * themselves so that they cannot drift from them again (they used to name
 * Project Owner, Admin and Member by hand, and left out the Settings roles
 * that own incoming call policies):
 *
 *  - LOOKING NUMBERS UP - searching Twilio for numbers to reserve, listing
 *    the numbers the Twilio account already has - names a Call and SMS
 *    config and uses its credentials. It needs the read of incoming call
 *    policies and the read of call and SMS settings, as naming a setting
 *    that holds credentials does everywhere (RelationListPermission
 *    .mayReadTable).
 *  - CHANGING THEM - reserving a number, attaching one the account has, and
 *    releasing one - changes the policy. It needs the edit of incoming call
 *    policies, and the route then checks that one policy as an update of it
 *    would, its labels and owners included. Reserving a number is charged by
 *    Twilio to the Twilio account of the policy's config; OneUptime charges
 *    the project nothing for it, so no billing permission is asked.
 *
 * Each is the table half of what the CRUD path asks before the same
 * operation (Types/HeldPermissions): one of the model's own permissions for
 * it, and no team block with no labels on any of them. The server's route
 * guard (UserMiddleware.requireModelPermission) and the dashboard's number
 * picker read these lists, so the picker is offered to exactly the people
 * the routes let in.
 *
 * Kept free of server and React code.
 */

export enum IncomingCallPhoneNumberAction {
  // Search Twilio for numbers to reserve; list the numbers it already has.
  LookUp = "LookUp",
  // Reserve a number, attach one the Twilio account has, release one.
  Change = "Change",
}

// One operation an action needs, on one model, as the CRUD path asks it.
export interface IncomingCallPhoneNumberNeed {
  model: DatabaseBaseModel;
  operation: PermissionOperation;
}

/*
 * What a caller refused an action is told, by the server and in the
 * dashboard's English text.
 */
export const INCOMING_CALL_PHONE_NUMBER_REFUSALS: Readonly<
  Record<IncomingCallPhoneNumberAction, string>
> = {
  [IncomingCallPhoneNumberAction.LookUp]:
    "Looking up phone numbers needs permission to read incoming call policies and call and SMS settings.",
  [IncomingCallPhoneNumberAction.Change]:
    "Adding or releasing a phone number needs permission to edit incoming call policies.",
};

export default class IncomingCallPhoneNumberAccess {
  // The operations `action` needs, every one of them.
  public static getNeeds(
    action: IncomingCallPhoneNumberAction,
  ): Array<IncomingCallPhoneNumberNeed> {
    switch (action) {
      case IncomingCallPhoneNumberAction.LookUp:
        return [
          { model: new IncomingCallPolicy(), operation: "read" },
          { model: new ProjectCallSMSConfig(), operation: "read" },
        ];
      case IncomingCallPhoneNumberAction.Change:
        return [{ model: new IncomingCallPolicy(), operation: "update" }];
      default:
        return [];
    }
  }

  /*
   * Whether `held` (a caller's permissions in the project) lets them do
   * every one of `actions`: each operation they need held by the one rule.
   * An action nothing is listed for is held by nobody.
   */
  public static mayDo(
    held: HeldPermissions,
    actions: ReadonlyArray<IncomingCallPhoneNumberAction>,
  ): boolean {
    if (actions.length === 0) {
      return false;
    }

    return actions.every((action: IncomingCallPhoneNumberAction): boolean => {
      const needs: Array<IncomingCallPhoneNumberNeed> =
        IncomingCallPhoneNumberAccess.getNeeds(action);

      return (
        needs.length > 0 &&
        needs.every((need: IncomingCallPhoneNumberNeed): boolean => {
          return HeldPermissionsUtil.holdsModelPermission(held, {
            isOperationalResource: need.model.isOperationalResource,
            operation: need.operation,
            modelPermissions:
              IncomingCallPhoneNumberAccess.getPermissions(need),
          });
        })
      );
    });
  }

  // The permissions of the model's own list for the operation a need names.
  public static getPermissions(
    need: IncomingCallPhoneNumberNeed,
  ): Array<Permission> {
    switch (need.operation) {
      case "create":
        return need.model.getCreatePermissions() || [];
      case "read":
        return need.model.getReadPermissions() || [];
      case "update":
        return need.model.getUpdatePermissions() || [];
      case "delete":
        return need.model.getDeletePermissions() || [];
      default:
        return [];
    }
  }
}
