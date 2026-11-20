import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import { BulkActionButtonSchema } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";

/*
 * The Sites list's Set and Clear Parent Site and Default Probe (#10188)
 * update the sites they touch, so each is locked, with the reason on hover,
 * for anyone who may not update a site - as a device's are
 * (BulkDeviceActionGate). The server refuses the write anyway; this says so
 * before the dialog is filled in rather than after. Read when the action is
 * built, on render.
 */
export function gateSiteBulkAction(
  action: BulkActionButtonSchema<NetworkSite>,
): BulkActionButtonSchema<NetworkSite> {
  const updateGate: PermissionGateResult = PermissionGate.check(
    new NetworkSite(),
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
