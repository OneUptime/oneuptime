import OneUptimeDate from "../../Types/Date";
import { NetworkDeviceMonitoringMethodUtil } from "../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../Types/ObjectID";

/*
 * The one place that decides whether a NetworkDevice is reachable.
 *
 * The rule this replaces was "lastSeenAt within a fixed 15 minutes = up",
 * which conflates two different facts:
 *
 *   1. the device did not answer the probe   (the device is down), and
 *   2. the probe has not asked it recently   (WE are behind).
 *
 * (2) is not a device outage. A probe hands out at most a bounded number of
 * devices per fetch cycle, so a large fleet's real poll cadence is
 * `fleetSize / claimRate` minutes however short the configured interval is —
 * and a fleet whose cadence exceeds the freshness window paints healthy
 * devices red on the device list, the topology graph and the site rollup,
 * while the device's own Interfaces tab (written by that same successful
 * walk) still reads "Up". A device polled on a 30-minute interval was
 * permanently "Down" for the same reason: it can never satisfy a 15-minute
 * window.
 *
 * So reachability is now the OUTCOME of the most recent poll —
 * NetworkDevice.isReachable, stamped by the poll pipeline on every ingested
 * poll (a ping, plus the SNMP walk on a device that has credentials; the
 * device is reachable when either answers) — and freshness is only a
 * backstop for "the polling pipeline itself stopped", measured generously
 * against the device's own interval.
 *
 * All of which is about a device that gets POLLED. A monitor-backed device
 * (monitoringMethod "Monitor") is never polled at all: no probe, no ping,
 * no walk. Every poll column on such a row is NULL forever, so
 * the rule above can only ever answer "Pending" for it — which is
 * OneUptime/oneuptime#3392, a correctly bound ping-only device stuck on
 * Pending. Its health comes from the Monitor bound to it, stamped onto
 * NetworkDevice.currentMonitorStatusId, and that is the branch below.
 */

export enum NetworkDeviceReachability {
  Up = "Up",
  Down = "Down",
  Pending = "Pending",
}

/*
 * Mirrors the NetworkDevice.pollingIntervalInMinutes column default, and is
 * what a NULL interval (rows written before that column existed) is read as.
 */
export const DEFAULT_DEVICE_POLLING_INTERVAL_IN_MINUTES: number = 5;

/*
 * Consecutive missed polls before a device's last verdict is reported as
 * STALE. Staleness is an annotation on the verdict, never the verdict
 * itself — see getReachability for why turning it into "Down" would both
 * re-create this bug at a longer timescale and put the pill permanently at
 * odds with the summary counts.
 *
 * Deliberately generous: a device that stops answering is marked
 * unreachable by the very next poll, so the only thing this flags is the
 * whole polling pipeline going silent (probe offline, claim loop wedged,
 * walk queue backed up). Ten missed cycles is unambiguous.
 */
export const DEVICE_MISSED_POLL_ALLOWANCE: number = 10;

/*
 * Floor under the window above, so a device on a one-minute interval is not
 * declared out of contact after ten minutes of ordinary scheduling jitter.
 */
export const DEVICE_MIN_STALE_WINDOW_IN_MINUTES: number = 60;

// The columns this util reads. Every caller selects exactly these.
export interface DeviceReachabilityInput {
  /*
   * Outcome of the most recent poll: true = the device answered (ping, or
   * the SNMP walk — either is enough), false = the probe could not reach it
   * by any means, null/undefined = never polled, or a row written before
   * this column existed.
   */
  isReachable?: boolean | null | undefined;
  // When the probe last ATTEMPTED a poll, whatever the outcome.
  lastPolledAt?: Date | string | null | undefined;
  // When the device last ANSWERED one.
  lastSeenAt?: Date | string | null | undefined;
  // The device's own schedule; sizes the staleness backstop.
  pollingIntervalInMinutes?: number | null | undefined;
  /*
   * How this device's health is established. NULL, empty and anything
   * unrecognised read as Probe — see NetworkDeviceMonitoringMethodUtil.parse,
   * which is why an omitted value keeps every existing caller on the poll
   * rule unchanged.
   */
  monitoringMethod?: string | null | undefined;
  /*
   * The OFFLINE end of the device's stamped MonitorStatus row, and only
   * consulted for a monitor-backed device. `undefined` means no monitor has
   * reported yet (nothing bound, or bound and never evaluated), which is a
   * real "Pending" rather than a healthy default.
   *
   * The offline end and not the operational end, because MonitorStatus is a
   * ladder rather than a pair: a "Degraded" row is NEITHER operational nor
   * offline, and the device map already resolves that ladder with
   * `isOfflineState ? down : up`. Reading the operational flag here instead
   * would paint every degraded-but-reachable device red on one surface and
   * green on the other. See DeviceHealthStateUtil, which reads it the same
   * way for the same reason.
   */
  monitorStatusIsOffline?: boolean | null | undefined;

  /*
   * QUALIFIER inputs. None of the four below moves the Up / Down / Pending
   * verdict — the rule above is deliberately decided by `isReachable` alone,
   * so the pill, the summary tiles and the Status chip (all SQL over that one
   * column) can never disagree. They ride on the same input so a surface can
   * hand its whole row over once and put the second, explanatory pill
   * ("SNMP failing", "No probe") beside the verdict; see the predicates in
   * the dashboard's DeviceStatusUtil.
   *
   * `isSnmpReachable`: the outcome of the last SNMP WALK, separate from the
   * ping — false is a device that answers ping but not SNMP (credentials, or
   * SNMP disabled on the box), NULL is "no walk was attempted": no usable
   * credentials, or never polled.
   */
  isSnmpReachable?: boolean | null | undefined;
  // When the last SUCCESSFUL walk completed; only moves on a success.
  lastSnmpSeenAt?: Date | string | null | undefined;
  /*
   * Which probe polls the device, and whether it is allowed to. A probe-polled
   * device with no probe, or with polling switched off, can never be polled
   * and is Pending for as long as that stays true.
   */
  probeId?: ObjectID | string | null | undefined;
  isPollingEnabled?: boolean | null | undefined;
}

export interface DeviceReachabilityResult {
  status: NetworkDeviceReachability;
  /*
   * True when the last poll ATTEMPT is older than the staleness window —
   * i.e. this verdict is being read off data nothing has refreshed for a
   * long time. Strictly independent of `status`: it qualifies the verdict
   * ("and nobody has checked lately") rather than changing it, and either
   * an Up or a Down device can be stale.
   */
  isStale: boolean;
  // The window `isStale` was measured against, so the UI can name it.
  staleWindowInMinutes: number;
  // Latest of lastPolledAt / lastSeenAt; null when neither is set.
  lastContactAt: Date | null;
  /*
   * True when this verdict came from the bound Monitor rather than from a
   * probe's poll. Carried so a surface can word its pill and its tooltip for
   * what actually decided the answer — "the last poll reached this device"
   * is a lie on a device nothing polls.
   */
  isMonitorBacked: boolean;
}

const MS_PER_MINUTE: number = 60 * 1000;

export default class DeviceReachabilityUtil {
  /*
   * The device's poll interval as a usable positive number. NULL, zero,
   * negative and non-finite values all fall back to the column default —
   * the same clamp NetworkDeviceService.claimDevicesForPolling applies when
   * it advances nextPollAt, so the window and the schedule agree.
   */
  public static getPollingIntervalInMinutes(
    pollingIntervalInMinutes?: number | null | undefined,
  ): number {
    if (
      typeof pollingIntervalInMinutes !== "number" ||
      !Number.isFinite(pollingIntervalInMinutes) ||
      pollingIntervalInMinutes <= 0
    ) {
      return DEFAULT_DEVICE_POLLING_INTERVAL_IN_MINUTES;
    }

    return Math.max(pollingIntervalInMinutes, 1);
  }

  // How long a device may go unpolled before its last verdict goes stale.
  public static getStaleWindowInMinutes(
    pollingIntervalInMinutes?: number | null | undefined,
  ): number {
    const interval: number = DeviceReachabilityUtil.getPollingIntervalInMinutes(
      pollingIntervalInMinutes,
    );

    return Math.max(
      interval * DEVICE_MISSED_POLL_ALLOWANCE,
      DEVICE_MIN_STALE_WINDOW_IN_MINUTES,
    );
  }

  public static getReachability(
    device: DeviceReachabilityInput,
    now?: Date | undefined,
  ): DeviceReachabilityResult {
    const currentDate: Date = now || OneUptimeDate.getCurrentDate();

    const staleWindowInMinutes: number =
      DeviceReachabilityUtil.getStaleWindowInMinutes(
        device.pollingIntervalInMinutes,
      );

    const lastPolledAt: Date | null = toDate(device.lastPolledAt);
    const lastSeenAt: Date | null = toDate(device.lastSeenAt);

    /*
     * Newest of the two. lastPolledAt alone would be wrong for rows written
     * before it existed (they only have lastSeenAt), and lastSeenAt alone
     * would call a device that is being polled and failing "out of contact"
     * — it is very much in contact, it is just down.
     */
    const lastContactAt: Date | null = newerOf(lastPolledAt, lastSeenAt);

    const isStale: boolean = lastContactAt
      ? currentDate.getTime() - lastContactAt.getTime() >
        staleWindowInMinutes * MS_PER_MINUTE
      : false;

    const isMonitorBacked: boolean =
      NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
        device.monitoringMethod,
      );

    const result: (
      status: NetworkDeviceReachability,
    ) => DeviceReachabilityResult = (
      status: NetworkDeviceReachability,
    ): DeviceReachabilityResult => {
      return {
        status: status,
        /*
         * Staleness is "nothing has polled this device lately", so it can
         * only ever be false for a device nothing polls BY DESIGN. Letting
         * it through would put an amber "check this device's probe" pill on
         * every monitor-backed device forever — and it has no probe.
         */
        isStale: isMonitorBacked ? false : isStale,
        staleWindowInMinutes: staleWindowInMinutes,
        lastContactAt: lastContactAt,
        isMonitorBacked: isMonitorBacked,
      };
    };

    /*
     * Monitor-backed: the bound Monitor's verdict IS the device's, and the
     * poll columns below are meaningless for it (they are NULL forever, and
     * on a device switched over from SNMP they are worse than meaningless —
     * they are the last thing a probe found before it stopped asking).
     *
     * No stamped status means Pending, and it is honest in both of the ways
     * it happens: no monitor is bound yet (discovery import creates devices
     * that way on purpose), or one is bound and has not been evaluated yet.
     */
    if (isMonitorBacked) {
      if (device.monitorStatusIsOffline === true) {
        return result(NetworkDeviceReachability.Down);
      }

      if (device.monitorStatusIsOffline === false) {
        return result(NetworkDeviceReachability.Up);
      }

      return result(NetworkDeviceReachability.Pending);
    }

    /*
     * The probe asked and got nothing. Authoritative however long ago it
     * was — nothing since has said otherwise.
     */
    if (device.isReachable === false) {
      return result(NetworkDeviceReachability.Down);
    }

    /*
     * The probe asked and the device answered. The answer stands until a
     * later poll contradicts it.
     *
     * Staleness deliberately does NOT override this. Turning "we have not
     * asked in a while" into "the device is down" is the exact move this
     * whole change exists to undo — doing it again at a longer timescale
     * would just relocate the bug. It is also not expressible as a database
     * filter (the window is per-device, derived from each row's own
     * interval), so a status that depended on it could never agree with the
     * summary counts or the Status filter, which have to run in SQL over
     * `isReachable`. A verdict the list cannot count or filter by is a
     * verdict that contradicts itself on screen.
     *
     * `isStale` still comes back in the result, and the UI shows it as what
     * it is — "nothing has polled this device in N minutes, check its
     * probe" — which is a different and more actionable statement than
     * "this device is down".
     */
    if (device.isReachable === true) {
      return result(NetworkDeviceReachability.Up);
    }

    /*
     * No recorded outcome. Either the device has genuinely never been polled
     * (Pending), or the row predates the column — in which case lastSeenAt
     * is all we have and freshness is the only rule available. The upgrade
     * migration backfills these, so this is a short-lived path.
     */
    if (!lastSeenAt) {
      /*
       * Polled but never once answered — the probe has been trying and
       * failing, which is Down, not "not set up yet".
       */
      if (lastPolledAt) {
        return result(NetworkDeviceReachability.Down);
      }

      return result(NetworkDeviceReachability.Pending);
    }

    return result(
      isStale ? NetworkDeviceReachability.Down : NetworkDeviceReachability.Up,
    );
  }

  // Shorthand for callers that only render the pill.
  public static getStatus(
    device: DeviceReachabilityInput,
    now?: Date | undefined,
  ): NetworkDeviceReachability {
    return DeviceReachabilityUtil.getReachability(device, now).status;
  }
}

/*
 * Tolerant of everything an API payload can carry in a date column: a Date,
 * an ISO string, the serialized {_type, value} form, null, undefined and the
 * empty string. Anything unparseable reads as "not set" rather than as an
 * Invalid Date that would silently compare false against every window.
 */
function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed: Date = OneUptimeDate.fromString(value);

  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function newerOf(first: Date | null, second: Date | null): Date | null {
  if (!first) {
    return second;
  }

  if (!second) {
    return first;
  }

  return first.getTime() >= second.getTime() ? first : second;
}
