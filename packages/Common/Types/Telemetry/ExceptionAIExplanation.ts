/*
 * WHAT ONEUPTIME AI SAYS ABOUT ONE EXCEPTION: what happened, the likely root
 * cause and how to fix it, written from its stack trace, the trace and logs
 * of its latest occurrence, and the deploys around it
 * (Server/Utils/AI/TelemetryAi/ExceptionExplanation). Kept on the exception
 * group (TelemetryException.aiExplanation) so everyone who opens it reads the
 * same answer without paying for it again, until someone asks for a new one.
 *
 * Shared by the server, which writes it, and the Dashboard, which reads it
 * back defensively (readExceptionAIExplanation): a stored value is JSON a
 * model wrote, so every field is checked and bounded on the way in and out.
 */

export const EXCEPTION_AI_EXPLANATION_VERSION: number = 1;

export enum ExceptionExplanationConfidence {
  High = "high",
  Medium = "medium",
  Low = "low",
}

/*
 * Where the fault most likely lies: the exception's own code, a library or
 * service it calls, the infrastructure under it, bad input, or settings.
 */
export enum ExceptionExplanationCategory {
  Code = "code",
  Dependency = "dependency",
  Infrastructure = "infrastructure",
  UserInput = "user-input",
  Configuration = "configuration",
  Unknown = "unknown",
}

// A frame of the exception's own stack trace the explanation points at.
export interface ExceptionExplanationFrame {
  file: string;
  line?: number | undefined;
  function?: string | undefined;
}

export interface ExceptionAIExplanation {
  version: number;
  // One or two sentences: what went wrong, in plain words.
  summary: string;
  // Markdown: the most likely root cause, and the evidence for it.
  rootCause: string;
  // Markdown: what to change.
  suggestedFix: string;
  confidence: ExceptionExplanationConfidence;
  category: ExceptionExplanationCategory;
  // At most MAX_SUSPECT_FRAMES, every one a frame of the stack trace.
  suspectFrames: Array<ExceptionExplanationFrame>;
  // At most MAX_NEXT_STEPS short sentences.
  nextSteps: Array<string>;
}

// How much of each field is kept: a model can write more, a reader needs less.
export const MAX_SUMMARY_LENGTH: number = 600;
export const MAX_ROOT_CAUSE_LENGTH: number = 4000;
export const MAX_SUGGESTED_FIX_LENGTH: number = 6000;
export const MAX_NEXT_STEP_LENGTH: number = 300;
export const MAX_NEXT_STEPS: number = 3;
export const MAX_SUSPECT_FRAMES: number = 3;
export const MAX_FRAME_FIELD_LENGTH: number = 300;

function boundedText(value: unknown, max: number): string {
  if (typeof value !== "string") {
    return "";
  }

  const text: string = value.trim();

  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function enumValue<T extends string>(
  value: unknown,
  values: ReadonlyArray<T>,
  fallback: T,
): T {
  return typeof value === "string" && values.includes(value as T)
    ? (value as T)
    : fallback;
}

function readFrame(value: unknown): ExceptionExplanationFrame | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const file: string = boundedText(record["file"], MAX_FRAME_FIELD_LENGTH);

  if (!file) {
    return null;
  }

  const line: unknown = record["line"];
  const functionName: string = boundedText(
    record["function"],
    MAX_FRAME_FIELD_LENGTH,
  );

  return {
    file,
    ...(typeof line === "number" && Number.isInteger(line) && line > 0
      ? { line }
      : {}),
    ...(functionName ? { function: functionName } : {}),
  };
}

/*
 * An explanation as stored or as a model wrote it, every field checked and
 * bounded, or null when it holds no summary to show. Unknown confidence and
 * category values read as low and unknown.
 */
export function readExceptionAIExplanation(
  value: unknown,
): ExceptionAIExplanation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const summary: string = boundedText(record["summary"], MAX_SUMMARY_LENGTH);

  if (!summary) {
    return null;
  }

  const frames: Array<ExceptionExplanationFrame> = (
    Array.isArray(record["suspectFrames"]) ? record["suspectFrames"] : []
  )
    .map(readFrame)
    .filter((frame: ExceptionExplanationFrame | null): boolean => {
      return frame !== null;
    })
    .slice(0, MAX_SUSPECT_FRAMES) as Array<ExceptionExplanationFrame>;

  const nextSteps: Array<string> = (
    Array.isArray(record["nextSteps"]) ? record["nextSteps"] : []
  )
    .map((step: unknown): string => {
      return boundedText(step, MAX_NEXT_STEP_LENGTH);
    })
    .filter((step: string): boolean => {
      return step.length > 0;
    })
    .slice(0, MAX_NEXT_STEPS);

  return {
    version: EXCEPTION_AI_EXPLANATION_VERSION,
    summary,
    rootCause: boundedText(record["rootCause"], MAX_ROOT_CAUSE_LENGTH),
    suggestedFix: boundedText(record["suggestedFix"], MAX_SUGGESTED_FIX_LENGTH),
    confidence: enumValue(
      record["confidence"],
      Object.values(ExceptionExplanationConfidence),
      ExceptionExplanationConfidence.Low,
    ),
    category: enumValue(
      record["category"],
      Object.values(ExceptionExplanationCategory),
      ExceptionExplanationCategory.Unknown,
    ),
    suspectFrames: frames,
    nextSteps,
  };
}
