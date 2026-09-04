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
 * A poll is a ping, plus an SNMP walk when the device has credentials, and
 * the device is Up when either answers. The walk's own outcome is a
 * separate column (`isSnmpReachable`) that never moves the verdict: it is
 * what the "SNMP failing" qualifier below reads.
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
 * a missing `monitoringMethod` / `currentMonitorStatus` leaves every
 * monitor-backed device on "Pending" whatever its monitor says
 * (OneUptime/oneuptime#3392), and a missing `isSnmpReachable` / `probeId` /
 * `isPollingEnabled` silently drops the qualifier pills that say WHY a
 * device reads the way it does.
 */
export const DEVICE_STATUS_SELECT: {
  isReachable: boolean;
  lastPolledAt: boolean;
  lastSeenAt: boolean;
  pollingIntervalInMinutes: boolean;
  monitoringMethod: boolean;
  isSnmpReachable: boolean;
  lastSnmpSeenAt: boolean;
  probeId: boolean;
  isPollingEnabled: boolean;
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
   * The walk's own outcome and its last success, for the "SNMP failing"
   * qualifier and the hero's SNMP line — never for the verdict.
   */
  isSnmpReachable: true,
  lastSnmpSeenAt: true,
  /*
   * Whether anything CAN poll the device, for the "No probe" qualifier: a
   * probe-polled device with no probe, or with polling switched off, is
   * Pending for as long as that stays true.
   */
  probeId: true,
  isPollingEnabled: true,
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
 * The tooltips behind a probe-polled device's verdict, worded once so the
 * list, the site's Devices tab and the Overview hero cannot drift. "The last
 * SNMP poll" is gone from all three on purpose: a device with no credentials
 * is pinged and never walked, and telling its operator that an SNMP poll
 * reached it sends them looking for interfaces it never collected.
 */
export const PROBE_POLLED_UP_TOOLTIP: string =
  "The last poll reached this device (ping or SNMP).";

export const PROBE_POLLED_DOWN_TOOLTIP: string =
  "The last poll could not reach this device — neither ping nor SNMP answered.";

export const NEVER_POLLED_PENDING_TOOLTIP: string =
  "This device has not been polled yet.";

/**
 * The amber "Stale" pill's tooltip. Staleness annotates the verdict rather
 * than replacing it — see DeviceReachabilityUtil — so the sentence says
 * what it is: nobody has asked lately, check the probe, not the device.
 */
export function getStaleTooltip(staleWindowInMinutes: number): string {
  return `No poll has been attempted in the last ${staleWindowInMinutes} minutes, so this verdict may be out of date — check that this device's probe is online and keeping up with its fleet.`;
}

/*
 * The QUALIFIERS.
 *
 * The tiles above the list and the Status chip partition the fleet into
 * exactly Up / Down / Pending, so none of these is a fourth verdict — a
 * fourth word would make "Status is Pending" return rows whose pill says
 * something else. Each is a second pill beside the verdict, the same shape
 * as the amber "Stale" pill: it qualifies the answer and says what to do
 * about it. There are three, one per way a verdict can be right and still
 * not be the whole story:
 *
 *   "No monitor"   — monitor-backed, nothing bound. Pending, and it will
 *                    stay Pending until somebody binds a monitor.
 *   "No probe"     — probe-polled, but no probe is assigned (or polling is
 *                    switched off). Pending, and it will stay Pending until
 *                    a probe that can reach it is assigned.
 *   "SNMP failing" — probe-polled and Up, because ping answers, but the
 *                    SNMP walk is failing. The device is reachable; its
 *                    interfaces, inventory and health OIDs are not being
 *                    refreshed, which is almost always credentials.
 *
 * Every surface that prints a device status reads these, so the list, the
 * site's Devices tab and the device Overview hero use one word and one
 * sentence per case.
 */

/** The two columns the "No monitor" qualifier is decided from. */
export interface DeviceBindingRow {
  monitoringMethod?: string | null | undefined;
  monitorId?: ObjectID | string | null | undefined;
}

/** The three columns the "No probe" qualifier is decided from. */
export interface DevicePollingRow {
  monitoringMethod?: string | null | undefined;
  probeId?: ObjectID | string | null | undefined;
  isPollingEnabled?: boolean | null | undefined;
}

export const NO_MONITOR_QUALIFIER: { text: string; tooltip: string } = {
  text: "No monitor",
  tooltip:
    "Nothing reports this device's health: it is monitor-backed and no monitor is bound to it. Open the device and use Create Ping Monitor, or bind an existing monitor under its Settings.",
};

export const NO_PROBE_QUALIFIER: { text: string; tooltip: string } = {
  text: "No probe",
  tooltip:
    "Assign a probe that can reach this device to have it pinged. Nothing polls it until then.",
};

export const SNMP_FAILING_QUALIFIER: { text: string; tooltip: string } = {
  text: "SNMP failing",
  tooltip:
    "The device answers ping but its SNMP walk is failing — check its credentials or that SNMP is enabled on the device. Interfaces, inventory and health OIDs are not being refreshed until it succeeds.",
};

/*
 * The Interfaces column's "not collected" states. Interface counts are
 * written by a successful SNMP walk and by nothing else, so a device that is
 * pinged and never walked has no counts to show — "0 / 0" would claim it has
 * no working ports, which is a different and wrong claim (#3447).
 */
export const NO_SNMP_INTERFACES_LABEL: { text: string; tooltip: string } = {
  text: "No SNMP",
  tooltip:
    "Add SNMP credentials for interfaces and inventory. This device is pinged only.",
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
 * "No monitor" qualifier is shown for. Read through the method parser, never
 * a raw compare: NULL means Probe, and a probe-polled device has no binding
 * to be missing.
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

/**
 * True for a probe-polled device nothing can poll: no probe assigned, or
 * polling switched off. Never true for a monitor-backed device, which has
 * no probe BY DESIGN and is qualified by its binding instead.
 *
 * Only an explicit `false` reads as "polling off": the column is
 * non-nullable with a default of true, so anything else is a row the page
 * did not select the column for, and a missing column must not turn into a
 * "No probe" pill on every row.
 */
export function isUnpolledProbeDevice(device: DevicePollingRow): boolean {
  if (
    NetworkDeviceMonitoringMethodUtil.isMonitorBacked(device.monitoringMethod)
  ) {
    return false;
  }

  return !device.probeId || device.isPollingEnabled === false;
}

/**
 * True for a probe-polled device that is Up while its last SNMP walk
 * failed — the one case the "SNMP failing" qualifier is shown for.
 *
 * "Up" is the shared rule's word, not a raw `isReachable` read, so the
 * qualifier can only ever sit beside a green pill: a device whose ping and
 * walk BOTH fail is Down, and a red pill with "SNMP failing" beside it would
 * send the operator to check credentials on a box that is off.
 */
export function isSnmpFailing(device: DeviceStatusRow): boolean {
  if (
    NetworkDeviceMonitoringMethodUtil.isMonitorBacked(device.monitoringMethod)
  ) {
    return false;
  }

  if (device.isSnmpReachable !== false) {
    return false;
  }

  return DeviceStatusUtil.getStatus(device) === NetworkDeviceReachability.Up;
}

/**
 * True for a probe-polled device that has been polled and never had an SNMP
 * walk attempted — i.e. it is pinged only, because it has no usable
 * credentials. The Interfaces column prints "No SNMP" for it rather than a
 * pair of zeroes.
 *
 * A device that has never been polled at all is left out: NULL means "no
 * walk attempted" in both cases, but before the first poll nothing is known
 * either way and the column prints "—".
 */
export function hasNoSnmpInventory(device: DeviceStatusRow): boolean {
  if (
    NetworkDeviceMonitoringMethodUtil.isMonitorBacked(device.monitoringMethod)
  ) {
    return false;
  }

  if (device.isSnmpReachable !== null && device.isSnmpReachable !== undefined) {
    return false;
  }

  return Boolean(device.lastPolledAt);
}
