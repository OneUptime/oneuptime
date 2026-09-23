import Dictionary from "../../Types/Dictionary";
import { JSONObject } from "../../Types/JSON";
import { MergedDowntimeTotals } from "../../Types/StatusPage/MergedDowntimeTotals";

/*
 * Wire format for the merged downtime of the monitor groups on a status page:
 * the overview payload's `monitorGroupMergedDowntime`, one entry per monitor
 * group whose resource shows its uptime, keyed by monitor group id.
 *
 *   { "<monitorGroupId>": { "coveredSeconds": 5184000, "downtimeSeconds": 17270 } }
 *
 * A monitor group is down whenever at least one of its monitors is. The
 * per-monitor day aggregate cannot say when that was, and the timeline rows
 * the page also receives arrive under one 10,000 row cap across every monitor
 * on the page, newest first - on a page with a flapping monitor, the last few
 * days of the window. So the server merges each group's monitors over every
 * row (MonitorStatusTimelineService.getMergedDowntimeSeconds) and the browser
 * reads the group's percentage from these two numbers.
 *
 * PLAIN on purpose, like UptimeDailyAggregateUtil's format: numbers and id
 * strings, none of this codebase's typed JSON envelopes. The payload is held
 * in a 500-entry in-memory cache on the hottest public endpoint, and this adds
 * about a hundred bytes per monitor group.
 *
 * Both directions live here so the encoding is defined once.
 */
export default class MonitorGroupMergedDowntimeUtil {
  public static toJSON(
    mergedDowntimeByMonitorGroupId: Dictionary<MergedDowntimeTotals>,
  ): JSONObject {
    const json: JSONObject = {};

    for (const monitorGroupId of Object.keys(mergedDowntimeByMonitorGroupId)) {
      const merged: MergedDowntimeTotals | undefined =
        mergedDowntimeByMonitorGroupId[monitorGroupId];

      if (!merged) {
        continue;
      }

      /*
       * The two figures and nothing else, in an object of their own: groups
       * with the same monitors share one totals object on the server, and
       * the cached payload must not hand that object out.
       */
      json[monitorGroupId] = {
        coveredSeconds: merged.coveredSeconds,
        downtimeSeconds: merged.downtimeSeconds,
      };
    }

    return json;
  }

  /**
   * Parse the wire format.
   *
   * Total by design: a missing or malformed field comes back empty rather
   * than throwing, and a malformed entry is skipped. An empty result is what
   * a server that predates the field sends too, and every monitor group then
   * falls back to its timeline rows - the page's behaviour before the field
   * existed - rather than failing to render.
   *
   * A figure that is not a positive number reads as zero, as it does where
   * the server reads it from the database. An entry with nothing covered is
   * kept: it says nothing was recorded for the group, and a percentage read
   * from it is null.
   */
  public static fromJSON(
    json: JSONObject | undefined | null,
  ): Dictionary<MergedDowntimeTotals> {
    const mergedDowntimeByMonitorGroupId: Dictionary<MergedDowntimeTotals> = {};

    if (!json || typeof json !== "object" || Array.isArray(json)) {
      return mergedDowntimeByMonitorGroupId;
    }

    for (const monitorGroupId of Object.keys(json)) {
      const entry: unknown = json[monitorGroupId];

      if (!monitorGroupId || !entry || typeof entry !== "object") {
        continue;
      }

      if (Array.isArray(entry)) {
        continue;
      }

      mergedDowntimeByMonitorGroupId[monitorGroupId] = {
        coveredSeconds: MonitorGroupMergedDowntimeUtil.toSeconds(
          (entry as JSONObject)["coveredSeconds"],
        ),
        downtimeSeconds: MonitorGroupMergedDowntimeUtil.toSeconds(
          (entry as JSONObject)["downtimeSeconds"],
        ),
      };
    }

    return mergedDowntimeByMonitorGroupId;
  }

  private static toSeconds(value: unknown): number {
    const seconds: number = Number(value);

    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  }
}
