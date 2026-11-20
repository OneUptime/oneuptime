import { getManagedDeviceStorageDetails } from "../../../../Types/DeviceManagement/ManagedDeviceCheckIn";
import {
  ManagedDevicePlatform,
  readManagedDevicePlatformFromName,
} from "../../../../Types/DeviceManagement/ManagedDevicePlatform";
import { JSONObject } from "../../../../Types/JSON";
import {
  MAX_IP_ADDRESSES,
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
 * WORKSPACE ONE UEM'S ANSWERS, READ WITHOUT TRUSTING THEM (#10086).
 *
 * Every field is named as Omnissa's MDM REST API V1 reference documents it
 * (developer.omnissa.com, release 2607):
 *
 *   - a device: DeviceExtended, as GET /api/mdm/devices/search lists it,
 *     a page at a time ({"Devices": [...], "Page", "PageSize", "Total"}).
 *     Its LastSeen is "the time the device last reported any status with
 *     AirWatch", written in UTC without a zone; "0001-01-01T00:00:00" is
 *     never.
 *   - an app: DeviceApplicationInfo, as GET /api/mdm/devices/{id}/apps
 *     lists a device's ({"DeviceApps": [...], "Page", "PageSize",
 *     "Total"}).
 *
 * A device that is not enrolled (unenrolled, wiped, or still enrolling)
 * stays in Workspace ONE's list until someone deletes it, but is no device
 * Workspace ONE manages: it is left out, as if it had left the list.
 *
 * Nothing about a device's user is read: not its enrollment user's name,
 * email or phone number, and not its friendly name, which Workspace ONE
 * makes of the enrollment user's name by default. A device is named by the
 * name it reports (DeviceReportedName), else by its serial number.
 */

// Before this, a date Workspace ONE gives is its "never" (year 1), not a date.
const EARLIEST_DATE_MS: number = Date.UTC(2000, 0, 1);

// The enrollment status of a device Workspace ONE manages.
const ENROLLED: string = "enrolled";

// The app statuses of an app that is not on the device: assigned, or gone.
const NOT_INSTALLED_APP_STATUSES: ReadonlySet<string> = new Set<string>([
  "pendinginstall",
  "removed",
]);

// What Workspace ONE's ownership letters stand for, as its console words them.
const OWNERSHIP_NAMES: Readonly<Record<string, string>> = {
  c: "Corporate - Dedicated",
  e: "Employee Owned",
  s: "Corporate - Shared",
};

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
        ? Number(value.trim())
        : NaN;

  return Number.isFinite(parsed) ? parsed : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

// Letters and digits only, lowercased: "Pending Install" and "PendingInstall" are one.
function compact(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  let text: string = "";

  for (const character of value.toLowerCase()) {
    if (
      (character >= "a" && character <= "z") ||
      (character >= "0" && character <= "9")
    ) {
      text += character;
    }
  }

  return text;
}

/*
 * A date Workspace ONE gave, or null for none, for nonsense and for its
 * never. A time without a zone is UTC, as Workspace ONE writes them.
 */
export function readWorkspaceOneDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  let text: string = value.trim();
  const timeAt: number = text.indexOf("T");

  // "2026-11-19T11:40:00.123", with no Z and no offset: UTC.
  if (timeAt > 0) {
    const time: string = text.substring(timeAt + 1);
    const hasZone: boolean =
      time.endsWith("Z") ||
      time.endsWith("z") ||
      time.includes("+") ||
      time.includes("-");

    if (!hasZone) {
      text = `${text}Z`;
    }
  }

  const parsed: number = Date.parse(text);

  return Number.isNaN(parsed) || parsed < EARLIEST_DATE_MS
    ? null
    : new Date(parsed);
}

/*
 * The ID a device is read and asked about by: the number of its Id
 * ({"Id": {"Value": 15}}), as text. "" for a device without one.
 */
export function readWorkspaceOneDeviceId(value: unknown): string {
  const id: number | null = readNumber(
    asObject(asObject(value)["Id"])["Value"],
  );

  return id !== null && id > 0 && Number.isInteger(id) ? String(id) : "";
}

/*
 * What a device runs, by Workspace ONE's Platform ("Apple", "AppleOsX",
 * "Android", "WinRT", "WindowsPC", "AppleTv"...). Workspace ONE calls an
 * iPad's platform Apple, as an iPhone's: its model says it is an iPad.
 */
export function readWorkspaceOnePlatform(data: {
  platform: unknown;
  model: unknown;
}): ManagedDevicePlatform {
  const platform: ManagedDevicePlatform = readManagedDevicePlatformFromName(
    data.platform,
  );
  const model: string =
    typeof data.model === "string" ? data.model.trim().toLowerCase() : "";

  if (platform === ManagedDevicePlatform.IOS && model.startsWith("ipad")) {
    return ManagedDevicePlatform.IPadOS;
  }

  return platform;
}

// Whether a device's enrollment status says Workspace ONE manages it; none said is yes.
export function isWorkspaceOneDeviceEnrolled(value: unknown): boolean {
  const status: string = compact(value);

  return !status || status === ENROLLED;
}

/*
 * A battery level as a percent: Workspace ONE passes on what the device
 * reports, "85%", "85" or an iOS fraction such as "0.85". Null for none.
 */
export function readWorkspaceOneBatteryLevel(value: unknown): number | null {
  const text: string =
    typeof value === "number" ? String(value) : cleanText(value);

  if (!text) {
    return null;
  }

  const isPercent: boolean = text.endsWith("%");
  const level: number | null = readNumber(
    isPercent ? text.substring(0, text.length - 1) : text,
  );

  if (level === null || level < 0) {
    return null;
  }

  const percent: number =
    !isPercent && level <= 1 && text.includes(".") ? level * 100 : level;

  return percent <= 100 ? Math.round(percent) : null;
}

// A size in gigabytes, to one decimal: "" for none or zero.
function gigabytes(value: number | null): string {
  if (value === null || value <= 0) {
    return "";
  }

  return String(Math.round(value * 10) / 10);
}

/*
 * A memory size Workspace ONE describes with its unit ({"MemorySize": 3.8,
 * "MemoryUnit": "GB"}), in gigabytes. "" for a unit it does not know.
 */
function memoryInGigabytes(value: unknown): string {
  const info: JSONObject = asObject(value);
  const size: number | null = readNumber(info["MemorySize"]);
  const unit: string = compact(info["MemoryUnit"]);
  const perGigabyte: Record<string, number> = { gb: 1, mb: 1024, kb: 1048576 };

  if (size === null || perGigabyte[unit] === undefined) {
    return "";
  }

  return gigabytes(size / perGigabyte[unit]!);
}

// An Android security patch level as Android writes it: 2026-10-01.
function readSecurityPatchLevel(value: unknown): string {
  const date: Date | null = readWorkspaceOneDate(value);

  return date ? date.toISOString().substring(0, 10) : "";
}

export interface WorkspaceOneDeviceRead {
  device: ProviderDevice;
  // When it last reported to Workspace ONE, never later than `now`; null for never.
  lastSeenAt: Date | null;
}

/*
 * One device of Workspace ONE's list, or null when it is not one Inventory
 * imports: no ID, or not enrolled. Every platform Workspace ONE manages is
 * imported.
 */
export function parseWorkspaceOneDevice(
  value: unknown,
  now: Date,
): WorkspaceOneDeviceRead | null {
  const raw: JSONObject = asObject(value);
  const providerDeviceId: string = readWorkspaceOneDeviceId(raw);

  if (
    !providerDeviceId ||
    !isWorkspaceOneDeviceEnrolled(raw["EnrollmentStatus"])
  ) {
    return null;
  }

  const platform: ManagedDevicePlatform = readWorkspaceOnePlatform({
    platform: raw["Platform"],
    model: raw["Model"],
  });
  const lastSeen: Date | null = readWorkspaceOneDate(raw["LastSeen"]);
  const group: JSONObject = asObject(raw["LocationGroupId"]);
  const groupNumber: number | null = readNumber(asObject(group["Id"])["Value"]);
  const groupName: string =
    cleanText(raw["LocationGroupName"]) || cleanText(group["Name"]);
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

  const ownership: string = cleanText(raw["Ownership"]);

  keep("operatingSystem", raw["Platform"]);
  keep("complianceState", raw["ComplianceStatus"]);
  keep("enrollmentStatus", raw["EnrollmentStatus"]);
  keep("ownership", OWNERSHIP_NAMES[ownership.toLowerCase()] || ownership);
  keep("isCompromised", readBoolean(raw["CompromisedStatus"]) ?? undefined);
  keep("isSupervised", readBoolean(raw["IsSupervised"]) ?? undefined);
  keep("assetNumber", raw["AssetNumber"]);
  keep("deviceUuid", raw["Uuid"]);
  keep("totalStorage", gigabytes(readNumber(raw["DeviceCapacity"])));
  keep("freeStorage", gigabytes(readNumber(raw["AvailableDeviceCapacity"])));
  keep("totalRam", memoryInGigabytes(raw["TotalPhysicalMemoryInfo"]));

  if (details["totalStorage"] || details["totalRam"]) {
    details["memoryUnits"] = "GB";
  }

  /*
   * In bytes, for how full it is (#10008): DeviceCapacity and
   * AvailableDeviceCapacity are in gigabytes, as Apple's MDM names the same
   * keys. Both are in one unit, so how full a device is never hangs on it.
   */
  const capacity: number | null = readNumber(raw["DeviceCapacity"]);
  const available: number | null = readNumber(raw["AvailableDeviceCapacity"]);

  Object.assign(
    details,
    getManagedDeviceStorageDetails({
      totalBytes: capacity === null ? null : capacity * 1e9,
      freeBytes: available === null ? null : available * 1e9,
    }),
  );

  const ipAddresses: Array<string> = [];
  let networkMac: string = "";

  for (const network of Array.isArray(raw["DeviceNetworkInfo"])
    ? (raw["DeviceNetworkInfo"] as Array<unknown>)
    : []) {
    const info: JSONObject = asObject(network);
    const address: string = cleanText(info["IPAddress"]);

    if (
      address &&
      ipAddresses.length < MAX_IP_ADDRESSES &&
      !ipAddresses.includes(address)
    ) {
      ipAddresses.push(address);
    }

    networkMac = networkMac || normalizeMacAddress(info["MACAddress"]);
  }

  return {
    device: {
      providerDeviceId,
      platform,
      deviceName: cleanText(raw["DeviceReportedName"]),
      alias: "",
      serialNumber: cleanText(raw["SerialNumber"]),
      imei: cleanText(raw["Imei"]),
      manufacturer: cleanText(raw["OEMInfo"]),
      brand: "",
      model: cleanText(raw["Model"]),
      osVersion: cleanText(raw["OperatingSystem"]),
      buildNumber: cleanText(raw["OSBuildVersion"]),
      securityPatchLevel:
        platform === ManagedDevicePlatform.Android
          ? readSecurityPatchLevel(raw["SecurityPatchDate"])
          : "",
      agentVersion: "",
      state: null,
      groupId:
        groupNumber !== null && groupNumber > 0
          ? String(groupNumber)
          : groupName,
      isKioskMode: null,
      batteryLevel: readWorkspaceOneBatteryLevel(raw["BatteryLevel"]),
      ipAddresses,
      macAddress: normalizeMacAddress(raw["MacAddress"]) || networkMac,
      provisionedAt: readWorkspaceOneDate(raw["LastEnrolledOn"]),
      details,
    },
    lastSeenAt: lastSeen && lastSeen.getTime() > now.getTime() ? now : lastSeen,
  };
}

/*
 * The organization groups the devices are in, as groups: each by its ID,
 * named as Workspace ONE names it. Its place in the group tree is not in a
 * device's record, so a group's path is its name.
 */
export function getWorkspaceOneGroups(
  raws: ReadonlyArray<unknown>,
): Array<ProviderGroup> {
  const groups: Map<string, ProviderGroup> = new Map<string, ProviderGroup>();

  for (const value of raws) {
    const raw: JSONObject = asObject(value);
    const group: JSONObject = asObject(raw["LocationGroupId"]);
    const number: number | null = readNumber(asObject(group["Id"])["Value"]);
    const name: string =
      cleanText(raw["LocationGroupName"]) || cleanText(group["Name"]);
    const id: string = number !== null && number > 0 ? String(number) : name;

    if (id && name && !groups.has(id)) {
      groups.set(id, { id, name, path: name });
    }
  }

  return Array.from(groups.values());
}

// Each device's last report, for the devices that have one.
export function getWorkspaceOneCheckIns(
  reads: ReadonlyArray<WorkspaceOneDeviceRead>,
): Array<ProviderCheckIn> {
  const checkIns: Array<ProviderCheckIn> = [];

  for (const read of reads) {
    if (read.lastSeenAt) {
      checkIns.push({
        providerDeviceId: read.device.providerDeviceId,
        lastCheckInAt: read.lastSeenAt,
      });
    }
  }

  return checkIns;
}

export interface WorkspaceOnePage {
  items: Array<unknown>;
  // The list's length, as the page says it (Total); null when it does not.
  total: number | null;
}

/*
 * One page of a Workspace ONE list: its items under `key` ("Devices",
 * "DeviceApps"), and its Total. A 204 - Workspace ONE's answer to a search
 * that found nothing - is an empty page. Null for an answer that is no
 * list at all.
 */
export function readWorkspaceOnePage(data: {
  status: number;
  body: unknown;
  key: string;
}): WorkspaceOnePage | null {
  if (data.status === 204 || data.body === undefined || data.body === "") {
    return { items: [], total: 0 };
  }

  const body: JSONObject = asObject(data.body);
  const items: unknown =
    body[data.key] ??
    body[data.key.charAt(0).toLowerCase() + data.key.slice(1)];

  if (!Array.isArray(items)) {
    return null;
  }

  const total: number | null = readNumber(body["Total"] ?? body["total"]);

  return {
    items: items as Array<unknown>,
    total: total !== null && total >= 0 ? Math.floor(total) : null,
  };
}

/*
 * One app of a device, or null for an app that is not on it (assigned but
 * not installed, or removed) and for one with no name. Its bundle or
 * package ID is its key; an app without one is keyed by its name.
 */
export function parseWorkspaceOneApp(value: unknown): ProviderApp | null {
  const app: JSONObject = asObject(value);
  const status: string = cleanText(app["Status"]);

  if (NOT_INSTALLED_APP_STATUSES.has(compact(status))) {
    return null;
  }

  const name: string = cleanText(app["ApplicationName"], MAX_SHORT_TEXT_LENGTH);
  const packageName: string =
    cleanText(app["ApplicationIdentifier"], MAX_LONG_TEXT_LENGTH) ||
    cleanText(app["ApplicationName"], MAX_LONG_TEXT_LENGTH);

  if (!packageName) {
    return null;
  }

  return {
    packageName,
    appName: name,
    versionName: cleanText(app["Version"]) || cleanText(app["AppVersion"]),
    versionCode: cleanText(app["BuildVersion"]),
    state: status,
    isKioskApp: false,
    isManagedByService: readBoolean(app["IsManaged"]) === true,
  };
}

// A device's apps, one per key: the first listed.
export function parseWorkspaceOneApps(
  items: ReadonlyArray<unknown>,
): Array<ProviderApp> {
  const apps: Array<ProviderApp> = [];
  const seen: Set<string> = new Set<string>();

  for (const item of items) {
    const app: ProviderApp | null = parseWorkspaceOneApp(item);

    if (!app || seen.has(app.packageName)) {
      continue;
    }

    seen.add(app.packageName);
    apps.push(app);
  }

  return apps;
}

/*
 * What Workspace ONE said went wrong: its {"errorCode", "message"}, else
 * the start of the body. One line.
 */
export function readWorkspaceOneError(data: {
  bodyJson: unknown;
  bodyText: string;
}): string {
  const body: JSONObject = asObject(data.bodyJson);
  const message: unknown = body["message"] ?? body["Message"];
  const code: number | null = readNumber(
    body["errorCode"] ?? body["ErrorCode"],
  );
  let text: string = "";

  if (typeof message === "string") {
    text = cleanText(message, MAX_LONG_TEXT_LENGTH);
  } else if (message && typeof message === "object") {
    text = cleanText(JSON.stringify(message), MAX_LONG_TEXT_LENGTH);
  }

  if (!text) {
    text = cleanText(data.bodyText, MAX_LONG_TEXT_LENGTH);
  }

  return code !== null && text ? `${text} (error code ${code})` : text;
}
