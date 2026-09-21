import BadDataException from "../../../Types/Exception/BadDataException";
import MonitoringIntervalUtil, {
  MonitoringIntervalNormalization,
  MonitoringIntervalNormalizationStatus,
} from "../../../Utils/Monitor/MonitoringIntervalUtil";
import CronTab from "../CronTab";

/*
 * Server-side policy for `Monitor.monitoringInterval`.
 *
 * MonitoringIntervalUtil says what a value MEANS and never throws.
 * This says what we DO about it on a write: understood values are rewritten
 * to canonical cron, and genuinely meaningless ones are refused with a
 * message that names the cron to use instead.
 *
 * WHY THE RUNTIME PARSER GETS THE LAST WORD
 *
 * The isomorphic normalizer is a hand-rolled grammar; the scheduler runs on
 * cron-parser. Where the two disagree, cron-parser wins, because it is what
 * actually computes `nextPingAt`. Validation that rejected an expression the
 * scheduler would happily honour ("@hourly", exotic step/range forms) would
 * be this same bug in mirror image: the UI and the runtime disagreeing about
 * a stored value, with the customer caught in between. So Unrecognized is
 * re-checked against cron-parser before we refuse anything.
 */

/*
 * The shortest cadence the probe fleet can honour.
 *
 * `claimMonitorProbesForProbing` is driven by a cron that ticks once a
 * minute, so a sub-minute schedule is a promise we cannot keep. cron-parser
 * accepts 6-field per-second expressions such as "* * * * * *" quite
 * happily; without this floor an API client could ask for a per-second probe
 * and silently get a per-minute one — the exact class of bug this file
 * exists to close.
 */
export const MINIMUM_MONITORING_INTERVAL_IN_SECONDS: number = 60;

export default class MonitoringIntervalValidator {
  /**
   * Validate and canonicalize an inbound monitoring interval.
   *
   * Returns the value to persist: null for "no schedule" (legitimate — a
   * Manual monitor is never probed), otherwise a cron expression the
   * scheduler can parse. Throws BadDataException when the value cannot be
   * understood by either the normalizer or cron-parser.
   */
  public static validateAndNormalize(
    value: string | null | undefined,
  ): string | null {
    const result: MonitoringIntervalNormalization =
      MonitoringIntervalUtil.normalize(value);

    if (result.status === MonitoringIntervalNormalizationStatus.Empty) {
      return null;
    }

    if (result.cron) {
      MonitoringIntervalValidator.assertMeetsFloor(result.cron, result.input);
      return result.cron;
    }

    /*
     * Unrecognized by the grammar. Before refusing, ask the parser that
     * actually schedules the probe — if it can read the expression, the
     * scheduler can honour it and there is nothing to refuse.
     */
    const trimmed: string = (result.input || "").trim();
    const intervalInSeconds: number | null =
      CronTab.getIntervalInSeconds(trimmed);

    if (intervalInSeconds !== null) {
      MonitoringIntervalValidator.assertMeetsFloor(trimmed, result.input);
      return trimmed;
    }

    throw new BadDataException(
      `Invalid Monitoring Interval "${trimmed}". Expected a cron expression - use "${MonitoringIntervalUtil.getSuggestedCronForMessage()}" for every 5 minutes.`,
    );
  }

  /*
   * Applied to every accepted value, normalized or passed through, because
   * the floor is about what the probe fleet can deliver and not about which
   * code path produced the expression.
   */
  private static assertMeetsFloor(
    cron: string,
    input: string | null | undefined,
  ): void {
    const intervalInSeconds: number | null = CronTab.getIntervalInSeconds(cron);

    if (
      intervalInSeconds !== null &&
      intervalInSeconds < MINIMUM_MONITORING_INTERVAL_IN_SECONDS
    ) {
      throw new BadDataException(
        `Monitoring Interval "${(input || cron).trim()}" is faster than once a minute, which probes cannot deliver. Use "* * * * *" for the fastest supported schedule.`,
      );
    }
  }

  /**
   * The cron a stored value means, for READ paths.
   *
   * Read paths must stay total: a row written before this validator existed
   * (or restored from a backup, or written through a hook-free path) is not
   * an exception, it is just a row. Callers fall back to their own default
   * when this returns null.
   */
  public static normalizeForRead(
    value: string | null | undefined,
  ): string | null {
    return MonitoringIntervalUtil.toCronOrNull(value);
  }
}
