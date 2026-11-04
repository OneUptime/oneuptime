import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import {
  CheckOn,
  CriteriaFilter,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import DataToProcess from "./DataToProcess";

// What the criteria's result and the status change say of a match with no series.
export const GROUPED_SERIES_GONE_MET_NOTE: string =
  "No series has data in this window, so each missing series counts as 0.";

// What the evaluation log says of a criteria that waits for the resource.
export const GROUPED_SERIES_GONE_NOT_MET_MESSAGE: string =
  "Criteria was not met: no series has data in this window, and nothing shows " +
  "the resource still reports, so a missing series does not count as 0. " +
  "Silence is not recovery.";

/**
 * A grouped metric check whose every series is gone, and the one kind of
 * criteria that can still match it.
 *
 * A state in a label - `status = red`, `type = SLOW_OPS`, `severity =
 * critical` - has a series only while something is in that state, so the last
 * red host turning green leaves no series at all, not a 0. That is what Treat
 * As Zero is for on a recovery criteria. But a grouped monitor acts on the
 * series a criteria names, and with none left such a criteria names none
 * ("no single series satisfied it"): it never matched, the monitor stayed
 * offline, and the incidents and alerts its firing criteria opened stayed open
 * for ever, while other series in the group would have closed them.
 *
 * It now matches, with no series, on two conditions:
 *
 *   - It opens nothing. With no series there is nothing to open a record for,
 *     and one for the whole monitor would block every real per-series record.
 *     A criteria that opens records goes on not matching, whatever it reads a
 *     missing series as.
 *   - On an infrastructure monitor, whose silence is not recovery
 *     (MonitorResourceUtil.isSilentInfrastructureWindow), the resource's
 *     heartbeat arrived in the same window
 *     (MetricMonitorResponse.resourceStillReporting). A window with no series
 *     looks the same whether the series are gone or the agent stopped; only
 *     the agent going on sending what it always sends tells them apart. A
 *     Metrics monitor's metric can be one an app sends only when something
 *     happens, so its silence keeps its old meaning and nothing more is asked.
 */
export default class GroupedSeriesGone {
  /*
   * A check of a grouped monitor (only those have a breakdown) that read
   * nothing: not one data point in any query.
   */
  public static hasNoSeries(dataToProcess: DataToProcess): boolean {
    const response: MetricMonitorResponse =
      dataToProcess as MetricMonitorResponse;

    if (
      !Array.isArray(response.seriesBreakdown) ||
      response.seriesBreakdown.length > 0 ||
      !Array.isArray(response.metricResult)
    ) {
      return false;
    }

    return response.metricResult.every((result: AggregatedResult): boolean => {
      return !result?.data || result.data.length === 0;
    });
  }

  /*
   * A criteria that opens nothing and has a metric filter reading a missing
   * series as 0.
   */
  public static countsMissingSeriesAsZero(
    criteriaInstance: MonitorCriteriaInstance,
  ): boolean {
    const criteria: MonitorCriteriaInstance["data"] | undefined =
      criteriaInstance.data;

    if (!criteria || MonitorCriteriaInstance.opensRecords(criteria)) {
      return false;
    }

    return (criteria.filters || []).some((filter: CriteriaFilter): boolean => {
      return (
        filter.checkOn === CheckOn.MetricValue &&
        filter.metricMonitorOptions?.onNoDataPolicy === NoDataPolicy.TreatAsZero
      );
    });
  }

  /*
   * For the worker: whether this check's verdict depends on the resource
   * still reporting, so that its heartbeat is worth reading.
   */
  public static needsResourceReport(input: {
    monitorType: MonitorType | undefined;
    monitorStep: MonitorStep;
    dataToProcess: DataToProcess;
  }): boolean {
    if (
      !MonitorTypeHelper.isInfrastructureMonitor(input.monitorType) ||
      !GroupedSeriesGone.hasNoSeries(input.dataToProcess)
    ) {
      return false;
    }

    const criteriaInstances: Array<MonitorCriteriaInstance> =
      input.monitorStep.data?.monitorCriteria?.data
        ?.monitorCriteriaInstanceArray || [];

    return criteriaInstances.some(
      (criteriaInstance: MonitorCriteriaInstance): boolean => {
        return GroupedSeriesGone.countsMissingSeriesAsZero(criteriaInstance);
      },
    );
  }

  /*
   * For the criteria evaluator, once a criteria of a grouped monitor holds of
   * this check and names no series: whether it matches all the same.
   */
  public static isCriteriaMet(input: {
    monitorType: MonitorType | undefined;
    criteriaInstance: MonitorCriteriaInstance;
    dataToProcess: DataToProcess;
  }): boolean {
    if (
      !GroupedSeriesGone.isCriteriaAboutGoneSeries({
        monitorType: input.monitorType,
        criteriaInstance: input.criteriaInstance,
        dataToProcess: input.dataToProcess,
      })
    ) {
      return false;
    }

    if (!MonitorTypeHelper.isInfrastructureMonitor(input.monitorType)) {
      return true;
    }

    return (
      (input.dataToProcess as MetricMonitorResponse).resourceStillReporting ===
      true
    );
  }

  /*
   * For the evaluation log: a criteria that would have matched had the
   * resource shown it still reports. Its own reason why nothing happened.
   */
  public static isWaitingForResource(input: {
    monitorType: MonitorType | undefined;
    criteriaInstance: MonitorCriteriaInstance;
    dataToProcess: DataToProcess;
  }): boolean {
    return (
      GroupedSeriesGone.isCriteriaAboutGoneSeries({
        monitorType: input.monitorType,
        criteriaInstance: input.criteriaInstance,
        dataToProcess: input.dataToProcess,
      }) && !GroupedSeriesGone.isCriteriaMet(input)
    );
  }

  private static isCriteriaAboutGoneSeries(input: {
    monitorType: MonitorType | undefined;
    criteriaInstance: MonitorCriteriaInstance;
    dataToProcess: DataToProcess;
  }): boolean {
    return (
      MonitorTypeHelper.isMetricBackedMonitor(input.monitorType) &&
      GroupedSeriesGone.hasNoSeries(input.dataToProcess) &&
      GroupedSeriesGone.countsMissingSeriesAsZero(input.criteriaInstance)
    );
  }
}
