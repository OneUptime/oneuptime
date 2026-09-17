import NetworkDeviceRole from "Common/Models/DatabaseModels/NetworkDeviceRole";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";

/*
 * The device-role picker, shared by the create form on the Devices list, the
 * edit form on a device's Settings page and the adopt-a-neighbour modal, so
 * the three cannot drift.
 *
 * Roles used to be a fixed union and this file turned it into a static option
 * list at import time. They are now the per-project NetworkDeviceRole table,
 * so the options are whatever the project configured: the field is backed by
 * the model itself (dropdownModal), which loads and searches the rows
 * server-side and needs no option list here at all.
 *
 * "No role" is the empty value, and it is deliberately different from a role
 * called "Unknown". Empty means "no answer given - work it out from the
 * device's SNMP identity", which is the better answer whenever there is an
 * identity to read. That is why the field is never required and why its
 * placeholder says where the answer comes from instead.
 */

export const DEVICE_ROLE_FIELD_TITLE: string = "Device Role";

export const DEVICE_ROLE_FIELD_DESCRIPTION: string =
  "What this device does on the network. Leave it empty for SNMP devices — the role is read from their own identity, and that is more reliable than a guess. Set it for anything without SNMP to read: a ping-only device has no identity to classify, so without this it is drawn as an anonymous node and treated as top-of-network when the map lays out the hierarchy.";

export const DEVICE_ROLE_FIELD_PLACEHOLDER: string =
  "Worked out from the device (SNMP only)";

/*
 * The model-backed dropdown wiring, in one place. Spread into a form field
 * rather than exported as a whole field, because the three call sites differ
 * in the step they put it on.
 */
export const DEVICE_ROLE_DROPDOWN_MODAL: {
  type: typeof NetworkDeviceRole;
  labelField: string;
  valueField: string;
} = {
  type: NetworkDeviceRole,
  labelField: "name",
  valueField: "_id",
};

/*
 * Where an operator goes to add a role that is not in the list. Offered next
 * to the picker because the moment somebody wants a role that is not there is
 * exactly the moment they need this page.
 */
export type DeviceRoleSettingsLinkFunction = () => {
  text: string;
  url: Route;
  openLinkInNewTab: boolean;
};

export const getDeviceRoleSettingsLink: DeviceRoleSettingsLinkFunction = (): {
  text: string;
  url: Route;
  openLinkInNewTab: boolean;
} => {
  return {
    text: "Manage roles",
    url: RouteUtil.populateRouteParams(
      RouteMap[PageMap.NETWORK_DEVICE_SETTINGS_DEVICE_ROLES] as Route,
    ),
    openLinkInNewTab: true,
  };
};
