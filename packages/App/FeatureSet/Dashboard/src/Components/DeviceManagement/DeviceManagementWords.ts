import { DeviceManagementConnectionStatus } from "Common/Types/DeviceManagement/DeviceManagementConnectionHealth";
import { DeviceManagementTestResult } from "Common/Types/DeviceManagement/DeviceManagementConnectionTest";
import DeviceManagementProvider from "Common/Types/DeviceManagement/DeviceManagementProvider";
import IconProp from "Common/Types/Icon/IconProp";
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
 * Why an Intune test or read failed, and what to do (#9837): Microsoft
 * Entra signs OneUptime in, and Microsoft Graph answers.
 */
function getIntuneFailureWords(
  failureKind: LlmConnectionFailureKind | undefined,
): DeviceManagementTestWords {
  switch (failureKind) {
    case LlmConnectionFailureKind.Authentication:
      return {
        headline: translationKey("Microsoft Entra refused the client secret."),
        advice: translationKey(
          "Copy the secret's value again from Certificates & secrets on the app registration, or make a new one: a secret stops working when it expires.",
        ),
      };
    case LlmConnectionFailureKind.Permission:
      return {
        headline: translationKey(
          "The app registration may not read Intune's devices.",
        ),
        advice: translationKey(
          "Give it the application permission DeviceManagementManagedDevices.Read.All on Microsoft Graph, and grant admin consent.",
        ),
      };
    case LlmConnectionFailureKind.Settings:
      return {
        headline: translationKey(
          "Check the tenant ID, the client ID and the cloud.",
        ),
        advice: translationKey(
          "All three are on the app registration's Overview in the Microsoft Entra admin center.",
        ),
      };
    case LlmConnectionFailureKind.RateLimited:
      return {
        headline: translationKey(
          "Microsoft Graph asked OneUptime to slow down.",
        ),
        advice: translationKey("Try again in a minute."),
      };
    default:
      return {
        headline: translationKey("OneUptime could not reach Microsoft Graph."),
        advice: translationKey(
          "Check the cloud the tenant is in. If it is right, Microsoft may be having trouble: try again in a few minutes.",
        ),
      };
  }
}

/*
 * Why a Workspace ONE UEM test or read failed, and what to do (#10086):
 * OneUptime signs in with an OAuth client or an administrator's account,
 * and the tenant's API server answers.
 */
function getWorkspaceOneFailureWords(
  failureKind: LlmConnectionFailureKind | undefined,
): DeviceManagementTestWords {
  switch (failureKind) {
    case LlmConnectionFailureKind.Authentication:
      return {
        headline: translationKey("Workspace ONE refused OneUptime's sign-in."),
        advice: translationKey(
          "Copy the OAuth client's ID and secret again and check its region, or check the administrator's username, password and REST API key.",
        ),
      };
    case LlmConnectionFailureKind.Permission:
      return {
        headline: translationKey(
          "OneUptime's admin role may not read Workspace ONE's devices.",
        ),
        advice: translationKey(
          "Give the role Read on Devices and Apps under its REST API permissions, at the organization group whose devices OneUptime reads.",
        ),
      };
    case LlmConnectionFailureKind.Settings:
      return {
        headline: translationKey("Check the REST API URL."),
        advice: translationKey(
          "Workspace ONE shows it in its REST API settings, like https://as1234.awmdm.com. OneUptime Cloud reads servers on the public internet only.",
        ),
      };
    case LlmConnectionFailureKind.RateLimited:
      return {
        headline: translationKey("Workspace ONE asked OneUptime to slow down."),
        advice: translationKey(
          "Try again in a minute. If the tenant's daily API quota is used up, reads start again once it resets.",
        ),
      };
    default:
      return {
        headline: translationKey("OneUptime could not reach Workspace ONE."),
        advice: translationKey(
          "Check the REST API URL. If it is right, the server may be having trouble: try again in a few minutes.",
        ),
      };
  }
}

/*
 * Why a SOTI MobiControl test or read failed, and what to do (#10087): an
 * API client and a MobiControl user sign OneUptime in at the server.
 */
function getSotiFailureWords(
  failureKind: LlmConnectionFailureKind | undefined,
): DeviceManagementTestWords {
  switch (failureKind) {
    case LlmConnectionFailureKind.Authentication:
      return {
        headline: translationKey("MobiControl refused OneUptime's sign-in."),
        advice: translationKey(
          "Check the API client's ID and secret, and the user's username and password. The user must be a MobiControl user with Web Console Access.",
        ),
      };
    case LlmConnectionFailureKind.Permission:
      return {
        headline: translationKey(
          "The MobiControl user may not read the devices.",
        ),
        advice: translationKey(
          "Give it Web Console Access and View Installed Applications, and View Groups on the device groups to read.",
        ),
      };
    case LlmConnectionFailureKind.Settings:
      return {
        headline: translationKey("Check the server's address."),
        advice: translationKey(
          "It is the address of the MobiControl web console, without /MobiControl. OneUptime Cloud reads servers on the public internet only.",
        ),
      };
    case LlmConnectionFailureKind.RateLimited:
      return {
        headline: translationKey("MobiControl asked OneUptime to slow down."),
        advice: translationKey("Try again in a minute."),
      };
    default:
      return {
        headline: translationKey("OneUptime could not reach MobiControl."),
        advice: translationKey(
          "Check the server's address. If it is right, the server may be having trouble: try again in a few minutes.",
        ),
      };
  }
}

/*
 * Why a test or a read failed, and what to do, by the kind of failure and
 * the connection's service (Esper's when none is said): the server's own
 * message, in English, goes under these.
 */
export function getDeviceManagementFailureWords(
  failureKind: LlmConnectionFailureKind | undefined,
  provider?: DeviceManagementProvider | string | undefined,
): DeviceManagementTestWords {
  if (provider === DeviceManagementProvider.Intune) {
    return getIntuneFailureWords(failureKind);
  }

  if (provider === DeviceManagementProvider.WorkspaceOne) {
    return getWorkspaceOneFailureWords(failureKind);
  }

  if (provider === DeviceManagementProvider.Soti) {
    return getSotiFailureWords(failureKind);
  }

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

  return getDeviceManagementFailureWords(result.failureKind, result.provider);
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
  provider?: DeviceManagementProvider | string | undefined,
): string | undefined {
  switch (match) {
    case ManagedDeviceHostMatch.Name:
      switch (provider) {
        case DeviceManagementProvider.Intune:
          return translationKey("Telemetry names it by its Intune name");
        case DeviceManagementProvider.WorkspaceOne:
          return translationKey("Telemetry names it by its Workspace ONE name");
        case DeviceManagementProvider.Soti:
          return translationKey("Telemetry names it by its MobiControl name");
        default:
          return translationKey("Telemetry names it by its Esper name");
      }
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
 * The device managers a project can connect, as "Connect device manager"
 * offers them: each by its product name, what it imports and how
 * OneUptime signs in. Drawn with OneUptime's own icons: none of the brands
 * has a one-colour mark OneUptime may draw (Common/Types/ProviderLogo).
 */
/*
 * The connections list's button ("Connect" and its singularName, "device
 * manager"), as one phrase: translateCreateAction looks the whole phrase up
 * before it fills the verb's template, so each language words it whole.
 */
export const CONNECT_DEVICE_MANAGER: string = translationKey(
  "Connect device manager",
);

export interface DeviceManagementProviderChoice {
  provider: DeviceManagementProvider;
  description: string;
  icon: IconProp;
}

export const DEVICE_MANAGEMENT_PROVIDER_CHOICES: ReadonlyArray<DeviceManagementProviderChoice> =
  [
    {
      provider: DeviceManagementProvider.Esper,
      description: translationKey(
        "Android devices, iPhones, iPads and Apple TVs, read with an API key.",
      ),
      icon: IconProp.DevicePhoneMobile,
    },
    {
      provider: DeviceManagementProvider.Intune,
      description: translationKey(
        "Windows PCs, Macs, iPhones, iPads and Android devices, read through Microsoft Graph with an app registration.",
      ),
      icon: IconProp.ComputerDesktop,
    },
    {
      provider: DeviceManagementProvider.WorkspaceOne,
      description: translationKey(
        "Phones, tablets and computers, read through the Workspace ONE REST API with an OAuth client.",
      ),
      icon: IconProp.DeviceTablet,
    },
    {
      provider: DeviceManagementProvider.Soti,
      description: translationKey(
        "Rugged devices, phones, tablets and computers, read from your MobiControl server with an API client.",
      ),
      icon: IconProp.Signal,
    },
  ];

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
