import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import { BulkActionButtonSchema } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";

/*
 * Bulk actions are handed straight to the table's action bar, which never
 * looks at permissions - so without this a viewer could still re-point every
 * device they had selected. Every device bulk action is an update of the
 * devices it touches, so each is locked, with the reason on hover, for
 * anyone who may not update a device. The server refuses the write anyway;
 * this says so before the dialog is filled in rather than after.
 *
 * Read when the action is built (on render), like the other device bulk
 * actions, so a permission change is picked up the next time the page draws.
 */
export function gateDeviceBulkAction(
  action: BulkActionButtonSchema<NetworkDevice>,
): BulkActionButtonSchema<NetworkDevice> {
  const updateGate: PermissionGateResult = PermissionGate.check(
    new NetworkDevice(),
    ModelAction.Update,
  );

  if (updateGate.isAllowed || !updateGate.disabledReason) {
    return action;
  }

  return {
    ...action,
    disabled: true,
    tooltip: updateGate.disabledReason,
  };
}
