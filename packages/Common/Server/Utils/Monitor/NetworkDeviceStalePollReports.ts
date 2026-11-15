import Redis, { ClientType } from "../../Infrastructure/Redis";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";

/*
 * WHICH STALE SPELLS THE STALE POLL CHECK HAS REPORTED ALREADY.
 *
 * NetworkDeviceMonitor:CheckStalePolls evaluates a Network Device monitor as
 * "unreachable" when its device's polls stopped (NetworkDeviceStalePoll). It
 * used to do so on every run, every five minutes, for as long as the polls
 * stayed away: a probe outage re-evaluated every monitor of every device the
 * probe polled, every five minutes, until it ended - thousands of full
 * evaluations a run, for a verdict the first one had already given.
 *
 * So each monitor is evaluated once per spell. A spell is the stretch a
 * device spends without a poll, and it is named by where it started: the
 * device's lastPolledAt when the check found it stale ("never" for a device
 * never polled, "gone" for one that no longer exists). After evaluating a
 * monitor for a spell, the check stamps (monitor, device) with that name;
 * on later runs a pair whose stamp names the spell the device is in now is
 * skipped.
 *
 * Nothing on the poll path writes here. The next poll that arrives moves the
 * device's lastPolledAt, so the stamp no longer names the spell the device
 * is in - which is what clearing it would do - and the poll's own
 * evaluation of the monitor replaces the stale verdict. If polls stop again,
 * that is a new spell, under a new name, and it is reported once in turn.
 *
 * Kept in Redis, not on the device row: a NetworkDevice column would be one
 * more write on the table every poll moves, and its model's indexes are
 * kept clear of poll columns so polls stay HOT updates (#7921).
 */

const KEY_PREFIX: string = "network-device-stale-poll-reported:";

/*
 * Long enough to outlive any outage worth the name; past it a spell still
 * under way is reported once more. Stamps of spells that ended age out with
 * it.
 */
export const STALE_POLL_REPORT_TTL_SECONDS: number =
  OneUptimeDate.getSecondsInDays(30);

// What a stamp says of a device that no longer exists.
export const GONE_DEVICE_SPELL: string = "gone";

// What a stamp says of a device that was never polled.
export const NEVER_POLLED_SPELL: string = "never";

export interface StalePollReport {
  monitorId: ObjectID;
  deviceId: string;
  // The spell the device is in now (spellOf).
  spell: string;
}

export default class NetworkDeviceStalePollReports {
  /*
   * The name of the spell a device without polls is in: where it started -
   * its last poll, NEVER_POLLED_SPELL, or GONE_DEVICE_SPELL for a device
   * that no longer exists.
   */
  public static spellOf(
    device: { lastPolledAt?: Date | null | undefined } | null,
  ): string {
    if (!device) {
      return GONE_DEVICE_SPELL;
    }

    if (!device.lastPolledAt) {
      return NEVER_POLLED_SPELL;
    }

    return new Date(device.lastPolledAt).toISOString();
  }

  public static getKey(monitorId: ObjectID | string, deviceId: string): string {
    return `${KEY_PREFIX}${monitorId.toString()}:${deviceId}`;
  }

  /*
   * The reports among `reports` that were made already for the spell their
   * device is in now, by key (getKey). One round trip however many.
   */
  public static async getReported(
    reports: Array<StalePollReport>,
  ): Promise<Set<string>> {
    const reported: Set<string> = new Set();

    if (reports.length === 0) {
      return reported;
    }

    const keys: Array<string> = reports.map(
      (report: StalePollReport): string => {
        return NetworkDeviceStalePollReports.getKey(
          report.monitorId,
          report.deviceId,
        );
      },
    );

    const stamps: Array<string | null> =
      await NetworkDeviceStalePollReports.getConnectedClient().mget(keys);

    reports.forEach((report: StalePollReport, index: number): void => {
      if (stamps[index] === report.spell) {
        reported.add(keys[index]!);
      }
    });

    return reported;
  }

  // Stamps the pairs as reported for the spell their device is in now.
  public static async markReported(
    reports: Array<StalePollReport>,
  ): Promise<void> {
    if (reports.length === 0) {
      return;
    }

    const pipeline: ReturnType<ClientType["pipeline"]> =
      NetworkDeviceStalePollReports.getConnectedClient().pipeline();

    for (const report of reports) {
      pipeline.set(
        NetworkDeviceStalePollReports.getKey(report.monitorId, report.deviceId),
        report.spell,
        "EX",
        STALE_POLL_REPORT_TTL_SECONDS,
      );
    }

    await pipeline.exec();
  }

  private static getConnectedClient(): ClientType {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new Error(
        "Redis is not connected, so the stale poll check cannot read which spells it reported.",
      );
    }

    return client;
  }
}
