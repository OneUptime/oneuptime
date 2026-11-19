import {
  ManagedDevicePlatform,
  readManagedDevicePlatformFromName,
} from "../../../../Types/DeviceManagement/ManagedDevicePlatform";
import { JSONObject } from "../../../../Types/JSON";
import {
  ProviderApp,
  ProviderCheckIn,
  ProviderDevice,
  ProviderGroup,
} from "../DeviceManagementTypes";

/*
 * ESPER'S ANSWERS, READ WITHOUT TRUSTING THEM.
 *
 * Every field below is named as Esper's API reference (api.esper.io)
 * documents it - the v2 device schemas (device_AndroidDeviceV2 and, since
 * #9837, device_AppleDeviceV2: an iPhone, an iPad or an Apple TV), the
 * heartbeat (device_EsperDeviceHeartbeat), the group (DeviceGroup) and the
 * device app (DeviceApp) - including Esper's own spelling of the security
 * patch level, `security_path_level`. The correct spelling is read too, so
 * a fix on Esper's side changes nothing here.
 *
 * Each value is cleaned (control characters become spaces) and bounded to
 * the column it lands in, and a value of the wrong type is treated as
 * absent: one odd device never fails a read of the fleet.
 */

// Lengths kept: the ShortText and LongText columns the values land in.
export const MAX_SHORT_TEXT_LENGTH: number = 100;
export const MAX_LONG_TEXT_LENGTH: number = 500;
// IP addresses kept per device.
export const MAX_IP_ADDRESSES: number = 10;

// Hex digits that are all zeros: the placeholder MAC some devices report.
const ALL_ZEROS: RegExp = /^0+$/;

/*
 * What Android answers for a MAC address to anyone not allowed to read it
 * (since Android 6): a placeholder, never the device's.
 */
const ANDROID_PLACEHOLDER_MAC: string = "020000000000";

// An ID Esper gives: a UUID's characters only, so it can go into a URL path.
const ESPER_ID: RegExp = /^[0-9a-fA-F-]{8,64}$/;

function asObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

/*
 * Text to keep: trimmed, every control character a space, cut to its
 * length. "" for anything that is not text (a number is written out).
 */
export function cleanText(
  value: unknown,
  maxLength: number = MAX_SHORT_TEXT_LENGTH,
): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value).substring(0, maxLength);
  }

  if (typeof value !== "string") {
    return "";
  }

  let cleaned: string = "";

  for (const character of value.substring(0, maxLength * 4)) {
    const code: number = character.charCodeAt(0);
    cleaned += code < 0x20 || code === 0x7f ? " " : character;
  }

  return cleaned.trim().substring(0, maxLength).trim();
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

function readDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const time: number = Date.parse(value.trim());

  return Number.isNaN(time) ? null : new Date(time);
}

/*
 * A MAC address as OneUptime keeps one: lowercase, colon-separated. ""
 * for anything that is not six bytes, or for a placeholder: all zeros, or
 * Android's 02:00:00:00:00:00.
 */
export function normalizeMacAddress(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  let hex: string = "";

  for (const character of value.trim().toLowerCase()) {
    if (
      (character >= "0" && character <= "9") ||
      (character >= "a" && character <= "f")
    ) {
      hex += character;
    } else if (character !== ":" && character !== "-" && character !== ".") {
      return "";
    }
  }

  if (
    hex.length !== 12 ||
    ALL_ZEROS.test(hex) ||
    hex === ANDROID_PLACEHOLDER_MAC
  ) {
    return "";
  }

  const pairs: Array<string> = [];

  for (let index: number = 0; index < 12; index += 2) {
    pairs.push(hex.substring(index, index + 2));
  }

  return pairs.join(":");
}

// A battery level in percent: 0 to 100, whole; null for anything else.
function readBatteryLevel(value: unknown): number | null {
  const level: number | null = readNumber(value);

  if (level === null || level < 0 || level > 100) {
    return null;
  }

  return Math.round(level);
}

/*
 * The platforms a read lists, as Esper's v2 device list takes them: a CSV
 * of ANDROID, APPLE, LINUX and WINDOWS. An Esper Windows or Linux device is
 * not imported yet.
 */
export const ESPER_IMPORTED_PLATFORMS: ReadonlyArray<string> = [
  "ANDROID",
  "APPLE",
];

/*
 * The platform of an Esper Apple device (device_AppleDeviceV2): its `os` -
 * "iOS", "iPadOS" or "tvOS" in Esper's schema, "macOS" should Esper ever
 * manage a Mac (its help center says it does not) - else its model, else
 * iOS, which most of Esper's Apple devices run.
 */
export function readEsperApplePlatform(data: {
  os: unknown;
  model: unknown;
}): ManagedDevicePlatform {
  for (const name of [data.os, data.model]) {
    const platform: ManagedDevicePlatform =
      readManagedDevicePlatformFromName(name);

    if (
      platform !== ManagedDevicePlatform.Other &&
      platform !== ManagedDevicePlatform.Android
    ) {
      return platform;
    }

    // A model is named by its line: "iPad Pro (11-inch)", "Apple TV 4K".
    const text: string = typeof name === "string" ? name.toLowerCase() : "";

    if (text.startsWith("ipad")) {
      return ManagedDevicePlatform.IPadOS;
    }

    if (text.startsWith("apple tv")) {
      return ManagedDevicePlatform.TvOS;
    }

    if (text.startsWith("mac")) {
      return ManagedDevicePlatform.MacOS;
    }
  }

  return ManagedDevicePlatform.IOS;
}

/*
 * The platform a device of Esper's v2 device list runs, or null for one
 * that is not imported: a Windows or Linux device, or a platform Esper
 * names that OneUptime does not know. A device that names no platform is
 * Android, as every device of the list asked for Android only was.
 */
export function readEsperPlatform(
  device: JSONObject,
): ManagedDevicePlatform | null {
  const platform: string =
    typeof device["platform"] === "string"
      ? (device["platform"] as string).trim().toUpperCase()
      : "";

  if (!platform || platform === "ANDROID") {
    return ManagedDevicePlatform.Android;
  }

  if (platform === "APPLE") {
    return readEsperApplePlatform({
      os: device["os"],
      model: asObject(device["hardware_info"])["model"],
    });
  }

  return null;
}

// Bytes as gigabytes, as a device's storage is sold: 64000000000 is "64".
function bytesToGigabytes(value: unknown): string {
  const bytes: number | null = readNumber(value);

  if (bytes === null || bytes <= 0) {
    return "";
  }

  return String(Math.round((bytes / 1e9) * 10) / 10);
}

/*
 * When an Esper Apple device last checked in (its last_seen), never later
 * than `now`; null when it says nothing. An Android device's check-ins are
 * read from the heartbeat list instead: its v2 record has no last_seen.
 */
export function parseEsperDeviceLastSeen(
  value: unknown,
  now: Date,
): Date | null {
  const seen: Date | null = readDate(asObject(value)["last_seen"]);

  if (!seen) {
    return null;
  }

  return seen.getTime() > now.getTime() ? now : seen;
}

/*
 * One device of Esper's v2 device list, or null when it is not one: no ID,
 * or a platform that is not imported (readEsperPlatform) - left out rather
 * than read wrongly. An Android device is read by device_AndroidDeviceV2,
 * an Apple one by device_AppleDeviceV2: the same names for what both have,
 * and its UDID, supervision and memory in bytes beside them.
 */
export function parseEsperDevice(value: unknown): ProviderDevice | null {
  const device: JSONObject = asObject(value);
  const id: string = cleanText(device["id"]);

  if (!id) {
    return null;
  }

  const platform: ManagedDevicePlatform | null = readEsperPlatform(device);

  if (!platform) {
    return null;
  }

  const isAndroid: boolean = platform === ManagedDevicePlatform.Android;
  const hardware: JSONObject = asObject(device["hardware_info"]);
  const software: JSONObject = asObject(device["software_info"]);
  const network: JSONObject = asObject(device["network_info"]);
  const networkStats: JSONObject = asObject(device["network_stats"]);
  const memory: JSONObject = asObject(device["memory_info"]);
  const memoryStats: JSONObject = asObject(device["memory_stats"]);
  const battery: JSONObject = asObject(device["battery_stats"]);
  const appMode: JSONObject = asObject(device["app_mode_meta"]);
  const agent: JSONObject = asObject(software["esper_agent_info"]);
  const wifi: JSONObject = asObject(networkStats["wifi_network_info"]);

  const ipAddresses: Array<string> = [];
  const rawAddresses: unknown = networkStats["ip_address"];

  for (const address of Array.isArray(rawAddresses)
    ? rawAddresses
    : typeof rawAddresses === "string"
      ? rawAddresses.split(",")
      : []) {
    const text: string = cleanText(address, 64);

    if (text && !ipAddresses.includes(text)) {
      ipAddresses.push(text);
    }
  }

  const state: number | null = readNumber(device["state"]);
  const wifiMac: string = normalizeMacAddress(network["wifi_mac_address"]);
  const ethernetMac: string = normalizeMacAddress(
    network["ethernet_mac_address"],
  );

  const details: JSONObject = {};
  const putDetail: (key: string, value: unknown) => void = (
    key: string,
    detailValue: unknown,
  ): void => {
    if (typeof detailValue === "string") {
      const text: string = cleanText(detailValue);

      if (text) {
        details[key] = text;
      }

      return;
    }

    if (typeof detailValue === "number" && Number.isFinite(detailValue)) {
      details[key] = detailValue;
      return;
    }

    if (typeof detailValue === "boolean") {
      details[key] = detailValue;
    }
  };

  putDetail("hardware", hardware["hardware"]);
  putDetail("modelNumber", hardware["model_number"]);
  putDetail("basebandVersion", hardware["device_baseband_version"]);
  putDetail("bootloaderVersion", software["bootloader_version"]);
  putDetail("kernelVersion", software["device_kernel_version"]);
  putDetail("agentVersionCode", agent["version_code"]);
  putDetail("dpcVersion", device["dpc_version"]);
  putDetail("imei2", network["imei2"]);
  putDetail("ethernetMacAddress", ethernetMac);
  putDetail("wifiMacAddress", wifiMac);
  putDetail("networkType", network["network_type"]);
  putDetail("activeConnection", networkStats["current_active_connection"]);
  putDetail("wifiSsid", wifi["wifi_ssid"]);
  putDetail("wifiSignalStrength", readNumber(wifi["wifi_signal_strength"]));
  if (isAndroid) {
    putDetail("totalRam", memory["total_ram"]);
    putDetail("totalStorage", memory["total_internal_storage"]);
    putDetail("memoryUnits", memory["units"]);
    putDetail("availableRam", readNumber(memoryStats["available_ram"]));
    putDetail(
      "availableStorage",
      readNumber(memoryStats["available_internal_storage"]),
    );
  } else {
    /*
     * An Apple device's memory comes in bytes (memory_stats), its
     * capacity sometimes in memory_info as Android's does: kept in
     * gigabytes, as Apple sells it, beside the bytes free.
     */
    const totalRam: string =
      cleanText(memory["total_ram"]) ||
      bytesToGigabytes(memoryStats["total_memory"]);
    const totalStorage: string =
      cleanText(memory["total_internal_storage"]) ||
      bytesToGigabytes(memoryStats["total_internal_storage"]);

    putDetail("totalRam", totalRam);
    putDetail("totalStorage", totalStorage);
    putDetail(
      "memoryUnits",
      cleanText(memory["units"]) || (totalRam || totalStorage ? "GB" : ""),
    );
    putDetail("availableRamBytes", readNumber(memoryStats["available_ram"]));
    putDetail(
      "availableStorageBytes",
      readNumber(memoryStats["available_internal_storage"]),
    );
    putDetail("udid", device["udid"]);
    putDetail("isSupervised", readBoolean(device["is_supervised"]));
    putDetail("deviceSource", device["device_source"]);
  }

  putDetail("operatingSystem", device["os"]);
  putDetail("kioskAppId", appMode["app_id"]);
  putDetail("timezone", device["timezone_string"]);

  const provisionedAt: Date | null = readDate(device["provisioned_on"]);

  return {
    providerDeviceId: id,
    platform: platform,
    deviceName: cleanText(device["name"]),
    alias: cleanText(device["alias"] ?? device["alias_name"]),
    serialNumber: cleanText(device["serial"]) || cleanText(hardware["serial"]),
    imei: cleanText(network["imei1"]),
    // Every Apple device is Apple's, whether or not Esper says so.
    manufacturer:
      cleanText(hardware["manufacturer"]) || (isAndroid ? "" : "Apple"),
    brand: cleanText(hardware["brand"]),
    model: cleanText(hardware["model"]) || cleanText(hardware["model_number"]),
    osVersion:
      cleanText(software["os_version"]) || cleanText(device["os_version"]),
    buildNumber: cleanText(software["os_build_number"]),
    // Android's alone: Esper's schema has the field for every platform.
    securityPatchLevel: isAndroid
      ? cleanText(software["security_path_level"]) ||
        cleanText(software["security_patch_level"])
      : "",
    // The Esper agent runs on Android; an Apple device has none.
    agentVersion: isAndroid
      ? cleanText(agent["version_name"]) || cleanText(device["dpc_version"])
      : "",
    state: state === null ? null : Math.round(state),
    groupId: cleanText(device["group_id"]),
    isKioskMode: readBoolean(appMode["is_kiosk"]),
    batteryLevel: readBatteryLevel(battery["battery_level"]),
    ipAddresses: ipAddresses.slice(0, MAX_IP_ADDRESSES),
    macAddress: wifiMac || ethernetMac,
    provisionedAt: provisionedAt,
    details: details,
  };
}

/*
 * A group of devices, or null when it has no ID. Its path is where it sits
 * among the tenant's groups; a group Esper gives no path is its name.
 */
export function parseEsperGroup(value: unknown): ProviderGroup | null {
  const group: JSONObject = asObject(value);
  const id: string = cleanText(group["id"]);

  if (!id) {
    return null;
  }

  const name: string = cleanText(group["name"]);

  return {
    id: id,
    name: name,
    path: cleanText(group["path"], MAX_LONG_TEXT_LENGTH) || name,
  };
}

/*
 * A check-in of Esper's heartbeat list ({"device_id", "timestamp",
 * "status"}), or null without a device or a time. `status` is Esper's
 * legacy 30-minute flag, which its docs say not to rely on: the time is
 * what is kept.
 */
export function parseEsperCheckIn(value: unknown): ProviderCheckIn | null {
  const heartbeat: JSONObject = asObject(value);
  const deviceId: string = cleanText(heartbeat["device_id"]);
  const timestamp: Date | null = readDate(heartbeat["timestamp"]);

  if (!deviceId || !timestamp) {
    return null;
  }

  return { providerDeviceId: deviceId, lastCheckInAt: timestamp };
}

/*
 * The newest check-in per device of a heartbeat list, never later than
 * `now` (a device whose clock runs ahead is not "seen in the future").
 */
export function newestCheckIns(
  values: Array<unknown>,
  now: Date,
): Array<ProviderCheckIn> {
  const newest: Map<string, Date> = new Map<string, Date>();

  for (const value of values) {
    const checkIn: ProviderCheckIn | null = parseEsperCheckIn(value);

    if (!checkIn) {
      continue;
    }

    const at: Date =
      checkIn.lastCheckInAt.getTime() > now.getTime()
        ? now
        : checkIn.lastCheckInAt;
    const known: Date | undefined = newest.get(checkIn.providerDeviceId);

    if (!known || known.getTime() < at.getTime()) {
      newest.set(checkIn.providerDeviceId, at);
    }
  }

  return Array.from(newest.entries()).map(
    ([providerDeviceId, lastCheckInAt]: [string, Date]): ProviderCheckIn => {
      return { providerDeviceId, lastCheckInAt };
    },
  );
}

/*
 * One app of a device's app list, or null without a package name - the
 * app's identity on the device.
 */
export function parseEsperApp(value: unknown): ProviderApp | null {
  const app: JSONObject = asObject(value);
  const packageName: string = cleanText(
    app["package_name"],
    MAX_LONG_TEXT_LENGTH,
  );

  if (!packageName) {
    return null;
  }

  return {
    packageName: packageName,
    appName: cleanText(app["app_name"]),
    versionName: cleanText(app["version_name"]),
    versionCode: cleanText(app["version_code"]),
    state: cleanText(app["state"]),
    isKioskApp: app["is_kiosk_app"] === true,
    isManagedByService: app["is_esper_controlled"] === true,
  };
}

/*
 * Who an API key belongs to (GET /user_info/): the enterprise its user is
 * in, which the enterprise routes are under, and the user's role.
 */
export function parseEsperUserInfo(value: unknown): {
  enterpriseId: string;
  role: string;
} {
  const user: JSONObject = asObject(value);
  const profile: JSONObject = asObject(user["profile"]);

  return {
    enterpriseId: cleanText(profile["enterprise"]),
    role: cleanText(profile["role"]),
  };
}

// Whether an ID can go into a URL path: a UUID's characters only.
export function isEsperId(value: string): boolean {
  return ESPER_ID.test(value);
}
