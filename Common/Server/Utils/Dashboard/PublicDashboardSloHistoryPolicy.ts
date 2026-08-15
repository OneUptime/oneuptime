import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import { SloWidgetDisplayType } from "../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  getSloChartAggregationInterval,
  getSloHistoryMetricName,
} from "../../../Utils/Slo/SloWidgetFormat";
import PublicDashboardSloWidget, {
  PublicDashboardSloWidgetConfig,
} from "./PublicDashboardSloWidget";

/*
 * Server-owned policy for the unauthenticated SLO history aggregation.
 *
 * Same contract as PublicDashboardResourceListPolicy: nothing the caller
 * sends becomes part of the query except the time window. WHICH SLO and
 * WHICH of its three series are read come from the stored widget alone, the
 * aggregation columns are fixed, and the bucket size is recomputed from the
 * window with the very same helper the widget uses — so a public viewer's
 * only lever is "which slice of the series the dashboard already publishes
 * do I want to see".
 */
export interface PublicDashboardSloHistoryPolicyResult {
  serviceLevelObjectiveId: ObjectID;
  /** SloHistory.metricName for the widget's chosen series. */
  metricName: string;
  startDate: Date;
  endDate: Date;
  aggregationInterval: AggregationInterval;
  limit: number;
}

export interface BuildPublicDashboardSloHistoryPolicyData {
  widget: unknown;
  /** The caller's `aggregateBy`, already JSONFunctions.deserialize'd. */
  requestedAggregateBy: unknown;
}

/*
 * The furthest back a window is allowed to reach. 400 days is SloHistory's
 * own TTL (see the ttlExpression on the model), so anything older can only
 * return empty buckets anyway — bounding it here is what stops a hand-rolled
 * request from asking ClickHouse to grid out centuries.
 *
 * A longer window is CLAMPED, not refused. The range picker on a public
 * dashboard offers an unbounded custom range, and the sibling widgets — the
 * metric charts on the very same page — just render whatever that range
 * holds. Throwing here would make one widget show a server error string
 * while its neighbours drew fine, purely because the viewer is anonymous.
 */
const MAX_WINDOW_IN_DAYS: number = 400;
const MAX_WINDOW_IN_MINUTES: number = MAX_WINDOW_IN_DAYS * 24 * 60;

export default class PublicDashboardSloHistoryPolicy {
  public static build(
    data: BuildPublicDashboardSloHistoryPolicyData,
  ): PublicDashboardSloHistoryPolicyResult {
    const config: PublicDashboardSloWidgetConfig =
      PublicDashboardSloWidget.readConfig(data.widget);

    /*
     * Only a Chart widget publishes the SERIES. A Tile widget publishes the
     * SLO's current numbers and nothing more, so serving 400 days of history
     * for one would hand out history its author never put on the page.
     */
    if (config.displayType !== SloWidgetDisplayType.Chart) {
      throw new BadDataException(
        "This dashboard widget does not chart SLO history.",
      );
    }

    const requestedAggregateBy: Record<string, unknown> =
      PublicDashboardSloHistoryPolicy.requireObject(
        data.requestedAggregateBy,
        "aggregateBy",
      );

    const startDate: Date = PublicDashboardSloHistoryPolicy.validDate(
      requestedAggregateBy["startTimestamp"],
      "startTimestamp",
    );
    const endDate: Date = PublicDashboardSloHistoryPolicy.validDate(
      requestedAggregateBy["endTimestamp"],
      "endTimestamp",
    );

    /*
     * An inverted or zero-length window is not a range the picker can
     * produce — it only ever comes from a hand-rolled request, and there is
     * no sensible slice of history to answer it with.
     */
    if (startDate.getTime() >= endDate.getTime()) {
      throw new BadDataException(
        "Public dashboard SLO history range is invalid.",
      );
    }

    const clampedStartDate: Date =
      OneUptimeDate.getMinutesBetweenTwoDates(startDate, endDate) >
      MAX_WINDOW_IN_MINUTES
        ? new Date(endDate.getTime() - MAX_WINDOW_IN_MINUTES * 60 * 1000)
        : startDate;

    const rangeInMinutes: number = OneUptimeDate.getMinutesBetweenTwoDates(
      clampedStartDate,
      endDate,
    );

    return {
      serviceLevelObjectiveId: config.serviceLevelObjectiveId,
      metricName: getSloHistoryMetricName(config.sloMetric),
      startDate: clampedStartDate,
      endDate,
      /*
       * Recomputed, never copied. The widget derives its bucket size from
       * the same window with the same helper, so the client still gets the
       * grid it drew its x-axis for — without being able to choose one.
       */
      aggregationInterval: getSloChartAggregationInterval(rangeInMinutes),
      limit: LIMIT_PER_PROJECT,
    };
  }

  private static validDate(value: unknown, key: string): Date {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return new Date(value.getTime());
    }

    if (typeof value === "string" && value.length <= 128) {
      const date: Date = new Date(value);

      if (Number.isFinite(date.getTime())) {
        return date;
      }
    }

    throw new BadDataException(
      `Public dashboard SLO history ${key} is not a valid date.`,
    );
  }

  /*
   * Returns an OWN-properties copy. JSON.parse turns a literal "__proto__"
   * member into a real own key and JSONFunctions.deserialize copies it with
   * `newVal[key] = …`, which fires Object.prototype's __proto__ setter — so a
   * plain `object["startTimestamp"]` lookup would walk the prototype chain
   * and read something the caller never sent as an own key. Copying first
   * means every field this policy reads is a field that was really there.
   */
  private static requireObject(
    value: unknown,
    label: string,
  ): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadDataException(`${label} must be an object.`);
    }

    return { ...(value as Record<string, unknown>) };
  }
}
