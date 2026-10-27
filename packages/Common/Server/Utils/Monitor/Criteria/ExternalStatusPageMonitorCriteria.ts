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

      const result: string | null = CompareCriteria.compareCriteriaNumbers({
        value: activeIncidents,
        threshold: threshold as number,
        criteriaFilter: input.criteriaFilter,
      });

      if (!result) {
        return null;
      }

      /*
       * Which incidents, by the names the page gives them: the ones that
       * affect a component the monitor watches. A probe that has not been
       * upgraded reports none, and the count says it all.
       */
      return ExternalStatusPageMonitorCriteria.withIncidentNames({
        message: result,
        names:
          activeIncidents > 0
            ? externalStatusPageResponse?.activeIncidentNames
            : undefined,
        count: activeIncidents,
      });
    }

    return null;
  }

  // How many incident names a criteria's message spells out.
  public static readonly MAX_NAMED_INCIDENTS: number = 3;

  /*
   * A criteria's message, followed by the incidents it counted:
   * 'Incident: "Incident with Git Operations".', or the first few of them
   * and how many more of the count there are.
   */
  public static withIncidentNames(data: {
    message: string;
    names: Array<string> | undefined;
    count: number;
  }): string {
    const message: string = data.message;
    const named: Array<string> = (Array.isArray(data.names) ? data.names : [])
      .filter((name: unknown): name is string => {
        return typeof name === "string" && name.trim().length > 0;
      })
      .map((name: string): string => {
        return name.trim();
      });

    if (named.length === 0) {
      return message;
    }

    const shown: Array<string> = named
      .slice(0, ExternalStatusPageMonitorCriteria.MAX_NAMED_INCIDENTS)
      .map((name: string): string => {
        return `"${name}"`;
      });
    const total: number = Math.max(data.count, named.length);
    const more: number = total - shown.length;
    const list: string =
      more > 0
        ? `${shown.join(", ")} and ${more} more`
        : shown.length > 1
          ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`
          : (shown[0] as string);

    return `${message} ${total === 1 ? "Incident" : "Incidents"}: ${list}.`;
  }
}
