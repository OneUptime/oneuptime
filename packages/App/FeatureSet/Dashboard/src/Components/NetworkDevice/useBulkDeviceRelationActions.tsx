import { ReactElement } from "react";

import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IconProp from "Common/Types/Icon/IconProp";
import { BulkActionButtonSchema } from "Common/UI/Components/BulkUpdate/BulkUpdateForm";
import { FormFieldSideLink } from "Common/UI/Components/Forms/Types/Field";
import { PluralTemplate } from "Common/UI/Utils/TranslateTemplate";
import useBulkRelationActions from "../BulkRelation/useBulkRelationActions";
import { gateDeviceBulkAction } from "./BulkDeviceActionGate";

/*
 * "Set X" / "Clear X" over a selection of devices, for a relation a device
 * holds one of: its site, its role. The dialog, the write and why it goes
 * one device at a time are the shared relation actions'
 * (BulkRelation/useBulkRelationActions), which a site's parent and default
 * probe use too; each is locked for anyone who may not update a device.
 */

export interface BulkDeviceRelationActionsResult {
  bulkActions: Array<BulkActionButtonSchema<NetworkDevice>>;
  modals: ReactElement;
}

// The relation id columns these actions write.
export type DeviceRelationColumn = "siteId" | "networkDeviceRoleId";

export interface BulkDeviceRelationConfig {
  column: DeviceRelationColumn;
  set: {
    // The menu item and the dialog's title.
    title: string;
    icon: IconProp;
    description: string;
    submitButtonText: string;
    field: {
      title: string;
      description?: string | undefined;
      placeholder: string;
      dropdownModal: {
        type: DatabaseBaseModelType;
        labelField: string;
        valueField: string;
      };
      sideLink?: FormFieldSideLink | undefined;
    };
    // Drawn under the picker: where the same thing happens automatically.
    footer?: ReactElement | undefined;
  };
  clear: {
    title: string;
    icon: IconProp;
    confirmTitle: PluralTemplate;
    confirmMessage: PluralTemplate;
  };
  /*
   * The id of the relation a device holds, from its row, or null. "Clear" is
   * only offered to a selection where it would clear something, and a device
   * already in the state asked for is not written again.
   */
  readRelationId: (device: NetworkDevice) => string | null;
  // Why a device "Set" leaves alone: it already holds what was picked.
  alreadySetReason: string;
  // Why a device "Clear" leaves alone: it holds nothing to clear.
  notSetReason: string;
}

function useBulkDeviceRelationActions(
  config: BulkDeviceRelationConfig,
): BulkDeviceRelationActionsResult {
  return useBulkRelationActions<NetworkDevice>({
    ...config,
    modelType: NetworkDevice,
    gate: gateDeviceBulkAction,
  });
}

export default useBulkDeviceRelationActions;
