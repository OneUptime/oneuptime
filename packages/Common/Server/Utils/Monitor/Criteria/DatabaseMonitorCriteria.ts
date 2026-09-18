import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import EvaluateOverTime, { OverTimeCriteriaValue } from "./EvaluateOverTime";
import {
  CheckOn,
  CriteriaFilter,
} from "../../../../Types/Monitor/CriteriaFilter";
import {
  DatabaseMetricDefinition,
  getDatabaseMetricByMetricType,
} from "../../../../Types/Monitor/DatabaseMetricCatalog";
import DatabaseMonitorResponse, {
  DatabaseMetricGroupStatus,
} from "../../../../Types/Monitor/DatabaseMonitor/DatabaseMonitorResponse";
import MonitorMetricType from "../../../../Types/Monitor/MonitorMetricType";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import CaptureSpan from "../../Telemetry/CaptureSpan";

export default class DatabaseMonitorCriteria {
  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
    /*
     * The monitor's monitoringInterval cron. Over-time filters use it to
     * work out how many samples a fully covered window should hold, so a
     * monitor that has only just started is not mistaken for one whose
     * whole window is breaching.
     */
    monitoringInterval?: string | undefined;
  }): Promise<string | null> {
    const dataToProcess: ProbeMonitorResponse =
      input.dataToProcess as ProbeMonitorResponse;

    const databaseResponse: DatabaseMonitorResponse | undefined =
      dataToProcess.databaseMonitorResponse;

    /*
     * Resolved once for every CheckOn. Database Metric filters name their
     * series in databaseMonitorOptions.metricType rather than in the CheckOn,
     * which is why EvaluateOverTime resolves the series from the whole filter.
     */
    const overTime: OverTimeCriteriaValue =
      await EvaluateOverTime.getOverTimeValueForCriteriaFilter({
        projectId: dataToProcess.projectId,
        monitorId: input.dataToProcess.monitorId!,
        criteriaFilter: input.criteriaFilter,
        monitoringInterval: input.monitoringInterval,
      });

    /*
     * The window could not back this over-time filter, so the no-data policy
     * has already decided it - do not fall through to the value that arrived
     * with this one check. That fallback is what let "all values over the
     * last N minutes" fire off a single bad reading.
     *
     * "Database Is Online" is exempt, mirroring the server monitor. An
     * unreachable database is the one signal that must always reach its
     * criteria: a monitor whose window is still filling, or whose metric
     * write has not caught up, would otherwise be unable to go offline at
     * all while the dashboard shows the connection failing.
     */
    if (
      overTime.earlyReturn &&
      input.criteriaFilter.checkOn !== CheckOn.DatabaseIsOnline
    ) {
      return overTime.earlyReturn.result;
    }

    const overTimeValue:
      | Array<number | boolean>
      | number
      | boolean
      | undefined = overTime.value;

    // Could the probe connect and run the baseline probe query?
    if (input.criteriaFilter.checkOn === CheckOn.DatabaseIsOnline) {
      const currentIsOnline: boolean | Array<boolean> =
        (overTimeValue as Array<boolean>) ?? dataToProcess.isOnline;

      return CompareCriteria.compareCriteriaBoolean({
        value: currentIsOnline,
        criteriaFilter: input.criteriaFilter,
      });
    }

    /*
     * One branch for all of the catalog's series: the filter names the one it
     * reads in databaseMonitorOptions.metricType, exactly as disk usage names
     * a mount and an SNMP value names an OID.
     *
     * Thresholds are whole numbers - CompareCriteria.convertToNumber parses
     * with parseInt, so "99.5" is compared as 99. Every catalog unit is
     * chosen so an integral threshold is the natural one to type.
     */
    if (input.criteriaFilter.checkOn === CheckOn.DatabaseMetric) {
      const metricType: MonitorMetricType | undefined =
        input.criteriaFilter.databaseMonitorOptions?.metricType;

      if (!metricType) {
        return null;
      }

      const definition: DatabaseMetricDefinition | null =
        getDatabaseMetricByMetricType(metricType);

      if (!definition) {
        return null;
      }

      const value: number | undefined = databaseResponse?.metrics[metricType];

      /*
       * The metric was not collected on this check - the engine cannot report
       * it, the monitoring login is missing the grant its group needs, or the
       * group timed out. Absent is not zero, and a criteria that cannot see a
       * value must never claim one breached: a revoked grant would otherwise
       * raise an incident about a database that is perfectly healthy.
       * CheckOn.DatabaseCollectionError is how an operator alerts on lost
       * visibility.
       */
      if (value === undefined || value === null) {
        return null;
      }

      const threshold: number | null = CompareCriteria.convertToNumber(
        input.criteriaFilter.value,
      );

      if (threshold === null) {
        return null;
      }

      const result: string | null = CompareCriteria.compareCriteriaNumbers({
        value: (overTimeValue as Array<number>) ?? value,
        threshold: threshold,
        criteriaFilter: input.criteriaFilter,
        unit: definition.unit || undefined,
      });

      if (result) {
        return `${definition.friendlyName} - ${result}`;
      }

      return null;
    }

    // Groups that could not be collected, as one operator-facing line each.
    if (input.criteriaFilter.checkOn === CheckOn.DatabaseCollectionError) {
      const collectionIssues: string = (
        databaseResponse?.unavailableGroups || []
      )
        .map((status: DatabaseMetricGroupStatus) => {
          return `${status.group}: ${status.message}`;
        })
        .join("; ");

      /*
       * compareEmptyAndNotEmpty tests for null/undefined, and an empty string
       * would read as "not empty" - so a check with nothing to report has to
       * arrive as undefined for "Is Empty" to mean "collection was clean".
       */
      const emptyNotEmptyResult: string | null =
        CompareCriteria.compareEmptyAndNotEmpty({
          value: collectionIssues || undefined,
          criteriaFilter: input.criteriaFilter,
        });

      if (emptyNotEmptyResult) {
        return emptyNotEmptyResult;
      }

      if (
        input.criteriaFilter.value !== null &&
        input.criteriaFilter.value !== undefined &&
        collectionIssues
      ) {
        return CompareCriteria.compareCriteriaStrings({
          value: collectionIssues,
          threshold: input.criteriaFilter.value.toString(),
          criteriaFilter: input.criteriaFilter,
        });
      }

      return null;
    }

    return null;
  }
}
