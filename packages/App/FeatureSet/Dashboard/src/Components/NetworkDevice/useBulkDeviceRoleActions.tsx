import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import IconProp from "Common/Types/Icon/IconProp";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import {
  DEVICE_ROLE_DROPDOWN_MODAL,
  DEVICE_ROLE_FIELD_TITLE,
  getDeviceRoleSettingsLink,
} from "./DeviceRoleFormFields";
import useBulkDeviceRelationActions, {
  BulkDeviceRelationActionsResult,
} from "./useBulkDeviceRelationActions";

/*
 * "Set Device Role" / "Clear Device Role" on Network -> Devices.
 *
 * "Select 20 switches and give them all the Access Switch role" - one
 * dialog, one save. The picker is the same one a device's Settings, the Add
 * Device form and the adopt-a-neighbour modal use (DeviceRoleFormFields), so
 * the four cannot drift: the project's own roles, with a link to the page
 * that adds one when the role wanted is not there yet.
 *
 * Clearing is a real choice, not a gap: a device without a role has it
 * worked out from its SNMP identity, which is the better answer wherever
 * there is an identity to read.
 */

export const SET_DEVICE_ROLE_ACTION_TITLE: string =
  translationKey("Set Device Role");

export const CLEAR_DEVICE_ROLE_ACTION_TITLE: string =
  translationKey("Clear Device Role");

export const SET_DEVICE_ROLE_DESCRIPTION: string = translationKey(
  "What the selected devices do on the network. It decides how the map draws them, where they sit in its hierarchy, and which alert policies scoped to a role cover them.",
);

export const CLEAR_DEVICE_ROLE_CONFIRM_TITLE: PluralTemplate = {
  one: "Clear the role of {{count}} device?",
  other: "Clear the role of {{count}} devices?",
};

export const CLEAR_DEVICE_ROLE_CONFIRM_MESSAGE: PluralTemplate = {
  one: "Its role is worked out from its SNMP identity again. A device with nothing to read - pinged only, or monitor-backed - is drawn as an unknown node on the map.",
  other:
    "Their roles are worked out from their SNMP identity again. A device with nothing to read - pinged only, or monitor-backed - is drawn as an unknown node on the map.",
};

function useBulkDeviceRoleActions(): BulkDeviceRelationActionsResult {
  return useBulkDeviceRelationActions({
    column: "networkDeviceRoleId",
    set: {
      title: SET_DEVICE_ROLE_ACTION_TITLE,
      icon: IconProp.Identification,
      description: SET_DEVICE_ROLE_DESCRIPTION,
      submitButtonText: "Set Role",
      field: {
        title: DEVICE_ROLE_FIELD_TITLE,
        placeholder: "Select a role",
        dropdownModal: DEVICE_ROLE_DROPDOWN_MODAL,
        sideLink: getDeviceRoleSettingsLink(),
      },
    },
    clear: {
      title: CLEAR_DEVICE_ROLE_ACTION_TITLE,
      icon: IconProp.LinkSlash,
      confirmTitle: CLEAR_DEVICE_ROLE_CONFIRM_TITLE,
      confirmMessage: CLEAR_DEVICE_ROLE_CONFIRM_MESSAGE,
    },
    hasRelation: (device: NetworkDevice): boolean => {
      return Boolean(device.networkDeviceRoleId || device.networkDeviceRole?._id);
    },
  });
}

export default useBulkDeviceRoleActions;
