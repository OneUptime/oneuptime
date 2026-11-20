import { DEVICE_MANAGEMENT_READ_INTERVALS_IN_MINUTES } from "Common/Types/DeviceManagement/DeviceManagementConnectionSettings";
import HashedString from "Common/Types/HashedString";
import { JSONValue } from "Common/Types/JSON";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { READ_INTERVAL_WORDS } from "./DeviceManagementWords";

/*
 * What every device manager's form shares (Intune, Workspace ONE, SOTI):
 * how a value it submitted is read, and the choices of how often a
 * connection is read. Pure, so the forms' tests read them as the forms do.
 */

/*
 * A text value a form submitted, trimmed. BasicForm wraps a Password
 * field's value in HashedString before submit: that one is kept exactly as
 * typed, since a space at either end can be part of a password.
 */
export function readDeviceManagerFormText(
  value: JSONValue | undefined,
): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof HashedString) {
    return value.toString();
  }

  return typeof value === "string" ? value.trim() : String(value).trim();
}

// The choices of how often a connection is read, under its "Read every" label.
export function getDeviceManagerIntervalOptions(): Array<DropdownOption> {
  return DEVICE_MANAGEMENT_READ_INTERVALS_IN_MINUTES.map(
    (minutes: number): DropdownOption => {
      return {
        value: minutes,
        label: READ_INTERVAL_WORDS[minutes] || String(minutes),
      };
    },
  );
}
