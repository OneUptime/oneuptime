import {
  ManagedDevicePlatform,
  readManagedDevicePlatformFromName,
} from "../../../../Types/DeviceManagement/ManagedDevicePlatform";
import { EsperDeviceState } from "../../../../Types/DeviceManagement/ManagedDeviceStatus";
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
 * SOTI MOBICONTROL'S ANSWERS, READ WITHOUT TRUSTING THEM (#10087).
 *
 * Every field is named as MobiControl's REST API reference (its Swagger,
 * served by every server at /MobiControl/api) documents it:
 *
 *   - a device: DeviceBase, as GET /devices lists it (a plain array, a page
 *     at a time with skip and take), with the fields of its Kind beside its
 *     own: an AndroidPlus device's HardwareSerialNumber and
 *     BuildSecurityPatch, an iOS device's ManufacturerSerialNumber...
 *   - an app: InstalledApplication, as GET /devices/{id}/installedApplications
 *     lists a device's.
 *
 * WHEN A DEVICE LAST CHECKED IN
 *
 * A MobiControl agent keeps a live connection to its server (IsAgentOnline)
 * and sends its device information on its update schedule
 * (LastCheckInTime). A device whose agent is connected is there now - at
 * the time of the read; one whose agent is not was last there at the
 * latest of its check-in, its agent's last connect and disconnect, and, for
 * an Apple device, its last MDM status update (LastStatusUpdate), which is
 * how an iPhone checks in. "0001-01-01T00:00:00Z" is never.
 *
 * WHICH DEVICES
 *
 * Devices whose Mode is Active, and those an administrator disabled, which
 * are Disabled in Inventory (EsperDeviceState.Disabled, the state Inventory
 * reads as disabled, whichever service said it). A device being unenrolled,
 * or unenrolled already, is no device MobiControl manages: it is left out,
 * as if it had left the list.
 *
 * Nothing about a device's user is read: not its user, its last logged on
 * user, its phone number, its personalized name or its custom attributes.
 */

// Before this, a date MobiControl gives is its "never" (year 1), not a date.
const EARLIEST_DATE_MS: number = Date.UTC(2000, 0, 1);

const ACTIVE_MODE: string = "active";
const DISABLED_MODE: string = "disabled";

/*
 * The statuses of an app that is not on the device: one being installed,
 * waiting to be, refused, failed or gone.
 */
const NOT_INSTALLED_APP_STATUSES: ReadonlySet<string> = new Set<string>([
  "uninstalled",
  "managedbutuninstalled",
  "failed",
  "queued",
  "installing",
  "needsredemption",
  "redeeming",
  "prompting",
  "userrejected",
  "provisioning",
  "unprovisioned",
  "staged",
  "retryinginstallation",
]);

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

// Letters and digits only, lowercased: "Active" and "ACTIVE" are one.
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

// A date MobiControl gave, or null for none, for nonsense and for its never.
export function readSotiDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  let text: string = value.trim();
  const timeAt: number = text.indexOf("T");

  // A time without a zone is UTC, as the server keeps them.
  if (timeAt > 0) {
    const time: string = text.substring(timeAt + 1);

    if (
      !time.endsWith("Z") &&
      !time.endsWith("z") &&
      !time.includes("+") &&
      !time.includes("-")
    ) {
      text = `${text}Z`;
    }
  }

  const parsed: number = Date.parse(text);

  return Number.isNaN(parsed) || parsed < EARLIEST_DATE_MS
    ? null
    : new Date(parsed);
}

/*
 * What a device runs, by its Kind ("AndroidPlus", "AndroidForWork", "Ios",
 * "Mac", "WindowsDesktop", "Linux"...), else its Platform. MobiControl
 * calls an iPad's Kind Ios, as an iPhone's: its model says it is an iPad.
 */
export function readSotiPlatform(raw: JSONObject): ManagedDevicePlatform {
  let platform: ManagedDevicePlatform = readManagedDevicePlatformFromName(
    raw["Kind"],
  );

  if (platform === ManagedDevicePlatform.Other) {
    platform = readManagedDevicePlatformFromName(raw["Platform"]);
  }

  const model: string = [raw["Model"], raw["ProductName"]]
    .map((value: unknown): string => {
      return typeof value === "string" ? value.trim().toLowerCase() : "";
    })
    .join(" ");

  if (
    platform === ManagedDevicePlatform.IOS &&
    (model.startsWith("ipad") || model.includes(" ipad"))
  ) {
    return ManagedDevicePlatform.IPadOS;
  }

  return platform;
}

// Whether MobiControl manages a device by its Mode: Active or Disabled; none said is Active.
export function isSotiDeviceManaged(value: unknown): boolean {
  const mode: string = compact(value);

  return !mode || mode === ACTIVE_MODE || mode === DISABLED_MODE;
}

/*
 * A device group's path as Inventory writes one: "Acme/Stores/West" for
 * MobiControl's "\\Acme\Stores\West".
 */
export function readSotiGroupPath(value: unknown): string {
  const path: string = cleanText(value, MAX_LONG_TEXT_LENGTH);

  return path
    .split("\\")
    .map((segment: string): string => {
      return segment.trim();
    })
    .filter(Boolean)
    .join("/");
}

// A size in bytes as gigabytes, to one decimal: "" for none or zero.
function bytesToGigabytes(value: unknown): string {
  const bytes: number | null = readNumber(value);

  if (bytes === null || bytes <= 0) {
    return "";
  }

  return String(Math.round((bytes / 1e9) * 10) / 10);
}

/*
 * When a device was last there: the read's time while its agent is
 * connected, else the latest of what MobiControl says of it - never later
 * than `now`. Null for a device that never checked in.
 */
export function readSotiLastCheckIn(raw: JSONObject, now: Date): Date | null {
  if (raw["IsAgentOnline"] === true) {
    return now;
  }

  let latest: Date | null = null;

  for (const key of [
    "LastCheckInTime",
    "LastAgentConnectTime",
    "LastAgentDisconnectTime",
    "LastStatusUpdate",
  ]) {
    const date: Date | null = readSotiDate(raw[key]);

    if (date && (!latest || date.getTime() > latest.getTime())) {
      latest = date;
    }
  }

  return latest && latest.getTime() > now.getTime() ? now : latest;
}

export interface SotiDeviceRead {
  device: ProviderDevice;
  // When it was last there, never later than `now`; null for never.
  lastCheckInAt: Date | null;
}

/*
 * One device of MobiControl's list, or null when it is not one Inventory
 * imports: no ID, or no longer managed. Every platform MobiControl manages
 * is imported.
 */
export function parseSotiDevice(
  value: unknown,
  now: Date,
): SotiDeviceRead | null {
  const raw: JSONObject = asObject(value);
  const providerDeviceId: string = cleanText(raw["DeviceId"]);

  if (!providerDeviceId || !isSotiDeviceManaged(raw["Mode"])) {
    return null;
  }

  const platform: ManagedDevicePlatform = readSotiPlatform(raw);
  const memory: JSONObject = asObject(raw["Memory"]);
  const groupPath: string = readSotiGroupPath(raw["Path"]);
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

  const complianceStatus: boolean | null = readBoolean(raw["ComplianceStatus"]);

  keep("operatingSystem", cleanText(raw["Kind"]) || cleanText(raw["Platform"]));
  keep(
    "complianceState",
    cleanText(raw["CompliancePolicyStatus"]) ||
      (complianceStatus === null
        ? ""
        : complianceStatus
          ? "Compliant"
          : "NonCompliant"),
  );
  keep("mode", raw["Mode"]);
  keep("isAgentOnline", readBoolean(raw["IsAgentOnline"]) ?? undefined);
  keep("isEncrypted", readBoolean(raw["IsEncrypted"]) ?? undefined);
  keep("isSupervised", readBoolean(raw["IsSupervised"]) ?? undefined);
  keep("enrollmentType", raw["EnrollmentType"]);
  keep("totalStorage", bytesToGigabytes(memory["TotalStorage"]));
  keep("freeStorage", bytesToGigabytes(memory["AvailableStorage"]));
  keep("totalRam", bytesToGigabytes(memory["TotalMemory"]));

  if (details["totalStorage"] || details["totalRam"]) {
    details["memoryUnits"] = "GB";
  }

  const battery: number | null = readNumber(raw["BatteryStatus"]);
  const ipv6: string = cleanText(raw["Ipv6"]);

  return {
    device: {
      providerDeviceId,
      platform,
      deviceName: cleanText(raw["DeviceName"]),
      alias: "",
      serialNumber:
        cleanText(raw["HardwareSerialNumber"]) ||
        cleanText(raw["ManufacturerSerialNumber"]),
      imei: cleanText(raw["IMEI_MEID_ESN"]),
      manufacturer: cleanText(raw["Manufacturer"]),
      brand: "",
      model: cleanText(raw["Model"]),
      osVersion: cleanText(raw["OSVersion"]),
      buildNumber: cleanText(raw["BuildVersion"]),
      securityPatchLevel:
        platform === ManagedDevicePlatform.Android
          ? cleanText(raw["BuildSecurityPatch"])
          : "",
      agentVersion: cleanText(raw["AgentVersion"]),
      // An administrator disabled it: Inventory's Disabled, never "stopped checking in".
      state:
        compact(raw["Mode"]) === DISABLED_MODE
          ? EsperDeviceState.Disabled
          : null,
      groupId: groupPath,
      isKioskMode: null,
      batteryLevel:
        battery !== null && battery >= 0 && battery <= 100
          ? Math.round(battery)
          : null,
      ipAddresses: ipv6 ? [ipv6] : [],
      macAddress:
        normalizeMacAddress(raw["WifiMAC"]) ||
        normalizeMacAddress(raw["MACAddress"]),
      provisionedAt: readSotiDate(raw["EnrollmentTime"]),
      details,
    },
    lastCheckInAt: readSotiLastCheckIn(raw, now),
  };
}

/*
 * The device groups the devices are in, as groups: each by its path, named
 * by its last part ("West" for Acme/Stores/West).
 */
export function getSotiGroups(
  devices: ReadonlyArray<ProviderDevice>,
): Array<ProviderGroup> {
  const groups: Map<string, ProviderGroup> = new Map<string, ProviderGroup>();

  for (const device of devices) {
    if (!device.groupId || groups.has(device.groupId)) {
      continue;
    }

    const parts: Array<string> = device.groupId.split("/");

    groups.set(device.groupId, {
      id: device.groupId,
      name: parts[parts.length - 1] || device.groupId,
      path: device.groupId,
    });
  }

  return Array.from(groups.values());
}

// Each device's last check-in, for the devices that have one.
export function getSotiCheckIns(
  reads: ReadonlyArray<SotiDeviceRead>,
): Array<ProviderCheckIn> {
  const checkIns: Array<ProviderCheckIn> = [];

  for (const read of reads) {
    if (read.lastCheckInAt) {
      checkIns.push({
        providerDeviceId: read.device.providerDeviceId,
        lastCheckInAt: read.lastCheckInAt,
      });
    }
  }

  return checkIns;
}

/*
 * One app of a device, or null for an app that is not on it and for one
 * with no name. Its package or bundle ID is its key; an app without one is
 * keyed by its name. An Apple app's ShortVersion is the version people
 * see, and its Version the build.
 */
export function parseSotiApp(value: unknown): ProviderApp | null {
  const app: JSONObject = asObject(value);
  const status: string = cleanText(app["Status"]);

  if (NOT_INSTALLED_APP_STATUSES.has(compact(status))) {
    return null;
  }

  const packageName: string =
    cleanText(app["ApplicationId"], MAX_LONG_TEXT_LENGTH) ||
    cleanText(app["Name"], MAX_LONG_TEXT_LENGTH);

  if (!packageName) {
    return null;
  }

  const shortVersion: string = cleanText(app["ShortVersion"]);
  const version: string = cleanText(app["Version"]);

  return {
    packageName,
    appName: cleanText(app["Name"], MAX_SHORT_TEXT_LENGTH),
    versionName: shortVersion || version,
    versionCode: cleanText(app["Build"]) || (shortVersion ? version : ""),
    state: status,
    isKioskApp: false,
    isManagedByService: compact(status) === "managed",
  };
}

// A device's apps, one per key: the first listed.
export function parseSotiApps(
  items: ReadonlyArray<unknown>,
): Array<ProviderApp> {
  const apps: Array<ProviderApp> = [];
  const seen: Set<string> = new Set<string>();

  for (const item of items) {
    const app: ProviderApp | null = parseSotiApp(item);

    if (!app || seen.has(app.packageName)) {
      continue;
    }

    seen.add(app.packageName);
    apps.push(app);
  }

  return apps;
}

/*
 * How many devices a summary says MobiControl manages: the Active and
 * Disabled buckets of an aggregation of the devices by their Mode
 * (POST /devices/summary). Undefined when it says nothing that can be read.
 */
export function parseSotiManagedDeviceCount(value: unknown): number | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const buckets: unknown = asObject(value[0])["Buckets"];

  if (!Array.isArray(buckets)) {
    return undefined;
  }

  let count: number = 0;

  for (const bucket of buckets) {
    const read: JSONObject = asObject(bucket);
    const number: number | null = readNumber(read["Count"]);

    if (number !== null && number > 0 && isSotiDeviceManaged(read["Value"])) {
      count += Math.floor(number);
    }
  }

  return count;
}

/*
 * What MobiControl said went wrong: its {"ErrorCode", "Message", "Data"},
 * an OAuth {"error", "error_description"}, else the start of the body. One
 * line.
 */
export function readSotiError(data: {
  bodyJson: unknown;
  bodyText: string;
}): string {
  const body: JSONObject = asObject(data.bodyJson);
  const message: string = cleanText(
    body["Message"] ?? body["message"],
    MAX_LONG_TEXT_LENGTH,
  );
  const detail: unknown = Array.isArray(body["Data"])
    ? (body["Data"] as Array<unknown>)[0]
    : undefined;
  const detailText: string = cleanText(detail, MAX_LONG_TEXT_LENGTH);
  const oauthError: string = cleanText(body["error"]);
  const oauthDescription: string = cleanText(
    body["error_description"],
    MAX_LONG_TEXT_LENGTH,
  );

  if (message) {
    return detailText && detailText !== message
      ? `${message} ${detailText}`
      : message;
  }

  if (oauthError) {
    return oauthDescription ? `${oauthError}: ${oauthDescription}` : oauthError;
  }

  return cleanText(data.bodyText, MAX_LONG_TEXT_LENGTH);
}
