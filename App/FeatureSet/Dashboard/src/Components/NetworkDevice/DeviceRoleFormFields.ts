import { NetworkTopologyDeviceRole } from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  DEVICE_ROLES_IN_LEGEND_ORDER,
  labelForDeviceRole,
} from "Common/Utils/Monitor/NetworkDeviceRoleUtil";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

/*
 * The device-role picker, shared by the create form on the Devices list and
 * the edit form on a device's Settings page so the two cannot drift.
 *
 * Built from DEVICE_ROLES_IN_LEGEND_ORDER and DEVICE_ROLE_LABELS rather than
 * hand-listed, so a role added to the classifier turns up here, in the map
 * legend and in the node shapes at once instead of in two of the three.
 *
 * "Unknown" is deliberately not offered. The empty value already means
 * "no override — work it out from SNMP", and an explicit "unknown" would
 * mean something subtly different and much less useful: stop classifying
 * and draw a neutral node forever.
 */
export const DEVICE_ROLE_OPTIONS: Array<DropdownOption> =
  DEVICE_ROLES_IN_LEGEND_ORDER.map((role: NetworkTopologyDeviceRole) => {
    return {
      value: role,
      label: labelForDeviceRole(role),
    };
  });

export const DEVICE_ROLE_FIELD_TITLE: string = "Device Role";

export const DEVICE_ROLE_FIELD_DESCRIPTION: string =
  "What this device does on the network. Leave it empty for SNMP devices — the role is read from their own identity, and that is more reliable than a guess. Set it for anything without SNMP to read: a ping-only device has no identity to classify, so without this it is drawn as an anonymous node and treated as top-of-network when the map lays out the hierarchy.";
