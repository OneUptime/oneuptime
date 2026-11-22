import AggregateModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import { JSONObject } from "../../../Types/JSON";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsViewConfig from "../../../Types/Metrics/MetricsViewConfig";
import { CheckOn, CriteriaFilter } from "../../../Types/Monitor/CriteriaFilter";
import LogMonitorGroupResult from "../../../Types/Monitor/LogMonitor/LogMonitorGroupResult";
import LogMonitorResponse from "../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import {
  MonitorEvaluationSeries,
  MonitorEvaluationSeriesLabels,
  MonitorEvaluationSeriesRow,
  MonitorEvaluationSeriesValueKind,
} from "../../../Types/Monitor/MonitorEvaluationSummary";
import SeriesLabelDisplay from "../../../Types/Monitor/SeriesContext/SeriesLabelDisplay";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import TraceMonitorGroupResult from "../../../Types/Monitor/TraceMonitor/TraceMonitorGroupResult";
import TraceMonitorResponse from "../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import { MatchedCriteriaResult } from "../../../Types/Probe/ProbeApiIngestResponse";
import GroupedMonitorRecovery, {
  GroupedCriteriaRole,
} from "./GroupedMonitorRecovery";
import DataToProcess from "./DataToProcess";

/*
 * How many of a grouped check's series its evaluation keeps for the Series
 * card (#10062). Every monitor log row of the monitor carries them, so a
 * monitor of 16,000 series keeps the ones that matter first and says how
 * many there were.
 */
export const MAX_SERIES_TABLE_ROWS: number = 50;

/*
 * THE SERIES A GROUPED CHECK READ, FOR ITS MONITOR'S OVERVIEW (#10062).
 *
 * A monitor that groups its query by an attribute - a Host monitor on a host
 * with several disks, a metric monitor by host or pod, a Logs or Traces
 * monitor by group - has one status, and nothing on its page said which
 * disks were over the threshold: people read its Metrics, its Incidents and
 * the Observed column of Monitoring Logs side by side. The check now keeps,
 * on its evaluation summary, each series it read: its labels, its newest
 * value of what the criteria compare, the criteria it met, and whether it
 * keeps the monitor's status. The Overview lists them with what is open for
 * each.
 *
 * Bounded (MAX_SERIES_TABLE_ROWS): the series that keep the status or met a
 * criteria that changes it first, then those that met another, then the
 * rest, each in the check's order. A record about one series does not keep
 * the list (MonitorStoredCheck.scopeToSeries).
 */
export default class MonitorSeriesTable {
  public static build(input: {
    monitorType: MonitorType | undefined;
    monitorStep: MonitorStep;
    dataToProcess: DataToProcess;
    criteriaInstances: Array<MonitorCriteriaInstance>;
    defaultMonitorStatusId: ObjectID | undefined;
    // Every criteria's matches on the check, those that wait included.
    matchedCriteria: Array<MatchedCriteriaResult>;
    // The series that keep the monitor's status (GroupedMonitorRecovery).
    seriesKeepingStatus: ReadonlySet<string>;
  }): MonitorEvaluationSeries | undefined {
    const rows: Array<MonitorEvaluationSeriesRow> | null =
      MonitorSeriesTable.getRows(input);

    if (!rows) {
      return undefined;
    }

    // The criteria each series met, in criteria order.
    const criteriaOrder: Map<string, number> = new Map<string, number>();

    input.criteriaInstances.forEach(
      (criteriaInstance: MonitorCriteriaInstance, index: number): void => {
        if (criteriaInstance.data?.id) {
          criteriaOrder.set(criteriaInstance.data.id.toString(), index);
        }
      },
    );

    const metCriteria: Map<string, Set<string>> = new Map<
      string,
      Set<string>
    >();

    for (const matched of input.matchedCriteria) {
      for (const series of matched.perSeriesMatches) {
        const met: Set<string> =
          metCriteria.get(series.fingerprint) || new Set<string>();

        met.add(matched.criteriaId);
        metCriteria.set(series.fingerprint, met);
      }
    }

    const problemCriteriaIds: Set<string> = new Set<string>(
      input.criteriaInstances
        .filter((criteriaInstance: MonitorCriteriaInstance): boolean => {
          return (
            GroupedMonitorRecovery.getRole({
              criteriaInstance: criteriaInstance,
              defaultMonitorStatusId: input.defaultMonitorStatusId,
            }) === GroupedCriteriaRole.Problem
          );
        })
        .map((criteriaInstance: MonitorCriteriaInstance): string => {
          return criteriaInstance.data!.id.toString();
        }),
    );

    for (const row of rows) {
      row.metCriteriaIds = Array.from(
        metCriteria.get(row.fingerprint) || [],
      ).sort((a: string, b: string): number => {
        return (criteriaOrder.get(a) ?? 0) - (criteriaOrder.get(b) ?? 0);
      });

      if (input.seriesKeepingStatus.has(row.fingerprint)) {
        row.isKeepingStatus = true;
      }
    }

    /*
     * A series the check seeded for a host or device that stopped reporting
     * read nothing: it is listed only when a criteria met it, as a criteria
     * that fires on silence does. So the count is what Observed counts.
     */
    const read: Array<MonitorEvaluationSeriesRow> = rows.filter(
      (row: MonitorEvaluationSeriesRow): boolean => {
        return (
          row.value !== undefined ||
          row.metCriteriaIds.length > 0 ||
          Boolean(row.isKeepingStatus)
        );
      },
    );

    // What the series is read for first: a problem, then any match.
    const rank: (row: MonitorEvaluationSeriesRow) => number = (
      row: MonitorEvaluationSeriesRow,
    ): number => {
      if (
        row.isKeepingStatus ||
        row.metCriteriaIds.some((criteriaId: string): boolean => {
          return problemCriteriaIds.has(criteriaId);
        })
      ) {
        return 0;
      }

      return row.metCriteriaIds.length > 0 ? 1 : 2;
    };

    const ranked: Array<{ row: MonitorEvaluationSeriesRow; index: number }> =
      read.map((row: MonitorEvaluationSeriesRow, index: number) => {
        return { row: row, index: index };
      });

    ranked.sort(
      (
        a: { row: MonitorEvaluationSeriesRow; index: number },
        b: { row: MonitorEvaluationSeriesRow; index: number },
      ): number => {
        return rank(a.row) - rank(b.row) || a.index - b.index;
      },
    );

    return {
      count: read.length,
      rows: ranked
        .slice(0, MAX_SERIES_TABLE_ROWS)
        .map((entry: { row: MonitorEvaluationSeriesRow }) => {
          return entry.row;
        }),
    };
  }

  /*
   * Every series the check read, before their verdicts. Null for a check
   * that has no series of its own: a monitor that does not group, or one
   * whose criteria name "*" for a disk or a port.
   */
  private static getRows(input: {
    monitorType: MonitorType | undefined;
    monitorStep: MonitorStep;
    dataToProcess: DataToProcess;
    criteriaInstances: Array<MonitorCriteriaInstance>;
    defaultMonitorStatusId: ObjectID | undefined;
  }): Array<MonitorEvaluationSeriesRow> | null {
    if (input.monitorType === MonitorType.Logs) {
      const groups: Array<LogMonitorGroupResult> | undefined = (
        input.dataToProcess as LogMonitorResponse
      ).groupBreakdown;

      return Array.isArray(groups)
        ? groups.map((group: LogMonitorGroupResult) => {
            return {
              fingerprint: group.fingerprint,
              labels: MonitorSeriesTable.toKeptLabels(group.labels),
              valueKind: MonitorEvaluationSeriesValueKind.Logs,
              value: group.logCount,
              metCriteriaIds: [],
            };
          })
        : null;
    }

    if (input.monitorType === MonitorType.Traces) {
      const groups: Array<TraceMonitorGroupResult> | undefined = (
        input.dataToProcess as TraceMonitorResponse
      ).groupBreakdown;

      return Array.isArray(groups)
        ? groups.map((group: TraceMonitorGroupResult) => {
            return {
              fingerprint: group.fingerprint,
              labels: MonitorSeriesTable.toKeptLabels(group.labels),
              ...(group.context
                ? { context: MonitorSeriesTable.toKeptLabels(group.context) }
                : {}),
              valueKind: MonitorEvaluationSeriesValueKind.Spans,
              value: group.spanCount,
              metCriteriaIds: [],
            };
          })
        : null;
    }

    if (!MonitorTypeHelper.isMetricBackedMonitor(input.monitorType)) {
      return null;
    }

    const seriesBreakdown: Array<MetricSeriesResult> | undefined = (
      input.dataToProcess as MetricMonitorResponse
    ).seriesBreakdown;

    if (!Array.isArray(seriesBreakdown)) {
      return null;
    }

    const compared: ComparedResult = MonitorSeriesTable.getComparedResult({
      monitorStep: input.monitorStep,
      criteriaInstances: input.criteriaInstances,
      defaultMonitorStatusId: input.defaultMonitorStatusId,
    });

    return seriesBreakdown
      .filter((series: MetricSeriesResult): boolean => {
        return Boolean(series?.fingerprint);
      })
      .map((series: MetricSeriesResult): MonitorEvaluationSeriesRow => {
        const results: Array<AggregatedResult> = series.aggregatedResults || [];

        const value: number | undefined = MonitorSeriesTable.getNewestValue(
          results[
            compared.index !== null && compared.index < results.length
              ? compared.index
              : results.length - 1
          ],
        );

        return {
          fingerprint: series.fingerprint,
          labels: MonitorSeriesTable.toKeptLabels(series.labels),
          valueKind: MonitorEvaluationSeriesValueKind.Metric,
          ...(value !== undefined ? { value: value } : {}),
          ...(compared.unit ? { unit: compared.unit } : {}),
          ...(compared.metricName ? { metricName: compared.metricName } : {}),
          metCriteriaIds: [],
        };
      });
  }

  /*
   * The query or formula whose value the table shows: the one the first
   * criteria that changes the status to a problem compares, else the first
   * one any criteria compares - a series' results are its queries', then its
   * formulas'. Index null when none is named or found: the series' last
   * result is shown then, a formula's when it has one.
   */
  private static getComparedResult(input: {
    monitorStep: MonitorStep;
    criteriaInstances: Array<MonitorCriteriaInstance>;
    defaultMonitorStatusId: ObjectID | undefined;
  }): ComparedResult {
    const none: ComparedResult = {
      index: null,
      unit: undefined,
      metricName: undefined,
    };

    const ordered: Array<MonitorCriteriaInstance> = [
      ...input.criteriaInstances.filter(
        (criteriaInstance: MonitorCriteriaInstance): boolean => {
          return (
            GroupedMonitorRecovery.getRole({
              criteriaInstance: criteriaInstance,
              defaultMonitorStatusId: input.defaultMonitorStatusId,
            }) === GroupedCriteriaRole.Problem
          );
        },
      ),
      ...input.criteriaInstances,
    ];

    let alias: string | undefined = undefined;

    for (const criteriaInstance of ordered) {
      if (criteriaInstance.data?.isEnabled === false) {
        continue;
      }

      const filter: CriteriaFilter | undefined = (
        criteriaInstance.data?.filters || []
      ).find((candidate: CriteriaFilter): boolean => {
        return (
          candidate.checkOn === CheckOn.MetricValue &&
          Boolean(candidate.metricMonitorOptions?.metricAlias)
        );
      });

      if (filter) {
        alias = filter.metricMonitorOptions!.metricAlias;
        break;
      }
    }

    const view: MetricsViewConfig | undefined =
      MonitorStep.getMetricsViewConfig(input.monitorStep);

    if (!alias || !view) {
      return none;
    }

    const wanted: string = MonitorSeriesTable.toAliasKey(alias);

    const queries: Array<MetricQueryConfigData> = view.queryConfigs || [];
    const formulas: Array<MetricFormulaConfigData> = view.formulaConfigs || [];

    const queryIndex: number = queries.findIndex(
      (query: MetricQueryConfigData): boolean => {
        return (
          MonitorSeriesTable.toAliasKey(
            query.metricAliasData?.metricVariable,
          ) === wanted
        );
      },
    );

    if (queryIndex >= 0) {
      return {
        index: queryIndex,
        unit: queries[queryIndex]!.metricAliasData?.legendUnit || undefined,
        metricName:
          queries[
            queryIndex
          ]!.metricQueryData?.filterData?.metricName?.toString() || undefined,
      };
    }

    const formulaIndex: number = formulas.findIndex(
      (formula: MetricFormulaConfigData): boolean => {
        return (
          MonitorSeriesTable.toAliasKey(
            formula.metricAliasData?.metricVariable,
          ) === wanted
        );
      },
    );

    if (formulaIndex >= 0) {
      return {
        index: queries.length + formulaIndex,
        unit: formulas[formulaIndex]!.metricAliasData?.legendUnit || undefined,
        metricName: undefined,
      };
    }

    return none;
  }

  private static toAliasKey(alias: string | undefined): string {
    return (alias || "").trim().replace(/^\$/, "").toLowerCase();
  }

  /*
   * A series' labels as the summary keeps them (MonitorEvaluationSeriesLabels):
   * the ones SeriesLabelDisplay names it by, each as the text it reads as.
   * Named again from these, the series reads as it did from the check's own.
   */
  private static toKeptLabels(
    labels: JSONObject | undefined,
  ): MonitorEvaluationSeriesLabels {
    const kept: MonitorEvaluationSeriesLabels = {};

    for (const label of SeriesLabelDisplay.getDisplayLabels(labels)) {
      kept[label.key] = label.value;
    }

    return kept;
  }

  // The value of a result's newest data point, by its time.
  private static getNewestValue(
    result: AggregatedResult | undefined,
  ): number | undefined {
    let newest: { at: number; value: number } | undefined = undefined;

    for (const point of result?.data || []) {
      const value: number = Number((point as AggregateModel)?.value);
      const at: number = new Date(
        (point as AggregateModel)?.timestamp as Date,
      ).getTime();

      if (!Number.isFinite(value)) {
        continue;
      }

      const time: number = Number.isFinite(at) ? at : 0;

      if (!newest || time >= newest.at) {
        newest = { at: time, value: value };
      }
    }

    return newest?.value;
  }
}

// The query or formula the table shows the value of.
interface ComparedResult {
  index: number | null;
  unit: string | undefined;
  metricName: string | undefined;
}
