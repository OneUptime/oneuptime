import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import Metric from "Common/Models/AnalyticsModels/Metric";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { RUM_WEB_VITALS_LOOKBACK_DAYS } from "./RumSignalDiagnosis";
import { getWebVitalMetricNames, toDateOrNull } from "./RumSignalFacts";

/*
 * The reads behind a RUM application's setup diagnosis (issue #5770), each
 * one row, each cheap on a busy project:
 *
 * - traces, logs and metrics: when each last arrived is on the application
 *   row itself (RumApplication.<signal>LastReceivedAt, stamped by ingest),
 *   so it costs nothing beyond the record the page reads anyway
 *   (RumSignalFacts);
 * - exceptions: the newest lastSeenAt of the application's exceptions -
 *   one Postgres row, through the (projectId, primaryEntityId, fingerprint)
 *   index;
 * - Web Vitals: the newest point of a vital's metric in the past 30 days -
 *   one ClickHouse row, whose sort key leads with the metric's name and the
 *   application, so the read touches only those granules.
 *
 * A read that fails throws: the caller says "couldn't be checked" rather
 * than "none".
 */

// The newest exception this application has reported, or null for none.
export async function fetchNewestRumExceptionAt(
  rumApplicationId: ObjectID,
): Promise<Date | null> {
  const result: ListResult<TelemetryException> =
    await ModelAPI.getList<TelemetryException>({
      modelType: TelemetryException,
      query: {
        primaryEntityId: rumApplicationId,
        // A row with no lastSeenAt would sort first, and say nothing.
        lastSeenAt: new NotNull(),
      },
      select: { lastSeenAt: true },
      sort: { lastSeenAt: SortOrder.Descending },
      limit: 1,
      skip: 0,
    });

  return toDateOrNull(result.data[0]?.lastSeenAt);
}

/*
 * The newest Web Vital this application reported in the past 30 days, or
 * null for none.
 */
export async function fetchNewestRumWebVitalAt(data: {
  rumApplicationId: ObjectID;
  now: Date;
}): Promise<Date | null> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  const result: ListResult<Metric> = await AnalyticsModelAPI.getList<Metric>({
    modelType: Metric,
    query: {
      ...(projectId ? { projectId: projectId } : {}),
      name: new Includes(getWebVitalMetricNames()),
      primaryEntityId: data.rumApplicationId,
      time: new InBetween<Date>(
        OneUptimeDate.addRemoveDays(data.now, -RUM_WEB_VITALS_LOOKBACK_DAYS),
        data.now,
      ),
    },
    select: { time: true },
    sort: { time: SortOrder.Descending },
    skip: 0,
    limit: 1,
  });

  return toDateOrNull(result.data[0]?.time);
}
