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
import { MetricZeroFillOptions } from "Common/Utils/Metrics/MetricZeroFill";
import MetricSeriesFingerprint, {
  MetricSeriesIdentity,
} from "Common/Utils/Metrics/MetricSeriesFingerprint";
import { EventLoopBudget } from "Common/Server/Utils/EventLoop";

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

/*
 * The arrival reads of one evaluation, by what they read (#10108). A step's
 * queries can read the same metric with the same filters over the same
 * window - the restarts' Maximum and their Minimum - and when they look
 * behind they read the same arrivals: read once, the second query is handed
 * the first's. A read that failed is not kept.
 */
export type QueryArrivalsReads = Map<string, Promise<QueryArrivals | null>>;

// A row's series, read once per series (MetricSeriesFingerprint.createSeriesReader).
type ReadSeries = (row: AggregatedModel) => MetricSeriesIdentity;

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
  readSeries?: ReadSeries | undefined;
}) => string = (input: {
  row: AggregatedModel;
  groupByAttributeKeys: Array<string>;
  readSeries?: ReadSeries | undefined;
}): string => {
  if (input.groupByAttributeKeys.length === 0) {
    return MetricSeriesFingerprint.WholeMonitorFingerprint;
  }

  if (input.readSeries) {
    return input.readSeries(input.row).fingerprint;
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
  readSeries?: ReadSeries | undefined;
}) => boolean = (input: {
  aggregatedResult: AggregatedResult;
  groupByAttributeKeys: Array<string>;
  startAndEndDate: InBetween<Date>;
  readSeries?: ReadSeries | undefined;
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
      readSeries: input.readSeries,
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
interface ReadQueryArrivalsInput {
  query: Query<Metric>;
  groupByAttributeKeys: Array<string>;
  aggregatedResult: AggregatedResult;
  startAndEndDate: InBetween<Date>;
  judgesFreshness: boolean;
  projectId?: ObjectID | undefined;
  // A row's series, shared by the evaluation's reads.
  readSeries?: ReadSeries | undefined;
  // The evaluation's arrival reads, so one read serves the queries it fits.
  reads?: QueryArrivalsReads | undefined;
}

/*
 * What an arrival read reads: the query - its metric, filters, services and
 * window - and how its series are grouped. Null when it cannot be told, and
 * the read is not shared.
 */
const getArrivalReadKey: (input: ReadQueryArrivalsInput) => string | null = (
  input: ReadQueryArrivalsInput,
): string | null => {
  try {
    return JSON.stringify({
      query: input.query,
      groupByAttributeKeys: input.groupByAttributeKeys,
      startAndEndDate: input.startAndEndDate,
    });
  } catch {
    return null;
  }
};

export const readQueryArrivals: (
  input: ReadQueryArrivalsInput,
) => Promise<QueryArrivals | null> = async (
  input: ReadQueryArrivalsInput,
): Promise<QueryArrivals | null> => {
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
      readSeries: input.readSeries,
    })
  ) {
    return null;
  }

  const key: string | null = input.reads ? getArrivalReadKey(input) : null;
  const shared: Promise<QueryArrivals | null> | undefined = key
    ? input.reads!.get(key)
    : undefined;

  if (shared) {
    return shared;
  }

  const read: Promise<QueryArrivals | null> = readArrivals(input);

  if (key) {
    input.reads!.set(key, read);
  }

  const arrivals: QueryArrivals | null = await read;

  // A read that failed is tried again by the next query that needs it.
  if (key && !arrivals) {
    input.reads!.delete(key);
  }

  return arrivals;
};

// The read itself: null when it fails, as readQueryArrivals says.
const readArrivals: (
  input: ReadQueryArrivalsInput,
) => Promise<QueryArrivals | null> = async (
  input: ReadQueryArrivalsInput,
): Promise<QueryArrivals | null> => {
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
    // A read of every series of a fleet: the loop is handed back as it goes.
    const budget: EventLoopBudget = new EventLoopBudget();

    for (const row of rows) {
      if (budget.isSpent()) {
        await budget.handBack();
      }

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
          readSeries: input.readSeries,
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
 * combined (MetricSeriesArrivalUtil.combine) - all but the queries counting
 * what happened that it reads as 0 where they have no point (`zeroFill`):
 * their silence is nothing happening, not the formula going stale
 * (MetricSeriesArrivalUtil.combineForFormula). `fingerprint` names the
 * series of a grouped monitor; left out, the queries' one series. Undefined
 * when no arrival was read at all.
 */
export const getSlotArrivals: (input: {
  perQueryArrivals: Array<QueryArrivals | null> | undefined;
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData> | undefined;
  fingerprint?: string | undefined;
  zeroFill?: MetricZeroFillOptions | undefined;
}) => Array<MetricSeriesArrival | null> | undefined = (input: {
  perQueryArrivals: Array<QueryArrivals | null> | undefined;
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData> | undefined;
  fingerprint?: string | undefined;
  zeroFill?: MetricZeroFillOptions | undefined;
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

    const countingVariables: Array<string> =
      MetricFormulaEvaluator.getCountingVariablesOfFormula({
        formula: formula,
        queryConfigs: queryConfigs,
        zeroFill: input.zeroFill,
      });

    const arrivalOf: (variable: string) => MetricSeriesArrival | null = (
      variable: string,
    ): MetricSeriesArrival | null => {
      return byVariable.get(variable) || null;
    };

    const referencedVariables: Array<string> =
      MetricFormulaEvaluator.getReferencedVariables(formula);

    const arrival: MetricSeriesArrival | null =
      countingVariables.length > 0
        ? MetricSeriesArrivalUtil.combineForFormula({
            read: referencedVariables
              .filter((variable: string): boolean => {
                return !countingVariables.includes(variable);
              })
              .map(arrivalOf),
            filled: countingVariables.map(arrivalOf),
          })
        : MetricSeriesArrivalUtil.combine(referencedVariables.map(arrivalOf));

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
