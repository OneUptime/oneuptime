import { getManagedDeviceStorageDetails } from "../../../../Types/DeviceManagement/ManagedDeviceCheckIn";
import {
  ManagedDevicePlatform,
  readManagedDevicePlatformFromName,
} from "../../../../Types/DeviceManagement/ManagedDevicePlatform";
import { JSONObject } from "../../../../Types/JSON";
import {
  MAX_LONG_TEXT_LENGTH,
  MAX_SHORT_TEXT_LENGTH,
  cleanText,
  normalizeMacAddress,
} from "../Esper/EsperParsers";
import {
  ProviderApp,
  ProviderCheckIn,
  ProviderDevice,
  ProviderGroup,
} from "../DeviceManagementTypes";

/*
 * Microsoft Graph's Intune answers, read into the connector contract's
 * plain shapes (DeviceManagementTypes). Pure, so every rule is tested on
 * payloads shaped as Microsoft's reference shows them:
 *
 *   - a device: v1.0 managedDevice (learn.microsoft.com/graph/api/
 *     resources/intune-devices-manageddevice). Its lastSyncDateTime is when
 *     it last checked in with Intune; "0001-01-01T00:00:00Z" is Graph's
 *     never.
 *   - an app: the detectedApp Intune discovered on the device (beta's
 *     managedDevice detectedApps).
 *
 * Every text is cleaned and bounded; a value Graph did not give is "" (a
 * number or a date, null). A device's user - its name, its email, its
 * phone number - is never read into OneUptime.
 */

// Intune's device category when none was given: no group.
const NO_CATEGORY: string = "unknown";

// Before this, a date Graph gives is its "never" (year 1), not a date.
const EARLIEST_DATE_MS: number = Date.UTC(2000, 0, 1);

function asObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function readNumber(value: unknown): number | null {
  const parsed: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;

  return Number.isFinite(parsed) ? parsed : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

// A date Graph gave, or null for none, for nonsense and for Graph's never.
export function readGraphDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const time: number = Date.parse(value.trim());

  return Number.isNaN(time) || time < EARLIEST_DATE_MS ? null : new Date(time);
}

// Bytes as gigabytes, to one decimal: "" for none or zero.
function bytesToGigabytes(value: unknown): string {
  const bytes: number | null = readNumber(value);

  if (bytes === null || bytes <= 0) {
    return "";
  }

  return String(Math.round((bytes / 1e9) * 10) / 10);
}

/*
 * What a device runs, by Intune's operatingSystem ("Windows", "iOS",
 * "macOS", "Android", "AndroidForWork", "Linux"...). Intune names an iPad's
 * system iOS on older enrollments: its model says it is an iPad.
 */
export function readIntunePlatform(data: {
  operatingSystem: unknown;
  model: unknown;
}): ManagedDevicePlatform {
  const platform: ManagedDevicePlatform = readManagedDevicePlatformFromName(
    data.operatingSystem,
  );
  const model: string =
    typeof data.model === "string" ? data.model.trim().toLowerCase() : "";

  if (platform === ManagedDevicePlatform.IOS && model.startsWith("ipad")) {
    return ManagedDevicePlatform.IPadOS;
  }

  return platform;
}

// A device's category, as its group: none when Intune says "Unknown".
export function readIntuneCategory(value: unknown): string {
  const category: string = cleanText(value);

  return category.toLowerCase() === NO_CATEGORY ? "" : category;
}

export interface IntuneDeviceRead {
  device: ProviderDevice;
  // When it last checked in with Intune, never later than `now`; null for never.
  lastSyncAt: Date | null;
}

/*
 * One device of Intune's list, or null when it is not one (no ID). Every
 * platform Intune manages is imported.
 */
export function parseIntuneDevice(
  value: unknown,
  now: Date,
): IntuneDeviceRead | null {
  const raw: JSONObject = asObject(value);
  const providerDeviceId: string = cleanText(raw["id"]);

  if (!providerDeviceId) {
    return null;
  }

  const platform: ManagedDevicePlatform = readIntunePlatform({
    operatingSystem: raw["operatingSystem"],
    model: raw["model"],
  });
  const lastSync: Date | null = readGraphDate(raw["lastSyncDateTime"]);
  const category: string = readIntuneCategory(raw["deviceCategoryDisplayName"]);
  const details: JSONObject = {};

  const keep: (key: string, text: unknown) => void = (
    key: string,
    text: unknown,
  ): void => {
    if (typeof text === "boolean") {
      details[key] = text;
      return;
    }

    const cleaned: string = cleanText(text);

    if (cleaned) {
      details[key] = cleaned;
    }
  };

  keep("operatingSystem", raw["operatingSystem"]);
  keep("complianceState", raw["complianceState"]);
  keep("ownership", raw["managedDeviceOwnerType"]);
  keep("enrollmentType", raw["deviceEnrollmentType"]);
  keep("enrollmentProfileName", raw["enrollmentProfileName"]);
  keep("managementAgent", raw["managementAgent"]);
  keep("deviceRegistrationState", raw["deviceRegistrationState"]);
  keep("azureADDeviceId", raw["azureADDeviceId"]);
  keep("jailBroken", raw["jailBroken"]);
  keep("isEncrypted", readBoolean(raw["isEncrypted"]) ?? undefined);
  keep("isSupervised", readBoolean(raw["isSupervised"]) ?? undefined);
  keep("totalStorage", bytesToGigabytes(raw["totalStorageSpaceInBytes"]));
  keep("freeStorage", bytesToGigabytes(raw["freeStorageSpaceInBytes"]));

  if (details["totalStorage"]) {
    details["memoryUnits"] = "GB";
  }

  /*
   * In bytes, as Graph gives them, for how full it is (#10008). Graph's
   * free space is 0 until the device reports it: that is no figure.
   * Intune's device list says nothing of a battery: an iPhone's or an
   * iPad's is asked of the device alone (parseIntuneBatteryLevel, #10287).
   */
  Object.assign(
    details,
    getManagedDeviceStorageDetails({
      totalBytes: readNumber(raw["totalStorageSpaceInBytes"]),
      freeBytes: readNumber(raw["freeStorageSpaceInBytes"]),
    }),
  );

  const meid: string = cleanText(raw["meid"]);

  if (meid) {
    details["meid"] = meid;
  }

  return {
    device: {
      providerDeviceId,
      platform,
      /*
       * Not managedDeviceName, which Intune makes of its user's name
       * ("megan_Windows_3/4/2025_9:12 AM"): a device with no name is named
       * by its serial number (getManagedDeviceHostName).
       */
      deviceName: cleanText(raw["deviceName"]),
      alias: "",
      serialNumber: cleanText(raw["serialNumber"]),
      imei: cleanText(raw["imei"]),
      manufacturer: cleanText(raw["manufacturer"]),
      brand: "",
      model: cleanText(raw["model"]),
      osVersion: cleanText(raw["osVersion"]),
      buildNumber: "",
      securityPatchLevel:
        platform === ManagedDevicePlatform.Android
          ? cleanText(raw["androidSecurityPatchLevel"])
          : "",
      agentVersion: "",
      state: null,
      groupId: category,
      isKioskMode: null,
      batteryLevel: null,
      ipAddresses: [],
      macAddress:
        normalizeMacAddress(raw["wiFiMacAddress"]) ||
        normalizeMacAddress(raw["ethernetMacAddress"]),
      provisionedAt: readGraphDate(raw["enrolledDateTime"]),
      details,
    },
    lastSyncAt: lastSync && lastSync.getTime() > now.getTime() ? now : lastSync,
  };
}

/*
 * The devices' categories as groups: Intune's categories are the one
 * grouping its device list carries (its Microsoft Entra groups are not
 * read). Named as they are, each once.
 */
export function getIntuneGroups(
  devices: ReadonlyArray<ProviderDevice>,
): Array<ProviderGroup> {
  const groups: Map<string, ProviderGroup> = new Map<string, ProviderGroup>();

  for (const device of devices) {
    if (device.groupId && !groups.has(device.groupId)) {
      groups.set(device.groupId, {
        id: device.groupId,
        name: device.groupId,
        path: device.groupId,
      });
    }
  }

  return Array.from(groups.values());
}

// Each device's last check-in, for the devices that have one.
export function getIntuneCheckIns(
  reads: ReadonlyArray<IntuneDeviceRead>,
): Array<ProviderCheckIn> {
  const checkIns: Array<ProviderCheckIn> = [];

  for (const read of reads) {
    if (read.lastSyncAt) {
      checkIns.push({
        providerDeviceId: read.device.providerDeviceId,
        lastCheckInAt: read.lastSyncAt,
      });
    }
  }

  return checkIns;
}

/*
 * One app Intune discovered on a device, or null when it has no name.
 * Intune keys a discovered app by its name and version, not a package, so
 * its name is its key: "Microsoft Edge", "com.contoso.kiosk".
 */
export function parseIntuneDetectedApp(value: unknown): ProviderApp | null {
  const app: JSONObject = asObject(value);
  const name: string = cleanText(app["displayName"], MAX_LONG_TEXT_LENGTH);

  if (!name) {
    return null;
  }

  return {
    packageName: name,
    appName: cleanText(app["displayName"], MAX_SHORT_TEXT_LENGTH),
    versionName: cleanText(app["version"]),
    versionCode: "",
    state: "",
    isKioskApp: false,
    isManagedByService: false,
  };
}

/*
 * The apps of one device, as beta's managedDevice?$expand=detectedApps
 * answers them: the device, with its `detectedApps` beside its own fields.
 * One per name, as a device's apps are kept: the first version listed.
 */
export function parseIntuneDetectedApps(value: unknown): Array<ProviderApp> {
  const list: unknown = asObject(value)["detectedApps"];
  const apps: Array<ProviderApp> = [];
  const seen: Set<string> = new Set<string>();

  if (!Array.isArray(list)) {
    return apps;
  }

  for (const item of list) {
    const app: ProviderApp | null = parseIntuneDetectedApp(item);

    if (!app) {
      continue;
    }

    if (seen.has(app.packageName)) {
      continue;
    }

    seen.add(app.packageName);
    apps.push(app);
  }

  return apps;
}

/*
 * One device's battery, in percent, as beta's single-device GET with
 * $select=id,hardwareInformation answers it (#10287): its
 * hardwareInformation.batteryLevelPercentage, "between 0.0 and 100, or
 * null if the battery level cannot be determined", which Intune fills per
 * check-in, on iOS and iPadOS alone, and only where it has the device's
 * Device Information access right. Whole, 1 to 100; null for none, for 0
 * (no device at 0% checks in) and for anything else. The device at the
 * answer's top level, or under "value" as the reference's example writes
 * it.
 */
export function parseIntuneBatteryLevel(value: unknown): number | null {
  const answer: JSONObject = asObject(value);
  const device: JSONObject =
    answer["hardwareInformation"] === undefined &&
    asObject(answer["value"])["hardwareInformation"] !== undefined
      ? asObject(answer["value"])
      : answer;
  const level: number | null = readNumber(
    asObject(device["hardwareInformation"])["batteryLevelPercentage"],
  );

  if (level === null || level <= 0 || level > 100) {
    return null;
  }

  return Math.max(1, Math.round(level));
}

/*
 * What managedDeviceOverview says the tenant has: its enrolled devices
 * (deviceManagement/managedDeviceOverview), or undefined when it says
 * nothing that can be read.
 */
export function parseIntuneEnrolledDeviceCount(
  value: unknown,
): number | undefined {
  const count: number | null = readNumber(
    asObject(value)["enrolledDeviceCount"],
  );

  return count !== null && count >= 0 ? Math.floor(count) : undefined;
}
