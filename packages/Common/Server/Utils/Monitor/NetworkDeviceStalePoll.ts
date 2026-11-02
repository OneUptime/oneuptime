import OneUptimeDate from "../../../Types/Date";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import ObjectID from "../../../Types/ObjectID";
import { NetworkDeviceMonitoringMethodUtil } from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";

/*
 * WHEN A NETWORK DEVICE'S POLLS STOP, ITS MONITORS SAY SO.
 *
 * A Network Device monitor is evaluated on each poll of its device
 * (NetworkDeviceWalkUtil) and on each trap - and on nothing else. When the
 * polls stopped (its probe went down or fell behind, or polling was turned
 * off, or the device lost its probe), nothing evaluated the monitor again:
 * it kept the status of its last poll, "Device unreachable" never fired, and
 * a dead link read green.
 *
 * So a worker job (NetworkDeviceMonitor:CheckStalePolls) looks for devices
 * whose last poll is older than three of their polling intervals (at least
 * ten minutes), and evaluates each monitor on them as a poll that found the
 * device unreachable, saying why no poll came. The next real poll evaluates
 * the monitor again, and a reachable device resolves what this opened.
 *
 * A device whose polling someone turned off is left alone: the setting
 * pauses polling on purpose (a device watched by its traps alone, or one
 * under work), and nobody asking a device is not the device being down.
 */

// What this reads of a device.
export interface StalePollDevice {
  lastPolledAt?: Date | undefined;
  pollingIntervalInMinutes?: number | undefined;
  isPollingEnabled?: boolean | undefined;
  probeId?: ObjectID | undefined;
  hostname?: string | undefined;
  monitoringMethod?: string | undefined;
  createdAt?: Date | undefined;
}

export const DEFAULT_POLLING_INTERVAL_IN_MINUTES: number = 5;
export const MISSED_POLLS_BEFORE_STALE: number = 3;
export const MIN_STALE_AFTER_IN_MINUTES: number = 10;

export default class NetworkDeviceStalePoll {
  // How long a device may go without a poll before its monitors say so.
  public static getStaleAfterInMinutes(
    pollingIntervalInMinutes: number | undefined,
  ): number {
    const interval: number =
      pollingIntervalInMinutes && pollingIntervalInMinutes > 0
        ? pollingIntervalInMinutes
        : DEFAULT_POLLING_INTERVAL_IN_MINUTES;

    return Math.max(
      interval * MISSED_POLLS_BEFORE_STALE,
      MIN_STALE_AFTER_IN_MINUTES,
    );
  }

  /*
   * Why no poll of the device has come in time, or undefined while it is
   * polled on time - or when it is not polled by design: a monitor-backed
   * device's reachability is its bound monitor's (monitoringMethod
   * "Monitor"), and nothing walks it; a device with polling turned off is
   * paused on purpose. A device that was never polled is stale once the
   * monitor (or the device, whichever is newer) has existed for as long.
   */
  public static getStaleReason(data: {
    device: StalePollDevice | null;
    monitorCreatedAt?: Date | undefined;
    now: Date;
  }): string | undefined {
    if (!data.device) {
      return "The network device this monitor watches no longer exists, so nothing polls it.";
    }

    const device: StalePollDevice = data.device;

    if (
      NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
        device.monitoringMethod,
      ) ||
      device.isPollingEnabled === false
    ) {
      return undefined;
    }

    const since: Date | undefined =
      device.lastPolledAt ||
      NetworkDeviceStalePoll.latest(device.createdAt, data.monitorCreatedAt);

    if (!since) {
      return undefined;
    }

    const staleAfterInMinutes: number =
      NetworkDeviceStalePoll.getStaleAfterInMinutes(
        device.pollingIntervalInMinutes,
      );
    const minutesSince: number = Math.floor(
      (data.now.getTime() - since.getTime()) / 60_000,
    );

    if (minutesSince < staleAfterInMinutes) {
      return undefined;
    }

    const what: string = device.lastPolledAt
      ? `No poll of this device has arrived for ${minutesSince} minutes (the last one ran at ${OneUptimeDate.toString(device.lastPolledAt)}).`
      : `This device has not been polled in the ${minutesSince} minutes since it was set up.`;

    return `${what} ${NetworkDeviceStalePoll.getWhy(device)}`;
  }

  /*
   * Whether evaluating a step as "unreachable" can say anything: it has a
   * criteria that matches a device that is not reachable (Device Is Online
   * is False). A step judged on walk data alone would match nothing on a
   * poll that has none, and fall to its default status - which is Online.
   */
  public static canSayUnreachable(monitorStep: MonitorStep): boolean {
    const criteria: Array<MonitorCriteriaInstance> =
      monitorStep.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray ||
      [];

    return criteria.some((instance: MonitorCriteriaInstance): boolean => {
      return (instance.data?.filters || []).some(
        (filter: CriteriaFilter): boolean => {
          return (
            filter.checkOn === CheckOn.SnmpIsOnline &&
            filter.filterType === FilterType.False
          );
        },
      );
    });
  }

  private static getWhy(device: StalePollDevice): string {
    if (!device.probeId) {
      return "No probe is assigned to poll it.";
    }

    if (!(device.hostname || "").trim()) {
      return "It has no hostname or IP address to poll.";
    }

    return "Its probe may be down or disconnected, or unable to poll all of its devices on time.";
  }

  private static latest(
    a: Date | undefined,
    b: Date | undefined,
  ): Date | undefined {
    if (!a) {
      return b;
    }

    if (!b) {
      return a;
    }

    return a.getTime() >= b.getTime() ? a : b;
  }
}
