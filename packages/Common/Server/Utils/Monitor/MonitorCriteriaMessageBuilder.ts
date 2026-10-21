import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import DataToProcess from "./DataToProcess";
import { CriteriaFilter } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaExpectationBuilder from "./MonitorCriteriaExpectationBuilder";
import MonitorCriteriaObservationBuilder from "./MonitorCriteriaObservationBuilder";

export default class MonitorCriteriaMessageBuilder {
  public static buildCriteriaFilterMessage(input: {
    monitor: Monitor;
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
    didMeetCriteria: boolean;
    matchMessage: string | null;
  }): string {
    if (input.matchMessage) {
      return input.matchMessage;
    }

    if (input.didMeetCriteria) {
      const description: string =
        MonitorCriteriaExpectationBuilder.getCriteriaFilterDescription(
          input.criteriaFilter,
        );

      return `${description} condition met.`;
    }

    /*
     * An "All Values" metric criteria whose data points all meet the
     * condition, waiting for them to cover the time range: say how far it
     * has got - "Waiting for 15 minutes of data: 2 of 15 minutes so far" -
     * which is the answer to "why did nothing fire?".
     */
    const windowWaitMessage: string | undefined =
      input.criteriaFilter.metricCriteriaContext?.windowWait?.message;

    if (windowWaitMessage) {
      return windowWaitMessage;
    }

    const failureMessage: string | null =
      MonitorCriteriaMessageBuilder.buildCriteriaFilterFailureMessage({
        monitor: input.monitor,
        criteriaFilter: input.criteriaFilter,
        dataToProcess: input.dataToProcess,
        monitorStep: input.monitorStep,
      });

    if (failureMessage) {
      return failureMessage;
    }

    const description: string =
      MonitorCriteriaExpectationBuilder.getCriteriaFilterDescription(
        input.criteriaFilter,
      );

    return `${description} condition was not met.`;
  }

  private static buildCriteriaFilterFailureMessage(input: {
    monitor: Monitor;
    criteriaFilter: CriteriaFilter;
    dataToProcess: DataToProcess;
    monitorStep: MonitorStep;
  }): string | null {
    /*
     * Resolve the metric's display unit (undefined for non-metric criteria)
     * so the threshold in the expectation clause reads in the same unit as
     * the observed value — "recorded latest 0.06 sec (expected to be greater
     * than 5 sec)" rather than the unitless "0.06 (expected ... 5)".
     */
    const metricDisplay: {
      unit: string | undefined;
      metricName: string | undefined;
    } = MonitorCriteriaObservationBuilder.getMetricValueDisplayContext({
      criteriaFilter: input.criteriaFilter,
      dataToProcess: input.dataToProcess,
      monitorStep: input.monitorStep,
    });

    const expectation: string | null =
      MonitorCriteriaExpectationBuilder.describeCriteriaExpectation(
        input.criteriaFilter,
        {
          ...metricDisplay,
          monitorType: input.monitor.monitorType,
        },
      );

    const observation: string | null =
      MonitorCriteriaObservationBuilder.describeFilterObservation({
        monitor: input.monitor,
        criteriaFilter: input.criteriaFilter,
        dataToProcess: input.dataToProcess,
        monitorStep: input.monitorStep,
      });

    if (observation) {
      if (expectation) {
        return `${observation} (expected ${expectation}).`;
      }

      return `${observation}; configured filter was not met.`;
    }

    if (expectation) {
      /*
       * Both halves of this sentence quote the same threshold, so both
       * must render it the same way — otherwise it reads "Metric Value
       * greater than 1000000000 did not satisfy the configured condition
       * (expected to be greater than 1 GB)".
       */
      const description: string =
        MonitorCriteriaExpectationBuilder.getCriteriaFilterDescription(
          input.criteriaFilter,
          metricDisplay,
        );

      return `${description} did not satisfy the configured condition (${expectation}).`;
    }

    return null;
  }
}
