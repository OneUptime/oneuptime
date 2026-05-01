/**
 * Fetches operational events (incidents today; deploys/maintenance/monitor
 * flips in follow-ups) and converts them into chart annotations.
 *
 * Calls are coalesced via the same QueryCoalescer used for metrics, so
 * dashboards with many chart panels only fetch the annotation set once
 * per (dashboard, time range, sources) combination.
 */
import DashboardAnnotation, {
  DashboardAnnotationKind,
  DashboardAnnotationsConfig,
} from "Common/Types/Dashboard/DashboardAnnotation";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Incident from "Common/Models/DatabaseModels/Incident";
import Alert from "Common/Models/DatabaseModels/Alert";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import QueryCoalescer from "Common/Utils/Dashboard/QueryCoalescer";

const coalescer: QueryCoalescer<Array<DashboardAnnotation>> =
  new QueryCoalescer<Array<DashboardAnnotation>>();

const INCIDENT_COLOR: string = "#ef4444"; // red-500
const ALERT_COLOR: string = "#f59e0b"; // amber-500

const buildKey: (input: {
  range: InBetween<Date>;
  sources: DashboardAnnotationsConfig;
}) => string = (input: {
  range: InBetween<Date>;
  sources: DashboardAnnotationsConfig;
}): string => {
  /*
   * We only need a stable hash here, not a full round-trip — JSON.stringify
   * is faster and avoids dragging the typed config through JSONFunctions
   * (which expects index-signature JSONObject shapes).
   */
  return JSON.stringify({
    s: input.range.startValue?.toISOString(),
    e: input.range.endValue?.toISOString(),
    src: input.sources,
  });
};

const truncate: (s: string, n: number) => string = (
  s: string,
  n: number,
): string => {
  if (!s) {
    return "";
  }
  if (s.length <= n) {
    return s;
  }
  return s.slice(0, n - 1) + "…";
};

export default class DashboardAnnotationFetcher {
  public static async fetch(input: {
    dashboardStartAndEndDate: RangeStartAndEndDateTime;
    config: DashboardAnnotationsConfig | undefined;
  }): Promise<Array<DashboardAnnotation>> {
    const config: DashboardAnnotationsConfig | undefined = input.config;
    if (!config || !config.enabled) {
      return [];
    }

    const range: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(
        input.dashboardStartAndEndDate,
      );
    if (!range.startValue || !range.endValue) {
      return [];
    }

    const key: string = buildKey({ range, sources: config });

    return coalescer.run(key, async () => {
      const results: Array<DashboardAnnotation> = [];

      /*
       * Incidents are the default annotation source; this is the highest
       * signal-to-noise overlay because incidents already represent a
       * human-confirmed operational event.
       */
      if (config.incidents !== false) {
        try {
          const incidents: ListResult<Incident> =
            await ModelAPI.getList<Incident>({
              modelType: Incident,
              query: {
                createdAt: new InBetween<Date>(
                  range.startValue!,
                  range.endValue!,
                ),
              } as Query<Incident>,
              limit: 50,
              skip: 0,
              select: {
                _id: true,
                title: true,
                createdAt: true,
              } as never,
              sort: { createdAt: SortOrder.Ascending } as never,
              requestOptions: {},
            });
          for (const i of incidents.data) {
            if (!i.createdAt) {
              continue;
            }
            results.push({
              id: `incident-${i._id?.toString()}`,
              kind: DashboardAnnotationKind.Incident,
              time: OneUptimeDate.fromString(i.createdAt as unknown as string),
              label: truncate(i.title || "Incident", 24),
              color: INCIDENT_COLOR,
            });
          }
        } catch {
          /*
           * Annotation failure is non-fatal — chart still renders without
           * overlays.
           */
        }
      }

      if (config.alerts === true) {
        try {
          const alerts: ListResult<Alert> = await ModelAPI.getList<Alert>({
            modelType: Alert,
            query: {
              createdAt: new InBetween<Date>(
                range.startValue!,
                range.endValue!,
              ),
            } as Query<Alert>,
            limit: 50,
            skip: 0,
            select: {
              _id: true,
              title: true,
              createdAt: true,
            } as never,
            sort: { createdAt: SortOrder.Ascending } as never,
            requestOptions: {},
          });
          for (const a of alerts.data) {
            if (!a.createdAt) {
              continue;
            }
            results.push({
              id: `alert-${a._id?.toString()}`,
              kind: DashboardAnnotationKind.Alert,
              time: OneUptimeDate.fromString(a.createdAt as unknown as string),
              label: truncate(a.title || "Alert", 24),
              color: ALERT_COLOR,
            });
          }
        } catch {
          // ditto
        }
      }

      /*
       * ScheduledMaintenance + MonitorStatusChange annotation sources are
       * staged for a follow-up — they require time-window queries against
       * ScheduledMaintenance / MonitorStatusTimeline models. The flags
       * already exist on the config so the UI can ship the toggles now.
       */

      return results;
    });
  }
}
