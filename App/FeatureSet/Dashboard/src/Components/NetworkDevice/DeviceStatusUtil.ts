import DeviceReachabilityUtil, {
  DEVICE_MISSED_POLL_ALLOWANCE,
  DEVICE_MIN_STALE_WINDOW_IN_MINUTES,
  DeviceReachabilityInput,
  DeviceReachabilityResult,
  NetworkDeviceReachability,
} from "Common/Utils/NetworkDevice/DeviceReachabilityUtil";

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
 * silently falls back to the legacy freshness rule and reintroduces the bug.
 */
export const DEVICE_STATUS_SELECT: {
  isReachable: boolean;
  lastPolledAt: boolean;
  lastSeenAt: boolean;
  pollingIntervalInMinutes: boolean;
} = {
  isReachable: true,
  lastPolledAt: true,
  lastSeenAt: true,
  pollingIntervalInMinutes: true,
};

export default class DeviceStatusUtil {
  public static getStatus(
    device: DeviceReachabilityInput,
  ): NetworkDeviceReachability {
    return DeviceReachabilityUtil.getStatus(device);
  }

  public static getReachability(
    device: DeviceReachabilityInput,
  ): DeviceReachabilityResult {
    return DeviceReachabilityUtil.getReachability(device);
  }

  public static getStaleWindowInMinutes(
    pollingIntervalInMinutes?: number | null | undefined,
  ): number {
    return DeviceReachabilityUtil.getStaleWindowInMinutes(
      pollingIntervalInMinutes,
    );
  }
}
