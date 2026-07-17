import OneUptimeDate from "Common/Types/Date";

/*
 * A device is considered up when its last successful SNMP poll happened
 * within this window. Mirrors FRESH_WINDOW_MS in
 * Common/Utils/Monitor/NetworkTopologyUtil.ts so the device list and the
 * topology view agree on what "up" means.
 */
export const DEVICE_FRESH_WINDOW_MINUTES: number = 15;

export enum NetworkDeviceStatus {
  Up = "Up",
  Down = "Down",
  Pending = "Pending",
}

export default class DeviceStatusUtil {
  public static getStatus(
    lastSeenAt: Date | string | undefined,
  ): NetworkDeviceStatus {
    if (!lastSeenAt) {
      // Never polled successfully — the device is still pending discovery.
      return NetworkDeviceStatus.Pending;
    }

    const lastSeen: Date = OneUptimeDate.fromString(lastSeenAt);
    const cutoff: Date = OneUptimeDate.getSomeMinutesAgo(
      DEVICE_FRESH_WINDOW_MINUTES,
    );

    if (lastSeen.getTime() < cutoff.getTime()) {
      return NetworkDeviceStatus.Down;
    }

    return NetworkDeviceStatus.Up;
  }
}
