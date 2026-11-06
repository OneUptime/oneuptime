import { getMultiDeviceSnmpWalkRoute } from "./MultiDeviceSnmpWalkRoute";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiagnostic from "Common/Models/DatabaseModels/NetworkDeviceDiagnostic";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";

/*
 * The Devices list's way to the Network's SNMP Walk page (issue #5548):
 * select the devices - by ticking rows, or every device the list's filters
 * match, such as every router or every device at a site - and Bulk Actions,
 * SNMP Walk opens the page with them picked. Nothing is walked yet: the
 * page asks where to start, and the reader presses Walk.
 *
 * So the action changes nothing and asks nothing first, even over rows the
 * page does not show: the walk page is where the selection is read, and it
 * says when there are more devices than one walk takes.
 */

export interface BulkSnmpWalkResult {
  bulkActions: Array<BulkActionButtonSchema<NetworkDevice>>;
}

function useBulkSnmpWalk(): BulkSnmpWalkResult {
  /*
   * A walk is a Network Device Diagnostic each device's probe runs, so the
   * action is locked - with why - for a reader who may not create one, as
   * the Walk button is hidden from them on a device's own page.
   */
  const walkGate: PermissionGateResult = PermissionGate.check(
    new NetworkDeviceDiagnostic(),
    ModelAction.Create,
  );

  const walkAction: BulkActionButtonSchema<NetworkDevice> = {
    title: "SNMP Walk",
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: IconProp.Search,
    opensItsOwnDialog: true,
    onClick: async (
      actionProps: BulkActionOnClickProps<NetworkDevice>,
    ): Promise<void> => {
      const deviceIds: Array<string> = actionProps.items
        .map((item: NetworkDevice): string => {
          return item._id?.toString() || "";
        })
        .filter((id: string): boolean => {
          return id.length > 0;
        });

      Navigation.navigate(
        getMultiDeviceSnmpWalkRoute({ deviceIds: deviceIds, startOid: "" }),
      );
    },
  };

  if (walkGate.isAllowed || !walkGate.disabledReason) {
    return { bulkActions: [walkAction] };
  }

  return {
    bulkActions: [
      {
        ...walkAction,
        disabled: true,
        tooltip: walkGate.disabledReason,
      },
    ],
  };
}

export default useBulkSnmpWalk;
