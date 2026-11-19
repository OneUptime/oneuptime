import { DeviceManagementConnectionStatus } from "Common/Types/DeviceManagement/DeviceManagementConnectionHealth";
import { DeviceManagementTestResult } from "Common/Types/DeviceManagement/DeviceManagementConnectionTest";
import {
  MANAGED_DEVICE_STATUS_LABELS,
  ManagedDeviceStatus,
  ManagedDeviceStatusTone,
  getManagedDeviceStatusTone,
} from "Common/Types/DeviceManagement/ManagedDeviceStatus";
import { ManagedDeviceHostMatch } from "Common/Types/DeviceManagement/ManagedDeviceIdentity";
import {
  MANAGED_DEVICE_OPERATING_SYSTEM_NAMES,
  MANAGED_DEVICE_PLATFORMS,
  ManagedDevicePlatform,
  getManagedDeviceOperatingSystemName,
} from "Common/Types/DeviceManagement/ManagedDevicePlatform";
import { JSONObject } from "Common/Types/JSON";
import { LlmConnectionFailureKind } from "Common/Types/LlmObservability/LlmConnectionTest";
import { PluralTemplate, translationKey } from "Common/Types/Translator";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { PillTone } from "Common/UI/Components/Pill/PillTone";

/*
 * The words Inventory > Managed Devices and a device's card say, in one
 * place: English keys, looked up in the reader's language where they are
 * drawn. Pure, so the tests read them as the pages do.
 */

export interface DeviceManagementHealthWords {
  label: string;
  tone: PillTone;
  tooltip: string;
}

/*
 * A connection's health as its row says it. Red only for a read that
 * failed; a connection someone turned off is grey (Paused), never red.
 */
export function getDeviceManagementHealthWords(
  status: DeviceManagementConnectionStatus,
): DeviceManagementHealthWords {
  switch (status) {
    case DeviceManagementConnectionStatus.Off:
      return {
        label: translationKey("Off"),
        tone: PillTone.Paused,
        tooltip: translationKey(
          "Not read on its schedule. Turn it on to read it again.",
        ),
      };
    case DeviceManagementConnectionStatus.Waiting:
      return {
        label: translationKey("Waiting"),
        tone: PillTone.Info,
        tooltip: translationKey(
          "Saved. Its first read starts within a minute.",
        ),
      };
    case DeviceManagementConnectionStatus.Partial:
      return {
        label: translationKey("Catching up"),
        tone: PillTone.Info,
        tooltip: translationKey(
          "The last read worked. Some devices' apps wait for the next read, a minute from now.",
        ),
      };
    case DeviceManagementConnectionStatus.Failing:
      return {
        label: translationKey("Failing"),
        tone: PillTone.Danger,
        tooltip: translationKey(
          "The last read failed. View the error to see why.",
        ),
      };
    case DeviceManagementConnectionStatus.Stale:
      return {
        label: translationKey("Stale"),
        tone: PillTone.Warning,
        tooltip: translationKey(
          "No read has worked for a while, so the devices may be out of date. Check that the OneUptime workers are running.",
        ),
      };
    default:
      return {
        label: translationKey("Healthy"),
        tone: PillTone.Success,
        tooltip: translationKey("The last read worked."),
      };
  }
}

export interface DeviceManagementTestWords {
  // What happened, in the reader's language.
  headline: string;
  // What to do about it, in the reader's language.
  advice?: string | undefined;
}

/*
 * Why a test or a read failed, and what to do, by the kind of failure:
 * the server's own message, in English, goes under these.
 */
export function getDeviceManagementFailureWords(
  failureKind: LlmConnectionFailureKind | undefined,
): DeviceManagementTestWords {
  switch (failureKind) {
    case LlmConnectionFailureKind.Authentication:
      return {
        headline: translationKey("Esper refused the API key."),
        advice: translationKey(
          "Copy the key again from API Key Management in the Esper console, or make a new one.",
        ),
      };
    case LlmConnectionFailureKind.Permission:
      return {
        headline: translationKey("The API key's user may not read devices."),
        advice: translationKey(
          "Use a key of a user whose Esper role can read devices, groups and apps.",
        ),
      };
    case LlmConnectionFailureKind.Settings:
      return {
        headline: translationKey("Check the tenant and the API key."),
        advice: translationKey(
          "The tenant is the name before .esper.cloud in your Esper console's address. Make a key in the Esper console under API Key Management.",
        ),
      };
    case LlmConnectionFailureKind.RateLimited:
      return {
        headline: translationKey("Esper asked OneUptime to slow down."),
        advice: translationKey("Try again in a minute."),
      };
    default:
      return {
        headline: translationKey("OneUptime could not reach Esper."),
        advice: translationKey(
          "Check the tenant: it is the name before .esper.cloud in your Esper console's address. If it is right, Esper may be down: try again in a few minutes.",
        ),
      };
  }
}

// A test that passed: how many devices a read will import.
export const TEST_PASSED_WITH_DEVICES: PluralTemplate = {
  one: "Connected. {{count}} device to import.",
  other: "Connected. {{count}} devices to import.",
};

export const TEST_PASSED: string = translationKey("Connected.");

// The words a test result is drawn with.
export function getDeviceManagementTestWords(
  result: DeviceManagementTestResult,
): DeviceManagementTestWords {
  if (result.status === "pass") {
    return { headline: TEST_PASSED };
  }

  return getDeviceManagementFailureWords(result.failureKind);
}

export interface ManagedDeviceStatusWords {
  label: string;
  tone: PillTone;
}

const TONES: Record<ManagedDeviceStatusTone, PillTone> = {
  success: PillTone.Success,
  danger: PillTone.Danger,
  info: PillTone.Info,
  paused: PillTone.Paused,
};

// A device's status as its pill says it.
export function getManagedDeviceStatusWords(
  status: ManagedDeviceStatus,
): ManagedDeviceStatusWords {
  return {
    label: MANAGED_DEVICE_STATUS_LABELS[status],
    tone: TONES[getManagedDeviceStatusTone(status)],
  };
}

// How a device's host in Inventory was found, as its card says it.
export function getManagedDeviceMatchWords(
  match: ManagedDeviceHostMatch | undefined,
): string | undefined {
  switch (match) {
    case ManagedDeviceHostMatch.Name:
      return translationKey("Telemetry names it by its Esper name");
    case ManagedDeviceHostMatch.SerialNumber:
      return translationKey("Telemetry names it by its serial number");
    case ManagedDeviceHostMatch.Created:
      return translationKey("No telemetry from it yet");
    default:
      return undefined;
  }
}

// What a device runs, for the devices list's Platform filter: product names, as written.
export const MANAGED_DEVICE_PLATFORM_OPTIONS: Array<DropdownOption> =
  MANAGED_DEVICE_PLATFORMS.map(
    (platform: ManagedDevicePlatform): DropdownOption => {
      return platform === ManagedDevicePlatform.Other
        ? { value: platform, label: translationKey("Other") }
        : {
            value: platform,
            label: MANAGED_DEVICE_OPERATING_SYSTEM_NAMES[platform],
            isUserContent: true,
          };
    },
  );

/*
 * What a device runs, its version after its name: "iOS 17.4", "Android 13".
 * A product name and a version, the same in every language; a version that
 * names its system already ("Windows 11 Pro") is not named twice.
 */
export function getManagedDeviceOperatingSystemLine(device: {
  platform?: string | undefined | null;
  osVersion?: string | undefined | null;
  details?: JSONObject | undefined | null;
}): string {
  const details: JSONObject =
    device.details && typeof device.details === "object"
      ? (device.details as JSONObject)
      : {};
  const serviceOperatingSystem: unknown = details["operatingSystem"];
  const name: string = getManagedDeviceOperatingSystemName({
    platform: device.platform,
    serviceOperatingSystem:
      typeof serviceOperatingSystem === "string"
        ? serviceOperatingSystem
        : undefined,
  });
  const version: string = (device.osVersion || "").trim();

  if (!name || version.toLowerCase().startsWith(name.toLowerCase())) {
    return version;
  }

  return version ? `${name}\u00A0${version}` : name;
}

/*
 * The choices of how often a connection is read, under its "Read every"
 * label: worded as a cloud connection's are.
 */
export const READ_INTERVAL_WORDS: Record<number, string> = {
  5: translationKey("5 minutes"),
  10: translationKey("10 minutes"),
  15: translationKey("15 minutes"),
  30: translationKey("30 minutes"),
  60: translationKey("1 hour"),
};
