import Dictionary from "../Dictionary";
import AndroidSecurityPatch, {
  ANDROID_SECURITY_PATCH_MAX_AGE_DAYS,
} from "../Host/AndroidSecurityPatch";
import {
  ManagedDeviceNaming,
  canonicalizeManagedDeviceIdentity,
  getManagedDeviceUniqueHostName,
  getManagedDeviceUniqueName,
  getSharedManagedDeviceNames,
} from "./ManagedDeviceIdentity";
import {
  ManagedDevicePlatform,
  readManagedDevicePlatform,
} from "./ManagedDevicePlatform";
import {
  ManagedDeviceStatus,
  getManagedDeviceStatus,
} from "./ManagedDeviceStatus";

/*
 * HOW LONG SINCE EACH MANAGED DEVICE CHECKED IN, AS A METRIC (#9835).
 *
 * A device only its device management service sees - a kiosk whose app
 * never started - sends no telemetry, so no monitor had anything to read
 * about it. Each read of its connection (DeviceManagementReadRunner)
 * therefore writes one reading per device: the minutes since the device
 * last checked in with the service, as the read found them. A Metrics
 * monitor grouped by the device's name alerts once per device that stops
 * checking in (ManagedDeviceAlertTemplates: "Esper Device Stopped Checking
 * In"), and the readings chart on the device's own Inventory page.
 *
 * WHICH DEVICES
 *
 *   - those the service lists: a device that left it (Removed) has nothing
 *     to check in for, and its last reading ages out of a monitor's window;
 *   - in service, Online or Offline (ManagedDeviceStatus): a device being
 *     set up, one whose onboarding failed, and one someone disabled or is
 *     wiping are states of their own, never a device that stopped checking
 *     in;
 *   - whose last check-in is known: a device Esper knows only as offline,
 *     with no check-in to measure from, has no age to say.
 *
 * THE ANDROID AGENT
 *
 * A device that runs the OneUptime Android agent is a host in Hosts (the
 * agent registers it under the same host.name: ManagedDeviceIdentity), and
 * Host Stopped Reporting watches it. Its readings say so (IsHost "true"),
 * and the recommended monitor reads only the devices that are not, so a
 * device that goes dark is told of once - by the host's alert, which knows
 * more about it. A host someone archived no longer counts: its device is
 * watched by its check-ins again.
 *
 * WHEN A READING IS TAKEN
 *
 * Once per read, every 15 minutes by default (5 to 60), and only by a read
 * that read every check-in up to its end: the age is measured at that end,
 * when the read knows every device's last check-in. A read cut short says
 * nothing rather than an age too old. So a monitor judges each device on
 * its latest reading (MonitorStepMetricMonitor.judgeLatestReading), over a
 * window that holds at least one read at the longest interval.
 *
 * HOW OLD AN ANDROID DEVICE'S SECURITY PATCH IS (#10098)
 *
 * Every device manager reads an Android device's security patch level - its
 * build's Android security bulletin date (Esper's security_patch_level,
 * Intune's androidSecurityPatchLevel, Workspace ONE's SecurityPatchDate,
 * SOTI's BuildSecurityPatch) - and Inventory shows it, Out of Date when more
 * than 90 days old (Host/AndroidSecurityPatch). The OneUptime Android agent
 * sends its age as android.os.security_patch.age, which the Host template
 * Security Patch Out of Date reads; a device without the agent sent nothing
 * a monitor could read. So the same read writes, beside each Android
 * device's check-in age, the age of its patch level: whole UTC days, the
 * agent's rule (AndroidSecurityPatch.getAgeInDays), with the level itself on
 * the reading, under a metric of its own
 * (MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME). A name of its own, and
 * not the agent's: a host's monitors read the agent's metric by the host's
 * name, which the readings carry too, and would read a device both report
 * twice. The device manager's Security Patch Out of Date templates read only
 * the devices no agent reports (IsHost "false"), so a device that runs the
 * agent is alerted on once, by its host.
 *
 * ITS BATTERY AND ITS STORAGE (#10008)
 *
 * A dying battery is the commonest reason a kiosk or a handheld stops
 * checking in, and it shows hours before. Most services report a device's
 * battery (Esper's battery_stats.battery_level, Workspace ONE's
 * BatteryLevel, SOTI's BatteryStatus; Intune's device list has none) and its
 * storage with its free space (Esper's memory_info and memory_stats,
 * Intune's totalStorageSpaceInBytes and freeStorageSpaceInBytes, Workspace
 * ONE's DeviceCapacity and AvailableDeviceCapacity, SOTI's Memory), each as
 * the device last told it. So the same read writes, beside each device's
 * check-in, its battery in percent and how much of its storage is in use,
 * in percent, under metrics of their own: what each service's Low Battery
 * and Storage Nearly Full read, for the devices no agent reports - the
 * agent's device is its host's Low Battery's and Storage Nearly Full's,
 * which read the agent's own metrics. A device that reports no battery (a
 * desktop, an Apple TV) or none of its free space gets no such reading,
 * and so never alerts.
 */

// The metric: minutes since the device's last check-in, a gauge per read.
export const MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME: string =
  "oneuptime.managed_device.check_in.age";

export const MANAGED_DEVICE_CHECK_IN_AGE_UNIT: string = "min";

export const MANAGED_DEVICE_CHECK_IN_AGE_DESCRIPTION: string =
  "Minutes since a managed device last checked in with its device management service, as the last read of its connection found them. One reading per device in service, at every read.";

/*
 * The metric: days since an Android device's security patch level, a gauge
 * per read (#10098). The agent's android.os.security_patch.age, counted the
 * same way, from what the device manager reports.
 */
export const MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME: string =
  "oneuptime.managed_device.security_patch.age";

export const MANAGED_DEVICE_SECURITY_PATCH_AGE_UNIT: string = "d";

export const MANAGED_DEVICE_SECURITY_PATCH_AGE_DESCRIPTION: string = `Days since an Android managed device's security patch level, as its device management service reported it at the last read of its connection: more than ${ANDROID_SECURITY_PATCH_MAX_AGE_DAYS} is out of date. One reading per Android device in service whose patch level is known, at every read.`;

/*
 * The metric: a device's battery, in percent, as its device manager last
 * heard it, a gauge per read (#10008). OneUptime's own name, never the
 * Android agent's hw.battery.charge: a host's monitors read that one by the
 * host's name, which the readings carry too.
 */
export const MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME: string =
  "oneuptime.managed_device.battery.level";

export const MANAGED_DEVICE_BATTERY_LEVEL_UNIT: string = "%";

export const MANAGED_DEVICE_BATTERY_LEVEL_DESCRIPTION: string =
  "A managed device's battery, in percent, as its device management service last heard it at the last read of its connection. One reading per device in service that reports a battery, at every read.";

/*
 * The metric: whether a device is on its charger, as its device manager
 * last heard it, a gauge per read (#10288): 1 on power, 0 on its battery.
 * Written beside a device's battery, where its service says which:
 * Workspace ONE's AcLineStatus, and SOTI MobiControl's IsCharging of an
 * Android+ device. Esper's and Intune's device lists say neither. Low
 * Battery reads it beside the battery, to leave a device on its charger be.
 */
export const MANAGED_DEVICE_BATTERY_CHARGING_METRIC_NAME: string =
  "oneuptime.managed_device.battery.charging";

export const MANAGED_DEVICE_BATTERY_CHARGING_UNIT: string = "";

export const MANAGED_DEVICE_BATTERY_CHARGING_DESCRIPTION: string =
  "Whether a managed device is on its charger, as its device management service last heard it at the last read of its connection: 1 on power, 0 on its battery. One reading per device in service that reports a battery and whether it is on power, at every read.";

/*
 * The metric: how much of a device's own storage is in use, in percent, as
 * its device manager last heard it, a gauge per read (#10008). OneUptime's
 * own name, never the agent's system.filesystem.utilization.
 */
export const MANAGED_DEVICE_STORAGE_USED_METRIC_NAME: string =
  "oneuptime.managed_device.storage.used";

export const MANAGED_DEVICE_STORAGE_USED_UNIT: string = "%";

export const MANAGED_DEVICE_STORAGE_USED_DESCRIPTION: string =
  "How much of a managed device's own storage is in use, in percent, as its device management service last heard it at the last read of its connection. One reading per device in service that reports its storage and its free space, at every read.";

// Every metric a connection's reads write for its devices.
export const MANAGED_DEVICE_READING_METRIC_NAMES: ReadonlyArray<string> = [
  MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
  MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME,
  MANAGED_DEVICE_BATTERY_LEVEL_METRIC_NAME,
  MANAGED_DEVICE_BATTERY_CHARGING_METRIC_NAME,
  MANAGED_DEVICE_STORAGE_USED_METRIC_NAME,
];

/*
 * The key an import keeps whether a device is on its charger under, in its
 * details (#10288): true on power, false on its battery, and left out
 * where the service says neither. Each service's own field, made one shape
 * by its parser (getManagedDeviceChargingDetails), so a reading reads it
 * the same way whatever the service.
 */
export const MANAGED_DEVICE_IS_CHARGING_DETAIL: string = "isCharging";

/*
 * What a parser keeps of whether a device is on its charger, under the key
 * a reading reads (#10288): true or false, and nothing where the service
 * said neither. Pure.
 */
export function getManagedDeviceChargingDetails(
  isCharging: boolean | null | undefined,
): Record<string, boolean> {
  return typeof isCharging === "boolean"
    ? { [MANAGED_DEVICE_IS_CHARGING_DETAIL]: isCharging }
    : {};
}

/*
 * The keys an import keeps a device's storage under, in its details, in
 * bytes (#10008): each service's own fields, made one shape by its parser,
 * so a reading is read the same way whatever the service.
 */
export const MANAGED_DEVICE_STORAGE_TOTAL_BYTES_DETAIL: string =
  "storageTotalBytes";
export const MANAGED_DEVICE_STORAGE_FREE_BYTES_DETAIL: string =
  "storageFreeBytes";

/*
 * What a parser keeps of a device's storage, in bytes, under the keys a
 * reading reads (#10008): each one a whole number of bytes, more than 0,
 * and left out where the service said none, 0 or something that is no
 * size. Pure.
 */
export function getManagedDeviceStorageDetails(data: {
  totalBytes: number | null | undefined;
  freeBytes: number | null | undefined;
}): Record<string, number> {
  const details: Record<string, number> = {};
  const isSize: (value: number | null | undefined) => value is number = (
    value: number | null | undefined,
  ): value is number => {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
  };

  if (isSize(data.totalBytes)) {
    details[MANAGED_DEVICE_STORAGE_TOTAL_BYTES_DETAIL] = Math.round(
      data.totalBytes,
    );
  }

  if (isSize(data.freeBytes)) {
    details[MANAGED_DEVICE_STORAGE_FREE_BYTES_DETAIL] = Math.round(
      data.freeBytes,
    );
  }

  return details;
}

/*
 * The attributes of each reading. OneUptime's own keys, bare like the other
 * series OneUptime writes (oneuptime.data.table.*), and the device's host
 * as telemetry names it (resource.host.name, trimmed and lowercased), so a
 * host's charts and filters find its check-ins beside what it sends.
 */
export enum ManagedDeviceCheckInAttribute {
  // The connection that read the device: what a monitor is scoped to.
  ConnectionId = "oneuptime.managed_device.connection.id",
  // The service: "esper".
  Provider = "oneuptime.managed_device.provider",
  /*
   * The device's name in the service, which names it uniquely and never
   * changes (Esper's ESP-ID-AAAAW): what a monitor groups by, one alert per
   * device.
   */
  DeviceName = "oneuptime.managed_device.name",
  // The name people gave it in the service ("Store 12 Kiosk 3"), if any.
  Alias = "oneuptime.managed_device.alias",
  // Its group in the service, as a path where it has one.
  Group = "oneuptime.managed_device.group",
  // "true" while the device is a host in Hosts (it runs the Android agent).
  IsHost = "oneuptime.managed_device.is_host",
  /*
   * What it runs (ManagedDevicePlatform): "android", "ios", "ipados"... A
   * monitor of an Esper connection reads its Android devices and its Apple
   * devices apart, since an Apple device checks in hours apart (#9837).
   */
  Platform = "oneuptime.managed_device.platform",
  // Its host, as telemetry names it.
  HostName = "resource.host.name",
  /*
   * An Android device's security patch level, as its service reports it
   * ("2024-06-05"): on its security patch readings only.
   */
  SecurityPatchLevel = "oneuptime.managed_device.security_patch.level",
  // A device's free and whole storage, in bytes: on its storage readings only.
  StorageFreeBytes = "oneuptime.managed_device.storage.free_bytes",
  StorageTotalBytes = "oneuptime.managed_device.storage.total_bytes",
}

// The device's state, as far as its check-ins are concerned.
const STATUSES_WITH_A_CHECK_IN_AGE: ReadonlySet<ManagedDeviceStatus> =
  new Set<ManagedDeviceStatus>([
    ManagedDeviceStatus.Online,
    ManagedDeviceStatus.Offline,
  ]);

// What a reading reads of a device.
export interface ManagedDeviceCheckInDevice {
  providerDeviceId?: string | undefined;
  // What it runs; none (a row read before the platform was kept) is Android.
  platform?: string | undefined | null;
  deviceName?: string | undefined;
  alias?: string | undefined;
  serialNumber?: string | undefined;
  groupName?: string | undefined;
  groupPath?: string | undefined;
  providerState?: number | null | undefined;
  lastCheckInAt?: Date | string | null | undefined;
  removedAt?: Date | string | null | undefined;
  // An Android device's security patch level, as the service reports it.
  securityPatchLevel?: string | null | undefined;
  // Its battery in percent, as the service last heard it; none for no battery.
  batteryLevel?: number | null | undefined;
  /*
   * What else the service says of it (ManagedDevice.details): its storage
   * in bytes, under MANAGED_DEVICE_STORAGE_TOTAL_BYTES_DETAIL and
   * MANAGED_DEVICE_STORAGE_FREE_BYTES_DETAIL.
   */
  details?: Record<string, unknown> | null | undefined;
}

// How old a device's security patch is, at a read.
export interface ManagedDeviceSecurityPatchReading {
  // The level, as the service reports it: "2024-06-05".
  level: string;
  // Whole UTC days since the level's date, as the agent counts them.
  ageInDays: number;
}

// How full a device's own storage is, at a read.
export interface ManagedDeviceStorageReading {
  // Of its storage, how much is in use: 0 to 100, to one decimal.
  usedPercent: number;
  totalBytes: number;
  freeBytes: number;
}

export interface ManagedDeviceCheckInReading {
  /*
   * The device's name in the service (its host.name, as written), with its
   * host's name after it when another device of the connection shares it.
   */
  deviceName: string;
  // Its host, as telemetry names it: trimmed and lowercased.
  hostName: string;
  alias: string;
  group: string;
  platform: ManagedDevicePlatform;
  ageInMinutes: number;
  // Whether it is a host in Hosts, which Host Stopped Reporting watches.
  isHost: boolean;
  /*
   * An Android device's security patch, when the service reports a level
   * of the calendar: the patch readings a read writes beside the check-ins.
   */
  securityPatch?: ManagedDeviceSecurityPatchReading | undefined;
  // Its battery in percent, when it reports one (#10008).
  batteryLevel?: number | undefined;
  /*
   * Whether it is on its charger, when it reports a battery and its
   * service says which (#10288).
   */
  isCharging?: boolean | undefined;
  // How full its storage is, when it reports its storage and its free space.
  storage?: ManagedDeviceStorageReading | undefined;
}

/*
 * A device's battery, as a reading reads it: a percent from 1 to 100. 0
 * says no battery - a device at 0% cannot check in - and anything else is
 * none. Pure.
 */
export function getManagedDeviceBatteryReading(
  batteryLevel: number | null | undefined,
): number | undefined {
  if (
    typeof batteryLevel !== "number" ||
    !Number.isFinite(batteryLevel) ||
    batteryLevel <= 0 ||
    batteryLevel > 100
  ) {
    return undefined;
  }

  return Math.round(batteryLevel);
}

/*
 * Whether a device is on its charger, from what its import keeps of it
 * (MANAGED_DEVICE_IS_CHARGING_DETAIL): true or false, and undefined for
 * anything else. Pure.
 */
export function getManagedDeviceChargingReading(
  details: Record<string, unknown> | null | undefined,
): boolean | undefined {
  if (!details || typeof details !== "object") {
    return undefined;
  }

  const isCharging: unknown = details[MANAGED_DEVICE_IS_CHARGING_DETAIL];

  return typeof isCharging === "boolean" ? isCharging : undefined;
}

function readBytes(value: unknown): number | undefined {
  const bytes: number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;

  return Number.isFinite(bytes) && bytes >= 0 ? Math.round(bytes) : undefined;
}

/*
 * How full a device's own storage is, from what its import keeps of it in
 * bytes (MANAGED_DEVICE_STORAGE_TOTAL_BYTES_DETAIL and
 * MANAGED_DEVICE_STORAGE_FREE_BYTES_DETAIL). None when either is missing,
 * when the whole is 0, when it says no byte is free - a service's default
 * for a device that never said (Intune's freeStorageSpaceInBytes), never a
 * device full to its last byte - or when it says more is free than there
 * is. Pure.
 */
export function getManagedDeviceStorageReading(
  details: Record<string, unknown> | null | undefined,
): ManagedDeviceStorageReading | undefined {
  if (!details || typeof details !== "object") {
    return undefined;
  }

  const totalBytes: number | undefined = readBytes(
    details[MANAGED_DEVICE_STORAGE_TOTAL_BYTES_DETAIL],
  );
  const freeBytes: number | undefined = readBytes(
    details[MANAGED_DEVICE_STORAGE_FREE_BYTES_DETAIL],
  );

  if (
    totalBytes === undefined ||
    freeBytes === undefined ||
    totalBytes <= 0 ||
    freeBytes <= 0 ||
    freeBytes > totalBytes
  ) {
    return undefined;
  }

  return {
    usedPercent:
      Math.round(((totalBytes - freeBytes) / totalBytes) * 1000) / 10,
    totalBytes,
    freeBytes,
  };
}

/*
 * The security patch of a device, at `asOf`: an Android device's, when its
 * level is a date of the calendar (AndroidSecurityPatch.readLevel and
 * getAgeInDays: "2024-02-30" is none). Never another platform's, whatever
 * its service reports. Pure.
 */
export function getManagedDeviceSecurityPatchReading(data: {
  platform: ManagedDevicePlatform;
  securityPatchLevel: string | null | undefined;
  asOf: Date;
}): ManagedDeviceSecurityPatchReading | undefined {
  if (data.platform !== ManagedDevicePlatform.Android) {
    return undefined;
  }

  const level: string | undefined = AndroidSecurityPatch.readLevel(
    data.securityPatchLevel,
  );

  if (!level) {
    return undefined;
  }

  const ageInDays: number | undefined = AndroidSecurityPatch.getAgeInDays(
    level,
    data.asOf,
  );

  return ageInDays === undefined ? undefined : { level, ageInDays };
}

function toTime(value: Date | string | null | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const time: number =
    value instanceof Date ? value.getTime() : new Date(value).getTime();

  return Number.isNaN(time) ? undefined : time;
}

/*
 * Whole minutes from a check-in to `asOf`: 59 minutes and 59 seconds is
 * 59, so "more than 60" means a device silent for a minute past the hour.
 * Never negative (a check-in stamped after the read's end by a clock ahead
 * of it), and undefined when there is no check-in to measure from. Pure.
 */
export function getManagedDeviceCheckInAgeInMinutes(
  lastCheckInAt: Date | string | null | undefined,
  asOf: Date,
): number | undefined {
  const checkIn: number | undefined = toTime(lastCheckInAt);

  if (checkIn === undefined) {
    return undefined;
  }

  return Math.max(0, Math.floor((asOf.getTime() - checkIn) / (60 * 1000)));
}

/*
 * The readings of a connection's devices at `asOf`: one per device in
 * service with a known check-in, by its name in the service. Two devices
 * that share a name (Intune's "iPhone") are each told apart by what names
 * their hosts (getManagedDeviceUniqueHostName), so each is a series of its
 * own and its reading lands on its own host. `hostNames` are the hosts in
 * Hosts, as telemetry names them. Pure.
 */
export function getManagedDeviceCheckInReadings(data: {
  devices: ReadonlyArray<ManagedDeviceCheckInDevice>;
  hostNames: ReadonlySet<string>;
  asOf: Date;
  // The connection's service; Esper when absent.
  provider?: string | undefined;
}): Array<ManagedDeviceCheckInReading> {
  const readings: Array<ManagedDeviceCheckInReading> = [];
  const seen: Set<string> = new Set<string>();
  // As Inventory names their hosts: from the devices still in the service.
  const sharedNames: Set<string> = getSharedManagedDeviceNames(
    data.devices.filter((device: ManagedDeviceCheckInDevice): boolean => {
      return !device.removedAt;
    }),
  );

  for (const device of data.devices) {
    const platform: ManagedDevicePlatform = readManagedDevicePlatform(
      device.platform,
    );
    const status: ManagedDeviceStatus = getManagedDeviceStatus({
      providerState: device.providerState,
      lastCheckInAt: device.lastCheckInAt,
      removedAt: device.removedAt,
      provider: data.provider,
      platform: platform,
      now: data.asOf,
    });

    if (!STATUSES_WITH_A_CHECK_IN_AGE.has(status)) {
      continue;
    }

    const ageInMinutes: number | undefined =
      getManagedDeviceCheckInAgeInMinutes(device.lastCheckInAt, data.asOf);

    if (ageInMinutes === undefined) {
      continue;
    }

    const naming: ManagedDeviceNaming = {
      deviceName: device.deviceName,
      serialNumber: device.serialNumber,
      providerDeviceId: device.providerDeviceId,
    };
    const deviceName: string = getManagedDeviceUniqueName(naming, sharedNames);
    const hostName: string = canonicalizeManagedDeviceIdentity(
      getManagedDeviceUniqueHostName(naming, sharedNames),
    );

    if (!hostName || seen.has(hostName)) {
      continue;
    }

    seen.add(hostName);

    const securityPatch: ManagedDeviceSecurityPatchReading | undefined =
      getManagedDeviceSecurityPatchReading({
        platform,
        securityPatchLevel: device.securityPatchLevel,
        asOf: data.asOf,
      });
    const batteryLevel: number | undefined = getManagedDeviceBatteryReading(
      device.batteryLevel,
    );
    // On its charger or not: of a device with a battery alone (#10288).
    const isCharging: boolean | undefined =
      batteryLevel !== undefined
        ? getManagedDeviceChargingReading(device.details)
        : undefined;
    const storage: ManagedDeviceStorageReading | undefined =
      getManagedDeviceStorageReading(device.details);

    readings.push({
      deviceName,
      hostName,
      alias: (device.alias || "").trim(),
      group: (device.groupPath || device.groupName || "").trim(),
      platform,
      ageInMinutes,
      isHost: data.hostNames.has(hostName),
      ...(securityPatch ? { securityPatch } : {}),
      ...(batteryLevel !== undefined ? { batteryLevel } : {}),
      ...(isCharging !== undefined ? { isCharging } : {}),
      ...(storage ? { storage } : {}),
    });
  }

  return readings;
}

/*
 * A reading's attributes. An alias or a group the device has none of is
 * left out rather than written empty. Pure.
 */
export function getManagedDeviceCheckInAttributes(data: {
  reading: ManagedDeviceCheckInReading;
  connectionId: string;
  provider: string;
}): Dictionary<string> {
  const attributes: Dictionary<string> = {
    [ManagedDeviceCheckInAttribute.ConnectionId]: data.connectionId,
    [ManagedDeviceCheckInAttribute.Provider]: data.provider,
    [ManagedDeviceCheckInAttribute.DeviceName]: data.reading.deviceName,
    [ManagedDeviceCheckInAttribute.IsHost]: data.reading.isHost
      ? "true"
      : "false",
    [ManagedDeviceCheckInAttribute.Platform]: data.reading.platform,
    [ManagedDeviceCheckInAttribute.HostName]: data.reading.hostName,
  };

  if (data.reading.alias) {
    attributes[ManagedDeviceCheckInAttribute.Alias] = data.reading.alias;
  }

  if (data.reading.group) {
    attributes[ManagedDeviceCheckInAttribute.Group] = data.reading.group;
  }

  return attributes;
}

/*
 * A security patch reading's attributes: the check-in's, which name the
 * device and its connection the same way, and the level it was read at.
 * Undefined for a reading with no patch. Pure.
 */
export function getManagedDeviceSecurityPatchAttributes(data: {
  reading: ManagedDeviceCheckInReading;
  connectionId: string;
  provider: string;
}): Dictionary<string> | undefined {
  if (!data.reading.securityPatch) {
    return undefined;
  }

  return {
    ...getManagedDeviceCheckInAttributes(data),
    [ManagedDeviceCheckInAttribute.SecurityPatchLevel]:
      data.reading.securityPatch.level,
  };
}

/*
 * A storage reading's attributes (#10008): the check-in's, and how many
 * bytes were free of how many, so its readings say what filled up.
 * Undefined for a reading with no storage. Pure.
 */
export function getManagedDeviceStorageAttributes(data: {
  reading: ManagedDeviceCheckInReading;
  connectionId: string;
  provider: string;
}): Dictionary<string> | undefined {
  if (!data.reading.storage) {
    return undefined;
  }

  return {
    ...getManagedDeviceCheckInAttributes(data),
    [ManagedDeviceCheckInAttribute.StorageFreeBytes]: String(
      data.reading.storage.freeBytes,
    ),
    [ManagedDeviceCheckInAttribute.StorageTotalBytes]: String(
      data.reading.storage.totalBytes,
    ),
  };
}
