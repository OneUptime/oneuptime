import DeviceReachabilityUtil, {
  DEVICE_MISSED_POLL_ALLOWANCE,
  DEVICE_MIN_STALE_WINDOW_IN_MINUTES,
  DeviceReachabilityInput,
  DeviceReachabilityResult,
  NetworkDeviceReachability,
} from "Common/Utils/NetworkDevice/DeviceReachabilityUtil";
import { NetworkDeviceMonitoringMethodUtil } from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "Common/Types/ObjectID";

/*
 * The dashboard's view of Common/Utils/NetworkDevice/DeviceReachabilityUtil,
 * which is the single rule the device list, the device Overview hero, the
 * topology graph, the network map and the site rollup all decide up/down by.
 *
 * A device is Up when its LAST POLL SUCCEEDED — not when that poll was
 * recent. The two are different questions, and answering the second one
 * meant a fleet whose real poll cadence exceeded the old fixed 15-minute
 * window (a probe hands out a bounded number of devices per cycle, so
 * cadence is a function of fleet size) showed healthy devices as Down while
 * their own Interfaces tab, written by the same successful walk, showed
 * them Up.
 *
 * ...unless nothing polls the device at all. A monitor-backed device is
 * judged by the Monitor bound to it, and this door is where the nested
 * `currentMonitorStatus` relation the API returns is turned into the flag
 * the shared rule reads.
 */

export {
  DEVICE_MISSED_POLL_ALLOWANCE,
  DEVICE_MIN_STALE_WINDOW_IN_MINUTES,
  NetworkDeviceReachability as NetworkDeviceStatus,
};
export type { DeviceReachabilityInput, DeviceReachabilityResult };

/*
 * The columns every caller of this util has to select. Exported so a page
 * cannot add a status pill and forget one of them — a missing `isReachable`
 * silently falls back to the legacy freshness rule and reintroduces the bug,
 * and a missing `monitoringMethod` / `currentMonitorStatus` leaves every
 * monitor-backed device on "Pending" whatever its monitor says
 * (OneUptime/oneuptime#3392).
 */
export const DEVICE_STATUS_SELECT: {
  isReachable: boolean;
  lastPolledAt: boolean;
  lastSeenAt: boolean;
  pollingIntervalInMinutes: boolean;
  monitoringMethod: boolean;
  currentMonitorStatus: {
    name: boolean;
    color: boolean;
    isOfflineState: boolean;
  };
} = {
  isReachable: true,
  lastPolledAt: true,
  lastSeenAt: true,
  pollingIntervalInMinutes: true,
  monitoringMethod: true,
  /*
   * `name` and `color` so a surface can render the operator's own status
   * word ("Operational", "Degraded") instead of flattening it to Up/Down;
   * `isOfflineState` because that is the end of the ladder the rule reads.
   */
  currentMonitorStatus: {
    name: true,
    color: true,
    isOfflineState: true,
  },
};

/*
 * A NetworkDevice row as the API returns it: the monitor's verdict arrives
 * as the nested `currentMonitorStatus` relation, while the shared rule takes
 * the one flag it reads. Accepting both spellings is what lets every page go
 * on passing the model straight through.
 */
export interface DeviceStatusRow extends DeviceReachabilityInput {
  currentMonitorStatus?:
    | {
        isOfflineState?: boolean | null | undefined;
      }
    | null
    | undefined;
}

function toReachabilityInput(device: DeviceStatusRow): DeviceReachabilityInput {
  if (device.monitorStatusIsOffline !== undefined) {
    return device;
  }

  return {
    ...device,
    /*
     * No stamped status stays `undefined` rather than becoming `false` — the
     * rule reads that as "no monitor has reported yet" (Pending), and
     * defaulting it to "not offline" would paint an unbound device green.
     */
    monitorStatusIsOffline: device.currentMonitorStatus
      ? Boolean(device.currentMonitorStatus.isOfflineState)
      : undefined,
  };
}

export default class DeviceStatusUtil {
  public static getStatus(device: DeviceStatusRow): NetworkDeviceReachability {
    return DeviceReachabilityUtil.getStatus(toReachabilityInput(device));
  }

  public static getReachability(
    device: DeviceStatusRow,
  ): DeviceReachabilityResult {
    return DeviceReachabilityUtil.getReachability(toReachabilityInput(device));
  }

  public static getStaleWindowInMinutes(
    pollingIntervalInMinutes?: number | null | undefined,
  ): number {
    return DeviceReachabilityUtil.getStaleWindowInMinutes(
      pollingIntervalInMinutes,
    );
  }
}

/*
 * The "No monitor" QUALIFIER.
 *
 * A monitor-backed device with nothing bound reads "Pending" — the verdict
 * is honest (nothing has judged it) but it is not actionable: the same word
 * covers an SNMP device that is queued for its first poll, which fixes
 * itself, and a monitor-backed device that will sit there forever because
 * nobody bound a monitor. The tiles above the list and the Status chip
 * partition the fleet into exactly Up / Down / Pending, so this is NOT a
 * fourth verdict — a fourth word would make "Status is Pending" return rows
 * whose pill says something else. It is a second, gray pill beside the
 * verdict, the same shape as the amber "Stale" pill beside an SNMP verdict:
 * it qualifies the answer and says what to do about it.
 *
 * Every surface that prints a device status reads these, so the list, the
 * site's Devices tab and the device Overview hero use one word and one
 * sentence.
 */

/** The two columns the qualifier is decided from. */
export interface DeviceBindingRow {
  monitoringMethod?: string | null | undefined;
  monitorId?: ObjectID | string | null | undefined;
}

export const NO_MONITOR_QUALIFIER: { text: string; tooltip: string } = {
  text: "No monitor",
  tooltip:
    "Nothing reports this device's health: it is monitor-backed and no monitor is bound to it. Open the device and use Create Ping Monitor, or bind an existing monitor under its Settings.",
};

/*
 * The Pending tooltips for the two ways a monitor-backed device can have no
 * verdict. Split so neither sentence has to hedge with "or".
 */
export const UNBOUND_MONITOR_BACKED_PENDING_TOOLTIP: string =
  "Nothing reports this device's health yet — no monitor is bound to it.";

export const BOUND_MONITOR_PENDING_TOOLTIP: string =
  "The monitor bound to this device has not reported a status yet.";

/**
 * True for a monitor-backed device with nothing bound — the one case the
 * qualifier is shown for. Read through the method parser, never a raw
 * compare: NULL means SNMP, and an SNMP device has no binding to be missing.
 */
export function isUnboundMonitorBackedDevice(
  device: DeviceBindingRow,
): boolean {
  return (
    NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
      device.monitoringMethod,
    ) && !device.monitorId
  );
}
