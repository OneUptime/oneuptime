/*
 * A structured record of what each step of a workflow run actually did.
 *
 * The runner has always known this — it logs the arguments it resolved, the
 * values a component returned, and which out port it took — but it flattened
 * all of it into one newline-joined string, so the only way to answer "what did
 * step three receive" was to read the whole blob. Keeping the same information
 * as data lets the run be read as a list of steps, and lets a step be matched
 * back to the node it came from on the canvas.
 *
 * The shapes live in Common/Types because the runner writes them, the API
 * returns them, and the dashboard renders them.
 */

import { JSONObject, JSONValue } from "../JSON";

export enum WorkflowStepStatus {
  Success = "Success",
  Error = "Error",
}

export interface WorkflowStepTraceEntry {
  /** The step's user-facing id ("api-get-1") — matches a node on the canvas. */
  componentId: string;
  /** Which kind of component this was, e.g. "api-post". */
  metadataId: string;
  /** The component's title, so the trace reads without loading metadata. */
  title: string;
  status: WorkflowStepStatus;
  startedAt: string;
  completedAt: string;
  durationInMs: number;
  /** Resolved arguments, already redacted for sensitive fields. */
  argumentValues: JSONObject;
  /** Returned values, already redacted for sensitive fields. */
  returnValues: JSONObject;
  /** The out port taken, or null when the step ended the run. */
  executedPort: string | null;
  /** Present only on a failed step. */
  errorMessage?: string | undefined;
}

export interface WorkflowStepTrace {
  steps: Array<WorkflowStepTraceEntry>;
  /**
   * Set when steps were dropped to keep the row bounded. The dashboard says so
   * rather than quietly showing a partial run as if it were complete.
   */
  truncated?: boolean | undefined;
}

/*
 * A run is bounded by cycle detection, but a workflow that suspends and resumes
 * accumulates across resumes, and a single value can be an entire HTTP response
 * body. Both are capped: the row is written on every status change, and an
 * unbounded trace would turn each of those writes into a large one.
 */
export const MAX_TRACE_STEPS: number = 100;
export const MAX_TRACE_VALUE_LENGTH: number = 4000;

export const TRUNCATED_VALUE_SUFFIX: string = "… (truncated)";

export type TruncateTraceValueFunction = (value: JSONValue) => JSONValue;

/**
 * Shrink one recorded value to something a row can hold.
 *
 * Strings are cut; anything structured is measured by its JSON length and
 * replaced wholesale when it is too big, because cutting a serialized object in
 * half produces text that looks like data but cannot be parsed.
 */
export const truncateTraceValue: TruncateTraceValueFunction = (
  value: JSONValue,
): JSONValue => {
  if (typeof value === "string") {
    if (value.length <= MAX_TRACE_VALUE_LENGTH) {
      return value;
    }

    return value.slice(0, MAX_TRACE_VALUE_LENGTH) + TRUNCATED_VALUE_SUFFIX;
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== "object") {
    return value;
  }

  let serialized: string;

  try {
    serialized = JSON.stringify(value);
  } catch {
    // Circular or otherwise unserializable: say so rather than throwing.
    return "[value could not be recorded]";
  }

  if (serialized.length <= MAX_TRACE_VALUE_LENGTH) {
    return value;
  }

  return (
    serialized.slice(0, MAX_TRACE_VALUE_LENGTH) + TRUNCATED_VALUE_SUFFIX
  );
};

export type TruncateTraceValuesFunction = (values: JSONObject) => JSONObject;

export const truncateTraceValues: TruncateTraceValuesFunction = (
  values: JSONObject,
): JSONObject => {
  const truncated: JSONObject = {};

  for (const key of Object.keys(values || {})) {
    truncated[key] = truncateTraceValue(values[key] as JSONValue);
  }

  return truncated;
};

export type AppendTraceStepFunction = (
  trace: WorkflowStepTrace,
  entry: WorkflowStepTraceEntry,
) => WorkflowStepTrace;

/**
 * Add a step, keeping the trace within its cap.
 *
 * When the cap is reached the OLDEST steps are dropped: a run that failed is
 * read from the end, and the step that broke it is the last one.
 */
export const appendTraceStep: AppendTraceStepFunction = (
  trace: WorkflowStepTrace,
  entry: WorkflowStepTraceEntry,
): WorkflowStepTrace => {
  const steps: Array<WorkflowStepTraceEntry> = [...(trace.steps || []), entry];

  if (steps.length <= MAX_TRACE_STEPS) {
    return { ...trace, steps: steps };
  }

  return {
    ...trace,
    steps: steps.slice(steps.length - MAX_TRACE_STEPS),
    truncated: true,
  };
};

export type EmptyTraceFunction = () => WorkflowStepTrace;

export const emptyTrace: EmptyTraceFunction = (): WorkflowStepTrace => {
  return { steps: [] };
};

export type ParseTraceFunction = (value: JSONValue) => WorkflowStepTrace;

/**
 * Read a trace back off a row, tolerating anything that is not one.
 *
 * Old runs predate the column and rows can be written by an older build, so
 * this never throws — a trace it cannot understand reads as an empty one and
 * the viewer falls back to the raw log.
 */
export const parseTrace: ParseTraceFunction = (
  value: JSONValue,
): WorkflowStepTrace => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyTrace();
  }

  const steps: JSONValue | undefined = (value as JSONObject)["steps"];

  if (!Array.isArray(steps)) {
    return emptyTrace();
  }

  return {
    steps: steps as unknown as Array<WorkflowStepTraceEntry>,
    truncated: Boolean((value as JSONObject)["truncated"]),
  };
};
