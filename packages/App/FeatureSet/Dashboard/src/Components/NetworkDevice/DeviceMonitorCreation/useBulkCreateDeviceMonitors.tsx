import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import {
  BulkActionButtonSchema,
  BulkActionOnClickProps,
} from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import React, { ReactElement, useState } from "react";
import CreateDeviceMonitorsDialog from "./CreateDeviceMonitorsDialog";
import { CREATE_MONITORS_ACTION_TITLE } from "./DeviceMonitorCreationModel";

/*
 * "Create Monitors" in the Devices list's Bulk Actions (OneUptime issue
 * #10990): the selected devices - a search for "LANSW", a site, a role,
 * all of them - each get one monitor from a template, in a dialog of its
 * own that shows the run on the server (CreateDeviceMonitorsDialog).
 *
 * Creating monitors is the work, so the action is locked - with why - for a
 * reader who may not create monitors, as the server refuses them.
 */

export interface BulkCreateDeviceMonitorsResult {
  bulkActions: Array<BulkActionButtonSchema<NetworkDevice>>;
  modals: ReactElement;
}

export default function useBulkCreateDeviceMonitors(): BulkCreateDeviceMonitorsResult {
  const [devices, setDevices] = useState<Array<NetworkDevice> | null>(null);

  const gate: PermissionGateResult = PermissionGate.check(
    new Monitor(),
    ModelAction.Create,
  );

  const action: BulkActionButtonSchema<NetworkDevice> = {
    title: CREATE_MONITORS_ACTION_TITLE,
    buttonStyleType: ButtonStyleType.NORMAL,
    icon: IconProp.Activity,
    opensItsOwnDialog: true,
    onClick: async (
      actionProps: BulkActionOnClickProps<NetworkDevice>,
    ): Promise<void> => {
      setDevices([...actionProps.items]);
    },
  };

  /*
   * "Not allowed, and nothing honest to say" (the permissions are still
   * being read) leaves the action alone, as every bulk action here does.
   */
  const bulkActions: Array<BulkActionButtonSchema<NetworkDevice>> =
    gate.isAllowed || !gate.disabledReason
      ? [action]
      : [{ ...action, disabled: true, tooltip: gate.disabledReason }];

  return {
    bulkActions: bulkActions,
    modals: devices ? (
      <CreateDeviceMonitorsDialog
        devices={devices}
        onClose={(): void => {
          setDevices(null);
        }}
      />
    ) : (
      <></>
    ),
  };
}
