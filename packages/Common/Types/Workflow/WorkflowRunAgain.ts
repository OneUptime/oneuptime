import { JSONObject } from "../JSON";

/*
 * RUN AGAIN.
 *
 * https://github.com/OneUptime/oneuptime/issues/5944 - someone testing a
 * webhook workflow gets one delivery from the other tool, changes a step, and
 * wants to try it again with the same payload, without making the other tool
 * send it again.
 *
 * Run again is a new run of the workflow as it is now, started with what an
 * earlier run's trigger started with. It is an ordinary run in every other way:
 * its steps run for real, it counts towards the plan, and while the workflow is
 * off it is a test run, as anything a person starts is.
 *
 * What a run started with is kept on its log row when the row is written
 * (WorkflowLog.triggerValues). The step trace could not serve: each value in it
 * is cut short and has secrets taken out, and running a workflow on that would
 * be running it on something else.
 *
 * A test of one step is not kept: it started with nothing, and it is run again
 * from the step.
 *
 * Pure, with no database or React imports.
 */

/*
 * The most that is kept for one run, in characters of JSON. A run that started
 * with more still runs. It just cannot be run again, so a large delivery does
 * not cost a large row on the table every run writes.
 */
export const MAX_TRIGGER_VALUES_LENGTH: number = 1024 * 1024;

export const WORKFLOW_RUN_CANNOT_RUN_AGAIN_MESSAGE: string =
  "This run cannot be run again, because what it started with was not kept. A test of one step, a run that started with too much to keep, and a run from before OneUptime kept these are not kept.";

export interface RunAgainColumns {
  triggerValues: string | undefined;
  canRunAgain: boolean;
}

const NOT_KEPT: RunAgainColumns = {
  triggerValues: undefined,
  canRunAgain: false,
};

type GetRunAgainColumnsFunction = (data: {
  returnValues: JSONObject | null | undefined;
  // The run is a test of one step: Run just this step.
  runOnlyComponentId?: string | null | undefined;
}) => RunAgainColumns;

// What a run's log row keeps of what the run starts with.
export const getRunAgainColumns: GetRunAgainColumnsFunction = (data: {
  returnValues: JSONObject | null | undefined;
  runOnlyComponentId?: string | null | undefined;
}): RunAgainColumns => {
  if (data.runOnlyComponentId) {
    return NOT_KEPT;
  }

  let text: string;

  try {
    // As the queue hands them to the worker, so the new run starts the same.
    text = JSON.stringify(data.returnValues || {});
  } catch {
    // Keeping a copy never stands in the way of the run that was asked for.
    return NOT_KEPT;
  }

  if (text.length > MAX_TRIGGER_VALUES_LENGTH) {
    return NOT_KEPT;
  }

  return { triggerValues: text, canRunAgain: true };
};

type ReadTriggerValuesFunction = (
  stored: string | null | undefined,
) => JSONObject | null;

// What a run started with, or null when it was not kept.
export const readTriggerValues: ReadTriggerValuesFunction = (
  stored: string | null | undefined,
): JSONObject | null => {
  if (!stored) {
    return null;
  }

  try {
    const values: unknown = JSON.parse(stored);

    return values && typeof values === "object" && !Array.isArray(values)
      ? (values as JSONObject)
      : null;
  } catch {
    return null;
  }
};
