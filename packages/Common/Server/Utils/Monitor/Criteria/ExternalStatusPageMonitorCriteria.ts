import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import {
  CheckOn,
  CriteriaFilter,
} from "../../../../Types/Monitor/CriteriaFilter";
import ExternalStatusPageMonitorResponse from "../../../../Types/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import EvaluateOverTime, { OverTimeCriteriaValue } from "./EvaluateOverTime";
import CaptureSpan from "../../Telemetry/CaptureSpan";

export default class ExternalStatusPageMonitorCriteria {
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
    let threshold: number | string | undefined | null =
      input.criteriaFilter.value;

    const dataToProcess: ProbeMonitorResponse =
      input.dataToProcess as ProbeMonitorResponse;

    const externalStatusPageResponse:
      | ExternalStatusPageMonitorResponse
      | undefined = dataToProcess.externalStatusPageResponse;

    const overTime: OverTimeCriteriaValue =
      await EvaluateOverTime.getOverTimeValueForCriteriaFilter({
        projectId: (input.dataToProcess as ProbeMonitorResponse).projectId,
        monitorId: input.dataToProcess.monitorId!,
        criteriaFilter: input.criteriaFilter,
        monitoringInterval: input.monitoringInterval,
      });

    /*
     * The window could not back this over-time filter (nothing recorded yet,
     * or the monitor has not been running long enough to cover it). Return
     * the decision the no-data policy already made instead of falling
     * through to the value that arrived with this one check - that fallback
     * is what let "all values over the last N minutes" fire off a single
     * bad reading.
     */
    if (overTime.earlyReturn) {
      return overTime.earlyReturn.result;
    }

    const overTimeValue:
      | Array<number | boolean>
      | number
      | boolean
      | undefined = overTime.value;

    // Check if external status page is online
    if (input.criteriaFilter.checkOn === CheckOn.ExternalStatusPageIsOnline) {
      const currentIsOnline: boolean | Array<boolean> =
        (overTimeValue as Array<boolean>) ??
        (input.dataToProcess as ProbeMonitorResponse).isOnline;

      return CompareCriteria.compareCriteriaBoolean({
        value: currentIsOnline,
        criteriaFilter: input.criteriaFilter,
      });
    }

    // Check external status page response time
    if (
      input.criteriaFilter.checkOn === CheckOn.ExternalStatusPageResponseTime
    ) {
      threshold = CompareCriteria.convertToNumber(threshold);

      if (threshold === null || threshold === undefined) {
        return null;
      }

      const currentResponseTime: number | Array<number> =
        (overTimeValue as Array<number>) ??
        (externalStatusPageResponse?.responseTimeInMs ||
          (input.dataToProcess as ProbeMonitorResponse).responseTimeInMs);

      if (currentResponseTime === null || currentResponseTime === undefined) {
        return null;
      }

      return CompareCriteria.compareCriteriaNumbers({
        value: currentResponseTime,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    // Check overall status
    if (
      input.criteriaFilter.checkOn === CheckOn.ExternalStatusPageOverallStatus
    ) {
      if (!externalStatusPageResponse?.overallStatus) {
        return null;
      }

      return CompareCriteria.compareCriteriaStrings({
        value: externalStatusPageResponse.overallStatus,
        threshold: String(threshold),
        criteriaFilter: input.criteriaFilter,
      });
    }

    // Check component status
    if (
      input.criteriaFilter.checkOn === CheckOn.ExternalStatusPageComponentStatus
    ) {
      if (
        !externalStatusPageResponse?.componentStatuses ||
        externalStatusPageResponse.componentStatuses.length === 0
      ) {
        return null;
      }

      // Check if any component status matches the criteria
      for (const component of externalStatusPageResponse.componentStatuses) {
        const result: string | null = CompareCriteria.compareCriteriaStrings({
          value: component.status,
          threshold: String(threshold),
          criteriaFilter: input.criteriaFilter,
        });

        if (result) {
          return `Component "${component.name}": ${result}`;
        }
      }

      return null;
    }

    // Check active incidents count
    if (
      input.criteriaFilter.checkOn === CheckOn.ExternalStatusPageActiveIncidents
    ) {
      threshold = CompareCriteria.convertToNumber(threshold);

      if (threshold === null || threshold === undefined) {
        return null;
      }

      const activeIncidents: number =
        externalStatusPageResponse?.activeIncidentCount || 0;

      return CompareCriteria.compareCriteriaNumbers({
        value: activeIncidents,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });
    }

    return null;
  }
}
