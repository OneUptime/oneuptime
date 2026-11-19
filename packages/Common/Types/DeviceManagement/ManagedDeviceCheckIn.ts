import Dictionary from "../Dictionary";
import {
  canonicalizeManagedDeviceIdentity,
  getManagedDeviceHostName,
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
 */

// The metric: minutes since the device's last check-in, a gauge per read.
export const MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME: string =
  "oneuptime.managed_device.check_in.age";

export const MANAGED_DEVICE_CHECK_IN_AGE_UNIT: string = "min";

export const MANAGED_DEVICE_CHECK_IN_AGE_DESCRIPTION: string =
  "Minutes since a managed device last checked in with its device management service, as the last read of its connection found them. One reading per device in service, at every read.";

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
}

export interface ManagedDeviceCheckInReading {
  // The device's name in the service (its host.name, as written).
  deviceName: string;
  // Its host, as telemetry names it: trimmed and lowercased.
  hostName: string;
  alias: string;
  group: string;
  platform: ManagedDevicePlatform;
  ageInMinutes: number;
  // Whether it is a host in Hosts, which Host Stopped Reporting watches.
  isHost: boolean;
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
 * service with a known check-in, by its name in the service, the first of
 * two that share one (which a service that names its devices uniquely
 * never sends). `hostNames` are the hosts in Hosts, as telemetry names
 * them. Pure.
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

    const deviceName: string = getManagedDeviceHostName({
      deviceName: device.deviceName,
      serialNumber: device.serialNumber,
      providerDeviceId: device.providerDeviceId,
    });
    const hostName: string = canonicalizeManagedDeviceIdentity(deviceName);

    if (!hostName || seen.has(hostName)) {
      continue;
    }

    seen.add(hostName);

    readings.push({
      deviceName,
      hostName,
      alias: (device.alias || "").trim(),
      group: (device.groupPath || device.groupName || "").trim(),
      platform,
      ageInMinutes,
      isHost: data.hostNames.has(hostName),
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
