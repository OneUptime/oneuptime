/*
 * How a recorded step reads in the run's Steps view, worked out from the trace
 * alone.
 *
 * Kept apart from StepTraceViewer so the decisions - which way a step went and
 * where that led, how a value is shown, which argument did not resolve - can
 * be tested without rendering anything, and so the viewer is left with layout.
 *
 * Every reader here has to cope with traces written before a field existed. A
 * run from last month has no port title, no list of next steps and no argument
 * names, and must still read sensibly rather than break or claim "nothing is
 * connected" about wiring it never recorded.
 */

import { JSONObject, JSONValue } from "../../../Types/JSON";
import {
  WorkflowStepStatus,
  WorkflowStepTrace,
  WorkflowStepTraceEntry,
  WorkflowStepTraceFieldName,
  WorkflowStepTraceNextStep,
  WorkflowStepTraceWarning,
  getStepPortTitle,
} from "../../../Types/Workflow/StepTrace";

/** The one port id that means the step failed: see RunWorkflow.recordStep. */
export const ERROR_PORT_ID: string = "error";

export enum StepPortTone {
  /** Any port that is simply the way the run went: Yes, No, Success, Out. */
  Normal = "Normal",
  /** The Error port: the step failed and the run took its error branch. */
  Error = "Error",
}

export enum StepOutcomeKind {
  /** Took a port wired to one or more steps. */
  LedTo = "LedTo",
  /** Took a port that nothing is connected to. */
  NothingConnected = "NothingConnected",
  /** Took a port, in a trace written before the wiring was recorded. */
  PortOnly = "PortOnly",
  /** Took no port: it failed before it got to one, or ended the run. */
  NoPort = "NoPort",
}

export interface StepOutcomeNextStep {
  componentId: string;
  title: string;
  /**
   * The step's number in this run, when it ran after this one. Null when it
   * did not run: the run stopped first, or it was a test of one step.
   */
  stepNumber: number | null;
}

export interface StepOutcome {
  kind: StepOutcomeKind;
  /** The port's name as the canvas shows it ("No"), or null for no port. */
  portTitle: string | null;
  portDescription: string | null;
  portTone: StepPortTone;
  nextSteps: Array<StepOutcomeNextStep>;
}

type IsTextFunction = (value: unknown) => value is string;

const isText: IsTextFunction = (value: unknown): value is string => {
  return typeof value === "string" && value.length > 0;
};

type GetStepsFunction = (
  trace: WorkflowStepTrace | null | undefined,
) => Array<WorkflowStepTraceEntry>;

/** The trace's steps, or none at all for anything that is not a trace. */
export const getTraceSteps: GetStepsFunction = (
  trace: WorkflowStepTrace | null | undefined,
): Array<WorkflowStepTraceEntry> => {
  if (!trace || !Array.isArray(trace.steps)) {
    return [];
  }

  return trace.steps.filter((step: WorkflowStepTraceEntry): boolean => {
    return Boolean(step) && typeof step === "object";
  });
};

type IsStepFailedFunction = (step: WorkflowStepTraceEntry) => boolean;

export const isStepFailed: IsStepFailedFunction = (
  step: WorkflowStepTraceEntry,
): boolean => {
  return step.status === WorkflowStepStatus.Error;
};

type GetStepWarningsFunction = (
  step: WorkflowStepTraceEntry,
) => Array<WorkflowStepTraceWarning>;

/** The step's warnings that have something to say. */
export const getStepWarnings: GetStepWarningsFunction = (
  step: WorkflowStepTraceEntry,
): Array<WorkflowStepTraceWarning> => {
  if (!Array.isArray(step.warnings)) {
    return [];
  }

  return step.warnings.filter((warning: WorkflowStepTraceWarning): boolean => {
    return Boolean(warning) && isText(warning.message);
  });
};

type GetStepOutcomeFunction = (
  trace: WorkflowStepTrace,
  index: number,
) => StepOutcome;

/**
 * Which way the step at `index` went, and where that led.
 *
 * A next step is matched to a later step of this run by its id: each step runs
 * at most once in a run (the runner refuses a cycle), so the first later step
 * with that id is the one this port started. One that never appears did not
 * run - the run stopped first, or only one step was being tested.
 */
export const getStepOutcome: GetStepOutcomeFunction = (
  trace: WorkflowStepTrace,
  index: number,
): StepOutcome => {
  const steps: Array<WorkflowStepTraceEntry> = getTraceSteps(trace);
  const step: WorkflowStepTraceEntry | undefined = steps[index];

  const portTitle: string | null = step ? getStepPortTitle(step) : null;

  if (!step || !portTitle) {
    return {
      kind: StepOutcomeKind.NoPort,
      portTitle: null,
      portDescription: null,
      portTone: StepPortTone.Normal,
      nextSteps: [],
    };
  }

  const portTone: StepPortTone =
    step.executedPort === ERROR_PORT_ID
      ? StepPortTone.Error
      : StepPortTone.Normal;

  const portDescription: string | null = isText(step.executedPortDescription)
    ? step.executedPortDescription
    : null;

  if (!Array.isArray(step.nextSteps)) {
    return {
      kind: StepOutcomeKind.PortOnly,
      portTitle: portTitle,
      portDescription: portDescription,
      portTone: portTone,
      nextSteps: [],
    };
  }

  const nextSteps: Array<StepOutcomeNextStep> = step.nextSteps
    .filter((next: WorkflowStepTraceNextStep): boolean => {
      return Boolean(next) && isText(next.componentId);
    })
    .map((next: WorkflowStepTraceNextStep): StepOutcomeNextStep => {
      const laterIndex: number = steps.findIndex(
        (candidate: WorkflowStepTraceEntry, candidateIndex: number) => {
          return (
            candidateIndex > index && candidate.componentId === next.componentId
          );
        },
      );

      return {
        componentId: next.componentId,
        title: isText(next.title) ? next.title : next.componentId,
        stepNumber: laterIndex === -1 ? null : laterIndex + 1,
      };
    });

  return {
    kind:
      nextSteps.length > 0
        ? StepOutcomeKind.LedTo
        : StepOutcomeKind.NothingConnected,
    portTitle: portTitle,
    portDescription: portDescription,
    portTone: portTone,
    nextSteps: nextSteps,
  };
};

export enum TraceValueKind {
  /** A string, shown as it was. */
  Text = "Text",
  /** The empty string, which is worth saying out loud. */
  EmptyText = "EmptyText",
  Number = "Number",
  Boolean = "Boolean",
  Null = "Null",
  /** An object or a list, shown as indented JSON. */
  Structured = "Structured",
}

export interface TraceValueDisplay {
  kind: TraceValueKind;
  text: string;
  /** Too long or too many lines to sit on one line: shown as a block. */
  isBlock: boolean;
}

/*
 * A one-line value longer than this is shown as a block rather than inline:
 * past roughly a dialog's width a long token reads better with room to wrap.
 */
export const INLINE_VALUE_MAX_LENGTH: number = 80;

type FormatTraceValueFunction = (value: unknown) => TraceValueDisplay;

/** How one recorded value is shown. */
export const formatTraceValue: FormatTraceValueFunction = (
  value: unknown,
): TraceValueDisplay => {
  if (value === null || value === undefined) {
    return { kind: TraceValueKind.Null, text: "null", isBlock: false };
  }

  if (typeof value === "string") {
    if (value.length === 0) {
      return { kind: TraceValueKind.EmptyText, text: "", isBlock: false };
    }

    return {
      kind: TraceValueKind.Text,
      text: value,
      isBlock: value.includes("\n") || value.length > INLINE_VALUE_MAX_LENGTH,
    };
  }

  if (typeof value === "number") {
    return { kind: TraceValueKind.Number, text: String(value), isBlock: false };
  }

  if (typeof value === "boolean") {
    return {
      kind: TraceValueKind.Boolean,
      text: value ? "true" : "false",
      isBlock: false,
    };
  }

  let text: string;

  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }

  return { kind: TraceValueKind.Structured, text: text, isBlock: true };
};

export interface StepValueRow {
  id: string;
  /** The name the step's settings give it, or its id in an older trace. */
  name: string;
  value: TraceValueDisplay;
  /**
   * What the argument was configured as, {{...}} and all, when that differs
   * from what it resolved to. Null for a plain value, or when the reference
   * resolved to nothing and was passed on as written.
   */
  template: string | null;
  /** The {{...}} references in it that resolved to nothing. */
  unresolvedReferences: Array<string>;
}

type OrderedKeysFunction = (
  values: JSONObject,
  names: Array<WorkflowStepTraceFieldName> | undefined,
) => Array<string>;

/*
 * The keys in the order the step's settings list them, then anything the
 * settings do not list (a trigger's run arguments, a component that returns
 * extra), in the order the trace has them.
 */
const orderedKeys: OrderedKeysFunction = (
  values: JSONObject,
  names: Array<WorkflowStepTraceFieldName> | undefined,
): Array<string> => {
  const present: Array<string> = Object.keys(values || {});
  const ordered: Array<string> = [];

  for (const field of Array.isArray(names) ? names : []) {
    if (field && present.includes(field.id) && !ordered.includes(field.id)) {
      ordered.push(field.id);
    }
  }

  for (const key of present) {
    if (!ordered.includes(key)) {
      ordered.push(key);
    }
  }

  return ordered;
};

type NameOfFunction = (
  id: string,
  names: Array<WorkflowStepTraceFieldName> | undefined,
) => string;

const nameOf: NameOfFunction = (
  id: string,
  names: Array<WorkflowStepTraceFieldName> | undefined,
): string => {
  const field: WorkflowStepTraceFieldName | undefined = (
    Array.isArray(names) ? names : []
  ).find((candidate: WorkflowStepTraceFieldName): boolean => {
    return Boolean(candidate) && candidate.id === id;
  });

  return field && isText(field.name) ? field.name : id;
};

type TemplateTextFunction = (template: JSONValue | undefined) => string | null;

const templateText: TemplateTextFunction = (
  template: JSONValue | undefined,
): string | null => {
  if (template === undefined || template === null) {
    return null;
  }

  if (typeof template === "string") {
    return template;
  }

  try {
    return JSON.stringify(template, null, 2);
  } catch {
    return null;
  }
};

type GetReceivedRowsFunction = (
  step: WorkflowStepTraceEntry,
) => Array<StepValueRow>;

/** What the step received, one row per argument, in its settings' order. */
export const getReceivedRows: GetReceivedRowsFunction = (
  step: WorkflowStepTraceEntry,
): Array<StepValueRow> => {
  const values: JSONObject = step.argumentValues || {};
  const templates: JSONObject = step.argumentTemplates || {};
  const warnings: Array<WorkflowStepTraceWarning> = getStepWarnings(step);

  return orderedKeys(values, step.argumentNames).map(
    (id: string): StepValueRow => {
      const value: TraceValueDisplay = formatTraceValue(values[id]);
      const template: string | null = templateText(templates[id]);

      const unresolvedReferences: Array<string> = [];

      for (const warning of warnings) {
        if (warning.argumentId !== id) {
          continue;
        }

        for (const reference of warning.unresolvedReferences || []) {
          if (isText(reference) && !unresolvedReferences.includes(reference)) {
            unresolvedReferences.push(reference);
          }
        }
      }

      return {
        id: id,
        name: nameOf(id, step.argumentNames),
        value: value,
        template:
          template !== null && template !== value.text ? template : null,
        unresolvedReferences: unresolvedReferences,
      };
    },
  );
};

type GetReturnedRowsFunction = (
  step: WorkflowStepTraceEntry,
) => Array<StepValueRow>;

/** What the step returned, one row per value, in its settings' order. */
export const getReturnedRows: GetReturnedRowsFunction = (
  step: WorkflowStepTraceEntry,
): Array<StepValueRow> => {
  const values: JSONObject = step.returnValues || {};

  return orderedKeys(values, step.returnValueNames).map(
    (id: string): StepValueRow => {
      return {
        id: id,
        name: nameOf(id, step.returnValueNames),
        value: formatTraceValue(values[id]),
        template: null,
        unresolvedReferences: [],
      };
    },
  );
};

type ReturnsNothingByDesignFunction = (step: WorkflowStepTraceEntry) => boolean;

/**
 * The step's component declares no return values at all, as If / Else does:
 * "returned nothing" is then what it always does rather than news. Only a
 * trace that recorded the component's return values can say so.
 */
export const returnsNothingByDesign: ReturnsNothingByDesignFunction = (
  step: WorkflowStepTraceEntry,
): boolean => {
  return (
    Array.isArray(step.returnValueNames) && step.returnValueNames.length === 0
  );
};

export enum TraceAttention {
  /** A step failed, or the run stopped for a reason of its own. */
  Error = "Error",
  /** Nothing failed, but a step has a warning. */
  Warning = "Warning",
  None = "None",
}

type GetTraceAttentionFunction = (
  trace: WorkflowStepTrace | null | undefined,
) => TraceAttention;

/** The most serious thing in the run, for a badge that has one colour. */
export const getTraceAttention: GetTraceAttentionFunction = (
  trace: WorkflowStepTrace | null | undefined,
): TraceAttention => {
  const steps: Array<WorkflowStepTraceEntry> = getTraceSteps(trace);

  if (isText(trace?.runErrorMessage) || steps.some(isStepFailed)) {
    return TraceAttention.Error;
  }

  if (
    steps.some((step: WorkflowStepTraceEntry): boolean => {
      return getStepWarnings(step).length > 0;
    })
  ) {
    return TraceAttention.Warning;
  }

  return TraceAttention.None;
};

type ShouldStepStartOpenFunction = (
  trace: WorkflowStepTrace,
  index: number,
) => boolean;

/**
 * Whether a step's details are open without a click: the ones the reader
 * opened the run to see. A step that failed, a step with a warning (which is
 * usually about one of its arguments), and a run of one step, whose details
 * are the whole answer.
 */
export const shouldStepStartOpen: ShouldStepStartOpenFunction = (
  trace: WorkflowStepTrace,
  index: number,
): boolean => {
  const steps: Array<WorkflowStepTraceEntry> = getTraceSteps(trace);
  const step: WorkflowStepTraceEntry | undefined = steps[index];

  if (!step) {
    return false;
  }

  return (
    steps.length === 1 || isStepFailed(step) || getStepWarnings(step).length > 0
  );
};

type IsSingleStepRunFunction = (
  trace: WorkflowStepTrace | null | undefined,
) => boolean;

/** The run tested one step on its own ("Run this step" in the builder). */
export const isSingleStepRun: IsSingleStepRunFunction = (
  trace: WorkflowStepTrace | null | undefined,
): boolean => {
  return isText(trace?.singleStepComponentId);
};

type GetTraceResumesAtFunction = (
  trace: WorkflowStepTrace | null | undefined,
) => Date | null;

/**
 * When a run sleeping on a Sleep step carries on, or null for a run that is
 * not sleeping. While it sleeps, the steps after the Sleep have not run yet,
 * which is not the same as not running at all.
 */
export const getTraceResumesAt: GetTraceResumesAtFunction = (
  trace: WorkflowStepTrace | null | undefined,
): Date | null => {
  if (!isText(trace?.resumesAt)) {
    return null;
  }

  const resumesAt: Date = new Date(trace!.resumesAt as string);

  return isNaN(resumesAt.getTime()) ? null : resumesAt;
};

type IsWholeReferenceFunction = (text: string) => boolean;

const WHOLE_REFERENCE: RegExp = /^{{[^{}\s]+}}$/;

/**
 * The text is one {{...}} reference and nothing else, which reads best kept
 * whole and broken only between its parts.
 */
export const isWholeReference: IsWholeReferenceFunction = (
  text: string,
): boolean => {
  return WHOLE_REFERENCE.test(text.trim());
};
