import { JSONObject, JSONValue } from "../JSON";

/*
 * HOW MUCH OF EACH VALUE A WORKFLOW RUN'S TEXT LOG WRITES (#11476).
 *
 * A run's text log (WorkflowLog.logs) writes each step's arguments
 * ("Component Args"), what it returned ("Data Returned"), and what it logs
 * itself. One value can be an API response body or a step's images, up to
 * 10 MB, and a run that sleeps writes its whole log to its row each time it
 * parks. So each value is written up to MAX_LOG_VALUE_LENGTH characters,
 * then a marker that says how many more there were - the way the Steps view
 * cuts each value (StepTrace.truncateTraceValue), with more room.
 *
 * A value is cut only after secrets and sensitive values have been taken
 * out of all of it (RunWorkflow), so one that the cut would split is still
 * redacted whole. Pure: the runner and the docs read the same limit.
 */

// The most characters of one value the run's log writes: 64 KB of text.
export const MAX_LOG_VALUE_LENGTH: number = 64 * 1024;

export type GetLeftOutMarkerFunction = (leftOut: number) => string;

// What ends a value that was cut: how many characters were left out.
export const getLeftOutMarker: GetLeftOutMarkerFunction = (
  leftOut: number,
): string => {
  return `… (${leftOut.toLocaleString("en-US")} more characters left out)`;
};

export type CutLogTextFunction = (text: string) => string;

/*
 * A text as the log writes it: whole when it fits, otherwise its first
 * MAX_LOG_VALUE_LENGTH characters and the marker. A cut that would split a
 * character written as two (an emoji) is made before it.
 */
export const cutLogText: CutLogTextFunction = (text: string): string => {
  if (typeof text !== "string" || text.length <= MAX_LOG_VALUE_LENGTH) {
    return text;
  }

  let cutAt: number = MAX_LOG_VALUE_LENGTH;
  const last: number = text.charCodeAt(cutAt - 1);

  // A high surrogate whose low half would be left out goes with it.
  if (last >= 0xd800 && last <= 0xdbff) {
    cutAt--;
  }

  return text.slice(0, cutAt) + getLeftOutMarker(text.length - cutAt);
};

export type CutLogValueFunction = (value: JSONValue) => JSONValue;

/*
 * One value as the log writes it. A text is cut as cutLogText cuts it. A
 * list or an object is measured by its JSON, and one too long is written as
 * its JSON cut short - a string, as the Steps view writes it - since half an
 * object is not one. Numbers, booleans and nothing are written as they are.
 */
export const cutLogValue: CutLogValueFunction = (
  value: JSONValue,
): JSONValue => {
  if (typeof value === "string") {
    return cutLogText(value);
  }

  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }

  let serialized: string;

  try {
    serialized = JSON.stringify(value);
  } catch {
    return "[value could not be logged]";
  }

  if (serialized === undefined || serialized.length <= MAX_LOG_VALUE_LENGTH) {
    return value;
  }

  return cutLogText(serialized);
};

export type CutLogValuesFunction = (values: JSONObject) => JSONObject;

// A step's arguments or returned values, each cut on its own.
export const cutLogValues: CutLogValuesFunction = (
  values: JSONObject,
): JSONObject => {
  const cut: JSONObject = {};

  for (const key of Object.keys(values || {})) {
    cut[key] = cutLogValue(values[key] as JSONValue);
  }

  return cut;
};
