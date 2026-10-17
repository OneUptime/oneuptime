import DataToProcess from "../DataToProcess";
import CompareCriteria from "./CompareCriteria";
import EvaluateOverTime, { OverTimeCriteriaValue } from "./EvaluateOverTime";
import {
  CheckOn,
  CriteriaFilter,
} from "../../../../Types/Monitor/CriteriaFilter";
import ProbeStatusMonitorResponse from "../../../../Types/Monitor/ProbeStatusMonitor/ProbeStatusMonitorResponse";
import ProbeStatusMonitorUtil from "../../../../Utils/Monitor/ProbeStatusMonitorUtil";
import { EVERY_MINUTE } from "../../../../Utils/CronTime";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * The criteria of a Probe Status monitor: how many of the probes it watches
 * are connected, and how many are not, compared with the filter's number.
 * Both are counts, so "Disconnected Probes is greater than 0" is "a probe is
 * down" and "Connected Probes is less than 2" is "fewer than two are left".
 *
 * Both counts are recorded every evaluation (MonitorMetricUtil), so a filter
 * can also be judged over a window - "Disconnected Probes is greater than 0
 * for all values over the last 5 minutes" waits five minutes before it
 * opens anything, on top of the three minutes a probe takes to be called
 * disconnected at all.
 */
export default class ProbeStatusMonitorCriteria {
  public static getResponse(
    dataToProcess: DataToProcess,
  ): ProbeStatusMonitorResponse | null {
    const response: ProbeStatusMonitorResponse =
      dataToProcess as ProbeStatusMonitorResponse;

    if (
      !response ||
      !Array.isArray(response.probes) ||
      typeof response.connectedProbeCount !== "number" ||
      typeof response.disconnectedProbeCount !== "number"
    ) {
      return null;
    }

    return response;
  }

  public static getValue(input: {
    response: ProbeStatusMonitorResponse;
    checkOn: CheckOn;
  }): number | null {
    if (input.checkOn === CheckOn.ConnectedProbes) {
      return input.response.connectedProbeCount;
    }

    if (input.checkOn === CheckOn.DisconnectedProbes) {
      return input.response.disconnectedProbeCount;
    }

    return null;
  }

  @CaptureSpan()
  public static async isMonitorInstanceCriteriaFilterMet(input: {
    dataToProcess: DataToProcess;
    criteriaFilter: CriteriaFilter;
    /*
     * The monitor's monitoringInterval cron, for sizing an over-time
     * window. A Probe Status monitor has none of its own: the worker
     * evaluates it every minute, so that is the cadence a window is sized
     * by (a status flip adds an evaluation, never removes one).
     */
    monitoringInterval?: string | undefined;
  }): Promise<string | null> {
    const response: ProbeStatusMonitorResponse | null =
      ProbeStatusMonitorCriteria.getResponse(input.dataToProcess);

    if (!response) {
      return null;
    }

    const value: number | null = ProbeStatusMonitorCriteria.getValue({
      response: response,
      checkOn: input.criteriaFilter.checkOn,
    });

    if (value === null) {
      return null;
    }

    const threshold: number | null = CompareCriteria.convertToNumber(
      input.criteriaFilter.value as string | number | undefined,
    );

    if (threshold === null) {
      return null;
    }

    const overTime: OverTimeCriteriaValue =
      await EvaluateOverTime.getOverTimeValueForCriteriaFilter({
        projectId: response.projectId,
        monitorId: response.monitorId,
        criteriaFilter: input.criteriaFilter,
        monitoringInterval: input.monitoringInterval || EVERY_MINUTE,
      });

    if (overTime.earlyReturn) {
      return overTime.earlyReturn.result;
    }

    const comparison: string | null = CompareCriteria.compareCriteriaNumbers({
      value: (overTime.value as Array<number> | number | undefined) ?? value,
      threshold: threshold,
      criteriaFilter: input.criteriaFilter,
    });

    if (!comparison) {
      return null;
    }

    /*
     * The comparison says which number crossed which line; the sentence
     * after it says which probes, which is what the person paged needs.
     */
    return `${comparison} ${ProbeStatusMonitorUtil.describe(response)}`;
  }
}
