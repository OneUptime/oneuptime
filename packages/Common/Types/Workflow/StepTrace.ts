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

/** A step that the port taken is wired to: where the step led. */
export interface WorkflowStepTraceNextStep {
  /** The step's id on the canvas ("slack-1"). */
  componentId: string;
  /** Its component's title ("Send Message to Slack"). */
  title: string;
}

/** An argument's or a return value's name, as the step's settings show it. */
export interface WorkflowStepTraceFieldName {
  id: string;
  name: string;
}

/** Something the runner noticed about a step that did not stop it. */
export interface WorkflowStepTraceWarning {
  /**
   * What happened, in the same words as the run's full log, less the log's
   * "Warning:" label.
   */
  message: string;
  /** The argument the warning is about, when it is about one. */
  argumentId?: string | undefined;
  /** The {{...}} references that resolved to nothing, as they were written. */
  unresolvedReferences?: Array<string> | undefined;
}

/*
 * Everything after `errorMessage` is optional and was added later, so a trace
 * written before it reads the same as one where the runner had nothing to say.
 * Readers must not treat an absent field as "none": an absent `nextSteps` means
 * "not recorded", where an empty one means "nothing is connected".
 */
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
  /**
   * The arguments the step received, resolved and already redacted for
   * sensitive fields. Captured before the component ran, since components
   * rewrite their own arguments as they work.
   */
  argumentValues: JSONObject;
  /** Returned values, already redacted for sensitive fields. */
  returnValues: JSONObject;
  /** The id of the out port taken ("no"), or null when the step took none. */
  executedPort: string | null;
  /** Present only on a failed step. */
  errorMessage?: string | undefined;
  /** The taken port's label, as the canvas shows it ("No"). */
  executedPortTitle?: string | undefined;
  /** What the taken port is for, as the canvas's tooltip says it. */
  executedPortDescription?: string | undefined;
  /**
   * The steps wired to the port taken, in the order the canvas connects them.
   * Empty when nothing is connected to that port. Recorded only when a port
   * was taken.
   */
  nextSteps?: Array<WorkflowStepTraceNextStep> | undefined;
  /**
   * The step's arguments in the order its settings list them, with their
   * names. A list rather than a map because the row is JSONB, which keeps an
   * object's keys in an order of its own (shortest first), not the order they
   * were written in.
   */
  argumentNames?: Array<WorkflowStepTraceFieldName> | undefined;
  /** The component's return values, in order, with their names. */
  returnValueNames?: Array<WorkflowStepTraceFieldName> | undefined;
  /**
   * For each argument whose configured value refers to another step or to a
   * variable, that value as configured, {{...}} and all, so it can be read
   * next to what it resolved to. Redacted like argumentValues, and never kept
   * for a sensitive argument.
   */
  argumentTemplates?: JSONObject | undefined;
  /** What the runner noticed about this step that did not stop it. */
  warnings?: Array<WorkflowStepTraceWarning> | undefined;
}

export interface WorkflowStepTrace {
  steps: Array<WorkflowStepTraceEntry>;
  /**
   * Set when steps were dropped to keep the row bounded. The dashboard says so
   * rather than quietly showing a partial run as if it were complete.
   */
  truncated?: boolean | undefined;
  /**
   * Set when the run tested one step on its own ("Run this step" in the
   * builder), to that step's id. Nothing ran before it, so whatever it reads
   * from earlier steps is empty, and the steps after it were not started.
   */
  singleStepComponentId?: string | undefined;
  /**
   * Why the run stopped, when no step's own entry says: it timed out between
   * steps, found a cycle, or failed before its first step ran.
   */
  runErrorMessage?: string | undefined;
  /**
   * Set while the run sleeps on a Sleep step, to when it carries on (an ISO
   * date). The steps after the Sleep have not run yet rather than not at all.
   * Cleared when the run resumes.
   */
  resumesAt?: string | undefined;
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

  return serialized.slice(0, MAX_TRACE_VALUE_LENGTH) + TRUNCATED_VALUE_SUFFIX;
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

  const traceObject: JSONObject = value as JSONObject;
  const steps: JSONValue | undefined = traceObject["steps"];

  if (!Array.isArray(steps)) {
    return emptyTrace();
  }

  const trace: WorkflowStepTrace = {
    // An entry that is not even an object cannot be drawn as a step at all.
    steps: steps.filter((step: JSONValue): boolean => {
      return Boolean(step) && typeof step === "object" && !Array.isArray(step);
    }) as unknown as Array<WorkflowStepTraceEntry>,
    truncated: Boolean(traceObject["truncated"]),
  };

  const singleStepComponentId: JSONValue | undefined =
    traceObject["singleStepComponentId"];

  if (typeof singleStepComponentId === "string" && singleStepComponentId) {
    trace.singleStepComponentId = singleStepComponentId;
  }

  const runErrorMessage: JSONValue | undefined = traceObject["runErrorMessage"];

  if (typeof runErrorMessage === "string" && runErrorMessage) {
    trace.runErrorMessage = runErrorMessage;
  }

  const resumesAt: JSONValue | undefined = traceObject["resumesAt"];

  if (typeof resumesAt === "string" && !isNaN(Date.parse(resumesAt))) {
    trace.resumesAt = resumesAt;
  }

  return trace;
};

export type GetStepPortTitleFunction = (
  step: Pick<WorkflowStepTraceEntry, "executedPort" | "executedPortTitle">,
) => string | null;

/**
 * The name of the port a step took, as the canvas labels it ("No"), or null
 * when it took none.
 *
 * Traces written before the title was kept have only the port's id. Every
 * built-in port's title is its id with a capital ("no" is "No", "error" is
 * "Error"), so that is the best reading of an old one. The one exception, the
 * manual trigger's "success" port titled "Execute", reads as "Success" there,
 * which is still what it means.
 */
export const getStepPortTitle: GetStepPortTitleFunction = (
  step: Pick<WorkflowStepTraceEntry, "executedPort" | "executedPortTitle">,
): string | null => {
  if (typeof step.executedPortTitle === "string" && step.executedPortTitle) {
    return step.executedPortTitle;
  }

  if (typeof step.executedPort !== "string" || !step.executedPort.trim()) {
    return null;
  }

  const words: string = step.executedPort.trim().replace(/[-_]+/g, " ");

  return words.charAt(0).toUpperCase() + words.slice(1);
};
