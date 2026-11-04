import MetricService, {
  MetricSeriesArrivalRow,
} from "Common/Server/Services/MetricService";
import { MutableMetricService as MutableMetricServiceClass } from "Common/Server/Services/MutableMetricService";
import Query from "Common/Server/Types/AnalyticsDatabase/Query";
import MetricMonitorCriteria from "Common/Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import MetricWindowCoverage from "Common/Server/Utils/Monitor/Criteria/MetricWindowCoverage";
import logger from "Common/Server/Utils/Logger";
import Metric from "Common/Models/AnalyticsModels/Metric";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import { CheckOn, CriteriaFilter } from "Common/Types/Monitor/CriteriaFilter";
import MetricSeriesArrival from "Common/Types/Monitor/MetricMonitor/MetricSeriesArrival";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import MetricFormulaEvaluator from "Common/Utils/Metrics/MetricFormulaEvaluator";
import MetricSeriesArrivalUtil from "Common/Utils/Metrics/MetricSeriesArrivalUtil";
import MetricSeriesFingerprint from "Common/Utils/Metrics/MetricSeriesFingerprint";

/*
 * When a metric monitor's series got their data (#4912's follow-up: a
 * series' lag and staleness from each row's createdAt).
 *
 * A metric row says when its source measured (`time`) and when OneUptime
 * wrote it (`createdAt`). "All Values" and the forecasts must tell a series
 * whose data stopped from one whose data is late - a source late by design,
 * a collector whose clock runs behind - and only createdAt can: a late
 * series' rows keep arriving. So after a query's read, the worker reads when
 * each of its series' data arrived (MetricService.readSeriesArrivals) and
 * hands it to the evaluator beside the data points (MetricSeriesArrival).
 *
 * Only when it can change a verdict: the step has a criteria that judges
 * freshness, and some series of the query looks behind - its newest data
 * point ended more than one data point before the window's end. A series
 * within one data point of the end is fresh however it is judged (stale
 * takes one and a half), so a monitor whose data keeps up costs no read.
 * And a failed read leaves the series to be judged as before.
 */

/*
 * A row per series: as many series as a grouped read can have rows
 * (GROUPED_READ_ROW_LIMIT in MonitorTelemetryMonitor). A series past it is
 * judged as before.
 */
const ARRIVAL_READ_ROW_LIMIT: number = 5 * LIMIT_PER_PROJECT;

/*
 * The arrivals of one query's series: its one series when it is not
 * grouped, each series of a grouped query by fingerprint (the series
 * breakdown's).
 */
export interface QueryArrivals {
  whole: MetricSeriesArrival | null;
  bySeries: Map<string, MetricSeriesArrival>;
}

// Whether any criteria of a step reads when its data arrived.
export const stepJudgesFreshness: (monitorStep: MonitorStep) => boolean = (
  monitorStep: MonitorStep,
): boolean => {
  const instances: Array<MonitorCriteriaInstance> =
    monitorStep.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];

  for (const instance of instances) {
    for (const filter of instance.data?.filters || []) {
      if (
        filter.checkOn === CheckOn.MetricValue &&
        MetricMonitorCriteria.judgesFreshness(filter as CriteriaFilter)
      ) {
        return true;
      }
    }
  }

  return false;
};

// The fingerprint of a row's series, the way the series breakdown keys it.
const getRowFingerprint: (input: {
  row: AggregatedModel;
  groupByAttributeKeys: Array<string>;
}) => string = (input: {
  row: AggregatedModel;
  groupByAttributeKeys: Array<string>;
}): string => {
  if (input.groupByAttributeKeys.length === 0) {
    return MetricSeriesFingerprint.WholeMonitorFingerprint;
  }

  return MetricSeriesFingerprint.computeFingerprint(
    MetricSeriesFingerprint.extractSeriesLabels({
      sample: input.row,
      attributeKeys: input.groupByAttributeKeys,
    }),
  );
};

/*
 * Whether a query's read looks behind: some series' newest data point -
 * its bucket - ended more than one data point before the window's end.
 */
export const isReadBehind: (input: {
  aggregatedResult: AggregatedResult;
  groupByAttributeKeys: Array<string>;
  startAndEndDate: InBetween<Date>;
}) => boolean = (input: {
  aggregatedResult: AggregatedResult;
  groupByAttributeKeys: Array<string>;
  startAndEndDate: InBetween<Date>;
}): boolean => {
  const startMs: number = new Date(
    input.startAndEndDate.startValue as Date,
  ).getTime();
  const endMs: number = new Date(
    input.startAndEndDate.endValue as Date,
  ).getTime();

  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs
  ) {
    return false;
  }

  const dataPointMs: number = MetricWindowCoverage.getDataPointMs({
    startMs: startMs,
    endMs: endMs,
    completeFromMs: null,
  });

  const newestBySeries: Map<string, number> = new Map();

  for (const row of input.aggregatedResult.data) {
    const timeMs: number = new Date(row.timestamp).getTime();

    if (!Number.isFinite(timeMs)) {
      continue;
    }

    const fingerprint: string = getRowFingerprint({
      row: row,
      groupByAttributeKeys: input.groupByAttributeKeys,
    });
    const newestMs: number | undefined = newestBySeries.get(fingerprint);

    if (newestMs === undefined || timeMs > newestMs) {
      newestBySeries.set(fingerprint, timeMs);
    }
  }

  for (const newestMs of newestBySeries.values()) {
    if (endMs - (newestMs + dataPointMs) > dataPointMs) {
      return true;
    }
  }

  return false;
};

/*
 * When each series of one query got its data, read after the query's data
 * points when it can change a verdict (see above); null when it cannot, when
 * the query reads a metric kept outside the Metric table, and when the read
 * fails - the series are then judged by their data points' times alone, as
 * before.
 */
export const readQueryArrivals: (input: {
  query: Query<Metric>;
  groupByAttributeKeys: Array<string>;
  aggregatedResult: AggregatedResult;
  startAndEndDate: InBetween<Date>;
  judgesFreshness: boolean;
  projectId?: ObjectID | undefined;
}) => Promise<QueryArrivals | null> = async (input: {
  query: Query<Metric>;
  groupByAttributeKeys: Array<string>;
  aggregatedResult: AggregatedResult;
  startAndEndDate: InBetween<Date>;
  judgesFreshness: boolean;
  projectId?: ObjectID | undefined;
}): Promise<QueryArrivals | null> => {
  if (!input.judgesFreshness || input.aggregatedResult.data.length === 0) {
    return null;
  }

  // Incident, alert and maintenance metrics live in a table of their own.
  if (
    MutableMetricServiceClass.isMutableMetricName(
      typeof input.query.name === "string" ? input.query.name : undefined,
    )
  ) {
    return null;
  }

  if (
    !isReadBehind({
      aggregatedResult: input.aggregatedResult,
      groupByAttributeKeys: input.groupByAttributeKeys,
      startAndEndDate: input.startAndEndDate,
    })
  ) {
    return null;
  }

  try {
    /*
     * What "nothing has arrived for" is counted to: the end of the window,
     * as the data points' freshness is - now, or where the ingest queue is
     * while it is behind (ReceivingCoverage), so rows still waiting in
     * OneUptime's own queue never make a series look stopped.
     */
    const nowMs: number = OneUptimeDate.getCurrentDate().getTime();
    const windowEndMs: number = new Date(
      input.startAndEndDate.endValue as Date,
    ).getTime();
    const asOfMs: number = Number.isFinite(windowEndMs)
      ? Math.min(nowMs, windowEndMs)
      : nowMs;

    const rows: Array<MetricSeriesArrivalRow> =
      await MetricService.readSeriesArrivals({
        query: input.query,
        groupByAttributeKeys:
          input.groupByAttributeKeys.length > 0
            ? input.groupByAttributeKeys
            : undefined,
        limit: ARRIVAL_READ_ROW_LIMIT,
        props: {
          isRoot: true,
        },
      });

    const arrivals: QueryArrivals = { whole: null, bySeries: new Map() };

    for (const row of rows) {
      const arrival: MetricSeriesArrival | null =
        MetricSeriesArrivalUtil.fromAggregates({
          asOfMs: asOfMs,
          aggregates: row.aggregates,
        });

      if (!arrival) {
        continue;
      }

      if (input.groupByAttributeKeys.length === 0) {
        arrivals.whole = arrival;
        continue;
      }

      arrivals.bySeries.set(
        getRowFingerprint({
          row: {
            timestamp: new Date(asOfMs),
            value: 0,
            attributes: row.attributes,
          },
          groupByAttributeKeys: input.groupByAttributeKeys,
        }),
        arrival,
      );
    }

    return arrivals;
  } catch (err) {
    logger.error(
      "Could not read when the metric monitor's data arrived; its series are judged by their data points' times alone.",
      {
        service: "workers",
        projectId: input.projectId?.toString(),
      },
    );
    logger.error(err, {
      service: "workers",
      projectId: input.projectId?.toString(),
    });
    return null;
  }
};

/*
 * One series' arrivals, aligned with its aggregated results: a query's are
 * its own, a formula's are those of the queries and formulas it reads,
 * combined (MetricSeriesArrivalUtil.combine). `fingerprint` names the series
 * of a grouped monitor; left out, the queries' one series. Undefined when no
 * arrival was read at all.
 */
export const getSlotArrivals: (input: {
  perQueryArrivals: Array<QueryArrivals | null> | undefined;
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData> | undefined;
  fingerprint?: string | undefined;
}) => Array<MetricSeriesArrival | null> | undefined = (input: {
  perQueryArrivals: Array<QueryArrivals | null> | undefined;
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData> | undefined;
  fingerprint?: string | undefined;
}): Array<MetricSeriesArrival | null> | undefined => {
  const perQueryArrivals: Array<QueryArrivals | null> =
    input.perQueryArrivals || [];

  if (
    !perQueryArrivals.some((arrivals: QueryArrivals | null) => {
      return Boolean(arrivals);
    })
  ) {
    return undefined;
  }

  const queryConfigs: Array<MetricQueryConfigData> = input.queryConfigs || [];
  const formulaConfigs: Array<MetricFormulaConfigData> =
    input.formulaConfigs || [];

  const slots: Array<MetricSeriesArrival | null> = [];
  const byVariable: Map<string, MetricSeriesArrival | null> = new Map();

  queryConfigs.forEach((queryConfig: MetricQueryConfigData, index: number) => {
    const arrivals: QueryArrivals | null = perQueryArrivals[index] || null;

    let arrival: MetricSeriesArrival | null = null;

    if (arrivals) {
      arrival =
        input.fingerprint === undefined
          ? arrivals.whole
          : arrivals.bySeries.get(input.fingerprint) || null;
    }

    slots.push(arrival);

    const variable: string | undefined =
      queryConfig.metricAliasData?.metricVariable;

    if (variable) {
      byVariable.set(variable.toLowerCase(), arrival);
    }
  });

  for (const formulaConfig of formulaConfigs) {
    const formula: string =
      formulaConfig.metricFormulaData?.metricFormula || "";

    const arrival: MetricSeriesArrival | null = MetricSeriesArrivalUtil.combine(
      MetricFormulaEvaluator.getReferencedVariables(formula).map(
        (variable: string): MetricSeriesArrival | null => {
          return byVariable.get(variable) || null;
        },
      ),
    );

    slots.push(arrival);

    const variable: string | undefined =
      formulaConfig.metricAliasData?.metricVariable;

    if (variable) {
      byVariable.set(variable.toLowerCase(), arrival);
    }
  }

  return slots.some((slot: MetricSeriesArrival | null) => {
    return Boolean(slot);
  })
    ? slots
    : undefined;
};
