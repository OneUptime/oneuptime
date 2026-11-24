import Includes from "../BaseDatabase/Includes";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorSteps from "./MonitorSteps";

/**
 * WHICH STEP A SERIES ROW CAME FROM (#10906).
 *
 * A monitor can have several steps - two URLs, a page and the API behind it -
 * and a probe checks each one and reports each result on its own. Every row a
 * check writes (MonitorMetricUtil) names the step it came from, beside the
 * probe that made it, so a window of one step's checks reads that step's rows
 * alone: its counts and percentages, its averages and percentiles, its status
 * changes and its previous check (CheckWindowCounts, EvaluateOverTime,
 * PreviousCheckComparison). Before, a monitor checking a fast page and a slow
 * one judged each step on both steps' checks.
 *
 * ROWS THAT NAME NO STEP
 *
 * Rows written before rows named their step carry none. A monitor with one
 * step reads them as its own - they cannot be any other step's - so its
 * windows go on across the upgrade. A monitor with several steps cannot tell
 * whose they are, so it leaves them out: its windows fill again with checks
 * that name their step, and until they do a window is judged as any window
 * whose checks do not reach back over it yet (its If No Data setting
 * decides).
 *
 * A step keeps its id when Terraform or the API writes the steps again
 * (MonitorStepsIdentityUtil), so its rows stay its own across a write.
 */
export const MONITOR_STEP_ID_ATTRIBUTE: string = "monitorStepId";

// The rows of a monitor's series a window of one step reads.
export interface MonitorStepSeriesScope {
  // The step whose checks the window reads.
  monitorStepId: string;
  /*
   * Whether the rows that name no step are read too: on a monitor with one
   * step, whose rows they all are.
   */
  readsRowsWithoutStep: boolean;
}

export default class MonitorStepSeries {
  /*
   * The rows a window of this step reads: the step's own, and on a monitor
   * with one step the rows written before rows named their step.
   */
  public static getScope(data: {
    monitorStepId: ObjectID | string;
    monitorSteps: MonitorSteps | undefined | null;
  }): MonitorStepSeriesScope {
    return {
      monitorStepId: data.monitorStepId.toString(),
      readsRowsWithoutStep:
        MonitorStepSeries.getStepCount(data.monitorSteps) <= 1,
    };
  }

  // How many steps a monitor has.
  public static getStepCount(
    monitorSteps: MonitorSteps | undefined | null,
  ): number {
    return monitorSteps?.data?.monitorStepsInstanceArray?.length || 0;
  }

  /*
   * The values the step attribute of a row the window reads may hold: the
   * step's id, and "" - a row that names no step - when those are read too.
   * A missing key of the attributes map reads as "", as ClickHouse reads it.
   */
  public static getAttributeValues(
    scope: MonitorStepSeriesScope,
  ): Array<string> {
    return scope.readsRowsWithoutStep
      ? [scope.monitorStepId, ""]
      : [scope.monitorStepId];
  }

  /*
   * The scope as an attribute filter of the analytics query a window's rows
   * are read with (EvaluateOverTime.readWindowRows): the step's id, or either
   * of the values getAttributeValues names.
   */
  public static toQueryAttributes(scope: MonitorStepSeriesScope): JSONObject {
    const values: Array<string> = MonitorStepSeries.getAttributeValues(scope);

    return {
      [MONITOR_STEP_ID_ATTRIBUTE]:
        values.length === 1 ? values[0]! : new Includes(values),
    };
  }

  // Whether a row's attributes are in the scope: what the reads above select.
  public static isRowInScope(data: {
    attributes: Record<string, unknown> | undefined | null;
    scope: MonitorStepSeriesScope;
  }): boolean {
    const value: unknown = data.attributes?.[MONITOR_STEP_ID_ATTRIBUTE];
    const stepId: string =
      value === undefined || value === null ? "" : String(value);

    return MonitorStepSeries.getAttributeValues(data.scope).includes(stepId);
  }

  /*
   * The position of a row's step among the monitor's steps, from 1, for a
   * monitor with several steps: what tells two lines of one probe apart on a
   * chart. Null for a monitor with one step, or a row that names no step or
   * one the monitor no longer has.
   */
  public static getStepNumber(data: {
    attributes: Record<string, unknown> | undefined | null;
    monitorSteps: MonitorSteps | undefined | null;
  }): number | null {
    const steps: Array<MonitorStep> =
      data.monitorSteps?.data?.monitorStepsInstanceArray || [];

    if (steps.length <= 1) {
      return null;
    }

    const value: unknown = data.attributes?.[MONITOR_STEP_ID_ATTRIBUTE];

    if (value === undefined || value === null || String(value) === "") {
      return null;
    }

    const index: number = steps.findIndex((step: MonitorStep): boolean => {
      return step.data?.id?.toString() === String(value);
    });

    return index === -1 ? null : index + 1;
  }
}
