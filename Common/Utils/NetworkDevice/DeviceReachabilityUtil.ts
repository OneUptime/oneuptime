import OneUptimeDate from "../../Types/Date";

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
 * NetworkDevice.isReachable, stamped by the walk pipeline on every ingested
 * walk — and freshness is only a backstop for "the polling pipeline itself
 * stopped", measured generously against the device's own interval.
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
 * Consecutive missed polls before a device that last answered successfully
 * is treated as out of contact.
 *
 * Deliberately generous. Real down-detection no longer rides on this number
 * — a device that stops answering is marked unreachable by the very next
 * poll — so the only thing this catches is the whole polling pipeline going
 * silent (probe offline, claim loop wedged, walk queue backed up). Ten
 * missed cycles is unambiguous; a tighter threshold would go back to
 * reporting scheduler lag as a fleet-wide outage, which is the bug this
 * exists to prevent.
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
   * Outcome of the most recent poll: true = the device answered, false = the
   * probe could not reach it, null/undefined = never polled, or a row
   * written before this column existed.
   */
  isReachable?: boolean | null | undefined;
  // When the probe last ATTEMPTED a walk, whatever the outcome.
  lastPolledAt?: Date | string | null | undefined;
  // When the device last ANSWERED one.
  lastSeenAt?: Date | string | null | undefined;
  // The device's own schedule; sizes the staleness backstop.
  pollingIntervalInMinutes?: number | null | undefined;
}

export interface DeviceReachabilityResult {
  status: NetworkDeviceReachability;
  /*
   * True when the last poll ATTEMPT is older than the staleness window —
   * i.e. this verdict is being read off data we can no longer vouch for.
   * Independent of `status`: an unreachable device can also be stale.
   */
  isStale: boolean;
  // The window `isStale` was measured against, so the UI can name it.
  staleWindowInMinutes: number;
  // Latest of lastPolledAt / lastSeenAt; null when neither is set.
  lastContactAt: Date | null;
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

    const result: (
      status: NetworkDeviceReachability,
    ) => DeviceReachabilityResult = (
      status: NetworkDeviceReachability,
    ): DeviceReachabilityResult => {
      return {
        status: status,
        isStale: isStale,
        staleWindowInMinutes: staleWindowInMinutes,
        lastContactAt: lastContactAt,
      };
    };

    /*
     * The probe asked and got nothing. Authoritative however long ago it
     * was — nothing since has said otherwise.
     */
    if (device.isReachable === false) {
      return result(NetworkDeviceReachability.Down);
    }

    /*
     * The probe asked and the device answered. This is the case the old
     * freshness rule got wrong: the answer stands until a later poll
     * contradicts it, or until we have gone so long without polling that we
     * can no longer vouch for it.
     */
    if (device.isReachable === true) {
      return result(
        isStale ? NetworkDeviceReachability.Down : NetworkDeviceReachability.Up,
      );
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
